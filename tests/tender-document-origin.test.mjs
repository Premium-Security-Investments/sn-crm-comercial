// El origen del documento (pendiente de Juan, 2026-10-22; construido el 2026-10-23).
//
// Los casos que lo pidieron son reales y de octubre de 2026: las seis cartas de terceros que Juan cargó en la
// Fiscalía el 21-oct, la carta de otra empresa en Pereira tipificada `pliego` porque el nombre del archivo traía
// esa palabra, los dos consolidados de respuestas de Supersalud que SÍ son de la entidad, y un resumen del
// propio equipo guardado con el peso del pliego. Antes de este cambio los cuatro entraban como
// `official` / `VERIFIED_OFFICIAL`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TENDER_DOCUMENT_ORIGINS,
  TENDER_DOCUMENT_ORIGIN_VALUES,
  normalizeTenderDocumentOrigin,
  suggestTenderDocumentOrigin,
  tenderDocumentBreaksEntitySilence,
  tenderDocumentSourceClassification,
} from '../verticales/licitaciones/tender-document-origin.js';
import { agt002InitialRequestedMembers } from '../verticales/licitaciones/agt002-initial-document-rule.js';
import { agt002IsOfficialDocumentSource } from '../verticales/licitaciones/agt002-schedule-freshness.js';

test('el vocabulario es el mismo que acepta la base', () => {
  assert.deepEqual(TENDER_DOCUMENT_ORIGIN_VALUES, ['entidad', 'tercero', 'propio', 'borrador']);
  const migracion = readFileSync(new URL('../supabase/migrations/150_tender_document_origin.sql', import.meta.url), 'utf8');
  for (const valor of TENDER_DOCUMENT_ORIGIN_VALUES) {
    assert.ok(migracion.includes(`'${valor}'`), `la migración debe aceptar ${valor}`);
  }
  assert.match(migracion, /check \(origin is null or origin in \('entidad', 'tercero', 'propio', 'borrador'\)\)/);
});

test('cada origen produce su clase, y lo no declarado cae en tercero', () => {
  assert.equal(tenderDocumentSourceClassification('entidad'), 'official');
  assert.equal(tenderDocumentSourceClassification('tercero'), 'third_party');
  assert.equal(tenderDocumentSourceClassification('propio'), 'internal');
  assert.equal(tenderDocumentSourceClassification('borrador'), 'draft');
  // Lo que importa: sin declarar NUNCA es oficial. Falla hacia "esto no es una regla del proceso".
  for (const sinDeclarar of [null, undefined, '', '  ', 'official', 'cualquier cosa', 42]) {
    assert.equal(tenderDocumentSourceClassification(sinDeclarar), 'third_party', String(sinDeclarar));
  }
});

test('normalizar acepta mayúsculas y espacios, y rechaza lo que no es del vocabulario', () => {
  assert.equal(normalizeTenderDocumentOrigin('  ENTIDAD '), 'entidad');
  assert.equal(normalizeTenderDocumentOrigin('Tercero'), 'tercero');
  assert.equal(normalizeTenderDocumentOrigin('oficial'), null);
  assert.equal(normalizeTenderDocumentOrigin(null), null);
  assert.deepEqual(Object.keys(TENDER_DOCUMENT_ORIGINS), TENDER_DOCUMENT_ORIGIN_VALUES);
});

test('el caso real de Pereira: la carta de un tercero deja de entrar como el pliego de la entidad', () => {
  const incluidos = [
    { version: { id: 'v1', name: 'PROYECTO DE PLIEGOS.pdf', origin: 'entidad' }, reason: 'Pliego de condiciones.' },
    // Carta de otra empresa. El nombre del archivo trae "PLIEGOS", y por eso el tipo le queda `pliego`:
    // el ORIGEN es lo que impide que además quede con el peso de la entidad.
    { version: { id: 'v2', name: 'OBSERVACIONES AL PROYECTO DE PLIEGOS PEREIRA ADMINISTRATIVO.docx.pdf', origin: 'tercero' }, reason: 'Respuestas a observaciones.' },
    { version: { id: 'v3', name: 'Informe Consolidado propio.pdf', origin: 'propio' }, reason: 'Documento oficial vigente del proceso.' },
    { version: { id: 'v4', name: 'Anexo sin declarar.pdf', origin: null }, reason: 'Anexos y formatos de la propuesta.' },
  ];
  assert.deepEqual(agt002InitialRequestedMembers(incluidos).map(m => [m.document_version_id, m.source_classification]), [
    ['v1', 'official'],
    ['v2', 'third_party'],
    ['v3', 'internal'],
    ['v4', 'third_party'],
  ]);
});

test('la razón de inclusión y el recorte a 500 no cambian', () => {
  const largo = 'x'.repeat(900);
  const [miembro] = agt002InitialRequestedMembers([{ version: { id: 'v1', origin: 'entidad' }, reason: largo }]);
  assert.equal(miembro.inclusion_reason.length, 500);
  assert.deepEqual(Object.keys(miembro).sort(), ['document_version_id', 'inclusion_reason', 'source_classification']);
});

