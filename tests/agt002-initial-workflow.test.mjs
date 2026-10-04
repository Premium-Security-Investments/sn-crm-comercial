// AGT-002 P0-03 (RED) — initial-analysis workflow state machine, pure logic half.
//
// Distinct, neutral module belonging to the initial-analysis slice
// (docs/agt002/initial-analysis/CURRENT.md): agt002-initial-workflow.js is never imported by,
// and never imports, any agt002-reanalysis-*.js module. It pins the legal
// initial-analysis state transition matrix and the envelope shape every
// psi_agt002_workflow_events row must carry: actor, authority, target, env, scope,
// preconditions, evidence, expiry, rollback.
//
// agt002-initial-workflow.js does not exist yet: every import below fails module
// resolution, so every test in this file reports RED for the same underlying reason
// (missing implementation), exactly as intended for this phase.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGT002_WORKFLOW_TYPES,
  AGT002_WORKFLOW_SCOPES,
  AGT002_WORKFLOW_STATES,
  AGT002_WORKFLOW_TERMINAL_STATES,
  AGT002_WORKFLOW_AUTHORITIES,
  AGT002_WORKFLOW_ENVS,
  AGT002_WORKFLOW_CREATION_SENTINEL,
  AGT002_WORKFLOW_TRANSITION_MATRIX,
  isLegalAgt002WorkflowTransition,
  assertLegalAgt002WorkflowTransition,
  normalizeAgt002WorkflowScopeSnapshot,
  computeAgt002WorkflowInstanceIdempotencyKey,
  computeAgt002WorkflowEventIdempotencyKey,
  buildAgt002WorkflowEventEnvelope,
} from '../agt002-initial-workflow.js';

const UUID_A = '10000000-4000-4000-8000-000000000001';
const UUID_B = '10000000-4000-4000-8000-000000000002';
const HEX64_A = 'a'.repeat(64);
const HEX64_B = 'b'.repeat(64);

function baseEventInput(overrides = {}) {
  return {
    workflowInstanceId: UUID_A,
    toState: 'AUTHORIZED',
    actorKind: 'human',
    actorProfileId: UUID_B,
    authority: 'G1',
    target: 'INITIAL_ANALYSIS_WORKFLOW',
    env: 'production',
    scope: 'A',
    preconditions: { evidence_package_version_frozen: true },
    evidence: { package_version_id: UUID_A, package_hash: HEX64_A },
    expiresAt: new Date('2026-10-15T00:00:00.000Z').toISOString(),
    rollbackOfEventId: null,
    ...overrides,
  };
}

describe('AGT-002 initial-analysis workflow constants', () => {
  it('pins exactly the two legal workflow types', () => {
    assert.deepEqual([...AGT002_WORKFLOW_TYPES].sort(), ['INITIAL', 'REANALYSIS']);
  });

  it('pins exactly the two legal scopes: A or A_PLUS_B, no more, no fewer', () => {
    assert.deepEqual([...AGT002_WORKFLOW_SCOPES].sort(), ['A', 'A_PLUS_B']);
  });

  it('matches migration 100 authority and environment vocabularies exactly', () => {
    assert.deepEqual([...AGT002_WORKFLOW_AUTHORITIES].sort(), ['G1', 'REQUESTER', 'SYSTEM']);
    assert.deepEqual([...AGT002_WORKFLOW_ENVS].sort(), ['production', 'staging', 'test']);
  });

  it('pins the closed set of workflow states, including every terminal state', () => {
    const states = new Set(AGT002_WORKFLOW_STATES);
    for (const s of ['REQUESTED', 'AUTHORIZED', 'REJECTED', 'CONSUMED', 'REVOKED', 'EXPIRED', 'COMPLETED', 'FAILED']) {
      assert.ok(states.has(s), `AGT002_WORKFLOW_STATES must include ${s}`);
    }
    for (const s of AGT002_WORKFLOW_TERMINAL_STATES) {
      assert.ok(states.has(s), `every terminal state must also be a legal state: ${s}`);
    }
  });

  it('every terminal state has no outgoing legal transition', () => {
    for (const terminal of AGT002_WORKFLOW_TERMINAL_STATES) {
      assert.equal(
        AGT002_WORKFLOW_TRANSITION_MATRIX[terminal], undefined,
        `${terminal} is terminal and must have no entry in the transition matrix`,
      );
    }
  });

  it('the transition matrix is deeply frozen and keyed by the creation sentinel for the first transition', () => {
    assert.ok(Object.isFrozen(AGT002_WORKFLOW_TRANSITION_MATRIX));
    assert.ok(Array.isArray(AGT002_WORKFLOW_TRANSITION_MATRIX[AGT002_WORKFLOW_CREATION_SENTINEL]));
    assert.deepEqual(AGT002_WORKFLOW_TRANSITION_MATRIX[AGT002_WORKFLOW_CREATION_SENTINEL], ['REQUESTED']);
    for (const targets of Object.values(AGT002_WORKFLOW_TRANSITION_MATRIX)) {
      assert.ok(Object.isFrozen(targets), 'every target list must itself be frozen');
    }
  });
});

