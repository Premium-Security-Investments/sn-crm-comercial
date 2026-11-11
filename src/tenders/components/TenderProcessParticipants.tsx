import { useEffect, useState } from 'react';
import type { TenderRequest } from '../types';
import { AllyCardDialog } from './AllyDetail';

/**
 * Punto 7 del encargo de Aliados (Juan, 2026-11-11: «vamos así»): quiénes se han movido en este proceso, plegado en
 * Decidir y agrupado por lo que hicieron. Sirve para leer la competencia antes de ofertar y para no proponer como socio
 * a quien ya compite aquí. Sólo lectura: los datos se registran en Aliados.
 */
type Item = { nit: string | null; name: string; role: string | null; kind: string; detail: string | null; occurred_on: string | null; other_processes: number; zone_cities: string[] };
type Group = { key: string; label: string; items: Item[] };
const ROLE: Record<string, string> = { aliado: 'Aliado', aliado_potencial: 'Aliado potencial', competidor: 'Competidor', descartado: 'Descartado' };
const joinNames = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0] || '';

export function TenderProcessParticipants({ opportunityId, request, canEdit = false }: { opportunityId: string; request: TenderRequest; canEdit?: boolean }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [card, setCard] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void request<{ installed: boolean; groups: Group[] }>(`/api/tender-allies/process-participants?opportunity_id=${encodeURIComponent(opportunityId)}`)
      .then(payload => { if (active) setGroups(payload.installed ? payload.groups : []); }, () => undefined);
    return () => { active = false; };
  }, [opportunityId, request]);
  if (!groups?.length) return null;
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  return <details className="tw-participants">
    <summary>Quiénes se han movido en este proceso ({total})</summary>
    <p className="tw-muted">Lo registrado en Aliados. Sólo lectura.</p>
    {groups.map(group => <div key={group.key} className="tw-participants-group">
      <h4>{group.label} · {group.items.length}</h4>
      <ul className="tw-ally-list">{group.items.map((item, index) => <li key={`${item.nit || item.name}-${index}`}>
        <div className="tw-ally-line">
          {item.nit ? <button type="button" className="tw-ally-name" onClick={() => setCard(item.nit)}>{item.name}</button> : <strong>{item.name}</strong>}
          {(item.detail || item.occurred_on) && <span className="tw-ally-meta">{[item.detail, item.occurred_on].filter(Boolean).join(' · ')}</span>}
        </div>
        {(item.other_processes > 0 || (item.role && ROLE[item.role]) || item.zone_cities.length > 0) && <div className="tw-ally-tags">
          {item.other_processes > 0 && <span className="tw-ally-tag is-neutral">En {item.other_processes} proceso{item.other_processes === 1 ? '' : 's'} nuestro{item.other_processes === 1 ? '' : 's'} más</span>}
          {item.role && ROLE[item.role] && <span className={`tw-ally-tag${item.role === 'competidor' ? ' is-alert' : ' is-good'}`}>{ROLE[item.role]}</span>}
          {item.zone_cities.length > 0 && <span className="tw-ally-tag">Oficina en {joinNames(item.zone_cities)}</span>}
        </div>}
      </li>)}</ul>
    </div>)}
    {card && <AllyCardDialog nit={card} canEdit={canEdit} request={request} onClose={() => setCard(null)} />}
  </details>;
}
