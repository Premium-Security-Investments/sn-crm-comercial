import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function sendError(res, error, status = 500) {
  console.error(error);
  res.status(status).json({ error: error?.message || String(error) });
}

async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function requireDb() {
  if (!db) throw new Error('Server environment is missing Supabase credentials.');
  return db;
}


const managementRoles = ['director','gerencia','admin'];
function isManager(profile) { return managementRoles.includes(profile?.role); }
function canManageUsers(profile) { return profile?.role === 'admin'; }
function normalizeUserRole(value) {
  const raw = String(value || 'comercial').trim().toLowerCase();
  if (raw === 'directivo') return 'director';
  return raw;
}
function getBearerToken(req) {
  const raw = req.headers.authorization || '';
  const match = String(raw).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
async function getAuthContext(req) {
  const database = requireDb();
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error('Debe iniciar sesión.');
    error.status = 401;
    throw error;
  }
  const { data: userData, error: userError } = await database.auth.getUser(token);
  if (userError || !userData?.user?.email) {
    const error = new Error('Sesión inválida o vencida.');
    error.status = 401;
    throw error;
  }
  const email = userData.user.email.toLowerCase();
  const profile = await must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active').ilike('microsoft_email', email).eq('active', true).single());
  if (!profile) {
    const error = new Error('El usuario no tiene perfil comercial activo.');
    error.status = 403;
    throw error;
  }
  return { user: userData.user, profile, token };
}
function sendAuthError(res, error) {
  sendError(res, error, error?.status || 500);
}
function getPublicAppUrl(req) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (configured) return configured.startsWith('http') ? configured : `https://${configured}`;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host && String(host).includes('localhost') ? 'http' : 'https');
  return host ? `${proto}://${host}` : 'https://seguridad-nacional-crm.vercel.app';
}
function recomputeSummary(stages, opportunities) {
  return stages.map(stage => {
    const rows = opportunities.filter(o => o.stage_code === stage.code);
    return {
      stage_code: stage.code,
      stage_name: stage.name,
      stage_order: stage.stage_order,
      opportunities_count: rows.length,
      total_offer_value: rows.reduce((sum, o) => sum + Number(o.offer_value || 0), 0),
      weighted_pipeline_value: rows.reduce((sum, o) => sum + Number(o.weighted_pipeline_value || 0), 0)
    };
  });
}
function filterBootstrapForProfile(payload, currentProfile) {
  const manager = isManager(currentProfile);
  const opportunities = manager ? payload.opportunities : payload.opportunities.filter(o => o.owner_id === currentProfile.id);
  const stages = payload.stages;
  const summary = manager ? payload.summary : recomputeSummary(stages, opportunities);
  const stalled = manager ? payload.stalled : payload.stalled.filter(o => o.owner_id === currentProfile.id);
  const topClosing = manager ? payload.topClosing : payload.topClosing.filter(o => o.owner_id === currentProfile.id);
  const monthlyKpis = manager ? payload.monthlyKpis : payload.monthlyKpis.filter(k => k.owner_id === currentProfile.id);
  const goals = manager ? payload.goals : payload.goals.filter(g => !g.user_id || g.user_id === currentProfile.id);
  const profiles = manager ? payload.profiles : payload.profiles.filter(p => p.id === currentProfile.id);
  const totals = opportunities.reduce((acc, o) => {
    acc.count += 1;
    acc.pipeline += Number(o.offer_value || 0);
    acc.weighted += Number(o.weighted_pipeline_value || 0);
    if (o.stage_code === 'aprobado') acc.approved += Number(o.offer_value || 0);
    return acc;
  }, { count: 0, pipeline: 0, weighted: 0, approved: 0 });
  return { ...payload, summary, opportunities, profiles, stalled, topClosing, monthlyKpis, goals, totals, currentProfile };
}
async function ensureOpportunityAccess(database, id, profile) {
  const opportunity = await must(database.from('psi_sales_opportunities').select('id,owner_id').eq('id', id).single());
  if (!isManager(profile) && opportunity.owner_id !== profile.id) {
    const error = new Error('No tiene permisos sobre esta oportunidad.');
    error.status = 403;
    throw error;
  }
  return opportunity;
}

