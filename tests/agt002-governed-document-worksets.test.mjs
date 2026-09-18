import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGT002_WORKSET_SOURCE_CLASSIFICATIONS,
  normalizeRequestedAgt002WorksetMembers,
  freezeAgt002WorksetEvidence,
  publicAgt002WorksetSummary,
  computeAgt002WorksetSelectionHash,
} from '../agt002-governed-document-worksets.js';

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

const DOC_IDS = Array.from({ length: 16 }, (_, i) => uuid(`doc-version-${i + 1}`));
const EXTRACTION_IDS = Array.from({ length: 16 }, (_, i) => uuid(`extraction-${i + 1}`));
const CONTENT_HASHES = Array.from({ length: 16 }, (_, i) => hex64(`content-${i + 1}`));
const TEXT_HASHES = Array.from({ length: 16 }, (_, i) => hex64(`text-${i + 1}`));

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

describe('AGT002_WORKSET_SOURCE_CLASSIFICATIONS', () => {
  it('is exactly the five closed provenance classifications', () => {
    const expected = ['corporate', 'draft', 'internal', 'official', 'third_party'];
    const actual = Array.from(AGT002_WORKSET_SOURCE_CLASSIFICATIONS).slice().sort();
    assert.deepEqual(actual, expected);
  });
});

describe('normalizeRequestedAgt002WorksetMembers', () => {
  it('accepts exactly 4 requested members', () => {
    const { members } = buildMatchedSet(4);
    const result = normalizeRequestedAgt002WorksetMembers(members);
    assert.equal(result.length, 4);
  });

  it('accepts 5 requested members, since 4 is a recommendation not a ceiling', () => {
    const { members } = buildMatchedSet(5);
    const result = normalizeRequestedAgt002WorksetMembers(members);
    assert.equal(result.length, 5);
  });

  it('accepts up to 12 requested members', () => {
    const { members } = buildMatchedSet(12);
    const result = normalizeRequestedAgt002WorksetMembers(members);
    assert.equal(result.length, 12);
  });

  it('rejects more than 12 requested members', () => {
    const { members } = buildMatchedSet(13);
    assert.throws(() => normalizeRequestedAgt002WorksetMembers(members));
  });

  it('rejects an empty member list', () => {
    assert.throws(() => normalizeRequestedAgt002WorksetMembers([]));
  });

  it('canonicalizes member order by document_version_id ascending', () => {
    const [first, second] = [DOC_IDS[0], DOC_IDS[1]].slice().sort();
    const members = [
      buildMember({ document_version_id: second, inclusion_reason: 'Second document in input order.' }),
      buildMember({ document_version_id: first, inclusion_reason: 'First document in input order.' }),
    ];
    const result = normalizeRequestedAgt002WorksetMembers(members);
    assert.deepEqual(result.map((m) => m.document_version_id), [first, second]);
  });

  it('trims whitespace from inclusion_reason', () => {
    const result = normalizeRequestedAgt002WorksetMembers([
      buildMember({ inclusion_reason: '   Primary tender notice.   ' }),
    ]);
    assert.equal(result[0].inclusion_reason, 'Primary tender notice.');
  });

  it('returns canonical members containing only the three normalized fields', () => {
    const result = normalizeRequestedAgt002WorksetMembers([buildMember()]);
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
    assert.throws(() => normalizeRequestedAgt002WorksetMembers(members));
  });

  it('rejects malformed or non-UUID document_version_id values', () => {
    const malformedIds = [
      'not-a-uuid',
      '12345',
      '',
      DOC_IDS[0].replace(/-/g, ''),
      DOC_IDS[0].slice(0, -1),
      `${DOC_IDS[0]}0`,
      DOC_IDS[0].replace('4', 'g'),
    ];
    for (const badId of malformedIds) {
      assert.throws(() => normalizeRequestedAgt002WorksetMembers([buildMember({ document_version_id: badId })]));
    }
  });

  it('rejects an unknown source_classification', () => {
    assert.throws(() =>
      normalizeRequestedAgt002WorksetMembers([buildMember({ source_classification: 'unverified' })]),
    );
  });

  it('rejects a blank inclusion_reason', () => {
    for (const reason of ['', '   ', '\n\t']) {
      assert.throws(() => normalizeRequestedAgt002WorksetMembers([buildMember({ inclusion_reason: reason })]));
    }
  });

  it('rejects inclusion_reason longer than 500 characters', () => {
    const reason = 'a'.repeat(501);
    assert.throws(() => normalizeRequestedAgt002WorksetMembers([buildMember({ inclusion_reason: reason })]));
  });

  it('accepts inclusion_reason at exactly 500 characters', () => {
    const reason = 'a'.repeat(500);
    const result = normalizeRequestedAgt002WorksetMembers([buildMember({ inclusion_reason: reason })]);
    assert.equal(result[0].inclusion_reason, reason);
  });

  const SERVER_OWNED_KEYS = [
    'actor_id',
    'content_hash',
    'extraction_id',
    'extraction_text_hash',
    'snapshot_id',
    'workset_id',
    'current',
    'extracted_text',
    'storage_path',
  ];

  for (const key of SERVER_OWNED_KEYS) {
    it(`rejects a requested member carrying the server-owned key "${key}"`, () => {
      const member = buildMember({ [key]: 'unexpected-client-supplied-value' });
      assert.throws(() => normalizeRequestedAgt002WorksetMembers([member]));
    });
  }
});

