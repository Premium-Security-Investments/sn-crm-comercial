import { useMemo } from 'react';
import { deriveTrackingItems, filterTrackingItems, navigateSiioView, uniqueOptions } from './selectors';
import { Badge, EmptyState, Panel, fmtSiioDate } from './SiioUi';
import type { SiioBootstrapPayload, SiioRouteState, SiioTrackingKind } from './types';

const kinds: Array<{ kind: SiioTrackingKind; label: string }> = [
  { kind: 'todos', label: 'Todos' },
  { kind: 'decisiones', label: 'Decisiones' },
  { kind: 'bloqueos', label: 'Bloqueos' },
  { kind: 'riesgos', label: 'Riesgos' },
  { kind: 'compromisos', label: 'Compromisos' },
];

export function SiioManagementTrackingView({ payload, routeState, onNavigate }: { payload: SiioBootstrapPayload; routeState: Extract<SiioRouteState, { view: 'seguimiento' }>; onNavigate: (state: SiioRouteState) => void }) {
  const items = useMemo(() => deriveTrackingItems(payload.records, payload.decisions), [payload.records, payload.decisions]);
  const visible = useMemo(() => filterTrackingItems(items, routeState.filters), [items, routeState.filters]);
  const statuses = useMemo(() => uniqueOptions(items.map(item => item.status)), [items]);
  const semaphores = useMemo(() => uniqueOptions(items.map(item => item.semaphore)), [items]);
  const owners = useMemo(() => uniqueOptions(items.map(item => item.owner)), [items]);
  const changeFilter = <Key extends keyof typeof routeState.filters>(changedKey: Key, value: typeof routeState.filters[Key]) => onNavigate(navigateSiioView('seguimiento', { ...routeState.filters, [changedKey]: value }));

  return <div className="stack">
    <div className="tabs siio-tracking-kinds" aria-label="Tipos de seguimiento">
      {kinds.map(({ kind, label }) => <button type="button" key={kind} className={routeState.filters.kind === kind ? 'active' : ''} aria-pressed={routeState.filters.kind === kind} onClick={() => changeFilter('kind', kind)}>{label}</button>)}
    </div>
    <section className="siio-view-filters" aria-label="Filtros de seguimiento gerencial">
      <label>Estado
        <select value={routeState.filters.status} onChange={event => changeFilter('status', event.target.value)}><option value="">Todos los estados</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</select>
      </label>
      <label>Semáforo
        <select value={routeState.filters.semaphore} onChange={event => changeFilter('semaphore', event.target.value)}><option value="">Todos los semáforos</option>{semaphores.map(semaphore => <option key={semaphore} value={semaphore}>{semaphore}</option>)}</select>
      </label>
      <label>Responsable
        <select value={routeState.filters.owner} onChange={event => changeFilter('owner', event.target.value)}><option value="">Todos los responsables</option>{owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}</select>
      </label>
    </section>
    <Panel title="Seguimiento gerencial">
      {!visible.length ? <EmptyState title="Sin asuntos para los filtros seleccionados" text="No hay decisiones, bloqueos, riesgos o compromisos que coincidan." /> : <div className="siio-table-wrap"><table><thead><tr><th>Tipo</th><th>Asunto</th><th>Frente</th><th>Responsable</th><th>Estado</th><th>Semáforo</th><th>Próxima acción</th><th>Fecha disponible</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><Badge tone="blue">{item.kind}</Badge></td><td><strong>{item.title}</strong></td><td>{item.frontId || 'Sin frente'} </td><td>{item.owner || 'Pendiente'}</td><td>{item.status}</td><td>{item.semaphore ? <Badge tone={item.semaphore === 'rojo' ? 'danger' : item.semaphore === 'amarillo' ? 'amber' : 'green'}>{item.semaphore}</Badge> : 'Pendiente'}</td><td>{item.nextAction || 'Pendiente'}</td><td>{fmtSiioDate(item.dueDate)}</td></tr>)}</tbody></table></div>}
    </Panel>
  </div>;
}
