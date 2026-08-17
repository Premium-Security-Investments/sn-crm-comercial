import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
  AGT002_INTEGRAL_UNIT_KINDS,
  AGT002_INTEGRAL_CATEGORIES,
  AGT002_INTEGRAL_ASSESSMENT_MODES,
  AGT002_INTEGRAL_CONCLUSION_STATUSES,
  AGT002_INTEGRAL_CONFIDENCE_LEVELS,
  AGT002_INTEGRAL_BLOCKING_EFFECTS,
  AGT002_INTEGRAL_BLOCKING_CURABILITY,
  AGT002_INTEGRAL_PRESENCE_STATES,
  AGT002_INTEGRAL_REVIEW_STATES,
  AGT002_INTEGRAL_VALIDITY_STATES,
  AGT002_INTEGRAL_APPLICABILITY_STATES,
  AGT002_INTEGRAL_COMPLIANCE_STATES,
  AGT002_INTEGRAL_SOURCE_TYPES,
  AGT002_INTEGRAL_EVIDENCE_PURPOSES,
  AGT002_INTEGRAL_COMMERCIAL_IMPACT_LEVELS,
  AGT002_INTEGRAL_COMMERCIAL_IMPACT_DIMENSIONS,
  AGT002_INTEGRAL_LEGAL_STATUSES,
  AGT002_INTEGRAL_ACTION_TYPES,
  AGT002_INTEGRAL_SUGGESTED_ROLES,
  AGT002_INTEGRAL_ACTION_PRIORITIES,
  AGT002_INTEGRAL_MILESTONE_STATUSES,
  AGT002_INTEGRAL_MILESTONE_TYPES,
  AGT002_INTEGRAL_ESCALATION_LEVELS,
  AGT002_INTEGRAL_CLOSURE_STATUSES,
} from '../agt002-integral-analysis-v3.js';
import { validateAgt002ManifestScope } from '../agt002-tender-adapter.js';
import { AGT002_PROCESS_PACKAGE_KEYS, validateAgt002ProcessPackage } from '../agt002-process-package.js';
import { deriveAgt002ManizalesManifestScope } from '../agt002-manizales-manifest-wiring.js';
import { AGT002_MANIZALES_PROCESS_PACKAGE, AGT002_MANIZALES_CHECKED_IN_MANIFEST } from '../agt002-manizales-manifest-source.js';

// Phase 9 (T4): the checked-in JSON Schemas under contracts/agents/AGT-002/v3/ must MIRROR the
// JS runtime contract, never diverge from it. This agreement test ties every enum and closed key
// set in those schemas to the exported JS constants / runtime validators, so a change on one side
// that is not mirrored on the other fails the build. It does NOT change the runtime contract.
// Nothing here touches production, network or DB.

function loadSchema(name) {
  return JSON.parse(readFileSync(new URL(`../contracts/agents/AGT-002/v3/${name}`, import.meta.url), 'utf8'));
}

const envelope = loadSchema('envelope.schema.json');
const integral = loadSchema('integral-analysis.schema.json');
const manifestScopeSchema = loadSchema('manifest-scope.schema.json');
const processPackageSchema = loadSchema('process-package.schema.json');
const manifest = loadSchema('manifest.json');

const sorted = (array) => [...array].sort();

