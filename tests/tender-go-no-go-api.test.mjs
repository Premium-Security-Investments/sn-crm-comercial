import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  callTenderGoNoGoDecision,
  getTenderGoNoGoDecision,
  requireTenderGoForPreparation,
} from '../tender-go-no-go-rpc.js';
import { buildTenderSnapshotInput } from '../tender-analysis-foundation.js';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const TENDER_ID = '22222222-2222-4222-8222-222222222222';
const ANALYSIS_RUN_ID = '33333333-3333-4333-8333-33333333333a';
const STALE_ANALYSIS_RUN_ID = '88888888-8888-4888-8888-88888888888b';
const LEGACY_ANALYSIS_INTERACTION_ID = '99999999-9999-4999-8999-999999999999';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const CURRENT_DOCUMENTS = [{ id: 'doc-1', name: 'Pliego.pdf', current: true, document_type: 'pliego' }];
const CURRENT_DOCUMENT_HASH = buildTenderSnapshotInput(CURRENT_DOCUMENTS, {}).document_hash;

const HISTORICAL_PREPARATION = Object.freeze({
  kind: 'tender_offer_preparation',
  status: 'preparacion_oferta',
  interaction_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  persisted_marker: 'historical-preparation',
  created_at: '2026-07-04T00:00:00.000Z',
  occurred_at: '2026-07-04T00:00:00.000Z',
});
const SQL_CURRENT_PREPARATION = Object.freeze({
  kind: 'tender_offer_preparation',
  status: 'preparacion_oferta',
  interaction_id: '33333333-3333-4333-8333-333333333333',
  persisted_marker: 'sql-current-by-occurred-at',
  created_at: '2026-07-04T00:00:00.000Z',
  occurred_at: '2026-07-09T00:00:00.000Z',
});
const CREATED_AT_CURRENT_PREPARATION = Object.freeze({
  kind: 'tender_offer_preparation',
  status: 'preparacion_oferta',
  interaction_id: '44444444-4444-4444-8444-444444444444',
  persisted_marker: 'incorrect-if-created-at-order',
  created_at: '2026-07-10T00:00:00.000Z',
  occurred_at: '2026-07-08T00:00:00.000Z',
});

const directorProfile = {
  id: ACTOR_ID,
  active: true,
  identity_type: 'human',
  role: 'director',
  permissions: ['licitaciones'],
  areas: [{ area_code: 'licitaciones', subarea_code: null }],
  full_name: 'Directora de Licitaciones',
};

function comparable(value) {
  return value == null ? '' : String(value);
}

function query(rows, onAccess) {
  const filters = [];
  const orders = [];
  let limit = null;
  const materialize = () => {
    let result = [...rows];
    for (const [key, value] of filters) result = result.filter(row => row?.[key] === value);
    for (const [key, options] of [...orders].reverse()) {
      const direction = options?.ascending === false ? -1 : 1;
      result.sort((left, right) => comparable(left?.[key]).localeCompare(comparable(right?.[key])) * direction);
    }
    return limit == null ? result : result.slice(0, limit);
  };
  const response = data => ({ data, error: null });
  const chain = {
    select() { return chain; },
    eq(key, value) { filters.push([key, value]); return chain; },
    order(key, options) { orders.push([key, options]); return chain; },
    limit(value) { limit = value; return chain; },
    maybeSingle() { onAccess?.(); return Promise.resolve(response(materialize()[0] || null)); },
    single() { onAccess?.(); return Promise.resolve(response(materialize()[0] || null)); },
    then(resolve, reject) { onAccess?.(); return Promise.resolve(response(materialize())).then(resolve, reject); },
  };
  return chain;
}

function preparationInteraction(preparation) {
  return {
    id: preparation.interaction_id,
    opportunity_id: OPPORTUNITY_ID,
    interaction_type: 'documento',
    notes: JSON.stringify({ ...preparation, kind: 'tender_offer_preparation' }),
    created_at: preparation.created_at,
    occurred_at: preparation.occurred_at,
  };
}

