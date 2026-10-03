// AGT-002 P0-02 (RED) — neutral initial-analysis evidence package, pure logic half.
//
// Mirrors the conventions of tests/agt002-governed-document-worksets.test.mjs, but pins a
// DISTINCT, neutral module: agt002-evidence-packages.js is never imported by, and never
// imports, any agt002-reanalysis-*.js module — this package belongs to the initial-analysis
// slice (docs/agt002/initial-analysis/CURRENT.md), not the governed-workset/reanalysis slice.
// Key behavioral differences from the governed workset's normalizer/freezer this file pins:
//   - no functional package-member upper bound (only a per-BATCH cap of 12);
//   - a deterministic partition into batches of at most 12 members, correct at N=1, 12, 13,
//     and larger N, with every member appearing in exactly one batch;
//   - three distinct deterministic digests (document_manifest_hash, semantic_manifest_hash,
//     package_hash) instead of the workset's single selection_hash.
//
// Neither agt002-evidence-packages.js nor agt002-evidence-package-api.js exists yet: every
// import below fails module resolution, so every test in this file reports RED for the same
// underlying reason (missing implementation), exactly as intended for this phase.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGT002_EVIDENCE_PACKAGE_SOURCE_CLASSIFICATIONS,
  AGT002_EVIDENCE_PACKAGE_BATCH_SIZE,
  normalizeRequestedAgt002EvidencePackageMembers,
  partitionAgt002EvidencePackageBatches,
  freezeAgt002EvidencePackageEvidence,
  computeAgt002EvidencePackageDocumentManifestHash,
  computeAgt002EvidencePackageSemanticManifestHash,
  computeAgt002EvidencePackageHash,
  computeAgt002EvidencePackageIdempotencyKey,
  publicAgt002EvidencePackageSummary,
} from '../agt002-evidence-packages.js';

function hex64(label) {
  const base = Buffer.from(String(label)).toString('hex');
  return base.repeat(Math.ceil(64 / base.length)).slice(0, 64);
}

