import {
  formatInitialReportSource, initialReportAlerts, initialReportAxes, initialReportClaims, initialReportCompanyFit,
  initialReportLabels as labels, initialReportTasks, initialReportVerdict,
  type Agt002InitialReport, type Agt002InitialReportClaim,
} from '../agt002InitialReportProjection';

function SourcedClaims({ report, ids }: { report: Agt002InitialReport; ids: string[] }) {
  const claims = initialReportClaims(report, ids);
  if (claims.length === 0) return null;
  return <details className="initial-report-support">
    <summary>Ver fuente ({claims.length})</summary>
    <ul>{claims.map(claim => <ClaimItem key={claim.id} claim={claim} />)}</ul>
  </details>;
}

function ClaimItem({ claim }: { claim: Agt002InitialReportClaim }) {
  return <li>
    <span>{claim.text}</span>
    <small className="initial-report-meta"> · {labels.evidenceStatus(claim.evidenceStatus)}</small>
    {claim.inferenceBasis && <small className="initial-report-meta"> · Base de la inferencia: {claim.inferenceBasis}</small>}
    {claim.sources.length > 0 && <ul className="initial-report-sources">
      {claim.sources.map((source, index) => <li key={`${source.documentId}-${index}`}><small>{formatInitialReportSource(source)}</small></li>)}
    </ul>}
  </li>;
}

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha';
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(time.getTime()) ? null : time.toLocaleDateString('es-CO', { dateStyle: 'medium' });
}

// The model's own limitations often restate what the server already states (no company profile, the decision is human).
const REDUNDANT_LIMITATION = /perfil de (la )?empresa|go\s*\/\s*no[- ]?go|decisi[oó]n (humana|.*no se toma)/i;

/** One deduplicated "scope" line: what this analysis did not evaluate. It closes the report; it does not open it. */
export function initialReportScope(report: Agt002InitialReport): string[] {
  const scope: string[] = [];
  if (!report.companyFitAuthorized) scope.push('sin perfil de empresa: no evalúa si la empresa cumple');
  if (!report.checksExecuted) scope.push('sin las verificaciones de la metodología');
  if (report.processStatus === 'WITHHELD_COVERAGE_GAP') scope.push('documentos con cobertura parcial');
  for (const limit of report.recommendation.limitations) {
    if (!REDUNDANT_LIMITATION.test(limit)) scope.push(limit.replace(/\.$/, ''));
  }
  return [...new Set(scope)];
}

/**
 * Read-only review report of the first (INITIAL) analysis, ordered for a decision: verdict, what blocks it, requirements,
 * what is missing, contradictions, dates and coverage; detail folded; the scope in one line at the end. It decides nothing.
 */
