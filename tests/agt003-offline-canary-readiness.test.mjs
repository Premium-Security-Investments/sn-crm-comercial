import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODULE_SPECIFIER = '../agt003-offline-canary-readiness.js';
const MODULE_FILE_PATH = fileURLToPath(new URL(MODULE_SPECIFIER, import.meta.url));

const AUTHORIZATION = Object.freeze({ gate: 'AGT003_REDUCED_CANARY', approved: true });

const HUMAN_GATE_CODE = 'AGT003_CANARY_HUMAN_GATE_REQUIRED';
const KILLED_CODE = 'AGT003_CANARY_KILLED';
const ATTEMPT_EXHAUSTED_CODE = 'AGT003_CANARY_ATTEMPT_EXHAUSTED';
const PACKAGE_FAILED_CODE = 'AGT003_CANARY_PACKAGE_FAILED';
const AUDIT_FAILED_CODE = 'AGT003_CANARY_AUDIT_FAILED';
const EXECUTOR_FAILED_CODE = 'AGT003_CANARY_EXECUTOR_FAILED';
const UNSAFE_RESULT_CODE = 'AGT003_CANARY_UNSAFE_RESULT';
const KILL_SWITCH_FAILED_CODE = 'AGT003_OFFLINE_CANARY_KILL_SWITCH_FAILED';

// In-memory-only sentinels: never logged, only compared programmatically.
const CONSUME_SENTINEL = 'synthetic-consume-sentinel-9f2c9a';
const EXECUTOR_REJECT_SENTINEL = 'synthetic-executor-reject-sentinel-5b1a71';
const CONSUME_REJECT_SENTINEL = 'synthetic-consume-reject-sentinel-7d44e0';
const AUDIT_REJECT_SENTINEL = 'synthetic-audit-reject-sentinel-3e91cd';
const BUSINESS_SENTINEL = 'Cliente Sintético Ñu S.A. oportunidad confidencial';
const KILL_SWITCH_THROW_SENTINEL = 'synthetic-kill-switch-throw-sentinel-6c8f2e';
const REDUCED_PAYLOAD_SENTINEL = 'synthetic-reduced-payload-sentinel-2a77f1';
const ALL_SENTINELS = [CONSUME_SENTINEL, EXECUTOR_REJECT_SENTINEL, CONSUME_REJECT_SENTINEL, AUDIT_REJECT_SENTINEL, BUSINESS_SENTINEL];

const SOURCE_PURITY_ASSERTION_MESSAGE = 'AGT-003 offline canary readiness module must not reference forbidden imports/calls.';
const IMPORT_SIDE_EFFECT_ASSERTION_MESSAGE = 'importing the module must perform zero fetch/timer/audit/executor/consume side effects.';
const MANIFEST_SHAPE_ASSERTION_MESSAGE = 'the synthetic M1 comparison manifest fixture must be internally consistent.';
const ACCEPTED_MANIFEST_ASSERTION_MESSAGE = 'a well-formed M1-shaped manifest must be accepted without consume/executor calls.';
const MALFORMED_MANIFEST_ASSERTION_MESSAGE = 'a malformed/extra-key manifest must be rejected before consume/executor.';
const AUTHORIZATION_GATE_ASSERTION_MESSAGE = 'missing/wrong authorization must throw the generic human-gate code before consume/executor.';
const KILL_SWITCH_ASSERTION_MESSAGE = 'an engaged kill switch must block before consume/executor with the generic killed code.';
const MID_RUN_KILL_SWITCH_ASSERTION_MESSAGE = 'the kill switch must be rechecked after consume and before executor invocation.';
const SINGLE_EXECUTION_ASSERTION_MESSAGE = 'an approved run must consume once and invoke the executor exactly once.';
const CONCURRENT_ATTEMPT_ASSERTION_MESSAGE = 'attempt reservation must happen synchronously before any await, failing a concurrent second run.';
const TERMINAL_RETRY_ASSERTION_MESSAGE = 'any retry after a terminal state must fail with the same one-shot attempt-exhausted code.';
const PACKAGE_FAILURE_ASSERTION_MESSAGE = 'a consume() rejection must become the generic package-failed code without leaking the rejection.';
const AUDIT_FAILURE_ASSERTION_MESSAGE = 'a pre-execution audit rejection must fail closed before executor invocation.';
const EXECUTOR_FAILURE_ASSERTION_MESSAGE = 'an executor rejection must become the generic executor-failed code without leaking the rejection.';
const UNSAFE_RESULT_ASSERTION_MESSAGE = 'an executor result outside the exact safe envelope must fail closed with the unsafe-result code.';
const SAFE_RESULT_ASSERTION_MESSAGE = 'a successful run result must contain only the safe envelope keys.';
const AUDIT_ALLOWLIST_ASSERTION_MESSAGE = 'every audit event must contain only allowlisted event/status/attempt/count/boolean fields.';
const STATE_SHAPE_ASSERTION_MESSAGE = 'getState() must return only the state enum, attempt integer, and terminal/executionStarted booleans.';
const MODULE_SURFACE_ASSERTION_MESSAGE = 'the module surface must be exactly one constructor and accept no CRM mutation callback.';
const KILL_SWITCH_THROW_ASSERTION_MESSAGE = 'an isKilled() that throws must fail closed with the generic kill-switch-failed code, no leakage, and a terminal safe state.';
const REDUCED_PAYLOAD_ASSERTION_MESSAGE = 'the executor must receive exactly the consumed reduced-payload object, with no payload leakage into audit/result/state.';
const M1_M2_INTEGRATION_ASSERTION_MESSAGE = 'a real M1 canary package driven through the M2 offline canary readiness controller must succeed once, deliver the consumed reduced payload to the executor, leak no policy/input/schema/payload/business fixture text into audit/result/state, and refuse a second run.';

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function buildValidManifest(overrides = {}) {
  const base = {
    sourcePolicyBytes: 4200,
    reducedPolicyBytes: 950,
    sourceInputBytes: 2300,
    reducedInputBytes: 2300,
    sourceOutputSchemaBytes: 1600,
    reducedOutputSchemaBytes: 1150,
    sourcePolicySha256: sha256Hex('synthetic-source-policy-fixture-a1'),
    reducedPolicySha256: sha256Hex('synthetic-reduced-policy-fixture-a2'),
    sourceInputSha256: sha256Hex('synthetic-source-input-fixture-a3'),
    reducedInputSha256: sha256Hex('synthetic-reduced-input-fixture-a4'),
    sourceOutputSchemaSha256: sha256Hex('synthetic-source-schema-fixture-a5'),
    reducedOutputSchemaSha256: sha256Hex('synthetic-reduced-schema-fixture-a6'),
    ...overrides,
  };
  const sourceTotalBytes = base.sourcePolicyBytes + base.sourceInputBytes + base.sourceOutputSchemaBytes;
  const reducedTotalBytes = base.reducedPolicyBytes + base.reducedInputBytes + base.reducedOutputSchemaBytes;
  return Object.freeze({
    ...base,
    sourceTotalBytes,
    reducedTotalBytes,
    bytesSaved: sourceTotalBytes - reducedTotalBytes,
    isSmaller: reducedTotalBytes < sourceTotalBytes,
  });
}

