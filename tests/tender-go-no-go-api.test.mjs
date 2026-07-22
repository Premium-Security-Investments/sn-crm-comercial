import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { callTenderGoNoGoDecision, getTenderGoNoGoDecision, requireTenderGoForPreparation } from '../tender-go-no-go-rpc.js';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const TENDER_ID = '22222222-2222-4222-8222-222222222222';
const ANALYSIS_OLD_ID = '33333333-3333-4333-8333-333333333333';
const ANALYSIS_LATEST_ID = '88888888-8888-4888-888888888888';
const UNKNOWN_ANALYSIS_ID = '99999999-9999-4999-8999-999999999999';
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

function query(data, onAccess) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    order() { return chain; },
    maybeSingle() { onAccess?.(); return Promise.resolve({ data, error: null }); },
    single() { onAccess?.(); return Promise.resolve({ data, error: null }); },
    then(resolve, reject) { onAccess?.(); return Promise.resolve({ data, error: null }).then(resolve, reject); },
  };
  return chain;
}

function fakeDatabase({
  onTargetAccess = () => {},
  preparationCreated = true,
  historicalPreparation = null,
  historicalPreparations = [],
  preparationId,
  history = [],
} = {}) {
  const observed = { rpc: [], targetAccesses: 0 };
  const interactions = [
    {
      id: '55555555-5555-4555-8555-555555555555',
      notes: JSON.stringify({ kind: 'tender_document_upload', documents: [{ id: 'doc-1', name: 'Pliego.pdf', current: true, document_type: 'pliego' }] }),
      created_at: '2026-07-01T00:00:00.000Z',
    },
    {
      id: ANALYSIS_OLD_ID,
      notes: JSON.stringify({ kind: 'tender_document_analysis', status: 'analisis_generado', recommendation: 'NO_GO', commercial_fit: { status: 'Sin encaje' } }),
      created_at: '2026-07-02T00:00:00.000Z',
    },
    {
      id: ANALYSIS_LATEST_ID,
      notes: JSON.stringify({ kind: 'tender_document_analysis', status: 'analisis_generado', recommendation: 'GO', commercial_fit: { status: 'Encaje detectado' } }),
      created_at: '2026-07-03T00:00:00.000Z',
    },
  ];
  if (historicalPreparation) {
    interactions.push({
      id: historicalPreparation.interaction_id,
      notes: JSON.stringify({ ...historicalPreparation, kind: 'tender_offer_preparation' }),
      created_at: historicalPreparation.created_at,
      occurred_at: historicalPreparation.occurred_at,
    });
  }
  for (const preparation of historicalPreparations) {
    interactions.push({
      id: preparation.interaction_id,
      notes: JSON.stringify({ ...preparation, kind: 'tender_offer_preparation' }),
      created_at: preparation.created_at,
      occurred_at: preparation.occurred_at,
    });
  }
  const database = {
    from(table) {
      const target = ['v_psi_sales_opportunity_enriched', 'psi_public_tenders', 'psi_sales_interactions'].includes(table);
      const access = target ? () => { observed.targetAccesses += 1; onTargetAccess(); } : undefined;
      if (table === 'v_psi_sales_opportunity_enriched') return query({ id: OPPORTUNITY_ID, company_name: 'Entidad pública', service_type_code: 'licitacion_publica', expected_close_date: '2026-08-01', offer_value: 1000 }, access);
      if (table === 'psi_public_tenders') return query({ id: TENDER_ID, converted_opportunity_id: OPPORTUNITY_ID }, access);
      if (table === 'psi_sales_interactions') return query(interactions, access);
      if (table === 'psi_tender_go_no_go_decisions') return query(history);
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      observed.rpc.push({ name, args });
      return {
        data: {
          decision_id: '66666666-6666-4666-8666-666666666666',
          decision: args.p_decision,
          preparation_id: args.p_decision === 'go' ? (preparationId || '77777777-7777-4777-8777-777777777777') : null,
          preparation_created: preparationCreated,
          tender_offer_status: args.p_decision === 'go' ? 'en_preparacion' : 'cerrada_no_go',
        },
        error: null,
      };
    },
  };
  return { database, observed };
}

