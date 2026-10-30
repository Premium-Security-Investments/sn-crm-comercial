// AGT-002 — aclaraciones del encargado (Juan, 2026-10-21). En el mismo espacio que las preguntas a Vig-IA, antes y
// después del GO: una aclaración le resuelve una duda o le corrige algo a Vig-IA. Queda registrada con autor y fecha
// (psi_agt002_clarifications, migración 141; sólo se agregan), opcionalmente ligada a un requisito o un hallazgo, y pide
// el reanálisis INCREMENTAL a nombre de quien la escribe: Vig-IA actualiza el análisis sólo en lo que la aclaración toca.

import { requestAgt002ManualReanalysis } from './agt002-manual-reanalysis.js';

const TARGET_KINDS = new Set(['requirement', 'finding']);
const MAX_CONTENT = 4000;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'AGT002_CLARIFICATION_BAD_REQUEST';
  return error;
}

function mapRpcError(error) {
  const wrapped = new Error(error?.message || 'No fue posible registrar la aclaración.');
  wrapped.status = ['23514', 'P0002'].includes(String(error?.code)) ? 409 : String(error?.code) === '42501' ? 403 : 400;
  wrapped.code = 'AGT002_CLARIFICATION_REJECTED';
  return wrapped;
}

/** Normaliza el cuerpo de una aclaración; el punto es opcional, pero si viene, viene completo. */
export function parseAgt002ClarificationBody(body) {
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!content) throw badRequest('Escriba la aclaración.');
  if (content.length > MAX_CONTENT) throw badRequest(`La aclaración supera ${MAX_CONTENT} caracteres.`);
  const targetKind = body?.target_kind ?? null;
  if (targetKind !== null && !TARGET_KINDS.has(targetKind)) throw badRequest('El punto de la aclaración no es válido.');
  const targetId = targetKind ? String(body?.target_id || '').trim().slice(0, 200) : null;
  if (targetKind && !targetId) throw badRequest('Falta el punto al que se refiere la aclaración.');
  const targetLabel = targetKind ? String(body?.target_label || '').trim().slice(0, 400) || null : null;
  return { content, targetKind, targetId, targetLabel };
}

/** Registra la aclaración y pide el incremental. La solicitud nunca hace fallar el registro. */
export async function recordAgt002Clarification(database, { opportunityId, actorId, body, request = requestAgt002ManualReanalysis }) {
  const { content, targetKind, targetId, targetLabel } = parseAgt002ClarificationBody(body);
  const { data, error } = await database.rpc('psi_record_agt002_clarification', {
    p_opportunity_id: opportunityId, p_actor_id: actorId, p_content: content,
    p_target_kind: targetKind, p_target_id: targetId, p_target_label: targetLabel,
  });
  if (error) throw mapRpcError(error);
  let analysisRequest;
  try {
    const requested = await request(database, { opportunityId, requestedBy: actorId, mode: 'incremental' });
    analysisRequest = { requested: requested.requested, already_open: requested.alreadyOpen, state: requested.status?.state || null };
  } catch (requestError) {
    analysisRequest = { requested: false, reason: requestError?.reason || null, message: String(requestError?.message || 'No fue posible pedir el análisis.').slice(0, 300) };
  }
  return { clarification: data, analysis_request: analysisRequest };
}

/** Las aclaraciones de una licitación, de la más antigua a la más reciente, con el nombre de quien las escribió. */
export async function listAgt002Clarifications(database, opportunityId) {
  const { data, error } = await database
    .from('psi_agt002_clarifications')
    .select('id,content,target_kind,target_id,target_label,created_at,author:psi_sales_profiles(full_name)')
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: true });
  if (error) {
    const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
    if (message.includes('42p01') || message.includes('pgrst205') || message.includes('psi_agt002_clarifications')) return [];
    throw mapRpcError(error);
  }
  return (data || []).map(row => ({
    id: row.id, content: row.content, target_kind: row.target_kind, target_id: row.target_id, target_label: row.target_label,
    created_at: row.created_at, author_name: row.author?.full_name || null,
  }));
}
