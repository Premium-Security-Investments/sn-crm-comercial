import { useEffect, useState } from 'react';
import { loadTenderSemana } from '../api';
import type { TenderRequest, TenderSemana, TenderSemanaItem } from '../types';
import { formatDay, formatDeadline } from '../workspace/tenderWorkspaceFormat';

const whenLabel = (dias: number) => (dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : null);

/** Nombre corto: las tres de la Rama Judicial sólo se distinguen al final del nombre (Manizales, Pereira, altas cortes). */
export function nombreCorto(entity: string | null) {
  return (entity || '').replace(/\s+/g, ' ').trim()
    .replace(/^Rama Judicial Dirección Seccional de Administración Judicial de (.+)$/i, 'Rama Judicial · Seccional $1')
    .replace(/^Rama Judicial Dirección Ejecutiva de Administración Judicial$/i, 'Rama Judicial · Dirección Ejecutiva');
}

function hora(item: TenderSemanaItem) {
  if (!item.tiene_hora) return 'sin hora';
  const text = formatDeadline(item.value);
  const comma = text.indexOf(', ');
  return comma >= 0 ? text.slice(comma + 2) : text;
}

/**
 * La semana de licitaciones (Juan, 2026-11-10): «un resumen del cronograma para que en una visual rápida pueda ver qué
 * tiene pendiente para hoy y los siguientes días, no importa el estado del proceso». Los próximos 7 días, con hoy
 * destacado. Sólo para quien trabaja licitaciones (permiso de Licitaciones). Sin nada en la semana, no se muestra.
 */
export function TenderMyDaySemana({ request, onOpen }: { request: TenderRequest; onOpen: (opportunityId: string) => void }) {
  const [semana, setSemana] = useState<TenderSemana | null>(null);
  useEffect(() => {
    let active = true;
    // Si no se puede leer, Mi día sigue igual: es un resumen, no una condición.
    void loadTenderSemana(request).then(payload => { if (active) setSemana(payload); }, () => undefined);
    return () => { active = false; };
  }, [request]);
  if (!semana || !semana.items.length) return null;
  const days = [...new Set(semana.items.map(item => item.day))];
  return <section className="my-day-tender-semana" aria-label="Licitaciones: esta semana">
    <header>
      <strong>Licitaciones: esta semana</strong>
      <small className="muted">{semana.hoy > 0 ? `${semana.hoy} para hoy · ` : 'Nada para hoy · '}{semana.items.length} en los próximos {semana.dias} días</small>
    </header>
    {days.map(day => {
      const items = semana.items.filter(item => item.day === day);
      const isToday = day === semana.today;
      const when = whenLabel(items[0].dias);
      return <div key={day} className={`my-day-semana-day ${isToday ? 'is-today' : ''}`}>
        <span className="my-day-semana-date">{when ? `${when} · ` : ''}{formatDay(day)}</span>
        <ul>{items.map(item => <li key={`${item.opportunity_id}-${item.label}-${item.value}`}>
          <span className="my-day-semana-hour">{hora(item)}</span>
          <span>
            <button type="button" className="tw-link" onClick={() => onOpen(item.opportunity_id)}>{nombreCorto(item.entity) || item.ref || 'Licitación'}</button>
            {item.ref && <small className="muted"> ({item.ref})</small>}
            <span> · {item.label}</span>
            {item.por_confirmar && <em className="muted"> · por confirmar</em>}
          </span>
        </li>)}</ul>
      </div>;
    })}
  </section>;
}
