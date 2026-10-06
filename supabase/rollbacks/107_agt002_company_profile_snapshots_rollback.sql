-- Fail-closed rollback: 107 adds the company-profile snapshot table. Once a snapshot exists it may back a
-- workflow instance and an analysis, so removing it would orphan that evidence: refused while any row exists.
begin;
lock table public.psi_agt002_company_profile_snapshots in access exclusive mode;
do $$
begin
  if exists (select 1 from public.psi_agt002_company_profile_snapshots) then
    raise exception 'Rollback 107 refused: company profile snapshot evidence exists.' using errcode = '55000';
  end if;
end;
$$;
drop function if exists public.psi_freeze_agt002_company_profile_snapshot(jsonb, text, uuid);
drop trigger if exists psi_agt002_company_profile_snapshots_immutable on public.psi_agt002_company_profile_snapshots;
drop table if exists public.psi_agt002_company_profile_snapshots;
drop function if exists public.psi_agt002_company_profile_snapshot_prevent_mutation();
commit;
