// AGT-002 revisión accionable — validación de los BYTES REALES de un adjunto de
// soporte (design §§13.1-13.2, 19.4). Módulo puro compartido por `server/index.js`
// y `api/[...path].js`: sin Express, sin base de datos, sin red y sin reloj. La
// única entrada es el contrato del ticket cargado server-side y el Buffer
// descargado del objeto privado; nada de lo que afirma el navegador (Content-Type
// del Blob, tamaño, hash, tipo declarado en el formulario) entra aquí.
//
// Fail-closed: cualquier comprobación que no se pueda ejecutar con certeza
// (contenedor ilegible, entrada corrupta, formato desconocido) devuelve
// `{ ok: false, reason }`. La función NUNCA lanza: la ruta no debe poder
// distinguir un fallo de validación de un fallo interno, y `reason` es sólo un
// código estable de observabilidad — jamás se envía al cliente ni se compone con
// datos del archivo.
//
// Alcance honesto (§13.2): esto valida ESTRUCTURA y CONSISTENCIA, no ausencia de
// malware. Sin un servicio antimalware aprobado el resultado es «contenido
// validado», nunca «libre de malware».

import { createHash, timingSafeEqual } from 'node:crypto';
import AdmZip from 'adm-zip';

// §13.1: allowlist cerrada extensión <-> MIME. Fuente ÚNICA para las dos capas
// (emisión del ticket y validación de bytes) — dos copias podrían divergir y
// dejar pasar una combinación que la otra rechaza.
export const ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION = Object.freeze({
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
});

// Política de recursos del contenedor OOXML. Fija y no alcanzable desde la firma
// pública: un paquete no puede ensanchar sus propios límites.
export const ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY = Object.freeze({
  maxBytes: 25 * 1024 * 1024,
  maxNameLength: 140,
  maxArchiveEntryCount: 512,
  maxArchiveEntryExpandedBytes: 25 * 1024 * 1024,
  maxArchiveTotalExpandedBytes: 60 * 1024 * 1024,
  maxArchiveCompressionRatio: 200,
  // La ratio sólo se evalúa por encima de este piso: una entrada XML diminuta y
  // muy repetitiva (habitual en OOXML legítimo) supera cualquier ratio sin ser
  // una bomba, porque su expansión absoluta es irrelevante.
  archiveCompressionRatioFloorBytes: 64 * 1024,
  maxContentTypesBytes: 1024 * 1024,
});

const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOI_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const ZIP_LOCAL_FILE_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const DOCX_MIME_TYPE = ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION['.docx'];
const XLSX_MIME_TYPE = ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION['.xlsx'];
const OOXML_CONTENT_TYPES_ENTRY = '[content_types].xml';
const OOXML_MAIN_PART_BY_MIME = Object.freeze({
  [DOCX_MIME_TYPE]: 'word/document.xml',
  [XLSX_MIME_TYPE]: 'xl/workbook.xml',
});

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

// Extensiones ejecutables/interpretables: nunca son la extensión final (la
// allowlist ya lo impide) pero sí el vector clásico de doble extensión
// `informe.exe.pdf`, y tampoco pueden aparecer como entrada de un OOXML.
const EXECUTABLE_EXTENSIONS = Object.freeze([
  'exe', 'dll', 'com', 'bat', 'cmd', 'scr', 'pif', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'msi', 'msp', 'jar', 'sh', 'bash', 'hta', 'lnk', 'scf', 'reg', 'cpl', 'sys',
  'ocx', 'apk', 'app', 'so', 'dylib', 'elf', 'jsp', 'php', 'py', 'pl', 'rb', 'sct', 'shb',
  'shs', 'inf', 'ins', 'msc', 'mst', 'gadget', 'swf', 'dmg', 'command',
]);
const EXECUTABLE_EXTENSION_SET = new Set(EXECUTABLE_EXTENSIONS);
const EXECUTABLE_ENTRY_PATTERN = new RegExp(`\\.(${EXECUTABLE_EXTENSIONS.join('|')})$`);
// Archivos anidados dentro del paquete: nunca se recorren, se rechaza el paquete
// entero (recorrerlos volvería inútil el preflight acotado del contenedor).
const NESTED_ARCHIVE_ENTRY_PATTERN = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|iso|cab|arj|lzh)$/;
// Macros y contenido activo OOXML: proyecto VBA, hojas de macro Excel 4.0,
// objetos OLE incrustados y módulos VBA sueltos.
const ACTIVE_CONTENT_ENTRY_PATTERNS = Object.freeze([
  /(^|\/)vbaproject[^/]*\.bin$/,
  /(^|\/)vbadata\.xml$/,
  /(^|\/)vbaprojectsignature[^/]*\.bin$/,
  /(^|\/)macrosheets?\//,
  /(^|\/)embeddings?\//,
  /(^|\/)oleobject[^/]*\.bin$/,
  /\.(xlm|bas|cls|frm|frx)$/,
]);
// El manifiesto de un paquete con macros declara su propio tipo macro-enabled.
const MACRO_CONTENT_TYPE_PATTERN = /(macroenabled|vbaproject)/;

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

