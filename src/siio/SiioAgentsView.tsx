import { useMemo } from 'react';
import { SIIO_AGENT_CATALOG } from '../siioAgents';
import { navigateSiioView, uniqueOptions } from './selectors';
import { Badge, EmptyState, Panel } from './SiioUi';
import type { SiioBootstrapPayload, SiioRouteState } from './types';

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
          {statuses.map(status => <option key={status} value={status}>{status}</option>)}
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
        {visibleAgents.map(agent => <article className="siio-insight" key={agent.id}>
          <header><div><span className="eyebrow">{agent.id}</span><h3>{agent.name}</h3></div><Badge tone={agent.status === 'piloto' ? 'amber' : agent.status === 'operativo_parcial' ? 'green' : 'purple'}>{agent.status}</Badge></header>
          <div className="siio-insight-detail">
            <div><strong>Propósito</strong><span>{agent.purpose}</span></div>
            <div><strong>Responsable institucional</strong><span>{agent.owner_role}</span></div>
            <div><strong>Estado</strong><span>{agent.status}</span></div>
            <div><strong>Frentes autorizados</strong><span>{agent.authorized_fronts.join(', ')}</span></div>
            <div><strong>Fuentes autorizadas</strong><span>{agent.authorized_sources.join(', ')}</span></div>
            <div><strong>Acciones permitidas</strong><span>{agent.permitted_actions.join(', ')}</span></div>
            <div><strong>Acciones prohibidas</strong><span>{agent.forbidden_actions.join(', ')}</span></div>
            <div><strong>Revisión humana obligatoria</strong><span>{agent.human_review_required ? 'Sí, obligatoria antes de cualquier uso institucional.' : 'No'}</span></div>
            <div><strong>Regla de auditoría</strong><span>{agent.audit_rule}</span></div>
            <div><strong>Siguiente gate</strong><span>{agent.next_gate}</span></div>
            <div><strong>Capacidad actual</strong><span>{agent.current_capability}</span></div>
            <div><strong>Canal autorizado</strong><span>{agent.channel}</span></div>
            <div><strong>Sin escritura automática en producción</strong><span>{agent.can_write_production ? 'No aplica' : 'Confirmado'}</span></div>
          </div>
        </article>)}
      </div>}
    </Panel>
  </div>;
}
