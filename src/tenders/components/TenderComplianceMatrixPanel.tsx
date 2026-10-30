import { useEffect, useMemo, useState } from 'react';
import './tender-dossier.css';
import { tenderComplianceMatrixCsv } from '../../../verticales/licitaciones/tender-compliance-matrix.js';
import { loadTenderComplianceMatrix } from '../api';
import type { TenderComplianceMatrix, TenderComplianceRow, TenderRequest } from '../types';

/**
 * La matriz de cumplimiento (punto 2 del encargo del 2026-10-30): una fila por requisito del pliego, con qué se
 * acredita, si eso sirve el día del cierre y quién responde. Es a la vez lo que la entidad pide y el tablero de la
 * encargada.
 *
 * Qué NO hace: no reevalúa el requisito —el estado es el que dio el análisis— y no afirma que un documento lo
 * acredita. El cruce con la ficha de empresa es por palabras, así que lo que muestra es un soporte **relacionado**
 * que una persona confirma. La descarga en CSV es la misma matriz, para radicarla o trabajarla en Excel.
 */
const STATUS_LABEL: Record<TenderComplianceRow['status'], string> = {
  falta: 'Falta',
  por_confirmar: 'Por confirmar',
  declarado: 'Cumple, falta el soporte',
  cumple: 'Cumple',
  no_aplica: 'No aplica',
};

const SUPPORT_STATE_LABEL: Record<string, string> = {
  listo_al_cierre: 'vigente al cierre',
  vence_antes_del_cierre: 'vence antes del cierre',
  vencido: 'vencido',
  sin_archivo: 'falta el soporte',
  vigencia_por_confirmar: 'vigencia por confirmar',
  sin_fecha_de_cierre: 'sin fecha de cierre',
};

/** Orden de lectura: primero lo que rechaza la oferta, después lo abierto, al final lo resuelto. */
function sortRows(rows: TenderComplianceRow[]): TenderComplianceRow[] {
  const weight = (row: TenderComplianceRow) => {
    if (row.rejection) return 0;
    if (row.status === 'falta') return 1;
    if (row.support_pending.length) return 2;
    if (row.status === 'por_confirmar') return 3;
    if (row.status === 'declarado') return 4;
    return 5;
  };
  return [...rows].sort((left, right) => weight(left) - weight(right) || left.area.localeCompare(right.area, 'es') || left.title.localeCompare(right.title, 'es'));
}

function downloadCsv(matrix: TenderComplianceMatrix) {
  const csv = tenderComplianceMatrixCsv(matrix.headers, matrix.table);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Matriz_Cumplimiento_${(matrix.tender_ref || matrix.opportunity_id).replace(/[^\w.-]+/g, '_')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function TenderComplianceMatrixPanel({ opportunityId, request }: { opportunityId: string; request: TenderRequest }) {
  const [matrix, setMatrix] = useState<TenderComplianceMatrix | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setMatrix(null);
    void (async () => {
      try {
        const payload = await loadTenderComplianceMatrix(request, opportunityId);
        if (active) setMatrix(payload);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [opportunityId, request]);

  const rows = useMemo(() => sortRows(matrix?.rows || []), [matrix]);

  if (loading) return <section className="card stack" aria-busy="true"><p className="muted">Armando la matriz de cumplimiento…</p></section>;
  if (error) return <section className="card stack"><div className="error" role="alert">{error}</div></section>;
  if (!matrix) return null;
  if (!matrix.available) {
    return <section className="card stack"><h3>Matriz de cumplimiento</h3><p className="muted">La matriz sale de los requisitos del análisis, y esta licitación todavía no tiene un análisis terminado.</p></section>;
  }

  const summary = matrix.summary;
  return <section className="card stack tender-company-bridge" aria-labelledby="tender-compliance-matrix-heading">
    <div className="tender-dossier-section-head">
      <div>
        <h3 id="tender-compliance-matrix-heading">Matriz de cumplimiento</h3>
        <p className="muted">Un requisito del pliego por fila, con qué se acredita y si eso sirve el día del cierre. El soporte corporativo es el que se le parece; confírmelo antes de radicar.</p>
      </div>
      <button type="button" className="secondary" onClick={() => downloadCsv(matrix)}>Descargar la matriz (CSV)</button>
    </div>
    {summary && <div className="tender-card-tags">
      <span className="badge badge-muted">{summary.total} requisitos</span>
      {summary.causas_de_rechazo > 0 && <span className="badge tender-fit-bajo">{summary.causas_de_rechazo} causan rechazo</span>}
      {summary.requisitos_abiertos > 0 && <span className="badge tender-fit-por_validar">{summary.requisitos_abiertos} abiertos</span>}
      {summary.soporte_corporativo_pendiente > 0 && <span className="badge tender-fit-bajo">{summary.soporte_corporativo_pendiente} con soporte pendiente</span>}
      <span className="badge badge-muted">{summary.especificos_del_proceso} con soporte propio del proceso</span>
    </div>}
    <ul className="stack tender-company-bridge-rows">
      {rows.map(row => <li key={row.key} className="tender-company-bridge-row">
        <div className="tender-card-tags">
          <span className="badge badge-muted">{row.area}</span>
          <span className={`badge ${row.status === 'falta' ? 'tender-fit-bajo' : row.status === 'cumple' ? 'tender-fit-alto' : 'tender-fit-por_validar'}`}>{STATUS_LABEL[row.status]}</span>
          {row.rejection && <span className="badge tender-fit-bajo">Causa rechazo</span>}
        </div>
        <strong>{row.title}</strong>
        {row.demand && <p className="muted">{row.demand}</p>}
        {row.sources.length > 0 && <p className="muted">Lo pide: {row.sources.map(source => [source.document_name, source.locator].filter(Boolean).join(' · ')).join('; ')}</p>}
        <p className="muted">
          {row.company_support.length
            ? <>Se acredita con: {row.company_support.map(item => `${item.label} (${SUPPORT_STATE_LABEL[item.state || ''] || 'sin dato'})`).join('; ')}</>
            : <>El soporte de este requisito se produce para este proceso.</>}
        </p>
        {row.actions.length > 0 && <p><strong>Qué hacer:</strong> {row.actions.join(' ')}</p>}
        <p className="muted">Responsable: {[row.owner, ...row.support_owners.filter(owner => owner !== row.owner)].join(' / ')}</p>
      </li>)}
    </ul>
  </section>;
}
