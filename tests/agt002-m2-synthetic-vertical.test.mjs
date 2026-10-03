import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  createAgt002M2SyntheticVertical,
  AGT002_M2_PHASE_TRANSITION_SENTINEL,
  AGT002_M2_ENVIRONMENT,
  recomputeAgt002M2RecordHash,
  verifyAgt002M2ChainIntegrity,
} from '../agt002-m2-synthetic-vertical.js';

// AGT-002 F3/M2: focused tests for the isolated in-memory synthetic vertical. All ids/locators
// below are synthetic-prefixed / fixture:// only. No IO, no network, no DB, no wiring into the
// real AGT-002/AGT-003 runtime.

const SENTINEL = AGT002_M2_PHASE_TRANSITION_SENTINEL;
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_PATH = path.join(REPO_ROOT, 'agt002-m2-synthetic-vertical.js');

function hex64(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

function humanActor(id) {
  return {
    principal_id: id,
    principal_kind: 'person',
    durable_ref: { locator: `fixture://agt002-m2/actors/${id}.json` },
  };
}

function validSourceParams(suffix) {
  return {
    sentinel: SENTINEL,
    source_id: `synthetic-source-${suffix}`,
    locator: `fixture://agt002-m2/sources/${suffix}.json`,
    content_sha256: hex64(`source-${suffix}`),
    captured_at_utc: '2026-09-01T10:00:00Z',
    actor_id: 'synthetic-pipeline',
  };
}

function validConversionParams(suffix) {
  return {
    sentinel: SENTINEL,
    conversion_id: `synthetic-conversion-${suffix}`,
    target_kind: 'tender_opportunity',
    converted_at_utc: '2026-09-01T10:05:00Z',
    actor_id: 'synthetic-pipeline',
  };
}

function validExpedienteParams(suffix) {
  return {
    sentinel: SENTINEL,
    expediente_id: `synthetic-expediente-${suffix}`,
    opened_at_utc: '2026-09-01T10:10:00Z',
    actor_id: 'synthetic-pipeline',
  };
}

function validWorksetParams(suffix) {
  return {
    sentinel: SENTINEL,
    workset_id: `synthetic-workset-${suffix}`,
    opened_at_utc: '2026-09-01T10:15:00Z',
    actor_id: 'synthetic-pipeline',
  };
}

function validAnalysisParams(suffix, { available = true } = {}) {
  return {
    sentinel: SENTINEL,
    analysis_id: `synthetic-analysis-${suffix}`,
    available,
    findings_hash: available ? hex64(`findings-${suffix}`) : undefined,
    unavailability_reason: available ? undefined : 'provider_timeout',
    recorded_at_utc: '2026-09-01T10:20:00Z',
    actor_id: 'synthetic-pipeline',
  };
}

function validRecommendationParams(suffix, { taxonomy = 'favorable' } = {}) {
  return {
    sentinel: SENTINEL,
    recommendation_id: `synthetic-recommendation-${suffix}`,
    taxonomy,
    rationale: 'synthetic rationale',
    produced_at_utc: '2026-09-01T10:25:00Z',
    actor_id: 'synthetic-pipeline',
  };
}

function validDecisionParams(suffix, actor) {
  return {
    sentinel: SENTINEL,
    decision_id: `synthetic-decision-${suffix}`,
    actor,
    verdict: 'GO',
    decided_at_utc: '2026-09-01T10:30:00Z',
  };
}

// Runs valid calls for every phase strictly before `uptoPhase`, leaving `uptoPhase` itself
// untouched so a test can exercise its validation in isolation against real prior state.
const PHASE_BUILD_ORDER = ['source', 'conversion', 'expediente', 'workset', 'analysis', 'recommendation', 'decision'];
function advanceTo(vertical, uptoPhase, suffix, { analysisAvailable = true, taxonomy = 'favorable' } = {}) {
  const idx = PHASE_BUILD_ORDER.indexOf(uptoPhase);
  if (idx > 0) vertical.recordSource(validSourceParams(suffix));
  if (idx > 1) vertical.convertSource(validConversionParams(suffix));
  if (idx > 2) vertical.openExpediente(validExpedienteParams(suffix));
  if (idx > 3) vertical.openWorkset(validWorksetParams(suffix));
  if (idx > 4) vertical.recordAnalysis(validAnalysisParams(suffix, { available: analysisAvailable }));
  if (idx > 5) vertical.buildRecommendation(validRecommendationParams(suffix, { taxonomy }));
}

function buildThroughRecommendation(vertical, { analysisAvailable = true, taxonomy = 'favorable', suffix = '1' } = {}) {
  const sourceResult = vertical.recordSource(validSourceParams(suffix));
  const conversionResult = vertical.convertSource(validConversionParams(suffix));
  const expedienteResult = vertical.openExpediente(validExpedienteParams(suffix));
  const worksetResult = vertical.openWorkset(validWorksetParams(suffix));
  const analysisResult = vertical.recordAnalysis(validAnalysisParams(suffix, { available: analysisAvailable }));
  const recommendationResult = vertical.buildRecommendation(validRecommendationParams(suffix, { taxonomy }));

  const steps = { sourceResult, conversionResult, expedienteResult, worksetResult, analysisResult, recommendationResult };
  for (const [name, result] of Object.entries(steps)) {
    assert.equal(result.status, 'RECORDED', `${name} must succeed while building the fixture chain`);
  }
  return steps;
}

// Shared assertion for a table-driven denial case: the call must be denied with the exact
// expected reason, must not mutate the phase's own record, and must audit the same reason.
function assertDenied(vertical, phase, phaseLabel, result, expectedReason) {
  assert.equal(result.status, 'DENIED', expectedReason);
  assert.equal(result.reason, expectedReason);
  assert.equal(vertical.getChain()[phase], null, expectedReason);
  const auditEntry = vertical.getAuditLog().at(-1);
  assert.equal(auditEntry.status, 'DENIED', expectedReason);
  assert.equal(auditEntry.reason, expectedReason);
  assert.equal(auditEntry.phase, phaseLabel, expectedReason);
}

// --- Positive: available GO -------------------------------------------------------------------

test('positive: available analysis + human GO produces a full, reconstructible chain with a post-GO result', () => {
  const vertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(vertical, { analysisAvailable: true, taxonomy: 'favorable', suffix: 'go-1' });

  const decision = vertical.decide({
    sentinel: SENTINEL,
    decision_id: 'synthetic-decision-go-1',
    actor: humanActor('synthetic-actor-go-1'),
    verdict: 'GO',
    decided_at_utc: '2026-09-01T10:30:00Z',
    rationale: 'meets criteria',
  });

  assert.equal(decision.status, 'GO');
  assert.equal(decision.record.analysis_available_at_decision, true);
  assert.equal(decision.record.attested_unavailable_go, false);
  assert.equal(decision.record.unavailable_analysis_attestation, null);
  assert.ok(decision.post_go, 'GO must produce a post-GO result');
  assert.equal(decision.post_go.based_on_decision_id, 'synthetic-decision-go-1');

  const chain = vertical.getChain();
  assert.ok(Object.values(chain).every((record) => record !== null));
  for (const record of Object.values(chain)) assert.equal(record.environment, AGT002_M2_ENVIRONMENT);

  const integrity = verifyAgt002M2ChainIntegrity(chain);
  assert.equal(integrity.verdict, 'VALID');
  assert.deepEqual(integrity.reasons, []);

  const auditLog = vertical.getAuditLog();
  assert.ok(auditLog.every((entry) => entry.status === 'ALLOWED'));
  assert.ok(auditLog.some((entry) => entry.phase === 'POST_GO'));
});

// --- Positive: attested unavailable GO --------------------------------------------------------

test('positive: unavailable analysis + valid structured attestation produces GO, with availability left false, and a post-GO result', () => {
  const vertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(vertical, { analysisAvailable: false, taxonomy: 'favorable', suffix: 'go-2' });

  const actor = humanActor('synthetic-actor-go-2');
  const analysisId = 'synthetic-analysis-go-2';
  const decision = vertical.decide({
    sentinel: SENTINEL,
    decision_id: 'synthetic-decision-go-2',
    actor,
    verdict: 'GO',
    decided_at_utc: '2026-09-01T10:30:00Z',
    unavailable_analysis_attestation: {
      missing_analysis_id: analysisId,
      reason: { code: 'deadline_pressure', detail: 'deadline forces a decision before the analysis completes' },
      attested_by: actor,
      attested_at_utc: '2026-09-01T10:29:00Z',
      statement: `decido sin el análisis ${analysisId}`,
    },
  });

  assert.equal(decision.status, 'GO');
  assert.equal(decision.record.analysis_available_at_decision, false);
  assert.equal(decision.record.attested_unavailable_go, true);
  assert.ok(decision.record.unavailable_analysis_attestation);
  assert.equal(decision.record.unavailable_analysis_attestation.missing_analysis_id, analysisId);
  assert.deepEqual(
    decision.record.unavailable_analysis_attestation.reason,
    { code: 'deadline_pressure', detail: 'deadline forces a decision before the analysis completes' },
  );
  assert.ok(Object.isFrozen(decision.record.unavailable_analysis_attestation.reason));
  assert.equal(decision.record.unavailable_analysis_attestation.statement, `decido sin el análisis ${analysisId}`);
  assert.ok(decision.post_go, 'attested unavailable GO must still produce a post-GO result');

  const chain = vertical.getChain();
  assert.equal(chain.analysis.available, false, 'availability must remain false even after an attested GO');
  assert.equal(verifyAgt002M2ChainIntegrity(chain).verdict, 'VALID');
});

// --- Positive: NO-GO ---------------------------------------------------------------------------

test('positive: NO-GO halts the chain with no transition and no post-GO result', () => {
  const vertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(vertical, { analysisAvailable: true, taxonomy: 'unfavorable', suffix: 'nogo-1' });

  const decision = vertical.decide({
    sentinel: SENTINEL,
    decision_id: 'synthetic-decision-nogo-1',
    actor: humanActor('synthetic-actor-nogo-1'),
    verdict: 'NO-GO',
    decided_at_utc: '2026-09-01T10:30:00Z',
    rationale: 'fails eligibility',
  });

  assert.equal(decision.status, 'NO-GO');
  assert.equal(decision.post_go, null);

  const chain = vertical.getChain();
  assert.equal(chain.decision.verdict, 'NO-GO');
  assert.equal(chain.post_go, null, 'no post-GO record must exist after a NO-GO');
  assert.equal(verifyAgt002M2ChainIntegrity(chain).verdict, 'VALID');

  const auditLog = vertical.getAuditLog();
  assert.ok(!auditLog.some((entry) => entry.phase === 'POST_GO'), 'no POST_GO transition may be audited after a NO-GO');
});

// --- Determinism / reconstructibility -----------------------------------------------------------

test('deterministic reconstructible chain: identical synthetic inputs on two isolated instances yield identical hashes, and tampering is detected', () => {
  const verticalA = createAgt002M2SyntheticVertical();
  const verticalB = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(verticalA, { analysisAvailable: true, taxonomy: 'favorable', suffix: 'det-1' });
  buildThroughRecommendation(verticalB, { analysisAvailable: true, taxonomy: 'favorable', suffix: 'det-1' });

  const decisionInput = {
    sentinel: SENTINEL,
    decision_id: 'synthetic-decision-det-1',
    actor: humanActor('synthetic-actor-det-1'),
    verdict: 'GO',
    decided_at_utc: '2026-09-01T10:30:00Z',
  };
  const resultA = verticalA.decide(decisionInput);
  const resultB = verticalB.decide(decisionInput);

  assert.deepEqual(verticalA.getChain(), verticalB.getChain());
  assert.equal(resultA.record.record_hash, resultB.record.record_hash);
  assert.equal(resultA.post_go.record_hash, resultB.post_go.record_hash);

  const chain = verticalA.getChain();
  assert.equal(verifyAgt002M2ChainIntegrity(chain).verdict, 'VALID');

  const tampered = { ...chain, analysis: { ...chain.analysis, available: false } };
  const tamperedIntegrity = verifyAgt002M2ChainIntegrity(tampered);
  assert.equal(tamperedIntegrity.verdict, 'INVALID');
  assert.ok(tamperedIntegrity.reasons.includes('chain.analysis.record_hash_mismatch'));

  assert.equal(recomputeAgt002M2RecordHash(chain.source), chain.source.record_hash);
});

test('chain integrity rejects malformed shapes and unknown phase slots fail-closed', () => {
  const malformed = verifyAgt002M2ChainIntegrity([]);
  assert.equal(malformed.verdict, 'INVALID');
  assert.deepEqual(malformed.reasons, ['chain.shape_invalid']);

  const vertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(vertical, { suffix: 'integrity-shape' });
  vertical.decide(validDecisionParams('integrity-shape', humanActor('synthetic-actor-integrity-shape')));

  const withUnknownPhase = { ...vertical.getChain(), injected_phase: null };
  const integrity = verifyAgt002M2ChainIntegrity(withUnknownPhase);
  assert.equal(integrity.verdict, 'INVALID');
  assert.ok(integrity.reasons.includes('chain.unknown_phase.injected_phase'));
});

test('chain integrity rejects wrong phase/environment metadata even when the tampered record is rehashed', () => {
  const vertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(vertical, { suffix: 'integrity-metadata' });
  vertical.decide(validDecisionParams('integrity-metadata', humanActor('synthetic-actor-integrity-metadata')));
  const chain = vertical.getChain();

  const wrongPhase = { ...chain.analysis, phase: 'RECOMMENDATION' };
  wrongPhase.record_hash = recomputeAgt002M2RecordHash(wrongPhase);
  const wrongEnvironment = { ...chain.post_go, environment: 'production' };
  wrongEnvironment.record_hash = recomputeAgt002M2RecordHash(wrongEnvironment);

  const integrity = verifyAgt002M2ChainIntegrity({
    ...chain,
    analysis: wrongPhase,
    post_go: wrongEnvironment,
  });
  assert.equal(integrity.verdict, 'INVALID');
  assert.ok(integrity.reasons.includes('chain.analysis.phase_mismatch'));
  assert.ok(integrity.reasons.includes('chain.post_go.environment_mismatch'));
});

test('chain integrity rejects gaps and any post-GO record after a NO-GO decision', () => {
  const goVertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(goVertical, { suffix: 'integrity-gap' });
  goVertical.decide(validDecisionParams('integrity-gap', humanActor('synthetic-actor-integrity-gap')));
  const goChain = goVertical.getChain();
  const gapIntegrity = verifyAgt002M2ChainIntegrity({ ...goChain, analysis: null });
  assert.equal(gapIntegrity.verdict, 'INVALID');
  assert.ok(gapIntegrity.reasons.includes('chain.recommendation.gap_before_phase'));

  const noGoVertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(noGoVertical, { taxonomy: 'unfavorable', suffix: 'integrity-nogo' });
  noGoVertical.decide({
    ...validDecisionParams('integrity-nogo', humanActor('synthetic-actor-integrity-nogo')),
    verdict: 'NO-GO',
  });
  const noGoChain = noGoVertical.getChain();
  const forbiddenPostGo = { ...goChain.post_go, previous_hash: noGoChain.decision.record_hash };
  forbiddenPostGo.record_hash = recomputeAgt002M2RecordHash(forbiddenPostGo);
  const noGoIntegrity = verifyAgt002M2ChainIntegrity({ ...noGoChain, post_go: forbiddenPostGo });
  assert.equal(noGoIntegrity.verdict, 'INVALID');
  assert.ok(noGoIntegrity.reasons.includes('chain.post_go.forbidden_after_no_go'));
});

test('chain integrity distinguishes invalid record/hash shapes, recomputed hash mismatches, and linkage mismatches', () => {
  const vertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(vertical, { suffix: 'integrity-hashes' });
  vertical.decide(validDecisionParams('integrity-hashes', humanActor('synthetic-actor-integrity-hashes')));
  const chain = vertical.getChain();

  const malformedRecord = verifyAgt002M2ChainIntegrity({ ...chain, analysis: [] });
  assert.ok(malformedRecord.reasons.includes('chain.analysis.record_invalid'));

  const invalidHash = verifyAgt002M2ChainIntegrity({
    ...chain,
    analysis: { ...chain.analysis, record_hash: 'not-a-sha256' },
  });
  assert.ok(invalidHash.reasons.includes('chain.analysis.record_hash_invalid'));

  const recomputedMismatch = verifyAgt002M2ChainIntegrity({
    ...chain,
    analysis: { ...chain.analysis, available: false },
  });
  assert.ok(recomputedMismatch.reasons.includes('chain.analysis.record_hash_mismatch'));

  const linkageMismatch = verifyAgt002M2ChainIntegrity({
    ...chain,
    recommendation: { ...chain.recommendation, previous_hash: hex64('wrong-link') },
  });
  assert.ok(linkageMismatch.reasons.includes('chain.recommendation.previous_hash_mismatch'));
});

test('chain integrity rejects malformed previous_hash format and a completely absent phase slot', () => {
  const vertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(vertical, { suffix: 'integrity-prevhash' });
  vertical.decide(validDecisionParams('integrity-prevhash', humanActor('synthetic-actor-integrity-prevhash')));
  const chain = vertical.getChain();

  // The genesis record (source) must carry previous_hash: null; any non-null value is invalid
  // regardless of whether it happens to look like a well-formed hash.
  const sourceWithPreviousHash = { ...chain.source, previous_hash: chain.conversion.previous_hash };
  sourceWithPreviousHash.record_hash = recomputeAgt002M2RecordHash(sourceWithPreviousHash);
  const sourcePreviousHash = verifyAgt002M2ChainIntegrity({ ...chain, source: sourceWithPreviousHash });
  assert.equal(sourcePreviousHash.verdict, 'INVALID');
  assert.ok(sourcePreviousHash.reasons.includes('chain.source.previous_hash_invalid'));

  // A non-source phase's previous_hash must be a well-formed 64-hex hash, independent of whether
  // it links to the right prior record.
  const conversionMalformedPreviousHash = { ...chain.conversion, previous_hash: 'not-a-hash' };
  conversionMalformedPreviousHash.record_hash = recomputeAgt002M2RecordHash(conversionMalformedPreviousHash);
  const conversionPreviousHash = verifyAgt002M2ChainIntegrity({ ...chain, conversion: conversionMalformedPreviousHash });
  assert.equal(conversionPreviousHash.verdict, 'INVALID');
  assert.ok(conversionPreviousHash.reasons.includes('chain.conversion.previous_hash_invalid'));

  // A phase slot that is entirely absent (not even present as null) must fail closed distinctly
  // from an explicit null, and must still trigger a gap on every phase that follows it.
  const { workset, ...chainWithoutWorkset } = chain;
  const missingSlot = verifyAgt002M2ChainIntegrity(chainWithoutWorkset);
  assert.equal(missingSlot.verdict, 'INVALID');
  assert.ok(missingSlot.reasons.includes('chain.workset.missing_slot'));
  assert.ok(missingSlot.reasons.includes('chain.analysis.gap_before_phase'));
});

// --- Negative: PHASE_TRANSITION_SENTINEL --------------------------------------------------------

test('negative: a wrong or missing PHASE_TRANSITION_SENTINEL is denied fail-closed and audited, at the first and at a later phase', () => {
  const vertical = createAgt002M2SyntheticVertical();

  const deniedWrong = vertical.recordSource({
    sentinel: 'not-the-sentinel',
    source_id: 'synthetic-source-sentinel-1',
    locator: 'fixture://agt002-m2/sources/sentinel-1.json',
    content_sha256: hex64('sentinel-1'),
    captured_at_utc: '2026-09-01T10:00:00Z',
  });
  assert.equal(deniedWrong.status, 'DENIED');
  assert.equal(deniedWrong.reason, 'phase_transition.sentinel_invalid');
  assert.equal(vertical.getChain().source, null);

  const deniedMissing = vertical.recordSource({
    source_id: 'synthetic-source-sentinel-2',
    locator: 'fixture://agt002-m2/sources/sentinel-2.json',
    content_sha256: hex64('sentinel-2'),
    captured_at_utc: '2026-09-01T10:00:00Z',
  });
  assert.equal(deniedMissing.reason, 'phase_transition.sentinel_invalid');

  buildThroughRecommendation(vertical, { suffix: 'sentinel-3' });
  const deniedDecision = vertical.decide({
    sentinel: 'nope',
    decision_id: 'synthetic-decision-sentinel-3',
    actor: humanActor('synthetic-actor-sentinel-3'),
    verdict: 'GO',
    decided_at_utc: '2026-09-01T10:30:00Z',
  });
  assert.equal(deniedDecision.status, 'DENIED');
  assert.equal(deniedDecision.reason, 'phase_transition.sentinel_invalid');
  assert.equal(vertical.getChain().decision, null);

  const sentinelDenials = vertical.getAuditLog().filter((entry) => entry.reason === 'phase_transition.sentinel_invalid');
  assert.equal(sentinelDenials.length, 3);
  assert.ok(sentinelDenials.every((entry) => entry.status === 'DENIED'));
});

// --- Table-driven: per-phase field validation, fail-closed on every reachable reason code -------

test('table: source validation denies each malformed field with its exact reason code', () => {
  const suffix = 'tbl-source';
  const base = validSourceParams(suffix);
  const cases = [
    [{ source_id: 'not-synthetic' }, 'source.not_synthetic'],
    [{ source_id: undefined }, 'source.not_synthetic'],
    [{ locator: 'https://not-isolated.example/x' }, 'source.locator_not_isolated'],
    [{ locator: undefined }, 'source.locator_not_isolated'],
    [{ content_sha256: 'not-a-hash' }, 'source.content_hash_invalid'],
    [{ content_sha256: undefined }, 'source.content_hash_invalid'],
    [{ captured_at_utc: 'not-a-timestamp' }, 'source.timestamp_invalid'],
  ];
  for (const [override, expectedReason] of cases) {
    const vertical = createAgt002M2SyntheticVertical();
    const result = vertical.recordSource({ ...base, ...override });
    assertDenied(vertical, 'source', 'SOURCE', result, expectedReason);
  }
});

test('table: conversion validation denies each malformed field with its exact reason code', () => {
  const suffix = 'tbl-conversion';
  const base = validConversionParams(suffix);
  const cases = [
    [{ conversion_id: 'not-synthetic' }, 'conversion.id_not_synthetic'],
    [{ conversion_id: undefined }, 'conversion.id_not_synthetic'],
    [{ target_kind: undefined }, 'conversion.target_kind_missing'],
    [{ target_kind: '' }, 'conversion.target_kind_missing'],
    [{ converted_at_utc: 'not-a-timestamp' }, 'conversion.timestamp_invalid'],
  ];
  for (const [override, expectedReason] of cases) {
    const vertical = createAgt002M2SyntheticVertical();
    advanceTo(vertical, 'conversion', suffix);
    const result = vertical.convertSource({ ...base, ...override });
    assertDenied(vertical, 'conversion', 'CONVERSION', result, expectedReason);
  }
});

test('table: expediente validation denies each malformed field with its exact reason code', () => {
  const suffix = 'tbl-expediente';
  const base = validExpedienteParams(suffix);
  const cases = [
    [{ expediente_id: 'not-synthetic' }, 'expediente.id_not_synthetic'],
    [{ expediente_id: undefined }, 'expediente.id_not_synthetic'],
    [{ opened_at_utc: 'not-a-timestamp' }, 'expediente.timestamp_invalid'],
  ];
  for (const [override, expectedReason] of cases) {
    const vertical = createAgt002M2SyntheticVertical();
    advanceTo(vertical, 'expediente', suffix);
    const result = vertical.openExpediente({ ...base, ...override });
    assertDenied(vertical, 'expediente', 'EXPEDIENTE', result, expectedReason);
  }
});

test('table: workset validation denies each malformed field with its exact reason code', () => {
  const suffix = 'tbl-workset';
  const base = validWorksetParams(suffix);
  const cases = [
    [{ workset_id: 'not-synthetic' }, 'workset.id_not_synthetic'],
    [{ workset_id: undefined }, 'workset.id_not_synthetic'],
    [{ opened_at_utc: 'not-a-timestamp' }, 'workset.timestamp_invalid'],
  ];
  for (const [override, expectedReason] of cases) {
    const vertical = createAgt002M2SyntheticVertical();
    advanceTo(vertical, 'workset', suffix);
    const result = vertical.openWorkset({ ...base, ...override });
    assertDenied(vertical, 'workset', 'WORKSET', result, expectedReason);
  }
});

test('table: analysis validation denies each malformed field with its exact reason code', () => {
  const suffix = 'tbl-analysis';
  const base = validAnalysisParams(suffix, { available: true });
  const cases = [
    [{ analysis_id: 'not-synthetic' }, 'analysis.id_not_synthetic'],
    [{ analysis_id: undefined }, 'analysis.id_not_synthetic'],
    [{ available: 'yes' }, 'analysis.available_not_boolean'],
    [{ available: undefined }, 'analysis.available_not_boolean'],
    [{ recorded_at_utc: 'not-a-timestamp' }, 'analysis.timestamp_invalid'],
    [{ findings_hash: 'not-a-hash' }, 'analysis.findings_hash_invalid'],
    [{ findings_hash: undefined }, 'analysis.findings_hash_invalid'],
    [{ available: false, findings_hash: hex64('leftover') }, 'analysis.findings_hash_must_be_absent'],
  ];
  for (const [override, expectedReason] of cases) {
    const vertical = createAgt002M2SyntheticVertical();
    advanceTo(vertical, 'analysis', suffix);
    const result = vertical.recordAnalysis({ ...base, ...override });
    assertDenied(vertical, 'analysis', 'ANALYSIS', result, expectedReason);
  }
});

test('table: recommendation validation denies each malformed field with its exact reason code', () => {
  const suffix = 'tbl-recommendation';
  const base = validRecommendationParams(suffix, { taxonomy: 'favorable' });
  const cases = [
    [{ recommendation_id: 'not-synthetic' }, 'recommendation.id_not_synthetic'],
    [{ recommendation_id: undefined }, 'recommendation.id_not_synthetic'],
    [{ taxonomy: 'unknown_taxonomy' }, 'recommendation.taxonomy_invalid'],
    [{ taxonomy: undefined }, 'recommendation.taxonomy_invalid'],
    [{ produced_at_utc: 'not-a-timestamp' }, 'recommendation.timestamp_invalid'],
  ];
  for (const [override, expectedReason] of cases) {
    const vertical = createAgt002M2SyntheticVertical();
    advanceTo(vertical, 'recommendation', suffix);
    const result = vertical.buildRecommendation({ ...base, ...override });
    assertDenied(vertical, 'recommendation', 'RECOMMENDATION', result, expectedReason);
  }
});

test('table: decision field validation denies each malformed field with its exact reason code, past the identity gate', () => {
  const suffix = 'tbl-decision';
  const actor = humanActor(`synthetic-actor-${suffix}`);
  const base = validDecisionParams(suffix, actor);
  const cases = [
    [{ decision_id: 'not-synthetic' }, 'decision.id_not_synthetic'],
    [{ decision_id: undefined }, 'decision.id_not_synthetic'],
    [{ verdict: 'MAYBE' }, 'decision.verdict_invalid'],
    [{ verdict: undefined }, 'decision.verdict_invalid'],
    [{ decided_at_utc: 'not-a-timestamp' }, 'decision.timestamp_invalid'],
  ];
  for (const [override, expectedReason] of cases) {
    const vertical = createAgt002M2SyntheticVertical();
    advanceTo(vertical, 'decision', suffix);
    const result = vertical.decide({ ...base, ...override });
    assertDenied(vertical, 'decision', 'DECISION', result, expectedReason);
  }
});

// --- Table-driven: out-of-order phase transitions are always denied, never partially applied ----

test('table: an out-of-order phase transition is denied fail-closed at every phase, and prior state is untouched', () => {
  const cases = [
    {
      label: 'conversion before source',
      run: (vertical) => vertical.convertSource(validConversionParams('oo-conversion')),
      phase: 'conversion', phaseLabel: 'CONVERSION',
    },
    {
      label: 'expediente before conversion',
      run: (vertical) => vertical.openExpediente(validExpedienteParams('oo-expediente')),
      phase: 'expediente', phaseLabel: 'EXPEDIENTE',
    },
    {
      label: 'workset before expediente',
      run: (vertical) => vertical.openWorkset(validWorksetParams('oo-workset')),
      phase: 'workset', phaseLabel: 'WORKSET',
    },
    {
      label: 'analysis before workset',
      run: (vertical) => vertical.recordAnalysis(validAnalysisParams('oo-analysis')),
      phase: 'analysis', phaseLabel: 'ANALYSIS',
    },
    {
      label: 'recommendation before analysis',
      run: (vertical) => vertical.buildRecommendation(validRecommendationParams('oo-recommendation')),
      phase: 'recommendation', phaseLabel: 'RECOMMENDATION',
    },
    {
      label: 'decision before recommendation',
      run: (vertical) => vertical.decide(validDecisionParams('oo-decision', humanActor('synthetic-actor-oo-decision'))),
      phase: 'decision', phaseLabel: 'DECISION',
    },
  ];

  for (const { label, run, phase, phaseLabel } of cases) {
    const vertical = createAgt002M2SyntheticVertical();
    const result = run(vertical);
    assertDenied(vertical, phase, phaseLabel, result, 'phase_transition.out_of_order');
    assert.equal(vertical.getChain()[phase], null, label);
  }

  // Re-running an already-completed phase is equally out of order, at both the first phase and
  // a later one. Unlike the never-reached cases above, the phase's record already exists here —
  // denial must leave that original record untouched, not null it out.
  const suffix = 'oo-repeat';
  const repeatVertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(repeatVertical, { suffix });
  const originalSource = repeatVertical.getChain().source;
  const repeatSource = repeatVertical.recordSource(validSourceParams(suffix));
  assert.equal(repeatSource.status, 'DENIED');
  assert.equal(repeatSource.reason, 'phase_transition.out_of_order');
  assert.deepEqual(repeatVertical.getChain().source, originalSource, 'the original source record must survive the repeat attempt');

  const originalRecommendation = repeatVertical.getChain().recommendation;
  const repeatRecommendation = repeatVertical.buildRecommendation(validRecommendationParams(suffix));
  assert.equal(repeatRecommendation.status, 'DENIED');
  assert.equal(repeatRecommendation.reason, 'phase_transition.out_of_order');
  assert.deepEqual(repeatVertical.getChain().recommendation, originalRecommendation);

  const decisionActor = humanActor(`synthetic-actor-${suffix}`);
  const firstDecision = repeatVertical.decide(validDecisionParams(suffix, decisionActor));
  assert.equal(firstDecision.status, 'GO');
  const repeatDecision = repeatVertical.decide(validDecisionParams(suffix, decisionActor));
  assert.equal(repeatDecision.status, 'DENIED');
  assert.equal(repeatDecision.reason, 'phase_transition.out_of_order');
});

// --- Negative: invalid human identity ------------------------------------------------------------

test('negative: an invalid human identity at the GO/NO-GO gate is denied fail-closed and audited, for every malformed actor shape', () => {
  const invalidActors = [
    [undefined, 'identity.actor_missing'],
    [{ principal_kind: 'system', principal_id: 'synthetic-actor-x', durable_ref: { locator: 'fixture://x' } }, 'identity.principal_kind_not_person'],
    [{ principal_kind: 'person', durable_ref: { locator: 'fixture://x' } }, 'identity.principal_id_missing'],
    [{ principal_kind: 'person', principal_id: 'gerencia', durable_ref: { locator: 'fixture://x' } }, 'identity.principal_id_is_role'],
    [{ principal_kind: 'person', principal_id: 'synthetic-actor-x' }, 'identity.durable_ref_missing'],
    [
      { principal_kind: 'person', principal_id: 'synthetic-actor-x', durable_ref: { locator: 'https://not-isolated.example/x' } },
      'identity.durable_ref_locator_not_isolated',
    ],
  ];

  for (const [actor, expectedReason] of invalidActors) {
    const vertical = createAgt002M2SyntheticVertical();
    const suffix = `identity-${expectedReason.replace(/\./g, '-')}`;
    buildThroughRecommendation(vertical, { suffix });
    const decision = vertical.decide({
      sentinel: SENTINEL,
      decision_id: `synthetic-decision-${suffix}`,
      actor,
      verdict: 'GO',
      decided_at_utc: '2026-09-01T10:30:00Z',
    });
    assert.equal(decision.status, 'DENIED', expectedReason);
    assert.equal(decision.reason, expectedReason);
    assert.equal(vertical.getChain().decision, null, expectedReason);

    const auditEntry = vertical.getAuditLog().at(-1);
    assert.equal(auditEntry.status, 'DENIED');
    assert.equal(auditEntry.reason, expectedReason);
    assert.equal(auditEntry.phase, 'DECISION');
  }
});

// --- Negative: pending/ambiguous taxonomy abstains -------------------------------------------

test('negative: pending/ambiguous taxonomy makes the vertical abstain rather than deciding, for both taxonomies', () => {
  for (const taxonomy of ['pending', 'ambiguous']) {
    const vertical = createAgt002M2SyntheticVertical();
    buildThroughRecommendation(vertical, { taxonomy, suffix: `abstain-${taxonomy}` });
    const decision = vertical.decide({
      sentinel: SENTINEL,
      decision_id: `synthetic-decision-abstain-${taxonomy}`,
      actor: humanActor(`synthetic-actor-abstain-${taxonomy}`),
      verdict: 'GO',
      decided_at_utc: '2026-09-01T10:30:00Z',
    });
    assert.equal(decision.status, 'ABSTAINED');
    assert.equal(decision.reason, 'decision.abstained');
    assert.equal(vertical.getChain().decision, null, `${taxonomy} must not produce a decision record`);
    assert.equal(vertical.getChain().post_go, null);

    const auditEntry = vertical.getAuditLog().at(-1);
    assert.equal(auditEntry.status, 'ABSTAINED');
    assert.equal(auditEntry.reason, 'decision.abstained');
  }
});

// --- Negative: unavailable-analysis GO requires a well-formed attestation ----------------------

test('negative: a GO on unavailable analysis is denied for every malformed attestation, and only an exact, valid attestation succeeds', () => {
  const vertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(vertical, { analysisAvailable: false, taxonomy: 'favorable', suffix: 'attest-1' });
  const actor = humanActor('synthetic-actor-attest-1');
  const analysisId = 'synthetic-analysis-attest-1';
  const otherActor = humanActor('synthetic-actor-attest-1-other');
  const validAttestation = {
    missing_analysis_id: analysisId,
    reason: { code: 'deadline_pressure', detail: 'timeline requires a decision now' },
    attested_by: actor,
    attested_at_utc: '2026-09-01T10:29:00Z',
    statement: `decido sin el análisis ${analysisId}`,
  };

  const cases = [
    [undefined, 'attestation.missing'],
    [{ ...validAttestation, missing_analysis_id: 'synthetic-analysis-other' }, 'attestation.missing_analysis_id_mismatch'],
    [{ ...validAttestation, reason: undefined }, 'attestation.reason_missing'],
    [{ ...validAttestation, reason: 'timeline requires a decision now' }, 'attestation.reason_missing'],
    [{ ...validAttestation, reason: { code: '', detail: 'timeline requires a decision now' } }, 'attestation.reason_invalid'],
    [{ ...validAttestation, reason: { code: 'deadline_pressure', detail: '' } }, 'attestation.reason_invalid'],
    [{ ...validAttestation, reason: { code: 'deadline_pressure' } }, 'attestation.reason_invalid'],
    [
      { ...validAttestation, attested_by: { principal_kind: 'system', principal_id: 'x', durable_ref: { locator: 'fixture://x' } } },
      'attestation.actor_invalid',
    ],
    // The attester (otherActor) is a validly-shaped human identity, just not the deciding actor.
    [{ ...validAttestation, attested_by: otherActor }, 'attestation.actor_mismatch'],
    [{ ...validAttestation, attested_at_utc: 'not-a-timestamp' }, 'attestation.timestamp_invalid'],
    [{ ...validAttestation, statement: 'decido sin el análisis synthetic-analysis-other' }, 'attestation.statement_mismatch'],
  ];

  for (const [attestation, expectedReason] of cases) {
    const decision = vertical.decide({
      sentinel: SENTINEL,
      decision_id: 'synthetic-decision-attest-1',
      actor,
      verdict: 'GO',
      decided_at_utc: '2026-09-01T10:30:00Z',
      unavailable_analysis_attestation: attestation,
    });
    assert.equal(decision.status, 'DENIED', expectedReason);
    assert.equal(decision.reason, expectedReason);
    assert.equal(vertical.getChain().decision, null, expectedReason);
  }

  assert.equal(vertical.getChain().analysis.available, false, 'denied attempts must never touch analysis availability');

  const accepted = vertical.decide({
    sentinel: SENTINEL,
    decision_id: 'synthetic-decision-attest-1',
    actor,
    verdict: 'GO',
    decided_at_utc: '2026-09-01T10:30:00Z',
    unavailable_analysis_attestation: validAttestation,
  });
  assert.equal(accepted.status, 'GO');
  assert.equal(vertical.getChain().analysis.available, false, 'availability must remain false even after acceptance');
});

// --- Negative: external action is always denied ------------------------------------------------

test('negative: external action requests are always denied, before and after a GO decision', () => {
  const vertical = createAgt002M2SyntheticVertical();

  const before = vertical.requestExternalAction({
    action: 'send_procurement_bid', requested_at_utc: '2026-09-01T09:00:00Z', actor_id: 'synthetic-actor-ext-1',
  });
  assert.equal(before.status, 'DENIED');
  assert.equal(before.reason, 'external_action.always_denied');

  buildThroughRecommendation(vertical, { suffix: 'ext-1' });
  const goResult = vertical.decide({
    sentinel: SENTINEL,
    decision_id: 'synthetic-decision-ext-1',
    actor: humanActor('synthetic-actor-ext-1'),
    verdict: 'GO',
    decided_at_utc: '2026-09-01T10:30:00Z',
  });
  assert.equal(goResult.status, 'GO');

  const after = vertical.requestExternalAction({
    sentinel: SENTINEL, action: 'send_procurement_bid', requested_at_utc: '2026-09-01T10:31:00Z', actor_id: 'synthetic-actor-ext-1',
  });
  assert.equal(after.status, 'DENIED');
  assert.equal(after.reason, 'external_action.always_denied');

  const externalEntries = vertical.getAuditLog().filter((entry) => entry.phase === 'EXTERNAL_ACTION');
  assert.equal(externalEntries.length, 2);
  assert.ok(externalEntries.every((entry) => entry.status === 'DENIED'));
});

// --- Negative: unapproved learning cannot alter methodology ------------------------------------

test('negative: unapproved or improperly approved learning cannot alter methodology; only approved learning by a valid human can', () => {
  const vertical = createAgt002M2SyntheticVertical();
  const before = vertical.getMethodology();

  const deniedUnapproved = vertical.submitLearning({
    sentinel: SENTINEL,
    approved: false,
    approver: humanActor('synthetic-actor-learn-1'),
    methodology_patch: { add_rules: ['skip_expediente'] },
  });
  assert.equal(deniedUnapproved.status, 'DENIED');
  assert.equal(deniedUnapproved.reason, 'learning.not_approved');
  assert.deepEqual(vertical.getMethodology(), before);

  const deniedBadApprover = vertical.submitLearning({
    sentinel: SENTINEL,
    approved: true,
    approver: { principal_kind: 'system', principal_id: 'synthetic-actor-learn-2', durable_ref: { locator: 'fixture://x' } },
    methodology_patch: { add_rules: ['skip_expediente'] },
  });
  assert.equal(deniedBadApprover.status, 'DENIED');
  assert.equal(deniedBadApprover.reason, 'learning.approver_invalid');
  assert.deepEqual(vertical.getMethodology(), before);

  const approved = vertical.submitLearning({
    sentinel: SENTINEL,
    approved: true,
    approver: humanActor('synthetic-actor-learn-3'),
    methodology_patch: { add_rules: ['additional_synthetic_rule'] },
  });
  assert.equal(approved.status, 'APPLIED');
  assert.notDeepEqual(vertical.getMethodology(), before);
  assert.ok(vertical.getMethodology().rules.includes('additional_synthetic_rule'));
});

// --- Teardown ------------------------------------------------------------------------------------

test('teardown removes only the isolated chain records, preserves the audit trail, and blocks further mutation', () => {
  const vertical = createAgt002M2SyntheticVertical();
  buildThroughRecommendation(vertical, { suffix: 'teardown-1' });
  const goResult = vertical.decide({
    sentinel: SENTINEL,
    decision_id: 'synthetic-decision-teardown-1',
    actor: humanActor('synthetic-actor-teardown-1'),
    verdict: 'GO',
    decided_at_utc: '2026-09-01T10:30:00Z',
  });
  assert.equal(goResult.status, 'GO');

  const chainBefore = vertical.getChain();
  assert.ok(Object.values(chainBefore).every((record) => record !== null));
  const auditBefore = vertical.getAuditLog();
  assert.ok(auditBefore.length > 0);

  const teardownResult = vertical.teardown({ torn_down_at_utc: '2026-09-01T11:00:00Z' });
  assert.equal(teardownResult.status, 'TORN_DOWN');
  assert.equal(teardownResult.already_torn_down, false);

  const chainAfter = vertical.getChain();
  for (const [phase, record] of Object.entries(chainAfter)) assert.equal(record, null, `${phase} must be cleared`);

  const auditAfter = vertical.getAuditLog();
  assert.deepEqual(auditAfter.slice(0, auditBefore.length), auditBefore, 'the audit trail must survive teardown untouched');
  assert.ok(auditAfter.length > auditBefore.length, 'teardown itself must be audited');
  assert.equal(auditAfter.at(-1).action, 'teardown');

  const deniedAfterTeardown = vertical.recordSource({
    sentinel: SENTINEL,
    source_id: 'synthetic-source-teardown-2',
    locator: 'fixture://agt002-m2/sources/teardown-2.json',
    content_sha256: hex64('teardown-2'),
    captured_at_utc: '2026-09-01T11:01:00Z',
  });
  assert.equal(deniedAfterTeardown.status, 'DENIED');
  assert.equal(deniedAfterTeardown.reason, 'instance.torn_down');

  const secondTeardown = vertical.teardown();
  assert.equal(secondTeardown.already_torn_down, true);
});

// --- Static isolation: the module itself stays isolated -----------------------------------------

test('module source is static-clean: only node:crypto is imported, no wall-clock, no IO/network/SQL/runtime-wiring or forbidden-scope keywords', () => {
  const source = readFileSync(MODULE_PATH, 'utf8');

  const importSpecifiers = [...source.matchAll(/^\s*import\s+.*?\sfrom\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(importSpecifiers, ['node:crypto']);

  const FORBIDDEN_PATTERNS = [
    [/\bDate\.now\s*\(/, 'Date.now('],
    [/new\s+Date\s*\(/, 'new Date('],
    [/\bMath\.random\s*\(/, 'Math.random('],
    [/\bfetch\s*\(/i, 'fetch('],
    [/\bprocess\.env/, 'process.env'],
    [/\brequire\s*\(/, 'require('],
    [/\bsupabase\b/i, 'supabase'],
    [/\bsql\b/i, 'sql'],
    [/\bDANE\b/, 'DANE'],
    [/\bSIIO\b/i, 'SIIO'],
    [/AGT-003|AGT003/, 'AGT-003'],
    [/\bmigration\b/i, 'migration'],
    [/readFileSync|writeFileSync|readdirSync/, 'filesystem access'],
    [/\bnode:fs\b|\bnode:net\b|\bnode:http\b|\bnode:https\b/, 'IO/network module'],
  ];
  for (const [re, label] of FORBIDDEN_PATTERNS) {
    assert.equal(re.test(source), false, `module must not reference "${label}"`);
  }
});
