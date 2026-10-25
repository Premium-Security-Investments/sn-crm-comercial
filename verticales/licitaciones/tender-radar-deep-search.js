// AGT-002 Radar — deep daily SECOP search, moved from Hermes into the CRM (owner decision 2026-10-06: everything about
// tenders lives in AGT-002/CRM; Hermes only delivers messages). This module holds the search vocabulary and the two
// inclusion paths ported verbatim from /root/.hermes/scripts/secop_psi_radar.py so the daily import keeps today's
// coverage: the keyword + UNSPSC SoQL filter (with a dedicated UNSPSC-family query), Socrata offset pagination in
// 10-day windows, the "seguridad electrónica ofertable" path and the "vigilancia ≥ $1.000 M" path. Pure: no I/O.

export const RADAR_DEEP_DAYS = 60;
export const RADAR_DEEP_PAGE_LIMIT = 500;
// Per date window, not per source: with the Hermes cap (5000 split across 7 windows ≈ 715) a busy 10-day window
// (1,087 matches for 26-sep..6-oct-2026) silently dropped its oldest days, e.g. the Fiscalía vigilance tender of
// 28-sep. 3000 per window covers the busiest observed window with margin.
export const RADAR_DEEP_MAX_ROWS_PER_WINDOW = 3000;
export const RADAR_DEEP_CHUNK_DAYS = { 'SECOP II': 10, 'SECOP I': 0 };
export const RADAR_DEEP_CATEGORY_FIELD = { 'SECOP II': 'codigo_principal_de_categoria', 'SECOP I': null };

const BASE_KEYWORDS = ["vigilancia", "vigilancia armada", "vigilancia privada", "seguridad privada", "seguridad fisica", "seguridad física", "seguridad electron", "seguridad tecnolog", "seguridad inteligente", "cctv", "videovigilancia", "video vigilancia", "camara", "cámara", "camaras", "cámaras", "control de acceso", "acceso biometr", "biometr", "alarma", "monitoreo de alarmas", "central de monitoreo", "incendio", "reconocimiento de placas", "lpr", "ciudad segura", "seguridad publica", "seguridad pública", "centro de operaciones de seguridad", "ronda", "rondas", "guarda", "guardas", "celaduria", "celaduría", "porteria", "portería", "monitoreo", "circuito cerrado", "centro de distribucion", "centro de distribución", "bodega"];
export const ELECTRONIC_SECURITY_WHERE_TERMS = ["vms", "nvr", "dvr", "psim", "analitica de video", "analítica de video", "video inteligente", "video analytics", "reconocimiento facial", "reconocimiento de matriculas", "reconocimiento de matrículas", "lectura de placas", "lectura de matriculas", "lectura de matrículas", "anpr", "lector", "lectores", "torniquete", "torniquetes", "barrera vehicular", "barreras vehiculares", "deteccion de intrusion", "detección de intrusión", "sensor perimetral", "sensores perimetrales", "cerca electrica", "cerca eléctrica", "cerco electrico", "cerco eléctrico", "sala de monitoreo", "central de alarmas", "operador de medios tecnologicos", "operador de medios tecnológicos", "operadores de medios tecnologicos", "operadores de medios tecnológicos"];
export const RADAR_DEEP_KEYWORDS = [...BASE_KEYWORDS, ...ELECTRONIC_SECURITY_WHERE_TERMS];
export const RADAR_UNSPSC_CODES = ["92101500", "92101600", "92101700", "46171500", "46171600", "81112000", "46181500", "92121500"];
export const ELECTRONIC_UNSPSC_FAMILIES = ["461715", "461716", "461815"];

