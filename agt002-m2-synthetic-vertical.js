// AGT-002 F3/M2: isolated in-memory synthetic vertical slice
// (source -> conversion -> expediente -> workset -> analysis -> recommendation -> human GO/NO-GO).
//
// Pure, fail-closed, self-contained: no imports from the rest of the repo, no filesystem, no
// network, no relational database, no wall-clock reads of any kind. Every record is stamped with a
// fixed isolated environment tag and every id must carry the "synthetic-" prefix over a
// "fixture://" locator, so nothing produced here can ever be mistaken for a real case. Every
// phase transition is gated by AGT002_M2_PHASE_TRANSITION_SENTINEL and every human decision is
// gated by a validated person identity; both gates deny closed and write an audit entry on
// denial. An unavailable-analysis attestation is only honored when its attester is the exact
// deciding actor (principal_id, principal_kind, and durable_ref locator all equal) and its reason
// is a structured { code, detail } object, not a free-form string. This module never performs an
// external action, regardless of state.

import { createHash } from 'node:crypto';

export const AGT002_M2_PHASE_TRANSITION_SENTINEL = 'agt002-m2-phase-transition/1.0.0';
export const AGT002_M2_ENVIRONMENT = 'isolated_fixture';

export const AGT002_M2_TAXONOMIES = Object.freeze(['favorable', 'unfavorable', 'pending', 'ambiguous']);
const AGT002_M2_ABSTAIN_TAXONOMIES = new Set(['pending', 'ambiguous']);

// Same closed-catalog convention as the rest of AGT-002's fail-closed modules: role ids are not
// people, and a principal without a durable, isolated locator is never treated as human.
const AGT002_M2_ROLE_PRINCIPAL_IDS = Object.freeze([
  'admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta',
]);

export const AGT002_M2_REASON_CODES = Object.freeze([
  'phase_transition.sentinel_invalid',
  'phase_transition.out_of_order',
  'instance.torn_down',
  'source.not_synthetic',
  'source.locator_not_isolated',
  'source.content_hash_invalid',
  'source.timestamp_invalid',
  'conversion.id_not_synthetic',
  'conversion.target_kind_missing',
  'conversion.timestamp_invalid',
  'expediente.id_not_synthetic',
  'expediente.timestamp_invalid',
  'workset.id_not_synthetic',
  'workset.timestamp_invalid',
  'analysis.id_not_synthetic',
  'analysis.available_not_boolean',
  'analysis.timestamp_invalid',
  'analysis.findings_hash_invalid',
  'analysis.findings_hash_must_be_absent',
  'recommendation.id_not_synthetic',
  'recommendation.taxonomy_invalid',
  'recommendation.timestamp_invalid',
  'decision.id_not_synthetic',
  'decision.verdict_invalid',
  'decision.timestamp_invalid',
  'decision.abstained',
  'identity.actor_missing',
  'identity.principal_kind_not_person',
  'identity.principal_id_missing',
  'identity.principal_id_is_role',
  'identity.durable_ref_missing',
  'identity.durable_ref_locator_not_isolated',
  'attestation.missing',
  'attestation.missing_analysis_id_mismatch',
  'attestation.reason_missing',
  'attestation.reason_invalid',
  'attestation.actor_invalid',
  'attestation.actor_mismatch',
  'attestation.timestamp_invalid',
  'attestation.statement_mismatch',
  'attestation.availability_inconsistent',
  'external_action.always_denied',
  'learning.not_approved',
  'learning.approver_invalid',
]);

