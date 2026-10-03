// Synthetic contract-only fixtures. This file does NOT copy the real
// Base_Maestra_Normalizada_v0.3.1.json content — entry ids and identity constants come from
// the validator module itself (the same values it is built to check against); every other
// field (document_class, notes, hashes, ...) below is synthetic placeholder text. The
// transformation resolutions and approval_evidence/residual_non_class_items values are the
// exact approved governance text (also sourced from the validator's own constants, not typed
// out independently) since the validator checks them for an exact match. No DB/fs/network
// access, no real timestamps beyond the fixed approved_at_utc string under test, no
// production data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256,
  AGT002_CANONICAL_V031_EXPECTED_VERSION,
  AGT002_CANONICAL_V031_EXPECTED_STATUS,
  AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY,
  AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC,
  AGT002_CANONICAL_V031_EXPECTED_MATCHING_RULE,
  AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS,
  AGT002_CANONICAL_V031_EXPECTED_APPROVAL_SCOPE,
  AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS,
  AGT002_CANONICAL_V031_ENTRY_IDS,
  AGT002_CANONICAL_V031_VAULT_ENTRY_IDS,
  AGT002_CANONICAL_V031_REQUIRED_ENTRY_STRING_FIELDS,
  AGT002_CANONICAL_V031_EXPECTED_SUPERSEDES,
  AGT002_CANONICAL_V031_SUPERSEDED_VERSIONS,
  AGT002_CANONICAL_V031_EXPECTED_APPROVAL_EVIDENCE,
  AGT002_CANONICAL_V031_EXPECTED_RESIDUAL_NON_CLASS_ITEMS,
  AGT002_CANONICAL_V031_FORBIDDEN_KEYS,
  validateAgt002CanonicalV031Envelope,
  buildAgt002CanonicalV031ValidationReport,
} from '../agt002-company-evidence-canonical-v031-validator.js';

// Imported as a namespace (not named bindings) because the exports referenced in the
// "canonical serialization / hash helpers" and "canonical payload binding" sections below do
// not exist on the module yet — that is the next hardening unit under test. A missing named
// import would throw an ESM link-time SyntaxError and crash the whole file; a missing property
// on a namespace object is simply `undefined`, so each not-yet-implemented test fails on its
// own assertion instead of taking every other test in this file down with it.
import * as Agt002CanonicalV031Validator from '../agt002-company-evidence-canonical-v031-validator.js';

const clone = (value) => structuredClone(value);

const SYNTHETIC_HASH = '1234567890abcdef'.repeat(4);

function buildSyntheticEntry(entryId) {
  const isVault = AGT002_CANONICAL_V031_VAULT_ENTRY_IDS.includes(entryId);
  return {
    entry_id: entryId,
    document_class: `synthetic-document-class-${entryId}`,
    change_action: 'synthetic-normalized',
    proposed_state: 'synthetic-proposed-state',
    evidence_state: 'synthetic-evidence-state',
    validity: 'synthetic-validity-window',
    sensitivity: 'synthetic-sensitivity-tag',
    source_segments_or_count: 'synthetic-source-ref-1',
    applicability: 'synthetic-applicability-scope',
    match_policy: 'synthetic-match-policy',
    human_gate: 'synthetic-human-gate-required',
    notes: 'synthetic governance note',
    evidence_sha256: isVault ? '' : SYNTHETIC_HASH,
  };
}

function buildSyntheticTransformations() {
  return Object.entries(AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS).map(([original, resolution]) => ({
    original,
    resolution,
    technical_hold_resolved: true,
  }));
}

function buildValidArtifact() {
  return {
    version: AGT002_CANONICAL_V031_EXPECTED_VERSION,
    status: AGT002_CANONICAL_V031_EXPECTED_STATUS,
    approved_by: AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY,
    approved_at_utc: AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC,
    matching_rule: AGT002_CANONICAL_V031_EXPECTED_MATCHING_RULE,
    ...AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS,
    approval_scope: { ...AGT002_CANONICAL_V031_EXPECTED_APPROVAL_SCOPE },
    transformations: buildSyntheticTransformations(),
    entries: AGT002_CANONICAL_V031_ENTRY_IDS.map(buildSyntheticEntry),
    supersedes: AGT002_CANONICAL_V031_EXPECTED_SUPERSEDES,
    superseded_versions: [...AGT002_CANONICAL_V031_SUPERSEDED_VERSIONS],
    approval_evidence: AGT002_CANONICAL_V031_EXPECTED_APPROVAL_EVIDENCE,
    residual_non_class_items: { ...AGT002_CANONICAL_V031_EXPECTED_RESIDUAL_NON_CLASS_ITEMS },
  };
}

function buildValidEnvelope() {
  return {
    artifact: buildValidArtifact(),
    observedFileSha256: AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256,
  };
}

// ---------------------------------------------------------------------------
// Positive case
// ---------------------------------------------------------------------------

test('a fully synthetic envelope matching the approved canonical contract has no blockers', () => {
  const blockers = validateAgt002CanonicalV031Envelope(buildValidEnvelope());
  assert.deepEqual(blockers, []);
});

test('the report for a valid envelope is valid:true with an empty blockers list', () => {
  const report = buildAgt002CanonicalV031ValidationReport(buildValidEnvelope());
  assert.equal(report.valid, true);
  assert.deepEqual(report.blockers, []);
});

// ---------------------------------------------------------------------------
// Malformed input never throws
// ---------------------------------------------------------------------------

for (const malformed of [null, undefined, 'a string', 42, true, [], () => {}]) {
  test(`validateAgt002CanonicalV031Envelope never throws on malformed envelope: ${String(malformed)}`, () => {
    assert.doesNotThrow(() => validateAgt002CanonicalV031Envelope(malformed));
    const blockers = validateAgt002CanonicalV031Envelope(malformed);
    assert.ok(blockers.length > 0);
  });

  test(`buildAgt002CanonicalV031ValidationReport never throws on malformed envelope: ${String(malformed)}`, () => {
    assert.doesNotThrow(() => buildAgt002CanonicalV031ValidationReport(malformed));
    const report = buildAgt002CanonicalV031ValidationReport(malformed);
    assert.equal(report.valid, false);
  });
}

