import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { planAgt002RadarGateAudit, runAgt002RadarGateHistoricalAudit } from '../scripts/agt002-radar-gate-historical-audit.mjs';
import { runAgt002RadarPreanalysisDryRun } from '../scripts/agt002-radar-preanalysis-dryrun.mjs';
import { runAgt002RadarLearningSignalsReport } from '../scripts/agt002-radar-learning-signals-report.mjs';
import { computeAgt002RadarSourceRowHash } from '../agt002-radar-gate.js';
import { agt002RadarDerivedDayWindowLabel } from '../agt002-radar-derived-day-churn.js';

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
]) {
  const result = planAgt002RadarGateAudit({ tenders, nowIso: NOW, canonicalPreanalysisByTenderId: new Map([['t1', { ...coveredCanonical, ...override }]]) });
  assert.equal(result.canonical_breakdown[expected], 1);
  assert.deepEqual(result.uncovered_visible_tenders, ['t1']);
}

for (const visibility_verdict of ['no_mostrar_en_radar', 'no_concluyente']) {
  const result = planAgt002RadarGateAudit({ tenders, nowIso: NOW, canonicalPreanalysisByTenderId: new Map([['t1', { ...coveredCanonical, visibility_verdict }]]) });
  assert.equal(result.canonical_breakdown[visibility_verdict], 1);
  assert.deepEqual(result.uncovered_visible_tenders, [], `${visibility_verdict} es una evaluación fresca y cubre el backfill aunque quede oculta`);
  assert.equal(result.ready_for_visibility_flag, true);
}

// BLOCKER (derived-day-only churn): un rollover diario que sólo reescribe raw.days/raw.window no
// puede clasificarse como `stale_hash`/uncovered: el mismo clasificador puro que ya usan el scan y
// el worker (agt002-radar-derived-day-churn.js) decide si el canónico sigue describiendo la misma
// fila. La licitación sintética replica la forma que ya sobrevive el gate (t1: vigilancia armada,
// cierre lejano) y sólo añade raw.days/raw.window con la forma exacta del exportador productivo.
const derivedToday = 11;
const derivedTender = {
  id: 't5', stable_key: 'k5', internal_status: 'nueva', status: 'abierto',
  title: 'Servicio de vigilancia armada', deadline_at: '2026-12-31T23:59:59.000Z',
  raw: { modalidad_de_contratacion: 'Licitación pública', days: derivedToday, window: agt002RadarDerivedDayWindowLabel(derivedToday) },
};
const derivedYesterday = {
  ...derivedTender,
  raw: { ...derivedTender.raw, days: derivedToday + 1, window: agt002RadarDerivedDayWindowLabel(derivedToday + 1) },
};
const derivedEvaluation = planAgt002RadarGateAudit({ tenders: [derivedTender], nowIso: NOW, canonicalPreanalysisByTenderId: new Map() }).evaluations.t5;
assert.equal(derivedEvaluation.verdict, 'sobreviviente');
assert.notEqual(computeAgt002RadarSourceRowHash(derivedTender), computeAgt002RadarSourceRowHash(derivedYesterday), 'el rollover diario si cambia el hash literal');
const derivedOnlyCanonical = {
  visibility_verdict: 'mostrar_en_radar', source_row_hash: computeAgt002RadarSourceRowHash(derivedYesterday),
  policy_version: derivedEvaluation.policy_version, context_version: derivedEvaluation.context_version,
};
const derivedResult = planAgt002RadarGateAudit({ tenders: [derivedTender], nowIso: NOW, canonicalPreanalysisByTenderId: new Map([['t5', derivedOnlyCanonical]]) });
assert.equal(derivedResult.canonical_breakdown.fresh_mostrar_en_radar, 1, 'un canonico derivado-solo por dias/ventana cuenta como fresco');
assert.equal(derivedResult.canonical_breakdown.stale_hash, 0);
assert.deepEqual(derivedResult.uncovered_visible_tenders, [], 'un derivado-solo no puede quedar uncovered');
assert.equal(derivedResult.ready_for_visibility_flag, true);

// Fail-closed: un cambio MATERIAL, aunque days/window tambien cambien, sigue siendo stale_hash/uncovered.
const derivedMaterialCanonical = {
  ...derivedOnlyCanonical,
  source_row_hash: computeAgt002RadarSourceRowHash({ ...derivedYesterday, title: 'Otro objeto' }),
};
const materialResult = planAgt002RadarGateAudit({ tenders: [derivedTender], nowIso: NOW, canonicalPreanalysisByTenderId: new Map([['t5', derivedMaterialCanonical]]) });
assert.equal(materialResult.canonical_breakdown.stale_hash, 1, 'un cambio material sigue clasificando stale_hash');
assert.deepEqual(materialResult.uncovered_visible_tenders, ['t5']);
assert.equal(materialResult.ready_for_visibility_flag, false);

