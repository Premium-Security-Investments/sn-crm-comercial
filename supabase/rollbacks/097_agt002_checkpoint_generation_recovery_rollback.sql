begin;

-- Fail closed once any generation was authorized: its audit row and recovery job are durable
-- evidence and this rollback never deletes or rewrites either.
lock table public.psi_agt002_reanalysis_jobs in access exclusive mode;
lock table public.psi_agt002_checkpoint_generation_recoveries in access exclusive mode;

do $$
begin
  if exists (select 1 from public.psi_agt002_checkpoint_generation_recoveries) then
    raise exception 'bloqueado: no se puede revertir 097 mientras existan recuperaciones de generación';
  end if;
end
$$;

drop function if exists public.psi_claim_agt002_reanalysis_job_by_id(uuid, integer);
drop function if exists public.psi_authorize_agt002_checkpoint_generation_recovery(uuid, uuid, uuid, integer, integer, text, text, text);

-- Restore migration 081's ordinary durable FIFO claim byte-for-byte in behavior.
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

  update public.psi_agt002_reanalysis_jobs
  set status = 'unavailable',
      error_code = 'lease_lost',
      error_message = 'El trabajo perdió su reserva antes de completarse.',
      lease_id = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where status = 'running' and lease_expires_at <= now()
    and (execution_mode is distinct from 'durable_batched_v1' or resume_count >= 5);

  update public.psi_agt002_reanalysis_jobs
  set status = 'queued',
      resume_count = resume_count + 1,
      lease_id = null,
      lease_expires_at = null,
      updated_at = now()
  where status = 'running' and lease_expires_at <= now()
    and execution_mode = 'durable_batched_v1' and resume_count < 5;

  select * into v_job
  from public.psi_agt002_reanalysis_jobs
  where status = 'queued' and lease_id is null
  order by created_at, id
  for update skip locked
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

drop trigger if exists psi_agt002_checkpoint_generation_recoveries_immutable on public.psi_agt002_checkpoint_generation_recoveries;
drop function if exists public.psi_agt002_checkpoint_generation_recoveries_prevent_mutation();
drop table public.psi_agt002_checkpoint_generation_recoveries;

commit;