const MANIFEST_ALLOWED_KEYS = Object.keys(buildValidManifest()).sort();

function buildMalformedManifestVariants() {
  const base = buildValidManifest();
  const withExtraKey = { ...base, unexpectedExtraKey: 'synthetic-extra-key-fixture' };
  const withMissingKey = { ...base };
  delete withMissingKey.bytesSaved;
  const withStringCount = { ...base, sourcePolicyBytes: String(base.sourcePolicyBytes) };
  const withNonHexHash = { ...base, sourcePolicySha256: 'not-a-hex-hash' };
  const withInconsistentArithmetic = { ...base, bytesSaved: base.bytesSaved + 1 };
  const withIsSmallerFalse = { ...base, isSmaller: false };
  const withNegativeCount = { ...base, reducedPolicyBytes: -1 };
  return [withExtraKey, withMissingKey, withStringCount, withNonHexHash, withInconsistentArithmetic, withIsSmallerFalse, withNegativeCount];
}

function createCanaryPackage({ manifest = buildValidManifest(), consumeResult = { inMemorySentinel: CONSUME_SENTINEL }, consumeError = null, consumeImpl = null } = {}) {
  let consumeCalls = 0;
  const pkg = Object.freeze({
    manifest,
    async consume() {
      consumeCalls += 1;
      if (consumeImpl) return consumeImpl();
      if (consumeError) throw consumeError;
      return consumeResult;
    },
  });
  return { pkg, calls: { get consumeCalls() { return consumeCalls; } } };
}

function createExecutor({ result = { ok: true, outcome: 'success', statusCode: 200 }, error = null } = {}) {
  let calls = 0;
  const executor = async (...args) => {
    calls += 1;
    if (error) throw error;
    return result;
  };
  return { executor, callsRef: () => calls };
}

function createAudit({ error = null } = {}) {
  const events = [];
  const audit = async (event) => {
    events.push(event);
    if (error) throw error;
  };
  return { audit, events };
}

function createIsKilledSequence(values) {
  let index = 0;
  return () => {
    const value = index < values.length ? values[index] : values[values.length - 1];
    index += 1;
    return value;
  };
}

const FORBIDDEN_IMPORT_PATTERN = /(?:from\s+['"]|require\(\s*['"])(?:node:)?(fs|net|http|https|child_process)['"]/;
const FORBIDDEN_FETCH_CALL_PATTERN = /\bfetch\s*\(/;
const FORBIDDEN_CRM_MUTATOR_PATTERN = /crm[-_]?(mutate|write|update|delete)/i;

test('module source contains no child_process/fs/net/http/https/fetch/CRM-mutator references; importing performs zero fetch/spawn/timer/audit/executor/consume side effects', async () => {
  const moduleSource = readFileSync(MODULE_FILE_PATH, 'utf8');
  assert.equal(FORBIDDEN_IMPORT_PATTERN.test(moduleSource), false, SOURCE_PURITY_ASSERTION_MESSAGE);
  assert.equal(FORBIDDEN_FETCH_CALL_PATTERN.test(moduleSource), false, SOURCE_PURITY_ASSERTION_MESSAGE);
  assert.equal(FORBIDDEN_CRM_MUTATOR_PATTERN.test(moduleSource), false, SOURCE_PURITY_ASSERTION_MESSAGE);

  let fetchCalls = 0;
  let timerCalls = 0;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('fetch must not be called by module import'); };
  globalThis.setTimeout = (...timerArgs) => { timerCalls += 1; return originalSetTimeout(...timerArgs); };
  try {
    await import(MODULE_SPECIFIER);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(fetchCalls, 0, IMPORT_SIDE_EFFECT_ASSERTION_MESSAGE);
  assert.equal(timerCalls, 0, IMPORT_SIDE_EFFECT_ASSERTION_MESSAGE);
});

test('constructor rejects malformed/extra-key manifests before consume/executor; an accepted manifest matches the exact M1 safe allowlist with consistent arithmetic', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);

  const validManifest = buildValidManifest();
  assert.deepEqual(Object.keys(validManifest).sort(), MANIFEST_ALLOWED_KEYS, MANIFEST_SHAPE_ASSERTION_MESSAGE);
  assert.equal(validManifest.isSmaller, true, MANIFEST_SHAPE_ASSERTION_MESSAGE);
  assert.ok(validManifest.bytesSaved > 0, MANIFEST_SHAPE_ASSERTION_MESSAGE);
  assert.equal(validManifest.sourceTotalBytes, validManifest.sourcePolicyBytes + validManifest.sourceInputBytes + validManifest.sourceOutputSchemaBytes, MANIFEST_SHAPE_ASSERTION_MESSAGE);
  assert.equal(validManifest.reducedTotalBytes, validManifest.reducedPolicyBytes + validManifest.reducedInputBytes + validManifest.reducedOutputSchemaBytes, MANIFEST_SHAPE_ASSERTION_MESSAGE);
  assert.equal(validManifest.bytesSaved, validManifest.sourceTotalBytes - validManifest.reducedTotalBytes, MANIFEST_SHAPE_ASSERTION_MESSAGE);

  const { pkg: validPackage } = createCanaryPackage({ manifest: validManifest });
  const { executor } = createExecutor();
  const { audit } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);

  let acceptedController = null;
  let constructionThrew = false;
  try {
    acceptedController = createAgt003OfflineCanaryReadinessController({ canaryPackage: validPackage, executor, audit, isKilled });
  } catch {
    constructionThrew = true;
  }
  assert.equal(constructionThrew, false, ACCEPTED_MANIFEST_ASSERTION_MESSAGE);
  const manifestKeysMatch = acceptedController && Object.keys(acceptedController.manifest).sort().join(',') === MANIFEST_ALLOWED_KEYS.join(',');
  assert.equal(manifestKeysMatch, true, ACCEPTED_MANIFEST_ASSERTION_MESSAGE);

  for (const variant of buildMalformedManifestVariants()) {
    const { pkg, calls } = createCanaryPackage({ manifest: variant });
    const { executor: badExecutor, callsRef: badExecutorCallsRef } = createExecutor();
    const { audit: badAudit } = createAudit();
    const badIsKilled = createIsKilledSequence([false, false]);
    let threw = false;
    try {
      createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor: badExecutor, audit: badAudit, isKilled: badIsKilled });
    } catch {
      threw = true;
    }
    assert.equal(threw, true, MALFORMED_MANIFEST_ASSERTION_MESSAGE);
    assert.equal(calls.consumeCalls, 0, MALFORMED_MANIFEST_ASSERTION_MESSAGE);
    assert.equal(badExecutorCallsRef(), 0, MALFORMED_MANIFEST_ASSERTION_MESSAGE);
  }
});

