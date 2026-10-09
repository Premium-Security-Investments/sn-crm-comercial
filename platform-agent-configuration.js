// IT → Agentes → configuración de funciones con IA (puerta única de modelos, Paso 2 "pantallas").
//
// Lectura: PLATFORM_DATABASE_URL (rol `platform_siio_reader`), transacción `read only`, timeout de 5 s.
// Escritura: SÓLO llamando a las funciones `platform.*` con PLATFORM_ADMIN_DATABASE_URL (rol que hereda
// `platform_admin_runtime`). Sin esa variable → 503 "La administración de la plataforma no está conectada.".
// Errores de la base → mensajes neutros (nunca host, cadena de conexión ni texto de Postgres).
//
// La configuración se valida aquí antes de proponerla: sólo las claves escalares admitidas por la plataforma
// (cualquier otra la base la rechaza como "secreto"), enteros 0..1000, periodos día/mes, modelos de una lista
// cerrada, perfiles existentes y no archivados, personas del SIIO y vencimientos que no estén en el pasado.
import pg from 'pg';
import {
  PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS,
  getPlatformPool,
  platformConnectionString,
  platformSslConfig,
  platformUnavailableError,
} from './platform-agents.js';
import { AGT003_AGENT_ID, AGT003_COPILOT_CAPABILITY, AGT003_LEAD_ANALYSIS_CAPABILITY, gatewayEnvironment } from './platform-model-gateway.js';

export const PLATFORM_ADMIN_UNAVAILABLE_MESSAGE = 'La administración de la plataforma no está conectada.';
export const PLATFORM_ADMIN_REJECTED_MESSAGE = 'La plataforma no aceptó el cambio. Actualice la página, revise el estado y vuelva a intentarlo.';
const PLATFORM_ADMIN_UNAVAILABLE_CODE = 'PLATFORM_ADMIN_UNAVAILABLE';
const PLATFORM_ADMIN_REJECTED_CODE = 'PLATFORM_ADMIN_REJECTED';
const PLATFORM_CONFIGURATION_INVALID_CODE = 'PLATFORM_CONFIGURATION_INVALID';

export const CONFIGURATION_TIMEZONE = 'America/Bogota';
export const CAP_MIN = 0;
export const CAP_MAX = 1000;
export const MAX_EXCEPTIONS_PER_FUNCTION = 50;
export const REASON_MAX_LENGTH = 500;

/** Modelos permitidos (lista cerrada). Hoy sólo Sonnet por la suscripción de Claude. */
export const AI_MODEL_OPTIONS = Object.freeze([Object.freeze({ id: 'sonnet', label: 'Sonnet (suscripción)' })]);
/** Plan B si el modelo falla. Por ahora un único valor. */
export const AI_FALLBACK_OPTIONS = Object.freeze([Object.freeze({ id: 'notify', label: 'Avisar y no reintentar' })]);
export const CAP_PERIODS = Object.freeze(['day', 'month']);

/** Catálogo de funciones con IA por agente, con nombres humanos (los IDs técnicos no se muestran a usuarios). */
export const AGENT_AI_FUNCTIONS = Object.freeze({
  [AGT003_AGENT_ID]: Object.freeze([
    Object.freeze({
      capability: AGT003_COPILOT_CAPABILITY,
      label: 'Siguiente paso (copiloto)',
      description: 'Sugiere el siguiente paso con el cliente en la ficha de la oportunidad.',
      default_cap: Object.freeze({ per: 'day', max: 20 }),
    }),
    Object.freeze({
      capability: AGT003_LEAD_ANALYSIS_CAPABILITY,
      label: 'Análisis profundo',
      description: 'Premio por perfil completo del cliente.',
      default_cap: Object.freeze({ per: 'month', max: 30 }),
    }),
  ]),
});
export const NO_AI_FUNCTIONS_TEXT = 'Sin funciones con IA configuradas todavía';

const PROFILE_ID = /^[a-z][a-z0-9_]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_ID = /^AGT-\d{3}$/;

export function agentAiFunctions(agentId) {
  return AGENT_AI_FUNCTIONS[agentId] || [];
}

