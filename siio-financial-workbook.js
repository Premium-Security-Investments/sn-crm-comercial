import { createHash } from 'node:crypto';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';

export const SIIO_FINANCIAL_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const SIIO_FINANCIAL_IMPORT_BUCKET = 'siio-financial-imports';
export const SIIO_FINANCIAL_IMPORT_PARSER_VERSION = 'siio-financial-workbook@1';

const REQUIRED_SHEETS = Object.freeze(['PYG NIIF', 'Comparat', 'Resum']);
const PRIVATE_SHEETS = new Set([
  'NOMINA', 'Socios', 'Dr Mauricio', 'Cuentas Dr.', 'Ot Pag', 'Dotac',
  'Ingr Monit', 'Ingr S Pub', 'ENERGIA', 'Amortiz', 'Hoja1',
]);
const KNOWN_NON_MONTHLY_SHEETS = new Set([
  '% distribucion gastos', 'PYG', 'SS 2016', 'FORMULAS', 'PYG NIIF', 'SS 2026',
  'Resum', 'X Concepto', 'Graf P', 'Comparat', 'NOMINA', 'MOD-MOI', 'Costo Ind',
  'Hoja2', 'Admon', 'Gastos Gen', 'Honorar', 'Arrendam', 'Servicios', 'Mantt y Rep',
  'Divers', 'COMER', 'MONITOREO', 'VIGILANCIA', 'CRUCE NOTAS', 'base agencias',
  'PUBLICIDAD', 'Junta', 'AJUSTES', 'AJUSTES MES', 'UEN', 'Graf', 'Hoja1', 'Dotac',
  'Ingr Monit', 'Socios', 'Ingr S Pub', 'Ot Pag', 'Cuentas Dr.', 'CCuentas', 'BASE',
  'Analis', 'Dr Mauricio', 'Amortiz', 'ENERGIA',
]);
const MONTHLY_SHEET_PATTERN = /^(1[0-2]|[1-9]) (\d{2})$/;
const APPROVED_CONCEPTS = new Set([
  'INGRESOS', 'COSTOS', 'GASTOS', 'UTILIDAD OPERACIONAL', 'MARGEN OPERACIONAL',
  'NO OPERACIONAL', 'IMPUESTOS', 'UTILIDAD NETA', 'MARGEN NETO',
]);
const MONTH_NAMES = new Map([
  ['ENERO', 1], ['FEBRERO', 2], ['MARZO', 3], ['ABRIL', 4], ['MAYO', 5], ['JUNIO', 6],
  ['JULIO', 7], ['AGOSTO', 8], ['SEPTIEMBRE', 9], ['OCTUBRE', 10], ['NOVIEMBRE', 11], ['DICIEMBRE', 12],
]);
const ARCHIVE_POLICY = Object.freeze({ maxEntries: 500, maxEntryBytes: 30 * 1024 * 1024, maxExpandedBytes: 60 * 1024 * 1024, maxRatio: 400 });

class FinancialWorkbookError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

function parseXml(entry, label) {
  if (!entry) throw new FinancialWorkbookError('invalid_workbook', `Falta ${label} en el archivo.`);
  let parseError = null;
  const parser = new DOMParser({ errorHandler: {
    warning() {},
    error(message) { parseError = message; },
    fatalError(message) { parseError = message; },
  } });
  const document = parser.parseFromString(entry.getData().toString('utf8'), 'text/xml');
  if (parseError) throw new FinancialWorkbookError('invalid_workbook', `No se pudo leer ${label}.`);
  return document;
}

function nodes(element, tagName) {
  const found = element.getElementsByTagName(tagName);
  return Array.from({ length: found.length }, (_, index) => found[index]);
}

