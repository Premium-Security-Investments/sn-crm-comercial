import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createAgt003ReducedCanaryHarness } from '../agt003-reduced-canary-harness.js';
import { createAgt003CopilotEngine } from '../agt003-copilot-engine.js';
import { createAgt003SingleCanaryPackage, reduceAgt003PayloadOffline } from '../agt003-payload-reduction.js';

const ALREADY_RUN_CODE = 'AGT003_REDUCED_CANARY_ALREADY_RUN';
const DEFAULT_TIMEOUT_MS = 30000;

const CORRELATION_ID = 'corr-synthetic-reduced-canary-0001';
const SNAPSHOT_ID = 'snap-synthetic-reduced-canary-0001';
const DIVERGENT_CORRELATION_ID = 'corr-synthetic-reduced-canary-DIVERGENT';
const DIVERGENT_SNAPSHOT_ID = 'snap-synthetic-reduced-canary-DIVERGENT';

// Contrato propuesto para la fuente del kill switch, consumido como killSwitch.read():
//   - Único estado inequívoco que habilita continuar: exactamente { enabled: false } (una sola clave).
//   - Exactamente { enabled: true } (una sola clave): bloqueo explícito -> KILLED_CODE.
//   - Cualquier otra forma (claves extra, tipos incorrectos, null, booleano suelto, objeto vacío,
//     ausencia de fuente, fuente que lanza/rechaza): fail-closed, nunca se interpreta como segura.
const KILLED_CODE = 'AGT003_REDUCED_CANARY_KILLED';
const KILL_SWITCH_SOURCE_MISSING_CODE = 'AGT003_REDUCED_CANARY_KILL_SWITCH_SOURCE_MISSING';
const KILL_SWITCH_FAILED_CODE = 'AGT003_REDUCED_CANARY_KILL_SWITCH_FAILED';
const KILL_SWITCH_AMBIGUOUS_CODE = 'AGT003_REDUCED_CANARY_KILL_SWITCH_AMBIGUOUS';

const INVALID_JSON_CODE = 'AGT003_REDUCED_CANARY_INVALID_JSON';
const INVALID_RESULT_CONTRACT_CODE = 'AGT003_REDUCED_CANARY_INVALID_RESULT_CONTRACT';
const CORRELATION_MISMATCH_CODE = 'AGT003_REDUCED_CANARY_CORRELATION_MISMATCH';
const SNAPSHOT_MISMATCH_CODE = 'AGT003_REDUCED_CANARY_SNAPSHOT_MISMATCH';

// --- Grupo 3A: autorización obligatoria y auditoría segura ---
//
// Contrato propuesto para la autorización, consumida como opción `authorization` del harness:
//   - Objeto exacto con las claves obligatorias: gate, correlation_id, snapshot_id, revision,
//     human_reviewer_id. Ausencia total del objeto (undefined/null) -> AUTHORIZATION_MISSING_CODE.
//   - Objeto presente pero con alguna clave obligatoria ausente, o human_reviewer_id vacío/solo
//     espacios -> AUTHORIZATION_INCOMPLETE_CODE.
//   - human_reviewer_id no vacío pero con forma de texto libre (espacios, puntuación de prosa) en
//     lugar de un ID validado -> AUTHORIZATION_INVALID_REVIEWER_ID_CODE.
//   - Objeto completo cuyo gate, correlation_id, snapshot_id o revision difieren del valor exigido
//     (gate='AGT003_SINGLE_REDUCED_CANARY', correlation_id/snapshot_id idénticos a los configurados
//     en el harness, revision='c66e9603f356648830ec3b4f7c4507c5ce0953e8') -> AUTHORIZATION_MISMATCH_CODE.
//   - En todos los casos anteriores, el executor no debe invocarse y no debe auditarse nada.
const AUTHORIZATION_GATE = 'AGT003_SINGLE_REDUCED_CANARY';
const AUTHORIZATION_REVISION = 'c66e9603f356648830ec3b4f7c4507c5ce0953e8';
const DIVERGENT_REVISION = '0000000000000000000000000000000000dead';
const HUMAN_REVIEWER_ID = 'reviewer-synthetic-0001';
const REQUIRED_AUTHORIZATION_KEYS = Object.freeze([
  'gate',
  'correlation_id',
  'snapshot_id',
  'revision',
  'human_reviewer_id',
]);

const AUTHORIZATION_MISSING_CODE = 'AGT003_REDUCED_CANARY_AUTHORIZATION_MISSING';
const AUTHORIZATION_INCOMPLETE_CODE = 'AGT003_REDUCED_CANARY_AUTHORIZATION_INCOMPLETE';
const AUTHORIZATION_INVALID_REVIEWER_ID_CODE = 'AGT003_REDUCED_CANARY_AUTHORIZATION_INVALID_REVIEWER_ID';
const AUTHORIZATION_MISMATCH_CODE = 'AGT003_REDUCED_CANARY_AUTHORIZATION_MISMATCH';

// Contrato propuesto para la auditoría segura: cada entrada persistida en el sink debe usar
// exactamente el nombre de evento allowlisted, exponer únicamente claves allowlisted, y cada valor
// debe ser metadato cerrado (booleano, ID validado, número finito no negativo, u outcome/termination
// perteneciente a un enum cerrado). Cualquier clave o valor de texto libre -o desconocida- en el
// resultado crudo del executor debe rechazarse ANTES de invocar el sink de auditoría, de forma que
// el sink nunca reciba el evento rechazado ni el texto libre que lo motivó.
const AUDIT_UNSAFE_RESULT_FIELDS_CODE = 'AGT003_REDUCED_CANARY_AUDIT_UNSAFE_RESULT_FIELDS';
const AUDIT_UNSAFE_METADATA_VALUE_CODE = 'AGT003_REDUCED_CANARY_AUDIT_UNSAFE_METADATA_VALUE';
const ALLOWLISTED_AUDIT_EVENT_NAME = 'agt003_reduced_canary_run_completed';
const ALLOWLISTED_AUDIT_EVENT_KEYS = Object.freeze([
  'name',
  'gate',
  'correlation_id',
  'snapshot_id',
  'revision',
  'human_reviewer_id',
  'outcome',
  'termination',
  'provider_is_error',
  'statusCode',
  'input_tokens',
  'output_tokens',
  'actual_cost_usd',
]);
const ALLOWLISTED_AUDIT_OUTCOMES = Object.freeze(['success', 'provider_error']);
const ALLOWLISTED_AUDIT_TERMINATIONS = Object.freeze(['normal', 'error']);