test('el caso real de Supersalud: una carga manual declarada de la entidad SÍ rompe el silencio', () => {
  // Los dos consolidados de respuestas se bajaron del módulo de mensajes de SECOP II y se subieron a mano.
  // El 23-oct la verificación de frescura afirmaba que la entidad no había publicado nada, teniéndolos.
  const consolidado = { source: 'carga manual', origin: 'entidad' };
  assert.equal(tenderDocumentBreaksEntitySilence(consolidado, agt002IsOfficialDocumentSource), true);

  // Lo que entra por el portal no necesita declaración: se sabe de dónde se bajó.
  assert.equal(tenderDocumentBreaksEntitySilence({ source: 'secop ii', origin: null }, agt002IsOfficialDocumentSource), true);
  assert.equal(tenderDocumentBreaksEntitySilence({ source: 'esu contratación', origin: null }, agt002IsOfficialDocumentSource), true);

  // Y lo que NO rompe el silencio sigue sin romperlo: una carga nuestra, la de un tercero, y la sin declarar.
  for (const origin of [null, 'propio', 'tercero', 'borrador']) {
    assert.equal(tenderDocumentBreaksEntitySilence({ source: 'carga manual', origin }, agt002IsOfficialDocumentSource), false, String(origin));
  }
});

test('la pantalla no propone origen para una carga manual: adivinarlo es el defecto que esto corrige', () => {
  assert.equal(suggestTenderDocumentOrigin({ source: 'secop ii' }, agt002IsOfficialDocumentSource), 'entidad');
  assert.equal(suggestTenderDocumentOrigin({ source: 'carga manual' }, agt002IsOfficialDocumentSource), null);
  assert.equal(suggestTenderDocumentOrigin({ source: '' }, agt002IsOfficialDocumentSource), null);
});

test('el servidor declara el origen en las tres rutas que graban versiones', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api, 'los dos backends tienen que ser idénticos');
  // Las dos importaciones oficiales saben de dónde bajaron el archivo; la carga manual lo recibe declarado.
  assert.equal((server.match(/p_origin: 'entidad',/g) || []).length, 2);
  assert.match(server, /p_origin: normalizeTenderDocumentOrigin\(version\.origin\),/);
  assert.match(server, /origin: normalizeTenderDocumentOrigin\(file\.origin\),/);
  // El listado lo devuelve, para que la pantalla pueda mostrar lo que falta declarar.
  assert.match(server, /origin: version\.origin \|\| null,/);
  assert.match(server, /select\('id,opportunity_id,name,document_type[^']*,origin'\)/);
  // Y existe la ruta para corregirlo sin recargar el archivo, con la oportunidad verificada.
  const ruta = server.match(/app\.post\('\/api\/tender-document-origin'[\s\S]*?\n}\);/)?.[0] || '';
  assert.ok(ruta, 'la ruta para declarar el origen debe existir');
  assert.match(ruta, /await ensureTenderOpportunity\(database, opportunityId, currentProfile\)/);
  assert.match(ruta, /\.eq\('id', documentVersionId\)\.eq\('opportunity_id', opportunityId\)/,
    'el id solo no autoriza: el documento tiene que ser de esa oportunidad');
  assert.match(ruta, /rpc\('psi_set_tender_document_origin'/);
});

test('la selección de documentos pide el origen a la base', () => {
  const auto = readFileSync(new URL('../verticales/licitaciones/agt002-auto-initial.js', import.meta.url), 'utf8');
  assert.match(auto, /\.select\('id,name,tender_id,origin'\)/, 'sin leerlo, la clase volvería a ser una suposición');
  const frescura = readFileSync(new URL('../verticales/licitaciones/agt002-schedule-freshness.js', import.meta.url), 'utf8');
  assert.match(frescura, /\.select\('created_at,source,origin'\)/);
  assert.match(frescura, /tenderDocumentBreaksEntitySilence\(document, agt002IsOfficialDocumentSource\)/);
});

test('la pantalla obliga a declarar antes de escoger archivos', () => {
  const seccion = readFileSync(new URL('../src/tenders/components/TenderDocumentSection.tsx', import.meta.url), 'utf8');
  assert.match(seccion, /¿Quién produjo estos documentos\?/);
  assert.match(seccion, /disabled=\{busy \|\| !uploadOrigin\}/, 'sin origen declarado no se pueden escoger archivos');
  assert.match(seccion, /useState<TenderDocumentOrigin \| ''>\(''\)/, 'sin valor por defecto: nadie adivina por el usuario');
  assert.match(seccion, /sin declarar su origen/, 'la lista avisa cuántos faltan');
  assert.match(seccion, /onSetOrigin\(document\.id, value\)/, 'y deja corregir uno ya cargado');
});