describe('freezeAgt002WorksetEvidence', () => {
  it('joins requested members with evidence rows by exact version id and returns a canonical frozen workset', () => {
    const { members, evidenceRows } = buildMatchedSet(4);
    const result = freezeAgt002WorksetEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows,
    });

    assert.equal(result.members.length, 4);
    assert.match(result.selectionHash, /^[0-9a-f]{64}$/);

    const sortedIds = members.map((m) => m.document_version_id).slice().sort();
    assert.deepEqual(result.members.map((m) => m.document_version_id), sortedIds);

    const evidenceById = new Map(evidenceRows.map((r) => [r.document_version_id, r]));
    for (const member of result.members) {
      const evidence = evidenceById.get(member.document_version_id);
      assert.equal(member.content_hash, evidence.content_hash);
      assert.equal(member.extraction_id, evidence.extraction_id);
      assert.equal(member.extraction_text_hash, evidence.extraction_text_hash);
      assert.match(member.content_hash, /^[0-9a-f]{64}$/);
      assert.match(member.extraction_text_hash, /^[0-9a-f]{64}$/);
    }
  });

  it('produces the same selectionHash regardless of requested member input order', () => {
    const { members, evidenceRows } = buildMatchedSet(4);
    const shuffled = [...members].reverse();
    const a = freezeAgt002WorksetEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows,
    });
    const b = freezeAgt002WorksetEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: shuffled,
      evidenceRows,
    });
    assert.equal(a.selectionHash, b.selectionHash);
  });

  it('changes selectionHash when inclusion_reason differs', () => {
    const { members, evidenceRows } = buildMatchedSet(4);
    const altered = members.map((m, i) =>
      i === 0 ? { ...m, inclusion_reason: `${m.inclusion_reason} Updated.` } : m,
    );
    const a = freezeAgt002WorksetEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows,
    });
    const b = freezeAgt002WorksetEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: altered,
      evidenceRows,
    });
    assert.notEqual(a.selectionHash, b.selectionHash);
  });

  it('changes selectionHash when source_classification differs', () => {
    const { members, evidenceRows } = buildMatchedSet(4);
    const altered = members.map((m, i) =>
      i === 0 ? { ...m, source_classification: m.source_classification === 'official' ? 'draft' : 'official' } : m,
    );
    const a = freezeAgt002WorksetEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows,
    });
    const b = freezeAgt002WorksetEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: altered,
      evidenceRows,
    });
    assert.notEqual(a.selectionHash, b.selectionHash);
  });

  it('changes selectionHash when the bound opportunity/tender differs', () => {
    const { members, evidenceRows } = buildMatchedSet(4);
    const otherEvidence = evidenceRows.map((r) => ({ ...r, opportunity_id: OTHER_OPPORTUNITY_ID }));
    const a = freezeAgt002WorksetEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows,
    });
    const b = freezeAgt002WorksetEvidence({
      opportunityId: OTHER_OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows: otherEvidence,
    });
    assert.notEqual(a.selectionHash, b.selectionHash);
  });

  it('changes selectionHash when evidence content_hash differs', () => {
    const { members, evidenceRows } = buildMatchedSet(4);
    const alteredEvidence = evidenceRows.map((r, i) =>
      i === 0 ? { ...r, content_hash: hex64('alternate-content') } : r,
    );
    const a = freezeAgt002WorksetEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows,
    });
    const b = freezeAgt002WorksetEvidence({
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      requestedMembers: members,
      evidenceRows: alteredEvidence,
    });
    assert.notEqual(a.selectionHash, b.selectionHash);
  });

  it('fails closed for an evidence row belonging to a different opportunity', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, opportunity_id: OTHER_OPPORTUNITY_ID }));
    assert.throws(() =>
      freezeAgt002WorksetEvidence({
        opportunityId: OPPORTUNITY_ID,
        tenderId: TENDER_ID,
        requestedMembers: members,
        evidenceRows: badEvidence,
      }),
    );
  });

  it('fails closed for an evidence row belonging to a different tender', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, tender_id: OTHER_TENDER_ID }));
    assert.throws(() =>
      freezeAgt002WorksetEvidence({
        opportunityId: OPPORTUNITY_ID,
        tenderId: TENDER_ID,
        requestedMembers: members,
        evidenceRows: badEvidence,
      }),
    );
  });

  it('fails closed for a non-current evidence row', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, current: false }));
    assert.throws(() =>
      freezeAgt002WorksetEvidence({
        opportunityId: OPPORTUNITY_ID,
        tenderId: TENDER_ID,
        requestedMembers: members,
        evidenceRows: badEvidence,
      }),
    );
  });

  it('fails closed when extraction_status is not "ok"', () => {
    for (const status of ['pending', 'failed', 'stale']) {
      const { members, evidenceRows } = buildMatchedSet(1);
      const badEvidence = evidenceRows.map((r) => ({ ...r, extraction_status: status }));
      assert.throws(() =>
        freezeAgt002WorksetEvidence({
          opportunityId: OPPORTUNITY_ID,
          tenderId: TENDER_ID,
          requestedMembers: members,
          evidenceRows: badEvidence,
        }),
      );
    }
  });

  it('fails closed when a requested member has no matching evidence row', () => {
    const { members } = buildMatchedSet(1);
    assert.throws(() =>
      freezeAgt002WorksetEvidence({
        opportunityId: OPPORTUNITY_ID,
        tenderId: TENDER_ID,
        requestedMembers: members,
        evidenceRows: [],
      }),
    );
  });

  it('fails closed on an evidence/requested member count mismatch', () => {
    const { members, evidenceRows } = buildMatchedSet(2);
    const duplicated = [...evidenceRows, buildEvidenceRow({ __index: 0 })];
    assert.throws(() =>
      freezeAgt002WorksetEvidence({
        opportunityId: OPPORTUNITY_ID,
        tenderId: TENDER_ID,
        requestedMembers: members,
        evidenceRows: duplicated,
      }),
    );
  });

  it('fails closed for a malformed content_hash', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, content_hash: 'not-a-hash' }));
    assert.throws(() =>
      freezeAgt002WorksetEvidence({
        opportunityId: OPPORTUNITY_ID,
        tenderId: TENDER_ID,
        requestedMembers: members,
        evidenceRows: badEvidence,
      }),
    );
  });

  it('fails closed for a malformed extraction_text_hash', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, extraction_text_hash: 'zz'.repeat(32) }));
    assert.throws(() =>
      freezeAgt002WorksetEvidence({
        opportunityId: OPPORTUNITY_ID,
        tenderId: TENDER_ID,
        requestedMembers: members,
        evidenceRows: badEvidence,
      }),
    );
  });

  it('fails closed for a malformed extraction_id UUID', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const badEvidence = evidenceRows.map((r) => ({ ...r, extraction_id: 'not-a-uuid' }));
    assert.throws(() =>
      freezeAgt002WorksetEvidence({
        opportunityId: OPPORTUNITY_ID,
        tenderId: TENDER_ID,
        requestedMembers: members,
        evidenceRows: badEvidence,
      }),
    );
  });

  it('fails closed when opportunityId is a non-canonical uppercase UUID, since the SQL preimage is lowercase-canonical', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const upperOpportunityId = OPPORTUNITY_ID.toUpperCase();
    const matchedEvidence = evidenceRows.map((r) => ({ ...r, opportunity_id: upperOpportunityId }));
    assert.throws(() =>
      freezeAgt002WorksetEvidence({
        opportunityId: upperOpportunityId,
        tenderId: TENDER_ID,
        requestedMembers: members,
        evidenceRows: matchedEvidence,
      }),
    );
  });

  it('fails closed when tenderId is a non-canonical uppercase UUID, since the SQL preimage is lowercase-canonical', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const upperTenderId = TENDER_ID.toUpperCase();
    const matchedEvidence = evidenceRows.map((r) => ({ ...r, tender_id: upperTenderId }));
    assert.throws(() =>
      freezeAgt002WorksetEvidence({
        opportunityId: OPPORTUNITY_ID,
        tenderId: upperTenderId,
        requestedMembers: members,
        evidenceRows: matchedEvidence,
      }),
    );
  });

  const EVIDENCE_ROW_UPPERCASE_FIELDS = [
    'document_version_id',
    'opportunity_id',
    'tender_id',
    'extraction_id',
    'content_hash',
    'extraction_text_hash',
  ];

  for (const field of EVIDENCE_ROW_UPPERCASE_FIELDS) {
    it(`fails closed when evidence row's server-owned "${field}" is a non-canonical uppercase value, before it reaches the hash`, () => {
      const { members, evidenceRows } = buildMatchedSet(1);
      const badEvidence = evidenceRows.map((r) => ({ ...r, [field]: r[field].toUpperCase() }));
      assert.throws(() =>
        freezeAgt002WorksetEvidence({
          opportunityId: OPPORTUNITY_ID,
          tenderId: TENDER_ID,
          requestedMembers: members,
          evidenceRows: badEvidence,
        }),
      );
    });
  }
});

