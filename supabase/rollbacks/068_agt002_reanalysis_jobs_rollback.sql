begin;

-- Fails closed on ANY existing row, not just active (queued|running) ones: a completed or
-- unavailable job is durable history of a real reanalysis attempt and must never be
-- silently dropped by rolling back the schema that holds it.
do $$
begin
  if to_regclass('public.psi_agt002_reanalysis_jobs') is not null
     and exists (select 1 from public.psi_agt002_reanalysis_jobs limit 1) then
    raise exception 'Rollback 068 bloqueado: existen filas en psi_agt002_reanalysis_jobs (historial); no se pueden eliminar.';
  end if;
end $$;

revoke all on function public.psi_fail_agt002_reanalysis_job(uuid, uuid, text) from public, authenticated, anon, service_role;
drop function if exists public.psi_fail_agt002_reanalysis_job(uuid, uuid, text);

revoke all on function public.psi_complete_agt002_reanalysis_job(uuid, uuid, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_complete_agt002_reanalysis_job(uuid, uuid, uuid);

revoke all on function public.psi_claim_agt002_reanalysis_job(integer) from public, authenticated, anon, service_role;
drop function if exists public.psi_claim_agt002_reanalysis_job(integer);

revoke all on function public.psi_create_agt002_reanalysis_job(uuid, uuid, uuid, uuid, text, jsonb, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_create_agt002_reanalysis_job(uuid, uuid, uuid, uuid, text, jsonb, uuid);

drop trigger if exists psi_agt002_reanalysis_jobs_identity_immutable on public.psi_agt002_reanalysis_jobs;
drop function if exists public.psi_agt002_reanalysis_jobs_prevent_identity_mutation();

drop table if exists public.psi_agt002_reanalysis_jobs;

commit;
