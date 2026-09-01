// AGT-002 revisión accionable — contrato PURO de validación de los bytes reales
// de un adjunto de soporte (design §§13.1-13.2, 19.4).
//
// RED reason: `agt002-actionable-review-attachment-validation.js` no existía;
// `complete` republicaba como "detectado" el MIME/tamaño/hash que el navegador
// había declarado al pedir el ticket, así que un PDF renombrado, un ZIP
// corriente con extensión .docx, un contenedor con traversal o macros, un
// archivo vacío y un archivo cuyos bytes no correspondían al hash declarado
// quedaban registrados como `content_validated`.
//
// Todos los fixtures se construyen en memoria con las MISMAS dependencias de
// producción (adm-zip), sin binarios versionados, sin reloj y sin aleatoriedad.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import {
  ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY,
  ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION,
  ACTIONABLE_REVIEW_ATTACHMENT_STORAGE_PREFIX,
  actionableReviewAttachmentHashesMatch,
  detectActionableReviewAttachmentMimeType,
  hasDoubleExecutableExtension,
  isActionableReviewAttachmentStoragePath,
  isCleanActionableReviewAttachmentName,
  isUnsafeActionableReviewArchiveEntryName,
  validateActionableReviewAttachmentBytes,
  validateActionableReviewAttachmentTextBytes,
} from '../agt002-actionable-review-attachment-validation.js';
import { ACTIONABLE_REVIEW_ATTACHMENT_MAX_BYTES } from '../agt002-actionable-review-http.js';
import { buildDocxBuffer, buildPdfBuffer, buildXlsxBuffer, replaceEqualLengthEntryName } from './fixtures/tender-document-archive-fixtures.mjs';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const LOGICAL_ID = '77777777-7777-4777-8777-777777777777';

// --- fixtures binarias mínimas ----------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}
/** PNG bien formado de 1x1: firma exacta + IHDR + IDAT + IEND con CRC reales. */
function buildPngBuffer() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
/** JPEG mínimo: SOI + APP0/JFIF + EOI. */
function buildJpegBuffer() {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'ascii'),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, Buffer.from([0xff, 0xd9])]);
}

const PDF_BYTES = buildPdfBuffer(['SOPORTE DE POLIZA']);
const PNG_BYTES = buildPngBuffer();
const JPEG_BYTES = buildJpegBuffer();
const TXT_BYTES = Buffer.from('Acta de aclaración\nEl proponente acreditó la póliza.\n', 'utf8');
const DOCX_BYTES = buildDocxBuffer(['CLAUSULA TECNICA']);
const XLSX_BYTES = buildXlsxBuffer({ sheetName: 'Formato', cellsXml: '<row r="1"><c r="A1" t="inlineStr"><is><t>VALOR</t></is></c></row>' });

// --- contrato del ticket server-owned ---------------------------------------

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
/** Contrato tal y como lo devuelve la fila del ticket, con overrides puntuales. */
function ticketFor(name, buffer, overrides = {}) {
  const extension = /\.[^.]+$/.exec(name)[0].toLowerCase();
  return {
    name,
    extension,
    version: 1,
    declared_mime_type: ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION[extension],
    declared_size_bytes: buffer.length,
    declared_content_hash: sha256(buffer),
    storage_path: `${ACTIONABLE_REVIEW_ATTACHMENT_STORAGE_PREFIX}${OPPORTUNITY_ID}/${ITEM_ID}/${LOGICAL_ID}/v1/${sha256(buffer)}-${name}`,
    ...overrides,
  };
}
function assertRejected(result, reason, message) {
  assert.equal(result.ok, false, message);
  assert.equal(result.reason, reason, `${message} (motivo esperado ${reason}, recibido ${result.reason})`);
  assert.match(result.reason, /^[a-z0-9_]+$/, 'el motivo es un código estable de observabilidad, nunca texto con datos del archivo');
}

// --- 1. allowlist cerrada y política única ----------------------------------

