// BLOCKER 1 — identidad canonica de version para paquetes ZIP oficiales.
//
// La reextraccion real por entrada ya existe (tender-zip-entry-extraction-coverage).
// Lo que faltaba es la OTRA mitad: de que se deriva la identidad de la version.
//
// Hoy `refreshOfficialTenderDocument` versiona por `sha256(bytes del archivo)`. En
// un ZIP esos bytes incluyen el ENVOLTORIO —marcas de tiempo por entrada, orden de
// escritura, nivel de compresion, comentario del paquete—, que la entidad cambia
// cada vez que regenera el paquete aunque no toque un solo documento interno. El
// resultado es una version nueva, una subida nueva a almacenamiento y un snapshot
// nuevo por un expediente que no cambio: versiones falsas.
//
// Contrato que fija este archivo:
//   * Mismo contenido interno reempaquetado  => misma identidad => 'unchanged',
//     sin subida y sin fila de version nueva.
//   * Cambio real dentro de una entrada      => identidad distinta => version nueva.
//   * Documento no ZIP                       => identidad = hash de bytes (intacto).
//   * ZIP ilegible a nivel de paquete        => identidad = hash de bytes (cierre
//     seguro: sin procedencia por entrada no hay contenido del que derivar nada).
//
// Ejecutar: node tests/tender-document-archive-canonical-version.test.mjs

import { strict as assert } from 'node:assert';
import { extractTenderDocumentText } from '../tender-document-text-extraction.js';
import {
  refreshOfficialTenderDocument,
  tenderDocumentCanonicalContentHash,
  tenderDocumentContentHash,
} from '../tender-document-versioning.js';
import {
  ARCHIVE_TXT_AMENDED_CONTENT,
  ARCHIVE_TXT_CONTENT,
  buildAmendedSupportedEntriesArchive,
  buildRepackagedSupportedEntriesArchive,
  buildSupportedEntriesArchive,
} from './fixtures/tender-document-archive-fixtures.mjs';

const ZIP_MIME = 'application/zip';
const OPPORTUNITY_ID = '44444444-4444-4444-8444-444444444444';

const ORIGINAL = buildSupportedEntriesArchive();
const REPACKAGED = buildRepackagedSupportedEntriesArchive();
const AMENDED = buildAmendedSupportedEntriesArchive();

// ===========================================================================
// 0. Control discriminante. Sin esto todo lo demas seria trivialmente cierto:
//    el reempaquetado TIENE que cambiar los bytes (si no, no habria bug que
//    arreglar) y TIENE que conservar el contenido interno.
// ===========================================================================
assert.notEqual(
  tenderDocumentContentHash(ORIGINAL),
  tenderDocumentContentHash(REPACKAGED),
  'el fixture reempaquetado debe cambiar los bytes del paquete; si no, no prueba nada',
);

const originalExtraction = await extractTenderDocumentText(ORIGINAL, 'FORMATOS.zip', ZIP_MIME);
const repackagedExtraction = await extractTenderDocumentText(REPACKAGED, 'FORMATOS.zip', ZIP_MIME);
const amendedExtraction = await extractTenderDocumentText(AMENDED, 'FORMATOS.zip', ZIP_MIME);
assert.equal(originalExtraction.status, 'ok');
assert.equal(repackagedExtraction.status, 'ok');
assert.equal(amendedExtraction.status, 'ok');
assert.ok(originalExtraction.text.includes(ARCHIVE_TXT_CONTENT));
assert.ok(amendedExtraction.text.includes(ARCHIVE_TXT_AMENDED_CONTENT));

// ===========================================================================
// 1. tenderDocumentCanonicalContentHash: identidad derivada del contenido.
// ===========================================================================
{
  const original = tenderDocumentCanonicalContentHash(tenderDocumentContentHash(ORIGINAL), originalExtraction);
  const repackaged = tenderDocumentCanonicalContentHash(tenderDocumentContentHash(REPACKAGED), repackagedExtraction);
  const amended = tenderDocumentCanonicalContentHash(tenderDocumentContentHash(AMENDED), amendedExtraction);

  assert.match(original, /^[0-9a-f]{64}$/, 'la identidad canonica debe ser SHA-256 hex en minuscula (lo exige la RPC de versionado)');
  assert.equal(
    repackaged,
    original,
    'reempaquetar el mismo contenido no puede cambiar la identidad canonica del documento',
  );
  assert.notEqual(
    amended,
    original,
    'un cambio real dentro de una entrada SI debe producir una identidad nueva',
  );

  // Determinista: no depende del reloj, del orden ni de la maquina.
  assert.equal(
    tenderDocumentCanonicalContentHash(tenderDocumentContentHash(ORIGINAL), originalExtraction),
    original,
  );

  // La identidad canonica no es el hash de los bytes: es una derivacion propia.
  assert.notEqual(original, tenderDocumentContentHash(ORIGINAL));
}