function uuid(label) {
  const hex = Buffer.from(String(label)).toString('hex').padEnd(32, '0').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const CLASSIFICATIONS = ['official', 'corporate', 'internal', 'third_party', 'draft'];

const OPPORTUNITY_ID = uuid('opportunity-1');
const OTHER_OPPORTUNITY_ID = uuid('opportunity-2');
const TENDER_ID = uuid('tender-1');
const OTHER_TENDER_ID = uuid('tender-2');

const N_LARGE = 37;
const DOC_IDS = Array.from({ length: N_LARGE }, (_, i) => uuid(`doc-version-${i + 1}`));
const EXTRACTION_IDS = Array.from({ length: N_LARGE }, (_, i) => uuid(`extraction-${i + 1}`));
const CONTENT_HASHES = Array.from({ length: N_LARGE }, (_, i) => hex64(`content-${i + 1}`));
const TEXT_HASHES = Array.from({ length: N_LARGE }, (_, i) => hex64(`text-${i + 1}`));

function buildMember(overrides = {}) {
  return {
    document_version_id: DOC_IDS[0],
    source_classification: 'official',
    inclusion_reason: 'Primary tender notice published by the contracting authority.',
    ...overrides,
  };
}

function buildEvidenceRow(overrides = {}) {
  const i = overrides.__index ?? 0;
  const row = {
    document_version_id: DOC_IDS[i],
    opportunity_id: OPPORTUNITY_ID,
    tender_id: TENDER_ID,
    current: true,
    extraction_status: 'ok',
    extraction_id: EXTRACTION_IDS[i],
    content_hash: CONTENT_HASHES[i],
    extraction_text_hash: TEXT_HASHES[i],
    ...overrides,
  };
  delete row.__index;
  return row;
}

function buildMatchedSet(n) {
  const members = [];
  const evidenceRows = [];
  for (let i = 0; i < n; i++) {
    members.push(
      buildMember({
        document_version_id: DOC_IDS[i],
        source_classification: CLASSIFICATIONS[i % CLASSIFICATIONS.length],
        inclusion_reason: `Reason ${i} for including document version ${i}.`,
      }),
    );
    evidenceRows.push(buildEvidenceRow({ __index: i }));
  }
  return { members, evidenceRows };
}

describe('AGT002_EVIDENCE_PACKAGE_SOURCE_CLASSIFICATIONS', () => {
  it('is exactly the five closed provenance classifications', () => {
    const expected = ['corporate', 'draft', 'internal', 'official', 'third_party'];
    const actual = Array.from(AGT002_EVIDENCE_PACKAGE_SOURCE_CLASSIFICATIONS).slice().sort();
    assert.deepEqual(actual, expected);
  });
});

describe('AGT002_EVIDENCE_PACKAGE_BATCH_SIZE', () => {
  it('is exactly 12', () => {
    assert.equal(AGT002_EVIDENCE_PACKAGE_BATCH_SIZE, 12);
  });
});

describe('normalizeRequestedAgt002EvidencePackageMembers — no functional package member limit', () => {
  it('accepts exactly 1 requested member', () => {
    const { members } = buildMatchedSet(1);
    assert.equal(normalizeRequestedAgt002EvidencePackageMembers(members).length, 1);
  });

  it('accepts exactly 12 requested members (one full batch)', () => {
    const { members } = buildMatchedSet(12);
    assert.equal(normalizeRequestedAgt002EvidencePackageMembers(members).length, 12);
  });

  it('accepts exactly 13 requested members — unlike the governed workset normalizer, this is NOT a ceiling', () => {
    const { members } = buildMatchedSet(13);
    assert.equal(normalizeRequestedAgt002EvidencePackageMembers(members).length, 13);
  });

  it('accepts 37 requested members, since the package has no functional member limit', () => {
    const { members } = buildMatchedSet(N_LARGE);
    assert.equal(normalizeRequestedAgt002EvidencePackageMembers(members).length, N_LARGE);
  });

  it('rejects an empty member list', () => {
    assert.throws(() => normalizeRequestedAgt002EvidencePackageMembers([]));
  });

  it('canonicalizes member order by document_version_id ascending', () => {
    const [first, second] = [DOC_IDS[0], DOC_IDS[1]].slice().sort();
    const members = [
      buildMember({ document_version_id: second, inclusion_reason: 'Second document in input order.' }),
      buildMember({ document_version_id: first, inclusion_reason: 'First document in input order.' }),
    ];
    const result = normalizeRequestedAgt002EvidencePackageMembers(members);
    assert.deepEqual(result.map((m) => m.document_version_id), [first, second]);
  });

  it('trims whitespace from inclusion_reason', () => {
    const result = normalizeRequestedAgt002EvidencePackageMembers([
      buildMember({ inclusion_reason: '   Primary tender notice.   ' }),
    ]);
    assert.equal(result[0].inclusion_reason, 'Primary tender notice.');
  });

  it('returns canonical members containing only the three normalized fields', () => {
    const result = normalizeRequestedAgt002EvidencePackageMembers([buildMember()]);
    assert.deepEqual(Object.keys(result[0]).sort(), [
      'document_version_id',
      'inclusion_reason',
      'source_classification',
    ]);
  });

  it('rejects duplicate document_version_id members', () => {
    const members = [
      buildMember({ document_version_id: DOC_IDS[0], source_classification: 'official' }),
      buildMember({ document_version_id: DOC_IDS[0], source_classification: 'draft' }),
    ];
    assert.throws(() => normalizeRequestedAgt002EvidencePackageMembers(members));
  });

  it('rejects malformed or non-UUID document_version_id values', () => {
    const malformedIds = ['not-a-uuid', '12345', '', DOC_IDS[0].replace(/-/g, ''), DOC_IDS[0].slice(0, -1)];
    for (const badId of malformedIds) {
      assert.throws(() => normalizeRequestedAgt002EvidencePackageMembers([buildMember({ document_version_id: badId })]));
    }
  });

  it('rejects an unknown source_classification', () => {
    assert.throws(() => normalizeRequestedAgt002EvidencePackageMembers([buildMember({ source_classification: 'unverified' })]));
  });

  it('rejects a blank inclusion_reason', () => {
    for (const reason of ['', '   ', '\n\t']) {
      assert.throws(() => normalizeRequestedAgt002EvidencePackageMembers([buildMember({ inclusion_reason: reason })]));
    }
  });

  it('rejects inclusion_reason longer than 500 characters', () => {
    assert.throws(() => normalizeRequestedAgt002EvidencePackageMembers([buildMember({ inclusion_reason: 'a'.repeat(501) })]));
  });

  const SERVER_OWNED_KEYS = ['actor_id', 'content_hash', 'extraction_id', 'extraction_text_hash', 'current', 'extracted_text', 'storage_path', 'batch_index'];
  for (const key of SERVER_OWNED_KEYS) {
    it(`rejects a requested member carrying the server-owned key "${key}"`, () => {
      assert.throws(() => normalizeRequestedAgt002EvidencePackageMembers([buildMember({ [key]: 'unexpected-client-supplied-value' })]));
    });
  }
});

describe('partitionAgt002EvidencePackageBatches', () => {
  function flattenBatchMembers(batches) {
    return batches.flatMap((batch) => batch.members);
  }

  it('rejects an empty member list', () => {
    assert.throws(() => partitionAgt002EvidencePackageBatches([]));
  });

  it('N=1: exactly one batch containing the single member', () => {
    const { members } = buildMatchedSet(1);
    const batches = partitionAgt002EvidencePackageBatches(members);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].batch_index, 0);
    assert.equal(batches[0].members.length, 1);
  });

  it('N=12: exactly one full batch of 12', () => {
    const { members } = buildMatchedSet(12);
    const batches = partitionAgt002EvidencePackageBatches(members);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].members.length, 12);
  });

  it('N=13: exactly two batches, sized 12 then 1', () => {
    const { members } = buildMatchedSet(13);
    const batches = partitionAgt002EvidencePackageBatches(members);
    assert.equal(batches.length, 2);
    assert.deepEqual(batches.map((b) => b.members.length), [12, 1]);
  });

  it('N=25: exactly three batches, sized 12, 12, then 1', () => {
    const { members } = buildMatchedSet(25);
    const batches = partitionAgt002EvidencePackageBatches(members);
    assert.equal(batches.length, 3);
    assert.deepEqual(batches.map((b) => b.members.length), [12, 12, 1]);
  });

  it('N=36 (an exact multiple of 12): exactly three full batches', () => {
    const { members } = buildMatchedSet(36);
    const batches = partitionAgt002EvidencePackageBatches(members);
    assert.equal(batches.length, 3);
    assert.deepEqual(batches.map((b) => b.members.length), [12, 12, 12]);
  });

  it(`N=${N_LARGE} (a larger N than any governed workset could ever accept): partitions into ceil(N/12) batches`, () => {
    const { members } = buildMatchedSet(N_LARGE);
    const batches = partitionAgt002EvidencePackageBatches(members);
    assert.equal(batches.length, Math.ceil(N_LARGE / 12));
  });

  it('no batch ever exceeds the 12-member cap, across every tested N', () => {
    for (const n of [1, 5, 11, 12, 13, 24, 25, 36, N_LARGE]) {
      const { members } = buildMatchedSet(n);
      for (const batch of partitionAgt002EvidencePackageBatches(members)) {
        assert.ok(batch.members.length <= AGT002_EVIDENCE_PACKAGE_BATCH_SIZE, `batch at N=${n} must never exceed ${AGT002_EVIDENCE_PACKAGE_BATCH_SIZE} members`);
      }
    }
  });

  it('batch_index is sequential starting at 0, across every tested N', () => {
    for (const n of [1, 13, 25, N_LARGE]) {
      const { members } = buildMatchedSet(n);
      const batches = partitionAgt002EvidencePackageBatches(members);
      assert.deepEqual(batches.map((b) => b.batch_index), batches.map((_, i) => i));
    }
  });

  it('every mandatory eligible member appears in exactly one batch, across every tested N', () => {
    for (const n of [1, 12, 13, 25, N_LARGE]) {
      const { members } = buildMatchedSet(n);
      const batches = partitionAgt002EvidencePackageBatches(members);
      const flattened = flattenBatchMembers(batches);
      assert.equal(flattened.length, n, `every one of the ${n} members must appear exactly once across all batches`);
      const seen = new Set(flattened.map((m) => m.document_version_id));
      assert.equal(seen.size, n, 'no member may be duplicated across batches');
      for (const member of members) {
        assert.ok(seen.has(member.document_version_id), `member ${member.document_version_id} must appear in some batch`);
      }
    }
  });

  it('partitions in canonical document_version_id order, independent of input order', () => {
    const { members } = buildMatchedSet(13);
    const shuffled = [...members].reverse();
    const sorted = [...members].sort((a, b) => (a.document_version_id < b.document_version_id ? -1 : 1));
    const fromSorted = partitionAgt002EvidencePackageBatches(sorted);
    const fromShuffled = partitionAgt002EvidencePackageBatches([...shuffled].sort((a, b) => (a.document_version_id < b.document_version_id ? -1 : 1)));
    assert.deepEqual(
      fromShuffled.map((b) => b.members.map((m) => m.document_version_id)),
      fromSorted.map((b) => b.members.map((m) => m.document_version_id)),
    );
  });
});

