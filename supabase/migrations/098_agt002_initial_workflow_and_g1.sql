-- AGT-002 P0-03 — initial workflow and G1 authorization (initial-analysis slice). Strictly
-- additive beside every deployed AGT-002 object from 097: nothing here drops a table or a
-- column, and no preexisting function is redefined.
--
-- Three new service-role-only, permanently append-only tables:
--   * psi_agt002_workflow_instances     -- one header row per (opportunity, tender, workflow
--     type, scope) identity, keyed for idempotent replay.
--   * psi_agt002_workflow_events        -- the full transition history of a workflow instance.
--     The legal initial-analysis state machine (REQUESTED -> AUTHORIZED|REJECTED; AUTHORIZED ->
--     CONSUMED|REVOKED|EXPIRED; CONSUMED -> COMPLETED|FAILED) is enforced inside
--     psi_append_agt002_workflow_event by walking the prior event's to_state, never merely by a
--     table CHECK.
--   * psi_agt002_analysis_authorizations -- exactly one G1 grant per workflow instance, bound to
--     a real frozen evidence package version+hash from 097. workflow_type is CHECK-pinned to
--     'INITIAL': G1 never authorizes REANALYSIS.
--
-- Four new SECURITY DEFINER, search_path-pinned, service_role-only RPCs:
--   * psi_create_agt002_workflow_instance          -- idempotent instance creation, atomically
--     followed by the null -> REQUESTED creation event.
--   * psi_append_agt002_workflow_event             -- the sole governed transition writer.
--   * psi_grant_agt002_g1_analysis_authorization   -- re-verifies INITIAL + the live frozen
--     package version/hash pair, then writes the AUTHORIZED event and the authorization row
--     atomically.
--   * psi_consume_agt002_analysis_authorization    -- the atomic, advisory-lock-serialized
--     consume-on-create boundary RPC that P0-04 job creation will call. It fails closed on any
--     workflow/opportunity/tender/package_version/package_hash mismatch, on an expired or
--     revoked authorization, and on double consumption. It never references any job table:
--     creating a job is explicitly out of scope here.
begin;

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_workflow_instances
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_workflow_instances (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  workflow_type text not null check (workflow_type in ('INITIAL', 'REANALYSIS')),
  scope text not null check (scope in ('A', 'A_PLUS_B')),
  profile_snapshot_id uuid,
  profile_snapshot_hash text check (profile_snapshot_hash is null or profile_snapshot_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (scope = 'A' and profile_snapshot_id is null and profile_snapshot_hash is null)
    or
    (scope = 'A_PLUS_B' and profile_snapshot_id is not null and profile_snapshot_hash is not null)
  )
);

create unique index if not exists psi_agt002_workflow_instances_idempotency_idx
  on public.psi_agt002_workflow_instances (idempotency_key);

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_workflow_events
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_workflow_events (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references public.psi_agt002_workflow_instances(id) on delete restrict,
  from_state text,
  to_state text not null check (to_state in ('REQUESTED', 'AUTHORIZED', 'REJECTED', 'CONSUMED', 'REVOKED', 'EXPIRED', 'COMPLETED', 'FAILED')),
  actor_profile_id uuid references public.psi_sales_profiles(id) on delete restrict,
  actor_kind text not null check (actor_kind in ('human', 'system')),
  authority text not null check (authority in ('REQUESTER', 'G1', 'SYSTEM')),
  target text not null,
  env text not null check (env in ('production', 'staging', 'test')),
  scope text not null check (scope in ('A', 'A_PLUS_B')),
  preconditions jsonb not null check (jsonb_typeof(preconditions) = 'object'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  expires_at timestamptz,
  rollback_of_event_id uuid references public.psi_agt002_workflow_events(id) on delete restrict,
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  created_at timestamptz not null default now(),
  check ((to_state = 'AUTHORIZED' and expires_at is not null) or to_state <> 'AUTHORIZED')
);

create index if not exists psi_agt002_workflow_events_instance_idx
  on public.psi_agt002_workflow_events (workflow_instance_id, created_at desc, id desc);

create unique index if not exists psi_agt002_workflow_events_idempotency_idx
  on public.psi_agt002_workflow_events (idempotency_key);

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_analysis_authorizations
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_analysis_authorizations (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null unique references public.psi_agt002_workflow_instances(id) on delete restrict,
  workflow_type text not null check (workflow_type = 'INITIAL'),
  scope text not null check (scope in ('A', 'A_PLUS_B')),
  package_version_id uuid not null references public.psi_agt002_evidence_package_versions(id) on delete restrict,
  package_hash text not null check (package_hash ~ '^[0-9a-f]{64}$'),
  granted_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > granted_at),
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null)
);

