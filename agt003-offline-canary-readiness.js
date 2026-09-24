const HUMAN_GATE_CODE = 'AGT003_CANARY_HUMAN_GATE_REQUIRED';
const KILLED_CODE = 'AGT003_CANARY_KILLED';
const ATTEMPT_EXHAUSTED_CODE = 'AGT003_CANARY_ATTEMPT_EXHAUSTED';
const PACKAGE_FAILED_CODE = 'AGT003_CANARY_PACKAGE_FAILED';
const AUDIT_FAILED_CODE = 'AGT003_CANARY_AUDIT_FAILED';
const EXECUTOR_FAILED_CODE = 'AGT003_CANARY_EXECUTOR_FAILED';
const UNSAFE_RESULT_CODE = 'AGT003_CANARY_UNSAFE_RESULT';
const KILL_SWITCH_FAILED_CODE = 'AGT003_OFFLINE_CANARY_KILL_SWITCH_FAILED';

const HUMAN_GATE_MESSAGE = 'Authorization for the reduced canary gate was missing or invalid.';
const KILLED_MESSAGE = 'The canary run was blocked by the kill switch.';
const ATTEMPT_EXHAUSTED_MESSAGE = 'The canary attempt quota has already been used.';
const PACKAGE_FAILED_MESSAGE = 'The canary package could not be prepared.';
const AUDIT_FAILED_MESSAGE = 'The canary pre-execution audit did not succeed.';
const EXECUTOR_FAILED_MESSAGE = 'The canary executor did not complete successfully.';
const UNSAFE_RESULT_MESSAGE = 'The canary executor returned a result outside the safe envelope.';
const KILL_SWITCH_FAILED_MESSAGE = 'The canary kill switch check could not be completed safely.';

const MANIFEST_INTEGER_KEYS = Object.freeze([
  'sourcePolicyBytes', 'reducedPolicyBytes',
  'sourceInputBytes', 'reducedInputBytes',
  'sourceOutputSchemaBytes', 'reducedOutputSchemaBytes',
  'sourceTotalBytes', 'reducedTotalBytes',
]);

const MANIFEST_HASH_KEYS = Object.freeze([
  'sourcePolicySha256', 'reducedPolicySha256',
  'sourceInputSha256', 'reducedInputSha256',
  'sourceOutputSchemaSha256', 'reducedOutputSchemaSha256',
]);

const MANIFEST_ALLOWED_KEYS = Object.freeze([
  ...MANIFEST_INTEGER_KEYS,
  ...MANIFEST_HASH_KEYS,
  'bytesSaved',
  'isSmaller',
]);

const MANIFEST_ALLOWED_KEY_SET = new Set(MANIFEST_ALLOWED_KEYS);

const HEX64_PATTERN = /^[0-9a-f]{64}$/;

const SAFE_OUTCOMES = new Set(['success', 'provider_error', 'timeout']);

function createGenericError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateManifest(manifest) {
  if (!isPlainObject(manifest)) return null;
  const keys = Object.keys(manifest);
  if (keys.length !== MANIFEST_ALLOWED_KEYS.length) return null;
  for (const key of keys) {
    if (!MANIFEST_ALLOWED_KEY_SET.has(key)) return null;
  }

  for (const key of MANIFEST_INTEGER_KEYS) {
    if (!Number.isInteger(manifest[key]) || manifest[key] < 0) return null;
  }
  if (!Number.isInteger(manifest.bytesSaved) || manifest.bytesSaved <= 0) return null;
  for (const key of MANIFEST_HASH_KEYS) {
    if (typeof manifest[key] !== 'string' || !HEX64_PATTERN.test(manifest[key])) return null;
  }
  if (manifest.isSmaller !== true) return null;

  const expectedSourceTotal = manifest.sourcePolicyBytes + manifest.sourceInputBytes + manifest.sourceOutputSchemaBytes;
  const expectedReducedTotal = manifest.reducedPolicyBytes + manifest.reducedInputBytes + manifest.reducedOutputSchemaBytes;
  if (manifest.sourceTotalBytes !== expectedSourceTotal) return null;
  if (manifest.reducedTotalBytes !== expectedReducedTotal) return null;
  if (manifest.bytesSaved !== expectedSourceTotal - expectedReducedTotal) return null;

  const sanitized = {};
  for (const key of MANIFEST_ALLOWED_KEYS) {
    sanitized[key] = manifest[key];
  }
  return Object.freeze(sanitized);
}