export function functionLabel(capability) {
  for (const list of Object.values(AGENT_AI_FUNCTIONS)) {
    const found = list.find(item => item.capability === capability);
    if (found) return found.label;
  }
  return 'Función sin nombre';
}

// ---------------------------------------------------------------------------------------------------------------------
// Errores públicos

export function platformAdminUnavailableError() {
  const error = new Error(PLATFORM_ADMIN_UNAVAILABLE_MESSAGE);
  error.status = 503;
  error.code = PLATFORM_ADMIN_UNAVAILABLE_CODE;
  return error;
}

export function platformAdminRejectedError() {
  const error = new Error(PLATFORM_ADMIN_REJECTED_MESSAGE);
  error.status = 409;
  error.code = PLATFORM_ADMIN_REJECTED_CODE;
  return error;
}

export function configurationInvalidError(problems, status = 400) {
  const list = Array.isArray(problems) ? problems : [String(problems)];
  const error = new Error(list.length === 1 ? list[0] : `Revise los datos: ${list.join(' ')}`);
  error.status = status;
  error.code = PLATFORM_CONFIGURATION_INVALID_CODE;
  error.problems = list;
  return error;
}

/** Errores de esta capa que se pueden mostrar tal cual (mensajes neutros escritos aquí). */
export function isPlatformConfigurationPublicError(error) {
  return [PLATFORM_ADMIN_UNAVAILABLE_CODE, PLATFORM_ADMIN_REJECTED_CODE, PLATFORM_CONFIGURATION_INVALID_CODE].includes(error?.code);
}

// ---------------------------------------------------------------------------------------------------------------------
// Fechas (Bogotá)

