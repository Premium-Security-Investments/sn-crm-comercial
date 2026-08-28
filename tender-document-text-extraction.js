import { createHash } from 'node:crypto';
import path from 'node:path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';

// Bumped whenever parsing behavior changes text/metadata shape for a given input,
// so Phase 1.2 persistence can tell which extractions need reprocessing.
export const TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION = 'tender-document-text-extraction@3';

// Archive resource-safety policy: bounds what an OOXML/ZIP package is allowed to
// declare it will expand to, checked from AdmZip central-directory metadata
// BEFORE any entry.getData()/mammoth/DOM call. Fixed and not reachable from the
// public extractTenderDocumentText(buffer, filename, mime) signature, so a
// caller cannot widen these limits by crafting the input.
export const TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY = Object.freeze({
  maxEntryCount: 300,
  maxEntryExpandedBytes: 25 * 1024 * 1024,
  maxTotalExpandedBytes: 50 * 1024 * 1024,
  maxCompressionRatio: 300,
});

// Persistence-safe ceiling for the final extracted text, matching the
// downstream tender-document-versioning.js MAX_EXTRACTED_TEXT_BYTES check, so
// an oversized document becomes a typed gap here instead of a hard throw later.
export const TENDER_DOCUMENT_MAX_EXTRACTED_TEXT_BYTES = 10 * 1024 * 1024;

// Bound applied to any captured parser error before it is placed in metadata.error.
export const TENDER_DOCUMENT_MAX_ERROR_MESSAGE_LENGTH = 200;

const XML_MIME = 'text/xml';
const ZIP_TEXT_ENTRY_PATTERN = /\.(txt|csv|xml|html?)$/i;
// Archives nested inside an official package are refused, never traversed:
// recursing would make the bounded preflight of the outer package meaningless.
const NESTED_ARCHIVE_ENTRY_PATTERN = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|iso|cab|arj|lzh)$/i;

class TenderDocumentGapError extends Error {
  constructor(gapReason, message) {
    super(message || gapReason);
    this.gapReason = gapReason;
  }
}

// Pure, unit-testable archive safety checks. Exported with an injectable
// `policy` param so tests can prove the boundary logic with tiny synthetic
// entries/limits (no OOM-scale fixtures needed); production call sites below
// always invoke these with the fixed TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY.
export function evaluateArchiveEntryCount(totalEntryCount, policy = TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY) {
  return totalEntryCount > policy.maxEntryCount ? 'too_many_entries' : null;
}

export function evaluateSelectedEntriesExpansion(selectedEntries, policy = TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY) {
  let total = 0;
  for (const entry of selectedEntries) {
    const declared = Math.max(0, Number(entry.declaredSize) || 0);
    const compressed = Math.max(1, Number(entry.compressedSize) || 0);
    if (declared > policy.maxEntryExpandedBytes) return 'expanded_size_exceeded';
    if (declared / compressed > policy.maxCompressionRatio) return 'compression_ratio_exceeded';
    total += declared;
    if (total > policy.maxTotalExpandedBytes) return 'expanded_size_exceeded';
  }
  return null;
}

function declaredEntry(entry) {
  return { name: entry.entryName, declaredSize: entry.header.size, compressedSize: entry.header.compressedSize };
}

// Checks the whole-archive entry count and the declared expansion of the
// entries we are about to decompress, using AdmZip central-directory metadata
// only (entry.header.size/compressedSize) — never calls entry.getData().
function enforceArchiveSafety(zip, selectedEntries, policy = TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY) {
  const totalEntryCount = zip.getEntries().length;
  const countGap = evaluateArchiveEntryCount(totalEntryCount, policy);
  if (countGap) throw new TenderDocumentGapError(countGap, `El paquete tiene demasiadas entradas (${totalEntryCount}).`);
  const expansionGap = evaluateSelectedEntriesExpansion(selectedEntries.map(declaredEntry), policy);
  if (expansionGap) throw new TenderDocumentGapError(expansionGap, 'El paquete excede los límites seguros de expansión declarada.');
}