test('authorization must exactly equal {gate:"AGT003_REDUCED_CANARY", approved:true}; missing/wrong authorization throws generic AGT003_CANARY_HUMAN_GATE_REQUIRED without consume/executor', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const invalidAuthorizations = [
    undefined,
    null,
    {},
    { gate: 'AGT003_REDUCED_CANARY' },
    { approved: true },
    { gate: 'AGT003_REDUCED_CANARY', approved: false },
    { gate: 'WRONG_GATE', approved: true },
    { gate: 'AGT003_REDUCED_CANARY', approved: true, extra: 'synthetic-extra-authorization-fixture' },
    { gate: 'AGT003_REDUCED_CANARY', approved: 'true' },
  ];

  for (const authorization of invalidAuthorizations) {
    const { pkg, calls } = createCanaryPackage();
    const { executor, callsRef } = createExecutor();
    const { audit } = createAudit();
    const isKilled = createIsKilledSequence([false, false]);
    const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

    let code = null;
    try {
      await controller.run({ authorization });
    } catch (error) {
      code = error?.code ?? null;
    }
    assert.equal(code, HUMAN_GATE_CODE, AUTHORIZATION_GATE_ASSERTION_MESSAGE);
    assert.equal(calls.consumeCalls, 0, AUTHORIZATION_GATE_ASSERTION_MESSAGE);
    assert.equal(callsRef(), 0, AUTHORIZATION_GATE_ASSERTION_MESSAGE);
  }
});

test('initial kill switch blocks before consume/executor with generic AGT003_CANARY_KILLED', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const { pkg, calls } = createCanaryPackage();
  const { executor, callsRef } = createExecutor();
  const { audit } = createAudit();
  const isKilled = createIsKilledSequence([true, true, true]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  let code = null;
  try {
    await controller.run({ authorization: AUTHORIZATION });
  } catch (error) {
    code = error?.code ?? null;
  }
  assert.equal(code, KILLED_CODE, KILL_SWITCH_ASSERTION_MESSAGE);
  assert.equal(calls.consumeCalls, 0, KILL_SWITCH_ASSERTION_MESSAGE);
  assert.equal(callsRef(), 0, KILL_SWITCH_ASSERTION_MESSAGE);
});

test('kill switch is rechecked after package.consume and before executor; if it flips mid-run, executor remains uninvoked', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const { pkg, calls } = createCanaryPackage();
  const { executor, callsRef } = createExecutor();
  const { audit } = createAudit();
  const isKilled = createIsKilledSequence([false, true]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  let code = null;
  try {
    await controller.run({ authorization: AUTHORIZATION });
  } catch (error) {
    code = error?.code ?? null;
  }
  assert.equal(code, KILLED_CODE, MID_RUN_KILL_SWITCH_ASSERTION_MESSAGE);
  assert.equal(calls.consumeCalls, 1, MID_RUN_KILL_SWITCH_ASSERTION_MESSAGE);
  assert.equal(callsRef(), 0, MID_RUN_KILL_SWITCH_ASSERTION_MESSAGE);
});

test('approved run consumes the canary package once and invokes the injected executor exactly once', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const { pkg, calls } = createCanaryPackage();
  const { executor, callsRef } = createExecutor();
  const { audit } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  const result = await controller.run({ authorization: AUTHORIZATION });
  assert.equal(calls.consumeCalls, 1, SINGLE_EXECUTION_ASSERTION_MESSAGE);
  assert.equal(callsRef(), 1, SINGLE_EXECUTION_ASSERTION_MESSAGE);
  assert.equal(typeof result, 'object', SINGLE_EXECUTION_ASSERTION_MESSAGE);
});

