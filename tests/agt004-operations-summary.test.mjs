import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function loadModule(relativePath) {
  const result = await build({ entryPoints: [new URL(relativePath, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { deriveOperationsSummary } = await loadModule('../src/siio/operationsSummary.ts');

const EXTRACTED = '2026-10-14T02:28:01+00:00'; // 13-oct 21:28 Bogotá → aprovisionamientos hasta el 12
const LABELS = { ara: 'ARA (Jerónimo Martins)', cide: 'CIDE', otros: 'Otros clientes', total: 'Total' };
const row = (period_month, client_key, regional, metric, value) => ({ period_month, client_key, client_label: LABELS[client_key], regional, metric, value, extracted_at: EXTRACTED });

// Cada fila por regional va también al total, como las escribe el extractor.
function withTotals(rows) {
  const out = [...rows];
  const sums = new Map();
  for (const r of rows) {
    for (const key of [`${r.period_month}|total|${r.regional}|${r.metric}`]) sums.set(key, (sums.get(key) || 0) + r.value);
  }
  for (const [key, value] of sums) {
    const [period, client, regional, metric] = key.split('|');
    out.push(row(period, client, regional, metric, value));
  }
  return out;
}

const OCT = '2026-10-01';
const SEP = '2026-09-01';
const fixture = withTotals([
  row(OCT, 'ara', 'BOGOTA', 'puestos_activos', 176),
  row(OCT, 'ara', 'BOGOTA', 'puestos_visitados', 129),
  row(OCT, 'ara', 'BOGOTA', 'visitas_supervisor', 321),
  row(OCT, 'ara', 'BOGOTA', 'aprovisionamientos_programados', 563),
  row(OCT, 'ara', 'BOGOTA', 'aprovisionamientos_cumplidos', 538),
  row(SEP, 'ara', 'BOGOTA', 'aprovisionamientos_programados', 1459),
  row(SEP, 'ara', 'BOGOTA', 'aprovisionamientos_cumplidos', 1351),
  row(SEP, 'ara', 'BOGOTA', 'visitas_supervisor', 805),
  row(OCT, 'ara', 'VALLE', 'puestos_activos', 178),
  row(OCT, 'otros', 'PEREIRA', 'puestos_activos', 200),
  row(OCT, 'otros', 'PEREIRA', 'visitas_tecnico', 6),
  row(OCT, 'cide', 'BOGOTA', 'puestos_activos', 3),
  row(OCT, 'cide', 'BOGOTA', 'visitas_supervisor', 17),
  row(OCT, 'otros', 'BOGOTA', 'puestos_activos', 20),
  row(OCT, 'otros', 'BOGOTA', 'tickets_abiertos', 3),
  row(OCT, 'otros', 'BOGOTA', 'tickets_vencidos_5d', 3),
]).concat([
  // Las filas TODAS y sin_identificar existen pero no deben sumarse dos veces.
  row(OCT, 'ara', 'TODAS', 'puestos_activos', 354),
  { ...row(OCT, 'total', 'TODAS', 'visitas_supervisor', 999) },
  { period_month: OCT, client_key: 'sin_identificar', client_label: 'Sin puesto identificado', regional: 'SIN REGIONAL', metric: 'novedades', value: 5, extracted_at: EXTRACTED },
]);

test('sin filas no hay resumen: la Torre muestra el bloque como pendiente', () => {
  assert.equal(deriveOperationsSummary([]), null);
});

test('una regional solo cuenta como en uso si registra control operativo', () => {
  const summary = deriveOperationsSummary(fixture);
  const status = Object.fromEntries(summary.regionals.map(r => [r.regional, r.status]));
  assert.deepEqual(status, { BOGOTA: 'en_uso', PEREIRA: 'parcial', VALLE: 'en_implementacion' });
  assert.deepEqual(summary.coveredRegionals, ['BOGOTA']);
});

test('las cifras por cliente salen solo de las regionales en uso', () => {
  const summary = deriveOperationsSummary(fixture);
  const ara = summary.clients.find(c => c.key === 'ara');
  assert.equal(ara.current.puestos, 176);
  assert.equal(ara.puestosSinCobertura, 178);
  assert.equal(ara.previous.aprovCumplidos, 1351);
  assert.equal(summary.totals.current.visitasSupervisor, 338);
  assert.equal(summary.totals.puestosSinCobertura, 378);
  assert.deepEqual(summary.clients.map(c => c.key), ['ara', 'cide', 'otros']);
});

test('las lecturas dicen cifra, base y corte, sin porcentajes de regionales sin uso', () => {
  const summary = deriveOperationsSummary(fixture);
  assert.equal(summary.provisionsUntil, '2026-10-12');
  assert.deepEqual(summary.readings, [
    'ARA en Bogotá: aprovisionamiento nocturno 96 % cumplido en octubre (538 de 563, hasta el 12 de octubre); en septiembre fue 93 %.',
    'Tiendas ARA en Bogotá con visita de supervisor en octubre: 129 de 176.',
    '3 tickets técnicos llevan más de 5 días sin respuesta.',
    'SecurityOps se usa hoy en Bogotá; 378 puestos en 2 regionales siguen en implementación, sin cifras de cumplimiento.',
  ]);
});
