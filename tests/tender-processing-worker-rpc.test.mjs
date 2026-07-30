import { strict as assert } from 'node:assert';
import {
  claimTenderProcessingJob,
  updateTenderProcessingJob,
  recordTenderImportItem,
  recordTenderDocumentChunk,
  appendTenderProcessingEvent,
  getTenderProcessingJobActor,
} from '../tender-processing-worker-rpc.js';

function fakeDb({ rpcResults = {}, tables = {} } = {}) {
  const rpcCalls = [];
  const fromCalls = [];
  return {
    rpcCalls,
    fromCalls,
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const result = rpcResults[name];
      if (typeof result === 'function') return Promise.resolve(result(args));
      return Promise.resolve(result || { data: null, error: null });
    },
    from(table) {
      fromCalls.push(table);
      const state = { table, filters: {} };
      const builder = {
        select() { return builder; },
        eq(key, value) { state.filters[key] = value; return builder; },
        in(key, values) { state.filters[key] = values; return builder; },
        order() { return builder; },
        limit() { return builder; },
        async single() {
          const row = tables[table]?.single;
          return typeof row === 'function' ? row(state.filters) : (row || { data: null, error: null });
        },
        async maybeSingle() {
          const row = tables[table]?.maybeSingle;
          return typeof row === 'function' ? row(state.filters) : (row || { data: null, error: null });
        },
        then(resolve) {
          const rows = tables[table]?.list;
          return Promise.resolve(typeof rows === 'function' ? rows(state.filters) : (rows || { data: [], error: null })).then(resolve);
        },
      };
      return builder;
    },
  };
}

async function claimReturnsNullWhenNotClaimed() {
  const db = fakeDb({ rpcResults: { psi_claim_tender_processing_job: { data: { status: 'empty' }, error: null } } });
  const claim = await claimTenderProcessingJob(db, { leaseSeconds: 60 });
  assert.equal(claim, null);
}

async function claimComposesFullShapeWhenClaimed() {
  const jobId = 'job-1';
  const db = fakeDb({
    rpcResults: {
      psi_claim_tender_processing_job: {
        data: { status: 'claimed', job_id: jobId, lease_id: 'lease-1', tender_id: 't-1', opportunity_id: 'o-1', current_step: 'documents', pipeline_status: 'importing_documents' },
        error: null,
      },
    },
    tables: {
      psi_tender_processing_jobs: {
        single: { data: { requested_by: 'u-1', analysis_authorized_by: null, snapshot_id: null, documents_processed: 1, documents_imported: 1, documents_unchanged: 0, documents_failed: 0, attempt_count: 0 }, error: null },
      },
      psi_tender_document_import_items: {
        list: { data: [
          { source: 'SECOP II', source_document_id: 'd1', source_url: 'https://x', name: 'Pliego', status: 'pending', critical: true, attempt_count: 0 },
          { source: 'SECOP II', source_document_id: 'd2', source_url: 'https://x/2', name: 'Anexo', status: 'imported', critical: false, attempt_count: 0 },
          { source: 'SECOP II', source_document_id: 'd3', source_url: 'https://x/3', name: 'Minuta', status: 'failed_terminal', critical: true, attempt_count: 0 },
          { source: 'SECOP II', source_document_id: 'd4', source_url: 'https://x/4', name: 'Pliego futuro', status: 'failed_retryable', critical: true, attempt_count: 1, next_attempt_at: '2999-01-01T00:00:00Z' },
        ], error: null },
      },
    },
  });
  const claim = await claimTenderProcessingJob(db, { leaseSeconds: 60 });
  assert.equal(claim.job_id, jobId);
  assert.equal(claim.status, 'importing_documents');
  assert.equal(claim.requested_by, 'u-1');
  assert.equal(claim.pending_documents.length, 1);
  assert.equal(claim.pending_documents[0].sourceDocumentId, 'd1');
  assert.equal(claim.pending_documents[0].critical, true);
  assert.equal(claim.any_usable_text, true);
  assert.equal(claim.any_critical_terminal_failure, true);
}

async function updatePreservesLeaseByDefaultAndReleasesExplicitly() {
  const db = fakeDb({ rpcResults: { psi_update_tender_processing_job: { data: { status: 'ok', lease_released: true }, error: null } } });
  await updateTenderProcessingJob(db, 'job-1', 'lease-1', { status: 'needs_attention' });
  assert.deepEqual(db.rpcCalls[0], {
    name: 'psi_update_tender_processing_job',
    args: { p_job_id: 'job-1', p_lease_id: 'lease-1', p_patch: { status: 'needs_attention' } },
  });
  await updateTenderProcessingJob(db, 'job-1', 'lease-2', { status: 'importing_documents' }, { releaseLease: true });
  assert.deepEqual(db.rpcCalls[1], {
    name: 'psi_update_tender_processing_job',
    args: { p_job_id: 'job-1', p_lease_id: 'lease-2', p_patch: { status: 'importing_documents', release_lease: true } },
  });
}

