begin;

-- Short-lived reservations make AGT-002 idempotency, concurrency and quota
-- enforcement atomic across HTTP requests and server instances. No prompt,
-- document content, credential or model output is stored here.
create table if not exists public.psi_agt002_preview_claims (
  idempotency_key text primary key check (nullif(btrim(idempotency_key), '') is not null),
  claim_id uuid not null unique default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  lease_expires_at timestamptz not null check (lease_expires_at > claimed_at)
);

create index if not exists psi_agt002_preview_claims_active_idx
  on public.psi_agt002_preview_claims(lease_expires_at, claimed_at);

revoke all on table public.psi_agt002_preview_claims from public;
revoke all on table public.psi_agt002_preview_claims from anon;
revoke all on table public.psi_agt002_preview_claims from authenticated;
revoke all on table public.psi_agt002_preview_claims from service_role;

create or replace function public.psi_claim_agt002_preview_run(
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
  v_claim public.psi_agt002_preview_claims%rowtype;
  v_active integer;
  v_daily integer;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'La clave de idempotencia AGT-002 es obligatoria.' using errcode = '22023';
  end if;
  if p_daily_max_runs is null or p_daily_max_runs <= 0
     or p_max_concurrent is null or p_max_concurrent <= 0
     or p_lease_seconds is null or p_lease_seconds <= 0 or p_lease_seconds > 600 then
    raise exception 'Los límites de reserva AGT-002 no son válidos.' using errcode = '22023';
  end if;

  -- One transaction-scoped lock serializes all capacity decisions. The lease
  -- persists after this transaction while the provider call runs.
  perform pg_advisory_xact_lock(hashtextextended('psi_agt002_preview_claims:v1', 0));

  if exists (select 1 from public.psi_tender_analysis_runs where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('status', 'existing');
  end if;

  delete from public.psi_agt002_preview_claims where lease_expires_at <= v_now;

  select * into v_claim
  from public.psi_agt002_preview_claims
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'in_progress');
  end if;

  select count(*)::integer into v_active
  from public.psi_agt002_preview_claims
  where lease_expires_at > v_now;
  if v_active >= p_max_concurrent then
    return jsonb_build_object('status', 'saturated');
  end if;

  v_start_day := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  select
    (select count(*) from public.psi_tender_analysis_runs
      where producer = 'AGT-002' and created_at >= v_start_day)
    +
    (select count(*) from public.psi_agt002_preview_claims claim
      where claim.claimed_at >= v_start_day
        and claim.lease_expires_at > v_now
        and not exists (
          select 1 from public.psi_tender_analysis_runs run
          where run.idempotency_key = claim.idempotency_key
        ))
  into v_daily;
  if v_daily >= p_daily_max_runs then
    return jsonb_build_object('status', 'quota');
  end if;

  insert into public.psi_agt002_preview_claims(idempotency_key, lease_expires_at)
  values (p_idempotency_key, v_now + make_interval(secs => p_lease_seconds))
  returning * into v_claim;

  return jsonb_build_object('status', 'claimed', 'claim_id', v_claim.claim_id);
end;
$$;

create or replace function public.psi_release_agt002_preview_claim(
  p_idempotency_key text,
  p_claim_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(p_idempotency_key), '') is null or p_claim_id is null then
    raise exception 'La reserva AGT-002 no es válida.' using errcode = '22023';
  end if;
  delete from public.psi_agt002_preview_claims
  where idempotency_key = p_idempotency_key and claim_id = p_claim_id;
  -- Idempotent release: an already-expired/deleted lease is also released.
  return true;
end;
$$;

revoke all on function public.psi_claim_agt002_preview_run(text, integer, integer, integer) from public;
revoke all on function public.psi_claim_agt002_preview_run(text, integer, integer, integer) from anon;
revoke all on function public.psi_claim_agt002_preview_run(text, integer, integer, integer) from authenticated;
revoke all on function public.psi_claim_agt002_preview_run(text, integer, integer, integer) from service_role;
grant execute on function public.psi_claim_agt002_preview_run(text, integer, integer, integer) to service_role;

revoke all on function public.psi_release_agt002_preview_claim(text, uuid) from public;
revoke all on function public.psi_release_agt002_preview_claim(text, uuid) from anon;
revoke all on function public.psi_release_agt002_preview_claim(text, uuid) from authenticated;
revoke all on function public.psi_release_agt002_preview_claim(text, uuid) from service_role;
grant execute on function public.psi_release_agt002_preview_claim(text, uuid) to service_role;

commit;