function decide(database, input = {}) {
  return callTenderGoNoGoDecision(database, { opportunity_id: OPPORTUNITY_ID, decision: 'go', ...input }, directorProfile);
}

{
  const { database, observed } = fakeDatabase();
  const result = await decide(database, { analysis_interaction_id: ANALYSIS_OLD_ID, justification: '' });
  assert.equal(observed.rpc.length, 1, 'GO must make exactly one mediated RPC call');
  assert.equal(observed.rpc[0].name, 'psi_record_tender_go_no_go');
  assert.equal(observed.rpc[0].args.p_actor_id, ACTOR_ID);
  assert.equal(observed.rpc[0].args.p_tender_id, TENDER_ID);
  assert.equal(observed.rpc[0].args.p_decision, 'go');
  assert.equal(observed.rpc[0].args.p_analysis_interaction_id, ANALYSIS_OLD_ID, 'explicit analysis must be audited by the RPC');
  assert.equal(observed.rpc[0].args.p_justification, null);
  assert.equal(observed.rpc[0].args.p_preparation.source_summary.decision, 'NO_GO', 'builder must use the explicitly selected analysis, not latest');
  assert.equal(result.preparation, observed.rpc[0].args.p_preparation, 'created preparation must return the payload submitted to the RPC');
}

{
  const { database, observed } = fakeDatabase();
  await decide(database);
  assert.equal(observed.rpc.length, 1);
  assert.equal(observed.rpc[0].args.p_analysis_interaction_id, ANALYSIS_LATEST_ID, 'omitted analysis must use the current/latest analysis for the RPC audit');
  assert.equal(observed.rpc[0].args.p_preparation.source_summary.decision, 'GO', 'omitted analysis must build from latest analysis');
}

{
  const { database, observed } = fakeDatabase();
  await decide(database, { analysis_interaction_id: null });
  assert.equal(observed.rpc.length, 1);
  assert.equal(observed.rpc[0].args.p_analysis_interaction_id, null, 'explicit null permits a decision without analysis');
  assert.equal(observed.rpc[0].args.p_preparation.checklist_summary.has_analysis, false, 'explicit null builds GO preparation without analysis');
  assert.equal(observed.rpc[0].args.p_preparation.source_summary.decision, 'Preparación aprobada por gerencia');
}

{
  const { database, observed } = fakeDatabase();
  await decide(database, { decision: 'no_go', analysis_interaction_id: ANALYSIS_OLD_ID });
  assert.equal(observed.rpc.length, 1);
  assert.equal(observed.rpc[0].args.p_preparation, null, 'NO GO must not build a preparation');
  assert.equal(observed.rpc[0].args.p_analysis_interaction_id, ANALYSIS_OLD_ID, 'NO GO must audit the effective explicit analysis');
}

{
  const { database, observed } = fakeDatabase();
  await decide(database, { decision: 'no_go' });
  assert.equal(observed.rpc.length, 1);
  assert.equal(observed.rpc[0].args.p_preparation, null, 'NO GO must not build a preparation');
  assert.equal(observed.rpc[0].args.p_analysis_interaction_id, ANALYSIS_LATEST_ID, 'NO GO must audit latest analysis when omitted');
}

{
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => decide(database, { analysis_interaction_id: UNKNOWN_ANALYSIS_ID }), /análisis.*oportunidad|análisis.*cargad/i);
  assert.equal(observed.rpc.length, 0, 'foreign analysis must fail before the RPC');
}