const bogotaDay = new Intl.DateTimeFormat('en-CA', { timeZone: CONFIGURATION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export function bogotaToday(now = new Date()) {
  return bogotaDay.format(now);
}

function isRealDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// ---------------------------------------------------------------------------------------------------------------------
// Configuración por defecto y validación

/** Configuración con los valores actuales del código (para que la primera propuesta sea la versión 1). */
export function defaultAgentConfiguration(agentId, limits = {}) {
  const functions = agentAiFunctions(agentId);
  if (!functions.length) return null;
  const capabilities = {};
  for (const item of functions) {
    const known = limits[item.capability];
    const cap = known && CAP_PERIODS.includes(known.period) && Number.isInteger(known.max)
      ? { per: known.period, max: Math.min(CAP_MAX, Math.max(CAP_MIN, known.max)) }
      : { ...item.default_cap };
    capabilities[item.capability] = { enabled: true, model: AI_MODEL_OPTIONS[0].id, fallback: AI_FALLBACK_OPTIONS[0].id, team_cap: cap };
  }
  return { timezone: CONFIGURATION_TIMEZONE, capabilities };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unknownKeys(object, allowed) {
  return Object.keys(object).filter(key => !allowed.includes(key));
}

function capInt(value) {
  return Number.isInteger(value) && value >= CAP_MIN && value <= CAP_MAX;
}

/**
 * Valida y normaliza una configuración propuesta. Devuelve un objeto nuevo con sólo las claves admitidas.
 * `context`: { agentId, profileIds: Set<string> (perfiles de uso no archivados), personIds: Set<string> (personas del
 * SIIO activas), today: 'YYYY-MM-DD' en Bogotá }. Lanza `configurationInvalidError` con todos los problemas.
 */
export function normalizeProposedConfiguration(raw, { agentId, profileIds = new Set(), personIds = new Set(), today } = {}) {
  const problems = [];
  const functions = agentAiFunctions(agentId);
  if (!functions.length) throw configurationInvalidError(`${agentId || 'El agente'} no tiene funciones con IA configurables.`);
  if (!isPlainObject(raw)) throw configurationInvalidError('La configuración no tiene el formato esperado.');
  const extraRoot = unknownKeys(raw, ['timezone', 'capabilities']);
  if (extraRoot.length) problems.push('La configuración trae datos no permitidos.');
  if (raw.timezone !== CONFIGURATION_TIMEZONE) problems.push('La zona horaria debe ser la de Bogotá.');
  const rawCapabilities = isPlainObject(raw.capabilities) ? raw.capabilities : null;
  if (!rawCapabilities) throw configurationInvalidError([...problems, 'Faltan las funciones con IA.']);
  const known = functions.map(item => item.capability);
  if (Object.keys(rawCapabilities).some(key => !known.includes(key))) problems.push('La configuración trae funciones que este agente no tiene.');
  const referenceDay = typeof today === 'string' && ISO_DATE.test(today) ? today : bogotaToday();
  const capabilities = {};
  for (const item of functions) {
    const label = item.label;
    const value = rawCapabilities[item.capability];
    if (!isPlainObject(value)) { problems.push(`Falta la configuración de "${label}".`); continue; }
    if (unknownKeys(value, ['enabled', 'model', 'fallback', 'team_cap', 'profile_caps', 'exceptions']).length) problems.push(`"${label}" trae datos no permitidos.`);
    const out = {};
    if (typeof value.enabled !== 'boolean') problems.push(`"${label}": indique si está encendida.`); else out.enabled = value.enabled;
    if (!AI_MODEL_OPTIONS.some(option => option.id === value.model)) problems.push(`"${label}": el modelo no está en la lista permitida.`); else out.model = value.model;
    if (!AI_FALLBACK_OPTIONS.some(option => option.id === value.fallback)) problems.push(`"${label}": el plan B no es válido.`); else out.fallback = value.fallback;
    const team = value.team_cap;
    if (!isPlainObject(team) || unknownKeys(team, ['per', 'max']).length || !CAP_PERIODS.includes(team.per) || !capInt(team.max)) {
      problems.push(`"${label}": el cupo del equipo debe ser un entero entre ${CAP_MIN} y ${CAP_MAX}, por día o por mes.`);
    } else out.team_cap = { per: team.per, max: team.max };
    if (value.profile_caps !== undefined) {
      if (!isPlainObject(value.profile_caps)) problems.push(`"${label}": los cupos por perfil no tienen el formato esperado.`);
      else {
        const caps = {};
        for (const [profileId, cap] of Object.entries(value.profile_caps)) {
          if (!PROFILE_ID.test(profileId) || !profileIds.has(profileId)) { problems.push(`"${label}": el perfil "${profileId}" no existe o está archivado.`); continue; }
          if (isPlainObject(cap) && cap.unlimited === true) {
            if (unknownKeys(cap, ['unlimited', 'safety_max']).length || !capInt(cap.safety_max)) {
              problems.push(`"${label}": el techo de seguridad del perfil "${profileId}" debe ser un entero entre ${CAP_MIN} y ${CAP_MAX}.`);
            } else caps[profileId] = { unlimited: true, safety_max: cap.safety_max };
          } else if (isPlainObject(cap) && !unknownKeys(cap, ['per', 'max']).length && CAP_PERIODS.includes(cap.per) && capInt(cap.max)) {
            caps[profileId] = { per: cap.per, max: cap.max };
          } else problems.push(`"${label}": el cupo del perfil "${profileId}" debe ser un entero entre ${CAP_MIN} y ${CAP_MAX}, por día o por mes.`);
        }
        if (Object.keys(caps).length) out.profile_caps = caps;
      }
    }
    if (value.exceptions !== undefined) {
      if (!Array.isArray(value.exceptions)) problems.push(`"${label}": las excepciones no tienen el formato esperado.`);
      else if (value.exceptions.length > MAX_EXCEPTIONS_PER_FUNCTION) problems.push(`"${label}": máximo ${MAX_EXCEPTIONS_PER_FUNCTION} excepciones.`);
      else {
        const seen = new Set();
        const exceptions = [];
        value.exceptions.forEach((exception, index) => {
          const n = index + 1;
          if (!isPlainObject(exception) || unknownKeys(exception, ['person', 'extra', 'per', 'expires']).length) { problems.push(`"${label}": la excepción ${n} no tiene el formato esperado.`); return; }
          const okPerson = typeof exception.person === 'string' && UUID.test(exception.person) && personIds.has(exception.person);
          if (!okPerson) problems.push(`"${label}": la excepción ${n} debe ser para una persona activa del SIIO.`);
          else if (seen.has(exception.person)) problems.push(`"${label}": la misma persona tiene dos excepciones.`);
          if (!capInt(exception.extra)) problems.push(`"${label}": el cupo extra de la excepción ${n} debe ser un entero entre ${CAP_MIN} y ${CAP_MAX}.`);
          if (!CAP_PERIODS.includes(exception.per)) problems.push(`"${label}": la excepción ${n} debe ser por día o por mes.`);
          if (!isRealDate(exception.expires)) problems.push(`"${label}": la excepción ${n} necesita una fecha de vencimiento.`);
          else if (exception.expires < referenceDay) problems.push(`"${label}": la excepción ${n} vence en el pasado.`);
          if (okPerson) seen.add(exception.person);
          exceptions.push({ person: exception.person, extra: exception.extra, per: exception.per, expires: exception.expires });
        });
        if (exceptions.length) out.exceptions = exceptions;
      }
    }
    capabilities[item.capability] = out;
  }
  if (problems.length) throw configurationInvalidError(problems);
  return { timezone: CONFIGURATION_TIMEZONE, capabilities };
}

export function normalizeReason(value, { required = true } = {}) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (required && text.length < 3) throw configurationInvalidError('Escriba el motivo (al menos 3 caracteres).');
  if (text.length > REASON_MAX_LENGTH) throw configurationInvalidError(`El motivo admite hasta ${REASON_MAX_LENGTH} caracteres.`);
  return text;
}

/** Slug de perfil a partir del nombre: minúsculas, sin tildes, guiones bajos, empieza por letra, 2..41 caracteres. */
export function profileSlugFromName(name) {
  const base = String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/g, '')
    .slice(0, 41).replace(/_+$/g, '');
  return base.length >= 2 ? base : '';
}

export function normalizeProfileInput(body) {
  const problems = [];
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim().replace(/\s+/g, ' ') : '';
  const profileId = typeof body?.profile_id === 'string' ? body.profile_id.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim().replace(/\s+/g, ' ') : '';
  if (displayName.length < 2 || displayName.length > 80) problems.push('El nombre del perfil debe tener entre 2 y 80 caracteres.');
  if (!PROFILE_ID.test(profileId)) problems.push('El identificador debe empezar por letra y usar sólo minúsculas, números y guion bajo (2 a 41 caracteres).');
  if (description.length > 300) problems.push('La descripción admite hasta 300 caracteres.');
  if (problems.length) throw configurationInvalidError(problems);
  return { profile_id: profileId, display_name: displayName, description };
}

export function isValidProfileId(value) {
  return typeof value === 'string' && PROFILE_ID.test(value);
}

export function isValidAgentId(value) {
  return typeof value === 'string' && AGENT_ID.test(value);
}

export function parseVersionId(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d{0,17}$/.test(text)) return null;
  return text;
}

