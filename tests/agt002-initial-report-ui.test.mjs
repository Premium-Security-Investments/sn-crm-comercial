import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

import { projectAgt002InitialReport } from '../agt002-initial-analysis-report.js';
import { buildInitialAggregate } from '../agt002-initial-analysis-aggregate-builder.js';
import { buildInitialScopeAV2, analysisFromBaseline, packageForDocuments } from './fixtures/agt002-pre-go-analysis-v2.mjs';

function load(relative, { jsx = false } = {}) {
  const bundled = buildSync({
    entryPoints: [new URL(relative, import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false,
    ...(jsx ? { jsx: 'automatic', loader: { '.tsx': 'tsx' } } : {}),
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
}
const projectionModule = await load('../src/tenders/agt002InitialReportProjection.ts');
const { parseAgt002InitialReportResponse, initialReportLabels, initialReportClaims, formatInitialReportSource, initialReportVerdict, initialReportAxes, initialReportTasks, initialReportAlerts, initialReportCompanyFit } = projectionModule;

const DOCUMENTS = [1, 2].map(index => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, classification: 'official' }));
const IDENTITY = {
  analysisRunId: '50000000-0000-4000-8000-000000000001', authorizationId: '60000000-0000-4000-8000-000000000001',
  packageHash: 'c'.repeat(64), g1Scope: 'A', policyVersion: 'policy-v1',
  opportunityId: '10000000-0000-4000-8000-000000000001', tenderId: '10000000-0000-4000-8000-000000000002',
};
function serverReport() {
  const baseline = buildInitialScopeAV2();
  const envelope = buildInitialAggregate({
    analysis: analysisFromBaseline(baseline, DOCUMENTS.map(document => document.id)),
    identity: IDENTITY, executor: { executorVersion: 'test', modelProfileId: 'sonnet' }, now: new Date('2026-10-05T12:00:00Z'),
    pkg: packageForDocuments(DOCUMENTS, { packageHash: IDENTITY.packageHash, createdAt: baseline.meta.cutoff_at }),
  });
  return projectAgt002InitialReport(envelope, new Map([[DOCUMENTS[0].id, 'pliego.pdf'], [DOCUMENTS[1].id, 'anexo.pdf']]));
}

test('the browser parser accepts exactly what the server projects', () => {
  const report = serverReport();
  const parsed = parseAgt002InitialReportResponse({ available: true, state: 'ready', report });
  assert.equal(parsed.report.runId, IDENTITY.analysisRunId);
});

test('the browser parser rejects an inconsistent or empty response', () => {
  assert.throws(() => parseAgt002InitialReportResponse(null), /no válido/);
  assert.throws(() => parseAgt002InitialReportResponse({ available: true, state: 'ready', report: null }), /estructura/);
  assert.throws(() => parseAgt002InitialReportResponse({ available: true, state: 'ready', report: { runId: 'r', recommendation: { kind: 'x' } } }), /estructura/);
  assert.throws(() => parseAgt002InitialReportResponse({ available: false, state: 'running', report: serverReport() }), /no listo/);
  assert.deepEqual(parseAgt002InitialReportResponse({ available: false, state: 'running', report: null }), { available: false, state: 'running', report: null });
});

test('labels are in Spanish and unknown codes fall through instead of disappearing', () => {
  assert.equal(initialReportLabels.recommendation('INSUFFICIENT_INFORMATION'), 'Información insuficiente');
  assert.equal(initialReportLabels.severity('HIGH'), 'Alto');
  assert.equal(initialReportLabels.coverageStatus('NOT_COVERED'), 'Sin cubrir');
  assert.equal(initialReportLabels.coverageBlock('TIMELINE_FEASIBILITY'), 'Cronograma');
  assert.equal(initialReportLabels.severity('SOMETHING_NEW'), 'SOMETHING_NEW');
});

test('every schema code the report shows has a Spanish label (no raw English codes on screen)', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/agt002/pre_go_analysis.v2.schema.json', import.meta.url), 'utf8'));
  const defs = schema.$defs;
  const cases = [
    [defs.requirement.properties.category.enum, initialReportLabels.requirementCategory],
    [defs.requirement.properties.company_evaluation.enum, initialReportLabels.companyEvaluation],
    [defs.openItem.properties.kind.enum, initialReportLabels.openItemKind],
    [defs.contradiction.properties.impact.enum, initialReportLabels.contradictionImpact],
    [defs.finding.properties.severity.enum, initialReportLabels.severity],
    [defs.claim.properties.evidence_status.enum, initialReportLabels.evidenceStatus],
    [defs.coverage.properties.block.enum, initialReportLabels.coverageBlock],
    [defs.coverage.properties.status.enum, initialReportLabels.coverageStatus],
    [defs.recommendation.properties.kind.enum, initialReportLabels.recommendation],
  ];
  for (const [codes, label] of cases) for (const code of codes) assert.notEqual(label(code), code, `${code} needs a Spanish label`);
});

test('the report styles use the CRM light card tokens, never the dark design-token surface', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* AGT-002 INITIAL review report'));
  assert.match(block, /\.initial-report \{[^}]*background: var\(--card, #fff\)/);
  assert.match(block, /\.initial-report \{[^}]*color: var\(--text, #172033\)/);
  assert.doesNotMatch(block, /var\(--surface/);
  assert.match(block, /\.agt002-initial-state \{[^}]*gap:/);
});

test('claims resolve in order and sources read as "document — locator"', () => {
  const report = serverReport();
  const ids = report.claims.slice(0, 2).map(claim => claim.id);
  assert.deepEqual(initialReportClaims(report, [...ids, 'CLM-MISSING']).map(claim => claim.id), ids);
  const source = report.claims.find(claim => claim.sources.length).sources[0];
  assert.match(formatInitialReportSource(source), /^(pliego|anexo)\.pdf — /);
  assert.equal(formatInitialReportSource({ documentId: 'x', documentName: null, locator: 'p. 3' }), 'Documento sin nombre — p. 3');
});

test('the report component renders the recommendation, the limits and the sourced findings, and decides nothing', async () => {
  const { TenderInitialReport } = await load('../src/tenders/components/TenderInitialReport.tsx', { jsx: true });
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const report = serverReport();
  const html = renderToStaticMarkup(createElement(TenderInitialReport, { report }));
  assert.match(html, /Reporte del análisis inicial/);
  assert.match(html, new RegExp(initialReportVerdict(report.recommendation.kind).label));
  assert.match(html, /Alcance: sin perfil de empresa/);
  assert.match(html, /sin la revisión punto por punto de la metodología/);
  assert.match(html, /Participar o no lo decide una persona/);
  // The verdict opens the report and the scope closes it.
  assert.ok(html.indexOf('para decidir') < html.indexOf('Qué hay que hacer'));
  assert.ok(html.indexOf('Qué hay que hacer') < html.indexOf('Ver el análisis completo'));
  assert.ok(html.indexOf('Ver el análisis completo') < html.indexOf('Alcance:'));
  for (const axis of ['Jurídico y garantías', 'Financiero', 'Técnico, licencias y personal', 'Experiencia', 'Económico']) assert.match(html, new RegExp(axis));
  assert.doesNotMatch(html, /Qué no evalúa este análisis/);
  for (const finding of report.findings) assert.match(html, new RegExp(finding.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 30)));
  assert.match(html, /(pliego|anexo)\.pdf/);
  assert.doesNotMatch(html, /[0-9a-f]{64}/);
});

test('the CRM asks for the report only when the INITIAL status is ready, once per canonical run, and shows it only then', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const section = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
  assert.match(main, /\/api\/agt002-initial-analysis-report\?opportunity_id=/);
  assert.match(main, /projection\.state !== 'ready' \|\| !projection\.runId/);
  assert.match(main, /initialReportRunIdRef\.current === ?|knownRunId === projection\.runId/);
  assert.match(main, /initialReport=\{initialReport\}/);
  assert.match(section, /initialAnalysis\.state === 'ready' && initialReport && <TenderInitialReport report=\{initialReport\} officialCloseDate=/);
});

test('with an INITIAL analysis the legacy-engine blocks are not rendered, and without it the legacy view stays', () => {
  const section = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
  const start = section.indexOf('if (initialFirst && initialAnalysis) {');
  assert.ok(start > 0);
  const initialBranch = section.slice(start, section.indexOf('\n  }\n', start));
  for (const legacy of ['Análisis pendiente', 'Recomendación preliminar', 'TenderGovernedDocumentWorkset', 'Análisis integral pausado', 'tenderAnalysisProducerDisclosure']) {
    assert.equal(initialBranch.includes(legacy), false, `${legacy} must not render next to the INITIAL analysis`);
  }
  assert.match(section.slice(start + initialBranch.length), /TenderGovernedDocumentWorkset/, 'the legacy view is unchanged for opportunities without INITIAL');
});

test('the scope line merges server limits with the model limitations without repeating them', async () => {
  const { initialReportScope } = await load('../src/tenders/components/TenderInitialReport.tsx', { jsx: true });
  const report = serverReport();
  report.recommendation.limitations = [
    'Sin perfil de empresa autorizado; no se evalúa ajuste a la empresa.',
    'La decisión GO/NO-GO corresponde a quien tenga autoridad y no se toma aquí.',
    'El análisis se basa solo en las notas de lote de 7 documentos.',
  ];
  const scope = initialReportScope(report);
  assert.equal(scope.filter(item => /perfil de empresa/i.test(item)).length, 1);
  assert.equal(scope.some(item => /GO\/NO-GO/.test(item)), false);
  assert.ok(scope.includes('El análisis se basa solo en las notas de lote de 7 documentos'));
});

test('the decision tab shows the INITIAL verdict and its blockers instead of the legacy brief', async () => {
  const { TenderInitialDecisionSummary } = await load('../src/tenders/components/TenderInitialDecisionSummary.tsx', { jsx: true });
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const report = serverReport();
  report.findings = [{ id: 'FND-1', severity: 'HIGH', category: 'Experiencia', title: 'Falta acreditar 100 cámaras', impact: 'Sin esto no habilita.', blocker: true, claimIds: [] }];
  const html = renderToStaticMarkup(createElement(TenderInitialDecisionSummary, { report }));
  assert.match(html, /Resultado del análisis inicial/);
  assert.match(html, new RegExp(initialReportVerdict(report.recommendation.kind).label));
  assert.match(html, /Empresa:/);
  assert.match(html, /Lo que hoy impide avanzar/);
  assert.match(html, /href="#tender-analysis"/);
  const experience = readFileSync(new URL('../src/tenders/components/TenderDecisionExperience.tsx', import.meta.url), 'utf8');
  assert.match(experience, /initialReport\s*\?\s*<TenderInitialDecisionSummary/);
});

test('the section chips read the INITIAL analysis: "Análisis inicial listo" and a pending human decision', async () => {
  const { resolveTenderDetailIndicators } = await load('../src/tenders/detailNavigationState.ts');
  const ready = value => ({ phase: 'ready', value });
  const indicators = resolveTenderDetailIndicators({
    documents: ready({ currentDocumentCount: 19, importError: null }),
    analysis: ready(null),
    decision: ready(null),
    preparation: ready({ preparationStatus: null, humanPendingCount: 0 }),
    followUp: { tone: 'unknown', label: '-' },
    initialAnalysisReady: true,
  });
  assert.equal(indicators['tender-analysis'].label, 'Análisis inicial listo');
  assert.equal(indicators['tender-decision'].label, 'Decisión humana pendiente');
  const legacy = resolveTenderDetailIndicators({
    documents: ready({ currentDocumentCount: 19, importError: null }), analysis: ready(null), decision: ready(null),
    preparation: ready({ preparationStatus: null, humanPendingCount: 0 }), followUp: { tone: 'unknown', label: '-' },
  });
  assert.equal(legacy['tender-analysis'].label, 'Sin análisis vigente');
});

test('the verdict speaks the decision language', () => {
  assert.equal(initialReportVerdict('CONTINUE_RECOMMENDED').label, 'Participar');
  assert.equal(initialReportVerdict('CONTINUE_CONDITIONAL_RECOMMENDED').label, 'Participar con condiciones');
  assert.equal(initialReportVerdict('HOLD_RECOMMENDED').label, 'Evaluar a fondo');
  assert.match(initialReportVerdict('INSUFFICIENT_INFORMATION').label, /falta información/);
  assert.equal(initialReportVerdict('NO_GO_RECOMMENDED').tone, 'nogo');
});

test('the five axes turn red on a blocker, amber when unconfirmed, green when verified, grey without data', () => {
  const report = serverReport();
  report.requirements = [
    { id: 'R1', category: 'FINANCIAL', textClaimId: '', applicability: 'APPLICABLE', companyEvaluation: 'VERIFIED', blocker: false, requiredAction: null },
    { id: 'R2', category: 'EXPERIENCE', textClaimId: '', applicability: 'APPLICABLE', companyEvaluation: 'BLOCKER', blocker: true, requiredAction: 'Conseguir certificación de 100 cámaras' },
    { id: 'R3', category: 'LICENSE', textClaimId: '', applicability: 'APPLICABLE', companyEvaluation: 'PENDING', blocker: false, requiredAction: 'Verificar licencia canina' },
    { id: 'R4', category: 'LEGAL', textClaimId: '', applicability: 'NOT_APPLICABLE', companyEvaluation: 'NOT_APPLICABLE', blocker: false, requiredAction: null },
  ];
  const axes = Object.fromEntries(initialReportAxes(report).map(axis => [axis.key, axis.light]));
  assert.deepEqual(axes, { juridico: 'sin_datos', financiero: 'cumple', tecnico: 'por_confirmar', experiencia: 'no_cumple', economico: 'sin_datos' });
  const tasks = initialReportTasks({ ...report, openItems: [] });
  assert.equal(tasks[0].text, 'Conseguir certificación de 100 cámaras', 'blocking actions come first');
  assert.equal(tasks[0].critical, true);
});

test('tasks are at most five, deduplicated, critical first; alerts are the three most serious, blockers first', () => {
  const report = serverReport();
  report.requirements = [];
  report.openItems = Array.from({ length: 8 }, (_, i) => ({ id: `O${i}`, kind: 'ACTION', description: i === 3 ? 'Obtener el cronograma' : i === 4 ? 'OBTENER EL CRONOGRAMA' : `Tarea ${i}`, critical: i === 6, status: 'OPEN', ownerRole: i === 6 ? 'Jurídico' : null, dueAt: null }));
  const tasks = initialReportTasks(report);
  assert.equal(tasks.length, 5);
  assert.equal(tasks[0].text, 'Tarea 6');
  assert.equal(tasks[0].owner, 'Jurídico');
  assert.equal(tasks.filter(task => /cronograma/i.test(task.text)).length, 1);
  report.findings = [
    { id: 'F1', severity: 'MEDIUM', title: 'm', impact: '', blocker: false, claimIds: [] },
    { id: 'F2', severity: 'HIGH', title: 'h', impact: '', blocker: false, claimIds: [] },
    { id: 'F3', severity: 'MEDIUM', title: 'b', impact: '', blocker: true, claimIds: [] },
    { id: 'F4', severity: 'CRITICAL', title: 'c', impact: '', blocker: false, claimIds: [] },
  ];
  assert.deepEqual(initialReportAlerts(report).map(finding => finding.id), ['F3', 'F4', 'F2']);
});

test('the company fit reads plainly, including when there is no profile', () => {
  const report = serverReport();
  assert.equal(initialReportCompanyFit({ ...report, companyFitAuthorized: false, companyFitLabel: 'NOT_AUTHORIZED' }), 'Sin perfil de empresa');
  assert.equal(initialReportCompanyFit({ ...report, companyFitAuthorized: true, companyFitLabel: 'NO_APTO' }), 'Hoy no cumple');
  assert.equal(initialReportCompanyFit({ ...report, companyFitAuthorized: true, companyFitLabel: 'PARTIAL_NOT_READY' }), 'Cumple en parte · aún no lista');
});

// --- Owner review 2026-10-06: one requirement once, notes readable without opening sources, no internal codes. ---
test('requirements over the same text are grouped once, with their points; axes count requirements, not points', async () => {
  const { initialReportRequirementGroups, initialReportAxes } = await import('../src/tenders/agt002InitialReportProjection.ts');
  const report = {
    requirements: [
      { id: 'R1', category: 'FINANCIAL', textClaimId: 'C-FIN', applicability: 'APPLICABLE', companyEvaluation: 'VERIFIED', blocker: false, requiredAction: 'Confirmar liquidez.' },
      { id: 'R2', category: 'FINANCIAL', textClaimId: 'C-FIN', applicability: 'APPLICABLE', companyEvaluation: 'BLOCKER', blocker: true, requiredAction: 'Confirmar endeudamiento.' },
      { id: 'R3', category: 'FINANCIAL', textClaimId: 'C-FIN', applicability: 'APPLICABLE', companyEvaluation: 'PENDING', blocker: false, requiredAction: 'Recalcular.' },
      { id: 'R4', category: 'LEGAL', textClaimId: 'C-LEG', applicability: 'APPLICABLE', companyEvaluation: 'VERIFIED', blocker: false, requiredAction: null },
    ],
    claims: [{ id: 'C-FIN', text: 'Indicadores financieros.' }, { id: 'C-LEG', text: 'RUP vigente.' }],
  };
  const groups = initialReportRequirementGroups(report);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].text, 'Indicadores financieros.');
  assert.equal(groups[0].blocker, true);
  assert.deepEqual(groups[0].points.map(point => point.evaluation), ['BLOCKER', 'PENDING', 'VERIFIED']);
  const financial = initialReportAxes(report).find(axis => axis.key === 'financiero');
  assert.equal(financial.total, 1);
  assert.equal(financial.blockers, 1);
});

test('a finding note says what is demanded, how the company stands and what to do, from the stored analysis', async () => {
  const { initialReportFindingNote, initialReportAcronyms, cleanInitialReportText, initialReportRecommendationText } = await import('../src/tenders/agt002InitialReportProjection.ts');
  const report = {
    companyFitAuthorized: true,
    requirements: [{ id: 'REQ-EXP', category: 'EXPERIENCE', textClaimId: 'CLM-REQ-EXP', applicability: 'APPLICABLE', companyEvaluation: 'PENDING', blocker: true, requiredAction: 'Buscar un aliado con ese contrato.', evidenceClaimIds: ['CLM-CO-EXP'] }],
    claims: [
      { id: 'CLM-REQ-EXP', text: 'Un contrato con 1.800 cámaras e integración con SECAD y 40 licencias LPR.' },
      { id: 'CLM-CO-EXP', text: 'El perfil no declara contratos de VMS (ver CLM-REQ-EXP).' },
    ],
  };
  const finding = { id: 'F1', severity: 'CRITICAL', category: 'Experiencia', title: 'Falta la experiencia específica', impact: 'La oferta sería rechazada.', blocker: true, claimIds: ['CLM-REQ-EXP', 'CLM-CO-EXP'] };
  const note = initialReportFindingNote(report, finding);
  assert.deepEqual(note.demand, ['Un contrato con 1.800 cámaras e integración con SECAD y 40 licencias LPR.']);
  assert.deepEqual(note.company, ['El perfil no declara contratos de VMS.']);
  assert.deepEqual(note.actions, ['Buscar un aliado con ese contrato.']);
  assert.match(note.certainty, /Por confirmar/);
  assert.deepEqual(initialReportAcronyms([...note.demand, ...note.company]).map(entry => entry.acronym), ['SECAD', 'LPR', 'VMS']);
  assert.equal(cleanInitialReportText("Perfil experience; la evidencia accredited_experience es 'pending_case_validation' en CLM-REQ-EXP-ESP."), "Perfil experiencia; la evidencia experiencia acreditada es 'pendiente de validar' en el requisito citado.");
  assert.equal(initialReportRecommendationText('Esperar a confirmar el RUP. Esta recomendación no es una decisión GO/NO-GO.'), 'Esperar a confirmar el RUP.');
});

test('without a company profile, or when the evidence is the requirement text itself, there is no "Cómo estamos"', async () => {
  const { initialReportFindingNote } = await import('../src/tenders/agt002InitialReportProjection.ts');
  const base = {
    requirements: [{ id: 'R', category: 'LEGAL', textClaimId: 'C-REQ', applicability: 'APPLICABLE', companyEvaluation: 'NOT_EVALUATED', blocker: false, requiredAction: 'Revisar.', evidenceClaimIds: ['C-REQ', 'C-CO'] }],
    claims: [{ id: 'C-REQ', text: 'Garantía de seriedad del 10%.' }, { id: 'C-CO', text: 'El perfil trae la póliza.' }],
  };
  const finding = { id: 'F', severity: 'HIGH', category: 'Jurídico', title: 'Garantía', impact: 'Causa rechazo.', blocker: false, claimIds: ['C-REQ', 'C-CO'] };
  assert.deepEqual(initialReportFindingNote({ ...base, companyFitAuthorized: false }, finding).company, []);
  assert.deepEqual(initialReportFindingNote({ ...base, companyFitAuthorized: true }, finding).company, ['El perfil trae la póliza.']);
});

// --- Before the first analysis (owner review 2026-10-06): one plain block, no retired-engine controls. ---
test('a new opportunity shows where it stands and the next step, never the retired engine controls', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { TenderPreAnalysisPanel } = await load('../src/tenders/components/TenderPreAnalysisPanel.tsx', { jsx: true });
  const empty = renderToStaticMarkup(createElement(TenderPreAnalysisPanel, { documentsCount: 0 }));
  assert.match(empty, /Todavía no se ha hecho/);
  assert.match(empty, /Actualizar documentos/);
  const loaded = renderToStaticMarkup(createElement(TenderPreAnalysisPanel, { documentsCount: 35 }));
  assert.match(loaded, /35 cargados/);
  for (const html of [empty, loaded]) {
    const visibleText = html.replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(visibleText, /INITIAL|AGT-002|procesando|Congelar|pausad/i);
  }
  const downloading = renderToStaticMarkup(createElement(TenderPreAnalysisPanel, {
    documentsCount: 3, processing: { status: 'importing_documents', counts: { discovered: 35, processed: 12, imported: 12, unchanged: 0, failed: 0 } },
  }));
  assert.match(downloading, /Bajando los documentos de SECOP/);
  assert.match(downloading, /12 de 35/);
  const ready = renderToStaticMarkup(createElement(TenderPreAnalysisPanel, { documentsCount: 35, processing: { status: 'awaiting_analysis_authorization', counts: { discovered: 35, processed: 35, imported: 35, unchanged: 0, failed: 0 } } }));
  assert.match(ready, /el análisis arranca en unos minutos/);
  assert.doesNotMatch(ready.replace(/<[^>]+>/g, ' '), /congele|Congelar/i);
  const stopped = renderToStaticMarkup(createElement(TenderPreAnalysisPanel, { documentsCount: 0, processing: { status: 'needs_attention', last_error_message: 'SECOP no respondió' } }));
  assert.match(stopped, /Se detuvo antes de empezar/);
  assert.match(stopped, /SECOP no respondió/);
  const section = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
  assert.match(section, /!initialFirst && !analysis && initialAnalysis\?\.state === 'pending'[\s\S]*<TenderPreAnalysisPanel/);
  assert.doesNotMatch(section, /<strong>INITIAL:/, 'the internal name never labels a visible state');
  const experience = readFileSync(new URL('../src/tenders/components/TenderDecisionExperience.tsx', import.meta.url), 'utf8');
  assert.match(experience, /Todavía no hay análisis/);
});
