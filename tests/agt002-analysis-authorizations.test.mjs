// AGT-002 P0-03 (RED) — G1 analysis authorization, pure logic half.
//
// Distinct, neutral module belonging to the initial-analysis slice
// (docs/agt002/initial-analysis/CURRENT.md): agt002-analysis-authorizations.js is never
// imported by, and never imports, any agt002-reanalysis-*.js module. It pins: G1 authorizes
// only INITIAL workflows (never REANALYSIS); the active/unexpired/unrevoked/unconsumed
// status derivation used by the consume-on-create boundary that P0-04 job creation will call
// through psi_consume_agt002_analysis_authorization (migration 098, not authored in this
// phase); and the exact-binding matcher (workflow/package version+hash/opportunity/tender)
// that fails closed on any mismatch.
//
// agt002-analysis-authorizations.js does not exist yet: every import below fails module
// resolution, so every test in this file reports RED for the same underlying reason
// (missing implementation), exactly as intended for this phase.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGT002_ANALYSIS_AUTHORIZATION_GATES,
  AGT002_G1_AUTHORIZABLE_WORKFLOW_TYPES,
  assertAgt002G1CanAuthorize,
  computeAgt002AnalysisAuthorizationIdempotencyKey,
  isAgt002AnalysisAuthorizationActive,
  assertAgt002AnalysisAuthorizationBinding,
  publicAgt002AnalysisAuthorizationSummary,
} from '../agt002-analysis-authorizations.js';

const UUID_A = '10000000-4000-4000-8000-000000000001';
const UUID_B = '10000000-4000-4000-8000-000000000002';
const UUID_C = '10000000-4000-4000-8000-000000000003';
const HEX64_A = 'a'.repeat(64);
const HEX64_B = 'b'.repeat(64);

function baseAuthorization(overrides = {}) {
  return {
    workflowInstanceId: UUID_A,
    opportunityId: UUID_B,
    tenderId: UUID_C,
    packageVersionId: UUID_A,
    packageHash: HEX64_A,
    ...overrides,
  };
}

describe('AGT-002 G1 gate — authorizes exactly INITIAL, never REANALYSIS', () => {
  it('pins exactly one known gate today: G1', () => {
    assert.deepEqual([...AGT002_ANALYSIS_AUTHORIZATION_GATES], ['G1']);
  });

  it('pins exactly one G1-authorizable workflow type: INITIAL', () => {
    assert.deepEqual([...AGT002_G1_AUTHORIZABLE_WORKFLOW_TYPES], ['INITIAL']);
  });

  it('assertAgt002G1CanAuthorize accepts INITIAL', () => {
    assert.doesNotThrow(() => assertAgt002G1CanAuthorize('INITIAL'));
  });

  it('assertAgt002G1CanAuthorize fails closed for REANALYSIS: the G1 INITIAL gate can never authorize reanalysis', () => {
    assert.throws(() => assertAgt002G1CanAuthorize('REANALYSIS'), /G1/i);
    assert.throws(() => assertAgt002G1CanAuthorize('REANALYSIS'), /INITIAL/i);
  });

  it('assertAgt002G1CanAuthorize fails closed for any unknown workflow type', () => {
    assert.throws(() => assertAgt002G1CanAuthorize('SOMETHING_ELSE'));
    assert.throws(() => assertAgt002G1CanAuthorize(null));
    assert.throws(() => assertAgt002G1CanAuthorize(undefined));
  });
});

describe('computeAgt002AnalysisAuthorizationIdempotencyKey', () => {
  it('is deterministic and a well-formed 64-hex digest', () => {
    const base = { workflowInstanceId: UUID_A, packageVersionId: UUID_B, packageHash: HEX64_A, expiresAt: '2026-10-15T00:00:00.000Z' };
    const first = computeAgt002AnalysisAuthorizationIdempotencyKey(base);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(first, computeAgt002AnalysisAuthorizationIdempotencyKey({ ...base }));
  });

  it('is sensitive to every field', () => {
    const base = { workflowInstanceId: UUID_A, packageVersionId: UUID_B, packageHash: HEX64_A, expiresAt: '2026-10-15T00:00:00.000Z' };
    const digest = computeAgt002AnalysisAuthorizationIdempotencyKey(base);
    assert.notEqual(digest, computeAgt002AnalysisAuthorizationIdempotencyKey({ ...base, workflowInstanceId: UUID_C }));
    assert.notEqual(digest, computeAgt002AnalysisAuthorizationIdempotencyKey({ ...base, packageVersionId: UUID_C }));
    assert.notEqual(digest, computeAgt002AnalysisAuthorizationIdempotencyKey({ ...base, packageHash: HEX64_B }));
    assert.notEqual(digest, computeAgt002AnalysisAuthorizationIdempotencyKey({ ...base, expiresAt: '2026-11-01T00:00:00.000Z' }));
  });
});

