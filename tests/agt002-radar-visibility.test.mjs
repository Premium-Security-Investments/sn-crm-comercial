import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { filterRadarRowsByCanonicalPreanalysis } from '../agt002-radar-visibility.js';
import { computeAgt002RadarSourceRowHash } from '../agt002-radar-gate.js';

const nueva = { id: 't1', stable_key: 'k1', status: 'abierto' };
const convertida = { id: 't2', stable_key: 'k2', status: 'cerrado' };
const preanalizada = { id: 't3', stable_key: 'k3', status: 'abierto' };
const stale = { id: 't4', stable_key: 'k4', status: 'actualizado' };
const rows = [nueva, convertida, preanalizada, stale];
const alwaysVisibleTenderIds = new Set(['t2']);
const HASH = row => `hash:${row.stable_key}:${row.status}`;
const policyVersion = 'policy-v1';
const contextVersion = 'context-v1';
const canonicalByTenderId = new Map([
  ['t1', { visibility_verdict: 'no_concluyente', source_row_hash: HASH(nueva), policy_version: policyVersion, context_version: contextVersion }],
  ['t3', { visibility_verdict: 'mostrar_en_radar', source_row_hash: HASH(preanalizada), policy_version: policyVersion, context_version: contextVersion }],
  ['t4', { visibility_verdict: 'mostrar_en_radar', source_row_hash: 'hash:anterior', policy_version: policyVersion, context_version: contextVersion }],
]);
const options = { canonicalByTenderId, alwaysVisibleTenderIds, computeSourceRowHash: HASH, policyVersion, contextVersion };

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
const firstIngest = { id: 't5', stable_key: 'k5', status: 'abierto', deadline_at: '2026-09-01T12:00:00Z', raw: { ref: 'x' }, last_seen_at: '2026-08-25T00:00:00Z' };
const secondIngest = { ...firstIngest, last_seen_at: '2026-08-26T00:00:00Z' };
const ingestedCanonical = new Map([['t5', { visibility_verdict: 'mostrar_en_radar', source_row_hash: computeAgt002RadarSourceRowHash(firstIngest), policy_version: policyVersion, context_version: contextVersion }]]);
assert.deepEqual(filterRadarRowsByCanonicalPreanalysis([secondIngest], { canonicalByTenderId: ingestedCanonical, alwaysVisibleTenderIds: new Set(), computeSourceRowHash: computeAgt002RadarSourceRowHash, policyVersion, contextVersion, enabled: true }), [secondIngest], 'un nuevo last_seen_at no vuelve stale una fila fuente sin cambios');
assert.throws(
  () => filterRadarRowsByCanonicalPreanalysis(rows, { ...options, canonicalByTenderId: null, enabled: true }),
  error => error.runtime_boundary_code === 'AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE',
);
assert.throws(
  () => filterRadarRowsByCanonicalPreanalysis(rows, { ...options, alwaysVisibleTenderIds: null, enabled: true }),
  error => error.runtime_boundary_code === 'AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE',
);
const visibilitySource = readFileSync(new URL('../agt002-radar-visibility.js', import.meta.url), 'utf8');
for (const forbidden of ['internal_status', 'converted_opportunity_id']) assert.equal(visibilitySource.includes(forbidden), false);
assert.equal(/learning/i.test(visibilitySource), false);

console.log('AGT-002 Radar canonical visibility is positive-only, fresh, and fail-closed');
