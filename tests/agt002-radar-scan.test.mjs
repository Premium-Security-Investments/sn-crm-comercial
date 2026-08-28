import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_RADAR_SCAN_STAGES, createAgt002RadarScan } from '../agt002-radar-scan.js';
import { enqueueAgt002RadarPreanalysisJob } from '../agt002-radar-preanalysis-jobs.js';
import { computeAgt002RadarSourceRowHash } from '../agt002-radar-gate.js';

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

// ---------------------------------------------------------------------------------------------
// AGT-002 hotfix: reanálisis causado EXCLUSIVAMENTE por los derivados diarios raw.days/raw.window.
// El recolector diario externo recalcula esos dos campos; como `raw` entero entra en
// `source_row_hash`, la fila cambia de identidad todos los días sin que cambie nada material y el
// corto circuito `satisfied` del RPC deja de aplicar. Estas pruebas fijan el comportamiento
// transicional: si el canónico vigente se reproduce cambiando SÓLO esos dos campos a una variante
// histórica válida, no se encola y se cuenta aparte.
// ---------------------------------------------------------------------------------------------
const URGENTE = 'urgente (0-7 días)';
const RAPIDO = 'revisar rápido (8-15 días)';
const BUENA = 'buena ventana (16-30 días)';
const churnRow = (id, raw, overrides = {}) => ({
  id, stable_key: `k-${id}`, source: 'SECOP II', entity: 'Alcaldía', title: 'Vigilancia armada',
  status: 'Convocado', deadline_at: '2026-09-05T00:00:00+00:00', url: 'https://example.gov.co/p/1',
  ...overrides, raw,
});
const canonicalRun = (tenderId, sourceRowHash, overrides = {}) => ({
  id: `run-${tenderId}`, tender_id: tenderId, canonical: true, status: 'completed',
  policy_version: 'p', context_version: 'c', source_row_hash: sourceRowHash, ...overrides,
});
const historic = (baseRow, days, window) => ({ ...baseRow, raw: { ...baseRow.raw, days, window } });
const hostileFrom = { from: () => { throw new Error('el scan debe leer canónicos por el lector inyectado'); } };

function churnScan({ rows, canonicalRows = [], readCanonicalPreanalysis } = {}) {
  const enqueues = []; const reads = [];
  const scan = createAgt002RadarScan({
    database: hostileFrom, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
    fetchTenderPage: async () => rows,
    evaluateGate: row => ({
      verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: row.id,
      source_row_hash: computeAgt002RadarSourceRowHash(row), policy_version: 'p', context_version: 'c',
    }),
    recordGateEvaluation: async (_db, value) => ({ id: `gate-${value.tenderId}` }),
    enqueueJob: async (_db, value) => { enqueues.push(value.tenderId); return { status: 'created', job_id: `j-${value.tenderId}` }; },
    readCanonicalPreanalysis: readCanonicalPreanalysis || (async (_db, ids) => { reads.push(ids); return canonicalRows; }),
  });
  return { scan, enqueues, reads };
}

const CHURN_ID = '44444444-4444-4444-8444-444444444444';
const CHURN_RAW = { modalidad_de_contratacion: 'Licitación pública', objeto: 'Vigilancia', days: 11, window: RAPIDO };
const CHURN_ROW = churnRow(CHURN_ID, CHURN_RAW);
const CHURN_PREVIOUS_HASH = computeAgt002RadarSourceRowHash(historic(CHURN_ROW, 12, RAPIDO));

// 13. Canónico previo reproducible SÓLO por days/window -> no se encola y se cuenta aparte.
{
  const { scan, enqueues, reads } = churnScan({ rows: [CHURN_ROW], canonicalRows: [canonicalRun(CHURN_ID, CHURN_PREVIOUS_HASH)] });
  const churnResult = await scan.runOnce();
  assert.equal(churnResult.status, 'completed');
  assert.equal(churnResult.survivors, 1);
  assert.equal(churnResult.satisfied_derived_only, 1);
  assert.equal(churnResult.enqueued, 0);
  assert.equal(churnResult.satisfied, 0, 'el contador del corto circuito del RPC no se contamina');
  assert.equal(churnResult.rejected, 0);
  assert.deepEqual(enqueues, [], 'un cambio puramente derivado no encola');
  assert.deepEqual(reads, [[CHURN_ID]]);
  assert.deepEqual(churnResult.stages, AGT002_RADAR_SCAN_STAGES, 'el contrato de etapas no cambia');
}