test('attempt state is reserved synchronously before any await, so a concurrent second run fails with AGT003_CANARY_ATTEMPT_EXHAUSTED and executor remains invoked once', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  let releaseConsume;
  const consumeGate = new Promise((resolve) => { releaseConsume = resolve; });
  const { pkg, calls } = createCanaryPackage({
    consumeImpl: async () => {
      await consumeGate;
      return { inMemorySentinel: CONSUME_SENTINEL };
    },
  });
  const { executor, callsRef } = createExecutor();
  const { audit } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  const firstRun = controller.run({ authorization: AUTHORIZATION });
  let secondCode = null;
  try {
    await controller.run({ authorization: AUTHORIZATION });
  } catch (error) {
    secondCode = error?.code ?? null;
  }
  assert.equal(secondCode, ATTEMPT_EXHAUSTED_CODE, CONCURRENT_ATTEMPT_ASSERTION_MESSAGE);
  assert.equal(callsRef(), 0, CONCURRENT_ATTEMPT_ASSERTION_MESSAGE);

  releaseConsume();
  await firstRun;
  assert.equal(callsRef(), 1, CONCURRENT_ATTEMPT_ASSERTION_MESSAGE);
  assert.equal(calls.consumeCalls, 1, CONCURRENT_ATTEMPT_ASSERTION_MESSAGE);
});

test('any retry after terminal state fails with the same one-shot attempt-exhausted code', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const { pkg, calls } = createCanaryPackage();
  const { executor, callsRef } = createExecutor();
  const { audit } = createAudit();
  const isKilled = createIsKilledSequence([false, false, false, false]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  await controller.run({ authorization: AUTHORIZATION });
  assert.equal(callsRef(), 1, TERMINAL_RETRY_ASSERTION_MESSAGE);

  let secondCode = null;
  try {
    await controller.run({ authorization: AUTHORIZATION });
  } catch (error) {
    secondCode = error?.code ?? null;
  }
  assert.equal(secondCode, ATTEMPT_EXHAUSTED_CODE, TERMINAL_RETRY_ASSERTION_MESSAGE);

  let thirdCode = null;
  try {
    await controller.run({ authorization: AUTHORIZATION });
  } catch (error) {
    thirdCode = error?.code ?? null;
  }
  assert.equal(thirdCode, ATTEMPT_EXHAUSTED_CODE, TERMINAL_RETRY_ASSERTION_MESSAGE);
  assert.equal(callsRef(), 1, TERMINAL_RETRY_ASSERTION_MESSAGE);
  assert.equal(calls.consumeCalls, 1, TERMINAL_RETRY_ASSERTION_MESSAGE);
});

test('a consume() rejection becomes the generic AGT003_CANARY_PACKAGE_FAILED code and never includes the rejection message or sentinel', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const rejectionError = new Error(CONSUME_REJECT_SENTINEL);
  const { pkg, calls } = createCanaryPackage({ consumeError: rejectionError });
  const { executor, callsRef } = createExecutor();
  const { audit, events } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  let caughtError = null;
  try {
    await controller.run({ authorization: AUTHORIZATION });
  } catch (error) {
    caughtError = error;
  }
  assert.equal(caughtError?.code, PACKAGE_FAILED_CODE, PACKAGE_FAILURE_ASSERTION_MESSAGE);
  const serializedError = JSON.stringify({ message: caughtError?.message, code: caughtError?.code });
  assert.equal(serializedError.includes(CONSUME_REJECT_SENTINEL), false, PACKAGE_FAILURE_ASSERTION_MESSAGE);
  const serializedAudit = JSON.stringify(events);
  assert.equal(serializedAudit.includes(CONSUME_REJECT_SENTINEL), false, PACKAGE_FAILURE_ASSERTION_MESSAGE);
  assert.equal(callsRef(), 0, PACKAGE_FAILURE_ASSERTION_MESSAGE);
  assert.equal(calls.consumeCalls, 1, PACKAGE_FAILURE_ASSERTION_MESSAGE);
});

test('a pre-execution audit rejection fails closed before executor invocation with generic AGT003_CANARY_AUDIT_FAILED', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const auditRejection = new Error(AUDIT_REJECT_SENTINEL);
  const { pkg } = createCanaryPackage();
  const { executor, callsRef } = createExecutor();
  const { audit } = createAudit({ error: auditRejection });
  const isKilled = createIsKilledSequence([false, false]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  let caughtError = null;
  try {
    await controller.run({ authorization: AUTHORIZATION });
  } catch (error) {
    caughtError = error;
  }
  assert.equal(caughtError?.code, AUDIT_FAILED_CODE, AUDIT_FAILURE_ASSERTION_MESSAGE);
  const serializedError = JSON.stringify({ message: caughtError?.message, code: caughtError?.code });
  assert.equal(serializedError.includes(AUDIT_REJECT_SENTINEL), false, AUDIT_FAILURE_ASSERTION_MESSAGE);
  assert.equal(callsRef(), 0, AUDIT_FAILURE_ASSERTION_MESSAGE);
});

test('an executor rejection becomes the generic AGT003_CANARY_EXECUTOR_FAILED code with no message or sentinel in error, audit, or result', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const executorRejection = new Error(EXECUTOR_REJECT_SENTINEL);
  const { pkg } = createCanaryPackage();
  const { executor, callsRef } = createExecutor({ error: executorRejection });
  const { audit, events } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  let caughtError = null;
  try {
    await controller.run({ authorization: AUTHORIZATION });
  } catch (error) {
    caughtError = error;
  }
  assert.equal(caughtError?.code, EXECUTOR_FAILED_CODE, EXECUTOR_FAILURE_ASSERTION_MESSAGE);
  const serializedError = JSON.stringify({ message: caughtError?.message, code: caughtError?.code });
  assert.equal(serializedError.includes(EXECUTOR_REJECT_SENTINEL), false, EXECUTOR_FAILURE_ASSERTION_MESSAGE);
  const serializedAudit = JSON.stringify(events);
  assert.equal(serializedAudit.includes(EXECUTOR_REJECT_SENTINEL), false, EXECUTOR_FAILURE_ASSERTION_MESSAGE);
  assert.equal(callsRef(), 1, EXECUTOR_FAILURE_ASSERTION_MESSAGE);
});

