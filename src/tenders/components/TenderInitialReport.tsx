import {
  cleanInitialReportText, formatInitialReportSource, initialReportAcronyms, initialReportAlerts, initialReportAxes,
  initialReportClaims, initialReportCompanyFit, initialReportFindingNote, initialReportLabels as labels,
  initialReportRecommendationText, initialReportRequirementGroups, initialReportTasks, initialReportVerdict,
  type Agt002InitialReport, type Agt002InitialReportClaim,
} from '../agt002InitialReportProjection';

type Finding = Agt002InitialReport['findings'][number];

/** One finding readable without opening its sources: what is demanded, how the company stands, why, what to do. */
function FindingNote({ report, finding }: { report: Agt002InitialReport; finding: Finding }) {
  const note = initialReportFindingNote(report, finding);
  return <li className="initial-report-note">
    <span className={`initial-report-chip severity-${finding.severity.toLowerCase()}`}>{labels.severity(finding.severity)}</span>
    {finding.blocker && <span className="initial-report-chip severity-blocker">Impedimento</span>}
    <strong> {finding.title}</strong>
    <dl>
      {note.demand.length > 0 && <><dt>Qué exigen</dt><dd>{note.demand.join(' ')}</dd></>}
      {note.company.length > 0 && <><dt>Cómo estamos</dt><dd>{note.company.join(' ')}</dd></>}
      <dt>{note.demand.length > 0 ? 'Por qué importa' : 'Qué pasa'}</dt><dd>{note.impact}</dd>
      {note.actions.length > 0 && <><dt>Qué hacer</dt><dd>{note.actions.join(' ')}</dd></>}
      {note.certainty && <><dt>Qué tan seguro es</dt><dd>{note.certainty}</dd></>}
    </dl>
    <SourcedClaims report={report} ids={finding.claimIds} />
  </li>;
}

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
    <span>{cleanInitialReportText(claim.text)}</span>
    <small className="initial-report-meta"> · {labels.evidenceStatus(claim.evidenceStatus)}</small>
    {claim.inferenceBasis && <small className="initial-report-meta"> · En qué se basa: {cleanInitialReportText(claim.inferenceBasis)}</small>}
    {claim.sources.length > 0 && <ul className="initial-report-sources">
      {claim.sources.map((source, index) => <li key={`${source.documentId}-${index}`}><small>{formatInitialReportSource(source)}</small></li>)}
    </ul>}
  </li>;
}

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  // A deadline stored as a whole day (midnight, or 23:59 for "end of day") is shown as a day, not as an odd hour.
  const wholeDay = !value.includes('T')
    || (time.getHours() === 0 && time.getMinutes() === 0) || (time.getHours() === 23 && time.getMinutes() === 59);
  return wholeDay
    ? time.toLocaleDateString('es-CO', { dateStyle: 'medium' })
    : time.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
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
  if (!report.checksExecuted) scope.push('todavía sin la revisión punto por punto de la metodología');
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
  // Each topic is told once: the folded detail lists only what the top of the report did not already show.
  const alertIds = new Set(alerts.map(finding => finding.id));
  const otherFindings = report.findings.filter(finding => !alertIds.has(finding.id));
  const taskTexts = new Set(tasks.map(task => task.text));
  const otherOpenItems = report.openItems.filter(item => !taskTexts.has(cleanInitialReportText(item.description)));
  const requirementGroups = initialReportRequirementGroups(report);
  const acronyms = initialReportAcronyms(alerts.flatMap(finding => {
    const note = initialReportFindingNote(report, finding);
    return [finding.title, ...note.demand, ...note.company, note.impact, ...note.actions];
  }));
  return <article className="initial-report" aria-label="Reporte del análisis inicial">
    <header className={`initial-report-verdict tone-${verdict.tone}`}>
      <small>Análisis inicial · para decidir</small>
      <strong>{verdict.label}</strong>
      <p>{initialReportRecommendationText(recommendation.label)}</p>
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

    <section aria-label="Por qué" className="initial-report-why">
      <h4>Por qué</h4>
      {alerts.length === 0 ? <p>Sin alertas.</p> : <ul>{alerts.map(finding => <FindingNote key={finding.id} report={report} finding={finding} />)}</ul>}
      {acronyms.length > 0 && <p className="initial-report-meta initial-report-acronyms"><b>Siglas:</b> {acronyms.map(entry => `${entry.acronym}: ${entry.meaning}`).join(' · ')}</p>}
    </section>

    <section aria-label="Qué hay que hacer">
      <h4>Qué hay que hacer</h4>
      {tasks.length === 0 ? <p>Sin tareas pendientes registradas.</p> : <ol>{tasks.map((task, index) => <li key={index}>
        {task.critical && <span className="initial-report-chip severity-blocker">Crítico</span>}
        <span>{task.text}</span>
        {(task.owner || task.dueAt) && <small className="initial-report-meta"> · {[task.owner, task.dueAt ? formatDate(task.dueAt) : null].filter(Boolean).join(' · ')}</small>}
      </li>)}</ol>}
    </section>

    <div>
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
      <summary>Ver el análisis completo: otros hallazgos, requisitos, pendientes, contradicciones y fuentes</summary>
    {otherFindings.length > 0 && <section aria-label="Otros hallazgos">
      <h4>Otros hallazgos ({otherFindings.length})</h4>
      <ul>{otherFindings.map(finding => <FindingNote key={finding.id} report={report} finding={finding} />)}</ul>
    </section>}

    <section aria-label="Requisitos">
      <h4>Requisitos ({requirementGroups.length})</h4>
      {requirementGroups.length === 0 ? <p>Sin requisitos registrados.</p> : <ul>{requirementGroups.map(group => <li key={group.key}>
        <strong>{labels.requirementCategory(group.category)}</strong>
        {group.blocker && <span className="initial-report-chip severity-blocker">Impedimento</span>}
        <span>: {group.text ? cleanInitialReportText(group.text) : 'Requisito sin texto en el análisis.'}</span>
        {group.points.length === 1
          ? <>
            {group.points[0].evaluation && group.points[0].evaluation !== 'NOT_EVALUATED' && <small className="initial-report-meta"> · Empresa: {labels.companyEvaluation(group.points[0].evaluation)}</small>}
            {group.points[0].action && <p>Qué hacer: {cleanInitialReportText(group.points[0].action)}</p>}
          </>
          : <ul className="initial-report-points">{group.points.map(point => <li key={point.id}>
            <b>Empresa: {labels.companyEvaluation(point.evaluation)}</b>{point.action && <> · {cleanInitialReportText(point.action)}</>}
          </li>)}</ul>}
      </li>)}</ul>}
    </section>

    <section aria-label="Pendientes">
      <h4>Otros pendientes ({otherOpenItems.length}{openCritical.length ? ` · ${report.openItems.length} en total, ${openCritical.length} críticos` : ''})</h4>
      {otherOpenItems.length === 0 ? <p>Los pendientes ya están en "Qué hay que hacer".</p> : <ul>{otherOpenItems.map(item => <li key={item.id}>
        <strong>{labels.openItemKind(item.kind)}{item.critical ? ' · crítico' : ''}:</strong> {cleanInitialReportText(item.description)}
      </li>)}</ul>}
    </section>

    {report.contradictions.length > 0 && <section aria-label="Contradicciones">
      <h4>Contradicciones en los documentos ({report.contradictions.length})</h4>
      <ul>{report.contradictions.map(item => <li key={item.id}>
        <strong>{item.topic}</strong>
        <small className="initial-report-meta"> · Afecta: {labels.contradictionImpact(item.impact)}</small>
        {item.requiredAction && <p>Qué hacer: {cleanInitialReportText(item.requiredAction)}</p>}
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
      <small>{scope.length > 0 && <>Alcance: {scope.join(' · ')}. </>}Análisis hecho con inteligencia artificial: orienta, no decide. Participar o no lo decide una persona.</small>
    </footer>
  </article>;
}
