import { strict as assert } from 'node:assert';
import { AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES } from '../agt002-pre-go-analysis.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from '../agt002-integral-analysis-v3.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';
import {
  runAgt002ManizalesV3LocalRun,
  isAgt002ManizalesV3MaterialExceptionUnit,
  buildManizalesV3SyntheticResponder,
  AGT002_MANIZALES_V3_ANALYZABLE_REQUIREMENT_COUNT,
} from '../scripts/agt002-manizales-v3-local-run.mjs';

// Phase 5 (Work item 1): strict integration gate for the LOCAL, no-persistence Manizales V3
// synthetic canary driver. It drives the REAL engine over the CHECKED-IN manifest with an
// in-process synthetic responder (no bridge, no network, no DB, no persistence), asserting:
//   - every analyzable requirement is analyzed in manifest order (1:1 governed coverage);
//   - every unit abstains with governed compliance "unknown" (evidence-or-abstention);
//   - human questions are emitted ONLY for material exceptions (a governed material-impediment
//     category per AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES, or critical missing evidence),
//     and the human-question count equals the material-exception count — never one per requirement;
//   - each manifest evidence_class_id resolves against the 17 production evidence classes;
//   - the run persists ZERO records and calls the synthetic provider exactly once;
//   - the printable summary carries only sanitized metadata (no open PII, no raw content).
// Nothing here touches production, the network, a real DB or the real provider.

const result = await runAgt002ManizalesV3LocalRun();

// ---------------------------------------------------------------------------------------------
// 1. Exactly the 20 analyzable requirement ids, in manifest order, 1:1 governed coverage.
// ---------------------------------------------------------------------------------------------
assert.equal(AGT002_MANIZALES_V3_ANALYZABLE_REQUIREMENT_COUNT, 20);
assert.equal(result.orderedRequirementIds.length, 20);
assert.deepEqual(
  result.orderedRequirementIds,
  result.expectedAnalyzableIdsInManifestOrder,
  'analyzed ids must equal the checked-in manifest analyzable ids, in manifest order',
);
assert.deepEqual(result.envelope.integral_analysis.coverage.expected_requirement_ids, result.orderedRequirementIds);
assert.deepEqual(result.envelope.integral_analysis.coverage.analyzed_requirement_ids, result.orderedRequirementIds);
assert.deepEqual(
  result.envelope.integral_analysis.analysis_units.map((unit) => unit.requirement_id),
  result.orderedRequirementIds,
  'the analysis units must realize the governed coverage in order',
);
assert.deepEqual(
  result.envelope.evidence_coverage.requirement_manifest.map((entry) => entry.requirement_id),
  result.orderedRequirementIds,
);

// Inner governed contract_version (not the envelope schema_version) and envelope schema_version.
assert.equal(result.envelope.integral_analysis.contract_version, AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION);
assert.equal(result.envelope.schema_version, '3.0.0');
assert.equal(result.envelope.human_review_required, true);
assert.equal(result.envelope.v2_projection.human_review_required, true);
// Phase 4: the run carries the server-owned top-level manifest_scope.
assert.ok(result.envelope.manifest_scope, 'a manifest-driven run carries a server-owned manifest_scope');

// ---------------------------------------------------------------------------------------------
// 2. Evidence-or-abstention: every unit abstains, governed compliance is "unknown", five axes.
// ---------------------------------------------------------------------------------------------
assert.equal(result.perRequirementMetadata.length, 20);
for (const meta of result.perRequirementMetadata) {
  assert.equal(meta.compliance, 'unknown', `proposal compliance must be unknown for ${meta.requirement_id}`);
  assert.deepEqual(
    Object.keys(meta.evidence_state).sort(),
    ['applicability', 'compliance', 'presence', 'review', 'validity'],
    'exactly the five evidence axes are surfaced',
  );
  assert.equal(meta.evidence_state.compliance, 'unknown');
}
for (const unit of result.envelope.integral_analysis.analysis_units) {
  assert.equal(unit.unit_kind, 'tender_requirement');
  assert.equal(unit.assessment_mode, 'abstained', `${unit.requirement_id} must abstain (governed compliance is unknown)`);
  assert.equal(unit.conclusion.status, 'human_validation_required');
  assert.equal(unit.conclusion.confidence, 'unavailable');
  assert.equal(unit.evidence_state.compliance, 'unknown');
  assert.equal(unit.human_validation.status, 'pending');
  assert.equal(unit.category, result.governedCategoryByRequirementId[unit.requirement_id]);
}

