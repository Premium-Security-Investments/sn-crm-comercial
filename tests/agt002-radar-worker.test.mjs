import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_RADAR_WORKER_STAGES, createAgt002RadarWorker } from '../agt002-radar-worker.js';
import { AGT002_RADAR_QUEUE_ERROR_CODES } from '../agt002-radar-preanalysis-worker.js';

const NOW = '2026-08-25T15:00:00.000Z';
const TENDER = { id: '22222222-2222-4222-8222-222222222222', stable_key: 'k-1', title: 'Vigilancia', description: 'Armada', source: 'SECOP II', entity: 'E', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación' };
const JOB = { jobId: 'j1', leaseId: 'l1', tenderId: TENDER.id, gateEvaluationId: 'gate-old', attemptKey: 'a1', sourceRowHash: 'a'.repeat(64), policyVersion: 'p', contextVersion: 'c' };
const hostileDatabase = new Proxy({}, { get() { throw new Error('database must not be touched'); } });
const hostile = () => { throw new Error('must not run'); };

// 1. Flag apagado: no-op total, ni siquiera intenta reclamar.
for (const environment of [{}, { AGT002_RADAR_GATE: 'false' }]) {
  const disabled = createAgt002RadarWorker({
    database: hostileDatabase, environment, now: () => NOW,
    claimJob: hostile, fetchTenderRow: hostile, evaluateGate: hostile, recordGateEvaluation: hostile,
    completeJob: hostile, failJob: hostile, projectLearningObservations: hostile, buildLearningSignals: hostile,
    runPreanalysis: hostile, recordPreanalysisRun: hostile,
  });
  assert.deepEqual(await disabled.runOnce(), { status: 'disabled', stages: [], code: 'AGT002_RADAR_WORKER_DISABLED' });
}

// 2. Cola vacía: la ÚNICA operación contra la base es claimJob. El reloj se valida ANTES de
//    reclamar (spec §6.2.1/A10): es una función pura inyectada, no una operación contra la base.
let claimCalls = 0, nowCalls = 0;
const idle = createAgt002RadarWorker({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => { nowCalls += 1; return NOW; },
  claimJob: async () => { claimCalls += 1; return null; },
  fetchTenderRow: hostile, evaluateGate: hostile, recordGateEvaluation: hostile,
  completeJob: hostile, failJob: hostile, projectLearningObservations: hostile,
  buildLearningSignals: hostile, runPreanalysis: hostile, recordPreanalysisRun: hostile,
});
assert.deepEqual(await idle.runOnce(), { status: 'empty', stages: ['claim'] });
assert.equal(claimCalls, 1);
assert.equal(nowCalls, 1, 'el reloj se valida una sola vez, antes de reclamar');

// 2b. Reloj inválido: no se reclama nada, no queda job abierto, retorno byte-idéntico al de hoy.
for (const badNow of [() => 'no-es-fecha', () => 42, () => { throw new Error('reloj roto'); }]) {
  const broken = createAgt002RadarWorker({
    database: hostileDatabase, environment: { AGT002_RADAR_GATE: 'true' }, now: badNow,
    claimJob: hostile, fetchTenderRow: hostile, evaluateGate: hostile, recordGateEvaluation: hostile,
    completeJob: hostile, failJob: hostile, projectLearningObservations: hostile,
    buildLearningSignals: hostile, runPreanalysis: hostile, recordPreanalysisRun: hostile,
  });
  assert.deepEqual(await broken.runOnce(), { status: 'unavailable', stages: [], error_code: 'provider_error' });
}

// 2c. claimJob lanza -> persistence_failure, sin job abierto, failJob nunca se llama.
const claimBroken = createAgt002RadarWorker({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  claimJob: async () => { throw new Error('down'); },
  fetchTenderRow: hostile, evaluateGate: hostile, recordGateEvaluation: hostile, completeJob: hostile,
  failJob: hostile, projectLearningObservations: hostile, buildLearningSignals: hostile,
  runPreanalysis: hostile, recordPreanalysisRun: hostile,
});
assert.deepEqual(await claimBroken.runOnce(), { status: 'unavailable', stages: ['claim'], error_code: 'persistence_failure' });

// 3. Camino feliz: claim -> fetch_row (una fila, por id) -> gate -> ledger -> learning -> agt -> persist -> complete.
const stages = [];
const track = (name, value) => (...args) => { stages.push(name); return typeof value === 'function' ? value(...args) : value; };
const happy = createAgt002RadarWorker({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  claimJob: track('claim', JOB),
  fetchTenderRow: track('fetch_row', (_db, { id }) => { assert.equal(id, TENDER.id); return TENDER; }),
  evaluateGate: track('gate', { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: JOB.policyVersion, context_version: JOB.contextVersion }),
  recordGateEvaluation: track('ledger', { id: 'gate-fresh' }),
  projectLearningObservations: track('learning', { precedents: [] }),
  buildLearningSignals: track('signals', ({ candidate, maxSignals }) => { assert.equal(candidate.tender_id, TENDER.id); assert.equal(maxSignals, 10); return { version: 'agt002-radar-learning-v1', candidate_id: TENDER.id, max_signals: 10, considered: 0, signals: [] }; }),
  runPreanalysis: track('agt', { status: 'completed', visibility_verdict: 'mostrar_en_radar', evidence: [{ evidence_id: 'e' }], usage: {} }),
  recordPreanalysisRun: track('persist', { id: 'r1', canonical: true }),
  completeJob: track('complete', { status: 'completed' }),
  failJob: hostile,
});
const result = await happy.runOnce();
assert.equal(result.status, 'completed');
assert.equal(result.job_id, 'j1');
assert.equal(result.preanalysis_run_id, 'r1');
assert.deepEqual([...new Set(stages)], ['claim', 'fetch_row', 'gate', 'ledger', 'learning', 'signals', 'agt', 'persist', 'complete']);
assert.deepEqual(result.stages, AGT002_RADAR_WORKER_STAGES);

// 4. Las cuatro divergencias -> stale_input, SIN aprendizaje, SIN modelo, SIN persistencia.
for (const [label, evaluation] of [
  ['eliminada', { verdict: 'eliminada', rule_ids: ['fecha_vencida'], reasons: [{ rule_id: 'fecha_vencida' }], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: JOB.policyVersion, context_version: JOB.contextVersion }],
  ['hash cambiado', { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: 'e'.repeat(64), policy_version: JOB.policyVersion, context_version: JOB.contextVersion }],
  ['policy cambiada', { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: 'p2', context_version: JOB.contextVersion }],
  ['context cambiado', { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: JOB.policyVersion, context_version: 'c2' }],
]) {
  let failedCode; const touched = [];
  const stale = createAgt002RadarWorker({
    database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
    claimJob: async () => JOB, fetchTenderRow: async () => TENDER,
    evaluateGate: () => evaluation, recordGateEvaluation: async () => ({ id: 'gate-fresh' }),
    projectLearningObservations: async () => { touched.push('learning'); return {}; },
    buildLearningSignals: () => { touched.push('signals'); return {}; },
    runPreanalysis: async () => { touched.push('agt'); return {}; },
    recordPreanalysisRun: async () => { touched.push('persist'); return {}; },
    completeJob: async () => { touched.push('complete'); },
    failJob: async (_db, { errorCode }) => { failedCode = errorCode; },
  });
  const staleResult = await stale.runOnce();
  assert.equal(staleResult.status, 'unavailable', label);
  assert.equal(staleResult.error_code, 'stale_input', label);
  assert.equal(failedCode, 'stale_input', label);
  assert.deepEqual(touched, [], `${label}: ni aprendizaje ni modelo ni persistencia`);
}

// 5. Fila ausente (fetchTenderRow devuelve null) -> stale_input, mismo cierre, sin tocar gate/ledger.
let absentCode;
const absent = createAgt002RadarWorker({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  claimJob: async () => JOB, fetchTenderRow: async () => null,
  evaluateGate: hostile, recordGateEvaluation: hostile,
  projectLearningObservations: hostile, buildLearningSignals: hostile,
  runPreanalysis: hostile, recordPreanalysisRun: hostile, completeJob: hostile,
  failJob: async (_db, { errorCode }) => { absentCode = errorCode; },
});
assert.equal((await absent.runOnce()).error_code, 'stale_input');
assert.equal(absentCode, 'stale_input');

// 6. Fallo de aprendizaje: el job se cierra, el modelo NUNCA se llama. La proyección relanza el
//    error crudo de Supabase (sin runtime_boundary_code), así que el clasificador cae a 'provider_error'.
let learningFailCode; const learningTouched = [];
const learningBroken = createAgt002RadarWorker({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  claimJob: async () => JOB, fetchTenderRow: async () => TENDER,
  evaluateGate: () => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: JOB.policyVersion, context_version: JOB.contextVersion }),
  recordGateEvaluation: async () => ({ id: 'gate-fresh' }),
  projectLearningObservations: async () => { throw new Error('down'); },
  buildLearningSignals: hostile,
  runPreanalysis: async () => { learningTouched.push('agt'); return {}; },
  recordPreanalysisRun: async () => { learningTouched.push('persist'); return {}; },
  completeJob: async () => { learningTouched.push('complete'); },
  failJob: async (_db, { errorCode }) => { learningFailCode = errorCode; },
});
const learningResult = await learningBroken.runOnce();
assert.equal(learningResult.status, 'unavailable');
assert.equal(learningResult.error_code, 'provider_error');
assert.equal(learningFailCode, 'provider_error');
assert.deepEqual(learningTouched, []);