test('executor outcome must be the exact safe envelope {ok, outcome, statusCode}; extra keys or free text fail closed with AGT003_CANARY_UNSAFE_RESULT', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const unsafeResults = [
    { ok: true, outcome: 'success', statusCode: 200, extraField: 'synthetic-extra-envelope-fixture' },
    { ok: true, outcome: 'success', statusCode: 200, message: EXECUTOR_REJECT_SENTINEL },
    { ok: 'true', outcome: 'success', statusCode: 200 },
    { ok: true, outcome: 'made-up-outcome', statusCode: 200 },
    { ok: true, outcome: 'success', statusCode: 42 },
    { ok: true, outcome: 'success', statusCode: 700 },
    { ok: true, outcome: 'success', statusCode: 200.5 },
    { ok: true, outcome: 'success' },
    { outcome: 'success', statusCode: 200 },
    { ok: true, statusCode: 200 },
    'synthetic-raw-text-fixture',
    null,
  ];

  for (const unsafeResult of unsafeResults) {
    const { pkg } = createCanaryPackage();
    const { executor, callsRef } = createExecutor({ result: unsafeResult });
    const { audit } = createAudit();
    const isKilled = createIsKilledSequence([false, false]);
    const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

    let code = null;
    try {
      await controller.run({ authorization: AUTHORIZATION });
    } catch (error) {
      code = error?.code ?? null;
    }
    assert.equal(code, UNSAFE_RESULT_CODE, UNSAFE_RESULT_ASSERTION_MESSAGE);
    assert.equal(callsRef(), 1, UNSAFE_RESULT_ASSERTION_MESSAGE);
  }

  const { pkg: nullStatusPkg } = createCanaryPackage();
  const { executor: nullStatusExecutor, callsRef: nullStatusCallsRef } = createExecutor({ result: { ok: false, outcome: 'timeout', statusCode: null } });
  const { audit: nullStatusAudit } = createAudit();
  const nullStatusIsKilled = createIsKilledSequence([false, false]);
  const nullStatusController = createAgt003OfflineCanaryReadinessController({ canaryPackage: nullStatusPkg, executor: nullStatusExecutor, audit: nullStatusAudit, isKilled: nullStatusIsKilled });
  const nullStatusResult = await nullStatusController.run({ authorization: AUTHORIZATION });
  assert.equal(nullStatusResult.statusCode, null, UNSAFE_RESULT_ASSERTION_MESSAGE);
  assert.equal(nullStatusCallsRef(), 1, UNSAFE_RESULT_ASSERTION_MESSAGE);
});

test('a successful run result contains only the safe envelope; no raw executor object or text leaks through', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const rawExecutorObject = { ok: true, outcome: 'success', statusCode: 200 };
  Object.defineProperty(rawExecutorObject, 'toString', { value: () => EXECUTOR_REJECT_SENTINEL, enumerable: false });
  const { pkg } = createCanaryPackage();
  const { executor, callsRef } = createExecutor({ result: rawExecutorObject });
  const { audit } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  const result = await controller.run({ authorization: AUTHORIZATION });
  const SAFE_ENVELOPE_KEYS = ['ok', 'outcome', 'statusCode'].sort();
  const keysMatchAllowlist = Object.keys(result).sort().join(',') === SAFE_ENVELOPE_KEYS.join(',');
  assert.equal(keysMatchAllowlist, true, SAFE_RESULT_ASSERTION_MESSAGE);
  assert.equal(result.ok, true, SAFE_RESULT_ASSERTION_MESSAGE);
  assert.equal(result.outcome, 'success', SAFE_RESULT_ASSERTION_MESSAGE);
  assert.equal(result.statusCode, 200, SAFE_RESULT_ASSERTION_MESSAGE);
  assert.notEqual(result, rawExecutorObject, SAFE_RESULT_ASSERTION_MESSAGE);
  assert.equal(callsRef(), 1, SAFE_RESULT_ASSERTION_MESSAGE);
});

test('every audit event has an exact allowlist of event/status/attempt/count/boolean fields and no policy/input/schema/payload/result/message/business sentinel', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const AUDIT_KEY_VALIDATORS = {
    event: v => typeof v === 'string' && v.length > 0,
    status: v => typeof v === 'string' && v.length > 0,
    attempt: v => Number.isInteger(v),
    bytesSaved: v => Number.isInteger(v),
    isSmaller: v => typeof v === 'boolean',
    ok: v => typeof v === 'boolean',
    outcome: v => v === 'success' || v === 'provider_error' || v === 'timeout',
    statusCode: v => v === null || (Number.isInteger(v) && v >= 100 && v <= 599),
  };
  const AUDIT_EVENT_ALLOWED_KEYS = new Set(Object.keys(AUDIT_KEY_VALIDATORS));

  const { pkg } = createCanaryPackage();
  const { executor } = createExecutor();
  const { audit, events } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  await controller.run({ authorization: AUTHORIZATION });
  assert.ok(events.length > 0, AUDIT_ALLOWLIST_ASSERTION_MESSAGE);

  for (const event of events) {
    const eventKeys = Object.keys(event ?? {});
    const onlyAllowedKeys = eventKeys.every(key => AUDIT_EVENT_ALLOWED_KEYS.has(key));
    assert.equal(onlyAllowedKeys, true, AUDIT_ALLOWLIST_ASSERTION_MESSAGE);
    const allValuesValid = eventKeys.every(key => AUDIT_KEY_VALIDATORS[key](event[key]));
    assert.equal(allValuesValid, true, AUDIT_ALLOWLIST_ASSERTION_MESSAGE);
  }

  const serializedEvents = JSON.stringify(events);
  for (const sentinel of ALL_SENTINELS) {
    assert.equal(serializedEvents.includes(sentinel), false, AUDIT_ALLOWLIST_ASSERTION_MESSAGE);
  }
});

