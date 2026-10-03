-- AGT-002 INITIAL atomic admission boundary.
--
-- G1 consumption and durable job creation are one PostgreSQL transaction. The caller supplies
-- the governed identities, but this function independently re-verifies them and constructs the
-- payload.persistence envelope itself. The older ungoverned admission RPC remains as an
-- implementation primitive for this SECURITY DEFINER function, but service_role can no longer
-- execute it directly after this migration.
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
  if p_package_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'La huella del paquete debe ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if p_g1_scope not in ('A', 'A_PLUS_B') then
    raise exception 'El alcance G1 no es válido.' using errcode = '22023';
  end if;
  if p_payload is not null and jsonb_typeof(p_payload) <> 'object' then
    raise exception 'El payload del análisis inicial debe ser un objeto.' using errcode = '22023';
  end if;

  -- Serialize every replay/conflict under the durable job identity before inspecting bindings.
  perform pg_advisory_xact_lock(hashtextextended('agt002-initial-authorized-admit:' || p_idempotency_key, 0));

  select * into v_authorization
  from public.psi_agt002_analysis_authorizations
  where id = p_authorization_id
  for share;
  if not found then
    raise exception 'La autorización G1 no existe.' using errcode = 'P0002';
  end if;
  if v_authorization.workflow_type is distinct from 'INITIAL'
     or v_authorization.workflow_instance_id is distinct from p_workflow_instance_id
     or v_authorization.package_version_id is distinct from p_package_version_id
     or v_authorization.package_hash is distinct from p_package_hash
     or v_authorization.scope is distinct from p_g1_scope then
    raise exception 'La autorización G1 no coincide con las identidades de la admisión INITIAL.' using errcode = '42501';
  end if;

  select * into v_workflow
  from public.psi_agt002_workflow_instances
  where id = p_workflow_instance_id
  for share;
  if not found then
    raise exception 'La instancia de flujo de trabajo no existe.' using errcode = 'P0002';
  end if;
  if v_workflow.workflow_type is distinct from 'INITIAL'
     or v_workflow.opportunity_id is distinct from p_opportunity_id
     or v_workflow.tender_id is distinct from p_tender_id
     or v_workflow.scope is distinct from p_g1_scope then
    raise exception 'La instancia de flujo de trabajo no coincide con la admisión INITIAL.' using errcode = '42501';
  end if;

  -- A caller-provided persistence member is always discarded. The only accepted lineage
  -- envelope is reconstructed from the bindings re-verified above.
  v_payload := (coalesce(p_payload, '{}'::jsonb) - 'persistence') || jsonb_build_object(
    'persistence', jsonb_build_object(
      'workflowInstanceId', p_workflow_instance_id,
      'authorizationId', p_authorization_id,
      'packageVersionId', p_package_version_id,
      'packageHash', p_package_hash,
      'g1Scope', p_g1_scope,
      'policyVersion', p_policy_version
    )
  );

  -- Both calls execute inside this function's transaction. Any later admission conflict raises
  -- below and rolls the CONSUMED event back with it.
  perform public.psi_consume_agt002_analysis_authorization(
    p_authorization_id,
    p_workflow_instance_id,
    p_opportunity_id,
    p_tender_id,
    p_package_version_id,
    p_package_hash,
    p_idempotency_key || ':g1-consume',
    p_actor_profile_id
  );

  v_admission := public.psi_admit_agt002_initial_analysis_job(
    p_opportunity_id,
    p_tender_id,
    p_idempotency_key,
    v_payload,
    p_actor_profile_id::text
  );

  if v_admission ->> 'status' = 'payload_mismatch' then
    raise exception 'Ya existe una admisión INITIAL con la misma clave y bindings distintos.' using errcode = '23505';
  end if;

  return v_admission;
end;
$$;

-- The legacy primitive is no longer an externally executable service-role surface. Only this
-- migration's atomic authorized boundary is exposed to service_role.
revoke all on function public.psi_admit_agt002_initial_analysis_job(uuid, uuid, text, jsonb, text) from public, authenticated, anon, service_role;
revoke all on function public.psi_admit_authorized_agt002_initial_analysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_admit_authorized_agt002_initial_analysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid) to service_role;

commit;
