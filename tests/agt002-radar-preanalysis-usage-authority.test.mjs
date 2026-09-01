import assert from 'node:assert/strict';
import { createAgt002RadarPreanalysisRuntime } from '../agt002-radar-preanalysis-runtime.js';
import { createAgt002RadarPipeline } from '../agt002-radar-pipeline.js';
import { createAgt002RadarWorker } from '../agt002-radar-worker.js';
import { classifyAgt002RadarPreanalysisError } from '../agt002-radar-preanalysis-worker.js';
import { AGT002_RADAR_PREANALYSIS_POLICY_VERSION } from '../agt002-radar-preanalysis-contract.js';

// ---------------------------------------------------------------------------
// Issue #136 · La medición del puente es la fuente autoritativa de tokens/modelo/costo.
//
// `agt002-hetzner-bridge-client.js` mide `response.usage` sobre el transporte firmado. El JSON del
// modelo viaja dentro de `response.content` y es material auto-reportado: no puede declarar su
// propio consumo ni suplantar el modelo de la corrida. Estas son pruebas de COMPORTAMIENTO con el
// runtime, el pipeline y el worker reales, con el cliente de puente y el runPreanalysis inyectados
// —no comprobaciones estáticas del código—.
// ---------------------------------------------------------------------------

const ENV = {
  AGT002_RADAR_GATE: 'true',
  AGT002_RADAR_PREANALYSIS_MODEL: 'radar-model-solicitado',
  AGT002_HETZNER_BRIDGE_URL: 'https://bridge.example.test/run',
  AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48),
};
const CONTEXT_VERSION = 'agt002-radar-context-v1';
const TENDER = { id: '22222222-2222-4222-8222-222222222222', stable_key: 'k-1', title: 'Vigilancia', description: 'Armada', status: 'abierto', deadline_at: '2026-12-31', source: 'SECOP II', entity: 'E', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación' };
const GATE = { id: '33333333-3333-4333-8333-333333333333', tender_id: TENDER.id, verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], policy_version: 'agt002-radar-gate-policy-v1', context_version: CONTEXT_VERSION, source_row_hash: 'a'.repeat(64) };

// Lo que el modelo se auto-reporta: otro proveedor, otro modelo, tokens y costo inflados.
const SELF_REPORTED_USAGE = Object.freeze({ provider: 'proveedor-declarado-por-el-json', model: 'modelo-declarado-por-el-json', input_tokens: 999_999, output_tokens: 888_888, cost_usd: 1_234.56 });
function modelEnvelope(usage = SELF_REPORTED_USAGE) {
  return {
    schema_version: 'agt002-radar-preanalysis-v1', agent_id: 'AGT-002', run_id: 'run-1',
    policy_version: AGT002_RADAR_PREANALYSIS_POLICY_VERSION, context_version: CONTEXT_VERSION,
    tender_id: TENDER.id, gate_evaluation_id: GATE.id, status: 'completed', visibility_verdict: 'mostrar_en_radar',
    summary: 'Vigilancia armada verificable en el pliego.',
    signals: [{ signal_id: 's1', text: 'Objeto compatible con el portafolio.', evidence_refs: ['e1'] }],
    evidence: [{ evidence_id: 'e1', evidence_type: 'tender_field', reference: 'title', observed_value: 'Vigilancia', policy_version: AGT002_RADAR_PREANALYSIS_POLICY_VERSION, context_version: CONTEXT_VERSION }],
    data_gaps: [], human_review_required: true, usage,
  };
}
function runtimeFor(bridgeUsage, { environment = ENV, envelope = modelEnvelope() } = {}) {
  let request = null;
  const runtime = createAgt002RadarPreanalysisRuntime({
    environment,
    createClient: () => ({ run: async value => { request = value; return { content: JSON.stringify(envelope), usage: bridgeUsage, rate_limit: null }; } }),
  });
  return { runtime, sent: () => request };
}
const runOnce = runtime => runtime.runOnce({ tenderRow: TENDER, gateEvaluation: GATE, learningSignals: null, idempotencyKey: 'idem-1' });

