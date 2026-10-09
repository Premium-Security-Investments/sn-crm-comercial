import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AGT002_RADAR_SCAN_STAGES, createAgt002RadarScan } from '../agt002-radar-scan.js';

const NOW = '2026-08-25T15:00:00.000Z';
const TENDER = { id: '22222222-2222-4222-8222-222222222222', stable_key: 'k-1', title: 'Vigilancia', description: 'Armada', source: 'SECOP II', entity: 'E', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación' };
const TENDER2 = { id: '33333333-3333-4333-8333-333333333333', stable_key: 'k-2' };
const hostileDatabase = new Proxy({}, { get() { throw new Error('database must not be touched'); } });
const hostile = () => { throw new Error('must not run'); };

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}
function referenceIdempotencyKey(parts) {
  return createHash('sha256').update(JSON.stringify(stableValue(parts))).digest('hex');
}

// 1. Determinístico y siempre activo cuando se invoca: ninguna variable de entorno lo apaga, no
//    existe 'disabled' en la superficie de este módulo, y un `environment` extra en las opciones
//    es simplemente ignorado (createAgt002RadarScan ya no declara ese parámetro).
for (const extra of [{}, { environment: {} }, { environment: { AGT002_RADAR_GATE: 'false' } }, { environment: { AGT002_RADAR_GATE: 'true' } }]) {
  const scan = createAgt002RadarScan({
    database: {}, now: () => NOW, fetchTenderPage: async () => [], evaluateGate: hostile, recordGateEvaluation: hostile, ...extra,
  });
  const result = await scan.runOnce();
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.stages, AGT002_RADAR_SCAN_STAGES);
  assert.equal(result.evaluated, 0);
}

// 1b. El scan nunca toca `database` directamente: sólo lo reenvía, sin leer ni escribir ninguna de
//     sus propiedades, a las funciones inyectadas (fetch/gate-ledger/ESU).
{
  const passthrough = createAgt002RadarScan({
    database: hostileDatabase, now: () => NOW,
    fetchTenderPage: async db => { assert.equal(db, hostileDatabase); return []; },
    evaluateGate: hostile, recordGateEvaluation: hostile,
    refreshEsuDirect: async db => { assert.equal(db, hostileDatabase); return { status: 'skipped_fresh', source: 'x' }; },
  });
  const passthroughResult = await passthrough.runOnce();
  assert.equal(passthroughResult.status, 'completed');
}

// 2. Orden real: esu_refresh -> fetch -> gate -> ledger (x2 filas). No existe etapa 'enqueue'.
const calls = []; let nowCalls = 0; const gateClockValues = [];
const track = (name, value) => (...args) => { calls.push(name); return typeof value === 'function' ? value(...args) : value; };
const filteringScan = createAgt002RadarScan({
  database: {}, now: () => { nowCalls += 1; return NOW; },
  fetchTenderPage: track('fetch', [TENDER, TENDER2]),
  evaluateGate: track('gate', (row, { nowIso }) => {
    gateClockValues.push(nowIso);
    return row.stable_key === 'k-1'
      ? { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: row.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }
      : { verdict: 'eliminada', rule_ids: ['estado_terminal'], reasons: [{ rule_id: 'estado_terminal' }], data_gaps: [], tender_id: row.id, source_row_hash: 'b'.repeat(64), policy_version: 'p', context_version: 'c' };
  }),
  recordGateEvaluation: track('ledger', value => ({ id: value.tenderId === TENDER.id ? 'gate-1' : 'gate-2' })),
});
const result = await filteringScan.runOnce();
assert.equal(result.status, 'completed');
assert.equal(result.evaluated, 2);
assert.equal(result.survivors, 1);
assert.equal(result.eliminated, 1);
assert.equal('enqueued' in result, false);
assert.equal('satisfied' in result, false);
assert.equal('rejected' in result, false);
assert.deepEqual([...new Set(calls)], ['fetch', 'gate', 'ledger']);
assert.deepEqual(result.stages, AGT002_RADAR_SCAN_STAGES);
assert.equal(calls.filter(x => x === 'ledger').length, 2);
assert.equal(nowCalls, 1);
assert.deepEqual(gateClockValues, [NOW, NOW]);

