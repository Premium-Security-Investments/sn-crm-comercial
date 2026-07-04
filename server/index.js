import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '25mb' }));

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
const commercialAreas = ['seguridad_fisica','tecnologia','licitacion_publica'];
const customerSegments = ['cliente_nuevo','cliente_actual'];
function isManager(profile) { return managementRoles.includes(profile?.role); }
function validateCommercialArea(value) { const area = value || null; if (area && !commercialAreas.includes(area)) throw new Error('Área comercial no válida.'); return area; }
function validateCustomerSegment(value, required = false) { const segment = value || null; if (required && !segment) throw new Error('Debe clasificar la oportunidad como Cliente Nuevo o Cliente Actual.'); if (segment && !customerSegments.includes(segment)) throw new Error('Tipo de cliente no válido.'); return segment; }
function canEditCustomerSegment(profile, opportunity) { return isManager(profile) || (profile?.can_edit_customer_segment && opportunity?.owner_id === profile.id); }
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
  const profile = await must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active,commercial_area,can_edit_customer_segment').ilike('microsoft_email', email).eq('active', true).single());
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
  const opportunity = await must(database.from('psi_sales_opportunities').select('id,owner_id,customer_segment').eq('id', id).single());
  if (!isManager(profile) && opportunity.owner_id !== profile.id) {
    const error = new Error('No tiene permisos sobre esta oportunidad.');
    error.status = 403;
    throw error;
  }
  return opportunity;
}

