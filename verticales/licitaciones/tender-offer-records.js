// Ofertas presentadas y su resultado (encargo AGT-002 del 2026-11-07; migración 191). Registrar «presentada» con
// evidencia aunque el expediente del CRM no esté completo, registrar el resultado, medir el valor concursado contra la
// meta anual y avisar cuando pasa un cierre con GO sin registro. Sin la 191, leer devuelve vacío y escribir responde 503.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TENDER_OFFER_RESULTS = Object.freeze({ ganada: 'Ganada', perdida: 'Perdida', rechazada: 'Rechazada', desierta: 'Desierta' });
export const TENDER_OFFER_RESULT_SOURCES = Object.freeze({ informe_evaluacion: 'Informe de evaluación', acto_adjudicacion: 'Acto de adjudicación', otro: 'Otra fuente' });

function fail(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}
const badRequest = message => fail(message, 400, 'TENDER_OFFER_RECORD_BAD_REQUEST');

export function isOfferRecordsMigrationMissing(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('42p01') || text.includes('42883') || text.includes('pgrst202') || text.includes('pgrst205')
    || text.includes('psi_tender_offer_submissions') || text.includes('psi_tender_offer_results') || text.includes('psi_tender_offer_goals')
    || text.includes('psi_register_tender_offer');
}

function mapRpcError(error) {
  if (isOfferRecordsMigrationMissing(error)) return fail('El registro de ofertas todavía no está instalado en la base.', 503, 'TENDER_OFFER_RECORDS_NOT_INSTALLED');
  const sql = String(error?.code || '');
  const status = sql === '42501' ? 403 : sql === 'P0002' ? 404 : ['23514', '23505', '40001'].includes(sql) ? 409 : 400;
  return fail(error?.message || 'No fue posible registrar la oferta.', status, 'TENDER_OFFER_RECORD_REJECTED');
}

const clean = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const https = value => { const url = clean(value, 2000); if (url && !/^https:\/\//i.test(url)) throw badRequest('El enlace debe empezar por https://.'); return url; };
const integer = (value, label) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`${label} debe ser un número entero mayor que cero.`);
  return n;
};

/** Cuerpo de «presentada» / «no presentada». */
export function parseTenderOfferSubmission(body) {
  const kind = body?.kind;
  if (kind !== 'presentada' && kind !== 'no_presentada') throw badRequest('Indique si la oferta se presentó o no.');
  if (kind === 'no_presentada') {
    const reason = clean(body?.reason, 2000);
    if (!reason) throw badRequest('Diga por qué no se presentó.');
    return { kind, reason };
  }
  const filingReference = clean(body?.filing_reference, 120);
  if (!filingReference) throw badRequest('Falta el número de radicado o RPL.');
  const submittedAt = clean(body?.submitted_at, 40);
  if (!submittedAt || Number.isNaN(new Date(submittedAt).getTime())) throw badRequest('Falta la fecha y hora de radicación.');
  const evidenceUrl = https(body?.evidence_url);
  if (!evidenceUrl) throw badRequest('Falta el enlace al PDF o a lo radicado.');
  return { kind, filing_reference: filingReference, submitted_at: new Date(submittedAt).toISOString(), evidence_url: evidenceUrl };
}

/** Cuerpo del resultado. */
export function parseTenderOfferResult(body) {
  const result = body?.result;
  if (!Object.hasOwn(TENDER_OFFER_RESULTS, result || '')) throw badRequest('El resultado no es válido.');
  const sourceKind = body?.source_kind;
  if (!Object.hasOwn(TENDER_OFFER_RESULT_SOURCES, sourceKind || '')) throw badRequest('Diga de dónde sale el resultado.');
  const sourceUrl = https(body?.source_url);
  const sourceNote = clean(body?.source_note, 2000);
  if (!sourceUrl && !sourceNote) throw badRequest('Falta el enlace o la referencia de la fuente.');
  let awardedValue = null;
  if (body?.awarded_value !== null && body?.awarded_value !== undefined && body?.awarded_value !== '') {
    // Pesos colombianos: el punto separa miles y la coma, decimales («$ 8.440.291.324»). Un número JSON va tal cual.
    awardedValue = typeof body.awarded_value === 'number' ? body.awarded_value : Number(String(body.awarded_value).replace(/[^\d,]/g, '').replace(',', '.'));
    if (!Number.isFinite(awardedValue) || awardedValue <= 0) throw badRequest('El valor adjudicado no es válido.');
  }
  if (result === 'ganada' && awardedValue === null) throw badRequest('Falta el valor adjudicado.');
  return {
    result, source_kind: sourceKind, source_url: sourceUrl, source_note: sourceNote,
    rank: integer(body?.rank, 'El puesto'), bidders: integer(body?.bidders, 'El número de oferentes'),
    awarded_value: result === 'ganada' ? awardedValue : null,
  };
}

function opportunity(id) {
  if (!UUID.test(String(id || ''))) throw badRequest('Debe indicar la licitación.');
  return id;
}

export async function registerTenderOfferSubmission(database, { opportunityId, actorId, body }) {
  const payload = parseTenderOfferSubmission(body);
  const { data, error } = await database.rpc('psi_register_tender_offer_submission', { p_opportunity_id: opportunity(opportunityId), p_actor_id: actorId, p_payload: payload });
  if (error) throw mapRpcError(error);
  return data;
}