// --- Grupo 3B: contrato de costo obligatorio, medidor como única fuente de verdad ---
//
// Contrato propuesto para el costo, consumido como opciones `cost_ceiling_usd` y `costMeter` del harness:
//   - `cost_ceiling_usd` es obligatorio: debe ser un número finito estrictamente mayor que 0. Ausencia
//     (undefined/null) -> COST_CEILING_MISSING_CODE. Presente pero no numérico, no finito (NaN/Infinity),
//     cero, negativo, o de un tipo distinto a number -> COST_CEILING_INVALID_CODE. Esta validación ocurre
//     ANTES de invocar al executor: ningún executor debe invocarse con un techo ausente o inválido.
//   - El valor del techo usado en estas pruebas es un fixture puramente sintético y arbitrario (de magnitud
//     mínima); en ningún caso representa, ni debe presentarse como, un techo recomendado o real para un
//     despliegue: cada test lo declara desde cero como dato de prueba, nunca como una aprobación real.
//   - `costMeter` se invoca como costMeter.measure({input_tokens, output_tokens, correlation_id, snapshot_id})
//     -- exactamente esas cuatro claves, tomadas del resultado ya validado del executor y de los IDs
//     configurados en el harness -- DESPUÉS de validar el contrato del resultado y ANTES de auditar.
//   - Ausencia de costMeter (undefined/null) -> COST_METER_MISSING_CODE.
//   - costMeter.measure() que lanza/rechaza -> COST_METER_FAILED_CODE.
//   - costMeter.measure() que resuelve un valor null/undefined/NaN/no finito/negativo/no numérico ->
//     COST_UNKNOWN_CODE.
//   - costMeter.measure() que resuelve un número finito no negativo pero mayor que cost_ceiling_usd ->
//     COST_CEILING_EXCEEDED_CODE.
//   - costMeter.measure() es la ÚNICA fuente de actual_cost_usd: un actual_cost_usd que el executor incluya
//     en su resultado crudo se rechaza como campo inseguro o se ignora sin poder influir en el resultado ni
//     en la auditoría; en ningún caso el valor propuesto por el executor llega al resultado o al audit sink.
//   - Con costo <= techo, el run concluye con normalidad y el resultado expone actual_cost_usd EXACTAMENTE
//     igual al valor devuelto por costMeter.measure(); ese mismo valor (y sólo ese) es el que se audita.
//   - Todos los fallos anteriores son terminales: sin reintento, consumen el único intento permitido
//     (ALREADY_RUN_CODE en un segundo run) y no auditan nada.
const COST_CEILING_MISSING_CODE = 'AGT003_REDUCED_CANARY_COST_CEILING_MISSING';
const COST_CEILING_INVALID_CODE = 'AGT003_REDUCED_CANARY_COST_CEILING_INVALID';
const COST_METER_MISSING_CODE = 'AGT003_REDUCED_CANARY_COST_METER_MISSING';
const COST_METER_FAILED_CODE = 'AGT003_REDUCED_CANARY_COST_METER_FAILED';
const COST_UNKNOWN_CODE = 'AGT003_REDUCED_CANARY_COST_UNKNOWN';
const COST_CEILING_EXCEEDED_CODE = 'AGT003_REDUCED_CANARY_COST_CEILING_EXCEEDED';

// Fixtures sintéticas de costo: valores arbitrarios y mínimos, nunca presentados como techo recomendado/real
// ni como aprobación real. Nunca provienen de un medidor/proveedor/CRM real.
const SYNTHETIC_COST_CEILING_USD = 0.000001337;
const SYNTHETIC_MEASURED_COST_USD = 0.0000005;
const SYNTHETIC_EXCEEDING_COST_USD = 0.01337;

function createSyntheticPayload(overrides = {}) {
  return Object.freeze({
    synthetic: true,
    reduced: true,
    packagePayloadId: 'pkg-payload-synthetic-reduced-canary-0001',
    ...overrides,
  });
}

// M1: entrega el paquete reducido ("paquete") vía consume(); nunca real.
function createCanaryPackage({ consumeResult = createSyntheticPayload() } = {}) {
  let calls = 0;
  const canaryPackage = Object.freeze({
    async consume() {
      calls += 1;
      return consumeResult;
    },
  });
  return { canaryPackage, callsRef: () => calls };
}

function createSuccessfulRawResult(overrides = {}) {
  return {
    provider_is_error: false,
    statusCode: 200,
    outcome: 'success',
    input_tokens: 12,
    output_tokens: 34,
    ...overrides,
  };
}

function createProviderErrorRawResult(overrides = {}) {
  return {
    provider_is_error: true,
    statusCode: 500,
    outcome: 'provider_error',
    input_tokens: 5,
    output_tokens: 0,
    ...overrides,
  };
}

// M2's injected executor: siempre sintético, nunca red/CRM/proveedor real.
function createResolvingExecutor({ result = createSuccessfulRawResult() } = {}) {
  let calls = 0;
  const executor = async (...args) => {
    calls += 1;
    void args;
    return result;
  };
  return { executor, callsRef: () => calls };
}

// Simula un proveedor sintético colgado, para probar timeout y terminación por signal.
function createHangingExecutor() {
  let calls = 0;
  let notifyStarted;
  const started = new Promise((resolve) => { notifyStarted = resolve; });
  const executor = async (...args) => {
    calls += 1;
    void args;
    notifyStarted();
    return new Promise(() => {});
  };
  return { executor, callsRef: () => calls, started };
}

// Executor sintético cuya salida es texto crudo (posible JSON serializado), nunca red/proveedor real.
function createRawStringExecutor({ raw } = {}) {
  let calls = 0;
  const executor = async (...args) => {
    calls += 1;
    void args;
    return raw;
  };
  return { executor, callsRef: () => calls };
}

function killSwitchThrows() {
  return { __throw: true };
}

// Fuente sintética de kill switch: expone read() devolviendo, en orden, los estados dados en `reads`
// (el último se repite si se consulta más veces de las previstas). Un estado marcado con __throw
// simula una fuente que lanza/rechaza en lugar de resolver un estado.
function createKillSwitch({ reads } = {}) {
  const script = Array.isArray(reads) && reads.length > 0 ? reads : [{ enabled: false }];
  let calls = 0;
  const killSwitch = Object.freeze({
    async read() {
      calls += 1;
      const state = script[Math.min(calls - 1, script.length - 1)];
      if (state && typeof state === 'object' && state.__throw === true) {
        throw new Error('synthetic kill switch source failure');
      }
      return state;
    },
  });
  return { killSwitch, callsRef: () => calls };
}

// Kill switch sintético por defecto para pruebas ajenas al kill switch: único estado inequívoco
// { enabled: false } que habilita continuar.
function createDefaultKillSwitch() {
  return Object.freeze({
    async read() {
      return Object.freeze({ enabled: false });
    },
  });
}

// Colaboradores instrumentados con una secuencia compartida, para demostrar por contadores el orden
// exacto: kill switch (check inicial) -> consume() -> kill switch (recheck) -> executor.
function createOrderedCollaborators() {
  const sequence = [];
  let killCalls = 0;
  let consumeCalls = 0;
  let executorCalls = 0;

  const killSwitch = Object.freeze({
    async read() {
      killCalls += 1;
      sequence.push(`kill:${killCalls}`);
      return Object.freeze({ enabled: false });
    },
  });

  const canaryPackage = Object.freeze({
    async consume() {
      consumeCalls += 1;
      sequence.push(`consume:${consumeCalls}`);
      return createSyntheticPayload();
    },
  });

  const executor = async (...args) => {
    executorCalls += 1;
    void args;
    sequence.push(`executor:${executorCalls}`);
    return createSuccessfulRawResult();
  };

  return {
    killSwitch,
    canaryPackage,
    executor,
    sequence,
    killCallsRef: () => killCalls,
    consumeCallsRef: () => consumeCalls,
    executorCallsRef: () => executorCalls,
  };
}

function createAudit() {
  const entries = [];
  const audit = async (entry) => { entries.push(entry); };
  return { audit, entries };
}

// Autorización sintética válida, ligada exactamente al gate/IDs/revision/reviewer exigidos. Nunca
// proviene de un proveedor/CRM/credencial real: es un fixture cerrado para las pruebas.
function createValidAuthorization(overrides = {}) {
  return Object.freeze({
    gate: AUTHORIZATION_GATE,
    correlation_id: CORRELATION_ID,
    snapshot_id: SNAPSHOT_ID,
    revision: AUTHORIZATION_REVISION,
    human_reviewer_id: HUMAN_REVIEWER_ID,
    ...overrides,
  });
}

function omitKey(object, key) {
  const clone = { ...object };
  delete clone[key];
  return clone;
}

function isValidatedId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function isClosedNonNegativeFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// Resultado crudo (JSON serializado) de un executor sintético que además incluye campos extra,
// nunca allowlisted, para probar que la auditoría los rechaza antes de persistir. Nunca proviene de
// un proveedor/CRM real.
function createSuccessfulRawResultWithExtraFields(extraFields) {
  return JSON.stringify({
    provider_is_error: false,
    statusCode: 200,
    outcome: 'success',
    input_tokens: 12,
    output_tokens: 34,
    ...extraFields,
  });
}

