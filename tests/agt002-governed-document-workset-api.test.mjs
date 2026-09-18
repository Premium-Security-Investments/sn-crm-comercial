import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  AGT002_GOVERNED_WORKSET_CAPACITY_REJECTED_CODE,
  AGT002_GOVERNED_WORKSET_CAPACITY_UNAVAILABLE_CODE,
  buildAgt002GovernedWorksetFrozenEngineInput,
  computeAgt002GovernedWorksetIdempotencyKey,
  evaluateAgt002GovernedWorksetFreezeCapacityPreflight,
  findLatestAgt002GovernedWorksetContextVersionId,
  findLatestAgt002GovernedWorksetSnapshotId,
  freezeAgt002GovernedDocumentWorkset,
  mapAgt002GovernedWorksetFreezeRpcError,
  projectAgt002GovernedWorksetFreezeResult,
  resolveAgt002GovernedWorksetCandidates,
  validateAgt002GovernedWorksetFreezeRequest,
} from '../agt002-governed-document-workset-api.js';
import { computeAgt002WorksetSelectionHash } from '../agt002-governed-document-worksets.js';
import { AGT002_GOVERNED_WORKSET_MAX_BATCHES, AGT002_GOVERNED_WORKSET_FREEZE_ROUTE } from '../agt002-governed-workset-capacity.js';
import { buildAgt002FrozenEngineInput } from '../agt002-reanalysis-input.js';
import { createAgt002ReanalysisExecutor } from '../agt002-reanalysis-executor.js';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT } from '../agt002-preview-reasoning-effort.js';

