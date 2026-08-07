import { strict as assert } from 'node:assert';
import {
  AGT002_INTEGRAL_GOVERNANCE_CATEGORIES,
  AGT002_INTEGRAL_GOVERNANCE_OVERRIDE_KINDS,
  buildAgt002IntegralGovernanceOverrides,
  loadAgt002IntegralGovernanceOverrides,
  validateAgt002IntegralGovernanceProvenance,
} from '../agt002-integral-governance-overrides.js';

// ---------------------------------------------------------------------------
// Governed source for the v3 engine's two curated maps (agt002-preview-engine.js):
// categoryOverrides (agt002-integral-category-manifest.js) and
// evidenceClassLinkByRequirementId (agt002-evidence-state-manifest.js). Neither map may
// ever be guessed from keyword matching, document presence or intuition — every entry
// must carry a rationale, a traceable source_reference and a curator identity, or it is
// rejected. Scoped per opportunity_id (requirement_id is not globally stable across
// opportunities — agt002-deep-analysis-matrix.js).
// ---------------------------------------------------------------------------

assert.deepEqual([...AGT002_INTEGRAL_GOVERNANCE_CATEGORIES].sort(), ['discard', 'financial_execution', 'habilitating', 'technical']);
assert.deepEqual([...AGT002_INTEGRAL_GOVERNANCE_OVERRIDE_KINDS].sort(), ['category_override', 'evidence_class_link']);

function categoryRow(overrides = {}) {
  return {
    requirement_id: 'req-legal-1',
    override_kind: 'category_override',
    category_value: 'habilitating',
    evidence_class_id: null,
    rationale: 'El pliego clasifica esta cláusula como causal de rechazo, no como requisito técnico.',
    source_reference: 'pliego:seccion-3.2:causales-de-rechazo',
    curated_by: '10101010-1010-4010-8010-101010101010',
    curated_at: '2026-08-07T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function linkRow(overrides = {}) {
  return {
    requirement_id: 'req-license-1',
    override_kind: 'evidence_class_link',
    category_value: null,
    evidence_class_id: 'supervigilancia_operating_license',
    rationale: 'El requisito exige la licencia de funcionamiento vigente exigida por el pliego.',
    source_reference: 'pliego:anexo-1:requisitos-habilitantes-juridicos',
    curated_by: '10101010-1010-4010-8010-101010101010',
    curated_at: '2026-08-07T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

// --- Happy path: builds both maps from curated rows, keeps traceable provenance. ---
{
  const result = buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow(), linkRow()] });
  assert.deepEqual(result.categoryOverrides, { 'req-legal-1': 'habilitating' });
  assert.deepEqual(result.evidenceClassLinkByRequirementId, { 'req-license-1': 'supervigilancia_operating_license' });
  assert.equal(result.provenance['category_override:req-legal-1'].rationale, categoryRow().rationale);
  assert.equal(result.provenance['category_override:req-legal-1'].source_reference, categoryRow().source_reference);
  assert.equal(result.provenance['evidence_class_link:req-license-1'].evidence_class_id, 'supervigilancia_operating_license');
  // P2-1: binding/versioning/provenance must be preserved, not dropped — a curated link's
  // class, rationale and version must all be traceable from the built provenance record.
  assert.equal(result.provenance['category_override:req-legal-1'].version, 1);
  assert.equal(result.provenance['category_override:req-legal-1'].curated_at, categoryRow().curated_at);
  assert.equal(result.provenance['evidence_class_link:req-license-1'].version, 1);
  assert.equal(result.provenance['evidence_class_link:req-license-1'].rationale, linkRow().rationale);
  assert.equal(Object.isFrozen(result.provenance['category_override:req-legal-1']), true);
  assert.equal(Object.isFrozen(result.provenance['evidence_class_link:req-license-1']), true);
}

