// AGT-002 governed workset — operational batch-capacity preflight.
//
// Sits in front of the governed workset freeze/enqueue flow
// (agt002-governed-document-workset-api.js): given the SERVER-RESOLVED size of a governed
// package (never a client-declared size), answers one closed, deterministic question — how many
// operational analysis batches would it need, and does that fit the route's server-owned
// operational capacity? APTO/NO_APTO — never a raw exception, never a partial answer, never a
// client-influenced ceiling.
export const AGT002_GOVERNED_WORKSET_CAPACITY_VERSION = 'agt002-governed-workset-capacity@1';

export const AGT002_GOVERNED_WORKSET_FREEZE_ROUTE = 'agt002.governed_document_workset.freeze';

export const AGT002_GOVERNED_WORKSET_CHARS_PER_BATCH = 20_000;

// Route-scoped, server-owned operational capacity policy. Closed and immutable: not
// environment-derived, not client-derived. The one production route this preflight currently
// guards is capped at 64 operational analysis batches.
export const AGT002_GOVERNED_WORKSET_MAX_BATCHES = Object.freeze({
  [AGT002_GOVERNED_WORKSET_FREEZE_ROUTE]: 64,
});

// A second, distinct, server-owned closed policy map — never environment/client-derived —
// scoping the ceiling that governs durable, checkpointed batch execution. Well above (but not
// unlimited relative to) AGT002_GOVERNED_WORKSET_MAX_BATCHES for the same route: durable,
// checkpointed batch processing can safely run more batches than the legacy in-memory ceiling,
// but the durable ceiling is a real, enforced cap, not an unlimited escape hatch.
export const AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES = Object.freeze({
  [AGT002_GOVERNED_WORKSET_FREEZE_ROUTE]: 184,
});

export const AGT002_GOVERNED_WORKSET_APTO = 'APTO';
export const AGT002_GOVERNED_WORKSET_NO_APTO = 'NO_APTO';

export const AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE = 'AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE';
export const AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE = 'AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE';
export const AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE = 'AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE';

const AGT002_GOVERNED_WORKSET_EXECUTION_MODE_SINGLE_TURN_V1 = 'single_turn_v1';
const AGT002_GOVERNED_WORKSET_EXECUTION_MODE_DURABLE_BATCHED_V1 = 'durable_batched_v1';

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isPlainPolicyMap(policy) {
  return policy !== null && typeof policy === 'object' && !Array.isArray(policy);
}

function closedError(code, message, report) {
  const error = new Error(message);
  error.code = code;
  error.report = Object.freeze({ code, ...report });
  return error;
}

function policyInvalidError(route) {
  return closedError(
    AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE,
    'Política de capacidad operativa no válida o ausente para la ruta indicada.',
    { route: typeof route === 'string' ? route : null },
  );
}

function evidenceInvalidError(route) {
  return closedError(
    AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE,
    'Evidencia de tamaño resuelta en servidor no válida o ausente.',
    { route: typeof route === 'string' ? route : null },
  );
}

function executionModeInvalidError(route) {
  return closedError(
    AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE,
    'Modo de ejecución no reconocido para el preflight de capacidad operativa.',
    { route: typeof route === 'string' ? route : null },
  );
}

/** Resolves the route's server-owned max batch ceiling from `policy`. Never trusts a caller/evidence override. */
function resolveMaxBatchCount(route, policy) {
  if (typeof route !== 'string' || route.length === 0) throw policyInvalidError(route);
  if (!isPlainPolicyMap(policy)) throw policyInvalidError(route);
  const maxBatchCount = policy[route];
  if (!isPositiveInteger(maxBatchCount)) throw policyInvalidError(route);
  return maxBatchCount;
}

/**
 * Same closed validation as `resolveMaxBatchCount`, exported narrowly so tests can exercise an
 * absent/malformed AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES-shaped map failing closed, without
 * `preflightAgt002GovernedWorksetCapacity` ever accepting a durable policy map from caller input:
 * that function always calls this with the module's own immutable
 * AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES, never with a caller-supplied `durablePolicy`.
 */
export function resolveAgt002GovernedWorksetDurableMaxBatchCount(route, durablePolicy) {
  return resolveMaxBatchCount(route, durablePolicy);
}

/** Validates SERVER-RESOLVED size evidence; never trusts a client payload shape. */
function validateEvidence(evidence, route) {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw evidenceInvalidError(route);
  }
  const { source_char_count, chars_per_batch, document_count } = evidence;
  if (!isPositiveInteger(source_char_count)) throw evidenceInvalidError(route);
  if (!isPositiveInteger(chars_per_batch)) throw evidenceInvalidError(route);
  if (!isPositiveInteger(document_count)) throw evidenceInvalidError(route);
  return { source_char_count, chars_per_batch, document_count };
}

