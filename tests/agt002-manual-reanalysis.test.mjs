// AGT-002 — "Volver a analizar" (Juan, 2026-10-20). Fija: la petición web sólo deja la solicitud; el host la admite
// como reanálisis sucesor del análisis canónico con quien la pidió como actor; una solicitud abierta por oportunidad;
// nada con la oportunidad inactiva, con un análisis en curso o sin análisis previo; la red de seguridad diaria; los
// interruptores; y el estado que ve el botón.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGT002_MANUAL_REANALYSIS_LIMITS, readAgt002ManualReanalysisStatus, requestAgt002ManualReanalysis, runAgt002ManualReanalysisRequests,
} from '../verticales/licitaciones/agt002-manual-reanalysis.js';
import { AGT002_AUTO_INITIAL_POLICY_VERSION } from '../verticales/licitaciones/agt002-auto-initial.js';

const NOW = new Date('2026-10-20T15:00:00.000Z');
const ON = { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true', AGT002_MODEL_CALLS_ENABLED: 'true' };
const REQUESTS = 'psi_agt002_manual_reanalysis_requests';

function fakeDb(tables) {
  let seq = 0;
  return {
    tables,
    from(name) {
      const filters = [];
      let limit = Infinity;
      let mode = 'select';
      let patch = null;
      let row = null;
      const rows = () => (tables[name] ||= []);
      const matching = () => rows().filter(item => filters.every(filter => filter(item)));
      const run = () => {
        if (mode === 'insert') {
          if (name === REQUESTS && rows().some(item => item.opportunity_id === row.opportunity_id && ['pending', 'running'].includes(item.status))) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          const inserted = { id: `req-${++seq}`, status: 'pending', requested_at: NOW.toISOString(), started_at: null, finished_at: null, job_id: null, reason: null, ...row };
          rows().push(inserted);
          return { data: [inserted], error: null };
        }
        if (mode === 'update') {
          const hit = matching();
          hit.forEach(item => Object.assign(item, patch));
          return { data: hit, error: null };
        }
        return { data: matching().slice(0, limit), error: null };
      };
      const chain = {
        select() { return chain; },
        insert(value) { mode = 'insert'; row = value; return chain; },
        update(value) { mode = 'update'; patch = value; return chain; },
        eq(column, value) { filters.push(item => item[column] === value); return chain; },
        gte(column, value) { filters.push(item => item[column] != null && String(item[column]) >= String(value)); return chain; },
        order() { return chain; },
        limit(n) { limit = n; return chain; },
        single: async () => { const result = run(); return result.error ? { data: null, error: result.error } : { data: result.data[0] ?? null, error: null }; },
        maybeSingle: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error }; },
        then(resolve) { resolve(run()); },
      };
      return chain;
    },
  };
}

function world(overrides = {}) {
  return {
    psi_public_tenders: [{ id: 't-fgn', converted_opportunity_id: 'opp-fgn' }, { id: 't-other', converted_opportunity_id: 'opp-other' }],
    psi_agt002_initial_analysis_jobs: [{ id: 'job-initial', opportunity_id: 'opp-fgn', status: 'COMPLETED' }],
    psi_tender_analysis_runs: [{ id: 'run-6oct', opportunity_id: 'opp-fgn', canonical: true, status: 'completed' }],
    [REQUESTS]: [],
    ...overrides,
  };
}

const active = async () => null;
const fakeMembers = async () => ({ requestedMembers: [{ document_version_id: 'd1' }], includedCount: 18 });
const fakeProfile = async (_db, { actorProfileId }) => ({ profileSnapshotId: `snap-${actorProfileId}`, profileSnapshotHash: 'h'.repeat(64) });

test('la petición web deja una solicitud pendiente y nada más', async () => {
  const db = fakeDb(world());
  const result = await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active });
  assert.equal(result.requested, true);
  assert.equal(result.status.state, 'requested');
  assert.equal(result.status.canRequest, false);
  assert.deepEqual(db.tables[REQUESTS].map(row => [row.opportunity_id, row.requested_by, row.status]), [['opp-fgn', 'juan', 'pending']]);
  assert.equal(db.tables.psi_agt002_initial_analysis_jobs.length, 1, 'la petición web nunca admite un job');
});

test('un segundo clic no abre otra solicitud', async () => {
  const db = fakeDb(world());
  await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active });
  const again = await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-fgn', requestedBy: 'katherine', now: NOW, inactiveReason: active });
  assert.equal(again.requested, false);
  assert.equal(again.alreadyOpen, true);
  assert.equal(db.tables[REQUESTS].length, 1);
});

