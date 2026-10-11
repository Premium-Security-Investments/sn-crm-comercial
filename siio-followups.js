// AGT-001 / Gerencia: Seguimiento gerencial.
// Compromisos con responsable (persona o área escrita por nombre), fecha y origen.
// Decisiones de Juan (2026-10-11): ven dueños (admin, gerencia), el directivo de solo consulta y la Junta;
// crean dueños y Junta; cierran y editan sólo los dueños. Los directivos siguen fuera del SIIO hasta que
// exista la regla de área. El cierre automático sólo ocurre cuando un dato del CRM lo comprueba.

export const FOLLOWUP_TABLE = 'siio_followups';
export const FOLLOWUP_ORIGINS = Object.freeze(['licitacion', 'oportunidad', 'finanzas', 'recomendacion_ia', 'junta', 'reunion', 'otro']);
export const FOLLOWUP_AUTO_RULES = Object.freeze({
  licitacion: ['tender_decision', 'tender_status'],
  oportunidad: ['opportunity_activity'],
});

const VIEW_ROLES = new Set(['admin', 'gerencia', 'consulta', 'junta']);
const CREATE_ROLES = new Set(['admin', 'gerencia', 'junta']);
const EDIT_ROLES = new Set(['admin', 'gerencia']);
const SUBMITTED_TENDER_STATUSES = new Set(['presentada', 'adjudicada', 'no_adjudicada']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function forbidden(message = 'Tu perfil no puede realizar esta acción en Seguimiento gerencial.') {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function followupPermissions(role) {
  return { view: VIEW_ROLES.has(role), create: CREATE_ROLES.has(role), edit: EDIT_ROLES.has(role) };
}

export function requireFollowupPermission(profile, operation) {
  if (!profile?.id || !followupPermissions(profile.role)[operation]) throw forbidden();
}

function text(value, { field, min = 0, max }) {
  const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (clean.length < min) throw invalid(`${field}: dato obligatorio.`);
  if (clean.length > max) throw invalid(`${field}: máximo ${max} caracteres.`);
  return clean || null;
}

function isoDate(value, field) {
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw invalid(`${field}: fecha inválida (AAAA-MM-DD).`);
  return value;
}

export function cleanFollowupInput(body = {}) {
  const originType = FOLLOWUP_ORIGINS.includes(body.origin_type) ? body.origin_type : null;
  if (!originType) throw invalid('Origen inválido.');
  const originRef = text(body.origin_ref, { field: 'Referencia de origen', max: 120 });
  const autoRule = body.auto_rule ?? null;
  if (autoRule !== null && !(FOLLOWUP_AUTO_RULES[originType] || []).includes(autoRule)) throw invalid('Regla de cierre automático no válida para este origen.');
  if (autoRule && !originRef) throw invalid('El cierre automático requiere el registro de origen.');
  return {
    title: text(body.title, { field: 'Qué', min: 3, max: 300 }),
    owner_label: text(body.owner_label, { field: 'Responsable', min: 2, max: 120 }),
    due_date: isoDate(body.due_date, 'Fecha compromiso'),
    origin_type: originType,
    origin_ref: originRef,
    origin_label: text(body.origin_label, { field: 'Origen', max: 300 }),
    auto_rule: autoRule,
  };
}

export async function createFollowup(db, body, profile, now = new Date()) {
  requireFollowupPermission(profile, 'create');
  const row = { ...cleanFollowupInput(body), created_by: profile.id, created_role: profile.role, created_at: now.toISOString(), updated_at: now.toISOString() };
  const { data, error } = await db.from(FOLLOWUP_TABLE).insert(row).select('*').single();
  if (error) throw error;
  return data;
}

// Owner actions: mark done, cancel, reopen, add a progress note or adjust what/who/when.
export async function updateFollowup(db, id, body = {}, profile, now = new Date()) {
  requireFollowupPermission(profile, 'edit');
  const { data: current, error: readError } = await db.from(FOLLOWUP_TABLE).select('*').eq('id', id).single();
  if (readError) throw readError;
  if (!current) throw invalid('Seguimiento no encontrado.');
  const stamp = now.toISOString();
  const patch = { updated_at: stamp };
  const note = text(body.note, { field: 'Nota', max: 1000 });
  if (note) patch.notes = [...(Array.isArray(current.notes) ? current.notes : []), { at: stamp, by: profile.id, text: note }];
  if (body.action === 'cumplir' || body.action === 'cancelar') {
    if (current.status !== 'abierto') throw invalid('El seguimiento ya está cerrado.');
    Object.assign(patch, { status: body.action === 'cumplir' ? 'cumplido' : 'cancelado', closed_at: stamp, closed_by: profile.id, close_reason: body.action === 'cumplir' ? 'manual' : 'cancelado', close_evidence: null });
  } else if (body.action === 'reabrir') {
    Object.assign(patch, { status: 'abierto', closed_at: null, closed_by: null, close_reason: null, close_evidence: null });
  } else if (body.action === 'editar') {
    if (body.title !== undefined) patch.title = text(body.title, { field: 'Qué', min: 3, max: 300 });
    if (body.owner_label !== undefined) patch.owner_label = text(body.owner_label, { field: 'Responsable', min: 2, max: 120 });
    if (body.due_date !== undefined) patch.due_date = isoDate(body.due_date, 'Fecha compromiso');
  } else if (body.action !== undefined && body.action !== 'nota') {
    throw invalid('Acción no válida.');
  }
  if (Object.keys(patch).length === 1) throw invalid('No hay cambios para guardar.');
  const { data, error } = await db.from(FOLLOWUP_TABLE).update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

// Pure: which open follow-ups the CRM already proves done, with the evidence shown to the reader.
export function followupsToAutoClose(followups, { decisions = [], opportunities = [] } = {}) {
  const decisionsByOpportunity = new Map();
  for (const decision of decisions) {
    const list = decisionsByOpportunity.get(decision.opportunity_id) || [];
    list.push(decision);
    decisionsByOpportunity.set(decision.opportunity_id, list);
  }
  const opportunityById = new Map(opportunities.map(item => [item.id, item]));
  const closes = [];
  for (const item of followups) {
    if (item.status !== 'abierto' || !item.auto_rule || !item.origin_ref) continue;
    const createdAt = Date.parse(item.created_at);
    const opportunity = opportunityById.get(item.origin_ref);
    if (item.auto_rule === 'tender_decision') {
      const decision = (decisionsByOpportunity.get(item.origin_ref) || []).find(row => Date.parse(row.decided_at) >= createdAt);
      if (decision) closes.push({ id: item.id, evidence: `Decisión registrada en el CRM: ${decision.decision === 'go' ? 'presentarse' : 'no presentarse'} (${String(decision.decided_at).slice(0, 10)}).` });
    } else if (item.auto_rule === 'tender_status') {
      const decided = (decisionsByOpportunity.get(item.origin_ref) || []).some(row => row.decision === 'no_go' && Date.parse(row.decided_at) >= createdAt);
      if (opportunity && SUBMITTED_TENDER_STATUSES.has(opportunity.tender_offer_status)) closes.push({ id: item.id, evidence: `Estado actualizado en el CRM: ${opportunity.tender_offer_status.replace('_', ' ')}.` });
      else if (decided) closes.push({ id: item.id, evidence: 'Se registró en el CRM la decisión de no presentarse.' });
    } else if (item.auto_rule === 'opportunity_activity') {
      const last = opportunity?.last_interaction_at ? Date.parse(opportunity.last_interaction_at) : NaN;
      if (Number.isFinite(last) && last >= createdAt) closes.push({ id: item.id, evidence: `Nueva actividad registrada en el CRM el ${opportunity.last_interaction_at.slice(0, 10)}.` });
    }
  }
  return closes;
}

async function applyAutoClose(db, followups, now) {
  const refs = [...new Set(followups.filter(item => item.status === 'abierto' && item.auto_rule && item.origin_ref).map(item => item.origin_ref))];
  if (!refs.length) return followups;
  const [decisions, opportunities] = await Promise.all([
    db.from('psi_tender_go_no_go_decisions').select('opportunity_id,decision,decided_at').in('opportunity_id', refs),
    db.from('psi_sales_opportunities').select('id,tender_offer_status,last_interaction_at').in('id', refs),
  ]);
  if (decisions.error) throw decisions.error;
  if (opportunities.error) throw opportunities.error;
  const closes = followupsToAutoClose(followups, { decisions: decisions.data || [], opportunities: opportunities.data || [] });
  if (!closes.length) return followups;
  const stamp = now.toISOString();
  const closed = new Map();
  for (const close of closes) {
    // Only rows still open are touched, so a manual close in between is never overwritten.
    const { data, error } = await db.from(FOLLOWUP_TABLE)
      .update({ status: 'cumplido', closed_at: stamp, closed_by: null, close_reason: 'automatico', close_evidence: close.evidence, updated_at: stamp })
      .eq('id', close.id).eq('status', 'abierto').select('*');
    if (error) throw error;
    if (data?.[0]) closed.set(close.id, data[0]);
  }
  return followups.map(item => closed.get(item.id) || item);
}

export async function listFollowups(db, profile, now = new Date()) {
  requireFollowupPermission(profile, 'view');
  const { data, error } = await db.from(FOLLOWUP_TABLE).select('*').order('due_date', { ascending: true }).limit(500);
  if (error) throw error;
  const rows = await applyAutoClose(db, data || [], now);
  return { followups: rows, permissions: followupPermissions(profile.role), today: now.toISOString().slice(0, 10) };
}
