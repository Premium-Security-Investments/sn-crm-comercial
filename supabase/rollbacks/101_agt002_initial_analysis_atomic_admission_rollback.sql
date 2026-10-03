begin;

-- No persisted row belongs exclusively to migration 101, so rollback removes only its RPC and
-- restores the prior service-role grant on the migration-099 primitive. It never deletes data.
revoke all on function public.psi_admit_authorized_agt002_initial_analysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_admit_authorized_agt002_initial_analysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid);

grant execute on function public.psi_admit_agt002_initial_analysis_job(uuid, uuid, text, jsonb, text) to service_role;

commit;