function createHarness({ canaryPackage, executor, audit, ...overrides }) {
  return createAgt003ReducedCanaryHarness({
    correlation_id: CORRELATION_ID,
    snapshot_id: SNAPSHOT_ID,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    canaryPackage,
    executor,
    audit,
    // Las pruebas ajenas al kill switch no pasan `killSwitch`, por lo que reciben este valor por
    // defecto (único estado inequívoco {enabled:false}) y mantienen su comportamiento previo.
    // Si `overrides` trae `killSwitch` (incluso `undefined`, para simular fuente ausente), el
    // spread siguiente lo sustituye.
    killSwitch: createDefaultKillSwitch(),
    // Igual que con `killSwitch`: las pruebas ajenas a la autorización reciben una autorización
    // sintética válida por defecto (gate/IDs/revision/reviewer exigidos) y mantienen su
    // comportamiento previo. Si `overrides` trae `authorization` (incluso `undefined`/`null`, para
    // simular autorización ausente), el spread siguiente lo sustituye.
    authorization: createValidAuthorization(),
    // Igual que con `killSwitch`/`authorization`: las pruebas ajenas al contrato de costo reciben
    // defaults sintéticos (techo y medidor) y mantienen su comportamiento previo. Si `overrides`
    // trae `cost_ceiling_usd`/`costMeter` (incluso `undefined`/`null`, para simular ausencia), el
    // spread siguiente los sustituye.
    cost_ceiling_usd: SYNTHETIC_COST_CEILING_USD,
    costMeter: Object.freeze({ async measure() { return SYNTHETIC_MEASURED_COST_USD; } }),
    ...overrides,
  });
}

test('recorrido exitoso M1->paquete->M2->executor inyectado->validación->auditoría con exactamente una invocación', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  const result = await harness.run();

  assert.equal(consumeCallsRef(), 1, 'M1 debe entregar el paquete (consume()) exactamente una vez');
  assert.equal(executorCallsRef(), 1, 'el executor inyectado (M2) debe invocarse exactamente una vez');
  assert.equal(entries.length, 1, 'la auditoría debe registrar exactamente una entrada del recorrido exitoso');

  assert.equal(result.provider_is_error, false, 'un recorrido exitoso no es un error de proveedor');
  assert.equal(result.termination, 'normal', 'un recorrido exitoso termina de forma normal');
  assert.equal(typeof result.statusCode, 'number', 'el resultado correlacionado expone un statusCode');
  assert.equal(typeof result.outcome, 'string', 'el resultado correlacionado expone un outcome');
  assert.equal(typeof result.input_tokens, 'number', 'el resultado correlacionado expone input_tokens');
  assert.equal(typeof result.output_tokens, 'number', 'el resultado correlacionado expone output_tokens');
  assert.equal(result.correlation_id, CORRELATION_ID, 'correlation_id debe ser idéntico al configurado');
  assert.equal(result.snapshot_id, SNAPSHOT_ID, 'snapshot_id debe ser idéntico al configurado');
});

test('un segundo run es rechazado sin una segunda invocación del executor', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  await harness.run();
  assert.equal(executorCallsRef(), 1);

  let secondCode = null;
  try {
    await harness.run();
  } catch (error) {
    secondCode = error?.code ?? null;
  }

  assert.equal(secondCode, ALREADY_RUN_CODE, 'el segundo run debe rechazarse con el código de un solo intento agotado');
  assert.equal(executorCallsRef(), 1, 'el executor no debe invocarse una segunda vez');
  assert.equal(consumeCallsRef(), 1, 'M1 no debe volver a entregar el paquete en el segundo intento');
});

test('un executor colgado agota el timeout de 30000 ms sin reintento', async (t) => {
  const { canaryPackage } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef, started } = createHangingExecutor();
  const { audit } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = harness.run();
    await started;
    t.mock.timers.tick(DEFAULT_TIMEOUT_MS);
    const result = await pending;

    assert.equal(result.termination, 'timeout', 'el timeout debe reflejarse como termination="timeout"');
    assert.equal(result.provider_is_error, false, 'un timeout del harness no es, por sí mismo, un error de proveedor');
    assert.equal(executorCallsRef(), 1, 'el executor debe haberse invocado exactamente una vez antes del timeout');

    t.mock.timers.tick(60000);
    assert.equal(executorCallsRef(), 1, 'no debe existir reintento del executor tras el timeout');
  } finally {
    t.mock.timers.reset();
  }
});

test('provider_is_error=true es terminal: sin reintento y sin segundo run', async () => {
  const { canaryPackage } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor({ result: createProviderErrorRawResult() });
  const { audit } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  const result = await harness.run();

  assert.equal(result.provider_is_error, true, 'el error de proveedor debe propagarse al resultado correlacionado');
  assert.equal(result.termination, 'error', 'un error de proveedor termina el run de forma terminal');
  assert.equal(executorCallsRef(), 1, 'un provider_is_error=true no debe disparar reintento del executor');

  let retryCode = null;
  try {
    await harness.run();
  } catch (error) {
    retryCode = error?.code ?? null;
  }
  assert.equal(retryCode, ALREADY_RUN_CODE, 'un estado terminal por error de proveedor no debe permitir un nuevo intento');
  assert.equal(executorCallsRef(), 1);
});

test('la terminación por signal terminal finaliza el run en curso sin reintento', async () => {
  const { canaryPackage } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef, started } = createHangingExecutor();
  const { audit } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  const pending = harness.run();
  await started;
  harness.terminate('SIGTERM');
  const result = await pending;

  assert.equal(result.termination, 'signal', 'la terminación por signal debe reflejarse como termination="signal"');
  assert.equal(result.provider_is_error, false, 'una terminación por signal no es, por sí misma, un error de proveedor');
  assert.equal(executorCallsRef(), 1, 'la terminación por signal no debe disparar reintento del executor');
});

// --- Grupo 2: kill switch fail-closed, integridad del resultado del executor, e identificadores ---

test('el executor con salida de texto no parseable como JSON se rechaza sin auditar éxito', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createRawStringExecutor({ raw: '{ "outcome": "success", ' });
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, INVALID_JSON_CODE, 'una salida no parseable como JSON debe rechazarse con un código específico');
  assert.equal(consumeCallsRef(), 1, 'M1 ya había entregado el paquete antes de invocar al executor');
  assert.equal(executorCallsRef(), 1, 'el executor se invocó exactamente una vez antes de detectar el JSON inválido');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido que no produjo un resultado válido');

  let secondCode = null;
  try {
    await harness.run();
  } catch (error) {
    secondCode = error?.code ?? null;
  }
  assert.equal(secondCode, ALREADY_RUN_CODE, 'un JSON inválido consume el único intento permitido');
});

test('el executor con salida JSON válida pero contrato inválido se rechaza sin auditar éxito', async () => {
  const invalidContractRaw = JSON.stringify({
    provider_is_error: false,
    statusCode: '200', // debe ser number: contrato inválido
    outcome: 'success',
    input_tokens: 12,
    // output_tokens ausente: contrato inválido
  });
  const { canaryPackage } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createRawStringExecutor({ raw: invalidContractRaw });
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, INVALID_RESULT_CONTRACT_CODE, 'un JSON válido que no cumple el contrato del resultado debe rechazarse con un código específico');
  assert.equal(executorCallsRef(), 1, 'el executor se invocó exactamente una vez antes de detectar el contrato inválido');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con un resultado fuera de contrato');

  let secondCode = null;
  try {
    await harness.run();
  } catch (error) {
    secondCode = error?.code ?? null;
  }
  assert.equal(secondCode, ALREADY_RUN_CODE, 'un contrato inválido consume el único intento permitido');
});

test('un correlation_id divergente en el paquete entregado por M1 impide el executor', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage({
    consumeResult: createSyntheticPayload({ correlation_id: DIVERGENT_CORRELATION_ID }),
  });
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, CORRELATION_MISMATCH_CODE, 'un correlation_id divergente en el paquete debe rechazarse de forma fail-closed');
  assert.equal(consumeCallsRef(), 1, 'la divergencia sólo puede detectarse después de consumir el paquete');
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse cuando el correlation_id diverge');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con identificadores divergentes');
});

