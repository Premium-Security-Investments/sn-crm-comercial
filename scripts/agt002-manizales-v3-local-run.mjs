#!/usr/bin/env node
// AGT-002 · Phase 5 · Manizales SA-24-2026 V3 LOCAL synthetic canary driver.
//
// What this is:
//   A fully local, in-memory driver that builds the governed V3 validation context from the
//   CHECKED-IN Manizales integral manifest (server-owned selection) and runs the REAL
//   agt002-preview-engine `analyze` exactly once against an in-process SYNTHETIC responder
//   (no Hetzner bridge, no network, no DB, no real provider). It prints only sanitized
//   governed metadata per requirement and surfaces human questions strictly for material
//   exceptions.
//
// What this is NOT:
//   - It is NOT the controlled real-provider canary of docs/runbooks/agt002-integral-v3-canary.md.
//     That canary requires the real codex_app_server provider (AGT002_HETZNER_BRIDGE_URL /
//     AGT002_HETZNER_BRIDGE_HMAC_SECRET / AGT002_PREVIEW_MODEL) and the real production
//     opportunity snapshot (Supabase read credentials) — none of which this driver touches.
//   - It performs ZERO persistence: it never imports the persistence module, never issues an
//     RPC, never writes a record. `engine.analyze` returns the envelope in memory and stops.
//
// Hard rules honored here:
//   - Sanitized metadata ONLY. No raw document content, citation quotes, secrets, headers or
//     connection strings are ever read out or printed (the driver asserts assertNoOpenPii on
//     its own summary before returning it).
//   - The governed evidence-state manifest always writes compliance "unknown" (there is no
//     governed compliance write path), so every tender_requirement unit necessarily ABSTAINS
//     (conclusion "human_validation_required"). The synthetic responder therefore follows the
//     abstention patterns of tests/fixtures/agt002-v3-synthetic-responder.mjs: it leaves the
//     server-governed `category`/`evidence_state` null and abstains every unit.
//
// Human-question policy (Phase 5 exit criterion "human questions only for material exceptions"):
//   Because every unit abstains, the deterministic v2 projection would emit one question per
//   requirement — pure noise for a human reviewer. A "material exception" is the closed,
//   honest filter over that noise: a unit whose governed manifest classification is a material
//   impediment (AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES) OR that carries critical missing
//   evidence. In the checked-in manifest NO analyzable requirement is classified 'material'
//   (they are ordinary/scorable/economic), so the material-impediment-category branch is
//   honestly empty and every material exception here is a critical-missing-evidence one.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES } from '../agt002-pre-go-analysis.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';
import { selectAgt002ManizalesManifestSource } from '../agt002-manizales-manifest-source.js';
import {
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
} from '../agt002-manizales-integral-manifest.js';

const MATERIAL_IMPEDIMENT_CATEGORY_SET = new Set(AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES);

// Deterministic, non-secret fixtures for the in-process run (mirrors the proven wiring test).
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const FIXED_RUN_ID = '99999999-9999-4999-8999-999999999999';
const LOCAL_MODEL = 'synthetic-local-canary-model';
const LOCAL_POLICY_VERSION = 'agt002-integral-v3-policy-1';

export const AGT002_MANIZALES_V3_ANALYZABLE_REQUIREMENT_COUNT = 20;

// -------------------------------------------------------------------------------------------
// Synthetic in-process context (no network / no DB): one governed context-v2 section set and a
// single minimal pliego document, exactly as the wiring test assembles them. The manifest
// source (not this deep-analysis matrix) is the sole origin of the resolved requirement set.
// -------------------------------------------------------------------------------------------
function contextV2Sections() {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-manizales-local', updated_at: '2026-08-01T10:00:00.000Z' },
      tender: { id: 'tender-manizales-local', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-08-01T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Proveedor Sintético Ltda.', updated_at: '2026-08-01T10:00:00.000Z' },
      documents: [],
    }),
  };
}