const ELECTRONIC_SECURITY_TECH_TERMS = {"vms": "VMS", "nvr": "NVR", "dvr": "DVR", "psim": "PSIM", "analitica de video": "analítica de video", "analítica de video": "analítica de video", "video inteligente": "video inteligente", "video analytics": "video analytics", "reconocimiento facial": "reconocimiento facial", "reconocimiento de placas": "reconocimiento de placas", "reconocimiento de matriculas": "reconocimiento de matrículas", "reconocimiento de matrículas": "reconocimiento de matrículas", "lectura de placas": "lectura de placas", "lectura de matriculas": "lectura de matrículas", "lectura de matrículas": "lectura de matrículas", "lpr": "LPR", "anpr": "ANPR", "control de acceso electronico": "control de acceso electrónico", "control de acceso electrónico": "control de acceso electrónico", "control de acceso biometrico": "control de acceso biométrico", "control de acceso biométrico": "control de acceso biométrico", "sistema biometrico": "sistema biométrico", "sistema biométrico": "sistema biométrico", "biometrico": "biométrico", "biométrico": "biométrico", "biometria": "biometría", "biometría": "biometría", "torniquete": "torniquete", "torniquetes": "torniquetes", "barrera vehicular": "barrera vehicular", "barreras vehiculares": "barreras vehiculares", "deteccion de intrusion": "detección de intrusión", "detección de intrusión": "detección de intrusión", "sensor perimetral": "sensor perimetral", "sensores perimetrales": "sensores perimetrales", "cerca electrica": "cerca eléctrica", "cerca eléctrica": "cerca eléctrica", "cerco electrico": "cerco eléctrico", "cerco eléctrico": "cerco eléctrico", "centro de monitoreo": "centro de monitoreo", "central de monitoreo": "central de monitoreo", "sala de monitoreo": "sala de monitoreo", "central de alarmas": "central de alarmas", "seguridad electronica integral": "seguridad electrónica integral", "seguridad electrónica integral": "seguridad electrónica integral", "seguridad tecnologica integral": "seguridad tecnológica integral", "seguridad tecnológica integral": "seguridad tecnológica integral", "seguridad electronica": "seguridad electrónica", "seguridad electrónica": "seguridad electrónica", "seguridad tecnologica": "seguridad tecnológica", "seguridad tecnológica": "seguridad tecnológica", "sistema de alarma": "sistema de alarma", "sistema de alarmas": "sistema de alarmas", "sistemas de alarma": "sistemas de alarma", "sistemas de alarmas": "sistemas de alarmas", "deteccion y alarma": "detección y alarma", "detección y alarma": "detección y alarma", "alarma": "alarma", "alarmas": "alarmas", "cctv": "CCTV", "videovigilancia": "videovigilancia"};
const ELECTRONIC_SECURITY_SERVICE_TERMS = {"instalacion": "instalación", "instalación": "instalación", "configuracion": "configuración", "configuración": "configuración", "integracion": "integración", "integración": "integración", "puesta en funcionamiento": "puesta en funcionamiento", "mantenimiento": "mantenimiento", "soporte": "soporte", "licenciamiento": "licenciamiento", "actualizacion": "actualización", "actualización": "actualización", "modernizacion": "modernización", "modernización": "modernización", "ampliacion": "ampliación", "ampliación": "ampliación", "operacion": "operación", "operación": "operación", "operador de medios tecnologicos": "operación (operador de medios tecnológicos)", "operador de medios tecnológicos": "operación (operador de medios tecnológicos)", "operadores de medios tecnologicos": "operación (operador de medios tecnológicos)", "operadores de medios tecnológicos": "operación (operador de medios tecnológicos)", "monitoreo": "monitoreo", "asistencia tecnica": "asistencia técnica", "asistencia técnica": "asistencia técnica"};
const WORD_BOUNDARY_TERMS = new Set(['cedi', 'cctv', 'lpr', 'cad', 'sies', '123', 'ronda', 'rondas', 'guarda', 'guardas', 'vms', 'nvr', 'dvr', 'psim', 'anpr', 'lector', 'lectores']);
const ELECTRONIC_SECURITY_MIN_VALUE = 10000000;
const MIN_VALUE = 50000000;
export const HIGH_VALUE_VIGILANCE_MIN_VALUE = 1_000_000_000;
export const DIRECT_SERVICE_REASON = 'objeto directo de seguridad ofertable';