// ===========================================================================
// 2. Compatibilidad: lo que NO es un paquete con procedencia por entrada
//    conserva exactamente la identidad por bytes de siempre.
// ===========================================================================
{
  const pdfBytes = Buffer.from('%PDF-1.4 contenido', 'utf8');
  const byteHash = tenderDocumentContentHash(pdfBytes);

  // Extraccion tipada de un PDF: sin metadata.entries.
  assert.equal(
    tenderDocumentCanonicalContentHash(byteHash, {
      status: 'ok', parser: 'pdf-parse', metadata: { num_pages: 3 },
    }),
    byteHash,
    'un documento no comprimido conserva la identidad por bytes',
  );

  // Extractor legado que devuelve un string, no un resultado tipado.
  assert.equal(tenderDocumentCanonicalContentHash(byteHash, 'texto legado'), byteHash);
  assert.equal(tenderDocumentCanonicalContentHash(byteHash, null), byteHash);
  assert.equal(tenderDocumentCanonicalContentHash(byteHash, undefined), byteHash);

  // ZIP ilegible a nivel de paquete (rutas inseguras, demasiadas entradas, bytes
  // corruptos): el gap NO trae procedencia por entrada, asi que no hay contenido
  // del que derivar identidad. Se cierra seguro sobre los bytes.
  const broken = await extractTenderDocumentText(Buffer.from('no-zip-bytes'), 'roto.zip', ZIP_MIME);
  assert.equal(broken.status, 'gap');
  assert.equal(Array.isArray(broken.metadata.entries), false);
  const brokenByteHash = tenderDocumentContentHash(Buffer.from('no-zip-bytes'));
  assert.equal(tenderDocumentCanonicalContentHash(brokenByteHash, broken), brokenByteHash);

  // Defensa ante metadata deforme/legacy: nunca lanza, siempre cierra sobre bytes.
  for (const deformed of [
    { status: 'ok', parser: 'zip-archive', metadata: { entries: [] } },
    { status: 'ok', parser: 'zip-archive', metadata: { entries: 'no-es-lista' } },
    { status: 'ok', parser: 'zip-archive', metadata: null },
    { status: 'ok', parser: 'zip-archive' },
  ]) {
    assert.equal(tenderDocumentCanonicalContentHash(byteHash, deformed), byteHash);
  }
}

// ===========================================================================
// 3. La identidad canonica liga la COBERTURA, no solo el texto: un paquete con
//    una entrada ilegible no puede compartir identidad con el integro.
// ===========================================================================
{
  const okIdentity = tenderDocumentCanonicalContentHash('0'.repeat(64), {
    status: 'ok',
    parser: 'zip-archive',
    metadata: {
      entries: [
        { entry_name: 'a.txt', status: 'ok', gap_reason: null, text_hash: 'a'.repeat(64) },
        { entry_name: 'b.pdf', status: 'ok', gap_reason: null, text_hash: 'b'.repeat(64) },
      ],
    },
  });
  const gappedIdentity = tenderDocumentCanonicalContentHash('0'.repeat(64), {
    status: 'gap',
    parser: 'zip-archive',
    metadata: {
      gap_reason: 'archive_incomplete_extraction',
      entries: [
        { entry_name: 'a.txt', status: 'ok', gap_reason: null, text_hash: 'a'.repeat(64) },
        { entry_name: 'b.pdf', status: 'gap', gap_reason: 'extraction_error', text_hash: 'b'.repeat(64) },
      ],
    },
  });
  assert.notEqual(
    gappedIdentity,
    okIdentity,
    'un paquete al que le falta una entrada no puede reutilizar la identidad del paquete integro',
  );
}

// ===========================================================================
// 4. refreshOfficialTenderDocument de punta a punta.
// ===========================================================================
function harness({ buffer, currentVersion }) {
  const calls = { uploads: [], recordedVersions: [], recordedExtractions: [] };
  const result = refreshOfficialTenderDocument({
    opportunityId: OPPORTUNITY_ID,
    source: 'SECOP II',
    document: { source_document_id: 'SECOP-DOC-0001', name: 'FORMATOS OFICIALES.zip', mime_type: ZIP_MIME },
    currentVersion,
    download: async () => buffer,
    cleanName: value => String(value || ''),
    extractText: (bytes, name, mime) => extractTenderDocumentText(bytes, name, mime),
    ensureStorage: async () => {},
    upload: async (storagePath, bytes) => { calls.uploads.push({ storagePath, size: bytes.length }); },
    recordVersion: async version => {
      calls.recordedVersions.push(version);
      return { id: 'version-1', status: 'created', version: 1, content_hash: version.content_hash };
    },
    recordExtraction: async payload => { calls.recordedExtractions.push(payload); },
  });
  return { result, calls };
}