// --- Empty input is safe: both maps default empty, matching the engine's own defaults. ---
{
  const result = buildAgt002IntegralGovernanceOverrides({ overrideEntries: [] });
  assert.deepEqual(result.categoryOverrides, {});
  assert.deepEqual(result.evidenceClassLinkByRequirementId, {});
}
assert.deepEqual(buildAgt002IntegralGovernanceOverrides().categoryOverrides, {});

// --- Fail-closed: invalid/missing fields never become a silent guess. ---
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ category_value: 'compliant' })] }), /category_value/i);
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [linkRow({ evidence_class_id: 'not_a_real_class' })] }), /catálogo|class|evidence_class_id/i);
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ override_kind: 'not_a_real_kind' })] }), /override_kind/i);
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ requirement_id: '' })] }), /requirement_id/i);
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ rationale: '' })] }), /rationale/i, 'a row without a real rationale must never be accepted — this is exactly the fabrication this table exists to prevent');
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ source_reference: '   ' })] }), /source_reference/i);
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ curated_by: null })] }), /curated_by/i);

// P2-3: curated_at null (or otherwise missing/invalid) must fail closed — it must never
// silently default to null and be persisted as an ungoverned/untraceable curation date.
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ curated_at: null })] }), /curated_at/i, 'a null curated_at must fail closed, never silently default');
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ curated_at: undefined })] }), /curated_at/i);
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ curated_at: '' })] }), /curated_at/i);
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ curated_at: 'not-a-real-timestamp' })] }), /curated_at/i);

// P2-1: version must be loaded/required and preserved, never silently omitted.
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ version: null })] }), /version/i);
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ version: 0 })] }), /version/i);
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ version: 1.5 })] }), /version/i);
assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ version: '1' })] }), /version/i);

// A category_override row must never carry an evidence_class_id, and vice versa — the
// same discipline the DB check constraint enforces, mirrored in the pure builder so
// malformed rows fail before ever reaching a DB round-trip.
assert.throws(
  () => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow({ evidence_class_id: 'rup' })] }),
  /category_override|evidence_class_id/i,
);
assert.throws(
  () => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [linkRow({ category_value: 'technical' })] }),
  /evidence_class_link|category_value/i,
);

// Duplicate requirement_id within the same kind must fail closed — never silently pick
// the last one, which would hide a governance conflict.
assert.throws(
  () => buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow(), categoryRow({ category_value: 'technical' })] }),
  /duplicad/i,
);

// The same requirement_id may legitimately carry both a category_override and an
// evidence_class_link row (they govern independent maps).
{
  const result = buildAgt002IntegralGovernanceOverrides({
    overrideEntries: [categoryRow({ requirement_id: 'req-both' }), linkRow({ requirement_id: 'req-both' })],
  });
  assert.equal(result.categoryOverrides['req-both'], 'habilitating');
  assert.equal(result.evidenceClassLinkByRequirementId['req-both'], 'supervigilancia_operating_license');
}

// ---------------------------------------------------------------------------
// DB loader: scoped by opportunity_id + current=true, fail-soft only when the table
// itself does not exist yet (pre-064 database), and never silently swallowing any
// other error.
// ---------------------------------------------------------------------------

function fakeDatabase(rows, { capturedSelect } = {}) {
  return {
    from(table) {
      assert.equal(table, 'psi_agt002_integral_governance_overrides');
      const filters = [];
      const chain = {
        select(columns) {
          if (capturedSelect) capturedSelect.value = columns;
          return chain;
        },
        eq(key, value) { filters.push([key, value]); return chain; },
        order() { return chain; },
        then(resolve) {
          const data = rows.filter(row => filters.every(([key, value]) => row[key] === value));
          resolve({ data, error: null });
        },
      };
      return chain;
    },
  };
}

