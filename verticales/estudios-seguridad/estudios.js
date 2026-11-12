// Estudios de Seguridad Física — registrar un estudio (tramo 1).
//
// Decisiones de Juan (2026-11-05): quien hace el estudio lo registra en SIIO, desde la pantalla o con un agente de
// texto, y el estudio se genera; no se ingresan clientes (vienen de Avancys o del CRM) y los Excel no se importan.
// Aquí sólo hay datos de captura. La valoración no se guarda: se calcula al leer con la metodología del estudio, así
// nadie puede escribir un nivel encima de la fórmula.
//
// El permiso de módulo (`estudios_seguridad`) lo exige la ruta. Dentro del módulo, en este tramo, cualquiera que lo
// tenga puede editar un estudio en borrador o devuelto: el flujo preparador → revisor → aprobador llega en el tramo 3.

import { METODOLOGIAS, METODOLOGIA_V1, METODOLOGIA_VIGENTE, valorarRiesgo, valorarSegunGuia } from './metodologia.js';
import { PLANTILLAS } from './plantilla.js';
import { listEvidence } from './evidencias.js';
import { cleanCharacterization, loadCharacterization } from './caracterizacion.js';
import { loadSecurityOps } from './securityops.js';
import { suggestProbability, suggestionsForStudy } from './sugerencia.js';
import { RENEWAL_MONTHS, studyValidity } from './vigencia.js';
import { findPreviousStudy, loadComparison, validatePrevious } from './comparacion.js';
import { guidedView, loadAnswers } from './recorrido.js';
import { cleanControlDetails } from './corbatin.js';

export const STUDY_TABLE = 'psi_security_studies';
export const ZONE_TABLE = 'psi_security_study_zones';
export const RISK_TABLE = 'psi_security_study_risks';
export const ACTION_TABLE = 'psi_security_study_actions';

const EDITABLE_STATUSES = new Set(['borrador', 'devuelto']);
// Cliente único (Juan, 2026-11-12): "estudios de seguridad debe usar solo los clientes que avancys le va a traer".
// El cliente sale de Avancys con su NIT; la sede, de sus puestos en Avancys o escrita a mano.
const CLIENT_SOURCES = new Set(['avancys']);
const SITE_SOURCES = new Set(['avancys_puesto', 'manual']);
const ACTION_STATUSES = new Set(['pendiente', 'en_curso', 'cumplida', 'descartada']);
const PRIORITIES = new Set(['alta', 'media', 'baja']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function text(value, { field, min = 0, max }) {
  if (value !== undefined && value !== null && typeof value !== 'string') throw invalid(`${field}: debe ser texto.`);
  const clean = typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').trim() : '';
  if (clean.length < min) throw invalid(`${field}: dato obligatorio.`);
  if (clean.length > max) throw invalid(`${field}: máximo ${max} caracteres.`);
  return clean || null;
}

function isoDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw invalid(`${field}: fecha inválida (AAAA-MM-DD).`);
  return value;
}

function scale(value, field, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(number) || number < 1 || number > 5) throw invalid(`${field}: debe ser un número entero de 1 a 5.`);
  return number;
}

function uuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`${field}: identificador inválido.`);
  return value;
}

// Un control se califica completo (calidad, eficacia y eficiencia) o no se califica.
function rating(body, prefix, label) {
  const keys = ['quality', 'efficacy', 'efficiency'];
  const given = keys.filter(key => ![undefined, null, ''].includes(body[`${prefix}_${key}`]));
  if (given.length === 0) return { [`${prefix}_quality`]: null, [`${prefix}_efficacy`]: null, [`${prefix}_efficiency`]: null };
  if (given.length < 3) throw invalid(`${label}: califique calidad, eficacia y eficiencia, o deje las tres vacías.`);
  return Object.fromEntries(keys.map(key => [`${prefix}_${key}`, scale(body[`${prefix}_${key}`], `${label} (${key === 'quality' ? 'calidad' : key === 'efficacy' ? 'eficacia' : 'eficiencia'})`)]));
}

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

