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

  -- Solo una conversión manual válida a Oportunidad autoriza el análisis
  -- AGT-002: p_requested_by ya superó el mismo gate de custodia
  -- (LICITACIONES_CONVERT) que exige la autorización separada
  -- (AI_ANALYSIS_RUN) -- ambos resuelven a canTenderCustodyAction. Exigir un
  -- segundo clic humano después de convertir es redundante, así que el job
  -- nace autorizado por el mismo actor que convirtió.
  insert into public.psi_tender_processing_jobs
    (tender_id, opportunity_id, pipeline_version, idempotency_key, status, current_step, requested_by,
     analysis_authorized_by, analysis_authorized_at)
  values
    (p_tender_id, p_opportunity_id, p_pipeline_version, p_idempotency_key, 'queued', 'documents', p_requested_by,
     p_requested_by, now())
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

-- Compatibilidad con jobs históricos: todo job existente solo pudo crearse a
-- través de psi_create_tender_processing_job, es decir, ya pasó por una
-- conversión manual válida con el mismo actor de custodia. Backfill puro
-- (UPDATE, ninguna fila nueva, ningún analysis_run nuevo): completa la
-- autorización con el mismo requested_by y, únicamente si el job ya tiene un
-- snapshot vigente y estaba esperando el segundo clic humano, lo avanza a
-- waiting_agent_capacity. Un job aún sin snapshot (importando/descubriendo
-- documentos) o terminal permanece exactamente donde estaba: fail-closed.
update public.psi_tender_processing_jobs j
set analysis_authorized_by = requested_by,
    analysis_authorized_at = coalesce(analysis_authorized_at, now()),
    status = case
      when status = 'awaiting_analysis_authorization' and snapshot_id is not null
        then 'waiting_agent_capacity'
      else status
    end,
    updated_at = now()
where analysis_authorized_by is null
  and exists (
    select 1 from public.psi_public_tenders t
    where t.id = j.tender_id
      and t.internal_status = 'convertida_oportunidad'
      and t.converted_opportunity_id = j.opportunity_id
  );

commit;