for (const [name, overrides, inactive, reason] of [
  ['oportunidad inactiva', {}, async () => 'no_go', 'oportunidad_inactiva'],
  ['análisis en curso', { psi_agt002_initial_analysis_jobs: [{ id: 'j', opportunity_id: 'opp-fgn', status: 'RUNNING' }] }, active, 'analisis_en_curso'],
  ['sin análisis previo', { psi_tender_analysis_runs: [] }, active, 'sin_analisis_previo'],
  ['sin licitación', { psi_public_tenders: [] }, active, 'sin_licitacion'],
]) {
  test(`se rechaza con ${name}`, async () => {
    const db = fakeDb(world(overrides));
    await assert.rejects(
      requestAgt002ManualReanalysis(db, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: inactive }),
      error => error.code === 'AGT002_MANUAL_REANALYSIS_BLOCKED' && error.reason === reason && error.status === 409,
    );
    assert.equal(db.tables[REQUESTS].length, 0);
  });
}

test('la red de seguridad diaria corta por proceso y en total', async () => {
  const admittedToday = (opportunityId, n) => Array.from({ length: n }, (_, i) => ({ id: `${opportunityId}-${i}`, opportunity_id: opportunityId, status: 'admitted', finished_at: '2026-10-20T13:00:00.000Z', job_id: `j${i}` }));
  const perProcess = fakeDb(world({ [REQUESTS]: admittedToday('opp-fgn', AGT002_MANUAL_REANALYSIS_LIMITS.perProcessPerDay) }));
  await assert.rejects(requestAgt002ManualReanalysis(perProcess, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active }), { reason: 'limite_por_proceso' });
  const total = fakeDb(world({ [REQUESTS]: admittedToday('opp-other', AGT002_MANUAL_REANALYSIS_LIMITS.totalPerDay) }));
  await assert.rejects(requestAgt002ManualReanalysis(total, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active }), { reason: 'limite_total' });
  // Los de ayer (hora Bogotá) no cuentan.
  const yesterday = fakeDb(world({ [REQUESTS]: admittedToday('opp-fgn', 3).map(row => ({ ...row, finished_at: '2026-10-20T04:59:00.000Z' })) }));
  assert.equal((await requestAgt002ManualReanalysis(yesterday, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active })).requested, true);
});

test('el host admite un REANALYSIS sucesor del análisis canónico, con quien lo pidió como actor', async () => {
  const db = fakeDb(world());
  await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active });
  const calls = [];
  const admit = async (_db, args) => { calls.push(args); return { admissionStatus: 'admitted', jobId: 'job-re' }; };
  const events = await runAgt002ManualReanalysisRequests(db, { now: NOW, environment: ON, admit, freezeProfile: fakeProfile, selectMembers: fakeMembers, inactiveReason: active });
  assert.deepEqual(events.map(event => event.event), ['agt002_manual_reanalysis_admitted']);
  assert.equal(calls.length, 1);
  const [args] = calls;
  assert.equal(args.analysisKind, 'REANALYSIS');
  assert.equal(args.sourceAnalysisRunId, 'run-6oct');
  assert.equal(args.actorProfileId, 'juan');
  assert.equal(args.tenderId, 't-fgn');
  assert.equal(args.profileSnapshotId, 'snap-juan');
  assert.equal(args.scope, 'A_PLUS_B');
  assert.equal(args.policyVersion, AGT002_AUTO_INITIAL_POLICY_VERSION);
  assert.equal(args.attempt, 'manual-reanalysis:req-1');
  assert.equal(args.expiresAt, '2026-10-22T15:00:00.000Z', 'ventana G1 de 48 h desde la solicitud');
  const [request] = db.tables[REQUESTS];
  assert.equal(request.status, 'admitted');
  assert.equal(request.job_id, 'job-re');
  assert.ok(request.started_at && request.finished_at);
});

test('con los interruptores apagados el host rechaza sin admitir', async () => {
  const db = fakeDb(world());
  await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active });
  let admitted = false;
  const events = await runAgt002ManualReanalysisRequests(db, { now: NOW, environment: {}, admit: async () => { admitted = true; }, freezeProfile: fakeProfile, selectMembers: fakeMembers, inactiveReason: active });
  assert.equal(admitted, false);
  assert.deepEqual(events.map(event => [event.event, event.reason]), [['agt002_manual_reanalysis_rejected', 'analisis_apagado']]);
  assert.equal(db.tables[REQUESTS][0].status, 'rejected');
});

test('el host vuelve a comprobar: si entre el clic y el turno empezó otro análisis, rechaza', async () => {
  const db = fakeDb(world());
  await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active });
  db.tables.psi_agt002_initial_analysis_jobs.push({ id: 'job-phase', opportunity_id: 'opp-fgn', status: 'QUEUED' });
  const events = await runAgt002ManualReanalysisRequests(db, { now: NOW, environment: ON, admit: async () => assert.fail('no debe admitir'), freezeProfile: fakeProfile, selectMembers: fakeMembers, inactiveReason: active });
  assert.deepEqual(events.map(event => event.reason), ['analisis_en_curso']);
  assert.equal(db.tables[REQUESTS][0].reason, 'analisis_en_curso');
});