test('a non-object artifact produces a blocker instead of throwing', () => {
  const envelope = { artifact: 'not-an-object', observedFileSha256: AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256 };
  assert.doesNotThrow(() => validateAgt002CanonicalV031Envelope(envelope));
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('artifact debe ser un objeto plano')));
});

test('a circular artifact never causes a stack overflow / throw', () => {
  const artifact = buildValidArtifact();
  artifact.entries[0].selfRef = artifact;
  assert.doesNotThrow(() => validateAgt002CanonicalV031Envelope({ artifact, observedFileSha256: AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256 }));
});

// ---------------------------------------------------------------------------
// Identity mismatches
// ---------------------------------------------------------------------------

test('a mismatched observedFileSha256 is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.observedFileSha256 = 'f'.repeat(64);
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('observedFileSha256')));
});

test('a mismatched artifact.version is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.version = 'v0.3.1-tampered';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('artifact.version')));
});

test('a mismatched artifact.status is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.status = 'DRAFT';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('artifact.status')));
});

test('a mismatched artifact.approved_by is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.approved_by = 'Someone Else';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('artifact.approved_by')));
});

test('a mismatched artifact.approved_at_utc is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.approved_at_utc = '2026-08-29T00:00:00Z';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('artifact.approved_at_utc')));
});

test('a mismatched matching_rule is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.matching_rule = 'fuzzy_match';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('artifact.matching_rule')));
});

// ---------------------------------------------------------------------------
// Top-level counts (NOT nested under a `counts` object)
// ---------------------------------------------------------------------------

for (const key of Object.keys(AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS)) {
  test(`top-level count field "${key}" must equal the declared approved value`, () => {
    const envelope = buildValidEnvelope();
    envelope.artifact[key] = 9999;
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(blockers.some((b) => b.includes(`artifact.${key}`)));
  });

  test(`top-level count field "${key}" missing entirely is rejected`, () => {
    const envelope = buildValidEnvelope();
    delete envelope.artifact[key];
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(blockers.some((b) => b.includes(`artifact.${key}`)));
  });
}

test('REGRESSION: nesting the counts under a `counts` object (old wrong shape) fails', () => {
  const envelope = buildValidEnvelope();
  const nestedCounts = { ...AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS };
  for (const key of Object.keys(AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS)) {
    delete envelope.artifact[key];
  }
  envelope.artifact.counts = nestedCounts;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  for (const key of Object.keys(AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS)) {
    assert.ok(blockers.some((b) => b.includes(`artifact.${key}`)));
  }
});

// ---------------------------------------------------------------------------
// Entries: id set (missing / extra / duplicate)
// ---------------------------------------------------------------------------

test('entries must be exactly the 22 approved entry_id values: a missing id is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.entries = envelope.artifact.entries.filter((e) => e.entry_id !== 'rup');
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('entries no incluye el entry_id requerido "rup"')));
});

test('an extra, non-approved entry_id is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.entries.push(buildSyntheticEntry('unapproved_synthetic_extra_class'));
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('entries contiene un entry_id no aprobado "unapproved_synthetic_extra_class"')));
});

test('a duplicated entry_id is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.entries.push(buildSyntheticEntry('rut'));
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('entries contiene "rut" duplicado')));
});

test('entries must be a list', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.entries = { not: 'a list' };
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b === 'entries debe ser una lista.'));
});

test('a non-object entry is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.entries[0] = 'not-an-object';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('entries[0] debe ser un objeto plano')));
});

test('an entry with a non-string entry_id is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.entries[0].entry_id = 12345;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('entries[0].entry_id debe ser un string no vacío')));
});

// ---------------------------------------------------------------------------
// Entries: each required string field
// ---------------------------------------------------------------------------

for (const field of AGT002_CANONICAL_V031_REQUIRED_ENTRY_STRING_FIELDS) {
  test(`entry field "${field}" is required to be a non-empty string`, () => {
    const envelope = buildValidEnvelope();
    envelope.artifact.entries[0][field] = '';
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(blockers.some((b) => b.includes(`.${field} debe ser texto no vacío`)));
  });

  test(`entry field "${field}" missing entirely is rejected`, () => {
    const envelope = buildValidEnvelope();
    delete envelope.artifact.entries[0][field];
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(blockers.some((b) => b.includes(`.${field} debe ser texto no vacío`)));
  });
}

// ---------------------------------------------------------------------------
// Entries: evidence_sha256 rules
// ---------------------------------------------------------------------------

test('a non-vault entry with an empty evidence_sha256 is rejected', () => {
  const envelope = buildValidEnvelope();
  const rupEntry = envelope.artifact.entries.find((e) => e.entry_id === 'rup');
  rupEntry.evidence_sha256 = '';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('rup') && b.includes('evidence_sha256')));
});

test('a non-vault entry with an uppercase hash is rejected (must be lowercase hex)', () => {
  const envelope = buildValidEnvelope();
  const rupEntry = envelope.artifact.entries.find((e) => e.entry_id === 'rup');
  rupEntry.evidence_sha256 = SYNTHETIC_HASH.toUpperCase();
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('rup') && b.includes('evidence_sha256')));
});

test('a non-vault entry with a wrong-length hash is rejected', () => {
  const envelope = buildValidEnvelope();
  const rupEntry = envelope.artifact.entries.find((e) => e.entry_id === 'rup');
  rupEntry.evidence_sha256 = 'abc123';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('rup') && b.includes('evidence_sha256')));
});

for (const vaultId of AGT002_CANONICAL_V031_VAULT_ENTRY_IDS) {
  test(`vault entry_id "${vaultId}" is allowed an empty evidence_sha256`, () => {
    const envelope = buildValidEnvelope();
    const entry = envelope.artifact.entries.find((e) => e.entry_id === vaultId);
    entry.evidence_sha256 = '';
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(!blockers.some((b) => b.includes(vaultId) && b.includes('evidence_sha256')));
  });

  test(`vault entry_id "${vaultId}" is allowed a valid lowercase hex hash too`, () => {
    const envelope = buildValidEnvelope();
    const entry = envelope.artifact.entries.find((e) => e.entry_id === vaultId);
    entry.evidence_sha256 = SYNTHETIC_HASH;
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(!blockers.some((b) => b.includes(vaultId) && b.includes('evidence_sha256')));
  });

  test(`vault entry_id "${vaultId}" with an invalid (non-hex, non-empty) hash is still rejected`, () => {
    const envelope = buildValidEnvelope();
    const entry = envelope.artifact.entries.find((e) => e.entry_id === vaultId);
    entry.evidence_sha256 = 'not-a-hash';
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(blockers.some((b) => b.includes(vaultId) && b.includes('evidence_sha256')));
  });
}

