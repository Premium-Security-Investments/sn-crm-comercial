-- Fail-closed rollback: 108 adds REANALYSIS as a successor of the canonical AGT-002 analysis. Once a
-- REANALYSIS job, run or G1 authorization exists, removing the shape would orphan that evidence (and a
-- demoted INITIAL run cannot be re-promoted), so the rollback is refused while any such row exists.
begin;
lock table public.psi_agt002_initial_analysis_jobs in access exclusive mode;
lock table public.psi_agt002_analysis_authorizations in access exclusive mode;
do $$
begin
  if exists (select 1 from public.psi_agt002_initial_analysis_jobs where analysis_kind <> 'INITIAL')
     or exists (select 1 from public.psi_tender_analysis_runs where analysis_kind = 'REANALYSIS')
     or exists (select 1 from public.psi_agt002_analysis_authorizations where workflow_type <> 'INITIAL') then
    raise exception 'Rollback 108 refused: REANALYSIS evidence exists.' using errcode = '55000';
  end if;
end;
$$;

drop function if exists public.psi_complete_agt002_initial_reanalysis_job(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb, text);
drop function if exists public.psi_admit_authorized_agt002_initial_reanalysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid, uuid);

-- Restore 100's G1 grant (INITIAL only), byte-identical.
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
  if v_instance.workflow_type is distinct from 'INITIAL' then
    raise exception 'G1 únicamente autoriza flujos INITIAL, nunca REANALYSIS.' using errcode = '42501';
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
    p_workflow_instance_id, 'INITIAL', v_instance.scope, p_package_version_id, p_package_hash,
    p_actor_profile_id, p_expires_at, p_idempotency_key
  ) returning id into v_authorization_id;

  return jsonb_build_object('status', 'created', 'authorization_id', v_authorization_id);
end;
$$;

revoke all on function public.psi_grant_agt002_g1_analysis_authorization(uuid, uuid, text, timestamptz, text, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_grant_agt002_g1_analysis_authorization(uuid, uuid, text, timestamptz, text, uuid) to service_role;

alter table public.psi_agt002_analysis_authorizations
  drop constraint if exists psi_agt002_analysis_authorizations_workflow_type_check;
alter table public.psi_agt002_analysis_authorizations
  add constraint psi_agt002_analysis_authorizations_workflow_type_check
  check (workflow_type = 'INITIAL');

alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_agt002_reanalysis_shape_check;
alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_agt002_kind_check;
alter table public.psi_tender_analysis_runs
  add constraint psi_tender_analysis_runs_agt002_kind_check
  check (analysis_kind is null or analysis_kind = 'INITIAL');

alter table public.psi_agt002_initial_analysis_jobs
  drop constraint if exists psi_agt002_initial_analysis_jobs_kind_shape_check;
alter table public.psi_agt002_initial_analysis_jobs
  drop column if exists analysis_version,
  drop column if exists source_analysis_run_id,
  drop column if exists analysis_kind;
commit;