function retrievalDocuments() {
  return [{
    document_id: 'doc-local-01', document_version_id: 'ver-local-01', opportunity_id: 'opp-manizales-local',
    snapshot_id: null, document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64),
    current: true, extracted_text: 'Documento de contexto sintético.',
  }];
}

function buildV3Context() {
  return {
    documents: retrievalDocuments(),
    // Empty deep-analysis matrix: the injected manifest source replaces it entirely.
    deepAnalysis: { matrix: { legal: [], financial: [], technical: [] } },
    snapshotId: SNAPSHOT_ID,
    contextV2Sections: contextV2Sections(),
  };
}

// All 17 governed company-evidence classes are crossed. The posture is deliberately
// conservative and clearly synthetic (reported-but-unverified, review pending, applicability
// pending, no observed expiry) so nothing is over-claimed; governed compliance stays "unknown"
// regardless, so every unit still abstains.
function buildSynthetic17ClassRegistry() {
  return [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort().map((classId) => ({
    entry_id: classId,
    document_class: classId,
    existence_status: 'reported',
    human_review_status: 'pending_human_review',
    applicability_status: 'pending_case_validation',
    integration_active: true,
    expiry: null,
    updated_at: '2026-01-01T00:00:00.000Z',
  }));
}

// -------------------------------------------------------------------------------------------
// Synthetic responder (no bridge). Follows tests/fixtures/agt002-v3-synthetic-responder.mjs:
// the model turn carries ONLY analysis_units; category and evidence_state are left null (the
// server governs both); every tender_requirement unit abstains. The ONE synthetic modeling
// choice is a critical missing-evidence item on the economic-offer requirements (governed V3
// category 'financial_execution'), which have no governed company-evidence link — modeling a
// genuine material exception the reviewer must resolve. Every other unit abstains cleanly with
// no critical missing evidence.
// -------------------------------------------------------------------------------------------
function modelsCriticalMissingEvidence(manifestEntry) {
  return manifestEntry.category === 'financial_execution';
}

function buildAbstainedUnit(manifestEntry, index) {
  const sequence = index + 1;
  const unitId = `UNIT-${String(sequence).padStart(2, '0')}`;
  const critical = modelsCriticalMissingEvidence(manifestEntry);
  return {
    unit_id: unitId,
    unit_kind: 'tender_requirement',
    requirement_id: manifestEntry.requirement_id,
    category: null, // server-governed
    sequence,
    title: `Requisito gobernado ${sequence}`, // generic; never the raw pliego label
    assessment_mode: 'abstained',
    conclusion: {
      status: 'human_validation_required',
      summary: 'Pendiente de validación humana (corrida sintética local, sin proveedor real).',
      confidence: 'unavailable',
    },
    blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'Sin determinación automática; requiere revisión humana.' },
    evidence_state: null, // server-governed
    evidence_refs: [],
    missing_evidence: critical
      ? [{
        missing_id: `MISS-${String(sequence).padStart(2, '0')}`,
        evidence_class_id: null,
        needed_source_type: 'tender_document',
        reason: 'Falta evidencia crítica de sustento económico (modelado sintético local).',
        critical: true,
      }]
      : [],
    commercial_impact: { level: 'unknown', summary: 'Impacto no determinado.', dimension: 'unknown' },
    legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico.', human_legal_review_required: false },
    actions: [],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
    escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
    closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida.', evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: 'Validación humana pendiente.' },
  };
}

