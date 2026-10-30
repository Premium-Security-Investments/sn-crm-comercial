const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value, label) {
  if (!UUID_PATTERN.test(String(value || ''))) throw new Error(`${label} debe ser un UUID válido.`);
  return String(value);
}

/**
 * Produces a reviewable retirement/re-anchor plan only. It never executes RPCs.
 * Runtime placeholders beginning with "$" must be resolved from read-only job
 * and snapshot lookups immediately before an explicitly approved execution.
 */
export function planSnapshotRetirement({ jobId, currentSnapshotId, targetSnapshotId = null } = {}) {
  const normalizedJobId = requireUuid(jobId, 'jobId');
  const effectiveTarget = targetSnapshotId
    ? requireUuid(targetSnapshotId, 'targetSnapshotId')
    : requireUuid(currentSnapshotId, 'currentSnapshotId/snapshot anterior');

  return {
    kind: 'tender_snapshot_retirement_plan',
    destructive: false,
    execution_authorized: false,
    job_id: normalizedJobId,
    current_snapshot_id: currentSnapshotId ? requireUuid(currentSnapshotId, 'currentSnapshotId') : null,
    requested_target_snapshot_id: targetSnapshotId || null,
    effective_target_snapshot_id: effectiveTarget,
    prerequisites: [
      'Leer y bloquear el job por job_id; verificar opportunity_id, tender_id y requested_by.',
      'Leer el snapshot objetivo y verificar que pertenezca a la misma oportunidad y licitación.',
      'Confirmar gate humano antes de ejecutar cualquiera de los RPC listados.',
    ],
    steps: [
      {
        kind: 'rpc',
        name: 'psi_begin_tender_document_refresh',
        params: { p_opportunity_id: '$job.opportunity_id', p_tender_id: '$job.tender_id' },
        captures: { refresh_token: '$result' },
      },
      {
        kind: 'rpc',
        name: 'psi_record_tender_document_snapshot',
        from_snapshot_id: effectiveTarget,
        params: {
          p_opportunity_id: '$job.opportunity_id',
          p_tender_id: '$job.tender_id',
          p_document_hash: '$target_snapshot.document_hash',
          p_profile_hash: '$target_snapshot.profile_hash',
          p_document_manifest: '$target_snapshot.document_manifest',
          p_profile_snapshot: '$target_snapshot.profile_snapshot',
          p_actor_id: '$job.requested_by',
          p_refresh_token: '$refresh_token',
        },
      },
      {
        kind: 'rpc',
        name: 'psi_update_tender_processing_job',
        params: {
          p_job_id: normalizedJobId,
          p_lease_id: '$active_lease_id',
          p_patch: {
            status: 'needs_attention',
            current_step: 'revertido',
            snapshot_id: effectiveTarget,
            last_error_code: 'SNAPSHOT_REVERTED',
            last_error_message: 'Snapshot retirado mediante reanclaje gobernado; requiere revisión humana.',
          },
        },
      },
    ],
  };
}