async function recordImportItemMapsCamelCaseToRpcParams() {
  const db = fakeDb({ rpcResults: { psi_record_tender_import_item: { data: { status: 'ok', id: 'item-1' }, error: null } } });
  await recordTenderImportItem(db, { jobId: 'job-1', source: 'SECOP II', sourceDocumentId: 'd1', sourceUrl: 'https://x', name: 'Pliego', status: 'imported', critical: true, documentVersionId: 'v-1' });
  assert.deepEqual(db.rpcCalls[0].args, {
    p_job_id: 'job-1', p_source: 'SECOP II', p_source_document_id: 'd1', p_source_url: 'https://x',
    p_name: 'Pliego', p_status: 'imported', p_critical: true, p_document_version_id: 'v-1',
    p_last_error_code: null, p_last_error_message: null,
 p_next_attempt_at: null,
  });
}

async function recordDocumentChunkMapsCamelCaseToRpcParams() {
  const db = fakeDb({ rpcResults: { psi_record_tender_document_chunk: { data: { id: 'chunk-row-1', chunk_id: 'chunk:v1:p1:s1:c0' }, error: null } } });
  await recordTenderDocumentChunk(db, {
    opportunityId: 'opp-1', tenderId: 'tender-1', documentVersionId: 'v-1', snapshotId: 'snap-1',
    chunkId: 'chunk:v1:p1:s1:c0', evidenceRef: 'evidence:chunk:v1:p1:s1:c0', documentType: 'pliego',
    name: 'Pliego.pdf', version: 1, contentHash: 'a'.repeat(64), page: 1, section: 1, chunkIndex: 0,
    text: 'Texto del chunk.', chunkHash: 'b'.repeat(64), current: true, precedence: 'base',
    supersededByAddendum: false, actorId: 'actor-1',
  });
  assert.deepEqual(db.rpcCalls[0], {
    name: 'psi_record_tender_document_chunk',
    args: {
      p_opportunity_id: 'opp-1', p_tender_id: 'tender-1', p_document_version_id: 'v-1', p_snapshot_id: 'snap-1',
      p_chunk_id: 'chunk:v1:p1:s1:c0', p_evidence_ref: 'evidence:chunk:v1:p1:s1:c0', p_document_type: 'pliego',
      p_name: 'Pliego.pdf', p_version: 1, p_content_hash: 'a'.repeat(64), p_page: 1, p_section: 1, p_chunk_index: 0,
      p_text: 'Texto del chunk.', p_chunk_hash: 'b'.repeat(64), p_current: true, p_precedence: 'base',
      p_superseded_by_addendum: false, p_actor_id: 'actor-1',
    },
  });
}

async function recordDocumentChunkDefaultsSnapshotIdToNull() {
  const db = fakeDb({ rpcResults: { psi_record_tender_document_chunk: { data: { id: 'chunk-row-2' }, error: null } } });
  await recordTenderDocumentChunk(db, {
    opportunityId: 'opp-1', tenderId: 'tender-1', documentVersionId: 'v-1', snapshotId: null,
    chunkId: 'chunk:v1:p1:s1:c1', evidenceRef: 'evidence:chunk:v1:p1:s1:c1', documentType: 'pliego',
    name: 'Pliego.pdf', version: 1, contentHash: 'a'.repeat(64), page: 1, section: 1, chunkIndex: 1,
    text: 'Otro chunk.', chunkHash: 'c'.repeat(64), current: true, precedence: 'base',
    supersededByAddendum: false, actorId: 'actor-1',
  });
  assert.equal(db.rpcCalls[0].args.p_snapshot_id, null);
}

async function appendEventMapsCamelCaseToRpcParams() {
  const db = fakeDb({ rpcResults: { psi_append_tender_tracking_event: { data: { status: 'created', id: 'e-1' }, error: null } } });
  await appendTenderProcessingEvent(db, { tenderId: 't-1', eventType: 'snapshot_published', actorKind: 'system', sourceRefType: 'snapshot', sourceRefId: 's-1', singular: true });
  assert.deepEqual(db.rpcCalls[0].args, {
    p_tender_id: 't-1', p_event_type: 'snapshot_published', p_actor_kind: 'system', p_created_by: null,
    p_source_ref_type: 'snapshot', p_source_ref_id: 's-1', p_metadata: null, p_note: null, p_singular: true,
  });
}

async function getActorReadsJobRow() {
  const db = fakeDb({ tables: { psi_tender_processing_jobs: { single: { data: { requested_by: 'u-1', analysis_authorized_by: 'u-2', tender_id: 't-1', opportunity_id: 'o-1' }, error: null } } } });
  const actor = await getTenderProcessingJobActor(db, 'job-1');
  assert.equal(actor.requested_by, 'u-1');
  assert.equal(actor.analysis_authorized_by, 'u-2');
}

async function run() {
  await claimReturnsNullWhenNotClaimed();
  await claimComposesFullShapeWhenClaimed();
  await updatePreservesLeaseByDefaultAndReleasesExplicitly();
  await recordImportItemMapsCamelCaseToRpcParams();
  await recordDocumentChunkMapsCamelCaseToRpcParams();
  await recordDocumentChunkDefaultsSnapshotIdToNull();
  await appendEventMapsCamelCaseToRpcParams();
  await getActorReadsJobRow();
  console.log('tender-processing-worker-rpc passed');
}
run();
