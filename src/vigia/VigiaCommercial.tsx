import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../apiClient';

type VigiaLevel = 'alto' | 'medio' | 'bajo' | 'sin_prioridad';
type VigiaSignal = { code: string; label: string; points: number; evidence: string };
type VigiaPriority = {
  id: string;
  owner_id: string | null;
  owner_name: string | null;
  company_name: string;
  stage_code: string;
  stage_name: string;
  service_type_code: string | null;
  service_type_name: string | null;
  regional_nombre: string | null;
  offer_value: number;
  score: number;
  level: VigiaLevel;
  signals: VigiaSignal[];
  recommendation: string;
  explanation: string;
  evidence: { activity_at: string | null; activity_basis: string; inactive_days: number | null; next_action_at: string | null; expected_close_date: string | null };
};
export type VigiaPayload = {
  generated_at: string;
  source: { id: string; label: string; as_of: string | null };
  policy: { version: string; read_only: boolean; human_review_required: boolean };
  totals: { visible_active: number; prioritized: number; high: number; medium: number; low: number };
  priorities: VigiaPriority[];
};

type Feedback = 'revisada' | 'util' | 'no_util';
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
const levelLabel: Record<VigiaLevel, string> = { alto: 'Alto', medio: 'Medio', bajo: 'Bajo', sin_prioridad: 'Sin prioridad' };

function displayDate(value: string | null) {
  if (!value) return 'Sin datos';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Sin datos' : date.format(parsed);
}

function dashboardLink(priority: VigiaPriority) {
  const params = new URLSearchParams();
  if (priority.owner_id) params.set('owner', priority.owner_id);
  if (priority.stage_code) params.set('stage', priority.stage_code);
  if (priority.service_type_code) params.set('service', priority.service_type_code);
  params.set('active', '1');
  return `#/dashboard2?${params.toString()}`;
}