describe('freezeAgt002EvidencePackageEvidence', () => {
  it('joins requested members with evidence rows and returns canonical members, batches, and three digests', () => {
    const { members, evidenceRows } = buildMatchedSet(4);
    const result = freezeAgt002EvidencePackageEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows,
    });
    assert.equal(result.members.length, 4);
    assert.match(result.documentManifestHash, /^[0-9a-f]{64}$/);
    assert.match(result.semanticManifestHash, /^[0-9a-f]{64}$/);
    assert.match(result.packageHash, /^[0-9a-f]{64}$/);
    assert.equal(result.batches.flatMap((b) => b.members).length, 4);
  });

  it('accepts 13 requested members and produces exactly two batches — no functional package member limit', () => {
    const { members, evidenceRows } = buildMatchedSet(13);
    const result = freezeAgt002EvidencePackageEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows,
    });
    assert.equal(result.batches.length, 2);
    assert.deepEqual(result.batches.map((b) => b.members.length), [12, 1]);
  });

  it('every mandatory eligible member appears exactly once across the frozen batches', () => {
    const { members, evidenceRows } = buildMatchedSet(25);
    const result = freezeAgt002EvidencePackageEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows,
    });
    const flattenedIds = result.batches.flatMap((b) => b.members.map((m) => m.document_version_id));
    assert.equal(flattenedIds.length, 25);
    assert.equal(new Set(flattenedIds).size, 25);
    assert.deepEqual(flattenedIds.slice().sort(), result.members.map((m) => m.document_version_id).slice().sort());
  });

  it('fails closed for an evidence row belonging to a different opportunity', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, opportunity_id: OTHER_OPPORTUNITY_ID }));
    assert.throws(() => freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows: badEvidence }));
  });

  it('fails closed for an evidence row belonging to a different tender', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, tender_id: OTHER_TENDER_ID }));
    assert.throws(() => freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows: badEvidence }));
  });

  it('fails closed for a non-current evidence row', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, current: false }));
    assert.throws(() => freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows: badEvidence }));
  });

  it('fails closed when extraction_status is not "ok"', () => {
    for (const status of ['pending', 'failed', 'stale']) {
      const { members, evidenceRows } = buildMatchedSet(1);
      const badEvidence = evidenceRows.map((r) => ({ ...r, extraction_status: status }));
      assert.throws(() => freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows: badEvidence }));
    }
  });

  it('fails closed when a requested member has no matching evidence row', () => {
    const { members } = buildMatchedSet(1);
    assert.throws(() => freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows: [] }));
  });

  it('fails closed for a malformed content_hash', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, content_hash: 'not-a-hash' }));
    assert.throws(() => freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows: badEvidence }));
  });

  it('fails closed for a malformed extraction_text_hash', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, extraction_text_hash: 'zz'.repeat(32) }));
    assert.throws(() => freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows: badEvidence }));
  });
});

