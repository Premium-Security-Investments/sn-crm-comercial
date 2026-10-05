import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { projectAgt002InitialReport, readAgt002InitialAnalysisReport } from '../agt002-initial-analysis-report.js';
import { buildInitialAggregate } from '../agt002-initial-analysis-aggregate-builder.js';
import { buildInitialScopeAV2, analysisFromBaseline, packageForDocuments } from './fixtures/agt002-pre-go-analysis-v2.mjs';

const DOCUMENTS = [1, 2].map(index => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, classification: 'official' }));
const IDENTITY = {
  analysisRunId: '50000000-0000-4000-8000-000000000001', authorizationId: '60000000-0000-4000-8000-000000000001',
  packageHash: 'c'.repeat(64), g1Scope: 'A', policyVersion: 'policy-v1',
  opportunityId: '10000000-0000-4000-8000-000000000001', tenderId: '10000000-0000-4000-8000-000000000002',
};

function envelope() {
  const baseline = buildInitialScopeAV2();
  return buildInitialAggregate({
    analysis: analysisFromBaseline(baseline, DOCUMENTS.map(document => document.id)),
    identity: IDENTITY, executor: { executorVersion: 'test', modelProfileId: 'sonnet' }, now: new Date('2026-10-05T12:00:00Z'),
    pkg: packageForDocuments(DOCUMENTS, { packageHash: IDENTITY.packageHash, createdAt: baseline.meta.cutoff_at }),
  });
}
const names = new Map([[DOCUMENTS[0].id, 'pliego-definitivo.pdf'], [DOCUMENTS[1].id, 'anexo-tecnico.pdf']]);

test('the projection carries what a reviewer needs and resolves source documents to names', () => {
  const stored = envelope();
  const report = projectAgt002InitialReport(stored, names);
  assert.equal(report.runId, IDENTITY.analysisRunId);
  assert.equal(report.recommendation.kind, stored.recommendation.kind);
  assert.equal(report.claims.length, stored.claims.length);
  assert.equal(report.findings.length, stored.findings.length);
  assert.equal(report.coverage.length, stored.coverage.length);
  assert.deepEqual(report.documents.map(document => document.name), ['pliego-definitivo.pdf', 'anexo-tecnico.pdf']);
  const cited = report.claims.flatMap(claim => claim.sources);
  assert.ok(cited.length > 0);
  assert.ok(cited.every(source => ['pliego-definitivo.pdf', 'anexo-tecnico.pdf'].includes(source.documentName)));
});

test('the projection is honest about what was not done and never leaks hashes or the check catalog', () => {
  const report = projectAgt002InitialReport(envelope(), names);
  assert.equal(report.companyFitAuthorized, false);
  assert.equal(report.checksExecuted, false);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /[0-9a-f]{64}/, 'no sha256 reaches the browser');
  assert.doesNotMatch(serialized, /CHECK-\d\d|analysis_core_hash|package_hash|g1_authorization/);
});

test('an unknown document name stays null instead of inventing one', () => {
  const report = projectAgt002InitialReport(envelope(), new Map());
  assert.ok(report.documents.every(document => document.name === null));
});

function chain(result, record) {
  const link = {};
  for (const method of ['eq', 'order', 'limit', 'in']) link[method] = (...args) => { record?.push([method, ...args]); return link; };
  link.select = () => link;
  link.maybeSingle = async () => result;
  link.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return link;
}
function databaseFor({ jobStatus = 'COMPLETED', versionEnvelope = envelope() } = {}) {
  const tables = [];
  return {
    tables,
    from(table) {
      tables.push(table);
      if (table === 'psi_agt002_initial_analysis_jobs') {
        return chain({ data: { id: 'job-1', status: jobStatus, analysis_run_id: jobStatus === 'COMPLETED' ? 'run-1' : null, error_code: null }, error: null });
      }
      if (table === 'psi_tender_analysis_runs') {
        return chain({ data: { id: 'run-1', status: 'completed', canonical: true, analysis_kind: 'INITIAL', analysis_version: 1 }, error: null });
      }
      if (table === 'psi_agt002_pre_go_analysis_versions') {
        return chain({ data: { analysis_run_id: 'run-1', aggregate_version: 1, schema_version: 'pre_go_analysis.v2', envelope: versionEnvelope }, error: null });
      }
      return chain({ data: DOCUMENTS.map((document, index) => ({ id: document.id, name: ['pliego.pdf', 'anexo.pdf'][index] })), error: null });
    },
  };
}

test('the report is served only when the canonical INITIAL status is ready', async () => {
  const ready = await readAgt002InitialAnalysisReport(databaseFor(), 'opp-1');
  assert.equal(ready.available, true);
  assert.equal(ready.state, 'ready');
  assert.deepEqual(ready.report.documents.map(document => document.name), ['pliego.pdf', 'anexo.pdf']);

  const database = databaseFor({ jobStatus: 'RUNNING' });
  const notReady = await readAgt002InitialAnalysisReport(database, 'opp-1');
  assert.deepEqual(notReady, { available: false, state: 'running', report: null });
  assert.equal(database.tables.includes('psi_agt002_pre_go_analysis_versions'), false, 'a non-ready analysis never reads the envelope');
});

test('a stored aggregate that cannot be read fails closed with a closed error', async () => {
  const database = databaseFor();
  const original = database.from.bind(database);
  database.from = table => (table === 'psi_agt002_pre_go_analysis_versions' ? chain({ data: null, error: { message: 'raw db text' } }) : original(table));
  await assert.rejects(
    () => readAgt002InitialAnalysisReport(database, 'opp-1'),
    error => error.code === 'AGT002_INITIAL_REPORT_READ_FAILED' && !/raw db text/.test(error.message),
  );
});

test('the report route is registered with the same permission as the status route and the mirrors stay identical', () => {
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.equal(api, server);
  assert.match(api, /'GET \/api\/agt002-initial-analysis-report': \['tenders', ACTIONS\.AI_ANALYSIS_RUN\]/);
  assert.match(api, /app\.get\('\/api\/agt002-initial-analysis-report'/);
});
