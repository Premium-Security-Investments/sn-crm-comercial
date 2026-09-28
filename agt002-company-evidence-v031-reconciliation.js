// Deterministic, in-memory-only reconciliation for the AGT-002 company evidence catalogue
// at v0.3.1. Pure functions over exactly the input supplied by the caller — no DB/fs/network/
// env access, no real timestamps, no randomness.

import { createHash } from 'node:crypto';

const CATALOGUE_VERSION = '0.3.1';
const VALID_TEMPORAL_APPLICABILITY = new Set(['prospective', 'historical']);

/**
 * A required boolean semantic field is valid only when the caller supplied the literal boolean
 * `true`. Anything else (missing, `false`, a non-boolean truthy value) fails closed to `false`.
 */
function readBooleanFailClosed(value) {
  return value === true;
}

/**
 * class_definition_version fails closed to `null` unless it exactly matches the catalogue
 * version this slice reconciles against.
 */
function validateClassDefinitionVersion(value) {
  return value === CATALOGUE_VERSION ? value : null;
}

/**
 * temporal_applicability fails closed to `null` unless it is exactly one of the explicitly
 * recognized values.
 */
function validateTemporalApplicability(value) {
  return VALID_TEMPORAL_APPLICABILITY.has(value) ? value : null;
}

/**
 * The seven F2 semantic fields are computed independently of one another. catalogue_approved
 * reflects only whether the catalogue itself was approved and never implies any of the other
 * per-row validation/authorization states.
 */
