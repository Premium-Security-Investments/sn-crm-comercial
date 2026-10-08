// AGT-003 — Premio "análisis profundo" del cliente (capacidad agt003.lead-deep-analysis, decisión de Juan 2026-10-08).
//
// Regla única para servidor y pantallas: cuándo se gana (perfil completo), qué entrega (contrato de salida), cuánto
// cupo hay (tope mensual del equipo, aparte del tope diario de Vig-IA) y cómo se estima su costo equivalente.

export const LEAD_ANALYSIS_CAPABILITY_ID = 'agt003.lead-deep-analysis';
export const LEAD_ANALYSIS_CONTRACT_VERSION = '1.0';
export const LEAD_ANALYSIS_DEFAULT_MONTHLY_MAX = 30;
// Tarifa pública por millón de tokens del modelo "sonnet" (Claude Sonnet 5.5). Sólo para estimar el costo equivalente:
// el puente corre con suscripción, no se factura por consulta.
export const LEAD_ANALYSIS_PRICE_PER_MTOK = Object.freeze({ input: 2, output: 10 });

/** Campos del perfil que, si cambian, permiten pedir un análisis nuevo de la misma oportunidad. */
export const LEAD_ANALYSIS_PROFILE_KEYS = Object.freeze([
  'company_name', 'company_website', 'economic_sector', 'decision_maker_name', 'decision_maker_title',
  'decision_maker_email', 'current_security_provider', 'current_security_provider_none',
]);

export function leadAnalysisProfileFingerprint(opportunity = {}) {
  return JSON.stringify(LEAD_ANALYSIS_PROFILE_KEYS.map(key => {
    const value = opportunity[key];
    return typeof value === 'string' ? value.trim().toLowerCase() : value === true;
  }));
}

const str = (max) => ({ type: 'string', minLength: 1, maxLength: max });

/** Contrato de salida que la IA debe cumplir (JSON Schema cerrado). */
export const LEAD_ANALYSIS_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['empresa', 'riesgos_sector', 'servicio_recomendado', 'mensaje_sugerido', 'pendientes_por_confirmar'],
  properties: {
    empresa: {
      type: 'object', additionalProperties: false, required: ['que_hace', 'sedes', 'tamano'],
      properties: { que_hace: str(900), sedes: str(500), tamano: str(400) },
    },
    riesgos_sector: { type: 'array', minItems: 2, maxItems: 5, items: str(400) },
    servicio_recomendado: {
      type: 'object', additionalProperties: false, required: ['servicio', 'por_que'],
      properties: { servicio: str(160), por_que: str(900) },
    },
    mensaje_sugerido: {
      type: 'object', additionalProperties: false, required: ['canal', 'texto'],
      properties: { canal: { type: 'string', enum: ['whatsapp', 'correo'] }, texto: str(1500) },
    },
    pendientes_por_confirmar: { type: 'array', maxItems: 6, items: str(300) },
  },
});

function fail(code) {
  const error = new Error('La respuesta del análisis no tiene la estructura esperada.');
  error.code = code;
  return error;
}

function checkString(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }

/** Valida la salida contra el contrato (cerrado: sin campos extra). Devuelve una copia limpia. */
export function validateLeadAnalysisOutput(raw) {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { throw fail('AGT003_LEAD_ANALYSIS_INVALID_JSON'); } })() : raw;
  const s = LEAD_ANALYSIS_OUTPUT_SCHEMA.properties;
  const closed = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).every(k => keys.includes(k));
  if (!closed(value, LEAD_ANALYSIS_OUTPUT_SCHEMA.required)) throw fail('AGT003_LEAD_ANALYSIS_INVALID_SHAPE');
  const e = value.empresa;
  if (!closed(e, s.empresa.required) || !checkString(e.que_hace, 900) || !checkString(e.sedes, 500) || !checkString(e.tamano, 400)) throw fail('AGT003_LEAD_ANALYSIS_INVALID_SHAPE');
  const risks = value.riesgos_sector;
  if (!Array.isArray(risks) || risks.length < 2 || risks.length > 5 || !risks.every(r => checkString(r, 400))) throw fail('AGT003_LEAD_ANALYSIS_INVALID_SHAPE');
  const sr = value.servicio_recomendado;
  if (!closed(sr, s.servicio_recomendado.required) || !checkString(sr.servicio, 160) || !checkString(sr.por_que, 900)) throw fail('AGT003_LEAD_ANALYSIS_INVALID_SHAPE');
  const msg = value.mensaje_sugerido;
  if (!closed(msg, s.mensaje_sugerido.required) || !['whatsapp', 'correo'].includes(msg.canal) || !checkString(msg.texto, 1500)) throw fail('AGT003_LEAD_ANALYSIS_INVALID_SHAPE');
  const pending = value.pendientes_por_confirmar;
  if (!Array.isArray(pending) || pending.length > 6 || !pending.every(p => checkString(p, 300))) throw fail('AGT003_LEAD_ANALYSIS_INVALID_SHAPE');
  return {
    empresa: { que_hace: e.que_hace.trim(), sedes: e.sedes.trim(), tamano: e.tamano.trim() },
    riesgos_sector: risks.map(r => r.trim()),
    servicio_recomendado: { servicio: sr.servicio.trim(), por_que: sr.por_que.trim() },
    mensaje_sugerido: { canal: msg.canal, texto: msg.texto.trim() },
    pendientes_por_confirmar: pending.map(p => p.trim()),
  };
}

/** Costo equivalente estimado en USD (tokens × tarifa pública). */
export function estimateLeadAnalysisCostUsd(usage = {}) {
  const input = Number(usage.input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  const usd = (input * LEAD_ANALYSIS_PRICE_PER_MTOK.input + output * LEAD_ANALYSIS_PRICE_PER_MTOK.output) / 1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

/** Inicio del mes calendario de Bogotá (UTC-5) como instante ISO. */
export function bogotaMonthStartIso(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${day.slice(0, 7)}-01T00:00:00-05:00`).toISOString();
}

export function monthlyMaxFrom(environment = {}) {
  const value = Number(environment.AGT003_LEAD_ANALYSIS_MONTHLY_MAX);
  return Number.isInteger(value) && value > 0 && value <= 1000 ? value : LEAD_ANALYSIS_DEFAULT_MONTHLY_MAX;
}
