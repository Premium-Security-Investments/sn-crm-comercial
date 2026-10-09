// IT → Agentes: vista visual (sólo lectura) de la Plataforma de Agentes y casa de Vig-IA IT.
// No confundir con la pestaña "Agentes" de la Torre de Control (src/siio/SiioAgentsView.tsx), que es otro catálogo.
import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { Badge, EmptyState, Panel } from '../siio/SiioUi';
import { AGENT_COUNT_LABELS, UPCOMING_PLATFORM_VIEWS, agentStateLabel, agentStateTone, type PlatformAgent, type PlatformAgentsPayload } from './agentsPresentation';
import { ModelUsageSection } from './ModelUsageSection';
import './platform.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; agents: PlatformAgent[] };

const dates = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
function fmtDate(value: string | null) { return value ? dates.format(new Date(value)) : '—'; }

export function AgentsView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    api<PlatformAgentsPayload>('/api/platform/agents')
      .then(payload => { if (!cancelled) setState({ status: 'ready', agents: Array.isArray(payload?.agents) ? payload.agents : [] }); })
      .catch((error: unknown) => { if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }); });
    return () => { cancelled = true; };
  }, []);

  return <div className="stack platform-agents">
    <section className="executive-hero platform-agents-hero">
      <div>
        <span className="eyebrow">Plataforma de agentes</span>
        <h2>Agentes del SIIO</h2>
        <p>Registro oficial de los agentes Vig-IA: quién es cada uno, en qué estado está y qué controla la plataforma.</p>
      </div>
      {state.status === 'ready' && <div className="hero-facts">
        <div><small>Agentes registrados</small><strong>{state.agents.length}</strong></div>
        <div><small>Activos en la plataforma</small><strong>{state.agents.filter(agent => agent.active).length}</strong></div>
      </div>}
    </section>

    {state.status === 'loading' && <div className="notice">Cargando agentes de la plataforma…</div>}
    {state.status === 'error' && <div className="error" role="alert">{state.message}</div>}
    {state.status === 'ready' && state.agents.length === 0 && <Panel title="Agentes">
      <EmptyState title="Sin agentes registrados" text="La plataforma todavía no tiene agentes en su registro." />
    </Panel>}
    {state.status === 'ready' && state.agents.length > 0 && <section className="platform-agent-grid" aria-label="Agentes registrados">
      {state.agents.map(agent => <article className="panel platform-agent-card" key={agent.id}>
        <header>
          <div>
            <h3>{agent.name}</h3>
            <small>{agent.id}</small>
          </div>
          <Badge tone={agentStateTone(agent.state)}>{agentStateLabel(agent.state)}</Badge>
        </header>
        <p className="platform-agent-active">Activo en la plataforma: <strong>{agent.active ? 'Sí' : 'No'}</strong></p>
        <dl className="platform-agent-counts">
          <div><dt>{AGENT_COUNT_LABELS.policy_versions}</dt><dd>{agent.counts.policy_versions}</dd></div>
          <div><dt>{AGENT_COUNT_LABELS.configuration_versions}</dt><dd>{agent.counts.configuration_versions}</dd></div>
          <div><dt>{AGENT_COUNT_LABELS.open_runs}</dt><dd>{agent.counts.open_runs}</dd></div>
        </dl>
        <p className="platform-agent-dates">
          Registrado: {fmtDate(agent.created_at)} · Actualizado: {fmtDate(agent.updated_at)}
          {agent.retired_at ? ` · Retirado: ${fmtDate(agent.retired_at)}` : ''}
        </p>
      </article>)}
    </section>}

    <ModelUsageSection />

    <Panel title="Próximas vistas">
      <ul className="platform-upcoming" aria-label="Próximas vistas de la plataforma">
        {UPCOMING_PLATFORM_VIEWS.map(view => <li key={view}><span className="platform-chip" aria-disabled="true">{view}</span></li>)}
      </ul>
    </Panel>
  </div>;
}
