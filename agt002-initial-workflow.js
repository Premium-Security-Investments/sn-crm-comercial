// AGT-002 P0-03 (GREEN slice A) — initial-analysis workflow state machine, pure logic half.
//
// Distinct, neutral module belonging to the initial-analysis slice
// (docs/agt002/initial-analysis/CURRENT.md): this module is never imported by, and never
// imports, any agt002-reanalysis-*.js module. It pins the legal initial-analysis state
// transition matrix and the envelope shape every psi_agt002_workflow_events row must carry:
// actor, authority, target, env, scope, preconditions, evidence, expiry, rollback.
//
// Pure functions only: no RPC calls, no SQL, no I/O. Callers inject RPC adapters around these
// validators/projectors; this module never performs a write itself.
import { createHash } from 'node:crypto';

export const AGT002_WORKFLOW_TYPES = Object.freeze(['INITIAL', 'REANALYSIS']);

export const AGT002_WORKFLOW_SCOPES = Object.freeze(['A', 'A_PLUS_B']);

export const AGT002_WORKFLOW_STATES = Object.freeze([
  'REQUESTED', 'AUTHORIZED', 'REJECTED', 'CONSUMED', 'REVOKED', 'EXPIRED', 'COMPLETED', 'FAILED',
]);

export const AGT002_WORKFLOW_TERMINAL_STATES = Object.freeze([
  'REJECTED', 'REVOKED', 'EXPIRED', 'COMPLETED', 'FAILED',
]);

export const AGT002_WORKFLOW_ACTOR_KINDS = Object.freeze(['human', 'system']);

export const AGT002_WORKFLOW_AUTHORITIES = Object.freeze(['G1', 'SYSTEM']);

export const AGT002_WORKFLOW_ENVS = Object.freeze(['production', 'isolated_fixture']);

// Sentinel key for the creation transition (null/undefined "from"). Deliberately not itself a
// member of AGT002_WORKFLOW_STATES so it can never collide with a real state.
export const AGT002_WORKFLOW_CREATION_SENTINEL = '__AGT002_WORKFLOW_CREATION__';

export const AGT002_WORKFLOW_TRANSITION_MATRIX = Object.freeze({
  [AGT002_WORKFLOW_CREATION_SENTINEL]: Object.freeze(['REQUESTED']),
  REQUESTED: Object.freeze(['AUTHORIZED', 'REJECTED']),
  AUTHORIZED: Object.freeze(['CONSUMED', 'REVOKED', 'EXPIRED']),
  CONSUMED: Object.freeze(['COMPLETED', 'FAILED']),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;

export function isLegalAgt002WorkflowTransition(from, to) {
  if (typeof to !== 'string' || !AGT002_WORKFLOW_STATES.includes(to)) return false;
  const fromKey = (from === null || from === undefined) ? AGT002_WORKFLOW_CREATION_SENTINEL : from;
  const targets = AGT002_WORKFLOW_TRANSITION_MATRIX[fromKey];
  return Array.isArray(targets) && targets.includes(to);
}

export function assertLegalAgt002WorkflowTransition(from, to) {
  if (!isLegalAgt002WorkflowTransition(from, to)) {
    throw new Error(`agt002-initial-workflow: illegal state transition "${from ?? 'creation'}" -> "${to}"`);
  }
}

export function normalizeAgt002WorkflowScopeSnapshot({ scope, profileSnapshotId, profileSnapshotHash }) {
  if (scope !== 'A' && scope !== 'A_PLUS_B') {
    throw new Error(`agt002-initial-workflow: unknown scope "${scope}"`);
  }

  if (scope === 'A') {
    if (profileSnapshotId !== null || profileSnapshotHash !== null) {
      throw new Error('agt002-initial-workflow: scope A must not carry a profile snapshot id or hash');
    }
    return { scope: 'A', profileSnapshotId: null, profileSnapshotHash: null };
  }

  if (profileSnapshotId === null || profileSnapshotHash === null) {
    throw new Error('agt002-initial-workflow: scope A_PLUS_B requires both a profile snapshot id and hash');
  }
  if (!UUID_PATTERN.test(profileSnapshotId)) {
    throw new Error('agt002-initial-workflow: scope A_PLUS_B profile snapshot id must be a well-formed UUID');
  }
  if (!HEX64_PATTERN.test(profileSnapshotHash)) {
    throw new Error('agt002-initial-workflow: scope A_PLUS_B profile snapshot hash must be a 64-hex sha256 digest');
  }
  return { scope: 'A_PLUS_B', profileSnapshotId, profileSnapshotHash };
}

function canonicalizeJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalizeJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function computeAgt002WorkflowHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalizeJsonValue(value))).digest('hex');
}

