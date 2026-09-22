import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createAgt002ReanalysisExecutor } from '../agt002-reanalysis-executor.js';
import {
  computeAgt002GovernedWorksetIdempotencyKey,
  computeAgt002WorksetSelectionHash,
} from '../agt002-governed-document-worksets.js';
import { buildAgt002TenderRequirementInventory } from '../agt002-preview-input.js';

// GREEN slice for the governed document-workset EXECUTION gap: a claimed durable_batched_v1 job's
// frozen_engine_input.analysis_context.documents (and its governed_workset_members) carry only
// governed, immutable IDENTITY metadata — document_version_id, source_classification,
// inclusion_reason (the exact 3-field projection agt002-reanalysis-executor.js's
// validFrozenInput already enforces byte-for-byte, see tests/agt002-reanalysis-executor.test.mjs)
// plus content_hash/extraction identity on governed_workset_members and a
// document_workset_identity (the workset identity) at the top level. None of that frozen shape
// carries extracted TEXT — current validation forbids a 4th key on analysis_context.documents —
// so the engine has no governed document content to analyze without rehydration. This test
// proves the executor accepts an injected `governedDocumentResolver` seam, calls it once per
// frozen governed document with its exact frozen identity, and rehydrates the resolver's
// transient extracted text (plus its engine-bound metadata) into the analysis input reaching the
// existing runPostBridgeAnalysis / runtime.analyze path — before that call is made.
//
// This file also enforces that contract with a closed, fail-safe boundary: the executor must
// never trust the resolver's rehydrated content verbatim. A resolver whose reported identity
// (document_version_id/content_hash/extraction_id/extraction_text_hash) diverges from the frozen
// governed_workset_members evidence it was called with, whose opportunity_id/tender_id diverges
// from the frozen document_workset_identity scope it was called with, whose name/document_type/
// version/current metadata is malformed, or whose text's own SHA-256 does not equal the
// extraction_text_hash it reports, must fail the WHOLE execution closed — status unavailable /
// analysis_run_id null / error_code invalid_output / reused false — strictly BEFORE
// runPostBridgeAnalysis (and therefore runtime.analyze) is ever reached, while still releasing
// the already-acquired preview claim exactly once. The resolver's validated output is then
// projected into EXACTLY the 10 keys agt002-document-chunks.js accepts — document_id,
// document_version_id, opportunity_id, snapshot_id, document_type, name, version, content_hash,
// current, extracted_text — never source_classification/inclusion_reason, which remain governed
// evidence in the frozen members/workset only.

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const OPPORTUNITY_ID = '11111111-1111-1111-1111-111111111111';
const TENDER_ID = '22222222-2222-2222-2222-222222222222';
const SNAPSHOT_ID = '33333333-3333-3333-3333-333333333333';
const CONTEXT_VERSION_ID = '44444444-4444-4444-4444-444444444444';
const DOCUMENT_VERSION_ID = '55555555-5555-5555-5555-555555555555';
const RESOLVED_DOCUMENT_ID = 'document-55555555';
const RESOLVED_DOCUMENT_NAME = 'Pliego de condiciones';
const RESOLVED_DOCUMENT_TYPE = 'pliego';
const RESOLVED_DOCUMENT_VERSION = 3;

const EXTRACTED_TEXT = 'EXTRACTED PLIEGO TEXT FOR DOCUMENT 55555555-...';
const EXTRACTED_TEXT_HASH = sha256Hex(EXTRACTED_TEXT);

const WRONG_DOCUMENT_VERSION_ID = '66666666-6666-6666-6666-666666666666';
const WRONG_CONTENT_HASH = 'c'.repeat(64);
const WRONG_EXTRACTION_ID = 'cccccccc-1111-1111-1111-111111111111';
const WRONG_EXTRACTION_TEXT_HASH = 'd'.repeat(64);
const TAMPERED_TEXT = 'TAMPERED TEXT THAT DOES NOT MATCH THE FROZEN EXTRACTION HASH';
const WRONG_OPPORTUNITY_ID = '77777777-7777-7777-7777-777777777777';
const WRONG_TENDER_ID = '88888888-8888-8888-8888-888888888888';