function uuid(label) {
  const hex = Buffer.from(String(label)).toString('hex').padEnd(32, '0').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
function hex64(label) {
  const base = Buffer.from(String(label)).toString('hex');
  return base.repeat(Math.ceil(64 / base.length)).slice(0, 64);
}

const OPPORTUNITY_ID = uuid('opportunity-1');
const TENDER_ID = uuid('tender-1');
const ACTOR_ID = uuid('actor-1');
const SNAPSHOT_ID = uuid('snapshot-1');
const CONTEXT_VERSION_ID = uuid('context-1');
const DOC_IDS = Array.from({ length: 4 }, (_, i) => uuid(`doc-${i + 1}`));
const EXTRACTION_IDS = Array.from({ length: 4 }, (_, i) => uuid(`extraction-${i + 1}`));
const CONTENT_HASHES = Array.from({ length: 4 }, (_, i) => hex64(`content-${i + 1}`));
const TEXT_HASHES = Array.from({ length: 4 }, (_, i) => hex64(`text-${i + 1}`));

function requestedMember(i, overrides = {}) {
  return {
    document_version_id: DOC_IDS[i],
    source_classification: 'official',
    inclusion_reason: `Reason ${i} for including this document.`,
    ...overrides,
  };
}

function candidateFor(i, overrides = {}) {
  return {
    document_version_id: DOC_IDS[i],
    opportunity_id: OPPORTUNITY_ID,
    tender_id: TENDER_ID,
    current: true,
    extraction_status: 'ok',
    content_hash: CONTENT_HASHES[i],
    extraction_id: EXTRACTION_IDS[i],
    extraction_text_hash: TEXT_HASHES[i],
    extracted_text_char_count: 1_000,
    ...overrides,
  };
}

/** Canonical base frozen-engine-input source: a real buildAgt002FrozenEngineInput output whose
 * analysis_context matches the given opportunity/snapshot scope, and whose idempotency_key is
 * whatever the caller passes in (so tests can bind it to the real server-computed value). */
function canonicalFrozenEngineInputSource({ opportunityId = OPPORTUNITY_ID, snapshotId = SNAPSHOT_ID, idempotencyKey, overrides = {} } = {}) {
  return buildAgt002FrozenEngineInput({
    runtimeConfig: {
      model: 'sonnet',
      policyVersion: 'policy-governed-1',
      timeoutMs: 165_000,
      dailyMaxRuns: 20,
      maxConcurrent: 2,
      effort: AGT002_PREVIEW_DEFAULT_REASONING_EFFORT,
    },
    analysisConfig: { AGT002_CANONICAL_ONLY: true },
    analysisContext: { opportunity: { id: opportunityId }, snapshotId, canonicalOnly: true },
    idempotencyKey,
    ...overrides,
  });
}

/** buildFrozenEngineInputSource callback matching freezeAgt002GovernedDocumentWorkset's real
 * calling convention: binds a fresh canonical source to whatever scope/idempotencyKey it resolved. */
function canonicalBuildFrozenEngineInputSource() {
  return ({ opportunityId, snapshotId, idempotencyKey }) => canonicalFrozenEngineInputSource({ opportunityId, snapshotId, idempotencyKey });
}

/** Full, mutually-consistent argument set for buildAgt002GovernedWorksetFrozenEngineInput: a
 * server-computed idempotencyKey plus a canonical source bound to the exact same scope/key. */
function governedEngineInputArgs({ opportunityId = OPPORTUNITY_ID, tenderId = TENDER_ID, snapshotId = SNAPSHOT_ID, contextVersionId = CONTEXT_VERSION_ID, frozen }) {
  const idempotencyKey = computeAgt002GovernedWorksetIdempotencyKey({ opportunityId, tenderId, snapshotId, contextVersionId, selectionHash: frozen.selectionHash });
  const frozenEngineInputSource = canonicalFrozenEngineInputSource({ opportunityId, snapshotId, idempotencyKey });
  return { opportunityId, tenderId, snapshotId, contextVersionId, frozen, frozenEngineInputSource, idempotencyKey };
}

function frozenResultShape(overrides = {}) {
  return {
    status: 'created',
    workset_id: uuid('workset-1'),
    run_id: uuid('run-1'),
    reanalysis_job_id: uuid('job-1'),
    member_count: 2,
    selection_hash: hex64('selection-1'),
    ...overrides,
  };
}

/** Minimal supabase-js-shaped fake: .rpc() plus a chainable .from().select().eq()...maybeSingle(). */
function fakeDb({ rpcResults = {}, fromResults = {} } = {}) {
  const calls = { rpc: [], from: [] };
  return {
    calls,
    rpc(name, args) {
      calls.rpc.push({ name, args });
      const queued = rpcResults[name];
      const next = Array.isArray(queued) ? queued.shift() : queued;
      if (typeof next === 'function') return Promise.resolve(next(args));
      return Promise.resolve(next || { data: null, error: null });
    },
    from(table) {
      const record = { table, select: null, eq: [], order: null, limit: null };
      calls.from.push(record);
      const builder = {
        select(columns) { record.select = columns; return builder; },
        eq(column, value) { record.eq.push([column, value]); return builder; },
        order(column, opts) { record.order = [column, opts]; return builder; },
        limit(n) { record.limit = n; return builder; },
        maybeSingle() {
          const queued = fromResults[table];
          const next = Array.isArray(queued) ? queued.shift() : queued;
          return Promise.resolve(next || { data: null, error: null });
        },
      };
      return builder;
    },
  };
}

describe('validateAgt002GovernedWorksetFreezeRequest', () => {
  it('accepts a well-formed request and canonicalizes documents', () => {
    const result = validateAgt002GovernedWorksetFreezeRequest({
      opportunity_id: OPPORTUNITY_ID,
      documents: [requestedMember(1), requestedMember(0)],
    });
    assert.equal(result.opportunityId, OPPORTUNITY_ID);
    assert.equal(result.tenderId, undefined, 'tender_id is server-resolved, never accepted from the client');
    assert.equal(result.requestedMembers.length, 2);
    assert.deepEqual(result.requestedMembers.map((m) => m.document_version_id), [DOC_IDS[0], DOC_IDS[1]].sort());
  });

  it('canonicalizes uppercase opportunity_id and document_version_id to lowercase', () => {
    const result = validateAgt002GovernedWorksetFreezeRequest({
      opportunity_id: OPPORTUNITY_ID.toUpperCase(),
      documents: [requestedMember(0, { document_version_id: DOC_IDS[0].toUpperCase() })],
    });
    assert.equal(result.opportunityId, OPPORTUNITY_ID);
    assert.equal(result.requestedMembers[0].document_version_id, DOC_IDS[0]);
  });

  for (const badBody of [null, undefined, 'x', 42, [], ['a']]) {
    it(`rejects a non-object body: ${JSON.stringify(badBody)}`, () => {
      assert.throws(
        () => validateAgt002GovernedWorksetFreezeRequest(badBody),
        (error) => error.status === 400 && error.code === 'invalid_governed_workset_input',
      );
    });
  }

  for (const extraKey of ['tender_id', 'snapshot_id', 'content_hash', 'frozen_engine_input', 'idempotency_key', 'actor_id']) {
    it(`rejects an unexpected top-level key "${extraKey}"`, () => {
      const body = { opportunity_id: OPPORTUNITY_ID, documents: [requestedMember(0)], [extraKey]: 'x' };
      assert.throws(
        () => validateAgt002GovernedWorksetFreezeRequest(body),
        (error) => error.status === 400 && error.code === 'invalid_governed_workset_input' && error.message.includes(extraKey),
      );
    });
  }

  it('rejects a malformed opportunity_id', () => {
    assert.throws(
      () => validateAgt002GovernedWorksetFreezeRequest({ opportunity_id: 'not-a-uuid', documents: [requestedMember(0)] }),
      (error) => error.status === 400 && error.code === 'invalid_governed_workset_input',
    );
  });

  it('rejects an empty documents array as a 400 invalid_governed_workset_input', () => {
    assert.throws(
      () => validateAgt002GovernedWorksetFreezeRequest({ opportunity_id: OPPORTUNITY_ID, documents: [] }),
      (error) => error.status === 400 && error.code === 'invalid_governed_workset_input',
    );
  });

  it('rejects duplicate document_version_id entries', () => {
    assert.throws(
      () => validateAgt002GovernedWorksetFreezeRequest({
        opportunity_id: OPPORTUNITY_ID,
        documents: [requestedMember(0), requestedMember(0)],
      }),
      (error) => error.status === 400 && error.code === 'invalid_governed_workset_input',
    );
  });

  it('rejects a document member carrying an unexpected key', () => {
    assert.throws(
      () => validateAgt002GovernedWorksetFreezeRequest({
        opportunity_id: OPPORTUNITY_ID,
        documents: [requestedMember(0, { content_hash: hex64('injected') })],
      }),
      (error) => error.status === 400 && error.code === 'invalid_governed_workset_input',
    );
  });

  it('rejects a blank inclusion_reason on a document member', () => {
    assert.throws(
      () => validateAgt002GovernedWorksetFreezeRequest({
        opportunity_id: OPPORTUNITY_ID,
        documents: [requestedMember(0, { inclusion_reason: '   ' })],
      }),
      (error) => error.status === 400 && error.code === 'invalid_governed_workset_input',
    );
  });

  it('rejects an unknown source_classification on a document member', () => {
    assert.throws(
      () => validateAgt002GovernedWorksetFreezeRequest({
        opportunity_id: OPPORTUNITY_ID,
        documents: [requestedMember(0, { source_classification: 'unverified' })],
      }),
      (error) => error.status === 400 && error.code === 'invalid_governed_workset_input',
    );
  });

  it('rejects more than 12 document members', () => {
    const documents = Array.from({ length: 13 }, (_, i) => ({
      document_version_id: uuid(`overflow-doc-${i}`), source_classification: 'official', inclusion_reason: `Reason ${i}.`,
    }));
    assert.throws(
      () => validateAgt002GovernedWorksetFreezeRequest({ opportunity_id: OPPORTUNITY_ID, documents }),
      (error) => error.status === 400 && error.code === 'invalid_governed_workset_input',
    );
  });
});

describe('mapAgt002GovernedWorksetFreezeRpcError', () => {
  const cases = [
    ['22023', 400, 'invalid_governed_workset_input'],
    ['42501', 403, 'governed_workset_forbidden'],
    ['P0002', 404, 'governed_workset_reference_not_found'],
    ['55000', 409, 'governed_workset_conflict'],
    ['23505', 409, 'governed_workset_conflict'],
  ];
  for (const [code, status, mappedCode] of cases) {
    it(`maps errcode ${code} to ${status} ${mappedCode}`, () => {
      const mapped = mapAgt002GovernedWorksetFreezeRpcError({ code, message: 'db message' });
      assert.equal(mapped.status, status);
      assert.equal(mapped.code, mappedCode);
      assert.equal(mapped.message, 'db message');
    });
  }
  it('fails closed on an unrecognized errcode', () => {
    const mapped = mapAgt002GovernedWorksetFreezeRpcError({ code: '99999', message: 'db message' });
    assert.equal(mapped.status, 500);
    assert.equal(mapped.code, 'governed_workset_internal_error');
  });
});

describe('resolveAgt002GovernedWorksetCandidates', () => {
  it('resolves one candidate per requested member, in order, via the single-id RPC', async () => {
    const requestedMembers = [requestedMember(0), requestedMember(1)];
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: [
          { data: candidateFor(0), error: null },
          { data: candidateFor(1), error: null },
        ],
      },
    });
    const evidenceRows = await resolveAgt002GovernedWorksetCandidates(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers });
    assert.equal(db.calls.rpc.length, 2);
    assert.deepEqual(db.calls.rpc[0].args, { p_opportunity_id: OPPORTUNITY_ID, p_tender_id: TENDER_ID, p_document_version_id: DOC_IDS[0] });
    assert.deepEqual(db.calls.rpc[1].args, { p_opportunity_id: OPPORTUNITY_ID, p_tender_id: TENDER_ID, p_document_version_id: DOC_IDS[1] });
    assert.deepEqual(evidenceRows.map((r) => r.document_version_id), [DOC_IDS[0], DOC_IDS[1]]);
  });

  it('fails closed on the first candidate error and never resolves the remaining members', async () => {
    const requestedMembers = [requestedMember(0), requestedMember(1), requestedMember(2)];
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: [
          { data: null, error: { code: '55000', message: 'La versión documental ya no es la vigente.' } },
        ],
      },
    });
    await assert.rejects(
      resolveAgt002GovernedWorksetCandidates(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers }),
      (error) => error.status === 409 && error.code === 'governed_workset_conflict',
    );
    assert.equal(db.calls.rpc.length, 1, 'must abort before resolving the remaining members');
  });

  it('fails closed on a malformed (non-object) candidate response', async () => {
    const db = fakeDb({ rpcResults: { psi_resolve_agt002_governed_document_candidate: { data: null, error: null } } });
    await assert.rejects(
      resolveAgt002GovernedWorksetCandidates(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: [requestedMember(0)] }),
    );
  });
});

