// AGT-003 — "Mi día": cola diaria de seguimiento comercial, con tope de 3 acciones principales.
//
// Módulo puro: sin JSX, sin red, sin mutación de sus argumentos. Deriva `MyDayQueue` en memoria
// a partir de `opportunities` (mismos datos ya cargados por `data.opportunities`), reutilizando
// `nextActionCardState`/`decisionMakerCardState` de `opportunity-ficha-presentation.ts` como
// única fuente de verdad para el estado de próxima gestión y de decisor.

import { nextActionCardState, decisionMakerCardState, type FichaCardState } from './opportunity-ficha-presentation';
import { stageStaleness, type StageStaleness } from './stage-staleness';

export type MyDayBucket = 'hacer_hoy' | 'preparar' | 'depurar_crm';

export type MyDayAlert = {
  id: string;
  bucket: MyDayBucket;
  companyName: string;
  fact: string;
  gap: string;
  goal: string;
  ctaHref: string;
  /** La oportunidad pasó el umbral de días de su etapa (migración 145). */
  stale: boolean;
};

export type MyDayQueue = {
  hacerHoy: MyDayAlert[];
  hacerHoyTotal: number;
  /** Cuántas oportunidades están estancadas, contadas sin el tope de la canasta. */
  estancadasTotal: number;
  preparar: MyDayAlert[];
  prepararTotal: number;
  depurarCrm: MyDayAlert[];
  depurarCrmTotal: number;
};

export type MyDayOpportunity = {
  id: string; company_name: string; stage_code: string; stage_name: string; stage_order: number;
  service_type_code: string | null; offer_value: number | null; regional_nombre: string | null;
  next_action_at: string | null; expected_close_date?: string | null;
  decision_maker_name: string | null; decision_maker_email: string | null; decision_maker_phone: string | null;
  stage_entered_at?: string | null; stage_entered_at_measured?: boolean | null; staleness_days?: number | null;
};

const HACER_HOY_LIMIT = 20;
const PREPARAR_LIMIT = 3;
const DEPURAR_LIMIT = 5;
const TERMINAL_STAGES = ['aprobado', 'perdido', 'descartado'];
// Basado en VIGIA_CONFIG.criticalStages (vigia-engine.js: ['sustentacion', 'negociacion']), pero no
// es una copia exacta: agrega 'envio_oferta' de forma intencional porque el audit de riesgo mostró
// que esa etapa concentra el mayor riesgo por falta de decisor verificado. No hay precedente en el
// repositorio de que un módulo de src/ importe un archivo raíz pensado para el backend, y ese
// acoplamiento nuevo no se introduce aquí. Si vigia-engine.js cambia sustentacion/negociacion, revisar
// si el cambio también aplica aquí.
const ADVANCED_STAGES = ['sustentacion', 'negociacion', 'envio_oferta'];

const BOGOTA_DATE_LABEL = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : BOGOTA_DATE_LABEL.format(parsed);
}

function ctaHref(id: string): string {
  return `#/detail/${id}?focus=interaction`;
}

function compareByValueStageNameId(a: MyDayOpportunity, b: MyDayOpportunity): number {
  return (Number(b.offer_value) || 0) - (Number(a.offer_value) || 0)
    || b.stage_order - a.stage_order
    || a.company_name.localeCompare(b.company_name, 'es')
    || String(a.id).localeCompare(String(b.id));
}

// El estancamiento no abre una canasta nueva: una oportunidad estancada es, por definición, una que no tiene
// próxima gestión futura, así que ya está en "Hacer hoy". Lo que agrega es el hecho de cuánto lleva parada.
function withStall(alert: MyDayAlert, stall: StageStaleness): MyDayAlert {
  if (!stall.stale || !stall.label) return alert;
  return { ...alert, fact: `${alert.fact} ${stall.label}`, stale: true };
}

function overdueAlert(o: MyDayOpportunity, next: FichaCardState): MyDayAlert {
  return {
    id: o.id,
    bucket: 'hacer_hoy',
    companyName: o.company_name,
    fact: `Próxima gestión ${next.detail.toLowerCase()} (programada para ${fmtDate(o.next_action_at)}).`,
    gap: 'La fecha pasó y no hay una próxima acción vigente.',
    goal: 'Registrar el resultado pendiente, si aplica, y agendar la próxima gestión.',
    ctaHref: ctaHref(o.id),
    stale: false,
  };
}

