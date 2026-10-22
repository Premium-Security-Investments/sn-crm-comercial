// AGT-002 — verificación de frescura (pendiente de Juan, 2026-10-21): avisar cuando una fecha clave del cronograma
// ya pasó y SECOP no se movió. El caso que lo pidió: la Fiscalía FGN-NC-IPSE-0054-2026 tenía el pliego definitivo
// para el 16-oct; el 21-oct seguía en "Presentación de observaciones", con los mismos 18 documentos del 28-sep, y
// nadie se dio cuenta hasta que lo notó Juan. El cierre seguía anunciado para el 23-oct.
//
// Dos reglas, y una salvaguarda:
//   1. La entidad debía publicar algo (pliego definitivo, respuesta a observaciones, adenda, informe, adjudicación)
//      y no hay nada nuevo: ni documento posterior a esa fecha ni cambio en la fila del Radar.
//   2. El cierre está encima y el pliego definitivo todavía no aparece: eso no es un trámite, es un proceso que no
//      se puede ofertar como está.
//   3. Salvaguarda: si el Radar no ha visto el proceso hace poco, el silencio puede ser nuestro y no de SECOP.
//      En ese caso no se afirma nada; se avisa que no se puede concluir.

const ENTITY_PUBLICATION_KINDS = new Set(['PUBLICATION', 'OBSERVATION_RESPONSES', 'ADDENDA', 'EVALUATION_REPORT', 'AWARD', 'RISK_HEARING']);
const DEFINITIVE_PLIEGO = /pliego de condiciones definitivo|pliego definitivo|acto administrativo de apertura/i;
// Un documento que cargamos nosotros no es una publicación de la entidad. La primera corrida en producción
// (2026-10-22T00:00Z) lo mostró: las seis cartas de observaciones que cargó Juan en la Fiscalía taparon los
// avisos del pliego definitivo del 16-oct, porque eran posteriores a esa fecha.
const MANUAL_SOURCE = /manual|legacy|carga/i;
const DEFAULT_RADAR_STALE_HOURS = 48;
const DEFAULT_CLOSING_HORIZON_DAYS = 7;
const DAY_MS = 86_400_000;

// Postgres entrega "2026-10-21 13:07:56.568+00": con espacio en vez de T y el desfase sin minutos, que
// Date.parse rechaza. Se normaliza antes de comparar, porque de ahí vienen todas estas fechas.
const ms = value => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Date.parse(text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isFinite(parsed) ? parsed : null;
};
const squash = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** ¿El documento entró por el portal oficial (SECOP II, ESU) o lo cargamos nosotros? */
export function agt002IsOfficialDocumentSource(source) {
  const text = squash(source);
  if (!text) return false;
  return !MANUAL_SOURCE.test(text);
}

/** Fecha en palabras para la línea que lee una persona, en hora de Bogotá. */
export function agt002FreshnessDay(value) {
  const at = ms(value);
  if (at === null) return 'sin fecha';
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long' }).format(new Date(at));
}

/**
 * Qué está en silencio en esta licitación. Puro: no lee ni escribe nada.
 * `deadlines` son los plazos del análisis vigente (`meta.process_deadlines`); `tender` es la fila del Radar.
 */