function normalizeLabel(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeHeader(value) {
  return normalizeLabel(value).replace(/[^A-Z0-9]/g, '');
}

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function columnIndex(reference) {
  const match = /^([A-Z]+)\d+$/i.exec(reference || '');
  if (!match) return 0;
  let result = 0;
  for (const char of match[1].toUpperCase()) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function rowIndex(reference) {
  return Number((/\d+$/.exec(reference || '') || [0])[0]);
}

function zipEntries(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new FinancialWorkbookError('invalid_workbook', 'El archivo no es un libro de Excel válido.');
  }
  const entries = zip.getEntries();
  if (entries.length > ARCHIVE_POLICY.maxEntries) throw new FinancialWorkbookError('unsafe_workbook', 'El archivo contiene demasiadas partes internas.');
  let expanded = 0;
  const names = new Set();
  for (const entry of entries) {
    const name = String(entry.entryName || '').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw new FinancialWorkbookError('unsafe_workbook', 'El archivo contiene una ruta interna insegura.');
    const lower = name.toLowerCase();
    if (names.has(lower)) throw new FinancialWorkbookError('unsafe_workbook', 'El archivo contiene partes internas duplicadas.');
    names.add(lower);
    const size = Math.max(0, Number(entry.header?.size) || 0);
    const compressed = Math.max(1, Number(entry.header?.compressedSize) || 0);
    if (size > ARCHIVE_POLICY.maxEntryBytes || size / compressed > ARCHIVE_POLICY.maxRatio) throw new FinancialWorkbookError('unsafe_workbook', 'El archivo excede los límites seguros de expansión.');
    expanded += size;
    if (expanded > ARCHIVE_POLICY.maxExpandedBytes) throw new FinancialWorkbookError('unsafe_workbook', 'El archivo excede el límite total de expansión.');
    if (/^(xl\/vbaproject\.bin|xl\/activex\/|xl\/embeddings\/)/i.test(name)) throw new FinancialWorkbookError('active_content', 'El libro contiene macros u objetos activos y no puede cargarse.');
  }
  return zip;
}

function workbookDeclarations(zip) {
  const workbook = parseXml(zip.getEntry('xl/workbook.xml'), 'la estructura del libro');
  const relationships = parseXml(zip.getEntry('xl/_rels/workbook.xml.rels'), 'las relaciones del libro');
  const targets = new Map(nodes(relationships, 'Relationship').map(node => [node.getAttribute('Id'), node.getAttribute('Target')]));
  return nodes(workbook, 'sheet').map(node => {
    const target = targets.get(node.getAttribute('r:id') || node.getAttribute('id'));
    const rawPath = target?.startsWith('/') ? target.slice(1) : path.posix.join('xl', target || '');
    const entryPath = path.posix.normalize(rawPath);
    if (!target || entryPath === '..' || entryPath.startsWith('../')) throw new FinancialWorkbookError('invalid_workbook', 'Una hoja tiene una relación inválida.');
    const entry = zip.getEntry(entryPath);
    if (!entry) throw new FinancialWorkbookError('invalid_workbook', 'Una hoja declarada no está presente en el archivo.');
    // Ninguna hoja se descomprime durante el inventario. La dimensión sólo se
    // obtiene más adelante para el subconjunto financiero expresamente elegido.
    const sheetName = node.getAttribute('name') || '';
    return { name: sheetName, state: node.getAttribute('state') || 'visible', entryPath, entry, dimension: PRIVATE_SHEETS.has(sheetName) ? '[excluded]' : null };
  });
}

function requestedSharedStringIndexes(sheetDeclarations) {
  const indexes = new Set();
  for (const sheet of sheetDeclarations) {
    const document = parseXml(sheet.entry, `la hoja ${sheet.name}`);
    for (const cell of nodes(document, 'c')) {
      if (cell.getAttribute('t') !== 's') continue;
      const value = cell.getElementsByTagName('v')[0]?.textContent;
      if (/^\d+$/.test(value || '')) indexes.add(Number(value));
    }
  }
  return indexes;
}

function readSharedStrings(zip, requested) {
  const entry = zip.getEntry('xl/sharedStrings.xml');
  if (!entry || !requested.size) return new Map();
  const document = parseXml(entry, 'los textos compartidos');
  const values = new Map();
  for (const [index, item] of nodes(document, 'si').entries()) {
    if (!requested.has(index)) continue;
    values.set(index, nodes(item, 't').map(node => node.textContent || '').join(''));
  }
  return values;
}

function parseSheet(sheet, sharedStrings) {
  const document = parseXml(sheet.entry, `la hoja ${sheet.name}`);
  const dimension = document.getElementsByTagName('dimension')[0]?.getAttribute('ref') || '';
  const cells = new Map();
  for (const element of nodes(document, 'c')) {
    const reference = element.getAttribute('r');
    if (!reference) continue;
    const type = element.getAttribute('t') || 'n';
    const raw = element.getElementsByTagName('v')[0]?.textContent ?? '';
    let value = raw;
    if (type === 's') value = sharedStrings.get(Number(raw)) ?? '';
    else if (type === 'inlineStr') value = nodes(element, 't').map(node => node.textContent || '').join('');
    else if (type === 'b') value = raw === '1';
    else if (type === 'n' || !type) value = numeric(raw);
    const formula = element.getElementsByTagName('f')[0]?.textContent || null;
    cells.set(reference.toUpperCase(), { reference: reference.toUpperCase(), row: rowIndex(reference), column: columnIndex(reference), type, value, formula });
  }
  return { ...sheet, dimension, cells };
}

function cell(sheet, column, row) {
  return sheet.cells.get(`${column}${row}`)?.value ?? null;
}

function formula(sheet, column, row) {
  return sheet.cells.get(`${column}${row}`)?.formula ?? null;
}

function sheetRows(sheet) {
  const rows = new Map();
  for (const item of sheet.cells.values()) {
    if (!rows.has(item.row)) rows.set(item.row, new Map());
    rows.get(item.row).set(item.column, item);
  }
  return rows;
}

function balanceHeaderColumns(sheet) {
  const headers = sheetRows(sheet).get(1) || new Map();
  const aliases = {
    account: new Set(['CUENTA', 'CODIGOCUENTA']),
    name: new Set(['NOMBRECUENTA', 'NOMBREDELACUENTA']),
    previous: new Set(['SALDOANTERIOR']),
    debit: new Set(['DEBITO', 'DEBITOS']),
    credit: new Set(['CREDITO', 'CREDITOS']),
    final: new Set(['SALDOACTUAL', 'SALDOFINAL']),
  };
  const result = {};
  for (const [column, item] of headers) {
    const normalized = normalizeHeader(item.value);
    for (const [key, accepted] of Object.entries(aliases)) if (accepted.has(normalized)) result[key] = column;
  }
  if (Object.keys(result).length !== Object.keys(aliases).length) throw new FinancialWorkbookError('balance_headers', `La hoja ${sheet.name} no tiene las seis columnas contables esperadas.`);
  return result;
}

function columnLetters(index) {
  let result = '';
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function hasFormulaConstant(value) {
  if (!value) return false;
  const withoutRefs = value.replace(/(?:'[^']+'!)?\$?[A-Z]{1,3}\$?\d+/gi, '').replace(/\d+(?=\s*[!:])/g, '');
  return /(?:^|[^A-Za-z])\d+(?:\.\d+)?/.test(withoutRefs);
}

function parseBalanceSheet(sheet, period) {
  const columns = balanceHeaderColumns(sheet);
  const rows = [];
  for (const [rowNumber, row] of sheetRows(sheet)) {
    if (rowNumber === 1) continue;
    const accountValue = row.get(columns.account)?.value;
    const account = String(accountValue ?? '').trim().replace(/\.0+$/, '');
    if (!/^\d{1,8}$/.test(account)) continue;
    const formulas = {};
    for (const key of ['previous', 'debit', 'credit', 'final']) {
      const current = formula(sheet, columnLetters(columns[key]), rowNumber);
      if (current) formulas[key] = current;
    }
    rows.push({
      year: period.year,
      month: period.month,
      account,
      account_name: String(row.get(columns.name)?.value ?? '').trim(),
      level: account.length,
      account_class: Number(account[0]),
      previous_balance: numeric(row.get(columns.previous)?.value),
      debits: numeric(row.get(columns.debit)?.value),
      credits: numeric(row.get(columns.credit)?.value),
      final_balance: numeric(row.get(columns.final)?.value),
      has_manual_adjustment: Object.values(formulas).some(hasFormulaConstant),
      original_formula: Object.keys(formulas).length ? JSON.stringify(formulas) : null,
      source_sheet: sheet.name,
      source_row: rowNumber,
    });
  }
  if (!rows.length) throw new FinancialWorkbookError('empty_balance', `La hoja ${sheet.name} no contiene líneas contables.`);
  return { headers: Object.fromEntries(Object.entries(columns).map(([key, value]) => [key, normalizeHeader(cell(sheet, columnLetters(value), 1))])), rows };
}

function financialCategory(concept) {
  if (concept.includes('MARGEN')) return 'margen';
  if (concept === 'INGRESOS') return 'ingresos';
  if (['COSTOS', 'GASTOS', 'IMPUESTOS'].includes(concept)) return 'costos_gastos';
  return 'resultado';
}

function parseReportedMetrics(sheet) {
  const result = [];
  for (const row of sheetRows(sheet).keys()) {
    const concept = normalizeLabel(cell(sheet, 'B', row));
    if (!APPROVED_CONCEPTS.has(concept)) continue;
    const current = numeric(cell(sheet, 'C', row));
    const comparison = numeric(cell(sheet, 'F', row));
    if (current === null || comparison === null) throw new FinancialWorkbookError('missing_metric', `El concepto ${concept} no tiene valores comparables.`);
    result.push({
      category: financialCategory(concept), concept, value_current: current, value_comparison: comparison,
      variation_abs: numeric(cell(sheet, 'I', row)) ?? current - comparison,
      variation_pct: numeric(cell(sheet, 'J', row)) ?? (comparison === 0 ? null : current / comparison - 1),
      source_sheet: sheet.name, source_cell: `C${row}`,
    });
  }
  if (result.length !== APPROVED_CONCEPTS.size) throw new FinancialWorkbookError('missing_metrics', `Se esperaban ${APPROVED_CONCEPTS.size} indicadores y se encontraron ${result.length}.`);
  return result;
}

function reportedPeriod(pygSheet) {
  for (const item of pygSheet.cells.values()) {
    const label = normalizeLabel(item.value);
    const match = /(?:A:)?\s*\d{1,2}\s+DE\s+([A-Z]+)\s+DE\s+(20\d{2})/.exec(label);
    if (match && MONTH_NAMES.has(match[1])) return { year: Number(match[2]), month: MONTH_NAMES.get(match[1]) };
  }
  return null;
}

function findPygNetIncome(pygSheet) {
  for (const row of sheetRows(pygSheet).keys()) if (normalizeLabel(cell(pygSheet, 'C', row)) === 'UTILIDAD DEL EJERCICIO') return numeric(cell(pygSheet, 'G', row));
  return null;
}

function validation(rule, severity, ok, expected, obtained, detail) {
  return { rule, severity, ok, expected: expected == null ? null : String(expected), obtained: obtained == null ? null : String(obtained), difference: numeric(obtained) != null && numeric(expected) != null ? numeric(obtained) - numeric(expected) : null, detail };
}

function calculateValidations({ parsedBalances, metrics, pygSheet, resumSheet, period, privateSheetCount }) {
  const validations = [];
  for (const balance of parsedBalances) {
    const topLevelTotal = balance.rows.filter(row => row.level === 1 && row.account_class >= 1 && row.account_class <= 7).reduce((sum, row) => sum + (row.final_balance || 0), 0);
    validations.push(validation('V1_BALANCE_CUADRA', 'bloqueante', Math.abs(topLevelTotal) <= 1, 0, topLevelTotal, `${balance.sheetName}: suma de clases 1 a 7.`));
  }
  const byConcept = new Map(metrics.map(item => [item.concept, item]));
  const comparatSheet = metrics[0]._sheet;
  const comparatValue = concept => {
    for (const row of sheetRows(comparatSheet).keys()) if (normalizeLabel(cell(comparatSheet, 'B', row)) === concept) return numeric(cell(comparatSheet, 'C', row));
    return null;
  };
  const lineTotal = ['VIGILANCIA', 'MONITOREO', 'COMERCIALIZACION'].reduce((sum, concept) => sum + (comparatValue(concept) || 0), 0);
  validations.push(validation('V3_INGRESOS_POR_LINEA', 'bloqueante', Math.abs(lineTotal - byConcept.get('INGRESOS').value_current) <= 1000, byConcept.get('INGRESOS').value_current, lineTotal, 'Ingresos = Vigilancia + Monitoreo + Comercialización.'));
  const netIncome = findPygNetIncome(pygSheet);
  validations.push(validation('V5_UTILIDAD_REPORTADA', 'bloqueante', netIncome !== null && Math.abs(netIncome - byConcept.get('UTILIDAD NETA').value_current) <= 1000, byConcept.get('UTILIDAD NETA').value_current, netIncome, 'Comparat frente a PYG NIIF.'));
  const resumControl = numeric(cell(resumSheet, 'B', 43));
  validations.push(validation('V5_CONTROL_RESUM', 'bloqueante', resumControl !== null && Math.abs(resumControl) <= 1, 0, resumControl, 'Control de cuadre Resum!B43.'));
  const keyErrorCells = [];
  for (const item of metrics) {
    const row = Number(item.source_cell.slice(1));
    for (const column of ['C', 'F', 'I', 'J']) if (comparatSheet.cells.get(`${column}${row}`)?.type === 'e') keyErrorCells.push(`${column}${row}`);
  }
  for (const row of sheetRows(pygSheet).keys()) {
    if (!['TOTAL INGRESOS', 'UTILIDAD DEL EJERCICIO'].includes(normalizeLabel(cell(pygSheet, 'C', row)))) continue;
    for (const column of ['G', 'L']) if (pygSheet.cells.get(`${column}${row}`)?.type === 'e') keyErrorCells.push(`${column}${row}`);
  }
  if (resumSheet.cells.get('B43')?.type === 'e') keyErrorCells.push('B43');
  const keyErrors = keyErrorCells.length;
  validations.push(validation('V7_ERRORES_EN_CELDAS_CLAVE', 'bloqueante', keyErrors === 0, 0, keyErrors, 'Errores de Excel en PYG NIIF o Resum.'));
  const currentYearBalances = parsedBalances.filter(item => item.year === period.year);
  const missingProvisions = currentYearBalances.filter(item => item.month <= period.month && numeric(cell(item.sheet, 'I', 1)) === null && numeric(cell(item.sheet, 'J', 1)) === null).map(item => item.sheetName);
  validations.push(validation('V9_PROVISION_DECLARADA', 'advertencia', missingProvisions.length === 0, 'todas las hojas del año', missingProvisions.join(', ') || 'todas', missingProvisions.length ? 'Hay meses sin provisión declarada en I1.' : 'Todos los meses tienen provisión declarada.'));
  const adjustedCells = currentYearBalances.reduce((sum, item) => sum + [...item.sheet.cells.values()].filter(cellItem => cellItem.row > 1 && cellItem.column >= 3 && cellItem.column <= 6 && cellItem.formula).length, 0);
  validations.push(validation('V10_AJUSTES_MANUALES', 'info', true, 'inventario', adjustedCells, 'Celdas con fórmulas dentro del balance; las que incluyen constantes quedan marcadas por línea para revisión.'));
  validations.push(validation('V15_UNIDAD_PESOS', 'bloqueante', numeric(cell(pygSheet, 'B', 5)) === 1, 1, cell(pygSheet, 'B', 5), 'PYG NIIF!B5 debe indicar pesos.'));
  validations.push(validation('V16_HOJAS_PRIVADAS_NO_LEIDAS', 'bloqueante', true, '0 hojas privadas leídas', 0, `${privateSheetCount} hojas privadas detectadas y excluidas antes de leer sus celdas.`));
  return validations;
}

function structureSummary(declarations, parsedBalances, reportSheets) {
  const selectedDimensions = new Map([
    ...parsedBalances.map(item => [item.sheetName, item.sheet.dimension]),
    ...reportSheets.map(sheet => [sheet.name, sheet.dimension]),
  ]);
  return {
    sheets: declarations.map(sheet => ({ name: sheet.name, state: sheet.state, dimension: selectedDimensions.get(sheet.name) ?? sheet.dimension })),
    balance_headers: parsedBalances.map(item => ({ sheet: item.sheetName, headers: item.headers })),
    report_labels: Object.fromEntries(reportSheets.map(sheet => [sheet.name, [...sheetRows(sheet).keys()].map(row => normalizeLabel(cell(sheet, sheet.name === 'Comparat' ? 'B' : sheet.name === 'PYG NIIF' ? 'C' : 'A', row))).filter(Boolean)])),
  };
}

export function parseSiioFinancialWorkbook(buffer, input = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new FinancialWorkbookError('empty_file', 'Debe cargar un archivo de Excel con contenido.');
  if (buffer.length > SIIO_FINANCIAL_IMPORT_MAX_BYTES) throw new FinancialWorkbookError('file_too_large', 'El archivo supera el límite de 10 MB.');
  const fileName = String(input.fileName || '').trim();
  if (!/\.xlsm$/i.test(fileName)) throw new FinancialWorkbookError('invalid_extension', 'El cargue contable acepta libros .xlsm.');
  const periodMatch = /^(20\d{2})-(0[1-9]|1[0-2])-01$/.exec(String(input.periodMonth || ''));
  if (!periodMatch) throw new FinancialWorkbookError('invalid_period', 'El periodo debe ser el primer día de un mes.');
  const cutoffDate = String(input.cutoffDate || '');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(cutoffDate) || Number.isNaN(Date.parse(`${cutoffDate}T00:00:00Z`))) throw new FinancialWorkbookError('invalid_cutoff', 'La fecha de corte no es válida.');
  const importType = String(input.importType || 'cierre_mensual');
  if (!['cierre_mensual', 'parcial_diario', 'reproceso'].includes(importType)) throw new FinancialWorkbookError('invalid_import_type', 'El tipo de corte no es válido.');
  const period = { year: Number(periodMatch[1]), month: Number(periodMatch[2]) };
  const zip = zipEntries(buffer);
  const declarations = workbookDeclarations(zip);
  const names = new Set(declarations.map(sheet => sheet.name));
  const unknownSheets = declarations.filter(sheet => !KNOWN_NON_MONTHLY_SHEETS.has(sheet.name) && !MONTHLY_SHEET_PATTERN.test(sheet.name)).map(sheet => sheet.name);
  if (unknownSheets.length) throw new FinancialWorkbookError('unknown_sheets', `El libro contiene ${unknownSheets.length} hoja(s) desconocida(s); Contabilidad debe revisar el cambio de estructura.`);
  for (const required of REQUIRED_SHEETS) if (!names.has(required)) throw new FinancialWorkbookError('missing_sheet', `Falta la hoja financiera obligatoria ${required}.`);
  const currentSuffix = String(period.year).slice(-2);
  const previousSuffix = String(period.year - 1).slice(-2);
  const selectedNames = new Set(REQUIRED_SHEETS);
  for (let month = 1; month <= period.month; month += 1) {
    selectedNames.add(`${month} ${currentSuffix}`);
    selectedNames.add(`${month} ${previousSuffix}`);
  }
  for (const required of selectedNames) if (!names.has(required)) throw new FinancialWorkbookError('missing_sheet', `Falta la hoja financiera obligatoria ${required}.`);
  const selected = declarations.filter(sheet => selectedNames.has(sheet.name));
  const sharedStrings = readSharedStrings(zip, requestedSharedStringIndexes(selected));
  const parsed = new Map(selected.map(sheet => [sheet.name, parseSheet(sheet, sharedStrings)]));
  const declared = reportedPeriod(parsed.get('PYG NIIF'));
  if (!declared || declared.year !== period.year || declared.month !== period.month) throw new FinancialWorkbookError('period_mismatch', 'El periodo indicado no coincide con el encabezado de PYG NIIF.');
  const parsedBalances = [];
  for (const sheet of selected.filter(item => MONTHLY_SHEET_PATTERN.test(item.name))) {
    const match = MONTHLY_SHEET_PATTERN.exec(sheet.name);
    const balancePeriod = { month: Number(match[1]), year: 2000 + Number(match[2]) };
    const parsedBalance = parseBalanceSheet(parsed.get(sheet.name), balancePeriod);
    parsedBalances.push({ ...parsedBalance, ...balancePeriod, sheetName: sheet.name, sheet: parsed.get(sheet.name) });
  }
  const metrics = parseReportedMetrics(parsed.get('Comparat')).map(item => ({ ...item, period_month: input.periodMonth, _sheet: parsed.get('Comparat') }));
  const validations = calculateValidations({ parsedBalances, metrics, pygSheet: parsed.get('PYG NIIF'), resumSheet: parsed.get('Resum'), period, privateSheetCount: declarations.filter(sheet => PRIVATE_SHEETS.has(sheet.name)).length });
  const structure = structureSummary(declarations, parsedBalances, [parsed.get('PYG NIIF'), parsed.get('Comparat'), parsed.get('Resum')]);
  const blockingFailures = validations.filter(item => item.severity === 'bloqueante' && !item.ok);
  const versionMatch = /(?:^|[_ -])V(\d+)(?:[_ .-]|$)/i.exec(fileName);
  return {
    parser_version: SIIO_FINANCIAL_IMPORT_PARSER_VERSION,
    file_name: fileName,
    file_sha256: createHash('sha256').update(buffer).digest('hex'),
    file_size_bytes: buffer.length,
    version_label: versionMatch ? `V${versionMatch[1]}` : null,
    period_month: input.periodMonth,
    cutoff_date: cutoffDate,
    import_type: importType,
    status: blockingFailures.length ? 'con_errores' : 'listo_revision',
    structure_signature: createHash('sha256').update(JSON.stringify(structure)).digest('hex'),
    structure,
    balance_lines: parsedBalances.flatMap(item => item.rows),
    metrics: metrics.map(({ _sheet, ...item }) => item),
    validations,
    summary: {
      balance_sheets: parsedBalances.length,
      balance_lines: parsedBalances.reduce((sum, item) => sum + item.rows.length, 0),
      metrics: metrics.length,
      blocking_failures: blockingFailures.length,
      warnings: validations.filter(item => item.severity === 'advertencia' && !item.ok).length,
      private_sheets_excluded: declarations.filter(sheet => PRIVATE_SHEETS.has(sheet.name)).length,
    },
  };
}

export function compareFinancialStructures(previous, current) {
  if (!previous) return { baseline: false, changed: false, changes: [] };
  const changes = [];
  const priorSheets = new Map((previous.sheets || []).map(item => [item.name, item]));
  const currentSheets = new Map((current.sheets || []).map(item => [item.name, item]));
  for (const name of currentSheets.keys()) if (!priorSheets.has(name)) changes.push({ type: 'sheet_added', sheet: name });
  for (const name of priorSheets.keys()) if (!currentSheets.has(name)) changes.push({ type: 'sheet_removed', sheet: name });
  for (const [name, item] of currentSheets) {
    const prior = priorSheets.get(name);
    if (prior && (prior.state !== item.state || prior.dimension !== item.dimension)) changes.push({ type: 'sheet_shape_changed', sheet: name, previous: { state: prior.state, dimension: prior.dimension }, current: { state: item.state, dimension: item.dimension } });
  }
  return { baseline: true, changed: changes.length > 0, changes };
}