test('getState() returns only a state enum, attempt integer, and terminal/executionStarted booleans with no payload', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const STATE_ALLOWED_KEYS = ['attempt', 'executionStarted', 'state', 'terminal'].sort();
  const { pkg } = createCanaryPackage();
  const { executor } = createExecutor();
  const { audit } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  const initialState = controller.getState();
  const initialKeysMatch = Object.keys(initialState).sort().join(',') === STATE_ALLOWED_KEYS.join(',');
  assert.equal(initialKeysMatch, true, STATE_SHAPE_ASSERTION_MESSAGE);
  assert.equal(typeof initialState.state, 'string', STATE_SHAPE_ASSERTION_MESSAGE);
  assert.equal(Number.isInteger(initialState.attempt), true, STATE_SHAPE_ASSERTION_MESSAGE);
  assert.equal(typeof initialState.terminal, 'boolean', STATE_SHAPE_ASSERTION_MESSAGE);
  assert.equal(typeof initialState.executionStarted, 'boolean', STATE_SHAPE_ASSERTION_MESSAGE);
  assert.equal(initialState.terminal, false, STATE_SHAPE_ASSERTION_MESSAGE);
  assert.equal(initialState.executionStarted, false, STATE_SHAPE_ASSERTION_MESSAGE);

  await controller.run({ authorization: AUTHORIZATION });
  const finalState = controller.getState();
  const finalKeysMatch = Object.keys(finalState).sort().join(',') === STATE_ALLOWED_KEYS.join(',');
  assert.equal(finalKeysMatch, true, STATE_SHAPE_ASSERTION_MESSAGE);
  assert.equal(finalState.terminal, true, STATE_SHAPE_ASSERTION_MESSAGE);
  assert.equal(finalState.executionStarted, true, STATE_SHAPE_ASSERTION_MESSAGE);

  const serializedState = JSON.stringify(finalState);
  for (const sentinel of ALL_SENTINELS) {
    assert.equal(serializedState.includes(sentinel), false, STATE_SHAPE_ASSERTION_MESSAGE);
  }
});

test('no accepted API surface takes CRM mutation callbacks, and the module\'s static export surface is only the controller constructor', async () => {
  const moduleExports = await import(MODULE_SPECIFIER);
  const exportKeys = Object.keys(moduleExports);
  const onlyExpectedExport = exportKeys.length === 1 && exportKeys[0] === 'createAgt003OfflineCanaryReadinessController';
  assert.equal(onlyExpectedExport, true, MODULE_SURFACE_ASSERTION_MESSAGE);

  const { createAgt003OfflineCanaryReadinessController } = moduleExports;
  assert.equal(createAgt003OfflineCanaryReadinessController.length <= 1, true, MODULE_SURFACE_ASSERTION_MESSAGE);

  const { pkg } = createCanaryPackage();
  const { executor } = createExecutor();
  const { audit } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);
  let crmCallbackInvoked = false;
  const controller = createAgt003OfflineCanaryReadinessController({
    canaryPackage: pkg,
    executor,
    audit,
    isKilled,
    crmWrite: () => { crmCallbackInvoked = true; },
    onCrmMutation: () => { crmCallbackInvoked = true; },
  });

  assert.equal(Object.isFrozen(controller), true, MODULE_SURFACE_ASSERTION_MESSAGE);
  const CONTROLLER_SURFACE_ALLOWED_KEYS = ['getState', 'manifest', 'run'].sort();
  const controllerKeysMatch = Object.keys(controller).sort().join(',') === CONTROLLER_SURFACE_ALLOWED_KEYS.join(',');
  assert.equal(controllerKeysMatch, true, MODULE_SURFACE_ASSERTION_MESSAGE);

  await controller.run({ authorization: AUTHORIZATION });
  assert.equal(crmCallbackInvoked, false, MODULE_SURFACE_ASSERTION_MESSAGE);
});

test('isKilled() throwing an Error with a private sentinel message fails closed with the generic kill-switch-failed code, no sentinel in error/audit/stdout, no consume/executor calls, and a terminal safe state', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const killSwitchError = new Error(KILL_SWITCH_THROW_SENTINEL);
  const { pkg, calls } = createCanaryPackage();
  const { executor, callsRef } = createExecutor();
  const { audit, events } = createAudit();
  const isKilled = () => { throw killSwitchError; };
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  const originalStdoutWrite = process.stdout.write;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let capturedOutput = '';
  process.stdout.write = (chunk) => { capturedOutput += String(chunk); return true; };
  console.log = (...args) => { capturedOutput += args.map(String).join(' '); };
  console.error = (...args) => { capturedOutput += args.map(String).join(' '); };

  let caughtError = null;
  try {
    await controller.run({ authorization: AUTHORIZATION });
  } catch (error) {
    caughtError = error;
  } finally {
    process.stdout.write = originalStdoutWrite;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }

  const codeMatchesGeneric = caughtError?.code === KILL_SWITCH_FAILED_CODE;
  assert.equal(codeMatchesGeneric, true, KILL_SWITCH_THROW_ASSERTION_MESSAGE);

  const serializedError = JSON.stringify({ message: caughtError?.message, code: caughtError?.code });
  const serializedAudit = JSON.stringify(events);
  const errorLeaksSentinel = serializedError.includes(KILL_SWITCH_THROW_SENTINEL);
  const auditLeaksSentinel = serializedAudit.includes(KILL_SWITCH_THROW_SENTINEL);
  const stdoutLeaksSentinel = capturedOutput.includes(KILL_SWITCH_THROW_SENTINEL);
  assert.equal(errorLeaksSentinel, false, KILL_SWITCH_THROW_ASSERTION_MESSAGE);
  assert.equal(auditLeaksSentinel, false, KILL_SWITCH_THROW_ASSERTION_MESSAGE);
  assert.equal(stdoutLeaksSentinel, false, KILL_SWITCH_THROW_ASSERTION_MESSAGE);

  assert.equal(calls.consumeCalls, 0, KILL_SWITCH_THROW_ASSERTION_MESSAGE);
  assert.equal(callsRef(), 0, KILL_SWITCH_THROW_ASSERTION_MESSAGE);

  const state = controller.getState();
  const serializedState = JSON.stringify(state);
  const stateLeaksSentinel = serializedState.includes(KILL_SWITCH_THROW_SENTINEL);
  assert.equal(stateLeaksSentinel, false, KILL_SWITCH_THROW_ASSERTION_MESSAGE);
  assert.equal(state.terminal, true, KILL_SWITCH_THROW_ASSERTION_MESSAGE);
  assert.equal(state.executionStarted, false, KILL_SWITCH_THROW_ASSERTION_MESSAGE);
});