function fakeDatabase({
  preparationCreated = true,
  preparationId,
  preparations = [],
  history = [],
  snapshots = [{ id: '66666666-6666-4666-8666-666666666666', opportunity_id: OPPORTUNITY_ID, document_hash: CURRENT_DOCUMENT_HASH, created_at: '2026-07-03T00:00:00.000Z' }],
  states = snapshots.length ? [{ opportunity_id: OPPORTUNITY_ID, current_snapshot_id: snapshots[0].id, refresh_in_progress: false }] : [],
  runs = [{
    id: ANALYSIS_RUN_ID,
    snapshot_id: '66666666-6666-4666-8666-666666666666',
    opportunity_id: OPPORTUNITY_ID,
    producer: 'siio_rules_v1',
    method: 'rules',
    status: 'completed',
    critical_open_count: 0,
    result: { recommendation: 'GO', summary: 'Análisis vigente' },
    created_at: '2026-07-03T00:00:00.000Z',
  }],
} = {}) {
  const observed = { rpc: [], targetAccesses: 0, tables: [] };
  const targetAccess = () => { observed.targetAccesses += 1; };
  const interactions = [
    {
      id: '55555555-5555-4555-8555-555555555555',
      opportunity_id: OPPORTUNITY_ID,
      interaction_type: 'documento',
      notes: JSON.stringify({ kind: 'tender_document_upload', documents: CURRENT_DOCUMENTS }),
      created_at: '2026-07-01T00:00:00.000Z',
      occurred_at: '2026-07-01T00:00:00.000Z',
    },
    ...preparations.map(preparationInteraction),
  ];
  const database = {
    from(table) {
      observed.tables.push(table);
      if (table === 'v_psi_sales_opportunity_enriched') return query([{ id: OPPORTUNITY_ID, company_name: 'Entidad pública', service_type_code: 'licitacion_publica', expected_close_date: '2026-08-01', offer_value: 1000 }], targetAccess);
      if (table === 'psi_public_tenders') return query([{ id: TENDER_ID, converted_opportunity_id: OPPORTUNITY_ID }], targetAccess);
      if (table === 'psi_sales_interactions') return query(interactions, targetAccess);
      if (table === 'psi_tender_document_versions') return query([], targetAccess);
      if (table === 'psi_tender_document_state') return query(states, targetAccess);
      if (table === 'psi_tender_document_snapshots') return query(snapshots, targetAccess);
      if (table === 'psi_tender_analysis_runs') return query(runs, targetAccess);
      if (table === 'psi_tender_go_no_go_decisions') return query(history, targetAccess);
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      observed.rpc.push({ name, args });
      return {
        data: {
          decision_id: '77777777-7777-4777-8777-777777777777',
          decision: args.p_decision,
          preparation_id: args.p_decision === 'go' ? (preparationId || '77777777-7777-4777-8777-777777777778') : null,
          preparation_created: preparationCreated,
          tender_offer_status: args.p_decision === 'go' ? 'en_preparacion' : 'cerrada_no_go',
        },
        error: null,
      };
    },
  };
  return { database, observed };
}

function decide(database, input = {}, profile = directorProfile) {
  return callTenderGoNoGoDecision(database, {
    opportunity_id: OPPORTUNITY_ID,
    decision: 'go',
    analysis_run_id: ANALYSIS_RUN_ID,
    justification: 'Margen y capacidad aprobados',
    ...input,
  }, profile);
}

{
  const { database, observed } = fakeDatabase({ snapshots: [], runs: [] });
  await decide(database, { analysis_run_id: null, justification: '' });
  assert.equal(observed.rpc.length, 1, 'missing analysis must still reach the authorized decision RPC');
  assert.equal(observed.rpc[0].args.p_analysis_run_id, null);
  assert.equal(observed.rpc[0].args.p_justification, null, 'human comment is optional');
}

