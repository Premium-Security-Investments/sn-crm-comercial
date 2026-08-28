import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_RADAR_SCAN_STAGES, createAgt002RadarScan } from '../agt002-radar-scan.js';
import { enqueueAgt002RadarPreanalysisJob } from '../agt002-radar-preanalysis-jobs.js';

const NOW = '2026-08-25T15:00:00.000Z';
const TENDER = { id: '22222222-2222-4222-8222-222222222222', stable_key: 'k-1', title: 'Vigilancia', description: 'Armada', source: 'SECOP II', entity: 'E', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación' };
const hostileDatabase = new Proxy({}, { get() { throw new Error('database must not be touched'); } });
const hostile = () => { throw new Error('must not run'); };

// 1. Flag apagado: no-op total. createAgt002RadarScan NO acepta claimJob/runPreanalysis/
//    recordPreanalysisRun/completeJob/failJob como parámetros: ni siquiera existen para inyectar.
for (const environment of [{}, { AGT002_RADAR_GATE: 'false' }, { AGT002_RADAR_GATE: 'yes' }, { AGT002_RADAR_GATE: '' }]) {
  const disabled = createAgt002RadarScan({
    database: hostileDatabase, environment, now: () => NOW,
    fetchTenderPage: hostile, evaluateGate: hostile, recordGateEvaluation: hostile, enqueueJob: hostile,
  });
  assert.deepEqual(await disabled.runOnce(), { status: 'disabled', stages: [], code: 'AGT002_RADAR_SCAN_DISABLED' });
}

// 2. Orden real: esu_refresh -> fetch -> gate -> ledger (x2 filas) -> enqueue (solo la sobreviviente).
const TENDER2 = { id: '33333333-3333-4333-8333-333333333333', stable_key: 'k-2' };
const calls = []; let nowCalls = 0; const gateClockValues = [];
const track = (name, value) => (...args) => { calls.push(name); return typeof value === 'function' ? value(...args) : value; };
const enabledScan = createAgt002RadarScan({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => { nowCalls += 1; return NOW; },
  fetchTenderPage: track('fetch', [TENDER, TENDER2]),
  evaluateGate: track('gate', (row, { nowIso }) => {
    gateClockValues.push(nowIso);
    return row.stable_key === 'k-1'
      ? { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: row.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }
      : { verdict: 'eliminada', rule_ids: ['estado_terminal'], reasons: [{ rule_id: 'estado_terminal' }], data_gaps: [], tender_id: row.id, source_row_hash: 'b'.repeat(64), policy_version: 'p', context_version: 'c' };
  }),
  recordGateEvaluation: track('ledger', value => ({ id: value.tenderId === TENDER.id ? 'gate-1' : 'gate-2' })),
  enqueueJob: track('enqueue', { status: 'created', job_id: 'j1' }),
});
const result = await enabledScan.runOnce();
assert.equal(result.status, 'completed');
assert.equal(result.evaluated, 2);
assert.equal(result.survivors, 1);
assert.equal(result.eliminated, 1);
assert.equal(result.enqueued, 1);
assert.equal(result.satisfied, 0);
assert.equal(result.rejected, 0);
assert.deepEqual([...new Set(calls)], ['fetch', 'gate', 'ledger', 'enqueue']);
assert.deepEqual(result.stages, AGT002_RADAR_SCAN_STAGES);
assert.equal(calls.filter(x => x === 'ledger').length, 2);
assert.equal(calls.filter(x => x === 'enqueue').length, 1);
assert.equal(nowCalls, 1);
assert.deepEqual(gateClockValues, [NOW, NOW]);

// 3. Página vacía -> status 'completed' con evaluated:0 (no existe 'empty' en el scan: no hay claim).
const emptyPage = createAgt002RadarScan({
  database: {}, environment: { AGT002_RADAR_GATE: '1' }, now: () => NOW,
  fetchTenderPage: async () => [], evaluateGate: hostile, recordGateEvaluation: hostile, enqueueJob: hostile,
});
const emptyResult = await emptyPage.runOnce();
assert.equal(emptyResult.status, 'completed');
assert.equal(emptyResult.evaluated, 0);
assert.equal(emptyResult.survivors, 0);
assert.equal(emptyResult.eliminated, 0);
assert.equal(emptyResult.enqueued, 0);
assert.deepEqual(emptyResult.stages, AGT002_RADAR_SCAN_STAGES);

// 4. Fallo de ledger antes de encolar -> status 'unavailable', enqueueJob nunca se llama.
let enqueueCalled = false;
const ledgerBroken = createAgt002RadarScan({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: async () => [TENDER],
  evaluateGate: () => ({ verdict: 'sobreviviente', tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async () => { throw new Error('down'); },
  enqueueJob: () => { enqueueCalled = true; },
});
const ledgerResult = await ledgerBroken.runOnce();
assert.equal(ledgerResult.status, 'unavailable');
assert.equal(ledgerResult.error_code, 'persistence_failure');
assert.equal(enqueueCalled, false);

// 5. Reintento entre corridas: misma fila, mismo día -> misma idempotencyKey de gate;
//    cruce de día calendario Bogota -> idempotencyKey de gate nueva, mismo source_row_hash.
const retryEnqueues = []; const retryGateWrites = [];
const retryTimes = [NOW, '2026-08-25T15:01:00.000Z', '2026-08-26T15:00:00.000Z'];
const retryable = createAgt002RadarScan({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => retryTimes.shift(),
  fetchTenderPage: async () => [TENDER],
  evaluateGate: () => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async (_db, value) => { retryGateWrites.push(value); return { id: 'gate-1' }; },
  enqueueJob: async (_db, value) => { retryEnqueues.push(value); return { status: 'created', job_id: `j${retryEnqueues.length}` }; },
});
assert.equal((await retryable.runOnce()).status, 'completed');
assert.equal((await retryable.runOnce()).status, 'completed');
assert.equal(retryEnqueues.length, 2);
assert.notEqual(retryEnqueues[0].attemptKey, retryEnqueues[1].attemptKey);
assert.notEqual(retryEnqueues[0].idempotencyKey, retryEnqueues[1].idempotencyKey);
assert.equal(retryGateWrites.length, 2);
assert.equal(retryGateWrites[0].idempotencyKey, retryGateWrites[1].idempotencyKey);
assert.notEqual(retryGateWrites[0].evaluatedAt, retryGateWrites[1].evaluatedAt);
assert.equal((await retryable.runOnce()).status, 'completed');
assert.equal(retryGateWrites.length, 3);
assert.notEqual(retryGateWrites[2].idempotencyKey, retryGateWrites[1].idempotencyKey);
assert.equal(retryGateWrites[2].sourceRowHash, retryGateWrites[1].sourceRowHash, 'la identidad diaria no toca el hash de ingesta');

// 6. Un rechazo de encolado de una fila (conflicto 55000) no aborta el lote:
//    la otra fila sigue encolándose y `rejected`/`enqueued` reflejan ambas.
const OTHER = { ...TENDER, id: '55555555-5555-4555-8555-555555555555', stable_key: 'k-other' };
const conflictEnqueues = [];
const conflicting = createAgt002RadarScan({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: async () => [TENDER, OTHER],
  evaluateGate: row => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: row.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async (_db, value) => ({ id: `gate-${value.tenderId}` }),
  enqueueJob: async (_db, value) => {
    conflictEnqueues.push(value.tenderId);
    if (value.tenderId === TENDER.id) { const error = new Error('AGT-002 Radar tender already has a different active job'); error.runtime_boundary_code = 'AGT002_RADAR_PERSISTENCE_FAILURE'; error.database_code = '55000'; throw error; }
    return { status: 'created', job_id: 'j2' };
  },
});
const conflicted = await conflicting.runOnce();
assert.equal(conflicted.status, 'completed');
assert.deepEqual(conflictEnqueues, [TENDER.id, OTHER.id], 'un rechazo no debe cortar el resto del lote');
assert.equal(conflicted.rejected, 1);
assert.equal(conflicted.enqueued, 1);

// 7. Fallo de encolado genérico (no 55000) NO se cuenta como rechazo esperado por fila: aborta el
//    lote entero de forma visible (persistence_failure) y no sigue intentando las filas restantes,
//    a diferencia del conflicto 55000 de la prueba 6.
const genericEnqueueCalls = [];
const genericFailureUnit = createAgt002RadarScan({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: async () => [TENDER, OTHER],
  evaluateGate: row => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: row.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async (_db, value) => ({ id: `gate-${value.tenderId}` }),
  enqueueJob: async (_db, value) => {
    genericEnqueueCalls.push(value.tenderId);
    const error = new Error('connection failure');
    error.database_code = '08006';
    throw error;
  },
});
const genericFailureUnitResult = await genericFailureUnit.runOnce();
assert.equal(genericFailureUnitResult.status, 'unavailable');
assert.equal(genericFailureUnitResult.error_code, 'persistence_failure');
assert.equal(genericFailureUnitResult.rejected, 0, 'un fallo de infraestructura no debe disfrazarse de rechazo por fila');
assert.deepEqual(genericEnqueueCalls, [TENDER.id], 'un fallo no-55000 aborta el lote: la segunda fila no se intenta');

// 8. Camino real: el adapter por defecto (enqueueAgt002RadarPreanalysisJob) envuelve un error
//    PostgREST genérico (no 55000, p.ej. una caída de conexión) preservando su código/mensaje en
//    el Error envuelto, pero el scan nunca filtra ese texto crudo al resultado.
const genericRpcCalls = [];
const genericFailureDb = { rpc: async (name, args) => { genericRpcCalls.push(name); return { data: null, error: { code: '08006', message: 'connection failure' } }; } };
const genericFailureAdapterScan = createAgt002RadarScan({
  database: genericFailureDb, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: async () => [TENDER],
  evaluateGate: row => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: row.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async (_db, value) => ({ id: `gate-${value.tenderId}` }),
  enqueueJob: enqueueAgt002RadarPreanalysisJob,
});
const genericFailureAdapterResult = await genericFailureAdapterScan.runOnce();
assert.equal(genericFailureAdapterResult.status, 'unavailable');
assert.equal(genericFailureAdapterResult.error_code, 'persistence_failure');
assert.equal(genericFailureAdapterResult.rejected, 0);
assert.deepEqual(genericRpcCalls, ['psi_enqueue_agt002_radar_preanalysis_job']);
const genericFailureSerialized = JSON.stringify(genericFailureAdapterResult);
assert.ok(!genericFailureSerialized.includes('connection failure'), 'el texto crudo del error no debe filtrarse al resultado');
assert.ok(!genericFailureSerialized.includes('08006'));

// 9. Camino real: el adapter por defecto reconoce el conflicto PostgREST 55000 exacto
//    (`psi_enqueue_agt002_radar_preanalysis_job`) como rechazo esperado de ESA fila y sigue
//    encolando el resto del lote.
const conflictAdapterCalls = [];
const conflictAdapterDb = {
  rpc: async (_name, args) => {
    conflictAdapterCalls.push(args.p_tender_id);
    if (args.p_tender_id === TENDER.id) return { data: null, error: { code: '55000', message: 'AGT-002 Radar tender already has a different active job' } };
    return { data: { status: 'created', job_id: 'j-adapter' }, error: null };
  },
};
const conflictAdapterScan = createAgt002RadarScan({
  database: conflictAdapterDb, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: async () => [TENDER, OTHER],
  evaluateGate: row => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: row.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async (_db, value) => ({ id: `gate-${value.tenderId}` }),
  enqueueJob: enqueueAgt002RadarPreanalysisJob,
});
const conflictAdapterResult = await conflictAdapterScan.runOnce();
assert.equal(conflictAdapterResult.status, 'completed');
assert.equal(conflictAdapterResult.rejected, 1);
assert.equal(conflictAdapterResult.enqueued, 1);
assert.deepEqual(conflictAdapterCalls, [TENDER.id, OTHER.id], 'el conflicto esperado no debe cortar el resto del lote');

// 10. Código 55000 con un mensaje distinto NO es el conflicto esperado: el predicado es exacto,
//     así que se propaga como fallo genérico y el lote falla visible.
const wrongMessageDb = { rpc: async () => ({ data: null, error: { code: '55000', message: 'some other semantic conflict' } }) };
const wrongMessageScan = createAgt002RadarScan({
  database: wrongMessageDb, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: async () => [TENDER],
  evaluateGate: row => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: row.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async (_db, value) => ({ id: `gate-${value.tenderId}` }),
  enqueueJob: enqueueAgt002RadarPreanalysisJob,
});
const wrongMessageResult = await wrongMessageScan.runOnce();
assert.equal(wrongMessageResult.status, 'unavailable');
assert.equal(wrongMessageResult.error_code, 'persistence_failure');
assert.equal(wrongMessageResult.rejected, 0);

// 11. Mensaje exacto con un código distinto de 55000 tampoco es el conflicto esperado.
const wrongCodeDb = { rpc: async () => ({ data: null, error: { code: '23505', message: 'AGT-002 Radar tender already has a different active job' } }) };
const wrongCodeScan = createAgt002RadarScan({
  database: wrongCodeDb, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: async () => [TENDER],
  evaluateGate: row => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: row.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async (_db, value) => ({ id: `gate-${value.tenderId}` }),
  enqueueJob: enqueueAgt002RadarPreanalysisJob,
});
const wrongCodeResult = await wrongCodeScan.runOnce();
assert.equal(wrongCodeResult.status, 'unavailable');
assert.equal(wrongCodeResult.error_code, 'persistence_failure');
assert.equal(wrongCodeResult.rejected, 0);

// 12. Superficie cerrada: el scan JAMÁS puede llamar al modelo ni reclamar un job,
//    porque esos parámetros no existen en su firma.
const source = readFileSync(new URL('../agt002-radar-scan.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /claimJob|runPreanalysis|recordPreanalysisRun|completeJob|failJob/);
assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/);

console.log('AGT-002 Radar daily scan (no claim, no model) passed');