export function buildManizalesV3SyntheticResponder() {
  const calls = [];
  // Trapped persistence boundary: the injected client is the ONLY external boundary the engine
  // is handed. `analyze` never calls `rpc` (persistence is a separate, deliberately un-imported
  // module here), so `rpcCalls` stays empty — but it is a REAL counter, not a literal: any code
  // that routed a persistence/RPC call through the client would be counted here AND throw.
  const rpcCalls = [];
  return {
    calls,
    rpcCalls,
    async run(options) {
      calls.push({ model: options?.model ?? null });
      const manifest = options.input.document_evidence.requirement_manifest;
      const units = manifest.map((entry, index) => buildAbstainedUnit(entry, index));
      return {
        content: JSON.stringify({ integral_analysis: { analysis_units: units } }),
        usage: { input_tokens: 11, output_tokens: 11 },
      };
    },
    async rpc(name) {
      rpcCalls.push({ name: typeof name === 'string' ? name : null });
      throw new Error('agt002-manizales-v3-local-run: persistence/RPC está prohibido en el driver local.');
    },
  };
}

// -------------------------------------------------------------------------------------------
// Material-exception predicate (Phase 5 exit criterion). A unit is a material exception iff its
// governed manifest classification is a material impediment (closed catalog) OR it carries
// critical missing evidence.
// -------------------------------------------------------------------------------------------
function manifestMaterialImpedimentBasis(manifestEntry) {
  // Only a governed_runtime entry classified 'material' can carry a material-impediment basis;
  // every analyzable entry in the checked-in manifest is ordinary/scorable/economic, so this is
  // null for all of them. Kept explicit so the OR below is faithful to the closed catalog.
  if (!manifestEntry || manifestEntry.materiality !== 'material') return null;
  return typeof manifestEntry.material_impediment_basis === 'string' ? manifestEntry.material_impediment_basis : null;
}

export function isAgt002ManizalesV3MaterialExceptionUnit(unit, manifestEntryByRequirementId) {
  const manifestEntry = manifestEntryByRequirementId.get(unit.requirement_id);
  const basis = manifestMaterialImpedimentBasis(manifestEntry);
  const categoryMaterial = basis !== null && MATERIAL_IMPEDIMENT_CATEGORY_SET.has(basis);
  const criticalMissingEvidence = Array.isArray(unit.missing_evidence)
    && unit.missing_evidence.some((item) => item && item.critical === true);
  return categoryMaterial || criticalMissingEvidence;
}

function classifyMaterialException(unit, manifestEntryByRequirementId) {
  const manifestEntry = manifestEntryByRequirementId.get(unit.requirement_id);
  const basis = manifestMaterialImpedimentBasis(manifestEntry);
  const categoryMaterial = basis !== null && MATERIAL_IMPEDIMENT_CATEGORY_SET.has(basis);
  const criticalMissingIds = Array.isArray(unit.missing_evidence)
    ? unit.missing_evidence.filter((item) => item && item.critical === true).map((item) => item.missing_id)
    : [];
  return { categoryMaterial, criticalMissingIds, isMaterialException: categoryMaterial || criticalMissingIds.length > 0 };
}

