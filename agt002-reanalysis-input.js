import { ANALYSIS_FLAG_NAMES } from './agt002-analysis-config.js';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT, isAgt002PreviewReasoningEffort } from './agt002-preview-reasoning-effort.js';
import { validateAgt002CompanyEvidenceIdentity, validateAgt002CompanyEvidenceAsOf } from './agt002-company-evidence-identity.js';
import { validateAgt002CompanyEvidenceInventorySnapshot } from './agt002-company-evidence-sharepoint-catalog.js';
import { AGT002_WORKSET_SOURCE_CLASSIFICATIONS } from './agt002-governed-document-worksets.js';
import { AGT002_PREVIEW_ALLOWED_MODELS } from './agt002-preview-allowed-models.js';

function object(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

const GOVERNED_WORKSET_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOVERNED_WORKSET_HEX64_RE = /^[0-9a-f]{64}$/i;
const GOVERNED_WORKSET_IDENTITY_KEYS = ['opportunity_id', 'tender_id', 'snapshot_id', 'context_version_id', 'selection_hash'];
// Exactly the six fields freezeAgt002WorksetEvidence()/computeAgt002WorksetSelectionHash()
// freeze per member — the full evidence-bearing shape, never the public three-field projection
// analysis_context.documents carries.
const GOVERNED_WORKSET_MEMBER_KEYS = new Set([
  'document_version_id', 'source_classification', 'inclusion_reason',
  'content_hash', 'extraction_id', 'extraction_text_hash',
]);

/**
 * Narrowly-scoped optional extension the governed document-workset freeze route composes onto
 * an otherwise-canonical frozen engine input: exactly `document_workset_identity` (the frozen
 * package's own opportunity/tender/snapshot/context/selection identity) and
 * `governed_workset_members` (the already-bounded, already-evidence-verified frozen member
 * list) — re-validated here, never trusted verbatim, so a corrupted/hostile extension can never
 * reach a queued job.
 */
export function validateAgt002GovernedWorksetExtension(extension) {
  if (!object(extension)) throw new Error('AGT-002 reanalysis governed workset extension must be an object.');
  const extraKeys = Object.keys(extension).filter((key) => key !== 'document_workset_identity' && key !== 'governed_workset_members');
  if (extraKeys.length > 0) throw new Error('AGT-002 reanalysis governed workset extension carries unexpected key(s).');

  const identity = extension.document_workset_identity;
  if (!object(identity) || Object.keys(identity).length !== GOVERNED_WORKSET_IDENTITY_KEYS.length
    || GOVERNED_WORKSET_IDENTITY_KEYS.some((key) => !Object.hasOwn(identity, key))
    || !GOVERNED_WORKSET_UUID_RE.test(identity.opportunity_id)
    // Canonical lowercase UUID only, exactly like the member document_version_id/extraction_id
    // checks below — a merely case-insensitively-valid identity UUID is never accepted.
    || identity.opportunity_id !== identity.opportunity_id.toLowerCase()
    || !GOVERNED_WORKSET_UUID_RE.test(identity.tender_id)
    || identity.tender_id !== identity.tender_id.toLowerCase()
    || !GOVERNED_WORKSET_UUID_RE.test(identity.snapshot_id)
    || identity.snapshot_id !== identity.snapshot_id.toLowerCase()
    || !GOVERNED_WORKSET_UUID_RE.test(identity.context_version_id)
    || identity.context_version_id !== identity.context_version_id.toLowerCase()
    || typeof identity.selection_hash !== 'string' || !GOVERNED_WORKSET_HEX64_RE.test(identity.selection_hash)) {
    throw new Error('AGT-002 reanalysis governed workset document identity is invalid.');
  }

  const members = extension.governed_workset_members;
  if (!Array.isArray(members) || members.length === 0 || members.length > 12) {
    throw new Error('AGT-002 reanalysis governed workset members are invalid.');
  }
  const seenDocumentVersionIds = new Set();
  let previousDocumentVersionId = null;
  for (const member of members) {
    if (!object(member) || Object.keys(member).length !== GOVERNED_WORKSET_MEMBER_KEYS.size
      || Object.keys(member).some((key) => !GOVERNED_WORKSET_MEMBER_KEYS.has(key))
      || typeof member.document_version_id !== 'string' || !GOVERNED_WORKSET_UUID_RE.test(member.document_version_id)
      // Canonical lowercase UUID only — never merely case-insensitively valid — so a frozen
      // input can never carry a non-canonical-case document_version_id undetected.
      || member.document_version_id !== member.document_version_id.toLowerCase()
      || !AGT002_WORKSET_SOURCE_CLASSIFICATIONS.has(member.source_classification)
      || typeof member.inclusion_reason !== 'string' || !member.inclusion_reason.trim()
      || member.inclusion_reason.length > 500
      || typeof member.content_hash !== 'string' || !GOVERNED_WORKSET_HEX64_RE.test(member.content_hash)
      || member.content_hash !== member.content_hash.toLowerCase()
      || typeof member.extraction_id !== 'string' || !GOVERNED_WORKSET_UUID_RE.test(member.extraction_id)
      || member.extraction_id !== member.extraction_id.toLowerCase()
      || typeof member.extraction_text_hash !== 'string' || !GOVERNED_WORKSET_HEX64_RE.test(member.extraction_text_hash)
      || member.extraction_text_hash !== member.extraction_text_hash.toLowerCase()) {
      throw new Error('AGT-002 reanalysis governed workset member is invalid.');
    }
    if (seenDocumentVersionIds.has(member.document_version_id)) {
      throw new Error('AGT-002 reanalysis governed workset member is invalid.');
    }
    seenDocumentVersionIds.add(member.document_version_id);
    // Members must already be frozen in strictly ascending lexical/C order by
    // document_version_id — this never sorts/reorders the input itself, it only rejects input
    // that was not already in canonical order.
    if (previousDocumentVersionId !== null && member.document_version_id <= previousDocumentVersionId) {
      throw new Error('AGT-002 reanalysis governed workset members must be strictly ascending by document_version_id.');
    }
    previousDocumentVersionId = member.document_version_id;
  }

  return { document_workset_identity: identity, governed_workset_members: members };
}

/** Hard ceiling the durable preview reservation accepts for a single claim lease. */
export const AGT002_MAX_PREVIEW_CLAIM_LEASE_SECONDS = 600;

/**
 * The durable claim lease one queued job needs, and the single source both the enqueue contract
 * and the worker executor read. A V3 run spends TWO sequential provider turns under one claim
 * (semantic discovery, then analysis) and `timeout_ms` bounds each turn independently, so each
 * turn rounds up to whole seconds on its own before they are summed, plus the executor's 30s
 * buffer. The result is NEVER clamped: clamping hands back a lease that silently underfunds both
 * turns and the run is reclaimed mid-flight after the provider has already been paid.
 */
export function agt002RequiredPreviewClaimLeaseSeconds(timeoutMs) {
  return 2 * Math.ceil(timeoutMs / 1000) + 30;
}

/**
 * Whether a job frozen with this turn timeout can ever be executed. The worker rejects an
 * unfundable lease BEFORE claiming, on every cycle, so queueing one only creates a corrida that
 * dies without ever reaching the provider — the enqueue side must refuse exactly what the worker
 * refuses. 285_000ms is the largest fundable timeout (2*285+30 = 600 exactly); 285_001ms needs
 * 602s and is refused here instead of being queued and rejected later.
 */
export function isAgt002QueueableTimeoutMs(timeoutMs) {
  return Number.isInteger(timeoutMs)
    && timeoutMs > 0
    && agt002RequiredPreviewClaimLeaseSeconds(timeoutMs) <= AGT002_MAX_PREVIEW_CLAIM_LEASE_SECONDS;
}

function cloneJson(value, label) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error();
    return JSON.parse(serialized);
  } catch {
    throw new Error(`AGT-002 reanalysis ${label} must be JSON-safe.`);
  }
}

