// AGT-002 INITIAL — builds the first aggregate (pre_go_analysis.v2) from two disjoint authorities:
//
//   * the MODEL writes only the analytical sections (claims, requirements, findings, contradictions,
//     coverage, process analysis, recommendation, open items, process deadlines) and cites sources as
//     {document_id, locator};
//   * the SERVER stamps everything that is identity or evidence: meta, evidence_package (from the frozen
//     package), source-ref hashes/timestamps/classification (from the package members), company_fit,
//     the check catalog, human_decision and presentation_readiness.
//
// The model therefore never invents an identifier, a hash or a timestamp, and integrity does not depend on
// it copying anything correctly. The result is stamped BEFORE the synthesis checkpoint is stored, because
// the completion RPC requires the persisted aggregate to equal the stored synthesis output.

import { createHash } from 'node:crypto';
import { PRE_GO_SCHEMA_V2, AGT002_PRE_GO_ANALYSIS_V2 } from './agt002-pre-go-analysis-v2.js';

export const INITIAL_MODEL_ANALYSIS_KEYS = Object.freeze([
  'claims', 'process_analysis', 'requirements', 'findings', 'contradictions', 'coverage',
  'recommendation', 'open_items', 'process_deadlines',
]);

// First INITIAL analyses carry no authorized company profile (scope A): the recommendation space is fixed.
const SCOPE_A_RECOMMENDATION_KINDS = Object.freeze(['HOLD_RECOMMENDED', 'NO_GO_RECOMMENDED', 'INSUFFICIENT_INFORMATION']);
const CHECK_CATALOG_VERSION = 'methodology-v1.1-checks-v1';
const CHECK_COUNT = 22;

const SOURCE_BY_CLASSIFICATION = Object.freeze({
  official: { source_type: 'OFFICIAL_PROCESS_DOCUMENT', officiality_status: 'VERIFIED_OFFICIAL' },
  corporate: { source_type: 'COMPANY_EVIDENCE', officiality_status: 'INTERNAL_SUPPORT' },
  internal: { source_type: 'COMPANY_EVIDENCE', officiality_status: 'INTERNAL_SUPPORT' },
  third_party: { source_type: 'COMPANY_EVIDENCE', officiality_status: 'UNCONFIRMED' },
  draft: { source_type: 'COMPANY_EVIDENCE', officiality_status: 'UNCONFIRMED' },
});

export function agt002InitialDiagnosticError(reason, detail = {}) {
  const error = new Error(`AGT-002 INITIAL aggregate: ${reason}`);
  error.code = 'AGT002_ENGINE_MODEL_CALL_FAILED';
  error.diagnostic = { reason, ...detail };
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

const sha256 = value => createHash('sha256').update(value).digest('hex');

/** SHA-256 of the canonical JSON of the analytical sections exactly as the model produced them. */
export function computeInitialAnalysisCoreHash(analysis) {
  const core = Object.fromEntries(INITIAL_MODEL_ANALYSIS_KEYS.map(key => [key, analysis?.[key]]));
  return sha256(JSON.stringify(stable(core)));
}

function omitProperties(definition, keys) {
  const next = structuredClone(definition);
  for (const key of keys) delete next.properties[key];
  next.required = next.required.filter(key => !keys.includes(key));
  return next;
}

/** The schema the MODEL fills for the synthesis phase: analytical sections only, sources as {document_id, locator}. */
export function buildInitialSynthesisModelSchema({ documentIds }) {
  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    throw agt002InitialDiagnosticError('synthesis_schema_requires_documents');
  }
  const schema = structuredClone(PRE_GO_SCHEMA_V2);
  const defs = schema.$defs;
  const nonEmptyText = { $ref: '#/$defs/nonEmptyText' };

  defs.claim = omitProperties(defs.claim, ['created_by', 'created_at', 'decision_ref']);
  defs.sourceRef = {
    type: 'object', additionalProperties: false,
    required: ['document_id', 'locator'],
    properties: { document_id: { enum: [...documentIds] }, locator: nonEmptyText },
  };
  defs.recommendation.properties.kind = { enum: [...SCOPE_A_RECOMMENDATION_KINDS] };

  const properties = {};
  for (const key of INITIAL_MODEL_ANALYSIS_KEYS) {
    properties[key] = key === 'process_deadlines'
      ? structuredClone(defs.meta.properties.process_deadlines)
      : structuredClone(schema.properties[key]);
  }
  return {
    $id: 'https://premiumsecurity.ai/schemas/agt002/pre_go_analysis.v2.initial-model-output.json',
    title: 'AGT-002 INITIAL synthesis model output',
    type: 'object',
    additionalProperties: false,
    required: [...INITIAL_MODEL_ANALYSIS_KEYS],
    properties,
    $defs: defs,
  };
}

/** Schema for one member-batch call: every note names the document it comes from, restricted to that batch. */
export function buildInitialMemberOutputSchema({ memberIds }) {
  if (!Array.isArray(memberIds) || memberIds.length === 0) throw agt002InitialDiagnosticError('member_schema_requires_members');
  return {
    type: 'object', additionalProperties: false,
    required: ['analysis_notes', 'open_items'],
    properties: {
      analysis_notes: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['document_id', 'locator', 'note'],
          properties: {
            document_id: { enum: [...memberIds] },
            locator: { type: 'string', minLength: 1, maxLength: 300 },
            note: { type: 'string', minLength: 1, maxLength: 4000 },
          },
        },
      },
      open_items: { type: 'array', items: { type: 'string' } },
    },
  };
}

function toIso(value, label) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw agt002InitialDiagnosticError('invalid_timestamp', { field: label });
  return new Date(time).toISOString();
}

