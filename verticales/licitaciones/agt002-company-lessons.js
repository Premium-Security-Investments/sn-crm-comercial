// Lecciones de la empresa (encargo AGT-002 del 2026-11-06; migración 189). Reglas cortas que la empresa ya aprendió en
// un proceso y que Vig-IA recibe en cada análisis y en la Mesa. Se proponen (persona, AGT-002 o Vig-IA desde un acta) y
// sólo entran al prompt cuando Juan o Katherine las aprueban (permiso `licitaciones_lecciones`). Append-only: aprobar,
// descartar y retirar agregan una versión nueva. Si la 189 todavía no corrió, la lista sale vacía y proponer o decidir responde 503.

export const AGT002_LESSON_CATEGORIES = Object.freeze({
  sede_agencia: 'Sede o agencia',
  financiero: 'Financiero',
  precio: 'Precio',
  garantias_polizas: 'Garantías y pólizas',
  personal_habilitante: 'Personal habilitante',
  documentos_vigencias: 'Documentos y vigencias',
  rup_unspsc: 'RUP y UNSPSC',
  alianzas_ut: 'Alianzas y UT',
  cronograma: 'Cronograma',
  licencias: 'Licencias',
  competencia: 'Competencia',
  estrategia: 'Estrategia',
  otro: 'Otro',
});
export const AGT002_LESSON_SOURCE_KINDS = Object.freeze(['acta', 'proceso', 'handoff', 'carga_inicial']);
export const AGT002_LESSON_STATUSES = Object.freeze(['propuesta', 'activa', 'retirada', 'descartada']);

const LIMITS = Object.freeze({ statement: 500, rationale: 1200, how_to_apply: 800, source_ref: 400, reason: 1000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^L-[0-9]{2,4}$/;

function fail(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
const badRequest = message => fail(message, 400, 'AGT002_LESSON_BAD_REQUEST');

/** La 189 todavía no corrió (tabla, vista o función ausente). */
export function isLessonsMigrationMissing(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('42p01') || text.includes('42883') || text.includes('pgrst202') || text.includes('pgrst205')
    || text.includes('psi_tender_lessons') || text.includes('psi_propose_tender_lesson') || text.includes('psi_decide_tender_lesson');
}

function mapRpcError(error) {
  if (isLessonsMigrationMissing(error)) {
    return fail('Las lecciones todavía no están instaladas en la base.', 503, 'AGT002_LESSONS_NOT_INSTALLED');
  }
  const sqlCode = String(error?.code || '');
  const status = sqlCode === '42501' ? 403 : sqlCode === 'P0002' ? 404 : sqlCode === '23514' ? 409 : 400;
  return fail(error?.message || 'No fue posible registrar la lección.', status, 'AGT002_LESSON_REJECTED');
}

function text(value, field, { required = false } = {}) {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  if (required && !cleaned) throw badRequest(field === 'statement' ? 'Escriba la lección.' : `Falta ${field}.`);
  if (cleaned.length > LIMITS[field]) throw badRequest(`El campo ${field} supera ${LIMITS[field]} caracteres.`);
  return cleaned || null;
}

/** Normaliza una lección propuesta. */
export function parseAgt002LessonProposal(body) {
  const category = body?.category ?? 'otro';
  if (!Object.hasOwn(AGT002_LESSON_CATEGORIES, category)) throw badRequest('La categoría de la lección no es válida.');
  const sourceKind = body?.source_kind ?? 'proceso';
  if (!AGT002_LESSON_SOURCE_KINDS.includes(sourceKind)) throw badRequest('La fuente de la lección no es válida.');
  const opportunityId = body?.opportunity_id ?? null;
  if (opportunityId !== null && !UUID.test(String(opportunityId))) throw badRequest('La licitación de la lección no es válida.');
  return {
    statement: text(body?.statement, 'statement', { required: true }),
    rationale: text(body?.rationale, 'rationale'),
    how_to_apply: text(body?.how_to_apply, 'how_to_apply'),
    category,
    source_kind: sourceKind,
    source_ref: text(body?.source_ref, 'source_ref'),
    opportunity_id: opportunityId,
  };
}

/** Registra una lección en `propuesta`. `proposedByModel` marca las que redactó Vig-IA. */
export async function proposeAgt002Lesson(database, { actorId, body, proposedByModel = false }) {
  const payload = parseAgt002LessonProposal(body);
  const { data, error } = await database.rpc('psi_propose_tender_lesson', {
    p_actor_id: actorId, p_payload: payload, p_proposed_by_model: proposedByModel === true,
  });
  if (error) throw mapRpcError(error);
  return data;
}

/** Aprueba (`activa`), descarta una propuesta (`descartada`) o retira una activa (`retirada`, con motivo). */
export async function decideAgt002Lesson(database, { actorId, code, expectedVersion, status, reason = null }) {
  if (!CODE.test(String(code || ''))) throw badRequest('La lección no es válida.');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw badRequest('Falta la versión de la lección.');
  if (!['activa', 'retirada', 'descartada'].includes(status)) throw badRequest('Sólo se puede aprobar, descartar o retirar una lección.');
  const cleanedReason = text(reason, 'reason');
  if (status === 'retirada' && !cleanedReason) throw badRequest('Escriba por qué se retira la lección.');
  const { data, error } = await database.rpc('psi_decide_tender_lesson', {
    p_actor_id: actorId, p_code: code, p_expected_version: expectedVersion, p_status: status, p_reason: cleanedReason,
  });
  if (error) throw mapRpcError(error);
  return data;
}

const LIST_COLUMNS = 'id,code,version,status,statement,rationale,how_to_apply,category,source_kind,source_ref,opportunity_id,'
  + 'proposed_by_model,actor_id,reason,created_at,proposed_by,proposed_at';

/** Lecciones en su versión vigente, por código. `statuses` filtra; sin la 189 devuelve []. */
export async function listAgt002Lessons(database, { statuses = AGT002_LESSON_STATUSES } = {}) {
  const { data, error } = await database
    .from('psi_tender_lessons_current')
    .select(LIST_COLUMNS)
    .in('status', [...statuses])
    .order('code', { ascending: true });
  if (error) {
    if (isLessonsMigrationMissing(error)) return [];
    throw mapRpcError(error);
  }
  return data || [];
}
