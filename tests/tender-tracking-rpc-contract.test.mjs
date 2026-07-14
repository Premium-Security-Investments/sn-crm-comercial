import { strict as assert } from 'node:assert';
import { callTenderTrackingTransition, callTenderTrackingUpdate } from '../tender-tracking-rpc.js';

const tenderId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';
const opportunityId = '44444444-4444-4444-8444-444444444444';
const expectedAt = '2026-07-14T12:00:00.000Z';

function fakeRpcDb({ data = { id: tenderId }, error = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data, error });
    },
  };
}

await (async function callsTheUpdateRpcWithActorOwnedAndOptimisticArguments() {
  const db = fakeRpcDb();
  const data = await callTenderTrackingUpdate(db, tenderId, {
    tracking_owner_id: ownerId,
    tracking_status: 'bloqueado',
    tracking_next_action: 'Solicitar aclaración',
    tracking_due_at: '2026-07-20T10:00:00.000Z',
    tracking_blocker: 'Falta anexo',
    note: 'Pendiente del anexo',
    expected_tracking_updated_at: expectedAt,
  }, { id: actorId });

  assert.deepEqual(data, { id: tenderId });
  assert.deepEqual(db.calls, [{
    name: 'psi_update_tender_tracking',
    args: {
      p_tender_id: tenderId,
      p_actor_id: actorId,
      p_tracking_owner_id: ownerId,
      p_tracking_status: 'bloqueado',
      p_tracking_next_action: 'Solicitar aclaración',
      p_tracking_due_at: '2026-07-20T10:00:00.000Z',
      p_tracking_blocker: 'Falta anexo',
      p_note: 'Pendiente del anexo',
      p_expected_tracking_updated_at: expectedAt,
    },
  }]);
})();

await (async function defaultsInitialOwnerToAuthenticatedActorAndAllowsNullExpectedTimestamp() {
  const db = fakeRpcDb();
  await callTenderTrackingUpdate(db, tenderId, {
    tracking_status: 'pendiente_revision',
    expected_tracking_updated_at: null,
  }, { id: actorId });

  assert.equal(db.calls[0].args.p_tracking_owner_id, actorId);
  assert.equal(db.calls[0].args.p_expected_tracking_updated_at, null);
})();

await (async function rejectsInvalidUpdateIdsStatusesAndClientSelectedEvents() {
  const db = fakeRpcDb();
  await assert.rejects(() => callTenderTrackingUpdate(db, 'not-a-uuid', {}, { id: actorId }), /licitación válida/i);
  await assert.rejects(() => callTenderTrackingUpdate(db, tenderId, { tracking_status: 'invalid' }, { id: actorId }), /Estado de seguimiento inválido/i);
  await assert.rejects(() => callTenderTrackingUpdate(db, tenderId, { tracking_owner_id: 'not-a-uuid' }, { id: actorId }), /responsable válido/i);
  await assert.rejects(() => callTenderTrackingUpdate(db, tenderId, { event_type: 'converted' }, { id: actorId }), /no se selecciona desde el cliente/i);
  assert.equal(db.calls.length, 0);
})();

await (async function callsTransitionRpcWithOnlySupportedTargetAndExpectedTimestamp() {
  const db = fakeRpcDb();
  await callTenderTrackingTransition(db, tenderId, {
    internal_status: 'convertida_oportunidad',
    converted_opportunity_id: opportunityId,
    note: 'Creada en CRM',
    expected_tracking_updated_at: expectedAt,
  }, { id: actorId });

  assert.deepEqual(db.calls, [{
    name: 'psi_transition_tender_tracking',
    args: {
      p_tender_id: tenderId,
      p_actor_id: actorId,
      p_internal_status: 'convertida_oportunidad',
      p_converted_opportunity_id: opportunityId,
      p_note: 'Creada en CRM',
      p_expected_tracking_updated_at: expectedAt,
    },
  }]);
})();

await (async function rejectsInvalidTransitionUuidStatusAndClientSelectedEventBeforeRpc() {
  const db = fakeRpcDb();
  await assert.rejects(() => callTenderTrackingTransition(db, tenderId, { internal_status: 'en_revision', expected_tracking_updated_at: expectedAt }, { id: actorId }), /Transición de seguimiento inválida/i);
  await assert.rejects(() => callTenderTrackingTransition(db, tenderId, { internal_status: 'convertida_oportunidad', converted_opportunity_id: 'bad', expected_tracking_updated_at: expectedAt }, { id: actorId }), /oportunidad válida/i);
  await assert.rejects(() => callTenderTrackingTransition(db, tenderId, { internal_status: 'descartada', event_type: 'discarded', expected_tracking_updated_at: expectedAt }, { id: actorId }), /no se selecciona desde el cliente/i);
  assert.equal(db.calls.length, 0);
})();

await (async function allowsNullExpectedTrackingTokenForInitialLifecycleTransitions() {
  const db = fakeRpcDb();
  await callTenderTrackingTransition(db, tenderId, { internal_status: 'descartada', expected_tracking_updated_at: null }, { id: actorId });
  await callTenderTrackingTransition(db, tenderId, {
    internal_status: 'convertida_oportunidad',
    converted_opportunity_id: opportunityId,
    expected_tracking_updated_at: null,
  }, { id: actorId });
  assert.equal(db.calls.length, 2);
  assert.equal(db.calls[0].args.p_expected_tracking_updated_at, null);
  assert.equal(db.calls[1].args.p_expected_tracking_updated_at, null);
})();

await (async function propagatesStaleTrackingTokenRpcErrorForHandlers() {
  const db = fakeRpcDb({ error: { message: 'Seguimiento desactualizado.', code: 'P0001' } });
  await assert.rejects(
    () => callTenderTrackingTransition(db, tenderId, { internal_status: 'descartada', expected_tracking_updated_at: expectedAt }, { id: actorId }),
    error => error.message === 'Seguimiento desactualizado.' && error.code === 'P0001',
  );
})();

console.log('tender tracking RPC backend contract passed');
