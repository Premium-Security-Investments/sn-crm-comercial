import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { filterRadarRowsByCanonicalPreanalysis } from '../agt002-radar-visibility.js';
import {
  AGT002_RADAR_GATE_CONTEXT_VERSION,
  AGT002_RADAR_GATE_POLICY_VERSION,
  computeAgt002RadarSourceRowHash,
  evaluateAgt002RadarGate,
} from '../agt002-radar-gate.js';

const NOW = '2026-08-25T15:00:00.000Z';
const nueva = { id: 't1', stable_key: 'k1', status: 'abierto' };
const convertida = { id: 't2', stable_key: 'k2', status: 'cerrado' };
const preanalizada = { id: 't3', stable_key: 'k3', status: 'abierto' };
const stale = { id: 't4', stable_key: 'k4', status: 'actualizado' };
const rows = [nueva, convertida, preanalizada, stale];
const alwaysVisibleTenderIds = new Set(['t2']);
const HASH = row => `hash:${row.stable_key}:${row.status}`;
const policyVersion = 'policy-v1';
const contextVersion = 'context-v1';
// Estas filas sinteticas no traen fecha de cierre; el eje bajo prueba aqui es la frescura canonica,
// asi que el gate se inyecta como superviviente y se ejercita por separado mas abajo.
const survivorGate = () => ({ verdict: 'sobreviviente' });
const canonicalByTenderId = new Map([
  ['t1', { visibility_verdict: 'no_concluyente', source_row_hash: HASH(nueva), policy_version: policyVersion, context_version: contextVersion }],
  ['t3', { visibility_verdict: 'mostrar_en_radar', source_row_hash: HASH(preanalizada), policy_version: policyVersion, context_version: contextVersion }],
  ['t4', { visibility_verdict: 'mostrar_en_radar', source_row_hash: 'hash:anterior', policy_version: policyVersion, context_version: contextVersion }],
]);
const options = { canonicalByTenderId, alwaysVisibleTenderIds, computeSourceRowHash: HASH, policyVersion, contextVersion, nowIso: NOW, evaluateGate: survivorGate };

assert.equal(filterRadarRowsByCanonicalPreanalysis(rows, { ...options, enabled: false }), rows);
assert.equal(filterRadarRowsByCanonicalPreanalysis(rows, { canonicalByTenderId: new Map(), alwaysVisibleTenderIds: new Set(), enabled: false }), rows);
assert.deepEqual(filterRadarRowsByCanonicalPreanalysis(rows, { ...options, enabled: true }).map(row => row.id), ['t2', 't3']);
assert.deepEqual(filterRadarRowsByCanonicalPreanalysis(rows, { ...options, canonicalByTenderId: new Map(), enabled: true }).map(row => row.id), ['t2']);
for (const override of [
  { source_row_hash: 'stale' },
  { policy_version: 'policy-v0' },
  { context_version: 'context-v0' },
]) {
  const staleMap = new Map([['t3', { ...canonicalByTenderId.get('t3'), ...override }]]);
  assert.deepEqual(filterRadarRowsByCanonicalPreanalysis([preanalizada], { ...options, canonicalByTenderId: staleMap, alwaysVisibleTenderIds: new Set(), enabled: true }), []);
}
assert.equal(filterRadarRowsByCanonicalPreanalysis(rows, { ...options, enabled: true })[1], preanalizada);

// La reingesta cambia `last_seen_at` pero no la fila fuente: el hash canonico sigue coincidiendo.
const firstIngest = { id: 't5', stable_key: 'k5', status: 'abierto', deadline_at: '2026-09-01T12:00:00Z', raw: { ref: 'x' }, last_seen_at: '2026-08-25T00:00:00Z' };
const secondIngest = { ...firstIngest, last_seen_at: '2026-08-26T00:00:00Z' };
assert.equal(computeAgt002RadarSourceRowHash(firstIngest), computeAgt002RadarSourceRowHash(secondIngest));
const ingestedCanonical = new Map([['t5', { visibility_verdict: 'mostrar_en_radar', source_row_hash: computeAgt002RadarSourceRowHash(firstIngest), policy_version: policyVersion, context_version: contextVersion }]]);
assert.deepEqual(filterRadarRowsByCanonicalPreanalysis([secondIngest], { canonicalByTenderId: ingestedCanonical, alwaysVisibleTenderIds: new Set(), computeSourceRowHash: computeAgt002RadarSourceRowHash, policyVersion, contextVersion, nowIso: NOW, evaluateGate: survivorGate, enabled: true }), [secondIngest], 'un nuevo last_seen_at no vuelve stale una fila fuente sin cambios');

// BLOCKER A2: un canonico positivo es una foto. El gate determinista se reevalua en lectura con un
// unico reloj para toda la pagina, asi que una fila que ya cruzo su cierre deja de mostrarse.
const realOptions = {
  computeSourceRowHash: computeAgt002RadarSourceRowHash,
  policyVersion: AGT002_RADAR_GATE_POLICY_VERSION,
  contextVersion: AGT002_RADAR_GATE_CONTEXT_VERSION,
  evaluateGate: evaluateAgt002RadarGate,
  enabled: true,
};
const vigente = {
  id: 'g1', stable_key: 'kg1', source: 'TVEC', title: 'Servicio de vigilancia armada', description: 'Guardas',
  entity: 'Entidad A', status: 'Abierto', deadline_at: '2026-08-26', category: 'Licitación Pública',
  raw: { modalidad_de_contratacion: 'Licitación pública' },
};
const convertidaVencida = { ...vigente, id: 'g2', stable_key: 'kg2', deadline_at: '2026-08-01', status: 'Cancelado' };
const positivo = row => [row.id, {
  visibility_verdict: 'mostrar_en_radar', source_row_hash: computeAgt002RadarSourceRowHash(row),
  policy_version: AGT002_RADAR_GATE_POLICY_VERSION, context_version: AGT002_RADAR_GATE_CONTEXT_VERSION,
}];
const gateCanonical = new Map([positivo(vigente), positivo(convertidaVencida)]);
const gateRows = [vigente, convertidaVencida];