test('un snapshot_id divergente en el paquete entregado por M1 impide el executor', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage({
    consumeResult: createSyntheticPayload({ snapshot_id: DIVERGENT_SNAPSHOT_ID }),
  });
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, SNAPSHOT_MISMATCH_CODE, 'un snapshot_id divergente en el paquete debe rechazarse de forma fail-closed');
  assert.equal(consumeCallsRef(), 1, 'la divergencia sólo puede detectarse después de consumir el paquete');
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse cuando el snapshot_id diverge');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con identificadores divergentes');
});

test('un kill switch activo en el primer check impide reservar y ejecutar', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const { killSwitch, callsRef: killCallsRef } = createKillSwitch({ reads: [{ enabled: true }] });
  const harness = createHarness({ canaryPackage, executor, audit, killSwitch });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, KILLED_CODE, 'un kill switch activo debe bloquear el run con un código específico');
  assert.equal(killCallsRef(), 1, 'el kill switch debe consultarse antes de cualquier otra acción');
  assert.equal(consumeCallsRef(), 0, 'M1 no debe entregar el paquete si el kill switch está activo desde el primer check');
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse si el kill switch está activo');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido bloqueado por el kill switch');

  let secondCode = null;
  try {
    await harness.run();
  } catch (error) {
    secondCode = error?.code ?? null;
  }
  assert.equal(secondCode, ALREADY_RUN_CODE, 'un kill switch activo consume el único intento permitido');
});

test('la ausencia de fuente de kill switch falla cerrado sin reservar ni ejecutar', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit, killSwitch: undefined });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, KILL_SWITCH_SOURCE_MISSING_CODE, 'la ausencia de fuente de kill switch debe fallar cerrado con un código específico');
  assert.equal(consumeCallsRef(), 0, 'M1 no debe entregar el paquete sin una fuente de kill switch verificable');
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse sin una fuente de kill switch verificable');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido sin fuente de kill switch');
});

test('una fuente de kill switch que lanza/falla en el primer check falla cerrado', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const { killSwitch, callsRef: killCallsRef } = createKillSwitch({ reads: [killSwitchThrows()] });
  const harness = createHarness({ canaryPackage, executor, audit, killSwitch });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, KILL_SWITCH_FAILED_CODE, 'una fuente de kill switch que falla debe tratarse como fallo cerrado');
  assert.equal(killCallsRef(), 1, 'el fallo debe detectarse en el primer intento de consulta');
  assert.equal(consumeCallsRef(), 0, 'M1 no debe entregar el paquete si la fuente del kill switch falló');
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse si la fuente del kill switch falló');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con fuente de kill switch fallida');
});

const AMBIGUOUS_KILL_SWITCH_STATES = Object.freeze([
  Object.freeze({ enabled: false, note: 'unexpected-extra-key' }),
  Object.freeze({ enabled: 'false' }),
  Object.freeze({ enabled: 0 }),
  Object.freeze({}),
  Object.freeze({ disabled: true }),
  null,
  true,
  false,
  'enabled',
]);

test('cualquier estado del kill switch distinto de {enabled:false} o {enabled:true} falla cerrado (nunca se interpreta como seguro)', async () => {
  for (const ambiguousState of AMBIGUOUS_KILL_SWITCH_STATES) {
    const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
    const { audit, entries } = createAudit();
    const { killSwitch } = createKillSwitch({ reads: [ambiguousState] });
    const harness = createHarness({ canaryPackage, executor, audit, killSwitch });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      KILL_SWITCH_AMBIGUOUS_CODE,
      `el estado ${JSON.stringify(ambiguousState)} debe fallar cerrado por ser ambiguo, nunca interpretarse como seguro`,
    );
    assert.equal(consumeCallsRef(), 0, 'M1 no debe entregar el paquete ante un estado ambiguo del kill switch');
    assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse ante un estado ambiguo del kill switch');
    assert.equal(entries.length, 0, 'no debe auditarse un recorrido con estado ambiguo del kill switch');
  }
});

test('un recheck del kill switch activo justo antes del executor lo impide aunque ya se consumió el paquete', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const { killSwitch, callsRef: killCallsRef } = createKillSwitch({ reads: [{ enabled: false }, { enabled: true }] });
  const harness = createHarness({ canaryPackage, executor, audit, killSwitch });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, KILLED_CODE, 'el recheck activo debe bloquear el run igual que el check inicial');
  assert.equal(killCallsRef(), 2, 'el recheck debe realizarse tras consumir el paquete');
  assert.equal(consumeCallsRef(), 1, 'M1 ya había entregado el paquete cuando se detectó el recheck activo');
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse pese a que el paquete ya se había consumido');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido bloqueado en el recheck');
});

test('un recheck del kill switch que falla justo antes del executor lo impide aunque ya se consumió el paquete', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const { killSwitch, callsRef: killCallsRef } = createKillSwitch({ reads: [{ enabled: false }, killSwitchThrows()] });
  const harness = createHarness({ canaryPackage, executor, audit, killSwitch });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, KILL_SWITCH_FAILED_CODE, 'el recheck fallido debe tratarse como fallo cerrado igual que el check inicial');
  assert.equal(killCallsRef(), 2, 'el recheck debe realizarse tras consumir el paquete');
  assert.equal(consumeCallsRef(), 1, 'M1 ya había entregado el paquete cuando falló el recheck');
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse pese a que el paquete ya se había consumido');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con recheck fallido');
});

test('el orden de los checks del kill switch queda probado por contadores: inicial antes de consumir, recheck después de consumir y antes del executor', async () => {
  const collaborators = createOrderedCollaborators();
  const { audit, entries } = createAudit();
  const harness = createHarness({
    canaryPackage: collaborators.canaryPackage,
    executor: collaborators.executor,
    audit,
    killSwitch: collaborators.killSwitch,
  });

  const result = await harness.run();

  assert.equal(result.termination, 'normal', 'con kill switch limpio en ambos checks, el run concluye con normalidad');
  assert.equal(collaborators.killCallsRef(), 2, 'debe haber exactamente dos consultas al kill switch: check inicial y recheck');
  assert.equal(collaborators.consumeCallsRef(), 1, 'M1 debe entregar el paquete exactamente una vez');
  assert.equal(collaborators.executorCallsRef(), 1, 'el executor debe invocarse exactamente una vez');
  assert.deepEqual(
    collaborators.sequence,
    ['kill:1', 'consume:1', 'kill:2', 'executor:1'],
    'el check inicial del kill switch debe preceder a consume(), y el recheck debe ocurrir tras consume() pero antes del executor',
  );
  assert.equal(entries.length, 1, 'un recorrido exitoso con kill switch limpio audita exactamente una vez');
});

// --- Grupo 3A: autorización obligatoria ligada a gate/IDs/revision/reviewer ---

test('la ausencia total de autorización falla cerrado antes del executor', async () => {
  for (const missingAuthorization of [undefined, null]) {
    const { canaryPackage } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
    const { audit, entries } = createAudit();
    const harness = createHarness({ canaryPackage, executor, audit, authorization: missingAuthorization });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      AUTHORIZATION_MISSING_CODE,
      `la autorización ${JSON.stringify(missingAuthorization)} debe tratarse como ausente y fallar cerrado`,
    );
    assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse sin autorización');
    assert.equal(entries.length, 0, 'no debe auditarse un recorrido sin autorización');
  }
});

test('una autorización con alguna clave obligatoria ausente falla cerrado antes del executor', async () => {
  for (const key of REQUIRED_AUTHORIZATION_KEYS) {
    const authorization = omitKey(createValidAuthorization(), key);
    const { canaryPackage } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
    const { audit, entries } = createAudit();
    const harness = createHarness({ canaryPackage, executor, audit, authorization });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      AUTHORIZATION_INCOMPLETE_CODE,
      `una autorización sin la clave "${key}" debe fallar cerrado por incompleta`,
    );
    assert.equal(executorCallsRef(), 0, `el executor no debe invocarse si falta la clave "${key}" en la autorización`);
    assert.equal(entries.length, 0, 'no debe auditarse un recorrido con autorización incompleta');
  }
});