/** Recursively freezes every array/object reachable from `value` — not only the root. */
function deepFreezeJson(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeJson(item);
    return Object.freeze(value);
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreezeJson(value[key]);
    return Object.freeze(value);
  }
  return value;
}

/** Creates the immutable, non-secret engine input persisted with a queue job. */
export function buildAgt002FrozenEngineInput({
  runtimeConfig,
  analysisConfig,
  analysisContext,
  legalCorpusContext = null,
  integralV3Governance = null,
  manizalesManifestSource = null,
  idempotencyKey,
  governedWorksetExtension = null,
} = {}) {
  // AGT-002 root-cause fix: the reasoning effort a NEW job freezes always resolves to a real,
  // explicit, allowlisted value — absence defaults to the fastest operationally-validated level
  // (mirroring getAgt002PreviewRuntimeConfig's own default), an explicit-but-unsupported value
  // fails closed. This never changes what an already-durable job carries: see
  // agt002-reanalysis-executor.js's validFrozenInput, which tolerates a legacy frozen input with
  // no `effort` field at all (a job created before this field existed).
  const resolvedEffort = runtimeConfig?.effort === undefined ? AGT002_PREVIEW_DEFAULT_REASONING_EFFORT : runtimeConfig.effort;
  if (!object(runtimeConfig)
    || !AGT002_PREVIEW_ALLOWED_MODELS.includes(runtimeConfig.model)
    || typeof runtimeConfig.policyVersion !== 'string' || !runtimeConfig.policyVersion.trim()
    || !isAgt002QueueableTimeoutMs(runtimeConfig.timeoutMs)
    || !Number.isInteger(runtimeConfig.dailyMaxRuns) || runtimeConfig.dailyMaxRuns <= 0
    || !Number.isInteger(runtimeConfig.maxConcurrent) || runtimeConfig.maxConcurrent <= 0
    || !isAgt002PreviewReasoningEffort(resolvedEffort)
    || !object(analysisConfig) || analysisConfig.AGT002_CANONICAL_ONLY !== true
    || !object(analysisContext) || analysisContext.canonicalOnly !== true
    || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw new Error('AGT-002 reanalysis frozen input is invalid.');
  }
  if (analysisConfig.AGT002_INTEGRAL_CONTRACT_V3 === true) {
    if (!object(integralV3Governance)) throw new Error('AGT-002 reanalysis frozen governance is required.');
    // C: a NEW job always freezes the company-evidence identity AND the deterministic asOf it was
    // derived against together — re-validated here (never trusted verbatim) rather than merely
    // accepted, exactly like every other governed value this module freezes.
    validateAgt002CompanyEvidenceIdentity(integralV3Governance.evidenceIdentity);
    // Canonical format only — never merely Date-parseable — so a frozen job can never carry an
    // offset, a non-midnight time or a calendar-impossible date as its governed asOf.
    validateAgt002CompanyEvidenceAsOf(integralV3Governance.evidenceAsOf);
    // F4: a NEW job always re-validates the governed SharePoint inventory snapshot it freezes —
    // never trusted verbatim — so a corrupted/hostile snapshot is rejected at freeze time, not
    // discovered by the worker hours later.
    validateAgt002CompanyEvidenceInventorySnapshot(integralV3Governance.companyEvidenceInventorySnapshot);
  }
  if (analysisConfig.AGT002_LEGAL_CORPUS === true && !object(legalCorpusContext)) {
    throw new Error('AGT-002 reanalysis frozen legal corpus is required.');
  }
  const validatedGovernedWorksetExtension = governedWorksetExtension === null
    ? null
    : validateAgt002GovernedWorksetExtension(governedWorksetExtension);

  const flags = {};
  for (const name of ANALYSIS_FLAG_NAMES) flags[name] = analysisConfig[name] === true;
  return deepFreezeJson(cloneJson({
    schema_version: 2,
    engine_identity: {
      model: runtimeConfig.model,
      policy_version: runtimeConfig.policyVersion.trim(),
      timeout_ms: runtimeConfig.timeoutMs,
      daily_max_runs: runtimeConfig.dailyMaxRuns,
      max_concurrent: runtimeConfig.maxConcurrent,
      effort: resolvedEffort,
      idempotency_key: idempotencyKey.trim(),
    },
    analysis_flags: flags,
    analysis_context: analysisContext,
    legal_corpus_context: legalCorpusContext,
    integral_v3_governance: integralV3Governance,
    manizales_manifest_source: manizalesManifestSource,
    ...(validatedGovernedWorksetExtension ? {
      document_workset_identity: validatedGovernedWorksetExtension.document_workset_identity,
      governed_workset_members: validatedGovernedWorksetExtension.governed_workset_members,
    } : {}),
  }, 'input'));
}