describe('findLatestAgt002GovernedWorksetSnapshotId', () => {
  it('selects only the id column, scoped by opportunity/tender, ordered to the latest', async () => {
    const db = fakeDb({ fromResults: { psi_tender_document_snapshots: { data: { id: SNAPSHOT_ID }, error: null } } });
    const snapshotId = await findLatestAgt002GovernedWorksetSnapshotId(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID });
    assert.equal(snapshotId, SNAPSHOT_ID);
    const call = db.calls.from[0];
    assert.equal(call.table, 'psi_tender_document_snapshots');
    assert.equal(call.select, 'id', 'must never select document/manifest columns, only the id');
    assert.deepEqual(call.eq, [['opportunity_id', OPPORTUNITY_ID], ['tender_id', TENDER_ID]]);
    assert.deepEqual(call.order, ['created_at', { ascending: false }]);
    assert.equal(call.limit, 1);
  });

  it('fails closed when no snapshot has ever been registered for this scope', async () => {
    const db = fakeDb({ fromResults: { psi_tender_document_snapshots: { data: null, error: null } } });
    await assert.rejects(
      findLatestAgt002GovernedWorksetSnapshotId(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID }),
      (error) => error.status === 409 && error.code === 'governed_workset_conflict',
    );
  });

  it('propagates a database error', async () => {
    const db = fakeDb({ fromResults: { psi_tender_document_snapshots: { data: null, error: { message: 'db down' } } } });
    await assert.rejects(findLatestAgt002GovernedWorksetSnapshotId(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID }));
  });
});

describe('findLatestAgt002GovernedWorksetContextVersionId', () => {
  it('selects only the id column, scoped by opportunity/tender/snapshot', async () => {
    const db = fakeDb({ fromResults: { psi_agt002_context_versions: { data: { id: CONTEXT_VERSION_ID }, error: null } } });
    const contextVersionId = await findLatestAgt002GovernedWorksetContextVersionId(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID });
    assert.equal(contextVersionId, CONTEXT_VERSION_ID);
    const call = db.calls.from[0];
    assert.equal(call.table, 'psi_agt002_context_versions');
    assert.equal(call.select, 'id');
    assert.deepEqual(call.eq, [['opportunity_id', OPPORTUNITY_ID], ['tender_id', TENDER_ID], ['snapshot_id', SNAPSHOT_ID]]);
  });

  it('fails closed when no context version has ever been registered for this snapshot', async () => {
    const db = fakeDb({ fromResults: { psi_agt002_context_versions: { data: null, error: null } } });
    await assert.rejects(
      findLatestAgt002GovernedWorksetContextVersionId(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID }),
      (error) => error.status === 409 && error.code === 'governed_workset_conflict',
    );
  });
});

describe('computeAgt002GovernedWorksetIdempotencyKey', () => {
  const base = { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID, selectionHash: hex64('selection-1') };

  it('is deterministic for identical inputs', () => {
    assert.equal(computeAgt002GovernedWorksetIdempotencyKey(base), computeAgt002GovernedWorksetIdempotencyKey({ ...base }));
  });

  for (const field of ['opportunityId', 'tenderId', 'snapshotId', 'contextVersionId', 'selectionHash']) {
    it(`changes when ${field} differs`, () => {
      const altered = { ...base, [field]: `${base[field]}-different` };
      assert.notEqual(computeAgt002GovernedWorksetIdempotencyKey(base), computeAgt002GovernedWorksetIdempotencyKey(altered));
    });
  }
});

