-- Replaces 036's auto-authorization shortcut. Under 036, a manual Radar -> Opportunity
-- conversion stamped analysis_authorized_by/analysis_authorized_at on the new processing job at
-- creation time, reasoning that the same custody gate (LICITACIONES_CONVERT) that authorized the
-- conversion already covered the separate AI_ANALYSIS_RUN authorization. That shortcut is no
-- longer correct: AGT-002 analysis is now only ever enqueued through the governed document
-- workset freeze (084, public.psi_freeze_agt002_governed_document_workset), which requires its
-- own explicit human review of the exact document package before anything runs. A new job must
-- therefore stay unauthorized and 'queued' at creation — the worker/import path may later move it
-- to 'awaiting_analysis_authorization' once a snapshot exists, and only a governed freeze may take
-- it from there into an actual AGT-002 run.
--
-- Minimum safe replacement: byte-for-byte 036's psi_create_tender_processing_job — same
-- signature, same human-profile and converted-tender validation, same advisory lock, same
-- existing-active-job and idempotency handling, same tracking events, same
-- security definer/search_path/grants — with only the analysis_authorized_by/analysis_authorized_at
-- columns dropped from the insert. No backfill, no UPDATE of existing rows: 036's one-time
-- backfill already ran when 036 was applied, and rewriting or reverting a human's historical
-- authorization here would silently alter custody history. Only new conversions change behavior.
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
  if p_requested_by is null or not exists (
    select 1 from public.psi_sales_profiles
    where id = p_requested_by and active = true
  ) then
    raise exception 'psi_create_tender_processing_job: requiere un perfil humano activo';
  end if;

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

  -- La conversión manual sigue siendo un requisito (fail-closed, arriba), pero ya no autoriza el
  -- análisis por sí sola: el job nace 'queued' y sin autorización. La autorización humana del
  -- análisis AGT-002 ahora ocurre exclusivamente al congelar el paquete gobernado de documentos
  -- (084), nunca en el momento de convertir el Radar en Oportunidad.
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

revoke all on function public.psi_authorize_tender_analysis(uuid, uuid) from public, anon, authenticated, service_role;

commit;
