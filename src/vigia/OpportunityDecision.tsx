import { useMemo, useState } from 'react';
import { api } from '../apiClient';
import { bogotaDay, FREEZE_DAYS, type DecisionCode } from './opportunity-decision-rules.js';

// CRM comercial — decisión obligatoria por oportunidad (2026-10-07). Toda oportunidad abierta debe quedar con una
// decisión vigente: sigue viva (con fecha), avanza, congelada, descartada, perdida o con eliminación pedida.

export type DecisionOpportunity = {
  id: string; company_name: string; owner_name?: string | null; stage_code: string; stage_name: string; stage_order: number;
  offer_value: number | null; next_action_at: string | null; last_interaction_at?: string | null; updated_at?: string | null;
  created_at?: string | null; frozen_until?: string | null; delete_requested_at?: string | null; delete_request_reason?: string | null;
  decision_maker_name?: string | null; decision_maker_phone?: string | null; sede?: string | null; quote_city?: string | null;
};
type StageOption = { code: string; name: string; stage_order: number; is_terminal: boolean };
type ReasonOption = { code: string; name: string };

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
  if (!opportunity.next_action_at) return 'No tiene próxima gestión';
  const next = bogotaDay(opportunity.next_action_at) || today;
  const days = daysBetween(next, today);
  return days === 1 ? 'La gestión se venció ayer' : `La gestión se venció hace ${days} días`;
}

function lastActivity(opportunity: DecisionOpportunity): string {
  const value = opportunity.last_interaction_at || opportunity.updated_at || opportunity.created_at;
  const day = value ? bogotaDay(value) : null;
  if (!day) return 'Sin actividad registrada';
  const days = daysBetween(day, todayDay());
  return days <= 0 ? 'Actividad hoy' : `Última actividad hace ${days} días`;
}

async function sendDecision(id: string, body: Record<string, unknown>) {
  return api(`/api/opportunity-decision?id=${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) });
}

export function OpportunityDecisionForm({ opportunity, stages, lossReasons, onDone, initial = 'continue' }: {
  opportunity: DecisionOpportunity; stages: StageOption[]; lossReasons: ReasonOption[]; onDone: () => Promise<void> | void; initial?: DecisionCode;
}) {
  const today = todayDay();
  const [decision, setDecision] = useState<DecisionCode>(initial);
  const [notes, setNotes] = useState('');
  const [nextDay, setNextDay] = useState(addDays(today, 7));
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

export function DecisionQueue({ pending, stages, lossReasons, onChanged }: {
  pending: DecisionOpportunity[]; stages: StageOption[]; lossReasons: ReasonOption[]; onChanged: () => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [visible, setVisible] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ decision: 'discard' | 'freeze'; reason: string; days: number; notes: string }>({ decision: 'discard', reason: '', days: 30, notes: '' });
  const [bulkStatus, setBulkStatus] = useState('');
  const [running, setRunning] = useState(false);
  const ordered = useMemo(() => [...pending].sort((a, b) => Number(b.offer_value || 0) - Number(a.offer_value || 0) || a.company_name.localeCompare(b.company_name, 'es')), [pending]);
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const shown = ordered.slice(0, visible);

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

  if (!pending.length) return null;
  return <section className="decision-queue" aria-label="Oportunidades sin decisión">
    <header className="decision-queue-header">
      <div><span className="eyebrow">Antes de seguir</span>
        <h3>Decida {pending.length === 1 ? 'esta oportunidad' : `estas ${pending.length} oportunidades`}</h3>
        <p>Toda oportunidad abierta debe tener una decisión: que siga viva con fecha, que avance, congelarla, descartarla o pedir eliminarla. Mientras haya pendientes puede consultar el CRM, pero no crear oportunidades nuevas.</p></div>
      <strong className="decision-queue-count numeric-value">{pending.length}</strong>
    </header>
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
    <ul className="decision-list">{shown.map(opportunity => <li key={opportunity.id} className={openId === opportunity.id ? 'is-open' : ''}>
      <div className="decision-row">
        <input type="checkbox" aria-label={`Seleccionar ${opportunity.company_name}`} checked={selected.has(opportunity.id)} onChange={() => toggle(opportunity.id)} />
        <button type="button" className="decision-row-main" onClick={() => setOpenId(openId === opportunity.id ? null : opportunity.id)} aria-expanded={openId === opportunity.id}>
          <strong>{opportunity.company_name}</strong>
          <span>{opportunity.stage_name} · {Number(opportunity.offer_value || 0) > 0 ? money.format(Number(opportunity.offer_value)) : 'Sin valor'} · {lastActivity(opportunity)}</span>
          <em>{pendingReason(opportunity)}</em>
        </button>
        <a className="button secondary" href={`#/detail/${opportunity.id}`}>Ver</a>
      </div>
      {openId === opportunity.id && <OpportunityDecisionForm opportunity={opportunity} stages={stages} lossReasons={lossReasons} onDone={async () => { setOpenId(null); await onChanged(); }} />}
    </li>)}</ul>
    {ordered.length > visible && <button type="button" className="secondary decision-more" onClick={() => setVisible(visible + 20)}>Ver {Math.min(20, ordered.length - visible)} más (quedan {ordered.length - visible})</button>}
    <p className="decision-tip">Para decidir varias de una vez, márquelas y use Descartar o Congelar arriba.</p>
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