describe('buildAgt002GovernedWorksetFrozenEngineInput — worker/job payload identity contract', () => {
  it('derives governed_workset_members from frozen.members ONLY, never from a broader document list', () => {
    const frozen = {
      selectionHash: hex64('selection-2'),
      members: [
        { document_version_id: DOC_IDS[0], source_classification: 'official', inclusion_reason: 'r0', content_hash: CONTENT_HASHES[0], extraction_id: EXTRACTION_IDS[0], extraction_text_hash: TEXT_HASHES[0] },
        { document_version_id: DOC_IDS[1], source_classification: 'corporate', inclusion_reason: 'r1', content_hash: CONTENT_HASHES[1], extraction_id: EXTRACTION_IDS[1], extraction_text_hash: TEXT_HASHES[1] },
      ],
    };
    // Simulates "every current tender document" (a superset a live listing query could return);
    // none of the extra ids may leak into the engine input.
    const allCurrentTenderDocumentIds = [...DOC_IDS];
    const engineInput = buildAgt002GovernedWorksetFrozenEngineInput(governedEngineInputArgs({ frozen }));

    assert.deepEqual(engineInput.document_workset_identity, {
      opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, snapshot_id: SNAPSHOT_ID,
      context_version_id: CONTEXT_VERSION_ID, selection_hash: frozen.selectionHash,
    });
    assert.equal(engineInput.governed_workset_members.length, frozen.members.length);
    assert.deepEqual(
      engineInput.governed_workset_members.map((m) => m.document_version_id),
      frozen.members.map((m) => m.document_version_id),
    );
    for (const id of allCurrentTenderDocumentIds.slice(frozen.members.length)) {
      assert.ok(
        !engineInput.governed_workset_members.some((m) => m.document_version_id === id),
        `document ${id} was never part of the frozen package and must never appear in the engine input`,
      );
    }
    // Carries the full six-field evidence shape per member — the same shape the executor
    // re-validates and the selection hash is computed over — never a narrower ad hoc shape.
    for (const member of engineInput.governed_workset_members) {
      assert.deepEqual(Object.keys(member).sort(), [
        'content_hash', 'document_version_id', 'extraction_id', 'extraction_text_hash', 'inclusion_reason', 'source_classification',
      ]);
    }
  });

  it('produces an engine input bounded to exactly N members for every N from 1 to 12', () => {
    for (const n of [1, 4, 12]) {
      const frozen = {
        selectionHash: hex64(`selection-n-${n}`),
        members: Array.from({ length: n }, (_, i) => ({
          document_version_id: uuid(`bounded-doc-${n}-${i}`), source_classification: 'official', inclusion_reason: `r${i}`,
          content_hash: hex64(`content-n-${n}-${i}`), extraction_id: uuid(`extraction-n-${n}-${i}`), extraction_text_hash: hex64(`text-n-${n}-${i}`),
        })),
      };
      const engineInput = buildAgt002GovernedWorksetFrozenEngineInput(governedEngineInputArgs({ frozen }));
      assert.equal(engineInput.governed_workset_members.length, n);
    }
  });
});

describe('buildAgt002GovernedWorksetFrozenEngineInput — integration regression: the governed worker payload must carry a canonical frozen engine input source through to the real executor', () => {
  const frozenMembers = [
    {
      document_version_id: DOC_IDS[0], source_classification: 'official', inclusion_reason: 'r0',
      content_hash: CONTENT_HASHES[0], extraction_id: EXTRACTION_IDS[0], extraction_text_hash: TEXT_HASHES[0],
    },
    {
      document_version_id: DOC_IDS[1], source_classification: 'official', inclusion_reason: 'r1',
      content_hash: CONTENT_HASHES[1], extraction_id: EXTRACTION_IDS[1], extraction_text_hash: TEXT_HASHES[1],
    },
    {
      document_version_id: DOC_IDS[2], source_classification: 'official', inclusion_reason: 'r2',
      content_hash: CONTENT_HASHES[2], extraction_id: EXTRACTION_IDS[2], extraction_text_hash: TEXT_HASHES[2],
    },
  ];
  // The real executor recomputes the selection hash from the six-field members and requires an
  // exact match against document_workset_identity.selection_hash, so this fixture (unlike the
  // structural-shape-only tests above) must carry the actual computed hash, not an arbitrary one.
  const frozen = {
    selectionHash: computeAgt002WorksetSelectionHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: frozenMembers }),
    members: frozenMembers,
  };
  const idempotencyKey = computeAgt002GovernedWorksetIdempotencyKey({
    opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID, selectionHash: frozen.selectionHash,
  });
  const frozenEngineInputSource = canonicalFrozenEngineInputSource({
    idempotencyKey,
    overrides: {
      analysisContext: {
        opportunity: { id: OPPORTUNITY_ID },
        snapshotId: SNAPSHOT_ID,
        canonicalOnly: true,
        documents: frozen.members.map((m) => ({
          document_version_id: m.document_version_id,
          source_classification: m.source_classification,
          inclusion_reason: m.inclusion_reason,
        })),
      },
    },
  });

  it('retains schema_version/engine_identity/analysis_flags/analysis_context from the canonical frozen input source alongside document_workset_identity/governed_workset_members', () => {
    const engineInput = buildAgt002GovernedWorksetFrozenEngineInput({
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
      frozen, frozenEngineInputSource, idempotencyKey,
    });

    assert.equal(engineInput.schema_version, frozenEngineInputSource.schema_version, 'must retain the canonical schema_version');
    assert.deepEqual(engineInput.engine_identity, frozenEngineInputSource.engine_identity, 'must retain the canonical engine identity');
    assert.deepEqual(engineInput.analysis_flags, frozenEngineInputSource.analysis_flags, 'must retain the canonical analysis flags');
    assert.deepEqual(engineInput.analysis_context, frozenEngineInputSource.analysis_context, 'must retain the canonical analysis context');
    assert.deepEqual(engineInput.document_workset_identity, {
      opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, snapshot_id: SNAPSHOT_ID,
      context_version_id: CONTEXT_VERSION_ID, selection_hash: frozen.selectionHash,
    });
    assert.deepEqual(
      engineInput.governed_workset_members.map((m) => m.document_version_id),
      frozen.members.map((m) => m.document_version_id),
    );
  });

  it('passed as a job.frozenEngineInput, reaches the real executor\'s preview claim/runtime construction rather than failing closed to invalid_output before the claim', async () => {
    const engineInput = buildAgt002GovernedWorksetFrozenEngineInput({
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
      frozen, frozenEngineInputSource, idempotencyKey,
    });
    const job = {
      jobId: 'governed-job-1',
      leaseId: 'governed-lease-1',
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      snapshotId: SNAPSHOT_ID,
      contextVersionId: CONTEXT_VERSION_ID,
      idempotencyKey: frozenEngineInputSource.engine_identity.idempotency_key,
      frozenEngineInput: engineInput,
    };

    const calls = { claim: [], find: [], runtime: [], post: [] };
    const executor = createAgt002ReanalysisExecutor({
      environment: {},
      claimPreviewRun: async (...args) => { calls.claim.push(args); return { status: 'claimed', claim_id: 'governed-claim-1' }; },
      findPreviewRun: async (...args) => { calls.find.push(args); return { run_id: 'unexpected-existing-run' }; },
      releasePreviewClaim: async () => {},
      countDailyRuns: async () => 0,
      createRuntime: (options) => { calls.runtime.push(options); return { analyze() {} }; },
      runPostBridgeAnalysis: async (...args) => { calls.post.push(args); return { status: 'completed', analysis_run_id: 'run-governed-1', error_code: null }; },
      createCorrelationId: () => 'governed-correlation-1',
      observability: { record() {} },
    });

    const result = await executor({ kind: 'db' }, job);

    assert.equal(calls.claim.length, 1, 'the governed frozen input must pass validFrozenInput and reach the preview claim');
    assert.equal(calls.find.length, 0, 'a fresh claim must never fall through to the existing-run lookup');
    assert.equal(calls.runtime.length, 1, 'must reach runtime construction, not fail closed before it');
    assert.notEqual(result.error_code, 'invalid_output', 'must never fail closed to invalid_output before the claim');
    assert.deepEqual(result, { status: 'completed', analysis_run_id: 'run-governed-1', error_code: null, reused: false });
  });
});

