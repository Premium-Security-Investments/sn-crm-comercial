// AGT-002 P0-05 (RED, no production change) — initial-analysis engine, pure unit half.
//
// Pins the not-yet-created `agt002-analysis-engine.js` module: a pure, dependency-injected
// per-batch analysis engine for the initial-analysis slice (docs/agt002/initial-analysis/
// CURRENT.md). It never touches a database and never imports any agt002-reanalysis-*.js module
// — the initial-analysis slice must not couple to the reanalysis operational surface.
//
// The module does not exist yet — that absence is the RED signal: importing it below fails with
// ERR_MODULE_NOT_FOUND, which aborts this whole file before any test() body runs. That is the
// expected, intentional RED failure mode for this file (never a syntax error). Every assertion
// below is otherwise an ordinary node:test assertion, written to define the exact contract P0-05's
// implementation step must satisfy.
//
// Only injected fakes are used below — no network, no PGlite, no real database, and no production
// module is imported here.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  AGT002_ANALYSIS_ENGINE_MAX_BATCH_SIZE,
  AGT002_ANALYSIS_ENGINE_ERROR_CODES,
  assertAgt002RehydratedMembersMatchHashes,
  validateAgt002AnalysisBatch,
  runAgt002AnalysisBatch,
} from '../agt002-analysis-engine.js';

test('rehydrated text members may bind directly to the frozen extraction_text_hash', () => {
  const text = 'contenido extraído gobernado';
  const contentHash = createHash('sha256').update(text).digest('hex');
  assert.doesNotThrow(() => assertAgt002RehydratedMembersMatchHashes([
    { memberId: 'doc-1', content: text, contentHash, hashKind: 'utf8_text' },
  ]));
});

test('a model response that crosses the USD budget fails closed before it can be checkpointed', async () => {
  await assert.rejects(
    () => runAgt002AnalysisBatch({
      members: [], expectedMemberIds: [], modelId: 'model-a',
      budget: { maxTotalTokens: 100, maxCostUsd: 0.01 }, usedTotalTokens: 0, usedCostUsd: 0,
      callModel: async () => ({ output: {}, usage: { totalTokens: 1, costUsd: 0.02 } }),
    }),
    error => error?.code === 'AGT002_ENGINE_BUDGET_EXCEEDED',
  );
});

test('missing/non-finite cost accounting fails closed when a USD budget exists', async () => {
  await assert.rejects(
    () => runAgt002AnalysisBatch({
      members: [], expectedMemberIds: [], modelId: 'model-a',
      budget: { maxTotalTokens: 100, maxCostUsd: 1 }, usedTotalTokens: 0, usedCostUsd: 0,
      callModel: async () => ({ output: {}, usage: { totalTokens: 1 } }),
    }),
    error => error?.code === 'AGT002_ENGINE_BUDGET_EXCEEDED',
  );
});

function stableForHash(value) {
  if (Array.isArray(value)) return value.map(stableForHash);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableForHash(value[key])]));
  }
  return value;
}
function canonicalSha256(value) {
  return createHash('sha256').update(JSON.stringify(stableForHash(value))).digest('hex');
}

function member(memberId, content = { requirement: memberId }) {
  return { memberId, content, contentHash: canonicalSha256(content) };
}

function membersFor(ids) {
  return ids.map(id => member(id));
}

function neverCalledModel() {
  return async () => { throw new Error('must never be called'); };
}

test('AGT002_ANALYSIS_ENGINE_MAX_BATCH_SIZE is exactly 12', () => {
  assert.equal(AGT002_ANALYSIS_ENGINE_MAX_BATCH_SIZE, 12);
});

// ---------------------------------------------------------------------------------------------
// 1) rehydrated member hash mismatch fails closed before any model call.
// ---------------------------------------------------------------------------------------------

test('assertAgt002RehydratedMembersMatchHashes passes silently when every rehydrated member re-derives its declared hash', () => {
  assert.doesNotThrow(() => assertAgt002RehydratedMembersMatchHashes(membersFor(['m-1', 'm-2'])));
});