// ---------------------------------------------------------------------------
// approval_scope
// ---------------------------------------------------------------------------

test('approval_scope must match the exact approved key set: a missing key is rejected', () => {
  const envelope = buildValidEnvelope();
  delete envelope.artifact.approval_scope.authorizes_submission;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('approval_scope carece de la clave requerida "authorizes_submission"')));
});

test('approval_scope must match the exact approved key set: an extra key is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.approval_scope.authorizes_something_undeclared = false;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('approval_scope contiene una clave no permitida "authorizes_something_undeclared"')));
});

test('approval_scope.canonical_catalog must be exactly true', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.approval_scope.canonical_catalog = false;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('approval_scope.canonical_catalog debe ser exactamente true')));
});

for (const operationalKey of ['authorizes_agt002_run', 'authorizes_go', 'authorizes_helpdesk', 'authorizes_submission']) {
  test(`approval_scope.${operationalKey} set to true (extra operational authority) is rejected`, () => {
    const envelope = buildValidEnvelope();
    envelope.artifact.approval_scope[operationalKey] = true;
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(blockers.some((b) => b.includes(`approval_scope.${operationalKey} debe ser exactamente false`)));
  });
}

test('approval_scope must be a plain object', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.approval_scope = ['not', 'an', 'object'];
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('approval_scope debe ser un objeto plano')));
});

// ---------------------------------------------------------------------------
// transformations (key is `original`, NOT `original_id`; resolutions are exact)
// ---------------------------------------------------------------------------

test('transformations must cover all four required originals: a missing one is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.transformations = envelope.artifact.transformations.filter(
    (t) => t.original !== 'overtime_authorization',
  );
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('transformations no incluye la transformación requerida "overtime_authorization"')));
});

test('a duplicated transformation original is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.transformations.push({
    original: 'overtime_authorization',
    resolution: AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS.overtime_authorization,
    technical_hold_resolved: true,
  });
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('transformations contiene "overtime_authorization" duplicado')));
});

test('an unrecognized transformation original is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.transformations[0].original = 'not_one_of_the_four';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('transformations[0].original debe ser exactamente uno de')));
});

test('a transformation resolution that does not match the exact approved text is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.transformations[0].resolution = 'synthetic-wrong-resolution-text';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('transformations[0].resolution debe ser exactamente')));
});

test('an empty transformation resolution is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.transformations[0].resolution = '';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('transformations[0].resolution debe ser texto no vacío')));
});

test('technical_hold_resolved set to false is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.transformations[0].technical_hold_resolved = false;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('transformations[0].technical_hold_resolved debe ser exactamente true')));
});

test('technical_hold_resolved missing entirely is rejected', () => {
  const envelope = buildValidEnvelope();
  delete envelope.artifact.transformations[0].technical_hold_resolved;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('transformations[0].technical_hold_resolved debe ser exactamente true')));
});

test('transformations must be a list', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.transformations = 'not-a-list';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b === 'transformations debe ser una lista.'));
});

test('REGRESSION: using `original_id` instead of `original` (old wrong shape) fails', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.transformations = Object.entries(AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS).map(
    ([original, resolution]) => ({ original_id: original, resolution, technical_hold_resolved: true }),
  );
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  for (const original of Object.keys(AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS)) {
    assert.ok(blockers.some((b) => b.includes(`transformations no incluye la transformación requerida "${original}"`)));
  }
});

// ---------------------------------------------------------------------------
// supersedes / superseded_versions
// ---------------------------------------------------------------------------

test('supersedes must equal the exact approved version-proposal string', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.supersedes = 'v0.3-normalized-proposal-20260830';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('supersedes debe ser exactamente')));
});

test('REGRESSION: an array-valued `supersedes` (old wrong shape) fails', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.supersedes = [...AGT002_CANONICAL_V031_SUPERSEDED_VERSIONS];
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('supersedes debe ser exactamente')));
});

test('superseded_versions must be present and cover v0.2 and v0.3', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.superseded_versions = ['v0.3'];
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('superseded_versions carece de la versión reemplazada requerida "v0.2"')));
});

test('an extra, unrecognized superseded_versions entry is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.superseded_versions = ['v0.2', 'v0.3', 'v0.1'];
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('superseded_versions contiene una versión no reconocida "v0.1"')));
});

test('a duplicated superseded_versions entry is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.superseded_versions = ['v0.2', 'v0.3', 'v0.3'];
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('superseded_versions contiene "v0.3" duplicado')));
});

test('superseded_versions must be a list of non-empty strings', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.superseded_versions = 'v0.2';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b === 'superseded_versions debe ser una lista de strings no vacíos.'));
});

// ---------------------------------------------------------------------------
// approval_evidence
// ---------------------------------------------------------------------------

test('a mismatched approval_evidence is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.approval_evidence = 'synthetic-different-statement';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('approval_evidence debe ser exactamente')));
});

test('a missing approval_evidence is rejected', () => {
  const envelope = buildValidEnvelope();
  delete envelope.artifact.approval_evidence;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('approval_evidence debe ser exactamente')));
});

// ---------------------------------------------------------------------------
// residual_non_class_items
// ---------------------------------------------------------------------------

test('residual_non_class_items must match the exact approved key set: a missing key is rejected', () => {
  const envelope = buildValidEnvelope();
  delete envelope.artifact.residual_non_class_items.actual_ministry_overtime_authorization_evidence;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes(
    'residual_non_class_items carece de la clave requerida "actual_ministry_overtime_authorization_evidence"',
  )));
});

test('residual_non_class_items must match the exact approved key set: an extra key is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.residual_non_class_items.extra_undeclared_item = 1;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('residual_non_class_items contiene una clave no permitida "extra_undeclared_item"')));
});

for (const [key, expectedValue] of Object.entries(AGT002_CANONICAL_V031_EXPECTED_RESIDUAL_NON_CLASS_ITEMS)) {
  test(`residual_non_class_items.${key} must equal the declared approved value`, () => {
    const envelope = buildValidEnvelope();
    envelope.artifact.residual_non_class_items[key] = typeof expectedValue === 'number' ? expectedValue + 1000 : 'observed';
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(blockers.some((b) => b.includes(`residual_non_class_items.${key} debe ser exactamente`)));
  });
}