test('canaryPackage.consume() resolving a distinct frozen synthetic reduced-payload object is passed to the executor as its sole argument, with no payload sentinel or payload fields in audit events or the public result/state', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const reducedPayload = Object.freeze({ reducedPayloadField: REDUCED_PAYLOAD_SENTINEL });
  const payloadIsFrozen = Object.isFrozen(reducedPayload);
  assert.equal(payloadIsFrozen, true, REDUCED_PAYLOAD_ASSERTION_MESSAGE);

  const { pkg } = createCanaryPackage({ consumeResult: reducedPayload });
  const { audit, events } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);
  let receivedArgs = null;
  const executor = async (...args) => {
    receivedArgs = args;
    return { ok: true, outcome: 'success', statusCode: 200 };
  };
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: pkg, executor, audit, isKilled });

  const result = await controller.run({ authorization: AUTHORIZATION });

  const executorWasCalled = receivedArgs !== null;
  assert.equal(executorWasCalled, true, REDUCED_PAYLOAD_ASSERTION_MESSAGE);
  const executorReceivedExactlyOneArg = receivedArgs.length === 1;
  assert.equal(executorReceivedExactlyOneArg, true, REDUCED_PAYLOAD_ASSERTION_MESSAGE);
  const executorReceivedExactPayload = receivedArgs[0] === reducedPayload;
  assert.equal(executorReceivedExactPayload, true, REDUCED_PAYLOAD_ASSERTION_MESSAGE);

  const serializedAudit = JSON.stringify(events);
  const auditLeaksSentinel = serializedAudit.includes(REDUCED_PAYLOAD_SENTINEL);
  const auditLeaksPayloadField = serializedAudit.includes('reducedPayloadField');
  assert.equal(auditLeaksSentinel, false, REDUCED_PAYLOAD_ASSERTION_MESSAGE);
  assert.equal(auditLeaksPayloadField, false, REDUCED_PAYLOAD_ASSERTION_MESSAGE);

  const serializedResult = JSON.stringify(result);
  const resultLeaksSentinel = serializedResult.includes(REDUCED_PAYLOAD_SENTINEL);
  const resultLeaksPayloadField = serializedResult.includes('reducedPayloadField');
  assert.equal(resultLeaksSentinel, false, REDUCED_PAYLOAD_ASSERTION_MESSAGE);
  assert.equal(resultLeaksPayloadField, false, REDUCED_PAYLOAD_ASSERTION_MESSAGE);

  const state = controller.getState();
  const serializedState = JSON.stringify(state);
  const stateLeaksSentinel = serializedState.includes(REDUCED_PAYLOAD_SENTINEL);
  const stateLeaksPayloadField = serializedState.includes('reducedPayloadField');
  assert.equal(stateLeaksSentinel, false, REDUCED_PAYLOAD_ASSERTION_MESSAGE);
  assert.equal(stateLeaksPayloadField, false, REDUCED_PAYLOAD_ASSERTION_MESSAGE);
});