{
  const { database, observed } = fakeDatabase({
    preparationCreated: false,
    preparationId: HISTORICAL_PREPARATION.interaction_id,
    historicalPreparation: HISTORICAL_PREPARATION,
  });
  const result = await decide(database);
  assert.equal(observed.rpc.length, 1);
  assert.deepEqual(result.preparation, HISTORICAL_PREPARATION, 'reused preparation must return the actually persisted historical interaction, not a new payload');
  assert.notEqual(result.preparation, observed.rpc[0].args.p_preparation, 'reused preparation must not pretend the newly-built payload persisted');
}

{
  const { database } = fakeDatabase({
    preparationCreated: false,
    preparationId: SQL_CURRENT_PREPARATION.interaction_id,
    historicalPreparations: [SQL_CURRENT_PREPARATION, CREATED_AT_CURRENT_PREPARATION],
    history: [{ id: '77777777-7777-4777-8777-777777777777', decision: 'go' }],
  });
  const result = await decide(database);
  assert.equal(result.decision.preparation_id, SQL_CURRENT_PREPARATION.interaction_id, 'fake RPC must return the preparation selected by SQL');
  assert.deepEqual(result.preparation, SQL_CURRENT_PREPARATION, 'reused POST preparation must match the exact SQL-selected interaction id, not created_at order');
  const readResult = await getTenderGoNoGoDecision(database, OPPORTUNITY_ID, directorProfile);
  assert.deepEqual(readResult.preparation, SQL_CURRENT_PREPARATION, 'GET preparation must use SQL occurred_at DESC, id DESC order');
}

{
  const noGo = { id: '99999999-9999-4999-8999-999999999998', decision: 'no_go', decided_at: '2026-07-11T00:00:00.000Z' };
  const go = { id: '99999999-9999-4999-8999-999999999997', decision: 'go', decided_at: '2026-07-10T00:00:00.000Z' };
  const { database } = fakeDatabase({ historicalPreparation: HISTORICAL_PREPARATION, history: [noGo, go] });
  const result = await getTenderGoNoGoDecision(database, OPPORTUNITY_ID, directorProfile);
  assert.equal(result.decision.decision, 'no_go');
  assert.equal(result.preparation, null, 'Una decisión NO_GO posterior no puede exponer una preparación histórica.');
  await assert.rejects(() => requireTenderGoForPreparation(database, OPPORTUNITY_ID, directorProfile), error => error?.status === 409, 'Las notas deben rechazar NO_GO vigente antes de insertar.');
}

for (const input of [
  { opportunity_id: 'invalid', decision: 'go' },
  { opportunity_id: OPPORTUNITY_ID, decision: 'unknown' },
  { opportunity_id: OPPORTUNITY_ID, decision: 'go', analysis_interaction_id: '' },
  { opportunity_id: OPPORTUNITY_ID, decision: 'go', analysis_interaction_id: '   ' },
]) {
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => callTenderGoNoGoDecision(database, input, directorProfile), /oportunidad válida|decisión debe ser go o no_go|análisis válido/i);
  assert.equal(observed.targetAccesses, 0, 'invalid input must not access target records');
}

for (const profile of [
  { ...directorProfile, identity_type: 'agent' },
  { ...directorProfile, permissions: [] },
]) {
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => callTenderGoNoGoDecision(database, { opportunity_id: OPPORTUNITY_ID, decision: 'go' }, profile), /autorización/i);
  assert.equal(observed.targetAccesses, 0, 'unauthorized actors must fail before target access');
  assert.equal(observed.rpc.length, 0);
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
  assert.doesNotMatch(alias[0], /requireDb|\.from\(|\.rpc\(|storage/);
  const noteRoute = source.match(/app\.post\('\/api\/tender-offer-preparation-note'[\s\S]*?\n}\);/);
  assert.ok(noteRoute, 'Debe conservarse la ruta de notas.');
  assert.match(noteRoute[0], /await requireTenderGoForPreparation\(database, opportunityId, currentProfile\)/, 'Las notas deben validar GO vigente antes del insert.');
}

console.log('tender go/no-go API checks passed');
