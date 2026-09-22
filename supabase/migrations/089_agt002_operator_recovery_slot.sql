begin;

-- AGT-002 operator-governed recovery (migration 089), redesigned as a database-enforced,
-- append-only audit trail plus a governed one-way binding on the job row itself.
--
-- resume_count/the automatic cap stay exactly at 5: this migration never assigns or
-- increments resume_count, and the check constraints 081 already declared
-- (0 <= resume_count <= 5) are completely untouched. Automatic reclaim
-- (public.psi_claim_agt002_reanalysis_job, 081) and every other 068/081 function/RPC/grant
-- are left byte-for-byte untouched.
--
-- Adds:
--   * public.psi_agt002_operator_recoveries -- one immutable, append-only row per recovered
--     job (job_id unique), service_role-readable only.
--   * psi_agt002_reanalysis_jobs.operator_recovery_id -- nullable, unique FK to the audit
--     table, plus a jobs guard trigger that only ever lets it move null -> a real, same-job
--     audit row exactly once, and that requires that exact atomic binding for any
--     unavailable -> queued transition while resume_count was already at the automatic cap.
--   * public.psi_authorize_agt002_operator_recovery(uuid, uuid, integer, text) -- the
--     owner-only SECURITY DEFINER function that re-verifies every precondition and performs
--     the one audited requeue. Reachable by NO role: not even service_role.

create table public.psi_agt002_operator_recoveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.psi_agt002_reanalysis_jobs(id) on delete restrict,
  workset_id uuid not null references public.psi_agt002_analysis_worksets(id) on delete restrict,
  completed_batch_count integer not null check (completed_batch_count > 0),
  defect_commit_sha text not null check (defect_commit_sha ~ '^[0-9a-f]{40}$'),
  reason_code text not null
    constraint psi_agt002_operator_recoveries_reason_code_check check (reason_code = 'corrected_deterministic_bridge_defect'),
  authorized_by text not null,
  authorized_at timestamptz not null default now()
);

-- Append-only against ordinary UPDATE/DELETE: this trigger blocks every such statement,
-- regardless of role. It cannot and does not claim to bind the database owner or a schema
-- alteration (DROP/DISABLE TRIGGER, ALTER TABLE, etc.) -- that remains the explicit, trusted
-- administrative boundary outside the reach of any in-database guard.
create function public.psi_agt002_operator_recoveries_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_operator_recoveries is append-only: UPDATE and DELETE are prohibited' using errcode = '55000';
end;
$$;

create trigger psi_agt002_operator_recoveries_immutable
  before update or delete on public.psi_agt002_operator_recoveries
  for each row execute function public.psi_agt002_operator_recoveries_prevent_mutation();

alter table public.psi_agt002_operator_recoveries enable row level security;
revoke all on table public.psi_agt002_operator_recoveries from public, anon, authenticated, service_role;
grant select on table public.psi_agt002_operator_recoveries to service_role;
create policy psi_agt002_operator_recoveries_service_role_select
  on public.psi_agt002_operator_recoveries
  for select to service_role using (true);

-- Nullable, unique, one-way binding: a job that was never operator-recovered keeps this null.
alter table public.psi_agt002_reanalysis_jobs
  add column operator_recovery_id uuid unique references public.psi_agt002_operator_recoveries(id) on delete restrict;

-- Guard: operator_recovery_id can only move null -> a real, same-job audit row, exactly once,
-- and only in the same statement as an unavailable -> queued transition already at the
-- automatic cap. No bare UPDATE can ever requeue an at-cap job without a fresh audit binding,
-- and no already-bound job can ever be rebound (a second recovery is impossible).
create function public.psi_agt002_reanalysis_jobs_guard_operator_recovery()
returns trigger language plpgsql as $$
declare
  v_audit public.psi_agt002_operator_recoveries%rowtype;
