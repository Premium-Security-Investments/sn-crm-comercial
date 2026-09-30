// AGT-002 P0-03 (GREEN slice A) — G1 analysis authorization, pure logic half.
//
// Distinct, neutral module belonging to the initial-analysis slice
// (docs/agt002/initial-analysis/CURRENT.md): this module is never imported by, and never
// imports, any agt002-reanalysis-*.js module. It pins: G1 authorizes only INITIAL workflows
// (never REANALYSIS); the active/unexpired/unrevoked/unconsumed status derivation used by the
// consume-on-create boundary that P0-04 job creation will call through
// psi_consume_agt002_analysis_authorization (migration 098, not authored in this phase); and
// the exact-binding matcher (workflow/package version+hash/opportunity/tender) that fails
// closed on any mismatch.
//
// Pure functions only: no RPC calls, no SQL, no I/O. Callers inject RPC adapters around these
// validators/projectors; this module never performs a write itself.
import { createHash } from 'node:crypto';

export const AGT002_ANALYSIS_AUTHORIZATION_GATES = Object.freeze(['G1']);

export const AGT002_G1_AUTHORIZABLE_WORKFLOW_TYPES = Object.freeze(['INITIAL']);

export function assertAgt002G1CanAuthorize(workflowType) {
  if (!AGT002_G1_AUTHORIZABLE_WORKFLOW_TYPES.includes(workflowType)) {
    throw new Error(`agt002-analysis-authorizations: G1 authorizes only INITIAL workflows, got "${workflowType}"`);
  }
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

function computeAgt002AnalysisAuthorizationHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalizeJsonValue(value))).digest('hex');
}

export function computeAgt002AnalysisAuthorizationIdempotencyKey(authorization) {
  const { workflowInstanceId, packageVersionId, packageHash, expiresAt } = authorization;
  return computeAgt002AnalysisAuthorizationHash({ workflowInstanceId, packageVersionId, packageHash, expiresAt });
}

const AGT002_ANALYSIS_AUTHORIZATION_RECOGNIZED_STATES = new Set([
  'REQUESTED', 'AUTHORIZED', 'EXPIRED', 'REVOKED', 'CONSUMED',
]);

export function isAgt002AnalysisAuthorizationActive({ latestEventToState, expiresAt, now }) {
  if (!AGT002_ANALYSIS_AUTHORIZATION_RECOGNIZED_STATES.has(latestEventToState)) {
    throw new Error(`agt002-analysis-authorizations: unrecognized latestEventToState "${latestEventToState}"`);
  }
  if (latestEventToState === 'REQUESTED') return 'pending';
  if (latestEventToState === 'REVOKED') return 'revoked';
  if (latestEventToState === 'CONSUMED') return 'consumed';
  if (latestEventToState === 'EXPIRED') return 'expired';

  // AUTHORIZED: still fail closed to "expired" once past expiry, even before an EXPIRED
  // event has been recorded, since expiry is a fact of time, not merely of ledger state.
  const nowInstant = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const expiresInstant = new Date(expiresAt).getTime();
  return nowInstant >= expiresInstant ? 'expired' : 'active';
}

const AGT002_ANALYSIS_AUTHORIZATION_BINDING_FIELDS = Object.freeze([
  'workflowInstanceId', 'opportunityId', 'tenderId', 'packageVersionId', 'packageHash',
]);

export function assertAgt002AnalysisAuthorizationBinding({ authorization, request }) {
  for (const field of AGT002_ANALYSIS_AUTHORIZATION_BINDING_FIELDS) {
    if (authorization[field] !== request[field]) {
      throw new Error(`agt002-analysis-authorizations: binding mismatch on ${field}`);
    }
  }
}

const AGT002_ANALYSIS_AUTHORIZATION_BANNED_KEY_PATTERN = new RegExp(
  ['extracted_text', 'storage_path', 'source_url', 'signed_url', 'credential', 'api_key', 'secret', 'raw_error', 'raw_prompt', 'prompt'].join('|'),
  'i',
);

function stripAgt002AnalysisAuthorizationBannedKeys(value) {
  if (Array.isArray(value)) return value.map(stripAgt002AnalysisAuthorizationBannedKeys);
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (AGT002_ANALYSIS_AUTHORIZATION_BANNED_KEY_PATTERN.test(key)) continue;
      result[key] = stripAgt002AnalysisAuthorizationBannedKeys(entry);
    }
    return result;
  }
  return value;
}

export function publicAgt002AnalysisAuthorizationSummary(row) {
  return stripAgt002AnalysisAuthorizationBannedKeys(row);
}