// --- Raw ZIP central-directory inspection (zip-slip defense) ----------------
// Entry names are read from the RAW central directory instead of from the
// reader's decoded view: a decompression library is free to normalize or
// sanitize a name while decoding it, and a package whose *declared* names
// escape the package root must never be extracted at all — not even its
// legitimate entries. Nothing here decompresses anything: it only walks fixed
// central-directory headers, bounded by the archive's own byte length.

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const ZIP_EOCD_LENGTH = 22;
const ZIP64_EOCD_LOCATOR_LENGTH = 20;
const ZIP64_EOCD_LENGTH = 56;
const ZIP_CENTRAL_HEADER_LENGTH = 46;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;

function archiveDirectoryGap(detail) {
  return new TenderDocumentGapError('extraction_error', `El directorio central del paquete ZIP es ilegible (${detail}).`);
}

function findZipEndOfCentralDirectory(buffer) {
  const limit = Math.max(0, buffer.length - ZIP_EOCD_LENGTH - ZIP_MAX_COMMENT_LENGTH);
  for (let offset = buffer.length - ZIP_EOCD_LENGTH; offset >= limit; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function readZip64CentralDirectory(buffer, eocdOffset) {
  const locatorOffset = eocdOffset - ZIP64_EOCD_LOCATOR_LENGTH;
  if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== ZIP64_EOCD_LOCATOR_SIGNATURE) {
    throw archiveDirectoryGap('localizador zip64 ausente');
  }
  const recordOffset = Number(buffer.readBigUInt64LE(locatorOffset + 8));
  if (!Number.isSafeInteger(recordOffset) || recordOffset < 0
    || recordOffset + ZIP64_EOCD_LENGTH > buffer.length
    || buffer.readUInt32LE(recordOffset) !== ZIP64_EOCD_SIGNATURE) {
    throw archiveDirectoryGap('registro zip64 inválido');
  }
  return {
    entryCount: Number(buffer.readBigUInt64LE(recordOffset + 32)),
    offset: Number(buffer.readBigUInt64LE(recordOffset + 48)),
  };
}

/** Declared entry count and central-directory offset, from the package itself. */
function readZipCentralDirectory(buffer) {
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw archiveDirectoryGap('fin de directorio central ausente');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const offset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0xffff || offset === 0xffffffff) return readZip64CentralDirectory(buffer, eocdOffset);
  return { entryCount, offset };
}