test('a non-object residual_non_class_items is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.residual_non_class_items = null;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('residual_non_class_items debe ser un objeto plano')));
});

// ---------------------------------------------------------------------------
// Recursive forbidden raw-reference / PII keys
// ---------------------------------------------------------------------------

for (const forbiddenKey of AGT002_CANONICAL_V031_FORBIDDEN_KEYS) {
  test(`a forbidden key "${forbiddenKey}" nested inside an entry is rejected`, () => {
    const envelope = buildValidEnvelope();
    envelope.artifact.entries[0][forbiddenKey] = 'synthetic-value';
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(blockers.some((b) => b.includes('Clave prohibida') && b.includes(forbiddenKey)));
  });
}

test('a forbidden key nested deeply inside a transformation is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.transformations[0].nested = { deeper: { token: 'synthetic-leak' } };
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('Clave prohibida') && b.includes('token')));
});

test('a forbidden key inside an array element is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.entries[0].extraList = [{ secret: 'synthetic-leak' }];
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('Clave prohibida') && b.includes('secret')));
});

test('ordinary governance text and approved_by are not rejected as forbidden keys', () => {
  const blockers = validateAgt002CanonicalV031Envelope(buildValidEnvelope());
  assert.ok(!blockers.some((b) => b.includes('Clave prohibida')));
});

// ---------------------------------------------------------------------------
// Report shape, immutability, no-authority flags
// ---------------------------------------------------------------------------

test('the report always declares catalogue_only true and every operational authority flag false, valid or not', () => {
  const validReport = buildAgt002CanonicalV031ValidationReport(buildValidEnvelope());
  assert.equal(validReport.catalogue_only, true);
  assert.equal(validReport.reconciliation_claim, false);
  assert.equal(validReport.authorizes_migration, false);
  assert.equal(validReport.authorizes_runtime_activation, false);
  assert.equal(validReport.authorizes_go, false);
  assert.equal(validReport.authorizes_submission, false);

  const invalidEnvelope = buildValidEnvelope();
  invalidEnvelope.artifact.status = 'REJECTED';
  const invalidReport = buildAgt002CanonicalV031ValidationReport(invalidEnvelope);
  assert.equal(invalidReport.valid, false);
  assert.equal(invalidReport.catalogue_only, true);
  assert.equal(invalidReport.reconciliation_claim, false);
  assert.equal(invalidReport.authorizes_migration, false);
  assert.equal(invalidReport.authorizes_runtime_activation, false);
  assert.equal(invalidReport.authorizes_go, false);
  assert.equal(invalidReport.authorizes_submission, false);
});

test('operational-sounding entry content never flips any authority flag to true', () => {
  const envelope = buildValidEnvelope();
  const rupEntry = envelope.artifact.entries.find((e) => e.entry_id === 'rup');
  rupEntry.proposed_state = 'READY_FOR_GO_AND_SUBMISSION_AUTHORIZED';
  rupEntry.human_gate = 'authorizes_go=true';
  const report = buildAgt002CanonicalV031ValidationReport(envelope);
  assert.equal(report.authorizes_go, false);
  assert.equal(report.authorizes_submission, false);
  assert.equal(report.reconciliation_claim, false);
  assert.equal(report.authorizes_migration, false);
});

test('the report object is deeply frozen', () => {
  const report = buildAgt002CanonicalV031ValidationReport(buildValidEnvelope());
  assert.throws(() => { report.valid = false; }, TypeError);
  assert.throws(() => { report.observed.version = 'tampered'; }, TypeError);
  assert.throws(() => { report.expected.version = 'tampered'; }, TypeError);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.observed));
  assert.ok(Object.isFrozen(report.expected));
  assert.ok(Object.isFrozen(report.blockers));
});

test('the blockers array returned by the validator is frozen and cannot be mutated', () => {
  const blockers = validateAgt002CanonicalV031Envelope(buildValidEnvelope());
  assert.ok(Object.isFrozen(blockers));
  assert.throws(() => { blockers.push('tampered'); }, TypeError);
});

test('the report observed identity reflects the supplied artifact values, not the expected constants', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.status = 'SOMETHING_ELSE';
  const report = buildAgt002CanonicalV031ValidationReport(envelope);
  assert.equal(report.observed.status, 'SOMETHING_ELSE');
  assert.equal(report.expected.status, AGT002_CANONICAL_V031_EXPECTED_STATUS);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('validation is deterministic: the same malformed input yields identical blockers on repeated calls', () => {
  const envelope = buildValidEnvelope();
  delete envelope.artifact.carried_forward;
  envelope.artifact.entries[0].document_class = '';
  const first = validateAgt002CanonicalV031Envelope(clone(envelope));
  const second = validateAgt002CanonicalV031Envelope(clone(envelope));
  assert.deepEqual(first, second);
});

test('validation is deterministic across many diverse malformed inputs (no throw, stable shape)', () => {
  const cases = [
    {},
    { artifact: {} },
    { artifact: buildValidArtifact() },
    { observedFileSha256: AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256 },
    buildValidEnvelope(),
  ];
  for (const testCase of cases) {
    const first = validateAgt002CanonicalV031Envelope(clone(testCase));
    const second = validateAgt002CanonicalV031Envelope(clone(testCase));
    assert.deepEqual(first, second);
    assert.ok(Array.isArray(first));
  }
});

// ===========================================================================
// NEXT HARDENING UNIT (not yet implemented — every test below this line is
// expected to fail against the current module). Four things are specified:
//
//   1. artifact top-level key set must be EXACT (reject any extra/missing key)
//   2. each transformation object's key set must be EXACT: original,
//      resolution, technical_hold_resolved — nothing more, nothing less
//   3. each entry object's key set must be EXACT: entry_id, the eleven
//      existing required string fields, and evidence_sha256 — nothing more
//   4. generic, artifact-agnostic canonical JSON (UTF-8) serialization +
//      SHA-256 helpers, and fail-closed binding of an optional
//      canonicalPayloadSha256 / canonicalPayloadBytes pair on the envelope
//
// None of these fixtures are copied from the real artifact: entry ids and
// the four transformation originals come from the validator module's own
// exported constants (as elsewhere in this file); every other value is
// synthetic placeholder text.
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. artifact top-level key set must be exact
// ---------------------------------------------------------------------------

const EXPECTED_TOP_LEVEL_ARTIFACT_KEYS = Object.keys(buildValidArtifact());

test('artifact top-level keys: an extra, undeclared top-level key is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.unexpected_extra_top_level_field = 'synthetic-value';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('contiene una clave no permitida "unexpected_extra_top_level_field"')));
});