// ---------------------------------------------------------------------------------------------------------------------
// Estados, diferencias y matriz de perfiles

/** Estado de una versión: vigente (la de current_agent_configuration), rechazada, aprobada o pendiente. */
export function versionStatus({ is_current, approved_at, rejected_at } = {}) {
  if (is_current) return 'vigente';
  if (rejected_at) return 'rechazada';
  if (approved_at) return 'aprobada';
  return 'pendiente';
}

const PER_LABEL = { day: 'día', month: 'mes' };
function perText(per) { return PER_LABEL[per] || per; }
function modelLabel(id) { return AI_MODEL_OPTIONS.find(option => option.id === id)?.label || 'Modelo no reconocido'; }
function fallbackLabel(id) { return AI_FALLBACK_OPTIONS.find(option => option.id === id)?.label || 'Plan B no reconocido'; }

export function describeProfileCap(cap) {
  if (!cap) return 'Sólo cupo del equipo';
  if (cap.unlimited) return `Sin cupo propio (techo de seguridad ${cap.safety_max})`;
  return `${cap.max} por ${perText(cap.per)}`;
}

function describeException(exception) {
  if (!exception) return 'Sin excepción';
  return `+${exception.extra} por ${perText(exception.per)} hasta ${exception.expires}`;
}

/**
 * Tabla legible "qué cambia" entre la configuración base (vigente o, si no hay, valores del código) y la propuesta.
 * Filas: { function, field, before, after }. Sólo las diferencias.
 */
