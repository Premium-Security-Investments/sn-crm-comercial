import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildTenderSnapshotInput } from '../tender-analysis-foundation.js';
import {
  runAgt002FixedSnapshotReanalysis,
  sanitizeAgt002FixedSnapshotError,
} from '../agt002-fixed-snapshot-reanalysis.js';

const ids = {
  opportunity: '54190e51-15fb-46af-b0aa-8f13461a3110',
  priorRun: 'b0f53383-3667-4897-8b77-e16b390a733e',
  snapshot: 'be9d136f-fa26-49fc-acce-23ad0a7d6a32',
  tender: 'd2a65660-c723-4363-98cc-62de2caa68be',
  actor: '60b26173-1226-476b-a958-cf2917661432',
  newRun: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  context: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

function fixture(overrides = {}) {
  const currentDocuments = [
    { id: '11111111-1111-4111-8111-111111111111', extracted_text: 'document a', current: true },
    { id: '22222222-2222-4222-8222-222222222222', extracted_text: 'document b', current: true },
  ];
  const calls = [];
  const value = {
    authorize: () => { calls.push('authorize'); return true; },
    body: {
      opportunity_id: ids.opportunity,
      prior_analysis_run_id: ids.priorRun,
      expected_snapshot_id: ids.snapshot,
      expected_document_count: 2,
    },
    analysisConfig: {
      AGT002_CANONICAL_ONLY: true,
      AGT002_DOCUMENT_RETRIEVAL: true,
      AGT002_LEGAL_CORPUS: false,
      AGT002_INTEGRAL_CONTRACT_V3: false,
    },
    autoAnalysisEnabled: true,
    loadPriorRun: async () => {
      calls.push('prior');
      return { id: ids.priorRun, opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, tender_id: ids.tender, producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: true };
    },
    loadSnapshot: async () => {
      calls.push('snapshot');
      return {
        id: ids.snapshot, opportunity_id: ids.opportunity, tender_id: ids.tender, actor_id: ids.actor,
        document_manifest: { documents: buildTenderSnapshotInput(currentDocuments, {}).documents },
      };
    },
    loadCurrentDocuments: async () => { calls.push('documents'); return currentDocuments; },
    loadActorProfile: async () => { calls.push('actor'); return { id: ids.actor, identity_type: 'human', active: true }; },
    reanalyze: async input => {
      calls.push(['reanalyze', input]);
      return { status: 'completed', reused: false, context_version_id: ids.context, analysis: { run_id: ids.newRun } };
    },
    ...overrides,
  };
  return { value, calls };
}

async function rejectsStatus(value, status) {
  await assert.rejects(() => runAgt002FixedSnapshotReanalysis(value), error => error?.status === status);
}

test('wires the same secret-protected route in both backends without the reserved internal prefix', () => {
  const route = "app.post('/api/agt002-reanalyze-fixed-snapshot', runAgt002FixedSnapshotOperator);";
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  for (const source of [server, api]) {
    assert.equal(source.includes(route), true);
    assert.equal(source.includes("/api/internal/agt002/reanalyze-fixed-snapshot"), false);
    assert.match(source, /authorize: \(\) => isTenderWorkerSchedulerAuthorized\(req\)/);
    assert.match(source, /sanitizeAgt002FixedSnapshotError\(error\)/);
  }
});

test('sanitizes unexpected dependency errors without exposing details', () => {
  const safe = sanitizeAgt002FixedSnapshotError(Object.assign(
    new Error('relation psi_secret does not exist; token=super-secret'),
    { status: 400 },
  ));
  assert.equal(safe.status, 500);
  assert.equal(safe.message, 'No fue posible completar la reanálisis fija.');
  assert.equal(safe.message.includes('psi_secret'), false);
  assert.equal(safe.message.includes('super-secret'), false);
});

test('preserves explicit gate errors as safe operator messages', async () => {
  const { value } = fixture({ authorize: () => false });
  let original;
  try { await runAgt002FixedSnapshotReanalysis(value); } catch (error) { original = error; }
  const safe = sanitizeAgt002FixedSnapshotError(original);
  assert.equal(safe.status, 403);
  assert.equal(safe.message, 'No autorizado.');
});

test('authenticates before any database-backed loader', async () => {
  const { value, calls } = fixture({ authorize: () => false });
  await rejectsStatus(value, 403);
  assert.deepEqual(calls, []);
});

test('rejects malformed input before database access', async () => {
  const { value, calls } = fixture({ body: { opportunity_id: 'not-a-uuid' } });
  await rejectsStatus(value, 400);
  assert.deepEqual(calls, ['authorize']);
});

for (const [label, patch] of [
  ['canonical-only off', { AGT002_CANONICAL_ONLY: false, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: false }],
  ['retrieval off', { AGT002_CANONICAL_ONLY: true, AGT002_DOCUMENT_RETRIEVAL: false, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: false }],
  ['legal corpus on without integral contract v3', { AGT002_CANONICAL_ONLY: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: true, AGT002_INTEGRAL_CONTRACT_V3: false }],
  ['integral contract v3 on without legal corpus', { AGT002_CANONICAL_ONLY: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: true }],
  ['non-boolean legal corpus and integral contract v3 values', { AGT002_CANONICAL_ONLY: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: 'true', AGT002_INTEGRAL_CONTRACT_V3: 'true' }],
]) {
  test(`fails closed when ${label}`, async () => {
    const { value, calls } = fixture({ analysisConfig: patch });
    await rejectsStatus(value, 409);
    assert.deepEqual(calls, ['authorize']);
  });
}

test('accepts the E5/V3 canonical profile with legal corpus and integral contract v3 both active', async () => {
  const { value } = fixture({
    analysisConfig: {
      AGT002_CANONICAL_ONLY: true,
      AGT002_DOCUMENT_RETRIEVAL: true,
      AGT002_LEGAL_CORPUS: true,
      AGT002_INTEGRAL_CONTRACT_V3: true,
    },
  });
  const result = await runAgt002FixedSnapshotReanalysis(value);
  assert.equal(result.status, 'completed');
});

test('fails closed when automatic analysis is off', async () => {
  const { value, calls } = fixture({ autoAnalysisEnabled: false });
  await rejectsStatus(value, 409);
  assert.deepEqual(calls, ['authorize']);
});

test('rejects a prior run belonging to another opportunity', async () => {
  const { value } = fixture({ loadPriorRun: async () => ({ id: ids.priorRun, opportunity_id: ids.actor, snapshot_id: ids.snapshot, tender_id: ids.tender, producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: true }) });
  await rejectsStatus(value, 409);
});

test('rejects a prior run bound to another snapshot', async () => {
  const { value } = fixture({ loadPriorRun: async () => ({ id: ids.priorRun, opportunity_id: ids.opportunity, snapshot_id: ids.actor, tender_id: ids.tender, producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: true }) });
  await rejectsStatus(value, 409);
});

test('rejects current document count mismatch', async () => {
  const { value } = fixture({ loadCurrentDocuments: async () => [] });
  await rejectsStatus(value, 409);
});

test('rejects snapshot manifest mismatch even when counts match', async () => {
  const { value } = fixture({ loadCurrentDocuments: async () => [
    { id: '11111111-1111-4111-8111-111111111111', extracted_text: 'changed', current: true },
    { id: '22222222-2222-4222-8222-222222222222', extracted_text: 'document b', current: true },
  ] });
  await rejectsStatus(value, 409);
});

test('accepts CRLF current text when the canonical snapshot normalized it to LF', async () => {
  const currentDocuments = [
    { id: '11111111-1111-4111-8111-111111111111', extracted_text: 'a\r\nb', current: true },
    { id: '22222222-2222-4222-8222-222222222222', extracted_text: 'document b', current: true },
  ];
  const manifest = buildTenderSnapshotInput(currentDocuments, {}).documents;
  const { value } = fixture({
    loadSnapshot: async () => ({
      id: ids.snapshot, opportunity_id: ids.opportunity, tender_id: ids.tender, actor_id: ids.actor,
      document_manifest: { documents: manifest },
    }),
    loadCurrentDocuments: async () => currentDocuments,
  });
  const result = await runAgt002FixedSnapshotReanalysis(value);
  assert.equal(result.status, 'completed');
});

test('rejects an agent actor derived from the snapshot', async () => {
  const { value } = fixture({ loadActorProfile: async () => ({ id: ids.actor, identity_type: 'agent', active: true }) });
  await rejectsStatus(value, 409);
});

test('rejects any non-human actor derived from the snapshot', async () => {
  const { value } = fixture({ loadActorProfile: async () => ({ id: ids.actor, identity_type: 'service', active: true }) });
  await rejectsStatus(value, 409);
});

test('rejects an empty historical identity type instead of treating it as human', async () => {
  const { value } = fixture({ loadActorProfile: async () => ({ id: ids.actor, identity_type: '', active: true }) });
  await rejectsStatus(value, 409);
});

test('accepts the inherited null identity type as human', async () => {
  const { value } = fixture({ loadActorProfile: async () => ({ id: ids.actor, identity_type: null, active: true }) });
  const result = await runAgt002FixedSnapshotReanalysis(value);
  assert.equal(result.status, 'completed');
});

test('delegates one fixed-snapshot reanalysis and returns only safe identifiers', async () => {
  let goNoGoCalls = 0;
  const { value, calls } = fixture({ goNoGo: () => { goNoGoCalls += 1; } });
  const result = await runAgt002FixedSnapshotReanalysis(value);
  assert.deepEqual(result, {
    status: 'completed', reused: false, context_version_id: ids.context, analysis_run_id: ids.newRun,
  });
  const delegation = calls.find(call => Array.isArray(call) && call[0] === 'reanalyze')[1];
  assert.equal(delegation.opportunityId, ids.opportunity);
  assert.equal(delegation.analysisRunId, ids.priorRun);
  assert.equal(delegation.currentProfile.id, ids.actor);
  assert.equal(goNoGoCalls, 0);
});