describe('isLegalAgt002WorkflowTransition / assertLegalAgt002WorkflowTransition', () => {
  const LEGAL_PAIRS = [
    [null, 'REQUESTED'],
    [undefined, 'REQUESTED'],
    ['REQUESTED', 'AUTHORIZED'],
    ['REQUESTED', 'REJECTED'],
    ['AUTHORIZED', 'CONSUMED'],
    ['AUTHORIZED', 'REVOKED'],
    ['AUTHORIZED', 'EXPIRED'],
    ['CONSUMED', 'COMPLETED'],
    ['CONSUMED', 'FAILED'],
  ];

  const ILLEGAL_PAIRS = [
    [null, 'AUTHORIZED'],
    ['REQUESTED', 'CONSUMED'],
    ['REQUESTED', 'REQUESTED'],
    ['AUTHORIZED', 'REQUESTED'],
    ['AUTHORIZED', 'COMPLETED'],
    ['CONSUMED', 'AUTHORIZED'],
    ['CONSUMED', 'CONSUMED'],
    ['REJECTED', 'AUTHORIZED'],
    ['REVOKED', 'CONSUMED'],
    ['EXPIRED', 'CONSUMED'],
    ['COMPLETED', 'FAILED'],
    ['FAILED', 'COMPLETED'],
    ['NOT_A_REAL_STATE', 'AUTHORIZED'],
    ['REQUESTED', 'NOT_A_REAL_STATE'],
  ];

  for (const [from, to] of LEGAL_PAIRS) {
    it(`${from ?? 'creation'} -> ${to} is legal`, () => {
      assert.equal(isLegalAgt002WorkflowTransition(from, to), true);
      assert.doesNotThrow(() => assertLegalAgt002WorkflowTransition(from, to));
    });
  }

  for (const [from, to] of ILLEGAL_PAIRS) {
    it(`${from ?? 'creation'} -> ${to} is illegal and fails closed`, () => {
      assert.equal(isLegalAgt002WorkflowTransition(from, to), false);
      assert.throws(() => assertLegalAgt002WorkflowTransition(from, to), /transition/i);
    });
  }
});

