import { strict as assert } from 'node:assert';
import { callCreateTenderProcessingJob, callTenderOpportunityConversion, callTenderOpportunityDiscard, callTenderTrackingTransition, callTenderTrackingUpdate } from '../tender-tracking-rpc.js';

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

function fakeJobCreationDb({ rpcResult, row }) {
  const calls = [];
  const reads = [];
  return {
    calls,
    reads,
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: rpcResult, error: null });
    },
    from(table) {
      assert.equal(table, 'psi_tender_processing_jobs');
      return {
        select(columns) {
          assert.equal(columns, 'status,current_step');
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              reads.push(value);
              return { single: () => Promise.resolve({ data: row, error: null }) };
            },
          };
        },
      };
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

await (async function callsTransitionRpcWithDiscardTargetAndNullOpportunityArgument() {
  const db = fakeRpcDb();
  await callTenderTrackingTransition(db, tenderId, {
    internal_status: 'descartada',
    note: 'No cumple el margen',
    expected_tracking_updated_at: expectedAt,
  }, { id: actorId });

  assert.deepEqual(db.calls, [{
    name: 'psi_transition_tender_tracking',
    args: {
      p_tender_id: tenderId,
      p_actor_id: actorId,
      p_internal_status: 'descartada',
      p_converted_opportunity_id: null,
      p_note: 'No cumple el margen',
      p_expected_tracking_updated_at: expectedAt,
    },
  }]);
})();

await (async function rejectsGenericConversionBeforeRpcAndDirectsToAtomicConversionFlow() {
  const db = fakeRpcDb();
  await assert.rejects(
    () => callTenderTrackingTransition(db, tenderId, { internal_status: 'convertida_oportunidad', converted_opportunity_id: opportunityId, expected_tracking_updated_at: expectedAt }, { id: actorId }),
    /conversión debe usar el flujo de convertir a oportunidad/i,
  );
  await assert.rejects(
    () => callTenderTrackingTransition(db, tenderId, { internal_status: 'descartada', converted_opportunity_id: opportunityId, expected_tracking_updated_at: expectedAt }, { id: actorId }),
    /no admite una oportunidad convertida/i,
  );
  await assert.rejects(() => callTenderTrackingTransition(db, tenderId, { internal_status: 'en_revision', expected_tracking_updated_at: expectedAt }, { id: actorId }), /Transición de seguimiento inválida/i);
  await assert.rejects(() => callTenderTrackingTransition(db, tenderId, { internal_status: 'descartada', event_type: 'discarded', expected_tracking_updated_at: expectedAt }, { id: actorId }), /no se selecciona desde el cliente/i);
  assert.equal(db.calls.length, 0);
})();

await (async function allowsNullExpectedTrackingTokenForInitialLifecycleTransitions() {
  const db = fakeRpcDb();
  await callTenderTrackingTransition(db, tenderId, { internal_status: 'descartada', expected_tracking_updated_at: null }, { id: actorId });
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].args.p_expected_tracking_updated_at, null);
})();

await (async function propagatesStaleTrackingTokenRpcErrorForHandlers() {
  const db = fakeRpcDb({ error: { message: 'Seguimiento desactualizado.', code: 'P0001' } });
  await assert.rejects(
    () => callTenderTrackingTransition(db, tenderId, { internal_status: 'descartada', expected_tracking_updated_at: expectedAt }, { id: actorId }),
    error => error.message === 'Seguimiento desactualizado.' && error.code === 'P0001',
  );
})();

await (async function callsCombinedDiscardRpcWithCurrentActorAndLatestLinkedTenderToken() {
  const db = fakeRpcDb({ data: { id: opportunityId, linked_tender_status: 'discarded' } });
  const data = await callTenderOpportunityDiscard(db, opportunityId, {
    note: 'No cumple el margen mínimo',
    expected_tracking_updated_at: expectedAt,
  }, { id: actorId });

  assert.deepEqual(data, { id: opportunityId, linked_tender_status: 'discarded' });
  assert.deepEqual(db.calls, [{
    name: 'psi_discard_tender_opportunity',
    args: {
      p_opportunity_id: opportunityId,
      p_actor_id: actorId,
      p_note: 'No cumple el margen mínimo',
      p_expected_tracking_updated_at: expectedAt,
    },
  }]);
})();