begin
  if old.operator_recovery_id is not null and new.operator_recovery_id is distinct from old.operator_recovery_id then
    raise exception 'operator_recovery_id es inmutable una vez fijado' using errcode = '55000';
  end if;

  if new.operator_recovery_id is distinct from old.operator_recovery_id then
    if old.operator_recovery_id is not null or new.operator_recovery_id is null then
      raise exception 'operator_recovery_id sólo puede pasar de null a un valor real, una única vez' using errcode = '55000';
    end if;
    select * into v_audit from public.psi_agt002_operator_recoveries where id = new.operator_recovery_id;
    if not found or v_audit.job_id is distinct from new.id then
      raise exception 'operator_recovery_id no pertenece a este job' using errcode = '55000';
    end if;
    if not (old.status = 'unavailable' and old.resume_count >= 5 and new.status = 'queued') then
      raise exception 'la vinculación de operator_recovery_id sólo aplica a una transición unavailable -> queued en el tope automático' using errcode = '55000';
    end if;
  end if;

  if new.status = 'queued' and old.status = 'unavailable' and old.resume_count >= 5 then
    if old.operator_recovery_id is not null or new.operator_recovery_id is null then
      raise exception 'un requeue en el tope automático exige un operator_recovery_id recién vinculado en la misma sentencia' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

create trigger psi_agt002_reanalysis_jobs_guard_operator_recovery
  before update on public.psi_agt002_reanalysis_jobs
  for each row execute function public.psi_agt002_reanalysis_jobs_guard_operator_recovery();