// 7. Nunca hay fetch de página completa: fetchTenderRow SIEMPRE se llama con {id: job.tenderId}.
const rowFetchArgsGuarded = createAgt002RadarWorker({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  claimJob: async () => JOB,
  fetchTenderRow: async (_db, args) => { assert.deepEqual(Object.keys(args), ['id']); return TENDER; },
  evaluateGate: () => ({ verdict: 'eliminada', rule_ids: ['fecha_vencida'], reasons: [{ rule_id: 'fecha_vencida' }], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: JOB.policyVersion, context_version: JOB.contextVersion }),
  recordGateEvaluation: async () => ({ id: 'gate-fresh' }),
  projectLearningObservations: hostile, buildLearningSignals: hostile, runPreanalysis: hostile, recordPreanalysisRun: hostile, completeJob: hostile,
  failJob: async () => {},
});
await rowFetchArgsGuarded.runOnce();

// 8. Sin reloj propio.
const source = readFileSync(new URL('../agt002-radar-worker.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/);

// 9/10. Con un job reclamado, NINGÚN camino de retorno sale sin cerrar el job, y el error_code
//       siempre pertenece al dominio congelado de AGT002_RADAR_QUEUE_ERROR_CODES.
const baseHappyDeps = {
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  claimJob: async () => JOB, fetchTenderRow: async () => TENDER,
  evaluateGate: () => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: JOB.policyVersion, context_version: JOB.contextVersion }),
  recordGateEvaluation: async () => ({ id: 'gate-fresh' }),
  projectLearningObservations: async () => ({ precedents: [] }),
  buildLearningSignals: () => ({ version: 'v1', signals: [] }),
  runPreanalysis: async () => ({ status: 'completed', visibility_verdict: 'mostrar_en_radar', evidence: [{ evidence_id: 'e' }], usage: {} }),
  recordPreanalysisRun: async () => ({ id: 'r1' }),
  completeJob: async () => ({ status: 'completed' }),
};
const FAILURE_POINTS = [
  ['fetch_row lanza', { fetchTenderRow: async () => { throw new Error('down'); } }],
  ['ledger lanza', { recordGateEvaluation: async () => { throw new Error('down'); } }],
  ['learning lanza', { projectLearningObservations: async () => { throw new Error('down'); } }],
  ['agt lanza', { runPreanalysis: async () => { throw new Error('down'); } }],
  ['persist lanza', { recordPreanalysisRun: async () => { throw new Error('down'); } }],
];
for (const [label, overrides] of FAILURE_POINTS) {
  let failCalls = 0, seenCode;
  const w = createAgt002RadarWorker({
    ...baseHappyDeps, ...overrides,
    failJob: async (_db, { jobId, leaseId, errorCode }) => {
      failCalls += 1; seenCode = errorCode;
      assert.equal(jobId, JOB.jobId); assert.equal(leaseId, JOB.leaseId);
    },
  });
  const r = await w.runOnce();
  assert.equal(failCalls, 1, `${label}: el job reclamado debe cerrarse exactamente una vez`);
  assert.equal(r.status, 'unavailable', label);
  assert.ok(AGT002_RADAR_QUEUE_ERROR_CODES.includes(seenCode), `${label}: ${seenCode} fuera de dominio`);
  assert.ok(AGT002_RADAR_QUEUE_ERROR_CODES.includes(r.error_code), `${label}: ${r.error_code} fuera de dominio`);
}