test('a real M1 canary package built with AGT003_COPILOT_POLICY and createAgt003SingleCanaryPackage runs once through the M2 offline canary readiness controller, delivers the consumed reduced payload to the executor, leaks no policy/input/schema/payload/business fixture text into audit/result/state, and refuses a second run', async () => {
  const { createAgt003OfflineCanaryReadinessController } = await import(MODULE_SPECIFIER);
  const { AGT003_COPILOT_POLICY } = await import('../agt003-copilot-engine.js');
  const { createAgt003SingleCanaryPackage } = await import('../agt003-payload-reduction.js');

  const evidenceOpportunity = 'evidence:opportunity:opp-m1m2-int-0001:stage';
  const evidenceInteraction = 'evidence:interaction:int-m1m2-int-0001';

  const sourceInput = {
    contract_version: '2.0-draft.1',
    capability_id: 'agt003.opportunity-copilot.preview',
    correlation_id: 'corr-m1m2-int-0001',
    snapshot_id: 'snap-m1m2-int-0001',
    opportunity: {
      opportunity_id: 'opp-m1m2-int-0001',
      title: 'Oportunidad sintética de integración M1-M2',
      company_name: 'Compañía Sintética de Integración M1M2 S.A.',
      stage: 'negociación',
      service: 'servicio sintético de integración',
      owner_name: 'Propietario Sintético de Integración',
      facts: [
        { evidence_id: evidenceOpportunity, field: 'stage', value: 'negociación', source: 'SIIO' },
      ],
    },
    interactions: [
      {
        interaction_id: 'int-m1m2-int-0001',
        interaction_type: 'llamada',
        occurred_at: '2026-09-20T10:00:00.000Z',
        summary: 'Cliente sintético de integración confirmó interés en continuar el ciclo comercial.',
        evidence_id: evidenceInteraction,
        untrusted_crm_text: true,
      },
    ],
    approved_assets: [
      {
        asset_id: 'asset-m1m2-int-0001',
        title: 'Ficha técnica sintética de integración M1M2',
        asset_type: 'pdf',
        url: 'https://assets.example.test/ficha-integracion-m1m2.pdf',
        status: 'approved',
        valid_until: '2027-01-01T00:00:00.000Z',
        tags: ['sintético', 'integración'],
      },
    ],
    authority: {
      read_only: true,
      human_review_required: true,
      external_send_allowed: false,
      crm_write_allowed: false,
      public_research_allowed: false,
    },
  };

  const text = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
  const evidenceRefs = {
    type: 'array',
    minItems: 1,
    maxItems: 20,
    uniqueItems: true,
    items: { type: 'string', enum: [evidenceOpportunity, evidenceInteraction] },
  };
  const sourceOutputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'facts', 'inferences', 'missing_information', 'contact_objective', 'strategy', 'draft', 'recommended_asset_ids', 'warnings', 'human_review_required'],
    properties: {
      summary: text(4000),
      facts: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'evidence_refs'],
          properties: { text: text(2000), evidence_refs: evidenceRefs },
        },
      },
      inferences: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'evidence_refs', 'confidence'],
          properties: {
            text: text(2000),
            evidence_refs: evidenceRefs,
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
        },
      },
      missing_information: { type: 'array', maxItems: 20, items: text(2000) },
      contact_objective: text(1000),
      strategy: text(2000),
      draft: {
        type: 'object',
        additionalProperties: false,
        required: ['subject', 'body'],
        properties: { subject: text(300), body: text(8000) },
      },
      recommended_asset_ids: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', enum: ['asset-m1m2-int-0001'] } },
      warnings: { type: 'array', maxItems: 20, items: text(2000) },
      human_review_required: { const: true },
    },
  };

  const m1Package = createAgt003SingleCanaryPackage({ policy: AGT003_COPILOT_POLICY, input: sourceInput, outputSchema: sourceOutputSchema });

  let receivedArgs = null;
  const executor = async (...args) => {
    receivedArgs = args;
    return { ok: true, outcome: 'success', statusCode: 200 };
  };
  const { audit, events } = createAudit();
  const isKilled = createIsKilledSequence([false, false]);
  const controller = createAgt003OfflineCanaryReadinessController({ canaryPackage: m1Package, executor, audit, isKilled });

  const result = await controller.run({ authorization: AUTHORIZATION });

  const runSucceeded = result?.ok === true && result?.outcome === 'success' && result?.statusCode === 200;
  assert.equal(runSucceeded, true, M1_M2_INTEGRATION_ASSERTION_MESSAGE);

  const executorReceivedOneArg = Array.isArray(receivedArgs) && receivedArgs.length === 1;
  assert.equal(executorReceivedOneArg, true, M1_M2_INTEGRATION_ASSERTION_MESSAGE);

  const receivedPayload = executorReceivedOneArg ? receivedArgs[0] : null;
  const receivedPayloadIsFrozen = receivedPayload !== null && Object.isFrozen(receivedPayload);
  assert.equal(receivedPayloadIsFrozen, true, M1_M2_INTEGRATION_ASSERTION_MESSAGE);

  const receivedInputJson = receivedPayload ? JSON.stringify(receivedPayload.input) : '';
  const receivedOutputSchemaJson = receivedPayload ? JSON.stringify(receivedPayload.outputSchema) : '';
  const receivedPolicyMatchesManifest = typeof receivedPayload?.policy?.payload === 'string'
    && sha256Hex(receivedPayload.policy.payload) === m1Package.manifest.reducedPolicySha256;
  const receivedInputMatchesManifest = sha256Hex(receivedInputJson) === m1Package.manifest.reducedInputSha256;
  const receivedOutputSchemaMatchesManifest = sha256Hex(receivedOutputSchemaJson) === m1Package.manifest.reducedOutputSchemaSha256;
  assert.equal(receivedPolicyMatchesManifest, true, M1_M2_INTEGRATION_ASSERTION_MESSAGE);
  assert.equal(receivedInputMatchesManifest, true, M1_M2_INTEGRATION_ASSERTION_MESSAGE);
  assert.equal(receivedOutputSchemaMatchesManifest, true, M1_M2_INTEGRATION_ASSERTION_MESSAGE);

  const state = controller.getState();
  const serializedAudit = JSON.stringify(events);
  const serializedResult = JSON.stringify(result);
  const serializedState = JSON.stringify(state);
  const leakProbes = [
    AGT003_COPILOT_POLICY,
    'preparation_date trae la fecha real de ejecución',
    sourceInput.opportunity.company_name,
    sourceInput.opportunity.title,
    sourceInput.interactions[0].summary,
    sourceInput.approved_assets[0].title,
    JSON.stringify(sourceInput),
    JSON.stringify(sourceOutputSchema),
  ];
  for (const probe of leakProbes) {
    assert.equal(serializedAudit.includes(probe), false, M1_M2_INTEGRATION_ASSERTION_MESSAGE);
    assert.equal(serializedResult.includes(probe), false, M1_M2_INTEGRATION_ASSERTION_MESSAGE);
    assert.equal(serializedState.includes(probe), false, M1_M2_INTEGRATION_ASSERTION_MESSAGE);
  }

  let secondCode = null;
  try {
    await controller.run({ authorization: AUTHORIZATION });
  } catch (error) {
    secondCode = error?.code ?? null;
  }
  const secondRunBlocked = secondCode === ATTEMPT_EXHAUSTED_CODE;
  assert.equal(secondRunBlocked, true, M1_M2_INTEGRATION_ASSERTION_MESSAGE);
});