const opportunitySelect = '*';
async function attachCommercialMetadata(database, rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return rows;
  const ids = list.map(o => o?.id).filter(Boolean);
  const ownerIds = Array.from(new Set(list.map(o => o?.owner_id).filter(Boolean)));
  const [baseResult, profileResult] = await Promise.all([
    ids.length ? database.from('psi_sales_opportunities').select('id,customer_segment').in('id', ids) : Promise.resolve({ data: [] }),
    ownerIds.length ? database.from('psi_sales_profiles').select('id,commercial_area,can_edit_customer_segment').in('id', ownerIds) : Promise.resolve({ data: [] })
  ]);
  if (baseResult.error) throw baseResult.error;
  if (profileResult.error) throw profileResult.error;
  const segmentById = new Map((baseResult.data || []).map(o => [o.id, o.customer_segment || null]));
  const profileById = new Map((profileResult.data || []).map(p => [p.id, p]));
  const enriched = list.map(o => {
    const owner = profileById.get(o.owner_id);
    return { ...o, customer_segment: segmentById.get(o.id) ?? o.customer_segment ?? null, owner_commercial_area: owner?.commercial_area || null, owner_can_edit_customer_segment: !!owner?.can_edit_customer_segment };
  });
  return Array.isArray(rows) ? enriched : enriched[0];
}
async function logCustomerSegmentChange(database, opportunityId, actorId, oldValue, newValue) {
  if ((oldValue || null) === (newValue || null)) return;
  await database.from('psi_sales_opportunity_audit_logs').insert({ opportunity_id: opportunityId, changed_by: actorId, field_name: 'customer_segment', old_value: oldValue || null, new_value: newValue || null, notes: 'Cambio de Cliente Nuevo / Cliente Actual' });
}



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
const SECOP_PROCESSES_RESOURCE = 'https://www.datos.gov.co/resource/p6dx-8zbt.json';
const SECOP_DOCUMENTS_RESOURCE = 'https://www.datos.gov.co/resource/dmgg-8hin.json';
const TVEC_EVENTS_URL = 'https://operaciones.colombiacompra.gov.co/eventos-cotizacion-tvec';
const ESU_CONTRATACION_URL = 'https://www.esucontratacion.com/procesos/index';
const ESU_DATOS_GOV_ENTITY_TERMS = ['EMPRESA PARA LA SEGURIDAD URBANA', 'EMPRESA PARA LA SEGURIDAD Y SOLUCIONES URBANAS'];
const TVEC_RELEVANT_AGGREGATIONS = {
  'Soluciones de videovigilancia': 90,
  'Soluciones de Videovigilancia y sus mantenimientos II': 90,
  'Video-vigilancia ciudadana': 90,
  'Video Vigilancia': 85,
  'Conectividad IV': 45,
  'IAD Software por Catalogo II': 38,
  'IAD Software por Catálogo II': 38,
  'Nube pública V': 35,
  'Nube Privada IV': 35,
  'Productos y Servicios Electrónicos y Digitales de Confianza': 32
};
const tenderPositiveTerms = {
  'vigilancia y seguridad privada': 45, 'vigilancia y seguridad': 42, 'servicios de vigilancia': 40, 'servicio de vigilancia': 40,
  'vigilancia armada': 38, 'vigilancia privada': 38, 'vigilancia': 35,
  'seguridad privada': 35, 'seguridad electronica': 35, 'seguridad electrónica': 35, 'cctv': 35,
  'videovigilancia': 35, 'video vigilancia': 35, 'control de acceso': 30, 'biometrico': 22, 'biométrico': 22,
  'alarma': 22, 'monitoreo': 22, 'circuito cerrado': 30, 'guardas': 28, 'cedi': 20, 'bodega': 10
};
const tenderDisqualifyingTerms = [
  'interventoria', 'interventoría',
  'vehiculo blindado', 'vehículo blindado', 'vehiculos blindados', 'vehículos blindados',
  'transporte blindado', 'camioneta blindada', 'camionetas blindadas', 'carro blindado',
  'blindaje vehicular', 'blindaje de vehiculos', 'blindaje de vehículos', 'blindados',
  // Regla de descarte SN/PSI: no somos empresa de mantenimiento/soporte técnico de equipos.
  'soporte y mantenimiento', 'mantenimiento y soporte', 'mantenimiento preventivo', 'mantenimiento correctivo',
  'soporte tecnico', 'soporte técnico', 'mesa de ayuda', 'repuestos', 'calibracion', 'calibración',
  'radiocomunicaciones', 'radiocomunicacion', 'radio comunicaciones', 'radio comunicación',
  'sistema de radiocomunicaciones', 'equipos de comunicacion', 'equipos de comunicación',
  'red de comunicaciones', 'telecomunicaciones'
];
const tenderFocusTerms = { 'bogotá': 22, 'bogota': 22, 'distrito capital': 20, 'medellín': 22, 'medellin': 22, 'antioquia': 14 };
const tenderInternalStatuses = ['nueva','en_revision','descartada','convertida_oportunidad'];
function canViewTenders(profile) { return isManager(profile) || profile?.microsoft_email?.toLowerCase() === 'directora.licitaciones@seguridadnacional.co'; }
const tenderCompanyProfileFields = ['legal_name','nit','rup_status','rup_updated_at','rup_unspsc_codes','authorized_services','supervigilancia_license','financial_capacity','organizational_capacity','experience_summary','certifications','recurring_documents','disqualifications_notes','useful_company_info','source_document_name','rup_import_notes'];
function cleanTenderCompanyProfile(body, profile) {
  const payload = { singleton_key: 'seguridad_nacional', updated_by: profile.id };
  for (const field of tenderCompanyProfileFields) {
    const value = body?.[field];
    payload[field] = value === undefined || value === null ? null : String(value).trim() || null;
  }
  if (payload.rup_updated_at && !/^\d{4}-\d{2}-\d{2}$/.test(payload.rup_updated_at)) payload.rup_updated_at = null;
  return payload;
}
function firstRupMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, ' ').trim().slice(0, 1200);
  }
  return null;
}
function uniqueLinesFromMatches(text, regex, limit = 30) {
  const found = new Set();
  for (const match of text.matchAll(regex)) {
    const value = String(match[0] || match[1] || '').replace(/\s+/g, ' ').trim();
    if (value) found.add(value.slice(0, 220));
    if (found.size >= limit) break;
  }
  return [...found].join('\n') || null;
}
function parseRupCompanyProfile(extractedText, existing = {}, sourceDocumentName = '') {
  const text = String(extractedText || '').replace(/\r/g, '\n');
  const compact = text.replace(/\s+/g, ' ');
  const payload = { ...existing, source_document_name: sourceDocumentName || existing.source_document_name || null };
  payload.legal_name = firstRupMatch(compact, [/Raz[oó]n social\s*[:\-]?\s*([^\n]{5,160}?)(?:\s+NIT|\s+Identificaci[oó]n|\s+C[áa]mara|$)/i, /Nombre\s*[:\-]?\s*([^\n]{5,160}?)(?:\s+NIT|\s+Identificaci[oó]n|$)/i]) || payload.legal_name || null;
  payload.nit = firstRupMatch(compact, [/(?:NIT|Identificaci[oó]n)\s*[:\-]?\s*([0-9][0-9.\- ]{7,20})/i]) || payload.nit || null;
  const date = firstRupMatch(compact, [/(?:Fecha\s+de\s+(?:expedici[oó]n|renovaci[oó]n|actualizaci[oó]n|inscripci[oó]n))\s*[:\-]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/i]);
  if (date) {
    const parts = date.replace(/\//g, '-').split('-');
    payload.rup_updated_at = parts[0].length === 4 ? `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}` : `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  }
  payload.rup_status = firstRupMatch(compact, [/(?:Estado\s+del\s+proponente|Estado\s+RUP|Estado)\s*[:\-]?\s*([^\n]{4,120}?)(?:\s+Fecha|\s+Clasificaci[oó]n|$)/i]) || payload.rup_status || 'Información extraída de RUP cargado; validar vigencia/firmeza.';
  payload.rup_unspsc_codes = uniqueLinesFromMatches(text, /\b\d{8}\b[^\n]{0,180}/g, 80) || payload.rup_unspsc_codes || null;
  payload.financial_capacity = firstRupMatch(compact, [/(Capacidad\s+financiera.{0,2200}?)(?:Capacidad\s+organizacional|Experiencia|Clasificaci[oó]n|$)/i]) || payload.financial_capacity || null;
  payload.organizational_capacity = firstRupMatch(compact, [/(Capacidad\s+organizacional.{0,1800}?)(?:Experiencia|Clasificaci[oó]n|Contratos|$)/i]) || payload.organizational_capacity || null;
  payload.experience_summary = firstRupMatch(compact, [/(Experiencia.{0,2600}?)(?:Capacidad\s+financiera|Capacidad\s+organizacional|Clasificaci[oó]n|$)/i]) || payload.experience_summary || null;
  const detected = tenderCompanyProfileFields.filter(field => !['source_document_name','rup_import_notes'].includes(field) && String(payload[field] || '').trim()).length;
  const snippet = compact.slice(0, 2500);
  payload.rup_import_notes = [
    `Documento RUP procesado: ${sourceDocumentName || 'archivo cargado'}`,
    `Caracteres de texto extraídos: ${compact.length}`,
    `Campos con información después de importar: ${detected}`,
    compact.length < 80 ? 'Advertencia: el archivo parece escaneado o sin texto seleccionable; cargue un PDF de texto/DOCX para extracción automática.' : 'Texto extraído del RUP disponible para validar y completar manualmente.'
  ].join('\n');
  payload.useful_company_info = [`RUP cargado para análisis de licitaciones (${new Date().toISOString().slice(0,10)}).`, payload.useful_company_info || '', snippet ? `Texto extraído del RUP:\n${snippet}` : 'No se obtuvo texto útil del RUP; validar manualmente con el documento fuente.'].filter(Boolean).join('\n\n');
  return payload;
}
async function getTenderCompanyProfile(database) {
  const { data, error } = await database.from('psi_company_procurement_profile').select('*').eq('singleton_key', 'seguridad_nacional').maybeSingle();
  if (!error && data) return await attachTenderCompanyProfileUpdater(database, data, data.updated_at, data.updated_by);
  if (error && !['PGRST205','42P01'].includes(error.code)) throw error;
  const fallback = await database.from('psi_tender_radar_runs').select('summary,run_at,triggered_by').eq('mode', 'company_profile').order('run_at', { ascending: false }).limit(1).maybeSingle();
  if (fallback.error) throw fallback.error;
  if (!fallback.data?.summary) return {};
  let parsed = {};
  try { parsed = JSON.parse(fallback.data.summary); } catch { parsed = { useful_company_info: fallback.data.summary }; }
  return await attachTenderCompanyProfileUpdater(database, parsed, fallback.data.run_at, fallback.data.triggered_by);
}
async function attachTenderCompanyProfileUpdater(database, data, updatedAt, updatedBy) {
  let updatedByName = null;
  if (updatedBy) {
    const result = await database.from('psi_sales_profiles').select('full_name').eq('id', updatedBy).maybeSingle();
    updatedByName = result.data?.full_name || null;
  }
  return { ...data, updated_at: data.updated_at || updatedAt || null, updated_by_name: updatedByName };
}
async function saveTenderCompanyProfile(database, payload) {
  const result = await database.from('psi_company_procurement_profile').upsert(payload, { onConflict: 'singleton_key' }).select('id').single();
  if (!result.error) return;
  if (!['PGRST205','42P01'].includes(result.error.code)) throw result.error;
  const fallbackPayload = { ...payload };
  delete fallbackPayload.singleton_key;
  delete fallbackPayload.updated_by;
  await must(database.from('psi_tender_radar_runs').insert({ triggered_by: payload.updated_by, mode: 'company_profile', summary: JSON.stringify(fallbackPayload) }).select('id').single());
}
function normTenderText(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
const tenderTerminalStatusTerms = ['revocado', 'declarado desierto', 'desierto', 'cancelado', 'cancelada'];
function isTenderTerminalStatus(value) {
  const text = normTenderText(value);
  return tenderTerminalStatusTerms.some(term => text.includes(normTenderText(term)));
}
function tenderStatusSearchText(item) {
  const raw = item?.raw || item || {};
  return [
    item?.status, raw.fase, raw.estado_del_procedimiento, raw.estado_del_proceso, raw.estado,
    raw.descripcion_estado, raw.estado_resumen, raw.resultado, raw.comentario_entidad_estatal
  ].filter(Boolean).join(' ');
}
function isTenderTrackable(item) {
  const text = tenderText(item?.raw || item || {});
  return !isTenderTerminalStatus(tenderStatusSearchText(item)) && !tenderDisqualifyingTerms.some(term => text.includes(normTenderText(term)));
}
function tenderMoney(value) { const n = Number(String(value || '0').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; }
function tenderDate(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function tenderDaysUntil(value) { const d = tenderDate(value); if (!d) return null; const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0); return Math.round((d.getTime() - today.getTime()) / 86400000); }
function tenderWindow(days) { if (days === null) return 'sin fecha de cierre reportada'; if (days <= 7) return 'urgente (0-7 días)'; if (days <= 15) return 'revisar rápido (8-15 días)'; if (days <= 30) return 'buena ventana (16-30 días)'; return 'ventana amplia'; }
function tenderText(row) { return normTenderText(Object.values(row || {}).filter(v => typeof v === 'string').join(' ')); }
function stableTenderKey(tender) {
  const base = [tender.source, tender.process_id || tender.ref, tender.entity, tender.title].map(v => normTenderText(v)).join('|');
  return createHash('sha1').update(base).digest('hex').slice(0, 20);
}
const tenderPositiveReasonSet = new Set(Object.keys(tenderPositiveTerms).map(term => normTenderText(term)));
const tenderPositiveEntries = Object.entries(tenderPositiveTerms).map(([term, pts]) => [term, pts, normTenderText(term)]).sort((a, b) => b[2].length - a[2].length);
function hasTenderServiceSignal(item) {
  const reasons = item?.reasons || [];
  const text = item?.raw ? tenderText(item.raw) : tenderText(item);
  return reasons.some(reason => tenderPositiveReasonSet.has(normTenderText(reason))) || tenderPositiveEntries.some(([, , term]) => text.includes(term));
}
function scoreTender(row) {
  const text = tenderText(row); let score = 0; const reasons = []; const risks = [];
  const matchedPositiveTerms = [];
  for (const [term, pts, normalizedTerm] of tenderPositiveEntries) {
    if (text.includes(normalizedTerm) && !matchedPositiveTerms.some(matched => matched.includes(normalizedTerm) || normalizedTerm.includes(matched))) {
      matchedPositiveTerms.push(normalizedTerm);
      score += pts;
      reasons.push(term);
    }
  }
  const matchedFocusTerms = new Set();
  for (const [term, pts] of Object.entries(tenderFocusTerms)) {
    const normalizedTerm = normTenderText(term);
    if (!matchedFocusTerms.has(normalizedTerm) && text.includes(normalizedTerm)) {
      matchedFocusTerms.add(normalizedTerm);
      score += pts;
      reasons.push(`zona foco: ${term}`);
    }
  }
  for (const term of tenderDisqualifyingTerms) if (text.includes(normTenderText(term))) risks.push(`no ofertable: ${term}`);
  const value = tenderMoney(row.precio_base || row.cuantia_proceso);
  if (value >= 500000000) { score += 25; reasons.push('valor alto'); }
  else if (value > 0 && value < 50000000) { score -= 15; risks.push('valor bajo'); }
  if (!value) risks.push('valor no reportado / $0; validar');
  return { score, reasons: [...new Set(reasons)].slice(0, 7), risks: [...new Set(risks)].slice(0, 5) };
}
function classifyTenderSection(tender) {
  if (tender.risks.some(r => r.includes('no ofertable'))) return 'descartar';
  if (tender.score < 70 || (tender.value > 0 && tender.value < 50000000)) return 'descartar';
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
    source,
    entity: isSecop2 ? row.entidad || 'Sin entidad' : row.nombre_entidad || 'Sin entidad',
    dept: row.departamento_entidad || '', city: isSecop2 ? row.ciudad_entidad || '' : row.municipio_entidad || '',
    ref: isSecop2 ? row.referencia_del_proceso || '' : row.numero_de_proceso || '', process_id: isSecop2 ? row.id_del_proceso || '' : '',
    title: isSecop2 ? row.nombre_del_procedimiento || row.descripci_n_del_procedimiento || 'Sin objeto' : row.objeto_a_contratar || row.detalle_del_objeto_a_contratar || 'Sin objeto',
    desc: isSecop2 ? row.descripci_n_del_procedimiento || '' : row.detalle_del_objeto_a_contratar || '',
    value, status: isSecop2 ? row.fase || row.estado_del_procedimiento || '' : row.estado_del_proceso || '', category: isSecop2 ? row.codigo_principal_de_categoria || '' : '',
    published: (isSecop2 ? row.fecha_de_publicacion_del : row.fecha_de_cargue_en_el_secop) || null, deadline: deadline || null, days, window: tenderWindow(days),
    score: scored.score, reasons: scored.reasons, risks: scored.risks, url: url || '', raw: row
  };
  const withId = { ...tender, section: classifyTenderSection(tender) };
  return { ...withId, id: stableTenderKey(withId), stable_key: stableTenderKey(withId), internal_status: 'nueva', converted_opportunity_id: null };
}
function esuEntityField(source) { return source === 'SECOP II' ? 'entidad' : 'nombre_entidad'; }
function isEsuEntityRow(row, source) {
  const entity = normTenderText(row?.[esuEntityField(source)] || row?.entity || '');
  return entity.includes('empresa para la seguridad urbana')
    || entity.includes('empresa para la seguridad y soluciones urbanas')
    || /\bseguridad\b.*\burbana\b.*\besu\b/.test(entity);
}
function normalizeEsuDatosGovProcess(row, originalSource) {
  const scored = scoreTender(row);
  scored.score += 20;
  scored.reasons = [...new Set([`ESU vía datos.gov.co / ${originalSource}`, ...(scored.reasons || [])])];
  scored.risks = [...new Set([...(scored.risks || []), 'ESU vía datos.gov.co: validar fecha de cierre en SECOP/portal ESU', 'ESU vía datos.gov.co: validar documentos asociados y presupuesto antes de recomendar'])];
  const tender = normalizeTender(row, originalSource, scored);
  const withSource = {
    ...tender,
    source: 'ESU Contratación',
    source_origin: `datos.gov.co / ${originalSource}`,
    crm_next_step: 'Validar fecha de cierre y documentos en SECOP/portal ESU; si encaja, marcar en revisión o convertir desde CRM.',
    raw: { ...(tender.raw || row), source_origin: originalSource, discovery: 'datos.gov.co' }
  };
  return { ...withSource, id: stableTenderKey(withSource), stable_key: stableTenderKey(withSource), section: classifyTenderSection(withSource) };
}
function keywordWhere(fields) {
  const terms = ['vigilancia','seguridad privada','cctv','videovigilancia','control de acceso','alarma','monitoreo','camaras','cámaras','biometrico','biométrico'];
  const clauses = [];
  for (const field of fields) for (const term of terms) clauses.push(`lower(${field}) like '%${term.toLowerCase()}%'`);
  return clauses.join(' OR ');
}
async function fetchSecopSource(source, cfg) {
  const start = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10) + 'T00:00:00';
  const params = new URLSearchParams({ '$select': cfg.select, '$where': `${cfg.dateField} >= '${start}' AND (${keywordWhere(cfg.nameFields)})`, '$order': `${cfg.dateField} DESC`, '$limit': '120' });
  const response = await fetch(`${cfg.base}?${params.toString()}`, { headers: { 'User-Agent': 'SN-CRM-Tenders-Radar/2.0' } });
  if (!response.ok) throw new Error(`${source} respondió ${response.status}`);
  const rows = await response.json();
  return rows.filter(row => !isEsuEntityRow(row, source) && isTenderTrackable(row)).map(row => ({ row, scored: scoreTender(row) })).filter(x => x.scored.score >= 35 && hasTenderServiceSignal(x.scored)).map(x => normalizeTender(x.row, source, x.scored));
}
function stripTenderHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function parseTenderTableRows(html) {
  const rows = [];
  const trMatches = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    const cells = [];
    const re = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let match;
    while ((match = re.exec(tr))) cells.push(stripTenderHtml(match[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}
function normalizeTvecEvent(cells, aggregation, baseScore, url) {
  const [ref, title, entity, start, end, status, instrument, _supplier, order, rawValue] = cells;
  const deadline = end || null;
  const days = tenderDaysUntil(deadline);
  const rowText = normTenderText(`${entity} ${title} ${instrument} ${status} ${ref}`);
  let score = baseScore;
  const reasons = [`TVEC: ${instrument || aggregation}`];
  const risks = ['evento TVEC/RFQ: validar requisitos en Coupa/TVEC; valor puede aparecer $0 hasta adjudicación'];
  for (const [term, pts] of Object.entries(tenderFocusTerms)) if (rowText.includes(normTenderText(term))) { score += pts; reasons.push(`zona foco: ${term}`); }
  for (const [term, pts, normalizedTerm] of tenderPositiveEntries) if (rowText.includes(normalizedTerm)) { score += Math.min(pts, 25); reasons.push(term); }
  const tender = {
    source: 'TVEC',
    entity: entity || 'Sin entidad',
    dept: '', city: '', ref: ref || '', process_id: ref || '',
    title: title || aggregation,
    desc: `Instrumento: ${instrument || aggregation}; orden de compra asociada: ${order || '0'}`,
    value: tenderMoney(rawValue),
    status: status || '', category: instrument || aggregation,
    published: start || null, deadline, days, window: tenderWindow(days),
    score, reasons: [...new Set(reasons)].slice(0, 7), risks: [...new Set(risks)].slice(0, 5), url, raw: { ref, title, entity, start, end, status, instrument, order, rawValue, aggregation }
  };
  const withId = { ...tender, section: classifyTenderSection(tender) };
  return { ...withId, id: stableTenderKey(withId), stable_key: stableTenderKey(withId), internal_status: 'nueva', converted_opportunity_id: null };
}
async function fetchTvecEvents() {
  const candidates = [];
  const seen = new Set();
  for (const [aggregation, baseScore] of Object.entries(TVEC_RELEVANT_AGGREGATIONS)) {
    const url = `${TVEC_EVENTS_URL}?${new URLSearchParams({ Agregacion: aggregation }).toString()}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'SN-CRM-TVEC-Radar/1.0' } });
    if (!response.ok) throw new Error(`TVEC respondió ${response.status}`);
    const rows = parseTenderTableRows(await response.text());
    for (const cells of rows.slice(1)) {
      if (cells.length < 10) continue;
      const [ref, title, entity, _start, _end, status] = cells;
      const active = normTenderText(status).includes('produccion') || normTenderText(status).includes('producción');
      if (!active) continue;
      const key = `${ref}:${title}:${entity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tender = normalizeTvecEvent(cells, aggregation, baseScore, url);
      if (tender.days !== null && tender.days < 0) continue;
      candidates.push(tender);
    }
  }
  return candidates.sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999));
}
function parseEsuProcessRows(html) {
  const processes = [];
  const trMatches = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    const cells = [];
    const re = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let match;
    while ((match = re.exec(tr))) cells.push(stripTenderHtml(match[1]));
    if (cells.length < 8 || /^n[ºo°]?$/i.test(cells[0]) || normTenderText(cells[1]) === 'numero') continue;
    const hrefMatch = tr.match(/href=["']([^"']*\/procesos\/view\/\d+)["']/i);
    const href = hrefMatch ? new URL(hrefMatch[1], ESU_CONTRATACION_URL).toString() : ESU_CONTRATACION_URL;
    processes.push({ cells, url: href });
  }
  return processes;
}
function normalizeEsuProcess(process) {
  const cells = process.cells || [];
  const [_rowNumber, numero, objeto, tipoProceso, fechaApertura, fechaCierre, estado, funcionario] = cells;
  const row = {
    nombre_entidad: 'Empresa para la Seguridad y Soluciones Urbanas - ESU',
    departamento_entidad: 'Antioquia',
    municipio_entidad: 'Medellín',
    numero_de_proceso: numero || '',
    objeto_a_contratar: objeto || '',
    detalle_del_objeto_a_contratar: `${tipoProceso || ''} ${estado || ''} ${funcionario || ''}`.trim(),
    estado_del_proceso: estado || '',
    fecha_de_cargue_en_el_secop: fechaApertura || null,
    cuantia_proceso: 0,
    ruta_proceso_en_secop_i: process.url || ESU_CONTRATACION_URL
  };
  const scored = scoreTender(row);
  if (normTenderText(estado).includes('convocado')) { scored.score += 20; scored.reasons = [...new Set([...(scored.reasons || []), 'ESU convocado'])]; }
  const deadline = fechaCierre || null;
  const days = tenderDaysUntil(deadline);
  const tender = {
    source: 'ESU Contratación',
    entity: row.nombre_entidad, dept: row.departamento_entidad, city: row.municipio_entidad,
    ref: numero || '', process_id: numero || '', title: objeto || 'Sin objeto', desc: row.detalle_del_objeto_a_contratar,
    value: 0, status: estado || '', category: tipoProceso || '',
    published: fechaApertura || null, deadline, days, window: tenderWindow(days),
    score: scored.score, reasons: [...new Set(scored.reasons || [])].slice(0, 7), risks: [...new Set([...(scored.risks || []), 'ESU: validar documentos y presupuesto en detalle del proceso'])].slice(0, 5),
    url: process.url || ESU_CONTRATACION_URL, raw: { numero, objeto, tipoProceso, fechaApertura, fechaCierre, estado, funcionario }
  };
  const withId = { ...tender, section: classifyTenderSection(tender) };
  return { ...withId, id: stableTenderKey(withId), stable_key: stableTenderKey(withId), internal_status: 'nueva', converted_opportunity_id: null };
}
async function fetchEsuProcesses() {
  const response = await fetch(ESU_CONTRATACION_URL, { headers: { 'User-Agent': 'SN-CRM-ESU-Tenders-Radar/1.0 (+https://seguridad-nacional-crm.vercel.app)', 'Accept': 'text/html,application/xhtml+xml' } });
  if (!response.ok) throw new Error(`ESU Contratación respondió ${response.status}`);
  const html = await response.text();
  const rows = parseEsuProcessRows(html);
  if (!rows.length && /Incapsula|_Incapsula_Resource/i.test(html)) throw new Error('bloqueo anti-bot de ESU Contratación');
  return rows.slice(0, 80)
    .map(normalizeEsuProcess)
    .filter(t => t.score >= 35)
    .filter(t => t.days === null || t.days >= 0)
    .sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999));
}
async function fetchEsuDatosGovProcesses() {
  const start = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10) + 'T00:00:00';
  const candidates = [];
  const seen = new Set();
  for (const [source, cfg] of Object.entries(tenderSources)) {
    for (const term of ESU_DATOS_GOV_ENTITY_TERMS) {
      const params = new URLSearchParams({ '$select': cfg.select, '$q': term, '$where': `${cfg.dateField} >= '${start}'`, '$order': `${cfg.dateField} DESC`, '$limit': '500' });
      const response = await fetch(`${cfg.base}?${params.toString()}`, { headers: { 'User-Agent': 'SN-CRM-ESU-DatosGov-Radar/1.0' } });
      if (!response.ok) throw new Error(`ESU vía datos.gov.co ${source} respondió ${response.status}`);
      const rows = await response.json();
      for (const row of rows) {
        if (!isEsuEntityRow(row, source)) continue;
        const tender = normalizeEsuDatosGovProcess(row, source);
        if (tender.score < 35 || (tender.days !== null && tender.days < 0) || !isTenderTrackable(tender)) continue;
        const key = `${tender.source_origin}:${tender.ref}:${tender.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(tender);
      }
    }
  }
  return candidates.sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999));
}
async function fetchPublicTenderRadar() {
  const tasks = [
    ...Object.entries(tenderSources).map(([source, cfg]) => ({ source, run: () => fetchSecopSource(source, cfg) })),
    { source: 'TVEC', run: fetchTvecEvents },
    { source: 'ESU Contratación', run: fetchEsuProcesses },
    { source: 'ESU vía datos.gov.co', run: fetchEsuDatosGovProcesses }
  ];
  const settled = await Promise.allSettled(tasks.map(t => t.run()));
  const diagnostics = [];
  const batches = [];
  settled.forEach((result, index) => {
    const source = tasks[index].source;
    if (result.status === 'fulfilled') {
      batches.push(result.value);
      diagnostics.push({ source, status: 'ok', count: result.value.length, message: result.value.length ? `${result.value.length} candidato(s)` : 'Sin candidatos relevantes hoy' });
    } else {
      const message = source === 'TVEC'
        ? `TVEC no disponible temporalmente: ${result.reason?.message || result.reason}`
        : source === 'ESU Contratación'
          ? `ESU Contratación no disponible temporalmente: ${result.reason?.message || result.reason}`
          : `${source} no disponible temporalmente: ${result.reason?.message || result.reason}`;
      diagnostics.push({ source, status: 'error', count: 0, message });
    }
  });
  const seen = new Set();
  const tenders = batches.flat().filter(t => {
    if (t.days !== null && t.days < 0) return false;
    if (!isTenderTrackable(t)) return false;
    const key = t.stable_key || stableTenderKey(t);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b) => {
    const sectionOrder = { hacer: 0, revisar: 1, descartar: 2 };
    return sectionOrder[a.section] - sectionOrder[b.section] || b.score - a.score || (a.days ?? 999) - (b.days ?? 999);
  }).slice(0, 80);
  return { tenders, diagnostics };
}
function radarPayload(tenders, generatedAt = new Date().toISOString(), source = 'live', diagnostics = []) {
  const normalized = tenders.map(t => ({ ...t, id: t.stable_key || t.id || stableTenderKey(t), stable_key: t.stable_key || t.id || stableTenderKey(t) }));
  return {
    generatedAt,
    source,
    diagnostics,
    totals: {
      all: normalized.length,
      hacer: normalized.filter(t => t.section === 'hacer').length,
      revisar: normalized.filter(t => t.section === 'revisar').length,
      descartar: normalized.filter(t => t.section === 'descartar').length,
      highValue: normalized.filter(t => Number(t.value || 0) >= 500000000).length,
      urgent: normalized.filter(t => t.days !== null && t.days !== undefined && t.days <= 7).length,
      enRevision: normalized.filter(t => t.internal_status === 'en_revision').length,
      convertidas: normalized.filter(t => t.internal_status === 'convertida_oportunidad' || t.converted_opportunity_id).length,
      descartadas: normalized.filter(t => t.internal_status === 'descartada').length
    },
    tenders: normalized
  };
}
function isMissingTenderTable(error) {
  const msg = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return msg.includes('42p01') || msg.includes('psi_public_tenders') || msg.includes('psi_tender_radar_runs');
}
async function tenderTableAvailable(database) {
  const { error } = await database.from('psi_public_tenders').select('id').limit(1);
  if (!error) return true;
  if (isMissingTenderTable(error)) return false;
  throw error;
}
function dbTenderToPublic(row) {
  return {
    id: row.stable_key,
    stable_key: row.stable_key,
    source: row.source,
    section: row.section,
    entity: row.entity,
    dept: row.dept || '', city: row.city || '', ref: row.ref || '', process_id: row.process_id || '',
    title: row.title, desc: row.description || '', value: Number(row.value || 0), status: row.status || '', category: row.category || '',
    published: row.published_at, deadline: row.deadline_at, days: tenderDaysUntil(row.deadline_at), window: tenderWindow(tenderDaysUntil(row.deadline_at)),
    score: Number(row.score || 0), reasons: row.reasons || [], risks: row.risks || [], url: row.url || '',
    internal_status: row.internal_status || 'nueva', converted_opportunity_id: row.converted_opportunity_id || null,
    reviewed_by: row.reviewed_by || null, reviewed_at: row.reviewed_at || null, detected_at: row.detected_at || row.created_at || null, last_seen_at: row.last_seen_at || null
  };
}
async function readPersistedTenderRadar(database) {
  const latestRunResult = await database.from('psi_tender_radar_runs').select('run_at,mode').order('run_at', { ascending: false }).limit(1).maybeSingle();
  if (latestRunResult.error && !isMissingTenderTable(latestRunResult.error)) throw latestRunResult.error;
  const latestRunAt = latestRunResult.data?.run_at || null;
  const cutoff = latestRunAt;
  const activeDeadlineCutoff = new Date();
  activeDeadlineCutoff.setUTCHours(0, 0, 0, 0);
  let query = database.from('psi_public_tenders').select('*').order('last_seen_at', { ascending: false }).limit(250);
  if (cutoff) query = query.or(`last_seen_at.gte.${cutoff},deadline_at.gte.${activeDeadlineCutoff.toISOString()}`);
  let { data, error } = await query;
  if (error) {
    if (isMissingTenderTable(error)) return null;
    throw error;
  }
  if ((!data || !data.length) && cutoff) {
    const fallback = await database.from('psi_public_tenders').select('*').order('last_seen_at', { ascending: false }).limit(250);
    if (fallback.error) throw fallback.error;
    data = fallback.data || [];
  }
  const rows = (data || []).filter(isTenderTrackable).map(dbTenderToPublic).filter(t => !['SECOP I','SECOP II'].includes(t.source) || hasTenderServiceSignal(t)).sort((a,b) => {
    const statusOrder = { nueva: 0, en_revision: 1, convertida_oportunidad: 2, descartada: 3 };
    const sectionOrder = { hacer: 0, revisar: 1, descartar: 2 };
    return (statusOrder[a.internal_status] ?? 9) - (statusOrder[b.internal_status] ?? 9) || sectionOrder[a.section] - sectionOrder[b.section] || b.score - a.score;
  });
  return radarPayload(rows, latestRunAt || rows[0]?.last_seen_at || new Date().toISOString(), 'supabase', [{ source: 'Supabase', status: 'ok', count: rows.length, message: latestRunAt ? `Radar historizado desde última corrida (${latestRunResult.data?.mode || 'run'})` : 'Radar historizado' }]);
}
async function enrichLiveTendersWithConversions(database, tenders) {
  const keys = tenders.map(t => `secop_radar:${t.source}:${stableTenderKey(t)}`);
  if (!keys.length) return tenders;
  const { data } = await database.from('psi_sales_opportunities').select('id,external_source').in('external_source', keys);
  const bySource = new Map((data || []).map(o => [o.external_source, o.id]));
  return tenders.map(t => {
    const opportunityId = bySource.get(`secop_radar:${t.source}:${stableTenderKey(t)}`) || null;
    return { ...t, converted_opportunity_id: opportunityId, internal_status: opportunityId ? 'convertida_oportunidad' : (t.internal_status || 'nueva') };
  });
}
async function persistTenderRadar(database, actorProfile, mode = 'manual') {
  const fetchedPayload = await fetchPublicTenderRadar();
  const fetched = fetchedPayload.tenders;
  const diagnostics = fetchedPayload.diagnostics;
  if (!(await tenderTableAvailable(database))) {
    const live = await enrichLiveTendersWithConversions(database, fetched);
    return radarPayload(live, new Date().toISOString(), 'live_no_table', diagnostics);
  }
  const now = new Date().toISOString();
  const rows = fetched.map(t => ({
    stable_key: stableTenderKey(t), source: t.source, section: t.section, entity: t.entity, dept: t.dept || null, city: t.city || null,
    ref: t.ref || null, process_id: t.process_id || null, title: t.title, description: t.desc || null, value: Number(t.value || 0),
    status: t.status || null, category: t.category || null, published_at: t.published || null, deadline_at: t.deadline || null,
    score: Number(t.score || 0), reasons: t.reasons || [], risks: t.risks || [], url: t.url || null, raw: t.raw || null, last_seen_at: now
  }));
  if (rows.length) {
    const { error: upsertError } = await database.from('psi_public_tenders').upsert(rows, { onConflict: 'stable_key', defaultToNull: false });
    if (upsertError) throw upsertError;
  }
  await database.from('psi_tender_radar_runs').insert({ run_at: now, triggered_by: actorProfile?.id || null, mode, count_total: rows.length, count_hacer: rows.filter(r => r.section === 'hacer').length, count_revisar: rows.filter(r => r.section === 'revisar').length, count_descartar: rows.filter(r => r.section === 'descartar').length, summary: `Radar multifuente sincronizado: ${rows.length} procesos/eventos. ${diagnostics.map(d => `${d.source}: ${d.status}`).join(' · ')}` });
  const persisted = await readPersistedTenderRadar(database);
  return { ...persisted, diagnostics };
}
async function buildTenderRadar(database, currentProfile, forceRefresh = false) {
  if (forceRefresh) return await persistTenderRadar(database, currentProfile, 'manual');
  if (await tenderTableAvailable(database)) {
    const persisted = await readPersistedTenderRadar(database);
    if (persisted?.tenders?.length) return persisted;
    return await persistTenderRadar(database, currentProfile, 'auto_empty');
  }
  const fetchedPayload = await fetchPublicTenderRadar();
  const live = await enrichLiveTendersWithConversions(database, fetchedPayload.tenders);
  return radarPayload(live, new Date().toISOString(), 'live_no_table', fetchedPayload.diagnostics);
}
async function findTenderOwner(database, currentProfile) {
  const { data } = await database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active').ilike('microsoft_email', 'directora.licitaciones@seguridadnacional.co').eq('active', true).maybeSingle();
  return data || currentProfile;
}
function buildTenderOpportunityPayload(tender, owner) {
  const notes = [
    `Origen: ${tender.source} / Radar Licitaciones`,
    `Referencia: ${tender.ref || tender.process_id || '—'}`,
    `Objeto: ${tender.title}`,
    `Entidad: ${tender.entity}`,
    `Ubicación: ${tender.city || tender.dept || '—'}`,
    `Score radar: ${tender.score}`,
    `Razones: ${(tender.reasons || []).join(', ') || '—'}`,
    tender.url ? `Link fuente: ${tender.url}` : '',
  ].filter(Boolean).join('\n');
  return {
    company_name: tender.entity,
    owner_id: owner.id,
    stage_code: 'prospecto',
    service_type_code: 'licitacion_publica',
    offer_value: Number(tender.value || 0),
    expected_close_date: tender.deadline || null,
    quote_city: tender.city || tender.dept || null,
    regional_nombre: tender.dept || null,
    sede: tender.ref || tender.process_id || null,
    economic_sector: 'Sector público',
    tipo_producto_original: 'Licitación Pública',
    observaciones: notes,
    external_source: `secop_radar:${tender.source}:${stableTenderKey(tender)}`
  };
}
async function markTenderConverted(database, tender, opportunityId, profileId) {
  if (!(await tenderTableAvailable(database))) return;
  await database.from('psi_public_tenders').update({ internal_status: 'convertida_oportunidad', converted_opportunity_id: opportunityId, reviewed_by: profileId, reviewed_at: new Date().toISOString() }).eq('stable_key', stableTenderKey(tender));
}
async function setTenderStatus(database, stableKey, internalStatus, currentProfile) {
  if (!tenderInternalStatuses.includes(internalStatus)) throw new Error('Estado interno de licitación inválido.');
  if (!(await tenderTableAvailable(database))) throw new Error('La tabla psi_public_tenders aún no existe. Aplica la migración para guardar estados internos.');
  const { data, error } = await database.from('psi_public_tenders').update({ internal_status: internalStatus, reviewed_by: currentProfile.id, reviewed_at: new Date().toISOString() }).eq('stable_key', stableKey).select('*').single();
  if (error) throw error;
  return dbTenderToPublic(data);
}

