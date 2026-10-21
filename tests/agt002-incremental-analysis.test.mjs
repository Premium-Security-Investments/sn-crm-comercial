// Juan, 2026-10-20: lo que se carga a mano se analiza solo, sobre el análisis vigente, sin releer todo el expediente.
// Fija: (1) el análisis guardado vuelve a la forma que escribe el modelo, sin citas a documentos que ya salieron;
// (2) la síntesis incremental recibe ese análisis (sólo el de la corrida fuente que fijó el servidor) y la instrucción
// incremental; (3) la cola lleva el modo: el incremental tras una carga espera si hay un análisis corriendo y el host lo
// admite como incremental; sin documentos nuevos se rechaza sin falla; (4) "qué cambió" entre dos análisis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { agt002PriorAnalysisForModel } from '../agt002-initial-analysis-aggregate-builder.js';
import { createAgt002InitialAnalysisRuntime } from '../agt002-initial-analysis-runtime.js';
import { agt002AnalysisChanges, requestAgt002ManualReanalysis, runAgt002ManualReanalysisRequests } from '../agt002-manual-reanalysis.js';

const STORED = {
  meta: { analysis_run_id: 'run-1', process_deadlines: [{ kind: 'SUBMISSION', value: '2026-10-22T10:00:00-05:00', certainty: 'CONFIRMED', status: 'UPCOMING', label: 'Cierre' }] },
  evidence_package: { member_refs: [] },
  checks: [{ id: 'x' }],
  claims: [
    { claim_id: 'CLM-DOM', display_text: 'Domicilio en Cali', created_by: 'AGT-002', created_at: '2026-10-19T00:00:00Z', decision_ref: null,
      source_refs: [{ document_id: 'pliego-def', locator: '3.1.15', source_hash: 'h', retrieved_at: 'x', source_id: 'pliego-def' }, { document_id: 'proyecto', locator: '3.1.15' }] },
  ],
  process_analysis: { status: 'COMPLETE' }, requirements: [{ requirement_id: 'REQ-DOM', text_claim_id: 'CLM-DOM', company_evaluation: 'PENDING' }],
  findings: [{ finding_id: 'F-1', title: 'Domicilio por confirmar', severity: 'HIGH' }], contradictions: [], coverage: [],
  recommendation: { kind: 'CONTINUE_CONDITIONAL_RECOMMENDED', label: 'Solo en unión temporal: ...' }, open_items: [],
  company_fit: { status: 'EVALUATED', profile_snapshot_id: 's', profile_snapshot_hash: 'h', overall_label: 'PARTIAL_NOT_READY', requirement_ids: ['REQ-DOM'], limitation_claim_ids: [] },
};

test('el análisis guardado vuelve a la forma del modelo y pierde las citas a documentos retirados', () => {
  const { prior, retiredDocumentIds } = agt002PriorAnalysisForModel(STORED, { documentIds: ['pliego-def', 'respuestas'], scope: 'A_PLUS_B' });
  assert.deepEqual(Object.keys(prior).sort(), ['claims', 'company_fit', 'contradictions', 'coverage', 'findings', 'open_items', 'process_analysis', 'process_deadlines', 'recommendation', 'requirements']);
  assert.deepEqual(prior.claims[0].source_refs, [{ document_id: 'pliego-def', locator: '3.1.15' }]);
  assert.equal('created_by' in prior.claims[0], false);
  assert.equal('decision_ref' in prior.claims[0], false);
  assert.deepEqual(prior.company_fit, { overall_label: 'PARTIAL_NOT_READY', requirement_ids: ['REQ-DOM'], limitation_claim_ids: [] });
  assert.equal(prior.process_deadlines[0].label, 'Cierre');
  assert.deepEqual(retiredDocumentIds, ['proyecto']);
  // Alcance A: sin company_fit.
  assert.equal('company_fit' in agt002PriorAnalysisForModel(STORED, { documentIds: ['pliego-def'], scope: 'A' }).prior, false);
});

const text = 'texto';
const textHash = createHash('sha256').update(text).digest('hex');
const PACKAGE_HASH = 'c'.repeat(64);
const job = {
  jobId: 'job-1', opportunityId: 'opp-cali', tenderId: 'tender-cali',
  payload: {
    persistence: { packageVersionId: 'pkg-2', packageHash: PACKAGE_HASH, analysisRunId: 'run-2', authorizationId: 'auth', g1Scope: 'A', policyVersion: 'p', analysisKind: 'REANALYSIS', analysisVersion: 2, sourceAnalysisRunId: 'run-1' },
    execution: { timeoutMs: 1000, reasoningEffort: 'medium' },
    budget: { maxTotalTokens: 1000, maxCostUsd: 1, inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 1 },
  },
};
const pkg = () => ({
  version: { package_id: 'p', package_hash: PACKAGE_HASH, document_manifest_hash: 'd'.repeat(64), semantic_manifest_hash: 'e'.repeat(64), member_count: 2, batch_count: 1, created_at: '2026-10-20T00:00:00Z' },
  members: ['pliego-def', 'respuestas'].map(id => ({ id: `m-${id}`, document_version_id: id, batch_index: 0, source_classification: 'official', inclusion_reason: 'x', content_hash: 'a'.repeat(64), extraction_text_hash: textHash })),
});
const emptyAnalysis = JSON.stringify({ claims: [], process_analysis: {}, requirements: [], findings: [], contradictions: [], coverage: [], recommendation: {}, open_items: [], process_deadlines: [] });