test('artifact top-level keys: an extra key present with an undefined value is still rejected (key presence, not value, is what matters)', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.legacy_unused_field = undefined;
  assert.ok(Object.keys(envelope.artifact).includes('legacy_unused_field'));
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.includes('contiene una clave no permitida "legacy_unused_field"')));
});

for (const key of EXPECTED_TOP_LEVEL_ARTIFACT_KEYS) {
  test(`artifact top-level keys: missing required key "${key}" is flagged as an exact-key-set violation`, () => {
    const envelope = buildValidEnvelope();
    delete envelope.artifact[key];
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(blockers.some((b) => b.includes(`carece de la clave requerida "${key}"`)));
  });
}

test('artifact top-level keys: an artifact with an extra key is rejected even when every existing individual field check passes', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.internal_debug_note = 'synthetic-should-not-be-here';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  // Every field the current implementation checks individually is still correct here, so an
  // exact-key-set check is the only mechanism that can catch this extra key.
  assert.ok(blockers.some((b) => b.includes('internal_debug_note')));
});

// ---------------------------------------------------------------------------
// 2. transformation objects: exact key set { original, resolution, technical_hold_resolved }
// ---------------------------------------------------------------------------

test('transformation objects: an extra, undeclared key is rejected', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.transformations[0].synthetic_extra_field = 'x';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(
    blockers.some((b) => b.includes('transformations[0]') && b.includes('contiene una clave no permitida "synthetic_extra_field"')),
  );
});

test('transformation objects: a missing "original" key is flagged as an exact-key-set violation', () => {
  const envelope = buildValidEnvelope();
  delete envelope.artifact.transformations[0].original;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(
    blockers.some((b) => b.includes('transformations[0]') && b.includes('carece de la clave requerida "original"')),
  );
});

test('transformation objects: a missing "resolution" key is flagged as an exact-key-set violation', () => {
  const envelope = buildValidEnvelope();
  delete envelope.artifact.transformations[0].resolution;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(
    blockers.some((b) => b.includes('transformations[0]') && b.includes('carece de la clave requerida "resolution"')),
  );
});

test('transformation objects: a missing "technical_hold_resolved" key is flagged as an exact-key-set violation', () => {
  const envelope = buildValidEnvelope();
  delete envelope.artifact.transformations[0].technical_hold_resolved;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(
    blockers.some(
      (b) => b.includes('transformations[0]') && b.includes('carece de la clave requerida "technical_hold_resolved"'),
    ),
  );
});

// ---------------------------------------------------------------------------
// 3. entry objects: exact key set { entry_id, ...the eleven required string fields, evidence_sha256 }
// ---------------------------------------------------------------------------

const EXPECTED_ENTRY_KEYS = ['entry_id', ...AGT002_CANONICAL_V031_REQUIRED_ENTRY_STRING_FIELDS, 'evidence_sha256'];

test('entry objects: an extra, undeclared key is rejected even though every required field is otherwise valid', () => {
  const envelope = buildValidEnvelope();
  envelope.artifact.entries[0].synthetic_extra_field = 'x';
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(
    blockers.some((b) => b.includes('entries[0]') && b.includes('contiene una clave no permitida "synthetic_extra_field"')),
  );
});

for (const key of EXPECTED_ENTRY_KEYS) {
  test(`entry objects: missing key "${key}" is flagged as an exact-key-set violation`, () => {
    const envelope = buildValidEnvelope();
    delete envelope.artifact.entries[0][key];
    const blockers = validateAgt002CanonicalV031Envelope(envelope);
    assert.ok(blockers.some((b) => b.includes('entries[0]') && b.includes(`carece de la clave requerida "${key}"`)));
  });
}

// ---------------------------------------------------------------------------
// 4. generic canonical JSON (UTF-8) serialization + SHA-256 helpers
//
// Assumed exported names (do not exist yet):
//   toCanonicalJsonString(value)          -> string, recursively sorted object keys,
//                                             array order preserved, no whitespace
//   computeCanonicalPayloadSha256Hex(value) -> lowercase 64-char hex sha256 of the UTF-8
//                                             bytes of toCanonicalJsonString(value)
//   computeCanonicalPayloadByteLength(value) -> UTF-8 byte length of that same string
// ---------------------------------------------------------------------------

function independentSha256Hex(utf8String) {
  return createHash('sha256').update(Buffer.from(utf8String, 'utf8')).digest('hex');
}

test('canonical JSON helper toCanonicalJsonString is exported as a function', () => {
  assert.equal(typeof Agt002CanonicalV031Validator.toCanonicalJsonString, 'function');
});

test('canonical payload SHA-256 helper computeCanonicalPayloadSha256Hex is exported as a function', () => {
  assert.equal(typeof Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex, 'function');
});

test('canonical payload byte-length helper computeCanonicalPayloadByteLength is exported as a function', () => {
  assert.equal(typeof Agt002CanonicalV031Validator.computeCanonicalPayloadByteLength, 'function');
});

test('canonical JSON serialization is deterministic across repeated calls on an equivalent synthetic object', () => {
  const value = { z: 1, a: { c: 3, b: 2 }, m: [3, 1, 2] };
  const first = Agt002CanonicalV031Validator.toCanonicalJsonString(value);
  const second = Agt002CanonicalV031Validator.toCanonicalJsonString(structuredClone(value));
  assert.equal(first, second);
});

test('canonical JSON serialization is invariant to top-level object key order', () => {
  const orderA = { alpha: 1, beta: { y: 2, x: 1 }, gamma: [1, 2, 3] };
  const orderB = { gamma: [1, 2, 3], alpha: 1, beta: { x: 1, y: 2 } };
  assert.equal(
    Agt002CanonicalV031Validator.toCanonicalJsonString(orderA),
    Agt002CanonicalV031Validator.toCanonicalJsonString(orderB),
  );
});