create unique index if not exists psi_agt002_analysis_authorizations_idempotency_idx
  on public.psi_agt002_analysis_authorizations (idempotency_key);

-- ---------------------------------------------------------------------------------------
-- Permanent append-only enforcement for all three tables.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_agt002_workflow_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '%: el historial de flujos de trabajo AGT-002 es append-only: UPDATE y DELETE están prohibidos', tg_table_name using errcode = '55000';
end;
$$;

drop trigger if exists psi_agt002_workflow_instances_immutable on public.psi_agt002_workflow_instances;
create trigger psi_agt002_workflow_instances_immutable
  before update or delete on public.psi_agt002_workflow_instances
  for each row execute function public.psi_agt002_workflow_prevent_mutation();

drop trigger if exists psi_agt002_workflow_events_immutable on public.psi_agt002_workflow_events;
create trigger psi_agt002_workflow_events_immutable
  before update or delete on public.psi_agt002_workflow_events
  for each row execute function public.psi_agt002_workflow_prevent_mutation();

drop trigger if exists psi_agt002_analysis_authorizations_immutable on public.psi_agt002_analysis_authorizations;
create trigger psi_agt002_analysis_authorizations_immutable
  before update or delete on public.psi_agt002_analysis_authorizations
  for each row execute function public.psi_agt002_workflow_prevent_mutation();

-- ---------------------------------------------------------------------------------------
-- RLS + grants: revoked from every direct role, then service_role read-only. Every write
-- goes exclusively through the governed SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------------------
alter table public.psi_agt002_workflow_instances enable row level security;
revoke all on table public.psi_agt002_workflow_instances from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_workflow_instances to service_role;

alter table public.psi_agt002_workflow_events enable row level security;
revoke all on table public.psi_agt002_workflow_events from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_workflow_events to service_role;

