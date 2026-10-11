import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { cleanFinancialImportRequest } from '../siio-financial-import-service.js';
import { compareFinancialStructures, parseSiioFinancialWorkbook } from '../siio-financial-workbook.js';

const xmlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const inline = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
const number = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
const formula = (ref, expression, cached) => `<c r="${ref}"><f>${xmlEscape(expression)}</f><v>${cached}</v></c>`;
const worksheet = cells => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:J60"/><sheetData><row r="1">${cells.filter(item => /[A-Z]+1\b/.test(item)).join('')}</row>${cells.filter(item => !/[A-Z]+1\b/.test(item)).map(item => `<row>${item}</row>`).join('')}</sheetData></worksheet>`;

function balanceSheet(withProvision = true, { detailOnly = false } = {}) {
  const header = [
    inline('A1', 'Codigo Cuenta'), inline('B1', 'Nombre Cuenta'), inline('C1', 'Saldo Anterior'), inline('D1', 'Debito'), inline('E1', 'Credito'), inline('F1', 'Saldo Actual'),
    ...(withProvision ? [number('I1', 125)] : []),
  ];
  if (detailOnly) {
    // Sólo cuentas auxiliares descuadradas: sin totales de clase, la suma de primer nivel sería 0.
    return worksheet([...header,
      number('A2', 110505), inline('B2', 'Caja'), number('C2', 0), number('D2', 0), number('E2', 0), number('F2', 100),
      number('A3', 210505), inline('B3', 'Proveedores'), number('C3', 0), number('D3', 0), number('E3', 0), number('F3', 999999),
    ]);
  }
  return worksheet([...header,
    number('A2', 1), inline('B2', 'Activo'), number('C2', 0), formula('D2', '50+25', 75), number('E2', 0), number('F2', 100),
    number('A3', 2), inline('B3', 'Pasivo'), number('C3', 0), number('D3', 0), number('E3', 0), number('F3', -60),
    number('A4', 3), inline('B4', 'Patrimonio'), number('C4', 0), number('D4', 0), number('E4', 0), number('F4', -30),
    number('A5', 4), inline('B5', 'Ingresos'), number('C5', 0), number('D5', 0), number('E5', 0), number('F5', -10),
  ]);
}

function workbookBuffer({ unknownSheet = false, detailOnly = false } = {}) {
  const sheets = ['PYG NIIF', 'Comparat', 'Resum', '1 26', '2 26', '3 26', '4 26', '1 25', '2 25', '3 25', '4 25', 'NOMINA'];
  if (unknownSheet) sheets.push('Hoja inesperada');
  const zip = new AdmZip();
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((name, index) => `<sheet name="${name}" sheetId="${index + 1}"${name === 'NOMINA' ? ' state="hidden"' : ''} r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;
  const relationships = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`;
  zip.addFile('xl/workbook.xml', Buffer.from(workbook));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(relationships));
  const concepts = [
    ['INGRESOS', 100, 80], ['VIGILANCIA', 70, 55], ['MONITOREO', 20, 15], ['COMERCIALIZACION', 10, 10],
    ['COSTOS', 60, 50], ['GASTOS', 20, 15], ['UTILIDAD OPERACIONAL', 20, 15], ['MARGEN OPERACIONAL', 0.2, 0.1875],
    ['NO OPERACIONAL', 0, 0], ['IMPUESTOS', 5, 4], ['UTILIDAD NETA', 15, 11], ['MARGEN NETO', 0.15, 0.1375],
  ];
  const comparatCells = concepts.flatMap(([label, current, prior], index) => {
    const row = index + 2;
    return [inline(`B${row}`, label), number(`C${row}`, current), number(`F${row}`, prior), number(`I${row}`, current - prior), number(`J${row}`, prior ? current / prior - 1 : 0)];
  });
  const content = new Map([
    ['PYG NIIF', worksheet([inline('C4', 'A: 30 DE ABRIL DE 2026 COMPARADO CON 30 DE ABRIL DE 2025'), number('B5', 1), inline('C15', 'TOTAL INGRESOS'), number('G15', 100), number('L15', 80), inline('C53', 'UTILIDAD DEL EJERCICIO'), number('G53', 15), number('L53', 11)])],
    ['Comparat', worksheet(comparatCells)],
    ['Resum', worksheet([number('B43', 0)])],
    ['1 26', balanceSheet(false)], ['2 26', balanceSheet()], ['3 26', balanceSheet()], ['4 26', balanceSheet(true, { detailOnly })],
    ['1 25', balanceSheet()], ['2 25', balanceSheet()], ['3 25', balanceSheet()], ['4 25', balanceSheet()],
    // XML deliberadamente inválido: demuestra que la hoja privada no se abre.
    ['NOMINA', '<contenido-privado-invalido'],
    ['Hoja inesperada', worksheet([])],
  ]);
  sheets.forEach((name, index) => zip.addFile(`xl/worksheets/sheet${index + 1}.xml`, Buffer.from(content.get(name))));
  return zip.toBuffer();
}