test('assertAgt002RehydratedMembersMatchHashes fails closed on a single tampered member, with a dedicated closed code', () => {
  const members = membersFor(['m-1', 'm-2']);
  members[1] = { ...members[1], content: { requirement: 'tampered' } };
  assert.throws(() => assertAgt002RehydratedMembersMatchHashes(members), error => {
    assert.equal(error.code, AGT002_ANALYSIS_ENGINE_ERROR_CODES.MEMBER_HASH_MISMATCH);
    return true;
  });
});

test('runAgt002AnalysisBatch fails closed on a rehydrated member hash mismatch before invoking the model', async () => {
  const members = membersFor(['m-1', 'm-2']);
  members[0] = { ...members[0], contentHash: 'f'.repeat(64) };
  const callModel = neverCalledModel();
  await assert.rejects(
    runAgt002AnalysisBatch({
      members, expectedMemberIds: ['m-1', 'm-2'], modelId: 'model-a',
      budget: { maxTotalTokens: 1000 }, usedTotalTokens: 0, callModel,
    }),
    error => {
      assert.equal(error.code, AGT002_ANALYSIS_ENGINE_ERROR_CODES.MEMBER_HASH_MISMATCH);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 2) incomplete batch or duplicate member id in a batch fails closed.
// ---------------------------------------------------------------------------------------------

test('validateAgt002AnalysisBatch rejects a batch missing an expected member id', () => {
  assert.throws(
    () => validateAgt002AnalysisBatch({ members: membersFor(['m-1']), expectedMemberIds: ['m-1', 'm-2'] }),
    error => {
      assert.equal(error.code, AGT002_ANALYSIS_ENGINE_ERROR_CODES.BATCH_INCOMPLETE);
      return true;
    },
  );
});

test('validateAgt002AnalysisBatch rejects a batch carrying a duplicate member id', () => {
  const members = membersFor(['m-1', 'm-2']);
  members.push(member('m-1'));
  assert.throws(
    () => validateAgt002AnalysisBatch({ members, expectedMemberIds: ['m-1', 'm-2'] }),
    error => {
      assert.equal(error.code, AGT002_ANALYSIS_ENGINE_ERROR_CODES.BATCH_DUPLICATE_MEMBER);
      return true;
    },
  );
});

test('runAgt002AnalysisBatch fails closed on an incomplete batch before invoking the model', async () => {
  const callModel = neverCalledModel();
  await assert.rejects(
    runAgt002AnalysisBatch({
      members: membersFor(['m-1']), expectedMemberIds: ['m-1', 'm-2'], modelId: 'model-a',
      budget: { maxTotalTokens: 1000 }, usedTotalTokens: 0, callModel,
    }),
    error => {
      assert.equal(error.code, AGT002_ANALYSIS_ENGINE_ERROR_CODES.BATCH_INCOMPLETE);
      return true;
    },
  );
});

test('runAgt002AnalysisBatch fails closed on a duplicate member id before invoking the model', async () => {
  const members = membersFor(['m-1', 'm-2']);
  members.push(member('m-2'));
  const callModel = neverCalledModel();
  await assert.rejects(
    runAgt002AnalysisBatch({
      members, expectedMemberIds: ['m-1', 'm-2'], modelId: 'model-a',
      budget: { maxTotalTokens: 1000 }, usedTotalTokens: 0, callModel,
    }),
    error => {
      assert.equal(error.code, AGT002_ANALYSIS_ENGINE_ERROR_CODES.BATCH_DUPLICATE_MEMBER);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 8) batch size >12 is rejected (cap is 12).
// ---------------------------------------------------------------------------------------------

test('validateAgt002AnalysisBatch accepts exactly 12 members and rejects 13', () => {
  const twelveIds = Array.from({ length: 12 }, (_, i) => `m-${i}`);
  assert.doesNotThrow(() => validateAgt002AnalysisBatch({ members: membersFor(twelveIds), expectedMemberIds: twelveIds }));

  const thirteenIds = Array.from({ length: 13 }, (_, i) => `m-${i}`);
  assert.throws(
    () => validateAgt002AnalysisBatch({ members: membersFor(thirteenIds), expectedMemberIds: thirteenIds }),
    error => {
      assert.equal(error.code, AGT002_ANALYSIS_ENGINE_ERROR_CODES.BATCH_TOO_LARGE);
      return true;
    },
  );
});

test('runAgt002AnalysisBatch rejects a 13-member batch before invoking the model', async () => {
  const ids = Array.from({ length: 13 }, (_, i) => `m-${i}`);
  const callModel = neverCalledModel();
  await assert.rejects(
    runAgt002AnalysisBatch({
      members: membersFor(ids), expectedMemberIds: ids, modelId: 'model-a',
      budget: { maxTotalTokens: 100000 }, usedTotalTokens: 0, callModel,
    }),
    error => {
      assert.equal(error.code, AGT002_ANALYSIS_ENGINE_ERROR_CODES.BATCH_TOO_LARGE);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 6) tokens/cost exceeding the G1/job budget fails closed with a closed error code, no raw
//    provider payload ever surfaces in the thrown error.
// ---------------------------------------------------------------------------------------------

test('runAgt002AnalysisBatch fails closed when the model response would exceed the remaining job budget, without leaking the raw provider payload', async () => {
  const members = membersFor(['m-1']);
  const callModel = async () => ({
    output: { requirement_id: 'm-1', finding: 'ok' },
    usage: { totalTokens: 900 },
    raw_response: { secret: 'raw provider payload should never surface' },
  });
  await assert.rejects(
    runAgt002AnalysisBatch({
      members, expectedMemberIds: ['m-1'], modelId: 'model-a',
      budget: { maxTotalTokens: 1000 }, usedTotalTokens: 500, callModel,
    }),
    error => {
      assert.equal(error.code, AGT002_ANALYSIS_ENGINE_ERROR_CODES.BUDGET_EXCEEDED);
      assert.doesNotMatch(String(error.message), /raw provider payload/);
      assert.doesNotMatch(JSON.stringify(error), /raw provider payload/);
      return true;
    },
  );
});

test('runAgt002AnalysisBatch succeeds when the model response stays within the remaining job budget', async () => {
  const members = membersFor(['m-1']);
  const callModel = async () => ({ output: { requirement_id: 'm-1', finding: 'ok' }, usage: { totalTokens: 100 } });
  const result = await runAgt002AnalysisBatch({
    members, expectedMemberIds: ['m-1'], modelId: 'model-a',
    budget: { maxTotalTokens: 1000 }, usedTotalTokens: 500, callModel,
  });
  assert.deepEqual(result.output, { requirement_id: 'm-1', finding: 'ok' });
  assert.equal(result.usage.totalTokens, 100);
});

// ---------------------------------------------------------------------------------------------
// 7) no automatic model fallback: a failed model call does not retry a different model id.
// ---------------------------------------------------------------------------------------------

test('runAgt002AnalysisBatch never falls back to a different model id after a failed call', async () => {
  const members = membersFor(['m-1']);
  const seenModelIds = [];
  const callModel = async ({ modelId }) => {
    seenModelIds.push(modelId);
    throw new Error('raw provider failure detail');
  };
  await assert.rejects(
    runAgt002AnalysisBatch({
      members, expectedMemberIds: ['m-1'], modelId: 'model-a',
      budget: { maxTotalTokens: 1000 }, usedTotalTokens: 0, callModel,
    }),
    error => {
      assert.equal(error.code, AGT002_ANALYSIS_ENGINE_ERROR_CODES.MODEL_CALL_FAILED);
      assert.doesNotMatch(String(error.message), /raw provider failure detail/);
      return true;
    },
  );
  assert.deepEqual(seenModelIds, ['model-a']);
});

// ---------------------------------------------------------------------------------------------
// Reanalysis decoupling (docs/agt002/initial-analysis/CURRENT.md, guard category 6): the engine
// source must never reference a reanalysis operational module.
// ---------------------------------------------------------------------------------------------

test('agt002-analysis-engine.js never imports a reanalysis operational module', () => {
  const source = readFileSync(new URL('../agt002-analysis-engine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /agt002-reanalysis-(api|jobs|worker|input|executor|error-message)\.js/);
});
