import {
  AGT003_PREFLIGHT_CAPABILITY,
  AGT003_PREFLIGHT_CONTRACT_VERSION,
  validateAgt003PreflightRequest,
} from './agt003-preflight-contract.js';
import {
  agt003PreparationDate,
  buildAgt003Facts,
  buildAgt003Interactions,
  redactAgt003CopilotText,
} from './agt003-copilot-input.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requiredText(value, field) {
  const text = redactAgt003CopilotText(value).trim();
  if (!text) throw new Error(`La oportunidad requiere ${field}.`);
  return text;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export function buildAgt003CopilotPreflightRequest({
  opportunity,
  interactions = [],
  correlationId,
  snapshotId,
  now = () => new Date(),
}) {
  if (!opportunity || typeof opportunity !== 'object' || Array.isArray(opportunity)) {
    throw new Error('La oportunidad es obligatoria.');
  }
  if (!Array.isArray(interactions)) throw new Error('interactions debe ser un arreglo.');
  if (!nonEmptyString(correlationId)) throw new Error('correlationId es obligatorio.');
  if (!nonEmptyString(snapshotId)) throw new Error('snapshotId es obligatorio.');

  const preparationDate = nonEmptyString(opportunity.preparation_date)
    ? opportunity.preparation_date.trim()
    : agt003PreparationDate(now);
  const request = {
    contract_version: AGT003_PREFLIGHT_CONTRACT_VERSION,
    capability_id: AGT003_PREFLIGHT_CAPABILITY,
    correlation_id: correlationId,
    snapshot_id: snapshotId,
    opportunity: {
      opportunity_id: requiredText(opportunity.id, 'id'),
      title: requiredText(opportunity.title, 'title'),
      company_name: requiredText(opportunity.company_name, 'company_name'),
      stage: requiredText(opportunity.stage, 'stage'),
      service: requiredText(opportunity.service, 'service'),
      owner_name: requiredText(opportunity.owner_name, 'owner_name'),
      facts: buildAgt003Facts(opportunity, preparationDate),
    },
    interactions: buildAgt003Interactions(interactions),
    authority: {
      read_only: true,
      human_review_required: true,
      external_send_allowed: false,
      crm_write_allowed: false,
      public_research_allowed: false,
    },
  };
  validateAgt003PreflightRequest(request);
  return deepFreeze(request);
}
