import { createHash } from 'node:crypto';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';

// Bumped whenever parsing behavior changes text/metadata shape for a given input,
// so Phase 1.2 persistence can tell which extractions need reprocessing.
export const TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION = 'tender-document-text-extraction@1';

const XML_MIME = 'text/xml';

function silentDomParser() {
  // xmldom logs parse warnings/errors to console by default; we want a typed
  // gap instead, so escalate error/fatalError to a thrown exception and drop
  // warnings (OOXML producers emit harmless namespace warnings routinely).
  return new DOMParser({
    onError: (level, message) => {
      if (level === 'error' || level === 'fatalError') throw new Error(message);
    },
  });
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

function parseSharedStrings(zip) {
  const entry = zip.getEntry('xl/sharedStrings.xml');
  if (!entry) return [];
  const doc = parseXml(entry.getData().toString('utf8'));
  const items = doc.getElementsByTagName('si');
  const strings = [];
  for (let i = 0; i < items.length; i += 1) strings.push(sharedStringText(items[i]));
  return strings;
}

function parseWorkbookSheets(zip) {
  const workbookEntry = zip.getEntry('xl/workbook.xml');
  if (!workbookEntry) throw new Error('xl/workbook.xml ausente en el paquete XLSX.');
  const relsEntry = zip.getEntry('xl/_rels/workbook.xml.rels');
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
    const path = target ? `xl/${target.replace(/^\/?xl\//, '').replace(/^\.?\//, '')}` : null;
    sheets.push({ name: node.getAttribute('name') || `Hoja${i + 1}`, path });
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
  const raw = firstChildText(cellElement, 'v');
  if (raw == null) return '';
  if (type === 's') {
    const index = Number(raw);
    return Number.isInteger(index) && sharedStrings[index] != null ? sharedStrings[index] : '';
  }
  return raw;
}

function parseWorksheetCells(zip, path, sharedStrings) {
  const entry = zip.getEntry(path);
  if (!entry) return [];
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
    if (!value && !formulaNode) continue;
    const { col, row } = parseCellReference(coordinate);
    cells.push({ coordinate, row, col, value, formula: formulaNode ? formulaNode.textContent : null });
  }
  cells.sort((left, right) => (left.row - right.row) || (left.col - right.col));
  return cells;
}

function parseXlsxWorkbook(buffer) {
  const zip = new AdmZip(buffer);
  const sharedStrings = parseSharedStrings(zip);
  const sheets = parseWorkbookSheets(zip);
  return sheets.map(sheet => ({
    name: sheet.name,
    cells: sheet.path ? parseWorksheetCells(zip, sheet.path, sharedStrings) : [],
  }));
}

function formatXlsxText(sheets) {
  return sheets.map(sheet => {
    const lines = [`--- Hoja: ${sheet.name} ---`];
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

function gapResult({ parser, gapReason, error = null }) {
  const text = '';
  return {
    status: 'gap',
    text,
    extractor_version: TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION,
    parser,
    char_count: 0,
    text_hash: textHash(text),
    metadata: { gap_reason: gapReason, error: error ? String(error) : null },
  };
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

/**
 * Pure, deterministic text extraction for tender documents. Never silently
 * truncates: unreadable/unsupported input becomes a typed gap, not fictitious
 * success text.
 */
export async function extractTenderDocumentText(buffer, filename, mime = '') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return gapResult({ parser: 'none', gapReason: 'empty_input' });
  }
  const kind = detectKind(filename, mime);
  try {
    if (kind === 'pdf') {
      const result = await pdfParse(buffer);
      return okResult({ text: result?.text || '', parser: 'pdf-parse', metadata: { num_pages: result?.numpages ?? null } });
    }
    if (kind === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      return okResult({ text: result?.value || '', parser: 'mammoth-docx', metadata: { warning_count: result?.messages?.length || 0 } });
    }
    if (kind === 'txt') {
      return okResult({ text: buffer.toString('utf8'), parser: 'plain-text' });
    }
    if (kind === 'xlsx') {
      const sheets = parseXlsxWorkbook(buffer);
      const text = formatXlsxText(sheets);
      const metadata = {
        sheets: sheets.map(sheet => ({
          name: sheet.name,
          cell_count: sheet.cells.length,
          formula_count: sheet.cells.filter(cell => cell.formula).length,
        })),
      };
      return okResult({ text, parser: 'xlsx-ooxml', metadata });
    }
    if (kind === 'zip') {
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries().filter(entry => !entry.isDirectory);
      const parts = entries.map(entry => {
        if (/\.(txt|csv|xml|html?)$/i.test(entry.entryName)) {
          return `--- ${entry.entryName} ---\n${entry.getData().toString('utf8')}`;
        }
        return `--- ${entry.entryName} ---\nArchivo incluido en ZIP para checklist de formatos.`;
      });
      return okResult({ text: parts.join('\n\n'), parser: 'zip-manifest', metadata: { entry_count: entries.length } });
    }
    return gapResult({ parser: 'unsupported', gapReason: 'unsupported_type' });
  } catch (error) {
    return gapResult({ parser: kind, gapReason: 'extraction_error', error: error?.message || error });
  }
}
