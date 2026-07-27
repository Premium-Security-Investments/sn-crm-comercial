import assert from 'node:assert/strict';
import { planSnapshotRetirement } from '../tender-snapshot-retire.js';

const plan = planSnapshotRetirement({ jobId: '11111111-1111-4111-8111-111111111111', currentSnapshotId: '22222222-2222-4222-8222-222222222222', targetSnapshotId: '33333333-3333-4333-8333-333333333333' });
assert.equal(plan.destructive, false);
assert.equal(plan.effective_target_snapshot_id, '33333333-3333-4333-8333-333333333333');
assert.deepEqual(plan.steps.filter(step => step.kind === 'rpc').map(step => step.name), ['psi_begin_tender_document_refresh', 'psi_record_tender_document_snapshot', 'psi_update_tender_processing_job']);
assert.equal(plan.steps[1].from_snapshot_id, '33333333-3333-4333-8333-333333333333');
assert.equal(plan.steps[2].params.p_patch.status, 'needs_attention');
assert.equal(plan.steps[2].params.p_patch.current_step, 'revertido');

const retainPrevious = planSnapshotRetirement({ jobId: '11111111-1111-4111-8111-111111111111', currentSnapshotId: '22222222-2222-4222-8222-222222222222', targetSnapshotId: null });
assert.equal(retainPrevious.effective_target_snapshot_id, '22222222-2222-4222-8222-222222222222');
assert.equal(retainPrevious.steps[1].from_snapshot_id, '22222222-2222-4222-8222-222222222222');

const serialized = JSON.stringify([plan, retainPrevious]).toLowerCase();
assert.doesNotMatch(serialized, /\b(delete|drop|truncate)\b/);
assert.doesNotMatch(serialized, /from\(['"]psi_tender_document_(versions|snapshots)['"]\).*?(delete|update)/);
assert.throws(() => planSnapshotRetirement({ jobId: '', currentSnapshotId: null, targetSnapshotId: null }), /jobId/);
assert.throws(() => planSnapshotRetirement({ jobId: '11111111-1111-4111-8111-111111111111', currentSnapshotId: null, targetSnapshotId: null }), /snapshot/i);

console.log('tender snapshot retirement plan passed');
