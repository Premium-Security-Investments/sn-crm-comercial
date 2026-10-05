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
const { parseAgt002InitialReportResponse, initialReportLabels, initialReportClaims, formatInitialReportSource } = projectionModule;

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
  assert.match(html, new RegExp(initialReportLabels.recommendation(report.recommendation.kind)));
  assert.match(html, /No hay perfil de empresa autorizado/);
  assert.match(html, /No se ejecutó ninguna de las verificaciones/);
  assert.match(html, /exclusivamente humana/);
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
  assert.match(section, /initialAnalysis\?\.state === 'ready' && initialReport && <TenderInitialReport/);
});