describe('buildAgt002GovernedWorksetFrozenEngineInput — canonical source requirement, immutability and field preservation', () => {
  const frozen = {
    selectionHash: hex64('selection-direct-1'),
    members: [
      {
        document_version_id: DOC_IDS[0], source_classification: 'official', inclusion_reason: 'r0',
        content_hash: CONTENT_HASHES[0], extraction_id: EXTRACTION_IDS[0], extraction_text_hash: TEXT_HASHES[0],
      },
    ],
  };
  const idempotencyKey = computeAgt002GovernedWorksetIdempotencyKey({
    opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID, selectionHash: frozen.selectionHash,
  });

  it('preserves every canonical field of a source that carries legal corpus, v3 governance and manifest fields', () => {
    const frozenEngineInputSource = canonicalFrozenEngineInputSource({
      idempotencyKey,
      overrides: {
        legalCorpusContext: { articles: [{ id: 'a1', text: 'texto legal' }] },
        manizalesManifestSource: { manifest_id: uuid('manifest-1') },
      },
    });
    const engineInput = buildAgt002GovernedWorksetFrozenEngineInput({
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
      frozen, frozenEngineInputSource, idempotencyKey,
    });

    for (const key of Object.keys(frozenEngineInputSource)) {
      assert.deepEqual(engineInput[key], frozenEngineInputSource[key], `canonical source field "${key}" must be preserved untouched`);
    }
    assert.deepEqual(Object.keys(engineInput).sort(), [...Object.keys(frozenEngineInputSource), 'document_workset_identity', 'governed_workset_members'].sort());
  });

  it('never mutates the frozenEngineInputSource it composes from', () => {
    const frozenEngineInputSource = canonicalFrozenEngineInputSource({ idempotencyKey });
    const before = JSON.stringify(frozenEngineInputSource);
    buildAgt002GovernedWorksetFrozenEngineInput({
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
      frozen, frozenEngineInputSource, idempotencyKey,
    });
    assert.equal(JSON.stringify(frozenEngineInputSource), before, 'the source object must never be mutated');
  });

  it('deep-freezes the composed output, including nested arrays/objects', () => {
    const frozenEngineInputSource = canonicalFrozenEngineInputSource({ idempotencyKey });
    const engineInput = buildAgt002GovernedWorksetFrozenEngineInput({
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
      frozen, frozenEngineInputSource, idempotencyKey,
    });
    assert.ok(Object.isFrozen(engineInput));
    assert.ok(Object.isFrozen(engineInput.engine_identity));
    assert.ok(Object.isFrozen(engineInput.document_workset_identity));
    assert.ok(Object.isFrozen(engineInput.governed_workset_members));
    assert.ok(Object.isFrozen(engineInput.governed_workset_members[0]));
    assert.throws(() => { engineInput.governed_workset_members.push({}); }, TypeError);
    assert.throws(() => { engineInput.document_workset_identity.opportunity_id = 'x'; }, TypeError);
  });

  for (const [label, source] of [
    ['null', null],
    ['a non-object', 'not-an-object'],
    ['an array', []],
    ['missing schema_version', { engine_identity: { idempotency_key: 'x' }, analysis_flags: {}, analysis_context: {} }],
    ['missing engine_identity', { schema_version: 2, analysis_flags: {}, analysis_context: {} }],
    ['a blank engine_identity.idempotency_key', { schema_version: 2, engine_identity: { idempotency_key: '  ' }, analysis_flags: {}, analysis_context: {} }],
    ['missing analysis_flags', { schema_version: 2, engine_identity: { idempotency_key: 'x' }, analysis_context: {} }],
    ['missing analysis_context', { schema_version: 2, engine_identity: { idempotency_key: 'x' }, analysis_flags: {} }],
    ['an already-extended source', { schema_version: 2, engine_identity: { idempotency_key: 'x' }, analysis_flags: {}, analysis_context: {}, document_workset_identity: {}, governed_workset_members: [] }],
  ]) {
    it(`rejects a missing/malformed frozenEngineInputSource: ${label}`, () => {
      assert.throws(() => buildAgt002GovernedWorksetFrozenEngineInput({
        opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
        frozen, frozenEngineInputSource: source, idempotencyKey,
      }));
    });
  }

  it('rejects a source whose analysis_context.opportunity.id does not match the opportunityId argument', () => {
    const frozenEngineInputSource = canonicalFrozenEngineInputSource({ opportunityId: uuid('other-opportunity'), idempotencyKey });
    assert.throws(() => buildAgt002GovernedWorksetFrozenEngineInput({
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
      frozen, frozenEngineInputSource, idempotencyKey,
    }));
  });

  it('rejects a source whose analysis_context.snapshotId does not match the snapshotId argument', () => {
    const frozenEngineInputSource = canonicalFrozenEngineInputSource({ snapshotId: uuid('other-snapshot'), idempotencyKey });
    assert.throws(() => buildAgt002GovernedWorksetFrozenEngineInput({
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
      frozen, frozenEngineInputSource, idempotencyKey,
    }));
  });

  for (const missingIdempotencyKey of [undefined, null, '', '   ']) {
    it(`rejects a missing idempotencyKey argument: ${JSON.stringify(missingIdempotencyKey)}`, () => {
      const frozenEngineInputSource = canonicalFrozenEngineInputSource({ idempotencyKey });
      assert.throws(() => buildAgt002GovernedWorksetFrozenEngineInput({
        opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
        frozen, frozenEngineInputSource, idempotencyKey: missingIdempotencyKey,
      }));
    });
  }

  it('rejects an idempotencyKey argument that does not equal the server-computed value for this scope/selection', () => {
    const frozenEngineInputSource = canonicalFrozenEngineInputSource({ idempotencyKey });
    assert.throws(() => buildAgt002GovernedWorksetFrozenEngineInput({
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
      frozen, frozenEngineInputSource, idempotencyKey: hex64('some-other-key'),
    }));
  });

  it('rejects when the source\'s engine_identity.idempotency_key does not match the idempotencyKey argument', () => {
    // Built with a different (also server-computed-looking) idempotency key than the one passed in.
    const mismatchedSource = canonicalFrozenEngineInputSource({ idempotencyKey: hex64('mismatched-key') });
    assert.throws(() => buildAgt002GovernedWorksetFrozenEngineInput({
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, contextVersionId: CONTEXT_VERSION_ID,
      frozen, frozenEngineInputSource: mismatchedSource, idempotencyKey,
    }));
  });
});