// 14. Diferencia material (estado, cierre, título, URL o raw adicional) -> se encola normalmente.
for (const [label, canonicalSource] of [
  ['status', { ...historic(CHURN_ROW, 12, RAPIDO), status: 'Cerrado' }],
  ['deadline_at', { ...historic(CHURN_ROW, 12, RAPIDO), deadline_at: '2026-10-05T00:00:00+00:00' }],
  ['title', { ...historic(CHURN_ROW, 12, RAPIDO), title: 'Otro objeto' }],
  ['url', { ...historic(CHURN_ROW, 12, RAPIDO), url: 'https://example.gov.co/p/2' }],
  ['raw extra', { ...CHURN_ROW, raw: { ...CHURN_RAW, days: 12, window: RAPIDO, nuevo_campo: 'x' } }],
]) {
  const { scan, enqueues } = churnScan({ rows: [CHURN_ROW], canonicalRows: [canonicalRun(CHURN_ID, computeAgt002RadarSourceRowHash(canonicalSource))] });
  const materialResult = await scan.runOnce();
  assert.equal(materialResult.status, 'completed');
  assert.equal(materialResult.satisfied_derived_only, 0, `${label} es una diferencia material`);
  assert.equal(materialResult.enqueued, 1, `${label} debe encolarse`);
  assert.deepEqual(enqueues, [CHURN_ID]);
}

// 15. Sin canónico -> se encola.
{
  const { scan, enqueues, reads } = churnScan({ rows: [CHURN_ROW], canonicalRows: [] });
  const noCanonical = await scan.runOnce();
  assert.equal(noCanonical.satisfied_derived_only, 0);
  assert.equal(noCanonical.enqueued, 1);
  assert.deepEqual(enqueues, [CHURN_ID]);
  assert.deepEqual(reads, [[CHURN_ID]], 'la fila sí tenía forma derivada: la consulta bulk se hace');
}

// 16. policy_version / context_version distintos -> se encola aunque el hash se reprodujera.
for (const overrides of [{ policy_version: 'p-vieja' }, { context_version: 'c-vieja' }]) {
  const { scan, enqueues } = churnScan({ rows: [CHURN_ROW], canonicalRows: [canonicalRun(CHURN_ID, CHURN_PREVIOUS_HASH, overrides)] });
  const versionResult = await scan.runOnce();
  assert.equal(versionResult.satisfied_derived_only, 0, JSON.stringify(overrides));
  assert.equal(versionResult.enqueued, 1);
  assert.deepEqual(enqueues, [CHURN_ID]);
}

// 17. days/window ausente, inválido o inconsistente -> se encola, y ni siquiera se consulta el
//     canónico: una fila sin la forma derivada exacta nunca puede explicarse por deriva diaria.
for (const [label, raw] of [
  ['sin days', { objeto: 'Vigilancia', window: RAPIDO }],
  ['sin window', { objeto: 'Vigilancia', days: 11 }],
  ['days no entero', { objeto: 'Vigilancia', days: '11', window: RAPIDO }],
  ['days null', { objeto: 'Vigilancia', days: null, window: 'sin fecha de cierre reportada' }],
  ['window inconsistente', { objeto: 'Vigilancia', days: 11, window: URGENTE }],
  ['raw ausente', null],
  ['raw array', [{ days: 11, window: RAPIDO }]],
]) {
  const shapelessRow = churnRow(CHURN_ID, raw);
  const { scan, enqueues, reads } = churnScan({ rows: [shapelessRow], canonicalRows: [canonicalRun(CHURN_ID, computeAgt002RadarSourceRowHash(shapelessRow))] });
  const shapelessResult = await scan.runOnce();
  assert.equal(shapelessResult.satisfied_derived_only, 0, label);
  assert.equal(shapelessResult.enqueued, 1, label);
  assert.deepEqual(enqueues, [CHURN_ID], label);
  assert.deepEqual(reads, [], `${label}: sin forma derivada no se paga la consulta bulk`);
}

