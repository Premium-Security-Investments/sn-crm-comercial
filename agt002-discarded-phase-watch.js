// AGT-002 — vigilancia mínima de lo descartado (pedido de Juan, 2026-10-22): si un proceso que descartamos publica
// una fase nueva con un cierre posterior, avisarlo una vez.
//
// El caso que lo pidió: `SME-LP-163-2026` (vigilancia para los colegios de Pereira) entró al CRM el 28-ago y salió con
// la nota "La fecha de cierre esta muy cerca y ya no vamos a alcanzar a presentarnos", contra un cierre del 8-sep. El
// 7-sep Pereira publicó la fase de oferta en otro aviso (`CO1.NTC.10850776`) con cierre el 22-sep: dos semanas más de
// las que se creían. Nadie avisó, porque al descartar la licitación vuelve al Radar y la revisión de fases del #332
// sólo mira oportunidades activas (#335). Se adjudicó con una sola oferta.
//
// La vigilancia completa sigue apagada en lo descartado: eso no cambia. Esto es sólo el aviso, y nada más:
//   * no baja documentos, no reanaliza, no toca la etapa de la oportunidad ni el `internal_status` de la licitación;
//   * no revive nada: deja una línea en la oportunidad y un evento para el correo de Hermes;
//   * una sola vez por aviso nuevo, porque el texto es estable y el RPC de la línea no duplica.
//
// Alcance deliberado: sólo `descartado`. Una oportunidad `perdido` ya se adjudicó a otro, así que una fase nueva allí
// es ruido. Y sólo se avisa de un cierre que todavía está por venir: lo que ya pasó no se puede mirar otra vez.

import { agt002FreshnessDay } from './agt002-schedule-freshness.js';
import { isTerminalTenderStatus, tenderProcessFamilyKey, compareTenderFamilyRecency } from './tender-process-family.js';

export const AGT002_DISCARDED_WATCH_STAGE = 'descartado';
const DEFAULT_OPPORTUNITY_LIMIT = 500;
const DEFAULT_TENDER_LIMIT = 50;

// Postgres entrega "2026-09-08 00:00:00+00": con espacio en vez de T y el desfase sin minutos, que Date.parse
// rechaza. Mismo normalizador que la verificación de frescura, y por la misma razón.
const ms = value => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Date.parse(text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isFinite(parsed) ? parsed : null;
};
const squash = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * El cierre en palabras. `psi_public_tenders.deadline_at` mezcla dos cosas: casi siempre es una FECHA guardada como
 * medianoche UTC ('2026-09-08 00:00:00+00' para el cierre del 8 de septiembre), y a veces una hora de verdad
 * ('2026-10-13 14:00:00+00' = 9:00 a. m. en Bogotá). Leer la primera en hora de Bogotá la corre un día hacia atrás
 * —el 8 de septiembre se leía "7 de septiembre"—, así que la medianoche UTC exacta se dice en UTC, como la fecha que
 * es, y cualquier otra hora sí se traduce a Bogotá. Lo mostró la corrida en seco contra las filas reales del Radar.
 */
export function agt002WatchDeadlineDay(value) {
  const at = ms(value);
  if (at === null) return 'sin fecha';
  if (at % 86_400_000 === 0) {
    return new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(at));
  }
  // El valor original, no `at`: agt002FreshnessDay parsea texto y un número de milisegundos no lo es.
  return agt002FreshnessDay(value);
}

/** 'https://...Index?noticeUID=CO1.NTC.10850776' → 'CO1.NTC.10850776'. */
export function agt002WatchNoticeUid(url) {
  const match = String(url || '').match(/noticeUID=([A-Za-z0-9.\-_]+)/i);
  return match ? match[1] : null;
}

/** Una fila que ya tiene oportunidad propia la sigue alguien más: no se avisa de ella. */
function isFollowedElsewhere(row) {
  return row?.internal_status === 'convertida_oportunidad' || Boolean(row?.converted_opportunity_id);
}

/**
 * ¿Hay una fase nueva que invalide la fecha con la que se descartó? Puro: no lee ni escribe nada.
 *
 * `discarded` es la fila del Radar de la licitación que se descartó; `candidates` son filas del Radar donde buscar
 * la familia (se filtran aquí por clave de familia, para que la prueba pueda pasar filas crudas). Devuelve el aviso
 * o `null`. Exige cierre en las dos filas: sin el cierre viejo no se puede afirmar que la fecha cambió, y sin el
 * nuevo no hay nada que mirar.
 */
