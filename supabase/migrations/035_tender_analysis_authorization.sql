begin;

create or replace function public.psi_append_tender_tracking_event(
  p_tender_id uuid,
  p_event_type text,
  p_actor_kind text,
  p_created_by uuid,
  p_source_ref_type text,
  p_source_ref_id uuid,
  p_metadata jsonb,
  p_note text,
  p_singular boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
begin
  if p_actor_kind = 'human' then
    if p_created_by is null or not exists (
      select 1 from public.psi_sales_profiles where id = p_created_by and active = true
    ) then
      raise exception 'psi_append_tender_tracking_event: evento human requiere un perfil humano activo';
    end if;
  elsif p_actor_kind in ('system', 'agent') then
    if p_created_by is not null then
      raise exception 'psi_append_tender_tracking_event: evento system/agent no admite created_by';
    end if;
  else
    raise exception 'psi_append_tender_tracking_event: actor_kind inválido';
  end if;

  if p_singular then
    select id into v_existing_id
    from public.psi_tender_tracking_events
    where event_type = p_event_type
      and source_ref_type is not distinct from p_source_ref_type
      and source_ref_id is not distinct from p_source_ref_id
    limit 1;

    if v_existing_id is not null then
      return jsonb_build_object('status', 'exists', 'id', v_existing_id);
    end if;
  end if;

  insert into public.psi_tender_tracking_events
    (tender_id, event_type, actor_kind, created_by, source_ref_type, source_ref_id, metadata, note)
  values
    (p_tender_id, p_event_type, p_actor_kind, p_created_by, p_source_ref_type, p_source_ref_id, p_metadata, p_note)
  returning id into v_new_id;

  return jsonb_build_object('status', 'created', 'id', v_new_id);
end;
$$;

create or replace function public.psi_record_tender_import_item(
  p_job_id uuid,
  p_source text,
  p_source_document_id text,
  p_source_url text,
  p_name text,
  p_status text,
  p_critical boolean,
  p_document_version_id uuid,
  p_last_error_code text,
  p_last_error_message text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_tender_processing_jobs%rowtype;
  v_item_id uuid;
begin
  select * into v_job from public.psi_tender_processing_jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'psi_record_tender_import_item: job % no encontrado', p_job_id;
  end if;

  insert into public.psi_tender_document_import_items
    (job_id, tender_id, opportunity_id, source, source_document_id, source_url, name, status,
     critical, document_version_id, last_error_code, last_error_message)
  values
    (p_job_id, v_job.tender_id, v_job.opportunity_id, p_source, p_source_document_id, p_source_url, p_name,
     coalesce(p_status, 'pending'), coalesce(p_critical, false), p_document_version_id, p_last_error_code, p_last_error_message)
  on conflict (job_id, source, source_document_id) do update set
    source_url = coalesce(excluded.source_url, public.psi_tender_document_import_items.source_url),
    name = excluded.name,
    status = excluded.status,
    critical = excluded.critical,
    document_version_id = coalesce(excluded.document_version_id, public.psi_tender_document_import_items.document_version_id),
    last_error_code = excluded.last_error_code,
    last_error_message = excluded.last_error_message,
    updated_at = now()
  returning id into v_item_id;

  return jsonb_build_object('status', 'ok', 'id', v_item_id);
end;
$$;

create or replace function public.psi_authorize_tender_analysis(
  p_job_id uuid,
  p_authorized_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_tender_processing_jobs%rowtype;
  v_next_status text;
begin
  if p_authorized_by is null or not exists (
    select 1 from public.psi_sales_profiles where id = p_authorized_by and active = true
  ) then
    raise exception 'psi_authorize_tender_analysis: requiere un perfil humano activo';
  end if;

  select * into v_job from public.psi_tender_processing_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'psi_authorize_tender_analysis: job % no encontrado', p_job_id;
  end if;

  v_next_status := v_job.status;
  if v_job.status = 'awaiting_analysis_authorization' and v_job.snapshot_id is not null then
    v_next_status := 'waiting_agent_capacity';
  end if;

  update public.psi_tender_processing_jobs
  set analysis_authorized_by = p_authorized_by,
      analysis_authorized_at = now(),
      status = v_next_status,
      updated_at = now()
  where id = p_job_id;

  insert into public.psi_tender_tracking_events
    (tender_id, event_type, actor_kind, created_by, source_ref_type, source_ref_id)
  values
    (v_job.tender_id, 'analysis_queued', 'human', p_authorized_by, 'job', p_job_id);

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.psi_append_tender_tracking_event(uuid, text, text, uuid, text, uuid, jsonb, text, boolean) from public, authenticated, anon;
revoke all on function public.psi_record_tender_import_item(uuid, text, text, text, text, text, boolean, uuid, text, text) from public, authenticated, anon;
revoke all on function public.psi_authorize_tender_analysis(uuid, uuid) from public, authenticated, anon;
grant execute on function public.psi_append_tender_tracking_event(uuid, text, text, uuid, text, uuid, jsonb, text, boolean) to service_role;
grant execute on function public.psi_record_tender_import_item(uuid, text, text, text, text, text, boolean, uuid, text, text) to service_role;
grant execute on function public.psi_authorize_tender_analysis(uuid, uuid) to service_role;

commit;