assert.deepEqual(
  Object.keys(ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION).sort(),
  ['.docx', '.jpeg', '.jpg', '.pdf', '.png', '.txt', '.xlsx'],
  'la allowlist cubre exactamente PDF, PNG, JPEG, DOCX, XLSX y TXT (§13.1)',
);
assert.equal(ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY.maxBytes, 25 * 1024 * 1024, 'el límite por archivo es 25 MiB');
assert.equal(ACTIONABLE_REVIEW_ATTACHMENT_MAX_BYTES, ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY.maxBytes,
  'el ticket y la validación de bytes comparten UNA sola política de tamaño');

// --- 2. los seis formatos válidos pasan y devuelven valores DETECTADOS -------

for (const [name, buffer, expectedMime] of [
  ['poliza.pdf', PDF_BYTES, 'application/pdf'],
  ['plano.png', PNG_BYTES, 'image/png'],
  ['foto.jpg', JPEG_BYTES, 'image/jpeg'],
  ['foto.jpeg', JPEG_BYTES, 'image/jpeg'],
  ['acta.txt', TXT_BYTES, 'text/plain'],
  ['clausula.docx', DOCX_BYTES, ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION['.docx']],
  ['formato.xlsx', XLSX_BYTES, ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION['.xlsx']],
]) {
  const result = validateActionableReviewAttachmentBytes(ticketFor(name, buffer), buffer);
  assert.equal(result.ok, true, `${name} válido pasa la validación de bytes reales`);
  assert.equal(result.detectedMimeType, expectedMime, `${name} reporta el MIME detectado por magic bytes/estructura`);
  assert.equal(result.sizeBytes, buffer.length, `${name} reporta el tamaño real de los bytes descargados`);
  assert.equal(result.contentHash, sha256(buffer), `${name} reporta el SHA-256 recalculado sobre los bytes`);
  assert.equal(detectActionableReviewAttachmentMimeType(buffer), expectedMime, `${name} se detecta igual desde la función pública`);
}

// --- 3. suplantación de MIME/extensión --------------------------------------

assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('falso.png', PDF_BYTES), PDF_BYTES),
  'mime_mismatch', 'un PDF renombrado .png se rechaza aunque el ticket declare image/png',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('falso.txt', PNG_BYTES), PNG_BYTES),
  'mime_mismatch', 'un PNG renombrado .txt se rechaza',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('falso.pdf', JPEG_BYTES), JPEG_BYTES),
  'mime_mismatch', 'un JPEG renombrado .pdf se rechaza',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('falso.xlsx', DOCX_BYTES), DOCX_BYTES),
  'mime_mismatch', 'un DOCX renombrado .xlsx se rechaza: el sabor OOXML se resuelve por sus partes',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('poliza.pdf', PDF_BYTES, { declared_mime_type: 'application/octet-stream' }), PDF_BYTES),
  'mime_extension_mismatch', 'un MIME genérico declarado no corresponde a la extensión y se rechaza',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('poliza.pdf', PDF_BYTES, { extension: '.zip' }), PDF_BYTES),
  'unsupported_extension', 'una extensión fuera de la allowlist se rechaza',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('poliza.pdf', PDF_BYTES, { name: 'poliza.png' }), PDF_BYTES),
  'invalid_file_name', 'el nombre debe terminar en la extensión del propio ticket',
);

// --- 4. tamaño, hash, vacío y sobrepeso -------------------------------------

assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('acta.txt', TXT_BYTES), Buffer.alloc(0)),
  'empty_file', 'un archivo vacío se rechaza',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('acta.txt', TXT_BYTES, { declared_size_bytes: TXT_BYTES.length + 1 }), TXT_BYTES),
  'size_mismatch', 'un tamaño real distinto del declarado se rechaza',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('acta.txt', TXT_BYTES, { declared_content_hash: 'a'.repeat(64) }), TXT_BYTES),
  'hash_mismatch', 'un SHA-256 real distinto del declarado se rechaza',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('acta.txt', TXT_BYTES, { declared_content_hash: sha256(TXT_BYTES).toUpperCase() }), TXT_BYTES),
  'invalid_declared_contract', 'el hash declarado debe venir en minúsculas hexadecimales',
);
const OVERSIZED = Buffer.alloc(ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY.maxBytes + 1, 0x61);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('grande.txt', TXT_BYTES), OVERSIZED),
  'size_limit_exceeded', 'unos bytes por encima de 25 MiB se rechazan aunque el ticket declarara menos',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('grande.txt', OVERSIZED), OVERSIZED),
  'invalid_declared_contract', 'un ticket que declara más de 25 MiB no es un contrato válido',
);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('acta.txt', TXT_BYTES), 'no soy un buffer'),
  'unreadable_object', 'un objeto que no son bytes se rechaza',
);