describe('computeAgt002WorksetSelectionHash', () => {
  it('is exactly the digest freezeAgt002WorksetEvidence produces for the same evidence-joined members', () => {
    const { members, evidenceRows } = buildMatchedSet(3);
    const frozen = freezeAgt002WorksetEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows });
    const recomputed = computeAgt002WorksetSelectionHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: frozen.members });
    assert.equal(recomputed, frozen.selectionHash);
  });

  it('changes when any of the six frozen member fields differs', () => {
    const { members, evidenceRows } = buildMatchedSet(1);
    const frozen = freezeAgt002WorksetEvidence({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members, evidenceRows });
    const base = computeAgt002WorksetSelectionHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: frozen.members });
    for (const field of ['document_version_id', 'source_classification', 'inclusion_reason', 'content_hash', 'extraction_id', 'extraction_text_hash']) {
      const altered = frozen.members.map((m, i) => (i === 0 ? { ...m, [field]: `${m[field]}-different` } : m));
      const alteredHash = computeAgt002WorksetSelectionHash({ opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, members: altered });
      assert.notEqual(alteredHash, base, `changing ${field} must change the selection hash`);
    }
  });
});

describe('publicAgt002WorksetSummary', () => {
  function buildRichWorkset() {
    return {
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      selectionHash: hex64('summary-selection'),
      frozen_engine_input: {
        prompt: 'internal engine prompt',
        raw_error: 'engine failure trace',
        context: { storage_path: '/internal/engine/context.json' },
      },
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
          nested: {
            extracted_text: 'nested duplicate sensitive text',
            storage_path: '/nested/path',
          },
        },
      ],
    };
  }

  it('recursively omits extracted_text, storage_path, source_url, signed_url, frozen_engine_input and raw_error', () => {
    const input = buildRichWorkset();
    const result = publicAgt002WorksetSummary(input);
    const serialized = JSON.stringify(result);
    for (const banned of [
      'extracted_text',
      'storage_path',
      'source_url',
      'signed_url',
      'frozen_engine_input',
      'raw_error',
    ]) {
      assert.ok(!serialized.includes(banned), `expected "${banned}" to be omitted from the public summary`);
    }
  });

  it('preserves safe header and member fields', () => {
    const input = buildRichWorkset();
    const result = publicAgt002WorksetSummary(input);
    assert.equal(result.opportunityId, OPPORTUNITY_ID);
    assert.equal(result.tenderId, TENDER_ID);
    assert.equal(result.selectionHash, input.selectionHash);
    assert.equal(result.members.length, 1);
    assert.equal(result.members[0].document_version_id, DOC_IDS[0]);
    assert.equal(result.members[0].source_classification, 'official');
    assert.equal(result.members[0].inclusion_reason, 'Primary tender notice.');
  });

  it('does not mutate the input workset', () => {
    const input = buildRichWorkset();
    const snapshot = JSON.stringify(input);
    publicAgt002WorksetSummary(input);
    assert.equal(JSON.stringify(input), snapshot);
  });
});
