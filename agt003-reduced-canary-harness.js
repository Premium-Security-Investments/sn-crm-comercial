// AGT-003 reduced-canary harness: orchestrates a single, one-shot, fully-gated
// synthetic canary run. Every collaborator (kill switch, authorization, cost
// meter, audit sink, executor) is injected by the caller; this module never
// instantiates a network/provider/CRM client and never reads credentials.

// main_base_revision: the exact origin/main commit this harness was reconciled against.
// harness_source_revision: the audited local commit applied on top of that base.
// authorization_revision: the canonical SHA-256 digest binding both revisions together, so
// the authorization gate can never be satisfied by the self-referential/impossible SHA of
// this future commit/merge.
export const AGT003_REDUCED_CANARY_REVISION_BINDING = Object.freeze({
  scheme: 'agt003-reduced-canary-revision-binding-v1',
  main_base_revision: '932fc4531ecddf4f194ed4e0955b1d4183dad739',
  harness_source_revision: '46f7b8e796c2be359d89cd9ec9f8d8d0d8351f05',
  authorization_revision: 'b46fa84615933c6c7bd4bc833f07e247a37639ab0dade3927f215c730774474a',
});

const ALREADY_RUN_CODE = 'AGT003_REDUCED_CANARY_ALREADY_RUN';
const DEFAULT_TIMEOUT_MS = 30000;

const KILLED_CODE = 'AGT003_REDUCED_CANARY_KILLED';
const KILL_SWITCH_SOURCE_MISSING_CODE = 'AGT003_REDUCED_CANARY_KILL_SWITCH_SOURCE_MISSING';
const KILL_SWITCH_FAILED_CODE = 'AGT003_REDUCED_CANARY_KILL_SWITCH_FAILED';
const KILL_SWITCH_AMBIGUOUS_CODE = 'AGT003_REDUCED_CANARY_KILL_SWITCH_AMBIGUOUS';

const INVALID_JSON_CODE = 'AGT003_REDUCED_CANARY_INVALID_JSON';
const INVALID_RESULT_CONTRACT_CODE = 'AGT003_REDUCED_CANARY_INVALID_RESULT_CONTRACT';
const CORRELATION_MISMATCH_CODE = 'AGT003_REDUCED_CANARY_CORRELATION_MISMATCH';
const SNAPSHOT_MISMATCH_CODE = 'AGT003_REDUCED_CANARY_SNAPSHOT_MISMATCH';

const AUTHORIZATION_GATE = 'AGT003_SINGLE_REDUCED_CANARY';
const AUTHORIZATION_REVISION = AGT003_REDUCED_CANARY_REVISION_BINDING.authorization_revision;

const AUTHORIZATION_MISSING_CODE = 'AGT003_REDUCED_CANARY_AUTHORIZATION_MISSING';
const AUTHORIZATION_INCOMPLETE_CODE = 'AGT003_REDUCED_CANARY_AUTHORIZATION_INCOMPLETE';
const AUTHORIZATION_INVALID_REVIEWER_ID_CODE = 'AGT003_REDUCED_CANARY_AUTHORIZATION_INVALID_REVIEWER_ID';
const AUTHORIZATION_MISMATCH_CODE = 'AGT003_REDUCED_CANARY_AUTHORIZATION_MISMATCH';

const AUDIT_UNSAFE_RESULT_FIELDS_CODE = 'AGT003_REDUCED_CANARY_AUDIT_UNSAFE_RESULT_FIELDS';
const AUDIT_UNSAFE_METADATA_VALUE_CODE = 'AGT003_REDUCED_CANARY_AUDIT_UNSAFE_METADATA_VALUE';
const ALLOWLISTED_AUDIT_EVENT_NAME = 'agt003_reduced_canary_run_completed';

const COST_CEILING_MISSING_CODE = 'AGT003_REDUCED_CANARY_COST_CEILING_MISSING';
const COST_CEILING_INVALID_CODE = 'AGT003_REDUCED_CANARY_COST_CEILING_INVALID';
const COST_METER_MISSING_CODE = 'AGT003_REDUCED_CANARY_COST_METER_MISSING';
const COST_METER_FAILED_CODE = 'AGT003_REDUCED_CANARY_COST_METER_FAILED';
const COST_UNKNOWN_CODE = 'AGT003_REDUCED_CANARY_COST_UNKNOWN';
const COST_CEILING_EXCEEDED_CODE = 'AGT003_REDUCED_CANARY_COST_CEILING_EXCEEDED';

