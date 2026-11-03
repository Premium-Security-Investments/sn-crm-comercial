import { useEffect, useState } from 'react';
import './tender-dossier.css';
import { formatDateOnly } from '../../dateOnly';
import { loadTenderOpenBoard } from '../api';
import type { TenderOpenBoard, TenderRequest } from '../types';

/**
 * El tablero de procesos abiertos (mejora 4 del encargo del 2026-10-31). Cada expediente sabe lo suyo; esto es el
 * conjunto: qué trámite sirve para varias licitaciones, qué documento vence antes de qué cierre y qué hay que pedir
 * una vez por proceso. Va plegado: se abre cuando se necesita.
 */
const date = (value: string | null) => (value ? formatDateOnly(value) : 'sin fecha');

export function TenderOpenBoardPanel({ request }: { request: TenderRequest }) {
  const [board, setBoard] = useState<TenderOpenBoard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const payload = await loadTenderOpenBoard(request);
        if (active) setBoard(payload);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { active = false; };
  }, [request]);

  if (error) return <div className="error" role="alert">Tablero de procesos abiertos: {error}</div>;
  if (!board) return null;
  const { summary } = board;
  if (!summary.procesos) return null;

  return <details className="card stack tender-company-bridge">
    <summary>
      <strong>Procesos abiertos en conjunto</strong>{' '}
      <span className="muted">
        {summary.procesos} con cierre por delante
        {summary.tramites_compartidos > 0 && ` · ${summary.tramites_compartidos} trámite${summary.tramites_compartidos === 1 ? '' : 's'} que sirve${summary.tramites_compartidos === 1 ? '' : 'n'} para varias`}
        {summary.documentos_que_vencen > 0 && ` · ${summary.documentos_que_vencen} documento${summary.documentos_que_vencen === 1 ? '' : 's'} que no llega${summary.documentos_que_vencen === 1 ? '' : 'n'} al cierre`}
        {summary.garantias_simultaneas > 0 && ' · garantías de seriedad casi simultáneas'}
      </span>
    </summary>

    {board.por_proceso.clusters.length > 0 && <section className="stack">
      <h4>Lo que se pide una vez por proceso</h4>
      <ul className="tender-company-bridge-rows">
        {board.por_proceso.clusters.map(cluster => <li key={cluster.processes.join('|')} className="tender-company-bridge-row"><p>{cluster.note}</p></li>)}
      </ul>
    </section>}

    {board.tramites.length > 0 && <section className="stack">
      <h4>Trámites por hacer, y para cuántas licitaciones sirven</h4>
      <ul className="tender-company-bridge-rows">
        {board.tramites.map(item => <li key={item.key} className="tender-company-bridge-row">
          <div className="tender-card-tags">
            <span className="badge badge-muted">{item.owner}</span>
            <span className="badge tender-fit-por_validar">{item.processes.length} {item.processes.length === 1 ? 'licitación' : 'licitaciones'}</span>
          </div>
          <strong>{item.label}</strong>
          <p>{item.note}</p>
          <p className="muted">{item.processes.map(process => `${process.ref} (cierre ${date(process.close_date)})`).join(' · ')}</p>
        </li>)}
      </ul>
    </section>}

    {board.vencimientos.length > 0 && <section className="stack">
      <h4>Lo que vence antes de un cierre</h4>
      <ul className="tender-company-bridge-rows">
        {board.vencimientos.map(item => <li key={item.key} className="tender-company-bridge-row">
          <div className="tender-card-tags"><span className="badge badge-muted">{item.owner}</span>{item.already_expired && <span className="badge tender-fit-bajo">Vencido</span>}</div>
          <p>{item.note}</p>
        </li>)}
      </ul>
    </section>}

    <p className="muted">
      {summary.sin_analisis > 0 && `${summary.sin_analisis} proceso${summary.sin_analisis === 1 ? '' : 's'} sin análisis terminado: para esos se cruza todo el catálogo de la empresa, no lo que pide su pliego. `}
      {board.without_access > 0 && `${board.without_access} proceso${board.without_access === 1 ? '' : 's'} que su usuario no puede ver no entra${board.without_access === 1 ? '' : 'n'}. `}
      La antigüedad que exige cada pliego se revisa en su requisito: aquí no se adivina.
    </p>
  </details>;
}