const sqlQuote = value => String(value).replace(/'/g, "''");

/** SoQL OR clause over the name fields for every keyword, plus the UNSPSC codes when the source has a category field. */
export function radarDeepKeywordWhere(fields, categoryField = null) {
  const clauses = RADAR_DEEP_KEYWORDS.map(keyword => `(${fields.map(field => `lower(${field}) like '%${sqlQuote(keyword)}%'`).join(' OR ')})`);
  if (categoryField) clauses.push(`(${RADAR_UNSPSC_CODES.map(code => `${categoryField} like '%${code}%'`).join(' OR ')})`);
  return `(${clauses.join(' OR ')})`;
}

/** Dedicated SoQL for electronic-security UNSPSC families: the keyword query is capped per window and can crowd them out. */
export function radarDeepUnspscFamilyWhere(categoryField) {
  if (!categoryField) return null;
  return `(${ELECTRONIC_UNSPSC_FAMILIES.map(code => `upper(${categoryField}) like '%${code}%'`).join(' OR ')})`;
}

/** [start, endExclusive) date windows (YYYY-MM-DD) covering the last `days` days up to today, `chunkDays` wide (0 = one window). */
export function radarDeepWindows(today, { days = RADAR_DEEP_DAYS, chunkDays = 0 } = {}) {
  const day = date => date.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - days * 86400000);
  const endExclusive = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + 86400000);
  if (!chunkDays) return [{ start: day(start), end: null }];
  const windows = [];
  for (let cursor = start; cursor < endExclusive;) {
    const next = new Date(Math.min(cursor.getTime() + chunkDays * 86400000, endExclusive.getTime()));
    windows.push({ start: day(cursor), end: day(next) });
    cursor = next;
  }
  return windows;
}

function rowText(row) {
  return Object.values(row || {}).map(value => (typeof value === 'string' ? value : '')).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function termInText(term, text) {
  if (!WORD_BOUNDARY_TERMS.has(term)) return text.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-záéíóúñ0-9])${escaped}(?![a-záéíóúñ0-9])`).test(text);
}

/**
 * The "seguridad electrónica ofertable" path: a known value above $10 M, at least one specific electronic-security
 * technology and at least one service/solution signal (pure supply never matches). Returns its own deterministic score.
 */
export function evaluateElectronicSecurityPath(row, value) {
  if (!value || value <= ELECTRONIC_SECURITY_MIN_VALUE) return { ok: false };
  const text = rowText(row);
  const tech = [...new Set(Object.entries(ELECTRONIC_SECURITY_TECH_TERMS).filter(([term]) => termInText(term, text)).map(([, label]) => label))];
  if (tech.length === 0) return { ok: false };
  const service = [...new Set(Object.entries(ELECTRONIC_SECURITY_SERVICE_TERMS).filter(([term]) => termInText(term, text)).map(([, label]) => label))];
  if (service.length === 0) return { ok: false };
  let score = 90 + Math.min((tech.length - 1) * 5, 15) + Math.min((service.length - 1) * 5, 10);
  if (value >= 500_000_000) score += 20; else if (value >= MIN_VALUE) score += 10;
  return {
    ok: true,
    score,
    reasons: [...tech.map(label => `seguridad electrónica: ${label}`), ...service.map(label => `servicio/solución: ${label}`)],
    risks: ['vía de seguridad electrónica integral: validar alcance exacto de tecnología y servicio en el pliego'],
  };
}

/** The "vigilancia ≥ $1.000 M" path: a commercially material private-security/vigilance tender always enters the Radar. */
export function isHighValueVigilanceTender({ value, entity, title, desc, reasons }) {
  if (Number(value || 0) < HIGH_VALUE_VIGILANCE_MIN_VALUE) return false;
  const text = rowText({ entity, title, desc, reasons: (reasons || []).join(' ') });
  const hasVigilance = termInText('vigilancia', text);
  const hasSecurityContext = ['seguridad privada', 'seguridad', 'vigilancia privada', 'vigilancia armada', 'guardas', 'servicios de vigilancia'].some(term => termInText(term, text));
  return hasVigilance && hasSecurityContext;
}
