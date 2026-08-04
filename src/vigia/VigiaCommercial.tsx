import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../apiClient';
import { formatDateOnly } from '../dateOnly';
import { filtersFromAlertsHash, filterCommercialPriorities, priorityContextSummary, priorityHashFiltersAreValid, summarizeCommercialPriorities } from './priority-filters.js';

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
  customer_segment: string | null;
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
type OperationalCategory = '' | 'risk' | 'missing' | 'overdue' | 'managed' | 'closing' | 'high_value_stalled' | 'stalled_sustentacion';
type PriorityCategory = OperationalCategory | '__invalid__';
const PRIORITY_INBOX_LIMIT = 20;
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
const levelLabel: Record<VigiaLevel, string> = { alto: 'Alto', medio: 'Medio', bajo: 'Bajo', sin_prioridad: 'Sin prioridad' };
const customerSegmentOptions = [['cliente_nuevo', 'Cliente Nuevo'], ['cliente_actual', 'Cliente Actual']] as const;

function displayDate(value: string | null) {
  if (!value) return 'Sin datos';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Sin datos' : date.format(parsed);
}

function displayDateOnly(value: string | null) { return formatDateOnly(value, 'Sin datos'); }

function dashboardLink(priority: VigiaPriority) {
  const params = new URLSearchParams();
  if (priority.owner_id) params.set('owner', priority.owner_id);
  if (priority.stage_code) params.set('stage', priority.stage_code);
  if (priority.service_type_code) params.set('service', priority.service_type_code);
  params.set('active', '1');
  return `#/dashboard2?${params.toString()}`;
}

function uniqueOptions(rows: VigiaPriority[], value: (row: VigiaPriority) => string | null, label: (row: VigiaPriority) => string | null) {
  const options = new Map<string, string>();
  for (const row of rows) {
    const optionValue = value(row);
    if (optionValue) options.set(optionValue, label(row) || optionValue);
  }
  return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
}

