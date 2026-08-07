import { useMemo } from 'react';
import { SIIO_AGENT_CATALOG } from '../siioAgents';
import type { SiioAgentStatus } from '../siioAgents';
import { navigateSiioView, uniqueOptions } from './selectors';
import { Badge, EmptyState, Panel } from './SiioUi';
import type { SiioBootstrapPayload, SiioRouteState } from './types';

const STATUS_LABELS: Record<SiioAgentStatus, string> = {
  piloto: 'Piloto controlado',
  operativo_parcial: 'Operación parcial',
  diseño: 'En diseño',
};

const FRONT_LABELS: Record<string, string> = {
  F1: 'Comercial',
  F2: 'Finanzas',
  F3B: 'Nómina agregada',
  F4: 'Fuentes e inteligencia',
  F5: 'Reglas y recomendaciones',
};

const agentStatusLabel = (status: string) => STATUS_LABELS[status as SiioAgentStatus] ?? status;

export function SiioAgentsView({ routeState, onNavigate }: { payload: SiioBootstrapPayload; routeState: Extract<SiioRouteState, { view: 'agentes' }>; onNavigate: (state: SiioRouteState) => void }) {
  const statuses = useMemo(() => uniqueOptions(SIIO_AGENT_CATALOG.map(agent => agent.status)), []);
  const owners = useMemo(() => uniqueOptions(SIIO_AGENT_CATALOG.map(agent => agent.owner_role)), []);
  const visibleAgents = useMemo(() => SIIO_AGENT_CATALOG.filter(agent => (
    (!routeState.filters.status || agent.status === routeState.filters.status)
    && (!routeState.filters.owner || agent.owner_role === routeState.filters.owner)
  )), [routeState.filters]);
  const changeFilter = <Key extends keyof typeof routeState.filters>(key: Key, value: typeof routeState.filters[Key]) => {
    onNavigate(navigateSiioView('agentes', { ...routeState.filters, [key]: value }));
  };

  return <div className="stack">
    <section className="siio-view-filters" aria-label="Filtros del catálogo de agentes">
      <label>Estado
        <select value={routeState.filters.status} onChange={event => changeFilter('status', event.target.value)}>
          <option value="">Todos los estados</option>
          {statuses.map(status => <option key={status} value={status}>{agentStatusLabel(status)}</option>)}
        </select>
      </label>
      <label>Responsable institucional
        <select value={routeState.filters.owner} onChange={event => changeFilter('owner', event.target.value)}>
          <option value="">Todos los responsables</option>
          {owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}
        </select>
      </label>
    </section>

    <Panel title="Catálogo institucional gobernado">
      {!visibleAgents.length ? <EmptyState title="Sin agentes para los filtros seleccionados" text="No hay agentes institucionales que coincidan con el estado y responsable seleccionados." /> : <div className="siio-insight-list">
        {visibleAgents.map(agent => <article className="siio-insight siio-agent-card" key={agent.id}>
          <header className="siio-agent-heading"><div><span className="siio-eyebrow">Agente funcional de SIIO</span><h3>{agent.name}</h3></div><Badge tone={agent.status === 'piloto' ? 'amber' : agent.status === 'operativo_parcial' ? 'green' : 'purple'}>{STATUS_LABELS[agent.status]}</Badge></header>
          <div className="siio-insight-detail">
            <div className="siio-agent-field"><strong>Propósito</strong><span>{agent.purpose}</span></div>
            <div className="siio-agent-field"><strong>Responsable institucional</strong><span>{agent.owner_role}</span></div>
            <div className="siio-agent-field"><strong>Estado</strong><span>{STATUS_LABELS[agent.status]}</span></div>
            <div className="siio-agent-field"><strong>Frentes autorizados</strong><span>{agent.authorized_fronts.map(front => FRONT_LABELS[front] ?? front).join(', ')}</span></div>
            <div className="siio-agent-field"><strong>Fuentes autorizadas</strong><span>{agent.authorized_sources.join(', ')}</span></div>
            <div className="siio-agent-field"><strong>Acciones permitidas</strong><span>{agent.permitted_actions.join(', ')}</span></div>
            <div className="siio-agent-field"><strong>Acciones prohibidas</strong><span>{agent.forbidden_actions.join(', ')}</span></div>
            <div className="siio-agent-field"><strong>Revisión humana obligatoria</strong><span>{agent.human_review_required ? 'Sí, obligatoria antes de cualquier uso institucional.' : 'No'}</span></div>
            <div className="siio-agent-field"><strong>Regla de auditoría</strong><span>{agent.audit_rule}</span></div>
            <div className="siio-agent-field"><strong>Siguiente gate</strong><span>{agent.next_gate}</span></div>
            <div className="siio-agent-field"><strong>Capacidad actual</strong><span>{agent.current_capability}</span></div>
            <div className="siio-agent-field"><strong>Canal autorizado</strong><span>{agent.channel}</span></div>
            <div className="siio-agent-field"><strong>Sin escritura automática en producción</strong><span>{agent.can_write_production ? 'No aplica' : 'Confirmado'}</span></div>
            <div className="siio-agent-field"><strong>Capacidad productiva</strong><span>{agent.production_capability}</span></div>
            <div className="siio-agent-field"><strong>Desarrollo / no desplegado</strong><span>{agent.development_status}</span></div>
            <div className="siio-agent-field"><strong>Corte</strong><span>{agent.state_as_of}</span></div>
            <div className="siio-agent-field"><strong>Fuente</strong><span>{agent.state_source}</span></div>
          </div>
        </article>)}
      </div>}
    </Panel>
  </div>;
}
