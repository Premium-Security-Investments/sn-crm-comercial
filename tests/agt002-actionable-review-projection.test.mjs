// AGT-002 actionable review — pure frontend projection (design §§8.2, 8.4,
// 8.7, 19.6, 12.3: `src/tenders/tenderActionableReviewProjection.ts`). RED
// reason: the module does not exist yet, so `esbuild.buildSync` throws
// before any scenario runs — there is no counts/state projection and no
// mutual-exclusion rule (new drawer vs. legacy editor) to test.
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const projectionPath = new URL('../src/tenders/tenderActionableReviewProjection.ts', import.meta.url).pathname;
const bundled = buildSync({ entryPoints: [projectionPath], bundle: true, platform: 'node', format: 'esm', write: false });
const projectionUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const {
  projectActionableReviewCard,
  projectActionableReviewSummary,
  resolvesEligibleForNewDrawer,
} = await import(projectionUrl);

function baseItem(overrides = {}) {
  return {
    id: 'item-1',
    state: 'pendiente',
    outcome: null,
    comment_count: 0,
    attachment_count: 0,
    current_supports_count: 0,
    capabilities: { can_contribute: true, can_resolve: false },
    ...overrides,
  };
}

// --- §8.2: badge/state labels never leak raw enums, unit ids or hashes ------
await (async function cardProjectsHumanLabelsWithoutTechnicalLeakage() {
  const card = projectActionableReviewCard(baseItem({ state: 'resuelto', outcome: 'riesgo_confirmado' }));
  assert.equal(card.badge_label, 'Riesgo confirmado');
  assert.equal(card.cta_label, 'Revisar pendiente');
  for (const forbidden of ['unit_id', 'requirement_id', 'source_hash', 'storage_path', 'e_tag']) {
    assert.equal(Object.prototype.hasOwnProperty.call(card, forbidden), false, `card must never expose ${forbidden}`);
  }
})();

await (async function readOnlyUserGetsViewLabelNotReviewLabel() {
  const card = projectActionableReviewCard(baseItem({ capabilities: { can_contribute: false, can_resolve: false } }));
  assert.equal(card.cta_label, 'Ver revisión');
})();

// --- §8.4: outcome label/state mapping is closed and exact ------------------
await (async function outcomeLabelsMatchTheClosedTable() {
  const table = [
    ['aclarado_con_soporte', 'Aclarado con soporte', 'resuelto'],
    ['riesgo_confirmado', 'Riesgo confirmado', 'resuelto'],
    ['no_aplica', 'No aplica', 'resuelto'],
    ['informacion_insuficiente', 'Información insuficiente', 'en_revision'],
  ];
  for (const [outcome, label] of table) {
    const card = projectActionableReviewCard(baseItem({ state: outcome === 'informacion_insuficiente' ? 'en_revision' : 'resuelto', outcome }));
    assert.equal(card.outcome_label, label, `outcome ${outcome} must project to '${label}'`);
  }
})();

// --- §8.1/§24.6: summary counts open items and vigente confirmed risks only
await (async function summaryCountsOpenAndVigenteConfirmedRisks() {
  const items = [
    baseItem({ id: 'a', state: 'pendiente' }),
    baseItem({ id: 'b', state: 'en_revision' }),
    baseItem({ id: 'c', state: 'resuelto', outcome: 'riesgo_confirmado' }),
    baseItem({ id: 'd', state: 'reabierto', outcome: 'riesgo_confirmado', was_confirmed_risk: true }),
    baseItem({ id: 'e', state: 'resuelto', outcome: 'no_aplica' }),
  ];
  const summary = projectActionableReviewSummary(items);
  assert.equal(summary.open_count, 3, 'pendiente + en_revision + reabierto count as open');
  assert.equal(summary.confirmed_risk_count, 1, 'only a resolved item with a vigente riesgo_confirmado counts; a reabierto risk no longer counts');
})();

// --- §8.7/§19.6: mutual exclusion — a V3-eligible unit mounts only the new
// drawer; a historical/non-eligible finding mounts only the legacy editor. --
await (async function eligibleUnitMountsOnlyNewDrawerNeverLegacyEditor() {
  assert.equal(resolvesEligibleForNewDrawer({ source_kind: 'integral_unit', source_id: 'unit-1', is_historical_run: false }), true);
  assert.equal(resolvesEligibleForNewDrawer({ source_kind: null, source_id: null, is_historical_run: false }), false, 'a finding with no structural identity must never resolve eligible');
  assert.equal(resolvesEligibleForNewDrawer({ source_kind: 'integral_unit', source_id: 'unit-1', is_historical_run: true }), false, 'a historical run finding must use the legacy editor, not the new drawer');
})();

await (async function unreviewableIdentityHasNoCta() {
  const card = projectActionableReviewCard(baseItem({ id: null, has_structural_identity: false }));
  assert.equal(card.cta_label, null, 'a finding without structural identity must show no CTA');
  assert.equal(card.badge_label, 'Pendiente sin identidad revisable');
})();

console.log('AGT-002 actionable review frontend projection contract (RED — module missing) passed');