const EXECUTOR_FAILED_CODE = 'AGT003_REDUCED_CANARY_EXECUTOR_FAILED';

const PROVIDER_OUTCOME_INCONSISTENT_CODE = 'AGT003_REDUCED_CANARY_PROVIDER_OUTCOME_INCONSISTENT';

const REQUIRED_AUTHORIZATION_KEYS = Object.freeze([
  'gate',
  'correlation_id',
  'snapshot_id',
  'revision',
  'human_reviewer_id',
]);

const RAW_RESULT_ALLOWED_KEYS = Object.freeze([
  'provider_is_error',
  'statusCode',
  'outcome',
  'input_tokens',
  'output_tokens',
]);

const RAW_RESULT_REQUIRED_TYPES = Object.freeze({
  provider_is_error: 'boolean',
  statusCode: 'number',
  outcome: 'string',
  input_tokens: 'number',
  output_tokens: 'number',
});

const ALLOWLISTED_OUTCOMES = Object.freeze(['success', 'provider_error']);

const VALIDATED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

class Agt003ReducedCanaryHarnessError extends Error {
  constructor(code) {
    super(code);
    this.name = 'Agt003ReducedCanaryHarnessError';
    this.code = code;
  }
}

function fail(code) {
  throw new Agt003ReducedCanaryHarnessError(code);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function classifyKillSwitchState(state) {
  if (!isPlainObject(state)) {
    return 'ambiguous';
  }
  const keys = Object.keys(state);
  if (keys.length !== 1 || keys[0] !== 'enabled' || typeof state.enabled !== 'boolean') {
    return 'ambiguous';
  }
  return state.enabled ? 'killed' : 'safe';
}

async function checkKillSwitch(killSwitch) {
  let state;
  try {
    state = await killSwitch.read();
  } catch {
    fail(KILL_SWITCH_FAILED_CODE);
  }
  const classification = classifyKillSwitchState(state);
  if (classification === 'ambiguous') {
    fail(KILL_SWITCH_AMBIGUOUS_CODE);
  }
  if (classification === 'killed') {
    fail(KILLED_CODE);
  }
}

function validateAuthorization(authorization, correlationId, snapshotId) {
  if (authorization === undefined || authorization === null || !isPlainObject(authorization)) {
    fail(AUTHORIZATION_MISSING_CODE);
  }

  for (const key of REQUIRED_AUTHORIZATION_KEYS) {
    if (!(key in authorization) || authorization[key] === undefined) {
      fail(AUTHORIZATION_INCOMPLETE_CODE);
    }
  }

  const reviewerId = authorization.human_reviewer_id;
  if (typeof reviewerId !== 'string' || reviewerId.trim() === '') {
    fail(AUTHORIZATION_INCOMPLETE_CODE);
  }
  if (!VALIDATED_ID_PATTERN.test(reviewerId)) {
    fail(AUTHORIZATION_INVALID_REVIEWER_ID_CODE);
  }

  if (
    authorization.gate !== AUTHORIZATION_GATE ||
    authorization.correlation_id !== correlationId ||
    authorization.snapshot_id !== snapshotId ||
    authorization.revision !== AUTHORIZATION_REVISION
  ) {
    fail(AUTHORIZATION_MISMATCH_CODE);
  }

  return authorization;
}

function validateCostCeiling(costCeilingUsd) {
  if (costCeilingUsd === undefined || costCeilingUsd === null) {
    fail(COST_CEILING_MISSING_CODE);
  }
  if (typeof costCeilingUsd !== 'number' || !Number.isFinite(costCeilingUsd) || costCeilingUsd <= 0) {
    fail(COST_CEILING_INVALID_CODE);
  }
}

function validateCostMeter(costMeter) {
  if (costMeter === undefined || costMeter === null) {
    fail(COST_METER_MISSING_CODE);
  }
}

function validateKillSwitchSource(killSwitch) {
  if (killSwitch === undefined || killSwitch === null) {
    fail(KILL_SWITCH_SOURCE_MISSING_CODE);
  }
}

function isM1Payload(payload) {
  return (
    isPlainObject(payload) &&
    Object.prototype.hasOwnProperty.call(payload, 'policy') &&
    Object.prototype.hasOwnProperty.call(payload, 'input') &&
    Object.prototype.hasOwnProperty.call(payload, 'outputSchema')
  );
}

function validatePackageIdentity(payload, correlationId, snapshotId) {
  if (isM1Payload(payload)) {
    const input = payload.input;
    if (!isPlainObject(input)) {
      fail(CORRELATION_MISMATCH_CODE);
    }
    if (typeof input.correlation_id !== 'string' || input.correlation_id !== correlationId) {
      fail(CORRELATION_MISMATCH_CODE);
    }
    if (typeof input.snapshot_id !== 'string' || input.snapshot_id !== snapshotId) {
      fail(SNAPSHOT_MISMATCH_CODE);
    }
    return;
  }

  if (!isPlainObject(payload)) {
    return;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'correlation_id') &&
    payload.correlation_id !== undefined &&
    payload.correlation_id !== correlationId
  ) {
    fail(CORRELATION_MISMATCH_CODE);
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'snapshot_id') &&
    payload.snapshot_id !== undefined &&
    payload.snapshot_id !== snapshotId
  ) {
    fail(SNAPSHOT_MISMATCH_CODE);
  }
}