describe('static contract: the module never lists or re-resolves all current tender documents', () => {
  const source = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'agt002-governed-document-workset-api.js'), 'utf8');

  for (const forbidden of ['getTenderDocumentRecords', 'currentDocs', 'analysisDocuments', "select('*')", '.select("*")']) {
    it(`never references "${forbidden}"`, () => {
      assert.equal(source.includes(forbidden), false);
    });
  }

  it('never queries the document-version table directly (all document identity is resolved through the single-id RPC)', () => {
    assert.equal(source.includes("psi_tender_document_versions'"), false);
    assert.equal(source.includes('psi_tender_document_versions"'), false);
  });

  it('the two id-only lookups select nothing but "id"', () => {
    const selectCalls = [...source.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(selectCalls.length >= 2, 'expected the snapshot and context-version id-only lookups');
    for (const call of selectCalls) assert.equal(call.trim(), "'id'");
  });
});

describe('projectAgt002GovernedWorksetFreezeResult', () => {
  it('preserves exactly the six closed identity/status fields plus the closed capacity preflight result', () => {
    const capacity = {
      version: 'agt002-governed-workset-capacity@1', route: AGT002_GOVERNED_WORKSET_FREEZE_ROUTE, verdict: 'APTO',
      max_batch_count: 64, predicted_batch_count: 1, source_char_count: 1000, chars_per_batch: 20_000, document_count: 1,
    };
    const result = frozenResultShape({ capacity_preflight: capacity });
    const projected = projectAgt002GovernedWorksetFreezeResult(result);
    assert.deepEqual(Object.keys(projected).sort(), ['capacity_preflight', 'member_count', 'reanalysis_job_id', 'run_id', 'selection_hash', 'status', 'workset_id']);
    assert.equal(projected.status, result.status);
    assert.equal(projected.workset_id, result.workset_id);
    assert.equal(projected.run_id, result.run_id);
    assert.equal(projected.reanalysis_job_id, result.reanalysis_job_id);
    assert.equal(projected.member_count, result.member_count);
    assert.equal(projected.selection_hash, result.selection_hash);
    assert.deepEqual(projected.capacity_preflight, capacity, 'the APTO capacity evidence must reach the sanitized projection untouched');
  });

  it('defense-in-depth: strips banned keys even if a malformed result somehow carried them', () => {
    const result = frozenResultShape({ frozen_engine_input: { prompt: 'x' }, extracted_text: 'y', storage_path: '/z' });
    const projected = projectAgt002GovernedWorksetFreezeResult(result);
    const serialized = JSON.stringify(projected);
    for (const banned of ['frozen_engine_input', 'extracted_text', 'storage_path']) {
      assert.equal(serialized.includes(banned), false);
    }
  });
});

describe('evaluateAgt002GovernedWorksetFreezeCapacityPreflight', () => {
  it('sums exclusively the server-resolved extracted_text_char_count, ignoring count-shaped distractor fields', () => {
    const evidenceRows = [
      candidateFor(0, { extracted_text_char_count: 1_000, source_char_count: 2_000_000, max_batch_count: 999_999, chars_per_batch: 1 }),
      candidateFor(1, { extracted_text_char_count: 2_000, source_char_count: 2_000_000, max_batch_count: 999_999, chars_per_batch: 1 }),
    ];
    const result = evaluateAgt002GovernedWorksetFreezeCapacityPreflight(evidenceRows);
    assert.equal(result.source_char_count, 3_000, 'must sum only extracted_text_char_count, never the distractor source_char_count field');
    assert.equal(result.predicted_batch_count, 1);
    assert.equal(result.verdict, 'APTO');
  });
});