test('un human_reviewer_id vacío o compuesto sólo de espacios falla cerrado antes del executor', async () => {
  for (const emptyReviewerId of ['', '   ']) {
    const authorization = createValidAuthorization({ human_reviewer_id: emptyReviewerId });
    const { canaryPackage } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
    const { audit, entries } = createAudit();
    const harness = createHarness({ canaryPackage, executor, audit, authorization });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      AUTHORIZATION_INCOMPLETE_CODE,
      `un human_reviewer_id ${JSON.stringify(emptyReviewerId)} debe tratarse como ausente y fallar cerrado`,
    );
    assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse con human_reviewer_id vacío');
    assert.equal(entries.length, 0, 'no debe auditarse un recorrido con human_reviewer_id vacío');
  }
});

test('un human_reviewer_id con forma de texto libre en lugar de un ID validado falla cerrado antes del executor', async () => {
  const authorization = createValidAuthorization({
    human_reviewer_id: 'aprobado por el gerente, ver ticket #123 - urgente!',
  });
  const { canaryPackage } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit, authorization });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(
    code,
    AUTHORIZATION_INVALID_REVIEWER_ID_CODE,
    'un human_reviewer_id con forma de texto libre (no un ID validado) debe fallar cerrado',
  );
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse con un human_reviewer_id no validado');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con human_reviewer_id no validado');
});

const AUTHORIZATION_MISMATCH_VARIANTS = Object.freeze([
  { field: 'gate', value: `${AUTHORIZATION_GATE}_DIVERGENT`, label: 'gate' },
  { field: 'correlation_id', value: DIVERGENT_CORRELATION_ID, label: 'correlation_id' },
  { field: 'snapshot_id', value: DIVERGENT_SNAPSHOT_ID, label: 'snapshot_id' },
  { field: 'revision', value: DIVERGENT_REVISION, label: 'revision' },
]);

test('una autorización con gate, correlation_id, snapshot_id o revision divergentes del valor exigido falla cerrada antes del executor', async () => {
  for (const variant of AUTHORIZATION_MISMATCH_VARIANTS) {
    const authorization = createValidAuthorization({ [variant.field]: variant.value });
    const { canaryPackage } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
    const { audit, entries } = createAudit();
    const harness = createHarness({ canaryPackage, executor, audit, authorization });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      AUTHORIZATION_MISMATCH_CODE,
      `una autorización con ${variant.label} divergente ("${variant.value}") debe fallar cerrada`,
    );
    assert.equal(executorCallsRef(), 0, `el executor no debe invocarse con ${variant.label} divergente en la autorización`);
    assert.equal(entries.length, 0, 'no debe auditarse un recorrido con identificadores de autorización divergentes');
  }
});

test('una revision de autorización distinta al commit pineado se rechaza aunque gate, IDs y reviewer sean válidos', async () => {
  const authorization = createValidAuthorization({ revision: DIVERGENT_REVISION });
  const { canaryPackage } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit, authorization });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(
    code,
    AUTHORIZATION_MISMATCH_CODE,
    'una revision distinta al commit pineado c66e9603f356648830ec3b4f7c4507c5ce0953e8 debe rechazarse',
  );
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse con una revision distinta al commit pineado');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con revision divergente');
});

test('una autorización completa y exacta permite el recorrido y el executor se invoca exactamente una vez', async () => {
  const authorization = createValidAuthorization();
  const { canaryPackage } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit, authorization });

  const result = await harness.run();

  assert.equal(result.termination, 'normal', 'una autorización válida no debe impedir un recorrido exitoso');
  assert.equal(executorCallsRef(), 1, 'el executor debe invocarse exactamente una vez con autorización válida');
  assert.equal(entries.length, 1, 'un recorrido autorizado y exitoso debe auditarse exactamente una vez');
});

// --- Grupo 3A: auditoría segura -- allowlist cerrada de nombres, claves y metadatos ---

test('un recorrido exitoso audita exactamente un evento con nombre y claves allowlisted, con valores sólo de metadatos cerrados', async () => {
  const { canaryPackage } = createCanaryPackage();
  const { executor } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  await harness.run();

  assert.equal(entries.length, 1, 'un recorrido exitoso audita exactamente una entrada');
  const [event] = entries;

  assert.equal(
    event.name,
    ALLOWLISTED_AUDIT_EVENT_NAME,
    'el evento auditado debe usar exactamente el nombre allowlisted del recorrido exitoso',
  );
  for (const key of Object.keys(event)) {
    assert.ok(ALLOWLISTED_AUDIT_EVENT_KEYS.includes(key), `la clave auditada "${key}" debe pertenecer a la allowlist cerrada`);
  }

  assert.ok(isValidatedId(event.correlation_id), 'correlation_id auditado debe ser un ID validado');
  assert.ok(isValidatedId(event.snapshot_id), 'snapshot_id auditado debe ser un ID validado');
  assert.ok(isValidatedId(event.human_reviewer_id), 'human_reviewer_id auditado debe ser un ID validado');
  assert.equal(event.gate, AUTHORIZATION_GATE, 'gate auditado debe ser exactamente el gate exigido');
  assert.equal(event.revision, AUTHORIZATION_REVISION, 'revision auditada debe ser exactamente el commit pineado');
  assert.ok(ALLOWLISTED_AUDIT_OUTCOMES.includes(event.outcome), 'outcome auditado debe pertenecer al enum cerrado');
  assert.ok(ALLOWLISTED_AUDIT_TERMINATIONS.includes(event.termination), 'termination auditada debe pertenecer al enum cerrado');
  assert.equal(typeof event.provider_is_error, 'boolean', 'provider_is_error auditado debe ser booleano');
  assert.ok(isClosedNonNegativeFiniteNumber(event.statusCode), 'statusCode auditado debe ser número finito no negativo');
  assert.ok(isClosedNonNegativeFiniteNumber(event.input_tokens), 'input_tokens auditado debe ser número finito no negativo');
  assert.ok(isClosedNonNegativeFiniteNumber(event.output_tokens), 'output_tokens auditado debe ser número finito no negativo');
});

const FORBIDDEN_AUDIT_FIELD_SAMPLES = Object.freeze([
  { key: 'payload', value: 'texto libre sintético de payload' },
  { key: 'policy', value: 'texto libre sintético de policy' },
  { key: 'prompt', value: 'texto libre sintético de prompt' },
  { key: 'brief', value: 'texto libre sintético de brief' },
  { key: 'stderr', value: 'texto libre sintético de traza de error' },
  { key: 'message', value: 'texto libre sintético de mensaje legible' },
  { key: 'commercial_data', value: 'texto libre sintético de datos comerciales' },
  { key: 'unlisted_debug_field', value: 'texto libre sintético de campo desconocido' },
]);

test('un resultado del executor con cualquier clave no allowlisted (incluyendo payload/policy/prompt/brief/stderr/message/commercial_data o campos desconocidos) se rechaza antes de persistir, y el audit sink nunca la recibe', async () => {
  for (const sample of FORBIDDEN_AUDIT_FIELD_SAMPLES) {
    const raw = createSuccessfulRawResultWithExtraFields({ [sample.key]: sample.value });
    const { canaryPackage } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createRawStringExecutor({ raw });
    const { audit, entries } = createAudit();
    const harness = createHarness({ canaryPackage, executor, audit });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      AUDIT_UNSAFE_RESULT_FIELDS_CODE,
      `la clave "${sample.key}" con valor de texto libre debe rechazarse antes de auditar`,
    );
    assert.equal(executorCallsRef(), 1, 'el executor ya se había invocado; el rechazo ocurre al validar el resultado antes de auditar');
    assert.equal(entries.length, 0, `el audit sink nunca debe recibir el evento cuando la clave "${sample.key}" está presente`);
    assert.equal(
      JSON.stringify(entries).includes(sample.value),
      false,
      `el audit sink nunca debe recibir el texto libre asociado a la clave "${sample.key}"`,
    );
  }
});

