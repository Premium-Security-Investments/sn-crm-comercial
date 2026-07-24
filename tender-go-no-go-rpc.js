import { ACTIONS, requireAction } from './access-control.js';
import { getCurrentTenderAnalysis } from './tender-analysis-foundation.js';
import { buildTenderOfferPreparation } from './tender-offer-preparation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function goNoGoError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireUuid(value, label) {
  const id = String(value || '').trim();
  if (!UUID_PATTERN.test(id)) throw goNoGoError(`Debe indicar ${label}.`);
  return id;
}


function nullableUuid(value, label) {
  if (value === null || value === undefined) return null;
  return requireUuid(value, label);
}

function nullableText(value, max = 1200) {
  return String(value || '').trim().slice(0, max) || null;
}

function requiredText(value, label, max = 1200) {
  const text = nullableText(value, max);
  if (!text) throw goNoGoError(`Debe indicar ${label}.`);
  return text;
}

async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function parseInteractionJson(notes) {
  if (!notes) return null;
  if (typeof notes === 'object') return notes;
  try { return JSON.parse(notes); } catch { return null; }
}

async function resolveTenderContext(database, opportunityId) {
  const opportunity = await must(database.from('v_psi_sales_opportunity_enriched').select('*').eq('id', opportunityId).single());
  if (!opportunity || opportunity.service_type_code !== 'licitacion_publica') throw goNoGoError('La oportunidad no corresponde a una licitación pública.');
  const tender = await must(database.from('psi_public_tenders').select('id,converted_opportunity_id').eq('converted_opportunity_id', opportunityId).maybeSingle());
  if (!tender?.id || tender.converted_opportunity_id !== opportunityId) throw goNoGoError('No existe una licitación vinculada a la oportunidad.', 404);
  return { opportunity, tender };
}

function currentPreparation(preparations) {
  return [...preparations].sort((left, right) => {
    const occurredAt = String(right.occurred_at || '').localeCompare(String(left.occurred_at || ''));
    return occurredAt || String(right.interaction_id).localeCompare(String(left.interaction_id));
  })[0] || null;
}

async function getTenderDocumentsAndAnalysis(database, opportunityId) {
  const interactions = await must(database.from('psi_sales_interactions').select('id,notes,created_at,occurred_at').eq('opportunity_id', opportunityId).eq('interaction_type', 'documento').order('created_at', { ascending: true }));
  const documents = [];
  const analyses = [];
  const preparations = [];
  for (const row of interactions || []) {
    const payload = parseInteractionJson(row.notes);
    if (payload?.kind === 'tender_document_upload') documents.push(...(payload.documents || []).map(document => ({ ...document, interaction_id: row.id })));
    if (payload?.kind === 'tender_document_analysis') analyses.push({ ...payload, interaction_id: row.id, created_at: row.created_at || row.occurred_at || null });
    if (payload?.kind === 'tender_offer_preparation') preparations.push({
      ...payload,
      interaction_id: row.id,
      created_at: row.created_at || row.occurred_at || null,
      occurred_at: row.occurred_at || null,
    });
  }
  return {
    documents: documents.filter(document => document.current !== false),
    analyses,
    preparations,
    analysis: analyses.at(-1) || null,
    preparation: currentPreparation(preparations),
  };
}

async function rpc(database, name, args) {
  const { data, error } = await database.rpc(name, args);
  if (error) throw error;
  return data;
}

/** Authoritative, RPC-mediated tender decision path. Authorization precedes every database access. */
export async function callTenderGoNoGoDecision(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  const decision = String(input?.decision || '').trim();
  if (!new Set(['go', 'no_go']).has(decision)) throw goNoGoError('La decisión debe ser go o no_go.');
  const analysisRunId = nullableUuid(input?.analysis_run_id, 'un análisis válido')?.toLowerCase() || null;
  const justification = nullableText(input?.justification);
  requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);

  const { opportunity, tender } = await resolveTenderContext(database, opportunityId);
  const records = await getTenderDocumentsAndAnalysis(database, opportunityId);
  const availableAnalysis = await getCurrentTenderAnalysis(database, opportunityId);
  const effectiveAnalysis = availableAnalysis?.run_id === analysisRunId && availableAnalysis.status === 'completed'
    ? { ...(availableAnalysis.result || {}), ...availableAnalysis }
    : null;
  const preparation = decision === 'go'
    ? buildTenderOfferPreparation(opportunity, records.documents, effectiveAnalysis, currentProfile)
    : null;
  const result = await rpc(database, 'psi_record_tender_go_no_go', {
    p_opportunity_id: opportunityId,
    p_tender_id: tender.id,
    p_actor_id: actorId,
    p_decision: decision,
    p_analysis_run_id: analysisRunId,
    p_justification: justification,
    p_preparation: preparation,
  });
  const persistedPreparation = result.preparation_created
    ? preparation
    : (records.preparations || []).find(candidate => candidate.interaction_id === result.preparation_id) || null;
  return { decision: result, preparation: persistedPreparation };
}

function currentDecisionFromHistory(history) {
  const rows = history || [];
  const supersededIds = new Set(rows.map(row => row.supersedes_decision_id).filter(Boolean));
  return rows.find(row => !supersededIds.has(row.id)) || rows[0] || null;
}

/** Read-side companion; preparation is visible only while the current supersession leaf is GO. */
export async function getTenderGoNoGoDecision(database, opportunityId, currentProfile) {
  const id = requireUuid(opportunityId, 'una oportunidad válida');
  requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
  const { tender } = await resolveTenderContext(database, id);
  const [history, records] = await Promise.all([
    must(database.from('psi_tender_go_no_go_decisions').select('id,opportunity_id,tender_id,decision,analysis_interaction_id,analysis_run_id,justification,decided_by,decided_at,supersedes_decision_id,psi_sales_profiles(full_name)').eq('opportunity_id', id).eq('tender_id', tender.id).order('decided_at', { ascending: false }).order('id', { ascending: false })),
    getTenderDocumentsAndAnalysis(database, id),
  ]);
  const decision = currentDecisionFromHistory(history);
  return { decision, history: history || [], preparation: decision?.decision === 'go' ? records.preparation : null, analysis: await getCurrentTenderAnalysis(database, id) };
}

/** Shared gate for every preparation read/write path; NO_GO never reveals or mutates prior preparation. */
export async function requireTenderGoForPreparation(database, opportunityId, currentProfile) {
  const payload = await getTenderGoNoGoDecision(database, opportunityId, currentProfile);
  if (payload.decision?.decision !== 'go') throw goNoGoError('La preparación de oferta requiere una decisión GO vigente.', 409);
  return payload;
}
