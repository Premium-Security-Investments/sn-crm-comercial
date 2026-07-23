const VERIFIED_DELEGATION_KEYS = Object.freeze([
  'issuer', 'subject', 'audience', 'authorized_party', 'actor_subject', 'agent_id',
  'capability', 'channel', 'correlation_id', 'environment', 'issued_at', 'expires_at', 'jti',
]);
const REQUEST_KEYS = Object.freeze(['contract_version', 'capability_id', 'correlation_id', 'query']);
const CONTEXT_KEYS = Object.freeze(['correlation_id', 'resolved_scope_digest', 'request_scope_digest', 'policy_version']);

function hasExactDataShape(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return false;
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
    });
  } catch {
    return false;
  }
}

function denied(reason) {
  return Object.freeze({ allowed: false, reason });
}

function cloneExactData(value, keys) {
  if (!hasExactDataShape(value, keys)) return null;
  try {
    const cloned = structuredClone(value);
    return hasExactDataShape(cloned, keys) ? cloned : null;
  } catch {
    return null;
  }
}

function isDigest(value) {
  return typeof value === 'string' && /^sha256:syn-[a-z0-9-]{3,120}$/.test(value);
}

export function guardSyntheticAgentCapability(delegation, request, serverContext) {
  const safeDelegation = cloneExactData(delegation, VERIFIED_DELEGATION_KEYS);
  if (!safeDelegation) return denied('invalid_delegation');
  if (!hasExactDataShape(request, REQUEST_KEYS)) return denied('invalid_request');
  if (!hasExactDataShape(request.query, [])) return denied('invalid_request');
  const safeRequest = cloneExactData(request, REQUEST_KEYS);
  if (!safeRequest || !hasExactDataShape(safeRequest.query, [])) return denied('invalid_request');
  const safeContext = cloneExactData(serverContext, CONTEXT_KEYS);
  if (!safeContext) return denied('invalid_context');

  if (safeDelegation.agent_id !== 'AGT-003' || safeDelegation.capability !== 'agt003.priorities.read') return denied('unsupported_capability');
  if (safeRequest.contract_version !== '1.0.0' || safeRequest.capability_id !== 'agt003.priorities.read') return denied('contract_drift');
  if (safeContext.policy_version !== 'gate0-v1.0') return denied('policy_drift');
  if (
    typeof safeDelegation.correlation_id !== 'string'
    || safeDelegation.correlation_id !== safeRequest.correlation_id
    || safeDelegation.correlation_id !== safeContext.correlation_id
  ) return denied('correlation_mismatch');
  if (
    !isDigest(safeContext.resolved_scope_digest)
    || safeContext.resolved_scope_digest !== safeContext.request_scope_digest
  ) return denied('scope_mismatch');

  return Object.freeze({
    allowed: true,
    agent_id: safeDelegation.agent_id,
    capability: safeDelegation.capability,
    correlation_id: safeDelegation.correlation_id,
    resolved_scope_digest: safeContext.resolved_scope_digest,
    policy_version: safeContext.policy_version,
  });
}