function missingAlert(o: MyDayOpportunity): MyDayAlert {
  return {
    id: o.id,
    bucket: 'hacer_hoy',
    companyName: o.company_name,
    fact: 'Sin próxima gestión agendada.',
    gap: 'No hay fecha ni acción definida para el siguiente contacto.',
    goal: 'Agendar la próxima gestión con fecha concreta.',
    ctaHref: ctaHref(o.id),
    stale: false,
  };
}

function todayAlert(o: MyDayOpportunity): MyDayAlert {
  return {
    id: o.id,
    bucket: 'hacer_hoy',
    companyName: o.company_name,
    fact: `Gestión agendada para hoy (${fmtDate(o.next_action_at)}).`,
    gap: 'Falta hacer el contacto y registrar qué pasó.',
    goal: 'Hacer la gestión, registrar el resultado y agendar la siguiente.',
    ctaHref: ctaHref(o.id),
    stale: false,
  };
}

function prepararAlert(o: MyDayOpportunity, decision: FichaCardState): MyDayAlert {
  return {
    id: o.id,
    bucket: 'preparar',
    companyName: o.company_name,
    fact: `Oportunidad en etapa ${o.stage_name} sin decisor verificado.`,
    gap: decision.detail,
    goal: 'Completar el contacto del decisor antes de avanzar la negociación.',
    ctaHref: ctaHref(o.id),
    stale: false,
  };
}

function depurarAlert(o: MyDayOpportunity): MyDayAlert {
  const missing: string[] = [];
  if (!(Number(o.offer_value) > 0)) missing.push('valor registrado');
  if (!String(o.regional_nombre || '').trim()) missing.push('regional');
  return {
    id: o.id,
    bucket: 'depurar_crm',
    companyName: o.company_name,
    fact: 'Faltan datos base de la oportunidad.',
    gap: missing.join(' y '),
    goal: 'Completar los datos para mejorar reportes y priorización.',
    ctaHref: ctaHref(o.id),
    stale: false,
  };
}

export function buildMyDayQueue(opportunities: MyDayOpportunity[], now: Date = new Date()): MyDayQueue {
  const eligible = opportunities.filter(o => !TERMINAL_STAGES.includes(o.stage_code) && o.service_type_code !== 'licitacion_publica');

  const hacerHoyEntries: Array<{ opportunity: MyDayOpportunity; next: FichaCardState; stall: StageStaleness }> = [];
  const prepararEntries: Array<{ opportunity: MyDayOpportunity; decision: FichaCardState }> = [];
  const depurarEntries: MyDayOpportunity[] = [];

  let estancadasTotal = 0;
  for (const o of eligible) {
    const stall = stageStaleness({
      stageEnteredAt: o.stage_entered_at, measured: o.stage_entered_at_measured,
      stalenessDays: o.staleness_days, nextActionAt: o.next_action_at, stageName: o.stage_name, now,
    });
    if (stall.stale) estancadasTotal += 1;
    const next = nextActionCardState({ stage_code: o.stage_code, next_action_at: o.next_action_at }, now);
    if (next.code === 'overdue' || next.code === 'missing' || next.code === 'today') {
      hacerHoyEntries.push({ opportunity: o, next, stall });
      continue;
    }
    if (ADVANCED_STAGES.includes(o.stage_code)) {
      const decision = decisionMakerCardState({ name: o.decision_maker_name, email: o.decision_maker_email, phone: o.decision_maker_phone });
      if (decision.code !== 'complete') {
        prepararEntries.push({ opportunity: o, decision });
        continue;
      }
    }
    if (!(Number(o.offer_value) > 0) || !String(o.regional_nombre || '').trim()) {
      depurarEntries.push(o);
    }
  }

  // Dentro de cada grupo, primero la que lleva más tiempo parada: con tope de 20 tarjetas, una oportunidad
  // estancada que quede por debajo del corte no se vería nunca.
  hacerHoyEntries.sort((a, b) => {
    const rank = (code: string) => (code === 'overdue' ? 0 : code === 'missing' ? 1 : 2);
    return rank(a.next.code) - rank(b.next.code)
      || Number(b.stall.stale) - Number(a.stall.stale)
      || (b.stall.stale && a.stall.stale ? (b.stall.days || 0) - (a.stall.days || 0) : 0)
      || compareByValueStageNameId(a.opportunity, b.opportunity);
  });
  prepararEntries.sort((a, b) => compareByValueStageNameId(a.opportunity, b.opportunity));
  depurarEntries.sort(compareByValueStageNameId);

  const hacerHoyAlerts = hacerHoyEntries.map(({ opportunity, next, stall }) => withStall(
    next.code === 'overdue' ? overdueAlert(opportunity, next) : next.code === 'missing' ? missingAlert(opportunity) : todayAlert(opportunity),
    stall,
  ));
  const prepararAlerts = prepararEntries.map(({ opportunity, decision }) => prepararAlert(opportunity, decision));
  const depurarAlerts = depurarEntries.map(depurarAlert);

  return {
    hacerHoy: hacerHoyAlerts.slice(0, HACER_HOY_LIMIT),
    hacerHoyTotal: hacerHoyAlerts.length,
    estancadasTotal,
    preparar: prepararAlerts.slice(0, PREPARAR_LIMIT),
    prepararTotal: prepararAlerts.length,
    depurarCrm: depurarAlerts.slice(0, DEPURAR_LIMIT),
    depurarCrmTotal: depurarAlerts.length,
  };
}

