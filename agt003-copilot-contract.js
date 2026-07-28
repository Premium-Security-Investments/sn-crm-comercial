export const AGT003_COPILOT_CAPABILITY = 'agt003.opportunity-copilot.preview';
export const AGT003_COPILOT_CONTRACT_VERSION = '2.0-draft.1';

const REQUEST_KEYS = ['contract_version', 'capability_id', 'correlation_id', 'snapshot_id', 'opportunity', 'interactions', 'approved_assets', 'authority'];
const OPPORTUNITY_KEYS = ['opportunity_id', 'title', 'company_name', 'stage', 'service', 'owner_name', 'facts'];
const FACT_INPUT_KEYS = ['evidence_id', 'field', 'value', 'source'];
const INTERACTION_KEYS = ['interaction_id', 'interaction_type', 'occurred_at', 'summary', 'evidence_id', 'untrusted_crm_text'];
const ASSET_KEYS = ['asset_id', 'title', 'asset_type', 'url', 'status', 'valid_until', 'tags'];
const AUTHORITY_KEYS = ['read_only', 'human_review_required', 'external_send_allowed', 'crm_write_allowed', 'public_research_allowed'];
const RESPONSE_KEYS = ['contract_version', 'capability_id', 'correlation_id', 'snapshot_id', 'policy_version', 'model', 'generated_at', 'brief'];
const BRIEF_KEYS = ['summary', 'facts', 'inferences', 'missing_information', 'contact_objective', 'strategy', 'draft', 'recommended_asset_ids', 'warnings', 'human_review_required'];
const FACT_OUTPUT_KEYS = ['text', 'evidence_refs'];
const INFERENCE_KEYS = ['text', 'evidence_refs', 'confidence'];
const DRAFT_KEYS = ['subject', 'body'];

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

function requireStringArray(value, label, maxItems) {
  if (!Array.isArray(value) || value.length > maxItems || !value.every(item => nonEmptyString(item))) {
    throw new Error(`${label} debe ser un arreglo acotado de textos no vacíos.`);
  }
}

function validateOpportunity(value) {
  requireClosed(value, OPPORTUNITY_KEYS, 'opportunity');
  for (const key of OPPORTUNITY_KEYS.slice(0, 6)) if (!nonEmptyString(value[key])) throw new Error(`opportunity.${key} es obligatorio.`);
  if (!Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 30) throw new Error('opportunity.facts debe contener entre 1 y 30 hechos.');
  for (const fact of value.facts) {
    requireClosed(fact, FACT_INPUT_KEYS, 'opportunity.fact');
    if (!nonEmptyString(fact.evidence_id) || !nonEmptyString(fact.field) || !nonEmptyString(fact.value, 2000) || fact.source !== 'SIIO') {
      throw new Error('Cada hecho de oportunidad requiere evidencia, campo, valor acotado y fuente SIIO.');
    }
  }
}

function validateInteraction(value) {
  requireClosed(value, INTERACTION_KEYS, 'interaction');
  if (!nonEmptyString(value.interaction_id) || !nonEmptyString(value.interaction_type) || Number.isNaN(Date.parse(value.occurred_at))
    || !nonEmptyString(value.summary, 2000) || !nonEmptyString(value.evidence_id) || value.untrusted_crm_text !== true) {
    throw new Error('Cada interacción debe ser cerrada, acotada, fechada y marcada como texto CRM no confiable.');
  }
}

function validateAsset(value) {
  requireClosed(value, ASSET_KEYS, 'approved_asset');
  if (!nonEmptyString(value.asset_id) || !nonEmptyString(value.title) || !nonEmptyString(value.asset_type)
    || !nonEmptyString(value.url) || value.status !== 'approved' || (value.valid_until !== null && Number.isNaN(Date.parse(value.valid_until)))) {
    throw new Error('Cada activo debe ser aprobado, identificable, HTTPS y con vigencia válida.');
  }
  let url;
  try { url = new URL(value.url); } catch { throw new Error('Cada activo debe usar una URL HTTPS válida.'); }
  if (url.protocol !== 'https:') throw new Error('Cada activo debe usar una URL HTTPS válida.');
  requireStringArray(value.tags, 'approved_asset.tags', 20);
}

