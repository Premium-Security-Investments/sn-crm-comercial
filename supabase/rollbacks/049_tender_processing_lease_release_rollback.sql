begin;

-- Restore migration-034 semantics: updates preserve the current lease until it
-- expires or is swept by the next claim.
create or replace function public.psi_update_tender_processing_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.psi_tender_processing_jobs%rowtype;
begin
  select * into v_current from public.psi_tender_processing_jobs where id = p_job_id for update;

  if v_current.id is null then
    raise exception 'psi_update_tender_processing_job: job % no encontrado', p_job_id;
  end if;

  if v_current.lease_id is distinct from p_lease_id then
    raise exception 'psi_update_tender_processing_job: lease inválido para job %', p_job_id;
  end if;

  if p_patch ? 'snapshot_id' and p_patch->>'snapshot_id' is not null then
    if not exists (
      select 1 from public.psi_tender_document_snapshots s
      where s.id = (p_patch->>'snapshot_id')::uuid
        and s.tender_id = v_current.tender_id
        and s.opportunity_id = v_current.opportunity_id
    ) then
      raise exception 'psi_update_tender_processing_job: snapshot_id no corresponde al tender/oportunidad del job';
    end if;
  end if;

  if p_patch ? 'analysis_run_id' and p_patch->>'analysis_run_id' is not null then
    if not exists (
      select 1 from public.psi_tender_analysis_runs r
      where r.id = (p_patch->>'analysis_run_id')::uuid
        and r.tender_id = v_current.tender_id
        and r.opportunity_id = v_current.opportunity_id
    ) then
      raise exception 'psi_update_tender_processing_job: analysis_run_id no corresponde al tender/oportunidad del job';
    end if;
  end if;

  update public.psi_tender_processing_jobs set
    status = coalesce(p_patch->>'status', status),
    current_step = coalesce(p_patch->>'current_step', current_step),
    attempt_count = coalesce((p_patch->>'attempt_count')::integer, attempt_count),
    next_attempt_at = case when p_patch ? 'next_attempt_at' then (p_patch->>'next_attempt_at')::timestamptz else next_attempt_at end,
    documents_discovered = coalesce((p_patch->>'documents_discovered')::integer, documents_discovered),
    documents_processed = coalesce((p_patch->>'documents_processed')::integer, documents_processed),
    documents_imported = coalesce((p_patch->>'documents_imported')::integer, documents_imported),
    documents_unchanged = coalesce((p_patch->>'documents_unchanged')::integer, documents_unchanged),
    documents_failed = coalesce((p_patch->>'documents_failed')::integer, documents_failed),
    snapshot_id = case when p_patch ? 'snapshot_id' then (p_patch->>'snapshot_id')::uuid else snapshot_id end,
    analysis_run_id = case when p_patch ? 'analysis_run_id' then (p_patch->>'analysis_run_id')::uuid else analysis_run_id end,
    last_error_code = case when p_patch ? 'last_error_code' then p_patch->>'last_error_code' else last_error_code end,
    last_error_message = case when p_patch ? 'last_error_message' then p_patch->>'last_error_message' else last_error_message end,
    completed_at = case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::timestamptz else completed_at end,
    updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.psi_update_tender_processing_job(uuid, uuid, jsonb) from public, authenticated, anon;
grant execute on function public.psi_update_tender_processing_job(uuid, uuid, jsonb) to service_role;

commit;
