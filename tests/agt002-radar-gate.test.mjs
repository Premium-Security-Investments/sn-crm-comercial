import assert from 'node:assert/strict';
import {
  AGT002_RADAR_GATE_CONTEXT_VERSION,
  AGT002_RADAR_GATE_POLICY_VERSION,
  AGT002_RADAR_GATE_RULE_IDS,
  computeAgt002RadarSourceRowHash,
  evaluateAgt002RadarGate,
} from '../agt002-radar-gate.js';

const NOW = '2026-08-25T15:00:00.000Z';
const base = {
  id: '00000000-0000-4000-8000-000000000001', stable_key: 'secop-1', source: 'SECOP II',
  title: 'Servicio de vigilancia armada', description: 'Guardas para las sedes', entity: 'Entidad A',
  status: 'Abierto', deadline_at: '2026-08-26T23:59:00.000Z', category: 'Licitación Pública',
  raw: { modalidad_de_contratacion: 'Licitación pública' },
};

const survived = evaluateAgt002RadarGate(base, { nowIso: NOW });
assert.equal(survived.verdict, 'sobreviviente');
assert.deepEqual(survived.rule_ids, []);
assert.deepEqual(survived.reasons, []);
assert.equal(survived.policy_version, AGT002_RADAR_GATE_POLICY_VERSION);
assert.equal(survived.context_version, AGT002_RADAR_GATE_CONTEXT_VERSION);
assert.match(survived.source_row_hash, /^[0-9a-f]{64}$/);
assert.match(survived.idempotency_key, /^[0-9a-f]{64}$/);

const cases = [
  ['estado_terminal', { status: 'Cancelado' }],
  ['fecha_vencida', { deadline_at: '2026-08-24' }],
  ['fecha_no_verificable', { deadline_at: null }],
  ['fecha_no_verificable', { deadline_at: '2026-02-30' }],
  ['contratacion_directa', { raw: { modalidad_de_contratacion: 'Contratación directa' } }],
  ['contexto_no_seguridad', { title: 'Vigilancia epidemiológica', description: 'Salud pública' }],
  ['contexto_no_seguridad', { title: 'Interventoría técnica' }],
];
for (const [ruleId, patch] of cases) {
  const result = evaluateAgt002RadarGate({ ...base, ...patch }, { nowIso: NOW });
  assert.equal(result.verdict, 'eliminada', ruleId);
  assert.ok(result.rule_ids.includes(ruleId), ruleId);
  const reason = result.reasons.find(item => item.rule_id === ruleId);
  assert.ok(reason, ruleId);
  assert.deepEqual(Object.keys(reason).sort(), ['context_version', 'field', 'observed_value', 'policy_version', 'rule_id', 'source']);
}

const allRules = evaluateAgt002RadarGate({
  ...base,
  status: 'Cancelado', deadline_at: null, category: 'Contratación directa',
  title: 'Vigilancia epidemiológica e interventoría', raw: {},
}, { nowIso: NOW });
assert.deepEqual(allRules.rule_ids, AGT002_RADAR_GATE_RULE_IDS.filter(id => id !== 'fecha_vencida'));
assert.equal(allRules.reasons.length, allRules.rule_ids.length);

const noModality = evaluateAgt002RadarGate({ ...base, raw: {}, category: '' }, { nowIso: NOW });
assert.equal(noModality.verdict, 'sobreviviente');
assert.deepEqual(noModality.data_gaps.map(gap => gap.gap_id), ['modalidad_no_reportada']);

const todayBogota = evaluateAgt002RadarGate({ ...base, deadline_at: '2026-08-25' }, { nowIso: NOW });
assert.equal(todayBogota.verdict, 'sobreviviente');

assert.deepEqual(
  evaluateAgt002RadarGate(base, { nowIso: NOW }),
  evaluateAgt002RadarGate(base, { nowIso: NOW }),
);
assert.equal(
  computeAgt002RadarSourceRowHash({ ...base, raw: { b: 2, a: 1 } }),
  computeAgt002RadarSourceRowHash({ ...base, raw: { a: 1, b: 2 } }),
);
const sourceHash = computeAgt002RadarSourceRowHash(base);
assert.equal(sourceHash, computeAgt002RadarSourceRowHash({
  ...base,
  last_seen_at: '2026-08-26T00:00:00.000Z',
  updated_at: '2026-08-26T00:00:01.000Z',
  score: 99,
  reasons: ['heurística mutable'],
  risks: ['heurística mutable'],
  internal_status: 'convertida_oportunidad',
  converted_opportunity_id: '44444444-4444-4444-8444-444444444444',
  reviewed_by: '55555555-5555-4555-8555-555555555555',
  reviewed_at: '2026-08-26T00:00:02.000Z',
}), 'la frescura no cambia por reingesta, scoring ni revisión humana');
assert.notEqual(computeAgt002RadarSourceRowHash(base), computeAgt002RadarSourceRowHash({ ...base, status: 'Cancelado' }));
assert.notEqual(computeAgt002RadarSourceRowHash(base), computeAgt002RadarSourceRowHash({ ...base, deadline_at: '2026-09-01' }));
assert.notEqual(computeAgt002RadarSourceRowHash(base), computeAgt002RadarSourceRowHash({ ...base, raw: { modalidad_de_contratacion: 'Selección abreviada' } }));
const missingDeadline = evaluateAgt002RadarGate({ ...base, deadline_at: null }, { nowIso: NOW });
assert.equal(missingDeadline.reasons[0].observed_value, '<null>');
assert.throws(() => evaluateAgt002RadarGate(null, { nowIso: NOW }), /AGT002_RADAR_GATE_INPUT_INVALID/);
assert.throws(() => evaluateAgt002RadarGate(base, { nowIso: 'not-a-date' }), /AGT002_RADAR_GATE_INPUT_INVALID/);

console.log('AGT-002 deterministic Radar gate contract passed');
