begin;

-- Rollback for supabase/migrations/101_agt002_initial_analysis_jobs.sql.
--
-- Fails closed while ANY initial-analysis job row still exists: rollback must never silently
-- delete or truncate queue history. This rollback is only for an installation that has never
-- admitted a job.
do $$
begin
  if to_regclass('public.psi_agt002_initial_analysis_jobs') is not null
     and exists (select 1 from public.psi_agt002_initial_analysis_jobs limit 1) then
    raise exception 'Rollback 101 bloqueado: existen jobs de análisis inicial AGT-002 (historial); el rollback se bloquea para no extraviar la cola.';
  end if;
end $$;

revoke all on function public.psi_renew_agt002_initial_analysis_job_lease(uuid, uuid, integer, integer) from public, authenticated, anon, service_role;
drop function if exists public.psi_renew_agt002_initial_analysis_job_lease(uuid, uuid, integer, integer);

revoke all on function public.psi_claim_agt002_initial_analysis_job(text, integer) from public, authenticated, anon, service_role;
drop function if exists public.psi_claim_agt002_initial_analysis_job(text, integer);

revoke all on function public.psi_admit_agt002_initial_analysis_job(uuid, uuid, text, jsonb, text) from public, authenticated, anon, service_role;
drop function if exists public.psi_admit_agt002_initial_analysis_job(uuid, uuid, text, jsonb, text);

drop table if exists public.psi_agt002_initial_analysis_jobs;

commit;