export function VigiaCommercial({ canOpenDashboard, canOpenOpportunity }: { canOpenDashboard: boolean; canOpenOpportunity: boolean }) {
  const initialHashFilters = useMemo(() => filtersFromAlertsHash(window.location.hash), []);
  const [payload, setPayload] = useState<VigiaPayload | null>(null);
  const [status, setStatus] = useState('Cargando prioridades del CRM…');
  const [category, setCategory] = useState<PriorityCategory>(initialHashFilters.category as PriorityCategory);
  const [level, setLevel] = useState<VigiaLevel | ''>('');
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState(initialHashFilters.owner);
  const [regional, setRegional] = useState(initialHashFilters.regional);
  const [stage, setStage] = useState(initialHashFilters.stage);
  const [service, setService] = useState(initialHashFilters.service);
  const [customerSegment, setCustomerSegment] = useState(initialHashFilters.customerSegment);
  const [hashInvalid, setHashInvalid] = useState(initialHashFilters.invalid);
  const [linkedContext, setLinkedContext] = useState(Boolean(window.location.hash.split('?')[1]));
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
  useEffect(() => {
    const syncFiltersFromHash = () => {
      const filters = filtersFromAlertsHash(window.location.hash);
      setCategory(filters.category as PriorityCategory);
      setOwner(filters.owner);
      setRegional(filters.regional);
      setStage(filters.stage);
      setService(filters.service);
      setCustomerSegment(filters.customerSegment);
      setHashInvalid(filters.invalid);
      setLinkedContext(Boolean(window.location.hash.split('?')[1]));
    };
    window.addEventListener('hashchange', syncFiltersFromHash);
    return () => window.removeEventListener('hashchange', syncFiltersFromHash);
  }, []);

  const priorities = payload?.priorities || [];
  const summary = payload ? summarizeCommercialPriorities(payload.priorities) : null;
  const reviewedIds = useMemo(() => new Set(Object.entries(feedback).filter(([, value]) => value === 'revisada').map(([id]) => id)), [feedback]);
  const invalidLink = useMemo(() => Boolean(payload && !priorityHashFiltersAreValid(priorities, {
    category,
    owner,
    regional,
    stage,
    service,
    customerSegment,
    invalid: hashInvalid,
  })), [payload, priorities, category, owner, regional, stage, service, customerSegment, hashInvalid]);
  const filtered = useMemo(() => filterCommercialPriorities(payload?.priorities || [], {
    query,
    category: invalidLink ? '__invalid__' : category,
    owner,
    regional,
    stage,
    service,
    customerSegment,
    level,
    reviewedIds,
  }), [payload, query, category, invalidLink, owner, regional, stage, service, customerSegment, level, reviewedIds]);
  const visible = filtered.slice(0, PRIORITY_INBOX_LIMIT);
  const reviewed = reviewedIds.size;
  const ownerOptions = useMemo(() => uniqueOptions(priorities, row => row.owner_id, row => row.owner_name), [priorities]);
  const regionalOptions = useMemo(() => uniqueOptions(priorities, row => row.regional_nombre, row => row.regional_nombre), [priorities]);
  const stageOptions = useMemo(() => uniqueOptions(priorities, row => row.stage_code, row => row.stage_name), [priorities]);
  const serviceOptions = useMemo(() => uniqueOptions(priorities, row => row.service_type_code, row => row.service_type_name), [priorities]);
  const hasFilters = Boolean(category || level || query || owner || regional || stage || service || customerSegment || hashInvalid);
  const linkedContextSummary = priorityContextSummary({ category, owner, regional, stage, service, customerSegment, invalid: hashInvalid }, {
    owner: ownerOptions.find(([value]) => value === owner)?.[1],
    regional,
    stage: stageOptions.find(([value]) => value === stage)?.[1],
    service: serviceOptions.find(([value]) => value === service)?.[1],
    segment: customerSegmentOptions.find(([value]) => value === customerSegment)?.[1],
  });
  const resetFilters = () => {
    setCategory(''); setLevel(''); setQuery(''); setOwner(''); setRegional(''); setStage(''); setService(''); setCustomerSegment(''); setHashInvalid(false);
    setLinkedContext(false);
    if (window.location.hash.includes('?')) window.history.replaceState(null, '', '#/alerts');
  };
  const toggleCategory = (next: OperationalCategory) => setCategory(current => current === next ? '' : next);

  return <section className="stack vigia-commercial priorities-commercial">
    <section className="centinel-topline"><h2>Prioridades Comerciales</h2><p>Una sola bandeja para decidir dónde intervenir en el pipeline comercial.</p></section>
    <section className="vigia-command-hero">
      <div><span className="eyebrow">Impulsado por Vig-IA</span><h2>Prioridades explicables del CRM</h2><p>Consolida agenda, vencimientos, estancamiento, etapa, cierre y calidad de datos con reglas determinísticas.</p><strong>Requiere validación humana; no ejecuta acciones.</strong></div>
      <div className="vigia-source-status"><small>Motor de priorización</small><strong>Vig-IA</strong><span>Fuente de datos: {payload?.source.id || 'CRM-F1'}</span><span>Corte: {displayDate(payload?.source.as_of || null)}</span><span>Política: {payload?.policy.version || 'gate0-v1.0'} · Solo lectura</span></div>
    </section>

    {summary && <section className="priority-filter-tabs" aria-label="Categorías operativas">
      <button className={`priority-filter-tab ${category === 'risk' ? 'active danger' : 'danger'}`} onClick={() => toggleCategory('risk')}><small>Pipeline en riesgo</small><strong>{summary.risk}</strong><span>Prioridad alta</span></button>
      <button className={`priority-filter-tab ${category === 'missing' ? 'active amber' : 'amber'}`} onClick={() => toggleCategory('missing')}><small>Sin próxima acción</small><strong>{summary.missing}</strong><span>Requieren agenda</span></button>
      <button className={`priority-filter-tab ${category === 'overdue' ? 'active danger' : 'danger'}`} onClick={() => toggleCategory('overdue')}><small>Vencidas</small><strong>{summary.overdue}</strong><span>Gestión atrasada</span></button>
      <button className={`priority-filter-tab ${category === 'managed' ? 'active blue' : 'blue'}`} onClick={() => toggleCategory('managed')}><small>Prioridades con gestión vigente</small><strong>{summary.managed}</strong><span>Con próxima acción</span></button>
      <button className={`priority-filter-tab ${category === 'closing' ? 'active amber' : 'amber'}`} onClick={() => toggleCategory('closing')}><small>Cierres próximos</small><strong>{summary.closing}</strong><span>Cercanos o vencidos</span></button>
      <button className={`priority-filter-tab ${category === 'high_value_stalled' ? 'active danger' : 'danger'}`} onClick={() => toggleCategory('high_value_stalled')}><small>Alto valor estancado</small><strong>{summary.highValueStalled}</strong><span>Valor alto sin movimiento</span></button>
      <button className={`priority-filter-tab ${category === 'stalled_sustentacion' ? 'active danger' : 'danger'}`} onClick={() => toggleCategory('stalled_sustentacion')}><small>Sustentación estancada</small><strong>{summary.stalledSustentacion}</strong><span>Sin movimiento según Vig-IA</span></button>
    </section>}

    {invalidLink && <section className="state error" role="alert"><strong>El enlace contiene filtros inválidos o no disponibles para su alcance.</strong><span>Restablezca los filtros para volver a la bandeja autorizada.</span></section>}

    {payload && linkedContext && !invalidLink && <section className="priority-context-summary" aria-label="Contexto recibido del Dashboard"><div><strong>Contexto recibido del Dashboard</strong><span>{linkedContextSummary}</span></div><button className="secondary" onClick={resetFilters}>Limpiar contexto</button></section>}

    <section className="priority-filter-panel">
      <div className="priority-filter-heading"><div><strong>Filtros de gestión</strong><span>Los filtros se combinan sobre la misma lectura de Vig-IA.</span></div>{hasFilters && !linkedContext && <button className="secondary" onClick={resetFilters}>Limpiar</button>}</div>
      <div className="priority-filter-grid">
        <label className="priority-search"><span>Buscar</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Empresa o comercial" /></label>
        <label><span>Comercial</span><select value={owner} onChange={event => setOwner(event.target.value)}><option value="">Todos</option>{ownerOptions.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select></label>
        <label><span>Región</span><select value={regional} onChange={event => setRegional(event.target.value)}><option value="">Todas</option>{regionalOptions.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select></label>
        <label><span>Etapa</span><select value={stage} onChange={event => setStage(event.target.value)}><option value="">Todas</option>{stageOptions.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select></label>
        <label><span>Producto</span><select value={service} onChange={event => setService(event.target.value)}><option value="">Todos</option>{serviceOptions.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select></label>
        <label><span>Tipo de cliente</span><select value={customerSegment} onChange={event => setCustomerSegment(event.target.value)}><option value="">Todos</option>{customerSegmentOptions.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select></label>
        <label><span>Nivel</span><select value={level} onChange={event => setLevel(event.target.value as VigiaLevel | '')}><option value="">Todos</option><option value="alto">Alto</option><option value="medio">Medio</option><option value="bajo">Bajo</option></select></label>
      </div>
    </section>

    <section className="vigia-control-strip"><div><strong>{filtered.length}</strong> resultados de {payload?.totals.prioritized || 0} prioridades{reviewed ? ` · ${reviewed} revisadas en esta sesión` : ''}{filtered.length > PRIORITY_INBOX_LIMIT ? ` · mostrando las ${PRIORITY_INBOX_LIMIT} más críticas` : ''}</div><button className="secondary" onClick={load}>Actualizar lectura</button></section>
    {status && <div className={payload ? 'muted' : 'error'}>{status}</div>}

    <section className="vigia-priority-grid">
      {visible.map(priority => <article className={`vigia-priority-card level-${priority.level}`} key={priority.id}>
        <header><div><span className={`vigia-level level-${priority.level}`}>{levelLabel[priority.level]}</span><h3>{priority.company_name}</h3><p>{priority.owner_name || 'Sin comercial'} · {priority.stage_name} · {priority.regional_nombre || 'Regional pendiente'}</p></div><div className="vigia-score"><small>Score</small><strong>{priority.score}</strong></div></header>
        <div className="vigia-card-value"><small>Valor registrado</small><strong>{Number(priority.offer_value) > 0 ? money.format(priority.offer_value) : 'Valor no registrado'}</strong></div>
        <ul className="vigia-signal-list">{priority.signals.map(signal => <li key={signal.code}><div><strong>{signal.label}</strong><span>{signal.evidence}</span></div><b>{signal.points > 0 ? `+${signal.points}` : 'Dato'}</b></li>)}</ul>
        <div className="vigia-recommendation"><small>Acción sugerida</small><strong>{priority.recommendation}</strong><p>{priority.explanation}</p></div>
        <div className="vigia-evidence"><span>Actividad: {displayDate(priority.evidence.activity_at)} ({priority.evidence.activity_basis})</span><span>Próxima acción: {displayDate(priority.evidence.next_action_at)}</span><span>Cierre esperado: {displayDateOnly(priority.evidence.expected_close_date)}</span></div>
        <footer>{(canOpenDashboard || canOpenOpportunity) && <div className="vigia-card-actions">{canOpenDashboard && <a className="button" href={dashboardLink(priority)}>Ver en Dashboard</a>}{canOpenOpportunity && <a className="button secondary" href={`#/detail/${priority.id}`}>Ver oportunidad</a>}{canOpenOpportunity && <a className="button secondary" href={`#/detail/${priority.id}?focus=interaction`}>Registrar seguimiento</a>}</div>}<div className="vigia-feedback" aria-label="Feedback local"><button className={feedback[priority.id] === 'revisada' ? 'active' : 'secondary'} onClick={() => setFeedback(current => ({ ...current, [priority.id]: 'revisada' }))}>Marcar revisada</button><button className={feedback[priority.id] === 'util' ? 'active' : 'secondary'} onClick={() => setFeedback(current => ({ ...current, [priority.id]: 'util' }))}>Útil</button><button className={feedback[priority.id] === 'no_util' ? 'active' : 'secondary'} onClick={() => setFeedback(current => ({ ...current, [priority.id]: 'no_util' }))}>No útil</button></div></footer>
      </article>)}
    </section>
    {!status && !visible.length && <div className="empty"><strong>Sin prioridades para estos filtros</strong><span>Prueba otra combinación o actualiza la lectura.</span>{hasFilters && <button className="secondary" onClick={resetFilters}>Limpiar</button>}</div>}
    <p className="muted">Feedback local de sesión: no se guarda en el CRM, no cambia el score y se pierde al recargar.</p>
  </section>;
}
