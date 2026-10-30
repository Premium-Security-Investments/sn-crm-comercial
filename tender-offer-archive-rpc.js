import { ACTIONS, requireAction } from './access-control.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARCHIVABLE_STATUSES = new Set(['en_preparacion', 'lista_para_presentar']);

function archiveError(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function uuid(value, label) { const id = String(value || '').trim(); if (!UUID_PATTERN.test(id)) throw archiveError('Debe indicar ' + label + '.'); return id; }
function note(value) { const text = String(value || '').trim().slice(0, 1200); if (!text) throw archiveError('Debe indicar por qué no nos presentamos.'); return text; }

export async function callTenderOpportunityArchive(database, input, currentProfile) {
  const opportunityId = uuid(input?.opportunity_id, 'una oportunidad válida');
  const actorId = uuid(currentProfile?.id, 'un actor válido');
  const expectedStatus = String(input?.expected_tender_offer_status || '').trim();
  if (!ARCHIVABLE_STATUSES.has(expectedStatus)) throw archiveError('Sólo se puede archivar antes de presentar la oferta.');
  requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);
  const { data, error } = await database.rpc('psi_archive_tender_opportunity', { p_opportunity_id: opportunityId, p_actor_id: actorId, p_note: note(input?.note), p_expected_tender_offer_status: expectedStatus });
  if (error) { if (error.code === '42501') error.status = 403; if (['40001', '23514', '23505'].includes(error.code)) error.status = 409; throw error; }
  return data;
}

export { ARCHIVABLE_STATUSES };