async function readStudy(db, id) {
  const study = await must(db.from(STUDY_TABLE).select('*').eq('id', uuid(id, 'Estudio')).maybeSingle());
  if (!study) throw invalid('Estudio no encontrado.', 404);
  return study;
}

async function requireEditable(db, studyId) {
  const study = await readStudy(db, studyId);
  if (!EDITABLE_STATUSES.has(study.status)) throw invalid('El estudio no está en borrador: no se puede modificar.', 409);
  return study;
}

async function touch(db, studyId, stamp) {
  await must(db.from(STUDY_TABLE).update({ updated_at: stamp }).eq('id', studyId));
}

export function cleanStudyInput(body = {}) {
  const clientSource = CLIENT_SOURCES.has(body.client_source) ? body.client_source : null;
  if (!clientSource) throw invalid('Elija el cliente de Avancys: los clientes no se escriben a mano.');
  const siteSource = SITE_SOURCES.has(body.site_source) ? body.site_source : null;
  if (!siteSource) throw invalid('Origen de la sede inválido.');
  const siteRef = text(body.site_ref, { field: 'Sede', max: 120 });
  if (siteSource !== 'manual' && !siteRef) throw invalid('Sede: falta la referencia de la fuente.');
  return {
    title: text(body.title, { field: 'Título', min: 3, max: 200 }),
    client_source: clientSource,
    client_ref: text(body.client_ref, { field: 'Cliente', min: 1, max: 80 }),
    client_name: text(body.client_name, { field: 'Cliente', min: 2, max: 200 }),
    client_nit: text(body.client_nit, { field: 'NIT', max: 30 }),
    opportunity_id: body.opportunity_id ? uuid(body.opportunity_id, 'Oportunidad') : null,
    site_source: siteSource,
    site_ref: siteRef,
    site_name: text(body.site_name, { field: 'Sede', min: 2, max: 200 }),
    site_city: text(body.site_city, { field: 'Ciudad', max: 80 }),
    site_address: text(body.site_address, { field: 'Dirección', max: 300 }),
    scope: text(body.scope, { field: 'Alcance', max: 4000 }),
    visit_date: isoDate(body.visit_date, 'Fecha de visita'),
    // Migración 209: cada cuánto se renueva (Héctor: mínimo cada 6 meses, máximo cada 3 años).
    ...(body.renewal_months !== undefined && body.renewal_months !== null && body.renewal_months !== '' ? { renewal_months: renewal(body.renewal_months) } : {}),
  };
}

export async function createStudy(db, body, profile, now = new Date()) {
  const stamp = now.toISOString();
  const row = { ...cleanStudyInput(body), methodology_id: METODOLOGIA_VIGENTE.id, prepared_by: profile.id, created_at: stamp, updated_at: stamp };
  // Migración 212: el estudio anterior de la misma sede (el último aprobado del mismo cliente y sede), para comparar.
  // Sólo si hay uno: así un estudio se puede crear aunque la migración 212 no se haya aplicado.
  const previous = await findPreviousStudy(db, row);
  if (previous) row.previous_study_id = previous;
  return must(db.from(STUDY_TABLE).insert(row).select('*').single());
}

// Datos generales que se pueden corregir en borrador. Cliente y sede se cambian completos, nunca a medias.
export async function updateStudy(db, id, body = {}, profile, now = new Date()) {
  const current = await requireEditable(db, id);
  const patch = {};
  if (body.title !== undefined) patch.title = text(body.title, { field: 'Título', min: 3, max: 200 });
  if (body.scope !== undefined) patch.scope = text(body.scope, { field: 'Alcance', max: 4000 });
  if (body.visit_date !== undefined) patch.visit_date = isoDate(body.visit_date, 'Fecha de visita');
  if (body.renewal_months !== undefined) patch.renewal_months = renewal(body.renewal_months);
  if (body.previous_study_id !== undefined) patch.previous_study_id = await validatePrevious(db, current, body.previous_study_id);
  Object.assign(patch, cleanCharacterization(body));
  if (body.client_source !== undefined || body.site_source !== undefined) {
    const merged = cleanStudyInput({ ...current, ...body });
    Object.assign(patch, {
      client_source: merged.client_source, client_ref: merged.client_ref, client_name: merged.client_name, client_nit: merged.client_nit,
      opportunity_id: merged.opportunity_id, site_source: merged.site_source, site_ref: merged.site_ref, site_name: merged.site_name,
      site_city: merged.site_city, site_address: merged.site_address,
    });
  }
  if (Object.keys(patch).length === 0) throw invalid('No hay cambios para guardar.');
  patch.updated_at = now.toISOString();
  return must(db.from(STUDY_TABLE).update(patch).eq('id', current.id).select('*').single());
}