function runtimeCapturing(requests, overrides = {}) {
  return createAgt002InitialAnalysisRuntime({
    bridgeClient: { run: async request => { requests.push(request); return { content: emptyAnalysis, usage: { input_tokens: 1, output_tokens: 1 } }; } },
    loadPackage: async () => pkg(),
    loadOfficialContext: async () => null,
    loadPriorAnalysis: async (_db, { analysisRunId, opportunityId }) => { assert.equal(analysisRunId, 'run-1'); assert.equal(opportunityId, 'opp-cali'); return STORED; },
    validateEnvelope: () => ({ ok: true, errors: [] }),
    now: () => new Date('2026-10-21T12:00:00Z'),
    ...overrides,
  });
}

test('la síntesis incremental recibe el análisis anterior y la instrucción incremental; la completa no', async () => {
  const requests = [];
  const members = [{ memberId: 'batch:0', content: { analysis_notes: [], open_items: [] }, contentHash: 'f'.repeat(64) }];
  await runtimeCapturing(requests).callModel({ job, batch: { phase: 'synthesis', batchIndex: 1, requestHash: 'h', mode: 'incremental', priorAnalysisRunId: 'run-1' }, modelId: 'm', members });
  assert.match(requests[0].policy, /^MODO INCREMENTAL\./);
  assert.deepEqual(requests[0].input.prior_analysis.claims[0].source_refs, [{ document_id: 'pliego-def', locator: '3.1.15' }]);
  assert.deepEqual(requests[0].input.retired_document_ids, ['proyecto']);
  await runtimeCapturing(requests, { loadPriorAnalysis: async () => assert.fail('una síntesis completa no lee el análisis anterior') })
    .callModel({ job, batch: { phase: 'synthesis', batchIndex: 1, requestHash: 'h' }, modelId: 'm', members });
  assert.doesNotMatch(requests[1].policy, /MODO INCREMENTAL/);
  assert.equal('prior_analysis' in requests[1].input, false);
});

test('la síntesis incremental sólo acepta la corrida fuente que fijó el servidor', async () => {
  await assert.rejects(
    runtimeCapturing([]).callModel({ job, batch: { phase: 'synthesis', batchIndex: 1, requestHash: 'h', mode: 'incremental', priorAnalysisRunId: 'otra-corrida' }, modelId: 'm', members: [] }),
    error => error?.diagnostic?.reason === 'prior_analysis_mismatch',
  );
});

// --- Cola (mismo fake que tests/agt002-manual-reanalysis.test.mjs, con modo) ---
const NOW = new Date('2026-10-21T15:00:00.000Z');
const ON = { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true', AGT002_MODEL_CALLS_ENABLED: 'true' };
const REQUESTS = 'psi_agt002_manual_reanalysis_requests';
function fakeDb(tables) {
  let seq = 0;
  return {
    tables,
    from(name) {
      const filters = []; let limit = Infinity; let mode = 'select'; let patch = null; let row = null;
      const rows = () => (tables[name] ||= []);
      const matching = () => rows().filter(item => filters.every(filter => filter(item)));
      const run = () => {
        if (mode === 'insert') {
          if (name === REQUESTS && rows().some(item => item.opportunity_id === row.opportunity_id && ['pending', 'running'].includes(item.status))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          const inserted = { id: `req-${++seq}`, status: 'pending', mode: 'full', requested_at: NOW.toISOString(), started_at: null, finished_at: null, job_id: null, reason: null, ...row };
          rows().push(inserted); return { data: [inserted], error: null };
        }
        if (mode === 'update') { const hit = matching(); hit.forEach(item => Object.assign(item, patch)); return { data: hit, error: null }; }
        return { data: matching().slice(0, limit), error: null };
      };
      const chain = {
        select() { return chain; }, insert(value) { mode = 'insert'; row = value; return chain; }, update(value) { mode = 'update'; patch = value; return chain; },
        eq(column, value) { filters.push(item => item[column] === value); return chain; },
        in(column, values) { filters.push(item => values.includes(item[column])); return chain; },
        gte(column, value) { filters.push(item => item[column] != null && String(item[column]) >= String(value)); return chain; },
        order() { return chain; }, limit(n) { limit = n; return chain; },
        single: async () => { const result = run(); return result.error ? { data: null, error: result.error } : { data: result.data[0] ?? null, error: null }; },
        maybeSingle: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error }; },
        then(resolve) { resolve(run()); },
      };
      return chain;
    },
  };
}
const world = (overrides = {}) => ({
  psi_public_tenders: [{ id: 't-cali', converted_opportunity_id: 'opp-cali' }],
  psi_agt002_initial_analysis_jobs: [{ id: 'job-0', opportunity_id: 'opp-cali', status: 'COMPLETED' }],
  psi_tender_analysis_runs: [{ id: 'run-1', opportunity_id: 'opp-cali', canonical: true, status: 'completed' }],
  [REQUESTS]: [], ...overrides,
});
const active = async () => null;
const deps = { freezeProfile: async () => ({ profileSnapshotId: 's', profileSnapshotHash: 'h'.repeat(64) }), selectMembers: async () => ({ requestedMembers: [{}], includedCount: 3 }), inactiveReason: active };