// --- 5. magic bytes exactos --------------------------------------------------

const PDF_WITHOUT_HEADER = Buffer.concat([Buffer.from('   ', 'ascii'), PDF_BYTES.subarray(3)]);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('poliza.pdf', PDF_WITHOUT_HEADER), PDF_WITHOUT_HEADER),
  'mime_mismatch', 'un PDF sin `%PDF-` al inicio no se acepta como PDF',
);
const PNG_BROKEN_SIGNATURE = Buffer.from(PNG_BYTES);
PNG_BROKEN_SIGNATURE[7] = 0x0b; // la firma PNG debe coincidir en los OCHO bytes
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('plano.png', PNG_BROKEN_SIGNATURE), PNG_BROKEN_SIGNATURE),
  'invalid_text_encoding', 'un PNG con un solo byte de firma alterado deja de ser PNG',
);
const JPEG_WITHOUT_SOI = Buffer.from(JPEG_BYTES);
JPEG_WITHOUT_SOI[2] = 0x00; // SOI es FF D8 FF
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('foto.jpg', JPEG_WITHOUT_SOI), JPEG_WITHOUT_SOI),
  'invalid_text_encoding', 'un JPEG sin SOI completo se rechaza',
);
assert.equal(detectActionableReviewAttachmentMimeType(Buffer.alloc(0)), null, 'un buffer vacío no detecta ningún tipo');
assert.equal(detectActionableReviewAttachmentMimeType(Buffer.from([0x00, 0x01, 0x02])), null, 'un binario desconocido no detecta ningún tipo');

// --- 6. TXT en UTF-8 estricto -----------------------------------------------

assert.equal(validateActionableReviewAttachmentTextBytes(Buffer.from('acentuación ñ €', 'utf8')), null,
  'UTF-8 válido con acentos y símbolos se acepta');
assert.equal(validateActionableReviewAttachmentTextBytes(Buffer.from([0x41, 0xc3, 0x28])), 'invalid_text_encoding',
  'una secuencia UTF-8 inválida se rechaza (decodificación estricta, sin reemplazos)');
assert.equal(validateActionableReviewAttachmentTextBytes(Buffer.from([0x41, 0xff, 0xfe])), 'invalid_text_encoding',
  'bytes que ningún UTF-8 válido produce se rechazan');
assert.equal(validateActionableReviewAttachmentTextBytes(Buffer.from('ok\ttab\r\nlínea', 'utf8')), null,
  'tab, CR y LF siguen siendo texto legítimo');
assert.equal(validateActionableReviewAttachmentTextBytes(Buffer.from([0x41, 0x00, 0x42])), 'binary_text_content',
  'un NUL delata contenido binario');
assert.equal(validateActionableReviewAttachmentTextBytes(Buffer.from([0x41, 0x07, 0x42])), 'binary_text_content',
  'un control fuera de tab/CR/LF delata contenido binario');
const LATIN1_TXT = Buffer.from([0x61, 0x63, 0x65, 0x6e, 0x74, 0x6f, 0x3a, 0xf3]); // "acento:ó" en latin-1
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('acta.txt', LATIN1_TXT), LATIN1_TXT),
  'invalid_text_encoding', 'un .txt que no es UTF-8 estricto se rechaza',
);
const BINARY_TXT = Buffer.from([0x74, 0x65, 0x78, 0x74, 0x00, 0x01]);
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('acta.txt', BINARY_TXT), BINARY_TXT),
  'binary_text_content', 'un binario con NUL renombrado .txt se rechaza',
);

// --- 7. contenedores ZIP/OOXML ----------------------------------------------

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const DOCUMENT_XML = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body/></w:document>';