alter table public.psi_agt002_analysis_authorizations enable row level security;
revoke all on table public.psi_agt002_analysis_authorizations from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_analysis_authorizations to service_role;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_append_agt002_workflow_event
-- The sole governed writer of transitions. Walks the prior event's to_state (null on the very
-- first event, when only REQUESTED is legal) and fails closed on any transition outside the
-- legal initial-analysis matrix. An AUTHORIZED transition always requires a non-null expiry.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_append_agt002_workflow_event(
  p_workflow_instance_id uuid,
  p_to_state text,
  p_actor_profile_id uuid,
  p_actor_kind text,
  p_authority text,
  p_target text,
  p_env text,
  p_preconditions jsonb,
  p_evidence jsonb,
  p_expires_at timestamptz,
  p_rollback_of_event_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.psi_agt002_workflow_instances%rowtype;
  v_from_state text;
  v_event_id uuid;
  v_existing_event public.psi_agt002_workflow_events%rowtype;
begin
  if p_workflow_instance_id is null or p_to_state is null or p_actor_kind is null
     or p_authority is null or p_target is null or p_env is null
     or p_preconditions is null or p_evidence is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Todos los campos obligatorios del evento de flujo de trabajo son requeridos.' using errcode = '22023';
  end if;

  -- AUTHORIZED is only ever legal from REQUESTED (see the matrix below), but it must be written
  -- exclusively by psi_grant_agt002_g1_analysis_authorization, never through this public entry
  -- point: this is the sole gate that keeps G1's re-verification of INITIAL + the frozen package
  -- version/hash mandatory for every AUTHORIZED transition.
  if p_to_state = 'AUTHORIZED' then
    raise exception 'Transición a AUTHORIZED no está permitida directamente: use psi_grant_agt002_g1_analysis_authorization.' using errcode = '42501';
  end if;

  if p_actor_kind = 'human' and p_actor_profile_id is null then
    raise exception 'Un actor humano requiere un actor_profile_id no nulo.' using errcode = '22023';
  elsif p_actor_kind = 'system' and p_actor_profile_id is not null then
    raise exception 'Un actor de sistema no debe llevar actor_profile_id.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-workflow-event:' || p_workflow_instance_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('agt002-workflow-event-idem:' || p_idempotency_key, 0));

  select * into v_existing_event
  from public.psi_agt002_workflow_events
  where idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_existing_event.workflow_instance_id is distinct from p_workflow_instance_id
       or v_existing_event.to_state is distinct from p_to_state
       or v_existing_event.actor_profile_id is distinct from p_actor_profile_id
       or v_existing_event.actor_kind is distinct from p_actor_kind
       or v_existing_event.authority is distinct from p_authority
       or v_existing_event.target is distinct from p_target
       or v_existing_event.env is distinct from p_env
       or v_existing_event.preconditions is distinct from p_preconditions
       or v_existing_event.evidence is distinct from p_evidence
       or v_existing_event.expires_at is distinct from p_expires_at
       or v_existing_event.rollback_of_event_id is distinct from p_rollback_of_event_id then
      raise exception 'Ya existe un evento de flujo de trabajo con una clave de idempotencia en conflicto.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'event_id', v_existing_event.id, 'to_state', v_existing_event.to_state);
  end if;

  select * into v_instance
  from public.psi_agt002_workflow_instances
  where id = p_workflow_instance_id
  for share;
  if not found then
    raise exception 'La instancia de flujo de trabajo no existe.' using errcode = 'P0002';
  end if;

  select to_state into v_from_state
  from public.psi_agt002_workflow_events
  where workflow_instance_id = p_workflow_instance_id
  order by created_at desc, id desc
  limit 1;

  if v_from_state is null then
    if p_to_state <> 'REQUESTED' then
      raise exception 'Transición inicial ilegal: solo REQUESTED puede ser el primer estado, se recibió %.', p_to_state using errcode = '55000';
    end if;
  elsif v_from_state = 'REQUESTED' then
    if p_to_state not in ('AUTHORIZED', 'REJECTED') then
      raise exception 'Transición ilegal: % -> %.', v_from_state, p_to_state using errcode = '55000';
    end if;
  elsif v_from_state = 'AUTHORIZED' then
    if p_to_state not in ('CONSUMED', 'REVOKED', 'EXPIRED') then
      raise exception 'Transición ilegal: % -> %.', v_from_state, p_to_state using errcode = '55000';
    end if;
  elsif v_from_state = 'CONSUMED' then
    if p_to_state not in ('COMPLETED', 'FAILED') then
      raise exception 'Transición ilegal: % -> %.', v_from_state, p_to_state using errcode = '55000';
    end if;
  else
    raise exception 'Transición ilegal: el estado % es terminal y no admite % -> %.', v_from_state, v_from_state, p_to_state using errcode = '55000';
  end if;

  insert into public.psi_agt002_workflow_events (
    workflow_instance_id, from_state, to_state, actor_profile_id, actor_kind, authority,
    target, env, scope, preconditions, evidence, expires_at, rollback_of_event_id, idempotency_key
  ) values (
    p_workflow_instance_id, v_from_state, p_to_state, p_actor_profile_id, p_actor_kind, p_authority,
    p_target, p_env, v_instance.scope, p_preconditions, p_evidence, p_expires_at, p_rollback_of_event_id, p_idempotency_key
  ) returning id into v_event_id;

  return jsonb_build_object('status', 'created', 'event_id', v_event_id, 'to_state', p_to_state);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_create_agt002_workflow_instance
