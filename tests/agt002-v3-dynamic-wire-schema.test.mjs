import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgt002IntegralAnalysisV3OutputJsonSchema } from '../agt002-preview-contract.js';

const validationContext = {
  requirementManifest: [
    { requirement_id: 'REQ-1', category: 'discard' },
    { requirement_id: 'REQ-2', category: 'habilitating' },
  ],
  companyEvidenceClassIds: ['rup', 'licenses'],
  allowlist: {
    tender_document: ['document:doc-1'],
    company_evidence: ['company:rup-1'],
    legal_corpus: ['legal:rule-1'],
    human_evidence: ['human:answer-1'],
    objective_validation: ['objective:REQ-1:amount'],
  },
};

function unitSchema(schema) {
  return schema.properties.integral_analysis.properties.analysis_units.items;
}

test('V3 wire schema binds every model-supplied reference to governed allowlists', () => {
  const schema = buildAgt002IntegralAnalysisV3OutputJsonSchema(validationContext);
  const unit = unitSchema(schema);

  assert.deepEqual(
    unit.properties.requirement_id,
    { type: 'string', enum: ['REQ-1', 'REQ-2'] },
  );

  const evidenceRef = unit.properties.evidence_refs.items;
  assert.ok(Array.isArray(evidenceRef.anyOf), 'evidence_refs must use governed source/ref branches');
  const bySource = new Map(evidenceRef.anyOf.map(branch => [branch.properties.source_type.const, branch]));
  assert.deepEqual(bySource.get('tender_document').properties.ref.enum, ['document:doc-1']);
  assert.deepEqual(bySource.get('company_evidence').properties.ref.enum, ['company:rup-1']);
  assert.deepEqual(bySource.get('legal_corpus').properties.ref.enum, ['legal:rule-1']);
  assert.deepEqual(bySource.get('human_evidence').properties.ref.enum, ['human:answer-1']);
  assert.deepEqual(bySource.get('objective_validation').properties.ref.enum, ['objective:REQ-1:amount']);
  assert.equal(JSON.stringify(evidenceRef).includes('invented-ref'), false);

  assert.deepEqual(
    unit.properties.missing_evidence.items.properties.evidence_class_id,
    { anyOf: [{ type: 'string', enum: ['licenses', 'rup'] }, { type: 'null' }] },
  );
  assert.deepEqual(unit.properties.legal_assessment.properties.basis_refs.items.enum, ['legal:rule-1']);

  // AGT-002 milestone wire-contract hotfix: milestone is now a closed, status-discriminated
  // anyOf (see buildV3MilestoneSchema in agt002-preview-contract.js) instead of a flat object,
  // so status <-> at/source_ref combinations the validator rejects are structurally unrepresentable.
  assert.ok(Array.isArray(unit.properties.milestone.anyOf), 'milestone must be a discriminated union');
  const milestoneBranches = new Map(unit.properties.milestone.anyOf.map(branch => [branch.properties.status.const, branch]));
  assert.deepEqual([...milestoneBranches.keys()].sort(), ['not_identified', 'unverified', 'verified']);
  assert.deepEqual(
    milestoneBranches.get('unverified').properties.source_ref,
    {
      anyOf: [
        { type: 'string', enum: ['document:doc-1', 'human:answer-1', 'legal:rule-1', 'objective:REQ-1:amount'] },
        { type: 'null' },
      ],
    },
  );
  assert.deepEqual(
    milestoneBranches.get('verified').properties.source_ref,
    { type: 'string', enum: ['document:doc-1', 'human:answer-1', 'legal:rule-1', 'objective:REQ-1:amount'] },
  );
  // AGT-002 milestone wire-contract hotfix: `at` now pins the documented OpenAI Structured
  // Outputs `format: 'date-time'` keyword, so a schema-valid non-date string (e.g. "tbd") can
  // no longer satisfy the wire schema and later fail validateMilestone's Date.parse check.
  assert.deepEqual(milestoneBranches.get('verified').properties.at, { type: 'string', format: 'date-time', minLength: 1, maxLength: 120 });
  assert.deepEqual(
    milestoneBranches.get('unverified').properties.at,
    {
      anyOf: [
        { type: 'string', format: 'date-time', minLength: 1, maxLength: 120 },
        { type: 'null' },
      ],
    },
  );
  assert.deepEqual(milestoneBranches.get('not_identified').properties.at, { type: 'null' });
  assert.deepEqual(milestoneBranches.get('not_identified').properties.source_ref, { type: 'null' });
});

test('V3 wire schema closes reference arrays when a governed allowlist is empty', () => {
  const schema = buildAgt002IntegralAnalysisV3OutputJsonSchema({
    requirementManifest: [{ requirement_id: 'REQ-1', category: 'discard' }],
    companyEvidenceClassIds: [],
    allowlist: {
      tender_document: [], company_evidence: [], legal_corpus: [], human_evidence: [], objective_validation: [],
    },
  });
  const unit = unitSchema(schema);
  assert.equal(unit.properties.evidence_refs.maxItems, 0);
  assert.equal(unit.properties.legal_assessment.properties.basis_refs.maxItems, 0);
  // "verified" is dropped entirely when no allowlisted source_ref exists (it would be
  // unsatisfiable — validateMilestone always rejects a null source_ref for "verified").
  const milestoneBranches = new Map(unit.properties.milestone.anyOf.map(branch => [branch.properties.status.const, branch]));
  assert.deepEqual([...milestoneBranches.keys()].sort(), ['not_identified', 'unverified']);
  assert.deepEqual(milestoneBranches.get('unverified').properties.source_ref, { type: 'null' });
  assert.deepEqual(unit.properties.missing_evidence.items.properties.evidence_class_id, { type: 'null' });

  const emptyManifestSchema = buildAgt002IntegralAnalysisV3OutputJsonSchema({
    requirementManifest: [],
    companyEvidenceClassIds: [],
    allowlist: {
      tender_document: [], company_evidence: [], legal_corpus: [], human_evidence: [], objective_validation: [],
    },
  });
  assert.deepEqual(unitSchema(emptyManifestSchema).properties.requirement_id, { type: 'null' });
});
