import { buildClosureActaInput, closureActaContextFromAnalysis } from './agt002-closure-acta-draft.js';

// Recorre las licitaciones ya cerradas que todavía no tienen acta y le pide a
// Vig-IA el borrador, a partir de la nota con la que la persona cerró. Cada
// licitación falla por separado: un borrador que no sale no corta los demás.
// El acta queda en 'borrador'; confirmarla es un acto humano que la base de
// datos no le permite a Vig-IA.
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;

function boundedLimit(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export async function runAgt002ClosureActaDrafts(database, {
  drafter,
  agentId,
  limit = DEFAULT_LIMIT,
  log = () => {},
} = {}) {
  if (!database || typeof database.rpc !== 'function') throw new Error('El acta de cierre requiere una conexión a la base.');
  if (!drafter || typeof drafter.draft !== 'function') throw new Error('El acta de cierre requiere un redactor configurado.');
  if (!agentId || !String(agentId).trim()) throw new Error('El acta de cierre requiere la identidad de Vig-IA.');

  const { data: pending, error } = await database.rpc('psi_list_tender_closure_acta_pending', { p_limit: boundedLimit(limit) });
  if (error) throw error;
  const rows = Array.isArray(pending) ? pending : [];
  if (rows.length === 0) {
    log({ event: 'agt002_closure_acta_nothing_pending' });
    return { pending: 0, drafted: 0, failed: 0, results: [] };
  }

  const results = [];
  for (const row of rows) {
    const opportunityId = row?.opportunity_id;
    try {
      const input = buildClosureActaInput({
        opportunityId,
        tenderName: row?.tender_name,
        closureKind: row?.closure_kind,
        closingNote: row?.closing_note,
        context: closureActaContextFromAnalysis(row?.analysis_result),
      });
      const acta = await drafter.draft(input);
      const { error: writeError } = await database.rpc('psi_upsert_tender_closure_acta', {
        p_opportunity_id: opportunityId,
        p_actor_id: agentId,
        p_payload: acta,
        p_expected_updated_at: null,
      });
      if (writeError) throw writeError;
      results.push({ opportunityId, status: 'drafted' });
      log({
        event: 'agt002_closure_acta_drafted',
        opportunity_id: opportunityId,
        closure_kind: row?.closure_kind,
        reasons: acta.reasons.length,
        requirements_unmet: acta.requirements_unmet.length,
        context_entries: input.context.length,
      });
    } catch (cause) {
      results.push({ opportunityId, status: 'failed', code: cause?.code || null });
      // Nunca se registra el contenido del acta ni el del modelo: sólo el código de la falla.
      log({ event: 'agt002_closure_acta_failed', opportunity_id: opportunityId, code: cause?.code || null, message: String(cause?.message || '').slice(0, 300) });
    }
  }

  const drafted = results.filter(result => result.status === 'drafted').length;
  log({ event: 'agt002_closure_acta_run', pending: rows.length, drafted, failed: results.length - drafted });
  return { pending: rows.length, drafted, failed: results.length - drafted, results };
}

export { DEFAULT_LIMIT as AGT002_CLOSURE_ACTA_DEFAULT_LIMIT, MAX_LIMIT as AGT002_CLOSURE_ACTA_MAX_LIMIT };
