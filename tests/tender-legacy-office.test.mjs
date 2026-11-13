// Formatos viejos de Office (Juan, 2026-11-13). Defensoría del Pueblo entró al análisis con 12 de 13 documentos:
// «7. FORMATOS Y FORMULARIOS.zip» traía cuatro .doc/.xls y un archivo de bloqueo de Word («~$…»).
import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { extractTenderDocumentText, isArchiveSystemEntry } from '../verticales/licitaciones/tender-document-text-extraction.js';
import {
  TENDER_DOCUMENT_LEGACY_OFFICE_EXTRACTOR_VERSION, legacyOfficeRepairable, readLegacyOfficeDocument, runTenderDocumentLegacyOfficePass,
  selectLegacyOfficeCandidates, upgradeLegacyOfficeArchive,
} from '../verticales/licitaciones/tender-document-legacy-office.js';

// Un .docx mínimo que mammoth lee: lo que «devolvería» LibreOffice en la prueba, sin necesitarlo en CI.
function docx(text) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  zip.addFile('_rels/.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`));
  return zip.toBuffer();
}
const fakeConvert = async (buffer, name) => docx(`CONVERTIDO ${name.split('/').pop()}`);

function paqueteDefensoria() {
  const zip = new AdmZip();
  zip.addFile('7. FORMATOS/1. MODELO CARTA DE PRESENTACION DE LA PROPUESTA.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]));
  zip.addFile('7. FORMATOS/6. EXPERIENCIA HABILITANTE DEL PROPONENTE.docx', docx('FORMATO 6 EXPERIENCIA'));
  zip.addFile('7. FORMATOS/~$ CAPACIDAD FINANCIERA.docx', Buffer.from('JuanB'));
  return zip.toBuffer();
}

test('el archivo de bloqueo de Word es basura de sistema y ya no tumba el paquete', async () => {
  assert.equal(isArchiveSystemEntry('7. FORMATOS/~$ CAPACIDAD FINANCIERA.docx'), true);
  assert.equal(isArchiveSystemEntry('7. FORMATOS/Capacidad financiera.docx'), false);
  const result = await extractTenderDocumentText(paqueteDefensoria(), '7. FORMATOS Y FORMULARIOS.zip');
  assert.equal(result.status, 'gap', 'el .doc sigue sin leerse en la carga');
  assert.deepEqual(result.metadata.internal_gaps.map(gap => gap.gap_reason), ['unsupported_type']);
  assert.equal(result.metadata.skipped_system_entries, 1);
});

test('en el servidor, el .doc del zip se convierte y el paquete queda completo con el mismo extractor', async () => {
  const upgraded = await upgradeLegacyOfficeArchive(paqueteDefensoria(), { convert: fakeConvert });
  assert.deepEqual(upgraded.converted, ['7. FORMATOS/1. MODELO CARTA DE PRESENTACION DE LA PROPUESTA.doc']);
  const { result } = await readLegacyOfficeDocument({ name: '7. FORMATOS Y FORMULARIOS.zip', mime_type: 'application/octet-stream' }, paqueteDefensoria(), { convert: fakeConvert });
  assert.equal(result.status, 'ok');
  assert.match(result.text, /CONVERTIDO 1\. MODELO CARTA DE PRESENTACION DE LA PROPUESTA\.doc/);
  assert.match(result.text, /FORMATO 6 EXPERIENCIA/);
  const suelto = await readLegacyOfficeDocument({ name: 'Formato 3.doc' }, Buffer.from('x'), { convert: fakeConvert });
  assert.equal(suelto.result.status, 'ok');
});

test('sólo se intenta lo que la conversión arregla, y una sola vez', () => {
  const gapZip = (gaps) => ({ status: 'gap', metadata: { gap_reason: 'archive_incomplete_extraction', internal_gaps: gaps } });
  assert.equal(legacyOfficeRepairable({ name: 'F.zip' }, gapZip([{ entry_name: 'a.doc', gap_reason: 'unsupported_type' }, { entry_name: 'b.xls', gap_reason: 'unsupported_type' }])), true);
  assert.equal(legacyOfficeRepairable({ name: 'F.zip' }, gapZip([{ entry_name: 'a.doc', gap_reason: 'unsupported_type' }, { entry_name: 'c.zip', gap_reason: 'nested_archive_not_supported' }])), false, 'un zip anidado no se arregla convirtiendo');
  assert.equal(legacyOfficeRepairable({ name: 'F.zip' }, gapZip([{ entry_name: 'a.doc', gap_reason: 'unsupported_type' }, { entry_name: '~$ b.docx', gap_reason: 'extraction_error' }])), true, 'el archivo de bloqueo viejo no impide arreglarlo');
  assert.equal(legacyOfficeRepairable({ name: 'Carta.doc' }, { status: 'gap', metadata: { gap_reason: 'unsupported_type' } }), true);
  assert.equal(legacyOfficeRepairable({ name: 'Plano.dwg' }, { status: 'gap', metadata: { gap_reason: 'unsupported_type' } }), false);
  assert.equal(legacyOfficeRepairable({ name: 'Pliego.pdf' }, { status: 'gap', metadata: { gap_reason: 'empty_extraction' } }), false, 'lo escaneado es del OCR');
  const versions = [{ id: 'v1', name: 'F.zip', current: true, storage_path: 'p1', created_at: '2026-11-12' }, { id: 'v2', name: 'C.doc', current: true, storage_path: 'p2', created_at: '2026-11-11' }];
  const rows = [
    { id: 'e1', document_version_id: 'v1', extractor_version: 'tender-document-text-extraction@3', status: 'gap', char_count: 0, metadata: { gap_reason: 'archive_incomplete_extraction', internal_gaps: [{ entry_name: 'a.doc', gap_reason: 'unsupported_type' }] }, created_at: '2026-11-12' },
    { id: 'e2', document_version_id: 'v2', extractor_version: 'tender-document-text-extraction@3', status: 'gap', char_count: 0, metadata: { gap_reason: 'unsupported_type' }, created_at: '2026-11-11' },
    { id: 'e3', document_version_id: 'v2', extractor_version: TENDER_DOCUMENT_LEGACY_OFFICE_EXTRACTOR_VERSION, status: 'gap', char_count: 0, metadata: { gap_reason: 'legacy_office_conversion_failed' }, created_at: '2026-11-13' },
  ];
  assert.deepEqual(selectLegacyOfficeCandidates(versions, rows).map(row => row.id), ['v1'], 'v2 ya se intentó');
});

test('el pase guarda la lectura nueva con una generación mayor, y deja constancia si LibreOffice falla', async () => {
  const recorded = [];
  const versions = [
    { id: 'v1', opportunity_id: 'o1', tender_id: 't1', name: '7. FORMATOS Y FORMULARIOS.zip', mime_type: 'application/octet-stream', storage_path: 'p1', current: true, actor_id: 'a', created_at: '2026-11-12' },
    { id: 'v2', opportunity_id: 'o1', tender_id: 't1', name: 'Formato 3.xls', mime_type: '', storage_path: 'p2', current: true, actor_id: 'a', created_at: '2026-11-11' },
  ];
  const extractions = [
    { id: 'e1', document_version_id: 'v1', extractor_version: 'tender-document-text-extraction@3', status: 'gap', char_count: 0, metadata: { gap_reason: 'archive_incomplete_extraction', internal_gaps: [{ entry_name: '7. FORMATOS/1. MODELO CARTA DE PRESENTACION DE LA PROPUESTA.doc', gap_reason: 'unsupported_type' }] }, created_at: '2026-11-12' },
    { id: 'e2', document_version_id: 'v2', extractor_version: 'tender-document-text-extraction@3', status: 'gap', char_count: 0, metadata: { gap_reason: 'unsupported_type' }, created_at: '2026-11-11' },
  ];
  const tables = { psi_sales_opportunities: [{ id: 'o1' }], psi_tender_document_versions: versions, psi_tender_document_extractions: extractions };
  const query = table => { const q = { select: () => q, eq: () => q, is: () => q, in: async () => ({ data: tables[table], error: null }) }; q.then = (resolve) => resolve({ data: tables[table], error: null }); return q; };
  const database = {
    from: query,
    storage: { from: () => ({ download: async path => ({ data: new Blob([path === 'p1' ? paqueteDefensoria() : Buffer.from('xls')]), error: null }) }) },
    rpc: async (name, params) => { recorded.push({ name, params }); return { error: null }; },
  };
  const convert = async (buffer, name) => { if (/\.xls$/.test(name)) throw Object.assign(new Error('soffice'), { code: 'ETIMEDOUT' }); return fakeConvert(buffer, name); };
  const events = await runTenderDocumentLegacyOfficePass(database, { convert });
  assert.deepEqual(events.map(event => event.event), ['tender_legacy_office_recorded', 'tender_legacy_office_failed']);
  const ok = recorded[0].params;
  assert.equal(ok.p_status, 'ok');
  assert.equal(ok.p_extractor_version, TENDER_DOCUMENT_LEGACY_OFFICE_EXTRACTOR_VERSION);
  assert.ok(Number(/@(\d+)$/.exec(ok.p_extractor_version)[1]) > 3, 'le gana a la lectura de la carga');
  assert.equal(ok.p_char_count, [...ok.p_extracted_text].length);
  const failed = recorded[1].params;
  assert.equal(failed.p_status, 'gap');
  assert.equal(failed.p_gap_reason, 'legacy_office_conversion_failed');
  assert.equal(failed.p_extracted_text, null);
});

test('el trabajo que arranca los análisis corre la segunda lectura', async () => {
  const { readFileSync } = await import('node:fs');
  const runner = readFileSync(new URL('../ops/agt002-auto-initial/run-agt002-auto-initial.mjs', import.meta.url), 'utf8');
  assert.match(runner, /runTenderDocumentLegacyOfficePass\(database/);
  assert.ok(runner.indexOf('runTenderDocumentLegacyOfficePass(database') < runner.indexOf('runAgt002AutoInitialAdmissions(database'), 'antes de admitir los análisis');
});
