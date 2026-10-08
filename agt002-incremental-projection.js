function stringArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];
}

export function projectAgt002IncrementalChangeSet(row) {
  const manifest = row?.manifest;
  if (!row || row.state !== 'COMPLETED' || !manifest || typeof manifest !== 'object'
    || manifest.schema_version !== 'incremental_delta_manifest_v1') return null;
  const members = Array.isArray(manifest.members) ? manifest.members : [];
  const affectedFindingRefs = stringArray(manifest.affected_finding_refs).sort();
  const triggerKinds = [...new Set(members.map(item => item?.trigger_kind)
    .filter(value => typeof value === 'string' && value.trim()))].sort();
  const events = members.map(member => ({
    trigger_kind: String(member?.trigger_kind || ''),
    source_type: String(member?.source_type || ''),
    observed_at: String(member?.observed_at || ''),
    actor_profile_id: member?.actor_profile_id == null ? null : String(member.actor_profile_id),
  }));
  return Object.freeze({
    schema_version: 'agt002.incremental_projection.v1',
    change_set_id: String(row.id),
    prior_run_id: String(row.prior_canonical_run_id),
    run_id: String(row.linked_run_id),
    changed_member_count: members.length,
    trigger_kinds: triggerKinds,
    events,
    affected_finding_refs: affectedFindingRefs,
    unaffected_finding_count: 0,
    comparison_excerpt_count: Array.isArray(manifest.comparison_excerpts) ? manifest.comparison_excerpts.length : 0,
    closed_at: row.closed_at == null ? null : String(row.closed_at),
    human_review_required: true,
  });
}

/** Safe read projection: no hashes, evidence text, source ids or raw manifest leave the server. */
export async function loadAgt002IncrementalProjection(database, analysisRunId) {
  if (typeof analysisRunId !== 'string' || !analysisRunId.trim()) return null;
  const response = await database.from('psi_agt002_incremental_change_sets')
    .select('id,prior_canonical_run_id,linked_run_id,state,manifest,closed_at')
    .eq('linked_run_id', analysisRunId).eq('state', 'COMPLETED').maybeSingle();
  if (response.error) {
    // Allows a flags-off application release to coexist briefly with a not-yet-applied
    // additive migration; every other database error remains visible and fail-closed.
    if (['42P01', 'PGRST205'].includes(response.error.code)) return null;
    throw response.error;
  }
  return projectAgt002IncrementalChangeSet(response.data);
}