const UNSAFE_AUDIT_METADATA_VALUE_VARIANTS = Object.freeze([
  { field: 'input_tokens', value: -1, label: 'input_tokens negativo' },
  { field: 'output_tokens', value: -1, label: 'output_tokens negativo' },
  { field: 'statusCode', value: -200, label: 'statusCode negativo' },
  {
    field: 'outcome',
    value: 'success - nota libre del revisor, aprobado manualmente sin más detalle',
    label: 'outcome de texto libre fuera del enum cerrado',
  },
]);

test('un resultado del executor con valores fuera de los metadatos cerrados (negativos o fuera del enum) se rechaza antes de persistir, y el audit sink nunca la recibe', async () => {
  for (const variant of UNSAFE_AUDIT_METADATA_VALUE_VARIANTS) {
    const raw = JSON.stringify({
      provider_is_error: false,
      statusCode: 200,
      outcome: 'success',
      input_tokens: 12,
      output_tokens: 34,
      [variant.field]: variant.value,
    });
    const { canaryPackage } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createRawStringExecutor({ raw });
    const { audit, entries } = createAudit();
    const harness = createHarness({ canaryPackage, executor, audit });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      AUDIT_UNSAFE_METADATA_VALUE_CODE,
      `${variant.label} debe rechazarse antes de auditar por no ser metadato cerrado`,
    );
    assert.equal(executorCallsRef(), 1, 'el executor ya se había invocado; el rechazo ocurre al validar el resultado antes de auditar');
    assert.equal(entries.length, 0, `el audit sink nunca debe recibir el evento cuando ${variant.label}`);
  }
});

// --- Grupo 3B: contrato de costo obligatorio, medidor como única fuente de verdad ---

test('con costo <= techo, costMeter.measure recibe exactamente las cuatro claves esperadas y su valor es la única fuente de actual_cost_usd', async () => {
  const { canaryPackage } = createCanaryPackage();
  const { executor } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  let measureCalls = 0;
  let measureArgs = null;
  const costMeter = Object.freeze({
    async measure(args) {
      measureCalls += 1;
      measureArgs = args;
      return SYNTHETIC_MEASURED_COST_USD;
    },
  });
  const harness = createHarness({
    canaryPackage,
    executor,
    audit,
    cost_ceiling_usd: SYNTHETIC_COST_CEILING_USD,
    costMeter,
  });

  const result = await harness.run();

  assert.equal(measureCalls, 1, 'costMeter.measure debe invocarse exactamente una vez');
  assert.deepEqual(
    measureArgs,
    {
      input_tokens: 12,
      output_tokens: 34,
      correlation_id: CORRELATION_ID,
      snapshot_id: SNAPSHOT_ID,
    },
    'costMeter.measure debe recibir exactamente esas cuatro claves, sin más ni menos',
  );
  assert.equal(
    result.actual_cost_usd,
    SYNTHETIC_MEASURED_COST_USD,
    'el resultado debe exponer actual_cost_usd exactamente igual al valor devuelto por costMeter.measure',
  );

  assert.equal(entries.length, 1, 'un recorrido exitoso con costo bajo el techo audita exactamente una entrada');
  assert.equal(
    entries[0].actual_cost_usd,
    SYNTHETIC_MEASURED_COST_USD,
    'el actual_cost_usd auditado debe ser exactamente el valor devuelto por costMeter.measure',
  );
});

test('cost_ceiling_usd ausente (undefined o null) falla cerrado antes del executor y consume el único intento', async () => {
  for (const missingCeiling of [undefined, null]) {
    const { canaryPackage } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
    const { audit, entries } = createAudit();
    const harness = createHarness({ canaryPackage, executor, audit, cost_ceiling_usd: missingCeiling });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      COST_CEILING_MISSING_CODE,
      `cost_ceiling_usd ${JSON.stringify(missingCeiling)} debe tratarse como ausente y fallar cerrado`,
    );
    assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse sin cost_ceiling_usd');
    assert.equal(entries.length, 0, 'no debe auditarse un recorrido sin cost_ceiling_usd');

    let secondCode = null;
    try {
      await harness.run();
    } catch (error) {
      secondCode = error?.code ?? null;
    }
    assert.equal(secondCode, ALREADY_RUN_CODE, 'cost_ceiling_usd ausente consume el único intento permitido');
  }
});

const INVALID_COST_CEILING_VALUES = Object.freeze([
  NaN,
  Infinity,
  -Infinity,
  0,
  -SYNTHETIC_COST_CEILING_USD,
  '0.000001337',
  true,
  { usd: SYNTHETIC_COST_CEILING_USD },
]);

test('cost_ceiling_usd presente pero inválido (NaN/Infinity/-Infinity/0/negativo/string/boolean/object) falla cerrado antes del executor', async () => {
  for (const invalidCeiling of INVALID_COST_CEILING_VALUES) {
    const { canaryPackage } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
    const { audit, entries } = createAudit();
    const harness = createHarness({ canaryPackage, executor, audit, cost_ceiling_usd: invalidCeiling });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      COST_CEILING_INVALID_CODE,
      `cost_ceiling_usd ${JSON.stringify(invalidCeiling)} debe fallar cerrado por inválido`,
    );
    assert.equal(executorCallsRef(), 0, `el executor no debe invocarse con cost_ceiling_usd ${JSON.stringify(invalidCeiling)}`);
    assert.equal(entries.length, 0, 'no debe auditarse un recorrido con cost_ceiling_usd inválido');
  }
});

test('costMeter ausente (undefined o null) con un techo válido falla cerrado antes del executor y consume el único intento', async () => {
  for (const missingCostMeter of [undefined, null]) {
    const { canaryPackage } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
    const { audit, entries } = createAudit();
    const harness = createHarness({
      canaryPackage,
      executor,
      audit,
      cost_ceiling_usd: SYNTHETIC_COST_CEILING_USD,
      costMeter: missingCostMeter,
    });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      COST_METER_MISSING_CODE,
      `costMeter ${JSON.stringify(missingCostMeter)} debe tratarse como ausente y fallar cerrado`,
    );
    assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse sin costMeter');
    assert.equal(entries.length, 0, 'no debe auditarse un recorrido sin costMeter');

    let secondCode = null;
    try {
      await harness.run();
    } catch (error) {
      secondCode = error?.code ?? null;
    }
    assert.equal(secondCode, ALREADY_RUN_CODE, 'costMeter ausente consume el único intento permitido');
  }
});

// Medidor de costo sintético que siempre lanza/rechaza, nunca proviene de un proveedor/CRM real.
function createThrowingCostMeter() {
  let calls = 0;
  const costMeter = Object.freeze({
    async measure() {
      calls += 1;
      throw new Error('synthetic cost meter failure');
    },
  });
  return { costMeter, callsRef: () => calls };
}

// Medidor de costo sintético que siempre resuelve el valor fijo dado, nunca proviene de un
// proveedor/CRM real.
function createFixedCostMeter(value) {
  let calls = 0;
  const costMeter = Object.freeze({
    async measure() {
      calls += 1;
      return value;
    },
  });
  return { costMeter, callsRef: () => calls };
}

test('costMeter.measure que lanza/rechaza falla cerrado tras invocar el executor, sin auditar, y consume el único intento', async () => {
  const { canaryPackage } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const { costMeter, callsRef: measureCallsRef } = createThrowingCostMeter();
  const harness = createHarness({
    canaryPackage,
    executor,
    audit,
    cost_ceiling_usd: SYNTHETIC_COST_CEILING_USD,
    costMeter,
  });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, COST_METER_FAILED_CODE, 'un costMeter.measure que lanza/rechaza debe fallar cerrado con un código específico');
  assert.equal(executorCallsRef(), 1, 'el executor ya se había invocado antes de invocar al medidor de costo');
  assert.equal(measureCallsRef(), 1, 'el medidor de costo debe invocarse exactamente una vez antes de fallar');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con medidor de costo fallido');

  let secondCode = null;
  try {
    await harness.run();
  } catch (error) {
    secondCode = error?.code ?? null;
  }
  assert.equal(secondCode, ALREADY_RUN_CODE, 'un medidor de costo fallido consume el único intento permitido');
});

