import {
  AGT003_COPILOT_CAPABILITY,
  AGT003_COPILOT_CONTRACT_VERSION,
  validateAgt003CopilotRequest,
} from './agt003-copilot-contract.js';

const MAX_INTERACTIONS = 20;
const MAX_INTERACTION_CHARS = 2000;
const MAX_INTERACTION_TOTAL_CHARS = 20000;
const OPPORTUNITY_FACT_FIELDS = [
  'title',
  'company_name',
  'stage',
  'service',
  'owner_name',
  'offer_value',
  'expected_close_date',
  'next_action',
  'next_action_date',
  'observations',
];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalIdPart(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._:-]+/g, '-');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export function redactAgt003CopilotText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/https?:\/\/[^\s?]+\?[^\s]+/gi, '[REDACTED_SIGNED_URL]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '[REDACTED_SECRET]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|secret|token)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED_SECRET]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?57[\s.-]*)?(?:3\d{2})[\s.-]*\d{3}[\s.-]*\d{4}\b/g, '[REDACTED_PHONE]');
}

function requiredText(value, field) {
  const text = redactAgt003CopilotText(value).trim();
  if (!text) throw new Error(`La oportunidad requiere ${field}.`);
  return text;
}

function buildFacts(opportunity) {
  const id = canonicalIdPart(opportunity.id);
  const facts = [];
  for (const field of OPPORTUNITY_FACT_FIELDS) {
    const raw = opportunity[field];
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const value = redactAgt003CopilotText(raw).slice(0, 2000);
    if (!value) continue;
    facts.push({
      evidence_id: `evidence:opportunity:${id}:${field}`,
      field,
      value,
      source: 'SIIO',
    });
  }
  return facts;
}

function interactionTimestamp(interaction) {
  const value = interaction.occurred_at || interaction.created_at || interaction.date;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function buildInteractions(interactions) {
  if (!Array.isArray(interactions)) throw new Error('interactions debe ser un arreglo.');
  const sorted = interactions
    .map(item => ({ item, occurredAt: interactionTimestamp(item), id: String(item?.id || '') }))
    .filter(entry => entry.occurredAt && entry.id)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
    .slice(0, MAX_INTERACTIONS);

  let remaining = MAX_INTERACTION_TOTAL_CHARS;
  const result = [];
  for (const { item, occurredAt, id } of sorted) {
    if (remaining <= 0) break;
    const rawSummary = item.summary ?? item.notes ?? item.description ?? item.observations ?? '';
    const summary = redactAgt003CopilotText(rawSummary).slice(0, Math.min(MAX_INTERACTION_CHARS, remaining));
    if (!summary.trim()) continue;
    remaining -= summary.length;
    result.push({
      interaction_id: String(id),
      interaction_type: String(item.interaction_type || item.type || 'note'),
      occurred_at: occurredAt,
      summary,
      evidence_id: `evidence:interaction:${canonicalIdPart(id)}`,
      untrusted_crm_text: true,
    });
  }
  return result;
}

export function buildAgt003CopilotRequest({ opportunity, interactions = [], approvedAssets = [], correlationId, snapshotId }) {
  if (!opportunity || typeof opportunity !== 'object' || Array.isArray(opportunity)) throw new Error('La oportunidad es obligatoria.');
  if (!nonEmptyString(correlationId)) throw new Error('correlationId es obligatorio.');
  if (!nonEmptyString(snapshotId)) throw new Error('snapshotId es obligatorio.');
  if (!Array.isArray(approvedAssets)) throw new Error('approvedAssets debe ser un arreglo validado.');

  const request = {
    contract_version: AGT003_COPILOT_CONTRACT_VERSION,
    capability_id: AGT003_COPILOT_CAPABILITY,
    correlation_id: correlationId,
    snapshot_id: snapshotId,
    opportunity: {
      opportunity_id: requiredText(opportunity.id, 'id'),
      title: requiredText(opportunity.title, 'title'),
      company_name: requiredText(opportunity.company_name, 'company_name'),
      stage: requiredText(opportunity.stage, 'stage'),
      service: requiredText(opportunity.service, 'service'),
      owner_name: requiredText(opportunity.owner_name, 'owner_name'),
      facts: buildFacts(opportunity),
    },
    interactions: buildInteractions(interactions),
    approved_assets: approvedAssets.map(asset => ({
      asset_id: asset.asset_id,
      title: asset.title,
      asset_type: asset.asset_type,
      url: asset.url,
      status: asset.status,
      valid_until: asset.valid_until,
      tags: [...asset.tags],
    })),
    authority: {
      read_only: true,
      human_review_required: true,
      external_send_allowed: false,
      crm_write_allowed: false,
      public_research_allowed: false,
    },
  };
  validateAgt003CopilotRequest(request);
  return deepFreeze(request);
}