/** Declared names of every central-directory record, verbatim and undecoded. */
function readZipCentralDirectoryEntryNames(buffer, { entryCount, offset }) {
  const names = [];
  let cursor = offset;
  for (let index = 0; index < entryCount; index += 1) {
    if (!Number.isSafeInteger(cursor) || cursor < 0
      || cursor + ZIP_CENTRAL_HEADER_LENGTH > buffer.length
      || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_HEADER_SIGNATURE) {
      throw archiveDirectoryGap(`cabecera central ${index + 1} inválida`);
    }
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const nameStart = cursor + ZIP_CENTRAL_HEADER_LENGTH;
    if (nameStart + nameLength > buffer.length) throw archiveDirectoryGap(`nombre de entrada ${index + 1} truncado`);
    names.push(buffer.toString('utf8', nameStart, nameStart + nameLength));
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  return names;
}

// An entry name is unsafe when it is absolute (POSIX root, Windows drive or UNC
// share) or when any of its segments escapes the package root. Both separators
// count: `..\` is traversal wherever backslashes are path separators.
export function isUnsafeArchiveEntryName(name) {
  const raw = String(name ?? '');
  if (!raw.trim() || raw.includes('\0')) return true;
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return true;
  if (/^[A-Za-z]:/.test(normalized)) return true;
  return normalized.split('/').includes('..');
}

// Invalidates the WHOLE package on the first unsafe name. The offending name is
// deliberately not echoed into the gap message.
function enforceArchiveEntryPathSafety(names) {
  for (const name of names) {
    if (isUnsafeArchiveEntryName(name)) {
      throw new TenderDocumentGapError('unsafe_entry_path', 'El paquete declara una entrada con ruta insegura.');
    }
  }
}

function xmlErrorHandler() {
  // xmldom 0.8.13 reads options.errorHandler (the 0.9 API uses onError, which
  // 0.8 silently ignores, falling back to console.warn/error + throw-only-on-
  // fatalError). Supplying this object suppresses harmless namespace warnings
  // and escalates BOTH error and fatalError levels to a typed gap, with no
  // console output either way.
  return {
    warning() {},
    error(message) { throw new Error(message); },
    fatalError(message) { throw new Error(message); },
  };
}

function silentDomParser() {
  return new DOMParser({ errorHandler: xmlErrorHandler() });
}

function parseXml(xmlText) {
  return silentDomParser().parseFromString(xmlText, XML_MIME);
}

function firstChildText(element, tagName) {
  const nodes = element.getElementsByTagName(tagName);
  return nodes.length ? nodes[0].textContent : null;
}

function sharedStringText(siElement) {
  const runTexts = siElement.getElementsByTagName('t');
  const parts = [];
  for (let i = 0; i < runTexts.length; i += 1) parts.push(runTexts[i].textContent || '');
  return parts.join('');
}

function parseSharedStringsFromEntry(entry) {
  if (!entry) return [];
  const doc = parseXml(entry.getData().toString('utf8'));
  const items = doc.getElementsByTagName('si');
  const strings = [];
  for (let i = 0; i < items.length; i += 1) strings.push(sharedStringText(items[i]));
  return strings;
}

// Resolves a workbook.xml.rels Target for a worksheet against the `xl/`
// package root, collapsing `..` segments. Returns null for anything that
// would escape the package root — treated as an unsafe/unresolvable target.
function resolveWorksheetRelationshipTarget(target) {
  if (!target) return null;
  const raw = target.startsWith('/') ? target.slice(1) : path.posix.join('xl', target);
  const normalized = path.posix.normalize(raw);
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

function parseWorkbookSheetDeclarations(workbookEntry, relsEntry) {
  const relsById = new Map();
  if (relsEntry) {
    const relsDoc = parseXml(relsEntry.getData().toString('utf8'));
    const relationships = relsDoc.getElementsByTagName('Relationship');
    for (let i = 0; i < relationships.length; i += 1) {
      const rel = relationships[i];
      relsById.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
    }
  }
  const workbookDoc = parseXml(workbookEntry.getData().toString('utf8'));
  const sheetNodes = workbookDoc.getElementsByTagName('sheet');
  const sheets = [];
  for (let i = 0; i < sheetNodes.length; i += 1) {
    const node = sheetNodes[i];
    const relId = node.getAttribute('r:id') || node.getAttribute('id');
    const target = relId ? relsById.get(relId) : null;
    const state = node.getAttribute('state') || '';
    sheets.push({
      name: node.getAttribute('name') || `Hoja${i + 1}`,
      path: resolveWorksheetRelationshipTarget(target),
      hidden: state === 'hidden' || state === 'veryHidden',
    });
  }
  return sheets;
}

function columnLettersToIndex(letters) {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
}

function parseCellReference(ref) {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref || '');
  if (!match) return { col: 0, row: 0 };
  return { col: columnLettersToIndex(match[1]), row: Number(match[2]) };
}

function cellValueText(cellElement, type, sharedStrings) {
  if (type === 'inlineStr') {
    const inline = cellElement.getElementsByTagName('is')[0];
    return inline ? sharedStringText(inline) : '';
  }
  if (type === 'b') {
    const raw = firstChildText(cellElement, 'v');
    if (raw == null) return '';
    return raw === '1' || raw.toLowerCase() === 'true' ? 'VERDADERO' : 'FALSO';
  }
  const raw = firstChildText(cellElement, 'v');
  if (raw == null) return '';
  if (type === 's') {
    const index = Number(raw);
    return Number.isInteger(index) && sharedStrings[index] != null ? sharedStrings[index] : '';
  }
  // Default numeric cell: date/style formatting is deferred (not decoded), but
  // when a style is applied we surface that explicitly so downstream text
  // mining cannot mistake a raw serial for an already-normalized date/value.
  if (type === 'n') {
    const styleIndex = cellElement.getAttribute('s');
    if (styleIndex && styleIndex !== '0') return `${raw} [serial estilo s=${styleIndex}]`;
  }
  return raw;
}

// Shared-formula follower cells (<f t="shared" si="N"/>) carry no formula text
// of their own, only a cached <v>. We must not invent/expand the master
// formula for them — just retain the shared-formula identity/reference.
function formulaDescriptor(formulaNode) {
  if (!formulaNode) return null;
  const text = formulaNode.textContent || '';
  if (text) return text;
  if (formulaNode.getAttribute('t') === 'shared') {
    const sharedIndex = formulaNode.getAttribute('si');
    return sharedIndex != null ? `fórmula compartida (si=${sharedIndex}, valor en caché)` : 'fórmula compartida (valor en caché)';
  }
  return null;
}

function parseWorksheetCells(entry, sharedStrings) {
  const doc = parseXml(entry.getData().toString('utf8'));
  const cellNodes = doc.getElementsByTagName('c');
  const cells = [];
  for (let i = 0; i < cellNodes.length; i += 1) {
    const cellElement = cellNodes[i];
    const coordinate = cellElement.getAttribute('r');
    if (!coordinate) continue;
    const type = cellElement.getAttribute('t') || 'n';
    const formulaNode = cellElement.getElementsByTagName('f')[0];
    const value = cellValueText(cellElement, type, sharedStrings);
    const formula = formulaDescriptor(formulaNode);
    if (!value && !formula) continue;
    const { col, row } = parseCellReference(coordinate);
    cells.push({ coordinate, row, col, value, formula });
  }
  cells.sort((left, right) => (left.row - right.row) || (left.col - right.col));
  return cells;
}

function parseXlsxWorkbook(buffer, policy = TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY) {
  const zip = new AdmZip(buffer);
  const workbookEntry = zip.getEntry('xl/workbook.xml');
  if (!workbookEntry) throw new TenderDocumentGapError('extraction_error', 'xl/workbook.xml ausente en el paquete XLSX.');
  const relsEntry = zip.getEntry('xl/_rels/workbook.xml.rels');
  const sharedStringsEntry = zip.getEntry('xl/sharedStrings.xml');
  const metadataEntries = [workbookEntry, relsEntry, sharedStringsEntry].filter(Boolean);
  // Preflight the small metadata parts before decompressing them, since we
  // need their content to even discover which worksheet entries exist.
  enforceArchiveSafety(zip, metadataEntries, policy);

  const sharedStrings = parseSharedStringsFromEntry(sharedStringsEntry);
  const sheetDeclarations = parseWorkbookSheetDeclarations(workbookEntry, relsEntry);

  const worksheetEntries = [];
  for (const sheet of sheetDeclarations) {
    if (!sheet.path) {
      throw new TenderDocumentGapError('extraction_error', `La hoja "${sheet.name}" referencia una relación ausente o insegura en el paquete XLSX.`);
    }
    const entry = zip.getEntry(sheet.path);
    if (!entry) {
      throw new TenderDocumentGapError('extraction_error', `La hoja "${sheet.name}" referencia una entrada ausente en el paquete XLSX.`);
    }
    worksheetEntries.push({ sheet, entry });
  }

  // Preflight again with metadata + worksheet entries combined, so the total
  // expansion budget covers everything we are about to decompress.
  enforceArchiveSafety(zip, [...metadataEntries, ...worksheetEntries.map(w => w.entry)], policy);

  return sheetDeclarations.map(sheet => {
    const found = worksheetEntries.find(w => w.sheet === sheet);
    return { name: sheet.name, hidden: sheet.hidden, cells: found ? parseWorksheetCells(found.entry, sharedStrings) : [] };
  });
}

function formatXlsxText(sheets) {
  return sheets.map(sheet => {
    const header = sheet.hidden ? `--- Hoja: ${sheet.name} (oculta) ---` : `--- Hoja: ${sheet.name} ---`;
    const lines = [header];
    for (const cell of sheet.cells) {
      const formulaSuffix = cell.formula ? ` (fórmula: ${cell.formula})` : '';
      lines.push(`${cell.coordinate}${formulaSuffix}: ${cell.value}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

function textHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function okResult({ text, parser, metadata = {} }) {
  return {
    status: 'ok',
    text,
    extractor_version: TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION,
    parser,
    char_count: text.length,
    text_hash: textHash(text),
    metadata,
  };
}

// `metadata` carries the closed provenance a gap is still able to justify (an
// archive keeps its per-entry index), always alongside gap_reason/error.
function gapResult({ parser, gapReason, error = null, metadata = {} }) {
  const text = '';
  return {
    status: 'gap',
    text,
    extractor_version: TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION,
    parser,
    char_count: 0,
    text_hash: textHash(text),
    metadata: { ...metadata, gap_reason: gapReason, error: error ?? null },
  };
}

// Redacts an error message to a single bounded, code-safe line before it is
// placed in metadata.error: strips newlines, redacts filesystem paths,
// emails, long hex/UUID identifiers and query-string secrets, and truncates.
// Only ever reads error.message (or a plain string) — the stack is never
// touched, so it can never leak through this path.
export function sanitizeExtractionErrorMessage(error) {
  const raw = String(error?.message ?? error ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!raw) return null;
  let sanitized = raw
    .replace(/[A-Za-z]:\\[^\s"']+/g, '[ruta]')
    .replace(/(?<![:/])(?:\.{1,2}\/|\/)(?:[\w.-]+\/)+[\w.-]+/g, '[ruta]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b[0-9a-fA-F]{16,}\b/g, '[id]')
    .replace(/([?&][\w.-]+=)[^\s&]+/g, '$1[secreto]');
  if (sanitized.length > TENDER_DOCUMENT_MAX_ERROR_MESSAGE_LENGTH) {
    sanitized = `${sanitized.slice(0, TENDER_DOCUMENT_MAX_ERROR_MESSAGE_LENGTH - 1)}…`;
  }
  return sanitized;
}

function detectKind(filename, mime) {
  const lower = String(filename || '').toLowerCase();
  const type = String(mime || '').toLowerCase();
  if (lower.endsWith('.pdf') || type.includes('pdf')) return 'pdf';
  if (lower.endsWith('.docx') || type.includes('wordprocessingml')) return 'docx';
  if (lower.endsWith('.txt') || type.startsWith('text/')) return 'txt';
  if (lower.endsWith('.xlsx') || type.includes('spreadsheetml')) return 'xlsx';
  if (lower.endsWith('.zip') || type.includes('zip')) return 'zip';
  return 'unsupported';
}

// Finalizes a successful parse: an oversized result becomes a typed gap
// instead of being truncated, and an empty/whitespace-only result becomes a
// typed gap instead of a fictitious `status: 'ok'` success.
function finalizeSuccess({ text, parser, metadata = {}, isEmpty }) {
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > TENDER_DOCUMENT_MAX_EXTRACTED_TEXT_BYTES) {
    return gapResult({ parser, gapReason: 'extracted_text_size_exceeded' });
  }
  const empty = typeof isEmpty === 'boolean' ? isEmpty : !text.trim();
  if (empty) return gapResult({ parser, gapReason: 'empty_extraction' });
  return okResult({ text, parser, metadata });
}

// pdf-parse bundles pdf.js 1.10.100, whose `Stream.makeSubStream` rebuilds every
// indirect-object substream as `new Stream(bytes.buffer, xrefOffset)`: it resolves
// the offset against the ArrayBuffer origin and silently drops `bytes.byteOffset`.
// Node serves any Buffer smaller than 4 KiB from a shared pool (and pdf.js's own
// worker loopback re-copies small inputs back into that pool with
// `new Buffer(value)`), so a small PDF reaches the parser at a non-zero
// byteOffset and every object is then read from the wrong origin — a
// structurally valid document fails as `extraction_error`. Documents at or above
// 4 KiB own their ArrayBuffer, which is why only small PDFs were affected.
// Handing pdf.js a plain Uint8Array anchored at offset 0 removes the ambiguity:
// `new Uint8Array(...)` copies are never pooled, so the offset stays 0 through
// the loopback clone too. Bytes are never altered, and a buffer that already owns
// its whole ArrayBuffer is re-viewed instead of copied.
function pdfBytesAnchoredAtZero(buffer) {
  if (buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength) {
    return new Uint8Array(buffer.buffer);
  }
  return new Uint8Array(buffer);
}

// The single place where a buffer of a known kind becomes text. Shared by the
// top-level document path and by every ZIP entry, so an annex delivered INSIDE
// an official package is read by exactly the same parser — and the same OOXML
// preflight — as the same file delivered on its own. Returns null for kinds
// that have no parser.
async function parseBufferByKind(kind, buffer) {
  if (kind === 'pdf') {
    const result = await pdfParse(pdfBytesAnchoredAtZero(buffer));
    return { text: result?.text || '', parser: 'pdf-parse', metadata: { num_pages: result?.numpages ?? null } };
  }
  if (kind === 'docx') {
    // mammoth decompresses the OOXML package internally, so preflight the
    // whole archive before handing it the buffer.
    const docxZip = new AdmZip(buffer);
    const docxEntries = docxZip.getEntries().filter(entry => !entry.isDirectory);
    enforceArchiveSafety(docxZip, docxEntries);
    const result = await mammoth.extractRawText({ buffer });
    return { text: result?.value || '', parser: 'mammoth-docx', metadata: { warning_count: result?.messages?.length || 0 } };
  }
  if (kind === 'txt') {
    return { text: buffer.toString('utf8'), parser: 'plain-text', metadata: {} };
  }
  if (kind === 'xlsx') {
    const sheets = parseXlsxWorkbook(buffer);
    const totalCells = sheets.reduce((sum, sheet) => sum + sheet.cells.length, 0);
    return {
      text: formatXlsxText(sheets),
      parser: 'xlsx-ooxml',
      metadata: {
        sheets: sheets.map(sheet => ({
          name: sheet.name,
          hidden: sheet.hidden,
          cell_count: sheet.cells.length,
          formula_count: sheet.cells.filter(cell => cell.formula).length,
        })),
      },
      isEmpty: totalCells === 0,
    };
  }
  return null;
}

// --- Real per-entry extraction of an official ZIP package -------------------

// Entry kinds are decided by extension alone: a ZIP central directory carries
// no MIME type, and guessing one from content would be a second, weaker
// classifier. Nested archives are matched FIRST so `.zip`/`.rar` can never fall
// through to another branch.
const ARCHIVE_ENTRY_PARSER_BY_KIND = Object.freeze({
  pdf: 'pdf-parse',
  docx: 'mammoth-docx',
  xlsx: 'xlsx-ooxml',
  txt: 'plain-text',
  archive: 'none',
  unsupported: 'unsupported',
});

function detectArchiveEntryKind(entryName) {
  const lower = String(entryName || '').toLowerCase();
  if (NESTED_ARCHIVE_ENTRY_PATTERN.test(lower)) return 'archive';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (ZIP_TEXT_ENTRY_PATTERN.test(lower)) return 'txt';
  return 'unsupported';
}

function declaredByteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

// Locale-independent ascending order by entry name, so the same package bytes
// always produce the same aggregated text and the same text_hash on any host.
function compareEntryNames(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Reads ONE archive entry. Returns a closed provenance record — no raw text,
 * no bytes, no storage path and no parser error string ever enters it — plus
 * the extracted text, which only the aggregate uses. A nested archive is
 * refused as a typed gap, never traversed.
 */
async function extractArchiveEntry(entry) {
  const kind = detectArchiveEntryKind(entry.entryName);
  const base = {
    entry_name: entry.entryName,
    kind,
    parser: ARCHIVE_ENTRY_PARSER_BY_KIND[kind],
    declared_size_bytes: declaredByteCount(entry.header?.size),
    compressed_size_bytes: declaredByteCount(entry.header?.compressedSize),
  };
  const gapEntry = gapReason => ({
    record: { ...base, status: 'gap', gap_reason: gapReason, char_count: 0, text_hash: textHash('') },
    text: null,
  });

  if (kind === 'archive') return gapEntry('nested_archive_not_supported');
  if (kind === 'unsupported') return gapEntry('unsupported_type');
  try {
    const parsed = await parseBufferByKind(kind, entry.getData());
    const text = parsed.text;
    const empty = typeof parsed.isEmpty === 'boolean' ? parsed.isEmpty : !text.trim();
    if (empty) return gapEntry('empty_extraction');
    return {
      record: { ...base, status: 'ok', gap_reason: null, char_count: text.length, text_hash: textHash(text) },
      text,
    };
  } catch (error) {
    return gapEntry(error instanceof TenderDocumentGapError ? error.gapReason : 'extraction_error');
  }
}

/**
 * Real, bounded extraction of an official ZIP package. Every entry is read with
 * the parser its type deserves; the aggregated text is emitted in ascending
 * entry-name order; and ANY entry that could not be read turns the whole
 * package into a typed gap that enumerates the internal holes one by one — so
 * no partial text is ever persisted as if it were the complete document.
 */
async function extractZipArchive(buffer) {
  // Bounds first, on declared metadata only: entry count, then declared paths,
  // then declared expansion. Nothing is decompressed until all three hold for
  // EVERY entry of the package, whatever its extension.
  const directory = readZipCentralDirectory(buffer);
  const countGap = evaluateArchiveEntryCount(directory.entryCount);
  if (countGap) throw new TenderDocumentGapError(countGap, `El paquete tiene demasiadas entradas (${directory.entryCount}).`);
  enforceArchiveEntryPathSafety(readZipCentralDirectoryEntryNames(buffer, directory));

  const zip = new AdmZip(buffer);
  const allEntries = zip.getEntries();
  enforceArchiveEntryPathSafety(allEntries.map(entry => entry.entryName));
  const entries = allEntries
    .filter(entry => !entry.isDirectory)
    .sort((left, right) => compareEntryNames(left.entryName, right.entryName));
  enforceArchiveSafety(zip, entries);

  // A failing entry never aborts the package: the readable ones keep their real
  // provenance and the unreadable ones are enumerated instead of being hidden.
  const records = [];
  const parts = [];
  for (const entry of entries) {
    const { record, text } = await extractArchiveEntry(entry);
    records.push(record);
    if (record.status === 'ok') parts.push(`--- ${record.entry_name} ---\n${text}`);
  }

  const internalGaps = records
    .filter(record => record.status === 'gap')
    .map(record => ({ entry_name: record.entry_name, gap_reason: record.gap_reason }));
  const metadata = { entry_count: records.length, entries: records, internal_gaps: internalGaps };
  if (internalGaps.length) {
    return gapResult({ parser: 'zip-archive', gapReason: 'archive_incomplete_extraction', metadata });
  }
  return finalizeSuccess({ text: parts.join('\n\n'), parser: 'zip-archive', metadata });
}

/**
 * Pure, deterministic text extraction for tender documents. Never silently
 * truncates: unreadable/unsupported/oversized/empty input becomes a typed
 * gap, not fictitious success text.
 */
export async function extractTenderDocumentText(buffer, filename, mime = '') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return gapResult({ parser: 'none', gapReason: 'empty_input' });
  }
  const kind = detectKind(filename, mime);
  try {
    if (kind === 'zip') return await extractZipArchive(buffer);
    const parsed = await parseBufferByKind(kind, buffer);
    if (parsed) return finalizeSuccess(parsed);
    return gapResult({ parser: 'unsupported', gapReason: 'unsupported_type' });
  } catch (error) {
    const gapReason = error instanceof TenderDocumentGapError ? error.gapReason : 'extraction_error';
    return gapResult({ parser: kind, gapReason, error: sanitizeExtractionErrorMessage(error) });
  }
}

// --- Legacy string-field adapter -------------------------------------------
// server/index.js and api/[...path].js persist extracted_text as a plain
// string (psi_tender_document_versions.extracted_text and friends). ok/
// unsupported_type/empty_input keep returning a legacy display string
// (unchanged, deliberately preserved), but every other gap now throws
// instead of returning gap prose: earlier behavior let a raw-parser-error
// string pass the callers' non-blank checks and get persisted/parsed as if
// it were real document content. Throwing here routes the failure through
// each call site's existing error handling (HTTP error response, or
// refreshTenderDocumentBatch's per-document failure entry) instead.

export class TenderDocumentExtractionGapError extends Error {
  constructor(filename, gapReason) {
    super(`No fue posible extraer texto verificable de ${filename} (código: ${gapReason}).`);
    this.name = 'TenderDocumentExtractionGapError';
    this.code = 'TENDER_DOC_EXTRACTION_GAP';
    this.gap_reason = gapReason;
    this.status = 422;
  }
}

const LEGACY_INFORMATIONAL_GAP_TEXT = {
  unsupported_type: filename => `Archivo ${filename} cargado. Tipo no soportado para extracción profunda automática.`,
  empty_input: filename => `Archivo ${filename} está vacío; no hay texto para extraer.`,
};

export function resolveLegacyExtractedText(result, filename) {
  if (result.status === 'ok') return result.text;
  const informational = LEGACY_INFORMATIONAL_GAP_TEXT[result.metadata.gap_reason];
  if (informational) return informational(filename);
  throw new TenderDocumentExtractionGapError(filename, result.metadata.gap_reason);
}
