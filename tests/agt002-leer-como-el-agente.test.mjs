// Leer como el agente (Juan, 2026-11-17). Dos cartas de terceros al pliego definitivo de la DEAJ: en la de Seguridad
// Atlas el nombre estaba sólo en el logo, y la de TAC pedía lo mismo que nuestra observación 2. Vig-IA no identificó a
// Atlas ni vio la coincidencia. Estas pruebas cubren las tres capacidades que se le dieron: el texto de las imágenes de
// una carta de tercero, la razón de inclusión según el origen y nuestras cartas de observaciones en la síntesis.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  TENDER_DOCUMENT_IMAGE_TEXT_EXTRACTOR_VERSION, TENDER_DOCUMENT_IMAGE_TEXT_HEADING, TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION,
  combineTextAndImageText, ocrPdfImages, runTenderDocumentImageTextPass, selectImageTextCandidates,
} from '../verticales/licitaciones/tender-document-ocr.js';
import { TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION } from '../verticales/licitaciones/tender-document-text-extraction.js';
import { selectCanonicalExtractionsByDocumentVersion } from '../verticales/licitaciones/tender-document-extraction-persistence.js';
import { agt002InitialRequestedMembers } from '../verticales/licitaciones/agt002-initial-document-rule.js';
import { agt002CrmFileName, agt002ManualUploadDocumentId, runAgt002OurObservationsPass, selectAgt002OurLettersToIngest } from '../verticales/licitaciones/agt002-nuestras-observaciones-sharepoint.js';
import { agt002NuestrasObservacionesForModel, isAgt002OurObservationLetter, loadAgt002NuestrasObservaciones } from '../verticales/licitaciones/agt002-nuestras-observaciones.js';

const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const V = (id, extra = {}) => ({ id, opportunity_id: 'o1', tender_id: 't1', name: `${id}.pdf`, mime_type: 'application/pdf', storage_path: `manual-uploads/o1/${id}.pdf`, current: true, actor_id: 'k', created_at: '2026-11-17T19:11:00Z', origin: 'tercero', ...extra });
const OK = (id, text, extra = {}) => ({ id: `e-${id}`, document_version_id: id, extractor_version: TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION, status: 'ok', extracted_text: text, text_hash: sha(text), char_count: [...text].length, created_at: '2026-11-17T19:11:01Z', ...extra });
const CARTA = 'Bogotá, D.C., 17 de noviembre de 2026\nObservación # 3 Numeral 5.2.1 REQUISITOS FINANCIEROS HABILITANTES\nLUIS FERNANDO GARCÍA TARQUINO\nRepresentante Legal';

test('candidatas: cartas de terceros en PDF con texto del extractor, que no se hayan leído las imágenes', () => {
  const versions = [
    V('atlas'), V('propia', { origin: 'propio' }), V('entidad', { origin: 'entidad' }), V('escaneada'),
    V('leida'), V('word', { name: 'carta.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
  ];
  const extractions = [
    OK('atlas', CARTA), OK('propia', CARTA), OK('entidad', CARTA), OK('word', CARTA), OK('leida', CARTA),
    OK('escaneada', 'texto del OCR', { extractor_version: TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION }),
    OK('leida', CARTA, { id: 'x', extractor_version: TENDER_DOCUMENT_IMAGE_TEXT_EXTRACTOR_VERSION }),
  ];
  assert.deepEqual(selectImageTextCandidates(versions, extractions).map(v => v.id), ['atlas']);
});

test('el texto de las imágenes va después del texto del documento, que no cambia; sin palabras, no se agrega nada', () => {
  const combined = combineTextAndImageText(CARTA, 'ATLAS\nSeguridad\nNos gusta cuidarte');
  assert.ok(combined.startsWith(CARTA));
  assert.ok(combined.endsWith(`${TENDER_DOCUMENT_IMAGE_TEXT_HEADING}\nATLAS\nSeguridad\nNos gusta cuidarte`));
  assert.equal(combineTextAndImageText(CARTA, ' | ° 12 '), CARTA);
  assert.equal(combineTextAndImageText(CARTA, ''), CARTA);
});

function fakeDb({ versions, extractions = [] }) {
  const calls = [];
  const table = rows => ({ select() { return this; }, eq() { return this; }, is() { return this; }, in() { return Promise.resolve({ data: rows, error: null }); } });
  return {
    calls,
    from(name) {
      if (name === 'psi_sales_opportunities') return { select() { return this; }, eq() { return this; }, is: () => Promise.resolve({ data: [{ id: 'o1' }], error: null }) };
      if (name === 'psi_tender_document_versions') return table(versions);
      return table(extractions);
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob([Buffer.from('%PDF')]), error: null }) }) },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: {}, error: null }; },
  };
}

