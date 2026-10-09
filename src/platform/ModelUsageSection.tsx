// IT → Agentes → "Uso de IA": cuántas veces cada agente usa la IA, cuántas fallan y cuántas veces se tocó el límite de
// la suscripción. Sólo lectura. Los datos vienen del libro de uso de modelos de la plataforma (puerta única de
// modelos); los carga AgentsView (GET /api/platform/model-usage) y se pasan aquí. El costo equivalente es secundario.
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
import type { Loadable } from './usePlatformData';

const dateTime = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
const numbers = new Intl.NumberFormat('es-CO');

function UsageCard({ item, agentName }: { item: ModelUsageCapability; agentName: string }) {
  const limit = usageAgainstLimit(item);
  const peak = Math.max(1, ...item.daily.map(point => point.uses));
  const sessionLimit = item.last_7_days.session_limit ?? 0;
  return <article className="panel platform-usage-card">
    <header>
      <div>
        <h3>{modelCapabilityLabel(item.capability, item.label)}</h3>
        <small>{agentName}</small>
      </div>
    </header>
    <dl className="platform-usage-facts platform-usage-highlights">
      <div><dt>Usos hoy</dt><dd>{item.today}</dd></div>
      <div><dt>Usos este mes</dt><dd>{item.month}</dd></div>
      <div data-tone={item.last_7_days.failed ? 'amber' : undefined}><dt>Fallidos (7 días)</dt><dd>{item.last_7_days.failed}</dd></div>
      <div data-tone={sessionLimit ? 'danger' : undefined}><dt>Límite de la suscripción (7 días)</dt><dd>{sessionLimit ? `${sessionLimit} veces` : 'Sin topes'}</dd></div>
    </dl>
    {limit && <div className="platform-usage-limit">
      <div className="platform-usage-limit-text">
        <span>Tope actual {limit.periodLabel}</span>
        <strong>{limit.used} de {limit.max}</strong>
      </div>
      <div className="platform-usage-bar" role="meter" aria-valuemin={0} aria-valuemax={limit.max} aria-valuenow={limit.used} aria-label={`Uso ${limit.periodLabel}: ${limit.used} de ${limit.max}`}>
        <span className={`platform-usage-bar-fill tone-${limit.tone}`} style={{ width: `${limit.percent}%` }} />
      </div>
    </div>}
    <div className="platform-usage-series" aria-label="Usos por día, últimos 14 días">
      {item.daily.map(point => <span key={point.day} className="platform-usage-series-bar" title={`${point.day}: ${point.uses} usos${point.rejected ? `, ${point.rejected} rechazados` : ''}`} style={{ height: `${Math.max(4, Math.round((point.uses / peak) * 100))}%` }} data-empty={point.uses === 0 ? 'true' : undefined} />)}
    </div>
    <p className="platform-usage-secondary">
      Últimos 14 días · Último uso: {item.last_used_at ? dateTime.format(new Date(item.last_used_at)) : 'sin usos'}<br />
      Completados (7 días): {item.last_7_days.completed} · Rechazados (7 días): {item.last_7_days.rejected} · Tiempo medio de respuesta: {formatLatency(item.avg_latency_ms)}<br />
      Tokens del mes: {numbers.format(item.month_tokens.input + item.month_tokens.output)} · Costo equivalente del mes: {formatUsdEquivalent(item.month_cost_usd_equivalent)}
    </p>
  </article>;
}

export function ModelUsageSection({ usage, agentId, agentNames = {} }: { usage: Loadable<ModelUsagePayload>; agentId?: string; agentNames?: Record<string, string> }) {
  const items = usage.status === 'ready' ? (usage.data.capabilities || []).filter(item => !agentId || item.agent_id === agentId) : [];
  return <Panel title="Uso de IA">
    <p className="platform-usage-intro">Cuántas veces cada agente usa la IA, cuántas fallan y cuántas veces se tocó el límite de la suscripción. Se cuentan los usos que llegaron al modelo; los rechazados (cupo agotado o servicio ocupado) no llegaron al modelo.</p>
    {usage.status === 'loading' && <div className="notice">Cargando uso de IA…</div>}
    {usage.status === 'error' && <div className="error" role="alert">{usage.message}</div>}
    {usage.status === 'ready' && <>
      {!usage.data.has_data && <EmptyState title="Sin usos registrados" text={MODEL_USAGE_EMPTY_TEXT} />}
      {items.length === 0 && usage.data.has_data && <EmptyState title="Sin funciones con IA" text="Este agente todavía no usa la IA por la puerta de modelos." />}
      {items.length > 0 && <section className="platform-agent-grid" aria-label="Uso de IA por función">
        {items.map(item => <UsageCard key={`${item.agent_id}:${item.capability}`} item={item} agentName={agentNames[item.agent_id] || item.agent_id} />)}
      </section>}
      <p className="platform-usage-note">{MODEL_USAGE_COST_NOTE}</p>
    </>}
  </Panel>;
}