describe('computeAgt002EvidencePackageDocumentManifestHash', () => {
  it('is deterministic and order-independent over the frozen members', () => {
    const { members, evidenceRows } = buildMatchedSet(5);
    const frozen = freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows });
    const a = computeAgt002EvidencePackageDocumentManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: frozen.members });
    const b = computeAgt002EvidencePackageDocumentManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: [...frozen.members].reverse() });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it('changes when a member content_hash differs', () => {
    const { members, evidenceRows } = buildMatchedSet(2);
    const frozen = freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows });
    const base = computeAgt002EvidencePackageDocumentManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: frozen.members });
    const altered = frozen.members.map((m, i) => (i === 0 ? { ...m, content_hash: hex64('alternate-content') } : m));
    const changed = computeAgt002EvidencePackageDocumentManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: altered });
    assert.notEqual(base, changed);
  });

  it('changes when document_version_id differs', () => {
    const { members, evidenceRows } = buildMatchedSet(2);
    const frozen = freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows });
    const base = computeAgt002EvidencePackageDocumentManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: frozen.members });
    const altered = frozen.members.map((m, i) => (i === 0 ? { ...m, document_version_id: DOC_IDS[2] } : m));
    const changed = computeAgt002EvidencePackageDocumentManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: altered });
    assert.notEqual(base, changed);
  });

  it('does NOT change when only inclusion_reason or source_classification differs — the document manifest is identity-only', () => {
    const { members, evidenceRows } = buildMatchedSet(2);
    const frozen = freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows });
    const base = computeAgt002EvidencePackageDocumentManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: frozen.members });
    const altered = frozen.members.map((m, i) => (i === 0 ? { ...m, inclusion_reason: 'A completely different reason.', source_classification: 'draft' } : m));
    const changed = computeAgt002EvidencePackageDocumentManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: altered });
    assert.equal(base, changed);
  });
});

