begin;

-- Once used, the generation-2 audit and job are durable evidence. Never delete or rewrite them.
lock table public.psi_agt002_reanalysis_jobs in access exclusive mode;
lock table public.psi_agt002_checkpoint_generation_2_recoveries in access exclusive mode;

do $$
begin
  if exists (select 1 from public.psi_agt002_checkpoint_generation_2_recoveries) then
    raise exception 'bloqueado: no se puede revertir 098 mientras existan recuperaciones generación 2';
  end if;
end
$$;

drop function if exists public.psi_authorize_agt002_checkpoint_generation_2_recovery(uuid, uuid, uuid, uuid, integer, integer, integer, text, text, text, integer, text);

-- Restore migration 097's exclusion and exact-id claim behavior byte-for-byte in semantics.
create or replace function public.psi_claim_agt002_reanalysis_job(
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_lease_id uuid;
  v_seconds integer;
  v_lease_expires_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('psi_agt002_reanalysis_jobs:claim'));
  v_seconds := least(greatest(coalesce(p_lease_seconds, 60), 1), 600);

  update public.psi_agt002_reanalysis_jobs j
  set status = 'unavailable', error_code = 'lease_lost',
      error_message = 'El trabajo perdió su reserva antes de completarse.',
      lease_id = null, lease_expires_at = null, completed_at = now(), updated_at = now()
  where j.status = 'running' and j.lease_expires_at <= now()
    and not exists (select 1 from public.psi_agt002_checkpoint_generation_recoveries r where r.recovery_job_id = j.id)
    and (j.execution_mode is distinct from 'durable_batched_v1' or j.resume_count >= 5);

  update public.psi_agt002_reanalysis_jobs j
  set status = 'queued', resume_count = resume_count + 1,
      lease_id = null, lease_expires_at = null, updated_at = now()
  where j.status = 'running' and j.lease_expires_at <= now()
    and not exists (select 1 from public.psi_agt002_checkpoint_generation_recoveries r where r.recovery_job_id = j.id)
    and j.execution_mode = 'durable_batched_v1' and j.resume_count < 5;

  select * into v_job
  from public.psi_agt002_reanalysis_jobs j
  where j.status = 'queued' and j.lease_id is null
    and not exists (select 1 from public.psi_agt002_checkpoint_generation_recoveries r where r.recovery_job_id = j.id)
  order by j.created_at, j.id
  for update of j skip locked
  limit 1;

  if v_job.id is null then return jsonb_build_object('status', 'empty'); end if;
  v_lease_id := gen_random_uuid();
  v_lease_expires_at := now() + make_interval(secs => v_seconds);
  update public.psi_agt002_reanalysis_jobs
  set status = 'running', lease_id = v_lease_id, lease_expires_at = v_lease_expires_at,
      started_at = coalesce(started_at, now()), updated_at = now()
  where id = v_job.id;

  return jsonb_build_object(
    'status', 'claimed', 'job_id', v_job.id, 'lease_id', v_lease_id,
    'lease_expires_at', v_lease_expires_at, 'opportunity_id', v_job.opportunity_id,
    'tender_id', v_job.tender_id, 'snapshot_id', v_job.snapshot_id,
    'context_version_id', v_job.context_version_id, 'idempotency_key', v_job.idempotency_key,
    'frozen_engine_input', v_job.frozen_engine_input, 'requested_by', v_job.requested_by,
    'execution_mode', v_job.execution_mode, 'phase', v_job.phase,
    'completed_batch_count', v_job.completed_batch_count,
    'total_batch_count', v_job.total_batch_count, 'resume_count', v_job.resume_count
  );
end;
$$;

revoke all on function public.psi_claim_agt002_reanalysis_job(integer) from public, authenticated, anon;
grant execute on function public.psi_claim_agt002_reanalysis_job(integer) to service_role;

create or replace function public.psi_claim_agt002_reanalysis_job_by_id(
  p_job_id uuid,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_lease_id uuid;
  v_seconds integer;
  v_lease_expires_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('psi_agt002_reanalysis_jobs:claim'));
  v_seconds := least(greatest(coalesce(p_lease_seconds, 60), 1), 600);

  if not exists (
    select 1 from public.psi_agt002_checkpoint_generation_recoveries
    where recovery_job_id = p_job_id
  ) then
    raise exception 'el job objetivo no es una recuperación de generación autorizada' using errcode = '28000';
  end if;

  update public.psi_agt002_reanalysis_jobs
  set status = case when execution_mode = 'durable_batched_v1' and resume_count < 5 then 'queued' else 'unavailable' end,
      resume_count = case when execution_mode = 'durable_batched_v1' and resume_count < 5 then resume_count + 1 else resume_count end,
      error_code = case when execution_mode = 'durable_batched_v1' and resume_count < 5 then null else 'lease_lost' end,
      error_message = case when execution_mode = 'durable_batched_v1' and resume_count < 5 then null else 'El trabajo perdió su reserva antes de completarse.' end,
      completed_at = case when execution_mode = 'durable_batched_v1' and resume_count < 5 then null else now() end,
      lease_id = null, lease_expires_at = null, updated_at = now()
  where id = p_job_id and status = 'running' and lease_expires_at <= now();

  select * into v_job
  from public.psi_agt002_reanalysis_jobs
  where id = p_job_id and status = 'queued' and lease_id is null
  for update;
  if v_job.id is null then return jsonb_build_object('status', 'empty'); end if;

  v_lease_id := gen_random_uuid();
  v_lease_expires_at := now() + make_interval(secs => v_seconds);
  update public.psi_agt002_reanalysis_jobs
  set status = 'running', lease_id = v_lease_id, lease_expires_at = v_lease_expires_at,
      started_at = coalesce(started_at, now()), updated_at = now()
  where id = v_job.id;

  return jsonb_build_object(
    'status', 'claimed', 'job_id', v_job.id, 'lease_id', v_lease_id,
    'lease_expires_at', v_lease_expires_at, 'opportunity_id', v_job.opportunity_id,
    'tender_id', v_job.tender_id, 'snapshot_id', v_job.snapshot_id,
    'context_version_id', v_job.context_version_id, 'idempotency_key', v_job.idempotency_key,
    'frozen_engine_input', v_job.frozen_engine_input, 'requested_by', v_job.requested_by,
    'execution_mode', v_job.execution_mode, 'phase', v_job.phase,
    'completed_batch_count', v_job.completed_batch_count,
    'total_batch_count', v_job.total_batch_count, 'resume_count', v_job.resume_count
  );
end;
$$;

revoke all on function public.psi_claim_agt002_reanalysis_job_by_id(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.psi_claim_agt002_reanalysis_job_by_id(uuid, integer) to service_role;

drop trigger if exists psi_agt002_checkpoint_generation_2_recoveries_immutable on public.psi_agt002_checkpoint_generation_2_recoveries;
drop function if exists public.psi_agt002_checkpoint_generation_2_recoveries_prevent_mutation();
drop table public.psi_agt002_checkpoint_generation_2_recoveries;

commit;
