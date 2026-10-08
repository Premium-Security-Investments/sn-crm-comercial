import { ACTIONS, requireAction } from './access-control.js';

export async function requireAuthorizedLicitacionesAnalysisActor({
  database,
  opportunityId,
  profile,
  ensureOpportunityAccess,
}) {
  if (!profile || profile.identity_type === 'agent' || (profile.identity_type != null && profile.identity_type !== 'human')
    || profile.active !== true || typeof profile.id !== 'string' || !profile.id.trim()) {
    const error = new Error('La señal incremental requiere una persona activa de Licitaciones.');
    error.status = 403;
    error.code = 'AGT002_INCREMENTAL_ACTOR_UNAUTHORIZED';
    throw error;
  }
  if (typeof ensureOpportunityAccess !== 'function') throw new Error('Falta el verificador de acceso a la oportunidad.');
  const opportunity = await ensureOpportunityAccess(database, opportunityId, profile);
  try {
    requireAction(profile, ACTIONS.AI_ANALYSIS_RUN);
  } catch {
    const error = new Error('La persona no conserva autoridad vigente para ejecutar análisis de Licitaciones.');
    error.status = 403;
    error.code = 'AGT002_INCREMENTAL_ACTOR_UNAUTHORIZED';
    throw error;
  }
  return opportunity;
}
