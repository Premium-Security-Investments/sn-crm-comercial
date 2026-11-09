import { useEffect, useState } from 'react';
import { loadTenderOpenBoard } from '../api';
import { DOSSIER_CONSEQUENCE_LABEL } from '../dossierChecklistModel';
import type { TenderOpenBoard, TenderRequest } from '../types';
import { countdownLabel } from '../workspace/tenderWorkspaceFormat';

/**
 * Mejora 1 (Juan, 2026-11-05: «déjelo en la plataforma únicamente por ahora»): lo primero que ve Katherine al entrar
 * son las licitaciones con algo vencido que puede tumbar la oferta, o con algo que no se subsana todavía abierto. Una
 * línea por licitación; el detalle está en Preparar. Mismo cálculo que el tablero y Preparar. Sin nada, no se muestra.
 */
export function TenderMyDayOverdue({ request, onOpen }: { request: TenderRequest; onOpen: (opportunityId: string) => void }) {
  const [board, setBoard] = useState<TenderOpenBoard | null>(null);
  useEffect(() => {
    let active = true;
    // Si el tablero no se puede leer, Mi día sigue igual: esto es un aviso, no una condición.
    void loadTenderOpenBoard(request).then(payload => { if (active) setBoard(payload); }, () => undefined);
    return () => { active = false; };
  }, [request]);
  const rows = (board?.processes || []).filter(process => process.vencidos && (process.vencidos.vencidos_que_tumban > 0 || process.vencidos.no_subsanables_abiertos > 0));
  // F17 (Juan, 2026-11-09): licitaciones abiertas cuyo análisis no trae la fecha de observaciones.
  const sinCronograma = (board?.processes || []).filter(process => process.cronograma_faltante);
  if (!rows.length && !sinCronograma.length) return null;
  return <>
  {sinCronograma.length > 0 && <section className="notice my-day-tender-overdue" aria-label="Licitaciones sin cronograma">
    <strong>Falta el cronograma de SECOP</strong>
    <ul>{sinCronograma.map(process => <li key={process.opportunity_id}>
      <button type="button" className="tw-link" onClick={() => onOpen(process.opportunity_id)}>{process.entity || process.ref}</button>
      {' · '}{countdownLabel(process.close_date)}
      <small className="muted"> — el análisis no encontró la fecha de observaciones: imprima «Información del procedimiento» de SECOP II y súbala.</small>
    </li>)}</ul>
  </section>}
  {rows.length > 0 && <section className="notice my-day-tender-overdue" aria-label="Licitaciones con algo que puede tumbar la oferta">
    <strong>Licitaciones con algo que puede tumbar la oferta</strong>
    <ul>
      {rows.map(process => {
        const v = process.vencidos!;
        const first = v.primeros.find(item => item.consecuencia === 'no_subsanable' || item.consecuencia === 'causa_rechazo') || v.primeros[0];
        return <li key={process.opportunity_id}>
          <button type="button" className="tw-link" onClick={() => onOpen(process.opportunity_id)}>{process.entity || process.ref}</button>
          {' · '}{countdownLabel(process.close_date)}
          {v.no_subsanables_abiertos > 0 && ` · ${v.no_subsanables_abiertos} que no se subsana${v.no_subsanables_abiertos === 1 ? '' : 'n'} abierto${v.no_subsanables_abiertos === 1 ? '' : 's'}`}
          {v.vencidos_que_tumban > 0 && ` · ${v.vencidos_que_tumban} vencido${v.vencidos_que_tumban === 1 ? '' : 's'} que tumba${v.vencidos_que_tumban === 1 ? '' : 'n'} la oferta`}
          {first && <small className="muted"> — {DOSSIER_CONSEQUENCE_LABEL[first.consecuencia]}: {first.titulo}{first.dias_vencido > 0 ? ` (venció hace ${first.dias_vencido} d)` : ''}</small>}
        </li>;
      })}
    </ul>
  </section>}
  </>;
}