const metadata = { fileName: 'PYG_ABRIL_2026_V6.xlsm', periodMonth: '2026-04-01', cutoffDate: '2026-04-30', importType: 'cierre_mensual' };

test('extrae un corte contable inmutable sin abrir la hoja privada', () => {
  const result = parseSiioFinancialWorkbook(workbookBuffer(), metadata);
  assert.equal(result.status, 'listo_revision');
  assert.equal(result.metrics.length, 9);
  assert.equal(result.balance_lines.length, 32);
  assert.equal(result.summary.private_sheets_excluded, 1);
  assert.equal(result.summary.blocking_failures, 0);
  assert.equal(result.validations.find(item => item.rule === 'V9_PROVISION_DECLARADA').ok, false);
  assert.equal(result.validations.find(item => item.rule === 'V10_AJUSTES_MANUALES').obtained, '4');
});

test('detiene una estructura con hojas desconocidas', () => {
  assert.throws(() => parseSiioFinancialWorkbook(workbookBuffer({ unknownSheet: true }), metadata), error => error.code === 'unknown_sheets');
});

test('valida metadatos del cierre antes de emitir una URL de carga', () => {
  const clean = cleanFinancialImportRequest({ name: 'PYG_ABRIL_2026_V6.xlsm', size: 1234, period_month: '2026-04-01', cutoff_date: '2026-04-30', import_type: 'cierre_mensual', mime_type: '' });
  assert.equal(clean.periodMonth, '2026-04-01');
  assert.throws(() => cleanFinancialImportRequest({ name: 'PYG.xlsx', size: 1234, period_month: '2026-04-01', cutoff_date: '2026-04-30' }), /\.xlsm/);
  assert.throws(() => cleanFinancialImportRequest({ name: 'PYG.xlsm', size: 1234, period_month: '2026-04-01', cutoff_date: '2026-04-29' }), /último día/);
});

test('bloquea un balance sin cuentas de primer nivel en lugar de darlo por cuadrado', () => {
  const result = parseSiioFinancialWorkbook(workbookBuffer({ detailOnly: true }), metadata);
  const check = result.validations.find(item => item.rule === 'V1_BALANCE_CUADRA' && item.detail.startsWith('4 26'));
  assert.equal(check.ok, false);
  assert.match(check.obtained, /faltan clases 1, 2, 3, 4/);
  assert.equal(result.status, 'con_errores');
});

test('no avisa cambio de estructura por el crecimiento normal de las hojas mensuales', () => {
  const base = parseSiioFinancialWorkbook(workbookBuffer(), metadata).structure;
  const nextMonth = structuredClone(base);
  for (const sheet of nextMonth.sheets) if (/^\d{1,2} \d{2}$/.test(sheet.name)) Object.assign(sheet, { state: 'visible', dimension: 'A1:Q1600' });
  assert.equal(compareFinancialStructures(base, nextMonth).changed, false);
  const relabeled = structuredClone(base);
  relabeled.report_labels.Comparat = relabeled.report_labels.Comparat.map(label => label === 'GASTOS' ? 'GASTOS ADMINISTRATIVOS' : label);
  const diff = compareFinancialStructures(base, relabeled);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.changes, [{ type: 'report_labels_changed', sheet: 'Comparat', added: ['GASTOS ADMINISTRATIVOS'], removed: ['GASTOS'] }]);
});