app.get('/api/tenders', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    res.json(await buildTenderRadar(database, currentProfile, req.query.refresh === '1'));
  } catch (error) { sendAuthError(res, error); }
});

app.get('/api/tender-company-profile', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver esta ficha.'); error.status = 403; throw error; }
    res.json(await getTenderCompanyProfile(requireDb()));
  } catch (error) { sendAuthError(res, error); }
});

app.put('/api/tender-company-profile', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede editar esta ficha.'); error.status = 403; throw error; }
    const database = requireDb();
    await saveTenderCompanyProfile(database, cleanTenderCompanyProfile(req.body, currentProfile));
    res.json(await getTenderCompanyProfile(database));
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-company-profile-upload-url', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede cargar el RUP.'); error.status = 403; throw error; }
    const database = requireDb();
    const name = cleanFileName(req.body?.name || 'rup-actualizado.pdf');
    const size = Number(req.body?.size || 0);
    if (!size) throw new Error('Debe seleccionar un archivo RUP válido.');
    if (size > RUP_MAX_BYTES) throw new Error('El RUP supera 50MB. Reduzca el archivo o cargue una versión PDF/DOCX más liviana.');
    await ensureTenderBucket(database);
    const id = createHash('sha256').update(`company-profile:${Date.now()}:${name}:${size}`).digest('hex').slice(0, 24);
    const storagePath = `company-profile/rup/${id}-${name}`;
    const { data, error } = await database.storage.from(tenderDocumentBucket).createSignedUploadUrl(storagePath);
    if (error) throw error;
    res.json({ path: storagePath, token: data.token });
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-company-profile-process-upload', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede procesar el RUP.'); error.status = 403; throw error; }
    const database = requireDb();
    const storagePath = String(req.body?.storage_path || '');
    if (!storagePath.startsWith('company-profile/rup/')) throw new Error('Ruta de RUP inválida.');
    const name = cleanFileName(req.body?.name || storagePath.split('/').at(-1) || 'rup-actualizado.pdf');
    const { data, error } = await database.storage.from(tenderDocumentBucket).download(storagePath);
    if (error) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());
    if (!buffer.length) throw new Error('El RUP cargado está vacío.');
    const extractedText = await extractTextFromTenderFile(buffer, name, req.body?.mime_type || '');
    const existing = await getTenderCompanyProfile(database);
    const payload = cleanTenderCompanyProfile(parseRupCompanyProfile(extractedText, existing, name), currentProfile);
    await saveTenderCompanyProfile(database, payload);
    res.json(await getTenderCompanyProfile(database));
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-company-profile-upload', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede cargar el RUP.'); error.status = 403; throw error; }
    const database = requireDb();
    const name = cleanFileName(req.body?.name || 'rup-actualizado.pdf');
    const buffer = Buffer.from(String(req.body?.content_base64 || ''), 'base64');
    if (!buffer.length) throw new Error('Debe cargar un archivo RUP válido.');
    if (buffer.length > RUP_MAX_BYTES) throw new Error('El RUP supera 50MB.');
    const extractedText = await extractTextFromTenderFile(buffer, name, req.body?.mime_type || '');
    const existing = await getTenderCompanyProfile(database);
    const payload = cleanTenderCompanyProfile(parseRupCompanyProfile(extractedText, existing, name), currentProfile);
    await saveTenderCompanyProfile(database, payload);
    res.json(await getTenderCompanyProfile(database));
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tenders/refresh', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    res.json(await persistTenderRadar(database, currentProfile, 'manual'));
  } catch (error) { sendAuthError(res, error); }
});

