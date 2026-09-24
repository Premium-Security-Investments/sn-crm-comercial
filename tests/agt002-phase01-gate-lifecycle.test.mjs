import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGT002_PHASE01_SCHEMA_VERSIONS,
  AGT002_PHASE01_FINAL_AUDIT_GATE_ID,
  computeAgt002Phase01ArtifactSetHash,
  validateAgt002Phase01GateTransition,
  validateAgt002Phase01Gate,
} from '../agt002-phase01-executable-controls.js';

// Loading throws (named export not found) until Task 3 Step 3 adds
// computeAgt002Phase01ArtifactSetHash / validateAgt002Phase01GateTransition /
// validateAgt002Phase01Gate to agt002-phase01-executable-controls.js — this
// is the intended external RED for Step 1.

const CONTRACTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contracts',
  'agt002-phase01',
  'v1',
);
const GATE_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'gate.schema.json');
const AUTHORITY_REGISTRY_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'authority-registry.schema.json');

const GATE_SCHEMA = JSON.parse(readFileSync(GATE_SCHEMA_PATH, 'utf8'));
const AUTHORITY_REGISTRY_SCHEMA = JSON.parse(readFileSync(AUTHORITY_REGISTRY_SCHEMA_PATH, 'utf8'));

const NOW_UTC = '2026-09-23T18:00:00Z';

// Minimal registry, inline only: one grant covers every gate built below. It
// is authored complete — authority resolution validates the registry against
// authority-registry.schema.json before resolving any grant out of it.
const AUTHORITY_REGISTRY = Object.freeze({
  schema_version: AGT002_PHASE01_SCHEMA_VERSIONS.authorityRegistry,
  registry_version: 1,
  supersedes_registry_version: null,
  issued_at_utc: '2026-09-01T00:00:00Z',
  grants: [
    {
      grant_id: 'GRANT-TEST-0001',
      gate_type: 'PHASE_AUDIT',
      principal: {
        principal_id: 'f1c70000-0000-0000-0000-000000000001',
        principal_kind: 'synthetic',
        durable_ref: {
          source: 'fixture_registry',
          locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000001',
          verifiable: true,
        },
        display_label: 'Fixture Principal',
      },
      delegate_of: null,
      valid_from_utc: '2026-09-01T00:00:00Z',
      valid_until_utc: '2027-09-01T00:00:00Z',
      scope: {
        environments: ['isolated_fixture'],
        resource_kind: 'fixture_resource',
        resource_ids: ['f1c70000-0000-0000-0000-000000000002'],
        actions: ['read'],
      },
      revoked_at_utc: null,
    },
  ],
});

const baseContext = Object.freeze({
  now_utc: NOW_UTC,
  gate_schema: GATE_SCHEMA,
  authority_registry: AUTHORITY_REGISTRY,
  authority_registry_schema: AUTHORITY_REGISTRY_SCHEMA,
});

const PREVIOUS_STATUS_SCHEMA_VERSION = 'agt002-phase01-previous-status-snapshot/1.0.0';
const LEDGER_SCHEMA_VERSION = 'agt002-phase01-consumption-ledger-snapshot/1.0.0';

function sha256Hex(bytes) {
  const hash = createHash('sha256');
  hash.write(bytes);
  hash.end();
  return hash.digest('hex');
}

function resolvedFixture(body, locator, capturedAtUtc, overrides = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  return {
    provenance: {
      source: 'fixture_snapshot_store',
      issuer: 'AGT-002 lifecycle test resolver',
      locator,
      content_sha256: sha256Hex(bytes),
      schema_version: body.schema_version,
      captured_at_utc: capturedAtUtc,
      ...overrides,
    },
    bytes,
  };
}

