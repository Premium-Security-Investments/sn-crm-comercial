import { strict as assert } from 'node:assert';
import { callTenderOfferStatusTransition, getTenderOfferStatus } from '../tender-offer-status-rpc.js';

const OPPORTUNITY = '11111111-1111-4111-8111-111111111111';
const TENDER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const director = { id: ACTOR, active: true, identity_type: 'human', role: 'director', permissions: ['licitaciones'], areas: [], full_name: 'Dirección' };
const viewer = { id: '44444444-4444-4444-8444-444444444444', active: true, identity_type: 'human', role: 'comercial', permissions: ['licitaciones'], areas: [] };
const noAccess = { id: '55555555-5555-4555-8555-555555555555', active: true, identity_type: 'human', role: 'comercial', permissions: [], areas: [] };

function query(data, onAccess) {
  const chain = {
    select() { return chain; }, eq() { return chain; }, order() { return chain; },
    single() { onAccess(); return Promise.resolve({ data, error: null }); },
    maybeSingle() { onAccess(); return Promise.resolve({ data, error: null }); },
    then(resolve, reject) { onAccess(); return Promise.resolve({ data, error: null }).then(resolve, reject); },
  };
  return chain;
}
function fakeDatabase({ rpcError = null } = {}) {
  const observed = { reads: 0, rpc: [] };
  const access = () => { observed.reads += 1; };
  const event = { id: '66666666-6666-4666-8666-666666666666', opportunity_id: OPPORTUNITY, tender_id: TENDER, actor_id: ACTOR, from_status: 'en_preparacion', to_status: 'lista_para_presentar', note: null, changed_at: '2026-07-22T00:00:00Z' };
  return {
    observed,
    database: {
      from(table) {
        if (table === 'psi_sales_opportunities') return query({ id: OPPORTUNITY, tender_offer_status: 'en_preparacion' }, access);
        if (table === 'psi_public_tenders') return query({ id: TENDER, converted_opportunity_id: OPPORTUNITY }, access);
        if (table === 'psi_tender_offer_status_transitions') return query([event], access);
        throw new Error(`unexpected table ${table}`);
      },
      async rpc(name, args) {
        observed.rpc.push({ name, args });
        return rpcError ? { data: null, error: rpcError } : { data: { status: args.p_to_status, event: { ...event, to_status: args.p_to_status, note: args.p_note } }, error: null };
      },
    },
  };
}

{
  const { database, observed } = fakeDatabase();
  const result = await getTenderOfferStatus(database, OPPORTUNITY, viewer);
  assert.equal(result.status, 'en_preparacion'); assert.equal(result.history.length, 1); assert.equal(observed.reads, 3);
}
{
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => getTenderOfferStatus(database, OPPORTUNITY, noAccess), error => error.status === 403);
  assert.equal(observed.reads, 0, 'GET denegado no puede consultar la oportunidad');
}
{
  const { database, observed } = fakeDatabase();
  const result = await callTenderOfferStatusTransition(database, { opportunity_id: OPPORTUNITY, to_status: 'lista_para_presentar', expected_current_status: 'en_preparacion', note: ' Lista ' }, director);
  assert.equal(result.status, 'lista_para_presentar'); assert.equal(observed.rpc.length, 1);
  assert.equal(observed.rpc[0].name, 'psi_transition_tender_offer_status');
  assert.equal(observed.rpc[0].args.p_actor_id, ACTOR); assert.equal(observed.rpc[0].args.p_note, 'Lista');
}
{
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => callTenderOfferStatusTransition(database, { opportunity_id: OPPORTUNITY, to_status: 'lista_para_presentar', expected_current_status: 'en_preparacion' }, viewer), error => error.status === 403);
  assert.equal(observed.rpc.length, 0, 'POST denegado no puede invocar RPC'); assert.equal(observed.reads, 0);
}
{
  const { database, observed } = fakeDatabase();
  await assert.rejects(() => callTenderOfferStatusTransition(database, { opportunity_id: OPPORTUNITY, to_status: 'presentada', expected_current_status: 'en_preparacion' }, director), error => error.status === 409);
  assert.equal(observed.rpc.length, 0, 'salto inválido no puede invocar RPC');
}
{
  const { database } = fakeDatabase({ rpcError: Object.assign(new Error('conflict'), { code: '40001' }) });
  await assert.rejects(() => callTenderOfferStatusTransition(database, { opportunity_id: OPPORTUNITY, to_status: 'lista_para_presentar', expected_current_status: 'en_preparacion' }, director), error => error.status === 409);
}
console.log('tender offer status service checks passed');