// 9c. completeJob lanza tras persist exitoso: failJob se llama exactamente una vez con un
//     error_code del dominio congelado y el worker retorna 'unavailable'.
{
  let failCalls = 0, seenCode;
  const w = createAgt002RadarWorker({
    ...baseHappyDeps,
    completeJob: async () => { throw new Error('complete down'); },
    failJob: async (_db, { jobId, leaseId, errorCode }) => {
      failCalls += 1; seenCode = errorCode;
      assert.equal(jobId, JOB.jobId); assert.equal(leaseId, JOB.leaseId);
    },
  });
  const r = await w.runOnce();
  assert.equal(failCalls, 1, 'completeJob lanza: failJob se llama exactamente una vez');
  assert.equal(r.status, 'unavailable');
  assert.ok(AGT002_RADAR_QUEUE_ERROR_CODES.includes(seenCode), `completeJob lanza: ${seenCode} fuera de dominio`);
  assert.ok(AGT002_RADAR_QUEUE_ERROR_CODES.includes(r.error_code), `completeJob lanza: ${r.error_code} fuera de dominio`);
}

// 9d. completeJob lanza Y failJob también lanza: el worker NUNCA debe rechazar la promesa de
//     runOnce(); debe resolver 'unavailable'/'persistence_failure' igual que hoy con los demás
//     puntos de fallo (línea 88-89 de agt002-radar-worker.js ya envuelve el failJob de cierre).
{
  const w = createAgt002RadarWorker({
    ...baseHappyDeps,
    completeJob: async () => { throw new Error('complete down'); },
    failJob: async () => { throw new Error('fail down too'); },
  });
  const r = await w.runOnce();
  assert.deepEqual(r, { status: 'unavailable', stages: AGT002_RADAR_WORKER_STAGES, job_id: JOB.jobId, error_code: 'persistence_failure' });
}