export async function listStudies(db, now = new Date()) {
  const studies = await must(db.from(STUDY_TABLE)
    .select('*')
    .order('updated_at', { ascending: false }));
  const risks = await must(db.from(RISK_TABLE).select('study_id, number, title, catalog_risk_code, probability, suggested_probability'));
  const count = new Map();
  const byStudy = new Map();
  for (const risk of risks || []) {
    count.set(risk.study_id, (count.get(risk.study_id) || 0) + 1);
    byStudy.set(risk.study_id, [...(byStudy.get(risk.study_id) || []), risk]);
  }
  // Migración 209: la vigencia de cada estudio (aprobación de la última versión, frecuencia y siniestros posteriores).
  // Tablero de alertas de la sección (Juan, 2026-11-11: "en la sección de estudio de seguridad … no en gerencia"):
  // entregas pendientes y recomendaciones vencidas.
  const [versions, secops, deliveries, actions] = await Promise.all([
    db.from('psi_security_study_versions').select('study_id, version, approved_at'),
    db.from('psi_security_study_securityops').select('study_id, puesto_id, status, summary'),
    db.from('psi_security_study_deliveries').select('study_id, version'),
    db.from(ACTION_TABLE).select('study_id, due_date, status, responsible_party').in('status', ['pendiente', 'en_curso']),
  ]);
  const delivered = new Set(((deliveries.error ? [] : deliveries.data) || []).map(row => `${row.study_id}:${row.version}`));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
  const overdue = new Map();
  for (const action of (actions.error ? [] : actions.data) || []) {
    // La fecha llega como texto desde supabase-js y como Date desde otros lectores.
    const due = action.due_date instanceof Date ? action.due_date.toISOString().slice(0, 10) : String(action.due_date || '').slice(0, 10);
    if (!due || due >= today) continue;
    const entry = overdue.get(action.study_id) || { nuestras: 0, cliente: 0 };
    entry[action.responsible_party === 'cliente' ? 'cliente' : 'nuestras'] += 1;
    overdue.set(action.study_id, entry);
  }
  const approvedAt = new Map();
  for (const row of (versions.error ? [] : versions.data) || []) {
    const prev = approvedAt.get(row.study_id);
    if (!prev || row.version > prev.version) approvedAt.set(row.study_id, row);
  }
  const ops = new Map(((secops.error ? [] : secops.data) || []).map(row => [row.study_id, row]));
  return (studies || []).map(study => ({
    id: study.id, code: study.code, title: study.title, status: study.status, client_name: study.client_name, site_name: study.site_name,
    site_city: study.site_city, visit_date: study.visit_date, prepared_by: study.prepared_by, created_at: study.created_at, updated_at: study.updated_at,
    risk_count: count.get(study.id) || 0,
    latest_version: approvedAt.get(study.id)?.version ?? null,
    delivered: approvedAt.has(study.id) ? delivered.has(`${study.id}:${approvedAt.get(study.id).version}`) : null,
    overdue_actions: overdue.get(study.id) || { nuestras: 0, cliente: 0 },
    // El indicador por riesgo sólo mira estudios aprobados: los riesgos de la base son los de la versión vigente.
    validity: studyValidity(study, {
      approvedAt: approvedAt.get(study.id)?.approved_at || null, securityops: ops.get(study.id)?.puesto_id === study.securityops_puesto_id ? { data: ops.get(study.id) } : null,
      risks: study.status === 'aprobado' ? byStudy.get(study.id) || [] : null, catalog: PLANTILLAS[study.template_id] || null, now,
    }),
  }));
}