{
  const { database, observed } = fakeDatabase();
  const result = await decide(database);
  assert.equal(observed.rpc.length, 1, 'GO must make exactly one mediated RPC call');
  assert.equal(observed.rpc[0].name, 'psi_record_tender_go_no_go');
  assert.equal(observed.rpc[0].args.p_actor_id, ACTOR_ID);
  assert.equal(observed.rpc[0].args.p_tender_id, TENDER_ID);
  assert.equal(observed.rpc[0].args.p_decision, 'go');
  assert.equal(observed.rpc[0].args.p_analysis_run_id, ANALYSIS_RUN_ID, 'new decisions bind the typed analysis run');
  assert.equal(observed.rpc[0].args.p_document_hash, CURRENT_DOCUMENT_HASH, 'la RPC recibe el hash documental vigente calculado desde los documentos actuales');
  assert.equal(Object.hasOwn(observed.rpc[0].args, 'p_analysis_interaction_id'), false, 'legacy interaction IDs are never write inputs');
  assert.equal(observed.rpc[0].args.p_justification, 'Margen y capacidad aprobados');
  assert.equal(result.preparation, observed.rpc[0].args.p_preparation, 'created preparation must return the payload submitted to the RPC');
  assert.equal(observed.rpc[0].args.p_agt002_items, null, 'a legacy (non-V3) analysis must never derive an AGT-002 handoff batch');
}

{
  const { database, observed } = fakeDatabase({
    snapshots: [{ id: '66666666-6666-4666-8666-666666666666', opportunity_id: OPPORTUNITY_ID, document_hash: '0'.repeat(64), created_at: '2026-07-03T00:00:00.000Z' }],
  });
  await decide(database);
  assert.equal(observed.rpc[0].args.p_analysis_run_id, null, 'un run de un hash documental histórico no puede declararse vigente en la decisión');
  assert.equal(observed.rpc[0].args.p_document_hash, CURRENT_DOCUMENT_HASH);
}

{
  const { database, observed } = fakeDatabase();
  await decide(database, { decision: 'no_go', justification: 'Riesgo técnico no aceptable' });
  assert.equal(observed.rpc.length, 1);
  assert.equal(observed.rpc[0].args.p_preparation, null, 'NO GO must not build a preparation');
  assert.equal(observed.rpc[0].args.p_justification, 'Riesgo técnico no aceptable');
  assert.equal(observed.rpc[0].args.p_agt002_items, null, 'NO GO must never derive an AGT-002 handoff batch');
}

// --- fase 3A: AGT-002 dossier handoff batch, derived server-side from the exact anchored run ---

// Expone exactamente las 19 claves cerradas de la proyección §6.4 (necesarias para
// buildActionableReviewIntegralUnitSource) y también las que exige la elegibilidad estructural de
// deriveAgt002GenericDecisionReview — mismo patrón que tests/agt002-dossier-handoff.test.mjs.
const V3_UNIT_FINANCIAL = Object.freeze({
  unit_id: 'unit-financial-1',
  unit_kind: 'tender_requirement',
  requirement_id: 'financial-working-capital',
  category: 'financial_execution',
  sequence: 1,
  title: 'Capital de trabajo mínimo exigido',
  assessment_mode: 'abstained',
  conclusion: { status: 'insufficient_evidence', confidence: 'unavailable', summary: 'El capital de trabajo debe revisarse.' },
  blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'La suficiencia financiera no está verificada.' },
  evidence_state: { applicability: 'applicable', compliance: 'pending_review' },
  evidence_refs: Object.freeze([{ source_type: 'tender_document', ref: 'evidence:chunk:doc-1:p1:s1:c0', purpose: 'requirement_basis' }]),
  missing_evidence: Object.freeze([{
    missing_id: 'missing-financial-review',
    needed_source_type: 'company_evidence',
    evidence_class_id: 'financial_statements',
    reason: 'Estados financieros revisados por una persona autorizada.',
    critical: true,
  }]),
  commercial_impact: { level: 'high', dimension: 'eligibility', summary: 'Puede impedir acreditar la capacidad financiera.' },
  legal_assessment: null,
  actions: Object.freeze([{
    action_id: 'action-review-financials',
    action_type: 'verify_validity',
    summary: 'Revisar los estados financieros y el capital de trabajo.',
    priority: 'critical',
    suggested_role: 'financial',
    basis_unit_id: 'unit-financial-1',
    external_side_effect: false,
  }]),
  milestone: null,
  escalation: null,
  closure: { status: 'open', condition: 'Revisión humana satisfactoria.', evidence_required: ['Estados financieros'] },
  human_validation: { required: true, status: 'pending', reason: 'Pendiente de revisión humana.' },
});

