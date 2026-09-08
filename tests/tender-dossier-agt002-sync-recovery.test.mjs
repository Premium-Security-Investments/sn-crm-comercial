import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { syncTenderDossierFromAgt002 } from '../tender-go-no-go-rpc.js';

// Fase 3B: recovery server-owned de psi_sync_agt002_post_go_checklist para una decisión GO ya
// registrada. A diferencia de deriveAgt002ItemsForGoDecision (que devuelve null como no-op
// legítimo al registrar una decisión NO-GO o un análisis todavía no listo), esta ruta es
// exclusivamente invocada por un humano que pide sincronizar un GO ya vigente: cada uno de esos
// mismos estados debe fallar cerrado (409), nunca degradar en silencio.

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const TENDER_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const DECISION_ID = '77777777-7777-4777-8777-777777777777';
const SUPERSEDED_DECISION_ID = '66666666-6666-4666-8666-666666666666';
const ANALYSIS_RUN_ID = '33333333-3333-4333-8333-33333333333a';
const OTHER_RUN_ID = '99999999-3333-4333-8333-33333333333c';
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';

const directorProfile = {
  id: ACTOR_ID,
  active: true,
  identity_type: 'human',
  role: 'director',
  permissions: ['licitaciones'],
  areas: [{ area_code: 'licitaciones', subarea_code: null }],
  full_name: 'Directora de Licitaciones',
};

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

function fakeDatabase({
  history = [{
    id: DECISION_ID,
    opportunity_id: OPPORTUNITY_ID,
    tender_id: TENDER_ID,
    decision: 'go',
    analysis_run_id: ANALYSIS_RUN_ID,
    supersedes_decision_id: null,
    decided_at: '2026-07-10T00:00:00.000Z',
  }],
  snapshots = [{ id: SNAPSHOT_ID, opportunity_id: OPPORTUNITY_ID, document_hash: '0'.repeat(64), created_at: '2026-07-03T00:00:00.000Z' }],
  states = [{ opportunity_id: OPPORTUNITY_ID, current_snapshot_id: SNAPSHOT_ID, refresh_in_progress: false }],
  runs = [{
    id: ANALYSIS_RUN_ID,
    snapshot_id: SNAPSHOT_ID,
    opportunity_id: OPPORTUNITY_ID,
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    canonical: true,
    critical_open_count: 0,
    result: v3ReadyResult(),
    created_at: '2026-07-03T00:00:00.000Z',
  }],
  rpcResult = { opportunity_id: OPPORTUNITY_ID, decision_id: DECISION_ID, analysis_run_id: ANALYSIS_RUN_ID, items: [] },
} = {}) {
  const observed = { rpc: [], targetAccesses: 0, tables: [] };
  const targetAccess = () => { observed.targetAccesses += 1; };
  const database = {
    from(table) {
      observed.tables.push(table);
      if (table === 'v_psi_sales_opportunity_enriched') return query([{ id: OPPORTUNITY_ID, service_type_code: 'licitacion_publica' }], targetAccess);
      if (table === 'psi_public_tenders') return query([{ id: TENDER_ID, converted_opportunity_id: OPPORTUNITY_ID }], targetAccess);
      if (table === 'psi_tender_go_no_go_decisions') return query(history, targetAccess);
      if (table === 'psi_tender_document_state') return query(states, targetAccess);
      if (table === 'psi_tender_document_snapshots') return query(snapshots, targetAccess);
      if (table === 'psi_tender_analysis_runs') return query(runs, targetAccess);
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      observed.rpc.push({ name, args });
      return { data: rpcResult, error: null };
    },
  };
  return { database, observed };
}

function sync(database, input = {}, profile = directorProfile) {
  return syncTenderDossierFromAgt002(database, { opportunity_id: OPPORTUNITY_ID, ...input }, profile);
}

// --- autorización antes de acceso a base de datos ---

for (const profile of [
  { ...directorProfile, identity_type: 'agent' },
  { ...directorProfile, permissions: [] },
]) {
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => sync(database, {}, profile), /autorización/i);
  assert.equal(observed.targetAccesses, 0, 'un actor no autorizado no puede llegar a la base de datos');
  assert.equal(observed.rpc.length, 0);
}

// --- cuerpo cerrado: sólo opportunity_id ---

