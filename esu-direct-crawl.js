// Shared ESU Contratación direct-site crawler (esucontratacion.com), extracted so
// server/index.js and api/[...path].js call one implementation instead of two copies.
// The relevance-scoring building blocks below are a faithful copy of the equivalent
// private helpers in server/index.js (not an import) so this module stays free of
// Express/Supabase import-time side effects and can be reused by esu-direct-refresh.js
// and the durable pipeline/CLI without booting the HTTP app.
import { createHash } from 'node:crypto';
import { safeOfficialFetch } from './safe-official-fetch.js';
import { normalizeTenderStatusText, isTenderTrackableStatus } from './tender-source-status.js';
import { TENDER_CORE_SERVICE_TERMS, TENDER_DISQUALIFYING_TERMS, TENDER_NON_COMMERCIAL_ACT_TERMS, TENDER_NON_SECURITY_CONTEXT_TERMS } from './tender-relevance-terms.js';

export const ESU_CONTRATACION_ORIGIN = 'https://esucontratacion.com';
export const ESU_CONTRATACION_URL = `${ESU_CONTRATACION_ORIGIN}/procesos/index`;
export const ESU_RELEVANT_CATEGORY_IDS = { '7': 'Tecnología', '8': 'Sistemas integrales de seguridad', '9': 'Vigilancia física' };
export const ESU_RELEVANT_KEYWORDS = ['vigilancia', 'seguridad', 'cctv', 'videovigilancia', 'control de acceso', 'alarma'];
export const ESU_FETCH_POLICY = { allowedHosts: ['esucontratacion.com', 'www.esucontratacion.com'], allowedPath: /^\/procesos(?:\/|$)/i };

const ESU_SCORE_NAME_FIELDS = ['objeto_a_contratar', 'detalle_del_objeto_a_contratar'];
const ESU_DOCUMENT_TYPES = ['pliego', 'estudios_previos', 'anexo_tecnico', 'adenda', 'formatos', 'otro'];

function normTenderText(value) { return normalizeTenderStatusText(value); }

const tenderPositiveTerms = {
  'vigilancia y seguridad privada': 45, 'vigilancia y seguridad': 42, 'servicios de vigilancia': 40, 'servicio de vigilancia': 40,
  'vigilancia armada': 38, 'vigilancia privada': 38, 'vigilancia': 35,
  'seguridad privada': 35, 'seguridad electronica': 35, 'seguridad electrónica': 35, 'cctv': 35,
  'videovigilancia': 35, 'video vigilancia': 35, 'control de acceso': 30, 'biometrico': 22, 'biométrico': 22,
  'alarma': 22, 'monitoreo': 22, 'circuito cerrado': 30, 'guardas': 28, 'cedi': 20, 'bodega': 10
};
const tenderContextualPhysicalSecurityReason = 'vigilancia física contextual';
const tenderDirectServiceReason = 'objeto directo de seguridad ofertable';
const tenderPhysicalSecurityContextTerms = [
  'vigilancia fisica', 'puesto de vigilancia', 'puestos de vigilancia', 'proteccion de instalaciones',
  'proteccion de bienes', 'proteccion de personas', 'bienes y personas', 'custodia', 'seguridad perimetral',
  'servicio canino', 'vigilancia canina', 'con armas', 'sin armas', 'sedes institucionales'
].map(normTenderText);
const tenderNonOfferableDirectIntentTerms = [
  'servicios profesionales', 'servicio profesional', 'apoyo a la gestion', 'apoyo a la gestión',
  'consultoria', 'consultoría', 'asesoria juridica', 'asesoría jurídica', 'acompanamiento juridico', 'acompañamiento jurídico',
  'supervision', 'supervisión', 'interventoria', 'interventoría', 'asistencia tecnica', 'asistencia técnica',
  'asesoria', 'asesoría', 'acompanamiento', 'acompañamiento',
  'arrendamiento', 'cafeteria', 'cafetería', 'aire acondicionado', 'compra de inmuebles',
  'adquisicion de inmuebles', 'adquisición de inmuebles', 'compraventa de inmuebles'
].map(normTenderText);
const tenderCoreServiceTerms = new Set([...TENDER_CORE_SERVICE_TERMS, tenderContextualPhysicalSecurityReason]);
const tenderFocusTerms = { 'bogotá': 22, 'bogota': 22, 'distrito capital': 20, 'medellín': 22, 'medellin': 22, 'antioquia': 14 };
const tenderPositiveEntries = Object.entries(tenderPositiveTerms).map(([term, pts]) => [term, pts, normTenderText(term), tenderCoreServiceTerms.has(term)]).sort((a, b) => b[2].length - a[2].length);

