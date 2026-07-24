import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  callTenderGoNoGoDecision,
  getTenderGoNoGoDecision,
  requireTenderGoForPreparation,
} from '../tender-go-no-go-rpc.js';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const TENDER_ID = '22222222-2222-4222-8222-222222222222';
const ANALYSIS_RUN_ID = '33333333-3333-4333-8333-33333333333a';
const STALE_ANALYSIS_RUN_ID = '88888888-8888-4888-8888-88888888888b';
const LEGACY_ANALYSIS_INTERACTION_ID = '99999999-9999-4999-8999-999999999999';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

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
  snapshots = [{ id: '66666666-6666-4666-8666-666666666666', opportunity_id: OPPORTUNITY_ID, created_at: '2026-07-03T00:00:00.000Z' }],
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
      notes: JSON.stringify({ kind: 'tender_document_upload', documents: [{ id: 'doc-1', name: 'Pliego.pdf', current: true, document_type: 'pliego' }] }),
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
  assert.equal(Object.hasOwn(observed.rpc[0].args, 'p_analysis_interaction_id'), false, 'legacy interaction IDs are never write inputs');
  assert.equal(observed.rpc[0].args.p_justification, 'Margen y capacidad aprobados');
  assert.equal(result.preparation, observed.rpc[0].args.p_preparation, 'created preparation must return the payload submitted to the RPC');
}

{
  const { database, observed } = fakeDatabase();
  await decide(database, { decision: 'no_go', justification: 'Riesgo técnico no aceptable' });
  assert.equal(observed.rpc.length, 1);
  assert.equal(observed.rpc[0].args.p_preparation, null, 'NO GO must not build a preparation');
  assert.equal(observed.rpc[0].args.p_justification, 'Riesgo técnico no aceptable');
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
  assert.match(source, /import \{ callTenderGoNoGoDecision, getTenderGoNoGoDecision, requireTenderGoForPreparation \} from '\.\.\/tender-go-no-go-rpc\.js';/);
  assert.match(source, /app\.get\('\/api\/tender-go-no-go-decision'/);
  assert.match(source, /app\.post\('\/api\/tender-go-no-go-decision'/);
  assert.match(source, /callTenderGoNoGoDecision\(requireDb\(\), req\.body \|\| \{\}, currentProfile\)/);
  const alias = source.match(/app\.post\('\/api\/tender-offer-preparation-approve'[\s\S]*?\n}\);/);
  assert.ok(alias, 'legacy alias must remain explicit');
  assert.match(alias[0], /getAuthContext\(req\)/, 'legacy alias still authenticates');
  assert.match(alias[0], /status\(410\)\.json\(\{ error: 'Use Autorizar GO para iniciar la preparación de oferta\.' \}\)/);
  assert.doesNotMatch(alias[0], /requireDb|\.from\(|\.rpc\(|storage/, 'legacy alias must not access database or storage');
  const noteRoute = source.match(/app\.post\('\/api\/tender-offer-preparation-note'[\s\S]*?\n}\);/);
  assert.ok(noteRoute, 'preparation-note route must remain available');
  assert.match(noteRoute[0], /await requireTenderGoForPreparation\(database, opportunityId, currentProfile\)/, 'preparation notes must validate the current GO before insert');
}

console.log('tender go/no-go API checks passed');