function controlFrom(row, prefix) {
  return row[`${prefix}_quality`] == null ? null
    : { calidad: row[`${prefix}_quality`], eficacia: row[`${prefix}_efficacy`], eficiencia: row[`${prefix}_efficiency`] };
}

export function valuateRisk(row, methodologyId = METODOLOGIA_V1.id) {
  const metodologia = METODOLOGIAS[methodologyId];
  if (!metodologia) throw invalid(`Metodología desconocida: ${methodologyId}.`, 500);
  // La guía (2026-11-11): un solo impacto y la probabilidad residual escogida por el analista.
  if (metodologia.probabilidadResidualEscogida) {
    return valorarSegunGuia({
      probabilidad: row.probability,
      impacto: row.impact_company,
      probabilidadResidual: row.residual_probability ?? null,
      controlActual: controlFrom(row, 'current'),
      controlPropuesto: controlFrom(row, 'proposed'),
    }, metodologia);
  }
  return valorarRiesgo({
    probabilidad: row.probability,
    impactoEmpresa: row.impact_company,
    impactoPersonas: row.impact_people,
    controlActual: controlFrom(row, 'current'),
    controlPropuesto: controlFrom(row, 'proposed'),
  }, metodologia);
}

export async function getStudy(db, id) {
  const study = await readStudy(db, id);
  const [zones, risks, actions, evidence, characterization, securityops, lastVersion] = await Promise.all([
    must(db.from(ZONE_TABLE).select('*').eq('study_id', study.id).order('position', { ascending: true })),
    must(db.from(RISK_TABLE).select('*').eq('study_id', study.id).order('number', { ascending: true })),
    must(db.from(ACTION_TABLE).select('*').eq('study_id', study.id).order('created_at', { ascending: true })),
    listEvidence(db, study.id),
    loadCharacterization(db, study.id),
    loadSecurityOps(db, study),
    db.from('psi_security_study_versions').select('approved_at').eq('study_id', study.id).order('version', { ascending: false }).limit(1),
  ]);
  const valued = (risks || []).map(risk => ({ ...risk, valuation: valuateRisk(risk, study.methodology_id) }));
  // Migración 214: el recorrido guiado (respuestas y lo que proponen).
  const guidedAnswers = await loadAnswers(db, study.id);
  // Migración 212: la comparación con el estudio anterior de la misma sede.
  const comparison = await loadComparison(db, study, valued, study.methodology_id);
  const levels = { actual: {}, residual: {} };
  for (const risk of valued) {
    levels.actual[risk.valuation.actual.nivel] = (levels.actual[risk.valuation.actual.nivel] || 0) + 1;
    levels.residual[risk.valuation.residual.nivel] = (levels.residual[risk.valuation.residual.nivel] || 0) + 1;
  }
  const template = PLANTILLAS[study.template_id] || null;
  return {
    study,
    zones: zones || [],
    risks: valued,
    actions: actions || [],
    evidence: evidence.evidence,
    evidence_available: evidence.available,
    characterization,
    securityops,
    comparison,
    guided_answers: guidedAnswers || [],
    recorrido: guidedView(guidedAnswers, template ? { riesgos: template.riesgos } : null, valued),
    // Migración 209: vigencia y revaloración.
    validity: studyValidity(study, {
      approvedAt: lastVersion?.error ? null : lastVersion?.data?.[0]?.approved_at || null, securityops,
      risks: study.status === 'aprobado' ? valued : null, catalog: template, }),
    // IEC 31010: la probabilidad que sugieren los datos para cada riesgo del catálogo y para uno propio.
    probability_suggestions: suggestionsForStudy({ catalog: template ? { riesgos: template.riesgos } : null, securityops, crimeStats: characterization?.estadisticas || [] }),
    summary: { risks: valued.length, levels },
    editable: EDITABLE_STATUSES.has(study.status),
    methodology: METODOLOGIAS[study.methodology_id] || null,
    catalog: template ? { procesos: template.procesos, riesgos: template.riesgos } : null,
  };
}