const opportunitySelect = '*';


const tenderSources = {
  'SECOP II': {
    base: 'https://www.datos.gov.co/resource/p6dx-8zbt.json',
    dateField: 'fecha_de_publicacion_del',
    select: 'entidad,departamento_entidad,ciudad_entidad,id_del_proceso,referencia_del_proceso,nombre_del_procedimiento,descripci_n_del_procedimiento,fase,estado_del_procedimiento,fecha_de_publicacion_del,fecha_de_recepcion_de,precio_base,codigo_principal_de_categoria,urlproceso',
    nameFields: ['nombre_del_procedimiento','descripci_n_del_procedimiento']
  },
  'SECOP I': {
    base: 'https://www.datos.gov.co/resource/f789-7hwg.json',
    dateField: 'fecha_de_cargue_en_el_secop',
    select: 'nombre_entidad,departamento_entidad,municipio_entidad,numero_de_proceso,objeto_a_contratar,detalle_del_objeto_a_contratar,estado_del_proceso,fecha_de_cargue_en_el_secop,cuantia_proceso,ruta_proceso_en_secop_i',
    nameFields: ['objeto_a_contratar','detalle_del_objeto_a_contratar']
  }
};
const tenderPositiveTerms = {
  'vigilancia y seguridad privada': 45, 'servicio de vigilancia': 40, 'vigilancia armada': 38, 'vigilancia privada': 38,
  'seguridad privada': 35, 'seguridad electronica': 35, 'seguridad electrónica': 35, 'cctv': 35,
  'videovigilancia': 35, 'video vigilancia': 35, 'control de acceso': 30, 'biometrico': 22, 'biométrico': 22,
  'alarma': 22, 'monitoreo': 22, 'circuito cerrado': 30, 'guardas': 28, 'cedi': 20, 'bodega': 10
};
const tenderNegativeTerms = { 'tecnovigilancia': 65, 'interventoria': 60, 'interventoría': 60, 'enfermera': 45, 'alimentacion': 25, 'aseo': 20, 'papeleria': 35, 'cámara de comercio': 55 };
const tenderFocusTerms = { 'bogotá': 22, 'bogota': 22, 'distrito capital': 20, 'medellín': 22, 'medellin': 22, 'antioquia': 14 };
function canViewTenders(profile) { return isManager(profile) || profile?.microsoft_email?.toLowerCase() === 'directora.licitaciones@seguridadnacional.co'; }
function normTenderText(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function tenderMoney(value) { const n = Number(String(value || '0').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; }
function tenderDate(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function tenderDaysUntil(value) { const d = tenderDate(value); if (!d) return null; const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0); return Math.round((d.getTime() - today.getTime()) / 86400000); }
function tenderWindow(days) { if (days === null) return 'sin fecha de cierre reportada'; if (days <= 7) return 'urgente (0-7 días)'; if (days <= 15) return 'revisar rápido (8-15 días)'; if (days <= 30) return 'buena ventana (16-30 días)'; return 'ventana amplia'; }
function tenderText(row) { return normTenderText(Object.values(row || {}).filter(v => typeof v === 'string').join(' ')); }
function scoreTender(row) {
  const text = tenderText(row); let score = 0; const reasons = []; const risks = [];
  for (const [term, pts] of Object.entries(tenderPositiveTerms)) if (text.includes(normTenderText(term))) { score += pts; reasons.push(term); }
  for (const [term, pts] of Object.entries(tenderFocusTerms)) if (text.includes(normTenderText(term))) { score += pts; reasons.push(`zona foco: ${term}`); }
  for (const [term, pts] of Object.entries(tenderNegativeTerms)) if (text.includes(normTenderText(term))) { score -= pts; risks.push(`posible falso positivo: ${term}`); }
  const value = tenderMoney(row.precio_base || row.cuantia_proceso);
  if (value >= 500000000) { score += 25; reasons.push('valor alto'); }
  else if (value > 0 && value < 50000000) { score -= 15; risks.push('valor bajo'); }
  if (!value) risks.push('valor no reportado / $0; validar');
  return { score, reasons: [...new Set(reasons)].slice(0, 7), risks: [...new Set(risks)].slice(0, 5) };
}
function classifyTenderSection(tender) {
  if (tender.score < 70 || (tender.value > 0 && tender.value < 50000000) || tender.risks.some(r => r.includes('falso positivo'))) return 'descartar';
  if ((tender.days !== null && tender.days <= 10) || tender.score >= 180 || tender.value >= 1000000000) return 'hacer';
  return 'revisar';
}
function normalizeTender(row, source, scored) {
  const isSecop2 = source === 'SECOP II';
  const deadline = isSecop2 ? row.fecha_de_recepcion_de : null;
  const days = tenderDaysUntil(deadline);
  const value = tenderMoney(isSecop2 ? row.precio_base : row.cuantia_proceso);
  const url = isSecop2 ? (typeof row.urlproceso === 'object' ? row.urlproceso?.url : row.urlproceso) : row.ruta_proceso_en_secop_i;
  const tender = {
    id: `${source}:${isSecop2 ? row.id_del_proceso || row.referencia_del_proceso : row.numero_de_proceso}`,
    source,
    entity: isSecop2 ? row.entidad || 'Sin entidad' : row.nombre_entidad || 'Sin entidad',
    dept: row.departamento_entidad || '', city: isSecop2 ? row.ciudad_entidad || '' : row.municipio_entidad || '',
    ref: isSecop2 ? row.referencia_del_proceso || '' : row.numero_de_proceso || '', process_id: isSecop2 ? row.id_del_proceso || '' : '',
    title: isSecop2 ? row.nombre_del_procedimiento || row.descripci_n_del_procedimiento || 'Sin objeto' : row.objeto_a_contratar || row.detalle_del_objeto_a_contratar || 'Sin objeto',
    desc: isSecop2 ? row.descripci_n_del_procedimiento || '' : row.detalle_del_objeto_a_contratar || '',
    value, status: isSecop2 ? row.fase || row.estado_del_procedimiento || '' : row.estado_del_proceso || '', category: isSecop2 ? row.codigo_principal_de_categoria || '' : '',
    published: (isSecop2 ? row.fecha_de_publicacion_del : row.fecha_de_cargue_en_el_secop) || null, deadline: deadline || null, days, window: tenderWindow(days),
    score: scored.score, reasons: scored.reasons, risks: scored.risks, url: url || ''
  };
  return { ...tender, section: classifyTenderSection(tender) };
}
function keywordWhere(fields) {
  const terms = ['vigilancia','seguridad privada','cctv','videovigilancia','control de acceso','alarma','monitoreo','camaras','cámaras','biometrico','biométrico','incendio'];
  const clauses = [];
  for (const field of fields) for (const term of terms) clauses.push(`lower(${field}) like '%${term.toLowerCase()}%'`);
  return clauses.join(' OR ');
}
async function fetchSecopSource(source, cfg) {
  const start = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10) + 'T00:00:00';
  const params = new URLSearchParams({ '$select': cfg.select, '$where': `${cfg.dateField} >= '${start}' AND (${keywordWhere(cfg.nameFields)})`, '$order': `${cfg.dateField} DESC`, '$limit': '120' });
  const response = await fetch(`${cfg.base}?${params.toString()}`, { headers: { 'User-Agent': 'SN-CRM-Tenders-Radar/1.0' } });
  if (!response.ok) throw new Error(`${source} respondió ${response.status}`);
  const rows = await response.json();
  return rows.map(row => ({ row, scored: scoreTender(row) })).filter(x => x.scored.score >= 35).map(x => normalizeTender(x.row, source, x.scored));
}
async function buildTenderRadar() {
  const batches = await Promise.all(Object.entries(tenderSources).map(([source, cfg]) => fetchSecopSource(source, cfg)));
  const seen = new Set();
  const tenders = batches.flat().filter(t => {
    if (t.days !== null && t.days < 0) return false;
    const key = `${t.source}:${t.ref}:${t.entity}:${t.title}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b) => {
    const sectionOrder = { hacer: 0, revisar: 1, descartar: 2 };
    return sectionOrder[a.section] - sectionOrder[b.section] || b.score - a.score || (a.days ?? 999) - (b.days ?? 999);
  }).slice(0, 80);
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      all: tenders.length, hacer: tenders.filter(t => t.section === 'hacer').length, revisar: tenders.filter(t => t.section === 'revisar').length,
      descartar: tenders.filter(t => t.section === 'descartar').length, highValue: tenders.filter(t => t.value >= 500000000).length, urgent: tenders.filter(t => t.days !== null && t.days <= 7).length
    },
    tenders
  };
}

app.get('/api/tenders', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    res.json(await buildTenderRadar());
  } catch (error) { sendAuthError(res, error); }
});

app.get('/api/bootstrap', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const [summary, opportunities, profiles, stages, services, lossReasons, stalled, topClosing, monthlyKpis, goals] = await Promise.all([
      must(database.from('v_psi_sales_pipeline_summary').select('*').order('stage_order')),
      must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).order('updated_at', { ascending: false }).limit(1000)),
      must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active').eq('active', true).order('full_name')),
      must(database.from('psi_sales_pipeline_stages').select('*').order('stage_order')),
      must(database.from('psi_sales_service_types').select('*').eq('active', true).order('name')),
      must(database.from('psi_sales_loss_reasons').select('*').eq('active', true).order('name')),
      must(database.from('v_psi_sales_stalled_sustentacion').select(opportunitySelect).order('prioritization_date')),
      must(database.from('v_psi_sales_top3_closing').select(opportunitySelect).order('owner_name')),
      must(database.from('v_psi_sales_kpis_by_commercial_month').select('*').order('period_month', { ascending: false }).limit(80)),
      must(database.from('psi_sales_goals').select('*').order('period_month', { ascending: false }).limit(500)),
    ]);
    const totals = opportunities.reduce((acc, o) => {
      acc.count += 1;
      acc.pipeline += Number(o.offer_value || 0);
      acc.weighted += Number(o.weighted_pipeline_value || 0);
      if (o.stage_code === 'aprobado') acc.approved += Number(o.offer_value || 0);
      return acc;
    }, { count: 0, pipeline: 0, weighted: 0, approved: 0 });
    res.json(filterBootstrapForProfile({ summary, opportunities, profiles, stages, services, lossReasons, stalled, topClosing, monthlyKpis, goals, totals }, currentProfile));
  } catch (error) { sendAuthError(res, error); }
});

app.get('/api/opportunities/:id', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const id = req.params.id;
    await ensureOpportunityAccess(database, id, currentProfile);
    const opportunity = await must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', id).single());
    const interactions = await must(database.from('psi_sales_interactions').select('*, psi_sales_profiles(full_name)').eq('opportunity_id', id).order('occurred_at', { ascending: false }));
    res.json({ opportunity, interactions });
  } catch (error) { sendError(res, error); }
});

function cleanOpportunity(body) {
  const payload = {
    company_name: String(body.company_name || '').trim(),
    owner_id: body.owner_id || null,
    economic_sector: body.economic_sector || null,
    decision_maker_name: body.decision_maker_name || null,
    decision_maker_email: body.decision_maker_email || null,
    decision_maker_phone: body.decision_maker_phone || null,
    quote_city: body.quote_city || null,
    quote_date: body.quote_date || null,
    offer_value: Number(body.offer_value || 0),
    service_type_code: body.service_type_code || null,
    stage_code: body.stage_code || 'prospecto',
    loss_reason_code: body.stage_code === 'perdido' ? body.loss_reason_code : null,
    loss_notes: body.loss_notes || null,
    next_action_at: body.next_action_at || null,
    expected_close_date: body.expected_close_date || null,
    commission_rate: Number(body.commission_rate || 0),
    regional_nombre: body.regional_nombre || null,
    sede: body.sede || null,
    tipo_producto_original: body.tipo_producto_original || null,
    observaciones: body.observaciones || null,
    external_source: body.external_source || 'web_mvp'
  };
  if (!payload.company_name) throw new Error('El cliente / empresa es obligatorio.');
  if (!payload.owner_id) throw new Error('El comercial responsable es obligatorio.');
  if (!payload.stage_code) throw new Error('La etapa es obligatoria.');
  if (!payload.service_type_code) throw new Error('El tipo de servicio es obligatorio.');
  if (Number.isNaN(payload.offer_value) || payload.offer_value < 0) throw new Error('El valor debe ser numérico y positivo.');
  if (payload.stage_code === 'perdido' && !payload.loss_reason_code) throw new Error('Si la oportunidad está perdida, debe registrar motivo de pérdida.');
  return payload;
}

app.post('/api/opportunities', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const payload = cleanOpportunity(req.body);
    if (currentProfile.role === 'comercial') payload.owner_id = currentProfile.id;
    const data = await must(database.from('psi_sales_opportunities').insert(payload).select('id').single());
    res.status(201).json(data);
  } catch (error) { sendError(res, error, 400); }
});

app.put('/api/opportunities/:id', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureOpportunityAccess(database, req.params.id, currentProfile);
    const payload = cleanOpportunity(req.body);
    if (currentProfile.role === 'comercial') payload.owner_id = currentProfile.id;
    const data = await must(database.from('psi_sales_opportunities').update(payload).eq('id', req.params.id).select('id').single());
    res.json(data);
  } catch (error) { sendError(res, error, 400); }
});

function normalizePeriodMonth(value) {
  const raw = String(value || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(raw)) throw new Error('Debe seleccionar año y mes válidos.');
  return `${raw}-01`;
}

function cleanGoal(body) {
  const payload = {
    user_id: body.user_id || null,
    period_month: normalizePeriodMonth(body.period_month),
    sales_budget: Number(body.sales_budget || 0),
    prospect_target: Number(body.prospect_target || 0),
    quote_target: Number(body.quote_target || 0),
  };
  if (!payload.user_id) throw new Error('Debe seleccionar un asesor comercial.');
  for (const [key, value] of Object.entries(payload)) {
    if (['sales_budget','prospect_target','quote_target'].includes(key) && (Number.isNaN(value) || Number(value) < 0)) {
      throw new Error('Las metas deben ser numéricas y positivas.');
    }
  }
  return payload;
}

app.get('/api/goals', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    let query = database.from('psi_sales_goals').select('*').order('period_month', { ascending: false }).limit(500);
    if (currentProfile.role === 'comercial') query = query.or(`user_id.eq.${currentProfile.id},user_id.is.null`);
    const data = await must(query);
    res.json(data);
  } catch (error) { sendAuthError(res, error); }
});

app.put('/api/goals', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!isManager(currentProfile)) { const error = new Error('Solo gerencia/admin puede modificar metas.'); error.status = 403; throw error; }
    const database = requireDb();
    const payload = cleanGoal(req.body);
    const data = await must(database.from('psi_sales_goals').upsert(payload, { onConflict: 'user_id,period_month' }).select('*').single());
    res.json(data);
  } catch (error) { sendError(res, error, 400); }
});

app.post('/api/opportunities/:id/interactions', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureOpportunityAccess(database, req.params.id, currentProfile);
    const notes = String(req.body.notes || '').trim();
    if (!notes) throw new Error('La nota del seguimiento es obligatoria.');
    const occurred_at = req.body.occurred_at || new Date().toISOString();
    const interaction_type = req.body.interaction_type || 'nota';
    const created_by = isManager(currentProfile) ? (req.body.created_by || currentProfile.id) : currentProfile.id;
    const next_action_at = req.body.next_action_at || null;
    const row = { opportunity_id: req.params.id, notes, occurred_at, interaction_type, created_by };
    const data = await must(database.from('psi_sales_interactions').insert(row).select('id').single());
    const update = { last_interaction_at: occurred_at };
    if (next_action_at) update.next_action_at = next_action_at;
    await must(database.from('psi_sales_opportunities').update(update).eq('id', req.params.id).select('id').single());
    res.status(201).json(data);
  } catch (error) { sendError(res, error, 400); }
});


// Vercel-safe single-segment aliases. The catch-all function reliably serves /api/bootstrap,
// but nested URLs like /api/opportunities/:id can resolve to Vercel 404 in production.
app.get('/api/opportunity-detail', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const id = String(req.query.id || '');
    if (!id) throw new Error('Debe indicar la oportunidad.');
    await ensureOpportunityAccess(database, id, currentProfile);
    const opportunity = await must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', id).single());
    const interactions = await must(database.from('psi_sales_interactions').select('*, psi_sales_profiles(full_name)').eq('opportunity_id', id).order('occurred_at', { ascending: false }));
    res.json({ opportunity, interactions });
  } catch (error) { sendError(res, error); }
});

app.put('/api/opportunity', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const id = String(req.query.id || '');
    if (!id) throw new Error('Debe indicar la oportunidad.');
    await ensureOpportunityAccess(database, id, currentProfile);
    const payload = cleanOpportunity(req.body);
    if (currentProfile.role === 'comercial') payload.owner_id = currentProfile.id;
    const data = await must(database.from('psi_sales_opportunities').update(payload).eq('id', id).select('id').single());
    res.json(data);
  } catch (error) { sendError(res, error, 400); }
});

app.post('/api/opportunity-interactions', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const id = String(req.query.id || '');
    if (!id) throw new Error('Debe indicar la oportunidad.');
    await ensureOpportunityAccess(database, id, currentProfile);
    const notes = String(req.body.notes || '').trim();
    if (!notes) throw new Error('La nota del seguimiento es obligatoria.');
    const occurred_at = req.body.occurred_at || new Date().toISOString();
    const interaction_type = req.body.interaction_type || 'nota';
    const created_by = isManager(currentProfile) ? (req.body.created_by || currentProfile.id) : currentProfile.id;
    const next_action_at = req.body.next_action_at || null;
    const row = { opportunity_id: id, notes, occurred_at, interaction_type, created_by };
    const data = await must(database.from('psi_sales_interactions').insert(row).select('id').single());
    const update = { last_interaction_at: occurred_at };
    if (next_action_at) update.next_action_at = next_action_at;
    await must(database.from('psi_sales_opportunities').update(update).eq('id', id).select('id').single());
    res.status(201).json(data);
  } catch (error) { sendError(res, error, 400); }
});



async function findAuthUserByEmail(database, email) {
  const { data: usersData, error } = await database.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return usersData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

app.get('/api/users', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canManageUsers(currentProfile)) { const error = new Error('Solo admin puede administrar usuarios.'); error.status = 403; throw error; }
    const database = requireDb();
    const profiles = await must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active,created_at').order('full_name'));
    res.json(profiles);
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canManageUsers(currentProfile)) { const error = new Error('Solo admin puede administrar usuarios.'); error.status = 403; throw error; }
    const database = requireDb();
    const full_name = String(req.body.full_name || '').trim();
    const microsoft_email = String(req.body.microsoft_email || '').trim().toLowerCase();
    const role = normalizeUserRole(req.body.role);
    const password = String(req.body.password || '');
    const active = req.body.active !== false;
    const send_invite = req.body.send_invite !== false;
    if (!full_name) throw new Error('El nombre completo es obligatorio.');
    if (!microsoft_email || !microsoft_email.includes('@')) throw new Error('Debe registrar un email válido.');
    if (!['comercial','director','gerencia','admin'].includes(role)) throw new Error('Rol no válido.');
    if (password && password.length < 8) throw new Error('La clave temporal debe tener mínimo 8 caracteres.');
    const userMetadata = { full_name, role };
    let inviteSent = false;
    if (send_invite && active) {
      const existing = await findAuthUserByEmail(database, microsoft_email);
      if (existing) {
        const updates = { user_metadata: userMetadata };
        if (password) updates.password = password;
        const { error: updateError } = await database.auth.admin.updateUserById(existing.id, updates);
        if (updateError) throw updateError;
      }
      const { error: inviteError } = await database.auth.admin.inviteUserByEmail(microsoft_email, {
        redirectTo: getPublicAppUrl(req),
        data: userMetadata
      });
      if (inviteError && /already|registered|exists/i.test(inviteError.message)) {
        const { error: resetError } = await database.auth.resetPasswordForEmail(microsoft_email, { redirectTo: getPublicAppUrl(req) });
        if (resetError) throw resetError;
      } else if (inviteError) {
        throw inviteError;
      }
      inviteSent = true;
    } else if (password) {
      const { error: createError } = await database.auth.admin.createUser({ email: microsoft_email, password, email_confirm: true, user_metadata: userMetadata });
      if (createError && !/already|registered|exists/i.test(createError.message)) throw createError;
      if (createError && /already|registered|exists/i.test(createError.message)) {
        const existing = await findAuthUserByEmail(database, microsoft_email);
        if (existing) await database.auth.admin.updateUserById(existing.id, { password, user_metadata: userMetadata });
      }
    }
    const row = await must(database.from('psi_sales_profiles').upsert({ full_name, microsoft_email, role, active }, { onConflict: 'microsoft_email' }).select('id,full_name,microsoft_email,role,active,created_at').single());
    res.status(201).json({ ...row, invited: inviteSent });
  } catch (error) { sendAuthError(res, error); }
});

app.patch('/api/users', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canManageUsers(currentProfile)) { const error = new Error('Solo admin puede administrar usuarios.'); error.status = 403; throw error; }
    const database = requireDb();
    const id = String(req.query.id || '').trim();
    const existingProfile = await must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active').eq('id', id).single());
    if (!existingProfile) { const error = new Error('Usuario no encontrado.'); error.status = 404; throw error; }
    const full_name = String(req.body.full_name || '').trim();
    const microsoft_email = String(req.body.microsoft_email || '').trim().toLowerCase();
    const role = normalizeUserRole(req.body.role);
    const password = String(req.body.password || '');
    const active = req.body.active !== false;
    if (!full_name) throw new Error('El nombre completo es obligatorio.');
    if (!microsoft_email || !microsoft_email.includes('@')) throw new Error('Debe registrar un email válido.');
    if (!['comercial','director','gerencia','admin'].includes(role)) throw new Error('Rol no válido.');
    if (password && password.length < 8) throw new Error('La clave temporal debe tener mínimo 8 caracteres.');
    const authUser = await findAuthUserByEmail(database, existingProfile.microsoft_email) || await findAuthUserByEmail(database, microsoft_email);
    if (authUser) {
      const updates = { email: microsoft_email, user_metadata: { full_name, role } };
      if (password) updates.password = password;
      const { error: updateAuthError } = await database.auth.admin.updateUserById(authUser.id, updates);
      if (updateAuthError) throw updateAuthError;
    } else if (password) {
      const { error: createError } = await database.auth.admin.createUser({ email: microsoft_email, password, email_confirm: true, user_metadata: { full_name, role } });
      if (createError) throw createError;
    }
    const row = await must(database.from('psi_sales_profiles').update({ full_name, microsoft_email, role, active }).eq('id', id).select('id,full_name,microsoft_email,role,active,created_at').single());
    res.json(row);
  } catch (error) { sendAuthError(res, error); }
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((_req, res) => res.sendFile(path.join(distPath, 'index.html')));

const port = process.env.PORT || 4173;
app.listen(port, () => console.log(`CRM Comercial SN escuchando en http://localhost:${port}`));