function isAuthorized(authorization) {
  if (!isPlainObject(authorization)) return false;
  const keys = Object.keys(authorization);
  if (keys.length !== 2 || !keys.includes('gate') || !keys.includes('approved')) return false;
  return authorization.gate === 'AGT003_REDUCED_CANARY' && authorization.approved === true;
}

function isSafeExecutionResult(result) {
  if (!isPlainObject(result)) return false;
  const keys = Object.keys(result);
  if (keys.length !== 3 || !keys.includes('ok') || !keys.includes('outcome') || !keys.includes('statusCode')) return false;
  if (typeof result.ok !== 'boolean') return false;
  if (!SAFE_OUTCOMES.has(result.outcome)) return false;
  const statusCode = result.statusCode;
  if (statusCode !== null && !(Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599)) return false;
  return true;
}

export function createAgt003OfflineCanaryReadinessController(options) {
  const { canaryPackage, executor, audit, isKilled } = options ?? {};

  const manifest = validateManifest(canaryPackage?.manifest);
  if (!manifest) {
    throw createGenericError(PACKAGE_FAILED_CODE, PACKAGE_FAILED_MESSAGE);
  }

  let reserved = false;
  let terminal = false;
  let executionStarted = false;
  let attempt = 0;

  async function checkKilled() {
    let result;
    try {
      result = await isKilled();
    } catch {
      terminal = true;
      throw createGenericError(KILL_SWITCH_FAILED_CODE, KILL_SWITCH_FAILED_MESSAGE);
    }
    if (result !== true && result !== false) {
      terminal = true;
      throw createGenericError(KILL_SWITCH_FAILED_CODE, KILL_SWITCH_FAILED_MESSAGE);
    }
    return result;
  }

  async function run(runOptions) {
    const { authorization } = runOptions ?? {};

    if (reserved) {
      throw createGenericError(ATTEMPT_EXHAUSTED_CODE, ATTEMPT_EXHAUSTED_MESSAGE);
    }
    reserved = true;
    attempt = 1;

    try {
      if (!isAuthorized(authorization)) {
        throw createGenericError(HUMAN_GATE_CODE, HUMAN_GATE_MESSAGE);
      }
      if (await checkKilled()) {
        throw createGenericError(KILLED_CODE, KILLED_MESSAGE);
      }

      let payload;
      try {
        payload = await canaryPackage.consume();
      } catch {
        throw createGenericError(PACKAGE_FAILED_CODE, PACKAGE_FAILED_MESSAGE);
      }

      if (await checkKilled()) {
        throw createGenericError(KILLED_CODE, KILLED_MESSAGE);
      }

      try {
        await audit({
          event: 'pre_execution',
          status: 'ok',
          attempt,
          bytesSaved: manifest.bytesSaved,
          isSmaller: manifest.isSmaller,
        });
      } catch {
        throw createGenericError(AUDIT_FAILED_CODE, AUDIT_FAILED_MESSAGE);
      }

      let rawResult;
      try {
        executionStarted = true;
        rawResult = await executor(payload);
      } catch {
        throw createGenericError(EXECUTOR_FAILED_CODE, EXECUTOR_FAILED_MESSAGE);
      }

      if (!isSafeExecutionResult(rawResult)) {
        throw createGenericError(UNSAFE_RESULT_CODE, UNSAFE_RESULT_MESSAGE);
      }

      const safeResult = Object.freeze({
        ok: rawResult.ok,
        outcome: rawResult.outcome,
        statusCode: rawResult.statusCode,
      });

      try {
        await audit({
          event: 'post_execution',
          status: 'ok',
          attempt,
          ok: safeResult.ok,
          outcome: safeResult.outcome,
          statusCode: safeResult.statusCode,
        });
      } catch {
        throw createGenericError(AUDIT_FAILED_CODE, AUDIT_FAILED_MESSAGE);
      }

      return safeResult;
    } finally {
      terminal = true;
    }
  }

  function getState() {
    return Object.freeze({
      state: terminal ? 'terminal' : (executionStarted ? 'running' : 'idle'),
      attempt,
      terminal,
      executionStarted,
    });
  }

  return Object.freeze({
    manifest,
    run,
    getState,
  });
}