function v3ReadyResult(unitOverrides = {}, { decisionReady = true } = {}) {
  const unit = { ...V3_UNIT_FINANCIAL, ...unitOverrides };
  return {
    integral_analysis: {
      contract_version: 'agt002-integral-analysis-v3',
      coverage: {
        analyzed_requirement_ids: [unit.requirement_id],
        expected_requirement_ids: [unit.requirement_id],
      },
      analysis_units: [unit],
    },
    evidence_coverage: {
      tender_requirement_inventory: {
        inventory_version: 'tender_requirement_inventory.v1',
        decision_ready: decisionReady,
        expedient_coverage: { total_source_units: 1, dispositioned_source_units: 1 },
        analyzed_coverage: { total_source_units: 1, dispositioned_source_units: 1 },
      },
    },
  };
}

// `canonical` es una columna real de psi_tender_analysis_runs, no un campo sintetizado por el
// servidor: la derivación del traspaso hace su propia lectura canónica (canonicalOnly) y exige
// canonical === true, así que el fixture debe declararlo igual que la fila de base de datos.
function v3Run(result, overrides = {}) {
  return {
    id: ANALYSIS_RUN_ID,
    snapshot_id: '66666666-6666-4666-8666-666666666666',
    opportunity_id: OPPORTUNITY_ID,
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    canonical: true,
    critical_open_count: 0,
    result,
    created_at: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

{
  // Ready V3 analysis: the RPC receives exactly the closed SQL shape, mapped from the pure
  // deriveAgt002DossierHandoff item (presentation/source flattened, origin/item_type dropped).
  const { database, observed } = fakeDatabase({ runs: [v3Run(v3ReadyResult())] });
  await decide(database);
  const items = observed.rpc[0].args.p_agt002_items;
  assert.equal(Array.isArray(items), true, 'a ready V3 analysis must derive an explicit batch');
  assert.equal(
    observed.rpc[0].args.p_analysis_run_id, ANALYSIS_RUN_ID,
    'a batch may only travel with the run the decision itself anchors — never alongside a null anchor',
  );
  assert.equal(items.length, 1);
  assert.match(items[0].source_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(items[0], {
    item_key: 'agt002_post_go:financial-working-capital',
    required: true,
    status: 'pendiente',
    title: 'Capital de trabajo mínimo exigido',
    instruction: 'Revisar los estados financieros y el capital de trabajo.',
    source_kind: 'integral_unit',
    source_id: 'unit-financial-1',
    requirement_id: 'financial-working-capital',
    source_hash: items[0].source_hash,
  });
}

{
  // Trust boundary: a forged agt002_items/source_hash/title in the request body is never even
  // read — the batch is derived exclusively server-side from the exact anchored analysis run.
  const { database, observed } = fakeDatabase({ runs: [v3Run(v3ReadyResult())] });
  await decide(database, {
    agt002_items: [{ item_key: 'agt002_post_go:forged', title: 'Forjado', source_hash: 'f'.repeat(64) }],
    source_hash: 'f'.repeat(64),
    title: 'Forjado',
  });
  const items = observed.rpc[0].args.p_agt002_items;
  assert.equal(items.length, 1);
  assert.equal(items[0].item_key, 'agt002_post_go:financial-working-capital');
  assert.notEqual(items[0].source_hash, 'f'.repeat(64));
  assert.notEqual(items[0].title, 'Forjado');
}

{
  // Trust boundary: the batch only ever comes from the run the RPC itself will bind
  // (p_analysis_run_id === the submitted, exact-current run) — never a different run's payload.
  const otherRun = '99999999-3333-4333-8333-33333333333c';
  const { database, observed } = fakeDatabase({ runs: [v3Run(v3ReadyResult(), { id: otherRun })] });
  await decide(database); // submits ANALYSIS_RUN_ID, but only otherRun exists as the current run.
  assert.equal(observed.rpc[0].args.p_analysis_run_id, null, 'a non-matching submitted run must not bind');
  assert.equal(observed.rpc[0].args.p_agt002_items, null, 'a batch must never be derived from a run other than the exact one being recorded');
}

{
  // Non-canonical run: a run carrying a structurally complete, decision-ready V3 envelope but
  // whose `canonical` column is not true must never derive a batch. Canonicity is read from the
  // run, never inferred from the shape of its payload.
  const { database, observed } = fakeDatabase({ runs: [v3Run(v3ReadyResult(), { canonical: false })] });
  await decide(database);
  assert.equal(observed.rpc.length, 1, 'the decision itself is still recorded');
  assert.equal(observed.rpc[0].args.p_agt002_items, null, 'a non-canonical run must never derive an AGT-002 handoff batch');
}

{
  // Same, for a run whose canonical column is simply absent/null: fail closed, never assume.
  const { database, observed } = fakeDatabase({ runs: [v3Run(v3ReadyResult(), { canonical: null })] });
  await decide(database);
  assert.equal(observed.rpc[0].args.p_agt002_items, null, 'an unknown canonical flag must never derive a batch');
}

{
  // Coverage not decision_ready: a structurally V3 analysis that has not reached
  // ready_for_human_review must send null, exactly like a missing/legacy analysis.
  const { database, observed } = fakeDatabase({ runs: [v3Run(v3ReadyResult({}, { decisionReady: false }))] });
  await decide(database);
  assert.equal(observed.rpc[0].args.p_agt002_items, null, 'a V3 analysis whose coverage is not decision_ready must send null');
}

{
  // Malformed/ambiguous union: a finding-eligible unit whose unit_kind is not tender_requirement
  // can never satisfy deriveAgt002DossierHandoff's union — this must fail closed and MUST NOT
  // reach the RPC at all (no GO gets recorded on an unsafe derivation).
  const { database, observed } = fakeDatabase({ runs: [v3Run(v3ReadyResult({ unit_kind: 'strategic_consideration' }))] });
  await assert.rejects(() => decide(database), /sin unidad V3 tender_requirement elegible/i);
  assert.equal(observed.rpc.length, 0, 'a malformed/ambiguous selector union must never register the GO decision');
}

{
  const { database, observed } = fakeDatabase({
    preparationCreated: false,
    preparationId: HISTORICAL_PREPARATION.interaction_id,
    preparations: [HISTORICAL_PREPARATION, SQL_CURRENT_PREPARATION],
  });
  const result = await decide(database);
  assert.equal(observed.rpc.length, 1);
  assert.deepEqual(result.preparation, HISTORICAL_PREPARATION, 'reused preparation must return the exact persisted historical interaction by preparation_id');
  assert.notEqual(result.preparation, observed.rpc[0].args.p_preparation, 'reused preparation must not pretend the newly-built payload persisted');
}

{
  const history = [{
    id: '77777777-7777-4777-8777-777777777777',
    opportunity_id: OPPORTUNITY_ID,
    tender_id: TENDER_ID,
    decision: 'go',
    analysis_interaction_id: LEGACY_ANALYSIS_INTERACTION_ID,
    analysis_run_id: ANALYSIS_RUN_ID,
    decided_at: '2026-07-10T00:00:00.000Z',
  }];
  const { database } = fakeDatabase({
    preparationCreated: false,
    preparationId: SQL_CURRENT_PREPARATION.interaction_id,
    preparations: [SQL_CURRENT_PREPARATION, CREATED_AT_CURRENT_PREPARATION],
    history,
  });
  const result = await decide(database);
  assert.equal(result.decision.preparation_id, SQL_CURRENT_PREPARATION.interaction_id);
  assert.deepEqual(result.preparation, SQL_CURRENT_PREPARATION, 'POST must return the RPC-selected interaction, not the newest created_at row');
  const readResult = await getTenderGoNoGoDecision(database, OPPORTUNITY_ID, directorProfile);
  assert.deepEqual(readResult.preparation, SQL_CURRENT_PREPARATION, 'GET preparation must use occurred_at DESC and interaction_id DESC, not created_at');
  assert.equal(readResult.history[0].analysis_interaction_id, LEGACY_ANALYSIS_INTERACTION_ID, 'history keeps legacy analysis linkage readable');
  assert.equal(readResult.history[0].analysis_run_id, ANALYSIS_RUN_ID, 'history exposes the typed analysis-run linkage');
}

{
  const noGo = { id: '99999999-9999-4999-8999-999999999998', opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, decision: 'no_go', decided_at: '2026-07-11T00:00:00.000Z' };
  const go = { id: '99999999-9999-4999-8999-999999999997', opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, decision: 'go', decided_at: '2026-07-10T00:00:00.000Z' };
  const { database } = fakeDatabase({ preparations: [HISTORICAL_PREPARATION], history: [noGo, go] });
  const result = await getTenderGoNoGoDecision(database, OPPORTUNITY_ID, directorProfile);
  assert.equal(result.decision.decision, 'no_go');
  assert.equal(result.preparation, null, 'a current NO_GO cannot expose historical preparation');
  await assert.rejects(() => requireTenderGoForPreparation(database, OPPORTUNITY_ID, directorProfile), error => error?.status === 409, 'preparation notes must reject a current NO_GO before insert');
}

{
  const root = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, decision: 'go', decided_at: '2026-07-23T10:00:00Z', supersedes_decision_id: null };
  const leaf = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, decision: 'no_go', decided_at: '2026-07-23T09:00:00Z', supersedes_decision_id: root.id };
  const { database } = fakeDatabase({ preparations: [HISTORICAL_PREPARATION], history: [root, leaf] });
  const payload = await getTenderGoNoGoDecision(database, OPPORTUNITY_ID, directorProfile);
  assert.equal(payload.decision.id, leaf.id, 'read side must choose the supersession leaf even when its timestamp is older');
  assert.equal(payload.preparation, null, 'a leaf NO GO must hide prior preparation');
}

for (const input of [
  { opportunity_id: 'invalid', decision: 'go', analysis_run_id: ANALYSIS_RUN_ID, justification: 'because' },
  { opportunity_id: OPPORTUNITY_ID, decision: 'unknown', analysis_run_id: ANALYSIS_RUN_ID, justification: 'because' },
  { opportunity_id: OPPORTUNITY_ID, decision: 'go', analysis_run_id: 'not-a-uuid', justification: 'because' },
]) {
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => callTenderGoNoGoDecision(database, input, directorProfile), /oportunidad válida|decisión debe ser go o no_go|análisis válido/i);
  assert.equal(observed.targetAccesses, 0, 'invalid opportunity, decision, or typed run must fail before target database access');
  assert.equal(observed.rpc.length, 0);
}