function computeF2SemanticFields(row, catalogueApproved) {
  return {
    catalogue_approved: catalogueApproved === true,
    evidence_current: readBooleanFailClosed(row.evidenceCurrent),
    requirement_matched: readBooleanFailClosed(row.requirementMatched),
    human_validated: readBooleanFailClosed(row.humanValidated),
    submission_authorized: readBooleanFailClosed(row.submissionAuthorized),
    class_definition_version: validateClassDefinitionVersion(row.classDefinitionVersion),
    temporal_applicability: validateTemporalApplicability(row.temporalApplicability),
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function computeReplayFingerprint(input) {
  return createHash('sha256').update(JSON.stringify(canonicalize(input))).digest('hex');
}

/**
 * A map hash is valid only when it is an actual string with non-whitespace content. Missing,
 * null, empty, whitespace-only, or non-string values (numbers, objects, arrays, booleans) fail
 * closed.
 */
function isNonEmptyNonWhitespaceString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Approval is valid only when the catalogue is exactly v0.3.1, the human approval record
 * exists, its declared version is exactly v0.3.1, both sides carry a non-empty non-whitespace
 * mapHash string, and those map hashes are exactly equal. Never inferred from anything else
 * (e.g. entry contents).
 */
export function validateCatalogueApproval(catalogue, humanApproval) {
  if (!catalogue || typeof catalogue !== 'object') return false;
  if (catalogue.version !== CATALOGUE_VERSION) return false;
  if (!humanApproval || typeof humanApproval !== 'object') return false;
  if (humanApproval.version !== CATALOGUE_VERSION) return false;
  if (humanApproval.version !== catalogue.version) return false;
  if (!isNonEmptyNonWhitespaceString(catalogue.mapHash)) return false;
  if (!isNonEmptyNonWhitespaceString(humanApproval.mapHash)) return false;
  if (humanApproval.mapHash !== catalogue.mapHash) return false;
  return true;
}

/**
 * Throws (fails closed) unless the freeze sentinel is actually frozen, carries a token and a
 * frozenAt timestamp, and that frozenAt is strictly before the cutover timestamp.
 */
export function assertFreezeBeforeCutover(freezeSentinel, cutoverTimestamp) {
  if (!freezeSentinel || typeof freezeSentinel !== 'object') {
    throw new Error('freeze sentinel is missing');
  }
  if (freezeSentinel.frozen !== true) {
    throw new Error('freeze sentinel is not frozen');
  }
  if (typeof freezeSentinel.token !== 'string' || !freezeSentinel.token) {
    throw new Error('freeze sentinel is missing a token');
  }
  if (typeof freezeSentinel.frozenAt !== 'string' || !freezeSentinel.frozenAt) {
    throw new Error('freeze sentinel is missing a frozenAt timestamp');
  }
  if (typeof cutoverTimestamp !== 'string' || !cutoverTimestamp) {
    throw new Error('cutover timestamp is missing');
  }
  if (!(freezeSentinel.frozenAt < cutoverTimestamp)) {
    throw new Error('freeze sentinel must be set strictly before cutover');
  }
}

/**
 * Append-only, no-delete archive: returns a NEW array with the row appended, carrying its
 * own lineage and version metadata. Prior entries are never mutated or removed.
 */
export function archiveRow(row, archive, version) {
  const entry = {
    ...structuredClone(row),
    version,
    lineage: [{ rowId: row.id, version, position: archive.length }],
  };
  return [...archive, entry];
}

/**
 * A row is a taxonomy conflict when it carries two or more codes from the same mutually
 * exclusive catalogue group.
 */
export function detectDoubleTaxonomy(row, catalogue) {
  const taxonomy = Array.isArray(row.taxonomy) ? row.taxonomy : [];
  const groups = Array.isArray(catalogue?.exclusivityGroups) ? catalogue.exclusivityGroups : [];
  return groups.some((group) => group.filter((code) => taxonomy.includes(code)).length >= 2);
}

/**
 * Fail-closed risk classification shared by computeSemanticFlags and evaluateHabilitacion. Only
 * a finite number is a valid riskScore: valid finite values >= 0.9 are high risk, valid finite
 * values below 0.9 are low risk, and anything else (missing, null, NaN, +/-Infinity, string,
 * object, array, boolean) is uncertain and therefore treated as high risk.
 */
function isRiskHigh(riskScore) {
  if (typeof riskScore !== 'number' || !Number.isFinite(riskScore)) return true;
  return riskScore >= 0.9;
}

/**
 * isHighRisk and isTaxonomyConflict are computed independently — neither is derived from the
 * other's value.
 */
export function computeSemanticFlags(row, catalogue) {
  const isHighRisk = isRiskHigh(row.riskScore);
  const isTaxonomyConflict = detectDoubleTaxonomy(row, catalogue);
  return { isHighRisk, isTaxonomyConflict };
}

/**
 * A high-risk row is forced non-enabling and queued for revalidation unless an exact-matching
 * human data authorization exists for that exact row (same rowId AND same dataHash). A
 * near-matching but inexact authorization never bypasses the forced state.
 */
export function evaluateHabilitacion(row, humanDataAuthorizations = []) {
  const isHighRisk = isRiskHigh(row.riskScore);
  if (!isHighRisk) {
    return { rowId: row.id, vigente_para_habilitacion: true, queuedForRevalidation: false };
  }
  const hasExactAuthorization = humanDataAuthorizations.some((auth) => {
    if (!auth) return false;
    if (typeof row.dataHash !== 'string' || row.dataHash === '') return false;
    if (typeof auth.dataHash !== 'string' || auth.dataHash === '') return false;
    return auth.rowId === row.id && auth.dataHash === row.dataHash;
  });
  if (hasExactAuthorization) {
    return { rowId: row.id, vigente_para_habilitacion: true, queuedForRevalidation: false };
  }
  return { rowId: row.id, vigente_para_habilitacion: false, queuedForRevalidation: true };
}

export function buildRevalidationQueueEntry(row, metadata) {
  return {
    id: `revalidation-${row.id}-${metadata.reason}`,
    rowId: row.id,
    reason: metadata.reason,
    status: 'pending',
    requiredApprovalType: 'human-data-authorization',
    sourceCatalogueVersion: metadata.sourceCatalogueVersion,
    sourceMapHash: metadata.sourceMapHash,
    queuedAt: metadata.queuedAt,
    lineageRef: `lineage-${row.id}`,
  };
}

function createInitialState(version) {
  return { version, archive: [], revalidationQueue: [], auditLog: [], replayLog: Object.create(null) };
}

/**
 * replayLog is kept prototype-free so that lookups/writes for tokens such as 'hasOwnProperty',
 * '__proto__', or 'constructor' behave as ordinary own-property access — never as an inherited
 * Object.prototype collision, and never as prototype pollution.
 */
function cloneReplayLog(replayLog) {
  const cloned = Object.create(null);
  for (const token of Object.keys(replayLog)) {
    const entry = replayLog[token];
    cloned[token] = { fingerprint: entry.fingerprint, result: structuredClone(entry.result) };
  }
  return cloned;
}

function withReplayEntry(replayLog, token, entry) {
  const next = cloneReplayLog(replayLog);
  next[token] = { fingerprint: entry.fingerprint, result: structuredClone(entry.result) };
  return next;
}

function cloneState(priorState, fallbackVersion) {
  if (!priorState) return createInitialState(fallbackVersion);
  return {
    version: priorState.version,
    archive: structuredClone(priorState.archive),
    revalidationQueue: structuredClone(priorState.revalidationQueue),
    auditLog: structuredClone(priorState.auditLog),
    replayLog: cloneReplayLog(priorState.replayLog),
  };
}

/**
 * Runs one reconciliation pass. Replays under an already-seen replay token are resolved from
 * the fingerprint of the exact input: an identical input replays idempotently (same cached
 * result), a differing input under the same token is denied and audited as a conflict, never
 * silently reprocessed either way.
 */
function buildDeniedResult(state, catalogueApproved) {
  return {
    archive: structuredClone(state.archive),
    flags: [],
    revalidationQueue: structuredClone(state.revalidationQueue),
    status: 'denied',
    catalogue_approved: catalogueApproved,
  };
}

export function runReconciliation(input, priorState) {
  const state = cloneState(priorState, input.catalogue?.version ?? null);
  const replayToken = input.replayToken;

  if (typeof replayToken !== 'string' || replayToken.length === 0) {
    const auditLog = [
      ...state.auditLog,
      { type: 'replay-token-invalid', replayToken: typeof replayToken === 'string' ? replayToken : null },
    ];
    const result = buildDeniedResult(state, false);
    return { result, state: { ...state, auditLog } };
  }

  const fingerprint = computeReplayFingerprint(input);
  const priorReplay = state.replayLog[replayToken];

  if (priorReplay) {
    if (priorReplay.fingerprint === fingerprint) {
      const auditLog = [...state.auditLog, { type: 'replay-idempotent', replayToken }];
      return { result: structuredClone(priorReplay.result), state: { ...state, auditLog } };
    }
    const auditLog = [...state.auditLog, { type: 'replay-conflict', replayToken }];
    const result = buildDeniedResult(state, false);
    return { result, state: { ...state, auditLog } };
  }

  const approvalOk = validateCatalogueApproval(input.catalogue, input.humanApproval);
  let freezeOk = true;
  if (approvalOk) {
    try {
      assertFreezeBeforeCutover(input.freezeSentinel, input.cutoverTimestamp);
    } catch {
      freezeOk = false;
    }
  }

  if (!approvalOk || !freezeOk) {
    const result = buildDeniedResult(state, approvalOk);
    const auditLog = [
      ...state.auditLog,
      {
        type: 'governance-denied',
        replayToken,
        reason: !approvalOk ? 'catalogue-approval-invalid' : 'freeze-sentinel-invalid',
      },
    ];
    const replayLog = withReplayEntry(state.replayLog, replayToken, { fingerprint, result });
    return { result, state: { ...state, auditLog, replayLog } };
  }

  let archive = state.archive;
  let revalidationQueue = state.revalidationQueue;
  const flags = [];

  for (const row of input.rows) {
    archive = archiveRow(row, archive, input.catalogue.version);
    const rowFlags = computeSemanticFlags(row, input.catalogue);
    const f2Fields = computeF2SemanticFields(row, approvalOk);
    flags.push({ rowId: row.id, ...rowFlags, ...f2Fields });

    const habilitacion = evaluateHabilitacion(row, input.humanDataAuthorizations || []);
    const revalidationReasons = [];
    if (habilitacion.queuedForRevalidation) revalidationReasons.push('high-risk-no-authorization');
    if (rowFlags.isTaxonomyConflict) revalidationReasons.push('taxonomy-conflict');

    for (const reason of revalidationReasons) {
      revalidationQueue = [
        ...revalidationQueue,
        buildRevalidationQueueEntry(row, {
          reason,
          sourceCatalogueVersion: input.catalogue.version,
          sourceMapHash: input.catalogue.mapHash,
          queuedAt: input.cutoverTimestamp,
        }),
      ];
    }
  }

  const result = {
    archive: structuredClone(archive),
    flags,
    revalidationQueue: structuredClone(revalidationQueue),
    status: 'reconciled',
    catalogue_approved: approvalOk,
  };
  const auditLog = [...state.auditLog, { type: 'reconciliation-processed', replayToken }];
  const replayLog = withReplayEntry(state.replayLog, replayToken, { fingerprint, result });

  return {
    result,
    state: { version: input.catalogue.version, archive, revalidationQueue, auditLog, replayLog },
  };
}

/**
 * Rolls the working version back while preserving every pre-existing audit entry — rollback
 * only appends, it never removes or rewrites prior audit history.
 */
export function rollback(state, targetVersion) {
  const auditLog = [
    ...state.auditLog,
    { type: 'rollback', fromVersion: state.version, toVersion: targetVersion },
  ];
  return { ...state, version: targetVersion, auditLog };
}

/**
 * Clears working state (archive, revalidation queue) but leaves the audit trail exactly as it
 * was — teardown discards working data, never audit history.
 */
export function teardown(state) {
  return { ...state, archive: [], revalidationQueue: [], auditLog: [...state.auditLog] };
}
