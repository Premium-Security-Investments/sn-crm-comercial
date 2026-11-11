// Estudios de Seguridad Física: tablero de alertas de la sección (Juan, 2026-11-11: "en la sección de estudio de
// seguridad, en una especie de dashboard o de alertas … pero no en gerencia"). Sólo lee la lista de estudios: qué está
// vencido o por vencer, qué hay que revalorar, qué falta entregar, qué recomendaciones se vencieron y qué espera revisión.
import type { StudySummaryRow } from './api';

type Group = { key: string; title: string; tone: 'inaceptable' | 'tolerable' | 'aceptable'; items: Array<{ study: StudySummaryRow; detail: string }> };
const fmtDate = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : '—');

export function studyAlerts(studies: StudySummaryRow[]): Group[] {
  const pick = (filter: (study: StudySummaryRow) => boolean, detail: (study: StudySummaryRow) => string) => studies.filter(filter).map(study => ({ study, detail: detail(study) }));
  const groups: Group[] = [
    { key: 'vencidos', title: 'Estudios vencidos', tone: 'inaceptable', items: pick(study => study.validity?.estado === 'vencido', study => `venció el ${fmtDate(study.validity?.vence)}`) },
    { key: 'revalorar', title: 'Para revalorar', tone: 'inaceptable', items: pick(study => Boolean(study.validity?.revalorar.length), study => study.validity!.revalorar.map(item => item.detalle).join(' · ')) },
    { key: 'por_vencer', title: 'Por vencer (60 días)', tone: 'tolerable', items: pick(study => study.validity?.estado === 'por_vencer', study => `vence el ${fmtDate(study.validity?.vence)}`) },
    { key: 'recomendaciones', title: 'Recomendaciones vencidas', tone: 'tolerable', items: pick(study => Boolean((study.overdue_actions?.nuestras || 0) + (study.overdue_actions?.cliente || 0)), study => [study.overdue_actions!.nuestras ? `${study.overdue_actions!.nuestras} nuestras` : '', study.overdue_actions!.cliente ? `${study.overdue_actions!.cliente} del cliente` : ''].filter(Boolean).join(' y ')) },
    { key: 'sin_entregar', title: 'Aprobados sin entregar', tone: 'tolerable', items: pick(study => study.delivered === false, study => `versión ${study.latest_version}: falta socializarla con el cliente`) },
    { key: 'por_aprobar', title: 'Esperan aprobación', tone: 'aceptable', items: pick(study => study.status === 'revisado', () => 'revisado: falta que el jefe de operaciones apruebe') },
    { key: 'en_revision', title: 'Esperan revisión', tone: 'aceptable', items: pick(study => study.status === 'en_revision', () => 'enviado: falta la revisión del coordinador') },
    { key: 'devueltos', title: 'Devueltos al analista', tone: 'aceptable', items: pick(study => study.status === 'devuelto', () => 'con observaciones por corregir') },
  ];
  return groups.filter(group => group.items.length);
}

export function AlertsPanel({ studies, onOpen }: { studies: StudySummaryRow[]; onOpen: (id: string) => void }) {
  const groups = studyAlerts(studies);
  if (!studies.length) return null;
  return <section className="es-card es-alerts" aria-label="Alertas de estudios">
    <h3>Alertas</h3>
    {!groups.length ? <p className="es-muted">Sin alertas: ningún estudio vencido, por vencer, por revalorar, por entregar ni con recomendaciones vencidas.</p> : <div className="es-alert-grid">
      {groups.map(group => <div key={group.key} className="es-alert-group">
        <p><span className={`es-nivel es-nivel-${group.tone}`}>{group.items.length}</span> <strong>{group.title}</strong></p>
        <ul>{group.items.slice(0, 8).map(({ study, detail }) => <li key={study.id}>
          <button type="button" className="es-link" onClick={() => onOpen(study.id)}>{study.code} · {study.client_name}</button>
          <small className="es-muted"> {study.site_name} — {detail}</small>
        </li>)}</ul>
        {group.items.length > 8 ? <small className="es-muted">y {group.items.length - 8} más en la lista.</small> : null}
      </div>)}
    </div>}
  </section>;
}
