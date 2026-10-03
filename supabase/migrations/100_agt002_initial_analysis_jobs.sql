-- Durable, worker-drained queue for AGT-002 initial analysis (docs/agt002/initial-analysis/
-- CURRENT.md): the FIRST analysis run for an opportunity, never a subsequent run of any kind.
-- service_role-only end to end.
begin;

create table if not exists public.psi_agt002_initial_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null,
  tender_id uuid not null,
  idempotency_key text not null,
  payload jsonb not null default '{}',
  requested_by text not null,
  status text not null check (status in ('QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION', 'COMPLETED', 'FAILED')),
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  lease_id uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  fence_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(idempotency_key)
);

create unique index if not exists psi_agt002_initial_analysis_jobs_one_active
  on public.psi_agt002_initial_analysis_jobs (opportunity_id)
  where status in ('QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION');

alter table public.psi_agt002_initial_analysis_jobs enable row level security;
revoke all on public.psi_agt002_initial_analysis_jobs from public, authenticated, anon;
grant select on public.psi_agt002_initial_analysis_jobs to service_role;

-- Idempotent admission: an exact idempotency-key replay reuses the same row; a same-key
-- payload/identity mismatch fails closed without mutation; a COMPLETED initial job or any other
-- active job for the opportunity blocks a second admission.
create or replace function public.psi_admit_agt002_initial_analysis_job(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_idempotency_key text,
  p_payload jsonb,
  p_requested_by text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.psi_agt002_initial_analysis_jobs%rowtype;
  v_completed public.psi_agt002_initial_analysis_jobs%rowtype;
  v_active public.psi_agt002_initial_analysis_jobs%rowtype;
  v_job_id uuid;
  v_payload jsonb;
begin
  v_payload := coalesce(p_payload, '{}'::jsonb);

  perform pg_advisory_xact_lock(hashtext('psi_agt002_initial_analysis_jobs:' || p_opportunity_id::text));

  select * into v_existing
  from public.psi_agt002_initial_analysis_jobs
  where idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.opportunity_id is distinct from p_opportunity_id
       or v_existing.tender_id is distinct from p_tender_id
       or v_existing.payload is distinct from v_payload
       or v_existing.requested_by is distinct from p_requested_by then
      return jsonb_build_object('status', 'payload_mismatch', 'job_id', v_existing.id);
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

  select * into v_completed
  from public.psi_agt002_initial_analysis_jobs
  where opportunity_id = p_opportunity_id and status = 'COMPLETED'
  limit 1;
  if found then
    raise exception 'Ya existe un análisis inicial COMPLETED para la oportunidad' using errcode = '55001';
  end if;

  select * into v_active
  from public.psi_agt002_initial_analysis_jobs
  where opportunity_id = p_opportunity_id
    and status in ('QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION')
  limit 1;
  if found then
    raise exception 'Ya existe un job AGT-002 initial-analysis activo (%) para la oportunidad', v_active.status using errcode = '55000';
  end if;

  insert into public.psi_agt002_initial_analysis_jobs
    (opportunity_id, tender_id, idempotency_key, payload, requested_by, status)
  values
    (p_opportunity_id, p_tender_id, p_idempotency_key, v_payload, p_requested_by, 'QUEUED')
  returning id into v_job_id;

  return jsonb_build_object(
    'status', 'admitted',
    'job_id', v_job_id,
    'opportunity_id', p_opportunity_id,
    'tender_id', p_tender_id,
    'idempotency_key', p_idempotency_key,
    'payload', v_payload,
    'requested_by', p_requested_by,
    'job_status', 'QUEUED'
  );
end;
$$;

-- Claims at most one due job (queued, or a claimed/running job whose lease already expired) per
-- call, under a fixed worker identity only. A reclaim strictly increments the fencing token so a
-- straggling prior owner's writes are rejected by the renewal RPC below.
create or replace function public.psi_claim_agt002_initial_analysis_job(
  p_worker_id text,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_initial_analysis_jobs%rowtype;
  v_seconds integer;
  v_lease_id uuid;
  v_lease_expires_at timestamptz;
  v_next_fence integer;
begin
  if p_worker_id is distinct from 'agt002-initial-analysis-worker' then
    raise exception 'Identidad de worker AGT-002 initial-analysis inválida.' using errcode = '28000';
  end if;

  v_seconds := least(greatest(coalesce(p_lease_seconds, 60), 1), 600);

  select *
  into v_job
  from public.psi_agt002_initial_analysis_jobs
  where status = 'QUEUED'
     or (status in ('CLAIMED', 'RUNNING') and lease_expires_at < now())
  order by created_at, id
  for update skip locked
  limit 1;

  if v_job.id is null then
    return jsonb_build_object('status', 'empty');
  end if;

  v_lease_id := gen_random_uuid();
  v_lease_expires_at := now() + make_interval(secs => v_seconds);
  v_next_fence := case when v_job.status = 'QUEUED' then v_job.fence_version else v_job.fence_version + 1 end;

  update public.psi_agt002_initial_analysis_jobs
  set status = 'CLAIMED',
      lease_id = v_lease_id,
      lease_owner = p_worker_id,
      lease_expires_at = v_lease_expires_at,
      fence_version = v_next_fence,
      updated_at = now()
  where id = v_job.id;

  return jsonb_build_object(
    'status', 'claimed',
    'job_id', v_job.id,
    'lease_id', v_lease_id,
    'fence_version', v_next_fence,
    'lease_expires_at', v_lease_expires_at,
    'opportunity_id', v_job.opportunity_id,
    'tender_id', v_job.tender_id,
    'idempotency_key', v_job.idempotency_key,
    'payload', v_job.payload,
    'requested_by', v_job.requested_by
  );
end;
$$;

-- Fenced lease renewal: a missing job, a lease_id mismatch, or an already-expired lease is
-- reported as 'lost'; a stale fence_version (superseded by a newer claim) is reported as
-- 'fenced'; only an exact match extends the lease.
create or replace function public.psi_renew_agt002_initial_analysis_job_lease(
  p_job_id uuid,
  p_lease_id uuid,
  p_fence_version integer,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_initial_analysis_jobs%rowtype;
  v_seconds integer;
  v_lease_expires_at timestamptz;
begin
  select * into v_job from public.psi_agt002_initial_analysis_jobs where id = p_job_id for update;

  if v_job.id is null
     or v_job.lease_id is distinct from p_lease_id
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at < now() then
    return jsonb_build_object('status', 'lost');
  end if;

  if v_job.fence_version is distinct from p_fence_version then
    return jsonb_build_object('status', 'fenced');
  end if;

  v_seconds := least(greatest(coalesce(p_lease_seconds, 60), 1), 600);
  v_lease_expires_at := now() + make_interval(secs => v_seconds);

  update public.psi_agt002_initial_analysis_jobs
  set lease_expires_at = v_lease_expires_at,
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('status', 'renewed', 'lease_expires_at', v_lease_expires_at);
end;
$$;

revoke all on function public.psi_admit_agt002_initial_analysis_job(uuid, uuid, text, jsonb, text) from public, authenticated, anon;
grant execute on function public.psi_admit_agt002_initial_analysis_job(uuid, uuid, text, jsonb, text) to service_role;
revoke all on function public.psi_claim_agt002_initial_analysis_job(text, integer) from public, authenticated, anon;
grant execute on function public.psi_claim_agt002_initial_analysis_job(text, integer) to service_role;
revoke all on function public.psi_renew_agt002_initial_analysis_job_lease(uuid, uuid, integer, integer) from public, authenticated, anon;
grant execute on function public.psi_renew_agt002_initial_analysis_job_lease(uuid, uuid, integer, integer) to service_role;

commit;