function failure(reason) {
  return { ok: false, reason };
}

function startsWithSignature(buffer, signature) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

// Comparación en tiempo constante del digest hexadecimal: ambos lados tienen
// longitud fija verificada antes, así que `timingSafeEqual` nunca lanza y no
// filtra por tiempo cuántos caracteres del hash declarado acertó un atacante.
export function actionableReviewAttachmentHashesMatch(declaredHex, actualHex) {
  if (!SHA256_HEX_PATTERN.test(declaredHex) || !SHA256_HEX_PATTERN.test(actualHex)) return false;
  return timingSafeEqual(Buffer.from(declaredHex, 'ascii'), Buffer.from(actualHex, 'ascii'));
}

// Caracteres de control, NUL y marcas bidi/formato: un nombre que los contiene
// puede disfrazar su extensión real en cualquier interfaz que lo muestre.
function hasUnsafeNameCharacters(name) {
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
    if (code >= 0x200e && code <= 0x200f) return true;
    if (code >= 0x202a && code <= 0x202e) return true;
    if (code >= 0x2066 && code <= 0x2069) return true;
  }
  return false;
}

// `informe.exe.pdf`: la extensión final está en la allowlist pero una intermedia
// es ejecutable. La extensión final NO se evalúa aquí — de eso se ocupa la
// allowlist cerrada, que ya rechaza `factura.pdf.exe`.
export function hasDoubleExecutableExtension(name) {
  const parts = String(name).toLowerCase().split('.');
  if (parts.length < 3) return false;
  return parts.slice(1, -1).some(part => EXECUTABLE_EXTENSION_SET.has(part));
}

// §13.1: nombre limpio — 1..140 caracteres, sin traversal, sin separadores de
// ruta (ninguno de los dos), sin control/bidi y sin doble extensión ejecutable.
export function isCleanActionableReviewAttachmentName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed !== name) return false;
  if (name.length > ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY.maxNameLength) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  if (name.startsWith('.')) return false;
  if (hasUnsafeNameCharacters(name)) return false;
  if (hasDoubleExecutableExtension(name)) return false;
  return true;
}

// Un nombre de entrada es inseguro si es absoluto (raíz POSIX, unidad Windows o
// recurso UNC), si usa la barra invertida como separador o si algún segmento
// escapa/rehace la raíz del paquete. Se lee el nombre DECLARADO tal cual lo
// expone adm-zip (que no lo sanea al leer), nunca una versión ya normalizada.
export function isUnsafeActionableReviewArchiveEntryName(name) {
  const raw = String(name ?? '');
  if (!raw.trim() || raw.includes('\0')) return true;
  if (raw.includes('\\')) return true;
  if (raw.startsWith('/')) return true;
  if (/^[A-Za-z]:/.test(raw)) return true;
  const withoutTrailingSlash = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  const segments = withoutTrailingSlash.split('/');
  return segments.some(segment => segment === '' || segment === '.' || segment === '..');
}

function isActiveContentEntryName(normalizedName) {
  if (EXECUTABLE_ENTRY_PATTERN.test(normalizedName)) return true;
  if (NESTED_ARCHIVE_ENTRY_PATTERN.test(normalizedName)) return true;
  return ACTIVE_CONTENT_ENTRY_PATTERNS.some(pattern => pattern.test(normalizedName));
}

// Sólo metadatos del directorio central (header.size/compressedSize): nunca
// descomprime para decidir si es seguro descomprimir.
function evaluateArchiveExpansion(entries) {
  const policy = ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY;
  let total = 0;
  for (const entry of entries) {
    const declared = Math.max(0, Number(entry.header?.size) || 0);
    const compressed = Math.max(1, Number(entry.header?.compressedSize) || 0);
    if (declared > policy.maxArchiveEntryExpandedBytes) return 'archive_expansion_exceeded';
    if (declared > policy.archiveCompressionRatioFloorBytes
      && declared / compressed > policy.maxArchiveCompressionRatio) return 'archive_compression_ratio_exceeded';
    total += declared;
    if (total > policy.maxArchiveTotalExpandedBytes) return 'archive_expansion_exceeded';
  }
  return null;
}