describe('computeAgt002EvidencePackageSemanticManifestHash', () => {
  it('is deterministic and order-independent over the frozen members', () => {
    const { members, evidenceRows } = buildMatchedSet(5);
    const frozen = freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows });
    const a = computeAgt002EvidencePackageSemanticManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: frozen.members });
    const b = computeAgt002EvidencePackageSemanticManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: [...frozen.members].reverse() });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it('changes when extraction_text_hash differs', () => {
    const { members, evidenceRows } = buildMatchedSet(2);
    const frozen = freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows });
    const base = computeAgt002EvidencePackageSemanticManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: frozen.members });
    const altered = frozen.members.map((m, i) => (i === 0 ? { ...m, extraction_text_hash: hex64('alternate-text') } : m));
    const changed = computeAgt002EvidencePackageSemanticManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: altered });
    assert.notEqual(base, changed);
  });

  it('changes when source_classification or inclusion_reason differs — unlike the document manifest, the semantic manifest is provenance/usage-aware', () => {
    const { members, evidenceRows } = buildMatchedSet(2);
    const frozen = freezeAgt002EvidencePackageEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows });
    const base = computeAgt002EvidencePackageSemanticManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: frozen.members });
    for (const field of ['source_classification', 'inclusion_reason']) {
      const altered = frozen.members.map((m, i) => (i === 0 ? { ...m, [field]: field === 'source_classification' ? 'draft' : 'A completely different reason.' } : m));
      const changed = computeAgt002EvidencePackageSemanticManifestHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: altered });
      assert.notEqual(base, changed, `changing ${field} must change the semantic manifest hash`);
    }
  });
});

