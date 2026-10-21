-- Rollback de 141: vuelve la admisión incremental de la 139 (sólo documentos) y quita las aclaraciones.
begin;
create or replace function public.psi_admit_authorized_agt002_incremental_reanalysis_job(
  p_authorization_id uuid,
  p_workflow_instance_id uuid,
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_package_version_id uuid,
  p_package_hash text,
  p_g1_scope text,
  p_policy_version text,
  p_idempotency_key text,
  p_payload jsonb,
  p_actor_profile_id uuid,
  p_source_analysis_run_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization public.psi_agt002_analysis_authorizations%rowtype;
  v_workflow public.psi_agt002_workflow_instances%rowtype;
  v_version public.psi_agt002_evidence_package_versions%rowtype;
  v_existing public.psi_agt002_initial_analysis_jobs%rowtype;
  v_active public.psi_agt002_initial_analysis_jobs%rowtype;
  v_source public.psi_tender_analysis_runs%rowtype;
  v_execution jsonb;
  v_budget jsonb;
  v_batches jsonb;
  v_source_indexes jsonb;
  v_synthesis_index integer;
  v_analysis_run_id uuid;
  v_analysis_version integer;
  v_payload jsonb;
  v_job_id uuid;
  v_source_package_version_id uuid;
begin
  if p_authorization_id is null or p_workflow_instance_id is null or p_opportunity_id is null
     or p_tender_id is null or p_package_version_id is null or p_actor_profile_id is null
     or p_source_analysis_run_id is null
     or nullif(btrim(coalesce(p_package_hash, '')), '') is null
     or nullif(btrim(coalesce(p_policy_version, '')), '') is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Todos los campos de la admisión autorizada REANALYSIS son obligatorios.' using errcode = '22023';
  end if;
  if p_package_hash !~ '^[0-9a-f]{64}$' or p_g1_scope not in ('A', 'A_PLUS_B') then
    raise exception 'La huella o el alcance G1 de la admisión REANALYSIS no es válido.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or (select count(*) from jsonb_object_keys(p_payload)) <> 2
     or not (p_payload ? 'execution' and p_payload ? 'budget') then
    raise exception 'El payload REANALYSIS sólo admite execution y budget.' using errcode = '22023';
  end if;
  v_execution := p_payload -> 'execution';
  v_budget := p_payload -> 'budget';
  if jsonb_typeof(v_execution) <> 'object' or jsonb_typeof(v_budget) <> 'object'
     or (select count(*) from jsonb_object_keys(v_execution)) <> 3
     or not (v_execution ? 'modelId' and v_execution ? 'timeoutMs' and v_execution ? 'reasoningEffort')
     or (select count(*) from jsonb_object_keys(v_budget)) <> 4
     or not (v_budget ? 'maxTotalTokens' and v_budget ? 'maxCostUsd'
       and v_budget ? 'inputCostPerMillionUsd' and v_budget ? 'outputCostPerMillionUsd') then
    raise exception 'La configuración durable REANALYSIS tiene una forma no permitida.' using errcode = '22023';
  end if;
  if nullif(btrim(v_execution ->> 'modelId'), '') is null
     or (v_execution ->> 'timeoutMs')::integer <= 0
     or v_execution ->> 'reasoningEffort' not in ('low', 'medium', 'high', 'xhigh')
     or (v_budget ->> 'maxTotalTokens')::integer <= 0
     or (v_budget ->> 'maxCostUsd')::numeric <= 0
     or (v_budget ->> 'inputCostPerMillionUsd')::numeric <= 0
     or (v_budget ->> 'outputCostPerMillionUsd')::numeric <= 0 then
    raise exception 'La configuración durable REANALYSIS contiene límites no válidos.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-initial-authorized-admit:' || p_idempotency_key, 0));
  -- Same per-opportunity lock as the INITIAL admission primitive (101), so INITIAL and REANALYSIS
  -- admissions for one opportunity are serialized against each other.
  perform pg_advisory_xact_lock(hashtext('psi_agt002_initial_analysis_jobs:' || p_opportunity_id::text));

  select * into v_authorization from public.psi_agt002_analysis_authorizations
  where id = p_authorization_id for share;
  if not found or v_authorization.workflow_type is distinct from 'REANALYSIS'
     or v_authorization.workflow_instance_id is distinct from p_workflow_instance_id
     or v_authorization.package_version_id is distinct from p_package_version_id
     or v_authorization.package_hash is distinct from p_package_hash
     or v_authorization.scope is distinct from p_g1_scope then
    raise exception 'La autorización G1 no coincide con la admisión REANALYSIS.' using errcode = '42501';
  end if;

  select * into v_workflow from public.psi_agt002_workflow_instances
  where id = p_workflow_instance_id for share;
  if not found or v_workflow.workflow_type is distinct from 'REANALYSIS'
     or v_workflow.opportunity_id is distinct from p_opportunity_id
     or v_workflow.tender_id is distinct from p_tender_id
     or v_workflow.scope is distinct from p_g1_scope then
    raise exception 'La instancia de flujo no coincide con la admisión REANALYSIS.' using errcode = '42501';
  end if;

  select * into v_version from public.psi_agt002_evidence_package_versions
  where id = p_package_version_id and package_hash = p_package_hash for share;
  if not found then
    raise exception 'El paquete congelado de la admisión REANALYSIS no existe.' using errcode = 'P0002';
  end if;

  select * into v_existing from public.psi_agt002_initial_analysis_jobs
  where idempotency_key = p_idempotency_key for share;
  if found then
    v_analysis_run_id := nullif(v_existing.payload -> 'persistence' ->> 'analysisRunId', '')::uuid;
    v_analysis_version := v_existing.analysis_version;
  else
    -- The source must be the opportunity's current canonical AGT-002 analysis right now.
    select * into v_source from public.psi_tender_analysis_runs
    where id = p_source_analysis_run_id for share;
    if not found
       or v_source.opportunity_id is distinct from p_opportunity_id
       or v_source.tender_id is distinct from p_tender_id
       or v_source.canonical is not true
       or v_source.status is distinct from 'completed'
       or v_source.analysis_kind is null
       or v_source.analysis_version is null then
      raise exception 'La corrida fuente no es el análisis canónico vigente de la oportunidad.' using errcode = '55000';
    end if;
    v_analysis_run_id := gen_random_uuid();
    v_analysis_version := v_source.analysis_version + 1;
  end if;

  -- Paquete con el que se hizo la corrida fuente: los documentos que ya leyó.
  select nullif(payload -> 'persistence' ->> 'packageVersionId', '')::uuid into v_source_package_version_id
  from public.psi_agt002_initial_analysis_jobs
  where analysis_run_id = p_source_analysis_run_id and status = 'COMPLETED'
  order by updated_at desc limit 1;
  if v_source_package_version_id is null then
    raise exception 'No se encontró el paquete de la corrida fuente del reanálisis incremental.' using errcode = '55000';
  end if;

  -- Sólo se leen los documentos nuevos o cambiados (versión que no estaba en el paquete fuente), en lotes de 12.
  select coalesce(jsonb_agg(jsonb_build_object(
    'batchIndex', grouped.batch_index,
    'phase', 'member_batch_analysis',
    'modelId', v_execution ->> 'modelId',
    'memberIds', grouped.member_ids,
    'expectedMemberIds', grouped.member_ids,
    'requestHash', encode(extensions.digest(p_package_hash || ':incremental:' || p_source_analysis_run_id::text || ':member_batch_analysis:' || grouped.batch_index::text, 'sha256'), 'hex')
  ) order by grouped.batch_index), '[]'::jsonb),
  coalesce(jsonb_agg(to_jsonb(grouped.batch_index) order by grouped.batch_index), '[]'::jsonb)
  into v_batches, v_source_indexes
  from (
    select (ordinal - 1) / 12 as batch_index, jsonb_agg(member_id order by member_id collate "C") as member_ids
    from (
      select m.document_version_id::text as member_id,
             row_number() over (order by m.document_version_id::text collate "C") as ordinal
      from public.psi_agt002_evidence_package_members m
      where m.package_version_id = p_package_version_id
        and not exists (
          select 1 from public.psi_agt002_evidence_package_members s
          where s.package_version_id = v_source_package_version_id
            and s.document_version_id = m.document_version_id
        )
    ) fresh
    group by (ordinal - 1) / 12
  ) grouped;

  if jsonb_array_length(v_batches) = 0 then
    raise exception 'No hay documentos nuevos frente al análisis vigente: no hay nada que analizar en modo incremental.' using errcode = '22023';
  end if;
  v_synthesis_index := jsonb_array_length(v_batches);
  v_batches := v_batches || jsonb_build_array(jsonb_build_object(
    'batchIndex', v_synthesis_index,
    'phase', 'synthesis',
    'modelId', v_execution ->> 'modelId',
    'memberIds', '[]'::jsonb,
    'expectedMemberIds', (select jsonb_agg('batch:' || value order by value::integer) from jsonb_array_elements_text(v_source_indexes)),
    'sourceBatchIndexes', v_source_indexes,
    'mode', 'incremental',
    'priorAnalysisRunId', p_source_analysis_run_id,
    'requestHash', encode(extensions.digest(p_package_hash || ':incremental:' || p_source_analysis_run_id::text || ':synthesis:' || v_synthesis_index::text, 'sha256'), 'hex')
  ));

  v_payload := jsonb_build_object(
    'execution', v_execution,
    'budget', v_budget,
    'batches', v_batches,
    'persistence', jsonb_build_object(
      'workflowInstanceId', p_workflow_instance_id,
      'authorizationId', p_authorization_id,
      'packageVersionId', p_package_version_id,
      'packageHash', p_package_hash,
      'g1Scope', p_g1_scope,
      'policyVersion', p_policy_version,
      'analysisRunId', v_analysis_run_id,
      'analysisKind', 'REANALYSIS',
      'analysisVersion', v_analysis_version,
      'sourceAnalysisRunId', p_source_analysis_run_id
    )
  );

  if v_existing.id is not null then
    if v_existing.opportunity_id is distinct from p_opportunity_id
       or v_existing.tender_id is distinct from p_tender_id
       or v_existing.analysis_kind is distinct from 'REANALYSIS'
       or v_existing.source_analysis_run_id is distinct from p_source_analysis_run_id
       or v_existing.payload is distinct from v_payload
       or v_existing.requested_by is distinct from p_actor_profile_id::text then
      raise exception 'Ya existe una admisión REANALYSIS con la misma clave y bindings distintos.' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status', 'existing',
      'job_id', v_existing.id,
      'opportunity_id', v_existing.opportunity_id,
      'tender_id', v_existing.tender_id,
      'idempotency_key', v_existing.idempotency_key,
      'payload', v_existing.payload,
      'requested_by', v_existing.requested_by,
      'job_status', v_existing.status
    );
  end if;

  select * into v_active from public.psi_agt002_initial_analysis_jobs
  where opportunity_id = p_opportunity_id
    and status in ('QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION')
  limit 1;
  if found then
    raise exception 'Ya existe un job AGT-002 de análisis activo (%) para la oportunidad', v_active.status using errcode = '55000';
  end if;

  perform public.psi_consume_agt002_analysis_authorization(
    p_authorization_id, p_workflow_instance_id, p_opportunity_id, p_tender_id,
    p_package_version_id, p_package_hash, p_idempotency_key || ':g1-consume', p_actor_profile_id
  );

  insert into public.psi_agt002_initial_analysis_jobs
    (opportunity_id, tender_id, idempotency_key, payload, requested_by, status,
     analysis_kind, source_analysis_run_id, analysis_version)
  values
    (p_opportunity_id, p_tender_id, p_idempotency_key, v_payload, p_actor_profile_id::text, 'QUEUED',
     'REANALYSIS', p_source_analysis_run_id, v_analysis_version)
  returning id into v_job_id;

  return jsonb_build_object(
    'status', 'admitted',
    'job_id', v_job_id,
    'opportunity_id', p_opportunity_id,
    'tender_id', p_tender_id,
    'idempotency_key', p_idempotency_key,
    'payload', v_payload,
    'requested_by', p_actor_profile_id::text,
    'job_status', 'QUEUED'
  );
end;
$$;

revoke all on function public.psi_admit_authorized_agt002_incremental_reanalysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_admit_authorized_agt002_incremental_reanalysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid, uuid) to service_role;

drop function if exists public.psi_record_agt002_clarification(uuid, uuid, text, text, text, text);
drop table if exists public.psi_agt002_clarifications;
drop function if exists public.psi_agt002_clarifications_append_only();
commit;
