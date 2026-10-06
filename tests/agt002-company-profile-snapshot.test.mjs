import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAgt002CompanyProfileSnapshotHash, freezeAgt002CompanyProfileSnapshot, loadAgt002CompanyProfileSnapshotForWorkflow,
} from '../agt002-company-profile-snapshot.js';

const DOSSIER = { profile: { legal_name: 'Seguridad Nacional', rup_status: 'vigente' }, documents: [{ id: 'd1' }] };

test('the snapshot hash is canonical: key order does not change it, content does', () => {
  const a = computeAgt002CompanyProfileSnapshotHash({ b: 1, a: { y: 2, x: 1 } });
  assert.equal(a, computeAgt002CompanyProfileSnapshotHash({ a: { x: 1, y: 2 }, b: 1 }));
  assert.notEqual(a, computeAgt002CompanyProfileSnapshotHash({ a: { x: 1, y: 3 }, b: 1 }));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('freezing sends the canonical dossier with its hash through the one RPC', async () => {
  let call;
  const database = { rpc: async (name, params) => { call = { name, params }; return { data: { status: 'created', profile_snapshot_id: 'snap-1', profile_snapshot_hash: params.p_snapshot_hash }, error: null }; } };
  const result = await freezeAgt002CompanyProfileSnapshot(database, { actorProfileId: 'actor-1', loadDossier: async () => DOSSIER });
  assert.equal(call.name, 'psi_freeze_agt002_company_profile_snapshot');
  assert.equal(call.params.p_snapshot_hash, computeAgt002CompanyProfileSnapshotHash(DOSSIER));
  assert.equal(call.params.p_actor_profile_id, 'actor-1');
  assert.deepEqual(result, { profileSnapshotId: 'snap-1', profileSnapshotHash: call.params.p_snapshot_hash, status: 'created' });
  await assert.rejects(() => freezeAgt002CompanyProfileSnapshot(database, { actorProfileId: '' }), error => error.diagnostic.reason === 'actor_required');
});

function databaseWith({ instance, row }) {
  const chain = result => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => result });
  return { from: table => chain(table === 'psi_agt002_workflow_instances' ? { data: instance, error: null } : { data: row, error: null }) };
}
const HASH = computeAgt002CompanyProfileSnapshotHash(DOSSIER);
const INSTANCE = { id: 'wf-1', scope: 'A_PLUS_B', profile_snapshot_id: 'snap-1', profile_snapshot_hash: HASH };

test('loading re-verifies the bound snapshot and returns it', async () => {
  const loaded = await loadAgt002CompanyProfileSnapshotForWorkflow(databaseWith({ instance: INSTANCE, row: { id: 'snap-1', snapshot: DOSSIER, snapshot_hash: HASH } }), 'wf-1');
  assert.deepEqual(loaded, { profileSnapshotId: 'snap-1', profileSnapshotHash: HASH, snapshot: DOSSIER });
});

test('loading fails closed on a scope-A instance, a missing snapshot, a rebinding or tampered content', async () => {
  const reason = async db => { try { await loadAgt002CompanyProfileSnapshotForWorkflow(db, 'wf-1'); return 'ok'; } catch (error) { return error.diagnostic.reason; } };
  assert.equal(await reason(databaseWith({ instance: { ...INSTANCE, scope: 'A' }, row: null })), 'workflow_not_a_plus_b');
  assert.equal(await reason(databaseWith({ instance: INSTANCE, row: null })), 'snapshot_unavailable');
  assert.equal(await reason(databaseWith({ instance: INSTANCE, row: { id: 'snap-1', snapshot: DOSSIER, snapshot_hash: 'f'.repeat(64) } })), 'snapshot_hash_mismatch');
  assert.equal(await reason(databaseWith({ instance: INSTANCE, row: { id: 'snap-1', snapshot: { ...DOSSIER, profile: { legal_name: 'otro' } }, snapshot_hash: HASH } })), 'snapshot_content_mismatch');
});