describe('computeAgt002EvidencePackageHash', () => {
  it('is deterministic given the same scope and the same two sub-digests', () => {
    const documentManifestHash = hex64('doc-manifest');
    const semanticManifestHash = hex64('semantic-manifest');
    const a = computeAgt002EvidencePackageHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, documentManifestHash, semanticManifestHash });
    const b = computeAgt002EvidencePackageHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, documentManifestHash, semanticManifestHash });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it('changes when documentManifestHash differs', () => {
    const semanticManifestHash = hex64('semantic-manifest');
    const a = computeAgt002EvidencePackageHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, documentManifestHash: hex64('doc-manifest-a'), semanticManifestHash });
    const b = computeAgt002EvidencePackageHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, documentManifestHash: hex64('doc-manifest-b'), semanticManifestHash });
    assert.notEqual(a, b);
  });

  it('changes when semanticManifestHash differs', () => {
    const documentManifestHash = hex64('doc-manifest');
    const a = computeAgt002EvidencePackageHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, documentManifestHash, semanticManifestHash: hex64('semantic-a') });
    const b = computeAgt002EvidencePackageHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, documentManifestHash, semanticManifestHash: hex64('semantic-b') });
    assert.notEqual(a, b);
  });

  it('changes when opportunityId or tenderId differs, even with identical sub-digests', () => {
    const documentManifestHash = hex64('doc-manifest');
    const semanticManifestHash = hex64('semantic-manifest');
    const a = computeAgt002EvidencePackageHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, documentManifestHash, semanticManifestHash });
    const b = computeAgt002EvidencePackageHash({ opportunityId: OTHER_OPPORTUNITY_ID, tenderId: TENDER_ID, documentManifestHash, semanticManifestHash });
    const c = computeAgt002EvidencePackageHash({ opportunityId: OPPORTUNITY_ID, tenderId: OTHER_TENDER_ID, documentManifestHash, semanticManifestHash });
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });
});

describe('computeAgt002EvidencePackageIdempotencyKey', () => {
  it('is deterministic given the same opportunity/tender/packageHash', () => {
    const packageHash = hex64('package-hash');
    const a = computeAgt002EvidencePackageIdempotencyKey({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, packageHash });
    const b = computeAgt002EvidencePackageIdempotencyKey({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, packageHash });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it('changes when packageHash differs', () => {
    const a = computeAgt002EvidencePackageIdempotencyKey({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, packageHash: hex64('package-a') });
    const b = computeAgt002EvidencePackageIdempotencyKey({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, packageHash: hex64('package-b') });
    assert.notEqual(a, b);
  });
});

describe('publicAgt002EvidencePackageSummary', () => {
  function buildRichPackage() {
    return {
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      packageHash: hex64('summary-package'),
      raw_error: 'top level processing error',
      members: [
        {
          document_version_id: DOC_IDS[0],
          source_classification: 'official',
          inclusion_reason: 'Primary tender notice.',
          content_hash: CONTENT_HASHES[0],
          extraction_id: EXTRACTION_IDS[0],
          extraction_text_hash: TEXT_HASHES[0],
          extracted_text: 'the full extracted document body goes here',
          storage_path: '/blobs/doc-0.pdf',
          source_url: 'https://source.example/doc-0.pdf',
          signed_url: 'https://cdn.example/doc-0.pdf?sig=abc123',
        },
      ],
    };
  }

  it('recursively omits extracted_text, storage_path, source_url, signed_url, and raw_error', () => {
    const result = publicAgt002EvidencePackageSummary(buildRichPackage());
    const serialized = JSON.stringify(result);
    for (const banned of ['extracted_text', 'storage_path', 'source_url', 'signed_url', 'raw_error']) {
      assert.ok(!serialized.includes(banned), `expected "${banned}" to be omitted from the public summary`);
    }
  });

  it('preserves safe header and member fields', () => {
    const input = buildRichPackage();
    const result = publicAgt002EvidencePackageSummary(input);
    assert.equal(result.opportunityId, OPPORTUNITY_ID);
    assert.equal(result.packageHash, input.packageHash);
    assert.equal(result.members[0].document_version_id, DOC_IDS[0]);
  });

  it('does not mutate the input package', () => {
    const input = buildRichPackage();
    const snapshot = JSON.stringify(input);
    publicAgt002EvidencePackageSummary(input);
    assert.equal(JSON.stringify(input), snapshot);
  });
});