export function TenderInitialReport({ report, officialCloseDate = null }: { report: Agt002InitialReport; officialCloseDate?: string | null }) {
  const { recommendation } = report;
  const openCritical = report.openItems.filter(item => item.critical);
  const officialClose = formatDay(officialCloseDate);
  const scope = initialReportScope(report);
  const verdict = initialReportVerdict(recommendation.kind);
  const axes = initialReportAxes(report);
  const tasks = initialReportTasks(report);
  const alerts = initialReportAlerts(report);
  const datedDeadlines = report.deadlines.filter(deadline => deadline.value);
  const LIGHT_LABEL = { cumple: 'Cumple', por_confirmar: 'Por confirmar', no_cumple: 'No cumple', sin_datos: 'Sin datos' } as const;
  return <article className="initial-report" aria-label="Reporte del análisis inicial">
    <header className={`initial-report-verdict tone-${verdict.tone}`}>
      <small>Análisis inicial · para decidir</small>
      <strong>{verdict.label}</strong>
      <p>{recommendation.label}</p>
      <div className="initial-report-verdict-meta">
        <span><b>Empresa:</b> {initialReportCompanyFit(report)}</span>
        <span><b>Confianza:</b> {labels.confidence(recommendation.confidence)}</span>
        {officialClose && <span><b>Cierre:</b> {officialClose}</span>}
      </div>
    </header>

    <section aria-label="Cinco ejes" className="initial-report-axes">
      {axes.map(axis => <div key={axis.key} className={`initial-report-axis light-${axis.light}`}>
        <small>{axis.label}</small>
        <strong>{LIGHT_LABEL[axis.light]}</strong>
        <span>{axis.total === 0 ? 'Sin requisitos identificados' : `${axis.total} requisito(s)${axis.blockers ? ` · ${axis.blockers} impide(n)` : ''}${axis.pending ? ` · ${axis.pending} por confirmar` : ''}`}</span>
      </div>)}
    </section>

    <section aria-label="Qué hay que hacer">
      <h4>Qué hay que hacer</h4>
      {tasks.length === 0 ? <p>Sin tareas pendientes registradas.</p> : <ol>{tasks.map((task, index) => <li key={index}>
        {task.critical && <span className="initial-report-chip severity-blocker">Crítico</span>}
        <span>{task.text}</span>
        {(task.owner || task.dueAt) && <small className="initial-report-meta"> · {[task.owner, task.dueAt ? formatDate(task.dueAt) : null].filter(Boolean).join(' · ')}</small>}
      </li>)}</ol>}
    </section>

    <div className="initial-report-twin">
      <section aria-label="Alertas">
        <h4>Alertas</h4>
        {alerts.length === 0 ? <p>Sin alertas.</p> : <ul>{alerts.map(finding => <li key={finding.id}>
          <span className={`initial-report-chip severity-${finding.severity.toLowerCase()}`}>{labels.severity(finding.severity)}</span>
          {finding.blocker && <span className="initial-report-chip severity-blocker">Impedimento</span>}
          <strong> {finding.title}</strong>
        </li>)}</ul>}
      </section>
      <section aria-label="Fechas clave">
        <h4>Fechas clave</h4>
        <ul>
          {officialClose && <li><strong>Cierre oficial (CRM):</strong> {officialClose}</li>}
          {datedDeadlines.map(deadline => <li key={deadline.kind}><strong>{labels.deadlineKind(deadline.kind)}:</strong> {formatDate(deadline.value)} <small className="initial-report-meta">· {labels.certainty(deadline.certainty)}</small></li>)}
          {!officialClose && datedDeadlines.length === 0 && <li>Las fechas no aparecen en los documentos analizados.</li>}
        </ul>
      </section>
    </div>

    <details className="initial-report-all-claims initial-report-detail">
      <summary>Ver el análisis completo: hallazgos, requisitos, pendientes, contradicciones y fuentes</summary>
    <section aria-label="Hallazgos">
      <h4>Hallazgos ({report.findings.length})</h4>
      {report.findings.length === 0 ? <p>Sin hallazgos registrados.</p> : <ul>{report.findings.map(finding => <li key={finding.id}>
        <span className={`initial-report-chip severity-${finding.severity.toLowerCase()}`}>{labels.severity(finding.severity)}</span>
        {finding.blocker && <span className="initial-report-chip severity-blocker">Impedimento</span>}
        <strong> {finding.title}</strong>
        <p>{finding.impact}</p>
        <SourcedClaims report={report} ids={finding.claimIds} />
      </li>)}</ul>}
    </section>

    <section aria-label="Requisitos">
      <h4>Requisitos ({report.requirements.length})</h4>
      {report.requirements.length === 0 ? <p>Sin requisitos registrados.</p> : <ul>{report.requirements.map(requirement => {
        const text = initialReportClaims(report, [requirement.textClaimId])[0];
        const evaluated = requirement.companyEvaluation && requirement.companyEvaluation !== 'NOT_EVALUATED';
        return <li key={requirement.id}>
          <strong>{labels.requirementCategory(requirement.category)}</strong>
          {requirement.blocker && <span className="initial-report-chip severity-blocker">Impedimento</span>}
          <span>: {text?.text ?? requirement.textClaimId}</span>
          {evaluated && <small className="initial-report-meta"> · Empresa: {labels.companyEvaluation(requirement.companyEvaluation)}</small>}
          {requirement.requiredAction && <p>Qué hacer: {requirement.requiredAction}</p>}
        </li>;
      })}</ul>}
    </section>

    <section aria-label="Pendientes">
      <h4>Qué falta ({report.openItems.length}{openCritical.length ? `, ${openCritical.length} críticos` : ''})</h4>
      {report.openItems.length === 0 ? <p>Sin pendientes registrados.</p> : <ul>{report.openItems.map(item => <li key={item.id}>
        <strong>{labels.openItemKind(item.kind)}{item.critical ? ' · crítico' : ''}:</strong> {item.description}
      </li>)}</ul>}
    </section>

    {report.contradictions.length > 0 && <section aria-label="Contradicciones">
      <h4>Contradicciones en los documentos ({report.contradictions.length})</h4>
      <ul>{report.contradictions.map(item => <li key={item.id}>
        <strong>{item.topic}</strong>
        <small className="initial-report-meta"> · Afecta: {labels.contradictionImpact(item.impact)}</small>
        {item.requiredAction && <p>Qué hacer: {item.requiredAction}</p>}
        <SourcedClaims report={report} ids={item.claimIds} />
      </li>)}</ul>
    </section>}


    <details className="initial-report-all-claims">
      <summary>Ver detalle: cobertura, afirmaciones y fuentes ({report.claims.length})</summary>
      <section aria-label="Cobertura">
        <h4>Cobertura de los documentos</h4>
        <ul>{report.coverage.map(entry => <li key={entry.block}>
          <strong>{labels.coverageBlock(entry.block)}:</strong> {labels.coverageStatus(entry.status)}{entry.critical ? ' (crítico)' : ''}
          {entry.gapReason && <small className="initial-report-meta"> · {entry.gapReason}</small>}
        </li>)}</ul>
      </section>
      <h4>Afirmaciones y fuentes</h4>
      <ul>{report.claims.map(claim => <ClaimItem key={claim.id} claim={claim} />)}</ul>
      <small>Documentos analizados ({report.documents.length}): {report.documents.map(document => document.name ?? 'Documento sin nombre').join('; ')}</small>
    </details>

    </details>

    <footer className="initial-report-foot">
      <small>{scope.length > 0 && <>Alcance: {scope.join(' · ')}. </>}Análisis generado por IA, no vinculante: la decisión GO/NO-GO es humana.</small>
    </footer>
  </article>;
}