-- The owner-only SECURITY DEFINER function: a direct database-owner/admin action, never an
-- application RPC surface. Re-verifies every precondition itself, then inserts the one audit
-- row and requeues the job in the same transaction.
create function public.psi_authorize_agt002_operator_recovery(
  p_job_id uuid,
  p_workset_id uuid,
  p_expected_completed_batch_count integer,
  p_defect_commit_sha text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_workset public.psi_agt002_analysis_worksets%rowtype;
  v_authorized_by text;
  v_recovery_id uuid;
  v_checkpoint_count integer;
  v_max_batch_index integer;
  total_batch_count integer;
  completed_batch_count integer;
begin
  if p_defect_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'defect_commit_sha inválido: se requieren 40 caracteres hexadecimales en minúscula' using errcode = '22023';
  end if;
  if p_expected_completed_batch_count is null or p_expected_completed_batch_count <= 0 then
    raise exception 'expected_completed_batch_count debe ser un entero positivo' using errcode = '22023';
  end if;

  select * into v_job from public.psi_agt002_reanalysis_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job % no encontrado', p_job_id using errcode = 'P0002';
  end if;

  if v_job.status is distinct from 'unavailable' then
    raise exception 'job % no está en estado unavailable', p_job_id using errcode = '55000';
  end if;
  if v_job.error_code is distinct from 'timeout' then
    raise exception 'job % no falló por timeout normalizado', p_job_id using errcode = '55000';
  end if;
  if v_job.execution_mode is distinct from 'durable_batched_v1' then
    raise exception 'job % no es durable_batched_v1', p_job_id using errcode = '55000';
  end if;
  if v_job.phase is distinct from 'semantic_discovery' then
    raise exception 'job % no está en la fase semantic_discovery', p_job_id using errcode = '55000';
  end if;
  if v_job.resume_count is distinct from 5 then
    raise exception 'job % no está en el tope automático de reintentos (debe ser 5)', p_job_id using errcode = '55000';
  end if;
  if v_job.analysis_run_id is not null then
    raise exception 'job % ya tiene una ejecución canónica asociada', p_job_id using errcode = '55000';
  end if;
  if v_job.lease_id is not null then
    raise exception 'job % todavía retiene una reserva activa', p_job_id using errcode = '55000';
  end if;
  if v_job.operator_recovery_id is not null then
    raise exception 'job % ya fue recuperado (operator_recovery_id ya está fijado)', p_job_id using errcode = '55000';
  end if;
  if v_job.completed_batch_count is distinct from p_expected_completed_batch_count then
    raise exception 'completed_batch_count no coincide con p_expected_completed_batch_count' using errcode = '55000';
  end if;

  total_batch_count := v_job.total_batch_count;
  completed_batch_count := v_job.completed_batch_count;
  if total_batch_count <= completed_batch_count then
    raise exception 'job % ya no tiene lotes pendientes', p_job_id using errcode = '55000';
  end if;

  select * into v_workset from public.psi_agt002_analysis_worksets where id = p_workset_id for update;
  if not found then
    raise exception 'workset % no existe', p_workset_id using errcode = 'P0002';
  end if;
  if v_workset.idempotency_key is distinct from v_job.idempotency_key then
    raise exception 'el workset no corresponde a la identidad (idempotency_key) del job' using errcode = '22023';
  end if;
  if v_workset.opportunity_id is distinct from v_job.opportunity_id
     or v_workset.tender_id is distinct from v_job.tender_id
     or v_workset.snapshot_id is distinct from v_job.snapshot_id
     or v_workset.context_version_id is distinct from v_job.context_version_id then
    raise exception 'el workset no corresponde a la identidad (opportunity/tender/snapshot/context_version) del job' using errcode = '22023';
  end if;
  if v_workset.published is true then
    raise exception 'el workset ya está publicado' using errcode = '55000';
  end if;
  if v_workset.published_analysis_run_id is not null then
    raise exception 'el workset ya tiene una ejecución publicada asociada' using errcode = '55000';
  end if;
  if v_workset.archived_at is not null then
    raise exception 'el workset está archivado' using errcode = '55000';
  end if;

  select count(distinct batch_index), max(batch_index) into v_checkpoint_count, v_max_batch_index
  from public.psi_agt002_analysis_checkpoints
  where workset_id = p_workset_id and stage = 'semantic_discovery_batch';
  if v_checkpoint_count is distinct from p_expected_completed_batch_count
     or v_max_batch_index is distinct from p_expected_completed_batch_count - 1 then
    raise exception 'los checkpoints de semantic_discovery_batch no son exactamente contiguos 0..N-1' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.psi_agt002_analysis_checkpoints
    where workset_id = p_workset_id and stage <> 'semantic_discovery_batch'
  ) then
    raise exception 'el workset tiene checkpoints fuera de la etapa semantic_discovery_batch' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-canonical:' || v_job.opportunity_id::text, 0));

  if exists (select 1 from public.psi_tender_analysis_runs where idempotency_key = v_job.idempotency_key) then
    raise exception 'ya existe una ejecución de análisis con esta idempotency_key' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.psi_agt002_reanalysis_jobs
    where opportunity_id = v_job.opportunity_id and id <> v_job.id and status in ('queued', 'running')
  ) then
    raise exception 'existe otro trabajo activo (queued/running) para la oportunidad' using errcode = '55000';
  end if;

  v_authorized_by := session_user;

  insert into public.psi_agt002_operator_recoveries
    (job_id, workset_id, completed_batch_count, defect_commit_sha, reason_code, authorized_by)
  values
    (v_job.id, p_workset_id, p_expected_completed_batch_count, p_defect_commit_sha,
     'corrected_deterministic_bridge_defect', v_authorized_by)
  returning id into v_recovery_id;

  update public.psi_agt002_reanalysis_jobs set
    status = 'queued',
    error_code = null,
    error_message = null,
    completed_at = null,
    lease_id = null,
    lease_expires_at = null,
    operator_recovery_id = v_recovery_id,
    updated_at = now()
  where id = v_job.id;

  return jsonb_build_object(
    'job_id', v_job.id, 'workset_id', p_workset_id, 'operator_recovery_id', v_recovery_id,
    'status', 'queued', 'resume_count', v_job.resume_count,
    'completed_batch_count', completed_batch_count, 'total_batch_count', total_batch_count
  );
end;
$$;

revoke all on function public.psi_authorize_agt002_operator_recovery(uuid, uuid, integer, text) from public;
revoke all on function public.psi_authorize_agt002_operator_recovery(uuid, uuid, integer, text) from anon;
revoke all on function public.psi_authorize_agt002_operator_recovery(uuid, uuid, integer, text) from authenticated;
revoke all on function public.psi_authorize_agt002_operator_recovery(uuid, uuid, integer, text) from service_role;

commit;