const UNKNOWN_MEASURED_COST_VALUES = Object.freeze([
  undefined,
  null,
  NaN,
  Infinity,
  -Infinity,
  -SYNTHETIC_MEASURED_COST_USD,
  '0.0000005',
  { usd: SYNTHETIC_MEASURED_COST_USD },
]);

test('costMeter.measure que resuelve un valor null/undefined/no finito/negativo/no numérico falla cerrado con COST_UNKNOWN_CODE', async () => {
  for (const unknownCost of UNKNOWN_MEASURED_COST_VALUES) {
    const { canaryPackage } = createCanaryPackage();
    const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
    const { audit, entries } = createAudit();
    const { costMeter, callsRef: measureCallsRef } = createFixedCostMeter(unknownCost);
    const harness = createHarness({
      canaryPackage,
      executor,
      audit,
      cost_ceiling_usd: SYNTHETIC_COST_CEILING_USD,
      costMeter,
    });

    let code = null;
    try {
      await harness.run();
    } catch (error) {
      code = error?.code ?? null;
    }

    assert.equal(
      code,
      COST_UNKNOWN_CODE,
      `costMeter.measure resolviendo ${JSON.stringify(unknownCost)} debe fallar cerrado por costo desconocido`,
    );
    assert.equal(executorCallsRef(), 1, `el executor ya se había invocado antes de detectar el costo desconocido ${JSON.stringify(unknownCost)}`);
    assert.equal(measureCallsRef(), 1, `el medidor de costo debe invocarse exactamente una vez antes de fallar con ${JSON.stringify(unknownCost)}`);
    assert.equal(entries.length, 0, `no debe auditarse un recorrido con costo desconocido ${JSON.stringify(unknownCost)}`);
  }
});

test('costMeter.measure que resuelve un costo mayor que el techo falla cerrado con COST_CEILING_EXCEEDED_CODE', async () => {
  const { canaryPackage } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const { costMeter, callsRef: measureCallsRef } = createFixedCostMeter(SYNTHETIC_EXCEEDING_COST_USD);
  const harness = createHarness({
    canaryPackage,
    executor,
    audit,
    cost_ceiling_usd: SYNTHETIC_COST_CEILING_USD,
    costMeter,
  });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(code, COST_CEILING_EXCEEDED_CODE, 'un costo medido mayor que el techo debe fallar cerrado con un código específico');
  assert.equal(executorCallsRef(), 1, 'el executor ya se había invocado antes de comparar el costo medido contra el techo');
  assert.equal(measureCallsRef(), 1, 'el medidor de costo debe invocarse exactamente una vez antes de fallar');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido cuyo costo medido excede el techo');
});

test('un resultado del executor que incluye actual_cost_usd se rechaza como campo inseguro sin invocar el medidor ni auditar, aunque el medidor sería válido', async () => {
  const raw = createSuccessfulRawResultWithExtraFields({ actual_cost_usd: SYNTHETIC_MEASURED_COST_USD });
  const { canaryPackage } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createRawStringExecutor({ raw });
  const { audit, entries } = createAudit();
  const { costMeter, callsRef: measureCallsRef } = createFixedCostMeter(SYNTHETIC_MEASURED_COST_USD);
  const harness = createHarness({
    canaryPackage,
    executor,
    audit,
    cost_ceiling_usd: SYNTHETIC_COST_CEILING_USD,
    costMeter,
  });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(
    code,
    AUDIT_UNSAFE_RESULT_FIELDS_CODE,
    'un actual_cost_usd propuesto por el executor debe rechazarse como campo inseguro, nunca aceptarse como fuente de costo',
  );
  assert.equal(executorCallsRef(), 1, 'el executor ya se había invocado antes de detectar el campo inseguro');
  assert.equal(measureCallsRef(), 0, 'el medidor de costo no debe invocarse cuando el resultado crudo ya se rechazó por campo inseguro');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con actual_cost_usd propuesto por el executor');
});

test('un kill switch activo en el check inicial gana aunque authorization/cost_ceiling_usd/costMeter estén ausentes', async () => {
  const { canaryPackage, callsRef: consumeCallsRef } = createCanaryPackage();
  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const { killSwitch, callsRef: killCallsRef } = createKillSwitch({ reads: [{ enabled: true }] });
  const harness = createHarness({
    canaryPackage,
    executor,
    audit,
    killSwitch,
    authorization: null,
    cost_ceiling_usd: null,
    costMeter: null,
  });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(
    code,
    KILLED_CODE,
    'el kill switch activo en el check inicial debe ganar aunque authorization/cost_ceiling_usd/costMeter también sean inválidos',
  );
  assert.equal(killCallsRef(), 1, 'el kill switch debe leerse exactamente una vez antes de detenerse');
  assert.equal(consumeCallsRef(), 0, 'M1 no debe entregar el paquete si el kill switch ya bloqueó el run');
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse si el kill switch ya bloqueó el run');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido bloqueado por el kill switch inicial');
});

test('un provider_is_error=true audita exactamente un evento con termination="error", outcome="provider_error" y sólo claves allowlisted', async () => {
  const { canaryPackage } = createCanaryPackage();
  const { executor } = createResolvingExecutor({ result: createProviderErrorRawResult() });
  const { audit, entries } = createAudit();
  const harness = createHarness({ canaryPackage, executor, audit });

  const result = await harness.run();

  assert.equal(result.provider_is_error, true, 'el error de proveedor debe propagarse al resultado correlacionado');
  assert.equal(result.termination, 'error', 'un error de proveedor termina el run con termination="error"');

  assert.equal(entries.length, 1, 'un error de proveedor debe auditarse exactamente una vez');
  const [event] = entries;

  for (const key of Object.keys(event)) {
    assert.ok(ALLOWLISTED_AUDIT_EVENT_KEYS.includes(key), `la clave auditada "${key}" debe pertenecer a la allowlist cerrada`);
  }
  assert.equal(event.termination, 'error', 'termination auditada debe ser exactamente "error"');
  assert.equal(event.outcome, 'provider_error', 'outcome auditado debe ser exactamente "provider_error"');
  assert.equal(event.provider_is_error, true, 'provider_is_error auditado debe reflejar el error de proveedor');
});

// --- Grupo 4: recorrido end-to-end offline -- engine real -> paquete reducido real -> harness ---
//
// Este recorrido nunca toca un proveedor/red/CRM real: el `client.run` del engine captura los
// argumentos reales que el engine construiría para el proveedor y lanza de inmediato, sin
// completar ninguna llamada; el paquete reducido se produce con la lógica de reducción real
// (createAgt003SingleCanaryPackage) sobre esos argumentos capturados; y el executor del harness
// es puramente sintético.