function parseRawExecutorOutput(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      fail(INVALID_JSON_CODE);
    }
  }
  if (isPlainObject(raw)) {
    return raw;
  }
  fail(INVALID_RESULT_CONTRACT_CODE);
  return undefined;
}

function validateRawResultFields(parsed) {
  if (!isPlainObject(parsed)) {
    fail(INVALID_RESULT_CONTRACT_CODE);
  }

  for (const key of Object.keys(parsed)) {
    if (!RAW_RESULT_ALLOWED_KEYS.includes(key)) {
      fail(AUDIT_UNSAFE_RESULT_FIELDS_CODE);
    }
  }

  for (const key of RAW_RESULT_ALLOWED_KEYS) {
    if (!(key in parsed) || typeof parsed[key] !== RAW_RESULT_REQUIRED_TYPES[key]) {
      fail(INVALID_RESULT_CONTRACT_CODE);
    }
  }

  if (!Number.isFinite(parsed.statusCode) || parsed.statusCode < 0) {
    fail(AUDIT_UNSAFE_METADATA_VALUE_CODE);
  }
  if (!Number.isFinite(parsed.input_tokens) || parsed.input_tokens < 0) {
    fail(AUDIT_UNSAFE_METADATA_VALUE_CODE);
  }
  if (!Number.isFinite(parsed.output_tokens) || parsed.output_tokens < 0) {
    fail(AUDIT_UNSAFE_METADATA_VALUE_CODE);
  }
  if (!ALLOWLISTED_OUTCOMES.includes(parsed.outcome)) {
    fail(AUDIT_UNSAFE_METADATA_VALUE_CODE);
  }

  if (parsed.provider_is_error === false && parsed.outcome === 'provider_error') {
    fail(PROVIDER_OUTCOME_INCONSISTENT_CODE);
  }
  if (parsed.provider_is_error === true && parsed.outcome === 'success') {
    fail(PROVIDER_OUTCOME_INCONSISTENT_CODE);
  }
}

async function measureCost({ costMeter, costCeilingUsd, inputTokens, outputTokens, correlationId, snapshotId }) {
  let actual;
  try {
    actual = await costMeter.measure({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      correlation_id: correlationId,
      snapshot_id: snapshotId,
    });
  } catch {
    fail(COST_METER_FAILED_CODE);
  }
  if (typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0) {
    fail(COST_UNKNOWN_CODE);
  }
  if (actual > costCeilingUsd) {
    fail(COST_CEILING_EXCEEDED_CODE);
  }
  return actual;
}