function consumedContext({
  gateId = 'GATE_TEST_0001',
  snapshotAtUtc = '2026-09-20T23:59:59Z',
  previousStatus = 'OPEN',
  previousBodyOverrides = {},
  previousProvenanceOverrides = {},
  ledgerEntries = [],
  ledgerBodyOverrides = {},
  ledgerProvenanceOverrides = {},
  resolverOverrides = {},
  disablePreviousResolution = false,
  disableLedgerResolution = false,
  contextOverrides = {},
} = {}) {
  const previousBody = {
    schema_version: PREVIOUS_STATUS_SCHEMA_VERSION,
    gate_id: gateId,
    status: previousStatus,
    captured_at_utc: snapshotAtUtc,
    ...previousBodyOverrides,
  };
  const ledgerBody = {
    schema_version: LEDGER_SCHEMA_VERSION,
    snapshot_phase: 'pre_consumption',
    as_of_utc: snapshotAtUtc,
    entries: ledgerEntries,
    ...ledgerBodyOverrides,
  };
  const previous = resolvedFixture(
    previousBody,
    `fixture://gate-status/${gateId}/pre-consumption`,
    previousBody.captured_at_utc,
    previousProvenanceOverrides,
  );
  const ledger = resolvedFixture(
    ledgerBody,
    `fixture://consumption-ledger/${gateId}/pre-consumption`,
    ledgerBody.as_of_utc,
    ledgerProvenanceOverrides,
  );
  const records = new Map([
    [previous.provenance.locator, previous.bytes],
    [ledger.provenance.locator, ledger.bytes],
  ]);
  return {
    ...baseContext,
    previous_status_provenance: previous.provenance,
    consumption_ledger_provenance: ledger.provenance,
    provenance_resolver_kind: 'isolated_fixture',
    resolve_durable_evidence(locator) {
      if (disablePreviousResolution && locator === previous.provenance.locator) return null;
      if (disableLedgerResolution && locator === ledger.provenance.locator) return null;
      if (Object.hasOwn(resolverOverrides, locator)) return resolverOverrides[locator];
      return records.get(locator) ?? null;
    },
    ...contextOverrides,
  };
}

function buildCanonicalGate() {
  return {
    gate_id: 'GATE_TEST_0001',
    schema_version: AGT002_PHASE01_SCHEMA_VERSIONS.gate,
    type: 'PHASE_AUDIT',
    authority: {
      principal: {
        principal_id: 'f1c70000-0000-0000-0000-000000000001',
        principal_kind: 'synthetic',
        durable_ref: {
          source: 'fixture_registry',
          locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000001',
          verifiable: true,
        },
        display_label: 'Fixture Principal',
      },
      grant_id: 'GRANT-TEST-0001',
      delegation: null,
    },
    objective: 'Verify gate lifecycle against a minimal well-formed fixture object',
    environment: 'isolated_fixture',
    synthetic: true,
    scope: {
      resource_kind: 'fixture_resource',
      resource_ids: ['f1c70000-0000-0000-0000-000000000002'],
      actions: ['read'],
    },
    preconditions: [
      {
        precondition_id: 'PRE-0001',
        statement: 'Fixture precondition statement',
        verdict: 'VALID',
        evidence_ids: ['EVID-0001'],
      },
    ],
    evidence: [
      {
        evidence_id: 'EVID-0001',
        kind: 'fixture_record',
        locator: 'fixture://evidence/0001',
        durable: true,
        content_hash: 'a'.repeat(64),
        captured_at_utc: '2026-09-20T00:00:00Z',
      },
    ],
    expires_at_utc: '2026-09-24T00:00:00Z',
    consumption_policy: {
      max_consumptions: 1,
      receipt_required: true,
      idempotency_key: 'idempotency-key-0001',
    },
    rollback: {
      supported: false,
      procedure: 'Compensate via fixture rollback procedure',
      locator: 'fixture://rollback/0001',
    },
    issued_at_utc: '2026-09-20T00:00:00Z',
    status: 'OPEN',
    outcome: null,
    consumption: null,
    revocation: null,
    artifact_set_hash: 'a'.repeat(64),
    active_case: null,
  };
}

function sealGate(gate) {
  return { ...gate, artifact_set_hash: computeAgt002Phase01ArtifactSetHash(gate) };
}

function buildGate(overrides = {}) {
  return sealGate({ ...buildCanonicalGate(), ...overrides });
}