test('tras una carga se pide el incremental aunque haya un análisis corriendo; el host lo devuelve a la cola', async () => {
  const db = fakeDb(world({ psi_agt002_initial_analysis_jobs: [{ id: 'job-run', opportunity_id: 'opp-cali', status: 'RUNNING' }] }));
  const requested = await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-cali', requestedBy: 'juan', mode: 'incremental', now: NOW, inactiveReason: active });
  assert.equal(requested.requested, true);
  assert.equal(db.tables[REQUESTS][0].mode, 'incremental');
  // El botón (completo) sí se rechaza con un análisis en curso.
  const other = fakeDb(world({ psi_agt002_initial_analysis_jobs: [{ id: 'job-run', opportunity_id: 'opp-cali', status: 'RUNNING' }] }));
  await assert.rejects(requestAgt002ManualReanalysis(other, { opportunityId: 'opp-cali', requestedBy: 'juan', now: NOW, inactiveReason: active }), { reason: 'analisis_en_curso' });
  const events = await runAgt002ManualReanalysisRequests(db, { now: NOW, environment: ON, admit: async () => assert.fail('no debe admitir'), ...deps });
  assert.deepEqual(events.map(event => [event.event, event.reason]), [['agt002_manual_reanalysis_deferred', 'analisis_en_curso']]);
  assert.equal(db.tables[REQUESTS][0].status, 'pending');
  assert.equal(db.tables[REQUESTS][0].started_at, null);
});

test('el host admite el incremental como REANALYSIS incremental de la corrida canónica', async () => {
  const db = fakeDb(world());
  await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-cali', requestedBy: 'juan', mode: 'incremental', now: NOW, inactiveReason: active });
  const calls = [];
  const events = await runAgt002ManualReanalysisRequests(db, { now: NOW, environment: ON, admit: async (_db, args) => { calls.push(args); return { admissionStatus: 'admitted', jobId: 'job-inc' }; }, ...deps });
  assert.equal(events[0].event, 'agt002_manual_reanalysis_admitted');
  assert.equal(calls[0].incremental, true);
  assert.equal(calls[0].analysisKind, 'REANALYSIS');
  assert.equal(calls[0].sourceAnalysisRunId, 'run-1');
});

test('sin documentos nuevos el incremental se rechaza sin contar como falla', async () => {
  const db = fakeDb(world());
  await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-cali', requestedBy: 'juan', mode: 'incremental', now: NOW, inactiveReason: active });
  const events = await runAgt002ManualReanalysisRequests(db, { now: NOW, environment: ON, admit: async () => { throw Object.assign(new Error('No hay documentos nuevos frente al análisis vigente: no hay nada que analizar en modo incremental.'), { code: '22023' }); }, ...deps });
  assert.deepEqual(events.map(event => [event.event, event.reason]), [['agt002_manual_reanalysis_rejected', 'sin_documentos_nuevos']]);
  assert.equal(db.tables[REQUESTS][0].status, 'rejected');
});

test('qué cambió: recomendación, requisitos re-evaluados y hallazgos nuevos o retirados', () => {
  const next = {
    ...STORED,
    claims: [{ claim_id: 'CLM-DOM', display_text: 'Domicilio principal en Cali (5 años)' }],
    requirements: [{ requirement_id: 'REQ-DOM', text_claim_id: 'CLM-DOM', company_evaluation: 'BLOCKER' }],
    findings: [{ finding_id: 'F-2', title: 'La entidad negó la sucursal para proponente individual', severity: 'HIGH' }],
    recommendation: { kind: 'NO_GO_RECOMMENDED', label: 'No puede presentarse: domicilio principal obligatorio.' },
  };
  const changes = agt002AnalysisChanges(STORED, next);
  assert.deepEqual(changes.recommendation, { from: 'Solo en unión temporal: ...', to: 'No puede presentarse: domicilio principal obligatorio.', kindChanged: true });
  assert.deepEqual(changes.requirements, [{ requirementId: 'REQ-DOM', text: 'Domicilio principal en Cali (5 años)', from: 'PENDING', to: 'BLOCKER' }]);
  assert.deepEqual(changes.addedFindings, [{ title: 'La entidad negó la sucursal para proponente individual', severity: 'HIGH' }]);
  assert.deepEqual(changes.removedFindings, [{ title: 'Domicilio por confirmar', severity: 'HIGH' }]);
  assert.deepEqual(agt002AnalysisChanges(STORED, STORED), { recommendation: null, requirements: [], addedFindings: [], removedFindings: [] });
});
