begin;

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

create or replace function public.psi_claim_tender_processing_job(
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_tender_processing_jobs%rowtype;
  v_lease_id uuid;
  v_seconds integer;
begin
  perform pg_advisory_xact_lock(hashtext('psi_tender_processing_jobs:claim'));

  update public.psi_tender_processing_jobs
  set lease_id = null, lease_expires_at = null
  where lease_expires_at < now();

  v_seconds := least(coalesce(p_lease_seconds, 60), 600);

  select *
  into v_job
  from public.psi_tender_processing_jobs
  where status in (
      'queued', 'discovering_documents', 'importing_documents', 'retry_wait',
      'ready_for_snapshot', 'snapshot_ready', 'waiting_agent_capacity', 'analyzing'
    )
    and (next_attempt_at is null or next_attempt_at <= now())
    and lease_id is null
  order by created_at
  for update skip locked
  limit 1;

  if v_job.id is null then
    return jsonb_build_object('status', 'empty');
  end if;

  v_lease_id := gen_random_uuid();

  update public.psi_tender_processing_jobs
  set lease_id = v_lease_id,
      lease_expires_at = now() + make_interval(secs => v_seconds),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = v_job.id;

  return jsonb_build_object(
    'status', 'claimed',
    'job_id', v_job.id,
    'lease_id', v_lease_id,
    'tender_id', v_job.tender_id,
    'opportunity_id', v_job.opportunity_id,
    'current_step', v_job.current_step,
    'pipeline_status', v_job.status
  );
end;
$$;

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

revoke all on function public.psi_create_tender_processing_job(uuid, uuid, text, text, uuid) from public, authenticated, anon;
revoke all on function public.psi_claim_tender_processing_job(integer) from public, authenticated, anon;
revoke all on function public.psi_update_tender_processing_job(uuid, uuid, jsonb) from public, authenticated, anon;
grant execute on function public.psi_create_tender_processing_job(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.psi_claim_tender_processing_job(integer) to service_role;
grant execute on function public.psi_update_tender_processing_job(uuid, uuid, jsonb) to service_role;

commit;