const GOVERNED_MEMBER = Object.freeze({
  document_version_id: DOCUMENT_VERSION_ID,
  source_classification: 'official',
  inclusion_reason: 'required by pliego',
  content_hash: 'a'.repeat(64),
  extraction_id: 'aaaaaaaa-1111-1111-1111-111111111111',
  extraction_text_hash: EXTRACTED_TEXT_HASH,
});

const SELECTION_HASH = computeAgt002WorksetSelectionHash({
  opportunityId: OPPORTUNITY_ID,
  tenderId: TENDER_ID,
  members: [GOVERNED_MEMBER],
});

const IDEMPOTENCY_KEY = computeAgt002GovernedWorksetIdempotencyKey({
  opportunityId: OPPORTUNITY_ID,
  tenderId: TENDER_ID,
  snapshotId: SNAPSHOT_ID,
  contextVersionId: CONTEXT_VERSION_ID,
  selectionHash: SELECTION_HASH,
});

// The exact 3-field public projection validFrozenInput requires analysis_context.documents to
// carry — never a superset (no content_hash, no text) — per the shared projection check in
// agt002-reanalysis-executor.js.
const GOVERNED_DOCUMENT_PROJECTION = Object.freeze({
  document_version_id: DOCUMENT_VERSION_ID,
  source_classification: 'official',
  inclusion_reason: 'required by pliego',
});

const GOVERNED_JOB = Object.freeze({
  jobId: 'job-governed-1',
  leaseId: 'lease-governed-1',
  opportunityId: OPPORTUNITY_ID,
  tenderId: TENDER_ID,
  snapshotId: SNAPSHOT_ID,
  contextVersionId: CONTEXT_VERSION_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
  requestedBy: 'actor-1',
  executionMode: 'durable_batched_v1',
  frozenEngineInput: Object.freeze({
    schema_version: 2,
    engine_identity: Object.freeze({
      model: 'sonnet', policy_version: 'policy-1', timeout_ms: 165000, daily_max_runs: 20, max_concurrent: 2,
      idempotency_key: IDEMPOTENCY_KEY,
    }),
    analysis_flags: Object.freeze({
      AGT002_CANONICAL_ONLY: true, AGT002_CONTEXT_V2: true, AGT002_DOCUMENT_RETRIEVAL: true,
      AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: false,
    }),
    analysis_context: Object.freeze({
      opportunity: Object.freeze({ id: OPPORTUNITY_ID }),
      documents: Object.freeze([GOVERNED_DOCUMENT_PROJECTION]),
      snapshotId: SNAPSHOT_ID,
      canonicalOnly: true,
    }),
    legal_corpus_context: null,
    integral_v3_governance: null,
    manizales_manifest_source: null,
    document_workset_identity: Object.freeze({
      opportunity_id: OPPORTUNITY_ID,
      tender_id: TENDER_ID,
      snapshot_id: SNAPSHOT_ID,
      context_version_id: CONTEXT_VERSION_ID,
      selection_hash: SELECTION_HASH,
    }),
    governed_workset_members: Object.freeze([GOVERNED_MEMBER]),
  }),
});

// The real resolver's full success output shape — document_id (mapped source_document_id),
// document_version_id, opportunity_id, tender_id, version, name, content_hash, document_type,
// current, extraction_id, extraction_text_hash, text. The executor is expected to cross-check
// every byte-for-byte-comparable field against the frozen governed_workset_members evidence and
// the frozen document_workset_identity scope (plus re-derive extraction_text_hash from `text`
// itself), and to require document_id/name/document_type/text as nonblank strings, version as a
// positive integer and current as a boolean, before trusting any of it.
function validResolvedDocument() {
  return {
    document_id: RESOLVED_DOCUMENT_ID,
    document_version_id: DOCUMENT_VERSION_ID,
    opportunity_id: OPPORTUNITY_ID,
    tender_id: TENDER_ID,
    version: RESOLVED_DOCUMENT_VERSION,
    name: RESOLVED_DOCUMENT_NAME,
    content_hash: GOVERNED_MEMBER.content_hash,
    document_type: RESOLVED_DOCUMENT_TYPE,
    current: true,
    extraction_id: GOVERNED_MEMBER.extraction_id,
    extraction_text_hash: GOVERNED_MEMBER.extraction_text_hash,
    text: EXTRACTED_TEXT,
  };
}