test('el pase guarda una extracción nueva que gana en la lectura canónica, y una falla no corta el pase', async () => {
  const db = fakeDb({ versions: [V('atlas'), V('rota', { created_at: '2026-11-17T18:00:00Z' })], extractions: [OK('atlas', CARTA), OK('rota', CARTA)] });
  let n = 0;
  const events = await runTenderDocumentImageTextPass(db, { ocr: async () => { n += 1; if (n === 2) throw new Error('pdfimages'); return { text: 'ATLAS Seguridad', images: 2 }; } });
  assert.deepEqual(events.map(e => e.event), ['tender_image_text_recorded', 'tender_image_text_failed']);
  const args = db.calls[0].args;
  assert.equal(args.p_extractor_version, TENDER_DOCUMENT_IMAGE_TEXT_EXTRACTOR_VERSION);
  assert.equal(args.p_status, 'ok');
  assert.match(args.p_extracted_text, /ATLAS Seguridad$/);
  assert.equal(args.p_text_hash, sha(args.p_extracted_text));
  assert.equal(args.p_char_count, [...args.p_extracted_text].length);
  const nueva = { id: 'n', document_version_id: 'atlas', extractor_version: args.p_extractor_version, status: 'ok', extracted_text: args.p_extracted_text, text_hash: args.p_text_hash, char_count: args.p_char_count, created_at: '2026-11-17T19:13:00Z' };
  assert.equal(selectCanonicalExtractionsByDocumentVersion([OK('atlas', CARTA), nueva]).get('atlas').id, 'n');
});

test('sin texto en las imágenes igual queda la extracción (con el texto de siempre), para no reintentar', async () => {
  const db = fakeDb({ versions: [V('sin-logo')], extractions: [OK('sin-logo', CARTA)] });
  await runTenderDocumentImageTextPass(db, { ocr: async () => ({ text: '', images: 0 }) });
  assert.equal(db.calls[0].args.p_extracted_text, CARTA);
  assert.equal(db.calls[0].args.p_metadata.texto_en_imagenes, false);
});

test('va en el trabajo que arranca los análisis, antes de admitirlos', () => {
  const runner = readFileSync(new URL('../ops/agt002-auto-initial/run-agt002-auto-initial.mjs', import.meta.url), 'utf8');
  assert.ok(runner.indexOf('runTenderDocumentImageTextPass(') > 0);
  assert.ok(runner.indexOf('runTenderDocumentImageTextPass(') < runner.indexOf('runAgt002AutoInitialAdmissions('));
  assert.ok(runner.indexOf('runTenderDocumentImageTextPass(') < runner.indexOf('runAgt002ManualReanalysisRequests('));
});