// ---------------------------------------------------------------------------------------------
// 3. Human questions ONLY for material exceptions; count == material-exception count; never 1/req.
// ---------------------------------------------------------------------------------------------
const materialExceptionIds = [...result.materialExceptionRequirementIds].sort();
const humanQuestionIds = result.humanQuestions.map((question) => question.requirement_id).sort();
assert.deepEqual(humanQuestionIds, materialExceptionIds, 'human questions map exactly onto material exceptions');
assert.equal(result.humanQuestions.length, result.materialExceptionRequirementIds.length);
assert.ok(result.humanQuestions.length >= 1, 'non-degenerate: at least one material exception is surfaced');
assert.ok(
  result.humanQuestions.length < result.orderedRequirementIds.length,
  'never one human question per requirement',
);

// Envelope-derived INDEPENDENT oracle (does NOT call the driver's emission predicate): recompute
// the material-exception set straight from the real validated envelope units (critical missing
// evidence) and the raw manifest (material-impediment category). This catches an emission/
// predicate that silently narrows or widens relative to the actual envelope ground truth — the
// case a predicate-vs-predicate check cannot see.
const materialImpedimentCatalog = new Set(AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES);
const independentMaterialExceptionIds = result.envelope.integral_analysis.analysis_units
  .filter((unit) => {
    const manifestEntry = result.manifestEntryByRequirementId.get(unit.requirement_id);
    const basis = manifestEntry && manifestEntry.materiality === 'material'
      && typeof manifestEntry.material_impediment_basis === 'string'
      ? manifestEntry.material_impediment_basis
      : null;
    const categoryMaterial = basis !== null && materialImpedimentCatalog.has(basis);
    const criticalMissingEvidence = unit.missing_evidence.some((item) => item.critical === true);
    return categoryMaterial || criticalMissingEvidence;
  })
  .map((unit) => unit.requirement_id)
  .sort();
assert.deepEqual(
  humanQuestionIds,
  independentMaterialExceptionIds,
  'human questions must equal the envelope-derived material-exception set (independent of the driver predicate)',
);
assert.ok(
  independentMaterialExceptionIds.length >= 2,
  'count-equality must be non-trivial: strictly more than one material exception is surfaced',
);

// Ground-truth tie: the synthetic responder stamps critical missing evidence on exactly the
// governed financial_execution units; verify against the real envelope's governed categories.
const envelopeCriticalUnitIds = result.envelope.integral_analysis.analysis_units
  .filter((unit) => unit.missing_evidence.some((item) => item.critical === true))
  .map((unit) => unit.requirement_id)
  .sort();
const envelopeFinancialUnitIds = result.envelope.integral_analysis.analysis_units
  .filter((unit) => unit.category === 'financial_execution')
  .map((unit) => unit.requirement_id)
  .sort();
assert.deepEqual(
  envelopeCriticalUnitIds,
  envelopeFinancialUnitIds,
  'critical missing evidence must land on exactly the governed financial_execution units',
);
assert.deepEqual(humanQuestionIds, envelopeCriticalUnitIds, 'human questions cover exactly the envelope units carrying critical missing evidence');