function harness({ governedDocumentResolver } = {}) {
  const calls = { claim: [], release: [], runtime: [], post: [], resolver: [] };
  const callOrder = [];
  const executor = createAgt002ReanalysisExecutor({
    environment: {},
    claimPreviewRun: async (...args) => { calls.claim.push(args); return { status: 'claimed', claim_id: 'preview-lease-1' }; },
    findPreviewRun: async () => ({ run_id: 'existing-run-1' }),
    releasePreviewClaim: async (...args) => { calls.release.push(args); },
    countDailyRuns: async () => 0,
    createRuntime: options => { calls.runtime.push(options); return { analyze() {}, manifestScope: { scope: 'fixed' } }; },
    runPostBridgeAnalysis: async (...args) => { callOrder.push('post'); calls.post.push(args); return { status: 'completed', analysis_run_id: 'run-1', error_code: null }; },
    createCorrelationId: () => 'correlation-1',
    observability: { record() {} },
    // Minimal durable-path stubs — no real DB/network/provider — just enough to reach analysis.
    computeFrozenInputHash: () => 'f'.repeat(64),
    deriveWorksetIdentity: () => ({ opportunityId: OPPORTUNITY_ID, idempotencyKey: IDEMPOTENCY_KEY }),
    getOrCreateWorkset: async () => ({ status: 'created', worksetId: 'workset-1', published: false }),
    createCheckpointAdapter: () => ({
      loadCheckpoint: async () => ({ hit: false }),
      storeCheckpoint: async () => ({ status: 'created', checkpointId: 'cp-1' }),
    }),
    ...(governedDocumentResolver ? {
      governedDocumentResolver: async (...args) => {
        callOrder.push('resolver');
        calls.resolver.push(args);
        return governedDocumentResolver(...args);
      },
    } : {}),
  });
  return { executor, calls, callOrder };
}