// 3. Página vacía -> status 'completed' con evaluated:0.
const emptyPage = createAgt002RadarScan({
  database: {}, now: () => NOW, fetchTenderPage: async () => [], evaluateGate: hostile, recordGateEvaluation: hostile,
});
const emptyResult = await emptyPage.runOnce();
assert.equal(emptyResult.status, 'completed');
assert.equal(emptyResult.evaluated, 0);
assert.equal(emptyResult.survivors, 0);
assert.equal(emptyResult.eliminated, 0);
assert.equal('enqueued' in emptyResult, false);
assert.equal('satisfied' in emptyResult, false);
assert.equal('rejected' in emptyResult, false);
assert.deepEqual(emptyResult.stages, AGT002_RADAR_SCAN_STAGES);

// 4. Fallo de fetch -> status 'unavailable', gate/ledger nunca se llaman.
const fetchBroken = createAgt002RadarScan({
  database: {}, now: () => NOW, fetchTenderPage: async () => { throw new Error('down'); }, evaluateGate: hostile, recordGateEvaluation: hostile,
});
const fetchResult = await fetchBroken.runOnce();
assert.equal(fetchResult.status, 'unavailable');
assert.equal(fetchResult.error_code, 'provider_error');
assert.deepEqual(fetchResult.stages, ['esu_refresh', 'fetch']);