// ---------------------------------------------------------------------------------------------
// El día despejado (Juan, 2026-10-22). Texto puro: cómo se nombra una fecha dentro de una frase y
// cómo se lee un teléfono. Sin JSX y sin red, para poder probarlo.
// ---------------------------------------------------------------------------------------------

const BOGOTA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });
const LONG_DATE = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
const WEEKDAY_ONLY = new Intl.DateTimeFormat('es-CO', { weekday: 'long', timeZone: 'America/Bogota' });

function dayKey(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : BOGOTA_DAY.format(date);
}

function wholeDaysBetween(fromDay: string, toDay: string): number {
  return Math.round((new Date(`${toDay}T12:00:00Z`).getTime() - new Date(`${fromDay}T12:00:00Z`).getTime()) / 86_400_000);
}

/** Cómo se nombra una fecha pasada dentro de una frase: "hoy", "ayer", "hace 4 días", "el 7 de octubre". */
export function pastDayPhrase(value: string | null | undefined, now: Date = new Date()): string {
  const day = dayKey(value);
  const today = dayKey(now);
  if (!day || !today) return '';
  const days = wholeDaysBetween(day, today);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return `el ${LONG_DATE.format(new Date(String(value)))}`;
}

/** Y una futura: "hoy", "mañana", "el lunes", "el 15 de diciembre". */
export function futureDayPhrase(value: string | null | undefined, now: Date = new Date()): string {
  const day = dayKey(value);
  const today = dayKey(now);
  if (!day || !today) return '';
  const days = wholeDaysBetween(today, day);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days <= 6) return `el ${WEEKDAY_ONLY.format(new Date(String(value)))}`;
  return `el ${LONG_DATE.format(new Date(String(value)))}`;
}

/** El teléfono del decisor se lee, no se audita: "+573107285800" se marca igual, pero así se puede dictar. */
export function readablePhone(value: string | null | undefined): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) return `+57 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return String(value || '').trim();
}

/** Un nombre que ya termina en punto ("... S.A.S.") no lleva otro al cerrar la frase. */
export function sentenceName(name: string): string {
  return String(name || '').replace(/\.$/, '');
}

/**
 * La fecha de cierre estimada en una frase. Separa pasado de futuro a propósito: 74 de las 193 oportunidades
 * abiertas tienen una fecha de cierre que ya pasó, y decir "espera cerrarla hoy" de una fecha de julio es
 * afirmar algo falso. Cuando ya pasó, el dato útil es justamente que se venció.
 */
export function closeDateLine(value: string | null | undefined, now: Date = new Date()): string {
  const day = value ? String(value).slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const instant = `${day}T12:00:00-05:00`;
  const today = dayKey(now);
  if (!today) return '';
  if (day < today) return `La fecha de cierre que puso pasó ${pastDayPhrase(instant, now)}`;
  if (day === today) return 'Espera cerrarla hoy';
  return `Espera cerrarla ${futureDayPhrase(instant, now)}`;
}