// 18. Cruce de etiqueta 7 -> 8 y 15 -> 16 a través del scan completo.
for (const [days, window, historicDays, historicWindow] of [[7, URGENTE, 8, RAPIDO], [15, RAPIDO, 16, BUENA]]) {
  const bandRow = churnRow(CHURN_ID, { objeto: 'Vigilancia', days, window });
  const { scan, enqueues } = churnScan({ rows: [bandRow], canonicalRows: [canonicalRun(CHURN_ID, computeAgt002RadarSourceRowHash(historic(bandRow, historicDays, historicWindow)))] });
  const bandResult = await scan.runOnce();
  assert.equal(bandResult.satisfied_derived_only, 1, `${days} -> ${historicDays}`);
  assert.equal(bandResult.enqueued, 0);
  assert.deepEqual(enqueues, []);
  // La etiqueta debe corresponder al days histórico; una banda que no corresponde se encola.
  const mislabeled = churnScan({ rows: [bandRow], canonicalRows: [canonicalRun(CHURN_ID, computeAgt002RadarSourceRowHash(historic(bandRow, historicDays, window)))] });
  const mislabeledResult = await mislabeled.scan.runOnce();
  assert.equal(mislabeledResult.satisfied_derived_only, 0, `${days} -> ${historicDays} con etiqueta vieja`);
  assert.equal(mislabeledResult.enqueued, 1);
}

// 19. La fila original nunca se muta (congelada en profundidad y comparada por estructura).
{
  const frozenRaw = Object.freeze({ ...CHURN_RAW, anidado: Object.freeze({ a: 1 }) });
  const frozenRow = Object.freeze(churnRow(CHURN_ID, frozenRaw));
  const snapshot = JSON.stringify(frozenRow);
  const { scan } = churnScan({ rows: [frozenRow], canonicalRows: [canonicalRun(CHURN_ID, computeAgt002RadarSourceRowHash({ ...frozenRow, raw: { ...frozenRaw, days: 14, window: RAPIDO } }))] });
  const frozenResult = await scan.runOnce();
  assert.equal(frozenResult.satisfied_derived_only, 1);
  assert.equal(JSON.stringify(frozenRow), snapshot, 'el scan no puede mutar la fila de origen');
  assert.equal(frozenRow.raw, frozenRaw);
  assert.equal(frozenRow.raw.days, 11);
  assert.equal(frozenRow.raw.window, RAPIDO);
}

// 20. Un fallo del lookup canónico es técnico, no un rechazo de negocio: falla el scan completo
//     con persistence_failure y NUNCA se encola sobre evidencia que no se pudo leer.
{
  const { scan, enqueues } = churnScan({ rows: [CHURN_ROW], readCanonicalPreanalysis: async () => { throw new Error('canonical lookup down'); } });
  const lookupFailure = await scan.runOnce();
  assert.equal(lookupFailure.status, 'unavailable');
  assert.equal(lookupFailure.error_code, 'persistence_failure');
  assert.equal(lookupFailure.satisfied_derived_only, 0);
  assert.equal(lookupFailure.rejected, 0, 'un fallo de lookup no se disfraza de rechazo por fila');
  assert.deepEqual(enqueues, []);
  assert.ok(!JSON.stringify(lookupFailure).includes('canonical lookup down'));
}
// Una forma de retorno inesperada del lector tampoco se interpreta: falla cerrado.
for (const broken of [null, undefined, { rows: [] }, 'x']) {
  const { scan, enqueues } = churnScan({ rows: [CHURN_ROW], readCanonicalPreanalysis: async () => broken });
  const brokenResult = await scan.runOnce();
  assert.equal(brokenResult.status, 'unavailable', JSON.stringify(broken));
  assert.equal(brokenResult.error_code, 'persistence_failure');
  assert.deepEqual(enqueues, []);
}