test('rehydrates a governed frozen document with extracted text via an injected governedDocumentResolver before the analysis input reaches the existing runtime.analyze path', async () => {
  // The frozen job's own governed metadata is immutable identity only — no extracted text, no
  // 4th field — this is already enforced by validFrozenInput today and is not the RED gap.
  const frozenDocuments = GOVERNED_JOB.frozenEngineInput.analysis_context.documents;
  assert.equal(frozenDocuments.length, 1);
  assert.deepEqual(
    Object.keys(frozenDocuments[0]).sort(),
    ['document_version_id', 'inclusion_reason', 'source_classification'],
    'frozen analysis_context.documents must carry governed immutable metadata only, never extracted text',
  );
  assert.ok(GOVERNED_JOB.frozenEngineInput.document_workset_identity, 'a governed job carries a document_workset_identity as its workset identity');
  assert.equal(EXTRACTED_TEXT_HASH, GOVERNED_MEMBER.extraction_text_hash, 'fixture sanity: the frozen member\'s extraction_text_hash must be the real SHA-256 of the extracted text it governs');

  const resolverImpl = async (args) => {
    const { opportunityId, tenderId, snapshotId, contextVersionId, documentVersionId, member } = args;
    assert.deepEqual(
      Object.keys(args).sort(),
      ['contextVersionId', 'documentVersionId', 'member', 'opportunityId', 'snapshotId', 'tenderId'],
      'the resolver must be invoked with exactly the frozen workset scope plus the frozen member evidence — no more, no less',
    );
    assert.equal(opportunityId, OPPORTUNITY_ID);
    assert.equal(tenderId, TENDER_ID);
    assert.equal(snapshotId, SNAPSHOT_ID);
    assert.equal(contextVersionId, CONTEXT_VERSION_ID);
    assert.equal(documentVersionId, DOCUMENT_VERSION_ID);
    assert.equal(member, GOVERNED_MEMBER, 'the resolver must receive the exact frozen governed_workset_members entry, not a copy');
    return validResolvedDocument();
  };

  const { executor, calls, callOrder } = harness({ governedDocumentResolver: resolverImpl });
  const outcome = await executor({ kind: 'db' }, GOVERNED_JOB);

  // Baseline sanity: the claimed durable_batched_v1 job reaches the existing path exactly once —
  // proves any RED failure below is about the missing resolver seam, not a malformed fixture.
  assert.equal(calls.claim.length, 1);
  assert.equal(calls.runtime.length, 1);
  assert.equal(calls.post.length, 1);
  assert.equal(outcome.status, 'completed');
  assert.equal(calls.release.length, 0, 'a successful run must not release the claim through this fail-closed path');

  assert.equal(
    calls.resolver.length,
    1,
    'the injected governedDocumentResolver must be called exactly once, for the one frozen governed document/version',
  );
  assert.deepEqual(
    callOrder,
    ['resolver', 'post'],
    'the resolver must run before the orchestrator that invokes runtime.analyze',
  );

  const [, , deps] = calls.post[0];
  const analysisDocuments = deps.analysisContext?.documents;
  assert.ok(Array.isArray(analysisDocuments) && analysisDocuments.length === 1);
  assert.equal(
    analysisDocuments[0].extracted_text,
    EXTRACTED_TEXT,
    'the resolver\'s transient extracted text must be present in the analysis context used by the existing runtime.analyze path before it is invoked',
  );

  // The frozen job itself must never be mutated by rehydration: same array/object references,
  // same governed 3-field projection, after execution as before it.
  assert.equal(
    GOVERNED_JOB.frozenEngineInput.analysis_context.documents,
    frozenDocuments,
    'the executor must never replace the frozen input\'s own documents array reference',
  );
  assert.deepEqual(
    Object.keys(frozenDocuments[0]).sort(),
    ['document_version_id', 'inclusion_reason', 'source_classification'],
    'the frozen input\'s own document projection must still carry exactly 3 governed identity fields after execution — no text written back onto it',
  );
  assert.equal(
    GOVERNED_JOB.frozenEngineInput.governed_workset_members[0],
    GOVERNED_MEMBER,
    'the frozen governed_workset_members entry must remain the exact frozen object reference after execution',
  );
});

// Table-driven GREEN coverage: an executor that rehydrates governed document content must never
// trust the resolver's reported identity/text verbatim. Any divergence from the frozen
// governed_workset_members evidence — or a text whose own SHA-256 does not equal the
// extraction_text_hash the resolver reports — must fail the whole execution closed, strictly
// before runPostBridgeAnalysis (and therefore runtime.analyze) is ever reached.
const INVALID_RESOLVER_OUTPUT_CASES = [
  {
    name: 'blank text',
    build: () => ({ ...validResolvedDocument(), text: '' }),
  },
  {
    name: 'missing text',
    build: () => {
      const { text, ...rest } = validResolvedDocument();
      return rest;
    },
  },
  {
    name: 'mismatched document_version_id',
    build: () => ({ ...validResolvedDocument(), document_version_id: WRONG_DOCUMENT_VERSION_ID }),
  },
  {
    name: 'mismatched content_hash',
    build: () => ({ ...validResolvedDocument(), content_hash: WRONG_CONTENT_HASH }),
  },
  {
    name: 'mismatched extraction_id',
    build: () => ({ ...validResolvedDocument(), extraction_id: WRONG_EXTRACTION_ID }),
  },
  {
    name: 'mismatched extraction_text_hash',
    build: () => ({ ...validResolvedDocument(), extraction_text_hash: WRONG_EXTRACTION_TEXT_HASH }),
  },
  {
    name: 'text whose SHA-256 does not equal the reported extraction_text_hash (tampered text)',
    build: () => ({ ...validResolvedDocument(), text: TAMPERED_TEXT }),
  },
];

