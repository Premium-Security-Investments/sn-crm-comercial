// AGT-003 — brief antes de la reunión (F12 de la especificación del 2026-10-22; capacidad 2 del mapa del 10-oct).
//
// Lo que el comercial necesita leer en treinta segundos antes de entrar: qué tiene hoy el cliente, qué pasó desde la
// última vez, qué más hay abierto con él, qué se perdió antes y qué conviene llevar preparado.
//
// Dos reglas que lo gobiernan, de la especificación:
//   · cada afirmación sale de datos del CRM. No hay llamada a un modelo aquí: lo que no está registrado no se dice,
//     y lo que falta se nombra en `faltaEnElCrm` en vez de rellenarse;
//   · lo que es sugerencia va marcado como sugerencia, y cada una dice en qué dato se apoya.
//
// Módulo puro: no lee red ni base, y no altera lo que recibe.

import { stageStaleness } from './stage-staleness';

const DAY_MS = 86_400_000;
const RENEWAL_HORIZON_DAYS = 90;
const RECENT_INTERACTIONS = 5;

export type BriefOpportunity = {
  id: string;
  client_id?: string | null;
  company_name: string;
  stage_code: string;
  stage_name: string;
  offer_value?: number | null;
  service_type_name?: string | null;
  service_type_code?: string | null;
  economic_sector?: string | null;
  sede?: string | null;
  quote_city?: string | null;
  regional_nombre?: string | null;
  decision_maker_name?: string | null;
  decision_maker_title?: string | null;
  decision_maker_phone?: string | null;
  decision_maker_email?: string | null;
  company_website?: string | null;
  current_security_provider?: string | null;
  current_security_provider_none?: boolean | null;
  current_contract_end_date?: string | null;
  next_action_at?: string | null;
  last_interaction_at?: string | null;
  loss_reason_name?: string | null;
  competitor_name?: string | null;
  stage_entered_at?: string | null;
  stage_entered_at_measured?: boolean | null;
  staleness_days?: number | null;
};

export type BriefInteraction = { interaction_type?: string | null; notes?: string | null; occurred_at?: string | null };
export type BriefFact = { label: string; value: string };
export type MeetingBrief = {
  cliente: BriefFact[];
  estado: BriefFact[];
  desdeLaUltimaVez: string[];
  otrasOportunidades: string[];
  perdidasPrevias: string[];
  sugerencias: string[];
  faltaEnElCrm: string[];
};

const CHANNEL: Record<string, string> = {
  llamada: 'Llamada', correo: 'Correo', reunion: 'Reunión', whatsapp: 'WhatsApp',
  nota: 'Nota', cambio_estado: 'Cambio de estado', documento: 'Documento',
};
const DAY_LABEL = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long' });
const MONEY = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const TERMINAL = ['aprobado', 'perdido', 'descartado'];

const text = (value: unknown) => String(value ?? '').trim();
function ms(value?: string | null): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw.length === 10 ? `${raw}T12:00:00-05:00` : raw.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isFinite(parsed) ? parsed : null;
}
const day = (value?: string | null) => { const at = ms(value); return at === null ? null : DAY_LABEL.format(new Date(at)); };
const daysBetween = (from: number, to: number) => Math.round((to - from) / DAY_MS);

function fact(list: BriefFact[], label: string, value: string | null | undefined) {
  const clean = text(value);
  if (clean) list.push({ label, value: clean });
}

