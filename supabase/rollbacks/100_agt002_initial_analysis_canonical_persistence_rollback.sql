begin;

-- Rollback for supabase/migrations/100_agt002_initial_analysis_canonical_persistence.sql.
--
-- Fails closed while ANY INITIAL canonical run, lineage row, aggregate envelope or persisted
-- checkpoint still exists: rollback must never silently delete or truncate an append-only
-- audit trail. This rollback is only for an installation that has never completed an
-- INITIAL analysis.
do $$
begin
  if (to_regclass('public.psi_agt002_pre_go_analysis_versions') is not null
        and exists (select 1 from public.psi_agt002_pre_go_analysis_versions limit 1))
     or (to_regclass('public.psi_agt002_initial_analysis_run_lineage') is not null
        and exists (select 1 from public.psi_agt002_initial_analysis_run_lineage limit 1))
     or (to_regclass('public.psi_agt002_initial_analysis_checkpoints') is not null
        and exists (select 1 from public.psi_agt002_initial_analysis_checkpoints limit 1))
     or (to_regclass('public.psi_tender_analysis_runs') is not null
        and exists (select 1 from public.psi_tender_analysis_runs where analysis_kind is not null limit 1))
     or (to_regclass('public.psi_agt002_initial_analysis_jobs') is not null
        and exists (select 1 from public.psi_agt002_initial_analysis_jobs where error_code is not null limit 1))
  then
    raise exception 'Rollback 100 bloqueado: existe historial de análisis inicial AGT-002 (checkpoints, linaje, agregados, corridas canónicas o fallos registrados); el rollback se bloquea para no extraviarlo.';
  end if;
end $$;

revoke all on function public.psi_fail_agt002_initial_analysis_job(uuid, uuid, integer, text) from public, authenticated, anon, service_role;
drop function if exists public.psi_fail_agt002_initial_analysis_job(uuid, uuid, integer, text);

revoke all on function public.psi_complete_agt002_initial_analysis_job(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb, text) from public, authenticated, anon, service_role;
drop function if exists public.psi_complete_agt002_initial_analysis_job(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb, text);

drop table if exists public.psi_agt002_pre_go_analysis_versions;
drop function if exists public.psi_agt002_pre_go_analysis_versions_prevent_mutation();

drop table if exists public.psi_agt002_initial_analysis_run_lineage;
drop function if exists public.psi_agt002_initial_analysis_run_lineage_prevent_mutation();

alter table public.psi_agt002_initial_analysis_jobs
  drop constraint if exists psi_agt002_initial_analysis_jobs_terminal_shape_check;
alter table public.psi_agt002_initial_analysis_jobs
  drop column if exists analysis_run_id;
alter table public.psi_agt002_initial_analysis_jobs
  drop column if exists error_code;

alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_agt002_hash_unique;
alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_agt002_identity_complete_check;
alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_agt002_initial_shape_check;
alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_agt002_hash_check;
alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_agt002_scope_check;
alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_agt002_kind_check;
alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_snapshot_legacy_check;
alter table public.psi_tender_analysis_runs
  alter column snapshot_id set not null;

alter table public.psi_tender_analysis_runs drop column if exists analysis_core_hash;
alter table public.psi_tender_analysis_runs drop column if exists package_version_id;
alter table public.psi_tender_analysis_runs drop column if exists g1_scope;
alter table public.psi_tender_analysis_runs drop column if exists g1_authorization_id;
alter table public.psi_tender_analysis_runs drop column if exists analysis_version;
alter table public.psi_tender_analysis_runs drop column if exists analysis_kind;

revoke all on function public.psi_store_agt002_initial_analysis_checkpoint(uuid, uuid, integer, integer, text, text, jsonb, text, jsonb) from public, authenticated, anon, service_role;
drop function if exists public.psi_store_agt002_initial_analysis_checkpoint(uuid, uuid, integer, integer, text, text, jsonb, text, jsonb);
revoke all on function public.psi_load_agt002_initial_analysis_checkpoint(uuid, integer, text) from public, authenticated, anon, service_role;
drop function if exists public.psi_load_agt002_initial_analysis_checkpoint(uuid, integer, text);

drop table if exists public.psi_agt002_initial_analysis_checkpoints;
drop function if exists public.psi_agt002_initial_analysis_checkpoints_prevent_mutation();

commit;
