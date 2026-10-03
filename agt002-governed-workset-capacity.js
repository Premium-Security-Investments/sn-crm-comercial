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

export const AGT002_GOVERNED_WORKSET_APTO = 'APTO';
export const AGT002_GOVERNED_WORKSET_NO_APTO = 'NO_APTO';

export const AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE = 'AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE';
export const AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE = 'AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE';

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

/** Resolves the route's server-owned max batch ceiling. Never trusts a caller/evidence override. */
function resolveMaxBatchCount(route, policy) {
  if (typeof route !== 'string' || route.length === 0) throw policyInvalidError(route);
  if (!isPlainPolicyMap(policy)) throw policyInvalidError(route);
  const maxBatchCount = policy[route];
  if (!isPositiveInteger(maxBatchCount)) throw policyInvalidError(route);
  return maxBatchCount;
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