// -------------------------------------------------------------------------------------------
// The single local run.
// -------------------------------------------------------------------------------------------
export async function runAgt002ManizalesV3LocalRun({ manifestSource } = {}) {
  // Server-owned manifest selection (Phase 4): the pilot flag + exact opportunity/proceso yield
  // the checked-in manifest, and any non-pilot scope fails closed.
  const source = manifestSource ?? selectAgt002ManizalesManifestSource({
    integralContractV3: true,
    opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
    process: AGT002_INTEGRAL_MANIFEST_PROCESO,
  });

  const analyzableEntries = source.entries.filter((entry) => entry.analyzable === true);
  const expectedAnalyzableIdsInManifestOrder = analyzableEntries.map((entry) => entry.requirement_id);
  const manifestEntryByRequirementId = new Map(analyzableEntries.map((entry) => [entry.requirement_id, entry]));

  const responder = buildManizalesV3SyntheticResponder();
  const engine = createAgt002PreviewEngine({
    client: responder,
    model: LOCAL_MODEL,
    policyVersion: LOCAL_POLICY_VERSION,
    timeoutMs: 2000,
    // Runbook single-run posture: a misconfiguration cannot fan out into repeated calls.
    maxConcurrent: 1,
    dailyMaxRuns: 1,
    countDailyRuns: async () => 0,
    idGenerator: () => FIXED_RUN_ID,
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => buildSynthetic17ClassRegistry(),
    manizalesManifestSource: source,
  });

  const envelope = await engine.analyze(buildV3Context());
  const units = envelope.integral_analysis.analysis_units;

  const orderedRequirementIds = units.map((unit) => unit.requirement_id);
  const governedCategoryByRequirementId = Object.fromEntries(units.map((unit) => [unit.requirement_id, unit.category]));

  const perRequirementMetadata = units.map((unit) => ({
    requirement_id: unit.requirement_id,
    category: unit.category,
    evidence_state: {
      presence: unit.evidence_state.presence,
      review: unit.evidence_state.review,
      validity: unit.evidence_state.validity,
      applicability: unit.evidence_state.applicability,
      compliance: unit.evidence_state.compliance,
    },
    compliance: unit.evidence_state.compliance,
    missing_evidence_ids: unit.missing_evidence.map((item) => item.missing_id),
  }));

  // Human questions: emitted ONLY for material exceptions.
  const humanQuestions = [];
  let materialImpedimentCategoryExceptionCount = 0;
  let criticalMissingEvidenceExceptionCount = 0;
  for (const unit of units) {
    const { categoryMaterial, criticalMissingIds, isMaterialException } = classifyMaterialException(unit, manifestEntryByRequirementId);
    if (!isMaterialException) continue;
    if (categoryMaterial) materialImpedimentCategoryExceptionCount += 1;
    else criticalMissingEvidenceExceptionCount += 1;
    humanQuestions.push({
      requirement_id: unit.requirement_id,
      question_id: `${unit.unit_id}::human_question`,
      basis: categoryMaterial ? 'material_impediment_category' : 'critical_missing_evidence',
      missing_evidence_ids: criticalMissingIds,
    });
  }
  const materialExceptionRequirementIds = humanQuestions.map((question) => question.requirement_id);

  // Item 2 (static): each manifest evidence_class_id resolves against the 17 production classes.
  const manifestEvidenceClassIds = [...new Set(
    analyzableEntries.map((entry) => entry.evidence_class_id).filter((value) => value !== null && value !== undefined),
  )].sort();
  const catalog = new Set(AGT002_COMPANY_EVIDENCE_CLASS_IDS);
  const evidenceClassResolution = {
    resolved: manifestEvidenceClassIds.map((id) => ({ evidence_class_id: id, in_catalog: catalog.has(id) })),
    unresolved: manifestEvidenceClassIds.filter((id) => !catalog.has(id)),
    null_link_requirement_count: analyzableEntries.filter((entry) => entry.evidence_class_id === null || entry.evidence_class_id === undefined).length,
  };

  const naiveProjectionQuestionCount = envelope.v2_projection.questions.length;

  const sanitizedSummary = {
    proceso: AGT002_INTEGRAL_MANIFEST_PROCESO,
    opportunity_id: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
    contract_version: envelope.integral_analysis.contract_version,
    schema_version: envelope.schema_version,
    analyzable_requirement_count: orderedRequirementIds.length,
    ordered_requirement_ids: orderedRequirementIds,
    governed_compliance_universally_unknown: perRequirementMetadata.every((meta) => meta.compliance === 'unknown'),
    per_requirement: perRequirementMetadata,
    human_questions: humanQuestions,
    material_exception_count: materialExceptionRequirementIds.length,
    material_impediment_category_exception_count: materialImpedimentCategoryExceptionCount,
    critical_missing_evidence_exception_count: criticalMissingEvidenceExceptionCount,
    naive_v2_projection_question_count: naiveProjectionQuestionCount,
    evidence_class_resolution: evidenceClassResolution,
    canonical_evidence_class_count: AGT002_COMPANY_EVIDENCE_CLASS_IDS.length,
    // Persistence proof is MEASURED, not asserted: provider run-calls and the (trapped) rpc
    // count come straight off the sole injected boundary. A record can only be persisted via an
    // rpc, so zero rpc calls ⇒ zero persisted records.
    persistence: { rpc_calls: responder.rpcCalls.length, persisted_records: responder.rpcCalls.length, provider_calls: responder.calls.length },
  };
  // Fail-closed on any un-redacted PII before this metadata can leave the process.
  assertNoOpenPii(sanitizedSummary);

  return {
    envelope,
    orderedRequirementIds,
    expectedAnalyzableIdsInManifestOrder,
    manifestEntryByRequirementId,
    governedCategoryByRequirementId,
    perRequirementMetadata,
    humanQuestions,
    materialExceptionRequirementIds,
    materialImpedimentCategoryExceptionCount,
    criticalMissingEvidenceExceptionCount,
    naiveProjectionQuestionCount,
    evidenceClassResolution,
    canonicalEvidenceClassCount: AGT002_COMPANY_EVIDENCE_CLASS_IDS.length,
    providerCallCount: responder.calls.length,
    // Measured off the sole injected boundary (see buildManizalesV3SyntheticResponder): not literals.
    persistenceRpcCount: responder.rpcCalls.length,
    persistedRecordCount: responder.rpcCalls.length,
    sanitizedSummary,
  };
}

