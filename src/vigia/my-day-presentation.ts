// AGT-003 — "Mi día": cola diaria de seguimiento comercial, con tope de 3 acciones principales.
//
// Módulo puro: sin JSX, sin red, sin mutación de sus argumentos. Deriva `MyDayQueue` en memoria
// a partir de `opportunities` (mismos datos ya cargados por `data.opportunities`), reutilizando
// `nextActionCardState`/`decisionMakerCardState` de `opportunity-ficha-presentation.ts` como
// única fuente de verdad para el estado de próxima gestión y de decisor.

import { nextActionCardState, decisionMakerCardState, type FichaCardState } from './opportunity-ficha-presentation';

export type MyDayBucket = 'hacer_hoy' | 'preparar' | 'depurar_crm';

export type MyDayAlert = {
  id: string;
  bucket: MyDayBucket;
  companyName: string;
  fact: string;
  gap: string;
  goal: string;
  ctaHref: string;
};

export type MyDayQueue = {
  hacerHoy: MyDayAlert[];
  hacerHoyTotal: number;
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
};

const HACER_HOY_LIMIT = 3;
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

function overdueAlert(o: MyDayOpportunity, next: FichaCardState): MyDayAlert {
  return {
    id: o.id,
    bucket: 'hacer_hoy',
    companyName: o.company_name,
    fact: `Próxima gestión vencida ${next.detail.toLowerCase()} (programada para ${fmtDate(o.next_action_at)}).`,
    gap: 'La fecha pasó y no hay una próxima acción vigente.',
    goal: 'Registrar el resultado pendiente, si aplica, y agendar la próxima gestión.',
    ctaHref: ctaHref(o.id),
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
  };
}

export function buildMyDayQueue(opportunities: MyDayOpportunity[], now: Date = new Date()): MyDayQueue {
  const eligible = opportunities.filter(o => !TERMINAL_STAGES.includes(o.stage_code) && o.service_type_code !== 'licitacion_publica');

  const hacerHoyEntries: Array<{ opportunity: MyDayOpportunity; next: FichaCardState }> = [];
  const prepararEntries: Array<{ opportunity: MyDayOpportunity; decision: FichaCardState }> = [];
  const depurarEntries: MyDayOpportunity[] = [];

  for (const o of eligible) {
    const next = nextActionCardState({ stage_code: o.stage_code, next_action_at: o.next_action_at }, now);
    if (next.code === 'overdue' || next.code === 'missing') {
      hacerHoyEntries.push({ opportunity: o, next });
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

  hacerHoyEntries.sort((a, b) => {
    const rank = (code: string) => (code === 'overdue' ? 0 : 1);
    return rank(a.next.code) - rank(b.next.code) || compareByValueStageNameId(a.opportunity, b.opportunity);
  });
  prepararEntries.sort((a, b) => compareByValueStageNameId(a.opportunity, b.opportunity));
  depurarEntries.sort(compareByValueStageNameId);

  const hacerHoyAlerts = hacerHoyEntries.map(({ opportunity, next }) => (next.code === 'overdue' ? overdueAlert(opportunity, next) : missingAlert(opportunity)));
  const prepararAlerts = prepararEntries.map(({ opportunity, decision }) => prepararAlert(opportunity, decision));
  const depurarAlerts = depurarEntries.map(depurarAlert);

  return {
    hacerHoy: hacerHoyAlerts.slice(0, HACER_HOY_LIMIT),
    hacerHoyTotal: hacerHoyAlerts.length,
    preparar: prepararAlerts.slice(0, PREPARAR_LIMIT),
    prepararTotal: prepararAlerts.length,
    depurarCrm: depurarAlerts.slice(0, DEPURAR_LIMIT),
    depurarCrmTotal: depurarAlerts.length,
  };
}
