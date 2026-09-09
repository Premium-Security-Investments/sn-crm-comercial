import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { syncTenderDossierFromAgt002 } from '../tender-go-no-go-rpc.js';
import { AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION } from '../agt002-preview-contract.js';
import { AGT002_INTEGRAL_V3_POLICY_VERSION } from '../agt002-preview-runtime.js';

// Fase 3B: recovery server-owned de psi_sync_agt002_post_go_checklist para una decisión GO ya
// registrada. A diferencia de deriveAgt002ItemsForGoDecision (que devuelve null como no-op
// legítimo al registrar una decisión NO-GO, un análisis todavía no listo o una corrida legada),
// esta ruta es exclusivamente invocada por un humano que pide sincronizar un GO ya vigente: cada
// uno de esos mismos estados debe fallar cerrado (409), nunca degradar en silencio.
//
// Es además la ÚNICA ruta que declara `humanGoGranted: true` al selector, porque aquí el GO ya está
// persistido y vigente: el bypass legado del issue #187 no existe al registrar la decisión.

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

const AGT002_DOSSIER_SYNC_STAGE = 'agt002_dossier_sync';
const RUN_CREATED_AT = '2026-07-03T00:00:00.000Z';

// Corrida AGT-002 V3 válida por defecto: canónica, completada y vigente. Toda corrida usada como
// una corrida V3 válida en estos fixtures declara explícitamente su propia schema_version/
// policy_version y un completed_at igual a created_at — nunca los deja implícitos.
function baseValidRun(overrides = {}) {
  return {
    id: ANALYSIS_RUN_ID,
    snapshot_id: SNAPSHOT_ID,
    opportunity_id: OPPORTUNITY_ID,
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    canonical: true,
    critical_open_count: 0,
    result: v3ReadyResult(),
    created_at: RUN_CREATED_AT,
    schema_version: AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION,
    policy_version: AGT002_INTEGRAL_V3_POLICY_VERSION,
    completed_at: RUN_CREATED_AT,
    ...overrides,
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
  runs = [baseValidRun()],
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

// Caso REAL de Cali (issue #187): el GO vigente quedó registrado SIN analysis_run_id.
function unanchoredGoHistory() {
  return [{
    id: DECISION_ID,
    opportunity_id: OPPORTUNITY_ID,
    tender_id: TENDER_ID,
    decision: 'go',
    analysis_run_id: null,
    supersedes_decision_id: null,
    decided_at: '2026-07-10T00:00:00.000Z',
  }];
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

// --- RED: la identidad de versión y la completitud de la corrida seleccionada nunca se asumen ---
// Ninguno de estos campos se valida todavía en el servidor: cada caso debe fallar 409 ANTES de
// invocar la RPC, con `error.stage`/`error.code` estructurados — nunca degradar en silencio hacia
// un lote sintetizado sobre una corrida cuya versión o completitud no puede confirmarse.

{
  // schema_version distinto de la V3 vigente: un payload que no se autoidentifica como la V3
  // vigente nunca puede sustentar el traspaso, aunque el resto de la corrida luzca válida.
  const { database, observed } = fakeDatabase({ runs: [baseValidRun({ schema_version: '2.0.0' })] });
  await assert.rejects(() => sync(database), error => error?.status === 409
    && error?.stage === AGT002_DOSSIER_SYNC_STAGE
    && error?.code === 'schema_version_mismatch');
  assert.equal(observed.rpc.length, 0, 'un schema_version distinto nunca puede sincronizar');
}

{
  // policy_version distinto de la política vigente: la corrida pudo completarse bajo una política
  // ya reemplazada, así que tampoco puede sustentar el traspaso sin verificarlo primero.
  const { database, observed } = fakeDatabase({ runs: [baseValidRun({ policy_version: 'agt002-integral-v3-policy-v4' })] });
  await assert.rejects(() => sync(database), error => error?.status === 409
    && error?.stage === AGT002_DOSSIER_SYNC_STAGE
    && error?.code === 'policy_version_mismatch');
  assert.equal(observed.rpc.length, 0, 'un policy_version distinto nunca puede sincronizar');
}

for (const invalidCompletedAt of [null, 'no-es-una-fecha']) {
  // completed_at ausente o inválido: sin una fecha de finalización verificable no hay forma segura
  // de anclar el análisis a un instante concreto, mucho menos de compararlo contra el GO.
  const { database, observed } = fakeDatabase({ runs: [baseValidRun({ completed_at: invalidCompletedAt })] });
  await assert.rejects(() => sync(database), error => error?.status === 409
    && error?.stage === AGT002_DOSSIER_SYNC_STAGE
    && error?.code === 'completed_at_invalid');
  assert.equal(observed.rpc.length, 0, 'completed_at ausente o inválido nunca puede sincronizar');
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

// --- GO vigente sin análisis anclado sobre una corrida MODERNA (con evidence_coverage): el caso
// legado estricto del issue #187 no aplica, así que sigue siendo fail-closed 409 ---

{
  const { database, observed } = fakeDatabase({ history: unanchoredGoHistory() });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /análisis anclado/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

// --- el análisis vigente ya no es el mismo run anclado a la decisión ---

{
  const { database, observed } = fakeDatabase({
    runs: [baseValidRun({ id: OTHER_RUN_ID })],
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
    runs: [baseValidRun({ canonical: false })],
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
    runs: [baseValidRun({ result: v3ReadyResult({}, { decisionReady: false }) })],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /listo para el traspaso/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

// --- issue #187: recovery de una corrida V3 LEGADA (sin `result.evidence_coverage`) ---

// Idéntica a `v3ReadyResult` pero sin la clave `evidence_coverage`: la corrida es anterior a ese
// bloque, así que su cobertura no puede quedar lista jamás.
function v3LegacyResult(coverageOverrides = {}) {
  return {
    integral_analysis: {
      contract_version: 'agt002-integral-analysis-v3',
      coverage: {
        analyzed_requirement_ids: [V3_UNIT_FINANCIAL.requirement_id],
        expected_requirement_ids: [V3_UNIT_FINANCIAL.requirement_id],
        material_omissions: false,
        omission_reasons: [],
        ...coverageOverrides,
      },
      analysis_units: [V3_UNIT_FINANCIAL],
    },
  };
}

// Forma de PRODUCCIÓN del expediente legado: cinco requisitos DEL PLIEGO con el prefijo `sreq:` del
// manifiesto del expediente, cinco unidades V3 abiertas y, por tanto, cinco decision_questions
// genéricas. Ninguno de esos ids está —ni debe estar— en el catálogo global de materialidad por
// requisito gobernado de la empresa: el traspaso post-GO no depende de esa clasificación PRE-GO.
// Los títulos son neutros a propósito: el lote nunca se deriva del texto del pliego.
const PRODUCTION_REQUIREMENT_IDS = Object.freeze(['sreq:001', 'sreq:002', 'sreq:003', 'sreq:004', 'sreq:005']);

function productionUnit(requirementId, index) {
  const unitId = `unit-pliego-${index + 1}`;
  return {
    ...V3_UNIT_FINANCIAL,
    unit_id: unitId,
    requirement_id: requirementId,
    sequence: index + 1,
    title: `Requisito del pliego ${index + 1}`,
    actions: [{
      action_id: `action-pliego-${index + 1}`,
      action_type: 'verify_validity',
      summary: `Revisar el requisito del pliego ${index + 1} con la persona responsable.`,
      priority: 'critical',
      suggested_role: 'legal',
      basis_unit_id: unitId,
      external_side_effect: false,
    }],
  };
}

function productionUnits() {
  return PRODUCTION_REQUIREMENT_IDS.map((requirementId, index) => productionUnit(requirementId, index));
}

// Igual que `v3LegacyResult` (sin la propiedad `evidence_coverage`), pero con las cinco unidades.
function v3LegacyProductionResult(units = productionUnits()) {
  const requirementIds = units.map(unit => unit.requirement_id);
  return {
    integral_analysis: {
      contract_version: 'agt002-integral-analysis-v3',
      coverage: {
        analyzed_requirement_ids: requirementIds,
        expected_requirement_ids: requirementIds,
        // Forma REAL de Cali: la corrida de producción sí declara una omisión material, y la única
        // razón autorizada por el bypass legado (`lower_relevance`).
        material_omissions: true,
        omission_reasons: ['lower_relevance'],
      },
      analysis_units: units,
    },
  };
}

function legacyRun(result, overrides = {}) {
  return {
    id: ANALYSIS_RUN_ID,
    snapshot_id: SNAPSHOT_ID,
    opportunity_id: OPPORTUNITY_ID,
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    canonical: true,
    critical_open_count: 0,
    result,
    created_at: RUN_CREATED_AT,
    schema_version: AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION,
    policy_version: AGT002_INTEGRAL_V3_POLICY_VERSION,
    completed_at: RUN_CREATED_AT,
    ...overrides,
  };
}

{
  // GO vigente + corrida legada anclada: el recovery siembra el expediente con la misma forma
  // cerrada de siempre y sólo invoca la RPC de sincronización — nunca reescribe la decisión.
  const { database, observed } = fakeDatabase({ runs: [legacyRun(v3LegacyResult())] });
  await sync(database);
  assert.equal(observed.rpc.length, 1);
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
  assert.match(items[0].source_hash, /^[0-9a-f]{64}$/);
}

{
  // Sin GO vigente no hay recovery de la corrida legada: 409 fail-closed, sin RPC.
  const noGo = [{
    id: DECISION_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, decision: 'no_go',
    analysis_run_id: null, supersedes_decision_id: null, decided_at: '2026-07-10T00:00:00.000Z',
  }];
  const { database, observed } = fakeDatabase({ history: noGo, runs: [legacyRun(v3LegacyResult())] });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /GO vigente/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

{
  // El GO vigente debe anclar exactamente esta corrida canónica: otra corrida legada no sirve.
  const { database, observed } = fakeDatabase({ runs: [legacyRun(v3LegacyResult(), { id: OTHER_RUN_ID })] });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /vigente, canónico y completado/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

{
  // Corrida legada no canónica: 409 fail-closed.
  const { database, observed } = fakeDatabase({ runs: [legacyRun(v3LegacyResult(), { canonical: false })] });
  await assert.rejects(() => sync(database), error => error?.status === 409);
  assert.equal(observed.rpc.length, 0);
}

{
  // Corrida legada con omisiones materiales declaradas: 409 fail-closed, nunca un lote incompleto.
  const { database, observed } = fakeDatabase({ runs: [legacyRun(v3LegacyResult({ material_omissions: true }))] });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /listo para el traspaso/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

// --- issue #187, caso REAL de Cali: GO vigente con analysis_run_id NULL ---

{
  // RED: antes, un GO sin anclaje se rechazaba de inmediato ("no tiene un análisis anclado") y ese
  // expediente no podía sembrarse jamás. GREEN: con la corrida legada vigente (canónica, completada,
  // AGT-002/agent_ai, V3 y sin la propiedad `evidence_coverage`), el recovery deriva el lote y llama
  // a la RPC con el run que el propio servidor leyó — nunca uno recibido del cuerpo.
  const { database, observed } = fakeDatabase({
    history: unanchoredGoHistory(),
    runs: [legacyRun(v3LegacyResult())],
  });
  await sync(database);
  assert.equal(observed.rpc.length, 1);
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
  assert.match(items[0].source_hash, /^[0-9a-f]{64}$/);
}

{
  // Caso REAL de Cali con la FORMA DE PRODUCCIÓN: GO vigente con `analysis_run_id` NULL sobre una
  // corrida legada con cinco requisitos `sreq:*` del pliego y cinco unidades abiertas. El recovery
  // debe enviar los CINCO ítems, con identidad 1:1 con su unidad V3 y con el run que el propio
  // servidor leyó. Ningún `sreq:*` está en el catálogo global de materialidad: si esa clasificación
  // PRE-GO volviera a filtrar aquí, este expediente real se quedaría sin traspaso posible.
  const units = productionUnits();
  const { database, observed } = fakeDatabase({
    history: unanchoredGoHistory(),
    runs: [legacyRun(v3LegacyProductionResult(units))],
  });
  await sync(database);
  assert.equal(observed.rpc.length, 1);
  assert.equal(observed.rpc[0].name, 'psi_sync_agt002_post_go_checklist');
  assert.equal(observed.rpc[0].args.p_decision_id, DECISION_ID);
  assert.equal(observed.rpc[0].args.p_analysis_run_id, ANALYSIS_RUN_ID, 'el run del lote lo elige el servidor, no el cuerpo');
  const items = observed.rpc[0].args.p_items;
  assert.equal(items.length, 5, 'las cinco unidades abiertas se traspasan completas');
  assert.deepEqual(items.map(entry => entry.item_key), PRODUCTION_REQUIREMENT_IDS.map(id => `agt002_post_go:${id}`));
  items.forEach((entry, index) => {
    const unit = units[index];
    assert.deepEqual(entry, {
      item_key: `agt002_post_go:${unit.requirement_id}`,
      required: true,
      status: 'pendiente',
      title: unit.title,
      instruction: unit.actions[0].summary,
      source_kind: 'integral_unit',
      source_id: unit.unit_id,
      requirement_id: unit.requirement_id,
      source_hash: entry.source_hash,
    });
    assert.match(entry.source_hash, /^[0-9a-f]{64}$/);
  });
  assert.equal(new Set(items.map(entry => entry.source_hash)).size, 5, 'cada unidad V3 aporta su propia identidad canónica');
}

{
  // Misma forma de producción, pero con la propiedad `evidence_coverage` presente: la corrida sale
  // del caso legado estricto y el GO sin anclaje vuelve a ser fail-closed.
  const { database, observed } = fakeDatabase({
    history: unanchoredGoHistory(),
    runs: [legacyRun({ ...v3LegacyProductionResult(), evidence_coverage: null })],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /evidence_coverage/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

{
  // Presencia de `evidence_coverage` —aunque su valor sea null— NO es el caso legado: fail-closed.
  for (const presentCoverage of [{ evidence_coverage: null }, { evidence_coverage: {} }, { evidence_coverage: false }]) {
    const { database, observed } = fakeDatabase({
      history: unanchoredGoHistory(),
      runs: [legacyRun({ ...v3LegacyResult(), ...presentCoverage })],
    });
    await assert.rejects(
      () => sync(database),
      error => error?.status === 409 && /evidence_coverage/i.test(error.message),
    );
    assert.equal(observed.rpc.length, 0, 'una cobertura presente nunca habilita el traspaso sin anclaje');
  }
}

{
  // Corrida vigente que no es AGT-002/agent_ai: fail-closed, aunque venga marcada como canónica.
  const { database, observed } = fakeDatabase({
    history: unanchoredGoHistory(),
    runs: [legacyRun(v3LegacyResult(), { producer: 'siio_rules_v1', method: 'rules' })],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /AGT-002/.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

{
  // Sin corrida canónica vigente (no canónica) no hay nada que pueda sustentar el traspaso legado.
  const { database, observed } = fakeDatabase({
    history: unanchoredGoHistory(),
    runs: [legacyRun(v3LegacyResult(), { canonical: false })],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /vigente, canónico y completado/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

{
  // Refresco documental en curso: la corrida deja de ser vigente, así que tampoco hay traspaso.
  const { database, observed } = fakeDatabase({
    history: unanchoredGoHistory(),
    runs: [legacyRun(v3LegacyResult())],
    states: [{ opportunity_id: OPPORTUNITY_ID, current_snapshot_id: SNAPSHOT_ID, refresh_in_progress: true }],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409);
  assert.equal(observed.rpc.length, 0);
}

{
  // Corrida legada con omisiones materiales declaradas: el selector no produce lote listo, 409.
  const { database, observed } = fakeDatabase({
    history: unanchoredGoHistory(),
    runs: [legacyRun(v3LegacyResult({ material_omissions: true }))],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409 && /listo para el traspaso/i.test(error.message));
  assert.equal(observed.rpc.length, 0);
}

{
  // Análisis legado sin sobre V3 (reglas): 409, nunca un lote.
  const { database, observed } = fakeDatabase({
    history: unanchoredGoHistory(),
    runs: [legacyRun({ recommendation: 'GO' })],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409);
  assert.equal(observed.rpc.length, 0);
}

// --- RED: contrato temporal seguro del bypass legado sin anclaje — el análisis debe haberse
// completado a más tardar cuando el humano otorgó el GO, nunca después. Sin anclaje explícito el
// servidor elige la corrida canónica vigente por sí mismo, así que debe probar que esa corrida ya
// existía (completada) en el instante del GO; nunca puede atar una decisión humana pasada a un
// análisis que, de hecho, es posterior a ella. ---

{
  const { database, observed } = fakeDatabase({
    history: unanchoredGoHistory(),
    runs: [legacyRun(v3LegacyResult(), { completed_at: '2026-07-11T00:00:00.000Z' })],
  });
  await assert.rejects(() => sync(database), error => error?.status === 409
    && error?.stage === AGT002_DOSSIER_SYNC_STAGE
    && error?.code === 'unanchored_run_completed_after_go');
  assert.equal(observed.rpc.length, 0, 'una corrida sin anclaje completada después del GO nunca puede sincronizar');
}

// --- RED: columnas seleccionadas de psi_tender_analysis_runs. El fake query de este archivo no
// registra los argumentos de `.select(...)` (ver `query()` arriba: `select()` ignora su argumento),
// así que esta garantía se prueba a nivel de fuente contra la única función que arma esa lista de
// columnas para la lectura de la corrida vigente.
{
  const source = readFileSync(new URL('../tender-analysis-foundation.js', import.meta.url), 'utf8');
  const columns = source.match(/function currentAnalysisRunColumns\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(columns, 'currentAnalysisRunColumns debe seguir declarada en tender-analysis-foundation.js');
  for (const column of ['schema_version', 'policy_version', 'completed_at']) {
    assert.match(columns, new RegExp(`'${column}'`), `la lectura de la corrida vigente debe seleccionar ${column}`);
  }
}

// --- RED: guardia de deriva de constantes. schema_version/policy_version deben leerse de sus
// módulos canónicos (agt002-integral-analysis-contract.js / agt002-preview-runtime.js) — nunca
// de una copia local, que puede desincronizarse en silencio de la versión vigente real. ---

{
  const source = readFileSync(new URL('../tender-go-no-go-rpc.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /import\s*\{[^}]*\bAGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION\b[^}]*\}\s*from\s*['"]\.\/agt002-preview-contract\.js['"]/,
    'tender-go-no-go-rpc.js debe importar AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION desde su módulo canónico',
  );
  assert.match(
    source,
    /import\s*\{[^}]*\bAGT002_INTEGRAL_V3_POLICY_VERSION\b[^}]*\}\s*from\s*['"]\.\/agt002-preview-runtime\.js['"]/,
    'tender-go-no-go-rpc.js debe importar AGT002_INTEGRAL_V3_POLICY_VERSION desde su módulo canónico',
  );
  assert.match(
    source,
    /run\?\.schema_version\s*!==\s*AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION/,
    'la verificación de metadata debe comparar contra la constante canónica de schema_version',
  );
  assert.match(
    source,
    /run\?\.policy_version\s*!==\s*AGT002_INTEGRAL_V3_POLICY_VERSION/,
    'la verificación de metadata debe comparar contra la constante canónica de policy_version',
  );
  assert.doesNotMatch(
    source,
    /const\s+AGT002_V3_SCHEMA_VERSION\s*=/,
    'tender-go-no-go-rpc.js no puede declarar una copia local de AGT002_V3_SCHEMA_VERSION',
  );
  assert.doesNotMatch(
    source,
    /const\s+AGT002_V3_POLICY_VERSION\s*=/,
    'tender-go-no-go-rpc.js no puede declarar una copia local de AGT002_V3_POLICY_VERSION',
  );
}

// --- unión malformada/ambigua: el error propio del selector propaga sin envolverse en 409 ---

{
  const { database, observed } = fakeDatabase({
    runs: [baseValidRun({ result: v3ReadyResult({ unit_kind: 'strategic_consideration' }) })],
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