function formatSanitizedReport(result) {
  const lines = [];
  lines.push('AGT-002 · Manizales SA-24-2026 · V3 LOCAL synthetic canary (no persistence, no real provider)');
  lines.push(`contract_version=${result.envelope.integral_analysis.contract_version} schema_version=${result.envelope.schema_version}`);
  lines.push(`analyzable requirements analyzed in manifest order: ${result.orderedRequirementIds.length}`);
  lines.push('--- per requirement (sanitized governed metadata) ---');
  for (const meta of result.perRequirementMetadata) {
    const axes = meta.evidence_state;
    lines.push(
      `${meta.requirement_id} | category=${meta.category} | `
      + `presence=${axes.presence} review=${axes.review} validity=${axes.validity} applicability=${axes.applicability} compliance=${axes.compliance} | `
      + `missing_evidence_ids=[${meta.missing_evidence_ids.join(', ')}]`,
    );
  }
  lines.push('--- human questions (material exceptions only) ---');
  lines.push(`material_exception_count=${result.materialExceptionRequirementIds.length} `
    + `(material_impediment_category=${result.materialImpedimentCategoryExceptionCount}, critical_missing_evidence=${result.criticalMissingEvidenceExceptionCount}); `
    + `naive_v2_projection_question_count=${result.naiveProjectionQuestionCount}`);
  for (const question of result.humanQuestions) {
    lines.push(`${question.requirement_id} | basis=${question.basis} | missing_evidence_ids=[${question.missing_evidence_ids.join(', ')}]`);
  }
  lines.push('--- evidence class resolution (each manifest class ↔ the 17 production classes) ---');
  for (const resolved of result.evidenceClassResolution.resolved) {
    lines.push(`${resolved.evidence_class_id} -> in_catalog=${resolved.in_catalog}`);
  }
  lines.push(`unresolved=[${result.evidenceClassResolution.unresolved.join(', ')}] `
    + `null_link_requirements=${result.evidenceClassResolution.null_link_requirement_count} `
    + `canonical_classes=${result.canonicalEvidenceClassCount}`);
  lines.push('--- persistence proof ---');
  lines.push(`provider_calls=${result.providerCallCount} persistence_rpc_calls=${result.persistenceRpcCount} persisted_records=${result.persistedRecordCount}`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAgt002ManizalesV3LocalRun()
    .then((result) => {
      process.stdout.write(`${formatSanitizedReport(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`agt002-manizales-v3-local-run failed: ${error?.message ?? error}\n`);
      process.exitCode = 1;
    });
}
