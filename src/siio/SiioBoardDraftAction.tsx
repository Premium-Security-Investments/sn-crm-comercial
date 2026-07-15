import { useEffect, useRef, type KeyboardEvent } from 'react';
import { sourceFreshness } from './selectors';
import { Badge, EmptyState, fmtSiioMoney } from './SiioUi';
import type { SiioBootstrapPayload, SiioRecommendation, SiioTrackingItem } from './types';
import type { deriveSiioExecutiveSnapshot } from '../siioExecutive';

type ExecutiveSnapshot = ReturnType<typeof deriveSiioExecutiveSnapshot>;

type SiioBoardDraftActionProps = {
  open: boolean;
  onClose: () => void;
  payload: SiioBootstrapPayload;
  snapshot: ExecutiveSnapshot;
  trackingItems: SiioTrackingItem[];
  recommendations: SiioRecommendation[];
};

function formatPeriod(period: string | null | undefined) {
  return period
    ? new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}T12:00:00Z`))
    : 'Sin datos publicados';
}

function validationLabel(status: ExecutiveSnapshot['financialValidationStatus']) {
  if (status === 'validado') return 'Validado por Finanzas';
  if (status === 'sin_datos') return 'Sin datos publicados';
  return 'Pendiente de validación financiera';
}

function sourceNameById(sources: SiioBootstrapPayload['sources'], sourceId: string) {
  return sources.find(source => source.id === sourceId)?.name || 'Pendiente de evidencia';
}

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter(element => !element.hasAttribute('hidden'));
}

export function SiioBoardDraftAction({ open, onClose, payload, snapshot, trackingItems, recommendations }: SiioBoardDraftActionProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previouslyFocusedElement.current?.focus();
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const elements = focusableElements(dialogRef.current);
    if (!elements.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const groupedTracking = ['decisiones', 'bloqueos', 'riesgos', 'compromisos'].map(kind => ({
    kind,
    items: trackingItems.filter(item => item.kind === kind),
  }));

  return <div className="siio-board-backdrop" onMouseDown={onClose}>
    <section
      ref={dialogRef}
      className="siio-board-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="siio-board-title"
      onMouseDown={event => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <header className="siio-board-header">
        <div><span className="eyebrow">SIIO · Borrador de Junta</span><h2 id="siio-board-title">Preparar informe de Junta</h2></div>
        <button type="button" className="secondary" aria-label="Cerrar borrador de Junta" onClick={onClose}>Cerrar</button>
      </header>
      <div className="notice"><strong>Borrador sujeto a revisión humana</strong><br />Consulta local de información ya cargada; no publica, aprueba, crea fuentes ni ejecuta decisiones.</div>

      <section className="panel">
        <h3>Estado financiero y nómina agregada</h3>
        <div className="siio-insight-detail">
          <div><strong>Periodo financiero</strong><span>{formatPeriod(snapshot.financialPeriod)}</span></div>
          <div><strong>Validación financiera</strong><span>{validationLabel(snapshot.financialValidationStatus)}</span></div>
          <div><strong>Periodo de nómina</strong><span>{formatPeriod(snapshot.payrollPeriod)}</span></div>
          <div><strong>Personas agregadas</strong><span>{snapshot.payrollTotals.totalPeople}</span></div>
          <div><strong>Devengado agregado</strong><span>{fmtSiioMoney(snapshot.payrollTotals.totalAccrued)}</span></div>
          <div><strong>Deducciones agregadas</strong><span>{fmtSiioMoney(snapshot.payrollTotals.totalDeductions)}</span></div>
          <div><strong>Neto total</strong><span>{fmtSiioMoney(snapshot.payrollTotals.netTotal)}</span></div>
          <div><strong>Alertas de nómina agregadas</strong><span>{snapshot.payrollTotals.alerts}</span></div>
        </div>
        {!snapshot.financialRows.length ? <EmptyState title="Sin métricas financieras publicadas" text="No hay indicadores cargados para el último periodo." /> : <div className="siio-table-wrap"><table><thead><tr><th>Indicador</th><th>Valor</th><th>Periodo</th></tr></thead><tbody>{snapshot.financialRows.map(row => <tr key={row.concept}><td>{row.concept}</td><td>{row.category === 'margen' ? new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 }).format(Number(row.value_current || 0)) : fmtSiioMoney(row.value_current)}</td><td>{formatPeriod(row.period_month)}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="panel">
        <h3>Prioridades, decisiones, riesgos y compromisos</h3>
        {groupedTracking.every(group => !group.items.length) ? <EmptyState title="Sin asuntos de seguimiento" text="No hay decisiones, bloqueos, riesgos ni compromisos cargados." /> : groupedTracking.map(group => group.items.length ? <article key={group.kind} className="siio-board-group"><h4>{group.kind}</h4><ul>{group.items.map(item => <li key={item.id}><strong>{item.title}</strong> · {item.status} · {item.owner || 'Responsable pendiente'}{item.nextAction ? ` · Próxima acción: ${item.nextAction}` : ''}</li>)}</ul></article> : null)}
      </section>

      <section className="panel">
        <h3>Recomendaciones y evidencia</h3>
        {!recommendations.length ? <EmptyState title="Sin recomendaciones" text="No hay recomendaciones derivadas de la información cargada." /> : <div className="siio-insight-list">{recommendations.map(recommendation => <article key={recommendation.id} className={`siio-insight siio-insight-${recommendation.tone}`}><strong>{recommendation.title}</strong><p>{recommendation.finding}</p><div className="siio-insight-detail"><div><strong>Evidencia</strong><span>{recommendation.evidence || 'Pendiente de evidencia'}</span></div><div><strong>Fuente</strong><span>{recommendation.sourceIds.map(sourceId => sourceId === 'Pendiente de evidencia' ? sourceId : `${sourceNameById(payload.sources, sourceId)} (${sourceId})`).join(', ')}</span></div><div><strong>Periodo</strong><span>{formatPeriod(recommendation.period)}</span></div><div><strong>Prioridad</strong><span>{recommendation.priority}</span></div><div><strong>Acción recomendada</strong><span>{recommendation.action}</span></div></div></article>)}</div>}
      </section>

      <section className="panel">
        <h3>Fuentes, vigencia y restricciones</h3>
        {!payload.sources.length ? <EmptyState title="Sin fuentes cargadas" text="No hay fuentes autorizadas disponibles para este borrador." /> : <div className="siio-insight-list">{payload.sources.map(source => <article key={source.id} className="siio-insight"><strong>{source.name}</strong><div className="siio-insight-detail"><div><strong>Vigencia</strong><span><Badge tone={sourceFreshness(source) === 'vencida' ? 'danger' : sourceFreshness(source) === 'próxima_a_vencer' ? 'amber' : 'green'}>{sourceFreshness(source)}</Badge></span></div><div><strong>Restricciones</strong><span>{source.restrictions || 'Sin restricciones registradas'}</span></div><div><strong>Estado</strong><span>{source.status || 'Pendiente'}</span></div></div></article>)}</div>}
      </section>

      <section className="panel">
        <h3>Secciones y reportes existentes de Junta</h3>
        {!payload.boardSections.length ? <EmptyState title="Sin secciones configuradas" text="No hay secciones de Junta cargadas." /> : <ul>{payload.boardSections.map(section => <li key={section.id || section.name}><strong>{section.name}</strong>{section.human_review_required ? ' · Revisión humana obligatoria' : ''}</li>)}</ul>}
        {!payload.boardReports.length ? <EmptyState title="Sin reportes existentes" text="No hay reportes de Junta cargados." /> : <ul>{payload.boardReports.map(report => <li key={report.id}><strong>{formatPeriod(report.period_month)}</strong> · {report.status}{report.summary ? ` · ${report.summary}` : ''}</li>)}</ul>}
      </section>

      <footer className="siio-board-footer"><button type="button" onClick={() => window.print()}>Imprimir / exportar borrador</button></footer>
    </section>
  </div>;
}