/** El brief de una oportunidad: hechos del CRM primero, sugerencias al final y marcadas. */
export function meetingBrief({
  opportunity, interactions = [], siblings = [], now = new Date(),
}: {
  opportunity: BriefOpportunity;
  interactions?: BriefInteraction[];
  siblings?: BriefOpportunity[];
  now?: Date;
}): MeetingBrief {
  const nowMs = now.getTime();
  const cliente: BriefFact[] = [];
  fact(cliente, 'Sector', opportunity.economic_sector);
  fact(cliente, 'Dónde', [opportunity.sede, opportunity.quote_city, opportunity.regional_nombre].map(text).filter(Boolean)[0]);
  fact(cliente, 'Decisor', [opportunity.decision_maker_name, opportunity.decision_maker_title].map(text).filter(Boolean).join(' · '));
  fact(cliente, 'Contacto', [opportunity.decision_maker_phone, opportunity.decision_maker_email].map(text).filter(Boolean).join(' · '));
  fact(cliente, 'Página web', opportunity.company_website);
  fact(cliente, 'Seguridad hoy', opportunity.current_security_provider_none === true
    ? 'No tiene proveedor'
    : opportunity.current_security_provider);
  const contractEnd = day(opportunity.current_contract_end_date);
  if (contractEnd) fact(cliente, 'Contrato actual vence', contractEnd);

  const stall = stageStaleness({
    stageEnteredAt: opportunity.stage_entered_at, measured: opportunity.stage_entered_at_measured,
    stalenessDays: opportunity.staleness_days, nextActionAt: opportunity.next_action_at,
    stageName: opportunity.stage_name, now,
  });
  const estado: BriefFact[] = [];
  fact(estado, 'Etapa', [opportunity.stage_name, stall.days === null ? '' : stall.label.replace(/\.$/, '')].filter(Boolean).join(' · '));
  fact(estado, 'Servicio', opportunity.service_type_name);
  if (Number(opportunity.offer_value) > 0) fact(estado, 'Valor', MONEY.format(Number(opportunity.offer_value)));
  fact(estado, 'Próxima gestión', day(opportunity.next_action_at));
  fact(estado, 'Último seguimiento', day(opportunity.last_interaction_at));

  const desdeLaUltimaVez = [...interactions]
    .sort((a, b) => (ms(b.occurred_at) || 0) - (ms(a.occurred_at) || 0))
    .slice(0, RECENT_INTERACTIONS)
    .map(item => {
      const when = day(item.occurred_at);
      const channel = CHANNEL[text(item.interaction_type)] || 'Nota';
      const note = text(item.notes).replace(/\s+/g, ' ');
      return `${when ? `${when} · ` : ''}${channel}${note ? `: ${note}` : ''}`;
    });

  const family = siblings.filter(row => row.id !== opportunity.id);
  const otrasOportunidades = family
    .filter(row => !TERMINAL.includes(text(row.stage_code)))
    .map(row => `${row.company_name} · ${row.stage_name}${Number(row.offer_value) > 0 ? ` · ${MONEY.format(Number(row.offer_value))}` : ''}${text(row.service_type_name) ? ` · ${text(row.service_type_name)}` : ''}`);

  const perdidasPrevias = family
    .filter(row => text(row.stage_code) === 'perdido')
    .map(row => {
      const motivo = text(row.loss_reason_name) || 'sin motivo registrado';
      const competidor = text(row.competitor_name);
      return `${row.company_name}: ${motivo}${competidor ? ` · frente a ${competidor}` : ''}`;
    });

  // Sugerencias: cada una dice de dónde sale. Nada que no se pueda sostener con un dato de arriba.
  const sugerencias: string[] = [];
  const endAt = ms(opportunity.current_contract_end_date);
  if (endAt !== null) {
    const left = daysBetween(nowMs, endAt);
    if (left >= 0 && left <= RENEWAL_HORIZON_DAYS) sugerencias.push(`El contrato actual vence el ${contractEnd} (en ${left} día(s)): es el momento de hablar de renovación.`);
    else if (left < 0) sugerencias.push(`El contrato actual venció el ${contractEnd}: confirme con quién está hoy el servicio.`);
  }
  if (opportunity.current_security_provider_none === true) sugerencias.push('No tienen proveedor de seguridad registrado: la conversación es de primera vez, no de reemplazo.');
  else if (text(opportunity.current_security_provider)) sugerencias.push(`Hoy están con ${text(opportunity.current_security_provider)}: pregunte qué les falta de ese servicio.`);
  if (stall.stale && stall.days !== null) sugerencias.push(`${stall.label} Conviene salir de la reunión con un compromiso concreto.`);
  if (perdidasPrevias.length) sugerencias.push('Ya se perdió una oportunidad de este cliente: revise el motivo antes de repetir la propuesta.');
  if (!ms(opportunity.next_action_at) || (ms(opportunity.next_action_at) || 0) <= nowMs) sugerencias.push('No hay próxima gestión vigente: deje la fecha del siguiente contacto antes de cerrar la reunión.');

  const faltaEnElCrm: string[] = [];
  if (!text(opportunity.decision_maker_name)) faltaEnElCrm.push('quién decide');
  if (!text(opportunity.decision_maker_phone) && !text(opportunity.decision_maker_email)) faltaEnElCrm.push('cómo contactarlo');
  if (!text(opportunity.economic_sector)) faltaEnElCrm.push('el sector');
  if (opportunity.current_security_provider_none !== true && !text(opportunity.current_security_provider)) faltaEnElCrm.push('con quién están hoy');
  if (!contractEnd) faltaEnElCrm.push('cuándo vence su contrato actual');
  if (!(Number(opportunity.offer_value) > 0)) faltaEnElCrm.push('el valor estimado');
  if (!interactions.length) faltaEnElCrm.push('no hay seguimientos registrados');

  return { cliente, estado, desdeLaUltimaVez, otrasOportunidades, perdidasPrevias, sugerencias, faltaEnElCrm };
}