app.patch('/api/tenders/:id/status', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    res.json(await setTenderStatus(database, decodeURIComponent(req.params.id), req.body.internal_status, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tenders/convert', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    const tender = req.body?.tender || req.body;
    const result = await convertTenderToOpportunity(database, tender, currentProfile);
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { sendError(res, error, error?.status || 400); }
});


app.post('/api/tender-refresh', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    res.json(await persistTenderRadar(database, currentProfile, 'manual'));
  } catch (error) { sendAuthError(res, error); }
});

app.patch('/api/tender-status', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    const stableKey = String(req.query.id || '');
    if (!stableKey) throw new Error('Debe indicar la licitación.');
    res.json(await setTenderStatus(database, stableKey, req.body.internal_status, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-convert', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    const tender = req.body?.tender || req.body;
    const result = await convertTenderToOpportunity(database, tender, currentProfile);
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/bootstrap', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const [summary, opportunities, profiles, stages, services, lossReasons, stalled, topClosing, monthlyKpis, goals] = await Promise.all([
      must(database.from('v_psi_sales_pipeline_summary').select('*').order('stage_order')),
      must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).order('updated_at', { ascending: false }).limit(1000)),
      must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active,commercial_area,can_edit_customer_segment').eq('active', true).order('full_name')),
      must(database.from('psi_sales_pipeline_stages').select('*').order('stage_order')),
      must(database.from('psi_sales_service_types').select('*').eq('active', true).order('name')),
      must(database.from('psi_sales_loss_reasons').select('*').eq('active', true).order('name')),
      must(database.from('v_psi_sales_stalled_sustentacion').select(opportunitySelect).order('prioritization_date')),
      must(database.from('v_psi_sales_top3_closing').select(opportunitySelect).order('owner_name')),
      must(database.from('v_psi_sales_kpis_by_commercial_month').select('*').order('period_month', { ascending: false }).limit(80)),
      must(database.from('psi_sales_goals').select('*').order('period_month', { ascending: false }).limit(500)),
    ]);
    const enrichedOpportunities = await attachCommercialMetadata(database, opportunities);
    const enrichedStalled = await attachCommercialMetadata(database, stalled);
    const enrichedTopClosing = await attachCommercialMetadata(database, topClosing);
    const totals = enrichedOpportunities.reduce((acc, o) => {
      acc.count += 1;
      acc.pipeline += Number(o.offer_value || 0);
      acc.weighted += Number(o.weighted_pipeline_value || 0);
      if (o.stage_code === 'aprobado') acc.approved += Number(o.offer_value || 0);
      return acc;
    }, { count: 0, pipeline: 0, weighted: 0, approved: 0 });
    res.json(filterBootstrapForProfile({ summary, opportunities: enrichedOpportunities, profiles, stages, services, lossReasons, stalled: enrichedStalled, topClosing: enrichedTopClosing, monthlyKpis, goals, totals }, currentProfile));
  } catch (error) { sendAuthError(res, error); }
});

