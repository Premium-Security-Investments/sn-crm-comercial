-- AGT-002 INITIAL: the first analysis is published with the pre_go_analysis.v2 envelope (v1 minus the
-- render manifest, which does not exist yet when the first analysis is published). This migration
--   * lets the aggregate-versions table store v1 (later stages) or v2 (the INITIAL first aggregate), and
--   * makes the one INITIAL completion RPC require v2 in both p_schema_version and meta.schema_version.
-- The RPC body is otherwise byte-identical to migration 102 and its grants are unchanged.
begin;

alter table public.psi_agt002_pre_go_analysis_versions
  drop constraint if exists psi_agt002_pre_go_analysis_versions_schema_version_check;
alter table public.psi_agt002_pre_go_analysis_versions
  add constraint psi_agt002_pre_go_analysis_versions_schema_version_check
  check (schema_version in ('pre_go_analysis.v1', 'pre_go_analysis.v2'));

create or replace function public.psi_complete_agt002_initial_analysis_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_fence_version integer,
  p_analysis_run_id uuid,
  p_workflow_instance_id uuid,
  p_authorization_id uuid,
  p_package_version_id uuid,
  p_package_hash text,
  p_g1_scope text,
  p_analysis_core_hash text,
  p_policy_version text,
  p_schema_version text,
  p_envelope jsonb,
  p_envelope_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_initial_analysis_jobs%rowtype;
  v_existing_run public.psi_tender_analysis_runs%rowtype;
  v_existing_lineage public.psi_agt002_initial_analysis_run_lineage%rowtype;
  v_existing_version public.psi_agt002_pre_go_analysis_versions%rowtype;
  v_synthesis public.psi_agt002_initial_analysis_checkpoints%rowtype;
  v_version public.psi_agt002_evidence_package_versions%rowtype;
  v_package public.psi_agt002_evidence_packages%rowtype;
  v_auth public.psi_agt002_analysis_authorizations%rowtype;
  v_workflow public.psi_agt002_workflow_instances%rowtype;
  v_workflow_state text;
  v_meta jsonb;
  v_lineage_id uuid;
