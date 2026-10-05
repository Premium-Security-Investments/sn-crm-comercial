import {
  formatInitialReportSource, initialReportClaims, initialReportLabels as labels,
  type Agt002InitialReport, type Agt002InitialReportClaim,
} from '../agt002InitialReportProjection';

function SourcedClaims({ report, ids }: { report: Agt002InitialReport; ids: string[] }) {
  const claims = initialReportClaims(report, ids);
  if (claims.length === 0) return null;
  return <details className="initial-report-support">
    <summary>Ver respaldo ({claims.length})</summary>
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

/** Read-only review report of the first (INITIAL) analysis. It states what was NOT evaluated; it decides nothing. */
export function TenderInitialReport({ report }: { report: Agt002InitialReport }) {
  const { recommendation } = report;
  const openCritical = report.openItems.filter(item => item.critical);
  return <article className="initial-report" aria-label="Reporte del análisis inicial">
    <header className="initial-report-head">
      <small>Reporte del análisis inicial</small>
      <strong>{labels.recommendation(recommendation.kind)}</strong>
      <p>{recommendation.label}</p>
      <small className="initial-report-meta">Confianza {labels.confidence(recommendation.confidence)} · Documentos hasta {formatDate(report.cutoffAt)}</small>
    </header>

    <section className="notice initial-report-limits" role="note" aria-label="Alcance del análisis">
      <strong>Qué no evalúa este análisis</strong>
      <ul>
        {!report.companyFitAuthorized && <li>No hay perfil de empresa autorizado: no valora si la empresa encaja ni cumple.</li>}
        {!report.checksExecuted && <li>No se ejecutó ninguna de las verificaciones de la metodología.</li>}
        {report.processStatus === 'WITHHELD_COVERAGE_GAP' && <li>La cobertura de los documentos es incompleta: la lectura del proceso es parcial.</li>}
        {recommendation.limitations.map((limit, index) => <li key={index}>{limit}</li>)}
      </ul>
      <small>La decisión GO/NO-GO continúa siendo exclusivamente humana.</small>
    </section>

    {report.deadlines.length > 0 && <section aria-label="Plazos">
      <h4>Plazos</h4>
      <ul>{report.deadlines.map(deadline => <li key={deadline.kind}>
        <strong>{labels.deadlineKind(deadline.kind)}:</strong> {deadline.value ? formatDate(deadline.value) : 'sin fecha en los documentos'}
        <small className="initial-report-meta"> · {labels.certainty(deadline.certainty)}</small>
      </li>)}</ul>
    </section>}

    <section aria-label="Cobertura">
      <h4>Cobertura de los documentos</h4>
      <ul>{report.coverage.map(entry => <li key={entry.block}>
        <strong>{labels.coverageBlock(entry.block)}:</strong> {labels.coverageStatus(entry.status)}{entry.critical ? ' (crítico)' : ''}
        {entry.gapReason && <small className="initial-report-meta"> · {entry.gapReason}</small>}
      </li>)}</ul>
    </section>

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
        return <li key={requirement.id}>
          <strong>{labels.requirementCategory(requirement.category)}</strong>
          {requirement.blocker && <span className="initial-report-chip severity-blocker">Impedimento</span>}
          <span>: {text?.text ?? requirement.textClaimId}</span>
          <small className="initial-report-meta"> · Evaluación de la empresa: {labels.companyEvaluation(requirement.companyEvaluation)}</small>
          {requirement.requiredAction && <p>Acción requerida: {requirement.requiredAction}</p>}
        </li>;
      })}</ul>}
    </section>

    <section aria-label="Pendientes">
      <h4>Pendientes ({report.openItems.length}{openCritical.length ? `, ${openCritical.length} críticos` : ''})</h4>
      {report.openItems.length === 0 ? <p>Sin pendientes registrados.</p> : <ul>{report.openItems.map(item => <li key={item.id}>
        <strong>{labels.openItemKind(item.kind)}{item.critical ? ' · crítico' : ''}:</strong> {item.description}
      </li>)}</ul>}
    </section>

    {report.contradictions.length > 0 && <section aria-label="Contradicciones">
      <h4>Contradicciones en los documentos ({report.contradictions.length})</h4>
      <ul>{report.contradictions.map(item => <li key={item.id}>
        <strong>{item.topic}</strong>
        <small className="initial-report-meta"> · Afecta: {labels.contradictionImpact(item.impact)}</small>
        {item.requiredAction && <p>Acción requerida: {item.requiredAction}</p>}
        <SourcedClaims report={report} ids={item.claimIds} />
      </li>)}</ul>
    </section>}

    <details className="initial-report-all-claims">
      <summary>Todas las afirmaciones y sus fuentes ({report.claims.length})</summary>
      <ul>{report.claims.map(claim => <ClaimItem key={claim.id} claim={claim} />)}</ul>
    </details>

    <footer className="initial-report-foot">
      <small>Documentos analizados ({report.documents.length}): {report.documents.map(document => document.name ?? 'Documento sin nombre').join('; ')}</small>
    </footer>
  </article>;
}