// The material-exception predicate is the sole gate for emission: emitted iff material exception.
const unitByRequirementId = new Map(
  result.envelope.integral_analysis.analysis_units.map((unit) => [unit.requirement_id, unit]),
);
const emittedIds = new Set(humanQuestionIds);
for (const unit of result.envelope.integral_analysis.analysis_units) {
  const isMaterialException = isAgt002ManizalesV3MaterialExceptionUnit(unit, result.manifestEntryByRequirementId);
  assert.equal(
    emittedIds.has(unit.requirement_id),
    isMaterialException,
    `question emission for ${unit.requirement_id} must equal its material-exception status`,
  );
}
for (const question of result.humanQuestions) {
  const unit = unitByRequirementId.get(question.requirement_id);
  assert.ok(unit, 'every human question references an analyzed unit');
  assert.ok(
    isAgt002ManizalesV3MaterialExceptionUnit(unit, result.manifestEntryByRequirementId),
    `human question ${question.requirement_id} must be a material exception`,
  );
  // Each material exception here arises from critical missing evidence: no analyzable manifest
  // entry is classified in the closed material-impediment catalog.
  assert.equal(question.basis, 'critical_missing_evidence');
  assert.ok(question.missing_evidence_ids.length >= 1);
}

// Honest documentation of the material-impediment-category branch: it is empty for this pilot
// (no analyzable requirement is classified 'material'), so every material exception is a
// critical-missing-evidence one. The closed catalog itself is non-empty and referenced.
assert.ok(AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES.length >= 1);
assert.equal(result.materialImpedimentCategoryExceptionCount, 0);
assert.equal(result.criticalMissingEvidenceExceptionCount, result.humanQuestions.length);

// Contrast with the naive v2 projection: because every unit abstains, the deterministic v2
// projection emits exactly one question per requirement — which is precisely the one-per-
// requirement noise the material-exception filter above removes.
assert.equal(result.envelope.v2_projection.questions.length, result.orderedRequirementIds.length);
assert.equal(result.naiveProjectionQuestionCount, 20);
assert.ok(result.humanQuestions.length < result.naiveProjectionQuestionCount);

// ---------------------------------------------------------------------------------------------
// 4. Each manifest evidence_class_id resolves against the 17 production evidence classes.
// ---------------------------------------------------------------------------------------------
assert.equal(AGT002_COMPANY_EVIDENCE_CLASS_IDS.length, 17);
assert.equal(result.canonicalEvidenceClassCount, 17);
assert.ok(result.evidenceClassResolution.resolved.length >= 1);
for (const resolved of result.evidenceClassResolution.resolved) {
  assert.equal(resolved.in_catalog, true, `${resolved.evidence_class_id} must resolve against the 17 classes`);
  assert.ok(AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(resolved.evidence_class_id));
}
assert.deepEqual(result.evidenceClassResolution.unresolved, [], 'no manifest evidence_class_id is outside the catalog');

// ---------------------------------------------------------------------------------------------
// 5. Zero persistence, no DB, exactly one synthetic provider call.
// ---------------------------------------------------------------------------------------------
assert.equal(result.providerCallCount, 1, 'exactly one engine.analyze -> one synthetic provider call');
assert.equal(result.persistenceRpcCount, 0, 'the driver performs zero persistence RPC calls');
assert.equal(result.persistedRecordCount, 0, 'the driver persists zero records');
// The persistence counters are MEASURED off a real trapped boundary, not literals: prove the
// trap is load-bearing (any rpc/persistence through the injected client is counted AND throws).
const probeResponder = buildManizalesV3SyntheticResponder();
assert.equal(probeResponder.rpcCalls.length, 0);
await assert.rejects(() => probeResponder.rpc('psi_record_agt002_canonical_analysis_run'), /prohibido/);
assert.equal(probeResponder.rpcCalls.length, 1, 'a routed rpc is really counted, so the run\'s 0 is a measurement');

// ---------------------------------------------------------------------------------------------
// 6. Sanitized metadata only: no open PII, no raw-content keys.
// ---------------------------------------------------------------------------------------------
assertNoOpenPii(result.sanitizedSummary);
const serialized = JSON.stringify(result.sanitizedSummary);
assert.doesNotMatch(
  serialized,
  /"(quote|excerpt|text|source_text_by_document_id|content|extracted_text)"\s*:/,
  'the sanitized summary must not carry any raw-content key',
);

console.log('agt002-manizales-v3-local-run integration: OK');