test('canonical JSON serialization recursively sorts nested object keys at every depth', () => {
  const nested = { top: { z: { y: 1, x: 2 }, a: 1 } };
  const nestedReordered = { top: { a: 1, z: { x: 2, y: 1 } } };
  assert.equal(
    Agt002CanonicalV031Validator.toCanonicalJsonString(nested),
    Agt002CanonicalV031Validator.toCanonicalJsonString(nestedReordered),
  );
});

test('canonical JSON serialization preserves array element order (arrays are never sorted)', () => {
  const ascending = { list: [1, 2, 3] };
  const descending = { list: [3, 2, 1] };
  assert.notEqual(
    Agt002CanonicalV031Validator.toCanonicalJsonString(ascending),
    Agt002CanonicalV031Validator.toCanonicalJsonString(descending),
  );
});

test('canonical JSON serialization sorts keys of objects nested inside an array without reordering the array itself', () => {
  const value = { list: [{ b: 1, a: 2 }, { d: 3, c: 4 }] };
  const expected = '{"list":[{"a":2,"b":1},{"c":4,"d":3}]}';
  assert.equal(Agt002CanonicalV031Validator.toCanonicalJsonString(value), expected);
});

test('canonical JSON serialization is exact UTF-8: multi-byte characters survive a parse round-trip unchanged', () => {
  const value = { name: 'café', emoji: '🙂' };
  const canonical = Agt002CanonicalV031Validator.toCanonicalJsonString(value);
  const parsed = JSON.parse(canonical);
  assert.equal(parsed.name, 'café');
  assert.equal(parsed.emoji, '🙂');
});

test('canonical payload SHA-256 helper returns a lowercase 64-char hex digest', () => {
  const hash = Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex({ a: 1, b: 2 });
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('canonical payload SHA-256 matches an independently computed sha256 of the canonical JSON UTF-8 bytes', () => {
  const value = { z: 1, a: 'café🙂', nested: { y: 2, x: [3, 2, 1] } };
  const canonicalString = Agt002CanonicalV031Validator.toCanonicalJsonString(value);
  const expectedHash = independentSha256Hex(canonicalString);
  const actualHash = Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(value);
  assert.equal(actualHash, expectedHash);
});

test('canonical payload SHA-256 is invariant to object key order but sensitive to array order', () => {
  const value = { z: 1, a: 2 };
  const reorderedValue = { a: 2, z: 1 };
  assert.equal(
    Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(value),
    Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(reorderedValue),
  );

  const arrayValue = { list: [1, 2, 3] };
  const reorderedArrayValue = { list: [3, 2, 1] };
  assert.notEqual(
    Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(arrayValue),
    Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(reorderedArrayValue),
  );
});

test('canonical payload SHA-256 is sensitive to any single nested mutation of a synthetic artifact-shaped object', () => {
  const base = buildValidArtifact();
  const mutated = clone(base);
  mutated.entries[0].notes = `${mutated.entries[0].notes}-mutated`;
  assert.notEqual(
    Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(base),
    Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(mutated),
  );
});

test('canonical payload byte-length helper matches the UTF-8 byte length of the canonical JSON string', () => {
  const value = { name: 'café', list: [1, 2, 3] };
  const canonicalString = Agt002CanonicalV031Validator.toCanonicalJsonString(value);
  const expectedBytes = Buffer.byteLength(canonicalString, 'utf8');
  const actualBytes = Agt002CanonicalV031Validator.computeCanonicalPayloadByteLength(value);
  assert.equal(actualBytes, expectedBytes);
});

// ---------------------------------------------------------------------------
// 5. optional canonicalPayloadSha256 / canonicalPayloadBytes envelope binding:
//    exposed on the report only if supplied, and validation fails closed on mismatch.
// ---------------------------------------------------------------------------

function computeExpectedCanonicalPayloadForArtifact(artifact) {
  return {
    sha256: Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(artifact),
    bytes: Agt002CanonicalV031Validator.computeCanonicalPayloadByteLength(artifact),
  };
}

test('report does not expose a canonical payload hash/bytes when the caller does not supply them in the envelope', () => {
  const report = buildAgt002CanonicalV031ValidationReport(buildValidEnvelope());
  assert.ok(!('canonical_payload_sha256' in report.observed) || report.observed.canonical_payload_sha256 == null);
  assert.ok(!('canonical_payload_bytes' in report.observed) || report.observed.canonical_payload_bytes == null);
  assert.ok(!('canonical_payload_sha256' in report.expected) || report.expected.canonical_payload_sha256 == null);
  assert.ok(!('canonical_payload_bytes' in report.expected) || report.expected.canonical_payload_bytes == null);
});

test('a supplied canonicalPayloadSha256/canonicalPayloadBytes pair that matches recomputation of the supplied artifact produces no canonical-payload blocker and is exposed on the report', () => {
  const envelope = buildValidEnvelope();
  const { sha256, bytes } = computeExpectedCanonicalPayloadForArtifact(envelope.artifact);
  envelope.canonicalPayloadSha256 = sha256;
  envelope.canonicalPayloadBytes = bytes;

  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(!blockers.some((b) => b.toLowerCase().includes('canonical')));

  const report = buildAgt002CanonicalV031ValidationReport(envelope);
  assert.equal(report.observed.canonical_payload_sha256, sha256);
  assert.equal(report.expected.canonical_payload_sha256, sha256);
  assert.equal(report.observed.canonical_payload_bytes, bytes);
  assert.equal(report.expected.canonical_payload_bytes, bytes);
});

test('FAIL CLOSED: a supplied canonicalPayloadSha256 that does not match recomputation of the supplied artifact is rejected', () => {
  const envelope = buildValidEnvelope();
  const { sha256, bytes } = computeExpectedCanonicalPayloadForArtifact(envelope.artifact);
  envelope.canonicalPayloadSha256 = 'f'.repeat(64);
  envelope.canonicalPayloadBytes = bytes;
  assert.notEqual(envelope.canonicalPayloadSha256, sha256);

  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.toLowerCase().includes('canonical') && b.toLowerCase().includes('sha256')));

  const report = buildAgt002CanonicalV031ValidationReport(envelope);
  assert.equal(report.valid, false);
});

