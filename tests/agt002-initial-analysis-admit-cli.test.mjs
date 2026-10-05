import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAgt002InitialAnalysisAdmissionManifest } from '../scripts/agt002-initial-analysis-admit.mjs';

const BASE = Object.freeze({
  schema_version: 'agt002-initial-analysis-admission-v1',
  opportunity_id: '10000000-0000-4000-8000-000000000001',
  tender_id: '10000000-0000-4000-8000-000000000002',
  actor_profile_id: '10000000-0000-4000-8000-000000000003',
  expires_at: '2026-10-05T13:00:00.000Z',
  policy_version: 'agt002-initial-c1a.v1',
  scope: 'A',
  profile_snapshot_id: null,
  profile_snapshot_hash: null,
  documents: [{
    document_version_id: '10000000-0000-4000-8000-000000000004',
    source_classification: 'official',
    inclusion_reason: 'Documento oficial vigente seleccionado para el canario C1A.',
  }],
});

test('parses the closed one-opportunity admission manifest', () => {
  const parsed = parseAgt002InitialAnalysisAdmissionManifest(JSON.stringify(BASE));
  assert.equal(parsed.opportunityId, BASE.opportunity_id);
  assert.equal(parsed.tenderId, BASE.tender_id);
  assert.equal(parsed.actorProfileId, BASE.actor_profile_id);
  assert.equal(parsed.requestedMembers.length, 1);
  assert.equal(parsed.scope, 'A');
});

test('rejects unknown fields, multiple opportunities and an invalid schema', () => {
  assert.throws(
    () => parseAgt002InitialAnalysisAdmissionManifest(JSON.stringify({ ...BASE, unexpected: true })),
    /unexpected/i,
  );
  assert.throws(
    () => parseAgt002InitialAnalysisAdmissionManifest(JSON.stringify({ ...BASE, opportunity_ids: [BASE.opportunity_id] })),
    /unexpected/i,
  );
  assert.throws(
    () => parseAgt002InitialAnalysisAdmissionManifest(JSON.stringify({ ...BASE, schema_version: 'unknown' })),
    /schema/i,
  );
});

test('rejects a malformed identity or document selection before database access', () => {
  assert.throws(
    () => parseAgt002InitialAnalysisAdmissionManifest(JSON.stringify({ ...BASE, tender_id: 'not-a-uuid' })),
    /tender_id/i,
  );
  assert.throws(
    () => parseAgt002InitialAnalysisAdmissionManifest(JSON.stringify({ ...BASE, documents: [] })),
    /member|document/i,
  );
});

test('attempt is optional, defaults to null and must be an integer >= 2', () => {
  assert.equal(parseAgt002InitialAnalysisAdmissionManifest(JSON.stringify(BASE)).attempt, null);
  assert.equal(parseAgt002InitialAnalysisAdmissionManifest(JSON.stringify({ ...BASE, attempt: 2 })).attempt, 2);
  for (const bad of [1, 0, -1, 2.5, '2', true]) {
    assert.throws(
      () => parseAgt002InitialAnalysisAdmissionManifest(JSON.stringify({ ...BASE, attempt: bad })),
      /attempt/i,
    );
  }
});
