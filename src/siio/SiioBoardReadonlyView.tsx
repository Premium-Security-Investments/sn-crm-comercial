import type { SiioBoardReport } from './types';

type Props = {
  payload: { boardReports: SiioBoardReport[] } | null;
  loading: boolean;
  status: string;
  onRetry: () => void;
};

export function SiioBoardReadonlyView({ payload, loading, status, onRetry }: Props) {
  if (!payload) {
    if (!loading) {
      return <section className="stack" aria-live="polite">
        <div className="error">No fue posible cargar los reportes publicados: {status || 'Error de conexión.'}</div>
        <button type="button" onClick={onRetry}>Reintentar carga</button>
      </section>;
    }
    return <section className="stack"><div className="notice">Cargando reportes publicados…</div></section>;
  }

  const reports = payload.boardReports || [];
  return <section className="stack siio-dashboard" aria-label="Reportes publicados para Junta">
    <section className="executive-hero">
      <div>
        <span className="eyebrow">SIIO — Junta</span>
        <h2>Reportes publicados</h2>
        <p>Consulta de solo lectura de los informes aprobados para Junta.</p>
      </div>
    </section>
    {reports.length === 0 ? <div className="notice">No hay informes publicados para consultar.</div> : <section className="stack">
      {reports.map(report => <article className="siio-board-report" key={report.id}>
        <div><small>Período</small><strong>{report.period_month}</strong></div>
        <div><small>Estado</small><strong>{report.status}</strong></div>
        <p>{report.summary || 'Sin resumen disponible.'}</p>
      </article>)}
    </section>}
  </section>;
}