{
  const rows = [
    { ...categoryRow(), opportunity_id: 'opp-1', current: true },
    { ...linkRow(), opportunity_id: 'opp-1', current: true },
    { ...categoryRow({ requirement_id: 'req-other-opp' }), opportunity_id: 'opp-2', current: true },
    { ...categoryRow({ requirement_id: 'req-stale' }), opportunity_id: 'opp-1', current: false },
  ];
  const capturedSelect = {};
  const result = await loadAgt002IntegralGovernanceOverrides(fakeDatabase(rows, { capturedSelect }), 'opp-1');
  assert.deepEqual(result.categoryOverrides, { 'req-legal-1': 'habilitating' });
  assert.deepEqual(result.evidenceClassLinkByRequirementId, { 'req-license-1': 'supervigilancia_operating_license' });
  // P2-1: the loader must actually fetch version — without it, binding/versioning can
  // never be reconstructed downstream regardless of what the builder does with it.
  assert.match(capturedSelect.value, /(^|,)version(,|$)/, 'the DB select must fetch version so binding/versioning survives to the built provenance');
  assert.equal(result.provenance['category_override:req-legal-1'].version, 1);
}

// ---------------------------------------------------------------------------
// P2-1: validateAgt002IntegralGovernanceProvenance re-validates a persisted/serialized
// provenance map fail-closed, mirroring how agt002-preview-persistence.js never trusts an
// envelope's own copy of evidence_coverage verbatim. This is the seam persistence uses
// before storing governance_provenance on the run.
// ---------------------------------------------------------------------------
{
  const built = buildAgt002IntegralGovernanceOverrides({ overrideEntries: [categoryRow(), linkRow()] });
  assert.equal(validateAgt002IntegralGovernanceProvenance(built.provenance), built.provenance);

  assert.throws(() => validateAgt002IntegralGovernanceProvenance(null), /objeto/i);
  assert.throws(() => validateAgt002IntegralGovernanceProvenance([]), /objeto/i);
  assert.throws(
    () => validateAgt002IntegralGovernanceProvenance({
      ...built.provenance,
      'category_override:req-legal-1': { ...built.provenance['category_override:req-legal-1'], rationale: '' },
    }),
    /rationale/i,
    'a provenance record without a real rationale must never be accepted as valid',
  );
  assert.throws(
    () => validateAgt002IntegralGovernanceProvenance({ 'category_override:mismatched-key': built.provenance['category_override:req-legal-1'] }),
    /no coincide/i,
    'a key that does not match its own record content must be rejected, not silently trusted',
  );
  assert.throws(
    () => validateAgt002IntegralGovernanceProvenance({
      ...built.provenance,
      'category_override:req-legal-1': { ...built.provenance['category_override:req-legal-1'], version: undefined },
    }),
    /version/i,
  );
}

await assert.rejects(loadAgt002IntegralGovernanceOverrides(fakeDatabase([]), ''), /opportunityId/i);
await assert.rejects(loadAgt002IntegralGovernanceOverrides(fakeDatabase([]), null), /opportunityId/i);

function tableAbsentDatabase(code) {
  return {
    from(table) {
      assert.equal(table, 'psi_agt002_integral_governance_overrides');
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        order() { return chain; },
        then(resolve) { resolve({ data: null, error: { code } }); },
      };
      return chain;
    },
  };
}
{
  const result = await loadAgt002IntegralGovernanceOverrides(tableAbsentDatabase('PGRST205'), 'opp-1');
  assert.deepEqual(result.categoryOverrides, {});
  assert.deepEqual(result.evidenceClassLinkByRequirementId, {});
}
{
  const result = await loadAgt002IntegralGovernanceOverrides(tableAbsentDatabase('42P01'), 'opp-1');
  assert.deepEqual(result.categoryOverrides, {});
}
await assert.rejects(
  loadAgt002IntegralGovernanceOverrides(tableAbsentDatabase('53300'), 'opp-1'),
  error => error.code === '53300',
  'a non-table-absent error must propagate, never be treated as an empty override set',
);

console.log('AGT-002 integral v3 governance overrides (category/evidence-class curation source) passed');