test('fails closed before runtime creation and runPostBridgeAnalysis when a GOVERNED_JOB is executed with no governedDocumentResolver injected', async () => {
  const { executor, calls, callOrder } = harness();

  const outcome = await executor({ kind: 'db' }, GOVERNED_JOB);

  assert.deepEqual(
    outcome,
    { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false },
    'a governed job with no resolver seam available must produce the standard fail-closed unavailable/invalid_output outcome',
  );
  assert.equal(calls.resolver.length, 0, 'there is no injected resolver, so it can never be called');
  assert.equal(calls.runtime.length, 0, 'the runtime must never be created when governed document content cannot be resolved');
  assert.equal(calls.post.length, 0, 'runPostBridgeAnalysis (and therefore runtime.analyze) must never be reached with no resolver available');
  assert.ok(!callOrder.includes('post'), 'no post-bridge call may occur, in any order, on this fail-closed path');
  assert.equal(calls.release.length, 1, 'the already-acquired preview claim must be released exactly once on this fail-closed path');
  assert.equal(calls.release[0][1]?.idempotencyKey, IDEMPOTENCY_KEY, 'the release must be fenced by this job\'s own idempotency key');
  assert.equal(calls.release[0][1]?.claimId, 'preview-lease-1', 'the release must target the exact claim this execution acquired');
});

// GREEN regression: the governed document reaching runPostBridgeAnalysis must be projected into
// EXACTLY the 10 keys agt002-document-chunks.js accepts — document_id, document_version_id,
// opportunity_id, snapshot_id, document_type, name, version, content_hash, current,
// extracted_text — never source_classification/inclusion_reason (which remain governed evidence
// in the frozen members/workset only) and never the resolver's own tender_id/extraction_id/
// extraction_text_hash. This test captures the exact analysisContext.documents the executor
// hands to runPostBridgeAnalysis, asserts that closed 10-key shape, then feeds it straight into
// buildAgt002TenderRequirementInventory and requires a nonempty source_units result.
test('rehydrated governed documents reaching runPostBridgeAnalysis carry the canonical downstream shape buildAgt002TenderRequirementInventory requires', async () => {
  const resolverImpl = async () => validResolvedDocument();

  const { executor, calls } = harness({ governedDocumentResolver: resolverImpl });
  const outcome = await executor({ kind: 'db' }, GOVERNED_JOB);
  assert.equal(outcome.status, 'completed');

  const [, , deps] = calls.post[0];
  const analysisDocuments = deps.analysisContext?.documents;
  assert.ok(Array.isArray(analysisDocuments) && analysisDocuments.length === 1);

  const rehydrated = analysisDocuments[0];
  assert.deepEqual(
    Object.keys(rehydrated).sort(),
    ['content_hash', 'current', 'document_id', 'document_type', 'document_version_id', 'extracted_text', 'name', 'opportunity_id', 'snapshot_id', 'version'],
    'the rehydrated document reaching runPostBridgeAnalysis must carry exactly the 10 keys agt002-document-chunks.js accepts — never source_classification/inclusion_reason and never the resolver\'s own tender_id/extraction_id/extraction_text_hash',
  );
  assert.equal(rehydrated.document_id, RESOLVED_DOCUMENT_ID);
  assert.equal(rehydrated.document_version_id, DOCUMENT_VERSION_ID);
  assert.equal(rehydrated.opportunity_id, OPPORTUNITY_ID);
  assert.equal(rehydrated.snapshot_id, SNAPSHOT_ID);
  assert.equal(rehydrated.document_type, RESOLVED_DOCUMENT_TYPE);
  assert.equal(rehydrated.name, RESOLVED_DOCUMENT_NAME);
  assert.equal(rehydrated.version, RESOLVED_DOCUMENT_VERSION);
  assert.equal(rehydrated.content_hash, GOVERNED_MEMBER.content_hash);
  assert.equal(rehydrated.current, true);
  assert.equal(rehydrated.extracted_text, EXTRACTED_TEXT);

  const inventory = buildAgt002TenderRequirementInventory({
    snapshotId: SNAPSHOT_ID,
    documents: analysisDocuments,
  });
  assert.ok(
    Array.isArray(inventory.source_units) && inventory.source_units.length > 0,
    'buildAgt002TenderRequirementInventory must produce a nonempty source_units result from the rehydrated governed documents',
  );
});

