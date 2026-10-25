// Juan, 2026-10-20: los complementarios cargados a mano ("Cargar complementarios") deben entrar al expediente versionado
// que lee Vig-IA. Antes la ruta sólo guardaba el archivo y una nota en la interacción, y ningún análisis los veía
// (las respuestas a observaciones de Cali). Fija: versión en psi_tender_document_versions con fuente "carga manual",
// identidad por contenido (recargar el mismo archivo no duplica), extracción tipada y la nota sin texto extraído.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refreshOfficialTenderDocument } from '../verticales/licitaciones/tender-document-versioning.js';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const route = server.match(/app\.post\('\/api\/tender-documents-upload'[\s\S]*?\n}\);/)?.[0] || '';

test('la carga manual registra versiones con la misma cadena que la importación oficial', () => {
  assert.ok(route, 'la ruta de carga debe existir');
  assert.match(server, /const TENDER_MANUAL_UPLOAD_SOURCE = 'carga manual';/);
  assert.match(server, /const tenderManualUploadDocumentId = buffer => `manual-\$\{createHash\('sha256'\)\.update\(buffer\)/);
  assert.match(route, /refreshOfficialTenderDocument\(\{[\s\S]*source: TENDER_MANUAL_UPLOAD_SOURCE/);
  assert.match(route, /rpc\('psi_record_tender_document_version'[\s\S]*p_source: TENDER_MANUAL_UPLOAD_SOURCE/);
  assert.match(route, /recordExtraction: \(\{ extraction, version \}\) => recordTenderDocumentExtraction\(/);
  assert.match(route, /getCurrentTenderDocumentVersion\(database, opportunityId, TENDER_MANUAL_UPLOAD_SOURCE, doc\.source_document_id\)/);
  assert.doesNotMatch(route, /saveTenderDocumentBuffer/, 'ya no basta con guardar el archivo y la nota');
  const note = route.match(/const uploaded = preparedFiles\.map[\s\S]*?\}\)\);/)?.[0] || '';
  assert.ok(note, 'la nota de la carga se arma aparte');
  assert.doesNotMatch(note, /extracted_text/, 'la nota de la interacción no lleva el texto extraído');
  assert.match(route, /source_document_id: tenderManualUploadDocumentId\(buffer\)/, 'la nota usa el mismo id que la versión para no duplicar la lista');
});

test('el mismo contenido cargado otra vez no crea una versión nueva', async () => {
  const buffer = Buffer.from('Respuestas a observaciones al pliego definitivo LP 1827-2026');
  const recorded = [];
  const base = {
    opportunityId: 'opp-cali', source: 'carga manual',
    document: { name: 'RESPUESTAS OBSERVACIONES.pdf', source_document_id: 'manual-abc', mime_type: 'application/pdf' },
    download: () => buffer,
    extractText: async () => ({ status: 'ok', text: buffer.toString() }),
    ensureStorage: async () => {},
    upload: async () => {},
    recordVersion: async version => { recorded.push(version); return { id: 'v1', ...version }; },
    recordExtraction: async () => {},
  };
  const first = await refreshOfficialTenderDocument({ ...base, currentVersion: null });
  assert.equal(first.status, 'new');
  assert.equal(recorded[0].source, 'carga manual');
  const again = await refreshOfficialTenderDocument({ ...base, currentVersion: { content_hash: recorded[0].content_hash, needs_extraction: false } });
  assert.equal(again.status, 'unchanged');
  assert.equal(recorded.length, 1);
});
