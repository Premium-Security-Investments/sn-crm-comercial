import {
  initialReportAxes, initialReportCompanyFit, initialReportLabels as labels, initialReportVerdict, type Agt002InitialReport,
} from '../agt002InitialReportProjection';

const LIGHT_LABEL = { cumple: 'Cumple', por_confirmar: 'Por confirmar', no_cumple: 'No cumple', sin_datos: 'Sin datos' } as const;

/** Decision tab header: the INITIAL verdict, the company fit, the five axes and what blocks it. */
export function TenderInitialDecisionSummary({ report }: { report: Agt002InitialReport }) {
  const verdict = initialReportVerdict(report.recommendation.kind);
  const blockers = report.findings.filter(finding => finding.blocker || finding.severity === 'CRITICAL').slice(0, 3);
  return <section className="initial-decision-summary" aria-label="Resultado del análisis inicial">
    <small>Resultado del análisis inicial</small>
    <strong>{verdict.label}</strong>
    <p>{report.recommendation.label}</p>
    <p><b>Empresa:</b> {initialReportCompanyFit(report)} · <b>Confianza:</b> {labels.confidence(report.recommendation.confidence)}</p>
    <ul className="initial-decision-axes">{initialReportAxes(report).map(axis => <li key={axis.key} className={`light-${axis.light}`}><b>{axis.label}:</b> {LIGHT_LABEL[axis.light]}</li>)}</ul>
    {blockers.length > 0 && <div>
      <h4>Lo que hoy impide avanzar</h4>
      <ul>{blockers.map(finding => <li key={finding.id}>{finding.title}</li>)}</ul>
    </div>}
    <small className="initial-report-meta"><a href="#tender-analysis">Ver el análisis completo</a></small>
  </section>;
}
