import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { build } from 'esbuild';
import { parseSiioFinancialWorkbook } from '../verticales/gerencial/siio-financial-workbook.js';

async function loadModule(relativePath) {
  const result = await build({ entryPoints: [new URL(relativePath, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { deriveRevenueByClient } = await loadModule('../src/siio/revenueByClient.ts');

const xmlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const inline = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
const number = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
const formula = (ref, expression, cached) => `<c r="${ref}"><f>${xmlEscape(expression)}</f><v>${cached}</v></c>`;
const worksheet = cells => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:J60"/><sheetData><row r="1">${cells.filter(item => /[A-Z]+1\b/.test(item)).join('')}</row>${cells.filter(item => !/[A-Z]+1\b/.test(item)).map(item => `<row>${item}</row>`).join('')}</sheetData></worksheet>`;

const balanceSheet = (provision = null) => worksheet([
  inline('A1', 'Codigo Cuenta'), inline('B1', 'Nombre Cuenta'), inline('C1', 'Saldo Anterior'), inline('D1', 'Debito'), inline('E1', 'Credito'), inline('F1', 'Saldo Actual'),
  ...(provision === null ? [] : [number('I1', provision)]),
  number('A2', 1), inline('B2', 'Activo'), number('C2', 0), number('D2', 0), number('E2', 0), number('F2', 100),
  number('A3', 2), inline('B3', 'Pasivo'), number('C3', 0), number('D3', 0), number('E3', 0), number('F3', -60),
  number('A4', 3), inline('B4', 'Patrimonio'), number('C4', 0), number('D4', 0), number('E4', 0), number('F4', -30),
  number('A5', 4), inline('B5', 'Ingresos'), number('C5', 0), number('D5', 0), number('E5', 0), number('F5', -10),
]);

// Misma forma que la hoja real de agosto de 2026: título, encabezado, servicios del mes,
// TOTAL SERVICIOS, ajustes de meses anteriores, total general que resta una fila y, debajo,
// el bloque del año anterior con su propio encabezado.
function revenueSheet({ totalExpression = '+C8+C11-C7', services = null } = {}) {
  const rows = services || [
    ['AGOSTO', 'EMPRESA PARA LA SEGURIDAD Y SOLUCIONES URBANAS - ESU', 600],
    ['AGOSTO', 'HOSPITAL SAN JORGE', 300],
    ['AGOSTO', 'EDIFICIO TERMINAL DE BUSES Y TAXIS MARIANO OSPINA PEREZ PH', 50],
  ];
  const cells = [
    inline('A3', 'PERIODO DE FACTURACIÓN 1 A 30 DE ABRIL  2026'),
    inline('A4', 'MES PRESTACIÓN DEL SERVICIO'), inline('B4', 'TERCERO'), inline('C4', 'VR ANTES DE IVA'),
  ];
  rows.forEach(([month, label, amount], index) => {
    const row = index + 5;
    cells.push(inline(`A${row}`, month), inline(`B${row}`, label), number(`C${row}`, amount));
  });
  const totalRow = rows.length + 5;
  cells.push(inline(`B${totalRow}`, 'TOTAL SERVICIOS'), number(`C${totalRow}`, rows.reduce((sum, item) => sum + item[2], 0)));
  cells.push(inline('B11', 'INGENIO MARZO'), number('C11', 75));
  cells.push(formula('C13', totalExpression, 975));
  // Bloque comparativo del año anterior: no debe entrar en las líneas del mes.
  cells.push(inline('A16', 'PERIODO DE FACTURACIÓN 1 A 30 DE ABRIL 2025'));
  cells.push(inline('A17', 'MES PRESTACIÓN DEL SERVICIO'), inline('B17', 'TERCERO'), inline('C17', 'VR ANTES DE IVA'));
  cells.push(inline('A18', 'ABRIL'), inline('B18', 'HOSPITAL SAN JORGE'), number('C18', 200));
  return worksheet(cells);
}

function workbookBuffer({ withRevenue = true, provision = 975, totalExpression } = {}) {
  const sheets = ['PYG NIIF', 'Comparat', 'Resum', '1 26', '2 26', '3 26', '4 26', '1 25', '2 25', '3 25', '4 25'];
  if (withRevenue) sheets.push('Ingresos');
  const zip = new AdmZip();
  zip.addFile('xl/workbook.xml', Buffer.from(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((name, index) => `<sheet name="${name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`));
  const concepts = [
    ['INGRESOS', 100, 80], ['VIGILANCIA', 70, 55], ['MONITOREO', 20, 15], ['COMERCIALIZACION', 10, 10],
    ['COSTOS', 60, 50], ['GASTOS', 20, 15], ['UTILIDAD OPERACIONAL', 20, 15], ['MARGEN OPERACIONAL', 0.2, 0.1875],
    ['NO OPERACIONAL', 0, 0], ['IMPUESTOS', 5, 4], ['UTILIDAD NETA', 15, 11], ['MARGEN NETO', 0.15, 0.1375],
  ];
  const comparat = concepts.flatMap(([label, current, prior], index) => {
    const row = index + 2;
    return [inline(`B${row}`, label), number(`C${row}`, current), number(`F${row}`, prior), number(`I${row}`, current - prior), number(`J${row}`, prior ? current / prior - 1 : 0)];
  });
  const content = new Map([
    ['PYG NIIF', worksheet([inline('C4', 'A: 30 DE ABRIL DE 2026 COMPARADO CON 30 DE ABRIL DE 2025'), number('B5', 1), inline('C15', 'TOTAL INGRESOS'), number('G15', 100), number('L15', 80), inline('C53', 'UTILIDAD DEL EJERCICIO'), number('G53', 15), number('L53', 11)])],
    ['Comparat', worksheet(comparat)],
    ['Resum', worksheet([number('B43', 0)])],
    ['1 26', balanceSheet(1)], ['2 26', balanceSheet(1)], ['3 26', balanceSheet(1)], ['4 26', balanceSheet(provision)],
    ['1 25', balanceSheet(1)], ['2 25', balanceSheet(1)], ['3 25', balanceSheet(1)], ['4 25', balanceSheet(1)],
    ['Ingresos', revenueSheet({ totalExpression })],
  ]);
  sheets.forEach((name, index) => zip.addFile(`xl/worksheets/sheet${index + 1}.xml`, Buffer.from(content.get(name))));
  return zip.toBuffer();
}

const metadata = { fileName: 'PYG_ABRIL_2026_V6.xlsm', periodMonth: '2026-04-01', cutoffDate: '2026-04-30', importType: 'cierre_mensual' };

test('lee la provisión de ingresos por tercero y separa los ajustes de meses anteriores', () => {
  const result = parseSiioFinancialWorkbook(workbookBuffer(), metadata);
  assert.equal(result.summary.revenue_lines, 4);
  const services = result.revenue_lines.filter(line => line.line_type === 'servicio');
  const adjustments = result.revenue_lines.filter(line => line.line_type === 'ajuste');
  assert.equal(services.length, 3);
  assert.deepEqual(adjustments.map(line => [line.client_label, line.amount]), [['INGENIO MARZO', 75]]);
  assert.equal(services[0].service_month, 'AGOSTO');
  assert.equal(result.revenue_lines.every(line => line.period_month === '2026-04-01'), true);
  assert.equal(result.revenue_provision.declared_total, 975);
  assert.equal(result.revenue_provision.computed_total, 975);
  // El rótulo del archivo trae espacios dobles; la Torre los normaliza.
  assert.equal(result.revenue_provision.period_label, 'PERIODO DE FACTURACIÓN 1 A 30 DE ABRIL 2026');
});

test('marca la fila que el propio archivo deja fuera de su total', () => {
  const result = parseSiioFinancialWorkbook(workbookBuffer(), metadata);
  const excluded = result.revenue_lines.filter(line => line.excluded_from_total);
  assert.deepEqual(excluded.map(line => line.amount), [50]);
  assert.match(excluded[0].client_label, /MARIANO OSPINA/);
});

test('no toma las filas del bloque comparativo del año anterior', () => {
  const result = parseSiioFinancialWorkbook(workbookBuffer(), metadata);
  assert.equal(result.revenue_lines.filter(line => line.amount === 200).length, 0);
});

test('avisa cuando el total de la hoja no coincide con la provisión declarada del mes', () => {
  const ok = parseSiioFinancialWorkbook(workbookBuffer(), metadata).validations.find(item => item.rule === 'V17_PROVISION_POR_TERCERO');
  assert.equal(ok.ok, true);
  assert.equal(ok.severity, 'advertencia');
  assert.match(ok.detail, /resta 1 fila/);
  // La tolerancia de la regla es de mil pesos: la diferencia tiene que superarla.
  const off = parseSiioFinancialWorkbook(workbookBuffer({ provision: 5000 }), metadata).validations.find(item => item.rule === 'V17_PROVISION_POR_TERCERO');
  assert.equal(off.ok, false);
  assert.equal(off.expected, '5000');
  assert.equal(off.obtained, '975');
  // Una advertencia no bloquea la publicación del cierre.
  assert.equal(parseSiioFinancialWorkbook(workbookBuffer({ provision: 5000 }), metadata).status, 'listo_revision');
});

test('un libro sin la hoja Ingresos se sigue leyendo igual', () => {
  const result = parseSiioFinancialWorkbook(workbookBuffer({ withRevenue: false }), metadata);
  assert.equal(result.summary.revenue_lines, 0);
  assert.deepEqual(result.revenue_lines, []);
  assert.equal(result.revenue_provision, null);
  assert.equal(result.validations.some(item => item.rule === 'V17_PROVISION_POR_TERCERO'), false);
  assert.equal(result.status, 'listo_revision');
});

const line = (client_label, amount, overrides = {}) => ({
  period_month: '2026-08-01', line_type: 'servicio', client_label, amount,
  service_month: 'AGOSTO', excluded_from_total: false, source_sheet: 'Ingresos', source_row: 5, ...overrides,
});

test('la Torre ordena por valor, calcula participación y deja la fila excluida sin sumar', () => {
  const summary = deriveRevenueByClient([
    line('HOSPITAL SAN JORGE', 300),
    line('ESU', 600),
    line('MARIANO OSPINA', 50, { excluded_from_total: true }),
    line('INGENIO MARZO', 100, { line_type: 'ajuste', service_month: null }),
  ], '2026-08-01');
  assert.equal(summary.period, '2026-08-01');
  assert.deepEqual(summary.services.map(row => row.label), ['ESU', 'HOSPITAL SAN JORGE', 'MARIANO OSPINA']);
  assert.equal(summary.total, 1000);
  assert.equal(summary.servicesTotal, 900);
  assert.equal(summary.adjustmentsTotal, 100);
  assert.equal(summary.excludedTotal, 50);
  assert.equal(summary.services[0].share, 0.6);
  assert.equal(summary.services[2].share, null);
  assert.match(summary.readings[0], /ESU concentra el 60 %/);
  assert.equal(summary.readings.some(text => /MARIANO OSPINA .*fuera del total/.test(text)), true);
});

test('la Torre usa el último mes disponible cuando el periodo pedido no tiene líneas', () => {
  const rows = [line('ESU', 600), line('HOSPITAL SAN JORGE', 300, { period_month: '2026-09-01' })];
  assert.equal(deriveRevenueByClient(rows, '2026-07-01').period, '2026-09-01');
  assert.equal(deriveRevenueByClient(rows, '2026-08-01').period, '2026-08-01');
  assert.equal(deriveRevenueByClient([], '2026-08-01'), null);
});