describe('normalizeAgt002WorkflowScopeSnapshot — scope is exactly A or A_PLUS_B; only A_PLUS_B carries a snapshot', () => {
  it('scope A with no snapshot fields normalizes to nulls', () => {
    const result = normalizeAgt002WorkflowScopeSnapshot({ scope: 'A', profileSnapshotId: null, profileSnapshotHash: null });
    assert.deepEqual(result, { scope: 'A', profileSnapshotId: null, profileSnapshotHash: null });
  });

  it('scope A carrying a snapshot id or hash fails closed', () => {
    assert.throws(() => normalizeAgt002WorkflowScopeSnapshot({ scope: 'A', profileSnapshotId: UUID_A, profileSnapshotHash: null }), /scope/i);
    assert.throws(() => normalizeAgt002WorkflowScopeSnapshot({ scope: 'A', profileSnapshotId: null, profileSnapshotHash: HEX64_A }), /scope/i);
  });

  it('scope A_PLUS_B requires both a well-formed snapshot id and hash', () => {
    const result = normalizeAgt002WorkflowScopeSnapshot({ scope: 'A_PLUS_B', profileSnapshotId: UUID_A, profileSnapshotHash: HEX64_A });
    assert.deepEqual(result, { scope: 'A_PLUS_B', profileSnapshotId: UUID_A, profileSnapshotHash: HEX64_A });
  });

  it('scope A_PLUS_B without a snapshot id or hash fails closed', () => {
    assert.throws(() => normalizeAgt002WorkflowScopeSnapshot({ scope: 'A_PLUS_B', profileSnapshotId: null, profileSnapshotHash: HEX64_A }), /snapshot/i);
    assert.throws(() => normalizeAgt002WorkflowScopeSnapshot({ scope: 'A_PLUS_B', profileSnapshotId: UUID_A, profileSnapshotHash: null }), /snapshot/i);
  });

  it('scope A_PLUS_B with a malformed snapshot hash fails closed', () => {
    assert.throws(() => normalizeAgt002WorkflowScopeSnapshot({ scope: 'A_PLUS_B', profileSnapshotId: UUID_A, profileSnapshotHash: 'not-a-hash' }), /hash/i);
  });

  it('an unknown scope literal fails closed', () => {
    assert.throws(() => normalizeAgt002WorkflowScopeSnapshot({ scope: 'B', profileSnapshotId: null, profileSnapshotHash: null }), /scope/i);
    assert.throws(() => normalizeAgt002WorkflowScopeSnapshot({ scope: 'A_PLUS_B_PLUS_C', profileSnapshotId: UUID_A, profileSnapshotHash: HEX64_A }), /scope/i);
  });
});

describe('computeAgt002WorkflowInstanceIdempotencyKey / computeAgt002WorkflowEventIdempotencyKey', () => {
  const baseInstance = {
    opportunityId: UUID_A, tenderId: UUID_B, workflowType: 'INITIAL', scope: 'A',
    profileSnapshotHash: null, requestedBy: UUID_B,
  };

  it('is deterministic: the same input always yields the same 64-hex digest', () => {
    const first = computeAgt002WorkflowInstanceIdempotencyKey(baseInstance);
    const second = computeAgt002WorkflowInstanceIdempotencyKey({ ...baseInstance });
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(first, second);
  });

  it('is sensitive to every field: changing any one field changes the digest', () => {
    const base = computeAgt002WorkflowInstanceIdempotencyKey(baseInstance);
    for (const [key, value] of Object.entries({
      opportunityId: UUID_B, tenderId: UUID_A, workflowType: 'REANALYSIS', scope: 'A_PLUS_B',
      profileSnapshotHash: HEX64_B, requestedBy: UUID_A,
    })) {
      const changed = computeAgt002WorkflowInstanceIdempotencyKey({ ...baseInstance, [key]: value });
      assert.notEqual(changed, base, `changing ${key} must change the idempotency key`);
    }
  });

  it('computeAgt002WorkflowEventIdempotencyKey is deterministic and field-sensitive', () => {
    const baseEvent = {
      workflowInstanceId: UUID_A, fromState: 'REQUESTED', toState: 'AUTHORIZED',
      authority: 'G1', actorProfileId: UUID_B,
    };
    const first = computeAgt002WorkflowEventIdempotencyKey(baseEvent);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(first, computeAgt002WorkflowEventIdempotencyKey({ ...baseEvent }));
    assert.notEqual(first, computeAgt002WorkflowEventIdempotencyKey({ ...baseEvent, toState: 'REJECTED' }));
  });
});