// --- Zonas ---------------------------------------------------------------------------------------------------

function cleanZone(body) {
  return {
    name: text(body.name, { field: 'Zona', min: 2, max: 160 }),
    description: text(body.description, { field: 'Descripción', max: 2000 }),
  };
}

export async function addZone(db, studyId, body = {}, profile, now = new Date()) {
  const study = await requireEditable(db, studyId);
  const existing = await must(db.from(ZONE_TABLE).select('position').eq('study_id', study.id));
  const position = Math.max(0, ...(existing || []).map(zone => zone.position)) + 1;
  const stamp = now.toISOString();
  const zone = await must(db.from(ZONE_TABLE).insert({ ...cleanZone(body), study_id: study.id, position, created_at: stamp, updated_at: stamp }).select('*').single());
  await touch(db, study.id, stamp);
  return zone;
}

async function readChild(db, table, studyId, childId, label) {
  const row = await must(db.from(table).select('*').eq('id', uuid(childId, label)).eq('study_id', studyId).maybeSingle());
  if (!row) throw invalid(`${label}: no existe en este estudio.`, 404);
  return row;
}

export async function updateZone(db, studyId, zoneId, body = {}, profile, now = new Date()) {
  const study = await requireEditable(db, studyId);
  const current = await readChild(db, ZONE_TABLE, study.id, zoneId, 'Zona');
  const stamp = now.toISOString();
  const zone = await must(db.from(ZONE_TABLE).update({ ...cleanZone({ ...current, ...body }), updated_at: stamp }).eq('id', current.id).select('*').single());
  await touch(db, study.id, stamp);
  return zone;
}

export async function deleteZone(db, studyId, zoneId, profile, now = new Date()) {
  const study = await requireEditable(db, studyId);
  const current = await readChild(db, ZONE_TABLE, study.id, zoneId, 'Zona');
  // Los riesgos de la zona no se borran: quedan sin zona (on delete set null) para no perder trabajo.
  await must(db.from(ZONE_TABLE).delete().eq('id', current.id));
  await touch(db, study.id, now.toISOString());
  return { deleted: current.id };
}

// --- Riesgos -------------------------------------------------------------------------------------------------

function renewal(value) {
  const months = Number(value);
  if (!RENEWAL_MONTHS.has(months)) throw invalid('Renovación: cada 6, 12, 24 o 36 meses.');
  return months;
}

const CONFIDENCE = new Set(['alta', 'media', 'baja']);
function confidence(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!CONFIDENCE.has(value)) throw invalid('Confianza: alta, media o baja.');
  return value;
}

// IEC 31010 (Juan, 2026-11-11): la plataforma sugiere la probabilidad con los datos; si el analista se aparta, escribe
// por qué. Se guarda la sugerida junto a la escogida, para poder medir después la diferencia.
async function studySignals(db, study) {
  const [securityops, characterization] = await Promise.all([loadSecurityOps(db, study), loadCharacterization(db, study.id)]);
  return { securityops, crimeStats: characterization?.estadisticas || [] };
}

/** Para validar varios riesgos antes de crear el primero (la nota de campo no deja nada a medias). */
export async function probabilityChecker(db, study) {
  const catalog = PLANTILLAS[study.template_id];
  const signals = await studySignals(db, study);
  return row => applyProbabilityRule(row, suggestProbability({ catalogCode: row.catalog_risk_code, catalog, ...signals }));
}

function applyProbabilityRule(row, suggestion) {
  row.suggested_probability = suggestion?.probabilidad ?? null;
  if (suggestion && row.probability !== suggestion.probabilidad && (row.probability_basis || '').length < 10) {
    throw invalid(`Probabilidad: los datos sugieren ${suggestion.probabilidad} (${suggestion.significado}; ${suggestion.fuente}). Si escoge otra, explique por qué en la justificación.`);
  }
  return row;
}