let hasTools = true;
try {
  for (const [cmd, arg] of [['tesseract', '--version'], ['pdfimages', '-v']]) execFileSync(cmd, [arg], { stdio: 'ignore' });
  execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
} catch { hasTools = false; }
test('lectura real: un PDF cuyo único texto es el de un logo (sólo donde hay tesseract)', { skip: !hasTools && 'sin tesseract, pdfimages o Pillow' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logo-'));
  try {
    const pdf = join(dir, 'logo.pdf');
    execFileSync('python3', ['-c', [
      'import sys', 'from PIL import Image, ImageDraw, ImageFont',
      'img = Image.new("RGB", (900, 260), "white")',
      'font = ImageFont.truetype("DejaVuSans-Bold.ttf", 110) if __import__("os").path.exists("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf") else ImageFont.load_default()',
      'ImageDraw.Draw(img).text((40, 60), "ATLAS", fill="black", font=font)',
      'img.save(sys.argv[1], "PDF", resolution=150)',
    ].join('\n'), pdf]);
    const result = await ocrPdfImages(readFileSync(pdf), { maxPages: 1 });
    assert.ok(result.images >= 1);
    assert.match(result.text, /ATLAS/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('la razón de inclusión dice qué es el documento cuando el origen está declarado', () => {
  const regla = 'Respuestas a observaciones: aclaran o modifican requisitos.';
  const members = agt002InitialRequestedMembers([
    { version: { id: 'tac', origin: 'tercero' }, reason: regla },
    { version: { id: 'nuestra', origin: 'propio' }, reason: regla },
    { version: { id: 'entidad', origin: 'entidad' }, reason: regla },
    { version: { id: 'sin', origin: null }, reason: regla },
  ]);
  assert.match(members[0].inclusion_reason, /de un tercero/);
  assert.match(members[1].inclusion_reason, /Documento nuestro/);
  assert.equal(members[2].inclusion_reason, regla);
  assert.equal(members[3].inclusion_reason, regla);
});

const L = (id, name, extra = {}) => ({ id, name, origin: 'propio', current: true, created_at: '2026-11-17T20:00:00Z', ...extra });
test('nuestras cartas: sólo las propias y vigentes que son cartas de observaciones; la nota y la constancia no', () => {
  assert.equal(isAgt002OurObservationLetter(L('a', 'OBSERVACIONES_PLIEGO_DEFINITIVO_LP-07-2026_DEAJ_SEGURIDAD_NACIONAL.pdf')), true);
  assert.equal(isAgt002OurObservationLetter(L('b', '00_NOTA_PARA_KATHERINE_DEFINITIVO_LP-07-2026_DEAJ.docx')), false);
  assert.equal(isAgt002OurObservationLetter(L('c', 'CONSTANCIA_RADICACION_observaciones.pdf')), false);
  assert.equal(isAgt002OurObservationLetter(L('d', 'Respuesta-Observaciones-LP-07-2026.pdf')), false);
  assert.equal(isAgt002OurObservationLetter(L('e', 'OBSERVACIONES_TAC.pdf', { origin: 'tercero' })), false);
  assert.equal(isAgt002OurObservationLetter(L('f', 'OBSERVACIONES_viejas.pdf', { current: false })), false);
});

test('nuestras cartas para el modelo: la más reciente primero, con su texto canónico; sin texto no van', () => {
  const versions = [L('vieja', 'OBSERVACIONES_PROYECTO.pdf', { created_at: '2026-11-10T00:00:00Z' }), L('nueva', 'OBSERVACIONES_DEFINITIVO.pdf'), L('vacia', 'OBSERVACIONES_X.pdf')];
  const rows = [OK('vieja', 'OBSERVACIÓN 1 …'), OK('nueva', 'OBSERVACIÓN 2 … por lo menos uno de sus integrantes'), { id: 'g', document_version_id: 'vacia', extractor_version: TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION, status: 'gap', created_at: '2026-11-17T20:00:01Z' }];
  const cartas = agt002NuestrasObservacionesForModel(versions, rows);
  assert.deepEqual(cartas.map(carta => carta.nombre), ['OBSERVACIONES_DEFINITIVO.pdf', 'OBSERVACIONES_PROYECTO.pdf']);
  assert.match(cartas[0].texto, /por lo menos uno de sus integrantes/);
});

test('si la lectura falla, el análisis sigue sin las cartas', async () => {
  assert.deepEqual(await loadAgt002NuestrasObservaciones({ from() { throw new Error('caída'); } }, { opportunityId: 'o1' }), []);
  assert.deepEqual(await loadAgt002NuestrasObservaciones({ from: () => ({ select() { return this; }, eq() { return this; }, then: resolve => resolve({ data: null, error: { code: 'x' } }) }) }, { opportunityId: 'o1' }), []);
});

// --- De la carpeta de radicación al expediente ------------------------------------------------------------------

const BASE = '06_Productos_PSI/Licitaciones/03_Procesos_Activos/RAMA JUDICIAL - DEAJ ALTAS CORTES BOGOTA - LP-07-2026';
const F = (sub, nombre, bytes = 100, modificado_en = '2026-11-17T15:00:00Z') => ({ ruta: `${BASE}/01_Observaciones/${sub}/${nombre}`, nombre, bytes, modificado_en });

test('cartas a cargar: PDF antes que Word, sin nota, léeme ni constancia, y sólo lo que el expediente no tiene', () => {
  const files = [
    F('Definitivo', '00_LEEME.md'), F('Definitivo', '00_NOTA_PARA_KATHERINE_DEFINITIVO_LP-07-2026_DEAJ.docx'),
    F('Definitivo', 'OBSERVACIONES_PLIEGO_DEFINITIVO_LP-07-2026_DEAJ_SEGURIDAD_NACIONAL.docx'),
    F('Definitivo', 'OBSERVACIONES_PLIEGO_DEFINITIVO_LP-07-2026_DEAJ_SEGURIDAD_NACIONAL.pdf', 200),
    F('Definitivo', 'CONSTANCIA_RADICACION_2026-11-17.pdf'),
    F('Proyecto', 'OBSERVACIONES_LP-07-2026_DEAJ.docx', 300, '2026-11-06T15:00:00Z'),
    { ruta: `${BASE}/05_Competidores/OBSERVACION_TAC_SEGURIDAD.pdf`, nombre: 'OBSERVACION_TAC_SEGURIDAD.pdf', bytes: 1 },
  ];
  assert.deepEqual(selectAgt002OurLettersToIngest(files).map(file => file.nombre), [
    'OBSERVACIONES_PLIEGO_DEFINITIVO_LP-07-2026_DEAJ_SEGURIDAD_NACIONAL.pdf', 'OBSERVACIONES_LP-07-2026_DEAJ.docx',
  ]);
  const existing = [{ name: agt002CrmFileName('OBSERVACIONES_PLIEGO_DEFINITIVO_LP-07-2026_DEAJ_SEGURIDAD_NACIONAL.pdf'), size_bytes: 200 }];
  assert.deepEqual(selectAgt002OurLettersToIngest(files, existing).map(file => file.nombre), ['OBSERVACIONES_LP-07-2026_DEAJ.docx']);
  // Si cambió (otro tamaño), se vuelve a cargar: la carga del CRM reemplaza la versión del mismo nombre.
  assert.equal(selectAgt002OurLettersToIngest(files, [{ ...existing[0], size_bytes: 201 }]).length, 2);
});

function syncDb({ versions = [] } = {}) {
  const chain = rows => ({ select() { return this; }, eq() { return this; }, in() { return this; }, then: resolve => resolve({ data: rows, error: null }) });
  return {
    from(name) {
      if (name === 'psi_tender_filing_folders') return chain([{ opportunity_id: 'o1', folder_path: BASE, status: 'creada' }, { opportunity_id: 'o2', folder_path: 'x', status: 'creada' }]);
      if (name === 'psi_sales_opportunities') return chain([{ id: 'o1', company_name: 'DEAJ' }, { id: 'o2', company_name: 'Archivada', archived_at: '2026-11-01' }]);
      if (name === 'psi_tender_processing_jobs') return { ...chain([{ requested_by: 'juan', created_at: '2026-11-01' }]), order() { return this; }, limit() { return this; } };
      return chain(versions);
    },
  };
}

test('el pase carga nuestras cartas como «propio», sin proponer datos a la ficha, y salta lo archivado y lo ya cargado', async () => {
  const bytes = Buffer.from('%PDF carta');
  const listed = [];
  const ingested = [];
  const events = await runAgt002OurObservationsPass(syncDb(), {
    listing: async path => { listed.push(path); return [F('Definitivo', 'OBSERVACIONES_PLIEGO_DEFINITIVO.pdf')]; },
    download: async () => bytes,
    ingest: async args => { ingested.push(args); return { upload_results: [{ status: 'new' }], analysis_request: { requested: true } }; },
    actorProfileId: 'vigia',
  });
  assert.deepEqual(listed, [`${BASE}/01_Observaciones`]);
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].opportunityId, 'o1');
  assert.equal(ingested[0].actorProfileId, 'vigia');
  assert.equal(ingested[0].proposeCompanyFacts, false);
  // La carga queda a nombre de Vig-IA; el reanálisis, a nombre de quien convirtió la oportunidad.
  assert.equal(ingested[0].analysisRequestedBy, 'juan');
  assert.deepEqual(ingested[0].files.map(file => [file.name, file.origin, file.mime_type]), [['OBSERVACIONES_PLIEGO_DEFINITIVO.pdf', 'propio', 'application/pdf']]);
  assert.equal(Buffer.from(ingested[0].files[0].content_base64, 'base64').toString(), '%PDF carta');
  assert.deepEqual(events, [{ event: 'agt002_nuestras_observaciones_cargadas', opportunity_id: 'o1', cartas: 1, estados: ['new'], reanalisis: true }]);

  // La misma carta ya cargada por una persona con otro nombre: se reconoce por su contenido y no se vuelve a cargar.
  const again = [];
  const quiet = await runAgt002OurObservationsPass(syncDb({ versions: [{ name: 'carta.pdf', size_bytes: 1, source_document_id: agt002ManualUploadDocumentId(bytes) }] }), {
    listing: async () => [F('Definitivo', 'OBSERVACIONES_PLIEGO_DEFINITIVO.pdf')], download: async () => bytes,
    ingest: async args => { again.push(args); return {}; }, actorProfileId: 'vigia',
  });
  assert.equal(again.length, 0);
  assert.deepEqual(quiet, [{ event: 'agt002_nuestras_observaciones_al_dia' }]);
});

test('el trabajo de borradores corre el pase y sólo lee SharePoint', () => {
  const runner = readFileSync(new URL('../ops/agt002-sharepoint-bridge/run-agt002-sharepoint-drafts.mjs', import.meta.url), 'utf8');
  const block = runner.slice(runner.indexOf('runAgt002OurObservationsPass(database'));
  assert.ok(block.length > 0);
  const pass = readFileSync(new URL('../verticales/licitaciones/agt002-nuestras-observaciones-sharepoint.js', import.meta.url), 'utf8');
  assert.doesNotMatch(pass, /subir\.py|uploader|--reemplazar/);
});