// 1. Discordancia: el envelope devuelto lleva la medición del puente, nunca la auto-declarada. El
//    puente no informó costo en esta corrida: se persiste `cost_usd: null` (no medido), nunca un 0
//    inventado —0 y "no medido" son estados distintos y no pueden confundirse—.
{
  const { runtime, sent } = runtimeFor({ input_tokens: 12, output_tokens: 7 });
  const output = await runOnce(runtime);
  assert.equal(sent().model, 'radar-model-solicitado', 'el modelo solicitado es el que se firma hacia el puente');
  assert.deepEqual(output.usage, { provider: 'hetzner_bridge', model: 'radar-model-solicitado', input_tokens: 12, output_tokens: 7, cost_usd: null },
    'el usage del envelope debe ser el medido por el puente, no el auto-reportado por el modelo, y el costo ausente debe ser null, no 0');
  assert.equal(output.tender_id, TENDER.id, 'el resto del contrato de output/provenance no cambia');
  assert.equal(output.policy_version, AGT002_RADAR_PREANALYSIS_POLICY_VERSION);
  assert.equal(output.human_review_required, true);
}

// 2. 0/0 es una medición legítima: no puede degradarse a la declaración del modelo por ser falsy.
//    El costo, en cambio, no vino en esta medición: sigue siendo null, no 0.
{
  const output = await runOnce(runtimeFor({ input_tokens: 0, output_tokens: 0 }).runtime);
  assert.equal(output.usage.input_tokens, 0, '0 tokens de entrada medidos son 0, no "ausente"');
  assert.equal(output.usage.output_tokens, 0, '0 tokens de salida medidos son 0, no "ausente"');
  assert.equal(output.usage.model, 'radar-model-solicitado');
  assert.equal(output.usage.cost_usd, null, 'costo no informado por el puente: null, nunca 0 inventado');
}

// 3. Modelo solicitado vs modelo resuelto: el puente puede resolver un alias del proveedor. Se
//    registra el resuelto (lo que se ejecutó) y se sigue firmando el solicitado (lo que se pidió).
{
  const { runtime, sent } = runtimeFor({ input_tokens: 3, output_tokens: 4, model: 'radar-model-resuelto-2026-05-01', cost_usd: 0.42 });
  const output = await runOnce(runtime);
  assert.equal(sent().model, 'radar-model-solicitado', 'el modelo solicitado no cambia');
  assert.equal(output.usage.model, 'radar-model-resuelto-2026-05-01', 'el modelo persistido es el resuelto por el puente');
  assert.equal(output.usage.cost_usd, 0.42, 'el costo medido por el puente se conserva cuando existe y es positivo');
}

// 3b. Costo explícito 0 (medido, distinto de "no medido"): se conserva tal cual, no se convierte en
//     null. null significa "el puente no informó costo"; 0 significa "el puente midió costo cero".
{
  const output = await runOnce(runtimeFor({ input_tokens: 3, output_tokens: 4, cost_usd: 0 }).runtime);
  assert.equal(output.usage.cost_usd, 0, 'costo 0 explícito del puente se conserva como 0, no como null');
  assert.notEqual(output.usage.cost_usd, null, 'costo 0 medido no es lo mismo que costo no medido');
}

// 4. Sin modelo informado por el puente, el resuelto es el solicitado —el puente firmó con él—,
//    nunca el que el JSON del modelo declara. Tampoco informó costo: null, no 0.
{
  const output = await runOnce(runtimeFor({ input_tokens: 1, output_tokens: 1, model: null }).runtime);
  assert.equal(output.usage.model, 'radar-model-solicitado');
  assert.notEqual(output.usage.model, SELF_REPORTED_USAGE.model);
  assert.equal(output.usage.cost_usd, null);
}

// 5. Fail closed ante mediciones que el puente no debería haber aceptado. El código es distinto del
//    de output inválido: la falla es del proveedor/transporte, no del JSON del modelo.
for (const [label, bridgeUsage] of [
  ['ausente', undefined],
  ['nula', null],
  ['arreglo', []],
  ['tokens negativos', { input_tokens: -1, output_tokens: 0 }],
  ['tokens fraccionarios', { input_tokens: 1.5, output_tokens: 0 }],
  ['tokens de texto', { input_tokens: '12', output_tokens: 7 }],
  ['tokens ausentes', { output_tokens: 7 }],
  ['modelo no textual', { input_tokens: 1, output_tokens: 1, model: 42 }],
  ['modelo vacío', { input_tokens: 1, output_tokens: 1, model: '   ' }],
  ['costo negativo', { input_tokens: 1, output_tokens: 1, cost_usd: -0.01 }],
  ['costo no finito', { input_tokens: 1, output_tokens: 1, cost_usd: Number.POSITIVE_INFINITY }],
  ['costo NaN', { input_tokens: 1, output_tokens: 1, cost_usd: Number.NaN }],
  ['costo textual', { input_tokens: 1, output_tokens: 1, cost_usd: '0' }],
]) {
  await assert.rejects(
    () => runOnce(runtimeFor(bridgeUsage).runtime),
    error => {
      assert.equal(error.runtime_boundary_code, 'AGT002_RADAR_PREANALYSIS_UNTRUSTED_USAGE', `usage ${label}`);
      assert.equal(classifyAgt002RadarPreanalysisError(error), 'provider_error', `usage ${label}`);
      return true;
    },
    `usage ${label} debe cerrar la corrida`,
  );
}

