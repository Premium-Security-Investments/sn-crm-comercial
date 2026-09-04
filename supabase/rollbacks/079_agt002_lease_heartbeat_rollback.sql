-- Removes only the two renewal RPCs migration 079 added. The reservation tables they extend
-- (psi_agt002_preview_claims, psi_agt002_reanalysis_jobs) and every other RPC beside them are
-- untouched.
begin;

revoke all on function public.psi_renew_agt002_reanalysis_job_lease(uuid, uuid, integer) from public, authenticated, anon, service_role;
drop function if exists public.psi_renew_agt002_reanalysis_job_lease(uuid, uuid, integer);

revoke all on function public.psi_renew_agt002_preview_claim(text, uuid, integer) from public, authenticated, anon, service_role;
drop function if exists public.psi_renew_agt002_preview_claim(text, uuid, integer);

commit;
