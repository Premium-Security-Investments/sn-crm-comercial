import assert from 'node:assert/strict';
import {
  AGT002_WORKBENCH_CAPABILITIES,
  AGT002_WORKBENCH_CONTRACT_VERSION,
  AGT002_WORKBENCH_POLICY_VERSION,
  validateAgt002WorkbenchJobInput,
  validateAgt002WorkbenchResult,
} from '../agt002-workbench-contract.js';

const UUID = Object.freeze({
  job: '10000000-0000-4000-8000-000000000001',
  thread: '10000000-0000-4000-8000-000000000002',
  message: '10000000-0000-4000-8000-000000000003',
  opportunity: '10000000-0000-4000-8000-000000000004',
  tender: '10000000-0000-4000-8000-000000000005',
  snapshot: '10000000-0000-4000-8000-000000000006',
  artifact: '10000000-0000-4000-8000-000000000007',
  source: '10000000-0000-4000-8000-000000000008',
  version: '10000000-0000-4000-8000-000000000009',
  proposal: '10000000-0000-4000-8000-000000000010',
});

assert.equal(Object.isFrozen(AGT002_WORKBENCH_CAPABILITIES), true);
assert.equal(AGT002_WORKBENCH_CONTRACT_VERSION, 'agt002.dossier-workbench.v1');
assert.equal(AGT002_WORKBENCH_POLICY_VERSION, 'agt002.dossier-workbench.policy.v1');
assert.deepEqual(AGT002_WORKBENCH_CAPABILITIES, {
  reply: 'agt002.dossier-workbench.reply.v1',
  draft: 'agt002.dossier-workbench.draft.v1',
  learningProposal: 'agt002.dossier-workbench.learning-proposal.v1',
});

const input = Object.freeze({
  job_id: UUID.job,
  thread_id: UUID.thread,
  origin_message_id: UUID.message,
  opportunity_id: UUID.opportunity,
  tender_id: UUID.tender,
  snapshot_id: UUID.snapshot,
  base_version_id: UUID.version,
  capability_id: AGT002_WORKBENCH_CAPABILITIES.reply,
  contract_version: AGT002_WORKBENCH_CONTRACT_VERSION,
  policy_version: AGT002_WORKBENCH_POLICY_VERSION,
  context_links: [{
    kind: 'source',
    id: UUID.source,
    label: 'Pliego definitivo',
    source_ref: 'SECOP-II:CO1.NTC.123',
  }],
  message: 'Identifique los faltantes con sus fuentes.',
});

assert.equal(validateAgt002WorkbenchJobInput(input), input);
assert.throws(
  () => validateAgt002WorkbenchJobInput({ ...input, opportunity_id: 'otra' }),
  /opportunity_id|UUID/i,
);
assert.throws(
  () => validateAgt002WorkbenchJobInput({ ...input, action: 'presentar' }),
  /cerrad|inesperad/i,
);
assert.throws(
  () => validateAgt002WorkbenchJobInput({ ...input, context_links: [...input.context_links, { ...input.context_links[0], invented: true }] }),
  /cerrad|inesperad/i,
);

const reply = {
  kind: 'reply',
  visible_agent_name: 'Vig-IA',
  human_review_required: true,
  snapshot_id: UUID.snapshot,
  base_version_id: UUID.version,
  content_text: 'Falta el certificado de experiencia. Revise la fuente vinculada.',
  source_links: [UUID.source],
  missing_information: ['Certificado de experiencia vigente'],
  required_actions: ['La encargada debe confirmar la vigencia del certificado.'],
};
assert.equal(validateAgt002WorkbenchResult(reply, { input }), reply);

const draftInput = { ...input, capability_id: AGT002_WORKBENCH_CAPABILITIES.draft };
const draft = {
  kind: 'draft',
  visible_agent_name: 'Vig-IA',
  human_review_required: true,
  snapshot_id: UUID.snapshot,
  base_version_id: UUID.version,
  artifact_id: UUID.artifact,
  content_kind: 'markdown',
  content_text: '# Borrador\n\nSujeto a revisión humana.',
  content_metadata: { title: 'Documento técnico' },
  source_links: [UUID.source],
  missing_information: [],
  required_actions: ['La encargada debe revisar esta versión.'],
};
assert.equal(validateAgt002WorkbenchResult(draft, { input: draftInput }), draft);

const learningInput = { ...input, capability_id: AGT002_WORKBENCH_CAPABILITIES.learningProposal };
const learning = {
  kind: 'learning_proposal',
  visible_agent_name: 'Vig-IA',
  human_review_required: true,
  snapshot_id: UUID.snapshot,
  base_version_id: UUID.version,
  proposal_id: UUID.proposal,
  proposal_type: 'pattern',
  proposed_rule: 'Solicitar certificado de experiencia cuando el pliego lo exija.',
  scope: 'entity',
  valid_from: '2026-07-28T00:00:00.000Z',
  valid_until: null,
  source_message_id: UUID.message,
  source_links: [UUID.source],
};
assert.equal(validateAgt002WorkbenchResult(learning, { input: learningInput }), learning);

assert.throws(
  () => validateAgt002WorkbenchResult({ ...reply, visible_agent_name: 'AGT-002' }, { input }),
  /Vig-IA|identidad/i,
);
assert.throws(
  () => validateAgt002WorkbenchResult({ ...reply, human_review_required: false }, { input }),
  /revisión humana/i,
);
assert.throws(
  () => validateAgt002WorkbenchResult({ ...reply, source_links: ['10000000-0000-4000-8000-000000000099'] }, { input }),
  /fuente|context/i,
);
assert.throws(
  () => validateAgt002WorkbenchResult({ ...reply, send_now: true }, { input }),
  /cerrad|inesperad/i,
);
assert.throws(
  () => validateAgt002WorkbenchResult({ ...reply, content_text: 'He aprobado y radicaré la oferta.' }, { input }),
  /autoridad|prohibid/i,
);
assert.throws(
  () => validateAgt002WorkbenchResult(reply, { input: { ...input, capability_id: AGT002_WORKBENCH_CAPABILITIES.draft } }),
  /capability|tipo/i,
);

console.log('AGT-002 dossier workbench contract passed');