for (const forgedInput of [
  { agt002_items: [{ item_key: 'agt002_post_go:forged', title: 'Forjado', source_hash: 'f'.repeat(64) }] },
  { source_hash: 'f'.repeat(64) },
  { title: 'Forjado' },
  { decision_id: DECISION_ID },
  { analysis_run_id: ANALYSIS_RUN_ID },
]) {
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => sync(database, forgedInput), /opportunity_id/);
  assert.equal(observed.targetAccesses, 0, 'una clave ajena en el cuerpo nunca debe alcanzar la base de datos');
  assert.equal(observed.rpc.length, 0);
}

{
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => syncTenderDossierFromAgt002(database, { opportunity_id: 'invalid' }, directorProfile), /oportunidad válida/i);
  assert.equal(observed.targetAccesses, 0);
  assert.equal(observed.rpc.length, 0);
}

// --- feliz: GO vigente + run exacto canónico completo + V3 listo ---

{
  const { database, observed } = fakeDatabase();
  await sync(database);
  assert.equal(observed.rpc.length, 1, 'debe invocar exactamente la RPC de sincronización');
  assert.equal(observed.rpc[0].name, 'psi_sync_agt002_post_go_checklist');
  assert.deepEqual(observed.rpc[0].args, {
    p_opportunity_id: OPPORTUNITY_ID,
    p_actor_id: ACTOR_ID,
    p_decision_id: DECISION_ID,
    p_analysis_run_id: ANALYSIS_RUN_ID,
    p_items: observed.rpc[0].args.p_items,
  });
  const items = observed.rpc[0].args.p_items;
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

// --- no-go vigente: fail-closed 409, sin RPC ---

{
  const noGo = [{
    id: DECISION_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, decision: 'no_go',
    analysis_run_id: null, supersedes_decision_id: null, decided_at: '2026-07-10T00:00:00.000Z',
  }];
  const { database, observed } = fakeDatabase({ history: noGo });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /GO vigente/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

// --- sin ninguna decisión: fail-closed 409 ---

{
  const { database, observed } = fakeDatabase({ history: [] });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /GO vigente/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

// --- GO vigente superseded por una decisión posterior: el histórico ya no vale ---

{
  const history = [
    { id: SUPERSEDED_DECISION_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, decision: 'go', analysis_run_id: ANALYSIS_RUN_ID, supersedes_decision_id: null, decided_at: '2026-07-08T00:00:00.000Z' },
    { id: DECISION_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, decision: 'no_go', analysis_run_id: null, supersedes_decision_id: SUPERSEDED_DECISION_ID, decided_at: '2026-07-10T00:00:00.000Z' },
  ];
  const { database, observed } = fakeDatabase({ history });
  await assert.rejects(() => sync(database), error => error?.status === 409);
  assert.equal(observed.rpc.length, 0, 'una decisión GO ya superada nunca puede sincronizar');
}

// --- GO vigente sin análisis anclado: fail-closed 409 ---

{
  const history = [{ id: DECISION_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, decision: 'go', analysis_run_id: null, supersedes_decision_id: null, decided_at: '2026-07-10T00:00:00.000Z' }];
  const { database, observed } = fakeDatabase({ history });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /análisis anclado/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

// --- el análisis vigente ya no es el mismo run anclado a la decisión ---

{
  const { database, observed } = fakeDatabase({
    runs: [{
      id: OTHER_RUN_ID, snapshot_id: SNAPSHOT_ID, opportunity_id: OPPORTUNITY_ID, producer: 'AGT-002', method: 'agent_ai',
      status: 'completed', canonical: true, critical_open_count: 0, result: v3ReadyResult(), created_at: '2026-07-03T00:00:00.000Z',
    }],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /vigente, canónico y completado/i.test(error.message));
  assert.equal(observed.rpc.length, 0, 'un run distinto al anclado por la decisión nunca puede sincronizar');
}

// --- refresco documental en curso: el análisis anclado ya no cuenta como vigente ---

{
  const { database, observed } = fakeDatabase({
    states: [{ opportunity_id: OPPORTUNITY_ID, current_snapshot_id: SNAPSHOT_ID, refresh_in_progress: true }],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409);
  assert.equal(observed.rpc.length, 0);
}

// --- run no canónico: fail-closed 409 ---

{
  const { database, observed } = fakeDatabase({
    runs: [{
      id: ANALYSIS_RUN_ID, snapshot_id: SNAPSHOT_ID, opportunity_id: OPPORTUNITY_ID, producer: 'AGT-002', method: 'agent_ai',
      status: 'completed', canonical: false, critical_open_count: 0, result: v3ReadyResult(), created_at: '2026-07-03T00:00:00.000Z',
    }],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409);
  assert.equal(observed.rpc.length, 0);
}

// --- análisis legado (sin sobre V3): fail-closed 409, nunca un no-op silencioso ---

{
  const { database, observed } = fakeDatabase({
    runs: [{
      id: ANALYSIS_RUN_ID, snapshot_id: SNAPSHOT_ID, opportunity_id: OPPORTUNITY_ID, producer: 'siio_rules_v1', method: 'rules',
      status: 'completed', canonical: true, critical_open_count: 0, result: { recommendation: 'GO' }, created_at: '2026-07-03T00:00:00.000Z',
    }],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /integral V3/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

// --- pausado: cobertura no decision_ready, fail-closed 409 (no un no-op) ---

{
  const { database, observed } = fakeDatabase({
    runs: [{
      id: ANALYSIS_RUN_ID, snapshot_id: SNAPSHOT_ID, opportunity_id: OPPORTUNITY_ID, producer: 'AGT-002', method: 'agent_ai',
      status: 'completed', canonical: true, critical_open_count: 0, result: v3ReadyResult({}, { decisionReady: false }), created_at: '2026-07-03T00:00:00.000Z',
    }],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /listo para el traspaso/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

// --- unión malformada/ambigua: el error propio del selector propaga sin envolverse en 409 ---

{
  const { database, observed } = fakeDatabase({
    runs: [{
      id: ANALYSIS_RUN_ID, snapshot_id: SNAPSHOT_ID, opportunity_id: OPPORTUNITY_ID, producer: 'AGT-002', method: 'agent_ai',
      status: 'completed', canonical: true, critical_open_count: 0,
      result: v3ReadyResult({ unit_kind: 'strategic_consideration' }), created_at: '2026-07-03T00:00:00.000Z',
    }],
  });
  await assert.rejects(() => sync(database), /sin unidad V3 tender_requirement elegible/i);
  assert.equal(observed.rpc.length, 0);
}

// --- ruteo server/serverless: mismo POST, sin GET, mismo helper cableado ---

for (const path of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /import \{ callTenderGoNoGoDecision, getTenderGoNoGoDecision, requireTenderGoForPreparation, syncTenderDossierFromAgt002 \} from '\.\.\/tender-go-no-go-rpc\.js';/);
  assert.match(source, /app\.post\('\/api\/tender-dossier-agt002-sync'/);
  assert.doesNotMatch(source, /app\.get\('\/api\/tender-dossier-agt002-sync'/, 'esta ruta de recovery no puede exponer un GET');
  const route = source.match(/app\.post\('\/api\/tender-dossier-agt002-sync'[\s\S]*?\n}\);/);
  assert.ok(route, 'la ruta de recovery del expediente AGT-002 debe existir');
  assert.match(
    route[0],
    /getAuthContext\(req\)[\s\S]*const database = requireDb\(\);[\s\S]*await requireTenderAnalysisFoundation\(database\);[\s\S]*syncTenderDossierFromAgt002\(database, req\.body \|\| \{\}, currentProfile\)/,
    'la ruta debe autenticar, verificar la fundación y delegar en el helper server-owned',
  );
  assert.equal(
    (source.match(/app\.post\('\/api\/tender-dossier-agt002-sync'/g) || []).length,
    1,
    'sólo puede existir un único POST para esta ruta',
  );
}

// --- tipos: TenderDossierItem proyecta instruction/analysis_source alineados a 082 §5 ---

{
  const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');
  assert.match(types, /export type TenderDossierItemAnalysisSource = \{/);
  for (const field of ['decision_id: string', 'analysis_run_id: string', 'source_id: string', 'requirement_id: string \\| null']) {
    assert.match(types, new RegExp(field), `TenderDossierItemAnalysisSource debe declarar ${field}`);
  }
  const item = types.match(/export type TenderDossierItem = \{[\s\S]*?\n\};/)?.[0] || '';
  assert.ok(item, 'TenderDossierItem debe seguir declarado');
  assert.match(item, /instruction: string \| null;/, 'TenderDossierItem debe declarar instruction');
  assert.match(item, /analysis_source: TenderDossierItemAnalysisSource \| null;/, 'TenderDossierItem debe declarar analysis_source');
  for (const preserved of ['id: string;', 'item_key: string;', 'title: string;', 'required: boolean;', 'status: TenderDossierItemStatus;', 'latest_evidence:']) {
    assert.match(item, new RegExp(preserved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `TenderDossierItem no puede perder ${preserved}`);
  }
}

console.log('tender dossier AGT-002 recovery sync checks passed');