/**
 * Pure, deterministic, never throws for a well-formed call. `policy` defaults to the server-owned
 * AGT002_GOVERNED_WORKSET_MAX_BATCHES map. `evidence` must be SERVER-RESOLVED size evidence — any
 * `max_batch_count` (or other override-shaped field) it carries is inert: the returned
 * `max_batch_count` always comes from `policy[route]`. Missing/malformed evidence or an
 * invalid/missing route-scoped policy fails closed with a closed `.code` and a sanitized
 * `.report`, never a partial or best-effort verdict.
 */
export function evaluateAgt002GovernedWorksetCapacity(args) {
  const safeArgs = args !== null && typeof args === 'object' ? args : {};
  const route = safeArgs.route;
  const policy = Object.prototype.hasOwnProperty.call(safeArgs, 'policy')
    ? safeArgs.policy
    : AGT002_GOVERNED_WORKSET_MAX_BATCHES;

  const maxBatchCount = resolveMaxBatchCount(route, policy);
  const { source_char_count, chars_per_batch, document_count } = validateEvidence(safeArgs.evidence, route);

  const predictedBatchCount = Math.ceil(source_char_count / chars_per_batch);
  const verdict = predictedBatchCount <= maxBatchCount
    ? AGT002_GOVERNED_WORKSET_APTO
    : AGT002_GOVERNED_WORKSET_NO_APTO;

  return Object.freeze({
    version: AGT002_GOVERNED_WORKSET_CAPACITY_VERSION,
    route,
    verdict,
    max_batch_count: maxBatchCount,
    predicted_batch_count: predictedBatchCount,
    source_char_count,
    chars_per_batch,
    document_count,
  });
}

/**
 * Extends the same closed route/evidence validation as `evaluateAgt002GovernedWorksetCapacity`
 * with an explicit execution-mode axis — but, unlike that function, is a fully closed,
 * server-owned decision: it resolves both ceilings exclusively from this module's own immutable
 * AGT002_GOVERNED_WORKSET_MAX_BATCHES / AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES maps. A
 * caller-supplied `policy` or `durablePolicy`, and any override-shaped field smuggled inside
 * `evidence` (`max_batch_count`, `durable_max_batch_count`, `effective_max_batch_count`, ...), are
 * completely inert. Only `executionMode: 'durable_batched_v1'` with `checkpointing === true` is
 * evaluated against the route's durable ceiling instead of the classic one; every other
 * executionMode/checkpointing combination is evaluated against the classic ceiling exactly like
 * the legacy comparison. Every count and every ceiling is reported byte-honestly: `max_batch_count`
 * (classic), `durable_max_batch_count`, and `effective_max_batch_count` (whichever ceiling actually
 * governed this verdict), plus `durable_checkpointing_required: true` only when the durable
 * ceiling — not the classic one — is what let an over-classic-ceiling source pass. Any
 * `executionMode` other than `'single_turn_v1'` and `'durable_batched_v1'` (including
 * missing/null/non-string/unrecognized) fails closed with
 * `AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE`.
 */
export function preflightAgt002GovernedWorksetCapacity(args) {
  const safeArgs = args !== null && typeof args === 'object' ? args : {};
  const route = safeArgs.route;

  const maxBatchCount = resolveMaxBatchCount(route, AGT002_GOVERNED_WORKSET_MAX_BATCHES);
  const durableMaxBatchCount = resolveAgt002GovernedWorksetDurableMaxBatchCount(route, AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES);
  const { source_char_count, chars_per_batch, document_count } = validateEvidence(safeArgs.evidence, route);

  const executionMode = safeArgs.executionMode;
  if (
    executionMode !== AGT002_GOVERNED_WORKSET_EXECUTION_MODE_SINGLE_TURN_V1 &&
    executionMode !== AGT002_GOVERNED_WORKSET_EXECUTION_MODE_DURABLE_BATCHED_V1
  ) {
    throw executionModeInvalidError(route);
  }
  const checkpointing = safeArgs.checkpointing === true;
  const durableEligible = executionMode === AGT002_GOVERNED_WORKSET_EXECUTION_MODE_DURABLE_BATCHED_V1 && checkpointing;
  const effectiveMaxBatchCount = durableEligible ? durableMaxBatchCount : maxBatchCount;

  const predictedBatchCount = Math.ceil(source_char_count / chars_per_batch);
  const verdict = predictedBatchCount <= effectiveMaxBatchCount
    ? AGT002_GOVERNED_WORKSET_APTO
    : AGT002_GOVERNED_WORKSET_NO_APTO;
  const durableCheckpointingRequired = durableEligible
    && verdict === AGT002_GOVERNED_WORKSET_APTO
    && predictedBatchCount > maxBatchCount;

  return Object.freeze({
    version: AGT002_GOVERNED_WORKSET_CAPACITY_VERSION,
    route,
    verdict,
    max_batch_count: maxBatchCount,
    durable_max_batch_count: durableMaxBatchCount,
    effective_max_batch_count: effectiveMaxBatchCount,
    predicted_batch_count: predictedBatchCount,
    source_char_count,
    chars_per_batch,
    document_count,
    execution_mode: executionMode,
    checkpointing,
    durable_checkpointing_required: durableCheckpointingRequired,
  });
}