// Devuelve `{ mimeType }` con el sabor OOXML resuelto por sus partes obligatorias
// o `{ reason }`. Un ZIP corriente (sin `[Content_Types].xml` + parte principal)
// nunca resuelve a un MIME permitido: se rechaza como contenedor inválido.
function inspectOoxmlPackage(buffer) {
  let entries;
  try {
    entries = new AdmZip(buffer).getEntries();
  } catch {
    return { reason: 'invalid_container' };
  }
  if (!Array.isArray(entries) || entries.length === 0) return { reason: 'invalid_container' };
  if (entries.length > ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY.maxArchiveEntryCount) {
    return { reason: 'archive_entry_limit_exceeded' };
  }

  const normalizedNames = new Set();
  for (const entry of entries) {
    const declaredName = entry?.entryName;
    if (isUnsafeActionableReviewArchiveEntryName(declaredName)) return { reason: 'unsafe_entry_path' };
    const normalized = String(declaredName).toLowerCase();
    if (isActiveContentEntryName(normalized)) return { reason: 'active_content_entry' };
    // Dos entradas con el mismo nombre normalizado hacen ambiguo qué parte
    // lee un consumidor posterior; el paquete completo se invalida.
    if (normalizedNames.has(normalized)) return { reason: 'duplicate_entry_name' };
    normalizedNames.add(normalized);
  }

  const expansionReason = evaluateArchiveExpansion(entries);
  if (expansionReason) return { reason: expansionReason };

  if (!normalizedNames.has(OOXML_CONTENT_TYPES_ENTRY)) return { reason: 'missing_ooxml_part' };
  const mimeType = normalizedNames.has(OOXML_MAIN_PART_BY_MIME[DOCX_MIME_TYPE])
    ? DOCX_MIME_TYPE
    : normalizedNames.has(OOXML_MAIN_PART_BY_MIME[XLSX_MIME_TYPE])
      ? XLSX_MIME_TYPE
      : null;
  if (!mimeType) return { reason: 'missing_ooxml_part' };

  const contentTypesEntry = entries.find(entry => String(entry.entryName).toLowerCase() === OOXML_CONTENT_TYPES_ENTRY);
  const contentTypesSize = Math.max(0, Number(contentTypesEntry.header?.size) || 0);
  if (contentTypesSize === 0 || contentTypesSize > ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY.maxContentTypesBytes) {
    return { reason: 'invalid_container' };
  }
  let contentTypesXml;
  try {
    contentTypesXml = contentTypesEntry.getData().toString('utf8');
  } catch {
    return { reason: 'invalid_container' };
  }
  const normalizedXml = contentTypesXml.toLowerCase();
  if (!normalizedXml.includes('<types')) return { reason: 'invalid_container' };
  if (MACRO_CONTENT_TYPE_PATTERN.test(normalizedXml)) return { reason: 'active_content_entry' };
  return { mimeType };
}

// UTF-8 estricto: `fatal: true` rechaza cualquier secuencia inválida (un binario
// arbitrario renombrado a .txt casi nunca decodifica) y además se rechaza NUL y
// todo control fuera de tab/CR/LF, que delata contenido binario que sí decodifica.
export function validateActionableReviewAttachmentTextBytes(buffer) {
  let text;
  try {
    text = TEXT_DECODER.decode(buffer);
  } catch {
    return 'invalid_text_encoding';
  }
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) return 'binary_text_content';
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return 'binary_text_content';
    if (code === 0x7f) return 'binary_text_content';
  }
  return null;
}

function detectContent(buffer) {
  if (startsWithSignature(buffer, PNG_SIGNATURE)) return { mimeType: 'image/png' };
  if (startsWithSignature(buffer, JPEG_SOI_SIGNATURE)) return { mimeType: 'image/jpeg' };
  if (startsWithSignature(buffer, PDF_SIGNATURE)) return { mimeType: 'application/pdf' };
  if (startsWithSignature(buffer, ZIP_LOCAL_FILE_SIGNATURE)) return inspectOoxmlPackage(buffer);
  const textReason = validateActionableReviewAttachmentTextBytes(buffer);
  if (textReason) return { reason: textReason };
  return { mimeType: 'text/plain' };
}

// MIME real por magic bytes/estructura, independiente de la extensión, del
// Content-Type del navegador y del que anunció el almacenamiento. `null` cuando
// el contenido no es exactamente uno de los siete formatos permitidos.
export function detectActionableReviewAttachmentMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  return detectContent(buffer).mimeType ?? null;
}

