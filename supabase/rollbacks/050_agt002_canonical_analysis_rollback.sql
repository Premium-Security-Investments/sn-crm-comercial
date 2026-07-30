begin;

revoke all on function public.psi_append_agt002_analysis_attempt(uuid, uuid, uuid, text, text, text, text, text, text, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_append_agt002_analysis_attempt(uuid, uuid, uuid, text, text, text, text, text, text, uuid);

revoke all on function public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb) from public, authenticated, anon, service_role;
drop function if exists public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb);

drop trigger if exists psi_agt002_analysis_attempt_events_immutable on public.psi_agt002_analysis_attempt_events;
drop function if exists public.psi_agt002_analysis_attempt_events_prevent_mutation();
drop table if exists public.psi_agt002_analysis_attempt_events;

drop index if exists public.psi_tender_analysis_runs_canonical_current_idx;
alter table public.psi_tender_analysis_runs
  drop constraint if exists psi_tender_analysis_runs_canonical_agt002_check;
alter table public.psi_tender_analysis_runs
  drop column if exists canonical;

commit;