// 10b. defaultFetchTenderRow (sin override) envuelve fallos de base con persistence_failure,
//      igual patrón `persistenceError` que agt002-radar-preanalysis-jobs.js.
let defaultRowFailCode;
const dbThatFailsRowFetch = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: new Error('db down') }) }) }) }) };
const defaultRowFetch = createAgt002RadarWorker({
  database: dbThatFailsRowFetch, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  claimJob: async () => JOB,
  evaluateGate: hostile, recordGateEvaluation: hostile, projectLearningObservations: hostile,
  buildLearningSignals: hostile, runPreanalysis: hostile, recordPreanalysisRun: hostile, completeJob: hostile,
  failJob: async (_db, { errorCode }) => { defaultRowFailCode = errorCode; },
});
const defaultRowResult = await defaultRowFetch.runOnce();
assert.equal(defaultRowResult.error_code, 'persistence_failure');
assert.equal(defaultRowFailCode, 'persistence_failure');

// 11. El worker NO importa el módulo combinado ni lo reconstruye.
assert.doesNotMatch(source, /agt002-radar-pipeline|createAgt002RadarPipeline/);

// 12. El módulo combinado sigue existiendo y sigue exportando su superficie: es el artefacto de
//     compatibilidad/rollback, no un residuo a limpiar.
const { AGT002_RADAR_PIPELINE_STAGES, createAgt002RadarPipeline } = await import('../agt002-radar-pipeline.js');
assert.equal(typeof createAgt002RadarPipeline, 'function');
assert.deepEqual(AGT002_RADAR_PIPELINE_STAGES, ['esu_refresh', 'fetch', 'gate', 'ledger', 'claim', 'learning', 'agt', 'persist']);

console.log('AGT-002 Radar claim-first queue worker passed');
