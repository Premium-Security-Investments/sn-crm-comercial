begin;

-- Rollback for migration 091 (AGT-002 validation-recovery slot).
--
-- Undoes only 091's additions and restores the
-- psi_agt002_reanalysis_jobs_guard_operator_recovery trigger function to its exact 090
-- body/semantics (operator_recovery_id and context_recovery_id only, two-way exactly-one
-- closing check), so that the database looks exactly as it did right after 090 committed.
--
-- Fails closed: refuses to drop anything while any validation-recovery audit row exists, or
-- while any job still carries a non-null validation_recovery_id. No row is ever mutated
-- here; the evidence checks below are the only statements that run before the drops, and
-- neither writes anything. This rollback never repeats the 089/090 evidence checks:
-- psi_agt002_operator_recoveries, psi_agt002_context_recoveries, and their jobs columns
-- stay intact and untested here.

-- Lock jobs -> operator_recoveries -> context_recoveries -> validation_recoveries, mirroring
-- authorize's locking order and the same order in which the three recoveries stack (operator,
-- context, validation), so no new recovery evidence can commit between the preflight checks
-- below and the drops that follow.
lock table public.psi_agt002_reanalysis_jobs in access exclusive mode;
lock table public.psi_agt002_operator_recoveries in access exclusive mode;
lock table public.psi_agt002_context_recoveries in access exclusive mode;
lock table public.psi_agt002_validation_recoveries in access exclusive mode;

do $$
begin
  if exists (select 1 from public.psi_agt002_validation_recoveries) then
    raise exception 'bloqueado: no se puede revertir la migración 091 mientras public.psi_agt002_validation_recoveries tenga registros de auditoría';
  end if;
  if exists (select 1 from public.psi_agt002_reanalysis_jobs where validation_recovery_id is not null) then
    raise exception 'bloqueado: no se puede revertir la migración 091 mientras algún job tenga validation_recovery_id asignado';
  end if;
end
$$;

drop function if exists public.psi_authorize_agt002_validation_recovery(uuid, uuid, integer, text, text, text);

-- Restore the jobs guard trigger function to the exact 090 body/semantics, recognizing only
-- operator_recovery_id and context_recovery_id. The trigger itself
-- (psi_agt002_reanalysis_jobs_guard_operator_recovery on public.psi_agt002_reanalysis_jobs,
-- before update) was never dropped by 091 and needs no change; only the function body it
-- points to is replaced back in place.
create or replace function public.psi_agt002_reanalysis_jobs_guard_operator_recovery()
returns trigger language plpgsql as $$
declare
  v_operator_audit public.psi_agt002_operator_recoveries%rowtype;
  v_context_audit public.psi_agt002_context_recoveries%rowtype;
  v_operator_bound boolean;
  v_context_bound boolean;
begin
  if old.operator_recovery_id is not null and new.operator_recovery_id is distinct from old.operator_recovery_id then
    raise exception 'operator_recovery_id es inmutable una vez fijado' using errcode = '55000';
  end if;

  if old.context_recovery_id is not null and new.context_recovery_id is distinct from old.context_recovery_id then
    raise exception 'context_recovery_id es inmutable una vez fijado' using errcode = '55000';
  end if;

  v_operator_bound := old.operator_recovery_id is null and new.operator_recovery_id is not null;
  v_context_bound := old.context_recovery_id is null and new.context_recovery_id is not null;

  if new.operator_recovery_id is distinct from old.operator_recovery_id then
    if not v_operator_bound then
      raise exception 'operator_recovery_id sólo puede pasar de null a un valor real, una única vez' using errcode = '55000';
    end if;
    select * into v_operator_audit from public.psi_agt002_operator_recoveries where id = new.operator_recovery_id;
    if not found or v_operator_audit.job_id is distinct from new.id then
      raise exception 'operator_recovery_id no pertenece a este job' using errcode = '55000';
    end if;
    if not (old.status = 'unavailable' and old.resume_count >= 5 and new.status = 'queued') then
      raise exception 'la vinculación de operator_recovery_id sólo aplica a una transición unavailable -> queued en el tope automático' using errcode = '55000';
    end if;
  end if;

  if new.context_recovery_id is distinct from old.context_recovery_id then
    if not v_context_bound then
      raise exception 'context_recovery_id sólo puede pasar de null a un valor real, una única vez' using errcode = '55000';
    end if;
    select * into v_context_audit from public.psi_agt002_context_recoveries where id = new.context_recovery_id;
    if not found or v_context_audit.job_id is distinct from new.id then
      raise exception 'context_recovery_id no pertenece a este job' using errcode = '55000';
    end if;
    if not (old.status = 'unavailable' and old.resume_count = 5 and new.status = 'queued') then
      raise exception 'la vinculación de context_recovery_id sólo aplica a una transición unavailable -> queued en el tope automático' using errcode = '55000';
    end if;
    if old.operator_recovery_id is null or new.operator_recovery_id is distinct from old.operator_recovery_id then
      raise exception 'la vinculación de context_recovery_id exige un operator_recovery_id (089) ya fijado y sin cambios' using errcode = '55000';
    end if;
  end if;

  if new.status = 'queued' and old.status = 'unavailable' and old.resume_count >= 5 then
    if (v_operator_bound and v_context_bound) or (not v_operator_bound and not v_context_bound) then
      raise exception 'un requeue en el tope automático exige vincular exactamente uno de operator_recovery_id o context_recovery_id en la misma sentencia' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

alter table public.psi_agt002_reanalysis_jobs
  drop column if exists validation_recovery_id;

drop trigger if exists psi_agt002_validation_recoveries_immutable on public.psi_agt002_validation_recoveries;
drop function if exists public.psi_agt002_validation_recoveries_prevent_mutation();

-- No policy to drop alongside the table: migration 091 never created one on
-- psi_agt002_validation_recoveries (only the inert grant select to service_role).
drop table if exists public.psi_agt002_validation_recoveries;

commit;
