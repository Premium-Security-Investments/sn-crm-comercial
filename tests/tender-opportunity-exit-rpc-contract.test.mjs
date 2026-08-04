import { strict as assert } from 'node:assert';
import { callTenderOpportunityExit } from '../tender-tracking-rpc.js';

const actorId = '22222222-2222-4222-8222-222222222222';
const opportunityId = '44444444-4444-4444-8444-444444444444';
const expectedAt = '2026-08-04T12:00:00.123456+00:00';

function fakeRpcDb({ data = { id: opportunityId }, error = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data, error });
    },
  };
}

await (async function callsTheExitRpcWithActorDestinationAndOpaqueTimestamp() {
  const db = fakeRpcDb();
  const data = await callTenderOpportunityExit(db, opportunityId, {
    destination: 'seguimiento',
    note: 'Esperar adenda',
    expected_tracking_updated_at: expectedAt,
  }, { id: actorId });

  assert.deepEqual(data, { id: opportunityId });
  assert.equal(db.calls[0].name, 'psi_exit_tender_opportunity');
  assert.deepEqual(db.calls[0].args, {
    p_opportunity_id: opportunityId,
    p_actor_id: actorId,
    p_destination: 'seguimiento',
    p_note: 'Esperar adenda',
    p_expected_tracking_updated_at: expectedAt,
  });
})();

await (async function callsTheExitRpcWithRadarDestinationAndNullNote() {
  const db = fakeRpcDb();
  await callTenderOpportunityExit(db, opportunityId, {
    destination: 'radar',
    expected_tracking_updated_at: expectedAt,
  }, { id: actorId });

  assert.equal(db.calls[0].args.p_destination, 'radar');
  assert.equal(db.calls[0].args.p_note, null);
})();

await (async function rejectsInvalidIdsActorsAndDestinations() {
  const db = fakeRpcDb();
  await assert.rejects(() => callTenderOpportunityExit(db, 'not-a-uuid', { destination: 'radar', expected_tracking_updated_at: expectedAt }, { id: actorId }), /oportunidad válida/i);
  await assert.rejects(() => callTenderOpportunityExit(db, opportunityId, { destination: 'radar', expected_tracking_updated_at: expectedAt }, { id: 'not-a-uuid' }), /actor válido/i);
  await assert.rejects(() => callTenderOpportunityExit(db, opportunityId, { destination: 'otro', expected_tracking_updated_at: expectedAt }, { id: actorId }), /destino/i);
  assert.equal(db.calls.length, 0);
})();

await (async function rejectsClientSelectedEventType() {
  const db = fakeRpcDb();
  await assert.rejects(
    () => callTenderOpportunityExit(db, opportunityId, { destination: 'radar', event_type: 'exit', expected_tracking_updated_at: expectedAt }, { id: actorId }),
    /no se selecciona desde el cliente/i,
  );
  assert.equal(db.calls.length, 0);
})();

await (async function requiresExpectedTrackingUpdatedAtToken() {
  const db = fakeRpcDb();
  await assert.rejects(
    () => callTenderOpportunityExit(db, opportunityId, { destination: 'radar' }, { id: actorId }),
    /versión de seguimiento/i,
  );
  assert.equal(db.calls.length, 0);
})();

await (async function propagatesStaleTrackingTokenRpcError() {
  const stale = { message: 'Seguimiento desactualizado.', code: 'P0001' };
  const db = fakeRpcDb({ error: stale });
  await assert.rejects(
    () => callTenderOpportunityExit(db, opportunityId, { destination: 'radar', expected_tracking_updated_at: expectedAt }, { id: actorId }),
    error => error === stale,
  );
  assert.equal(db.calls.length, 1);
})();

console.log('tender opportunity exit RPC contract passed');