export function describeConfigurationChanges(before, after, { agentId, profileNames = {}, personNames = {} } = {}) {
  const rows = [];
  const beforeCaps = before?.capabilities || {};
  const afterCaps = after?.capabilities || {};
  const add = (fn, field, a, b) => { if (a !== b) rows.push({ function: fn, field, before: a, after: b }); };
  for (const item of agentAiFunctions(agentId)) {
    const label = item.label;
    const a = beforeCaps[item.capability] || {};
    const b = afterCaps[item.capability] || {};
    const onOff = value => (value === false ? 'Apagada' : value === true ? 'Encendida' : '—');
    add(label, 'Estado', onOff(a.enabled), onOff(b.enabled));
    add(label, 'Modelo', a.model ? modelLabel(a.model) : '—', b.model ? modelLabel(b.model) : '—');
    add(label, 'Plan B', a.fallback ? fallbackLabel(a.fallback) : '—', b.fallback ? fallbackLabel(b.fallback) : '—');
    const team = cap => (cap ? `${cap.max} por ${perText(cap.per)}` : '—');
    add(label, 'Cupo del equipo', team(a.team_cap), team(b.team_cap));
    const profiles = new Set([...Object.keys(a.profile_caps || {}), ...Object.keys(b.profile_caps || {})]);
    for (const profileId of [...profiles].sort()) {
      add(label, `Perfil ${profileNames[profileId] || profileId}`, describeProfileCap(a.profile_caps?.[profileId]), describeProfileCap(b.profile_caps?.[profileId]));
    }
    const byPerson = list => new Map((list || []).map(exception => [exception.person, exception]));
    const ea = byPerson(a.exceptions);
    const eb = byPerson(b.exceptions);
    const people = new Set([...ea.keys(), ...eb.keys()]);
    for (const person of [...people].sort()) {
      add(label, `Excepción: ${personNames[person] || 'Persona sin nombre'}`, describeException(ea.get(person)), describeException(eb.get(person)));
    }
  }
  return rows;
}

/**
 * Matriz perfil × agente: para cada perfil (no archivado) y cada agente con funciones con IA, el cupo del perfil en
 * cada función según la configuración vigente (o "Sin configuración aprobada" si el agente no tiene versión vigente).
 */
export function buildProfileMatrix(profiles, currentByAgent) {
  const agents = Object.keys(AGENT_AI_FUNCTIONS).sort();
  return {
    agents,
    rows: (profiles || []).filter(profile => !profile.archived_at).map(profile => ({
      profile_id: profile.profile_id,
      display_name: profile.display_name,
      cells: Object.fromEntries(agents.map(agentId => {
        const configuration = currentByAgent?.[agentId] || null;
        return [agentId, agentAiFunctions(agentId).map(item => ({
          function: item.label,
          text: configuration ? describeProfileCap(configuration.capabilities?.[item.capability]?.profile_caps?.[profile.profile_id]) : 'Sin configuración aprobada',
        }))];
      })),
    })),
  };
}