// 21. Carga bulk, no N+1: una sola llamada al lector con todos los ids candidatos del lote, y un
//     lote mixto contabiliza cada desenlace por separado.
{
  const materialId = '55555555-5555-4555-8555-555555555555';
  const shapelessId = '66666666-6666-4666-8666-666666666666';
  const churnB = churnRow(materialId, { objeto: 'Otro', days: 3, window: URGENTE });
  const shapeless = churnRow(shapelessId, { objeto: 'Sin derivados' });
  const { scan, enqueues, reads } = churnScan({
    rows: [CHURN_ROW, churnB, shapeless],
    canonicalRows: [
      canonicalRun(CHURN_ID, CHURN_PREVIOUS_HASH),
      canonicalRun(materialId, computeAgt002RadarSourceRowHash({ ...historic(churnB, 4, URGENTE), status: 'Cerrado' })),
    ],
  });
  const bulkResult = await scan.runOnce();
  assert.equal(reads.length, 1, 'una sola consulta para todo el lote');
  assert.deepEqual(reads[0], [CHURN_ID, materialId], 'sólo se consultan los ids con forma derivada');
  assert.equal(bulkResult.survivors, 3);
  assert.equal(bulkResult.satisfied_derived_only, 1);
  assert.equal(bulkResult.enqueued, 2);
  assert.deepEqual(enqueues, [materialId, shapelessId]);
}

// 22. Dos canónicas para la misma licitación es una forma extraña (072 declara índice único):
//     se cierra el camino y esa licitación se encola.
{
  const { scan, enqueues } = churnScan({
    rows: [CHURN_ROW],
    canonicalRows: [canonicalRun(CHURN_ID, CHURN_PREVIOUS_HASH), canonicalRun(CHURN_ID, CHURN_PREVIOUS_HASH, { id: 'run-dup' })],
  });
  const duplicateResult = await scan.runOnce();
  assert.equal(duplicateResult.satisfied_derived_only, 0);
  assert.equal(duplicateResult.enqueued, 1);
  assert.deepEqual(enqueues, [CHURN_ID]);
}

// 23. Superficie de lectura: el scan obtiene canónicos SÓLO por el lector bulk ya existente
//     (`readAgt002RadarCanonicalPreanalysis`, que usa el cliente Supabase inyectado). No construye
//     URLs, no lee credenciales, no arma cabeceras y no imprime nada.
const scanSource = readFileSync(new URL('../agt002-radar-scan.js', import.meta.url), 'utf8');
assert.match(scanSource, /readAgt002RadarCanonicalPreanalysis/);
assert.doesNotMatch(scanSource, /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON|apikey|Authorization|Bearer|createClient|fetch\(|console\./);
assert.doesNotMatch(scanSource, /https?:\/\//);
// El runner sigue usando exactamente el service role que ya declaraba: la consulta bulk viaja por
// el mismo cliente, sin variables nuevas ni secretos en la salida.
const scanRunnerSource = readFileSync(new URL('../ops/agt002-radar-scan/run-agt002-radar-scan.mjs', import.meta.url), 'utf8');
assert.match(scanRunnerSource, /createClient\(url,\s*key/);
assert.match(scanRunnerSource, /const key=process\.env\.SUPABASE_SERVICE_ROLE_KEY;/);
assert.deepEqual([...new Set(scanRunnerSource.match(/process\.env\.[A-Z0-9_]+/g) || [])].sort(),
  ['process.env.NEXT_PUBLIC_SUPABASE_URL', 'process.env.SUPABASE_SERVICE_ROLE_KEY', 'process.env.SUPABASE_URL'],
  'el runner del scan no gana ninguna variable de entorno nueva');
assert.doesNotMatch(scanRunnerSource, /console\.(log|error)\([^)]*\b(key|url)\b/, 'el runner nunca imprime credenciales ni el endpoint');
const canonicalReaderSource = readFileSync(new URL('../agt002-radar-preanalysis-persistence.js', import.meta.url), 'utf8');
assert.doesNotMatch(canonicalReaderSource, /SUPABASE_SERVICE_ROLE_KEY|apikey|Authorization|createClient/);

console.log('AGT-002 Radar daily scan (no claim, no model) passed');
