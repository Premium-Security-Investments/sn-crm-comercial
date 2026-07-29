export const AGT002_WORKBENCH_CONTRACT_VERSION = 'agt002.dossier-workbench.v1';
export const AGT002_WORKBENCH_POLICY_VERSION = 'agt002.dossier-workbench.policy.v1';
export const AGT002_WORKBENCH_CAPABILITIES = Object.freeze({
  reply: 'agt002.dossier-workbench.reply.v1',
  draft: 'agt002.dossier-workbench.draft.v1',
  learningProposal: 'agt002.dossier-workbench.learning-proposal.v1',
});

const JOB_KEYS = Object.freeze([
  'job_id',
  'thread_id',
  'origin_message_id',
  'opportunity_id',
  'tender_id',
  'snapshot_id',
  'base_version_id',
  'capability_id',
  'contract_version',
  'policy_version',
  'context_links',
  'message',
]);
const CONTEXT_LINK_KEYS = Object.freeze(['kind', 'id', 'label', 'source_ref']);
const REPLY_KEYS = Object.freeze([
  'kind',
  'visible_agent_name',
  'human_review_required',
  'snapshot_id',
  'base_version_id',
  'content_text',
  'source_links',
  'missing_information',
  'required_actions',
]);
const DRAFT_KEYS = Object.freeze([
  'kind',
  'visible_agent_name',
  'human_review_required',
  'snapshot_id',
  'base_version_id',
  'artifact_id',
  'content_kind',
  'content_text',
  'content_metadata',
  'source_links',
  'missing_information',
  'required_actions',
]);
const LEARNING_KEYS = Object.freeze([
  'kind',
  'visible_agent_name',
  'human_review_required',
  'snapshot_id',
  'base_version_id',
  'proposal_id',
  'proposal_type',
  'proposed_rule',
  'scope',
  'valid_from',
  'valid_until',
  'source_message_id',
  'source_links',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTEXT_KINDS = new Set(['artifact', 'source', 'requirement', 'action', 'message', 'snapshot']);
const CONTENT_KINDS = new Set(['markdown', 'texto', 'metadata']);
const LEARNING_TYPES = new Set(['pattern', 'preference', 'rule', 'source']);
const LEARNING_SCOPES = new Set(['tender', 'entity', 'modality_sector', 'psi_rule']);
const PROHIBITED_AGENT_AUTHORITY = /\b(?:he aprobado|ya aprobé|aprobaré|firmaré|enviaré|radicaré|presentaré)\b/i;

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)
    || Object.keys(value).length !== expected.length
    || !expected.every(key => Object.hasOwn(value, key))) {
    throw new Error(`${label} debe ser un objeto JSON cerrado sin claves inesperadas.`);
  }
}

function requireUuid(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} debe ser un UUID válido.`);
  }
}

function requireText(value, label, max) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > max) {
    throw new Error(`${label} debe ser texto no vacío y acotado.`);
  }
}

function requireStringArray(value, label, max, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)
    || value.length > max
    || (!allowEmpty && value.length === 0)
    || !value.every(item => typeof item === 'string' && item.trim() === item && item.length > 0 && item.length <= 2000)) {
    throw new Error(`${label} debe ser un arreglo acotado de textos no vacíos.`);
  }
}

function requireIsoDate(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} debe ser una fecha ISO válida.`);
  }
}

function validateContextLink(value) {
  exactKeys(value, CONTEXT_LINK_KEYS, 'context_link');
  if (!CONTEXT_KINDS.has(value.kind)) throw new Error('context_link.kind no es válido.');
  requireUuid(value.id, 'context_link.id');
  requireText(value.label, 'context_link.label', 300);
  requireText(value.source_ref, 'context_link.source_ref', 1000);
}

function validateCommonResult(value, input) {
  if (value.visible_agent_name !== 'Vig-IA') throw new Error('La identidad visible debe ser Vig-IA.');
  if (value.human_review_required !== true) throw new Error('Toda respuesta requiere revisión humana.');
  if (value.snapshot_id !== input.snapshot_id || value.base_version_id !== input.base_version_id) {
    throw new Error('El resultado no coincide con snapshot_id o base_version_id del trabajo.');
  }
  requireStringArray(value.source_links, 'source_links', 20);
  const allowedSources = new Set(input.context_links.map(link => link.id));
  if (!value.source_links.every(sourceId => UUID_PATTERN.test(sourceId) && allowedSources.has(sourceId))) {
    throw new Error('El resultado cita una fuente que no pertenece al contexto autorizado.');
  }
}