/** Excepciones vigentes que vencen en los próximos `days` días (para los avisos del Resumen). */
export function expiringExceptions(currentByAgent, { today = bogotaToday(), days = 7, personNames = {} } = {}) {
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  const until = limit.toISOString().slice(0, 10);
  const items = [];
  for (const [agentId, configuration] of Object.entries(currentByAgent || {})) {
    for (const item of agentAiFunctions(agentId)) {
      for (const exception of configuration?.capabilities?.[item.capability]?.exceptions || []) {
        if (exception.expires >= today && exception.expires <= until) {
          items.push({ agent_id: agentId, function: item.label, person: personNames[exception.person] || 'Persona sin nombre', expires: exception.expires });
        }
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectura

export const PLATFORM_CONFIGURATION_VERSIONS_SQL = `select c.configuration_version_id::text as configuration_version_id, c.agent_id, c.environment,
       c.version_number, c.configuration, c.created_at,
       p.proposed_by, p.reason as proposal_reason, p.proposed_at,
       a.approved_by, a.approved_at,
       r.rejected_by, r.reason as rejection_reason, r.rejected_at,
       act.activated_by, act.activated_at,
       (cur.configuration_version_id is not null) as is_current
  from platform.agent_configuration_version c
  left join lateral (select x.proposed_by, x.reason, x.proposed_at from platform.configuration_proposal x
                      where x.configuration_version_id = c.configuration_version_id order by x.proposed_at desc limit 1) p on true
  left join lateral (select x.approved_by, x.approved_at from platform.configuration_approval_event x
                      where x.configuration_version_id = c.configuration_version_id order by x.approved_at desc limit 1) a on true
  left join lateral (select x.rejected_by, x.reason, x.rejected_at from platform.configuration_rejection_event x
                      where x.configuration_version_id = c.configuration_version_id order by x.rejected_at desc limit 1) r on true
  left join lateral (select x.activated_by, x.activated_at from platform.configuration_activation_event x
                      where x.configuration_version_id = c.configuration_version_id order by x.activated_at desc limit 1) act on true
  left join platform.current_agent_configuration cur
    on cur.configuration_version_id = c.configuration_version_id and cur.agent_id = c.agent_id and cur.environment = c.environment
 where c.environment = $1
 order by c.agent_id, c.version_number desc`;

export const PLATFORM_AI_USAGE_PROFILES_SQL = `select profile_id, display_name, description, created_by, created_at, archived_by, archived_at
  from platform.ai_usage_profile
 order by display_name, profile_id`;

function isoOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function textOrNull(value) {
  return value == null ? null : String(value);
}

function configurationFrom(value) {
  if (isPlainObject(value)) return value;
  if (typeof value === 'string') { try { const parsed = JSON.parse(value); return isPlainObject(parsed) ? parsed : null; } catch { return null; } }
  return null;
}

export function presentAiUsageProfile(row) {
  return {
    profile_id: String(row.profile_id),
    display_name: row.display_name == null ? String(row.profile_id) : String(row.display_name),
    description: textOrNull(row.description),
    created_by: textOrNull(row.created_by),
    created_at: isoOrNull(row.created_at),
    archived_by: textOrNull(row.archived_by),
    archived_at: isoOrNull(row.archived_at),
  };
}

export function presentConfigurationVersion(row) {
  const presented = {
    id: String(row.configuration_version_id),
    agent_id: String(row.agent_id),
    environment: textOrNull(row.environment),
    version_number: Number.isFinite(Number(row.version_number)) ? Math.trunc(Number(row.version_number)) : null,
    configuration: configurationFrom(row.configuration),
    created_at: isoOrNull(row.created_at),
    proposed_by: textOrNull(row.proposed_by),
    proposal_reason: textOrNull(row.proposal_reason),
    proposed_at: isoOrNull(row.proposed_at),
    approved_by: textOrNull(row.approved_by),
    approved_at: isoOrNull(row.approved_at),
    rejected_by: textOrNull(row.rejected_by),
    rejection_reason: textOrNull(row.rejection_reason),
    rejected_at: isoOrNull(row.rejected_at),
    activated_by: textOrNull(row.activated_by),
    activated_at: isoOrNull(row.activated_at),
    is_current: row.is_current === true,
  };
  return { ...presented, status: versionStatus(presented) };
}

/**
 * Arma la respuesta pública de la configuración. `people`: [{ id, full_name }] de personas del SIIO activas.
 * Cada versión no vigente trae `changes` frente a la vigente (o frente a los valores del código si no hay vigente).
 */
export function presentAgentConfiguration({ versionRows = [], profileRows = [], people = [], environment, limits = {}, adminConnected = false, now = new Date() } = {}) {
  const versions = versionRows.map(presentConfigurationVersion);
  const profiles = profileRows.map(presentAiUsageProfile);
  const profileNames = Object.fromEntries(profiles.map(profile => [profile.profile_id, profile.display_name]));
  const personNames = Object.fromEntries(people.map(person => [person.id, person.full_name]));
  const currentByAgent = {};
  const currentVersion = {};
  for (const version of versions) {
    if (version.is_current && version.configuration) { currentByAgent[version.agent_id] = version.configuration; currentVersion[version.agent_id] = version.id; }
  }
  const defaults = Object.fromEntries(Object.keys(AGENT_AI_FUNCTIONS).map(agentId => [agentId, defaultAgentConfiguration(agentId, limits)]));
  const withChanges = versions.map(version => {
    if (version.is_current) return { ...version, changes: [] };
    const base = currentByAgent[version.agent_id] || defaults[version.agent_id] || null;
    return { ...version, changes: describeConfigurationChanges(base, version.configuration, { agentId: version.agent_id, profileNames, personNames }) };
  });
  return {
    generated_at: now.toISOString(),
    environment,
    admin_connected: adminConnected,
    today: bogotaToday(now),
    models: AI_MODEL_OPTIONS,
    fallbacks: AI_FALLBACK_OPTIONS,
    catalog: Object.fromEntries(Object.entries(AGENT_AI_FUNCTIONS).map(([agentId, list]) => [agentId, list.map(({ capability, label, description }) => ({ capability, label, description }))])),
    no_functions_text: NO_AI_FUNCTIONS_TEXT,
    defaults,
    profiles,
    people: people.map(person => ({ id: person.id, full_name: person.full_name })),
    versions: withChanges,
    current: currentVersion,
    pending_count: withChanges.filter(version => version.status === 'pendiente').length,
    profile_matrix: buildProfileMatrix(profiles, currentByAgent),
    expiring_exceptions: expiringExceptions(currentByAgent, { today: bogotaToday(now), personNames }),
  };
}

// Pools de prueba (dobles sin base real). Nunca se usan en producción.
let testPools = null;
export function __setPlatformConfigurationPoolsForTests(pools) { testPools = pools || null; }

function readerPool(env) {
  return testPools?.reader || getPlatformPool(env);
}

/** Pool de lectura de la plataforma (o el doble de pruebas). Lo usan otros lectores de sólo lectura. */
export function platformConfigurationReaderPool(env = process.env) {
  return readerPool(env);
}

export function hasPlatformAdminConnection(env = process.env) {
  return Boolean(testPools?.admin) || Boolean(platformConnectionString(env.PLATFORM_ADMIN_DATABASE_URL));
}

let cachedAdminPool = null;
let cachedAdminKey = null;
export function getPlatformAdminPool(env = process.env) {
  if (testPools && 'admin' in testPools) {
    if (!testPools.admin) throw platformAdminUnavailableError();
    return testPools.admin;
  }
  const connectionString = platformConnectionString(env.PLATFORM_ADMIN_DATABASE_URL);
  if (!connectionString) throw platformAdminUnavailableError();
  if (cachedAdminPool && cachedAdminKey === connectionString) return cachedAdminPool;
  if (cachedAdminPool) cachedAdminPool.end().catch(() => {});
  const pool = new pg.Pool({
    connectionString,
    ssl: platformSslConfig(env),
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS,
    statement_timeout: PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS,
    application_name: 'siio-it-agentes-admin',
  });
  pool.on('error', () => {});
  cachedAdminPool = pool;
  cachedAdminKey = connectionString;
  return pool;
}

export async function readOnly(pool, label, work) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    console.warn(label, { stage: 'connect', code: error?.code || null });
    throw platformUnavailableError();
  }
  let failed = null;
  try {
    await client.query('begin read only');
    await client.query(`set local statement_timeout = ${PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS}`);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    failed = error;
    await client.query('rollback').catch(() => {});
    console.warn(label, { stage: 'query', code: error?.code || null });
    throw platformUnavailableError();
  } finally {
    client.release(failed ? true : undefined);
  }
}

/** Perfiles de uso de IA no archivados (sólo lectura), para el campo "Perfil de uso de IA" de Usuarios y permisos. */
export async function readActiveAiUsageProfiles({ env = process.env } = {}) {
  return readOnly(readerPool(env), 'platform_ai_usage_profiles_unavailable', async client => {
    const result = await client.query(PLATFORM_AI_USAGE_PROFILES_SQL);
    return (result.rows || []).map(presentAiUsageProfile).filter(profile => !profile.archived_at && isValidProfileId(profile.profile_id))
      .map(profile => ({ profile_id: profile.profile_id, display_name: profile.display_name }));
  });
}

/** Lee versiones y perfiles de uso (sólo lectura). */
export async function readAgentConfigurationRows({ env = process.env, environment = gatewayEnvironment(env) } = {}) {
  return readOnly(readerPool(env), 'platform_agent_configuration_unavailable', async client => {
    const versions = await client.query(PLATFORM_CONFIGURATION_VERSIONS_SQL, [environment]);
    const profiles = await client.query(PLATFORM_AI_USAGE_PROFILES_SQL);
    return { versionRows: versions.rows || [], profileRows: profiles.rows || [] };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Escritura (sólo funciones platform.*)

export const PLATFORM_ADMIN_SQL = Object.freeze({
  propose: 'select platform.propose_configuration($1::text, $2::text, $3::jsonb, $4::text, $5::text)::text as result',
  approve: 'select platform.approve_configuration($1::bigint, $2::text)::text as result',
  reject: 'select platform.reject_configuration($1::bigint, $2::text, $3::text)',
  reactivate: 'select platform.reactivate_configuration($1::bigint, $2::text)::text as result',
  createProfile: 'select platform.create_ai_usage_profile($1::text, $2::text, $3::text, $4::text)::text as result',
  archiveProfile: 'select platform.archive_ai_usage_profile($1::text, $2::text)',
});

async function adminCall(sql, params, env) {
  const pool = getPlatformAdminPool(env);
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    console.warn('platform_admin_unavailable', { stage: 'connect', code: error?.code || null });
    throw platformAdminUnavailableError();
  }
  let failed = null;
  try {
    await client.query('begin');
    await client.query(`set local statement_timeout = ${PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS}`);
    const result = await client.query(sql, params);
    await client.query('commit');
    return result.rows?.[0]?.result ?? null;
  } catch (error) {
    failed = error;
    await client.query('rollback').catch(() => {});
    console.warn('platform_admin_rejected', { code: error?.code || null });
    // Conexión caída o timeout → no conectada; cualquier otro rechazo de la base → mensaje neutro.
    if (['57P01', '57P03', '08000', '08003', '08006', '08001', '57014'].includes(error?.code)) throw platformAdminUnavailableError();
    throw platformAdminRejectedError();
  } finally {
    client.release(failed ? true : undefined);
  }
}

export function proposeConfiguration({ agentId, environment, configuration, actor, reason, env = process.env }) {
  return adminCall(PLATFORM_ADMIN_SQL.propose, [agentId, environment, JSON.stringify(configuration), actor, reason], env);
}
export function approveConfiguration({ versionId, actor, env = process.env }) {
  return adminCall(PLATFORM_ADMIN_SQL.approve, [versionId, actor], env);
}
export function rejectConfiguration({ versionId, actor, reason, env = process.env }) {
  return adminCall(PLATFORM_ADMIN_SQL.reject, [versionId, actor, reason], env);
}
export function reactivateConfiguration({ versionId, actor, env = process.env }) {
  return adminCall(PLATFORM_ADMIN_SQL.reactivate, [versionId, actor], env);
}
export function createAiUsageProfile({ profile, actor, env = process.env }) {
  return adminCall(PLATFORM_ADMIN_SQL.createProfile, [profile.profile_id, profile.display_name, profile.description, actor], env);
}
export function archiveAiUsageProfile({ profileId, actor, env = process.env }) {
  return adminCall(PLATFORM_ADMIN_SQL.archiveProfile, [profileId, actor], env);
}

/** Comprueba que una acción sobre una versión es posible según su estado actual (mensajes claros antes de escribir). */
export function assertVersionAction(version, action) {
  if (!version) throw configurationInvalidError('La versión no existe en este ambiente.', 404);
  if ((action === 'approve' || action === 'reject') && version.status !== 'pendiente') throw configurationInvalidError('Esta propuesta ya fue resuelta.', 409);
  if (action === 'reactivate' && version.status !== 'aprobada') {
    throw configurationInvalidError(version.status === 'vigente' ? 'Esta versión ya está vigente.' : 'Sólo se puede volver a una versión aprobada.', 409);
  }
}

/** Nombre del autor de una acción: siempre del perfil autenticado, nunca del cuerpo de la petición. */
export function actorNameFromProfile(profile) {
  const name = typeof profile?.full_name === 'string' ? profile.full_name.trim().replace(/\s+/g, ' ') : '';
  if (name) return name.slice(0, 120);
  const email = typeof profile?.microsoft_email === 'string' ? profile.microsoft_email.trim() : '';
  return email ? email.slice(0, 120) : 'Usuario del SIIO';
}