function buildFase0ConsumedGate(overrides = {}) {
  return buildGate({
    gate_id: AGT002_PHASE01_FINAL_AUDIT_GATE_ID,
    preconditions: [
      {
        precondition_id: 'PRE-0001',
        statement: 'AGT002-P1-GAP-0003: existe almacenamiento productivo apto para instancias de gate',
        verdict: 'INVALID',
        evidence_ids: ['EVID-0001'],
      },
    ],
    issued_at_utc: '2026-08-01T00:00:00Z',
    expires_at_utc: '2026-09-01T00:00:00Z',
    status: 'CONSUMED',
    outcome: 'REJECTED',
    consumption: {
      receipt_id: 'RCPT-FASE0-0001',
      consumed_at_utc: '2026-08-15T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
    ...overrides,
  });
}

// Group 1
test('gate lifecycle: happy path OPEN is VALID', () => {
  const gate = buildGate();
  const result = validateAgt002Phase01Gate(gate, baseContext);
  assert.equal(result.verdict, 'VALID', JSON.stringify(result.reasons));
  assert.equal(result.actionability_verdict, 'VALID');
});

// Group 2
test('gate lifecycle: happy path CONSUMED/PASS with a fresh receipt and an empty durable ledger is historically VALID but not actionable', () => {
  const gate = buildGate({
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-TEST-0001',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const result = validateAgt002Phase01Gate(gate, consumedContext());
  assert.equal(result.verdict, 'VALID', JSON.stringify(result.reasons));
  assert.equal(result.actionability_verdict, 'INVALID');
  assert.ok(result.actionability_reasons.includes('gate.not_actionable.status'));
});

// Group 3
test('gate lifecycle: FINAL_AUDIT_PHASE_0 modeled CONSUMED/REJECTED with a failed precondition is VALID (a well-governed rejection)', () => {
  const gate = buildFase0ConsumedGate();
  const result = validateAgt002Phase01Gate(gate, consumedContext({
    gateId: gate.gate_id,
    snapshotAtUtc: '2026-08-14T23:59:59Z',
  }));
  assert.equal(result.verdict, 'VALID', JSON.stringify(result.reasons));
  assert.equal(result.actionability_verdict, 'INVALID');
});

// Group 4 — FINAL_AUDIT_PHASE_0 in OPEN is forbidden. This negative lives
// inline, here, only — it must never be authored as a fixture file.
test('gate lifecycle: FINAL_AUDIT_PHASE_0 is never VALID in OPEN (inline negative, never a fixture)', () => {
  const consumedGate = buildFase0ConsumedGate();
  const openGate = sealGate({
    ...consumedGate,
    status: 'OPEN',
    outcome: null,
    consumption: null,
    revocation: null,
  });
  const result = validateAgt002Phase01Gate(openGate, baseContext);
  assert.notEqual(result.verdict, 'VALID');
  assert.ok(
    result.reasons.includes('gate.status.open_but_expired')
      || result.reasons.includes('gate.status.invalid_outcome_for_status'),
    JSON.stringify(result.reasons),
  );
});

// Group 5
test('gate transitions: allowed transitions resolve VALID', () => {
  assert.equal(validateAgt002Phase01GateTransition('DRAFT', 'OPEN').verdict, 'VALID');
  assert.equal(validateAgt002Phase01GateTransition('OPEN', 'CONSUMED').verdict, 'VALID');
  assert.equal(validateAgt002Phase01GateTransition('OPEN', 'EXPIRED').verdict, 'VALID');
  assert.equal(validateAgt002Phase01GateTransition('OPEN', 'REVOKED').verdict, 'VALID');
});

test('gate transitions: disallowed transitions resolve INVALID / gate.transition.not_allowed', () => {
  const disallowed = [
    ['DRAFT', 'CONSUMED'],
    ['CONSUMED', 'OPEN'],
    ['EXPIRED', 'CONSUMED'],
    ['REVOKED', 'CONSUMED'],
    ['OPEN', 'DRAFT'],
  ];
  for (const [from, to] of disallowed) {
    const result = validateAgt002Phase01GateTransition(from, to);
    assert.equal(result.verdict, 'INVALID', `${from} -> ${to}`);
    assert.ok(result.reasons.includes('gate.transition.not_allowed'), `${from} -> ${to}`);
  }
});

// Group 6
test('gate lifecycle: OPEN with outcome PASS is INVALID / gate.status.invalid_outcome_for_status', () => {
  const gate = buildGate({ outcome: 'PASS' });
  const result = validateAgt002Phase01Gate(gate, baseContext);
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('gate.status.invalid_outcome_for_status'));
});

// Group 7
test('gate lifecycle: CONSUMED without consumption is gate.consumption.missing; CONSUMED without outcome is gate.status.invalid_outcome_for_status', () => {
  const missingConsumption = buildGate({ status: 'CONSUMED', outcome: 'PASS', consumption: null });
  const missingConsumptionResult = validateAgt002Phase01Gate(missingConsumption, {
    ...baseContext,
    consumption_ledger: [],
  });
  assert.equal(missingConsumptionResult.verdict, 'INVALID');
  assert.ok(missingConsumptionResult.reasons.includes('gate.consumption.missing'));

  const missingOutcome = buildGate({
    status: 'CONSUMED',
    outcome: null,
    consumption: {
      receipt_id: 'RCPT-TEST-0002',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const missingOutcomeResult = validateAgt002Phase01Gate(missingOutcome, {
    ...baseContext,
    consumption_ledger: [],
  });
  assert.equal(missingOutcomeResult.verdict, 'INVALID');
  assert.ok(missingOutcomeResult.reasons.includes('gate.status.invalid_outcome_for_status'));
});

// Group 8
test('gate lifecycle: CONSUMED with a receipt_id already present in the ledger is INVALID / gate.consumption.receipt_not_unique', () => {
  const gate = buildGate({
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-DUP-0001',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const ledger = [
    { gate_id: 'GATE_OTHER_0002', receipt_id: 'RCPT-DUP-0001', consumed_at_utc: '2026-09-20T00:00:00Z' },
  ];
  const result = validateAgt002Phase01Gate(gate, consumedContext({ ledgerEntries: ledger }));
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('gate.consumption.receipt_not_unique'));
});

// Group 9
test('gate lifecycle: CONSUMED with a prior ledger entry for the same gate_id and a different receipt is INVALID / gate.consumption.exceeds_policy', () => {
  const gate = buildGate({
    gate_id: 'GATE_TEST_0003',
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-TEST-0003',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const ledger = [
    { gate_id: 'GATE_TEST_0003', receipt_id: 'RCPT-TEST-OLD', consumed_at_utc: '2026-09-20T00:00:00Z' },
  ];
  const result = validateAgt002Phase01Gate(gate, consumedContext({ gateId: gate.gate_id, ledgerEntries: ledger }));
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('gate.consumption.exceeds_policy'));
});

// Group 10
test('gate lifecycle: CONSUMED without consumption_ledger injected is UNVERIFIED / gate.consumption.ledger_absent', () => {
  const gate = buildGate({
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-TEST-0004',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const result = validateAgt002Phase01Gate(gate, baseContext);
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('gate.consumption.ledger_absent'));
});

// Group 11
test('gate lifecycle: consumed_at_utc outside [issued_at_utc, now_utc] is INVALID / gate.consumption.timestamp_out_of_range', () => {
  const afterNow = buildGate({
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-TEST-0005',
      consumed_at_utc: '2026-09-25T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const afterNowResult = validateAgt002Phase01Gate(afterNow, consumedContext());
  assert.equal(afterNowResult.verdict, 'INVALID');
  assert.ok(afterNowResult.reasons.includes('gate.consumption.timestamp_out_of_range'));

  const beforeIssued = buildGate({
    status: 'CONSUMED',
    outcome: 'PASS',
    issued_at_utc: '2026-09-20T00:00:00Z',
    consumption: {
      receipt_id: 'RCPT-TEST-0006',
      consumed_at_utc: '2026-09-19T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const beforeIssuedResult = validateAgt002Phase01Gate(beforeIssued, consumedContext());
  assert.equal(beforeIssuedResult.verdict, 'INVALID');
  assert.ok(beforeIssuedResult.reasons.includes('gate.consumption.timestamp_out_of_range'));
});

// Group 12
test('gate lifecycle: OPEN past expires_at_utc is INVALID / gate.status.open_but_expired', () => {
  const gate = buildGate({ expires_at_utc: '2026-09-01T00:00:00Z' });
  const result = validateAgt002Phase01Gate(gate, baseContext);
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('gate.status.open_but_expired'));
});

// Group 13
test('gate lifecycle: EXPIRED with a future expires_at_utc is gate.status.invalid_outcome_for_status; REVOKED without revocation is gate.status.revocation_required', () => {
  const expiredButNotYet = buildGate({ status: 'EXPIRED', expires_at_utc: '2026-09-30T00:00:00Z' });
  const expiredResult = validateAgt002Phase01Gate(expiredButNotYet, baseContext);
  assert.equal(expiredResult.verdict, 'INVALID');
  assert.ok(expiredResult.reasons.includes('gate.status.invalid_outcome_for_status'));

  const revokedWithoutRevocation = buildGate({ status: 'REVOKED', revocation: null });
  const revokedResult = validateAgt002Phase01Gate(revokedWithoutRevocation, baseContext);
  assert.equal(revokedResult.verdict, 'INVALID');
  assert.ok(revokedResult.reasons.includes('gate.status.revocation_required'));
});

// Group 14
test('gate lifecycle: outcome/preconditions coherence', () => {
  const passWithUnmet = buildGate({
    status: 'CONSUMED',
    outcome: 'PASS',
    preconditions: [
      { precondition_id: 'PRE-0001', statement: 'x', verdict: 'UNVERIFIED', evidence_ids: ['EVID-0001'] },
    ],
    consumption: {
      receipt_id: 'RCPT-TEST-0007',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const passResult = validateAgt002Phase01Gate(passWithUnmet, consumedContext());
  assert.equal(passResult.verdict, 'INVALID');
  assert.ok(passResult.reasons.includes('gate.outcome.pass_with_unmet_precondition'));

  const rejectedWithoutFailed = buildGate({
    status: 'CONSUMED',
    outcome: 'REJECTED',
    preconditions: [
      { precondition_id: 'PRE-0001', statement: 'x', verdict: 'VALID', evidence_ids: ['EVID-0001'] },
    ],
    consumption: {
      receipt_id: 'RCPT-TEST-0008',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const rejectedResult = validateAgt002Phase01Gate(rejectedWithoutFailed, consumedContext());
  assert.equal(rejectedResult.verdict, 'INVALID');
  assert.ok(rejectedResult.reasons.includes('gate.outcome.rejected_without_failed_precondition'));

  const cancelledWithFailed = buildGate({
    status: 'CONSUMED',
    outcome: 'CANCELLED',
    preconditions: [
      { precondition_id: 'PRE-0001', statement: 'x', verdict: 'INVALID', evidence_ids: ['EVID-0001'] },
    ],
    consumption: {
      receipt_id: 'RCPT-TEST-0009',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const cancelledResult = validateAgt002Phase01Gate(cancelledWithFailed, consumedContext());
  assert.equal(cancelledResult.verdict, 'INVALID');
  assert.ok(cancelledResult.reasons.includes('gate.outcome.cancelled_with_failed_precondition'));
});

// Group 15
test('gate lifecycle: artifact_set_hash mismatch is INVALID; OPEN -> CONSUMED does not change the immutable-subset hash', () => {
  const gate = buildGate();
  const tamperedHash = gate.artifact_set_hash.slice(0, -1) + (gate.artifact_set_hash.endsWith('a') ? 'b' : 'a');
  const tampered = { ...gate, artifact_set_hash: tamperedHash };
  const result = validateAgt002Phase01Gate(tampered, baseContext);
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('gate.artifact_set_hash.mismatch'));

  const openHash = computeAgt002Phase01ArtifactSetHash(gate);
  const consumedVariant = {
    ...gate,
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-TEST-0010',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  };
  const consumedHash = computeAgt002Phase01ArtifactSetHash(consumedVariant);
  assert.equal(openHash, consumedHash);
});

// Group 16
test('gate lifecycle: missing required field (objective) is INVALID with schema.missing_required in reasons', () => {
  const gate = buildGate();
  const { objective: _omitted, ...withoutObjective } = gate;
  const result = validateAgt002Phase01Gate(withoutObjective, baseContext);
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('schema.missing_required'));
});

test('gate lifecycle: malformed UTC timestamps never pass temporal validation', () => {
  const gate = buildGate({ expires_at_utc: 'zzzz' });
  const result = validateAgt002Phase01Gate(gate, baseContext);
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('gate.timestamp.invalid'));
});

test('gate lifecycle: strict canonical UTC rejects impossible calendar values and non-Z offsets', () => {
  const invalidTimestamps = [
    '2026-13-01T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-02-29T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:60:00Z',
    '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+00:00',
  ];

  for (const issued_at_utc of invalidTimestamps) {
    const result = validateAgt002Phase01Gate(buildGate({ issued_at_utc }), baseContext);
    assert.equal(result.verdict, 'INVALID', issued_at_utc);
    assert.ok(result.reasons.includes('gate.timestamp.invalid'), issued_at_utc);
    assert.equal(result.actionability_verdict, 'INVALID', issued_at_utc);
  }
});

test('gate lifecycle: OPEN is expired when now is one fractional millisecond after expires_at', () => {
  const gate = buildGate({ expires_at_utc: '2026-09-24T00:00:00Z' });
  const result = validateAgt002Phase01Gate(gate, {
    ...baseContext,
    now_utc: '2026-09-24T00:00:00.001Z',
  });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('gate.status.open_but_expired'));
  assert.equal(result.actionability_verdict, 'INVALID');
  assert.equal(result.is_actionable, false);
});

test('gate lifecycle: consumption one fractional millisecond after expiry is out of range', () => {
  const gate = buildGate({
    expires_at_utc: '2026-09-24T00:00:00Z',
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-FRACTIONAL-AFTER-EXPIRY',
      consumed_at_utc: '2026-09-24T00:00:00.001Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const result = validateAgt002Phase01Gate(gate, consumedContext({
    contextOverrides: { now_utc: '2026-09-24T00:00:00.002Z' },
  }));
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('gate.consumption.timestamp_out_of_range'));
});

test('gate lifecycle: terminal state without a durable previous status is UNVERIFIED', () => {
  const gate = buildGate({
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-TEST-PREVIOUS-ABSENT',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const result = validateAgt002Phase01Gate(gate, {
    ...baseContext,
    consumption_ledger: [],
    consumption_ledger_durable: true,
  });
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('gate.transition.previous_status_absent'));
});

test('gate lifecycle: caller-provided ledger without durable provenance is UNVERIFIED', () => {
  const gate = buildGate({
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-TEST-LEDGER-UNVERIFIED',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const result = validateAgt002Phase01Gate(gate, {
    ...baseContext,
    previous_status: 'OPEN',
    previous_status_durable: true,
    consumption_ledger: [],
  });
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('gate.consumption.ledger_unverified'));
});



test('gate lifecycle: legacy durable booleans cannot promote a consumed gate to VALID', () => {
  const gate = buildGate({
    status: 'CONSUMED', outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-LEGACY-FLAGS-0001',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const result = validateAgt002Phase01Gate(gate, {
    ...baseContext,
    previous_status: 'OPEN',
    previous_status_durable: true,
    consumption_ledger: [],
    consumption_ledger_durable: true,
  });
  assert.equal(result.verdict, 'UNVERIFIED', JSON.stringify(result.reasons));
  assert.ok(result.reasons.includes('gate.transition.previous_status_absent'));
  assert.ok(result.reasons.includes('gate.consumption.ledger_unverified'));
});

test('gate lifecycle: unresolved or hash-mismatched provenance is UNVERIFIED and never throws', () => {
  const gate = buildGate({
    status: 'CONSUMED', outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-PROVENANCE-0001',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  for (const context of [
    consumedContext({ disablePreviousResolution: true }),
    consumedContext({ disableLedgerResolution: true }),
    consumedContext({ previousProvenanceOverrides: { content_sha256: '0'.repeat(64) } }),
    consumedContext({ ledgerProvenanceOverrides: { content_sha256: '0'.repeat(64) } }),
  ]) {
    let result;
    assert.doesNotThrow(() => { result = validateAgt002Phase01Gate(gate, context); });
    assert.equal(result.verdict, 'UNVERIFIED', JSON.stringify(result.reasons));
  }
});

test('gate lifecycle: malformed ledger entries {} and [null] fail closed without exceptions', () => {
  const gate = buildGate({
    status: 'CONSUMED', outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-MALFORMED-LEDGER-0001',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  for (const entries of [{}, [null]]) {
    let result;
    assert.doesNotThrow(() => {
      result = validateAgt002Phase01Gate(
        gate,
        consumedContext({ ledgerBodyOverrides: { entries } }),
      );
    });
    assert.notEqual(result.verdict, 'VALID', JSON.stringify(result.reasons));
    assert.ok(result.reasons.includes('gate.consumption.ledger_invalid'), JSON.stringify(result.reasons));
  }
});

test('gate lifecycle: ledger must be a strictly earlier pre_consumption snapshot', () => {
  const gate = buildGate({
    status: 'CONSUMED', outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-LEDGER-CUT-0001',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  const wrongPhase = validateAgt002Phase01Gate(gate, consumedContext({
    ledgerBodyOverrides: { snapshot_phase: 'post_consumption' },
  }));
  assert.equal(wrongPhase.verdict, 'INVALID');
  assert.ok(wrongPhase.reasons.includes('gate.consumption.ledger_snapshot_phase_invalid'));

  const notEarlier = validateAgt002Phase01Gate(gate, consumedContext({
    ledgerBodyOverrides: { as_of_utc: '2026-09-21T00:00:00Z' },
  }));
  assert.equal(notEarlier.verdict, 'INVALID');
  assert.ok(notEarlier.reasons.includes('gate.consumption.ledger_snapshot_not_pre_consumption'));
});

test('gate lifecycle: production previous-status provenance rejects a local fixture locator even when relabeled independent', () => {
  const gate = buildGate({
    environment: 'production',
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-PROD-PREVIOUS-INDEPENDENT-RELABEL',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  // Same fixture-backed previous-status snapshot as the isolated_fixture
  // happy path (Group 2) — only the resolver-kind label and gate environment
  // change. A production CONSUMED gate must never become VALID off a
  // `fixture://` locator merely because the caller relabels it independent.
  const context = consumedContext({
    contextOverrides: { provenance_resolver_kind: 'independent' },
  });
  const result = validateAgt002Phase01Gate(gate, context);
  const previousStatusTerm = result.checked_terms.find((term) => term.term === 'previous_status_durability');
  assert.equal(previousStatusTerm.verdict, 'UNVERIFIED', JSON.stringify(previousStatusTerm));
  assert.ok(
    previousStatusTerm.reasons.includes('gate.transition.previous_status_unverified'),
    JSON.stringify(previousStatusTerm),
  );
  assert.notEqual(result.verdict, 'VALID', JSON.stringify(result.reasons));
});

test('gate lifecycle: production consumption-ledger provenance rejects a local fixture locator even when relabeled independent', () => {
  const gate = buildGate({
    environment: 'production',
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-PROD-LEDGER-INDEPENDENT-RELABEL',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000001',
    },
  });
  // Same fixture-backed ledger snapshot as the isolated_fixture happy path
  // (Group 2) — only the resolver-kind label and gate environment change. A
  // production CONSUMED gate must never become VALID off a `fixture://`
  // consumption-ledger locator merely because the caller relabels it
  // independent.
  const context = consumedContext({
    contextOverrides: { provenance_resolver_kind: 'independent' },
  });
  const result = validateAgt002Phase01Gate(gate, context);
  const consumptionTerm = result.checked_terms.find((term) => term.term === 'consumption_receipt');
  assert.equal(consumptionTerm.verdict, 'UNVERIFIED', JSON.stringify(consumptionTerm));
  assert.ok(
    consumptionTerm.reasons.includes('gate.consumption.ledger_unverified'),
    JSON.stringify(consumptionTerm),
  );
  assert.notEqual(result.verdict, 'VALID', JSON.stringify(result.reasons));
});

test('gate lifecycle: consumed_by must match the authorized gate principal', () => {
  const gate = buildGate({
    status: 'CONSUMED',
    outcome: 'PASS',
    consumption: {
      receipt_id: 'RCPT-TEST-UNAUTHORIZED-ACTOR',
      consumed_at_utc: '2026-09-21T00:00:00Z',
      consumed_by: 'f1c70000-0000-0000-0000-000000000099',
    },
  });
  const result = validateAgt002Phase01Gate(gate, consumedContext());
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('gate.consumption.actor_mismatch'));
});