export function cleanRiskInput(body = {}, catalog = null) {
  const catalogCode = text(body.catalog_risk_code, { field: 'Riesgo del catálogo', max: 10 });
  if (catalogCode && catalog && !catalog.riesgos.some(item => item.codigo === catalogCode)) throw invalid('Riesgo del catálogo inválido.');
  const processCode = text(body.process_code, { field: 'Proceso', max: 10 });
  if (processCode && catalog && !catalog.procesos.some(item => item.codigo === processCode)) throw invalid('Proceso inválido.');
  const row = {
    zone_id: body.zone_id ? uuid(body.zone_id, 'Zona') : null,
    catalog_risk_code: catalogCode,
    process_code: processCode,
    title: text(body.title, { field: 'Riesgo', min: 3, max: 300 }),
    // Del informe real (HADA): el proceso es del cliente (Gestión Humana, Producción…) y el factor, p. ej.
    // "Humano – Procedimental – Estratégico". El proceso del catálogo queda como clasificación técnica.
    client_process: text(body.client_process, { field: 'Proceso del cliente', max: 120 }),
    risk_factor: text(body.risk_factor, { field: 'Factor de riesgo', max: 200 }),
    causes: text(body.causes, { field: 'Causas', max: 4000 }),
    consequences: text(body.consequences, { field: 'Consecuencias', max: 4000 }),
    probability: scale(body.probability, 'Probabilidad'),
    impact_company: scale(body.impact_company, 'Impacto sobre la empresa'),
    // La guía tiene un solo impacto: si no llega el de personas, es el mismo (la metodología v1 usaba el mayor).
    impact_people: scale(body.impact_people ?? body.impact_company, 'Impacto sobre personas'),
    residual_probability: scale(body.residual_probability, 'Probabilidad residual', { optional: true }),
    // IEC 31010 (migración 208): por qué esa probabilidad, qué tan seguro está el analista y con qué supuestos.
    probability_basis: text(body.probability_basis, { field: 'Justificación de la probabilidad', max: 1000 }),
    confidence: confidence(body.confidence),
    assumptions: text(body.assumptions, { field: 'Supuestos', max: 2000 }),
    current_control: text(body.current_control, { field: 'Control existente', max: 4000 }),
    ...rating(body, 'current', 'Control existente'),
    proposed_control: text(body.proposed_control, { field: 'Control propuesto', max: 4000 }),
    ...rating(body, 'proposed', 'Control propuesto'),
  };
  // Migración 216: el dueño del riesgo (opcional) y los datos de cada control, contra los renglones de los controles.
  row.risk_owner = text(body.risk_owner, { field: 'Dueño del riesgo', max: 200 });
  row.control_details = cleanControlDetails(body.control_details, row);
  return row;
}

async function requireZoneInStudy(db, studyId, zoneId) {
  if (!zoneId) return;
  await readChild(db, ZONE_TABLE, studyId, zoneId, 'Zona');
}

export async function addRisk(db, studyId, body = {}, profile, { now = new Date(), origin = 'manual', sourceRef = null } = {}) {
  const study = await requireEditable(db, studyId);
  const catalog = PLANTILLAS[study.template_id];
  const row = cleanRiskInput(body, catalog);
  applyProbabilityRule(row, suggestProbability({ catalogCode: row.catalog_risk_code, catalog, ...(await studySignals(db, study)) }));
  await requireZoneInStudy(db, study.id, row.zone_id);
  const numbers = await must(db.from(RISK_TABLE).select('number').eq('study_id', study.id));
  const number = Math.max(0, ...(numbers || []).map(risk => risk.number)) + 1;
  const stamp = now.toISOString();
  const risk = await must(db.from(RISK_TABLE).insert({
    ...row, study_id: study.id, number, origin: origin === 'agente' || origin === 'securityops' ? origin : 'manual',
    // Migración 201: el riesgo que sale de SecurityOps lleva la alerta o nota de donde salió.
    ...(origin === 'securityops' ? { source_ref: sourceRef } : {}),
    created_by: profile.id, created_at: stamp, updated_at: stamp,
  }).select('*').single());
  await touch(db, study.id, stamp);
  return { ...risk, valuation: valuateRisk(risk, study.methodology_id) };
}