{
  const { database, observed } = fakeDatabase();
  await decide(database, { analysis_run_id: ANALYSIS_RUN_ID.toUpperCase() });
  assert.equal(observed.rpc.length, 1, 'uppercase UUID spelling must reach the decision RPC');
  assert.equal(observed.rpc[0].args.p_analysis_run_id, ANALYSIS_RUN_ID, 'valid UUID input must normalize before current-run comparison and RPC submission');
}

for (const profile of [
  { ...directorProfile, identity_type: 'agent' },
  { ...directorProfile, permissions: [] },
]) {
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => decide(database, {}, profile), /autorización/i);
  assert.equal(observed.targetAccesses, 0, 'unauthorized actors must fail before target database access');
  assert.equal(observed.rpc.length, 0);
}

{
  const staleSnapshot = { id: '12121212-1212-4121-8121-121212121212', opportunity_id: OPPORTUNITY_ID, created_at: '2026-07-02T00:00:00.000Z' };
  const currentSnapshot = { id: '13131313-1313-4131-8131-131313131313', opportunity_id: OPPORTUNITY_ID, created_at: '2026-07-03T00:00:00.000Z' };
  const { database, observed } = fakeDatabase({
    snapshots: [staleSnapshot, currentSnapshot],
    states: [{ opportunity_id: OPPORTUNITY_ID, current_snapshot_id: currentSnapshot.id, refresh_in_progress: false }],
    runs: [
      { id: STALE_ANALYSIS_RUN_ID, snapshot_id: staleSnapshot.id, opportunity_id: OPPORTUNITY_ID, status: 'completed', result: { recommendation: 'GO' }, created_at: '2026-07-04T00:00:00.000Z' },
      { id: ANALYSIS_RUN_ID, snapshot_id: currentSnapshot.id, opportunity_id: OPPORTUNITY_ID, status: 'completed', result: { recommendation: 'GO' }, created_at: '2026-07-03T00:00:00.000Z' },
    ],
  });
  await decide(database, { analysis_run_id: STALE_ANALYSIS_RUN_ID });
  assert.equal(observed.rpc.length, 1, 'a stale typed run remains auditable and cannot block an authorized human');
  const payload = await getTenderGoNoGoDecision(database, OPPORTUNITY_ID, directorProfile);
  assert.equal(payload.analysis.run_id, ANALYSIS_RUN_ID, 'read side reports the completed run for the latest snapshot, not a newer stale-snapshot run');
}

