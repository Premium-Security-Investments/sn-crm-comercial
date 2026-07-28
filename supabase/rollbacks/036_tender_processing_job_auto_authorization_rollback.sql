-- Restores psi_create_tender_processing_job to its pre-036 body (034):
-- jobs are created without an automatic analysis_authorized_by/at, so the
-- separate psi_authorize_tender_analysis click is required again. Does not
-- (and cannot) undo the 036 backfill UPDATE on existing rows -- that is a
-- one-time data migration, not schema state.
create or replace function public.psi_create_tender_processing_job(
  p_tender_id uuid,
  p_opportunity_id uuid,
  p_pipeline_version text,
  p_idempotency_key text,
  p_requested_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_id uuid;
  v_existing_active uuid;
begin
  if not exists (
    select 1 from public.psi_public_tenders
    where id = p_tender_id
      and internal_status = 'convertida_oportunidad'
      and converted_opportunity_id = p_opportunity_id
  ) then
    raise exception 'psi_create_tender_processing_job: requiere una conversión manual válida a la oportunidad';
  end if;

  perform pg_advisory_xact_lock(hashtext('psi_tender_processing_jobs:' || p_opportunity_id::text));

  select id into v_existing_active
  from public.psi_tender_processing_jobs
  where opportunity_id = p_opportunity_id
    and status not in ('completed', 'cancelled')
  limit 1;

  if v_existing_active is not null then
    return jsonb_build_object('status', 'existing', 'job_id', v_existing_active);
  end if;

  insert into public.psi_tender_processing_jobs
    (tender_id, opportunity_id, pipeline_version, idempotency_key, status, current_step, requested_by)
  values
    (p_tender_id, p_opportunity_id, p_pipeline_version, p_idempotency_key, 'queued', 'documents', p_requested_by)
  on conflict (idempotency_key) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select id into v_job_id from public.psi_tender_processing_jobs where idempotency_key = p_idempotency_key;
    return jsonb_build_object('status', 'existing', 'job_id', v_job_id);
  end if;

  if not exists (
    select 1 from public.psi_tender_tracking_events where tender_id = p_tender_id and event_type = 'converted'
  ) then
    insert into public.psi_tender_tracking_events (tender_id, event_type, actor_kind, created_by, source_ref_type, source_ref_id)
    values (p_tender_id, 'converted', 'human', p_requested_by, 'opportunity', p_opportunity_id);
  end if;

  insert into public.psi_tender_tracking_events (tender_id, event_type, actor_kind, source_ref_type, source_ref_id)
  values (p_tender_id, 'pipeline_queued', 'system', 'job', v_job_id);

  return jsonb_build_object('status', 'created', 'job_id', v_job_id);
end;
$$;

revoke all on function public.psi_create_tender_processing_job(uuid, uuid, text, text, uuid) from public, authenticated, anon;
grant execute on function public.psi_create_tender_processing_job(uuid, uuid, text, text, uuid) to service_role;
