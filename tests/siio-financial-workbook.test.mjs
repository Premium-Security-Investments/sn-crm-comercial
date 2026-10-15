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

// Formato del balance desde agosto de 2026: un total suelto en la fila 1, encabezados en la fila 2 y
// sólo cuentas auxiliares de 8 dígitos, sin los totales por clase, grupo, cuenta y subcuenta.
function auxiliaryOnlyBalanceSheet() {
  const auxiliaries = [
    [11050500, 'CAJA GENERAL', 40, 30, 10, 60], [11100500, 'BANCOS', 0, 40, 0, 40],
    [21050500, 'PROVEEDORES', 0, 0, 60, -60], [31050500, 'CAPITAL', 0, 0, 30, -30],
    [41450500, 'SERVICIO DE VIGILANCIA', -40, 0, 10, -50], [72050500, 'MANO DE OBRA', 0, 40, 0, 40],
  ];
  return worksheet([
    number('F1', 0), number('I1', 125),
    inline('A2', 'Codigo Cuenta'), inline('B2', 'Nombre Cuenta'), inline('C2', '  Saldo Anterior'), inline('D2', '     Debito'), inline('E2', '    Credito'), inline('F2', '   Saldo Actual'),
    ...auxiliaries.map(([account, name, previous, debit, credit, final], index) => {
      const row = index + 3;
      return [number(`A${row}`, account), inline(`B${row}`, name), number(`C${row}`, previous), number(`D${row}`, debit), number(`E${row}`, credit), number(`F${row}`, final)].join('');
    }),
  ]);
}

function workbookBuffer({ unknownSheet = false, detailOnly = false, auxiliaryOnly = false, resumControlRow = null, overrides = {} } = {}) {
  const sheets = ['PYG NIIF', 'Comparat', 'Resum', '1 26', '2 26', '3 26', '4 26', '1 25', '2 25', '3 25', '4 25', 'NOMINA'];
  if (unknownSheet) sheets.push('Hoja inesperada');
  if (auxiliaryOnly) sheets.push('Ingresos');
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
    ['Resum', worksheet(resumControlRow
      ? [inline(`A${resumControlRow - 1}`, 'Utilidad neta'), number(`B${resumControlRow - 1}`, -15), number(`B${resumControlRow}`, 0), number('B43', 999)]
      : [number('B43', 0)])],
    ['1 26', balanceSheet(false)], ['2 26', balanceSheet()], ['3 26', balanceSheet()], ['4 26', auxiliaryOnly ? auxiliaryOnlyBalanceSheet() : balanceSheet(true, { detailOnly })],
    ['1 25', balanceSheet()], ['2 25', balanceSheet()], ['3 25', balanceSheet()], ['4 25', balanceSheet()],
    // XML deliberadamente inválido: demuestra que la hoja privada no se abre.
    ['NOMINA', '<contenido-privado-invalido'],
    ['Hoja inesperada', worksheet([])],
    ['Ingresos', worksheet([inline('A1', 'PERIODO DE FACTURACIÓN')])],
  ]);
  for (const [name, xml] of Object.entries(overrides)) content.set(name, xml);
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

test('lee el balance con sólo cuentas auxiliares y reconstruye los niveles de resumen', () => {
  const result = parseSiioFinancialWorkbook(workbookBuffer({ auxiliaryOnly: true }), metadata);
  assert.equal(result.status, 'listo_revision');
  const april = result.balance_lines.filter(line => line.source_sheet === '4 26');
  assert.equal(april.filter(line => line.level === 8).length, 6);
  const byAccount = new Map(april.map(line => [line.account, line]));
  // Nombres tomados de los meses que sí traen los totales.
  assert.equal(byAccount.get('1').account_name, 'Activo');
  assert.deepEqual(['1', '11', '1105', '110505', '1110', '111005'].map(account => byAccount.get(account)?.final_balance), [100, 100, 60, 60, 40, 40]);
  assert.equal(byAccount.get('41').final_balance, -50);
  assert.equal(byAccount.get('72').debits, 40);
  assert.equal(byAccount.get('1').source_row, 3);
  assert.match(byAccount.get('1').original_formula, /suma de 2 cuenta/);
  assert.equal(byAccount.get('11050500').original_formula, null);
  const check = result.validations.find(item => item.rule === 'V1_BALANCE_CUADRA' && item.detail.startsWith('4 26'));
  assert.equal(check.ok, true);
  assert.deepEqual(result.structure.balance_headers.find(item => item.sheet === '4 26').headers, {
    account: 'CODIGOCUENTA', name: 'NOMBRECUENTA', previous: 'SALDOANTERIOR', debit: 'DEBITO', credit: 'CREDITO', final: 'SALDOACTUAL',
  });
});

test('ubica el control de Resum debajo de la utilidad neta aunque cambie de fila', () => {
  const moved = parseSiioFinancialWorkbook(workbookBuffer({ resumControlRow: 41 }), metadata).validations.find(item => item.rule === 'V5_CONTROL_RESUM');
  assert.equal(moved.ok, true);
  assert.match(moved.detail, /Resum!B41/);
  const legacy = parseSiioFinancialWorkbook(workbookBuffer(), metadata).validations.find(item => item.rule === 'V5_CONTROL_RESUM');
  assert.match(legacy.detail, /Resum!B43/);
});

test('un mes anterior al corte que no cuadra se publica como advertencia; el mes del corte sigue bloqueando', () => {
  const unbalanced = worksheet([
    inline('A1', 'Codigo Cuenta'), inline('B1', 'Nombre Cuenta'), inline('C1', 'Saldo Anterior'), inline('D1', 'Debito'), inline('E1', 'Credito'), inline('F1', 'Saldo Actual'), number('I1', 125),
    number('A2', 1), inline('B2', 'Activo'), number('C2', 0), number('D2', 0), number('E2', 0), number('F2', 100),
    number('A3', 2), inline('B3', 'Pasivo'), number('C3', 0), number('D3', 0), number('E3', 0), number('F3', -60),
    number('A4', 3), inline('B4', 'Patrimonio'), number('C4', 0), number('D4', 0), number('E4', 0), number('F4', -30),
    number('A5', 4), inline('B5', 'Ingresos'), number('C5', 0), number('D5', 0), number('E5', 0), number('F5', -7),
  ]);
  const earlier = parseSiioFinancialWorkbook(workbookBuffer({ overrides: { '2 25': unbalanced } }), metadata);
  const warning = earlier.validations.find(item => item.rule === 'V1_BALANCE_CUADRA' && item.detail.startsWith('2 25'));
  assert.equal(warning.severity, 'advertencia');
  assert.equal(warning.ok, false);
  assert.equal(warning.obtained, '3');
  assert.equal(earlier.status, 'listo_revision');
  const cutMonth = parseSiioFinancialWorkbook(workbookBuffer({ overrides: { '4 26': unbalanced } }), metadata);
  assert.equal(cutMonth.validations.find(item => item.rule === 'V1_BALANCE_CUADRA' && item.detail.startsWith('4 26')).severity, 'bloqueante');
  assert.equal(cutMonth.status, 'con_errores');
});