test('recorrido end-to-end offline: engine real captura el payload real, el paquete reducido real llega intacto al executor del harness sintético', async () => {
  const request = JSON.parse(
    readFileSync(new URL('../contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-request.json', import.meta.url), 'utf8'),
  );

  let capturedRunArgs = null;
  const engine = createAgt003CopilotEngine({
    client: {
      async run(args) {
        capturedRunArgs = args;
        throw new Error('synthetic capture: aborting before any provider/network round-trip');
      },
    },
    model: 'synthetic-e2e-model',
    policyVersion: 'synthetic-e2e-policy-v1',
    countDailyRuns: async () => 0,
  });

  await assert.rejects(() => engine.draft(request), 'el draft sintético debe rechazarse tras capturar los argumentos, sin completar el round-trip');
  assert.ok(capturedRunArgs, 'client.run debe haberse invocado exactamente una vez para capturar el payload real construido por el engine');

  const { policy, input, outputSchema } = capturedRunArgs;

  const canaryPackage = createAgt003SingleCanaryPackage({ policy, input, outputSchema });
  assert.equal(canaryPackage.manifest.isSmaller, true, 'el paquete reducido real debe ser estrictamente más pequeño que el payload fuente capturado');

  const expectedReducedPayload = reduceAgt003PayloadOffline({ policy, input, outputSchema });

  const requestCorrelationId = request.correlation_id;
  const requestSnapshotId = request.snapshot_id;
  const authorization = createValidAuthorization({
    correlation_id: requestCorrelationId,
    snapshot_id: requestSnapshotId,
  });

  let executorCalls = 0;
  let capturedPayload = null;
  let capturedContext = null;
  const executor = async (payload, context) => {
    executorCalls += 1;
    capturedPayload = payload;
    capturedContext = context;
    return createSuccessfulRawResult();
  };

  const { audit, entries } = createAudit();
  const harness = createAgt003ReducedCanaryHarness({
    correlation_id: requestCorrelationId,
    snapshot_id: requestSnapshotId,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    canaryPackage,
    executor,
    audit,
    killSwitch: createDefaultKillSwitch(),
    authorization,
    cost_ceiling_usd: SYNTHETIC_COST_CEILING_USD,
    costMeter: Object.freeze({ async measure() { return SYNTHETIC_MEASURED_COST_USD; } }),
  });

  const result = await harness.run();

  assert.equal(result.termination, 'normal', 'el recorrido offline completo debe concluir con normalidad');
  assert.equal(executorCalls, 1, 'el executor debe invocarse exactamente una vez');
  assert.ok(capturedContext && typeof capturedContext === 'object' && capturedContext.signal instanceof AbortSignal, 'el executor debe recibir un contexto con signal');

  assert.deepEqual(capturedPayload, expectedReducedPayload, 'el executor debe recibir exactamente el paquete reducido real, sin alterarlo');
  assert.equal(capturedPayload.input.correlation_id, requestCorrelationId, 'el correlation_id dentro del paquete reducido debe ser idéntico al de la request original');
  assert.equal(capturedPayload.input.snapshot_id, requestSnapshotId, 'el snapshot_id dentro del paquete reducido debe ser idéntico al de la request original');
  assert.equal(result.correlation_id, requestCorrelationId, 'el correlation_id del resultado debe ser idéntico al de la request original');
  assert.equal(result.snapshot_id, requestSnapshotId, 'el snapshot_id del resultado debe ser idéntico al de la request original');

  assert.equal(entries.length, 1, 'un recorrido exitoso audita exactamente una entrada');
  const [event] = entries;
  for (const forbiddenKey of ['policy', 'input', 'outputSchema', 'payload', 'brief']) {
    assert.equal(Object.hasOwn(event, forbiddenKey), false, `la auditoría nunca debe exponer la clave "${forbiddenKey}"`);
  }

  let secondCode = null;
  try {
    await harness.run();
  } catch (error) {
    secondCode = error?.code ?? null;
  }
  assert.equal(secondCode, ALREADY_RUN_CODE, 'un segundo run del mismo harness debe rechazarse con el código de un solo intento agotado');
  assert.equal(executorCalls, 1, 'el executor no debe invocarse una segunda vez');
});

// --- Grupo 5: paquete fresco real (M1 real) con identificadores divergentes respecto al harness ---
//
// Igual que el recorrido end-to-end offline del Grupo 4 -- engine real captura {policy, input,
// outputSchema} vía client.run sintético que lanza antes de completar ningún round-trip -- pero el
// paquete reducido real (createAgt003SingleCanaryPackage) se consume contra un harness configurado
// con un correlation_id/snapshot_id que diverge del que trae el paquete. authorization es válida
// para los IDs configurados en el harness (no para los del paquete), de forma que la única causa
// posible del rechazo sea la divergencia de identificadores entre el paquete y el harness.

async function captureAgt003CopilotEngineRunArgs(request) {
  let capturedRunArgs = null;
  const engine = createAgt003CopilotEngine({
    client: {
      async run(args) {
        capturedRunArgs = args;
        throw new Error('synthetic capture: aborting before any provider/network round-trip');
      },
    },
    model: 'synthetic-e2e-model',
    policyVersion: 'synthetic-e2e-policy-v1',
    countDailyRuns: async () => 0,
  });

  await assert.rejects(() => engine.draft(request), 'el draft sintético debe rechazarse tras capturar los argumentos, sin completar el round-trip');
  assert.ok(capturedRunArgs, 'client.run debe haberse invocado exactamente una vez para capturar el payload real construido por el engine');
  return capturedRunArgs;
}

test('un paquete fresco real (M1 real) con correlation_id divergente del harness impide el executor', async () => {
  const request = JSON.parse(
    readFileSync(new URL('../contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-request.json', import.meta.url), 'utf8'),
  );
  const { policy, input, outputSchema } = await captureAgt003CopilotEngineRunArgs(request);
  const canaryPackage = createAgt003SingleCanaryPackage({ policy, input, outputSchema });

  const harnessCorrelationId = DIVERGENT_CORRELATION_ID;
  const harnessSnapshotId = request.snapshot_id;
  const authorization = createValidAuthorization({
    correlation_id: harnessCorrelationId,
    snapshot_id: harnessSnapshotId,
  });

  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const harness = createAgt003ReducedCanaryHarness({
    correlation_id: harnessCorrelationId,
    snapshot_id: harnessSnapshotId,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    canaryPackage,
    executor,
    audit,
    killSwitch: createDefaultKillSwitch(),
    authorization,
    cost_ceiling_usd: SYNTHETIC_COST_CEILING_USD,
    costMeter: Object.freeze({ async measure() { return SYNTHETIC_MEASURED_COST_USD; } }),
  });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(
    code,
    CORRELATION_MISMATCH_CODE,
    'un correlation_id de harness distinto al del paquete real entregado por M1 debe rechazarse de forma fail-closed',
  );
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse cuando el correlation_id del paquete real diverge del harness');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con identificadores divergentes en el paquete real');
});

test('un paquete fresco real (M1 real) con snapshot_id divergente del harness impide el executor', async () => {
  const request = JSON.parse(
    readFileSync(new URL('../contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-request.json', import.meta.url), 'utf8'),
  );
  const { policy, input, outputSchema } = await captureAgt003CopilotEngineRunArgs(request);
  const canaryPackage = createAgt003SingleCanaryPackage({ policy, input, outputSchema });

  const harnessCorrelationId = request.correlation_id;
  const harnessSnapshotId = DIVERGENT_SNAPSHOT_ID;
  const authorization = createValidAuthorization({
    correlation_id: harnessCorrelationId,
    snapshot_id: harnessSnapshotId,
  });

  const { executor, callsRef: executorCallsRef } = createResolvingExecutor();
  const { audit, entries } = createAudit();
  const harness = createAgt003ReducedCanaryHarness({
    correlation_id: harnessCorrelationId,
    snapshot_id: harnessSnapshotId,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    canaryPackage,
    executor,
    audit,
    killSwitch: createDefaultKillSwitch(),
    authorization,
    cost_ceiling_usd: SYNTHETIC_COST_CEILING_USD,
    costMeter: Object.freeze({ async measure() { return SYNTHETIC_MEASURED_COST_USD; } }),
  });

  let code = null;
  try {
    await harness.run();
  } catch (error) {
    code = error?.code ?? null;
  }

  assert.equal(
    code,
    SNAPSHOT_MISMATCH_CODE,
    'un snapshot_id de harness distinto al del paquete real entregado por M1 debe rechazarse de forma fail-closed',
  );
  assert.equal(executorCallsRef(), 0, 'el executor no debe invocarse cuando el snapshot_id del paquete real diverge del harness');
  assert.equal(entries.length, 0, 'no debe auditarse un recorrido con identificadores divergentes en el paquete real');
});
