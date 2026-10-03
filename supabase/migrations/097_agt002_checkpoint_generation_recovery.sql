begin;

-- A failed durable job whose immutable checkpoints no longer satisfy the current engine
-- contract cannot safely be requeued: the first recomputed batch would try to move progress
-- backwards and the append-only checkpoint identity cannot be overwritten. This migration
-- adds one deliberately narrow escape hatch. An owner-only authorization creates a NEW job
-- identity and therefore a NEW workset generation, while preserving the failed job, workset,
-- checkpoints and every audit fact byte-for-byte.
--
-- Recovery jobs never join the ordinary FIFO queue. The ordinary claim RPC excludes them,
-- and a second service-role RPC can claim only one exact, already-authorized recovery job id.

create table public.psi_agt002_checkpoint_generation_recoveries (
  id uuid primary key default gen_random_uuid(),
  source_job_id uuid not null unique references public.psi_agt002_reanalysis_jobs(id) on delete restrict,
  source_workset_id uuid not null references public.psi_agt002_analysis_worksets(id) on delete restrict,
  recovery_job_id uuid not null unique references public.psi_agt002_reanalysis_jobs(id) on delete restrict,
  root_idempotency_key text not null check (root_idempotency_key ~ '^[0-9a-f]{64}$'),
  recovery_idempotency_key text not null unique check (recovery_idempotency_key ~ '^[0-9a-f]{64}$'),
  checkpoint_generation integer not null check (checkpoint_generation = 1),
  rejected_checkpoint_id uuid not null references public.psi_agt002_analysis_checkpoints(id) on delete restrict,
  rejected_batch_index integer not null check (rejected_batch_index >= 0),
  rejected_request_hash text not null check (rejected_request_hash ~ '^[0-9a-f]{64}$'),
  rejected_output_sha256 text not null check (rejected_output_sha256 ~ '^[0-9a-f]{64}$'),
  source_completed_batch_count integer not null check (source_completed_batch_count > 0),
  source_total_batch_count integer not null check (source_total_batch_count >= source_completed_batch_count),
  repair_commit_sha text not null check (repair_commit_sha ~ '^[0-9a-f]{40}$'),
  reason_code text not null check (reason_code = 'checkpoint_contract_drift'),
  authorized_by text not null check (btrim(authorized_by) <> ''),
  authorized_at timestamptz not null default now()
);

create function public.psi_agt002_checkpoint_generation_recoveries_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_checkpoint_generation_recoveries is append-only: UPDATE and DELETE are prohibited' using errcode = '55000';
end;
$$;

create trigger psi_agt002_checkpoint_generation_recoveries_immutable
  before update or delete on public.psi_agt002_checkpoint_generation_recoveries
  for each row execute function public.psi_agt002_checkpoint_generation_recoveries_prevent_mutation();

alter table public.psi_agt002_checkpoint_generation_recoveries enable row level security;
alter table public.psi_agt002_checkpoint_generation_recoveries force row level security;
revoke all on table public.psi_agt002_checkpoint_generation_recoveries from public, anon, authenticated, service_role;
grant select on table public.psi_agt002_checkpoint_generation_recoveries to service_role;

-- FORCE ROW LEVEL SECURITY deliberately has no policies. Reading this audit table through
-- the service role therefore requires the production service_role to carry BYPASSRLS (as it
-- does in the supported Supabase deployment). The authorization function below likewise
-- requires a deploy-owner with BYPASSRLS; otherwise it fails closed at the audit INSERT.