/** DOCX mínimo con entradas extra arbitrarias (incluidas las peligrosas). */
function buildDocxWithEntries(extraEntries, contentTypesXml = CONTENT_TYPES_XML) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from('<?xml version="1.0"?><Relationships/>', 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(DOCUMENT_XML, 'utf8'));
  for (const [name, content] of extraEntries) zip.addFile(name, content);
  return zip.toBuffer();
}
function assertContainerRejected(buffer, reason, message) {
  assertRejected(validateActionableReviewAttachmentBytes(ticketFor('clausula.docx', buffer), buffer), reason, message);
}

const ORDINARY_ZIP = (() => {
  const zip = new AdmZip();
  zip.addFile('lectura.txt', Buffer.from('contenido legitimo', 'utf8'));
  return zip.toBuffer();
})();
assertContainerRejected(ORDINARY_ZIP, 'missing_ooxml_part',
  'un ZIP corriente con extensión .docx se rechaza: no es un paquete OOXML');
assert.equal(detectActionableReviewAttachmentMimeType(ORDINARY_ZIP), null, 'un ZIP corriente no detecta ningún MIME permitido');

const CONTENT_TYPES_ONLY = (() => {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES_XML, 'utf8'));
  zip.addFile('otro/parte.xml', Buffer.from('<a/>', 'utf8'));
  return zip.toBuffer();
})();
assertContainerRejected(CONTENT_TYPES_ONLY, 'missing_ooxml_part',
  'sin `word/document.xml` ni `xl/workbook.xml` no hay paquete válido');

const TRUNCATED_ZIP = Buffer.concat([DOCX_BYTES.subarray(0, 40), Buffer.from('basura', 'ascii')]);
assertContainerRejected(TRUNCATED_ZIP, 'invalid_container', 'un contenedor ilegible se rechaza sin lanzar');

// zip-slip: el nombre DECLARADO escapa de la raíz del paquete. Se sustituye in
// situ por otro de igual longitud para que ningún escritor lo sanee antes.
const TRAVERSAL_DOCX = replaceEqualLengthEntryName(
  buildDocxWithEntries([['aa/evil.txt', Buffer.from('carga util', 'utf8')]]),
  'aa/evil.txt', '../evil.txt',
);
assertContainerRejected(TRAVERSAL_DOCX, 'unsafe_entry_path', 'un DOCX con traversal interno se rechaza entero');

const ABSOLUTE_DOCX = replaceEqualLengthEntryName(
  buildDocxWithEntries([['ab/passwd.txt', Buffer.from('carga util', 'utf8')]]),
  'ab/passwd.txt', '/etc/pass.txt',
);
assertContainerRejected(ABSOLUTE_DOCX, 'unsafe_entry_path', 'un DOCX con entrada de ruta absoluta se rechaza');

const BACKSLASH_DOCX = replaceEqualLengthEntryName(
  buildDocxWithEntries([['ac/evil.txt', Buffer.from('carga util', 'utf8')]]),
  'ac/evil.txt', 'ac\\evil.txt',
);
assertContainerRejected(BACKSLASH_DOCX, 'unsafe_entry_path', 'la barra invertida nunca es separador legítimo en OOXML');

const DUPLICATE_DOCX = replaceEqualLengthEntryName(
  buildDocxWithEntries([['word/duplicado.xx', Buffer.from('<a/>', 'utf8')]]),
  'word/duplicado.xx', 'word/document.xml',
);
assertContainerRejected(DUPLICATE_DOCX, 'duplicate_entry_name', 'dos entradas con el mismo nombre hacen ambigua la parte principal');

// Bomba de expansión: 20 MiB de ceros comprimen a unos pocos KiB.
const BOMB_DOCX = buildDocxWithEntries([['word/media/grande.dat', Buffer.alloc(20 * 1024 * 1024, 0)]]);
assertContainerRejected(BOMB_DOCX, 'archive_compression_ratio_exceeded', 'una entrada con ratio de compresión desmedida se rechaza');

const MANY_ENTRIES_DOCX = buildDocxWithEntries(
  Array.from({ length: ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY.maxArchiveEntryCount + 1 },
    (_unused, index) => [`word/parte${index}.xml`, Buffer.from('<a/>', 'utf8')]),
);
assertContainerRejected(MANY_ENTRIES_DOCX, 'archive_entry_limit_exceeded', 'un paquete con demasiadas entradas se rechaza');