describe('freezeAgt002GovernedDocumentWorkset — full orchestration', () => {
  function happyDb(overrides = {}) {
    return fakeDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: [
          { data: candidateFor(0), error: null },
          { data: candidateFor(1), error: null },
        ],
        psi_freeze_agt002_governed_document_workset: { data: frozenResultShape({ member_count: 2 }), error: null },
      },
      fromResults: {
        psi_tender_document_snapshots: { data: { id: SNAPSHOT_ID }, error: null },
        psi_agt002_context_versions: { data: { id: CONTEXT_VERSION_ID }, error: null },
      },
      ...overrides,
    });
  }

  it('resolves, validates, freezes and enqueues in one RPC call, binding server-resolved evidence only', async () => {
    const requestedMembers = [requestedMember(0), requestedMember(1)];
    const db = happyDb();
    const buildCalls = [];
    const buildFrozenEngineInputSource = async (resolved) => {
      buildCalls.push(resolved);
      return canonicalFrozenEngineInputSource({ opportunityId: resolved.opportunityId, snapshotId: resolved.snapshotId, idempotencyKey: resolved.idempotencyKey });
    };
    const result = await freezeAgt002GovernedDocumentWorkset(db, {
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers, buildFrozenEngineInputSource,
    });
    assert.equal(result.status, 'created');

    assert.equal(buildCalls.length, 1, 'the source factory must be invoked exactly once');
    const resolved = buildCalls[0];
    assert.equal(resolved.opportunityId, OPPORTUNITY_ID);
    assert.equal(resolved.tenderId, TENDER_ID);
    assert.equal(resolved.snapshotId, SNAPSHOT_ID);
    assert.equal(resolved.contextVersionId, CONTEXT_VERSION_ID);
    assert.equal(typeof resolved.idempotencyKey, 'string');
    assert.ok(resolved.idempotencyKey.length > 0);
    assert.equal(resolved.frozen.members.length, 2, 'the callback must receive the already-frozen evidence-verified package');
    assert.deepEqual(
      resolved.evidenceRows.map((row) => row.document_version_id),
      [DOC_IDS[0], DOC_IDS[1]],
      'the callback must receive the server-resolved candidate evidence rows',
    );
    assert.equal(result.capacity_preflight.verdict, 'APTO', 'a successful freeze projection must carry the APTO capacity preflight evidence');
    assert.equal(result.capacity_preflight.source_char_count, 2_000, 'source_char_count must be the sum of the server-resolved candidates\' extracted_text_char_count');
    assert.equal(result.capacity_preflight.max_batch_count, AGT002_GOVERNED_WORKSET_MAX_BATCHES[AGT002_GOVERNED_WORKSET_FREEZE_ROUTE]);

    const freezeCall = db.calls.rpc.find((c) => c.name === 'psi_freeze_agt002_governed_document_workset');
    assert.ok(freezeCall, 'must call the freeze RPC exactly once');
    assert.equal(freezeCall.args.p_opportunity_id, OPPORTUNITY_ID);
    assert.equal(freezeCall.args.p_tender_id, TENDER_ID);
    assert.equal(freezeCall.args.p_snapshot_id, SNAPSHOT_ID);
    assert.equal(freezeCall.args.p_context_version_id, CONTEXT_VERSION_ID);
    assert.equal(freezeCall.args.p_actor_profile_id, ACTOR_ID);
    assert.equal(typeof freezeCall.args.p_idempotency_key, 'string');
    assert.ok(freezeCall.args.p_idempotency_key.length > 0);

    assert.equal(freezeCall.args.p_members.length, 2);
    const sentMemberA = freezeCall.args.p_members.find((m) => m.document_version_id === DOC_IDS[0]);
    assert.equal(sentMemberA.content_hash, CONTENT_HASHES[0], 'content_hash must come from the resolved candidate, never the client request');
    assert.equal(sentMemberA.extraction_id, EXTRACTION_IDS[0]);
    assert.equal(sentMemberA.extraction_text_hash, TEXT_HASHES[0]);

    const sentIdentity = freezeCall.args.p_frozen_engine_input.document_workset_identity;
    assert.equal(sentIdentity.opportunity_id, OPPORTUNITY_ID);
    assert.equal(sentIdentity.tender_id, TENDER_ID);
    assert.equal(sentIdentity.snapshot_id, SNAPSHOT_ID);
    assert.equal(sentIdentity.context_version_id, CONTEXT_VERSION_ID);
    assert.match(sentIdentity.selection_hash, /^[0-9a-f]{64}$/, 'selection_hash must be the server-computed evidence hash, not a client value');
    assert.equal(freezeCall.args.p_frozen_engine_input.governed_workset_members.length, 2);
    assert.equal(freezeCall.args.p_frozen_engine_input.schema_version, 2, 'the canonical source built by the callback must reach the freeze RPC');
    assert.equal(
      freezeCall.args.p_frozen_engine_input.engine_identity.idempotency_key,
      freezeCall.args.p_idempotency_key,
      'the canonical source engine_identity must reach the RPC payload with the matching idempotency key',
    );
  });

  it('never trusts a client-supplied inclusion_reason/source_classification hash pairing — the frozen p_members always reflect the resolved evidence join', async () => {
    const requestedMembers = [requestedMember(0, { source_classification: 'draft', inclusion_reason: 'Client-stated reason.' })];
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: { data: candidateFor(0), error: null },
        psi_freeze_agt002_governed_document_workset: { data: frozenResultShape({ member_count: 1 }), error: null },
      },
      fromResults: {
        psi_tender_document_snapshots: { data: { id: SNAPSHOT_ID }, error: null },
        psi_agt002_context_versions: { data: { id: CONTEXT_VERSION_ID }, error: null },
      },
    });
    await freezeAgt002GovernedDocumentWorkset(db, {
      opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers,
      buildFrozenEngineInputSource: canonicalBuildFrozenEngineInputSource(),
    });
    const freezeCall = db.calls.rpc.find((c) => c.name === 'psi_freeze_agt002_governed_document_workset');
    assert.equal(freezeCall.args.p_members[0].source_classification, 'draft');
    assert.equal(freezeCall.args.p_members[0].inclusion_reason, 'Client-stated reason.');
    assert.equal(freezeCall.args.p_members[0].content_hash, CONTENT_HASHES[0]);
  });

  it('fails closed when candidate resolution fails and never calls the freeze RPC', async () => {
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: { data: null, error: { code: 'P0002', message: 'no existe' } },
      },
      fromResults: {
        psi_tender_document_snapshots: { data: { id: SNAPSHOT_ID }, error: null },
        psi_agt002_context_versions: { data: { id: CONTEXT_VERSION_ID }, error: null },
      },
    });
    await assert.rejects(
      freezeAgt002GovernedDocumentWorkset(db, {
        opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: [requestedMember(0)],
        buildFrozenEngineInputSource: canonicalBuildFrozenEngineInputSource(),
      }),
      (error) => error.status === 404 && error.code === 'governed_workset_reference_not_found',
    );
    assert.equal(db.calls.rpc.some((c) => c.name === 'psi_freeze_agt002_governed_document_workset'), false);
  });

  it('fails closed when a resolved candidate belongs to a different opportunity scope', async () => {
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: { data: candidateFor(0, { opportunity_id: uuid('other-opportunity') }), error: null },
      },
      fromResults: {
        psi_tender_document_snapshots: { data: { id: SNAPSHOT_ID }, error: null },
        psi_agt002_context_versions: { data: { id: CONTEXT_VERSION_ID }, error: null },
      },
    });
    await assert.rejects(
      freezeAgt002GovernedDocumentWorkset(db, {
        opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: [requestedMember(0)],
        buildFrozenEngineInputSource: canonicalBuildFrozenEngineInputSource(),
      }),
    );
    assert.equal(db.calls.rpc.some((c) => c.name === 'psi_freeze_agt002_governed_document_workset'), false);
  });

  it('fails closed when no document snapshot exists for the scope, before ever resolving candidates into a freeze call', async () => {
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: { data: candidateFor(0), error: null },
      },
      fromResults: {
        psi_tender_document_snapshots: { data: null, error: null },
      },
    });
    await assert.rejects(
      freezeAgt002GovernedDocumentWorkset(db, {
        opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: [requestedMember(0)],
        buildFrozenEngineInputSource: canonicalBuildFrozenEngineInputSource(),
      }),
      (error) => error.status === 409 && error.code === 'governed_workset_conflict',
    );
    assert.equal(db.calls.rpc.some((c) => c.name === 'psi_freeze_agt002_governed_document_workset'), false);
  });

  it('fails closed when no AGT-002 context version exists for the resolved snapshot', async () => {
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: { data: candidateFor(0), error: null },
      },
      fromResults: {
        psi_tender_document_snapshots: { data: { id: SNAPSHOT_ID }, error: null },
        psi_agt002_context_versions: { data: null, error: null },
      },
    });
    await assert.rejects(
      freezeAgt002GovernedDocumentWorkset(db, {
        opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: [requestedMember(0)],
        buildFrozenEngineInputSource: canonicalBuildFrozenEngineInputSource(),
      }),
      (error) => error.status === 409 && error.code === 'governed_workset_conflict',
    );
    assert.equal(db.calls.rpc.some((c) => c.name === 'psi_freeze_agt002_governed_document_workset'), false);
  });

  it('maps a freeze RPC error (e.g. missing custody authority) to a closed 403', async () => {
    const db = happyDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: [
          { data: candidateFor(0), error: null },
          { data: candidateFor(1), error: null },
        ],
        psi_freeze_agt002_governed_document_workset: { data: null, error: { code: '42501', message: 'El actor debe tener la autoridad de custodia documental de Licitaciones.' } },
      },
    });
    await assert.rejects(
      freezeAgt002GovernedDocumentWorkset(db, {
        opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: [requestedMember(0), requestedMember(1)],
        buildFrozenEngineInputSource: canonicalBuildFrozenEngineInputSource(),
      }),
      (error) => error.status === 403 && error.code === 'governed_workset_forbidden',
    );
  });

  it('fails closed on a malformed freeze RPC response', async () => {
    const db = happyDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: [
          { data: candidateFor(0), error: null },
          { data: candidateFor(1), error: null },
        ],
        psi_freeze_agt002_governed_document_workset: { data: { status: 'created' }, error: null },
      },
    });
    await assert.rejects(
      freezeAgt002GovernedDocumentWorkset(db, {
        opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: [requestedMember(0), requestedMember(1)],
        buildFrozenEngineInputSource: canonicalBuildFrozenEngineInputSource(),
      }),
      (error) => error.status === 409 && error.code === 'governed_workset_conflict',
    );
  });

  it('requires a real actor profile id before touching the database', async () => {
    const db = fakeDb();
    await assert.rejects(
      freezeAgt002GovernedDocumentWorkset(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: '', requestedMembers: [requestedMember(0)] }),
    );
    assert.equal(db.calls.rpc.length, 0);
  });

  it('fails closed before ANY database RPC/lookup when no buildFrozenEngineInputSource callback is supplied', async () => {
    const db = happyDb();
    await assert.rejects(
      freezeAgt002GovernedDocumentWorkset(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: [requestedMember(0)] }),
    );
    assert.equal(db.calls.rpc.length, 0, 'must never resolve candidates or freeze without a server-owned source factory');
    assert.equal(db.calls.from.length, 0, 'must never look up snapshot/context without a server-owned source factory');
  });

  it('the operational batch-capacity preflight rejects an oversized package with a safe 422 and never calls the freeze RPC / provider queue', async () => {
    const perDocumentCharCount = 1_000_000; // 2 docs -> 2,000,000 chars -> ceil(2,000,000 / 20,000) = 100 > 64
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_governed_document_candidate: [
          { data: candidateFor(0, { extracted_text_char_count: perDocumentCharCount }), error: null },
          { data: candidateFor(1, { extracted_text_char_count: perDocumentCharCount }), error: null },
        ],
      },
      fromResults: {
        psi_tender_document_snapshots: { data: { id: SNAPSHOT_ID }, error: null },
        psi_agt002_context_versions: { data: { id: CONTEXT_VERSION_ID }, error: null },
      },
    });
    const requestedMembers = [requestedMember(0), requestedMember(1)];
    await assert.rejects(
      freezeAgt002GovernedDocumentWorkset(db, {
        opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers,
        buildFrozenEngineInputSource: canonicalBuildFrozenEngineInputSource(),
      }),
      (error) => {
        assert.equal(error.status, 422);
        assert.equal(error.code, AGT002_GOVERNED_WORKSET_CAPACITY_REJECTED_CODE);
        assert.equal(error.report.criterion, 'NO_APTO');
        assert.equal(error.report.predicted_batch_count, 100);
        assert.equal(error.report.max_batch_count, AGT002_GOVERNED_WORKSET_MAX_BATCHES[AGT002_GOVERNED_WORKSET_FREEZE_ROUTE]);
        assert.equal(error.report.source_char_count, 2_000_000);
        return true;
      },
    );
    assert.equal(db.calls.rpc.some((c) => c.name === 'psi_freeze_agt002_governed_document_workset'), false, 'an oversized package must never reach the freeze/enqueue RPC');
  });

  for (const badCount of [undefined, null, 'a lot', -1, 0, 1.5]) {
    it(`fails closed with a safe 503 when a candidate's server-resolved char count is missing/malformed (${JSON.stringify(badCount)}), and never calls the freeze RPC`, async () => {
      const db = fakeDb({
        rpcResults: {
          psi_resolve_agt002_governed_document_candidate: [
            { data: candidateFor(0, { extracted_text_char_count: badCount }), error: null },
            { data: candidateFor(1), error: null },
          ],
        },
        fromResults: {
          psi_tender_document_snapshots: { data: { id: SNAPSHOT_ID }, error: null },
          psi_agt002_context_versions: { data: { id: CONTEXT_VERSION_ID }, error: null },
        },
      });
      const requestedMembers = [requestedMember(0), requestedMember(1)];
      await assert.rejects(
        freezeAgt002GovernedDocumentWorkset(db, {
          opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers,
          buildFrozenEngineInputSource: canonicalBuildFrozenEngineInputSource(),
        }),
        (error) => {
          assert.equal(error.status, 503);
          assert.equal(error.code, AGT002_GOVERNED_WORKSET_CAPACITY_UNAVAILABLE_CODE);
          assert.ok(error.report && typeof error.report === 'object');
          return true;
        },
      );
      assert.equal(db.calls.rpc.some((c) => c.name === 'psi_freeze_agt002_governed_document_workset'), false, 'unavailable capacity evidence must never reach the freeze/enqueue RPC');
    });
  }
});