export function agt002ScheduleFreshnessNotices({
  deadlines = [], tender = {}, lastDocumentAt = null, now = new Date(),
  radarStaleHours = DEFAULT_RADAR_STALE_HOURS, closingHorizonDays = DEFAULT_CLOSING_HORIZON_DAYS,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : ms(now);
  if (!Number.isFinite(nowMs)) return [];
  const phase = squash(tender.status) || 'sin fase registrada';
  const seenAt = ms(tender.lastSeenAt ?? tender.last_seen_at);
  // Sólo `published_at` dice que la entidad publicó algo nuevo. `updated_at` no sirve: el Radar reescribe la fila
  // en cada pasada diaria (la Fiscalía la tenía al día de hoy con una publicación del 28 de septiembre), así que
  // usarlo tapaba todos los avisos.
  const publishedAt = ms(tender.publishedAt ?? tender.published_at);
  const documentAt = ms(lastDocumentAt);

  const pending = [];
  for (const deadline of Array.isArray(deadlines) ? deadlines : []) {
    const kind = squash(deadline?.kind).toUpperCase();
    if (!ENTITY_PUBLICATION_KINDS.has(kind)) continue;
    const at = ms(deadline?.value);
    if (at === null || at >= nowMs) continue;
    if (documentAt !== null && documentAt > at) continue; // llegó algo después de esa fecha
    if (publishedAt !== null && publishedAt > at) continue; // la entidad publicó un aviso después de esa fecha
    pending.push({ kind, label: squash(deadline?.label) || kind, value: deadline.value, at });
  }
  if (!pending.length) return [];

  // Salvaguarda, una vez que hay algo que concluir: sin una mirada reciente del Radar, el silencio puede ser
  // nuestro y no de la entidad. Entonces no se afirma nada.
  if (seenAt === null || nowMs - seenAt > radarStaleHours * 3_600_000) {
    return [{
      code: 'radar_sin_mirar',
      severity: 'media',
      deadlineLabel: null,
      deadlineValue: null,
      text: `Vig-IA, frescura: hay fechas del cronograma vencidas sin novedad, pero no se puede concluir si SECOP se movió: el Radar no ve este proceso desde ${seenAt === null ? 'nunca' : agt002FreshnessDay(seenAt)}. Revisar el Radar antes de leer el silencio como un atraso de la entidad.`,
    }];
  }

  const notices = pending
    .sort((left, right) => left.at - right.at)
    .map(item => ({
      code: 'entidad_sin_publicar',
      severity: 'media',
      deadlineLabel: item.label,
      deadlineValue: item.value,
      text: `Vig-IA, frescura: «${item.label}» estaba para el ${agt002FreshnessDay(item.value)} y no hay nada nuevo: el proceso sigue en «${phase}» y el expediente no tiene documentos posteriores a esa fecha. Verificar en SECOP II si la fase se publicó en otro enlace.`,
    }));

  // Lo que de verdad importa: cierre encima sin pliego definitivo publicado.
  const submission = (Array.isArray(deadlines) ? deadlines : [])
    .map(deadline => ({ kind: squash(deadline?.kind).toUpperCase(), value: deadline?.value, at: ms(deadline?.value) }))
    .filter(item => item.kind === 'SUBMISSION' && item.at !== null && item.at >= nowMs)
    .sort((left, right) => left.at - right.at)[0];
  const definitive = pending.find(item => item.kind === 'PUBLICATION' && DEFINITIVE_PLIEGO.test(item.label));
  if (submission && definitive && submission.at - nowMs <= closingHorizonDays * DAY_MS) {
    notices.unshift({
      code: 'cierre_sin_pliego_definitivo',
      severity: 'alta',
      deadlineLabel: definitive.label,
      deadlineValue: definitive.value,
      text: `Vig-IA, frescura: el cierre es el ${agt002FreshnessDay(submission.value)} y el pliego definitivo, previsto para el ${agt002FreshnessDay(definitive.value)}, no aparece. Con el borrador no se puede armar la oferta: confirmar en SECOP II si el proceso se movió a otro enlace o si la entidad va a aplazar.`,
    });
  }
  return notices;
}

/**
 * Revisión programada: por cada licitación convertida y activa, mira su cronograma contra lo que hay. Deja el aviso
 * como línea en la oportunidad con el RPC atómico que no duplica, y devuelve los eventos para el log. Cada
 * licitación falla por separado: una que no se pueda leer no corta las demás. Sólo lee y agrega avisos.
 */
export async function runAgt002ScheduleFreshnessReview(database, {
  now = new Date(), log = () => {}, inactiveReason, appendLine, limit = 50,
} = {}) {
  const events = [];
  const { data: tenders, error } = await database
    .from('psi_public_tenders')
    .select('id,ref,entity,status,updated_at,published_at,last_seen_at,converted_opportunity_id,internal_status')
    .eq('internal_status', 'convertida_oportunidad')
    .limit(limit);
  if (error) {
    log({ event: 'agt002_schedule_freshness_unavailable', message: String(error.message || error).slice(0, 200) });
    return events;
  }
  for (const tender of tenders || []) {
    const opportunityId = tender?.converted_opportunity_id;
    if (!opportunityId) continue;
    try {
      if (inactiveReason && await inactiveReason(database, opportunityId, tender.id)) continue;
      const { data: runs } = await database.from('psi_tender_analysis_runs')
        .select('id,result').eq('opportunity_id', opportunityId).eq('canonical', true).limit(1);
      const deadlines = runs?.[0]?.result?.meta?.process_deadlines;
      if (!Array.isArray(deadlines) || !deadlines.length) { events.push({ event: 'agt002_schedule_freshness_no_schedule', opportunityId }); continue; }
      // Sólo cuentan los documentos que publicó la entidad: una carga nuestra no rompe el silencio.
      const { data: documents } = await database.from('psi_tender_document_versions')
        .select('created_at,source').eq('opportunity_id', opportunityId).order('created_at', { ascending: false }).limit(50);
      const lastOfficial = (documents || []).find(document => agt002IsOfficialDocumentSource(document?.source));
      const notices = agt002ScheduleFreshnessNotices({
        deadlines, tender, lastDocumentAt: lastOfficial?.created_at || null, now,
      });
      for (const notice of notices) {
        if (appendLine) await appendLine(database, opportunityId, notice.text);
        events.push({ event: 'agt002_schedule_freshness_notice', opportunityId, ref: tender.ref || null, code: notice.code, severity: notice.severity, deadline: notice.deadlineValue || null });
      }
      if (!notices.length) events.push({ event: 'agt002_schedule_freshness_ok', opportunityId, ref: tender.ref || null });
    } catch (cause) {
      events.push({ event: 'agt002_schedule_freshness_failed', opportunityId, message: String(cause?.message || cause).slice(0, 200) });
    }
  }
  for (const event of events) log(event);
  return events;
}

export {
  ENTITY_PUBLICATION_KINDS as AGT002_FRESHNESS_ENTITY_KINDS,
  DEFAULT_RADAR_STALE_HOURS as AGT002_FRESHNESS_RADAR_STALE_HOURS,
  DEFAULT_CLOSING_HORIZON_DAYS as AGT002_FRESHNESS_CLOSING_HORIZON_DAYS,
};
