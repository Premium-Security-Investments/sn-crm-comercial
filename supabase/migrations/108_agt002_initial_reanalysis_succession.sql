-- AGT-002 INITIAL v2 — REANALYSIS as a governed successor of the canonical analysis.
--
-- The INITIAL slice is single-shot per opportunity (101: a COMPLETED job blocks a second admission
-- with 55001; 106: completion refuses while any canonical run exists). Redoing an analysis with a
-- new evidence package or a company profile therefore needs a successor path. This migration adds
-- it beside INITIAL, reusing the same durable queue, checkpoints, worker and lineage, and never
-- touching the INITIAL RPCs (101/105/106 bodies stay byte-identical):
--
--   * psi_agt002_initial_analysis_jobs gains analysis_kind / source_analysis_run_id /
--     analysis_version (defaults keep every existing row INITIAL v1).
--   * psi_tender_analysis_runs accepts analysis_kind = 'REANALYSIS', always version >= 2 and always
--     superseding another run (063's supersedes_run_id).
--   * G1 may authorize a REANALYSIS workflow instance (a human authorizes every run that costs
--     money); the authorization row records the instance's own workflow_type.
--   * psi_admit_authorized_agt002_initial_reanalysis_job — mirror of 105 bound to the opportunity's
--     current canonical AGT-002 run as its source; version = source version + 1.
--   * psi_complete_agt002_initial_reanalysis_job — mirror of 106 that, atomically, verifies the
--     source is still the current canonical run, demotes it (063's single allowed transition:
--     canonical true -> false, nothing else changes) and publishes the successor as canonical.
--
-- Names deliberately avoid the v1 reanalysis queue (068: psi_agt002_reanalysis_jobs and its
-- psi_*_agt002_reanalysis_job RPCs), which this slice never references.
begin;

-- ---------------------------------------------------------------------------------------
-- Jobs: kind, source and version of the analysis each job produces.
-- ---------------------------------------------------------------------------------------
alter table public.psi_agt002_initial_analysis_jobs
  add column if not exists analysis_kind text not null default 'INITIAL',
  add column if not exists source_analysis_run_id uuid references public.psi_tender_analysis_runs(id) on delete restrict,
  add column if not exists analysis_version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_agt002_initial_analysis_jobs'::regclass
      and conname = 'psi_agt002_initial_analysis_jobs_kind_shape_check'
  ) then
    alter table public.psi_agt002_initial_analysis_jobs
      add constraint psi_agt002_initial_analysis_jobs_kind_shape_check
      check (
        (analysis_kind = 'INITIAL' and source_analysis_run_id is null and analysis_version = 1)
        or (analysis_kind = 'REANALYSIS' and source_analysis_run_id is not null and analysis_version >= 2)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- Runs: widen the AGT-002 kind enum and pin the REANALYSIS shape at the table itself.
-- ---------------------------------------------------------------------------------------
alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_agt002_kind_check;
alter table public.psi_tender_analysis_runs
  add constraint psi_tender_analysis_runs_agt002_kind_check
  check (analysis_kind is null or analysis_kind in ('INITIAL', 'REANALYSIS'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_tender_analysis_runs'::regclass
      and conname = 'psi_tender_analysis_runs_agt002_reanalysis_shape_check'
  ) then
    alter table public.psi_tender_analysis_runs
      add constraint psi_tender_analysis_runs_agt002_reanalysis_shape_check
      check (
        analysis_kind is distinct from 'REANALYSIS'
        or (analysis_version >= 2 and supersedes_run_id is not null and supersedes_run_id <> id)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- G1: the authorization row carries its instance's workflow type (INITIAL or REANALYSIS).
-- The original inline CHECK (workflow_type = 'INITIAL') is unnamed, so it is located by table
-- and column rather than by a guessed name.
-- ---------------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.psi_agt002_analysis_authorizations'::regclass
      and c.contype = 'c'
      and a.attname = 'workflow_type'
  loop
    execute format('alter table public.psi_agt002_analysis_authorizations drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.psi_agt002_analysis_authorizations
  add constraint psi_agt002_analysis_authorizations_workflow_type_check
  check (workflow_type in ('INITIAL', 'REANALYSIS'));

-- Body identical to 100 except: REANALYSIS instances are authorizable, and the row records the
-- instance's own workflow_type instead of the literal 'INITIAL'.
create or replace function public.psi_grant_agt002_g1_analysis_authorization(
  p_workflow_instance_id uuid,
  p_package_version_id uuid,
  p_package_hash text,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_actor_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.psi_agt002_workflow_instances%rowtype;
  v_version public.psi_agt002_evidence_package_versions%rowtype;
  v_package public.psi_agt002_evidence_packages%rowtype;
  v_existing public.psi_agt002_analysis_authorizations%rowtype;
  v_authorization_id uuid;
  v_from_state text;
  v_event_id uuid;
begin
  if p_workflow_instance_id is null or p_package_version_id is null or p_package_hash is null
     or p_expires_at is null or p_actor_profile_id is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Todos los campos de la autorización G1 son obligatorios.' using errcode = '22023';
  end if;

  if p_expires_at <= now() then
    raise exception 'La fecha de expiración de la autorización ya expiró; no puede otorgarse.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-g1-grant:' || p_workflow_instance_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('agt002-g1-grant-idem:' || p_idempotency_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('agt002-workflow-event:' || p_workflow_instance_id::text, 0));

  select * into v_instance
  from public.psi_agt002_workflow_instances
  where id = p_workflow_instance_id
  for share;
  if not found then
    raise exception 'La instancia de flujo de trabajo no existe.' using errcode = 'P0002';
  end if;
  if v_instance.workflow_type not in ('INITIAL', 'REANALYSIS') then
    raise exception 'G1 únicamente autoriza flujos INITIAL o REANALYSIS.' using errcode = '42501';
  end if;

  select * into v_version
  from public.psi_agt002_evidence_package_versions
  where id = p_package_version_id and package_hash = p_package_hash
  for share;
  if not found then
    raise exception 'La versión del paquete de evidencia congelada no coincide con la huella indicada.' using errcode = '55000';
  end if;

  select * into v_package
  from public.psi_agt002_evidence_packages
  where id = v_version.package_id
  for share;
  if v_package.opportunity_id is distinct from v_instance.opportunity_id
     or v_package.tender_id is distinct from v_instance.tender_id then
    raise exception 'El paquete de evidencia congelado no pertenece a la oportunidad y licitación de esta instancia.' using errcode = '42501';
  end if;

  select * into v_existing
  from public.psi_agt002_analysis_authorizations
  where idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_existing.workflow_instance_id is distinct from p_workflow_instance_id
       or v_existing.package_version_id is distinct from p_package_version_id
       or v_existing.package_hash is distinct from p_package_hash
       or v_existing.expires_at is distinct from p_expires_at then
      raise exception 'Ya existe una autorización G1 con una clave de idempotencia en conflicto.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'authorization_id', v_existing.id);
  end if;

  select to_state into v_from_state
  from public.psi_agt002_workflow_events
  where workflow_instance_id = p_workflow_instance_id
  order by created_at desc, id desc
  limit 1;
  if v_from_state is distinct from 'REQUESTED' then
    raise exception 'Transición ilegal: % -> AUTHORIZED.', v_from_state using errcode = '55000';
  end if;

  insert into public.psi_agt002_workflow_events (
    workflow_instance_id, from_state, to_state, actor_profile_id, actor_kind, authority,
    target, env, scope, preconditions, evidence, expires_at, rollback_of_event_id, idempotency_key
  ) values (
    p_workflow_instance_id, v_from_state, 'AUTHORIZED', p_actor_profile_id, 'human', 'G1',
    'INITIAL_ANALYSIS_WORKFLOW', 'production', v_instance.scope, '{}'::jsonb,
    jsonb_build_object('package_version_id', p_package_version_id, 'package_hash', p_package_hash),
    p_expires_at, null, p_idempotency_key
  ) returning id into v_event_id;

  insert into public.psi_agt002_analysis_authorizations (
    workflow_instance_id, workflow_type, scope, package_version_id, package_hash,
    granted_by, expires_at, idempotency_key
  ) values (
    p_workflow_instance_id, v_instance.workflow_type, v_instance.scope, p_package_version_id, p_package_hash,
    p_actor_profile_id, p_expires_at, p_idempotency_key
  ) returning id into v_authorization_id;

  return jsonb_build_object('status', 'created', 'authorization_id', v_authorization_id);
end;
$$;

revoke all on function public.psi_grant_agt002_g1_analysis_authorization(uuid, uuid, text, timestamptz, text, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_grant_agt002_g1_analysis_authorization(uuid, uuid, text, timestamptz, text, uuid) to service_role;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_admit_authorized_agt002_initial_reanalysis_job
-- Mirror of 105 for a REANALYSIS workflow. The source must be the opportunity's current
-- canonical AGT-002 run (INITIAL or an earlier REANALYSIS); the successor's version is the
-- source's + 1. G1 consumption and job creation are one transaction. 55001 (one INITIAL per
-- opportunity) does not apply here; 55000 (one active job per opportunity) still does.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_admit_authorized_agt002_initial_reanalysis_job(
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'batchIndex', grouped.batch_index,
    'phase', 'member_batch_analysis',
    'modelId', v_execution ->> 'modelId',
    'memberIds', grouped.member_ids,
    'expectedMemberIds', grouped.member_ids,
    'requestHash', encode(extensions.digest(p_package_hash || ':member_batch_analysis:' || grouped.batch_index::text, 'sha256'), 'hex')
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
    raise exception 'Los lotes del paquete REANALYSIS no coinciden con su versión congelada.' using errcode = '55000';
  end if;
  v_synthesis_index := jsonb_array_length(v_batches);
  v_batches := v_batches || jsonb_build_array(jsonb_build_object(
    'batchIndex', v_synthesis_index,
    'phase', 'synthesis',
    'modelId', v_execution ->> 'modelId',
    'memberIds', '[]'::jsonb,
    'expectedMemberIds', (select jsonb_agg('batch:' || value order by value::integer) from jsonb_array_elements_text(v_source_indexes)),
    'sourceBatchIndexes', v_source_indexes,
    'requestHash', encode(extensions.digest(p_package_hash || ':synthesis:' || v_synthesis_index::text, 'sha256'), 'hex')
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

revoke all on function public.psi_admit_authorized_agt002_initial_reanalysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_admit_authorized_agt002_initial_reanalysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_complete_agt002_initial_reanalysis_job
-- Mirror of 106's completion for a REANALYSIS job. In one transaction: re-verify the job's
-- source is still the opportunity's current canonical run, demote it, and publish the successor
-- (run + lineage + aggregate v1 + job COMPLETED + workflow COMPLETED). Any failure rolls back
-- everything, so the opportunity always has exactly one canonical analysis.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_complete_agt002_initial_reanalysis_job(
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
  v_source public.psi_tender_analysis_runs%rowtype;
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
    raise exception 'Todos los campos de finalización del reanálisis AGT-002 son obligatorios.' using errcode = '22023';
  end if;
  if p_schema_version is distinct from 'pre_go_analysis.v2' then
    raise exception 'La versión de esquema del agregado REANALYSIS debe ser pre_go_analysis.v2.' using errcode = '22023';
  end if;
  if p_package_hash !~ '^[0-9a-f]{64}$'
     or p_analysis_core_hash !~ '^[0-9a-f]{64}$'
     or p_envelope_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Los hashes del reanálisis deben ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if nullif(btrim(p_policy_version), '') is null then
    raise exception 'La versión de política del reanálisis es obligatoria.' using errcode = '22023';
  end if;
  if p_g1_scope not in ('A', 'A_PLUS_B') then
    raise exception 'El alcance G1 no es válido.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_envelope) <> 'object' then
    raise exception 'El agregado debe ser un objeto estructurado.' using errcode = '22023';
  end if;

  select * into v_job from public.psi_agt002_initial_analysis_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'El job de reanálisis no existe.' using errcode = 'P0002';
  end if;
  if v_job.analysis_kind is distinct from 'REANALYSIS' then
    raise exception 'El job no es un reanálisis; use la finalización INITIAL.' using errcode = '42501';
  end if;

  if v_job.status = 'COMPLETED' then
    select * into v_existing_run from public.psi_tender_analysis_runs where id = v_job.analysis_run_id for share;
    select * into v_existing_lineage from public.psi_agt002_initial_analysis_run_lineage where job_id = p_job_id for share;
    if found and v_existing_lineage.analysis_run_id = p_analysis_run_id then
      select * into v_existing_version
      from public.psi_agt002_pre_go_analysis_versions
      where analysis_run_id = p_analysis_run_id and aggregate_version = 1
      for share;
      if v_job.analysis_run_id is distinct from p_analysis_run_id
         or v_existing_run.id is null
         or v_existing_run.opportunity_id is distinct from v_job.opportunity_id
         or v_existing_run.tender_id is distinct from v_job.tender_id
         or v_existing_run.analysis_kind is distinct from 'REANALYSIS'
         or v_existing_run.analysis_version is distinct from v_job.analysis_version
         or v_existing_run.supersedes_run_id is distinct from v_job.source_analysis_run_id
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
        raise exception 'El job de reanálisis ya se completó con un resultado distinto; el reintento no es un replay idéntico.' using errcode = '23505';
      end if;
      return jsonb_build_object('status', 'existing', 'job_id', p_job_id, 'analysis_run_id', v_existing_lineage.analysis_run_id, 'aggregate_version', 1);
    end if;
    raise exception 'El job de reanálisis ya se completó con otra ejecución.' using errcode = '23505';
  end if;

  if v_job.status not in ('CLAIMED', 'RUNNING') then
    raise exception 'El job de reanálisis no está en ejecución.' using errcode = '55000';
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
    raise exception 'No puede completarse un reanálisis sin su checkpoint de síntesis persistido.' using errcode = '22023';
  end if;

  -- Same lock as the INITIAL completion (106): every canonical publication for one opportunity
  -- is serialized.
  perform pg_advisory_xact_lock(hashtextextended('agt002-initial-analysis-complete:' || v_job.opportunity_id::text, 0));

  select * into v_source from public.psi_tender_analysis_runs
  where id = v_job.source_analysis_run_id
  for update;
  if v_source.id is null
     or v_source.opportunity_id is distinct from v_job.opportunity_id
     or v_source.canonical is not true
     or v_source.status is distinct from 'completed'
     or v_source.analysis_kind is null
     or v_source.analysis_version is distinct from v_job.analysis_version - 1 then
    raise exception 'La corrida fuente ya no es el análisis canónico vigente; el reanálisis quedó obsoleto.' using errcode = '55000';
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
  if v_auth.id is null or v_auth.workflow_type is distinct from 'REANALYSIS'
     or v_auth.package_version_id is distinct from p_package_version_id
     or v_auth.package_hash is distinct from p_package_hash or v_auth.scope is distinct from p_g1_scope then
    raise exception 'La autorización G1 no coincide con el paquete de evidencia o el alcance indicados.' using errcode = '22023';
  end if;
  if v_auth.workflow_instance_id is distinct from p_workflow_instance_id then
    raise exception 'La autorización G1 no corresponde a la instancia de flujo de trabajo indicada.' using errcode = '22023';
  end if;
  select * into v_workflow from public.psi_agt002_workflow_instances where id = p_workflow_instance_id for share;
  if v_workflow.id is null
     or v_workflow.workflow_type is distinct from 'REANALYSIS'
     or v_workflow.opportunity_id is distinct from v_job.opportunity_id
     or v_workflow.tender_id is distinct from v_job.tender_id
     or v_workflow.scope is distinct from p_g1_scope then
    raise exception 'La instancia de flujo de trabajo no coincide con la identidad completa del job REANALYSIS.' using errcode = '42501';
  end if;
  select to_state into v_workflow_state
  from public.psi_agt002_workflow_events
  where workflow_instance_id = p_workflow_instance_id
  order by created_at desc, id desc
  limit 1;
  if v_workflow_state is distinct from 'CONSUMED' then
    raise exception 'La instancia de flujo de trabajo no está en estado CONSUMED; no puede completarse.' using errcode = '55000';
  end if;

  v_meta := p_envelope -> 'meta';
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception 'El agregado debe incluir un bloque meta estructurado.' using errcode = '22023';
  end if;
  if v_meta ->> 'schema_version' is distinct from 'pre_go_analysis.v2' then
    raise exception 'meta.schema_version del agregado REANALYSIS debe ser pre_go_analysis.v2.' using errcode = '22023';
  end if;
  if v_meta ->> 'analysis_kind' is distinct from 'REANALYSIS' then
    raise exception 'meta.analysis_kind del agregado debe ser REANALYSIS.' using errcode = '22023';
  end if;
  if v_meta -> 'analysis_version' is distinct from to_jsonb(v_job.analysis_version) then
    raise exception 'meta.analysis_version del reanálisis no coincide con la versión admitida.' using errcode = '22023';
  end if;
  if v_meta ->> 'source_analysis_run_id' is distinct from v_job.source_analysis_run_id::text then
    raise exception 'meta.source_analysis_run_id del reanálisis no coincide con la corrida fuente admitida.' using errcode = '22023';
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

  -- 063's single allowed transition: canonical true -> false, no other column changes.
  update public.psi_tender_analysis_runs set canonical = false where id = v_source.id;

  insert into public.psi_tender_analysis_runs (
    id, snapshot_id, opportunity_id, tender_id, producer, method, status, result, critical_open_count,
    idempotency_key, schema_version, policy_version, completed_at, canonical, supersedes_run_id,
    analysis_kind, analysis_version,
    g1_authorization_id, g1_scope, package_version_id, analysis_core_hash
  ) values (
    p_analysis_run_id, null, v_job.opportunity_id, v_job.tender_id, 'AGT-002', 'agent_ai', 'completed', p_envelope, 0,
    v_job.idempotency_key || ':initial-reanalysis', p_schema_version, p_policy_version, now(), true, v_source.id,
    'REANALYSIS', v_job.analysis_version,
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
    jsonb_build_object('analysis_run_id', p_analysis_run_id::text, 'supersedes_run_id', v_source.id::text), null, null,
    v_job.idempotency_key || ':workflow-completed'
  );

  return jsonb_build_object(
    'status', 'completed', 'job_id', p_job_id, 'analysis_run_id', p_analysis_run_id,
    'aggregate_version', 1, 'lineage_id', v_lineage_id, 'supersedes_run_id', v_source.id
  );
end;
$$;

revoke all on function public.psi_complete_agt002_initial_reanalysis_job(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb, text) from public, authenticated, anon, service_role;
grant execute on function public.psi_complete_agt002_initial_reanalysis_job(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb, text) to service_role;

commit;
