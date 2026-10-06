// AGT-002 INITIAL scope A_PLUS_B — the company procurement profile frozen as an immutable, hash-identified snapshot
// (migration 107). The snapshot is exactly what agt002-company-dossier.js builds (profile + current company
// documents + evidence registry, minimum-exposure selects), so the analysis evaluates the company against the
// profile that was authorized, never a later edit of it.
import { createHash } from 'node:crypto';
import { loadAgt002CompanyDossier } from './agt002-company-dossier.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function snapshotError(reason) {
  const error = new Error(`AGT-002 company profile snapshot: ${reason}`);
  error.code = 'AGT002_COMPANY_PROFILE_SNAPSHOT_FAILED';
  error.diagnostic = { reason };
  return error;
}

export function computeAgt002CompanyProfileSnapshotHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(stable(snapshot))).digest('hex');
}

/** Builds the current company dossier and freezes it (idempotent by hash). Returns { profileSnapshotId, profileSnapshotHash, status }. */
export async function freezeAgt002CompanyProfileSnapshot(database, { actorProfileId, loadDossier = loadAgt002CompanyDossier } = {}) {
  if (typeof actorProfileId !== 'string' || actorProfileId.trim() === '') throw snapshotError('actor_required');
  const snapshot = JSON.parse(JSON.stringify(stable(await loadDossier(database))));
  const snapshotHash = computeAgt002CompanyProfileSnapshotHash(snapshot);
  const { data, error } = await database.rpc('psi_freeze_agt002_company_profile_snapshot', {
    p_snapshot: snapshot, p_snapshot_hash: snapshotHash, p_actor_profile_id: actorProfileId,
  });
  if (error || !data?.profile_snapshot_id) throw snapshotError('freeze_failed');
  return { profileSnapshotId: data.profile_snapshot_id, profileSnapshotHash: data.profile_snapshot_hash, status: data.status };
}

/**
 * Loads the snapshot bound to a workflow instance and re-verifies it: the instance must be A_PLUS_B, reference an
 * existing snapshot, and the stored content must still hash to the bound hash. Any mismatch fails closed.
 */
export async function loadAgt002CompanyProfileSnapshotForWorkflow(database, workflowInstanceId) {
  const { data: instance, error: instanceError } = await database
    .from('psi_agt002_workflow_instances')
    .select('id,scope,profile_snapshot_id,profile_snapshot_hash')
    .eq('id', workflowInstanceId)
    .maybeSingle();
  if (instanceError || !instance) throw snapshotError('workflow_unavailable');
  if (instance.scope !== 'A_PLUS_B' || !instance.profile_snapshot_id || !instance.profile_snapshot_hash) throw snapshotError('workflow_not_a_plus_b');
  const { data: row, error } = await database
    .from('psi_agt002_company_profile_snapshots')
    .select('id,snapshot,snapshot_hash')
    .eq('id', instance.profile_snapshot_id)
    .maybeSingle();
  if (error || !row) throw snapshotError('snapshot_unavailable');
  if (row.snapshot_hash !== instance.profile_snapshot_hash) throw snapshotError('snapshot_hash_mismatch');
  if (computeAgt002CompanyProfileSnapshotHash(row.snapshot) !== row.snapshot_hash) throw snapshotError('snapshot_content_mismatch');
  return { profileSnapshotId: row.id, profileSnapshotHash: row.snapshot_hash, snapshot: row.snapshot };
}
