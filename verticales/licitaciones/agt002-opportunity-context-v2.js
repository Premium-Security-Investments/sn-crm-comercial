import { AGT002_CONTEXT_V2_FIELDS, buildAgt002ContextV2 } from './agt002-context-v2.js';

export const AGT002_OPPORTUNITY_CONTEXT_SELECT = 'id,owner_id,owner_name,company_name,stage_code,stage_name,offer_value,next_action_at,updated_at,created_at,expected_close_date';
export const AGT002_TENDER_CONTEXT_SELECT = 'id,source,entity,dept,city,title,value,status,published_at,deadline_at,url,raw,internal_status,tracking_owner_id,tracking_status,tracking_next_action,tracking_due_at,tracking_last_note,reasons,updated_at,created_at';

const EPOCH = '1970-01-01T00:00:00.000Z';

function observedAt(record, fallback = EPOCH) {
  return record?.updated_at || record?.created_at || fallback;
}

function source(reference, record, type = 'database') {
  return { type, reference, observed_at: observedAt(record) };
}

function evidence(value, reference, record, { status = 'verified', type = 'database' } = {}) {
  const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  return {
    status: missing ? 'not_verified' : status,
    value: missing ? null : value,
    source: source(missing ? `missing:${reference}` : reference, record, missing ? 'system' : type),
  };
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function rawValue(raw, keys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return firstDefined(...keys.map(key => raw[key]));
}

function placeValue(tender) {
  return [tender?.city, tender?.dept].filter(Boolean).join(', ') || null;
}

function conversionReason(tender) {
  if (!Array.isArray(tender?.reasons) || !tender.reasons.length) return null;
  return tender.reasons.map(String).filter(Boolean).sort((left, right) => left.localeCompare(right)).join(' · ');
}

function emptyCompanyDossier(referenceRecord) {
  return Object.fromEntries(AGT002_CONTEXT_V2_FIELDS.company_dossier.map(key => [
    key,
    evidence(null, `company_dossier:${key}`, referenceRecord),
  ]));
}

export function buildAgt002OpportunityContextV2({ opportunity = {}, tender = {} }) {
  const opportunityObserved = observedAt(opportunity, observedAt(tender));
  const opportunitySourceRecord = { updated_at: opportunityObserved };
  const budget = firstDefined(tender.value, opportunity.offer_value);
  const opportunitySection = {
    opportunity_id: evidence(opportunity.id, 'v_psi_sales_opportunity_enriched:id', opportunity),
    tender_id: evidence(tender.id, 'psi_public_tenders:id', tender),
    title: evidence(tender.title, 'psi_public_tenders:title', tender),
    entity: evidence(tender.entity, 'psi_public_tenders:entity', tender),
    modality: evidence(rawValue(tender.raw, ['modalidad', 'modalidadContratacion', 'modalidad_de_contratacion']), 'psi_public_tenders:raw.modalidad', tender),
    budget: evidence(budget, tender.value != null ? 'psi_public_tenders:value' : 'v_psi_sales_opportunity_enriched:offer_value', tender.value != null ? tender : opportunity),
    currency: evidence(budget == null ? null : 'COP', 'system:currency_from_budget', opportunitySourceRecord, { status: 'reported', type: 'system' }),
    published_at: evidence(tender.published_at, 'psi_public_tenders:published_at', tender),
    submission_deadline: evidence(tender.deadline_at, 'psi_public_tenders:deadline_at', tender),
    place: evidence(placeValue(tender), 'psi_public_tenders:city,dept', tender),
    duration: evidence(rawValue(tender.raw, ['duracion', 'duracionContrato', 'duracion_contrato']), 'psi_public_tenders:raw.duracion', tender),
    status: evidence(firstDefined(tender.tracking_status, tender.internal_status, tender.status), tender.tracking_status ? 'psi_public_tenders:tracking_status' : 'psi_public_tenders:status', tender),
    official_source: evidence(tender.source, 'psi_public_tenders:source', tender),
    source_url: evidence(tender.url, 'psi_public_tenders:url', tender),
    owner_id: evidence(firstDefined(opportunity.owner_id, tender.tracking_owner_id), opportunity.owner_id ? 'v_psi_sales_opportunity_enriched:owner_id' : 'psi_public_tenders:tracking_owner_id', opportunity.owner_id ? opportunity : tender),
    owner_name: evidence(opportunity.owner_name, 'v_psi_sales_opportunity_enriched:owner_name', opportunity),
    conversion_reason: evidence(conversionReason(tender), 'psi_public_tenders:reasons', tender, { status: 'reported' }),
    authorized_notes: evidence(tender.tracking_last_note, 'psi_public_tenders:tracking_last_note', tender, { status: 'reported' }),
  };
  const commercialSection = {
    opportunity_status: evidence(firstDefined(opportunity.stage_name, opportunity.stage_code), opportunity.stage_name ? 'v_psi_sales_opportunity_enriched:stage_name' : 'v_psi_sales_opportunity_enriched:stage_code', opportunity),
    commercial_owner: evidence(firstDefined(opportunity.owner_name, opportunity.owner_id), opportunity.owner_name ? 'v_psi_sales_opportunity_enriched:owner_name' : 'v_psi_sales_opportunity_enriched:owner_id', opportunity),
    account_relationship: evidence(opportunity.company_name, 'v_psi_sales_opportunity_enriched:company_name', opportunity, { status: 'reported' }),
    next_action: evidence(tender.tracking_next_action, 'psi_public_tenders:tracking_next_action', tender, { status: 'reported' }),
    due_at: evidence(firstDefined(tender.tracking_due_at, opportunity.next_action_at), tender.tracking_due_at ? 'psi_public_tenders:tracking_due_at' : 'v_psi_sales_opportunity_enriched:next_action_at', tender.tracking_due_at ? tender : opportunity),
    authorized_notes: evidence(tender.tracking_last_note, 'psi_public_tenders:tracking_last_note', tender, { status: 'reported' }),
  };

  const validated = buildAgt002ContextV2({
    snapshot_id: tender.id || opportunity.id || 'agt002-context-v2-unbound',
    opportunity: opportunitySection,
    company_dossier: emptyCompanyDossier(opportunitySourceRecord),
    commercial_context: commercialSection,
    human_evidence: [],
  });
  return {
    opportunity: validated.opportunity,
    commercial_context: validated.commercial_context,
  };
}

async function requireSingle(query, label) {
  const { data, error } = await query.single();
  if (error) throw error;
  if (!data) throw new Error(`No se encontró ${label}.`);
  return data;
}

export async function loadAgt002OpportunityContextV2(database, { opportunityId, tenderId, opportunity: providedOpportunity = null }) {
  const opportunity = providedOpportunity || await requireSingle(
    database.from('v_psi_sales_opportunity_enriched').select(AGT002_OPPORTUNITY_CONTEXT_SELECT).eq('id', opportunityId),
    'la oportunidad para contexto AGT-002',
  );
  const tender = await requireSingle(
    database.from('psi_public_tenders').select(AGT002_TENDER_CONTEXT_SELECT).eq('id', tenderId).eq('converted_opportunity_id', opportunityId),
    'la licitación para contexto AGT-002',
  );
  return buildAgt002OpportunityContextV2({ opportunity, tender });
}