function buildEvidencePackage({ version, members, cutoffAt }) {
  const byBatch = new Map();
  for (const member of members) byBatch.set(member.batch_index, (byBatch.get(member.batch_index) ?? 0) + 1);
  return {
    package_id: version.package_id,
    package_hash: version.package_hash,
    snapshot_id: null,
    document_manifest_hash: version.document_manifest_hash,
    semantic_manifest_hash: version.semantic_manifest_hash,
    member_count: version.member_count,
    mandatory_member_count: version.member_count,
    batch_count: version.batch_count,
    batch_size: Math.max(...byBatch.values()),
    inventory_cutoff_at: cutoffAt,
    member_refs: members.map(member => ({
      member_id: member.id,
      document_id: member.document_version_id,
      content_hash: member.content_hash,
      extraction_hash: member.extraction_text_hash,
      vitality: 'UNCLASSIFIED',
      review_depth: 'FULL',
      batch_index: member.batch_index,
    })),
  };
}

function buildCheckCatalog() {
  return Array.from({ length: CHECK_COUNT }, (_, index) => ({
    catalog_version: CHECK_CATALOG_VERSION,
    check_id: `CHECK-${String(index + 1).padStart(2, '0')}`,
    catalog_number: index + 1,
    modality: 'AUTOMATED',
    roles: ['AGT-002'],
    applicability: 'APPLICABLE',
    applicability_reason: null,
    evidence_claim_ids: [],
    // The methodology's check catalog is not defined in this repository: the first analysis does not claim to
    // have executed any of them.
    execution_status: 'NOT_STARTED',
    result: 'INDETERMINATE',
    calculation_claim_id: null,
    executed_at: null,
  }));
}

function expandSourceRef(ref, membersByDocument, cutoffAt) {
  const member = membersByDocument.get(ref?.document_id);
  if (!member) return { document_id: ref?.document_id, locator: ref?.locator };
  const mapping = SOURCE_BY_CLASSIFICATION[member.source_classification] ?? SOURCE_BY_CLASSIFICATION.third_party;
  return {
    ...mapping,
    source_id: member.document_version_id,
    source_hash: member.extraction_text_hash,
    document_id: member.document_version_id,
    chunk_id: null,
    unit_hash: null,
    locator: ref.locator,
    retrieved_at: cutoffAt,
  };
}

/**
 * Stamps the server-owned parts around the model's analytical sections and returns the full v2 envelope.
 * Throws a diagnostic error (closed reason, no model content) when the stamping inputs are unusable.
 */
export function buildInitialAggregate({ analysis, identity, pkg, now, executor }) {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) throw agt002InitialDiagnosticError('analysis_not_object');
  if (identity?.g1Scope !== 'A') throw agt002InitialDiagnosticError('scope_not_supported', { scope: String(identity?.g1Scope) });
  const { version, members } = pkg ?? {};
  if (!version || !Array.isArray(members) || members.length === 0) throw agt002InitialDiagnosticError('package_unavailable');
  if (members.length !== version.member_count) throw agt002InitialDiagnosticError('package_member_count_mismatch');

  const cutoffAt = toIso(version.created_at, 'inventory_cutoff_at');
  const stampedAt = toIso(now, 'now');
  const membersByDocument = new Map(members.map(member => [member.document_version_id, member]));

  const claims = (Array.isArray(analysis.claims) ? analysis.claims : []).map(claim => ({
    ...claim,
    source_refs: (Array.isArray(claim.source_refs) ? claim.source_refs : [])
      .map(ref => expandSourceRef(ref, membersByDocument, cutoffAt)),
    decision_ref: null,
    created_by: 'AGT-002',
    created_at: stampedAt,
  }));

  const evidencePackage = buildEvidencePackage({ version, members, cutoffAt });
  return {
    meta: {
      schema_version: AGT002_PRE_GO_ANALYSIS_V2,
      aggregate_version: 1,
      aggregate_stage: 'ANALYSIS_PUBLISHED',
      analysis_core_hash: computeInitialAnalysisCoreHash(analysis),
      analysis_run_id: identity.analysisRunId,
      analysis_kind: 'INITIAL',
      analysis_version: 1,
      source_analysis_run_id: null,
      legacy_lineage_refs: [],
      opportunity_id: identity.opportunityId,
      tender_id: identity.tenderId,
      package_id: version.package_id,
      package_hash: identity.packageHash,
      snapshot_id: null,
      g1_authorization_id: identity.authorizationId,
      g1_scope: identity.g1Scope,
      policy_version: identity.policyVersion,
      check_catalog_version: CHECK_CATALOG_VERSION,
      executor_version: executor.executorVersion,
      model_profile_id: executor.modelProfileId,
      cutoff_at: cutoffAt,
      created_at: stampedAt,
      completed_at: stampedAt,
      process_deadlines: Array.isArray(analysis.process_deadlines) ? analysis.process_deadlines : [],
    },
    evidence_package: evidencePackage,
    claims,
    process_analysis: analysis.process_analysis,
    company_fit: {
      status: 'NOT_AUTHORIZED',
      profile_snapshot_id: null,
      profile_snapshot_hash: null,
      overall_label: 'NOT_AUTHORIZED',
      requirement_ids: [],
      limitation_claim_ids: [],
    },
    requirements: analysis.requirements,
    findings: analysis.findings,
    checks: buildCheckCatalog(),
    contradictions: analysis.contradictions,
    coverage: analysis.coverage,
    recommendation: analysis.recommendation,
    open_items: analysis.open_items,
    human_decision: null,
    presentation_readiness: {
      status: 'NOT_STARTED',
      control_c_status: 'NOT_STARTED',
      control_c_receipt_id: null,
      g3_gate: null,
      blocker_ids: [],
      last_checked_at: null,
    },
  };
}
