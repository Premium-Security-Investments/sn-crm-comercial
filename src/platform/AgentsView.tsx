// IT → Agentes: casa de Vig-IA IT y de la Plataforma de Agentes. Pestañas Resumen | Uso de IA | Perfiles de uso |
// Propuestas | Historial; el detalle de un agente vive en #/agents/<ID>. Sólo para quien administra usuarios.
// No confundir con la pestaña "Agentes" de la Torre de Control (src/siio/SiioAgentsView.tsx), que es otro catálogo.
import { useMemo, useState, type ReactElement } from 'react';
import { Badge, EmptyState, Panel } from '../siio/SiioUi';
import {
  AGENTS_TABS,
  AGENT_OWNER_PENDING,
  UPCOMING_PLATFORM_VIEWS,
  agentStateLabel,
  agentModelAlerts,
  agentStateTone,
  agentUsageTotals,
  alertCountText,
  versionLabel,
  type AgentConfigurationPayload,
  type AgentsTab,
  type ModelUsagePayload,
  type PlatformAgent,
} from './agentsPresentation';
import { AgentDetail } from './AgentDetail';
import { HistoryView, ProfilesView, ProposalsView, fmtDateTime } from './ConfigurationViews';
import { ModelAlertsPanel } from './ModelAlerts';
import { ModelUsageSection } from './ModelUsageSection';
import { usePlatformData, type Loadable } from './usePlatformData';
import './platform.css';

function go(hash: string) { window.location.hash = hash; }

/** Avisos del Resumen, todos derivados de datos reales. */
export function platformWarnings(agents: PlatformAgent[], usage: ModelUsagePayload | null, config: AgentConfigurationPayload | null): string[] {
  const warnings: string[] = [];
  // Paso 3: cada falla activa de la IA (sin uso exitoso posterior) es un aviso, en lenguaje común.
  for (const alert of agentModelAlerts(usage).filter(item => item.active)) {
    const name = agents.find(agent => agent.id === alert.agent_id)?.name || alert.agent_id;
    warnings.push(`${name}: ${alert.title}. Última vez: ${fmtDateTime(alert.last_at)} (${alertCountText(alert.count_24h)}).`);
  }
  const sessionLimit = usage?.session_limit_7d ?? 0;
  if (sessionLimit > 0) warnings.push(`El límite de la suscripción se tocó ${sessionLimit} ${sessionLimit === 1 ? 'vez' : 'veces'} en los últimos 7 días.`);
  if (config) {
    if (!config.admin_connected) warnings.push('La administración de la plataforma no está conectada: no se pueden proponer ni aprobar cambios.');
    for (const agentId of Object.keys(config.catalog)) {
      if (!config.current[agentId]) warnings.push(`${agents.find(agent => agent.id === agentId)?.name || agentId} usa los valores del código: aún no tiene configuración aprobada.`);
    }
    for (const item of config.expiring_exceptions) warnings.push(`La excepción de ${item.person} en "${item.function}" vence el ${item.expires}.`);
  }
  return warnings;
}

