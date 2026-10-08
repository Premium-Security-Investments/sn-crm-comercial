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
