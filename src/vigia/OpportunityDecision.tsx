import { useMemo, useState } from 'react';
import { api } from '../apiClient';
import { bogotaDay, FREEZE_DAYS, type DecisionCode } from './opportunity-decision-rules.js';
import { stageStaleness } from './stage-staleness';
import { closeDateLine, clockTime, futureDayPhrase, pastDayPhrase, readablePhone, sentenceName } from './my-day-presentation';

// CRM comercial — decisión obligatoria por oportunidad (2026-10-07). Toda oportunidad abierta debe quedar con una
// decisión vigente: sigue viva (con fecha), avanza, congelada, descartada, perdida o con eliminación pedida.

export type DecisionOpportunity = {
  id: string; company_name: string; owner_name?: string | null; stage_code: string; stage_name: string; stage_order: number;
  offer_value: number | null; next_action_at: string | null; last_interaction_at?: string | null; updated_at?: string | null;
  created_at?: string | null; frozen_until?: string | null; delete_requested_at?: string | null; delete_request_reason?: string | null;
  decision_maker_name?: string | null; decision_maker_phone?: string | null; sede?: string | null; quote_city?: string | null;
  stage_entered_at?: string | null; stage_entered_at_measured?: boolean | null; staleness_days?: number | null;
  client_id?: string | null; economic_sector?: string | null; service_type_name?: string | null; regional_nombre?: string | null;
  expected_close_date?: string | null; approved_at?: string | null; lost_at?: string | null; discarded_at?: string | null;
};
type StageOption = { code: string; name: string; stage_order: number; is_terminal: boolean };
type ReasonOption = { code: string; name: string };
export type CompetitorOption = { id: string; name: string };
const OTHER_COMPETITOR = '__otro__';

const DECISION_LABELS: Record<DecisionCode, string> = {
  continue: 'Sigue viva', advance: 'Avanza', freeze: 'Congelar', discard: 'Descartar', lose: 'Perdida', request_delete: 'Pedir eliminar',
};
const DECISION_HINTS: Record<DecisionCode, string> = {
  continue: 'Hubo contacto o sigue en curso: deje la próxima gestión agendada.',
  advance: 'Pasó a una etapa más avanzada o se ganó.',
  freeze: 'Hoy no avanza pero puede volver: sale de sus cifras y vuelve sola en la fecha.',
  discard: 'No se va a trabajar (no era real, no aplica, sin interés).',
  lose: 'Se compitió y se perdió.',
  request_delete: 'Está duplicada o se creó por error. El director comercial confirma.',
};
const DELETE_REASONS = ['Duplicada', 'Creada por error', 'No es una oportunidad comercial'];
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00-05:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return bogotaDay(date) || day;
}
const todayDay = () => bogotaDay(new Date()) || new Date().toISOString().slice(0, 10);
/** Una fecha de calendario elegida en Bogotá, a las 9:00 a. m. de ese día. */
const dayToIso = (day: string) => new Date(`${day}T09:00:00-05:00`).toISOString();

function daysBetween(fromDay: string, toDay: string) {
  return Math.round((new Date(`${toDay}T12:00:00Z`).getTime() - new Date(`${fromDay}T12:00:00Z`).getTime()) / 86_400_000);
}

/** Por qué pide decisión, en una frase. */
export function pendingReason(opportunity: DecisionOpportunity): string {
  const today = todayDay();
  if (!opportunity.next_action_at) return 'Sin próxima gestión';
  const next = bogotaDay(opportunity.next_action_at) || today;
  const days = daysBetween(next, today);
  return `Vencida hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

async function sendDecision(id: string, body: Record<string, unknown>) {
  return api(`/api/opportunity-decision?id=${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) });
}

