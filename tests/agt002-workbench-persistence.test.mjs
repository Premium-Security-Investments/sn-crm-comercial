import assert from 'node:assert/strict';
import {
  appendAgt002AgentArtifactVersion,
  appendAgt002AgentResult,
  appendAgt002HumanMessage,
  appendAgt002WorkbenchJobEvent,
  claimAgt002WorkbenchJob,
  computeAgt002WorkbenchIdempotencyKey,
  getAgt002Workbench,
  reviewAgt002LearningProposal,
} from '../agt002-workbench-persistence.js';
import {
  AGT002_WORKBENCH_CAPABILITIES,
  AGT002_WORKBENCH_CONTRACT_VERSION,
  AGT002_WORKBENCH_POLICY_VERSION,
} from '../agt002-workbench-contract.js';

const ids = Object.freeze({
  actor: '10000000-0000-4000-8000-000000000001',
  agent: '10000000-0000-4000-8000-000000000002',
  opportunity: '10000000-0000-4000-8000-000000000003',
  thread: '10000000-0000-4000-8000-000000000004',
  message: '10000000-0000-4000-8000-000000000005',
  job: '10000000-0000-4000-8000-000000000006',
  claim: '10000000-0000-4000-8000-000000000007',
  tender: '10000000-0000-4000-8000-000000000008',
  snapshot: '10000000-0000-4000-8000-000000000009',
  artifact: '10000000-0000-4000-8000-000000000010',
  version: '10000000-0000-4000-8000-000000000011',
  proposal: '10000000-0000-4000-8000-000000000012',
});

const keyInputA = {
  threadId: ids.thread,
  originMessageId: ids.message,
  snapshotId: ids.snapshot,
  capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply,
  contractVersion: AGT002_WORKBENCH_CONTRACT_VERSION,
  policyVersion: AGT002_WORKBENCH_POLICY_VERSION,
  baseVersionId: null,
};
const keyInputB = {
  policyVersion: AGT002_WORKBENCH_POLICY_VERSION,
  baseVersionId: null,
  capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply,
  originMessageId: ids.message,
  contractVersion: AGT002_WORKBENCH_CONTRACT_VERSION,
  snapshotId: ids.snapshot,
  threadId: ids.thread,
};
const hashA = computeAgt002WorkbenchIdempotencyKey(keyInputA);
assert.match(hashA, /^[a-f0-9]{64}$/);
assert.equal(hashA, computeAgt002WorkbenchIdempotencyKey(keyInputB));
assert.notEqual(hashA, computeAgt002WorkbenchIdempotencyKey({ ...keyInputA, policyVersion: 'other' }));
assert.throws(() => computeAgt002WorkbenchIdempotencyKey({ ...keyInputA, extra: true }), /cerrad|claves/i);

const calls = [];
const responses = new Map();
const database = {
  async rpc(name, args) {
    calls.push({ name, args });
    const value = responses.get(name);
    return value instanceof Error ? { data: null, error: value } : { data: value, error: null };
  },
};

responses.set('psi_get_agt002_workbench', { thread_id: ids.thread, messages: [] });
assert.equal((await getAgt002Workbench(database, { opportunityId: ids.opportunity, actorId: ids.actor })).thread_id, ids.thread);
assert.deepEqual(calls.at(-1), {
  name: 'psi_get_agt002_workbench',
  args: { p_opportunity_id: ids.opportunity, p_actor_id: ids.actor },
});

responses.set('psi_append_agt002_workbench_message', { status: 'queued', job_id: ids.job });
const queued = await appendAgt002HumanMessage(database, {
  opportunityId: ids.opportunity,
  actorId: ids.actor,
  threadId: ids.thread,
  content: 'Liste faltantes.',
  contextLinks: [],
  idempotencyKey: hashA,
  contractVersion: AGT002_WORKBENCH_CONTRACT_VERSION,
  policyVersion: AGT002_WORKBENCH_POLICY_VERSION,
  capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply,
  snapshotId: ids.snapshot,
  baseVersionId: null,
});
assert.equal(queued.status, 'queued');
assert.equal(calls.at(-1).args.p_actor_id, ids.actor);
assert.equal(Object.hasOwn(calls.at(-1).args, 'actor_id'), false);