function Summary({ agents, usage, config, onTab }: { agents: PlatformAgent[]; usage: Loadable<ModelUsagePayload>; config: Loadable<AgentConfigurationPayload>; onTab: (tab: AgentsTab) => void }) {
  const usageData = usage.status === 'ready' ? usage.data : null;
  const configData = config.status === 'ready' ? config.data : null;
  const usesToday = usageData ? usageData.capabilities.reduce((sum, item) => sum + item.today, 0) : null;
  const sessionLimit = usageData ? usageData.session_limit_7d ?? 0 : null;
  const warnings = platformWarnings(agents, usageData, configData);
  const partial = agents.filter(agent => agent.state === 'partial_operation').length;
  return <div className="stack">
    <section className="platform-kpis" aria-label="Indicadores generales">
      <article className="panel platform-kpi"><small>Agentes registrados</small><strong>{agents.length}</strong><span>{partial} en operación parcial</span></article>
      <article className="panel platform-kpi"><small>Usos de IA hoy</small><strong>{usesToday ?? '—'}</strong><span>todos los agentes</span></article>
      <article className="panel platform-kpi" data-tone={sessionLimit ? 'danger' : 'green'}><small>Límite de la suscripción</small><strong>{sessionLimit == null ? '—' : sessionLimit ? `${sessionLimit} veces` : 'Sin topes'}</strong><span>veces tocado en 7 días: {sessionLimit ?? '—'}</span></article>
      <article className="panel platform-kpi" data-tone={configData?.pending_count ? 'amber' : undefined}><small>Propuestas por aprobar</small><strong>{configData ? configData.pending_count : '—'}</strong>
        <button type="button" className="link-button" onClick={() => onTab('proposals')}>Revisar →</button></article>
      <article className="panel platform-kpi" data-tone={agentModelAlerts(usageData).some(alert => alert.active) ? 'danger' : undefined}><small>Avisos</small><strong>{warnings.length}</strong><span>{warnings[0] || 'Sin avisos'}</span></article>
    </section>
    {usage.status === 'error' && <div className="notice">Uso de IA: {usage.message}</div>}
    {config.status === 'error' && <div className="notice">Configuración: {config.message}</div>}
    {warnings.length > 1 && <Panel title="Avisos"><ul className="platform-warnings">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></Panel>}
    <ModelAlertsPanel alerts={agentModelAlerts(usageData)} agentNames={Object.fromEntries(agents.map(agent => [agent.id, agent.name]))} />
    <section className="panel" aria-label="Lista de agentes">
      <div className="platform-section-head"><h2>Agentes</h2><small>Clic en un agente para ver su ficha, funciones, modelos y cupos</small></div>
      {agents.length === 0 && <EmptyState title="Sin agentes registrados" text="La plataforma todavía no tiene agentes en su registro." />}
      {agents.length > 0 && <div className="tablewrap platform-table">
        <table>
          <thead><tr><th>Agente</th><th>Estado</th><th>Dueño</th><th>Funciones con IA</th><th>Uso hoy / mes</th><th>Versión vigente</th></tr></thead>
          <tbody>
            {agents.map(agent => {
              const functions = configData?.catalog[agent.id] || [];
              const totals = agentUsageTotals(usageData, agent.id);
              const current = configData?.versions.find(version => version.id === configData.current[agent.id]);
              return <tr key={agent.id} className="clickable" onClick={() => go(`#/agents/${encodeURIComponent(agent.id)}`)}>
                <td><a href={`#/agents/${encodeURIComponent(agent.id)}`} onClick={event => event.stopPropagation()}><strong>{agent.name}</strong></a><small className="platform-sub">{agent.id}</small></td>
                <td><Badge tone={agentStateTone(agent.state)}>{agentStateLabel(agent.state)}</Badge></td>
                <td className="platform-muted">{AGENT_OWNER_PENDING}</td>
                <td title={functions.length ? functions.map(item => item.label).join(' · ') : configData?.no_functions_text}>{functions.length || '—'}</td>
                <td>{totals.tracked ? `${totals.today} / ${totals.month}` : '—'}</td>
                <td>{current ? <>{versionLabel(current)} · <span className="platform-ok">vigente</span></> : <span className="platform-muted">{functions.length ? 'Sin configurar (valores del código)' : 'Sin configurar'}</span>}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
    </section>
  </div>;
}

export function AgentsView({ agentId }: { agentId?: string }) {
  const { agents, usage, config, reload } = usePlatformData();
  const [tab, setTab] = useState<AgentsTab>('summary');
  const [message, setMessage] = useState('');
  const agentNames = useMemo(() => (agents.status === 'ready' ? Object.fromEntries(agents.data.map(agent => [agent.id, agent.name])) : {}), [agents]);
  const onDone = (text: string) => { setMessage(text); reload(); };

  if (agentId) return <AgentDetail agentId={agentId} agents={agents} usage={usage} config={config} agentNames={agentNames} onDone={onDone} message={message} />;

  const pending = config.status === 'ready' ? config.data.pending_count : 0;
  const configBlock = (render: (data: AgentConfigurationPayload) => ReactElement) => (config.status === 'ready'
    ? render(config.data)
    : config.status === 'error' ? <div className="error" role="alert">{config.message}</div> : <div className="notice">Cargando configuración…</div>);

  return <div className="stack platform-agents">
    <section className="executive-hero platform-agents-hero">
      <div>
        <span className="eyebrow">SIIO · IT</span>
        <h2>Agentes</h2>
        <p>Registro oficial de los agentes Vig-IA: estado, funciones con IA, modelos, cupos y quién aprueba cada cambio.</p>
      </div>
    </section>
    <nav className="module-segmented-nav platform-tabs" aria-label="Vistas de Agentes">
      {AGENTS_TABS.map(item => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setMessage(''); }}>
        {item.label}{item.id === 'proposals' && pending > 0 && <span className="platform-count" aria-label={`${pending} pendientes`}>{pending}</span>}
      </button>)}
    </nav>
    <p className="platform-upcoming-text">{UPCOMING_PLATFORM_VIEWS.join(' · ')} (próximamente)</p>
    {message && <div className="notice" role="status">{message}</div>}

    {agents.status === 'loading' && tab === 'summary' && <div className="notice">Cargando agentes de la plataforma…</div>}
    {agents.status === 'error' && tab === 'summary' && <div className="error" role="alert">{agents.message}</div>}
    {agents.status === 'ready' && tab === 'summary' && <Summary agents={agents.data} usage={usage} config={config} onTab={setTab} />}
    {tab === 'usage' && <ModelUsageSection usage={usage} agentNames={agentNames} />}
    {tab === 'profiles' && configBlock(data => <ProfilesView config={data} agentNames={agentNames} onDone={onDone} />)}
    {tab === 'proposals' && configBlock(data => <ProposalsView config={data} usage={usage} agentNames={agentNames} onDone={onDone} />)}
    {tab === 'history' && configBlock(data => <HistoryView config={data} agentNames={agentNames} onDone={onDone} />)}
  </div>;
}