for (const { name, build } of INVALID_RESOLVER_OUTPUT_CASES) {
  test(`fails closed before runPostBridgeAnalysis when the governedDocumentResolver returns ${name}`, async () => {
    const resolved = build();
    // Fixture sanity for the tampered-text case: prove the divergence this case is meant to
    // exercise actually exists, so a RED failure here can never be blamed on a bad fixture.
    if (Object.hasOwn(resolved, 'extraction_text_hash') && typeof resolved.text === 'string') {
      const actualHash = sha256Hex(resolved.text);
      const claimsConsistentHash = actualHash === resolved.extraction_text_hash;
      const claimsFrozenIdentity = resolved.document_version_id === DOCUMENT_VERSION_ID
        && resolved.content_hash === GOVERNED_MEMBER.content_hash
        && resolved.extraction_id === GOVERNED_MEMBER.extraction_id
        && resolved.extraction_text_hash === GOVERNED_MEMBER.extraction_text_hash;
      assert.ok(
        !claimsConsistentHash || !claimsFrozenIdentity,
        'fixture sanity: this case must diverge from the frozen governed identity in at least one checked dimension',
      );
    }

    const { executor, calls, callOrder } = harness({
      governedDocumentResolver: async () => resolved,
    });

    const outcome = await executor({ kind: 'db' }, GOVERNED_JOB);

    assert.deepEqual(
      outcome,
      { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false },
      'an invalid resolver output must produce the standard fail-closed unavailable/invalid_output outcome',
    );
    assert.equal(calls.resolver.length, 1, 'the resolver is still invoked exactly once before its output is validated');
    assert.equal(calls.post.length, 0, 'runPostBridgeAnalysis (and therefore runtime.analyze) must never be reached when the resolver output fails validation');
    assert.ok(!callOrder.includes('post'), 'no post-bridge call may occur, in any order, on the fail-closed path');
    assert.equal(calls.release.length, 1, 'the already-acquired preview claim must be released exactly once on the fail-closed path');
    assert.equal(calls.release[0][1]?.idempotencyKey, IDEMPOTENCY_KEY, 'the release must be fenced by this job\'s own idempotency key');
    assert.equal(calls.release[0][1]?.claimId, 'preview-lease-1', 'the release must target the exact claim this execution acquired');

    // Fail-closed can never mutate the frozen job either.
    assert.deepEqual(
      Object.keys(GOVERNED_JOB.frozenEngineInput.analysis_context.documents[0]).sort(),
      ['document_version_id', 'inclusion_reason', 'source_classification'],
      'the frozen input\'s own document projection must remain untouched even on the fail-closed path',
    );
  });
}

// Focused GREEN coverage: document_id carries no frozen counterpart on governed_workset_members,
// so it can never be byte-for-byte cross-checked like the other five resolver fields — but it
// must still be required as a nonblank string, since it is the sole identity the downstream
// canonical projection (and buildAgt002TenderRequirementInventory) relies on to cite this
// document. Kept out of INVALID_RESOLVER_OUTPUT_CASES/its shared fixture-sanity check, which
// only reasons about the frozen-identity fields document_id has none of.
const MISSING_OR_BLANK_DOCUMENT_ID_CASES = [
  {
    name: 'missing document_id',
    build: () => {
      const { document_id, ...rest } = validResolvedDocument();
      return rest;
    },
  },
  { name: 'blank document_id', build: () => ({ ...validResolvedDocument(), document_id: '   ' }) },
  { name: 'non-string document_id', build: () => ({ ...validResolvedDocument(), document_id: 42 }) },
];

for (const { name, build } of MISSING_OR_BLANK_DOCUMENT_ID_CASES) {
  test(`fails closed before runPostBridgeAnalysis when the governedDocumentResolver returns ${name}`, async () => {
    const { executor, calls, callOrder } = harness({
      governedDocumentResolver: async () => build(),
    });

    const outcome = await executor({ kind: 'db' }, GOVERNED_JOB);

    assert.deepEqual(
      outcome,
      { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false },
      'a resolver output with a missing/blank/non-string document_id must produce the standard fail-closed unavailable/invalid_output outcome',
    );
    assert.equal(calls.resolver.length, 1, 'the resolver is still invoked exactly once before its output is validated');
    assert.equal(calls.post.length, 0, 'runPostBridgeAnalysis (and therefore runtime.analyze) must never be reached when document_id fails validation');
    assert.ok(!callOrder.includes('post'), 'no post-bridge call may occur, in any order, on the fail-closed path');
    assert.equal(calls.release.length, 1, 'the already-acquired preview claim must be released exactly once on the fail-closed path');
    assert.equal(calls.release[0][1]?.idempotencyKey, IDEMPOTENCY_KEY, 'the release must be fenced by this job\'s own idempotency key');
    assert.equal(calls.release[0][1]?.claimId, 'preview-lease-1', 'the release must target the exact claim this execution acquired');
  });
}

