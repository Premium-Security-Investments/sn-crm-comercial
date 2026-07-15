import { useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { SIIO_AGENT_CATALOG } from '../siioAgents';
import { createBoardDraftGovernance, focusTrapTargetIndex } from './boardDraftPolicy';
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const governance = createBoardDraftGovernance(SIIO_AGENT_CATALOG, { sources: payload.sources, recommendations, trackingItems });

  useEffect(() => {
    if (!open) return;
    previouslyFocusedElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
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
    const targetIndex = focusTrapTargetIndex(elements.length, elements.indexOf(document.activeElement as HTMLElement), event.shiftKey);
    if (targetIndex !== null) {
      event.preventDefault();
      elements[targetIndex].focus();
    }
  };

  const groupedTracking = ['decisiones', 'bloqueos', 'riesgos', 'compromisos'].map(kind => ({
    kind,
    items: governance.eligibleTrackingItems.filter(item => item.kind === kind),
  }));
  const excludedItems = [...governance.excludedRecommendations, ...governance.excludedTrackingItems];

  return createPortal(<div className="siio-board-backdrop" onMouseDown={onClose}>
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
        <button ref={closeButtonRef} type="button" className="secondary" aria-label="Cerrar borrador de Junta" onClick={onClose}>Cerrar</button>
      </header>
      <div className="notice"><strong>Borrador sujeto a revisión humana</strong><br />Consulta local de información ya cargada; no publica, aprueba, crea fuentes ni ejecuta decisiones.</div>
      <div className="notice siio-board-governance"><strong>{governance.agent.id} · {governance.agent.name}</strong><br />Evidencia elegible únicamente desde fuentes autorizadas cargadas: {governance.authorizedSourceIds.join(', ')}. {governance.agent.audit_rule}</div>

      <section className="panel">
        <h3>Estado financiero y nómina agregada</h3>
        <p className="siio-board-policy-note">Lectura agregada local: no se marca como evidencia elegible hasta que la fuente de Junta quede vinculada y autorizada.</p>
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
        {!snapshot.financialRows.length ? <EmptyState title="Sin métricas financieras publicadas" text="No hay indicadores cargados para el periodo financiero seleccionado." /> : <div className="siio-table-wrap"><table><thead><tr><th>Indicador</th><th>Valor</th><th>Periodo</th></tr></thead><tbody>{snapshot.financialRows.map(row => <tr key={row.concept}><td>{row.concept}</td><td>{row.category === 'margen' ? new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 }).format(Number(row.value_current || 0)) : fmtSiioMoney(row.value_current)}</td><td>{formatPeriod(row.period_month)}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="panel">
        <h3>Prioridades, decisiones, riesgos y compromisos elegibles</h3>
        {groupedTracking.every(group => !group.items.length) ? <EmptyState title="Sin asuntos de seguimiento con fuente autorizada" text="Los asuntos sin fuente vinculada o con fuentes fuera de AGT-001 quedan excluidos como evidencia de Junta." /> : groupedTracking.map(group => group.items.length ? <article key={group.kind} className="siio-board-group"><h4>{group.kind}</h4><ul>{group.items.map(item => <li key={item.id}><strong>{item.title}</strong> · {item.status} · {item.owner || 'Responsable pendiente'}{item.nextAction ? ` · Próxima acción: ${item.nextAction}` : ''}</li>)}</ul></article> : null)}
      </section>

      <section className="panel">
        <h3>Recomendaciones y evidencia elegible</h3>
        {!governance.eligibleRecommendations.length ? <EmptyState title="Sin recomendaciones con evidencia autorizada" text="No hay recomendaciones derivadas de fuentes autorizadas y cargadas." /> : <div className="siio-insight-list">{governance.eligibleRecommendations.map(recommendation => <article key={recommendation.id} className={`siio-insight siio-insight-${recommendation.tone}`}><strong>{recommendation.title}</strong><p>{recommendation.finding}</p><div className="siio-insight-detail"><div><strong>Evidencia</strong><span>{recommendation.evidence || 'Pendiente de evidencia'}</span></div><div><strong>Fuente</strong><span>{recommendation.sourceIds.map(sourceId => `${sourceNameById(governance.eligibleSources, sourceId)} (${sourceId})`).join(', ')}</span></div><div><strong>Periodo</strong><span>{formatPeriod(recommendation.period)}</span></div><div><strong>Prioridad</strong><span>{recommendation.priority}</span></div><div><strong>Acción recomendada</strong><span>{recommendation.action}</span></div></div></article>)}</div>}
      </section>

      <section className="panel">
        <h3>Fuentes autorizadas, vigencia y restricciones</h3>
        {!governance.eligibleSources.length ? <EmptyState title="Sin fuentes autorizadas cargadas" text="No hay fuentes de AGT-001 disponibles para este borrador." /> : <div className="siio-insight-list">{governance.eligibleSources.map(source => <article key={source.id} className="siio-insight"><strong>{source.name}</strong><div className="siio-insight-detail"><div><strong>Vigencia</strong><span><Badge tone={sourceFreshness(source) === 'vencida' ? 'danger' : sourceFreshness(source) === 'próxima_a_vencer' ? 'amber' : 'green'}>{sourceFreshness(source)}</Badge></span></div><div><strong>Restricciones</strong><span>{source.restrictions || 'Sin restricciones registradas'}</span></div><div><strong>Estado</strong><span>{source.status || 'Pendiente'}</span></div></div></article>)}</div>}
      </section>

      {(governance.excludedSources.length || excludedItems.length) ? <section className="panel siio-board-excluded" aria-label="Contenido excluido por política de fuentes">
        <h3>Contenido excluido por política de fuentes</h3>
        <p>Se mantiene visible para trazabilidad, pero no se presenta como evidencia válida ni se incorpora a recomendaciones elegibles.</p>
        {governance.excludedSources.length ? <ul>{governance.excludedSources.map(source => <li key={source.id}><strong>{source.name} ({source.id})</strong> · Fuente no autorizada para {governance.agent.id}.</li>)}</ul> : null}
        {excludedItems.length ? <ul>{excludedItems.map(item => <li key={`${item.id}:${item.exclusionReason}`}><strong>{item.title}</strong> · {item.exclusionReason}</li>)}</ul> : null}
      </section> : null}

      <section className="panel">
        <h3>Secciones y reportes existentes de Junta</h3>
        {!payload.boardSections.length ? <EmptyState title="Sin secciones configuradas" text="No hay secciones de Junta cargadas." /> : <ul>{payload.boardSections.map(section => <li key={section.id || section.name}><strong>{section.name}</strong>{section.human_review_required ? ' · Revisión humana obligatoria' : ''}</li>)}</ul>}
        {!payload.boardReports.length ? <EmptyState title="Sin reportes existentes" text="No hay reportes de Junta cargados." /> : <ul>{payload.boardReports.map(report => <li key={report.id}><strong>{formatPeriod(report.period_month)}</strong> · {report.status}{report.summary ? ` · ${report.summary}` : ''}</li>)}</ul>}
      </section>

      <footer className="siio-board-footer"><button type="button" onClick={() => window.print()}>Imprimir / exportar borrador</button></footer>
    </section>
  </div>, document.body);
}