await (async function propagatesCombinedDiscardRpcErrorsWithoutFallbackWrites() {
  const stale = { message: 'Seguimiento desactualizado.', code: 'P0001' };
  const db = fakeRpcDb({ error: stale });
  await assert.rejects(
    () => callTenderOpportunityDiscard(db, opportunityId, { note: 'Descartar', expected_tracking_updated_at: expectedAt }, { id: actorId }),
    error => error === stale,
  );
  assert.equal(db.calls.length, 1);
})();

await (async function callsAtomicConversionRpcWithPersistedTenderPayloadAndToken() {
  const db = fakeRpcDb({ data: { opportunity_id: opportunityId, duplicate: false } });
  await callTenderOpportunityConversion(db, tenderId, {
    external_source: 'secop_radar:SECOP II:one', company_name: 'Entidad', owner_id: ownerId,
    stage_code: 'prospecto', service_type_code: 'licitacion_publica', offer_value: 123,
    expected_close_date: '2026-07-20', quote_city: 'Bogotá', regional_nombre: 'Cundinamarca', sede: 'REF-1',
    economic_sector: 'Sector público', tipo_producto_original: 'Licitación Pública', observaciones: 'Radar',
  }, expectedAt, { id: actorId });
  assert.equal(db.calls[0].name, 'psi_convert_tender_to_opportunity');
  assert.deepEqual(db.calls[0].args, {
    p_tender_id: tenderId, p_actor_id: actorId, p_external_source: 'secop_radar:SECOP II:one',
    p_company_name: 'Entidad', p_owner_id: ownerId, p_stage_code: 'prospecto', p_service_type_code: 'licitacion_publica',
    p_offer_value: 123, p_expected_close_date: '2026-07-20', p_quote_city: 'Bogotá', p_regional_nombre: 'Cundinamarca',
    p_sede: 'REF-1', p_economic_sector: 'Sector público', p_tipo_producto_original: 'Licitación Pública',
    p_observaciones: 'Radar', p_expected_tracking_updated_at: expectedAt,
  });
})();

await (async function reportsCreationOutcomeSeparatelyFromDurablePipelineStatusForANewJob() {
  const jobId = '55555555-5555-4555-8555-555555555555';
  const db = fakeJobCreationDb({
    rpcResult: { status: 'created', job_id: jobId },
    row: { status: 'queued', current_step: 'documents' },
  });

  const job = await callCreateTenderProcessingJob(db, {
    tenderId, opportunityId, pipelineVersion: 'v1', requestedBy: actorId,
  });

  assert.deepEqual(job, { job_id: jobId, outcome: 'created', status: 'queued', current_step: 'documents' });
  assert.equal(db.calls[0].name, 'psi_create_tender_processing_job');
  assert.deepEqual(db.reads, [jobId]);
})();

await (async function reportsCreationOutcomeSeparatelyFromDurablePipelineStatusForAnExistingJob() {
  const jobId = '66666666-6666-4666-8666-666666666666';
  const db = fakeJobCreationDb({
    rpcResult: { status: 'existing', job_id: jobId },
    row: { status: 'importing_documents', current_step: 'documents' },
  });

  const job = await callCreateTenderProcessingJob(db, {
    tenderId, opportunityId, pipelineVersion: 'v1', requestedBy: actorId,
  });

  assert.deepEqual(job, { job_id: jobId, outcome: 'existing', status: 'importing_documents', current_step: 'documents' });
})();

console.log('tender tracking RPC backend contract passed');