export async function updateRisk(db, studyId, riskId, body = {}, profile, now = new Date()) {
  const study = await requireEditable(db, studyId);
  const current = await readChild(db, RISK_TABLE, study.id, riskId, 'Riesgo');
  const catalog = PLANTILLAS[study.template_id];
  const row = cleanRiskInput({ ...current, ...body }, catalog);
  // Sólo se vuelve a sugerir si cambia la probabilidad o el riesgo del catálogo: editar un texto no exige justificar de
  // nuevo porque SecurityOps se haya actualizado entretanto.
  if (row.probability !== current.probability || (row.catalog_risk_code ?? null) !== (current.catalog_risk_code ?? null)) {
    applyProbabilityRule(row, suggestProbability({ catalogCode: row.catalog_risk_code, catalog, ...(await studySignals(db, study)) }));
  }
  await requireZoneInStudy(db, study.id, row.zone_id);
  const stamp = now.toISOString();
  const risk = await must(db.from(RISK_TABLE).update({ ...row, updated_at: stamp }).eq('id', current.id).select('*').single());
  await touch(db, study.id, stamp);
  return { ...risk, valuation: valuateRisk(risk, study.methodology_id) };
}

export async function deleteRisk(db, studyId, riskId, profile, now = new Date()) {
  const study = await requireEditable(db, studyId);
  const current = await readChild(db, RISK_TABLE, study.id, riskId, 'Riesgo');
  await must(db.from(RISK_TABLE).delete().eq('id', current.id));
  await touch(db, study.id, now.toISOString());
  return { deleted: current.id };
}

// --- Acciones del plan de tratamiento --------------------------------------------------------------------------

function cleanAction(body) {
  const status = body.status ?? 'pendiente';
  if (!ACTION_STATUSES.has(status)) throw invalid('Estado de la acción inválido.');
  const priority = body.priority ?? 'media';
  if (!PRIORITIES.has(priority)) throw invalid('Prioridad inválida.');
  return {
    description: text(body.description, { field: 'Acción', min: 3, max: 1000 }),
    owner_label: text(body.owner_label, { field: 'Responsable', max: 120 }),
    due_date: isoDate(body.due_date, 'Fecha compromiso'),
    priority,
    status,
    // Migración 205: a cargo de Seguridad Nacional o del cliente. Sólo las nuestras pasan a Seguimiento gerencial.
    responsible_party: party(body.responsible_party),
  };
}

const PARTIES = new Set(['seguridad_nacional', 'cliente']);
function party(value) {
  if (value === undefined || value === null || value === '') return 'seguridad_nacional';
  if (!PARTIES.has(value)) throw invalid('A cargo de: Seguridad Nacional o el cliente.');
  return value;
}

export async function addAction(db, studyId, body = {}, profile, now = new Date()) {
  const study = await requireEditable(db, studyId);
  const risk = await readChild(db, RISK_TABLE, study.id, body.risk_id, 'Riesgo');
  const stamp = now.toISOString();
  const action = await must(db.from(ACTION_TABLE).insert({
    ...cleanAction(body), study_id: study.id, risk_id: risk.id, created_by: profile.id, created_at: stamp, updated_at: stamp,
  }).select('*').single());
  await touch(db, study.id, stamp);
  return action;
}

export async function updateAction(db, studyId, actionId, body = {}, profile, now = new Date()) {
  const study = await requireEditable(db, studyId);
  const current = await readChild(db, ACTION_TABLE, study.id, actionId, 'Acción');
  const stamp = now.toISOString();
  const action = await must(db.from(ACTION_TABLE).update({ ...cleanAction({ ...current, ...body }), updated_at: stamp }).eq('id', current.id).select('*').single());
  await touch(db, study.id, stamp);
  return action;
}

export async function deleteAction(db, studyId, actionId, profile, now = new Date()) {
  const study = await requireEditable(db, studyId);
  const current = await readChild(db, ACTION_TABLE, study.id, actionId, 'Acción');
  await must(db.from(ACTION_TABLE).delete().eq('id', current.id));
  await touch(db, study.id, now.toISOString());
  return { deleted: current.id };
}