// Focused GREEN coverage: opportunity_id/tender_id carry no per-field frozen counterpart on
// governed_workset_members (they are validated against the frozen document_workset_identity
// scope instead), and name/document_type/version/current carry no frozen counterpart at all —
// but each must still be validated (scope fields exactly, metadata fields well-formed) before the
// resolver's rehydrated content is trusted, since all four now flow straight into the 10-key
// projection reaching the engine. Kept out of INVALID_RESOLVER_OUTPUT_CASES/its shared
// fixture-sanity check, which only reasons about frozen-identity-vs-hash divergence.
const INVALID_RESOLVER_SCOPE_AND_METADATA_CASES = [
  { name: 'mismatched opportunity_id', build: () => ({ ...validResolvedDocument(), opportunity_id: WRONG_OPPORTUNITY_ID }) },
  { name: 'mismatched tender_id', build: () => ({ ...validResolvedDocument(), tender_id: WRONG_TENDER_ID }) },
  { name: 'blank name', build: () => ({ ...validResolvedDocument(), name: '   ' }) },
  {
    name: 'missing name',
    build: () => {
      const { name, ...rest } = validResolvedDocument();
      return rest;
    },
  },
  { name: 'blank document_type', build: () => ({ ...validResolvedDocument(), document_type: '   ' }) },
  {
    name: 'missing document_type',
    build: () => {
      const { document_type, ...rest } = validResolvedDocument();
      return rest;
    },
  },
  { name: 'zero version', build: () => ({ ...validResolvedDocument(), version: 0 }) },
  { name: 'negative version', build: () => ({ ...validResolvedDocument(), version: -1 }) },
  { name: 'non-integer version', build: () => ({ ...validResolvedDocument(), version: 1.5 }) },
  {
    name: 'missing version',
    build: () => {
      const { version, ...rest } = validResolvedDocument();
      return rest;
    },
  },
  { name: 'non-boolean current', build: () => ({ ...validResolvedDocument(), current: 'true' }) },
  {
    name: 'missing current',
    build: () => {
      const { current, ...rest } = validResolvedDocument();
      return rest;
    },
  },
];

for (const { name, build } of INVALID_RESOLVER_SCOPE_AND_METADATA_CASES) {
  test(`fails closed before runPostBridgeAnalysis when the governedDocumentResolver returns ${name}`, async () => {
    const { executor, calls, callOrder } = harness({
      governedDocumentResolver: async () => build(),
    });

    const outcome = await executor({ kind: 'db' }, GOVERNED_JOB);

    assert.deepEqual(
      outcome,
      { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false },
      'a resolver output with an invalid scope or metadata field must produce the standard fail-closed unavailable/invalid_output outcome',
    );
    assert.equal(calls.resolver.length, 1, 'the resolver is still invoked exactly once before its output is validated');
    assert.equal(calls.post.length, 0, 'runPostBridgeAnalysis (and therefore runtime.analyze) must never be reached when the resolver output fails validation');
    assert.ok(!callOrder.includes('post'), 'no post-bridge call may occur, in any order, on the fail-closed path');
    assert.equal(calls.release.length, 1, 'the already-acquired preview claim must be released exactly once on the fail-closed path');
    assert.equal(calls.release[0][1]?.idempotencyKey, IDEMPOTENCY_KEY, 'the release must be fenced by this job\'s own idempotency key');
    assert.equal(calls.release[0][1]?.claimId, 'preview-lease-1', 'the release must target the exact claim this execution acquired');
  });
}