export async function registerTenderOfferResult(database, { opportunityId, actorId, body }) {
  const payload = parseTenderOfferResult(body);
  const { data, error } = await database.rpc('psi_register_tender_offer_result', { p_opportunity_id: opportunity(opportunityId), p_actor_id: actorId, p_payload: payload });
  if (error) throw mapRpcError(error);
  return data;
}

async function optional(query) {
  const { data, error } = await query;
  if (error) {
    if (isOfferRecordsMigrationMissing(error)) return [];
    throw error;
  }
  return data || [];
}

/** Lo registrado de una licitación: presentación y resultado, o nulos. */
export async function loadTenderOfferRecord(database, opportunityId) {
  const [submissions, results] = await Promise.all([
    optional(database.from('psi_tender_offer_submissions').select('*').eq('opportunity_id', opportunity(opportunityId))),
    optional(database.from('psi_tender_offer_results').select('*').eq('opportunity_id', opportunityId)),
  ]);
  return { submission: submissions[0] || null, result: results[0] || null };
}

const bogotaMonth = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).format(date);
};

/**
 * Indicadores por mes y en lo que va del año (hora de Colombia). Puro: recibe filas y devuelve números.
 * - calificadas: licitaciones que pasaron a Oportunidades (creadas en el mes);
 * - go: decisiones GO vigentes;
 * - presentadas y valor concursado (presupuesto oficial del proceso);
 * - adjudicadas y valor adjudicado;
 * - meta: la más reciente del año y el avance del valor concursado contra ella.
 */
export function buildTenderOfferIndicators({ year, now = new Date(), opportunities = [], goDecisions = [], submissions = [], results = [], tenderValues = {}, goals = [] }) {
  const y = String(year);
  const currentMonth = bogotaMonth(now);
  const lastMonth = currentMonth && currentMonth.startsWith(y) ? Number(currentMonth.slice(5, 7)) : 12;
  const months = Array.from({ length: lastMonth }, (_, i) => ({ month: `${y}-${String(i + 1).padStart(2, '0')}`, calificadas: 0, go: 0, presentadas: 0, valor_concursado: 0, adjudicadas: 0, valor_adjudicado: 0 }));
  const at = value => months.find(row => row.month === bogotaMonth(value)) || null;
  for (const row of opportunities) { const m = at(row.created_at); if (m) m.calificadas += 1; }
  for (const row of goDecisions) { const m = at(row.decided_at); if (m) m.go += 1; }
  for (const row of submissions) {
    if (row.kind !== 'presentada') continue;
    const m = at(row.submitted_at);
    if (!m) continue;
    m.presentadas += 1;
    m.valor_concursado += Number(tenderValues[row.opportunity_id]) || 0;
  }
  for (const row of results) {
    if (row.result !== 'ganada') continue;
    const m = at(row.created_at);
    if (!m) continue;
    m.adjudicadas += 1;
    m.valor_adjudicado += Number(row.awarded_value) || 0;
  }
  const ytd = months.reduce((acc, row) => {
    for (const key of ['calificadas', 'go', 'presentadas', 'valor_concursado', 'adjudicadas', 'valor_adjudicado']) acc[key] += row[key];
    return acc;
  }, { calificadas: 0, go: 0, presentadas: 0, valor_concursado: 0, adjudicadas: 0, valor_adjudicado: 0 });
  const goal = [...goals].filter(row => Number(row.year) === Number(year)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  const target = goal ? Number(goal.target_value) : null;
  return {
    year: Number(year), months, ytd,
    goal: target ? { target_value: target, progress: Math.round((ytd.valor_concursado / target) * 1000) / 10 } : null,
  };
}

/**
 * Procesos con GO vigente cuyo cierre ya pasó (fecha de Colombia) y sin registro de si se presentaron o no.
 * `processes`: [{ opportunity_id, entity, ref, close_date: 'YYYY-MM-DD', offer_status, archived }].
 */
export function pendingSubmissionReminders({ processes = [], goOpportunityIds = new Set(), submittedOpportunityIds = new Set(), today }) {
  return processes
    .filter(row => row.close_date && row.close_date < today && !row.archived
      && goOpportunityIds.has(row.opportunity_id) && !submittedOpportunityIds.has(row.opportunity_id)
      && ['en_preparacion', 'lista_para_presentar'].includes(row.offer_status))
    .map(row => ({ opportunity_id: row.opportunity_id, entity: row.entity, ref: row.ref, close_date: row.close_date }))
    .sort((a, b) => a.close_date.localeCompare(b.close_date));
}

/** GO vigente por oportunidad (la última decisión no reemplazada). */
export function currentGoDecisions(decisions = []) {
  const superseded = new Set(decisions.map(row => row.supersedes_decision_id).filter(Boolean));
  const latest = new Map();
  for (const row of decisions) {
    if (superseded.has(row.id)) continue;
    const previous = latest.get(row.opportunity_id);
    if (!previous || String(row.decided_at) > String(previous.decided_at)) latest.set(row.opportunity_id, row);
  }
  return [...latest.values()].filter(row => row.decision === 'go');
}

export async function loadTenderOfferRows(database) {
  const [submissions, results, goals] = await Promise.all([
    optional(database.from('psi_tender_offer_submissions').select('opportunity_id,kind,submitted_at,created_at')),
    optional(database.from('psi_tender_offer_results').select('opportunity_id,result,awarded_value,created_at')),
    optional(database.from('psi_tender_offer_goals').select('year,target_value,created_at')),
  ]);
  return { submissions, results, goals };
}
