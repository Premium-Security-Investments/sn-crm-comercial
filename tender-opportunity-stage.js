// Etapa derivada de una oportunidad de licitación para el backend: réplica exacta de `classifyOpportunityStage`
// (src/tenders/opportunityStage.ts, TypeScript del frontend) y del CASE de la migración 088. Una prueba de paridad
// (tests/tender-opportunity-stage-parity.test.mjs) las mantiene iguales.
//
//   1. 'cerradas': NO GO humano vigente, o estado de oferta terminal (cerrada_no_go, adjudicada, no_adjudicada).
//   2. 'por_decidir': sin decisión humana GO/NO GO (la recomendación del sistema nunca la sustituye).
//   3. 'en_curso': GO humano y no terminal.

export const TENDER_OPPORTUNITY_TERMINAL_OFFER_STATUSES = Object.freeze(['cerrada_no_go', 'adjudicada', 'no_adjudicada']);

export function classifyTenderOpportunityStage(row) {
  const status = String(row?.tender_offer_status || 'pendiente_decision');
  const rawDecision = row?.decision;
  const decision = rawDecision === 'go' || rawDecision === 'no_go' ? rawDecision : null;
  if (decision === 'no_go' || TENDER_OPPORTUNITY_TERMINAL_OFFER_STATUSES.includes(status)) return 'cerradas';
  if (!decision) return 'por_decidir';
  return 'en_curso';
}

/** Activa = "Por decidir" o "En curso" en la bandeja. */
export function isActiveTenderOpportunityStage(row) {
  return classifyTenderOpportunityStage(row) !== 'cerradas';
}

/** Decisión GO/NO GO vigente: la más reciente que ninguna otra reemplaza (misma regla que la migración 088). */
export function latestTenderGoNoGoDecision(decisions = []) {
  const superseded = new Set(decisions.map(row => row?.supersedes_decision_id).filter(Boolean));
  return [...decisions].filter(row => row && !superseded.has(row.id))
    .sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || '')) || String(b.id).localeCompare(String(a.id)))[0] || null;
}

// Etapas comerciales cerradas (migración 110): además de la etapa de la bandeja, una oportunidad así nunca es activa.
export const TENDER_OPPORTUNITY_CLOSED_COMMERCIAL_STAGES = new Set(['aprobado', 'descartado', 'perdido']);

/** Licitación convertida: la misma regla que el Radar (`internal_status`); una devuelta al Radar vuelve a ser fila normal. */
export function isConvertedTenderRow(row) {
  return row?.internal_status === 'convertida_oportunidad';
}

async function readOrThrow(promise, label) {
  const { data, error } = await promise;
  if (error) {
    const wrapped = new Error(`${label}: ${error.message || 'error de lectura'}`);
    wrapped.code = 'AGT002_PHASE_CHANGE_READ_FAILED';
    throw wrapped;
  }
  return data;
}

/**
 * Por qué una oportunidad de licitación NO es activa, o `null` si es activa (decisión del dueño, 2026-10-09: todo
 * proceso automático trata las no activas como si no existieran). Activa = etapa derivada "Por decidir" o "En curso" de
 * la bandeja (classifyTenderOpportunityStage con la decisión GO/NO GO vigente) y etapa comercial abierta. Sólo lee.
 */
export async function readTenderOpportunityInactiveReason(database, opportunityId, tenderId = null) {
  if (!opportunityId) return 'opportunity_missing';
  const opportunity = await readOrThrow(database.from('psi_sales_opportunities')
    .select('id,stage_code,tender_offer_status').eq('id', opportunityId).maybeSingle(), 'oportunidad');
  if (!opportunity) return 'opportunity_missing';
  if (TENDER_OPPORTUNITY_CLOSED_COMMERCIAL_STAGES.has(opportunity.stage_code)) return 'opportunity_closed';
  let decisions = database.from('psi_tender_go_no_go_decisions')
    .select('id,decision,decided_at,supersedes_decision_id').eq('opportunity_id', opportunityId);
  if (tenderId) decisions = decisions.eq('tender_id', tenderId);
  const latest = latestTenderGoNoGoDecision((await readOrThrow(decisions, 'decisión GO/NO GO')) || []);
  const stage = classifyTenderOpportunityStage({ decision: latest?.decision || null, tender_offer_status: opportunity.tender_offer_status });
  return stage === 'cerradas' ? 'opportunity_closed' : null;
}
