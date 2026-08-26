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

// Convención monetaria vigente del CRM: los valores se registran en COP salvo que la oportunidad
// declare explícitamente otra moneda. VIG-IA no debe pedir la "moneda exacta" cuando este contexto
// ya la resuelve.
export const AGT003_CRM_DEFAULT_CURRENCY = 'COP';

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

// offer_value es un hecho monetario, no texto libre: un decimal grande (p.ej. 3500000000) puede
// coincidir con el patrón de teléfono colombiano de redactAgt003CopilotText. Una representación
// numérica finita/no negativa viaja intacta; cualquier otra cosa cae al camino de redacción normal.
const OFFER_VALUE_DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

function offerValueLiteral(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? String(raw) : null;
  }
  if (typeof raw === 'string' && OFFER_VALUE_DECIMAL_PATTERN.test(raw.trim())) {
    return raw.trim();
  }
  return null;
}

function requiredText(value, field) {
  const text = redactAgt003CopilotText(value).trim();
  if (!text) throw new Error(`La oportunidad requiere ${field}.`);
  return text;
}

// Fecha real de ejecución de la preparación (no la de creación de la oportunidad ni la de un run
// anterior). `now` es inyectable para pruebas deterministas; por defecto usa el reloj real.
export function agt003PreparationDate(now = () => new Date()) {
  return now().toISOString().slice(0, 10);
}

export function buildAgt003Facts(opportunity, preparationDate) {
  const id = canonicalIdPart(opportunity.id);
  const facts = [];
  for (const field of OPPORTUNITY_FACT_FIELDS) {
    const raw = opportunity[field];
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    // NaN/Infinity no son un hecho monetario representable: se omiten en lugar de viajar como texto.
    if (field === 'offer_value' && typeof raw === 'number' && !Number.isFinite(raw)) continue;
    const literal = field === 'offer_value' ? offerValueLiteral(raw) : null;
    const value = literal !== null ? literal : redactAgt003CopilotText(raw).slice(0, 2000);
    if (!value) continue;
    facts.push({
      evidence_id: `evidence:opportunity:${id}:${field}`,
      field,
      value,
      source: 'SIIO',
    });
  }
  facts.push({
    evidence_id: `evidence:opportunity:${id}:preparation_date`,
    field: 'preparation_date',
    value: preparationDate,
    source: 'SIIO',
  });
  if (facts.some(fact => fact.field === 'offer_value')) {
    const currency = nonEmptyString(opportunity.currency) ? opportunity.currency.trim() : AGT003_CRM_DEFAULT_CURRENCY;
    facts.push({
      evidence_id: `evidence:opportunity:${id}:offer_currency`,
      field: 'offer_currency',
      value: currency,
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

export function buildAgt003Interactions(interactions) {
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

export function buildAgt003CopilotRequest({ opportunity, interactions = [], approvedAssets = [], correlationId, snapshotId, now = () => new Date() }) {
  if (!opportunity || typeof opportunity !== 'object' || Array.isArray(opportunity)) throw new Error('La oportunidad es obligatoria.');
  if (!nonEmptyString(correlationId)) throw new Error('correlationId es obligatorio.');
  if (!nonEmptyString(snapshotId)) throw new Error('snapshotId es obligatorio.');
  if (!Array.isArray(approvedAssets)) throw new Error('approvedAssets debe ser un arreglo validado.');
  // El backend puede fijar `preparation_date` (misma fuente que el hash del snapshot); en ese caso
  // gobierna sobre `now`, así un run reutilizado no arrastra una fecha vieja ni una nueva inconsistente.
  const preparationDate = nonEmptyString(opportunity.preparation_date)
    ? opportunity.preparation_date.trim()
    : agt003PreparationDate(now);

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
      facts: buildAgt003Facts(opportunity, preparationDate),
    },
    interactions: buildAgt003Interactions(interactions),
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