// 4.1 Primera importacion: se versiona con la identidad canonica del contenido.
const firstImport = harness({ buffer: ORIGINAL, currentVersion: null });
const firstResult = await firstImport.result;
const canonicalIdentity = tenderDocumentCanonicalContentHash(tenderDocumentContentHash(ORIGINAL), originalExtraction);
{
  assert.equal(firstResult.status, 'new');
  assert.equal(firstImport.calls.recordedVersions.length, 1);
  assert.equal(firstImport.calls.uploads.length, 1);
  const recorded = firstImport.calls.recordedVersions[0];
  assert.equal(recorded.content_hash, canonicalIdentity, 'la version se registra con la identidad canonica del contenido');
  assert.equal(
    recorded.size_bytes,
    ORIGINAL.length,
    'el tamano sigue siendo el del archivo real descargado, no una derivacion',
  );
  assert.ok(
    firstImport.calls.uploads[0].storagePath.includes(canonicalIdentity),
    'la ruta de almacenamiento se deriva de la misma identidad canonica, para no duplicar blobs por reempaquetado',
  );
}

// 4.2 EL BLOQUEO: el mismo contenido reempaquetado NO crea version nueva.
{
  const reprocess = harness({
    buffer: REPACKAGED,
    currentVersion: { id: 'version-1', content_hash: canonicalIdentity, needs_extraction: false },
  });
  const result = await reprocess.result;
  assert.equal(
    result.status,
    'unchanged',
    'reprocesar el mismo ZIP con metadata mutable del envoltorio no puede crear una version falsa',
  );
  assert.deepEqual(reprocess.calls.recordedVersions, [], 'no se registra ninguna version nueva');
  assert.deepEqual(reprocess.calls.uploads, [], 'no se vuelve a subir el mismo contenido al almacenamiento');
  assert.equal(result.source_document_id, 'SECOP-DOC-0001');
}

// 4.3 Un cambio REAL de contenido si crea una version nueva.
{
  const amended = harness({
    buffer: AMENDED,
    currentVersion: { id: 'version-1', content_hash: canonicalIdentity, needs_extraction: false },
  });
  const result = await amended.result;
  assert.equal(result.status, 'updated', 'una adenda real dentro del paquete si debe versionarse');
  assert.equal(amended.calls.recordedVersions.length, 1);
  assert.equal(amended.calls.uploads.length, 1);
  assert.notEqual(amended.calls.recordedVersions[0].content_hash, canonicalIdentity);
}

// 4.4 Compatibilidad con historico: una fila antigua guardada con el hash de
//     BYTES sigue resolviendo 'unchanged' cuando la fuente devuelve esos mismos
//     bytes, sin reextraer y sin migracion de datos.
{
  const legacy = harness({
    buffer: ORIGINAL,
    currentVersion: { id: 'version-0', content_hash: tenderDocumentContentHash(ORIGINAL), needs_extraction: false },
  });
  const result = await legacy.result;
  assert.equal(result.status, 'unchanged', 'una version historica identificada por bytes sigue reconociendose');
  assert.deepEqual(legacy.calls.recordedVersions, []);
  assert.deepEqual(legacy.calls.uploads, []);
}

// 4.5 `needs_extraction` sigue mandando: una version sin extraccion persistida se
//     reprocesa aunque el contenido sea identico, o el hueco nunca se cerraria.
{
  const needsExtraction = harness({
    buffer: ORIGINAL,
    currentVersion: { id: 'version-1', content_hash: canonicalIdentity, needs_extraction: true },
  });
  const result = await needsExtraction.result;
  assert.equal(result.status, 'updated');
  assert.equal(needsExtraction.calls.recordedExtractions.length, 1, 'la extraccion faltante se persiste');
}

// 4.6 Un documento NO comprimido conserva el comportamiento historico exacto.
{
  const pdfBytes = Buffer.from('contenido plano del pliego', 'utf8');
  const calls = { uploads: [], recordedVersions: [] };
  const result = await refreshOfficialTenderDocument({
    opportunityId: OPPORTUNITY_ID,
    source: 'SECOP II',
    document: { source_document_id: 'SECOP-DOC-0002', name: 'pliego.txt', mime_type: 'text/plain' },
    currentVersion: null,
    download: async () => pdfBytes,
    extractText: (bytes, name, mime) => extractTenderDocumentText(bytes, name, mime),
    ensureStorage: async () => {},
    upload: async (storagePath, bytes) => { calls.uploads.push({ storagePath, size: bytes.length }); },
    recordVersion: async version => { calls.recordedVersions.push(version); return { id: 'v', status: 'created' }; },
    recordExtraction: async () => {},
  });
  assert.equal(result.status, 'new');
  assert.equal(
    calls.recordedVersions[0].content_hash,
    tenderDocumentContentHash(pdfBytes),
    'un documento no comprimido se sigue versionando por el hash de sus bytes',
  );
}

// 4.7 La identidad canonica jamas arrastra contenido ni rutas.
{
  const identity = tenderDocumentCanonicalContentHash(tenderDocumentContentHash(ORIGINAL), originalExtraction);
  assert.match(identity, /^[0-9a-f]{64}$/);
  assert.equal(identity.includes('condiciones'), false, 'la identidad no puede llevar nombres de entrada en claro');
  assert.equal(identity.includes('tender-documents'), false, 'la identidad no puede llevar rutas de almacenamiento');
}

console.log('tender-document-archive-canonical-version.test.mjs OK');