describe('buildAgt002WorkflowEventEnvelope — every transition carries actor/authority/target/env/scope/preconditions/evidence/expiry/rollback', () => {
  it('builds the canonical envelope with exactly the required columns', () => {
    const envelope = buildAgt002WorkflowEventEnvelope(baseEventInput());
    assert.deepEqual(Object.keys(envelope).sort(), [
      'actor_kind', 'actor_profile_id', 'authority', 'evidence', 'expires_at', 'env',
      'preconditions', 'rollback_of_event_id', 'scope', 'target', 'to_state', 'workflow_instance_id',
    ].sort());
    assert.equal(envelope.actor_profile_id, UUID_B);
    assert.equal(envelope.authority, 'G1');
    assert.equal(envelope.target, 'INITIAL_ANALYSIS_WORKFLOW');
    assert.equal(envelope.env, 'production');
    assert.equal(envelope.scope, 'A');
    assert.deepEqual(envelope.preconditions, { evidence_package_version_frozen: true });
    assert.deepEqual(envelope.evidence, { package_version_id: UUID_A, package_hash: HEX64_A });
    assert.equal(envelope.expires_at, baseEventInput().expiresAt);
    assert.equal(envelope.rollback_of_event_id, null);
  });

  it('a human actor requires a non-null actorProfileId', () => {
    assert.throws(() => buildAgt002WorkflowEventEnvelope(baseEventInput({ actorKind: 'human', actorProfileId: null })), /actor/i);
  });

  it('a system actor forbids a non-null actorProfileId', () => {
    assert.throws(() => buildAgt002WorkflowEventEnvelope(baseEventInput({ toState: 'EXPIRED', actorKind: 'system', actorProfileId: UUID_B, authority: 'SYSTEM', expiresAt: null })), /actor/i);
  });

  it('env is a closed vocabulary', () => {
    assert.throws(() => buildAgt002WorkflowEventEnvelope(baseEventInput({ env: 'prod' })), /env/i);
  });

  it('authority is a closed vocabulary (REQUESTER, G1 or SYSTEM only)', () => {
    assert.throws(() => buildAgt002WorkflowEventEnvelope(baseEventInput({ authority: 'G2' })), /authority/i);
  });

  it('scope is a closed vocabulary (A or A_PLUS_B only)', () => {
    assert.throws(() => buildAgt002WorkflowEventEnvelope(baseEventInput({ scope: 'B' })), /scope/i);
  });

  it('an AUTHORIZED transition requires a non-null expiresAt', () => {
    assert.throws(() => buildAgt002WorkflowEventEnvelope(baseEventInput({ toState: 'AUTHORIZED', expiresAt: null })), /expir/i);
  });

  it('a non-AUTHORIZED transition forbids a non-null expiresAt', () => {
    assert.throws(() => buildAgt002WorkflowEventEnvelope(baseEventInput({
      toState: 'REJECTED', actorKind: 'system', actorProfileId: null, authority: 'SYSTEM', expiresAt: baseEventInput().expiresAt,
    })), /expir/i);
  });

  it('preconditions and evidence must be plain objects, never arrays or primitives', () => {
    assert.throws(() => buildAgt002WorkflowEventEnvelope(baseEventInput({ preconditions: ['not', 'an', 'object'] })), /preconditions/i);
    assert.throws(() => buildAgt002WorkflowEventEnvelope(baseEventInput({ evidence: 'not-an-object' })), /evidence/i);
  });

  it('rollbackOfEventId, when present, must be a well-formed UUID', () => {
    assert.throws(() => buildAgt002WorkflowEventEnvelope(baseEventInput({ rollbackOfEventId: 'not-a-uuid' })), /rollback/i);
    const envelope = buildAgt002WorkflowEventEnvelope(baseEventInput({ rollbackOfEventId: UUID_A }));
    assert.equal(envelope.rollback_of_event_id, UUID_A);
  });

  it('never carries a raw prompt, extracted text, storage path, or credential', () => {
    const envelope = buildAgt002WorkflowEventEnvelope(baseEventInput());
    const serialized = JSON.stringify(envelope);
    assert.doesNotMatch(serialized, /extracted_text|storage_path|source_url|signed_url|credential|api_key|secret/i);
  });
});

console.log('AGT-002 initial workflow pure-logic contract passed');
