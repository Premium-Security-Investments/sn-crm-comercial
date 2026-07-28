begin;

create table if not exists public.psi_agt003_copilot_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (idempotency_key ~ '^[a-f0-9]{64}$'),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  snapshot_id text not null check (nullif(btrim(snapshot_id), '') is not null),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  contract_version text not null check (nullif(btrim(contract_version), '') is not null),
  capability_id text not null check (capability_id = 'agt003.opportunity-copilot.preview'),
  policy_version text not null check (nullif(btrim(policy_version), '') is not null),
  model text not null check (nullif(btrim(model), '') is not null),
  status text not null check (status in ('completed', 'failed')),
  output jsonb,
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  output_hash text check (output_hash is null or output_hash ~ '^[a-f0-9]{64}$'),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z0-9_]{1,80}$'),
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  check (
    (status = 'completed' and output is not null and jsonb_typeof(output) = 'object' and output_hash is not null and failure_code is null)
    or
    (status = 'failed' and output is null and output_hash is null and failure_code is not null)
  )
);

create index if not exists psi_agt003_copilot_runs_opportunity_idx
  on public.psi_agt003_copilot_runs(opportunity_id, created_at desc);
create index if not exists psi_agt003_copilot_runs_daily_idx
  on public.psi_agt003_copilot_runs(created_at desc);