// §13.3: prefijo aprobado y exacto de los soportes de revisión accionable. No
// coincide con `<opportunity_id>/<documento>` (expediente oficial) ni con
// `question-responses/`, y ninguna ruta de esta familia puede tocarlos.
export const ACTIONABLE_REVIEW_ATTACHMENT_STORAGE_PREFIX = 'actionable-reviews/';
const ACTIONABLE_REVIEW_ATTACHMENT_STORAGE_SEGMENT_COUNT = 6;

// Espejo exacto del path que construye `psi_issue_tender_actionable_review_upload_ticket`:
// `actionable-reviews/<opportunity_id>/<review_item_id>/<logical_attachment_id>/v<version>/<declared_hash>-<name>`.
// Se comprueba ANTES de descargar o borrar nada: un ticket cuyo path no esté en
// este espacio de nombres no habilita ninguna operación de almacenamiento.
export function isActionableReviewAttachmentStoragePath(storagePath, expected) {
  if (typeof storagePath !== 'string' || !storagePath) return false;
  if (storagePath.includes('\\') || storagePath.includes('..') || storagePath.includes('\0')) return false;
  if (storagePath !== storagePath.trim()) return false;
  if (!storagePath.startsWith(ACTIONABLE_REVIEW_ATTACHMENT_STORAGE_PREFIX)) return false;
  const segments = storagePath.split('/');
  if (segments.length !== ACTIONABLE_REVIEW_ATTACHMENT_STORAGE_SEGMENT_COUNT) return false;
  if (segments.some(segment => segment === '' || segment === '.')) return false;
  const [prefix, opportunityId, reviewItemId, logicalAttachmentId, version, fileName] = segments;
  if (prefix !== 'actionable-reviews') return false;
  if (!expected?.opportunityId || opportunityId !== expected.opportunityId) return false;
  if (!expected?.reviewItemId || reviewItemId !== expected.reviewItemId) return false;
  if (!logicalAttachmentId) return false;
  if (!/^v[1-9][0-9]*$/.test(version)) return false;
  if (expected.version != null && version !== `v${expected.version}`) return false;
  if (!SHA256_HEX_PATTERN.test(String(expected?.declaredContentHash ?? ''))) return false;
  if (!fileName.startsWith(`${expected.declaredContentHash}-`)) return false;
  return fileName.length > expected.declaredContentHash.length + 1;
}

// §13.2 paso 4: única entrada de la ruta `complete`. `ticket` es el contrato
// server-owned recién releído (name/extension/declared_*), `buffer` son los bytes
// exactos descargados del objeto privado. Devuelve los valores DETECTADOS que la
// RPC recibirá, nunca los declarados por el navegador.
export function validateActionableReviewAttachmentBytes(ticket, buffer) {
  const name = typeof ticket?.name === 'string' ? ticket.name : '';
  const extension = typeof ticket?.extension === 'string' ? ticket.extension.toLowerCase() : '';
  const declaredMimeType = typeof ticket?.declared_mime_type === 'string' ? ticket.declared_mime_type : '';
  const declaredSizeBytes = Number(ticket?.declared_size_bytes);
  const declaredContentHash = typeof ticket?.declared_content_hash === 'string' ? ticket.declared_content_hash : '';

  if (!isCleanActionableReviewAttachmentName(name)) return failure('invalid_file_name');
  const expectedMimeType = ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION[extension];
  if (!expectedMimeType) return failure('unsupported_extension');
  if (!name.toLowerCase().endsWith(extension)) return failure('invalid_file_name');
  if (declaredMimeType !== expectedMimeType) return failure('mime_extension_mismatch');
  if (!SHA256_HEX_PATTERN.test(declaredContentHash)) return failure('invalid_declared_contract');
  if (!Number.isSafeInteger(declaredSizeBytes) || declaredSizeBytes <= 0
    || declaredSizeBytes > ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY.maxBytes) return failure('invalid_declared_contract');

  if (!Buffer.isBuffer(buffer)) return failure('unreadable_object');
  if (buffer.length === 0) return failure('empty_file');
  if (buffer.length > ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY.maxBytes) return failure('size_limit_exceeded');
  if (buffer.length !== declaredSizeBytes) return failure('size_mismatch');

  const contentHash = createHash('sha256').update(buffer).digest('hex');
  if (!actionableReviewAttachmentHashesMatch(declaredContentHash, contentHash)) return failure('hash_mismatch');

  const detected = detectContent(buffer);
  if (!detected.mimeType) return failure(detected.reason || 'unrecognized_content');
  if (detected.mimeType !== expectedMimeType) return failure('mime_mismatch');

  return { ok: true, detectedMimeType: detected.mimeType, sizeBytes: buffer.length, contentHash };
}