// Fail-closed: policy/context distinto de la evaluacion vigente nunca se promueve a "fresco" via el
// clasificador derivado-solo, ni siquiera cuando el hash sería derivado-solo con la política correcta.
for (const [category, override] of [['stale_hash', { policy_version: 'policy-old' }], ['stale_hash', { context_version: 'context-old' }]]) {
  const staleVersionResult = planAgt002RadarGateAudit({ tenders: [derivedTender], nowIso: NOW, canonicalPreanalysisByTenderId: new Map([['t5', { ...derivedOnlyCanonical, ...override }]]) });
  assert.equal(staleVersionResult.canonical_breakdown[category], 1, `${JSON.stringify(override)} no puede convertirse en fresh_mostrar_en_radar`);
  assert.equal(staleVersionResult.canonical_breakdown.fresh_mostrar_en_radar, 0);
  assert.deepEqual(staleVersionResult.uncovered_visible_tenders, ['t5']);
}
// Cuando el hash coincide exactamente (sin churn de por medio) y sólo la política/contexto quedaron
// atrás, la categoría sigue siendo stale_policy/stale_context: el clasificador derivado-solo no debe
// tocar ese camino existente.
for (const [expected, override] of [['stale_policy', { policy_version: 'policy-old' }], ['stale_context', { context_version: 'context-old' }]]) {
  const exactStaleVersionResult = planAgt002RadarGateAudit({
    tenders: [derivedTender], nowIso: NOW,
    canonicalPreanalysisByTenderId: new Map([['t5', { ...derivedOnlyCanonical, source_row_hash: derivedEvaluation.source_row_hash, ...override }]]),
  });
  assert.equal(exactStaleVersionResult.canonical_breakdown[expected], 1);
  assert.equal(exactStaleVersionResult.canonical_breakdown.fresh_mostrar_en_radar, 0);
}

for (const sample of plan.muestras) {
  assert.ok(sample.tender_id && sample.rule_id && sample.field && String(sample.observed_value).length > 0);
}

const databaseRequests = [];
let runtimeRequest;
const fetchImpl = async (url, options = {}) => {
  databaseRequests.push({ url: String(url), method: options.method });
  const parsed = new URL(url);
  const table = parsed.pathname.split('/').at(-1);
  const isRequestedTender = table === 'psi_public_tenders' && parsed.searchParams.get('id') === 'eq.t1';
  return {
    ok: true,
    status: 200,
    async json() {
      if (isRequestedTender) return [tenders[0]];
      if (table === 'psi_public_tenders' && !parsed.searchParams.has('internal_status')) return tenders;
      return [];
    },
  };
};
const dryRun = await runAgt002RadarPreanalysisDryRun({
  tenderId: 't1',
  baseUrl: 'https://supabase.example.test',
  serviceKey: 'service-key',
  environment: {},
  nowIso: NOW,
  fetchImpl,
  createRuntime: () => ({ runOnce: async request => { runtimeRequest = request; return { visibility_verdict: 'mostrar_en_radar' }; } }),
});
assert.equal(dryRun.persisted, false);
assert.equal(dryRun.mode, 'read_only_dry_run');
assert.equal(databaseRequests.length, 5);
assert.ok(databaseRequests.every(request => request.method === 'GET'));
assert.equal(runtimeRequest.learningSignals, null, 'cero señales debe viajar como null, no como sobre vacío');

const auditRequestStart = databaseRequests.length;
const liveAudit = await runAgt002RadarGateHistoricalAudit({
  baseUrl: 'https://supabase.example.test',
  serviceKey: 'service-key',
  nowIso: NOW,
  fetchImpl,
});
assert.equal(liveAudit.total, tenders.length);
assert.equal(liveAudit.ledger_available, true);
assert.ok(databaseRequests.slice(auditRequestStart).every(request => request.method === 'GET'));

const learningRequestStart = databaseRequests.length;
const learningReport = await runAgt002RadarLearningSignalsReport({
  baseUrl: 'https://supabase.example.test',
  serviceKey: 'service-key',
  generatedAt: NOW,
  fetchImpl,
});
assert.equal(learningReport.persisted, false);
assert.ok(databaseRequests.slice(learningRequestStart).every(request => request.method === 'GET'));

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

const operationalRunbook = readFileSync(new URL('../docs/runbooks/agt002-radar-pipeline.md', import.meta.url), 'utf8');
for (const required of [
  'AGT002_RADAR_GATE', 'AGT002_RADAR_VISIBILITY', 'uncovered_visible_tenders = 0',
  'no_mostrar_en_radar', 'no_concluyente', 'source_row_hash', 'policy_version', 'context_version',
  'convertidas históricas se muestran siempre', 'no persiste el resultado ni modifica Supabase',
]) assert.ok(operationalRunbook.includes(required), required);

console.log('AGT-002 historical audit and dry-run scripts are deterministic and read-only');