export function VigiaCommercial({ canOpenDashboard, canOpenOpportunity }: { canOpenDashboard: boolean; canOpenOpportunity: boolean }) {
  const [payload, setPayload] = useState<VigiaPayload | null>(null);
  const [status, setStatus] = useState('Cargando prioridades del CRM…');
  const [level, setLevel] = useState<VigiaLevel | ''>('');
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const load = async () => {
    setStatus('Cargando prioridades del CRM…');
    try {
      const result = await api<VigiaPayload>('/api/vigia/priorities');
      setPayload(result);
      setStatus('');
    } catch (error) {
      setPayload(null);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => { load(); }, []);
  const visible = useMemo(() => (payload?.priorities || []).filter(row => !level || row.level === level).slice(0, 50), [payload, level]);
  const reviewed = Object.values(feedback).filter(value => value === 'revisada').length;

  return <section className="stack vigia-commercial">
    <section className="centinel-topline"><h2>Vig-IA Comercial</h2><p>Prioridades explicables del CRM para revisión de Dirección Comercial.</p></section>
    <section className="vigia-command-hero">
      <div><span className="eyebrow">AGT-003 · SOLO LECTURA</span><h2>Prioridades explicables del CRM</h2><p>Ordena señales determinísticas de agenda, estancamiento, etapa, cierre y calidad de datos. No predice ventas ni modifica oportunidades.</p><strong>Requiere validación humana; no ejecuta acciones.</strong></div>
      <div className="vigia-source-status"><small>Fuente</small><strong>{payload?.source.id || 'CRM-F1'}</strong><span>Corte: {displayDate(payload?.source.as_of || null)}</span><span>Política: {payload?.policy.version || 'gate0-v1.0'}</span></div>
    </section>

    {payload && <section className="vigia-summary-grid" aria-label="Resumen de prioridades">
      <button className={!level ? 'active' : ''} onClick={() => setLevel('')}><small>Activas visibles</small><strong>{payload.totals.visible_active}</strong><span>{payload.totals.prioritized} con señales</span></button>
      <button className={level === 'alto' ? 'active danger' : 'danger'} onClick={() => setLevel(level === 'alto' ? '' : 'alto')}><small>Prioridad alta</small><strong>{payload.totals.high}</strong><span>Score 60+</span></button>
      <button className={level === 'medio' ? 'active amber' : 'amber'} onClick={() => setLevel(level === 'medio' ? '' : 'medio')}><small>Prioridad media</small><strong>{payload.totals.medium}</strong><span>Score 30–59</span></button>
      <button className={level === 'bajo' ? 'active blue' : 'blue'} onClick={() => setLevel(level === 'bajo' ? '' : 'bajo')}><small>Prioridad baja</small><strong>{payload.totals.low}</strong><span>Score 1–29</span></button>
    </section>}

    <section className="vigia-control-strip"><div><strong>{visible.length}</strong> prioridades visibles{reviewed ? ` · ${reviewed} revisadas en esta sesión` : ''}</div><button className="secondary" onClick={load}>Actualizar lectura</button></section>
    {status && <div className={payload ? 'muted' : 'error'}>{status}</div>}

    <section className="vigia-priority-grid">
      {visible.map(priority => <article className={`vigia-priority-card level-${priority.level}`} key={priority.id}>
        <header><div><span className={`vigia-level level-${priority.level}`}>{levelLabel[priority.level]}</span><h3>{priority.company_name}</h3><p>{priority.owner_name || 'Sin comercial'} · {priority.stage_name} · {priority.regional_nombre || 'Regional pendiente'}</p></div><div className="vigia-score"><small>Score</small><strong>{priority.score}</strong></div></header>
        <div className="vigia-card-value"><small>Valor registrado</small><strong>{Number(priority.offer_value) > 0 ? money.format(priority.offer_value) : 'Valor no registrado'}</strong></div>
        <ul className="vigia-signal-list">{priority.signals.map(signal => <li key={signal.code}><div><strong>{signal.label}</strong><span>{signal.evidence}</span></div><b>+{signal.points}</b></li>)}</ul>
        <div className="vigia-recommendation"><small>Acción sugerida</small><strong>{priority.recommendation}</strong><p>{priority.explanation}</p></div>
        <div className="vigia-evidence"><span>Actividad: {displayDate(priority.evidence.activity_at)} ({priority.evidence.activity_basis})</span><span>Próxima acción: {displayDate(priority.evidence.next_action_at)}</span><span>Cierre esperado: {displayDate(priority.evidence.expected_close_date)}</span></div>
        <footer>{(canOpenDashboard || canOpenOpportunity) && <div className="vigia-card-actions">{canOpenDashboard && <a className="button" href={dashboardLink(priority)}>Ver en Dashboard</a>}{canOpenOpportunity && <a className="button secondary" href={`#/detail/${priority.id}`}>Ver oportunidad</a>}</div>}<div className="vigia-feedback" aria-label="Feedback local"><button className={feedback[priority.id] === 'revisada' ? 'active' : 'secondary'} onClick={() => setFeedback(current => ({ ...current, [priority.id]: 'revisada' }))}>Marcar revisada</button><button className={feedback[priority.id] === 'util' ? 'active' : 'secondary'} onClick={() => setFeedback(current => ({ ...current, [priority.id]: 'util' }))}>Útil</button><button className={feedback[priority.id] === 'no_util' ? 'active' : 'secondary'} onClick={() => setFeedback(current => ({ ...current, [priority.id]: 'no_util' }))}>No útil</button></div></footer>
      </article>)}
    </section>
    {!status && !visible.length && <div className="empty"><strong>Sin prioridades para este filtro</strong><span>Prueba otro nivel o actualiza la lectura.</span></div>}
    <p className="muted">Feedback local de sesión: no se guarda en el CRM, no cambia el score y se pierde al recargar.</p>
  </section>;
}