assertContainerRejected(
  buildDocxWithEntries([['word/vbaProject.bin', Buffer.from('macro', 'utf8')]]),
  'active_content_entry', 'un proyecto VBA dentro del paquete se rechaza',
);
assertContainerRejected(
  buildDocxWithEntries([['xl/macroSheets/sheet1.xml', Buffer.from('<a/>', 'utf8')]]),
  'active_content_entry', 'una hoja de macros Excel 4.0 se rechaza',
);
assertContainerRejected(
  buildDocxWithEntries([['word/embeddings/oleObject1.bin', Buffer.from('ole', 'utf8')]]),
  'active_content_entry', 'un objeto OLE incrustado se rechaza',
);
assertContainerRejected(
  buildDocxWithEntries([['word/media/payload.exe', Buffer.from('MZ', 'utf8')]]),
  'active_content_entry', 'un ejecutable incrustado se rechaza',
);
assertContainerRejected(
  buildDocxWithEntries([['word/media/payload.js', Buffer.from('alert(1)', 'utf8')]]),
  'active_content_entry', 'un script incrustado se rechaza',
);
assertContainerRejected(
  buildDocxWithEntries([['word/anexo.zip', Buffer.from('PK', 'utf8')]]),
  'active_content_entry', 'un archivo comprimido anidado se rechaza en vez de recorrerse',
);
assertContainerRejected(
  buildDocxWithEntries([], CONTENT_TYPES_XML.replace(
    'wordprocessingml.document.main+xml',
    'wordprocessingml.document.macroEnabled.main+xml',
  )),
  'active_content_entry', 'un manifiesto que declara contenido macro-enabled se rechaza',
);

// --- 8. nombres de entrada (predicado puro) ---------------------------------

for (const unsafe of ['../evil.txt', '/etc/passwd', 'C:\\evil.txt', 'a\\b.xml', 'a/../b.xml', './b.xml', '', '   ', 'a\0b']) {
  assert.equal(isUnsafeActionableReviewArchiveEntryName(unsafe), true, `nombre de entrada inseguro: ${JSON.stringify(unsafe)}`);
}
for (const safe of ['word/document.xml', '[Content_Types].xml', '_rels/.rels', 'xl/worksheets/sheet1.xml', 'word/']) {
  assert.equal(isUnsafeActionableReviewArchiveEntryName(safe), false, `nombre de entrada legítimo: ${safe}`);
}

// --- 9. nombre de archivo limpio (§13.1) ------------------------------------

assert.equal(isCleanActionableReviewAttachmentName('Poliza vigente 2026.pdf'), true, 'un nombre normal es limpio');
assert.equal(isCleanActionableReviewAttachmentName(`${'a'.repeat(136)}.pdf`), true, 'exactamente 140 caracteres es el máximo admitido');
assert.equal(isCleanActionableReviewAttachmentName(`${'a'.repeat(137)}.pdf`), false, 'más de 140 caracteres se rechaza');
assert.equal(isCleanActionableReviewAttachmentName('../../etc/passwd.pdf'), false, 'traversal en el nombre se rechaza');
assert.equal(isCleanActionableReviewAttachmentName('carpeta\\archivo.pdf'), false, 'barra invertida en el nombre se rechaza');
assert.equal(isCleanActionableReviewAttachmentName('carpeta/archivo.pdf'), false, 'barra en el nombre se rechaza');
assert.equal(isCleanActionableReviewAttachmentName('informe.exe.pdf'), false, 'doble extensión ejecutable se rechaza');
assert.equal(isCleanActionableReviewAttachmentName('informe\u202Efdp.exe'), false, 'una marca bidi que disfraza la extensión se rechaza');
assert.equal(isCleanActionableReviewAttachmentName('informe\u0007.pdf'), false, 'un control en el nombre se rechaza');
assert.equal(isCleanActionableReviewAttachmentName('.oculto.pdf'), false, 'un nombre que empieza por punto se rechaza');
assert.equal(isCleanActionableReviewAttachmentName(' informe.pdf'), false, 'espacios al borde se rechazan');
assert.equal(hasDoubleExecutableExtension('informe.ps1.docx'), true, 'ps1 intermedio es doble extensión ejecutable');
assert.equal(hasDoubleExecutableExtension('Informe v1.2.pdf'), false, 'un punto de versión no es doble extensión');
assertRejected(
  validateActionableReviewAttachmentBytes(ticketFor('poliza.pdf', PDF_BYTES, { name: 'informe.exe.pdf' }), PDF_BYTES),
  'invalid_file_name', 'la doble extensión ejecutable se rechaza sobre el contrato del ticket',
);