for (const status of ['claimed', 'empty', 'quota', 'saturated']) {
  responses.set('psi_claim_agt002_workbench_job', { status, claim_id: status === 'claimed' ? ids.claim : undefined });
  assert.equal((await claimAgt002WorkbenchJob(database, {
    workerId: 'worker-test', dailyMaxJobs: 20, maxConcurrent: 2, leaseSeconds: 300,
  })).status, status);
}

responses.set('psi_append_agt002_workbench_job_event', { status: 'failed' });
assert.equal((await appendAgt002WorkbenchJobEvent(database, {
  jobId: ids.job, claimId: ids.claim, eventType: 'failed', metadata: { code: 'TEST' },
})).status, 'failed');

const input = {
  job_id: ids.job,
  thread_id: ids.thread,
  origin_message_id: ids.message,
  opportunity_id: ids.opportunity,
  tender_id: ids.tender,
  snapshot_id: ids.snapshot,
  base_version_id: null,
  capability_id: AGT002_WORKBENCH_CAPABILITIES.reply,
  contract_version: AGT002_WORKBENCH_CONTRACT_VERSION,
  policy_version: AGT002_WORKBENCH_POLICY_VERSION,
  context_links: [],
  message: 'Liste faltantes.',
};
const result = {
  kind: 'reply', visible_agent_name: 'Vig-IA', human_review_required: true,
  snapshot_id: ids.snapshot, base_version_id: null,
  content_text: 'Falta un certificado.', source_links: [],
  missing_information: ['Certificado'], required_actions: ['La encargada debe revisarlo.'],
};
responses.set('psi_append_agt002_agent_result', { status: 'completed', message_id: ids.message });
assert.equal((await appendAgt002AgentResult(database, {
  jobId: ids.job, claimId: ids.claim, agentId: ids.agent, input, result,
})).status, 'completed');
assert.throws(
  () => appendAgt002AgentResult(database, { jobId: ids.job, claimId: ids.claim, agentId: ids.agent, input, result: { ...result, send_now: true } }),
  /cerrad|inesperad/i,
);

responses.set('psi_append_agt002_agent_artifact_version', { status: 'stale', current_version_id: ids.version });
assert.equal((await appendAgt002AgentArtifactVersion(database, {
  jobId: ids.job,
  claimId: ids.claim,
  agentId: ids.agent,
  artifactId: ids.artifact,
  baseVersionId: null,
  contentKind: 'markdown',
  contentText: '# Draft',
  contentMetadata: null,
})).status, 'stale');
assert.throws(() => appendAgt002AgentArtifactVersion(database, {
  jobId: ids.job, claimId: ids.claim, agentId: ids.agent, artifactId: ids.artifact,
  contentKind: 'markdown', contentText: '# Draft', contentMetadata: null,
}), /baseVersionId/);

responses.set('psi_review_agt002_learning_proposal', { decision: 'approved', approved_scope: 'entity' });
assert.equal((await reviewAgt002LearningProposal(database, {
  opportunityId: ids.opportunity,
  actorId: ids.actor,
  proposalId: ids.proposal,
  decision: 'approved',
  scope: 'entity',
  comment: 'Aprobado por encargada.',
})).decision, 'approved');

responses.set('psi_get_agt002_workbench', Object.assign(new Error('boom'), { code: 'P0002' }));
await assert.rejects(
  () => getAgt002Workbench(database, { opportunityId: ids.opportunity, actorId: ids.actor }),
  error => error.code === 'P0002' && error.message === 'boom',
);

console.log('AGT-002 workbench persistence passed');