app.get('/api/opportunities/:id', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const id = req.params.id;
    await ensureOpportunityAccess(database, id, currentProfile);
    const opportunity = await attachCommercialMetadata(database, await must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', id).single()));
    const interactions = await must(database.from('psi_sales_interactions').select('*, psi_sales_profiles(full_name)').eq('opportunity_id', id).order('occurred_at', { ascending: false }));
    res.json({ opportunity, interactions });
  } catch (error) { sendError(res, error); }
});


const tenderDocumentBucket = 'tender-documents';
const RUP_MAX_BYTES = 50 * 1024 * 1024;
const tenderDocumentTypes = ['pliego','estudios_previos','anexo_tecnico','adenda','formatos','otro'];
function parseInteractionJson(notes) {
  try { return JSON.parse(notes || '{}'); } catch { return null; }
}
function normalizeDocumentType(value, filename = '') {
  if (tenderDocumentTypes.includes(value)) return value;
  const name = normTenderText(filename);
  if (name.includes('adenda')) return 'adenda';
  if (name.includes('estudio')) return 'estudios_previos';
  if (name.includes('anexo') || name.includes('tecnico')) return 'anexo_tecnico';
  if (name.includes('formato') || name.endsWith('.zip')) return 'formatos';
  if (name.includes('pliego')) return 'pliego';
  return 'otro';
}
function cleanFileName(name) { return String(name || 'documento').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 140); }
async function ensureTenderBucket(database) {
  const existing = await database.storage.getBucket(tenderDocumentBucket);
  if (!existing.error) {
    const currentLimit = Number(existing.data?.file_size_limit || existing.data?.fileSizeLimit || 0);
    if (currentLimit && currentLimit < RUP_MAX_BYTES) {
      const { error: updateError } = await database.storage.updateBucket(tenderDocumentBucket, { public: false, fileSizeLimit: RUP_MAX_BYTES });
      if (updateError) throw updateError;
    }
    return;
  }
  const { error } = await database.storage.createBucket(tenderDocumentBucket, { public: false, fileSizeLimit: RUP_MAX_BYTES });
  if (error && !String(error.message || '').toLowerCase().includes('already')) throw error;
}
async function extractTextFromTenderFile(buffer, filename, mime = '') {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith('.pdf') || mime.includes('pdf')) {
      const result = await pdfParse(buffer);
      return (result?.text || '').slice(0, 90000);
    }
    if (lower.endsWith('.docx') || mime.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ buffer });
      return (result?.value || '').slice(0, 90000);
    }
    if (lower.endsWith('.txt') || mime.startsWith('text/')) return buffer.toString('utf8').slice(0, 90000);
    if (lower.endsWith('.zip')) {
      const zip = new AdmZip(buffer);
      const parts = [];
      for (const entry of zip.getEntries().filter(e => !e.isDirectory).slice(0, 30)) {
        const entryName = entry.entryName;
        const data = entry.getData();
        if (/\.(txt|csv|xml|html?)$/i.test(entryName)) parts.push(`--- ${entryName} ---\n${data.toString('utf8').slice(0, 12000)}`);
        else parts.push(`--- ${entryName} ---\nArchivo incluido en ZIP para checklist de formatos.`);
      }
      return parts.join('\n\n').slice(0, 90000);
    }
  } catch (error) {
    return `No fue posible extraer texto automáticamente de ${filename}: ${error?.message || error}`;
  }
  return `Archivo ${filename} cargado. Tipo no soportado para extracción profunda automática.`;
}
function buildTenderDocumentAnalysis(opportunity, documents) {
  const text = documents.map(d => `\n--- ${d.document_type}: ${d.name} ---\n${d.extracted_text || ''}`).join('\n').slice(0, 220000);
  const normalized = normTenderText(text);
  const hasPliego = documents.some(d => d.document_type === 'pliego' || normTenderText(d.name).includes('pliego'));
  const hasTechnical = documents.some(d => d.document_type === 'anexo_tecnico' || /anexo|tecnico/i.test(normTenderText(d.name)));
  const hasAdenda = documents.some(d => d.document_type === 'adenda' || normTenderText(d.name).includes('adenda'));
  const hasFormats = documents.some(d => d.document_type === 'formatos');
  const finds = {
    smmlv: Array.from(text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*SMMLV/gi)).slice(0, 5).map(m => m[0]),
    money: Array.from(text.matchAll(/\$\s?[0-9][0-9.]{5,}(?:,[0-9]{1,2})?/g)).slice(0, 5).map(m => m[0]),
    years: Array.from(text.matchAll(/(\d+)\s*años?/gi)).slice(0, 5).map(m => m[0]),
  };
  const signals = [
    normalized.includes('coordinador') ? 'Menciona coordinador / supervisor operativo.' : 'No se detectó coordinador en el texto extraído.',
    normalized.includes('capital de trabajo') ? 'Menciona capital de trabajo.' : 'Validar capital de trabajo en documentos financieros.',
    normalized.includes('rup') ? 'Menciona RUP / experiencia habilitante.' : 'No se detectó RUP en el texto extraído.',
    normalized.includes('cctv') || normalized.includes('videovigilancia') ? 'Incluye componente CCTV / videovigilancia.' : 'No se detectó componente CCTV explícito.',
    normalized.includes('poliza') || normalized.includes('póliza') ? 'Menciona pólizas / seriedad de oferta.' : 'Validar pólizas requeridas.'
  ];
  const missingCritical = [!hasPliego && 'pliego', !hasTechnical && 'anexo técnico'].filter(Boolean);
  const recommendation = missingCritical.length ? 'Validación incompleta' : 'GO condicionado';
  const risk = missingCritical.length ? 'Alto' : 'Medio';
  const matrix = [
    { category: 'Jurídico', status: hasPliego ? 'Cumplimiento por validar' : 'Pendiente', detail: hasPliego ? 'Pliego disponible para revisar causales de rechazo y habilitantes.' : 'Falta pliego vigente.' },
    { category: 'Técnico', status: hasTechnical ? 'Cumplimiento por validar' : 'Pendiente', detail: hasTechnical ? 'Anexo técnico disponible para puestos, ANS, equipos y personal.' : 'Falta anexo técnico vigente.' },
    { category: 'Versiones', status: hasAdenda ? 'Revisión prioritaria' : 'Confirmar', detail: hasAdenda ? 'Hay adenda: usar siempre la versión más reciente.' : 'Confirmar si existen adendas posteriores.' },
    { category: 'Financiero', status: 'Validar', detail: finds.money.length ? `Valores detectados: ${finds.money.join(' · ')}` : 'Extraer presupuesto, indicadores y capital de trabajo.' },
    { category: 'Experiencia', status: 'Validar', detail: finds.smmlv.length ? `SMMLV detectados: ${finds.smmlv.join(' · ')}` : 'Validar experiencia exigida en SMMLV / contratos similares.' },
    { category: 'Formatos', status: hasFormats ? 'Cargados' : 'Pendiente', detail: hasFormats ? 'Formatos disponibles para checklist de entrega.' : 'Cargar formatos anexos antes de ofertar.' },
  ];
  return {
    kind: 'tender_document_analysis', status: 'analisis_generado', recommendation, risk, generated_at: new Date().toISOString(),
    summary: `${recommendation} para ${opportunity.company_name}. ${missingCritical.length ? `Faltan documentos críticos: ${missingCritical.join(', ')}.` : 'Hay base documental mínima para revisión comercial y licitatoria.'} ${hasAdenda ? 'Priorizar Adenda como versión vigente.' : 'Confirmar si existen adendas.'}`,
    findings: signals, detected_values: finds, matrix,
    checklist: [
      'Confirmar versión vigente de pliego/adendas antes de preparar oferta.',
      'Validar experiencia certificada/RUP y equivalencia en SMMLV.',
      'Revisar indicadores financieros: capital de trabajo, liquidez, endeudamiento y rentabilidad.',
      'Confirmar coordinador, supervisores, puestos, turnos, ANS y medios tecnológicos.',
      'Completar formatos obligatorios, pólizas y anexos firmados.'
    ],
    documents: documents.map(d => ({ id: d.id, name: d.name, type: d.document_type, current: d.current }))
  };
}
async function getTenderDocumentRecords(database, opportunityId) {
  const interactions = await must(database.from('psi_sales_interactions').select('id,notes,occurred_at,created_at,created_by,psi_sales_profiles(full_name)').eq('opportunity_id', opportunityId).eq('interaction_type', 'documento').order('created_at', { ascending: true }));
  const documents = [];
  const analyses = [];
  for (const row of interactions) {
    const payload = parseInteractionJson(row.notes);
    if (payload?.kind === 'tender_document_upload') documents.push(...(payload.documents || []).map(doc => ({ ...doc, interaction_id: row.id, uploaded_by: row.psi_sales_profiles?.full_name || null })));
    if (payload?.kind === 'tender_document_analysis') analyses.push({ ...payload, interaction_id: row.id, created_at: row.created_at, created_by_name: row.psi_sales_profiles?.full_name || null });
  }
  const signed = await Promise.all(documents.map(async doc => {
    const { data } = await database.storage.from(tenderDocumentBucket).createSignedUrl(doc.storage_path, 3600);
    return { ...doc, signed_url: data?.signedUrl || null };
  }));
  return { documents: signed, analysis: analyses.at(-1) || null, analyses };
}
async function ensureTenderOpportunity(database, id, profile) {
  await ensureOpportunityAccess(database, id, profile);
  const opportunity = await must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', id).single());
  if (opportunity.service_type_code !== 'licitacion_publica') { const error = new Error('La revisión documental aplica solo para oportunidades de licitación pública.'); error.status = 400; throw error; }
  return opportunity;
}