// --- 10. hash en tiempo constante -------------------------------------------

assert.equal(actionableReviewAttachmentHashesMatch(sha256(TXT_BYTES), sha256(TXT_BYTES)), true, 'dos digests iguales coinciden');
assert.equal(actionableReviewAttachmentHashesMatch(sha256(TXT_BYTES), sha256(PDF_BYTES)), false, 'dos digests distintos no coinciden');
assert.equal(actionableReviewAttachmentHashesMatch('abc', 'abc'), false, 'un valor que no es SHA-256 hexadecimal nunca coincide');
assert.equal(actionableReviewAttachmentHashesMatch(sha256(TXT_BYTES).toUpperCase(), sha256(TXT_BYTES)), false,
  'el contrato exige minúsculas: mayúsculas no coinciden');

// --- 11. espacio de nombres exacto del almacenamiento (§13.3) ---------------

const HASH = sha256(PDF_BYTES);
const EXPECTED = { opportunityId: OPPORTUNITY_ID, reviewItemId: ITEM_ID, version: 1, declaredContentHash: HASH };
const APPROVED_PATH = `actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/${LOGICAL_ID}/v1/${HASH}-poliza.pdf`;
assert.equal(isActionableReviewAttachmentStoragePath(APPROVED_PATH, EXPECTED), true, 'el path exacto del ticket es aceptado');
for (const [path, message] of [
  [`actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/${LOGICAL_ID}/v2/${HASH}-poliza.pdf`, 'otra versión que la del ticket'],
  [`actionable-reviews/${OPPORTUNITY_ID}/33333333-3333-4333-8333-333333333334/${LOGICAL_ID}/v1/${HASH}-poliza.pdf`, 'otro pendiente'],
  [`actionable-reviews/11111111-1111-4111-8111-111111111112/${ITEM_ID}/${LOGICAL_ID}/v1/${HASH}-poliza.pdf`, 'otra oportunidad'],
  [`question-responses/${OPPORTUNITY_ID}/${ITEM_ID}/${LOGICAL_ID}/v1/${HASH}-poliza.pdf`, 'el prefijo de question-responses'],
  [`${OPPORTUNITY_ID}/documento.pdf`, 'el prefijo del expediente oficial'],
  [`actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/${LOGICAL_ID}/v1/${'b'.repeat(64)}-poliza.pdf`, 'un hash distinto del declarado'],
  [`actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/${LOGICAL_ID}/v1/${HASH}-`, 'un nombre de archivo vacío'],
  [`actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/${LOGICAL_ID}/v1/../../../${HASH}-poliza.pdf`, 'traversal en el path'],
  [`actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/${LOGICAL_ID}/v1/${HASH}-poliza.pdf/extra`, 'un segmento de más'],
  [`actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/v1/${HASH}-poliza.pdf`, 'un segmento de menos'],
  [`/actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/${LOGICAL_ID}/v1/${HASH}-poliza.pdf`, 'una ruta absoluta'],
  [`actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/${LOGICAL_ID}\\v1/${HASH}-poliza.pdf`, 'una barra invertida'],
  ['', 'un path vacío'],
]) {
  assert.equal(isActionableReviewAttachmentStoragePath(path, EXPECTED), false, `se rechaza ${message}`);
}
assert.equal(isActionableReviewAttachmentStoragePath(APPROVED_PATH, { ...EXPECTED, declaredContentHash: 'no-hex' }), false,
  'sin un hash declarado válido no se aprueba ningún path');

console.log('AGT-002 actionable review attachment byte-validation contract passed');