// 5. Fallo de ledger -> status 'unavailable', error visible, sin contaminar con conceptos de IA.
let ledgerCalled = 0;
const ledgerBroken = createAgt002RadarScan({
  database: {}, now: () => NOW,
  fetchTenderPage: async () => [TENDER],
  evaluateGate: () => ({ verdict: 'sobreviviente', tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async () => { ledgerCalled += 1; throw new Error('down'); },
});
const ledgerResult = await ledgerBroken.runOnce();
assert.equal(ledgerResult.status, 'unavailable');
assert.equal(ledgerResult.error_code, 'persistence_failure');
assert.equal(ledgerResult.evaluated, 1);
assert.equal(ledgerCalled, 1);
assert.equal('enqueued' in ledgerResult, false);
assert.equal('satisfied' in ledgerResult, false);
assert.equal('rejected' in ledgerResult, false);

// 6. Persistencia determinística: la idempotencyKey del gate se calcula localmente (sha256 sobre
//    JSON de claves ordenadas) sobre exactamente los mismos campos que antes -- compatibilidad de
//    formato --, sin importar el helper de preanalysis persistence.
{
  const gateWrites = [];
  const scan = createAgt002RadarScan({
    database: {}, now: () => NOW,
    fetchTenderPage: async () => [TENDER],
    evaluateGate: () => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c', evaluation_date: '2026-08-25' }),
    recordGateEvaluation: async (_db, value) => { gateWrites.push(value); return { id: 'gate-1' }; },
  });
  await scan.runOnce();
  assert.equal(gateWrites.length, 1);
  const expectedKey = referenceIdempotencyKey({
    kind: 'gate', tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c', evaluation_date: '2026-08-25',
  });
  assert.equal(gateWrites[0].idempotencyKey, expectedKey);
}

// 7. Reintento entre corridas: misma fila, mismo día -> misma idempotencyKey de gate; cruce de día
//    calendario Bogota -> idempotencyKey nueva, mismo source_row_hash.
{
  const retryGateWrites = [];
  const retryTimes = [NOW, '2026-08-25T15:01:00.000Z', '2026-08-26T15:00:00.000Z'];
  const retryable = createAgt002RadarScan({
    database: {}, now: () => retryTimes.shift(),
    fetchTenderPage: async () => [TENDER],
    evaluateGate: () => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
    recordGateEvaluation: async (_db, value) => { retryGateWrites.push(value); return { id: 'gate-1' }; },
  });
  assert.equal((await retryable.runOnce()).status, 'completed');
  assert.equal((await retryable.runOnce()).status, 'completed');
  assert.equal(retryGateWrites.length, 2);
  assert.equal(retryGateWrites[0].idempotencyKey, retryGateWrites[1].idempotencyKey);
  assert.notEqual(retryGateWrites[0].evaluatedAt, retryGateWrites[1].evaluatedAt);
  assert.equal((await retryable.runOnce()).status, 'completed');
  assert.equal(retryGateWrites.length, 3);
  assert.notEqual(retryGateWrites[2].idempotencyKey, retryGateWrites[1].idempotencyKey);
  assert.equal(retryGateWrites[2].sourceRowHash, retryGateWrites[1].sourceRowHash, 'la identidad diaria no toca el hash de ingesta');
}

// 8. ESU no bloqueante: un refresh que revienta o devuelve una forma inesperada no impide fetch,
//    gate ni ledger, y la corrida sigue 'completed'.
for (const refreshEsuDirect of [
  async () => { throw new Error('esu down'); },
  async () => null,
  async () => 'not-an-object',
]) {
  const gateWrites = [];
  const scan = createAgt002RadarScan({
    database: {}, now: () => NOW, refreshEsuDirect,
    fetchTenderPage: async () => [TENDER],
    evaluateGate: () => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
    recordGateEvaluation: async (_db, value) => { gateWrites.push(value); return { id: 'gate-1' }; },
  });
  const esuResult = await scan.runOnce();
  assert.equal(esuResult.status, 'completed');
  assert.equal(esuResult.esu_refresh.status, 'unavailable');
  assert.equal(esuResult.survivors, 1);
  assert.equal(gateWrites.length, 1);
}
// Un ESU exitoso se refleja en el resultado sin alterar el filtro.
{
  const scan = createAgt002RadarScan({
    database: {}, now: () => NOW, refreshEsuDirect: async () => ({ status: 'success', source: 'ESU Contratación directo', rows: 3 }),
    fetchTenderPage: async () => [TENDER],
    evaluateGate: () => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
    recordGateEvaluation: async () => ({ id: 'gate-1' }),
  });
  const okResult = await scan.runOnce();
  assert.equal(okResult.status, 'completed');
  assert.deepEqual(okResult.esu_refresh, { status: 'success', source: 'ESU Contratación directo', rows: 3 });
}

// 9. Superficie cerrada: el scan JAMÁS puede reclamar un job, correr preanálisis, encolar, hablar
//    con el modelo/puente ni depender de las banderas retiradas AGT002_RADAR_GATE/VISIBILITY.
const source = readFileSync(new URL('../agt002-radar-scan.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /claimJob|runPreanalysis|recordPreanalysisRun|completeJob|failJob/);
assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/);
assert.doesNotMatch(source, /enqueueAgt002RadarPreanalysisJob|preanalysis-jobs/);
assert.doesNotMatch(source, /readAgt002RadarCanonicalPreanalysis|canonical-preanalysis|CanonicalPreanalysis/);
assert.doesNotMatch(source, /derived-day-churn|DerivedDay(Shape|OnlyChurn)/);
assert.doesNotMatch(source, /agt002-analysis-config|buildAgt002AnalysisConfig/);
assert.doesNotMatch(source, /AGT002_RADAR_GATE|AGT002_RADAR_VISIBILITY/);
assert.doesNotMatch(source, /\bmodel\b/i);
assert.doesNotMatch(source, /\bbridge\b/i);
assert.doesNotMatch(source, /\benqueue\b/i);
assert.doesNotMatch(source, /Hetzner/i);
// 9b. No importa el módulo de persistencia de preanálisis ni su helper de grabación del gate: el
//     adaptador `recordGateEvaluation` inyectable por defecto vive localmente en el propio scan.
assert.doesNotMatch(source, /agt002-radar-preanalysis-persistence/);
assert.doesNotMatch(source, /recordAgt002RadarGateEvaluation/);
// 9c. El resultado 'completed' ya no expone enqueued/satisfied/rejected.
assert.doesNotMatch(source, /\benqueued\b|\bsatisfied\b|\brejected\b/);
assert.deepEqual(AGT002_RADAR_SCAN_STAGES, ['esu_refresh', 'fetch', 'gate', 'ledger']);

// 10. Adaptador privado por defecto de `recordGateEvaluation` (sin inyectar): invoca exactamente
//     `database.rpc('psi_record_agt002_radar_gate_evaluation', ...)` con los mismos argumentos que
//     antes, y falla en cerrado si el cliente no expone `rpc` o si la RPC devuelve error.
{
  const rpcCalls = [];
  const rpcDatabase = {
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: { id: 'gate-1' } }; },
  };
  const scan = createAgt002RadarScan({
    database: rpcDatabase, now: () => NOW,
    fetchTenderPage: async () => [TENDER],
    evaluateGate: () => ({ verdict: 'sobreviviente', rule_ids: ['r1'], reasons: [{ rule_id: 'r1' }], data_gaps: ['g1'], tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  });
  const defaultResult = await scan.runOnce();
  assert.equal(defaultResult.status, 'completed');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'psi_record_agt002_radar_gate_evaluation');
  assert.deepEqual(rpcCalls[0].args, {
    p_tender_id: TENDER.id, p_stable_key: TENDER.stable_key, p_verdict: 'sobreviviente', p_rule_ids: ['r1'], p_reasons: [{ rule_id: 'r1' }],
    p_data_gaps: ['g1'], p_policy_version: 'p', p_context_version: 'c', p_source_row_hash: 'a'.repeat(64),
    p_idempotency_key: rpcCalls[0].args.p_idempotency_key, p_evaluated_at: NOW,
  });
}
{
  const scan = createAgt002RadarScan({
    database: {}, now: () => NOW,
    fetchTenderPage: async () => [TENDER],
    evaluateGate: () => ({ verdict: 'sobreviviente', tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  });
  const noRpcResult = await scan.runOnce();
  assert.equal(noRpcResult.status, 'unavailable');
  assert.equal(noRpcResult.error_code, 'persistence_failure');
}
{
  const scan = createAgt002RadarScan({
    database: { rpc: async () => ({ error: new Error('rpc down') }) }, now: () => NOW,
    fetchTenderPage: async () => [TENDER],
    evaluateGate: () => ({ verdict: 'sobreviviente', tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  });
  const rpcErrorResult = await scan.runOnce();
  assert.equal(rpcErrorResult.status, 'unavailable');
  assert.equal(rpcErrorResult.error_code, 'persistence_failure');
}

// Decisión del dueño (2026-10-09): el filtro del Radar diario nunca evalúa ni registra en el ledger una licitación
// convertida de una oportunidad NO activa; una convertida activa y una devuelta al Radar ('nueva') siguen como hoy.
{
  const inactive = { ...TENDER, id: '44444444-4444-4444-8444-444444444444', stable_key: 'k-conv', internal_status: 'convertida_oportunidad', converted_opportunity_id: 'opp-no-go' };
  const active = { ...TENDER, id: '55555555-5555-4555-8555-555555555555', stable_key: 'k-act', internal_status: 'convertida_oportunidad', converted_opportunity_id: 'opp-activa' };
  const returned = { ...TENDER2, internal_status: 'nueva', converted_opportunity_id: 'opp-2' };
  const evaluatedIds = [];
  const recordedIds = [];
  const asked = [];
  const scan = createAgt002RadarScan({
    database: {}, now: () => NOW,
    fetchTenderPage: async () => [inactive, active, returned],
    isInactiveConverted: async (_db, row) => { asked.push(row.id); return row.converted_opportunity_id === 'opp-no-go'; },
    evaluateGate: row => { evaluatedIds.push(row.id); return { verdict: 'sobreviviente', source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }; },
    recordGateEvaluation: async (_db, value) => { recordedIds.push(value.tenderId); return { id: 'g' }; },
  });
  const result = await scan.runOnce();
  assert.equal(result.status, 'completed');
  assert.deepEqual(asked, [inactive.id, active.id], 'sólo se consulta la etapa de las convertidas');
  assert.deepEqual(evaluatedIds, [active.id, returned.id]);
  assert.deepEqual(recordedIds, [active.id, returned.id], 'ninguna escritura en el ledger para la no activa');
  assert.equal(result.evaluated, 2);
}

console.log('AGT-002 Radar daily scan (deterministic, always-on, no preanalysis/enqueue/model/bridge) passed');