// Antes del cierre el canonico positivo se muestra.
assert.deepEqual(
  filterRadarRowsByCanonicalPreanalysis([vigente], { ...realOptions, canonicalByTenderId: gateCanonical, alwaysVisibleTenderIds: new Set(), nowIso: '2026-08-25T15:00:00.000Z' }).map(row => row.id),
  ['g1'],
);
// Despues del cierre el mismo canonico positivo, con el mismo hash fresco, queda oculto.
assert.deepEqual(
  filterRadarRowsByCanonicalPreanalysis([vigente], { ...realOptions, canonicalByTenderId: gateCanonical, alwaysVisibleTenderIds: new Set(), nowIso: '2026-08-27T15:00:00.000Z' }).map(row => row.id),
  [],
  'un positivo canonico rancio no puede sobrevivir a su fecha de cierre',
);
// El mismo hash de fila fuente atraviesa reingestas: lo que cambio es el dia, no la fila.
assert.equal(computeAgt002RadarSourceRowHash(vigente), computeAgt002RadarSourceRowHash({ ...vigente, last_seen_at: '2026-08-27T00:00:00Z' }));
// Las convertidas se resuelven antes del gate y siguen visibles aunque el gate las elimine.
assert.equal(evaluateAgt002RadarGate(convertidaVencida, { nowIso: '2026-08-27T15:00:00.000Z' }).verdict, 'eliminada');
assert.deepEqual(
  filterRadarRowsByCanonicalPreanalysis(gateRows, { ...realOptions, canonicalByTenderId: gateCanonical, alwaysVisibleTenderIds: new Set(['g2']), nowIso: '2026-08-27T15:00:00.000Z' }).map(row => row.id),
  ['g2'],
);
// Un unico reloj para toda la pagina: el gate recibe exactamente el mismo `nowIso` en cada fila.
const clocks = [];
filterRadarRowsByCanonicalPreanalysis(gateRows, {
  ...realOptions, canonicalByTenderId: gateCanonical, alwaysVisibleTenderIds: new Set(),
  nowIso: '2026-08-25T15:00:00.000Z',
  evaluateGate: (row, context) => { clocks.push(context.nowIso); return evaluateAgt002RadarGate(row, context); },
});
assert.deepEqual(clocks, ['2026-08-25T15:00:00.000Z', '2026-08-25T15:00:00.000Z']);

// Reloj o evaluador ausentes/invalidos: falla cerrado en el mismo borde 503, nunca "muestra igual".
// Un evaluador que revienta o devuelve una forma invalida no puede colar filas ni ocultarlas en
// silencio: siempre debe lanzar el mismo borde 503, igual que un evaluador ausente o del tipo incorrecto.
for (const broken of [
  { canonicalByTenderId: null },
  { alwaysVisibleTenderIds: null },
  { nowIso: undefined },
  { nowIso: '' },
  { nowIso: 'not-a-date' },
  { nowIso: 1756134000000 },
  { evaluateGate: undefined },
  { evaluateGate: 'no-soy-funcion' },
  { evaluateGate: () => { throw new Error('gate roto'); } },
  { evaluateGate: () => null },
  { evaluateGate: () => undefined },
  { evaluateGate: () => 'sobreviviente' },
  { evaluateGate: () => 42 },
  { evaluateGate: () => ({}) },
  { evaluateGate: () => ({ verdict: 'otro' }) },
  { evaluateGate: () => ({ verdict: 'SOBREVIVIENTE' }) },
]) {
  const attempt = () => filterRadarRowsByCanonicalPreanalysis(rows, { ...options, ...broken, enabled: true });
  assert.throws(attempt, error => error.runtime_boundary_code === 'AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE');
}

// Un veredicto 'eliminada' valido no es un fallo: se resuelve a "no visible" sin tocar el borde 503.
const eliminatedGate = () => ({ verdict: 'eliminada' });
assert.deepEqual(
  filterRadarRowsByCanonicalPreanalysis([preanalizada], { ...options, alwaysVisibleTenderIds: new Set(), evaluateGate: eliminatedGate, enabled: true }),
  [],
  'un gate valido con veredicto eliminada oculta la fila sin lanzar el borde',
);
// Las convertidas siguen resolviendose antes del gate: un evaluador invalido nunca se llega a invocar.
assert.deepEqual(
  filterRadarRowsByCanonicalPreanalysis([convertida], { ...options, evaluateGate: () => null, enabled: true }).map(row => row.id),
  ['t2'],
  'las convertidas se cortan antes de evaluar el gate, aun con un evaluador invalido',
);

const visibilitySource = readFileSync(new URL('../agt002-radar-visibility.js', import.meta.url), 'utf8');
for (const forbidden of ['internal_status', 'converted_opportunity_id']) assert.equal(visibilitySource.includes(forbidden), false);
assert.equal(/learning/i.test(visibilitySource), false);

console.log('AGT-002 Radar canonical visibility is positive-only, fresh, currently-surviving, and fail-closed');
