begin;

-- Rollback for migration 089 (AGT-002 operator-governed recovery).
--
-- Fails closed: refuses to drop anything while any audit row exists, or while any job still
-- carries a non-null operator_recovery_id. No row is ever mutated here; the two guard checks
-- below are the only statements that run before the drops, and neither writes anything.

-- Lock jobs before recoveries, mirroring authorize's job-first locking order, so no new
-- recovery evidence can commit between the preflight checks above and the drops below.
lock table public.psi_agt002_reanalysis_jobs in access exclusive mode;
lock table public.psi_agt002_operator_recoveries in access exclusive mode;

do $$
begin
  if exists (select 1 from public.psi_agt002_operator_recoveries) then
    raise exception 'bloqueado: no se puede revertir la migración 089 mientras public.psi_agt002_operator_recoveries tenga registros de auditoría';
  end if;
  if exists (select 1 from public.psi_agt002_reanalysis_jobs where operator_recovery_id is not null) then
    raise exception 'bloqueado: no se puede revertir la migración 089 mientras algún job tenga operator_recovery_id asignado';
  end if;
end
$$;

drop trigger if exists psi_agt002_reanalysis_jobs_guard_operator_recovery on public.psi_agt002_reanalysis_jobs;
drop function if exists public.psi_agt002_reanalysis_jobs_guard_operator_recovery();

drop function if exists public.psi_authorize_agt002_operator_recovery(uuid, uuid, integer, text);

alter table public.psi_agt002_reanalysis_jobs
  drop column if exists operator_recovery_id;

drop trigger if exists psi_agt002_operator_recoveries_immutable on public.psi_agt002_operator_recoveries;
drop function if exists public.psi_agt002_operator_recoveries_prevent_mutation();

drop table if exists public.psi_agt002_operator_recoveries;

commit;