test('una falla de la admisión queda registrada y no tumba la pasada', async () => {
  const db = fakeDb(world());
  await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active });
  const boom = Object.assign(new Error('runtime'), { code: 'AGT002_RUNTIME_NOT_READY' });
  const events = await runAgt002ManualReanalysisRequests(db, { now: NOW, environment: ON, admit: async () => { throw boom; }, freezeProfile: fakeProfile, selectMembers: fakeMembers, inactiveReason: active });
  assert.deepEqual(events.map(event => [event.event, event.code]), [['agt002_manual_reanalysis_failed', 'AGT002_RUNTIME_NOT_READY']]);
  assert.equal(db.tables[REQUESTS][0].status, 'failed');
});

test('el estado que ve el botón sigue al job hasta terminar', async () => {
  const db = fakeDb(world({ [REQUESTS]: [{ id: 'r1', opportunity_id: 'opp-fgn', requested_by: 'juan', status: 'admitted', requested_at: '2026-10-20T14:00:00.000Z', finished_at: '2026-10-20T14:02:00.000Z', job_id: 'job-re', reason: null }] }));
  db.tables.psi_agt002_initial_analysis_jobs.push({ id: 'job-re', opportunity_id: 'opp-fgn', status: 'RUNNING' });
  let status = await readAgt002ManualReanalysisStatus(db, 'opp-fgn', { now: NOW, inactiveReason: active });
  assert.equal(status.state, 'analyzing');
  assert.equal(status.canRequest, false);
  db.tables.psi_agt002_initial_analysis_jobs.find(job => job.id === 'job-re').status = 'COMPLETED';
  status = await readAgt002ManualReanalysisStatus(db, 'opp-fgn', { now: NOW, inactiveReason: active });
  assert.equal(status.state, 'completed');
  assert.equal(status.canRequest, true);
});

test('sin la migración 138 el botón responde 503 y el host no falla', async () => {
  const db = fakeDb(world());
  const original = db.from.bind(db);
  db.from = name => {
    if (name !== REQUESTS) return original(name);
    const missing = { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${REQUESTS}'` } };
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => missing, then: resolve => resolve(missing) };
    return chain;
  };
  await assert.rejects(readAgt002ManualReanalysisStatus(db, 'opp-fgn'), { code: 'AGT002_MANUAL_REANALYSIS_UNAVAILABLE', status: 503 });
  assert.deepEqual(await runAgt002ManualReanalysisRequests(db, { environment: ON }), [{ event: 'agt002_manual_reanalysis_unavailable' }]);
});

// Primer análisis a mano (Juan, 2026-10-29): la Fiscalía del Eje Cafetero quedó con 12 documentos y sin análisis
// porque la ventana automática se contaba desde la conversión. El mismo botón pide el primero.
const sinAnalisis = (overrides = {}) => world({
  psi_agt002_initial_analysis_jobs: [],
  psi_tender_analysis_runs: [],
  psi_tender_document_versions: [{ id: 'dv-pliego', opportunity_id: 'opp-fgn', current: true }],
  ...overrides,
});

test('sin ningún análisis todavía, el botón pide el PRIMERO y el host lo admite como INITIAL', async () => {
  const db = fakeDb(sinAnalisis());
  const result = await requestAgt002ManualReanalysis(db, { opportunityId: 'opp-fgn', requestedBy: 'katherine', now: NOW, inactiveReason: active });
  assert.equal(result.requested, true);
  const calls = [];
  const admit = async (_db, args) => { calls.push(args); return { admissionStatus: 'admitted', jobId: 'job-first' }; };
  const events = await runAgt002ManualReanalysisRequests(db, { now: NOW, environment: ON, admit, freezeProfile: fakeProfile, selectMembers: fakeMembers, inactiveReason: active });
  assert.deepEqual(events.map(event => event.event), ['agt002_manual_reanalysis_admitted']);
  assert.equal(calls[0].analysisKind, 'INITIAL');
  assert.equal(calls[0].sourceAnalysisRunId, null);
  assert.equal(calls[0].actorProfileId, 'katherine');
  assert.equal(db.tables[REQUESTS][0].status, 'admitted');
});

test('el primero no se pide sin documentos de la entidad, ni cuando ya hubo un análisis admitido', async () => {
  const vacia = fakeDb(sinAnalisis({ psi_tender_document_versions: [] }));
  await assert.rejects(
    requestAgt002ManualReanalysis(vacia, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active }),
    error => error.reason === 'sin_documentos_legibles',
  );
  const yaHubo = fakeDb(sinAnalisis({ psi_agt002_initial_analysis_jobs: [{ id: 'job-fallido', opportunity_id: 'opp-fgn', status: 'FAILED' }] }));
  await assert.rejects(
    requestAgt002ManualReanalysis(yaHubo, { opportunityId: 'opp-fgn', requestedBy: 'juan', now: NOW, inactiveReason: active }),
    error => error.reason === 'sin_analisis_previo',
  );
});

test('el incremental sigue necesitando un análisis vigente que comparar', async () => {
  const db = fakeDb(sinAnalisis());
  await assert.rejects(
    requestAgt002ManualReanalysis(db, { opportunityId: 'opp-fgn', requestedBy: 'juan', mode: 'incremental', now: NOW, inactiveReason: active }),
    error => error.reason === 'sin_analisis_previo',
  );
});
