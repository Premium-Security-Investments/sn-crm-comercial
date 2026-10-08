import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAgt002IncrementalChangeSet } from '../agt002-incremental-projection.js';

test('incremental projection exposes lineage and counts without hashes, source ids or evidence', () => {
  const projection = projectAgt002IncrementalChangeSet({
    id: 'set-1', state: 'COMPLETED', prior_canonical_run_id: 'run-0', linked_run_id: 'run-1',
    closed_at: '2026-10-08T12:00:00.000Z',
    manifest: {
      schema_version: 'incremental_delta_manifest_v1',
      affected_finding_refs: ['finding-2', 'finding-1'], comparison_excerpts: [],
      members: [{ signal_id: 'secret-signal', trigger_kind: 'human_interaction', source_type: 'answer',
        source_id: 'secret-source', content_hash: 'a'.repeat(64), observed_at: '2026-10-08T11:00:00.000Z', actor_profile_id: 'profile-1' }],
    },
  });
  assert.equal(projection.changed_member_count, 1);
  assert.deepEqual(projection.affected_finding_refs, ['finding-1', 'finding-2']);
  assert.equal(projection.human_review_required, true);
  assert.equal(JSON.stringify(projection).includes('secret-source'), false);
  assert.equal(JSON.stringify(projection).includes('a'.repeat(64)), false);
  assert.equal(JSON.stringify(projection).includes('secret-signal'), false);
});