export function agt002DiscardedPhaseWatchNotice({ discarded, candidates = [], now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : ms(now);
  if (!Number.isFinite(nowMs)) return null;
  const familyKey = tenderProcessFamilyKey(discarded);
  if (!familyKey) return null; // Sólo SECOP II, y sólo con una referencia que identifique el proceso.
  const previousAt = ms(discarded?.deadline_at);
  if (previousAt === null) return null;

  const newer = (Array.isArray(candidates) ? candidates : [])
    .filter(row => row && row.stable_key && row.stable_key !== discarded.stable_key)
    .filter(row => tenderProcessFamilyKey(row) === familyKey)
    .filter(row => !isFollowedElsewhere(row))
    .filter(row => !isTerminalTenderStatus(row.status))
    .map(row => ({ row, at: ms(row.deadline_at) }))
    // El cierre nuevo tiene que ser posterior al que se usó para decidir Y todavía estar por venir.
    .filter(item => item.at !== null && item.at > previousAt && item.at > nowMs)
    .sort((left, right) => right.at - left.at || compareTenderFamilyRecency(right.row, left.row));
  if (!newer.length) return null;

  const { row, at } = newer[0];
  const phase = squash(row.status);
  const ref = squash(row.ref) || squash(discarded.ref) || 'el proceso';
  const url = squash(row.url);
  return {
    code: 'descartado_con_fase_nueva',
    severity: 'alta',
    noticeUid: agt002WatchNoticeUid(url),
    ref,
    url: url || null,
    phase: phase || null,
    deadline: row.deadline_at,
    previousDeadline: discarded.deadline_at,
    // Fechas en palabras ya resueltas aquí: el módulo de avisos por correo es puro y no formatea fechas.
    deadlineLabel: agt002WatchDeadlineDay(row.deadline_at),
    previousDeadlineLabel: agt002WatchDeadlineDay(discarded.deadline_at),
    text: `Vig-IA: este proceso se descartó con el cierre del ${agt002WatchDeadlineDay(discarded.deadline_at)}, pero SECOP publicó «${ref}»${phase ? ` en «${phase}»` : ''} con cierre el ${agt002WatchDeadlineDay(row.deadline_at)}. La decisión se tomó con una fecha que ya no es la vigente: vale la pena mirarlo otra vez.${url ? ` Enlace: ${url}` : ''}`,
    deadlineAt: at,
  };
}

/**
 * Revisión programada: por cada licitación cuya oportunidad quedó descartada, mira si su familia tiene una fase nueva
 * con cierre posterior y todavía por venir. Deja la línea en la oportunidad con el RPC que no duplica y devuelve los
 * eventos para el log y para el correo. Cada licitación falla por separado. Sólo lee y agrega avisos.
 */
export async function runAgt002DiscardedPhaseWatch(database, {
  now = new Date(), log = () => {}, appendLine, limit = DEFAULT_TENDER_LIMIT,
  opportunityLimit = DEFAULT_OPPORTUNITY_LIMIT,
} = {}) {
  const events = [];
  const fail = (event, error) => {
    log({ event, message: String(error?.message || error).slice(0, 200) });
    return events;
  };

  const { data: discardedOpportunities, error: opportunitiesError } = await database
    .from('psi_sales_opportunities')
    .select('id,stage_code')
    .eq('stage_code', AGT002_DISCARDED_WATCH_STAGE)
    .limit(opportunityLimit);
  if (opportunitiesError) return fail('agt002_discarded_phase_watch_unavailable', opportunitiesError);
  const discardedIds = (discardedOpportunities || []).map(row => row.id).filter(Boolean);
  if (!discardedIds.length) return events;

  const FAMILY_COLUMNS = 'id,stable_key,source,entity,ref,process_id,published_at,deadline_at,status,url,internal_status,converted_opportunity_id';
  const { data: tenders, error: tendersError } = await database
    .from('psi_public_tenders')
    .select(FAMILY_COLUMNS)
    .in('converted_opportunity_id', discardedIds)
    .limit(limit);
  if (tendersError) return fail('agt002_discarded_phase_watch_tenders_unavailable', tendersError);
  if (!tenders?.length) return events;

  // Una sola lectura de candidatos para todas: la familia exige la misma entidad, así que basta con las filas de esas
  // entidades. La clave de familia se calcula en memoria (normaliza tildes, puntuación y sufijos de fase).
  const entities = [...new Set((tenders || []).map(row => row.entity).filter(Boolean))];
  if (!entities.length) return events;
  const { data: candidates, error: candidatesError } = await database
    .from('psi_public_tenders')
    .select(FAMILY_COLUMNS)
    .in('entity', entities);
  if (candidatesError) return fail('agt002_discarded_phase_watch_family_unavailable', candidatesError);

  for (const tender of tenders) {
    const opportunityId = tender?.converted_opportunity_id;
    if (!opportunityId) continue;
    try {
      const notice = agt002DiscardedPhaseWatchNotice({ discarded: tender, candidates: candidates || [], now });
      if (!notice) { events.push({ event: 'agt002_discarded_phase_watch_ok', opportunityId, ref: tender.ref || null }); continue; }
      if (appendLine) await appendLine(database, opportunityId, notice.text);
      events.push({
        event: 'agt002_discarded_phase_watch_notice', opportunityId, ref: notice.ref,
        code: notice.code, severity: notice.severity, noticeUid: notice.noticeUid, url: notice.url,
        phase: notice.phase, deadline: notice.deadline, previousDeadline: notice.previousDeadline,
        deadlineLabel: notice.deadlineLabel, previousDeadlineLabel: notice.previousDeadlineLabel,
      });
    } catch (cause) {
      events.push({ event: 'agt002_discarded_phase_watch_failed', opportunityId, message: String(cause?.message || cause).slice(0, 200) });
    }
  }
  for (const event of events) log(event);
  return events;
}

export { DEFAULT_TENDER_LIMIT as AGT002_DISCARDED_WATCH_TENDER_LIMIT };