export function computeAgt002WorkflowInstanceIdempotencyKey(instance) {
  const { opportunityId, tenderId, workflowType, scope, profileSnapshotHash, requestedBy } = instance;
  return computeAgt002WorkflowHash({ opportunityId, tenderId, workflowType, scope, profileSnapshotHash, requestedBy });
}

export function computeAgt002WorkflowEventIdempotencyKey(event) {
  const { workflowInstanceId, fromState, toState, authority, actorProfileId } = event;
  return computeAgt002WorkflowHash({ workflowInstanceId, fromState, toState, authority, actorProfileId });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function buildAgt002WorkflowEventEnvelope(input) {
  const {
    workflowInstanceId, toState, actorKind, actorProfileId, authority, target, env, scope,
    preconditions, evidence, expiresAt, rollbackOfEventId = null,
  } = input;

  if (typeof toState !== 'string' || !AGT002_WORKFLOW_STATES.includes(toState)) {
    throw new Error(`agt002-initial-workflow: unknown to_state "${toState}"`);
  }
  if (!AGT002_WORKFLOW_ACTOR_KINDS.includes(actorKind)) {
    throw new Error(`agt002-initial-workflow: unknown actor_kind "${actorKind}"`);
  }
  if (actorKind === 'human' && actorProfileId === null) {
    throw new Error('agt002-initial-workflow: a human actor requires a non-null actor_profile_id');
  }
  if (actorKind === 'system' && actorProfileId !== null) {
    throw new Error('agt002-initial-workflow: a system actor forbids a non-null actor_profile_id');
  }
  if (!AGT002_WORKFLOW_AUTHORITIES.includes(authority)) {
    throw new Error(`agt002-initial-workflow: unknown authority "${authority}"`);
  }
  if (!AGT002_WORKFLOW_ENVS.includes(env)) {
    throw new Error(`agt002-initial-workflow: unknown env "${env}"`);
  }
  if (!AGT002_WORKFLOW_SCOPES.includes(scope)) {
    throw new Error(`agt002-initial-workflow: unknown scope "${scope}"`);
  }
  if (!isPlainObject(preconditions)) {
    throw new Error('agt002-initial-workflow: preconditions must be a plain object');
  }
  if (!isPlainObject(evidence)) {
    throw new Error('agt002-initial-workflow: evidence must be a plain object');
  }
  if (toState === 'AUTHORIZED' && expiresAt === null) {
    throw new Error('agt002-initial-workflow: an AUTHORIZED transition requires a non-null expires_at');
  }
  if (toState !== 'AUTHORIZED' && expiresAt !== null) {
    throw new Error(`agt002-initial-workflow: a "${toState}" transition forbids a non-null expires_at`);
  }
  if (rollbackOfEventId !== null && !UUID_PATTERN.test(rollbackOfEventId)) {
    throw new Error('agt002-initial-workflow: rollback_of_event_id must be a well-formed UUID');
  }

  return {
    workflow_instance_id: workflowInstanceId,
    to_state: toState,
    actor_kind: actorKind,
    actor_profile_id: actorProfileId,
    authority,
    target,
    env,
    scope,
    preconditions,
    evidence,
    expires_at: expiresAt,
    rollback_of_event_id: rollbackOfEventId,
  };
}