test('FAIL CLOSED: a supplied canonicalPayloadBytes that does not match recomputation of the supplied artifact is rejected', () => {
  const envelope = buildValidEnvelope();
  const { sha256, bytes } = computeExpectedCanonicalPayloadForArtifact(envelope.artifact);
  envelope.canonicalPayloadSha256 = sha256;
  envelope.canonicalPayloadBytes = bytes + 1;

  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.some((b) => b.toLowerCase().includes('canonical') && b.toLowerCase().includes('byte')));

  const report = buildAgt002CanonicalV031ValidationReport(envelope);
  assert.equal(report.valid, false);
});

test('FAIL CLOSED: an arbitrary mismatched canonicalPayloadSha256 is rejected even when every other field on the envelope is otherwise correct', () => {
  const envelope = buildValidEnvelope();
  envelope.canonicalPayloadSha256 = 'a'.repeat(64);
  envelope.canonicalPayloadBytes = 0;
  const blockers = validateAgt002CanonicalV031Envelope(envelope);
  assert.ok(blockers.length > 0);
});

test('when canonicalPayloadSha256 is mismatched, the report exposes the caller-supplied value as observed and the recomputed value as expected', () => {
  const envelope = buildValidEnvelope();
  const { sha256: correctHash, bytes } = computeExpectedCanonicalPayloadForArtifact(envelope.artifact);
  const wrongHash = 'b'.repeat(64);
  envelope.canonicalPayloadSha256 = wrongHash;
  envelope.canonicalPayloadBytes = bytes;

  const report = buildAgt002CanonicalV031ValidationReport(envelope);
  assert.equal(report.observed.canonical_payload_sha256, wrongHash);
  assert.equal(report.expected.canonical_payload_sha256, correctHash);
  assert.equal(report.valid, false);
});

// ---------------------------------------------------------------------------
// Governance-boundary regression: none of the new hardening above may ever
// flip an operational authority flag, even when the canonical payload binds.
// ---------------------------------------------------------------------------

test('REGRESSION: a fully valid envelope with a correctly bound canonical payload still carries zero operational authority', () => {
  const envelope = buildValidEnvelope();
  const { sha256, bytes } = computeExpectedCanonicalPayloadForArtifact(envelope.artifact);
  envelope.canonicalPayloadSha256 = sha256;
  envelope.canonicalPayloadBytes = bytes;

  const report = buildAgt002CanonicalV031ValidationReport(envelope);
  assert.equal(report.catalogue_only, true);
  assert.equal(report.reconciliation_claim, false);
  assert.equal(report.authorizes_migration, false);
  assert.equal(report.authorizes_runtime_activation, false);
  assert.equal(report.authorizes_go, false);
  assert.equal(report.authorizes_submission, false);
});

// ===========================================================================
// TEST-ONLY CORRECTION (independent review): the exported canonical JSON/hash/
// byte-length helpers must REJECT unsupported non-plain-object values instead
// of silently collapsing or reordering them. isPlainObject() currently only
// checks `value !== null && typeof value === 'object' && !Array.isArray(value)`,
// which is true for Date, RegExp, Map, Set, arbitrary class instances, and
// Buffer/Uint8Array alike. canonicalizeValue() then runs Object.keys() over
// them: Date/RegExp/Map/Set have no own enumerable keys and silently collapse
// to `{}` (their entire value is lost), while Buffer/Uint8Array expose their
// bytes as own enumerable numeric-index keys and get silently reinterpreted
// as an ordinary object keyed by stringified indices instead of a byte
// sequence. Every test in this section documents the required correction and
// is expected to FAIL against the current implementation — it does not apply
// a fix. Synthetic values only.
// ===========================================================================

class SyntheticClassInstance {
  constructor() {
    this.a = 1;
    this.b = 2;
  }
}

const UNSUPPORTED_NON_PLAIN_VALUES = [
  ['a Date instance', new Date('2026-08-29T18:01:03Z')],
  ['a RegExp instance', /synthetic-pattern/],
  ['a Map instance', new Map([['a', 1], ['b', 2]])],
  ['a Set instance', new Set([1, 2, 3])],
  ['a class instance (prototype is not Object.prototype)', new SyntheticClassInstance()],
  ['a Buffer instance', Buffer.from('synthetic-bytes', 'utf8')],
  ['a Uint8Array instance', new Uint8Array([1, 2, 3])],
];

for (const [label, value] of UNSUPPORTED_NON_PLAIN_VALUES) {
  test(`toCanonicalJsonString rejects ${label} instead of silently collapsing/reordering it`, () => {
    assert.throws(() => Agt002CanonicalV031Validator.toCanonicalJsonString(value));
  });

  test(`toCanonicalJsonString rejects ${label} nested inside an otherwise-plain object field`, () => {
    assert.throws(() => Agt002CanonicalV031Validator.toCanonicalJsonString({ synthetic_field: value }));
  });

  test(`toCanonicalJsonString rejects ${label} nested inside an array element`, () => {
    assert.throws(() => Agt002CanonicalV031Validator.toCanonicalJsonString([value]));
  });
}

test('computeCanonicalPayloadSha256Hex rejects a Date instance instead of silently hashing a collapsed "{}"', () => {
  assert.throws(() => Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(new Date('2026-08-29T18:01:03Z')));
});

test('computeCanonicalPayloadSha256Hex rejects a Map instance instead of silently hashing a collapsed "{}"', () => {
  assert.throws(() => Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(new Map([['a', 1]])));
});

test('computeCanonicalPayloadSha256Hex rejects a Buffer instance instead of silently hashing its stringified-index reinterpretation', () => {
  assert.throws(() => Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(Buffer.from('synthetic-bytes', 'utf8')));
});

test('computeCanonicalPayloadByteLength rejects a Date instance instead of silently measuring a collapsed "{}"', () => {
  assert.throws(() => Agt002CanonicalV031Validator.computeCanonicalPayloadByteLength(new Date('2026-08-29T18:01:03Z')));
});

test('computeCanonicalPayloadByteLength rejects a Set instance instead of silently measuring a collapsed "{}"', () => {
  assert.throws(() => Agt002CanonicalV031Validator.computeCanonicalPayloadByteLength(new Set([1, 2, 3])));
});

test('computeCanonicalPayloadByteLength rejects a Uint8Array instance instead of silently measuring its stringified-index reinterpretation', () => {
  assert.throws(() => Agt002CanonicalV031Validator.computeCanonicalPayloadByteLength(new Uint8Array([1, 2, 3])));
});