export function OpportunityDecisionForm({ opportunity, stages, lossReasons, competitors = [], onDone, initial = 'continue' }: {
  opportunity: DecisionOpportunity; stages: StageOption[]; lossReasons: ReasonOption[]; competitors?: CompetitorOption[];
  onDone: () => Promise<void> | void; initial?: DecisionCode;
}) {
  const today = todayDay();
  const [decision, setDecision] = useState<DecisionCode>(initial);
  // F5: contra quién se perdió. Opcional, como pide la especificación, y con opción de escribir uno nuevo.
  const [competitor, setCompetitor] = useState('');
  const [competitorName, setCompetitorName] = useState('');
  const [notes, setNotes] = useState('');
  // Si ya hay una próxima gestión futura (dentro del máximo de 90 días), se propone esa en vez de "en una semana".
  const scheduledDay = opportunity.next_action_at ? bogotaDay(opportunity.next_action_at) : null;
  const [nextDay, setNextDay] = useState(scheduledDay && scheduledDay > today && scheduledDay <= addDays(today, 90) ? scheduledDay : addDays(today, 7));
  const [followUpType, setFollowUpType] = useState('llamada');
  const [stageCode, setStageCode] = useState('');
  const [value, setValue] = useState('');
  const [freezeDays, setFreezeDays] = useState(30);
  const [reason, setReason] = useState('');
  const [deleteReason, setDeleteReason] = useState(DELETE_REASONS[0]);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const nextStages = stages.filter(stage => stage.stage_order > opportunity.stage_order && !['descartado', 'perdido'].includes(stage.code));
  const targetStage = stages.find(stage => stage.code === stageCode);
  const needsDate = decision === 'continue' || (decision === 'advance' && targetStage && !targetStage.is_terminal);
  const askValue = !(Number(opportunity.offer_value || 0) > 0) && (decision === 'continue' || decision === 'advance');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setStatus('Guardando…');
    try {
      const body: Record<string, unknown> = { decision, notes: decision === 'request_delete' ? `${deleteReason}. ${notes}`.trim() : notes };
      if (needsDate) body.next_action_at = dayToIso(nextDay);
      if (decision === 'continue') body.interaction_type = followUpType;
      if (decision === 'advance') body.stage_code = stageCode;
      if (askValue && value) body.offer_value = Number(value.replace(/[^\d]/g, ''));
      if (decision === 'freeze') body.freeze_days = freezeDays;
      if (decision === 'discard' || decision === 'lose') body.loss_reason_code = reason;
      if (decision === 'lose') {
        if (competitor && competitor !== OTHER_COMPETITOR) body.competitor_id = competitor;
        else if (competitor === OTHER_COMPETITOR && competitorName.trim()) body.competitor_name = competitorName.trim();
      }
      await sendDecision(opportunity.id, body);
      setStatus('Listo.');
      await onDone();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return <form className="decision-form" onSubmit={submit}>
    <div className="decision-choices" role="radiogroup" aria-label="Decisión">
      {(Object.keys(DECISION_LABELS) as DecisionCode[]).map(code => <button type="button" role="radio" aria-checked={decision === code}
        key={code} className={`decision-choice decision-${code}${decision === code ? ' is-active' : ''}`} onClick={() => setDecision(code)}>{DECISION_LABELS[code]}</button>)}
    </div>
    <p className="decision-hint">{DECISION_HINTS[decision]}</p>
    <div className="decision-fields">
      {decision === 'continue' && <label>Cómo fue el contacto<select value={followUpType} onChange={e => setFollowUpType(e.target.value)}>
        <option value="llamada">Llamada</option><option value="whatsapp">WhatsApp</option><option value="correo">Correo</option><option value="reunion">Reunión</option><option value="nota">Sin contacto todavía</option>
      </select></label>}
      {decision === 'advance' && <label>Nueva etapa<select required value={stageCode} onChange={e => setStageCode(e.target.value)}>
        <option value="">Seleccionar</option>{nextStages.map(stage => <option key={stage.code} value={stage.code}>{stage.code === 'aprobado' ? 'Ganada (aprobada)' : stage.name}</option>)}
      </select></label>}
      {needsDate && <label>Próxima gestión<input type="date" required min={today} max={addDays(today, 90)} value={nextDay} onChange={e => setNextDay(e.target.value)} />
        <span className="decision-quick-dates">{[2, 7, 15, 30].map(days => <button type="button" key={days} onClick={() => setNextDay(addDays(today, days))}>{days === 2 ? 'En 2 días' : days === 7 ? '1 semana' : days === 15 ? '15 días' : '1 mes'}</button>)}</span></label>}
      {askValue && <label>Valor estimado (COP)<input inputMode="numeric" placeholder="Ej. 80000000" value={value} onChange={e => setValue(e.target.value)} /></label>}
      {decision === 'freeze' && <label>Congelar por<select value={freezeDays} onChange={e => setFreezeDays(Number(e.target.value))}>
        {FREEZE_DAYS.map(days => <option key={days} value={days}>{days} días (hasta {addDays(today, days).split('-').reverse().join('/')})</option>)}
      </select></label>}
      {(decision === 'discard' || decision === 'lose') && <label>Motivo<select required value={reason} onChange={e => setReason(e.target.value)}>
        <option value="">Seleccionar</option>{lossReasons.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
      </select></label>}
      {decision === 'lose' && <label>¿Frente a quién? (opcional)<select value={competitor} onChange={e => setCompetitor(e.target.value)}>
        <option value="">No se sabe</option>{competitors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value={OTHER_COMPETITOR}>Otro (escribirlo)</option>
      </select>
        {competitor === OTHER_COMPETITOR && <input placeholder="Nombre del competidor" maxLength={120} value={competitorName} onChange={e => setCompetitorName(e.target.value)} />}
      </label>}
      {decision === 'request_delete' && <label>Por qué eliminarla<select value={deleteReason} onChange={e => setDeleteReason(e.target.value)}>
        {DELETE_REASONS.map(item => <option key={item} value={item}>{item}</option>)}
      </select></label>}
      <label className="decision-notes">{decision === 'continue' ? '¿Qué pasó y qué sigue?' : decision === 'freeze' ? '¿Por qué se congela?' : 'Detalle'}
        <textarea required minLength={5} maxLength={2000} rows={2} value={notes} onChange={e => setNotes(e.target.value)}
          placeholder={decision === 'continue' ? 'Ej. Hablé con la gerente, revisa la propuesta el viernes.' : decision === 'freeze' ? 'Ej. No tienen presupuesto hasta enero.' : 'Una frase basta.'} /></label>
    </div>
    <div className="decision-actions"><button disabled={saving}>{saving ? 'Guardando…' : `Guardar: ${DECISION_LABELS[decision]}`}</button>{status && <small role="status">{status}</small>}</div>
  </form>;
}

const PENDING_SHOWN = 3;
const WEEK_DAY = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', timeZone: 'America/Bogota' });
const CHEVRON = <svg className="row-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>;

/** En las filas de Mi día el valor se lee de un vistazo, no se audita: va compacto, como en los KPIs. */
function compactValue(value: number): string {
  return `$ ${(value / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: value >= 1_000_000 ? 0 : 1 })} M`;
}

function valueLabel(opportunity: DecisionOpportunity): string {
  return Number(opportunity.offer_value || 0) > 0 ? compactValue(Number(opportunity.offer_value)) : 'Sin valor';
}

/**
 * Cuántos días lleva vencida. Sin fecha devuelve -1: una oportunidad sin próxima gestión también espera decisión,
 * pero no se puede decir cuánto lleva esperando, así que va después de las que sí tienen la cuenta.
 */
function overdueRank(opportunity: DecisionOpportunity): number {
  if (!opportunity.next_action_at) return -1;
  return daysBetween(bogotaDay(opportunity.next_action_at) || todayDay(), todayDay());
}

/**
 * El estancamiento (migración 145) NO abre una sección aparte. El aviso se apaga en cuanto hay una próxima gestión
 * con fecha futura, y "pendiente de decisión" es exactamente "vencida o sin fecha": por lo tanto toda oportunidad
 * estancada es también una que espera decisión, y una lista aparte mostraba dos veces la misma fila (Juan, 2026-10-22).
 * Queda como marca sobre la fila de "Ahora".
 */
function stallLabel(opportunity: DecisionOpportunity, now: Date): string {
  const stall = stageStaleness({
    stageEnteredAt: opportunity.stage_entered_at, measured: opportunity.stage_entered_at_measured,
    stalenessDays: opportunity.staleness_days, nextActionAt: opportunity.next_action_at,
    stageName: opportunity.stage_name, now,
  });
  if (!stall.stale || stall.days === null) return '';
  return `${stall.atLeast ? 'Al menos ' : ''}${stall.days} ${stall.days === 1 ? 'día' : 'días'} en ${opportunity.stage_name}`;
}

const ICON_PERSON = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" /></svg>;
const ICON_CLOCK = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3.2-6.9" /><path d="M12 7v5l3 2" /></svg>;
const ICON_CALENDAR = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></svg>;
const ICON_BUILDING = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-7h6v7" /></svg>;

/**
 * El día despejado (Juan, 2026-10-22): sin nada vencido ni agendado para hoy, la pantalla deja de anunciar que no
 * hay nada —"dice mucho pero no dice nada"— y pasa a ser la próxima conversación. Aquí sí hay un objeto, así que
 * aquí sí va una tarjeta. Sólo se pinta lo que está en los datos ya cargados: Mi día no trae las notas, así que no
 * se promete de qué se habló.
 */
export function NextConversation({ opportunity, sameClient = 1, now = new Date() }: {
  opportunity: DecisionOpportunity; sameClient?: number; now?: Date;
}) {
  const when = new Date(opportunity.next_action_at as string);
  // La hora sólo se muestra si alguien la escogió: 9:00 y 12:00 son lo que pone el calendario cuando no hay hora.
  const whenClock = clockTime(opportunity.next_action_at);
  const days = daysBetween(bogotaDay(now) || todayDay(), bogotaDay(opportunity.next_action_at as string) || todayDay());
  const stall = stageStaleness({
    stageEnteredAt: opportunity.stage_entered_at, measured: opportunity.stage_entered_at_measured,
    stalenessDays: opportunity.staleness_days, nextActionAt: opportunity.next_action_at, stageName: null, now,
  });
  const stageLine = stall.days === null ? '' : stall.days === 0
    ? `Entró a ${opportunity.stage_name} hoy`
    : `${stall.atLeast ? 'Lleva al menos' : 'Lleva'} ${stall.days} ${stall.days === 1 ? 'día' : 'días'} en ${opportunity.stage_name}`;

  const facts: { key: string; icon: React.ReactNode; title: string; note: string }[] = [];
  if (opportunity.decision_maker_name) {
    facts.push({ key: 'decisor', icon: ICON_PERSON, title: opportunity.decision_maker_name, note: readablePhone(opportunity.decision_maker_phone) || 'Sin teléfono registrado' });
  }
  if (opportunity.last_interaction_at) {
    const lastClock = clockTime(opportunity.last_interaction_at);
    facts.push({ key: 'ultima', icon: ICON_CLOCK, title: `Le habló ${pastDayPhrase(opportunity.last_interaction_at, now)}`, note: lastClock ? `A las ${lastClock}` : 'Quedó registrada sin hora' });
  }
  const closeLine = closeDateLine(opportunity.expected_close_date, now);
  if (closeLine) {
    facts.push({ key: 'cierre', icon: ICON_CALENDAR, title: closeLine, note: stageLine });
  } else if (stageLine) {
    facts.push({ key: 'etapa', icon: ICON_CALENDAR, title: stageLine, note: 'Sin fecha de cierre estimada' });
  }
  const sector = opportunity.economic_sector || opportunity.service_type_name;
  if (sector) {
    // Sin cliente registrado no se puede saber cuántas hay: se calla en vez de afirmar "única".
    const clientNote = sameClient > 1 ? `${sameClient} oportunidades suyas con este cliente`
      : sameClient === 1 ? 'Única oportunidad suya con este cliente' : '';
    facts.push({ key: 'sector', icon: ICON_BUILDING, title: sector, note: clientNote });
  }

  const place = [opportunity.quote_city, opportunity.regional_nombre].filter(Boolean).join(', ');
  const meta = [opportunity.stage_name, valueLabel(opportunity), opportunity.service_type_name, place].filter(Boolean).join(' · ');

  return <section className="next-talk" aria-label="Su próxima conversación">
    <p className="next-when">{WEEK_DAY.format(when)}{whenClock ? `, ${whenClock}` : ''} <em>· {days === 1 ? 'mañana' : `en ${days} días`}</em></p>
    <h3 className="next-name">{opportunity.company_name}</h3>
    <p className="next-meta">{meta}</p>
    {facts.length > 0 && <div className="next-facts">{facts.map(fact => <div key={fact.key} className="next-fact">
      {fact.icon}
      <div><strong>{fact.title}</strong>{fact.note && <span>{fact.note}</span>}</div>
    </div>)}</div>}
    <div className="next-acts">
      <a className="now-main" href={`#/detail/${opportunity.id}?focus=brief`}>Preparar la reunión</a>
      <a className="now-link" href={`#/detail/${opportunity.id}`}>Ver ficha</a>
    </div>
  </section>;
}

const DONE_LIMIT = 5;

/**
 * "Hoy ya hizo": un día sin pendientes no es un día vacío. Sale de lo que ya está cargado (fechas de la
 * oportunidad), no de una consulta nueva. Un cierre y su gestión comparten la hora, así que cada oportunidad
 * aporta un solo renglón: ganar, perder y descartar pesan más que registrar.
 */
export function TodayDone({ opportunities, now = new Date() }: { opportunities: DecisionOpportunity[]; now?: Date }) {
  const today = bogotaDay(now);
  const rows: { key: string; at: string; text: React.ReactNode }[] = [];
  for (const opportunity of opportunities) {
    // Cuando el nombre cierra la frase se le quita el punto de "S.A.S."; en medio de la frase se deja entero.
    const ending = <strong>{sentenceName(opportunity.company_name)}</strong>;
    const inline = <strong>{opportunity.company_name}</strong>;
    const scheduled = opportunity.next_action_at && (bogotaDay(opportunity.next_action_at) || '') > (today || '');
    const candidates: Array<[string | null | undefined, React.ReactNode]> = [
      [opportunity.approved_at, <>Ganó {ending}.</>],
      [opportunity.lost_at, <>Marcó perdida {ending}.</>],
      [opportunity.discarded_at, <>Descartó {ending}.</>],
      [opportunity.last_interaction_at, scheduled
        ? <>Registró una gestión con {inline} y dejó la próxima para {futureDayPhrase(opportunity.next_action_at, now)}.</>
        : <>Registró una gestión con {ending}.</>],
    ];
    const hit = candidates.find(([at]) => at && bogotaDay(at) === today);
    if (hit) rows.push({ key: opportunity.id, at: hit[0] as string, text: hit[1] });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return <section className="today-done" aria-label="Lo que hizo hoy">
    <h3>Hoy ya hizo</h3>
    {rows.slice(0, DONE_LIMIT).map(row => <div key={row.key} className="done-row">
      <time dateTime={row.at}>{clockTime(row.at) || 'Sin hora'}</time>
      <p>{row.text}</p>
    </div>)}
  </section>;
}

/**
 * "Ahora": la única pregunta de la primera pantalla de Mi día. Junta en un solo bloque lo que espera decisión
 * (vencidas o sin fecha) y lo agendado para hoy, en el orden que fijó Juan el 2026-10-07: primero decidir, después
 * hacer. La cuota diaria de decisiones no se toca; vive en la línea de estado, arriba.
 */
export function NowQueue({ pending, today, stages, lossReasons, competitors = [], onChanged, empty, now = new Date() }: {
  pending: DecisionOpportunity[]; today: DecisionOpportunity[]; stages: StageOption[]; lossReasons: ReasonOption[];
  competitors?: CompetitorOption[]; onChanged: () => Promise<void>; empty?: React.ReactNode; now?: Date;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ decision: 'discard' | 'freeze'; reason: string; days: number; notes: string }>({ decision: 'discard', reason: '', days: 30, notes: '' });
  const [bulkStatus, setBulkStatus] = useState('');
  const [running, setRunning] = useState(false);

  // Primero la que lleva más tiempo vencida. Ordenar por valor dejaba el orden en alfabético, porque la cartera
  // migrada del Excel llegó casi toda sin valor registrado y "¿qué hago ahora?" se quedaba sin respuesta.
  const ordered = useMemo(() => [...pending].sort((a, b) => overdueRank(b) - overdueRank(a)
    || Number(b.offer_value || 0) - Number(a.offer_value || 0)
    || a.company_name.localeCompare(b.company_name, 'es')), [pending]);
  const shown = showAll ? ordered : ordered.slice(0, PENDING_SHOWN);
  const hidden = ordered.length - shown.length;
  const total = pending.length + today.length;

  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const runBulk = async () => {
    if (bulk.notes.trim().length < 5) { setBulkStatus('Escriba en una frase por qué (aplica a todas las seleccionadas).'); return; }
    if (bulk.decision === 'discard' && !bulk.reason) { setBulkStatus('Escoja el motivo.'); return; }
    setRunning(true);
    let done = 0; const failed: string[] = [];
    for (const id of selected) {
      setBulkStatus(`Guardando ${done + failed.length + 1} de ${selected.size}…`);
      try {
        await sendDecision(id, bulk.decision === 'discard'
          ? { decision: 'discard', notes: bulk.notes, loss_reason_code: bulk.reason }
          : { decision: 'freeze', notes: bulk.notes, freeze_days: bulk.days });
        done += 1;
      } catch { failed.push(id); }
    }
    setSelected(new Set(failed));
    setBulkStatus(failed.length ? `${done} listas; ${failed.length} no se pudieron guardar (siguen seleccionadas).` : `${done} listas.`);
    setRunning(false);
    await onChanged();
  };

  const row = (opportunity: DecisionOpportunity, kind: 'pendiente' | 'hoy') => {
    const isOpen = openId === opportunity.id;
    const stall = stallLabel(opportunity, now);
    const todayClock = clockTime(opportunity.next_action_at);
    const head = kind === 'hoy' ? (todayClock ? `Hoy a las ${todayClock}` : 'Agendada para hoy') : pendingReason(opportunity);
    return <li key={opportunity.id} className={`now-item${isOpen ? ' is-open' : ''}`}>
      <div className={`now-row is-${kind}`}>
        {picking && kind === 'pendiente' && <input type="checkbox" className="now-pick" aria-label={`Seleccionar ${opportunity.company_name}`}
          checked={selected.has(opportunity.id)} onChange={() => toggle(opportunity.id)} />}
        <span className="now-dot" aria-hidden="true" />
        <div className="now-body">
          <strong className="now-name">{opportunity.company_name}</strong>
          <p className="now-fact"><em>{head}</em> · {opportunity.stage_name} · {valueLabel(opportunity)}</p>
          {stall && <p className="now-stall">{stall}</p>}
        </div>
        <div className="now-acts">
          <button type="button" className="now-main" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : opportunity.id)}>
            {isOpen ? 'Cerrar' : kind === 'hoy' ? 'Registrar gestión' : 'Decidir'}</button>
          <a className="now-link" href={`#/detail/${opportunity.id}${kind === 'hoy' ? '?focus=brief' : ''}`}>{kind === 'hoy' ? 'Antes de la reunión' : 'Ver ficha'}</a>
        </div>
      </div>
      {isOpen && <>
        <OpportunityDecisionForm opportunity={opportunity} stages={stages} lossReasons={lossReasons} competitors={competitors}
          onDone={async () => { setOpenId(null); await onChanged(); }} />
        <a className="decision-full-link" href={`#/detail/${opportunity.id}`}>Ver ficha completa (historial y contacto)</a>
      </>}
    </li>;
  };

  return <section className="now-queue" aria-label="Ahora">
    <header className="now-head"><h3>Ahora{total > 0 ? <span className="now-count numeric-value">{total}</span> : null}</h3></header>
    {total === 0
      ? <div className="now-empty">{empty}</div>
      : <>
        {pending.length > 0 && <>
          <p className="now-group">Esperando decisión · {pending.length}</p>
          {selected.size > 0 && <div className="decision-bulk" role="region" aria-label="Decidir varias">
            <strong>{selected.size === 1 ? '1 seleccionada' : `${selected.size} seleccionadas`}:</strong>
            <select value={bulk.decision} onChange={e => setBulk({ ...bulk, decision: e.target.value as 'discard' | 'freeze' })}><option value="discard">Descartar</option><option value="freeze">Congelar</option></select>
            {bulk.decision === 'discard'
              ? <select value={bulk.reason} onChange={e => setBulk({ ...bulk, reason: e.target.value })}><option value="">Motivo</option>{lossReasons.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
              : <select value={bulk.days} onChange={e => setBulk({ ...bulk, days: Number(e.target.value) })}>{FREEZE_DAYS.map(days => <option key={days} value={days}>{days} días</option>)}</select>}
            <input placeholder="Por qué (aplica a todas)" value={bulk.notes} onChange={e => setBulk({ ...bulk, notes: e.target.value })} />
            <button type="button" disabled={running} onClick={() => void runBulk()}>Aplicar</button>
            <button type="button" className="secondary" disabled={running} onClick={() => setSelected(new Set())}>Quitar selección</button>
            {bulkStatus && <small role="status">{bulkStatus}</small>}
          </div>}
          {!selected.size && bulkStatus && <p className="decision-bulk-result" role="status">{bulkStatus}</p>}
          <ul className="now-list">{shown.map(opportunity => row(opportunity, 'pendiente'))}</ul>
          {(hidden > 0 || showAll) && <button type="button" className="now-more" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Ver menos' : `Ver las ${hidden} que faltan`}</button>}
          <button type="button" className="now-bulk-toggle" aria-pressed={picking} onClick={() => { setPicking(!picking); setSelected(new Set()); }}>
            {picking ? 'Salir de decidir varias' : 'Decidir varias'}</button>
        </>}
        {today.length > 0 && <>
          <p className="now-group">Agendado para hoy · {today.length}</p>
          <ul className="now-list">{today.map(opportunity => row(opportunity, 'hoy'))}</ul>
        </>}
      </>}
  </section>;
}

/**
 * "Esta semana": lo que viene en los próximos 7 días, agrupado por día. Filas planas con separadores, sin tarjeta:
 * la única superficie elevada de la pantalla es "Ahora". La fila entera es el enlace a la ficha.
 */
export function WeekList({ upcoming }: { upcoming: DecisionOpportunity[] }) {
  if (!upcoming.length) return null;
  const groups: { day: string; label: string; rows: DecisionOpportunity[] }[] = [];
  for (const opportunity of upcoming) {
    const day = bogotaDay(opportunity.next_action_at as string) || '';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(opportunity);
    else groups.push({ day, label: WEEK_DAY.format(new Date(opportunity.next_action_at as string)), rows: [opportunity] });
  }
  return <section className="week-list" aria-label="Esta semana">
    <h3>Esta semana<span className="week-count numeric-value">{upcoming.length}</span></h3>
    {groups.map(group => <div key={group.day}>
      <p className="week-day">{group.label}</p>
      {group.rows.map(opportunity => <a key={opportunity.id} className="week-row" href={`#/detail/${opportunity.id}`}>
        <strong>{opportunity.company_name}</strong>
        <small>{opportunity.stage_name}{Number(opportunity.offer_value || 0) > 0 ? ` · ${compactValue(Number(opportunity.offer_value))}` : ''}</small>
        {CHEVRON}
      </a>)}
    </div>)}
  </section>;
}

export function DeleteRequestsPanel({ requests, onChanged }: { requests: DecisionOpportunity[]; onChanged: () => Promise<void> }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  if (!requests.length) return null;
  const resolve = async (id: string, approve: boolean) => {
    setStatus(current => ({ ...current, [id]: 'Guardando…' }));
    try {
      await api(`/api/opportunity-delete-resolution?id=${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ approve, notes: notes[id] || '' }) });
      await onChanged();
    } catch (error) {
      setStatus(current => ({ ...current, [id]: error instanceof Error ? error.message : String(error) }));
    }
  };
  return <section className="panel delete-requests" aria-label="Solicitudes de eliminación">
    <h2>Solicitudes de eliminación ({requests.length})</h2>
    <p className="v2-panel-note">Los comerciales pidieron eliminar estas oportunidades. Confirmar la oculta del CRM (el historial se conserva); rechazar la devuelve al comercial para que decida.</p>
    <ul className="decision-list">{requests.map(request => <li key={request.id}>
      <div className="delete-request-row">
        <div><strong>{request.company_name}</strong><span>{request.owner_name || 'Sin comercial'} · {request.stage_name} · {Number(request.offer_value || 0) > 0 ? money.format(Number(request.offer_value)) : 'Sin valor'}</span><em>{request.delete_request_reason || 'Sin motivo'}</em></div>
        <input placeholder="Nota (obligatoria si rechaza)" value={notes[request.id] || ''} onChange={e => setNotes({ ...notes, [request.id]: e.target.value })} />
        <button type="button" className="danger" onClick={() => void resolve(request.id, true)}>Eliminar</button>
        <button type="button" className="secondary" onClick={() => void resolve(request.id, false)}>Rechazar</button>
        <a className="button secondary" href={`#/detail/${request.id}`}>Ver</a>
      </div>
      {status[request.id] && <small role="status">{status[request.id]}</small>}
    </li>)}</ul>
  </section>;
}
