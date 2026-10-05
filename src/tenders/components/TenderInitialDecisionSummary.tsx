import { initialReportLabels as labels, type Agt002InitialReport } from '../agt002InitialReportProjection';

/** Decision tab header: the INITIAL verdict and what blocks it, so the GO / NO GO is recorded looking at the analysis. */
export function TenderInitialDecisionSummary({ report }: { report: Agt002InitialReport }) {
  const blockers = report.findings.filter(finding => finding.blocker || finding.severity === 'CRITICAL').slice(0, 3);
  return <section className="initial-decision-summary" aria-label="Resultado del análisis inicial">
    <small>Resultado del análisis inicial</small>
    <strong>{labels.recommendation(report.recommendation.kind)}</strong>
    <p>{report.recommendation.label}</p>
    {blockers.length > 0 && <div>
      <h4>Lo que hoy impide avanzar</h4>
      <ul>{blockers.map(finding => <li key={finding.id}>{finding.title}</li>)}</ul>
    </div>}
    <small className="initial-report-meta">Confianza {labels.confidence(report.recommendation.confidence)} · <a href="#tender-analysis">Ver el análisis completo</a></small>
  </section>;
}