function createAbortableExecution(executor, payload, timeoutMs) {
  const controller = new AbortController();
  let settle;
  const outcomePromise = new Promise((resolve) => {
    settle = resolve;
  });
  let settled = false;
  let timer = null;

  function finish(outcome) {
    if (settled) {
      return;
    }
    settled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    settle(outcome);
  }

  timer = setTimeout(() => {
    controller.abort();
    finish({ kind: 'timeout' });
  }, timeoutMs);

  Promise.resolve()
    .then(() => executor(payload, { signal: controller.signal }))
    .then((raw) => finish({ kind: 'resolved', raw }))
    .catch((error) => finish({ kind: 'rejected', error }));

  return {
    outcomePromise,
    terminate(signal) {
      void signal;
      controller.abort();
      finish({ kind: 'signal' });
    },
  };
}

function buildLifecycleResult(kind, correlationId, snapshotId) {
  return Object.freeze({
    provider_is_error: false,
    termination: kind,
    statusCode: null,
    outcome: kind,
    input_tokens: 0,
    output_tokens: 0,
    correlation_id: correlationId,
    snapshot_id: snapshotId,
    actual_cost_usd: null,
  });
}

export function createAgt003ReducedCanaryHarness(options) {
  const {
    correlation_id: correlationId,
    snapshot_id: snapshotId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    canaryPackage,
    executor,
    audit,
    killSwitch,
    authorization,
    cost_ceiling_usd: costCeilingUsd,
    costMeter,
  } = options;

  const state = {
    started: false,
    attemptReserved: false,
    currentTerminate: null,
  };

  async function run() {
    if (state.started) {
      fail(ALREADY_RUN_CODE);
    }
    state.started = true;

    validateKillSwitchSource(killSwitch);

    await checkKillSwitch(killSwitch);

    state.attemptReserved = true;

    const validatedAuthorization = validateAuthorization(authorization, correlationId, snapshotId);
    validateCostCeiling(costCeilingUsd);
    validateCostMeter(costMeter);

    const payload = await canaryPackage.consume();
    validatePackageIdentity(payload, correlationId, snapshotId);

    await checkKillSwitch(killSwitch);

    const execution = createAbortableExecution(executor, payload, timeoutMs);
    state.currentTerminate = execution.terminate;
    const outcome = await execution.outcomePromise;
    state.currentTerminate = null;

    if (outcome.kind === 'timeout' || outcome.kind === 'signal') {
      return buildLifecycleResult(outcome.kind, correlationId, snapshotId);
    }
    if (outcome.kind === 'rejected') {
      fail(EXECUTOR_FAILED_CODE);
    }

    const parsed = parseRawExecutorOutput(outcome.raw);
    validateRawResultFields(parsed);

    const actualCostUsd = await measureCost({
      costMeter,
      costCeilingUsd,
      inputTokens: parsed.input_tokens,
      outputTokens: parsed.output_tokens,
      correlationId,
      snapshotId,
    });

    const resultTermination = parsed.provider_is_error ? 'error' : 'normal';

    const result = Object.freeze({
      provider_is_error: parsed.provider_is_error,
      termination: resultTermination,
      statusCode: parsed.statusCode,
      outcome: parsed.outcome,
      input_tokens: parsed.input_tokens,
      output_tokens: parsed.output_tokens,
      correlation_id: correlationId,
      snapshot_id: snapshotId,
      actual_cost_usd: actualCostUsd,
    });

    const auditEvent = Object.freeze({
      name: ALLOWLISTED_AUDIT_EVENT_NAME,
      gate: validatedAuthorization.gate,
      correlation_id: correlationId,
      snapshot_id: snapshotId,
      revision: validatedAuthorization.revision,
      human_reviewer_id: validatedAuthorization.human_reviewer_id,
      outcome: parsed.outcome,
      termination: resultTermination,
      provider_is_error: parsed.provider_is_error,
      statusCode: parsed.statusCode,
      input_tokens: parsed.input_tokens,
      output_tokens: parsed.output_tokens,
      actual_cost_usd: actualCostUsd,
    });

    await audit(auditEvent);

    return result;
  }

  function terminate(signal) {
    if (state.currentTerminate) {
      state.currentTerminate(signal);
    }
  }

  return Object.freeze({ run, terminate });
}