-- Idempotent instance creation. A replay under the same idempotency_key with matching fields
-- returns the existing identity, creating nothing new; a divergent payload under the same key
-- fails closed. A genuinely new instance is created atomically with its null -> REQUESTED
-- creation event.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_create_agt002_workflow_instance(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_workflow_type text,
  p_scope text,
  p_profile_snapshot_id uuid,
  p_profile_snapshot_hash text,
  p_idempotency_key text,
  p_actor_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.psi_agt002_workflow_instances%rowtype;
  v_instance_id uuid;
begin
  if p_opportunity_id is null or p_tender_id is null or p_workflow_type is null
     or p_scope is null or p_actor_profile_id is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'La oportunidad, la licitación, el tipo de flujo, el alcance, la clave de idempotencia y el actor son obligatorios.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-workflow-instance:' || p_idempotency_key, 0));

  select * into v_existing
  from public.psi_agt002_workflow_instances
  where idempotency_key = p_idempotency_key
  for share;

  if found then
    if v_existing.opportunity_id is distinct from p_opportunity_id
       or v_existing.tender_id is distinct from p_tender_id
       or v_existing.workflow_type is distinct from p_workflow_type
       or v_existing.scope is distinct from p_scope
       or v_existing.profile_snapshot_id is distinct from p_profile_snapshot_id
       or v_existing.profile_snapshot_hash is distinct from p_profile_snapshot_hash
       or v_existing.created_by is distinct from p_actor_profile_id then
      raise exception 'Ya existe una instancia de flujo de trabajo con una clave de idempotencia en conflicto.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'workflow_instance_id', v_existing.id);
  end if;

  insert into public.psi_agt002_workflow_instances (
    opportunity_id, tender_id, workflow_type, scope, profile_snapshot_id, profile_snapshot_hash,
    idempotency_key, created_by
  ) values (
    p_opportunity_id, p_tender_id, p_workflow_type, p_scope, p_profile_snapshot_id, p_profile_snapshot_hash,
    p_idempotency_key, p_actor_profile_id
  ) returning id into v_instance_id;

  perform public.psi_append_agt002_workflow_event(
    v_instance_id, 'REQUESTED', p_actor_profile_id, 'human', 'REQUESTER',
    'INITIAL_ANALYSIS_WORKFLOW', 'production', '{}'::jsonb, '{}'::jsonb, null, null, p_idempotency_key
  );

  return jsonb_build_object('status', 'created', 'workflow_instance_id', v_instance_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_grant_agt002_g1_analysis_authorization
-- Re-asserts G1 authorizes only INITIAL, re-verifies the package_version/package_hash pair
-- against the live frozen version from 097 (and that it belongs to the same opportunity/tender
-- as the workflow instance), then writes the AUTHORIZED event and the authorization row
-- atomically. A replay under the same idempotency_key with matching bindings is idempotent; a
-- divergent payload fails closed.
-- ---------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------
-- RPC: psi_consume_agt002_analysis_authorization
-- The atomic, advisory-lock-serialized consume-on-create boundary RPC that P0-04 job creation
-- will call. Re-verifies every exact binding (workflow_instance_id, opportunity_id, tender_id,
-- package_version_id, package_hash), fails closed on expiry, on a revoked or otherwise
-- non-AUTHORIZED workflow state, and on double consumption. Never touches any job table.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_consume_agt002_analysis_authorization(
  p_authorization_id uuid,
  p_workflow_instance_id uuid,
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_package_version_id uuid,
  p_package_hash text,
  p_idempotency_key text,
  p_actor_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth public.psi_agt002_analysis_authorizations%rowtype;
  v_instance public.psi_agt002_workflow_instances%rowtype;
  v_latest_state text;
  v_existing_event public.psi_agt002_workflow_events%rowtype;
  v_evidence jsonb;
begin
  if p_authorization_id is null or p_workflow_instance_id is null or p_opportunity_id is null
     or p_tender_id is null or p_package_version_id is null or p_package_hash is null
     or p_actor_profile_id is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Todos los campos del consumo de autorización son obligatorios.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-consume:' || p_authorization_id::text, 0));

  v_evidence := jsonb_build_object(
    'authorization_id', p_authorization_id,
    'opportunity_id', p_opportunity_id,
    'tender_id', p_tender_id,
    'package_version_id', p_package_version_id,
    'package_hash', p_package_hash
  );

  select * into v_existing_event
  from public.psi_agt002_workflow_events
  where workflow_instance_id = p_workflow_instance_id
    and to_state = 'CONSUMED'
    and idempotency_key = p_idempotency_key
  limit 1;
  if found then
    if v_existing_event.evidence is distinct from v_evidence then
      raise exception 'Ya existe un consumo con una clave de idempotencia en conflicto.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'authorization_id', p_authorization_id, 'workflow_instance_id', p_workflow_instance_id);
  end if;

  select * into v_auth
  from public.psi_agt002_analysis_authorizations
  where id = p_authorization_id
  for share;
  if not found then
    raise exception 'La autorización no existe.' using errcode = 'P0002';
  end if;
  if v_auth.workflow_instance_id is distinct from p_workflow_instance_id then
    raise exception 'La autorización no corresponde a la instancia de flujo de trabajo indicada.' using errcode = '42501';
  end if;
  if v_auth.package_version_id is distinct from p_package_version_id then
    raise exception 'La versión del paquete no coincide con la autorización.' using errcode = '42501';
  end if;
  if v_auth.package_hash is distinct from p_package_hash then
    raise exception 'La huella del paquete no coincide con la autorización.' using errcode = '42501';
  end if;

  select * into v_instance
  from public.psi_agt002_workflow_instances
  where id = p_workflow_instance_id
  for share;
  if not found then
    raise exception 'La instancia de flujo de trabajo no existe.' using errcode = 'P0002';
  end if;
  if v_instance.opportunity_id is distinct from p_opportunity_id then
    raise exception 'La oportunidad no coincide con la instancia de flujo de trabajo.' using errcode = '42501';
  end if;
  if v_instance.tender_id is distinct from p_tender_id then
    raise exception 'La licitación no coincide con la instancia de flujo de trabajo.' using errcode = '42501';
  end if;

  if v_auth.expires_at <= now() then
    raise exception 'La autorización ya expiró; no puede consumirse.' using errcode = '55000';
  end if;

  select to_state into v_latest_state
  from public.psi_agt002_workflow_events
  where workflow_instance_id = p_workflow_instance_id
  order by created_at desc, id desc
  limit 1;

  if v_latest_state = 'REVOKED' then
    raise exception 'La autorización ya fue revocada; no puede consumirse.' using errcode = '55000';
  elsif v_latest_state is distinct from 'AUTHORIZED' then
    raise exception 'La instancia de flujo de trabajo no está en estado AUTHORIZED; no puede consumirse.' using errcode = '55000';
  end if;

  perform public.psi_append_agt002_workflow_event(
    p_workflow_instance_id, 'CONSUMED', null, 'system', 'SYSTEM',
    'INITIAL_ANALYSIS_WORKFLOW', 'production', '{}'::jsonb, v_evidence, null, null, p_idempotency_key
  );

  return jsonb_build_object('status', 'consumed', 'authorization_id', p_authorization_id, 'workflow_instance_id', p_workflow_instance_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Grants: revoke from every role first, then grant execute to service_role only.
-- ---------------------------------------------------------------------------------------
revoke all on function public.psi_append_agt002_workflow_event(uuid, text, uuid, text, text, text, text, jsonb, jsonb, timestamptz, uuid, text) from public, authenticated, anon, service_role;
grant execute on function public.psi_append_agt002_workflow_event(uuid, text, uuid, text, text, text, text, jsonb, jsonb, timestamptz, uuid, text) to service_role;

revoke all on function public.psi_create_agt002_workflow_instance(uuid, uuid, text, text, uuid, text, text, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_create_agt002_workflow_instance(uuid, uuid, text, text, uuid, text, text, uuid) to service_role;

revoke all on function public.psi_grant_agt002_g1_analysis_authorization(uuid, uuid, text, timestamptz, text, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_grant_agt002_g1_analysis_authorization(uuid, uuid, text, timestamptz, text, uuid) to service_role;

revoke all on function public.psi_consume_agt002_analysis_authorization(uuid, uuid, uuid, uuid, uuid, text, text, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_consume_agt002_analysis_authorization(uuid, uuid, uuid, uuid, uuid, text, text, uuid) to service_role;

commit;
