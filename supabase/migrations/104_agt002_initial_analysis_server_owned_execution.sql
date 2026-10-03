-- AGT-002 P0-10/P0-11 reduced closure: the authorized admission RPC derives the complete
-- execution plan from the frozen package. Callers may supply only the bounded runtime profile;
-- persistence identity, run id, member batches and synthesis topology are server-owned.
begin;

create or replace function public.psi_admit_authorized_agt002_initial_analysis_job(
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
  p_actor_profile_id uuid
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
  v_execution jsonb;
  v_budget jsonb;
  v_batches jsonb;
  v_source_indexes jsonb;
  v_synthesis_index integer;
  v_analysis_run_id uuid;
  v_payload jsonb;
  v_admission jsonb;
begin
  if p_authorization_id is null or p_workflow_instance_id is null or p_opportunity_id is null
     or p_tender_id is null or p_package_version_id is null or p_actor_profile_id is null
     or nullif(btrim(coalesce(p_package_hash, '')), '') is null
     or nullif(btrim(coalesce(p_policy_version, '')), '') is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Todos los campos de la admisión autorizada INITIAL son obligatorios.' using errcode = '22023';
  end if;
  if p_package_hash !~ '^[0-9a-f]{64}$' or p_g1_scope not in ('A', 'A_PLUS_B') then
    raise exception 'La huella o el alcance G1 de la admisión INITIAL no es válido.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or (select count(*) from jsonb_object_keys(p_payload)) <> 2
     or not (p_payload ? 'execution' and p_payload ? 'budget') then
    raise exception 'El payload INITIAL sólo admite execution y budget.' using errcode = '22023';
  end if;
  v_execution := p_payload -> 'execution';
  v_budget := p_payload -> 'budget';
  if jsonb_typeof(v_execution) <> 'object' or jsonb_typeof(v_budget) <> 'object'
     or (select count(*) from jsonb_object_keys(v_execution)) <> 3
     or not (v_execution ? 'modelId' and v_execution ? 'timeoutMs' and v_execution ? 'reasoningEffort')
     or (select count(*) from jsonb_object_keys(v_budget)) <> 4
     or not (v_budget ? 'maxTotalTokens' and v_budget ? 'maxCostUsd'
       and v_budget ? 'inputCostPerMillionUsd' and v_budget ? 'outputCostPerMillionUsd') then
    raise exception 'La configuración durable INITIAL tiene una forma no permitida.' using errcode = '22023';
  end if;
  if nullif(btrim(v_execution ->> 'modelId'), '') is null
     or (v_execution ->> 'timeoutMs')::integer <= 0
     or v_execution ->> 'reasoningEffort' not in ('low', 'medium', 'high', 'xhigh')
     or (v_budget ->> 'maxTotalTokens')::integer <= 0
     or (v_budget ->> 'maxCostUsd')::numeric <= 0
     or (v_budget ->> 'inputCostPerMillionUsd')::numeric <= 0
     or (v_budget ->> 'outputCostPerMillionUsd')::numeric <= 0 then
    raise exception 'La configuración durable INITIAL contiene límites no válidos.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-initial-authorized-admit:' || p_idempotency_key, 0));

  select * into v_authorization from public.psi_agt002_analysis_authorizations
  where id = p_authorization_id for share;
  if not found or v_authorization.workflow_type is distinct from 'INITIAL'
     or v_authorization.workflow_instance_id is distinct from p_workflow_instance_id
     or v_authorization.package_version_id is distinct from p_package_version_id
     or v_authorization.package_hash is distinct from p_package_hash
     or v_authorization.scope is distinct from p_g1_scope then
    raise exception 'La autorización G1 no coincide con la admisión INITIAL.' using errcode = '42501';
  end if;

  select * into v_workflow from public.psi_agt002_workflow_instances
  where id = p_workflow_instance_id for share;
  if not found or v_workflow.workflow_type is distinct from 'INITIAL'
     or v_workflow.opportunity_id is distinct from p_opportunity_id
     or v_workflow.tender_id is distinct from p_tender_id
     or v_workflow.scope is distinct from p_g1_scope then
    raise exception 'La instancia de flujo no coincide con la admisión INITIAL.' using errcode = '42501';
  end if;

  select * into v_version from public.psi_agt002_evidence_package_versions
  where id = p_package_version_id and package_hash = p_package_hash for share;
  if not found then
    raise exception 'El paquete congelado de la admisión INITIAL no existe.' using errcode = 'P0002';
  end if;

  select * into v_existing from public.psi_agt002_initial_analysis_jobs
  where idempotency_key = p_idempotency_key for share;
  if found then
    v_analysis_run_id := nullif(v_existing.payload -> 'persistence' ->> 'analysisRunId', '')::uuid;
  else
    v_analysis_run_id := gen_random_uuid();
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'batchIndex', grouped.batch_index,
    'phase', 'member_batch_analysis',
    'modelId', v_execution ->> 'modelId',
    'memberIds', grouped.member_ids,
    'expectedMemberIds', grouped.member_ids,
    'requestHash', encode(digest(p_package_hash || ':member_batch_analysis:' || grouped.batch_index::text, 'sha256'), 'hex')
  ) order by grouped.batch_index), '[]'::jsonb),
  coalesce(jsonb_agg(to_jsonb(grouped.batch_index) order by grouped.batch_index), '[]'::jsonb)
  into v_batches, v_source_indexes
  from (
    select batch_index, jsonb_agg(document_version_id::text order by document_version_id::text collate "C") as member_ids
    from public.psi_agt002_evidence_package_members
    where package_version_id = p_package_version_id
    group by batch_index
  ) grouped;

  if jsonb_array_length(v_batches) is distinct from v_version.batch_count
     or jsonb_array_length(v_batches) = 0 then
    raise exception 'Los lotes del paquete INITIAL no coinciden con su versión congelada.' using errcode = '55000';
  end if;
  v_synthesis_index := jsonb_array_length(v_batches);
  v_batches := v_batches || jsonb_build_array(jsonb_build_object(
    'batchIndex', v_synthesis_index,
    'phase', 'synthesis',
    'modelId', v_execution ->> 'modelId',
    'memberIds', '[]'::jsonb,
    'expectedMemberIds', (select jsonb_agg('batch:' || value order by value::integer) from jsonb_array_elements_text(v_source_indexes)),
    'sourceBatchIndexes', v_source_indexes,
    'requestHash', encode(digest(p_package_hash || ':synthesis:' || v_synthesis_index::text, 'sha256'), 'hex')
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
      'analysisRunId', v_analysis_run_id
    )
  );

  perform public.psi_consume_agt002_analysis_authorization(
    p_authorization_id, p_workflow_instance_id, p_opportunity_id, p_tender_id,
    p_package_version_id, p_package_hash, p_idempotency_key || ':g1-consume', p_actor_profile_id
  );
  v_admission := public.psi_admit_agt002_initial_analysis_job(
    p_opportunity_id, p_tender_id, p_idempotency_key, v_payload, p_actor_profile_id::text
  );
  if v_admission ->> 'status' = 'payload_mismatch' then
    raise exception 'Ya existe una admisión INITIAL con la misma clave y bindings distintos.' using errcode = '23505';
  end if;
  return v_admission;
end;
$$;

revoke all on function public.psi_admit_authorized_agt002_initial_analysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_admit_authorized_agt002_initial_analysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid) to service_role;

commit;
