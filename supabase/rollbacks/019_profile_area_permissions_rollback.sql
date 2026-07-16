-- Rollback 019 only. Profile data and unrelated legacy checks are preserved.

begin;

-- New role values cannot be represented by the legacy check, so abort before any schema removal.
do $$
begin
  if exists (
    select 1
    from public.psi_sales_profiles
    where role in ('colaborador', 'junta')
  ) then
    raise exception 'No se puede revertir 019: existen perfiles con rol colaborador o junta.';
  end if;

  if exists (select 1 from public.psi_profile_area_assignments) then
    raise exception 'No se puede revertir 019: psi_profile_area_assignments contiene datos funcionales.';
  end if;
  if exists (select 1 from public.psi_profile_permissions) then
    raise exception 'No se puede revertir 019: psi_profile_permissions contiene datos funcionales.';
  end if;
  if exists (select 1 from public.psi_access_audit_log) then
    raise exception 'No se puede revertir 019: psi_access_audit_log contiene datos funcionales.';
  end if;
end $$;

drop trigger if exists psi_access_audit_log_immutable on public.psi_access_audit_log;
drop table if exists public.psi_access_audit_log;
drop function if exists public.psi_access_audit_log_prevent_mutation();
drop table if exists public.psi_profile_permissions;
drop table if exists public.psi_profile_area_assignments;
drop table if exists public.psi_access_permissions;
drop table if exists public.psi_org_subareas;
drop table if exists public.psi_org_areas;

alter table public.psi_sales_profiles
  drop constraint if exists psi_sales_profiles_role_check;

alter table public.psi_sales_profiles
  add constraint psi_sales_profiles_role_check
  check (role in ('admin', 'gerencia', 'director', 'comercial'));

commit;