export function validateAgt003CopilotRequest(value) {
  requireClosed(value, REQUEST_KEYS, 'La solicitud AGT-003');
  if (value.contract_version !== AGT003_COPILOT_CONTRACT_VERSION || value.capability_id !== AGT003_COPILOT_CAPABILITY) {
    throw new Error('La identidad contractual de AGT-003 no es válida.');
  }
  if (!nonEmptyString(value.correlation_id) || !nonEmptyString(value.snapshot_id)) throw new Error('correlation_id y snapshot_id son obligatorios.');
  validateOpportunity(value.opportunity);
  if (!Array.isArray(value.interactions) || value.interactions.length > 20) throw new Error('interactions excede el límite permitido.');
  value.interactions.forEach(validateInteraction);
  if (!Array.isArray(value.approved_assets) || value.approved_assets.length > 50) throw new Error('approved_assets excede el límite permitido.');
  value.approved_assets.forEach(validateAsset);
  requireClosed(value.authority, AUTHORITY_KEYS, 'authority');
  if (value.authority.read_only !== true || value.authority.human_review_required !== true
    || value.authority.external_send_allowed !== false || value.authority.crm_write_allowed !== false
    || value.authority.public_research_allowed !== false) {
    throw new Error('La authority de AGT-003 debe permanecer read-only, sin envío, escritura ni investigación pública y con revisión humana.');
  }
  return value;
}

function collectAllowed(request) {
  return {
    evidence: new Set([
      ...request.opportunity.facts.map(item => item.evidence_id),
      ...request.interactions.map(item => item.evidence_id),
    ]),
    assets: new Set(request.approved_assets.map(item => item.asset_id)),
  };
}

function validateEvidenceItems(items, keys, allowed, label, maxItems) {
  if (!Array.isArray(items) || items.length > maxItems) throw new Error(`${label} debe ser un arreglo acotado.`);
  for (const item of items) {
    requireClosed(item, keys, label);
    if (!nonEmptyString(item.text, 2000) || !Array.isArray(item.evidence_refs) || item.evidence_refs.length < 1
      || !item.evidence_refs.every(ref => nonEmptyString(ref) && allowed.has(ref))) {
      throw new Error(`${label} cita un evidence_id que no fue enviado como evidencia autorizada.`);
    }
    if (keys === INFERENCE_KEYS && !['low', 'medium', 'high'].includes(item.confidence)) throw new Error('La confianza de inferencia no es válida.');
  }
}

export function validateAgt003CopilotResponse(value, { request } = {}) {
  validateAgt003CopilotRequest(request);
  requireClosed(value, RESPONSE_KEYS, 'La respuesta AGT-003');
  if (value.contract_version !== request.contract_version || value.capability_id !== request.capability_id
    || value.correlation_id !== request.correlation_id || value.snapshot_id !== request.snapshot_id) {
    throw new Error('La respuesta no coincide con la identidad, correlación o snapshot de la solicitud.');
  }
  if (!nonEmptyString(value.policy_version) || !nonEmptyString(value.model) || Number.isNaN(Date.parse(value.generated_at))) {
    throw new Error('La respuesta requiere policy_version, model y generated_at válidos.');
  }
  requireClosed(value.brief, BRIEF_KEYS, 'brief');
  const allowed = collectAllowed(request);
  if (!nonEmptyString(value.brief.summary, 4000)) throw new Error('brief.summary es obligatorio.');
  validateEvidenceItems(value.brief.facts, FACT_OUTPUT_KEYS, allowed.evidence, 'brief.facts', 20);
  validateEvidenceItems(value.brief.inferences, INFERENCE_KEYS, allowed.evidence, 'brief.inferences', 20);
  requireStringArray(value.brief.missing_information, 'brief.missing_information', 20);
  if (!nonEmptyString(value.brief.contact_objective, 1000) || !nonEmptyString(value.brief.strategy, 2000)) throw new Error('El objetivo y la estrategia son obligatorios.');
  requireClosed(value.brief.draft, DRAFT_KEYS, 'brief.draft');
  if (!nonEmptyString(value.brief.draft.subject, 300) || !nonEmptyString(value.brief.draft.body, 8000)) throw new Error('El borrador requiere asunto y cuerpo acotados.');
  requireStringArray(value.brief.recommended_asset_ids, 'brief.recommended_asset_ids', 20);
  for (const assetId of value.brief.recommended_asset_ids) if (!allowed.assets.has(assetId)) throw new Error(`La respuesta recomienda un activo no autorizado: ${assetId}.`);
  requireStringArray(value.brief.warnings, 'brief.warnings', 20);
  if (value.brief.human_review_required !== true) throw new Error('La respuesta siempre requiere revisión humana.');
  return value;
}
