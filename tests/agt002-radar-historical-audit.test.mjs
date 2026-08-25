import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { planAgt002RadarGateAudit } from '../scripts/agt002-radar-gate-historical-audit.mjs';

const NOW = '2026-08-25T15:00:00.000Z';
const tenders = [
  { id: 't1', stable_key: 'k1', internal_status: 'nueva', status: 'abierto', title: 'Servicio de vigilancia armada', deadline_at: '2026-12-31T23:59:59.000Z', raw: { modalidad_de_contratacion: 'Licitación pública' } },
  { id: 't2', stable_key: 'k2', internal_status: 'nueva', status: 'Cancelado', title: 'Vigilancia armada', deadline_at: '2026-12-31T23:59:59.000Z', raw: {} },
  { id: 't3', stable_key: 'k3', internal_status: 'nueva', status: 'abierto', title: 'Vigilancia armada', deadline_at: null, raw: {} },
  { id: 't4', stable_key: 'k4', internal_status: 'convertida_oportunidad', converted_opportunity_id: 'o1', status: 'Cancelado', title: 'Vigilancia armada', deadline_at: '2025-01-01T00:00:00.000Z', raw: {} },
];

const plan = planAgt002RadarGateAudit({ tenders, nowIso: NOW, canonicalPreanalysisByTenderId: new Map() });
assert.equal(plan.total, 4);
assert.equal(plan.sobrevivientes, 1);
assert.equal(plan.eliminadas_por_regla.estado_terminal, 2);
assert.equal(plan.data_gaps_por_tipo.modalidad_no_reportada, 3);
assert.equal(plan.convertidas_eliminadas_por_gate, 1);
assert.equal(plan.ocultables.includes('t4'), false);
assert.deepEqual(plan.uncovered_visible_tenders, ['t1']);
assert.equal(plan.ready_for_visibility_flag, false);

const coveredCanonical = {
  visibility_verdict: 'mostrar_en_radar',
  source_row_hash: plan.evaluations.t1.source_row_hash,
  policy_version: plan.policy_version,
  context_version: plan.context_version,
};
const covered = planAgt002RadarGateAudit({ tenders, nowIso: NOW, canonicalPreanalysisByTenderId: new Map([['t1', coveredCanonical]]) });
assert.deepEqual(covered.uncovered_visible_tenders, []);
assert.equal(covered.ready_for_visibility_flag, true);
assert.equal(covered.canonical_breakdown.fresh_mostrar_en_radar, 1);

for (const [expected, override] of [
  ['stale_hash', { source_row_hash: 'stale' }],
  ['stale_policy', { policy_version: 'old' }],
  ['stale_context', { context_version: 'old' }],
  ['no_concluyente', { visibility_verdict: 'no_concluyente' }],
]) {
  const result = planAgt002RadarGateAudit({ tenders, nowIso: NOW, canonicalPreanalysisByTenderId: new Map([['t1', { ...coveredCanonical, ...override }]]) });
  assert.equal(result.canonical_breakdown[expected], 1);
  assert.deepEqual(result.uncovered_visible_tenders, ['t1']);
}

for (const sample of plan.muestras) {
  assert.ok(sample.tender_id && sample.rule_id && sample.field && String(sample.observed_value).length > 0);
}
for (const name of ['agt002-radar-gate-historical-audit', 'agt002-radar-preanalysis-dryrun', 'agt002-radar-learning-signals-report']) {
  const source = readFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), 'utf8');
  assert.equal(/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(source), false, `${name} no debe escribir`);
  assert.equal(source.includes('--apply'), false, `${name} no debe aceptar --apply`);
  assert.equal(/psi_record_agt002_radar|psi_append_agt002_radar/.test(source), false, `${name} no debe llamar RPC de persistencia`);
  assert.equal(/psi_(enqueue|claim|complete|fail)_agt002_radar/.test(source), false, `${name} no debe tocar la cola`);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
}

const runbook = readFileSync(new URL('../ops/agt002-radar-pipeline/README.md', import.meta.url), 'utf8');
for (const required of [
  'AGT002_RADAR_GATE=false', 'AGT002_RADAR_VISIBILITY=false',
  'agt002-radar-gate-historical-audit.mjs', 'agt002-radar-preanalysis-dryrun.mjs',
  'agt002-radar-learning-signals-report.mjs', 'AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE',
  'uncovered_visible_tenders', 'rollback', 'systemctl',
]) assert.match(runbook, new RegExp(required));

console.log('AGT-002 historical audit and dry-run scripts are deterministic and read-only');