function getTenderSourceUrlFromOpportunity(opportunity) {
  const notes = String(opportunity?.observaciones || '');
  const match = notes.match(/Link fuente:\s*(https?:\/\/\S+)/i);
  return match ? match[1].trim() : '';
}
function noticeUidFromSecopUrl(url) {
  const match = String(url || '').match(/[?&]noticeUID=([^&\s]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}
function secopOfficialUrl(url) {
  const noticeUID = noticeUidFromSecopUrl(url);
  return noticeUID ? `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${noticeUID}` : String(url || '');
}
async function fetchDatosGovJson(url, label) {
  const response = await fetch(url, { headers: { 'User-Agent': 'SN-CRM-SECOP-Documents/1.0 (+https://seguridad-nacional-crm.vercel.app)', 'Accept': 'application/json' } });
  if (!response.ok) throw new Error(`${label} respondió ${response.status}`);
  return await response.json();
}
async function resolveSecopProcessByExactUrl(sourceUrl) {
  const exactUrl = secopOfficialUrl(sourceUrl);
  if (!noticeUidFromSecopUrl(exactUrl)) throw new Error('La oportunidad no tiene enlace SECOP II con noticeUID para importar documentos automáticamente.');
  const params = new URLSearchParams({ '$limit': '1', '$where': `urlproceso='${exactUrl.replace(/'/g, "''")}'` });
  const rows = await fetchDatosGovJson(`${SECOP_PROCESSES_RESOURCE}?${params.toString()}`, 'SECOP II procesos');
  if (!rows?.length) throw new Error(`No se encontró proceso SECOP por urlproceso exacto (${noticeUidFromSecopUrl(exactUrl)}).`);
  return rows[0];
}
async function listSecopDocumentsByPortfolio(portfolioId) {
  if (!portfolioId) throw new Error('El proceso SECOP no trae id_del_portafolio para buscar documentos.');
  const params = new URLSearchParams({ '$limit': '500', proceso: portfolioId });
  const docs = await fetchDatosGovJson(`${SECOP_DOCUMENTS_RESOURCE}?${params.toString()}`, 'SECOP II documentos');
  return (docs || []).filter(d => d?.url_descarga_documento?.url && d?.nombre_archivo);
}
async function downloadSecopDocument(doc, referer) {
  const response = await fetch(doc.url_descarga_documento.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'Accept': 'application/pdf,application/octet-stream,*/*', 'Referer': referer } });
  if (!response.ok) throw new Error(`Documento ${doc.nombre_archivo} respondió ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
async function saveTenderDocumentBuffer(database, opportunityId, file, currentProfile, sourceMeta = {}) {
  const name = cleanFileName(file.name);
  const buffer = file.buffer;
  if (!buffer?.length) throw new Error(`Archivo vacío: ${name}`);
  if (buffer.length > RUP_MAX_BYTES) throw new Error(`Archivo supera 50MB: ${name}`);
  const id = createHash('sha256').update(`${opportunityId}:${sourceMeta.source_document_id || ''}:${name}:${buffer.length}`).digest('hex').slice(0, 24);
  const storagePath = `${opportunityId}/${id}-${name}`;
  const documentType = normalizeDocumentType(file.document_type, name);
  const extractedText = await extractTextFromTenderFile(buffer, name, file.mime_type || '');
  const { error: uploadError } = await database.storage.from(tenderDocumentBucket).upload(storagePath, buffer, { contentType: file.mime_type || 'application/octet-stream', upsert: true });
  if (uploadError) throw uploadError;
  return { id, name, size: buffer.length, mime_type: file.mime_type || null, document_type: documentType, current: file.current !== false, storage_path: storagePath, uploaded_at: new Date().toISOString(), extracted_text: extractedText, auto_import: !!sourceMeta.auto_import, source_url: sourceMeta.source_url || null, source_document_id: sourceMeta.source_document_id || null };
}
async function importTenderDocumentsFromOfficialSource(database, opportunityId, currentProfile, { analyze = true } = {}) {
  const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
  const sourceUrl = getTenderSourceUrlFromOpportunity(opportunity);
  const officialUrl = secopOfficialUrl(sourceUrl);
  if (!/community\.secop\.gov\.co/i.test(officialUrl)) throw new Error('La importación automática solo está disponible para enlaces SECOP II. Use carga manual para otras fuentes.');
  await ensureTenderBucket(database);
  const process = await resolveSecopProcessByExactUrl(officialUrl);
  const docs = await listSecopDocumentsByPortfolio(process.id_del_portafolio);
  if (!docs.length) throw new Error('SECOP no retornó documentos para este portafolio.');
  const priority = ['pliego','estudio','previo','especificacion','especificación','tecnico','técnico','anexo','formato','indicador','financier','experiencia','matriz','riesgo','convocatoria','minuta'];
  const selected = docs.filter(d => priority.some(term => String(d.nombre_archivo || '').toLowerCase().includes(term))).slice(0, 40);
  const toDownload = selected.length ? selected : docs.slice(0, 40);
  const uploaded = [];
  for (const doc of toDownload) {
    try {
      const buffer = await downloadSecopDocument(doc, officialUrl);
      uploaded.push(await saveTenderDocumentBuffer(database, opportunityId, { name: doc.nombre_archivo, buffer, mime_type: doc.extensi_n === 'pdf' ? 'application/pdf' : 'application/octet-stream', document_type: normalizeDocumentType('', doc.nombre_archivo), current: true }, currentProfile, { auto_import: true, source_url: doc.url_descarga_documento.url, source_document_id: doc.id_documento }));
    } catch (error) {
      uploaded.push({ id: `error-${doc.id_documento}`, name: doc.nombre_archivo, size: 0, mime_type: null, document_type: normalizeDocumentType('', doc.nombre_archivo), current: false, storage_path: null, uploaded_at: new Date().toISOString(), extracted_text: `Error al importar desde SECOP: ${error?.message || error}`, auto_import: true, source_url: doc.url_descarga_documento?.url || null, source_document_id: doc.id_documento });
    }
  }
  await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_upload', auto_import: true, source: 'SECOP II', process_id: process.id_del_proceso, portfolio_id: process.id_del_portafolio, notice_uid: noticeUidFromSecopUrl(officialUrl), opportunity: opportunity.company_name, documents: uploaded }) }).select('id').single());
  if (analyze) {
    const records = await getTenderDocumentRecords(database, opportunityId);
    const currentDocs = records.documents.filter(d => d.current !== false);
    if (currentDocs.length) {
      const analysis = buildTenderDocumentAnalysis(opportunity, currentDocs);
      await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ ...analysis, auto_import: true, source: 'SECOP II' }) }).select('id').single());
    }
  }
  return await getTenderDocumentRecords(database, opportunityId);
}
async function convertTenderToOpportunity(database, tender, currentProfile) {
  if (!tender?.source || !tender?.entity || !tender?.title) throw new Error('Licitación inválida para convertir.');
  const owner = await findTenderOwner(database, currentProfile);
  const payload = buildTenderOpportunityPayload(tender, currentProfile.role === 'comercial' ? currentProfile : owner);
  const existing = await database.from('psi_sales_opportunities').select('id').eq('external_source', payload.external_source).maybeSingle();
  if (existing.error) throw existing.error;
  const opportunityId = existing.data?.id || (await must(database.from('psi_sales_opportunities').insert(payload).select('id').single())).id;
  await markTenderConverted(database, tender, opportunityId, currentProfile.id);
  let document_import_status = 'no_aplica';
  let document_import_error = null;
  if (tender.source === 'SECOP II' && tender.url) {
    try {
      await importTenderDocumentsFromOfficialSource(database, opportunityId, currentProfile, { analyze: true });
      document_import_status = 'analisis_generado';
    } catch (error) {
      document_import_status = 'fallo_importacion';
      document_import_error = error?.message || String(error);
      await database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_import_error', auto_import: true, source: 'SECOP II', error: document_import_error }) });
    }
  }
  return { id: opportunityId, duplicate: !!existing.data?.id, document_import_status, document_import_error };
}
async function markTenderOpportunityDiscarded(database, opportunityId, currentProfile, reason) {
  await ensureTenderOpportunity(database, opportunityId, currentProfile);
  const notes = String(reason || 'Descartada después de revisión documental / comercial.').trim();
  await must(database.from('psi_sales_opportunities').update({ stage_code: 'descartado', loss_notes: notes, next_action_at: null }).eq('id', opportunityId).select('id').single());
  await database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'nota', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: `Sacar de oportunidad / descartada: ${notes}` });
  if (await tenderTableAvailable(database)) {
    await database.from('psi_public_tenders').update({ internal_status: 'descartada', converted_opportunity_id: null, reviewed_by: currentProfile.id, reviewed_at: new Date().toISOString() }).eq('converted_opportunity_id', opportunityId);
  }
  return { id: opportunityId, stage_code: 'descartado', internal_status: 'descartada' };
}

app.get('/api/tender-documents', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const id = String(req.query.id || '');
    if (!id) throw new Error('Debe indicar la oportunidad.');
    await ensureTenderOpportunity(database, id, currentProfile);
    res.json(await getTenderDocumentRecords(database, id));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-documents-upload', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const files = Array.isArray(req.body.files) ? req.body.files : [];
    if (!files.length) throw new Error('Debe adjuntar al menos un documento.');
    await ensureTenderBucket(database);
    const uploaded = [];
    for (const file of files.slice(0, 8)) {
      const name = cleanFileName(file.name);
      const buffer = Buffer.from(String(file.content_base64 || ''), 'base64');
      if (!buffer.length) throw new Error(`Archivo vacío: ${name}`);
      if (buffer.length > RUP_MAX_BYTES) throw new Error(`Archivo supera 50MB: ${name}`);
      uploaded.push(await saveTenderDocumentBuffer(database, opportunityId, { name, buffer, mime_type: file.mime_type || '', document_type: file.document_type, current: file.current }, currentProfile));
    }
    await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_upload', opportunity: opportunity.company_name, documents: uploaded }) }).select('id').single());
    res.status(201).json(await getTenderDocumentRecords(database, opportunityId));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-documents-analyze', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const records = await getTenderDocumentRecords(database, opportunityId);
    const currentDocs = records.documents.filter(d => d.current !== false);
    if (!currentDocs.length) throw new Error('Debe cargar documentos antes de analizar.');
    const analysis = buildTenderDocumentAnalysis(opportunity, currentDocs);
    await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify(analysis) }).select('id').single());
    res.json(await getTenderDocumentRecords(database, opportunityId));
  } catch (error) { sendError(res, error, error?.status || 400); }
});


app.post('/api/tender-documents-import', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    res.json(await importTenderDocumentsFromOfficialSource(database, opportunityId, currentProfile, { analyze: true }));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-opportunity-discard', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    res.json(await markTenderOpportunityDiscarded(database, opportunityId, currentProfile, req.body.reason));
  } catch (error) { sendError(res, error, error?.status || 400); }
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
    customer_segment: validateCustomerSegment(body.customer_segment, true),
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
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.put('/api/opportunities/:id', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const existing = await ensureOpportunityAccess(database, req.params.id, currentProfile);
    const payload = cleanOpportunity(req.body);
    if (currentProfile.role === 'comercial') payload.owner_id = currentProfile.id;
    if ((payload.customer_segment || null) !== (existing.customer_segment || null) && !canEditCustomerSegment(currentProfile, existing)) { const error = new Error('No tiene permiso para cambiar Cliente Nuevo / Cliente Actual en oportunidades ya creadas.'); error.status = 403; throw error; }
    const data = await must(database.from('psi_sales_opportunities').update(payload).eq('id', req.params.id).select('id').single());
    await logCustomerSegmentChange(database, req.params.id, currentProfile.id, existing.customer_segment, payload.customer_segment);
    res.json(data);
  } catch (error) { sendError(res, error, error?.status || 400); }
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
    service_type_code: body.service_type_code || null,
    regional_nombre: body.regional_nombre || null,
    operational_unit_target: Number(body.operational_unit_target || 0),
    sales_budget: Number(body.sales_budget || 0),
    prospect_target: Number(body.prospect_target || 0),
    quote_target: Number(body.quote_target || 0),
  };
  if (!payload.user_id) throw new Error('Debe seleccionar un asesor comercial.');
  if (!payload.service_type_code) throw new Error('Debe seleccionar el producto / servicio de la meta.');
  for (const [key, value] of Object.entries(payload)) {
    if (['sales_budget','prospect_target','quote_target','operational_unit_target'].includes(key) && (Number.isNaN(value) || Number(value) < 0)) {
      throw new Error('Las metas deben ser numéricas y positivas.');
    }
  }
  payload.regional_nombre = payload.regional_nombre || 'todas';
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
    const data = await must(database.from('psi_sales_goals').upsert(payload, { onConflict: 'user_id,period_month,service_type_code,regional_nombre' }).select('*').single());
    res.json(data);
  } catch (error) { sendError(res, error, error?.status || 400); }
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
  } catch (error) { sendError(res, error, error?.status || 400); }
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
    const opportunity = await attachCommercialMetadata(database, await must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', id).single()));
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
    const existing = await ensureOpportunityAccess(database, id, currentProfile);
    const payload = cleanOpportunity(req.body);
    if (currentProfile.role === 'comercial') payload.owner_id = currentProfile.id;
    if ((payload.customer_segment || null) !== (existing.customer_segment || null) && !canEditCustomerSegment(currentProfile, existing)) { const error = new Error('No tiene permiso para cambiar Cliente Nuevo / Cliente Actual en oportunidades ya creadas.'); error.status = 403; throw error; }
    const data = await must(database.from('psi_sales_opportunities').update(payload).eq('id', id).select('id').single());
    await logCustomerSegmentChange(database, id, currentProfile.id, existing.customer_segment, payload.customer_segment);
    res.json(data);
  } catch (error) { sendError(res, error, error?.status || 400); }
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
  } catch (error) { sendError(res, error, error?.status || 400); }
});



async function findAuthUserByEmail(database, email) {
  const { data: usersData, error } = await database.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return usersData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function confirmAuthUserIfNeeded(database, user) {
  if (!user || user.email_confirmed_at || user.confirmed_at) return user;
  const { data, error } = await database.auth.admin.updateUserById(user.id, { email_confirm: true });
  if (error) throw error;
  return data?.user || user;
}

async function generateAccessLink(database, email, req, userMetadata = {}) {
  const { data, error } = await database.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: getPublicAppUrl(req), data: userMetadata }
  });
  if (error) return null;
  return data?.properties?.action_link || data?.action_link || null;
}

async function sendAccessEmail(database, email, req) {
  const { error } = await database.auth.resetPasswordForEmail(email, { redirectTo: getPublicAppUrl(req) });
  return { sent: !error, error };
}

app.get('/api/users', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canManageUsers(currentProfile)) { const error = new Error('Solo admin puede administrar usuarios.'); error.status = 403; throw error; }
    const database = requireDb();
    const profiles = await must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active,commercial_area,can_edit_customer_segment,created_at').order('full_name'));
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
    const commercial_area = validateCommercialArea(req.body.commercial_area);
    const can_edit_customer_segment = req.body.can_edit_customer_segment === true;
    if (!full_name) throw new Error('El nombre completo es obligatorio.');
    if (!microsoft_email || !microsoft_email.includes('@')) throw new Error('Debe registrar un email válido.');
    if (!['comercial','director','gerencia','admin'].includes(role)) throw new Error('Rol no válido.');
    if (password && password.length < 8) throw new Error('La clave temporal debe tener mínimo 8 caracteres.');
    const userMetadata = { full_name, role };
    let inviteSent = false;
    let accessLink = null;
    let authUser = await findAuthUserByEmail(database, microsoft_email);
    if (send_invite && active) {
      if (authUser) {
        const updates = { user_metadata: userMetadata, email_confirm: true };
        if (password) updates.password = password;
        const { data: updatedAuth, error: updateError } = await database.auth.admin.updateUserById(authUser.id, updates);
        if (updateError) throw updateError;
        authUser = updatedAuth?.user || authUser;
      } else if (password) {
        const { data: createdAuth, error: createError } = await database.auth.admin.createUser({ email: microsoft_email, password, email_confirm: true, user_metadata: userMetadata });
        if (createError && !/already|registered|exists/i.test(createError.message)) throw createError;
        authUser = createError ? await findAuthUserByEmail(database, microsoft_email) : createdAuth?.user;
      } else {
        const { error: inviteError } = await database.auth.admin.inviteUserByEmail(microsoft_email, {
          redirectTo: getPublicAppUrl(req),
          data: userMetadata
        });
        if (inviteError && !/already|registered|exists/i.test(inviteError.message)) throw inviteError;
        authUser = await findAuthUserByEmail(database, microsoft_email);
      }
      if (authUser) await confirmAuthUserIfNeeded(database, authUser);
      const emailResult = await sendAccessEmail(database, microsoft_email, req);
      if (emailResult.error) console.error('Supabase access email failed', emailResult.error);
      accessLink = await generateAccessLink(database, microsoft_email, req, userMetadata);
      inviteSent = emailResult.sent;
    } else if (password) {
      const { data: createdAuth, error: createError } = await database.auth.admin.createUser({ email: microsoft_email, password, email_confirm: true, user_metadata: userMetadata });
      if (createError && !/already|registered|exists/i.test(createError.message)) throw createError;
      if (createError && /already|registered|exists/i.test(createError.message)) {
        const existing = await findAuthUserByEmail(database, microsoft_email);
        if (existing) await database.auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: userMetadata });
      } else if (createdAuth?.user) {
        await confirmAuthUserIfNeeded(database, createdAuth.user);
      }
    }
    const row = await must(database.from('psi_sales_profiles').upsert({ full_name, microsoft_email, role, active, commercial_area, can_edit_customer_segment }, { onConflict: 'microsoft_email' }).select('id,full_name,microsoft_email,role,active,commercial_area,can_edit_customer_segment,created_at').single());
    res.status(201).json({ ...row, invited: inviteSent, access_link: accessLink });
  } catch (error) { sendAuthError(res, error); }
});

app.patch('/api/users', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canManageUsers(currentProfile)) { const error = new Error('Solo admin puede administrar usuarios.'); error.status = 403; throw error; }
    const database = requireDb();
    const id = String(req.query.id || '').trim();
    const existingProfile = await must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active,commercial_area,can_edit_customer_segment').eq('id', id).single());
    if (!existingProfile) { const error = new Error('Usuario no encontrado.'); error.status = 404; throw error; }
    const full_name = String(req.body.full_name || '').trim();
    const microsoft_email = String(req.body.microsoft_email || '').trim().toLowerCase();
    const role = normalizeUserRole(req.body.role);
    const password = String(req.body.password || '');
    const active = req.body.active !== false;
    const send_invite = req.body.send_invite === true;
    const commercial_area = validateCommercialArea(req.body.commercial_area);
    const can_edit_customer_segment = req.body.can_edit_customer_segment === true;
    if (!full_name) throw new Error('El nombre completo es obligatorio.');
    if (!microsoft_email || !microsoft_email.includes('@')) throw new Error('Debe registrar un email válido.');
    if (!['comercial','director','gerencia','admin'].includes(role)) throw new Error('Rol no válido.');
    if (password && password.length < 8) throw new Error('La clave temporal debe tener mínimo 8 caracteres.');
    const existingEmail = String(existingProfile.microsoft_email || '').trim().toLowerCase();
    const emailChanged = microsoft_email !== existingEmail;
    const authUserByOldEmail = await findAuthUserByEmail(database, existingEmail);
    const authUserByNewEmail = emailChanged ? await findAuthUserByEmail(database, microsoft_email) : authUserByOldEmail;
    if (emailChanged && authUserByNewEmail && (!authUserByOldEmail || authUserByNewEmail.id !== authUserByOldEmail.id)) {
      throw new Error('El email ya pertenece a otro usuario de acceso.');
    }
    let authUser = authUserByOldEmail || authUserByNewEmail;
    const userMetadata = { full_name, role };
    let accessLink = null;
    let inviteSent = false;
    if (authUser) {
      const updates = { user_metadata: userMetadata, email_confirm: true };
      if (emailChanged) updates.email = microsoft_email;
      if (password) updates.password = password;
      const { data: updatedAuth, error: updateAuthError } = await database.auth.admin.updateUserById(authUser.id, updates);
      if (updateAuthError) throw updateAuthError;
      authUser = updatedAuth?.user || authUser;
    } else if (password) {
      const { data: createdAuth, error: createError } = await database.auth.admin.createUser({ email: microsoft_email, password, email_confirm: true, user_metadata: userMetadata });
      if (createError) throw createError;
      authUser = createdAuth?.user || null;
    }
    if (send_invite && active) {
      if (authUser) await confirmAuthUserIfNeeded(database, authUser);
      const emailResult = await sendAccessEmail(database, microsoft_email, req);
      if (emailResult.error) console.error('Supabase access email failed', emailResult.error);
      accessLink = await generateAccessLink(database, microsoft_email, req, userMetadata);
      inviteSent = emailResult.sent;
    }
    const row = await must(database.from('psi_sales_profiles').update({ full_name, microsoft_email, role, active, commercial_area, can_edit_customer_segment }).eq('id', id).select('id,full_name,microsoft_email,role,active,commercial_area,can_edit_customer_segment,created_at').single());
    res.json({ ...row, invited: inviteSent, access_link: accessLink });
  } catch (error) { sendAuthError(res, error); }
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((_req, res) => res.sendFile(path.join(distPath, 'index.html')));

const port = process.env.PORT || 4173;
app.listen(port, () => console.log(`CRM Comercial SN escuchando en http://localhost:${port}`));
