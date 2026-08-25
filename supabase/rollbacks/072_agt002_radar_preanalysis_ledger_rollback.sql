-- Remove only the AGT-002 Radar preanalysis queue and ledgers introduced by 072.
begin;
drop function if exists public.psi_fail_agt002_radar_preanalysis_job(uuid,uuid,text);
drop function if exists public.psi_complete_agt002_radar_preanalysis_job(uuid,uuid,uuid);
drop function if exists public.psi_claim_agt002_radar_preanalysis_job(integer);
drop function if exists public.psi_enqueue_agt002_radar_preanalysis_job(uuid,uuid,text,text,text,text,text);
drop function if exists public.psi_append_agt002_radar_preanalysis_attempt(text,uuid,uuid,text,text,uuid,text);
drop function if exists public.psi_record_agt002_radar_preanalysis_run(uuid,uuid,text,text,jsonb,jsonb,text,text,text,integer,text,jsonb,text);
drop trigger if exists psi_agt002_radar_attempt_append_only on public.psi_agt002_radar_preanalysis_attempt_events;
drop function if exists public.psi_guard_agt002_radar_attempt_mutation();
drop trigger if exists psi_agt002_radar_preanalysis_jobs_immutable on public.psi_agt002_radar_preanalysis_jobs;
drop function if exists public.psi_guard_agt002_radar_preanalysis_job_mutation();
drop trigger if exists psi_agt002_radar_preanalysis_runs_append_only on public.psi_agt002_radar_preanalysis_runs;
drop function if exists public.psi_guard_agt002_radar_preanalysis_run_mutation();
drop table if exists public.psi_agt002_radar_preanalysis_attempt_events;
drop table if exists public.psi_agt002_radar_preanalysis_jobs;
drop table if exists public.psi_agt002_radar_preanalysis_runs;
commit;