begin
  if p_job_id is null or p_lease_id is null or p_fence_version is null or p_analysis_run_id is null
     or p_workflow_instance_id is null or p_authorization_id is null or p_package_version_id is null
     or p_package_hash is null or p_g1_scope is null or p_analysis_core_hash is null
     or p_policy_version is null or p_schema_version is null or p_envelope is null or p_envelope_hash is null then
    raise exception 'Todos los campos de finalización del análisis inicial AGT-002 son obligatorios.' using errcode = '22023';
  end if;
  if p_schema_version is distinct from 'pre_go_analysis.v2' then
    raise exception 'La versión de esquema del agregado INITIAL debe ser pre_go_analysis.v2.' using errcode = '22023';
  end if;
  if p_package_hash !~ '^[0-9a-f]{64}$'
     or p_analysis_core_hash !~ '^[0-9a-f]{64}$'
     or p_envelope_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Los hashes del análisis inicial deben ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if nullif(btrim(p_policy_version), '') is null then
    raise exception 'La versión de política del análisis inicial es obligatoria.' using errcode = '22023';
  end if;
  if p_g1_scope not in ('A', 'A_PLUS_B') then
    raise exception 'El alcance G1 no es válido.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_envelope) <> 'object' then
    raise exception 'El agregado debe ser un objeto estructurado.' using errcode = '22023';
  end if;

  select * into v_job from public.psi_agt002_initial_analysis_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'El job de análisis inicial no existe.' using errcode = 'P0002';
  end if;

  if v_job.status = 'COMPLETED' then
    select * into v_existing_run
    from public.psi_tender_analysis_runs
    where id = v_job.analysis_run_id
    for share;
    select * into v_existing_lineage from public.psi_agt002_initial_analysis_run_lineage where job_id = p_job_id for share;
    if found and v_existing_lineage.analysis_run_id = p_analysis_run_id then
      -- Same job, same run: still only idempotent if every lineage binding and the aggregate v1
      -- row itself match the incoming parameters byte for byte. This is a replay check, not a
      -- re-derivation — any discrepancy (a caller retrying with different bindings or a
      -- different envelope/hash under the same run id) is a 23505 conflict, never a silent reuse
      -- of whatever happened to be persisted first.
      select * into v_existing_version
      from public.psi_agt002_pre_go_analysis_versions
      where analysis_run_id = p_analysis_run_id and aggregate_version = 1
      for share;
      if v_job.analysis_run_id is distinct from p_analysis_run_id
         or v_existing_run.id is null
         or v_existing_run.opportunity_id is distinct from v_job.opportunity_id
         or v_existing_run.tender_id is distinct from v_job.tender_id
         or v_existing_run.analysis_kind is distinct from 'INITIAL'
         or v_existing_run.analysis_version is distinct from 1
         or v_existing_run.g1_authorization_id is distinct from p_authorization_id
         or v_existing_run.g1_scope is distinct from p_g1_scope
         or v_existing_run.package_version_id is distinct from p_package_version_id
         or v_existing_run.analysis_core_hash is distinct from p_analysis_core_hash
         or v_existing_run.policy_version is distinct from p_policy_version
         or v_existing_run.schema_version is distinct from p_schema_version
         or v_existing_run.result is distinct from p_envelope
         or v_existing_lineage.workflow_instance_id is distinct from p_workflow_instance_id
         or v_existing_lineage.authorization_id is distinct from p_authorization_id
         or v_existing_lineage.package_version_id is distinct from p_package_version_id
         or v_existing_version.id is null
         or v_existing_version.analysis_core_hash is distinct from p_analysis_core_hash
         or v_existing_version.envelope_hash is distinct from p_envelope_hash
         or v_existing_version.envelope is distinct from p_envelope
         or v_existing_version.schema_version is distinct from p_schema_version
         or v_existing_version.aggregate_stage is distinct from 'ANALYSIS_PUBLISHED'
         or v_existing_version.aggregate_version is distinct from 1 then
        raise exception 'El job de análisis inicial ya se completó con un resultado distinto; el reintento no es un replay idéntico.' using errcode = '23505';
      end if;
      return jsonb_build_object('status', 'existing', 'job_id', p_job_id, 'analysis_run_id', v_existing_lineage.analysis_run_id, 'aggregate_version', 1);
    end if;
    raise exception 'El job de análisis inicial ya se completó con otra ejecución.' using errcode = '23505';
  end if;

  if v_job.status not in ('CLAIMED', 'RUNNING') then
    raise exception 'El job de análisis inicial no está en ejecución.' using errcode = '55000';
  end if;
  if v_job.lease_id is distinct from p_lease_id
     or v_job.fence_version is distinct from p_fence_version
     or v_job.lease_expires_at is null or v_job.lease_expires_at <= now() then
    raise exception 'El job perdió su reserva antes de poder completarse.' using errcode = '55000';
  end if;

  select * into v_synthesis
  from public.psi_agt002_initial_analysis_checkpoints
  where job_id = p_job_id and phase = 'synthesis'
  for share;
  if v_synthesis.id is null then
    raise exception 'No puede completarse un análisis inicial sin su checkpoint de síntesis persistido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-initial-analysis-complete:' || v_job.opportunity_id::text, 0));

  if exists (
    select 1 from public.psi_tender_analysis_runs
    where opportunity_id = v_job.opportunity_id and canonical and status = 'completed'
  ) then
    raise exception 'Ya existe un análisis canónico para esta oportunidad; el análisis inicial nunca reemplaza uno existente.' using errcode = '55000';
  end if;

  select * into v_version from public.psi_agt002_evidence_package_versions where id = p_package_version_id for share;
  if v_version.id is null or v_version.package_hash is distinct from p_package_hash then
    raise exception 'La versión del paquete de evidencia congelada no coincide con la huella indicada.' using errcode = '22023';
  end if;
  select * into v_package from public.psi_agt002_evidence_packages where id = v_version.package_id for share;
  if v_package.opportunity_id is distinct from v_job.opportunity_id or v_package.tender_id is distinct from v_job.tender_id then
    raise exception 'El paquete de evidencia congelado no pertenece a la oportunidad y licitación del job.' using errcode = '42501';
  end if;

  select * into v_auth from public.psi_agt002_analysis_authorizations where id = p_authorization_id for share;
  if v_auth.id is null or v_auth.package_version_id is distinct from p_package_version_id
     or v_auth.package_hash is distinct from p_package_hash or v_auth.scope is distinct from p_g1_scope then
    raise exception 'La autorización G1 no coincide con el paquete de evidencia o el alcance indicados.' using errcode = '22023';
  end if;
  if v_auth.workflow_instance_id is distinct from p_workflow_instance_id then
    raise exception 'La autorización G1 no corresponde a la instancia de flujo de trabajo indicada.' using errcode = '22023';
  end if;
  select * into v_workflow
  from public.psi_agt002_workflow_instances
  where id = p_workflow_instance_id
  for share;
  if v_workflow.id is null
     or v_workflow.workflow_type is distinct from 'INITIAL'
     or v_workflow.opportunity_id is distinct from v_job.opportunity_id
     or v_workflow.tender_id is distinct from v_job.tender_id
     or v_workflow.scope is distinct from p_g1_scope then
    raise exception 'La instancia de flujo de trabajo no coincide con la identidad completa del job INITIAL.' using errcode = '42501';
  end if;
  select to_state into v_workflow_state
  from public.psi_agt002_workflow_events
  where workflow_instance_id = p_workflow_instance_id
  order by created_at desc, id desc
  limit 1;
  if v_workflow_state is distinct from 'CONSUMED' then
    raise exception 'La instancia de flujo de trabajo no está en estado CONSUMED; no puede completarse.' using errcode = '55000';
  end if;

  -- Re-check the envelope's own meta block against every parameter before trusting it: the
  -- caller's full JSON-Schema validation happens in JS, but the DB never takes the envelope's
  -- self-reported identity on faith.
  v_meta := p_envelope -> 'meta';
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception 'El agregado debe incluir un bloque meta estructurado.' using errcode = '22023';
  end if;
  if v_meta ->> 'schema_version' is distinct from 'pre_go_analysis.v2' then
    raise exception 'meta.schema_version del agregado INITIAL debe ser pre_go_analysis.v2.' using errcode = '22023';
  end if;
  if v_meta ->> 'analysis_kind' is distinct from 'INITIAL' then
    raise exception 'meta.analysis_kind del agregado debe ser INITIAL.' using errcode = '22023';
  end if;
  if v_meta -> 'analysis_version' is distinct from '1'::jsonb then
    raise exception 'meta.analysis_version de un análisis INITIAL debe ser 1.' using errcode = '22023';
  end if;
  if v_meta ->> 'aggregate_stage' is distinct from 'ANALYSIS_PUBLISHED' then
    raise exception 'meta.aggregate_stage del primer agregado debe ser ANALYSIS_PUBLISHED.' using errcode = '22023';
  end if;
  if v_meta -> 'aggregate_version' is distinct from '1'::jsonb then
    raise exception 'meta.aggregate_version del primer agregado debe ser 1.' using errcode = '22023';
  end if;
  if p_envelope -> 'human_decision' is distinct from 'null'::jsonb then
    raise exception 'human_decision del primer agregado (ANALYSIS_PUBLISHED) debe ser nulo.' using errcode = '22023';
  end if;
  if v_meta ->> 'analysis_run_id' is distinct from p_analysis_run_id::text then
    raise exception 'meta.analysis_run_id del agregado no coincide con la ejecución indicada.' using errcode = '22023';
  end if;
  if v_meta ->> 'analysis_core_hash' is distinct from p_analysis_core_hash then
    raise exception 'meta.analysis_core_hash del agregado no coincide con el hash indicado.' using errcode = '22023';
  end if;
  if v_meta ->> 'g1_authorization_id' is distinct from p_authorization_id::text then
    raise exception 'meta.g1_authorization_id del agregado no coincide con la autorización indicada.' using errcode = '22023';
  end if;
  if v_meta ->> 'g1_scope' is distinct from p_g1_scope then
    raise exception 'meta.g1_scope del agregado no coincide con el alcance indicado.' using errcode = '22023';
  end if;
  if v_meta ->> 'package_hash' is distinct from p_package_hash then
    raise exception 'meta.package_hash del agregado no coincide con la huella del paquete indicado.' using errcode = '22023';
  end if;
  if v_meta ->> 'opportunity_id' is distinct from v_job.opportunity_id::text
     or v_meta ->> 'tender_id' is distinct from v_job.tender_id::text then
    raise exception 'meta.opportunity_id/tender_id del agregado no coinciden con el job.' using errcode = '22023';
  end if;
  if v_synthesis.output is distinct from p_envelope then
    raise exception 'El agregado final no coincide con el checkpoint de síntesis persistido.' using errcode = '22023';
  end if;

  insert into public.psi_tender_analysis_runs (
    id, snapshot_id, opportunity_id, tender_id, producer, method, status, result, critical_open_count,
    idempotency_key, schema_version, policy_version, completed_at, canonical,
    analysis_kind, analysis_version,
    g1_authorization_id, g1_scope, package_version_id, analysis_core_hash
  ) values (
    p_analysis_run_id, null, v_job.opportunity_id, v_job.tender_id, 'AGT-002', 'agent_ai', 'completed', p_envelope, 0,
    v_job.idempotency_key || ':initial-analysis', p_schema_version, p_policy_version, now(), true,
    'INITIAL', 1,
    p_authorization_id, p_g1_scope, p_package_version_id, p_analysis_core_hash
  );

  insert into public.psi_agt002_initial_analysis_run_lineage (
    analysis_run_id, job_id, workflow_instance_id, authorization_id, package_version_id, opportunity_id, tender_id
  ) values (
    p_analysis_run_id, p_job_id, p_workflow_instance_id, p_authorization_id, p_package_version_id, v_job.opportunity_id, v_job.tender_id
  ) returning id into v_lineage_id;

  insert into public.psi_agt002_pre_go_analysis_versions (
    analysis_run_id, aggregate_version, aggregate_stage, schema_version, envelope, envelope_hash, analysis_core_hash, created_by
  ) values (
    p_analysis_run_id, 1, 'ANALYSIS_PUBLISHED', p_schema_version, p_envelope, p_envelope_hash, p_analysis_core_hash, 'system'
  );

  update public.psi_agt002_initial_analysis_jobs
  set status = 'COMPLETED', analysis_run_id = p_analysis_run_id, lease_id = null, lease_expires_at = null, updated_at = now()
  where id = p_job_id;

  perform public.psi_append_agt002_workflow_event(
    p_workflow_instance_id, 'COMPLETED', null, 'system', 'SYSTEM',
    'INITIAL_ANALYSIS_WORKFLOW', 'production', '{}'::jsonb,
    jsonb_build_object('analysis_run_id', p_analysis_run_id::text), null, null,
    v_job.idempotency_key || ':workflow-completed'
  );

  return jsonb_build_object(
    'status', 'completed', 'job_id', p_job_id, 'analysis_run_id', p_analysis_run_id,
    'aggregate_version', 1, 'lineage_id', v_lineage_id
  );
end;
$$;

revoke all on function public.psi_complete_agt002_initial_analysis_job(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb, text) from public, authenticated, anon, service_role;
grant execute on function public.psi_complete_agt002_initial_analysis_job(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb, text) to service_role;

commit;