describe('isAgt002AnalysisAuthorizationActive — active means AUTHORIZED, unexpired, unrevoked, unconsumed', () => {
  const NOW = new Date('2026-09-30T12:00:00.000Z');
  const FUTURE = '2026-10-15T00:00:00.000Z';
  const PAST = '2026-09-01T00:00:00.000Z';

  it('a REQUESTED (not yet authorized) workflow is pending, not active', () => {
    assert.equal(isAgt002AnalysisAuthorizationActive({ latestEventToState: 'REQUESTED', expiresAt: FUTURE, now: NOW }), 'pending');
  });

  it('an AUTHORIZED, unexpired workflow is active', () => {
    assert.equal(isAgt002AnalysisAuthorizationActive({ latestEventToState: 'AUTHORIZED', expiresAt: FUTURE, now: NOW }), 'active');
  });

  it('an AUTHORIZED workflow past its expiry is expired, even with no EXPIRED event recorded yet', () => {
    assert.equal(isAgt002AnalysisAuthorizationActive({ latestEventToState: 'AUTHORIZED', expiresAt: PAST, now: NOW }), 'expired');
  });

  it('an explicitly EXPIRED workflow is expired', () => {
    assert.equal(isAgt002AnalysisAuthorizationActive({ latestEventToState: 'EXPIRED', expiresAt: PAST, now: NOW }), 'expired');
  });

  it('a REVOKED workflow is revoked, never active, even if unexpired', () => {
    assert.equal(isAgt002AnalysisAuthorizationActive({ latestEventToState: 'REVOKED', expiresAt: FUTURE, now: NOW }), 'revoked');
  });

  it('a CONSUMED workflow is consumed, never active again (no double consumption)', () => {
    assert.equal(isAgt002AnalysisAuthorizationActive({ latestEventToState: 'CONSUMED', expiresAt: FUTURE, now: NOW }), 'consumed');
  });

  it('an unrecognized latestEventToState fails closed rather than defaulting to active', () => {
    assert.throws(() => isAgt002AnalysisAuthorizationActive({ latestEventToState: 'NOT_A_STATE', expiresAt: FUTURE, now: NOW }));
  });
});

describe('assertAgt002AnalysisAuthorizationBinding — exact match on workflow/package version+hash/opportunity/tender, fail closed on any mismatch', () => {
  it('an exact match does not throw', () => {
    const authorization = baseAuthorization();
    assert.doesNotThrow(() => assertAgt002AnalysisAuthorizationBinding({ authorization, request: baseAuthorization() }));
  });

  for (const field of ['workflowInstanceId', 'opportunityId', 'tenderId', 'packageVersionId']) {
    it(`a mismatched ${field} fails closed`, () => {
      const authorization = baseAuthorization();
      const request = baseAuthorization({ [field]: UUID_B === authorization[field] ? UUID_C : UUID_B });
      assert.throws(() => assertAgt002AnalysisAuthorizationBinding({ authorization, request }), /mismatch|bind/i);
    });
  }

  it('a mismatched packageHash fails closed', () => {
    const authorization = baseAuthorization();
    const request = baseAuthorization({ packageHash: HEX64_B });
    assert.throws(() => assertAgt002AnalysisAuthorizationBinding({ authorization, request }), /mismatch|bind|hash/i);
  });
});

describe('publicAgt002AnalysisAuthorizationSummary', () => {
  it('strips banned raw/sensitive keys at any depth', () => {
    const row = {
      id: UUID_A,
      evidence: { package_version_id: UUID_B, extracted_text: 'should never leak', storage_path: '/tmp/x' },
      raw_error: 'stack trace should never leak',
    };
    const summary = publicAgt002AnalysisAuthorizationSummary(row);
    assert.equal(summary.id, UUID_A);
    assert.equal(summary.evidence.package_version_id, UUID_B);
    assert.ok(!('extracted_text' in summary.evidence));
    assert.ok(!('storage_path' in summary.evidence));
    assert.ok(!('raw_error' in summary));
  });
});

console.log('AGT-002 analysis authorizations pure-logic contract passed');