// 6. El JSON del modelo deja de tener autoridad sobre `usage`: aunque lo omita o lo emita roto, el
//    envelope se cierra con la medición del puente y sigue siendo válido contra el contrato. No hay
//    migración de esquema: la forma cerrada del envelope persistido es exactamente la de siempre.
for (const [label, modelUsage] of [['omitido', undefined], ['roto', { input_tokens: 'muchos' }], ['nulo', null]]) {
  const envelope = modelEnvelope();
  if (modelUsage === undefined) delete envelope.usage; else envelope.usage = modelUsage;
  const output = await runOnce(runtimeFor({ input_tokens: 5, output_tokens: 6 }, { envelope }).runtime);
  assert.deepEqual(output.usage, { provider: 'hetzner_bridge', model: 'radar-model-solicitado', input_tokens: 5, output_tokens: 6, cost_usd: null }, `usage ${label} en el JSON del modelo`);
  assert.deepEqual(Object.keys(output).sort(), Object.keys(modelEnvelope()).sort(), `usage ${label}: el envelope conserva su forma cerrada`);
}

// ---------------------------------------------------------------------------
// Pipeline y worker: la persistencia toma el modelo y el consumo del envelope medido, nunca del
// entorno, y falla cerrado cuando no hay medición.
// ---------------------------------------------------------------------------
const NOW = '2026-08-25T15:00:00.000Z';
const QUEUE_ENV = { AGT002_RADAR_GATE: 'true', AGT002_RADAR_PREANALYSIS_MODEL: 'modelo-del-entorno' };
const EVALUATION = { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' };
const JOB = { jobId: 'j1', leaseId: 'l1', tenderId: TENDER.id, gateEvaluationId: 'gate-1', attemptKey: 'a1', sourceRowHash: 'a'.repeat(64), policyVersion: 'p', contextVersion: 'c' };
const MEASURED_USAGE = Object.freeze({ provider: 'hetzner_bridge', model: 'modelo-medido-por-el-puente', input_tokens: 0, output_tokens: 0, cost_usd: 0 });
// Costo no medido por el puente: null, no 0. La persistencia debe aceptarlo y guardarlo tal cual.
const MEASURED_USAGE_UNMEASURED_COST = Object.freeze({ provider: 'hetzner_bridge', model: 'modelo-medido-por-el-puente', input_tokens: 3, output_tokens: 4, cost_usd: null });
const agtOutput = usage => ({ status: 'completed', visibility_verdict: 'mostrar_en_radar', evidence: [{ evidence_id: 'e' }], usage });

function pipelineFor(usage, sink) {
  return createAgt002RadarPipeline({
    database: {}, environment: QUEUE_ENV, now: () => NOW,
    fetchTenderPage: async () => [TENDER], evaluateGate: () => EVALUATION,
    recordGateEvaluation: async () => ({ id: 'gate-1' }), enqueueJob: async () => ({ status: 'created', job_id: 'j1' }),
    claimJob: async () => JOB,
    projectLearningObservations: async () => ({ precedents: [] }),
    buildLearningSignals: () => ({ version: 'agt002-radar-learning-v1', candidate_id: TENDER.id, max_signals: 10, considered: 0, signals: [] }),
    runPreanalysis: async () => agtOutput(usage),
    recordPreanalysisRun: async (_db, value) => { sink.persisted = value; return { id: 'r1' }; },
    completeJob: async () => { sink.completed = true; return { status: 'completed' }; },
    failJob: async (_db, { errorCode }) => { sink.failedCode = errorCode; },
  });
}
function workerFor(usage, sink) {
  return createAgt002RadarWorker({
    database: {}, environment: QUEUE_ENV, now: () => NOW,
    claimJob: async () => JOB, fetchTenderRow: async () => TENDER, evaluateGate: () => EVALUATION,
    recordGateEvaluation: async () => ({ id: 'gate-1' }),
    projectLearningObservations: async () => ({ precedents: [] }),
    buildLearningSignals: () => ({ version: 'agt002-radar-learning-v1', signals: [] }),
    runPreanalysis: async () => agtOutput(usage),
    recordPreanalysisRun: async (_db, value) => { sink.persisted = value; return { id: 'r1' }; },
    completeJob: async () => { sink.completed = true; },
    failJob: async (_db, { errorCode }) => { sink.failedCode = errorCode; },
  });
}

// 7. Camino feliz: se persiste el modelo medido (no el del entorno) y el consumo medido tal cual,
//    tanto con costo 0 explícito como con costo no medido (`null`). Ninguno de los dos se persiste
//    sustituido por el otro.
for (const [label, build] of [['pipeline', pipelineFor], ['worker', workerFor]]) {
  for (const usage of [MEASURED_USAGE, MEASURED_USAGE_UNMEASURED_COST]) {
    const sink = {};
    assert.equal((await build(usage, sink).runOnce()).status, 'completed', label);
    assert.equal(sink.persisted.model, 'modelo-medido-por-el-puente', `${label}: el modelo persistido es el medido`);
    assert.notEqual(sink.persisted.model, QUEUE_ENV.AGT002_RADAR_PREANALYSIS_MODEL, `${label}: el entorno no puede suplantar el modelo`);
    assert.deepEqual(sink.persisted.usage, usage, `${label}: el consumo persistido es el medido, incluidos 0/0 y costo null`);
    assert.equal(sink.completed, true, label);
  }
}

// 8. Fail closed: sin medición confiable no se persiste NADA y el job se cierra como provider_error.
//    Antes, un `usage` vacío o con modelo vacío se completaba silenciosamente con el modelo del
//    entorno: una corrida quedaba atribuida a un modelo que nadie midió.
for (const [label, usage] of [
  ['vacío', {}],
  ['sin claves de medición', { provider: 'hetzner_bridge', model: 'm' }],
  ['modelo vacío', { provider: 'hetzner_bridge', model: '', input_tokens: 5, output_tokens: 2, cost_usd: 0 }],
  ['tokens de texto', { provider: 'hetzner_bridge', model: 'm', input_tokens: '5', output_tokens: 2, cost_usd: 0 }],
  // `cost_usd: null` (no medido) es válido y se prueba en el camino feliz (7); estos casos son
  // costos presentes pero inválidos, que deben seguir cerrando la corrida igual que antes.
  ['costo negativo', { provider: 'hetzner_bridge', model: 'm', input_tokens: 5, output_tokens: 2, cost_usd: -0.01 }],
  ['costo NaN', { provider: 'hetzner_bridge', model: 'm', input_tokens: 5, output_tokens: 2, cost_usd: Number.NaN }],
  ['costo textual', { provider: 'hetzner_bridge', model: 'm', input_tokens: 5, output_tokens: 2, cost_usd: '0' }],
  ['costo infinito', { provider: 'hetzner_bridge', model: 'm', input_tokens: 5, output_tokens: 2, cost_usd: Number.POSITIVE_INFINITY }],
  ['ausente', undefined],
]) {
  for (const [surface, build] of [['pipeline', pipelineFor], ['worker', workerFor]]) {
    const sink = {};
    const result = await build(usage, sink).runOnce();
    assert.equal(result.status, 'unavailable', `${surface}/${label}`);
    assert.equal(result.error_code, 'provider_error', `${surface}/${label}`);
    assert.equal(sink.failedCode, 'provider_error', `${surface}/${label}: el job se cierra`);
    assert.equal(sink.persisted, undefined, `${surface}/${label}: no se persiste una corrida sin medición`);
    assert.equal(sink.completed, undefined, `${surface}/${label}: el job no se completa`);
  }
}

// 9. La corrida sin medición tampoco alcanza la etapa de persistencia declarada.
{
  const sink = {};
  const result = await pipelineFor({}, sink).runOnce();
  assert.equal(result.stages.includes('persist'), false, 'no se anuncia `persist` si la corrida nunca llegó a persistir');
}

// Nota (issue #136): antes de esta corrección, un costo no medido se persistía como `0`, ambiguo
// con un costo medido en cero. Las filas ya persistidas bajo ese comportamiento anterior conservan
// su `cost_usd` numérico tal cual —no hay migración ni reescritura de histórico—; el contrato acepta
// tanto el histórico numérico como el `null` nuevo (ver agt002-radar-preanalysis-contract.js). Sólo
// las corridas nuevas, a partir de este cambio, distinguen "no medido" (`null`) de "medido en 0".
console.log('AGT-002 Radar bridge-measured usage authority (issue #136) passed');