for (const path of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /import \{ callTenderGoNoGoDecision, getTenderGoNoGoDecision, requireTenderGoForPreparation, syncTenderDossierFromAgt002 \} from '\.\.\/tender-go-no-go-rpc\.js';/);
  assert.match(source, /app\.get\('\/api\/tender-go-no-go-decision'/);
  assert.match(source, /app\.post\('\/api\/tender-go-no-go-decision'/);
  const decisionRoute = source.match(/app\.post\('\/api\/tender-go-no-go-decision'[\s\S]*?\n}\);/);
  assert.ok(decisionRoute, 'GO/NO GO route must remain available');
  assert.match(
    decisionRoute[0],
    /const database = requireDb\(\);[\s\S]*await requireTenderAnalysisFoundation\(database\);[\s\S]*callTenderGoNoGoDecision\(database, req\.body \|\| \{\}, currentProfile\)/,
    'GO/NO GO must verify migration 025 before recording the human decision',
  );
  const alias = source.match(/app\.post\('\/api\/tender-offer-preparation-approve'[\s\S]*?\n}\);/);
  assert.ok(alias, 'legacy alias must remain explicit');
  assert.match(alias[0], /getAuthContext\(req\)/, 'legacy alias still authenticates');
  assert.match(alias[0], /status\(410\)\.json\(\{ error: 'Use Registrar GO para iniciar la preparación de oferta\.' \}\)/);
  assert.doesNotMatch(alias[0], /requireDb|\.from\(|\.rpc\(|storage/, 'legacy alias must not access database or storage');
  const noteRoute = source.match(/app\.post\('\/api\/tender-offer-preparation-note'[\s\S]*?\n}\);/);
  assert.ok(noteRoute, 'preparation-note route must remain available');
  assert.match(noteRoute[0], /await requireTenderGoForPreparation\(database, opportunityId, currentProfile\)/, 'preparation notes must validate the current GO before insert');
}

console.log('tender go/no-go API checks passed');