create table if not exists public.psi_agt003_copilot_feedback (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.psi_agt003_copilot_runs(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  rating text not null check (rating in ('useful', 'needs_change', 'discarded')),
  comment text check (comment is null or char_length(comment) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists psi_agt003_copilot_feedback_run_idx
  on public.psi_agt003_copilot_feedback(run_id, created_at desc);

create table if not exists public.psi_agt003_copilot_claims (
  idempotency_key text primary key check (idempotency_key ~ '^[a-f0-9]{64}$'),
  claim_id uuid not null unique default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  lease_expires_at timestamptz not null check (lease_expires_at > claimed_at)
);

create index if not exists psi_agt003_copilot_claims_active_idx
  on public.psi_agt003_copilot_claims(lease_expires_at, claimed_at);

alter table public.psi_agt003_copilot_runs enable row level security;
alter table public.psi_agt003_copilot_feedback enable row level security;
alter table public.psi_agt003_copilot_claims enable row level security;

revoke all on table public.psi_agt003_copilot_runs from public, anon, authenticated, service_role;
revoke all on table public.psi_agt003_copilot_feedback from public, anon, authenticated, service_role;
revoke all on table public.psi_agt003_copilot_claims from public, anon, authenticated, service_role;

create or replace function public.psi_reject_agt003_append_only_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Los registros AGT-003 son append-only.' using errcode = '55000';
end;
$$;

revoke all on function public.psi_reject_agt003_append_only_mutation() from public, anon, authenticated, service_role;

drop trigger if exists trg_psi_agt003_copilot_runs_append_only on public.psi_agt003_copilot_runs;
create trigger trg_psi_agt003_copilot_runs_append_only
before update or delete on public.psi_agt003_copilot_runs
for each row execute function public.psi_reject_agt003_append_only_mutation();

drop trigger if exists trg_psi_agt003_copilot_feedback_append_only on public.psi_agt003_copilot_feedback;
create trigger trg_psi_agt003_copilot_feedback_append_only
before update or delete on public.psi_agt003_copilot_feedback
for each row execute function public.psi_reject_agt003_append_only_mutation();

create or replace function public.psi_claim_agt003_copilot_run(
  p_idempotency_key text,
  p_daily_max_runs integer,
  p_max_concurrent integer,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start_day timestamptz;
  v_claim public.psi_agt003_copilot_claims%rowtype;
  v_active integer;
  v_daily integer;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$' then
    raise exception 'La clave de idempotencia AGT-003 no es válida.' using errcode = '22023';
  end if;
  if p_daily_max_runs is null or p_daily_max_runs <= 0
    or p_max_concurrent is null or p_max_concurrent <= 0
    or p_lease_seconds is null or p_lease_seconds <= 0 or p_lease_seconds > 600 then
    raise exception 'Los límites de reserva AGT-003 no son válidos.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('psi_agt003_copilot_claims:v1', 0));

  if exists (select 1 from public.psi_agt003_copilot_runs where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('status', 'existing');
  end if;

  delete from public.psi_agt003_copilot_claims where lease_expires_at <= v_now;
  select * into v_claim from public.psi_agt003_copilot_claims where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('status', 'in_progress'); end if;

  select count(*)::integer into v_active
  from public.psi_agt003_copilot_claims
  where lease_expires_at > v_now;
  if v_active >= p_max_concurrent then return jsonb_build_object('status', 'saturated'); end if;

  v_start_day := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  select
    (select count(*) from public.psi_agt003_copilot_runs run where run.created_at >= v_start_day)
    +
    (select count(*) from public.psi_agt003_copilot_claims claim
      where claim.claimed_at >= v_start_day and claim.lease_expires_at > v_now)
  into v_daily;
  if v_daily >= p_daily_max_runs then return jsonb_build_object('status', 'quota'); end if;

  insert into public.psi_agt003_copilot_claims(idempotency_key, lease_expires_at)
  values (p_idempotency_key, v_now + make_interval(secs => p_lease_seconds))
  returning * into v_claim;
  return jsonb_build_object('status', 'claimed', 'claim_id', v_claim.claim_id);
end;
$$;

create or replace function public.psi_get_agt003_copilot_run_by_key(
  p_idempotency_key text
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(r)
  from (
    select id, opportunity_id, idempotency_key, status, output, failure_code, created_at, completed_at
    from public.psi_agt003_copilot_runs
    where idempotency_key = p_idempotency_key
  ) r;
$$;

create or replace function public.psi_get_agt003_copilot_run_by_id(
  p_run_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(r)
  from (
    select id, opportunity_id, idempotency_key, status, output, failure_code, created_at, completed_at
    from public.psi_agt003_copilot_runs
    where id = p_run_id
  ) r;
$$;

create or replace function public.psi_release_agt003_copilot_claim(
  p_idempotency_key text,
  p_claim_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$' or p_claim_id is null then
    raise exception 'La reserva AGT-003 no es válida.' using errcode = '22023';
  end if;
  delete from public.psi_agt003_copilot_claims
  where idempotency_key = p_idempotency_key and claim_id = p_claim_id;
  return true;
end;
$$;

create or replace function public.psi_record_agt003_copilot_run(
  p_idempotency_key text,
  p_claim_id uuid,
  p_opportunity_id uuid,
  p_actor_id uuid,
  p_snapshot_id text,
  p_contract_version text,
  p_capability_id text,
  p_policy_version text,
  p_model text,
  p_output jsonb,
  p_usage jsonb,
  p_input_hash text,
  p_output_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_existing public.psi_agt003_copilot_runs%rowtype;
  v_saved public.psi_agt003_copilot_runs%rowtype;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$'
    or p_claim_id is null or p_opportunity_id is null or p_actor_id is null
    or nullif(btrim(p_snapshot_id), '') is null or nullif(btrim(p_contract_version), '') is null
    or p_capability_id <> 'agt003.opportunity-copilot.preview'
    or nullif(btrim(p_policy_version), '') is null or nullif(btrim(p_model), '') is null
    or p_output is null or jsonb_typeof(p_output) <> 'object'
    or p_usage is null or jsonb_typeof(p_usage) <> 'object'
    or p_input_hash !~ '^[a-f0-9]{64}$' or p_output_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'El registro AGT-003 no es válido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('psi_agt003_copilot_claims:v1', 0));
  select * into v_existing from public.psi_agt003_copilot_runs where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.opportunity_id = p_opportunity_id
      and v_existing.actor_id = p_actor_id
      and v_existing.snapshot_id = p_snapshot_id
      and v_existing.contract_version = p_contract_version
      and v_existing.capability_id = p_capability_id
      and v_existing.policy_version = p_policy_version
      and v_existing.model = p_model
      and v_existing.status = 'completed'
      and v_existing.output = p_output
      and v_existing.usage = p_usage
      and v_existing.input_hash = p_input_hash
      and v_existing.output_hash = p_output_hash then
      return to_jsonb(v_existing);
    end if;
    raise exception 'Conflicto de idempotencia AGT-003: la clave ya existe con otro contenido.' using errcode = '23505';
  end if;

  if not exists (
    select 1 from public.psi_agt003_copilot_claims
    where idempotency_key = p_idempotency_key and claim_id = p_claim_id and lease_expires_at > v_now
  ) then
    raise exception 'La reserva AGT-003 no existe o expiró.' using errcode = '55000';
  end if;

  insert into public.psi_agt003_copilot_runs(
    idempotency_key, opportunity_id, snapshot_id, actor_id, contract_version,
    capability_id, policy_version, model, status, output, usage, input_hash,
    output_hash, completed_at
  ) values (
    p_idempotency_key, p_opportunity_id, p_snapshot_id, p_actor_id, p_contract_version,
    p_capability_id, p_policy_version, p_model, 'completed', p_output, p_usage,
    p_input_hash, p_output_hash, v_now
  ) returning * into v_saved;

  delete from public.psi_agt003_copilot_claims
  where idempotency_key = p_idempotency_key and claim_id = p_claim_id;
  return to_jsonb(v_saved);
end;
$$;

create or replace function public.psi_record_agt003_copilot_failure(
  p_idempotency_key text,
  p_claim_id uuid,
  p_opportunity_id uuid,
  p_actor_id uuid,
  p_snapshot_id text,
  p_contract_version text,
  p_capability_id text,
  p_policy_version text,
  p_model text,
  p_usage jsonb,
  p_input_hash text,
  p_failure_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_existing public.psi_agt003_copilot_runs%rowtype;
  v_saved public.psi_agt003_copilot_runs%rowtype;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$'
    or p_claim_id is null or p_opportunity_id is null or p_actor_id is null
    or nullif(btrim(p_snapshot_id), '') is null or nullif(btrim(p_contract_version), '') is null
    or p_capability_id <> 'agt003.opportunity-copilot.preview'
    or nullif(btrim(p_policy_version), '') is null or nullif(btrim(p_model), '') is null
    or p_usage is null or jsonb_typeof(p_usage) <> 'object'
    or p_input_hash !~ '^[a-f0-9]{64}$'
    or p_failure_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'El fallo AGT-003 no es válido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('psi_agt003_copilot_claims:v1', 0));
  select * into v_existing from public.psi_agt003_copilot_runs where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.opportunity_id = p_opportunity_id
      and v_existing.actor_id = p_actor_id
      and v_existing.snapshot_id = p_snapshot_id
      and v_existing.contract_version = p_contract_version
      and v_existing.capability_id = p_capability_id
      and v_existing.policy_version = p_policy_version
      and v_existing.model = p_model
      and v_existing.status = 'failed'
      and v_existing.usage = p_usage
      and v_existing.input_hash = p_input_hash
      and v_existing.failure_code = p_failure_code then
      return to_jsonb(v_existing);
    end if;
    raise exception 'Conflicto de idempotencia AGT-003: la clave ya existe con otro contenido.' using errcode = '23505';
  end if;

  if not exists (
    select 1 from public.psi_agt003_copilot_claims
    where idempotency_key = p_idempotency_key and claim_id = p_claim_id and lease_expires_at > v_now
  ) then
    raise exception 'La reserva AGT-003 no existe o expiró.' using errcode = '55000';
  end if;

  insert into public.psi_agt003_copilot_runs(
    idempotency_key, opportunity_id, snapshot_id, actor_id, contract_version,
    capability_id, policy_version, model, status, output, usage, input_hash,
    output_hash, failure_code, completed_at
  ) values (
    p_idempotency_key, p_opportunity_id, p_snapshot_id, p_actor_id, p_contract_version,
    p_capability_id, p_policy_version, p_model, 'failed', null, p_usage,
    p_input_hash, null, p_failure_code, v_now
  ) returning * into v_saved;

  delete from public.psi_agt003_copilot_claims
  where idempotency_key = p_idempotency_key and claim_id = p_claim_id;
  return to_jsonb(v_saved);
end;
$$;

create or replace function public.psi_record_agt003_copilot_feedback(
  p_run_id uuid,
  p_opportunity_id uuid,
  p_actor_id uuid,
  p_rating text,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_saved public.psi_agt003_copilot_feedback%rowtype;
begin
  if p_run_id is null or p_opportunity_id is null or p_actor_id is null
    or p_rating not in ('useful', 'needs_change', 'discarded')
    or (p_comment is not null and (char_length(btrim(p_comment)) < 1 or char_length(p_comment) > 2000)) then
    raise exception 'El feedback AGT-003 no es válido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_agt003_copilot_runs
    where id = p_run_id and opportunity_id = p_opportunity_id
  ) then
    raise exception 'La ejecución AGT-003 no pertenece a la oportunidad.' using errcode = '23503';
  end if;
  insert into public.psi_agt003_copilot_feedback(run_id, opportunity_id, actor_id, rating, comment)
  values (p_run_id, p_opportunity_id, p_actor_id, p_rating, case when p_comment is null then null else btrim(p_comment) end)
  returning * into v_saved;
  return to_jsonb(v_saved);
end;
$$;

revoke all on function public.psi_claim_agt003_copilot_run(text, integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.psi_claim_agt003_copilot_run(text, integer, integer, integer) to service_role;
revoke all on function public.psi_get_agt003_copilot_run_by_key(text) from public, anon, authenticated, service_role;
grant execute on function public.psi_get_agt003_copilot_run_by_key(text) to service_role;
revoke all on function public.psi_get_agt003_copilot_run_by_id(uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_get_agt003_copilot_run_by_id(uuid) to service_role;
revoke all on function public.psi_release_agt003_copilot_claim(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_release_agt003_copilot_claim(text, uuid) to service_role;
revoke all on function public.psi_record_agt003_copilot_run(text, uuid, uuid, uuid, text, text, text, text, text, jsonb, jsonb, text, text) from public, anon, authenticated, service_role;
grant execute on function public.psi_record_agt003_copilot_run(text, uuid, uuid, uuid, text, text, text, text, text, jsonb, jsonb, text, text) to service_role;
revoke all on function public.psi_record_agt003_copilot_failure(text, uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text) from public, anon, authenticated, service_role;
grant execute on function public.psi_record_agt003_copilot_failure(text, uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text) to service_role;
revoke all on function public.psi_record_agt003_copilot_feedback(uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.psi_record_agt003_copilot_feedback(uuid, uuid, uuid, text, text) to service_role;

commit;
