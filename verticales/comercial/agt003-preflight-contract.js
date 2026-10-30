export const AGT003_PREFLIGHT_CAPABILITY = 'agt003.opportunity-preflight.preview';
export const AGT003_PREFLIGHT_CONTRACT_VERSION = 'agt003-preflight-v1';
export const PREFLIGHT_ISSUE_CODES = Object.freeze([
  'next_action',
  'close_date',
  'decision_maker',
  'stalled_conversation',
  'pending_terms',
  'escalation_needed',
  'other',
]);

const REQUEST_KEYS = ['contract_version', 'capability_id', 'correlation_id', 'snapshot_id', 'opportunity', 'interactions', 'authority'];
const OPPORTUNITY_KEYS = ['opportunity_id', 'title', 'company_name', 'stage', 'service', 'owner_name', 'facts'];
const FACT_KEYS = ['evidence_id', 'field', 'value', 'source'];
const INTERACTION_KEYS = ['interaction_id', 'interaction_type', 'occurred_at', 'summary', 'evidence_id', 'untrusted_crm_text'];
const AUTHORITY_KEYS = ['read_only', 'human_review_required', 'external_send_allowed', 'crm_write_allowed', 'public_research_allowed'];
const RESPONSE_KEYS = ['contract_version', 'capability_id', 'correlation_id', 'snapshot_id', 'policy_version', 'model', 'generated_at', 'actions'];
const ACTION_KEYS = ['issue_code', 'title', 'description', 'evidence_refs'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}

function nonEmptyString(value, max = Infinity) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function requireClosed(value, keys, label) {
  if (!exactKeys(value, keys)) throw new Error(`${label} debe ser un objeto JSON cerrado sin claves inesperadas.`);
}

function validateOpportunity(value) {
  requireClosed(value, OPPORTUNITY_KEYS, 'opportunity');
  for (const key of OPPORTUNITY_KEYS.slice(0, 6)) {
    if (!nonEmptyString(value[key])) throw new Error(`opportunity.${key} es obligatorio.`);
  }
  if (!Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 30) {
    throw new Error('opportunity.facts debe contener entre 1 y 30 hechos.');
  }
  for (const fact of value.facts) {
    requireClosed(fact, FACT_KEYS, 'opportunity.fact');
    if (!nonEmptyString(fact.evidence_id) || !nonEmptyString(fact.field)
      || !nonEmptyString(fact.value, 2000) || fact.source !== 'SIIO') {
      throw new Error('Cada hecho requiere evidence_id, campo, valor acotado y fuente SIIO.');
    }
  }
}

function validateInteraction(value) {
  requireClosed(value, INTERACTION_KEYS, 'interaction');
  if (!nonEmptyString(value.interaction_id) || !nonEmptyString(value.interaction_type)
    || !nonEmptyString(value.occurred_at) || Number.isNaN(Date.parse(value.occurred_at))
    || !nonEmptyString(value.summary, 2000) || !nonEmptyString(value.evidence_id)
    || value.untrusted_crm_text !== true) {
    throw new Error('Cada interacción debe ser cerrada, acotada, fechada y marcada como texto CRM no confiable.');
  }
}

export function validateAgt003PreflightRequest(value) {
  requireClosed(value, REQUEST_KEYS, 'La solicitud preflight AGT-003');
  if (value.contract_version !== AGT003_PREFLIGHT_CONTRACT_VERSION
    || value.capability_id !== AGT003_PREFLIGHT_CAPABILITY) {
    throw new Error('La identidad contractual del preflight AGT-003 no es válida.');
  }
  if (!nonEmptyString(value.correlation_id) || !nonEmptyString(value.snapshot_id)) {
    throw new Error('correlation_id y snapshot_id son obligatorios.');
  }
  validateOpportunity(value.opportunity);
  if (!Array.isArray(value.interactions) || value.interactions.length > 20) {
    throw new Error('interactions excede el límite permitido.');
  }
  value.interactions.forEach(validateInteraction);
  requireClosed(value.authority, AUTHORITY_KEYS, 'authority');
  if (value.authority.read_only !== true || value.authority.human_review_required !== true
    || value.authority.external_send_allowed !== false || value.authority.crm_write_allowed !== false
    || value.authority.public_research_allowed !== false) {
    throw new Error('La authority debe permanecer read-only, sin envío, escritura ni investigación pública y con revisión humana.');
  }
  return value;
}

export function validateAgt003PreflightResponse(value, { request } = {}) {
  validateAgt003PreflightRequest(request);
  requireClosed(value, RESPONSE_KEYS, 'La respuesta preflight AGT-003');
  if (value.contract_version !== request.contract_version || value.capability_id !== request.capability_id
    || value.correlation_id !== request.correlation_id || value.snapshot_id !== request.snapshot_id) {
    throw new Error('La respuesta no coincide con la identidad, correlación o snapshot de la solicitud.');
  }
  if (!nonEmptyString(value.policy_version) || !nonEmptyString(value.model)
    || !nonEmptyString(value.generated_at) || Number.isNaN(Date.parse(value.generated_at))) {
    throw new Error('La respuesta requiere policy_version, model y generated_at válidos.');
  }
  if (!Array.isArray(value.actions) || value.actions.length > 8) {
    throw new Error('actions debe ser un arreglo acotado.');
  }
  const allowedEvidence = new Set([
    ...request.opportunity.facts.map(item => item.evidence_id),
    ...request.interactions.map(item => item.evidence_id),
  ]);
  for (const action of value.actions) {
    requireClosed(action, ACTION_KEYS, 'action');
    if (!PREFLIGHT_ISSUE_CODES.includes(action.issue_code)) throw new Error('action.issue_code no es válido.');
    if (!nonEmptyString(action.title, 200) || !nonEmptyString(action.description, 1000)) {
      throw new Error('Cada acción requiere título y descripción acotados.');
    }
    if (!Array.isArray(action.evidence_refs) || action.evidence_refs.length < 1 || action.evidence_refs.length > 5
      || new Set(action.evidence_refs).size !== action.evidence_refs.length
      || !action.evidence_refs.every(ref => nonEmptyString(ref) && allowedEvidence.has(ref))) {
      throw new Error('Cada acción debe citar entre 1 y 5 evidence_id autorizados y únicos.');
    }
  }
  return value;
}
