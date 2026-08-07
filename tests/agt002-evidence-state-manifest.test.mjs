import { strict as assert } from 'node:assert';
import {
  AGT002_EVIDENCE_STATE_SAFE_UNKNOWN,
  buildAgt002EvidenceStateManifest,
} from '../agt002-evidence-state-manifest.js';
import { buildAgt002CompanyEvidenceClasses } from '../agt002-company-evidence-classes.js';

// ---------------------------------------------------------------------------
// Gap closed here (audit P0 "cumplimiento inferido por presencia" / the five-axis
// origin gap): evidence_state must NEVER be free model output. Each requirement links to
// at most one real company-evidence class via an explicit, curated
// evidenceClassLinkByRequirementId — never guessed. No link, or a link whose class was
// never observed in this run, abstains to the safe-unknown state. Every axis reads its
// own independent governed column; none is ever derived from another (in particular,
// never inferred purely from documentary presence). `compliance` never leaves "unknown":
// there is no real write path for it yet (agt002-company-evidence-classes.js), so no
// rule here may promote it off abstention.
// ---------------------------------------------------------------------------

const REQUIREMENT_MANIFEST = [
  { requirement_id: 'REQ-LINKED', category: 'habilitating' },
  { requirement_id: 'REQ-UNLINKED', category: 'technical' },
];

function run() {
  // No governed link at all -> every requirement abstains to the exact safe-unknown
  // state, never partially mutated, never guessed from anything else in the manifest.
  {
    const result = buildAgt002EvidenceStateManifest(REQUIREMENT_MANIFEST);
    assert.equal(result.length, 2);
    for (const entry of result) {
      assert.deepEqual(entry.evidence_state, AGT002_EVIDENCE_STATE_SAFE_UNKNOWN);
      assert.equal(entry.rule_id, 'no_governed_evidence_class_link');
      assert.equal(entry.provenance, null);
    }
  }

  // A governed link to a real catalog class that this run's evidenceClasses list simply
  // never included (e.g. the caller only fetched a subset) also abstains — absence of
  // *signal* in this run, not absence of *governance*, still resolves safely rather than
  // throwing.
  {
    const result = buildAgt002EvidenceStateManifest(REQUIREMENT_MANIFEST, {
      evidenceClasses: [],
      evidenceClassLinkByRequirementId: { 'REQ-LINKED': 'rup' },
    });
    const linked = result.find(entry => entry.requirement_id === 'REQ-LINKED');
    assert.deepEqual(linked.evidence_state, AGT002_EVIDENCE_STATE_SAFE_UNKNOWN);
    assert.equal(linked.rule_id, 'linked_evidence_class_not_observed');
    assert.equal(linked.provenance.evidence_class_id, 'rup');

    const unlinked = result.find(entry => entry.requirement_id === 'REQ-UNLINKED');
    assert.deepEqual(unlinked.evidence_state, AGT002_EVIDENCE_STATE_SAFE_UNKNOWN);
    assert.equal(unlinked.rule_id, 'no_governed_evidence_class_link');
  }

  // The real 17-class catalog builder always returns a stub for every catalog id, even
  // when the registry row is absent (agt002-company-evidence-classes.js's
  // buildMissingClass) — a governed link to such a stub still derives its axes from that
  // stub's own real columns (not_verified/pending_human_review/unknown/...), proving the
  // four axes are read independently even for a "missing" class, never collapsed into a
  // convenience shortcut.
  {
    const { classes } = buildAgt002CompanyEvidenceClasses({ registryEntries: [] });
    const result = buildAgt002EvidenceStateManifest(REQUIREMENT_MANIFEST, {
      evidenceClasses: classes,
      evidenceClassLinkByRequirementId: { 'REQ-LINKED': 'rup' },
    });
    const linked = result.find(entry => entry.requirement_id === 'REQ-LINKED');
    assert.equal(linked.evidence_state.presence, 'absent');
    assert.equal(linked.evidence_state.review, 'not_reviewed');
    assert.equal(linked.evidence_state.validity, 'unknown');
    assert.equal(linked.evidence_state.applicability, 'unknown');
    assert.equal(linked.evidence_state.compliance, 'unknown');
    assert.equal(linked.rule_id, 'company_evidence_class_axis_projection');
    assert.equal(linked.provenance.evidence_class_id, 'rup');
  }

  // A governed link to a class that IS observed and verified: each axis is read from its
  // own independent DB-backed column (presence/review/validity/applicability), and
  // compliance still never leaves "unknown" (no real write path exists for it).
  {
    const asOf = new Date('2026-08-07T00:00:00.000Z');
    const { classes } = buildAgt002CompanyEvidenceClasses({
      asOf,
      registryEntries: [{
        entry_id: 'rup', document_class: 'RUP', existence_status: 'verified',
        human_review_status: 'approved', applicability_status: 'applicable',
        integration_active: true, expiry: '2030-01-01', updated_at: '2026-01-01T00:00:00.000Z',
      }],
    });
    const result = buildAgt002EvidenceStateManifest(REQUIREMENT_MANIFEST, {
      evidenceClasses: classes,
      evidenceClassLinkByRequirementId: { 'REQ-LINKED': 'rup' },
    });
    const linked = result.find(entry => entry.requirement_id === 'REQ-LINKED');
    assert.deepEqual(linked.evidence_state, {
      presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'unknown',
    });
    assert.equal(linked.provenance.evidence_class_id, 'rup');
    assert.ok(linked.provenance.source);
  }

  // Presence never mutates the other axes: a class reported present but never reviewed,
  // with unknown validity and pending applicability, must keep every axis independent —
  // not silently upgraded because presence is favorable.
  {
    const { classes } = buildAgt002CompanyEvidenceClasses({
      registryEntries: [{
        entry_id: 'rut', document_class: 'RUT', existence_status: 'reported',
        human_review_status: 'pending_human_review', applicability_status: 'pending_case_validation',
        integration_active: true, expiry: null, updated_at: '2026-01-01T00:00:00.000Z',
      }],
    });
    const result = buildAgt002EvidenceStateManifest(
      [{ requirement_id: 'REQ-RUT', category: 'habilitating' }],
      { evidenceClasses: classes, evidenceClassLinkByRequirementId: { 'REQ-RUT': 'rut' } },
    );
    assert.deepEqual(result[0].evidence_state, {
      presence: 'present', review: 'not_reviewed', validity: 'unknown', applicability: 'unknown', compliance: 'unknown',
    });
  }

  // A governed link pointing outside the real 17-class catalog is a configuration/
  // governance error (not an absence-of-signal case) and must fail closed, never guess.
  assert.throws(
    () => buildAgt002EvidenceStateManifest(REQUIREMENT_MANIFEST, {
      evidenceClassLinkByRequirementId: { 'REQ-LINKED': 'not-a-real-class' },
    }),
    /catálogo|no es un identificador|clase de evidencia/i,
  );

  // A requirement without a requirement_id is rejected rather than silently skipped.
  assert.throws(() => buildAgt002EvidenceStateManifest([{ category: 'technical' }]), /requirement_id/i);

  // The exported safe-unknown constant is exactly the state the spec requires and is
  // frozen (structural guard against accidental future mutation).
  assert.deepEqual(AGT002_EVIDENCE_STATE_SAFE_UNKNOWN, {
    presence: 'unknown', review: 'not_reviewed', validity: 'unknown', applicability: 'unknown', compliance: 'unknown',
  });
  assert.ok(Object.isFrozen(AGT002_EVIDENCE_STATE_SAFE_UNKNOWN));

  console.log('agt002-evidence-state-manifest fail-closed derivation passed');
}

run();