// ---------------------------------------------------------------------------
// Null-prototype records: chosen contract is REJECT, not accept.
//
// An Object.create(null) record with ordinary JSON-compatible own properties
// satisfies today's isPlainObject() check (it is non-null, typeof 'object',
// and not an array), so it currently canonicalizes without complaint even
// though its prototype is not Object.prototype. Accepting it would make the
// "unsupported non-plain object" contract above ambiguous — a null-prototype
// record is exactly as much "not a genuine Object.prototype plain object" as
// a class instance is. To keep the contract unambiguous, this test asserts
// the corrected helper REJECTS null-prototype records too: only object
// literals / JSON.parse-shaped values (Object.prototype plain objects) are
// accepted as canonicalizable. This test is expected to FAIL against the
// current implementation, which accepts null-prototype records today.
// ---------------------------------------------------------------------------

test('toCanonicalJsonString rejects an Object.create(null) record under the chosen contract: only genuine Object.prototype plain objects are accepted, not merely non-array objects', () => {
  const nullProtoRecord = Object.create(null);
  nullProtoRecord.a = 1;
  nullProtoRecord.b = 2;
  assert.throws(() => Agt002CanonicalV031Validator.toCanonicalJsonString(nullProtoRecord));
});

// ===========================================================================
// TEST-ONLY CORRECTIONS (final review): two additional synthetic hardening
// units. Both are expected to FAIL against the current implementation.
//
//   (1) buildAgt002CanonicalV031ValidationReport must never throw when the
//       envelope/artifact is object-like but throws on property reads (a
//       Proxy with a throwing get trap, or a plain object with a throwing
//       accessor property) — it must fail closed: valid:false, at least one
//       blocker, and every governance authority flag still false.
//   (2) canonical serialization must preserve an own enumerable JSON-parsed
//       key literally named "__proto__" as a genuine own property of the
//       output, rather than silently dropping it or reinterpreting the
//       assignment as a prototype mutation of the output object.
//
// Synthetic only: no filesystem/DB/network/env access.
// ===========================================================================

test('buildAgt002CanonicalV031ValidationReport never throws for an artifact Proxy whose get trap always throws', () => {
  const artifact = new Proxy({}, {
    get() {
      throw new Error('synthetic-proxy-get-trap-throw');
    },
  });
  const envelope = { artifact, observedFileSha256: AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256 };

  assert.doesNotThrow(() => buildAgt002CanonicalV031ValidationReport(envelope));
  const report = buildAgt002CanonicalV031ValidationReport(envelope);

  assert.equal(report.valid, false);
  assert.ok(report.blockers.length > 0);
  assert.equal(report.catalogue_only, true);
  assert.equal(report.reconciliation_claim, false);
  assert.equal(report.authorizes_migration, false);
  assert.equal(report.authorizes_runtime_activation, false);
  assert.equal(report.authorizes_go, false);
  assert.equal(report.authorizes_submission, false);
});

test('buildAgt002CanonicalV031ValidationReport never throws for an envelope with a throwing "artifact" accessor', () => {
  const envelope = {};
  Object.defineProperty(envelope, 'artifact', {
    get() {
      throw new Error('synthetic-accessor-artifact-throw');
    },
    enumerable: true,
  });
  Object.defineProperty(envelope, 'observedFileSha256', {
    value: AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256,
    enumerable: true,
  });

  assert.doesNotThrow(() => buildAgt002CanonicalV031ValidationReport(envelope));
  const report = buildAgt002CanonicalV031ValidationReport(envelope);

  assert.equal(report.valid, false);
  assert.ok(report.blockers.length > 0);
  assert.equal(report.catalogue_only, true);
  assert.equal(report.reconciliation_claim, false);
  assert.equal(report.authorizes_migration, false);
  assert.equal(report.authorizes_runtime_activation, false);
  assert.equal(report.authorizes_go, false);
  assert.equal(report.authorizes_submission, false);
});

test('buildAgt002CanonicalV031ValidationReport never throws for an envelope with a throwing "canonicalPayloadSha256" accessor', () => {
  const envelope = {
    artifact: buildValidArtifact(),
    observedFileSha256: AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256,
  };
  Object.defineProperty(envelope, 'canonicalPayloadSha256', {
    get() {
      throw new Error('synthetic-accessor-canonicalPayloadSha256-throw');
    },
    enumerable: true,
  });

  assert.doesNotThrow(() => buildAgt002CanonicalV031ValidationReport(envelope));
  const report = buildAgt002CanonicalV031ValidationReport(envelope);

  assert.equal(report.valid, false);
  assert.ok(report.blockers.length > 0);
  assert.equal(report.catalogue_only, true);
  assert.equal(report.reconciliation_claim, false);
  assert.equal(report.authorizes_migration, false);
  assert.equal(report.authorizes_runtime_activation, false);
  assert.equal(report.authorizes_go, false);
  assert.equal(report.authorizes_submission, false);
});

test('toCanonicalJsonString preserves an own enumerable JSON-parsed "__proto__" key, keeps its nested keys sorted, and does not mutate the output prototype', () => {
  const parsed = JSON.parse('{"z_field":1,"__proto__":{"nested_z":2,"nested_a":1},"a_field":2}');
  assert.ok(Object.prototype.hasOwnProperty.call(parsed, '__proto__'));
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);

  const canonical = Agt002CanonicalV031Validator.toCanonicalJsonString(parsed);
  assert.ok(canonical.includes('"__proto__"'));
  assert.equal(canonical, '{"__proto__":{"nested_a":1,"nested_z":2},"a_field":2,"z_field":1}');

  const roundTripped = JSON.parse(canonical);
  assert.ok(Object.prototype.hasOwnProperty.call(roundTripped, '__proto__'));
  assert.equal(Object.getPrototypeOf(roundTripped), Object.prototype);
  assert.deepEqual(Object.keys(roundTripped.__proto__), ['nested_a', 'nested_z']);
});

test('canonical payload SHA-256 changes when the nested value under an own "__proto__" key changes', () => {
  const base = JSON.parse('{"a_field":2,"__proto__":{"nested_a":1}}');
  const mutated = JSON.parse('{"a_field":2,"__proto__":{"nested_a":999}}');

  const baseHash = Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(base);
  const mutatedHash = Agt002CanonicalV031Validator.computeCanonicalPayloadSha256Hex(mutated);

  assert.notEqual(baseHash, mutatedHash);
});
