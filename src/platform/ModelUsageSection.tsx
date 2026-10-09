// IT → Agentes → "Uso de IA": cuántas veces cada agente usa la IA, contra sus topes. Sólo lectura.
// Los datos vienen del libro de uso de modelos de la plataforma (puerta única de modelos, Paso 1).
import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { EmptyState, Panel } from '../siio/SiioUi';
import {
  MODEL_USAGE_COST_NOTE,
  MODEL_USAGE_EMPTY_TEXT,
  formatLatency,
  formatUsdEquivalent,
  modelCapabilityLabel,
  usageAgainstLimit,
  type ModelUsageCapability,
  type ModelUsagePayload,
} from './agentsPresentation';

type UsageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; payload: ModelUsagePayload };

const dateTime = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
const numbers = new Intl.NumberFormat('es-CO');

function UsageCard({ item }: { item: ModelUsageCapability }) {
  const limit = usageAgainstLimit(item);
  const peak = Math.max(1, ...item.daily.map(point => point.uses));
  return <article className="panel platform-usage-card">
    <header>
      <div>
        <h3>{modelCapabilityLabel(item.capability, item.label)}</h3>
        <small>{item.agent_id} · {item.capability}</small>
      </div>
    </header>
    {limit && <div className="platform-usage-limit">
      <div className="platform-usage-limit-text">
        <span>Uso {limit.periodLabel}</span>
        <strong>{limit.used} de {limit.max}</strong>
      </div>
      <div className="platform-usage-bar" role="meter" aria-valuemin={0} aria-valuemax={limit.max} aria-valuenow={limit.used} aria-label={`Uso ${limit.periodLabel}: ${limit.used} de ${limit.max}`}>
        <span className={`platform-usage-bar-fill tone-${limit.tone}`} style={{ width: `${limit.percent}%` }} />
      </div>
    </div>}
    <dl className="platform-usage-facts">
      <div><dt>Usos hoy</dt><dd>{item.today}</dd></div>
      <div><dt>Usos este mes</dt><dd>{item.month}</dd></div>
      <div><dt>Completados (7 días)</dt><dd>{item.last_7_days.completed}</dd></div>
      <div><dt>Fallidos (7 días)</dt><dd>{item.last_7_days.failed}</dd></div>
      <div><dt>Rechazados (7 días)</dt><dd>{item.last_7_days.rejected}</dd></div>
      <div><dt>Tiempo medio de respuesta</dt><dd>{formatLatency(item.avg_latency_ms)}</dd></div>
      <div><dt>Tokens del mes</dt><dd>{numbers.format(item.month_tokens.input + item.month_tokens.output)}</dd></div>
      <div><dt>Costo equivalente del mes</dt><dd>{formatUsdEquivalent(item.month_cost_usd_equivalent)}</dd></div>
    </dl>
    <div className="platform-usage-series" aria-label="Usos por día, últimos 14 días">
      {item.daily.map(point => <span key={point.day} className="platform-usage-series-bar" title={`${point.day}: ${point.uses} usos${point.rejected ? `, ${point.rejected} rechazados` : ''}`} style={{ height: `${Math.max(4, Math.round((point.uses / peak) * 100))}%` }} data-empty={point.uses === 0 ? 'true' : undefined} />)}
    </div>
    <p className="platform-agent-dates">Últimos 14 días · Último uso: {item.last_used_at ? dateTime.format(new Date(item.last_used_at)) : 'sin usos'}</p>
  </article>;
}

export function ModelUsageSection() {
  const [state, setState] = useState<UsageState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    api<ModelUsagePayload>('/api/platform/model-usage')
      .then(payload => { if (!cancelled) setState({ status: 'ready', payload }); })
      .catch((error: unknown) => { if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }); });
    return () => { cancelled = true; };
  }, []);

  return <Panel title="Uso de IA">
    <p className="platform-usage-intro">Cuántas veces cada agente usa la IA, frente a sus topes. Se cuentan los usos que llegaron al modelo; los rechazados (tope agotado o servicio ocupado) no llegaron al modelo.</p>
    {state.status === 'loading' && <div className="notice">Cargando uso de IA…</div>}
    {state.status === 'error' && <div className="error" role="alert">{state.message}</div>}
    {state.status === 'ready' && <>
      {!state.payload.has_data && <EmptyState title="Sin usos registrados" text={MODEL_USAGE_EMPTY_TEXT} />}
      <section className="platform-agent-grid" aria-label="Uso de IA por capacidad">
        {(state.payload.capabilities || []).map(item => <UsageCard key={`${item.agent_id}:${item.capability}`} item={item} />)}
      </section>
      <p className="platform-usage-note">{MODEL_USAGE_COST_NOTE}</p>
    </>}
  </Panel>;
}