-- Owner/admin only. No application role, including service_role, can create a generation.
create function public.psi_authorize_agt002_checkpoint_generation_recovery(
  p_source_job_id uuid,
  p_source_workset_id uuid,
  p_rejected_checkpoint_id uuid,
  p_expected_completed_batch_count integer,
  p_expected_total_batch_count integer,
  p_expected_request_hash text,
  p_expected_output_sha256 text,
  p_repair_commit_sha text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_source_workset public.psi_agt002_analysis_worksets%rowtype;
  v_rejected public.psi_agt002_analysis_checkpoints%rowtype;
  v_recovery_id uuid := gen_random_uuid();
  v_recovery_job_id uuid := gen_random_uuid();
  v_recovery_key text;
  v_recovery_input jsonb;
  v_discovery_count integer;
  v_discovery_max integer;
  v_manifest_count integer;
  v_plan_count integer;
  v_plan_max integer;
  v_integral_count integer;
  v_integral_max integer;
begin
  if p_expected_completed_batch_count is null or p_expected_completed_batch_count <= 0
     or p_expected_total_batch_count is null
     or p_expected_total_batch_count < p_expected_completed_batch_count then
    raise exception 'los conteos esperados de progreso no son válidos' using errcode = '22023';
  end if;
  if p_expected_request_hash !~ '^[0-9a-f]{64}$'
     or p_expected_output_sha256 !~ '^[0-9a-f]{64}$'
     or p_repair_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'los hashes de evidencia o repair_commit_sha no tienen el formato requerido' using errcode = '22023';
  end if;

  select * into v_source_job
  from public.psi_agt002_reanalysis_jobs
  where id = p_source_job_id
  for update;
  if not found then raise exception 'source job % no existe', p_source_job_id using errcode = 'P0002'; end if;

  if v_source_job.status is distinct from 'unavailable'
     or v_source_job.error_code is distinct from 'persistence_failure'
     or v_source_job.error_message is distinct from 'No fue posible confirmar el estado final del trabajo; la corrida canónica puede haberse registrado.'
     or v_source_job.execution_mode is distinct from 'durable_batched_v1'
     or v_source_job.phase is distinct from 'integral_analysis'
     or v_source_job.completed_batch_count is distinct from p_expected_completed_batch_count
     or v_source_job.total_batch_count is distinct from p_expected_total_batch_count
     or v_source_job.lease_id is not null
     or v_source_job.lease_expires_at is not null
     or v_source_job.analysis_run_id is not null then
    raise exception 'el source job no coincide con el fallo durable de persistencia esperado' using errcode = '55000';
  end if;
  if v_source_job.idempotency_key !~ '^[0-9a-f]{64}$'
     or v_source_job.frozen_engine_input #>> '{engine_identity,idempotency_key}' is distinct from v_source_job.idempotency_key
     or jsonb_typeof(v_source_job.frozen_engine_input -> 'schema_version') is distinct from 'number'
     or (v_source_job.frozen_engine_input ->> 'schema_version')::numeric is distinct from 2
     or jsonb_typeof(v_source_job.frozen_engine_input -> 'document_workset_identity') is distinct from 'object'
     or jsonb_typeof(v_source_job.frozen_engine_input -> 'governed_workset_members') is distinct from 'array'
     or v_source_job.frozen_engine_input ? 'checkpoint_generation_recovery' then
    raise exception 'el source job no tiene una identidad gobernada de generación raíz válida' using errcode = '55000';
  end if;
  if v_source_job.frozen_engine_input #>> '{document_workset_identity,opportunity_id}' is distinct from v_source_job.opportunity_id::text
     or v_source_job.frozen_engine_input #>> '{document_workset_identity,tender_id}' is distinct from v_source_job.tender_id::text
     or v_source_job.frozen_engine_input #>> '{document_workset_identity,snapshot_id}' is distinct from v_source_job.snapshot_id::text
     or v_source_job.frozen_engine_input #>> '{document_workset_identity,context_version_id}' is distinct from v_source_job.context_version_id::text then
    raise exception 'la identidad documental gobernada no coincide con el source job' using errcode = '55000';
  end if;

  select * into v_source_workset
  from public.psi_agt002_analysis_worksets
  where id = p_source_workset_id
  for update;
  if not found then raise exception 'source workset % no existe', p_source_workset_id using errcode = 'P0002'; end if;
  if v_source_workset.idempotency_key is distinct from v_source_job.idempotency_key
     or v_source_workset.opportunity_id is distinct from v_source_job.opportunity_id
     or v_source_workset.tender_id is distinct from v_source_job.tender_id
     or v_source_workset.snapshot_id is distinct from v_source_job.snapshot_id
     or v_source_workset.context_version_id is distinct from v_source_job.context_version_id
     or v_source_workset.published is true
     or v_source_workset.published_analysis_run_id is not null
     or v_source_workset.archived_at is not null then
    raise exception 'el source workset no es la generación fallida, inédita y activa esperada' using errcode = '55000';
  end if;

  select * into v_rejected
  from public.psi_agt002_analysis_checkpoints
  where id = p_rejected_checkpoint_id
  for share;
  if not found
     or v_rejected.workset_id is distinct from p_source_workset_id
     or v_rejected.stage is distinct from 'integral_analysis_batch'
     or v_rejected.request_hash is distinct from p_expected_request_hash
     or v_rejected.output_sha256 is distinct from p_expected_output_sha256 then
    raise exception 'el checkpoint rechazado no coincide con la evidencia atestada' using errcode = '55000';
  end if;

  select count(*)::integer, max(batch_index) into v_discovery_count, v_discovery_max
  from public.psi_agt002_analysis_checkpoints
  where workset_id = p_source_workset_id and stage = 'semantic_discovery_batch';
  select count(*)::integer into v_manifest_count
  from public.psi_agt002_analysis_checkpoints
  where workset_id = p_source_workset_id and stage = 'semantic_manifest' and batch_index = 0;
  select count(*)::integer, max(batch_index) into v_plan_count, v_plan_max
  from public.psi_agt002_analysis_checkpoints
  where workset_id = p_source_workset_id and stage = 'integral_analysis_plan';
  select count(*)::integer, max(batch_index) into v_integral_count, v_integral_max
  from public.psi_agt002_analysis_checkpoints
  where workset_id = p_source_workset_id and stage = 'integral_analysis_batch';

  if v_discovery_count <= 0 or v_discovery_max is distinct from v_discovery_count - 1
     or v_manifest_count is distinct from 1
     or v_plan_count not in (0, 1) or (v_plan_count = 1 and v_plan_max is distinct from 0)
     or v_integral_count is distinct from p_expected_completed_batch_count
     or v_integral_max is distinct from p_expected_completed_batch_count - 1 then
    raise exception 'el historial de checkpoints fuente no es completo y contiguo' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.psi_agt002_analysis_checkpoints
    where workset_id = p_source_workset_id and stage = 'semantic_manifest' and batch_index <> 0
  ) then
    raise exception 'el historial contiene un semantic_manifest inesperado' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtext('psi_agt002_reanalysis_jobs:' || v_source_job.opportunity_id::text));
  perform pg_advisory_xact_lock(hashtextextended('agt002-canonical:' || v_source_job.opportunity_id::text, 0));

  if exists (select 1 from public.psi_agt002_checkpoint_generation_recoveries where source_job_id = v_source_job.id) then
    raise exception 'este source job ya tiene una recuperación de generación autorizada' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.psi_tender_analysis_runs
    where idempotency_key = v_source_job.idempotency_key
  ) then
    raise exception 'el source job ya tiene una corrida canónica persistida' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.psi_agt002_reanalysis_jobs
    where opportunity_id = v_source_job.opportunity_id and status in ('queued', 'running')
  ) then
    raise exception 'existe otro trabajo activo para la oportunidad' using errcode = '55000';
  end if;

  v_recovery_key := encode(sha256(convert_to(
    'agt002-checkpoint-generation-recovery-v1' || E'\n'
    || v_source_job.idempotency_key || E'\n'
    || v_source_job.id::text || E'\n1' || E'\n'
    || p_repair_commit_sha,
    'UTF8'
  )), 'hex');

  if exists (select 1 from public.psi_tender_analysis_runs where idempotency_key = v_recovery_key)
     or exists (select 1 from public.psi_agt002_reanalysis_jobs where idempotency_key = v_recovery_key)
     or exists (select 1 from public.psi_agt002_analysis_worksets where idempotency_key = v_recovery_key) then
    raise exception 'la identidad determinística de recuperación ya existe fuera de esta autorización' using errcode = '23505';
  end if;

  v_recovery_input := jsonb_set(
    jsonb_set(
      v_source_job.frozen_engine_input,
      '{engine_identity,idempotency_key}',
      to_jsonb(v_recovery_key),
      false
    ),
    '{checkpoint_generation_recovery}',
    jsonb_build_object(
      'contract_version', 'agt002-checkpoint-generation-recovery-v1',
      'reason_code', 'checkpoint_contract_drift',
      'root_idempotency_key', v_source_job.idempotency_key,
      'source_job_id', v_source_job.id,
      'source_workset_id', v_source_workset.id,
      'checkpoint_generation', 1,
      'repair_commit_sha', p_repair_commit_sha
    ),
    true
  );

  insert into public.psi_agt002_reanalysis_jobs (
    id, opportunity_id, tender_id, snapshot_id, context_version_id, idempotency_key,
    frozen_engine_input, status, requested_by, execution_mode
  ) values (
    v_recovery_job_id, v_source_job.opportunity_id, v_source_job.tender_id,
    v_source_job.snapshot_id, v_source_job.context_version_id, v_recovery_key,
    v_recovery_input, 'queued', v_source_job.requested_by, 'durable_batched_v1'
  );

  insert into public.psi_agt002_checkpoint_generation_recoveries (
    id, source_job_id, source_workset_id, recovery_job_id, root_idempotency_key,
    recovery_idempotency_key, checkpoint_generation, rejected_checkpoint_id,
    rejected_batch_index, rejected_request_hash, rejected_output_sha256,
    source_completed_batch_count, source_total_batch_count, repair_commit_sha,
    reason_code, authorized_by
  ) values (
    v_recovery_id, v_source_job.id, v_source_workset.id, v_recovery_job_id,
    v_source_job.idempotency_key, v_recovery_key, 1, v_rejected.id,
    v_rejected.batch_index, v_rejected.request_hash, v_rejected.output_sha256,
    v_source_job.completed_batch_count, v_source_job.total_batch_count,
    p_repair_commit_sha, 'checkpoint_contract_drift', session_user
  );

  return jsonb_build_object(
    'status', 'created',
    'checkpoint_generation_recovery_id', v_recovery_id,
    'source_job_id', v_source_job.id,
    'source_workset_id', v_source_workset.id,
    'recovery_job_id', v_recovery_job_id,
    'recovery_idempotency_key', v_recovery_key,
    'checkpoint_generation', 1
  );
end;
$$;

revoke all on function public.psi_authorize_agt002_checkpoint_generation_recovery(uuid, uuid, uuid, integer, integer, text, text, text) from public;
revoke all on function public.psi_authorize_agt002_checkpoint_generation_recovery(uuid, uuid, uuid, integer, integer, text, text, text) from anon;
revoke all on function public.psi_authorize_agt002_checkpoint_generation_recovery(uuid, uuid, uuid, integer, integer, text, text, text) from authenticated;
revoke all on function public.psi_authorize_agt002_checkpoint_generation_recovery(uuid, uuid, uuid, integer, integer, text, text, text) from service_role;

-- Preserve 081's claim behavior for ordinary jobs, but neither sweep nor claim a recovery
-- generation. Only the exact-id RPC below may touch one.
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

create function public.psi_claim_agt002_reanalysis_job_by_id(
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

commit;
