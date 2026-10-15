import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { buildFinancialPulse, loadFinancialPulse } from '../siio-financial-pulse.js';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key';
process.env.VERCEL = '1';

async function loadModule(relativePath) {
  const result = await build({ entryPoints: [new URL(relativePath, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

// Saldos acumulados por mes, como los entrega el balance: ingresos en crédito (negativos).
function line(year, month, account, previous, final) {
  return { year, month, account, level: 2, previous_balance: previous, final_balance: final };
}
const lines = [
  line(2026, 1, '41', 0, -100), line(2026, 2, '41', -100, -250), line(2026, 3, '41', -250, -400),
  line(2026, 1, '72', 0, 90), line(2026, 2, '72', 90, 180), line(2026, 3, '72', 180, 270),
  line(2026, 1, '51', 0, 20), line(2026, 2, '51', 20, 40), line(2026, 3, '51', 40, 60),
  line(2026, 1, '53', 0, 5), line(2026, 2, '53', 5, 9), line(2026, 3, '53', 9, 30),
  line(2026, 3, '74', 0, 7),
  line(2025, 3, '41', -160, -240), line(2025, 3, '72', 120, 180), line(2025, 3, '51', 30, 45),
  line(2026, 3, '4155', -250, -400),
  { ...line(2026, 3, '41', 0, -999), level: 1 },
  line(2024, 3, '41', 0, -1),
  line(2026, 4, '41', -400, -600),
];

test('convierte saldos acumulados en movimiento mensual con ingresos positivos', () => {
  const pulse = buildFinancialPulse(lines, { periodMonth: '2026-03-01' });
  const march = pulse.months.find(item => item.year === 2026 && item.month === 3);
  assert.equal(march.values.ingresos, 150);
  assert.equal(march.values.mano_obra, 90);
  assert.equal(march.values.otros_costos, 7, 'una cuenta de costo sin clasificar igual suma al total');
  assert.equal(march.totals.costos, 97);
  assert.equal(march.totals.gastos_operacionales, 20);
  assert.equal(march.totals.utilidad_operacional, 33);
  assert.equal(march.totals.resultado_no_operacional, -21);
  assert.deepEqual(pulse.months.map(item => `${item.year}-${item.month}`), ['2025-3', '2026-1', '2026-2', '2026-3'], 'ignora otros niveles, otros años y meses posteriores al corte');
  assert.ok(pulse.groups.some(group => group.key === 'otros_costos'));
});

test('rechaza periodos mal formados', () => {
  assert.throws(() => buildFinancialPulse([], { periodMonth: '2026-3' }), error => error.status === 400);
});

test('la lectura del mes cita cifras y detecta el salto de ingresos', async () => {
  const { pulseReadings, pulseBreakdown } = await loadModule('../src/siio/financialPulse.ts');
  const pulse = buildFinancialPulse(lines, { periodMonth: '2026-03-01' });
  const readings = pulseReadings(pulse);
  assert.ok(readings.some(text => /ingresos de marzo de 2026/.test(text) && /87,5%/.test(text)), readings.join('\n'));
  assert.ok(readings.some(text => /En febrero los ingresos subieron/.test(text)), readings.join('\n'));
  assert.ok(readings.some(text => /gastos no operacionales de marzo/.test(text)), readings.join('\n'));
  const breakdown = pulseBreakdown(pulse);
  assert.equal(breakdown.find(row => row.key === 'mano_obra').change, 30);
  assert.equal(breakdown.find(row => row.key === 'mano_obra').yearToDate, 270);
});

function fakeDatabase(imports, balanceLines) {
  const calls = [];
  const builder = (table) => {
    const state = { table, filters: [] };
    const chain = {
      select: () => chain,
      or: value => { state.filters.push(['or', value]); return chain; },
      eq: (column, value) => { state.filters.push(['eq', column, value]); return chain; },
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve) => {
        calls.push(state);
        if (table === 'siio_financial_validations') {
          const rule = state.filters.find(item => item[1] === 'rule')?.[2];
          if (rule === 'V1_BALANCE_CUADRA') return resolve({ data: [{ ok: false, obtained: '-1032138.04', detail: '2 26: suma de clases 1 a 7. Mes anterior al corte con diferencia; se publica marcado para revisión de Contabilidad.' }], error: null });
          return resolve({ data: [{ ok: false, obtained: '1 26' }], error: null });
        }
        if (table === 'siio_financial_imports') {
          const period = state.filters.find(item => item[1] === 'period_month')?.[2];
          return resolve({ data: imports.filter(item => !period || item.period_month === period), error: null });
        }
        return resolve({ data: balanceLines, error: null });
      },
    };
    return chain;
  };
  return { from: builder, calls };
}

test('usa el corte publicado más reciente y no lee nada si no hay', async () => {
  const imports = [
    { id: 'b', file_name: 'diario.xlsm', period_month: '2026-03-01', cutoff_date: '2026-03-20', import_type: 'parcial_diario', status: 'validado', uploaded_at: '2026-03-21' },
    { id: 'a', file_name: 'marzo.xlsm', period_month: '2026-03-01', cutoff_date: '2026-03-31', import_type: 'cierre_mensual', status: 'publicado', uploaded_at: '2026-04-05' },
  ];
  const database = fakeDatabase(imports, lines);
  const pulse = await loadFinancialPulse(database, null);
  assert.equal(pulse.source.import_id, 'a');
  assert.equal(pulse.source.basis, 'balance_de_cuentas');
  assert.equal(pulse.months.find(item => item.year === 2026 && item.month === 1).provision_declared, false, 'lee la advertencia V9 del mismo corte');
  assert.equal(pulse.months.find(item => item.year === 2026 && item.month === 2).balance_difference, -1032138.04, 'marca el mes anterior que no cuadra (advertencia V1)');
  assert.equal(pulse.months.find(item => item.year === 2026 && item.month === 3).balance_difference, null);
  assert.ok(database.calls.some(call => call.table === 'siio_financial_validations' && call.filters.some(item => item[1] === 'severity' && item[2] === 'advertencia')), 'sólo lee las diferencias publicadas como advertencia');
  assert.equal(database.calls.find(call => call.table === 'siio_financial_balance_lines').filters.find(item => item[1] === 'import_id')[2], 'a');
  assert.equal(await loadFinancialPulse(fakeDatabase([], []), null), null);
  await assert.rejects(() => loadFinancialPulse(database, '2026-03'), error => error.status === 400);
});

test('el pulso tiene los mismos permisos de lectura que el historial financiero', async () => {
  const { requireSiioEndpointAccess } = await import('../server/index.js');
  const profile = role => ({ id: `${role}-profile`, role, active: true, identity_type: 'human', areas: [], permissions: ['modulo_siio_gerencial'] });
  for (const role of ['admin', 'gerencia', 'consulta']) assert.equal(requireSiioEndpointAccess(profile(role), 'GET /api/siio/financial-pulse'), true);
  assert.throws(() => requireSiioEndpointAccess(profile('junta'), 'GET /api/siio/financial-pulse'), error => error?.status === 403);
});

test('mide cada mes contra el cierre anterior aunque la hoja abra sin la provisión', async () => {
  const { pulseReadings } = await loadModule('../src/siio/financialPulse.ts');
  // Febrero cierra con 40 de provisión; marzo abre sin ella (previous -210 en vez de -250).
  const provisionLines = [
    line(2026, 1, '41', 0, -100), line(2026, 2, '41', -100, -250), line(2026, 3, '41', -210, -380),
    line(2026, 1, '72', 0, 150), line(2026, 2, '72', 150, 230), line(2026, 3, '72', 230, 320),
  ];
  const pulse = buildFinancialPulse(provisionLines, { periodMonth: '2026-03-01', monthsWithoutProvision: [{ year: 2026, month: 1 }] });
  const march = pulse.months.find(item => item.month === 3);
  assert.equal(march.values.ingresos, 130, 'cierre de marzo menos cierre de febrero');
  assert.equal(march.carried_from_previous_month.ingresos, 40);
  const ytd = pulse.months.reduce((total, item) => total + item.values.ingresos, 0);
  assert.equal(ytd, 380, 'la suma de los meses coincide con el acumulado del último cierre');
  assert.equal(pulse.months.find(item => item.month === 1).provision_declared, false);
  const readings = pulseReadings(pulse);
  assert.ok(readings.some(text => /^Enero no tiene provisión de ingresos declarada/.test(text)), readings.join('\n'));
  assert.ok(!readings.some(text => /los ingresos (subieron|bajaron)/.test(text)), 'no presenta como cambio de negocio un salto causado por la falta de provisión, ni la caída del mes siguiente');
  assert.ok(readings.some(text => /pérdida operativa.*falta de provisión/.test(text)), readings.join('\n'));
});

test('la vista muestra pérdidas con el signo antes del peso', async () => {
  const { readFileSync } = await import('node:fs');
  const view = readFileSync(new URL('../src/siio/SiioFinancialPulse.tsx', import.meta.url), 'utf8');
  assert.match(view, /rounded < 0 \? '−' : ''\}\$\$\{Math\.abs\(rounded\)/);
  assert.match(view, /corte \{cutoffLabel\(pulse\.source\.cutoff_date\)\}/);
});