function tenderText(row) { return normTenderText(Object.values(row || {}).filter(v => typeof v === 'string').join(' ')); }
function tenderObjectText(row, nameFields) {
  if (!Array.isArray(nameFields) || !nameFields.length) return tenderText(row);
  return normTenderText(nameFields.map(field => (typeof row?.[field] === 'string' ? row[field] : '')).join(' '));
}
function tenderObjectParts(row, nameFields) {
  const fields = Array.isArray(nameFields) && nameFields.length ? nameFields : ['title', 'desc'];
  return fields.map(field => normTenderText(typeof row?.[field] === 'string' ? row[field] : '')).filter(Boolean);
}
function tenderMoney(value) { const n = Number(String(value || '0').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; }
function tenderDate(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function tenderDaysUntil(value) { const d = tenderDate(value); if (!d) return null; const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0); return Math.round((d.getTime() - today.getTime()) / 86400000); }
function tenderWindow(days) { if (days === null) return 'sin fecha de cierre reportada'; if (days <= 7) return 'urgente (0-7 días)'; if (days <= 15) return 'revisar rápido (8-15 días)'; if (days <= 30) return 'buena ventana (16-30 días)'; return 'ventana amplia'; }

function hasTenderPhysicalSecurityContext(text) {
  return text.includes(normTenderText('vigilancia')) && tenderPhysicalSecurityContextTerms.some(term => text.includes(term));
}
function hasDirectOfferableTenderIntent(row, nameFields) {
  const parts = tenderObjectParts(row, nameFields);
  if (!parts.length) return false;
  const primary = parts[0];
  if (tenderNonOfferableDirectIntentTerms.some(term => primary.includes(term))) return false;
  const hasService = text => Array.from(tenderCoreServiceTerms).some(term => term !== tenderContextualPhysicalSecurityReason && text.includes(normTenderText(term)))
    || (text.includes(normTenderText('vigilancia')) && hasTenderPhysicalSecurityContext(text));
  if (hasService(primary)) return true;
  const directProcurementCue = /(contratar|prestacion|prestar|servicio|suministro|adquisicion|instalacion|mantenimiento|operacion|implementacion|puesta en funcionamiento)/;
  return parts.slice(1).some(part => hasService(part) && directProcurementCue.test(part));
}
function scoreTender(row, nameFields) {
  const objectText = tenderObjectText(row, nameFields);
  const text = tenderText(row); let score = 0; const reasons = []; const risks = [];
  const matchedPositiveTerms = [];
  for (const [term, pts, normalizedTerm] of tenderPositiveEntries) {
    if (objectText.includes(normalizedTerm) && !matchedPositiveTerms.some(matched => matched.includes(normalizedTerm) || normalizedTerm.includes(matched))) {
      matchedPositiveTerms.push(normalizedTerm);
      score += pts;
      reasons.push(term);
    }
  }
  if (reasons.includes('vigilancia') && hasTenderPhysicalSecurityContext(objectText)) {
    reasons.push(tenderContextualPhysicalSecurityReason);
  }
  if (hasDirectOfferableTenderIntent(row, nameFields)) reasons.unshift(tenderDirectServiceReason);
  const matchedFocusTerms = new Set();
  for (const [term, pts] of Object.entries(tenderFocusTerms)) {
    const normalizedTerm = normTenderText(term);
    if (!matchedFocusTerms.has(normalizedTerm) && text.includes(normalizedTerm)) {
      matchedFocusTerms.add(normalizedTerm);
      score += pts;
      reasons.push(`zona foco: ${term}`);
    }
  }
  for (const term of TENDER_DISQUALIFYING_TERMS) if (text.includes(normTenderText(term))) risks.push(`no ofertable: ${term}`);
  const value = tenderMoney(row.precio_base || row.cuantia_proceso);
  if (value >= 500000000) { score += 25; reasons.push('valor alto'); }
  else if (value > 0 && value < 50000000) { score -= 15; risks.push('valor bajo'); }
  if (!value) risks.push('valor no reportado / $0; validar');
  return { score, reasons: [...new Set(reasons)].slice(0, 7), risks: [...new Set(risks)].slice(0, 5) };
}
function classifyTenderSection(tender) {
  if (tender.risks.some(r => r.includes('no ofertable'))) return 'prioridad_baja';
  if (tender.score < 70 || (tender.value > 0 && tender.value < 50000000)) return 'prioridad_baja';
  if (tender.days === null || tender.days === undefined) return 'revisar';
  if (tender.days <= 10 || tender.score >= 180 || tender.value >= 1000000000) return 'hacer';
  return 'revisar';
}
function stableTenderKey(tender) {
  const base = [tender.source, tender.process_id || tender.ref, tender.entity, tender.title].map(v => normTenderText(v)).join('|');
  return createHash('sha1').update(base).digest('hex').slice(0, 20);
}
function isEsuTenderTrackable(item) {
  const text = tenderText(item?.raw || item || {});
  const hasNonSecurityContext = TENDER_NON_SECURITY_CONTEXT_TERMS.some(term => text.includes(normTenderText(term)));
  const isNonCommercialAct = TENDER_NON_COMMERCIAL_ACT_TERMS.some(term => text.includes(normTenderText(term)));
  return !hasNonSecurityContext && !isNonCommercialAct && isTenderTrackableStatus(item) && !TENDER_DISQUALIFYING_TERMS.some(term => text.includes(normTenderText(term)));
}
function normalizeDocumentType(value, filename = '') {
  if (ESU_DOCUMENT_TYPES.includes(value)) return value;
  const name = normTenderText(filename);
  if (name.includes('adenda')) return 'adenda';
  if (name.includes('estudio')) return 'estudios_previos';
  if (name.includes('anexo') || name.includes('tecnico')) return 'anexo_tecnico';
  if (name.includes('formato') || name.endsWith('.zip')) return 'formatos';
  if (name.includes('pliego')) return 'pliego';
  return 'otro';
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
    const href = hrefMatch ? new URL(hrefMatch[1], ESU_CONTRATACION_ORIGIN).toString() : ESU_CONTRATACION_URL;
    processes.push({ cells, url: href });
  }
  return processes;
}
export function parseEsuProcessId(url) {
  const match = String(url || '').match(/\/procesos\/view\/(\d+)/i);
  return match ? match[1] : '';
}
function htmlDecodeBasic(value) {
  return String(value || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ');
}
export function parseEsuProcessDetail(html, url) {
  const clean = String(html || '');
  const plain = stripTenderHtml(clean.replace(/<br\s*\/?\s*>/gi, '\n'));
  const documents = [];
  for (const match of clean.matchAll(/href=["']([^"']*\/procesos\/descargar\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1], ESU_CONTRATACION_ORIGIN).toString();
    const fileName = decodeURIComponent(href.split('/').pop() || '').replace(/\+/g, ' ');
    documents.push({ name: fileName || stripTenderHtml(match[2]) || 'Documento ESU', url: href, type: normalizeDocumentType('', fileName || match[2]) });
  }
  const email = (clean.match(/[A-Z0-9._%+-]+@esu\.com\.co/i) || [null])[0];
  const ciiu = Array.from(clean.matchAll(/>(\d{6}\s*-\s*[^<]+)</g)).slice(0, 12).map(m => stripTenderHtml(m[1]));
  const lines = [];
  for (const label of Object.values(ESU_RELEVANT_CATEGORY_IDS)) if (normTenderText(plain).includes(normTenderText(label))) lines.push(label);
  return { url, email, ciiu, lines: [...new Set(lines)], documents, text: htmlDecodeBasic(plain).slice(0, 4000) };
}
function normalizeEsuProcess(process, detail = null) {
  const cells = process.cells || [];
  const numero = cells[1];
  const objeto = cells[2];
  // 10-cell POST /procesos/buscar layout: [row, numero, objeto, fechaApertura, fechaCierre,
  // estado, UNSPSC codes, categories, blank, actions] — dates/status sit two cells earlier than
  // the 9-cell index layout and there's no funcionario column, only UNSPSC codes/categories.
  const isSearchLayout = cells.length >= 10;
  const tipoProceso = isSearchLayout ? (cells[7] || '') : cells[3];
  const fechaApertura = isSearchLayout ? cells[3] : cells[4];
  const fechaCierre = isSearchLayout ? cells[4] : cells[5];
  const estado = isSearchLayout ? cells[5] : cells[6];
  const funcionario = isSearchLayout ? '' : cells[7];
  const row = {
    nombre_entidad: 'Empresa para la Seguridad y Soluciones Urbanas - ESU',
    departamento_entidad: 'Antioquia',
    municipio_entidad: 'Medellín',
    numero_de_proceso: numero || '',
    objeto_a_contratar: objeto || '',
    detalle_del_objeto_a_contratar: `${tipoProceso || ''} ${estado || ''} ${funcionario || ''} ${(detail?.lines || []).join(' ')} ${(detail?.ciiu || []).join(' ')}`.trim(),
    estado_del_proceso: estado || '',
    fecha_de_cargue_en_el_secop: fechaApertura || null,
    cuantia_proceso: 0,
    ruta_proceso_en_secop_i: process.url || ESU_CONTRATACION_URL
  };
  const scored = scoreTender(row, ESU_SCORE_NAME_FIELDS);
  if (normTenderText(estado).includes('convocado')) { scored.score += 20; scored.reasons = [...new Set([...(scored.reasons || []), 'ESU convocado'])]; }
  if ((detail?.documents || []).length) scored.reasons = [...new Set([...(scored.reasons || []), 'documentos ESU disponibles'])];
  const deadline = fechaCierre || null;
  const days = tenderDaysUntil(deadline);
  const tender = {
    source: 'ESU Contratación',
    entity: row.nombre_entidad, dept: row.departamento_entidad, city: row.municipio_entidad,
    ref: numero || '', process_id: numero || '', title: objeto || 'Sin objeto', desc: [row.detalle_del_objeto_a_contratar, detail?.email ? `Responsable: ${funcionario || ''} (${detail.email})` : ''].filter(Boolean).join(' · '),
    value: 0, status: estado || '', category: (detail?.lines || []).join(', ') || tipoProceso || '',
    published: fechaApertura || null, deadline, days, window: tenderWindow(days),
    score: scored.score, reasons: [...new Set(scored.reasons || [])].slice(0, 7), risks: [...new Set([...(scored.risks || []), 'ESU: validar pliego/anexos en detalle del proceso'])].slice(0, 5),
    url: process.url || ESU_CONTRATACION_URL, raw: { numero, objeto, tipoProceso, fechaApertura, fechaCierre, estado, funcionario, ciiu: detail?.ciiu || [], lines: detail?.lines || [], documents: detail ? detail.documents || [] : [], documents_count: detail?.documents?.length || 0 }
  };
  const withId = { ...tender, section: classifyTenderSection(tender) };
  return { ...withId, id: stableTenderKey(withId), stable_key: stableTenderKey(withId), internal_status: 'nueva', converted_opportunity_id: null };
}

export async function fetchEsuHtml(url, options = {}) {
  const response = await safeOfficialFetch(url, ESU_FETCH_POLICY, { ...options, maxBytes: 10 * 1024 * 1024, headers: { 'User-Agent': 'SN-CRM-ESU-Tenders-Radar/1.0', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`ESU Contratación directo respondió ${response.status}`);
  const html = await response.text();
  if (/Not Acceptable|Mod_Security|Incapsula|_Incapsula_Resource/i.test(html)) throw new Error('bloqueo anti-bot/mod_security de ESU Contratación directo');
  return html;
}
export async function fetchEsuIndexPages(maxPages = 5) {
  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? ESU_CONTRATACION_URL : `${ESU_CONTRATACION_URL}/page:${page}`;
    const pageRows = parseEsuProcessRows(await fetchEsuHtml(url));
    if (!pageRows.length) break;
    rows.push(...pageRows);
    if (pageRows.length < 20) break;
  }
  return rows;
}
function esuSearchBody({ estadoId = '0', categoryIds = [], keyword = '' } = {}) {
  const body = new URLSearchParams();
  body.set('_method', 'POST');
  body.set('data[Proceso][estado_id]', estadoId);
  if (keyword) body.set('data[Proceso][objeto]', keyword);
  for (const id of categoryIds) body.append('data[Categoria][Categoria][]', id);
  return body;
}
export async function searchEsuProcesses(params) {
  const html = await fetchEsuHtml(`${ESU_CONTRATACION_ORIGIN}/procesos/buscar#resultados`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': `${ESU_CONTRATACION_ORIGIN}/procesos/buscar` }, body: esuSearchBody(params) });
  return parseEsuProcessRows(html);
}
export async function fetchEsuProcessDetail(process) {
  if (!process?.url || !parseEsuProcessId(process.url)) return null;
  try {
    return parseEsuProcessDetail(await fetchEsuHtml(process.url), process.url);
  } catch {
    return null;
  }
}
export async function fetchEsuProcesses({ fetchIndexPages = fetchEsuIndexPages, searchProcesses = searchEsuProcesses } = {}) {
  const seen = new Map();
  let successfulTraversals = 0;
  let lastTraversalError = null;
  const addRows = rows => {
    for (const row of rows || []) {
      const key = parseEsuProcessId(row.url) || `${row.cells?.[1]}:${row.cells?.[2]}`;
      if (!seen.has(key)) seen.set(key, row);
    }
  };
  const tryAddRows = async label => {
    try { addRows(await label.run()); successfulTraversals += 1; }
    catch (error) { lastTraversalError = error; console.warn(`ESU recorrido omitido (${label.name}): ${error?.message || error}`); }
  };
  await tryAddRows({ name: 'índice paginado', run: () => fetchIndexPages(5) });
  await tryAddRows({ name: 'convocados', run: () => searchProcesses({ estadoId: '19' }) });
  await tryAddRows({ name: 'categorías relevantes', run: () => searchProcesses({ estadoId: '19', categoryIds: Object.keys(ESU_RELEVANT_CATEGORY_IDS) }) });
  for (const keyword of ESU_RELEVANT_KEYWORDS) await tryAddRows({ name: `keyword ${keyword}`, run: () => searchProcesses({ estadoId: '19', keyword }) });
  // Every index/search traversal failing means we never actually reached ESU Contratación this
  // run: silently returning [] would read as "0 processes right now" (success_empty) instead of
  // the truth, that the source was unreachable. At least one successful traversal (even with 0
  // rows) is required before an empty result can be trusted as a real empty result.
  if (!successfulTraversals) {
    const reason = lastTraversalError?.message || 'todos los recorridos de índice/búsqueda fallaron';
    throw new Error(`ESU Contratación directo no disponible: ${reason}`);
  }
  const preliminary = Array.from(seen.values()).map(row => normalizeEsuProcess(row)).filter(t => t.days === null || t.days >= 0).filter(isEsuTenderTrackable).sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999));
  const enriched = [];
  for (const [index, tender] of preliminary.entries()) {
    if (index >= 40) { enriched.push(tender); continue; }
    const sourceRow = seen.get(parseEsuProcessId(tender.url));
    const detail = await fetchEsuProcessDetail(sourceRow);
    enriched.push(normalizeEsuProcess(sourceRow, detail));
  }
  return enriched.filter(t => t.days === null || t.days >= 0).filter(isEsuTenderTrackable).sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999));
}
