// Frontera de dominio entre agentes (catálogo institucional SIIO): AGT-003 Vig-IA Comercial trabaja el pipeline
// comercial privado; las licitaciones públicas convertidas en oportunidad pertenecen a AGT-002 Vig-IA Licitaciones,
// que tiene su propio proceso (documentos, análisis inicial, decisión). Sus valores son de otra escala (miles de
// millones) y, mezclados, deforman pipeline, forecast, rankings y alertas comerciales.
//
// Esta es la única regla para decidir a qué agente pertenece una oportunidad. La usan la API de prioridades de
// AGT-003 (servidor) y los tableros comerciales (cliente), para que ambos cuenten el mismo universo.

export const AGT002_TENDER_SERVICE_TYPE = 'licitacion_publica';

/** La oportunidad es una licitación pública: dominio de AGT-002, fuera de las métricas comerciales. */
export function isPublicTenderOpportunity(opportunity) {
  return opportunity?.service_type_code === AGT002_TENDER_SERVICE_TYPE;
}

/** La oportunidad pertenece al pipeline comercial privado de AGT-003. */
export function isAgt003CommercialOpportunity(opportunity) {
  return Boolean(opportunity) && !isPublicTenderOpportunity(opportunity);
}

/** Separa un conjunto de oportunidades en comercial (AGT-003) y licitaciones (AGT-002), sin mutar la entrada. */
export function splitByAgentDomain(opportunities = []) {
  const commercial = [];
  const tenders = [];
  for (const opportunity of Array.isArray(opportunities) ? opportunities : []) {
    if (isPublicTenderOpportunity(opportunity)) tenders.push(opportunity);
    else if (opportunity) commercial.push(opportunity);
  }
  return { commercial, tenders };
}