const SYNTHETIC_PREFIX = 'synthetic-';
const FIXTURE_LOCATOR_RE = /^fixture:\/\//;
const HASH64_RE = /^[0-9a-f]{64}$/;
const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const PHASE_ORDER = Object.freeze([
  'source', 'conversion', 'expediente', 'workset', 'analysis', 'recommendation', 'decision', 'post_go',
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSyntheticId(value) {
  return typeof value === 'string' && value.startsWith(SYNTHETIC_PREFIX) && value.length > SYNTHETIC_PREFIX.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

function hashOf(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function withRecordHash(record) {
  return Object.freeze({ ...record, record_hash: hashOf(record) });
}

// Public, pure reconstruction primitive: recomputes the hash a stored record *should* carry from
// its own fields (everything except record_hash), so a caller can verify the chain was not
// tampered with, independent of this module's internal state.
export function recomputeAgt002M2RecordHash(record) {
  if (!isPlainObject(record)) return null;
  const { record_hash, ...rest } = record;
  return hashOf(rest);
}

// Public, pure reconstruction check: validates the exact exported chain shape, then walks records in
// fixed phase order. A not-yet-reached suffix may be null, but the chain must remain contiguous;
// malformed records, metadata drift, unknown slots, hash/linkage drift, and post-GO after NO-GO
// all fail closed with deterministic reason codes.
export function verifyAgt002M2ChainIntegrity(chain) {
  if (!isPlainObject(chain)) {
    return Object.freeze({ verdict: 'INVALID', reasons: Object.freeze(['chain.shape_invalid']) });
  }

  const reasons = [];
  const knownPhases = new Set(PHASE_ORDER);
  for (const phase of Object.keys(chain).filter((key) => !knownPhases.has(key)).sort()) {
    reasons.push(`chain.unknown_phase.${phase}`);
  }

  let previousHash = null;
  let sawAbsentPhase = false;
  for (const phase of PHASE_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(chain, phase)) {
      reasons.push(`chain.${phase}.missing_slot`);
      sawAbsentPhase = true;
      continue;
    }

    const record = chain[phase];
    if (record === null) {
      sawAbsentPhase = true;
      continue;
    }
    if (sawAbsentPhase) reasons.push(`chain.${phase}.gap_before_phase`);
    if (!isPlainObject(record)) {
      reasons.push(`chain.${phase}.record_invalid`);
      continue;
    }

    const expectedPhase = phase.toUpperCase();
    if (record.phase !== expectedPhase) reasons.push(`chain.${phase}.phase_mismatch`);
    if (record.environment !== AGT002_M2_ENVIRONMENT) reasons.push(`chain.${phase}.environment_mismatch`);

    if (phase === 'source') {
      if (record.previous_hash !== null) reasons.push(`chain.${phase}.previous_hash_invalid`);
    } else if (!HASH64_RE.test(record.previous_hash)) {
      reasons.push(`chain.${phase}.previous_hash_invalid`);
    }
    if (record.previous_hash !== previousHash) reasons.push(`chain.${phase}.previous_hash_mismatch`);

    if (!HASH64_RE.test(record.record_hash)) {
      reasons.push(`chain.${phase}.record_hash_invalid`);
    } else if (recomputeAgt002M2RecordHash(record) !== record.record_hash) {
      reasons.push(`chain.${phase}.record_hash_mismatch`);
    }
    previousHash = record.record_hash;
  }

  if (
    isPlainObject(chain.decision)
    && chain.decision.verdict === 'NO-GO'
    && chain.post_go !== null
    && chain.post_go !== undefined
  ) {
    reasons.push('chain.post_go.forbidden_after_no_go');
  }

  return Object.freeze({ verdict: reasons.length === 0 ? 'VALID' : 'INVALID', reasons: Object.freeze(reasons) });
}

function validateHumanIdentity(actor) {
  if (!isPlainObject(actor)) return { valid: false, reason: 'identity.actor_missing' };
  if (actor.principal_kind !== 'person') return { valid: false, reason: 'identity.principal_kind_not_person' };
  if (typeof actor.principal_id !== 'string' || actor.principal_id.length === 0) {
    return { valid: false, reason: 'identity.principal_id_missing' };
  }
  if (AGT002_M2_ROLE_PRINCIPAL_IDS.includes(actor.principal_id)) {
    return { valid: false, reason: 'identity.principal_id_is_role' };
  }
  const durableRef = actor.durable_ref;
  if (!isPlainObject(durableRef) || typeof durableRef.locator !== 'string' || durableRef.locator.length === 0) {
    return { valid: false, reason: 'identity.durable_ref_missing' };
  }
  if (!FIXTURE_LOCATOR_RE.test(durableRef.locator)) {
    return { valid: false, reason: 'identity.durable_ref_locator_not_isolated' };
  }
  return { valid: true, reason: null };
}

function freezeActor(actor) {
  return Object.freeze({
    principal_id: actor.principal_id,
    principal_kind: actor.principal_kind,
    durable_ref: Object.freeze({ ...actor.durable_ref }),
  });
}

// The deciding actor and the attestation's attester must be the exact same person: equal
// principal_id, principal_kind, and durable_ref locator. Both sides are already validated human
// identities by the time this runs, so a plain field comparison is sufficient here.
function actorsExactMatch(a, b) {
  return a.principal_id === b.principal_id
    && a.principal_kind === b.principal_kind
    && a.durable_ref.locator === b.durable_ref.locator;
}

function validateUnavailableAnalysisAttestation(attestation, missingAnalysisId, decidingActor) {
  if (!isPlainObject(attestation)) return { valid: false, reason: 'attestation.missing' };
  if (attestation.missing_analysis_id !== missingAnalysisId) {
    return { valid: false, reason: 'attestation.missing_analysis_id_mismatch' };
  }
  if (!isPlainObject(attestation.reason)) {
    return { valid: false, reason: 'attestation.reason_missing' };
  }
  if (
    typeof attestation.reason.code !== 'string' || attestation.reason.code.length === 0
    || typeof attestation.reason.detail !== 'string' || attestation.reason.detail.length === 0
  ) {
    return { valid: false, reason: 'attestation.reason_invalid' };
  }
  if (!validateHumanIdentity(attestation.attested_by).valid) {
    return { valid: false, reason: 'attestation.actor_invalid' };
  }
  if (!actorsExactMatch(attestation.attested_by, decidingActor)) {
    return { valid: false, reason: 'attestation.actor_mismatch' };
  }
  if (!RFC3339_UTC_RE.test(attestation.attested_at_utc)) {
    return { valid: false, reason: 'attestation.timestamp_invalid' };
  }
  const expectedStatement = `decido sin el análisis ${missingAnalysisId}`;
  if (attestation.statement !== expectedStatement) {
    return { valid: false, reason: 'attestation.statement_mismatch' };
  }
  return {
    valid: true,
    reason: null,
    attestation: Object.freeze({
      missing_analysis_id: attestation.missing_analysis_id,
      reason: Object.freeze({ code: attestation.reason.code, detail: attestation.reason.detail }),
      attested_by: freezeActor(attestation.attested_by),
      attested_at_utc: attestation.attested_at_utc,
      statement: attestation.statement,
    }),
  };
}

export function createAgt002M2SyntheticVertical() {
  const records = {
    source: null, conversion: null, expediente: null, workset: null,
    analysis: null, recommendation: null, decision: null, post_go: null,
  };
  const auditLog = [];
  let auditCounter = 0;
  let methodology = Object.freeze({ version: 1, rules: Object.freeze(['baseline']) });
  let tornDown = false;

  function audit({ phase, action, status, reason, actor_principal_id, at_utc }) {
    auditCounter += 1;
    auditLog.push(Object.freeze({
      audit_id: `synthetic-audit-${auditCounter}`,
      phase,
      action,
      status,
      reason: reason ?? null,
      actor_principal_id: actor_principal_id ?? null,
      at_utc: at_utc ?? null,
    }));
  }

  function deny(phase, action, reason, actorPrincipalId = null) {
    audit({ phase, action, status: 'DENIED', reason, actor_principal_id: actorPrincipalId, at_utc: null });
    return { status: 'DENIED', reason, record: null };
  }

  function abstain(phase, action, reason, actorPrincipalId = null) {
    audit({ phase, action, status: 'ABSTAINED', reason, actor_principal_id: actorPrincipalId, at_utc: null });
    return { status: 'ABSTAINED', reason, record: null };
  }

  function guardCommon(phase, action, sentinel, requiredPrior, ownField) {
    if (tornDown) return deny(phase, action, 'instance.torn_down');
    if (sentinel !== AGT002_M2_PHASE_TRANSITION_SENTINEL) return deny(phase, action, 'phase_transition.sentinel_invalid');
    if (requiredPrior !== null && records[requiredPrior] === null) return deny(phase, action, 'phase_transition.out_of_order');
    if (records[ownField] !== null) return deny(phase, action, 'phase_transition.out_of_order');
    return null;
  }

  function recordSource({ sentinel, source_id, locator, content_sha256, captured_at_utc, actor_id } = {}) {
    const blocked = guardCommon('SOURCE', 'record_source', sentinel, null, 'source');
    if (blocked) return blocked;
    if (!isSyntheticId(source_id)) return deny('SOURCE', 'record_source', 'source.not_synthetic');
    if (typeof locator !== 'string' || !FIXTURE_LOCATOR_RE.test(locator)) {
      return deny('SOURCE', 'record_source', 'source.locator_not_isolated');
    }
    if (!HASH64_RE.test(content_sha256)) return deny('SOURCE', 'record_source', 'source.content_hash_invalid');
    if (!RFC3339_UTC_RE.test(captured_at_utc)) return deny('SOURCE', 'record_source', 'source.timestamp_invalid');

    const record = withRecordHash({
      phase: 'SOURCE', environment: AGT002_M2_ENVIRONMENT, source_id, locator, content_sha256,
      captured_at_utc, actor_id: actor_id ?? null, previous_hash: null,
    });
    records.source = record;
    audit({ phase: 'SOURCE', action: 'record_source', status: 'ALLOWED', reason: null, actor_principal_id: actor_id ?? null, at_utc: captured_at_utc });
    return { status: 'RECORDED', reason: null, record };
  }

  function convertSource({ sentinel, conversion_id, target_kind, converted_at_utc, actor_id } = {}) {
    const blocked = guardCommon('CONVERSION', 'convert_source', sentinel, 'source', 'conversion');
    if (blocked) return blocked;
    if (!isSyntheticId(conversion_id)) return deny('CONVERSION', 'convert_source', 'conversion.id_not_synthetic');
    if (typeof target_kind !== 'string' || target_kind.length === 0) {
      return deny('CONVERSION', 'convert_source', 'conversion.target_kind_missing');
    }
    if (!RFC3339_UTC_RE.test(converted_at_utc)) return deny('CONVERSION', 'convert_source', 'conversion.timestamp_invalid');

    const record = withRecordHash({
      phase: 'CONVERSION', environment: AGT002_M2_ENVIRONMENT, conversion_id, source_id: records.source.source_id,
      target_kind, converted_at_utc, actor_id: actor_id ?? null, previous_hash: records.source.record_hash,
    });
    records.conversion = record;
    audit({ phase: 'CONVERSION', action: 'convert_source', status: 'ALLOWED', reason: null, actor_principal_id: actor_id ?? null, at_utc: converted_at_utc });
    return { status: 'RECORDED', reason: null, record };
  }

  function openExpediente({ sentinel, expediente_id, opened_at_utc, actor_id } = {}) {
    const blocked = guardCommon('EXPEDIENTE', 'open_expediente', sentinel, 'conversion', 'expediente');
    if (blocked) return blocked;
    if (!isSyntheticId(expediente_id)) return deny('EXPEDIENTE', 'open_expediente', 'expediente.id_not_synthetic');
    if (!RFC3339_UTC_RE.test(opened_at_utc)) return deny('EXPEDIENTE', 'open_expediente', 'expediente.timestamp_invalid');

    const record = withRecordHash({
      phase: 'EXPEDIENTE', environment: AGT002_M2_ENVIRONMENT, expediente_id, conversion_id: records.conversion.conversion_id,
      opened_at_utc, actor_id: actor_id ?? null, previous_hash: records.conversion.record_hash,
    });
    records.expediente = record;
    audit({ phase: 'EXPEDIENTE', action: 'open_expediente', status: 'ALLOWED', reason: null, actor_principal_id: actor_id ?? null, at_utc: opened_at_utc });
    return { status: 'RECORDED', reason: null, record };
  }

  function openWorkset({ sentinel, workset_id, opened_at_utc, actor_id } = {}) {
    const blocked = guardCommon('WORKSET', 'open_workset', sentinel, 'expediente', 'workset');
    if (blocked) return blocked;
    if (!isSyntheticId(workset_id)) return deny('WORKSET', 'open_workset', 'workset.id_not_synthetic');
    if (!RFC3339_UTC_RE.test(opened_at_utc)) return deny('WORKSET', 'open_workset', 'workset.timestamp_invalid');

    const record = withRecordHash({
      phase: 'WORKSET', environment: AGT002_M2_ENVIRONMENT, workset_id, expediente_id: records.expediente.expediente_id,
      opened_at_utc, actor_id: actor_id ?? null, previous_hash: records.expediente.record_hash,
    });
    records.workset = record;
    audit({ phase: 'WORKSET', action: 'open_workset', status: 'ALLOWED', reason: null, actor_principal_id: actor_id ?? null, at_utc: opened_at_utc });
    return { status: 'RECORDED', reason: null, record };
  }

  function recordAnalysis({ sentinel, analysis_id, available, findings_hash, recorded_at_utc, unavailability_reason, actor_id } = {}) {
    const blocked = guardCommon('ANALYSIS', 'record_analysis', sentinel, 'workset', 'analysis');
    if (blocked) return blocked;
    if (!isSyntheticId(analysis_id)) return deny('ANALYSIS', 'record_analysis', 'analysis.id_not_synthetic');
    if (typeof available !== 'boolean') return deny('ANALYSIS', 'record_analysis', 'analysis.available_not_boolean');
    if (!RFC3339_UTC_RE.test(recorded_at_utc)) return deny('ANALYSIS', 'record_analysis', 'analysis.timestamp_invalid');
    if (available) {
      if (!HASH64_RE.test(findings_hash)) return deny('ANALYSIS', 'record_analysis', 'analysis.findings_hash_invalid');
    } else if (findings_hash !== undefined && findings_hash !== null) {
      return deny('ANALYSIS', 'record_analysis', 'analysis.findings_hash_must_be_absent');
    }

    const record = withRecordHash({
      phase: 'ANALYSIS', environment: AGT002_M2_ENVIRONMENT, analysis_id, available,
      findings_hash: available ? findings_hash : null,
      unavailability_reason: available ? null : (unavailability_reason ?? null),
      recorded_at_utc, actor_id: actor_id ?? null, previous_hash: records.workset.record_hash,
    });
    records.analysis = record;
    audit({ phase: 'ANALYSIS', action: 'record_analysis', status: 'ALLOWED', reason: null, actor_principal_id: actor_id ?? null, at_utc: recorded_at_utc });
    return { status: 'RECORDED', reason: null, record };
  }

  function buildRecommendation({ sentinel, recommendation_id, taxonomy, rationale, produced_at_utc, actor_id } = {}) {
    const blocked = guardCommon('RECOMMENDATION', 'build_recommendation', sentinel, 'analysis', 'recommendation');
    if (blocked) return blocked;
    if (!isSyntheticId(recommendation_id)) return deny('RECOMMENDATION', 'build_recommendation', 'recommendation.id_not_synthetic');
    if (!AGT002_M2_TAXONOMIES.includes(taxonomy)) return deny('RECOMMENDATION', 'build_recommendation', 'recommendation.taxonomy_invalid');
    if (!RFC3339_UTC_RE.test(produced_at_utc)) return deny('RECOMMENDATION', 'build_recommendation', 'recommendation.timestamp_invalid');

    const taxonomyVerdict = AGT002_M2_ABSTAIN_TAXONOMIES.has(taxonomy) ? 'ABSTAIN' : 'DECIDABLE';
    const record = withRecordHash({
      phase: 'RECOMMENDATION', environment: AGT002_M2_ENVIRONMENT, recommendation_id, taxonomy, taxonomy_verdict: taxonomyVerdict,
      rationale: rationale ?? null, produced_at_utc, actor_id: actor_id ?? null, previous_hash: records.analysis.record_hash,
    });
    records.recommendation = record;
    audit({ phase: 'RECOMMENDATION', action: 'build_recommendation', status: 'ALLOWED', reason: null, actor_principal_id: actor_id ?? null, at_utc: produced_at_utc });
    return { status: 'RECORDED', reason: null, record };
  }

  function decide({ sentinel, decision_id, actor, verdict, decided_at_utc, rationale, unavailable_analysis_attestation } = {}) {
    if (tornDown) return deny('DECISION', 'decide', 'instance.torn_down');
    if (sentinel !== AGT002_M2_PHASE_TRANSITION_SENTINEL) return deny('DECISION', 'decide', 'phase_transition.sentinel_invalid');
    if (records.recommendation === null) return deny('DECISION', 'decide', 'phase_transition.out_of_order');
    if (records.decision !== null) return deny('DECISION', 'decide', 'phase_transition.out_of_order');
    if (!isSyntheticId(decision_id)) return deny('DECISION', 'decide', 'decision.id_not_synthetic');

    const identity = validateHumanIdentity(actor);
    if (!identity.valid) return deny('DECISION', 'decide', identity.reason, actor && actor.principal_id);

    // Pending/ambiguous taxonomy: the vertical abstains rather than forcing a GO/NO-GO on a
    // recommendation that was never decidable in the first place.
    if (records.recommendation.taxonomy_verdict === 'ABSTAIN') {
      return abstain('DECISION', 'decide', 'decision.abstained', actor.principal_id);
    }

    if (verdict !== 'GO' && verdict !== 'NO-GO') return deny('DECISION', 'decide', 'decision.verdict_invalid', actor.principal_id);
    if (!RFC3339_UTC_RE.test(decided_at_utc)) return deny('DECISION', 'decide', 'decision.timestamp_invalid', actor.principal_id);

    let attestationRecord = null;
    if (verdict === 'GO' && records.analysis.available === false) {
      const attestationCheck = validateUnavailableAnalysisAttestation(unavailable_analysis_attestation, records.analysis.analysis_id, actor);
      if (!attestationCheck.valid) return deny('DECISION', 'decide', attestationCheck.reason, actor.principal_id);
      // Defensive re-check: nothing in this module ever flips analysis.available after it is
      // recorded, but a GO-without-analysis attestation must never be honored against an
      // analysis that has since become available — the human explicitly decided without it.
      if (records.analysis.available !== false) {
        return deny('DECISION', 'decide', 'attestation.availability_inconsistent', actor.principal_id);
      }
      attestationRecord = attestationCheck.attestation;
    }

    const record = withRecordHash({
      phase: 'DECISION', environment: AGT002_M2_ENVIRONMENT, decision_id, actor: freezeActor(actor), verdict, decided_at_utc,
      rationale: rationale ?? null, analysis_available_at_decision: records.analysis.available,
      attested_unavailable_go: attestationRecord !== null, unavailable_analysis_attestation: attestationRecord,
      previous_hash: records.recommendation.record_hash,
    });
    records.decision = record;
    audit({ phase: 'DECISION', action: 'decide', status: 'ALLOWED', reason: null, actor_principal_id: actor.principal_id, at_utc: decided_at_utc });

    if (verdict === 'NO-GO') {
      // No further transition and no post-GO result: the chain halts here, by design.
      return { status: 'NO-GO', reason: null, record, post_go: null };
    }

    const postGo = withRecordHash({
      phase: 'POST_GO', environment: AGT002_M2_ENVIRONMENT, post_go_id: `synthetic-post-go-${decision_id}`,
      based_on_decision_id: decision_id, produced_at_utc: decided_at_utc, previous_hash: record.record_hash,
    });
    records.post_go = postGo;
    audit({ phase: 'POST_GO', action: 'produce_post_go', status: 'ALLOWED', reason: null, actor_principal_id: actor.principal_id, at_utc: decided_at_utc });
    return { status: 'GO', reason: null, record, post_go: postGo };
  }

  // Always denied, unconditionally: this synthetic vertical never performs a real-world action,
  // regardless of sentinel, phase, or decision state.
  function requestExternalAction({ action, requested_at_utc, actor_id } = {}) {
    audit({
      phase: 'EXTERNAL_ACTION', action: 'request_external_action', status: 'DENIED',
      reason: 'external_action.always_denied', actor_principal_id: actor_id ?? null, at_utc: requested_at_utc ?? null,
    });
    return { status: 'DENIED', reason: 'external_action.always_denied', record: null };
  }

  function submitLearning({ sentinel, approved, approver, methodology_patch, approved_at_utc } = {}) {
    if (tornDown) return deny('LEARNING', 'submit_learning', 'instance.torn_down');
    if (sentinel !== AGT002_M2_PHASE_TRANSITION_SENTINEL) return deny('LEARNING', 'submit_learning', 'phase_transition.sentinel_invalid');
    if (approved !== true) return deny('LEARNING', 'submit_learning', 'learning.not_approved');
    if (!validateHumanIdentity(approver).valid) return deny('LEARNING', 'submit_learning', 'learning.approver_invalid');

    const addRules = Array.isArray(methodology_patch && methodology_patch.add_rules) ? methodology_patch.add_rules : [];
    methodology = Object.freeze({ version: methodology.version + 1, rules: Object.freeze([...methodology.rules, ...addRules]) });
    audit({
      phase: 'LEARNING', action: 'submit_learning', status: 'ALLOWED', reason: null,
      actor_principal_id: approver.principal_id, at_utc: approved_at_utc ?? null,
    });
    return { status: 'APPLIED', reason: null, methodology };
  }

  function teardown({ torn_down_at_utc } = {}) {
    const alreadyTornDown = tornDown;
    for (const phase of PHASE_ORDER) records[phase] = null;
    tornDown = true;
    // The audit trail is not "chain data" — it is the compliance ledger, and it survives
    // teardown untouched. Teardown removes only this instance's isolated working records.
    audit({
      phase: 'LIFECYCLE', action: 'teardown', status: 'ALLOWED', reason: null,
      actor_principal_id: null, at_utc: torn_down_at_utc ?? null,
    });
    return { status: 'TORN_DOWN', reason: null, already_torn_down: alreadyTornDown };
  }

  function getChain() {
    return { ...records };
  }

  function getAuditLog() {
    return [...auditLog];
  }

  function getMethodology() {
    return methodology;
  }

  return Object.freeze({
    recordSource,
    convertSource,
    openExpediente,
    openWorkset,
    recordAnalysis,
    buildRecommendation,
    decide,
    requestExternalAction,
    submitLearning,
    teardown,
    getChain,
    getAuditLog,
    getMethodology,
  });
}