function rejectAgentAuthority(...texts) {
  if (texts.some(text => typeof text === 'string' && PROHIBITED_AGENT_AUTHORITY.test(text))) {
    throw new Error('El resultado atribuye al agente una autoridad prohibida.');
  }
}

export function validateAgt002WorkbenchJobInput(value) {
  exactKeys(value, JOB_KEYS, 'El trabajo AGT-002');
  requireUuid(value.job_id, 'job_id');
  requireUuid(value.thread_id, 'thread_id');
  requireUuid(value.origin_message_id, 'origin_message_id');
  requireUuid(value.opportunity_id, 'opportunity_id');
  requireUuid(value.tender_id, 'tender_id');
  requireUuid(value.snapshot_id, 'snapshot_id');
  requireUuid(value.base_version_id, 'base_version_id', { nullable: true });
  if (!Object.values(AGT002_WORKBENCH_CAPABILITIES).includes(value.capability_id)) {
    throw new Error('capability_id no pertenece al contrato AGT-002.');
  }
  if (value.contract_version !== AGT002_WORKBENCH_CONTRACT_VERSION) {
    throw new Error('contract_version no coincide con el contrato AGT-002.');
  }
  if (value.policy_version !== AGT002_WORKBENCH_POLICY_VERSION) {
    throw new Error('policy_version no coincide con la política AGT-002.');
  }
  if (!Array.isArray(value.context_links) || value.context_links.length > 20) {
    throw new Error('context_links debe ser un arreglo acotado.');
  }
  value.context_links.forEach(validateContextLink);
  requireText(value.message, 'message', 12000);
  return value;
}

export function validateAgt002WorkbenchResult(value, { input } = {}) {
  validateAgt002WorkbenchJobInput(input);
  if (!isRecord(value)) throw new Error('El resultado debe ser un objeto JSON cerrado.');

  if (value.kind === 'reply') {
    if (input.capability_id !== AGT002_WORKBENCH_CAPABILITIES.reply) {
      throw new Error('El tipo reply no coincide con capability_id.');
    }
    exactKeys(value, REPLY_KEYS, 'El resultado reply');
    validateCommonResult(value, input);
    requireText(value.content_text, 'content_text', 12000);
    requireStringArray(value.missing_information, 'missing_information', 20);
    requireStringArray(value.required_actions, 'required_actions', 20);
    rejectAgentAuthority(value.content_text, ...value.required_actions);
    return value;
  }

  if (value.kind === 'draft') {
    if (input.capability_id !== AGT002_WORKBENCH_CAPABILITIES.draft) {
      throw new Error('El tipo draft no coincide con capability_id.');
    }
    exactKeys(value, DRAFT_KEYS, 'El resultado draft');
    validateCommonResult(value, input);
    requireUuid(value.artifact_id, 'artifact_id');
    if (!CONTENT_KINDS.has(value.content_kind)) throw new Error('content_kind no es válido.');
    requireText(value.content_text, 'content_text', 50000);
    if (!isRecord(value.content_metadata) || JSON.stringify(value.content_metadata).length > 8000) {
      throw new Error('content_metadata debe ser un objeto JSON acotado.');
    }
    requireStringArray(value.missing_information, 'missing_information', 20);
    requireStringArray(value.required_actions, 'required_actions', 20);
    rejectAgentAuthority(value.content_text, ...value.required_actions);
    return value;
  }

  if (value.kind === 'learning_proposal') {
    if (input.capability_id !== AGT002_WORKBENCH_CAPABILITIES.learningProposal) {
      throw new Error('El tipo learning_proposal no coincide con capability_id.');
    }
    exactKeys(value, LEARNING_KEYS, 'El resultado learning_proposal');
    validateCommonResult(value, input);
    requireUuid(value.proposal_id, 'proposal_id');
    if (!LEARNING_TYPES.has(value.proposal_type)) throw new Error('proposal_type no es válido.');
    requireText(value.proposed_rule, 'proposed_rule', 4000);
    if (!LEARNING_SCOPES.has(value.scope)) throw new Error('scope no es válido.');
    requireIsoDate(value.valid_from, 'valid_from');
    requireIsoDate(value.valid_until, 'valid_until', { nullable: true });
    requireUuid(value.source_message_id, 'source_message_id');
    rejectAgentAuthority(value.proposed_rule);
    return value;
  }

  throw new Error('El tipo de resultado AGT-002 no es válido.');
}