// -----------------------------------------------------------------------------
// Every object node that declares `properties` must be closed (additionalProperties:false).
// -----------------------------------------------------------------------------
function assertClosedObjects(node, path) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => assertClosedObjects(child, `${path}[${index}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (Object.hasOwn(node, 'properties')) {
    assert.equal(node.additionalProperties, false, `object schema at ${path} must set additionalProperties:false`);
  }
  for (const [key, child] of Object.entries(node)) {
    assertClosedObjects(child, `${path}.${key}`);
  }
}
for (const [name, schema] of [
  ['envelope', envelope], ['integral', integral], ['manifest-scope', manifestScopeSchema], ['process-package', processPackageSchema],
]) {
  assertClosedObjects(schema, name);
}

// -----------------------------------------------------------------------------
// integral_analysis: closed key sets equal the JS key sets (agt002-integral-analysis-v3.js:88-109).
// -----------------------------------------------------------------------------
{
  assert.equal(integral.properties.contract_version.const, AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION);
  assert.deepEqual(sorted(integral.required), sorted(['contract_version', 'coverage', 'analysis_units']));
  assert.deepEqual(sorted(integral.properties.coverage.required), sorted([
    'manifest_version', 'expected_requirement_ids', 'analyzed_requirement_ids', 'material_omissions',
    'omission_reasons', 'company_evidence_manifest_version', 'company_evidence_class_ids', 'legal_corpus_version_id',
  ]));
  const unit = integral.$defs.unit;
  assert.deepEqual(sorted(unit.required), sorted([
    'unit_id', 'unit_kind', 'requirement_id', 'category', 'sequence', 'title', 'assessment_mode',
    'conclusion', 'blocking', 'evidence_state', 'evidence_refs', 'missing_evidence', 'commercial_impact',
    'legal_assessment', 'actions', 'milestone', 'escalation', 'closure', 'human_validation',
  ]));
}

// -----------------------------------------------------------------------------
// integral_analysis: every enum equals its exported JS constant (the real drift risk).
// -----------------------------------------------------------------------------
{
  const p = integral.$defs.unit.properties;
  const enumChecks = [
    [p.unit_kind.enum, AGT002_INTEGRAL_UNIT_KINDS],
    [p.category.enum.filter(v => v !== null), AGT002_INTEGRAL_CATEGORIES],
    [p.assessment_mode.enum, AGT002_INTEGRAL_ASSESSMENT_MODES],
    [p.conclusion.properties.status.enum, AGT002_INTEGRAL_CONCLUSION_STATUSES],
    [p.conclusion.properties.confidence.enum, AGT002_INTEGRAL_CONFIDENCE_LEVELS],
    [p.blocking.properties.effect.enum, AGT002_INTEGRAL_BLOCKING_EFFECTS],
    [p.blocking.properties.curability.enum, AGT002_INTEGRAL_BLOCKING_CURABILITY],
    [p.evidence_state.properties.presence.enum, AGT002_INTEGRAL_PRESENCE_STATES],
    [p.evidence_state.properties.review.enum, AGT002_INTEGRAL_REVIEW_STATES],
    [p.evidence_state.properties.validity.enum, AGT002_INTEGRAL_VALIDITY_STATES],
    [p.evidence_state.properties.applicability.enum, AGT002_INTEGRAL_APPLICABILITY_STATES],
    [p.evidence_state.properties.compliance.enum, AGT002_INTEGRAL_COMPLIANCE_STATES],
    [p.evidence_refs.items.properties.source_type.enum, AGT002_INTEGRAL_SOURCE_TYPES],
    [p.evidence_refs.items.properties.purpose.enum, AGT002_INTEGRAL_EVIDENCE_PURPOSES],
    [p.missing_evidence.items.properties.needed_source_type.enum, AGT002_INTEGRAL_SOURCE_TYPES],
    [p.commercial_impact.properties.level.enum, AGT002_INTEGRAL_COMMERCIAL_IMPACT_LEVELS],
    [p.commercial_impact.properties.dimension.enum, AGT002_INTEGRAL_COMMERCIAL_IMPACT_DIMENSIONS],
    [p.legal_assessment.properties.status.enum, AGT002_INTEGRAL_LEGAL_STATUSES],
    [p.actions.items.properties.action_type.enum, AGT002_INTEGRAL_ACTION_TYPES],
    [p.actions.items.properties.suggested_role.enum, AGT002_INTEGRAL_SUGGESTED_ROLES],
    [p.actions.items.properties.priority.enum, AGT002_INTEGRAL_ACTION_PRIORITIES],
    [p.milestone.properties.status.enum, AGT002_INTEGRAL_MILESTONE_STATUSES],
    [p.milestone.properties.type.enum, AGT002_INTEGRAL_MILESTONE_TYPES],
    [p.escalation.properties.level.enum, AGT002_INTEGRAL_ESCALATION_LEVELS],
    [p.closure.properties.status.enum, AGT002_INTEGRAL_CLOSURE_STATUSES],
  ];
  for (const [schemaEnum, jsConst] of enumChecks) {
    assert.deepEqual(schemaEnum, [...jsConst], `enum drift: ${JSON.stringify(schemaEnum)} != ${JSON.stringify([...jsConst])}`);
  }
}

// -----------------------------------------------------------------------------
// Envelope: closed key set + server-owned literals match validateAgt002TenderAnalysisEnvelopeV3
// (agt002-tender-adapter.js:139-258).
// -----------------------------------------------------------------------------
{
  assert.deepEqual(sorted(envelope.required), sorted([
    'schema_version', 'agent_id', 'run_id', 'policy_version', 'snapshot_id', 'context_version_id',
    'status', 'method', 'integral_analysis', 'evidence_coverage', 'legal_corpus_version_id',
    'human_review_required', 'v2_projection', 'usage',
  ]));
  assert.equal(envelope.properties.schema_version.const, '3.0.0');
  assert.equal(envelope.properties.agent_id.const, 'AGT-002');
  assert.equal(envelope.properties.status.const, 'completed');
  assert.equal(envelope.properties.method.const, 'agent_ai');
  assert.equal(envelope.properties.human_review_required.const, true);
  assert.deepEqual(sorted(envelope.properties.usage.required), sorted(['provider', 'model', 'input_tokens', 'output_tokens', 'rate_limit']));
  // manifest_scope is an optional server-owned addition, referencing the scope schema.
  assert.equal(envelope.properties.manifest_scope.$ref, 'manifest-scope.schema.json');
  assert.equal(envelope.required.includes('manifest_scope'), false, 'manifest_scope must be optional, not base-required');
  // The projected v2 surface documents the critical-questions subset alongside the full list.
  assert.ok(envelope.properties.v2_projection.required.includes('questions'));
  assert.ok(envelope.properties.v2_projection.required.includes('critical_questions'));
}

// -----------------------------------------------------------------------------
// manifest_scope: the real derived Manizales scope validates against the JS validator AND has
// exactly the schema's closed key set.
// -----------------------------------------------------------------------------
{
  const derived = deriveAgt002ManizalesManifestScope(AGT002_MANIZALES_CHECKED_IN_MANIFEST);
  const jsValidated = validateAgt002ManifestScope(derived);
  assert.deepEqual(sorted(Object.keys(jsValidated)), sorted(manifestScopeSchema.required));
  assert.deepEqual(sorted(Object.keys(jsValidated.dispositions)), sorted(manifestScopeSchema.properties.dispositions.required));
  // Every schema-required scope key is actually present on the governed object.
  for (const key of manifestScopeSchema.required) {
    assert.ok(Object.hasOwn(jsValidated, key), `derived scope missing schema key ${key}`);
  }
}

// -----------------------------------------------------------------------------
// process_package: schema key set equals the JS key set and the real Manizales package + the
// checked-in template both agree with the JS validator.
// -----------------------------------------------------------------------------
{
  assert.deepEqual(sorted(processPackageSchema.required), sorted([...AGT002_PROCESS_PACKAGE_KEYS]));
  assert.equal(processPackageSchema.properties.schema_version.const, 'agt002-process-package@1');
  // The real Manizales package validates through the JS validator and carries exactly these keys.
  const validated = validateAgt002ProcessPackage(AGT002_MANIZALES_PROCESS_PACKAGE);
  assert.deepEqual(sorted(Object.keys(validated)), sorted(processPackageSchema.required));
  const template = JSON.parse(readFileSync(
    new URL('../data/agt002/processes/_template/process.package.template.json', import.meta.url), 'utf8'));
  const validatedTemplate = validateAgt002ProcessPackage(template);
  assert.deepEqual(sorted(Object.keys(validatedTemplate)), sorted(processPackageSchema.required));
}

// -----------------------------------------------------------------------------
// manifest.json lists exactly the four schema files.
// -----------------------------------------------------------------------------
{
  assert.equal(manifest.agent_id, 'AGT-002');
  assert.equal(manifest.contract_version, '3.0.0');
  assert.deepEqual(sorted(manifest.schemas.map(s => s.file)), sorted([
    'envelope.schema.json', 'integral-analysis.schema.json', 'manifest-scope.schema.json', 'process-package.schema.json',
  ]));
}

console.log('agt002-v3-contract-json-agreement: OK');
