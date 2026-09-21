begin;

alter table public.psi_sales_profiles
  add column if not exists can_own_opportunities boolean;

alter table public.psi_sales_profiles
  alter column can_own_opportunities set default false;

update public.psi_sales_profiles
set can_own_opportunities = false
where can_own_opportunities is null;

alter table public.psi_sales_profiles
  alter column can_own_opportunities set not null;

comment on column public.psi_sales_profiles.can_own_opportunities is
  'Explicitly allows a non-comercial role to own CRM opportunities without changing its authorization role.';

do $$
declare
  v_profile_id uuid;
  v_match_count integer;
  v_unrelated_enabled_before bigint;
  v_unrelated_enabled_after bigint;
begin
  select count(*), min(profile.id::text)::uuid
    into v_match_count, v_profile_id
  from public.psi_sales_profiles profile
  where lower(btrim(profile.microsoft_email)) = 'juanbotero@premiumsecurity.ai'
    and profile.active = true
    and coalesce(profile.identity_type, 'human') = 'human';

  if v_match_count <> 1 or v_profile_id is null then
    raise exception 'La participación comercial debe resolver exactamente un perfil humano activo de Juan Botero; encontrados %.', v_match_count;
  end if;

  if not exists (
    select 1
    from public.psi_sales_profiles profile
    where profile.id = v_profile_id
      and profile.role = 'admin'
  ) then
    raise exception 'Juan Botero debe conservar el rol admin; no se aplicaron cambios.';
  end if;

  select count(*)
    into v_unrelated_enabled_before
  from public.psi_sales_profiles profile
  where profile.id <> v_profile_id
    and profile.can_own_opportunities = true;

  update public.psi_sales_profiles
  set can_own_opportunities = true
  where id = v_profile_id;

  if not exists (
    select 1
    from public.psi_sales_profiles profile
    where profile.id = v_profile_id
      and lower(btrim(profile.microsoft_email)) = 'juanbotero@premiumsecurity.ai'
      and profile.role = 'admin'
      and profile.active = true
      and coalesce(profile.identity_type, 'human') = 'human'
      and profile.can_own_opportunities = true
  ) then
    raise exception 'No se pudo habilitar a Juan Botero sin alterar su identidad administrativa.';
  end if;

  select count(*)
    into v_unrelated_enabled_after
  from public.psi_sales_profiles profile
  where profile.id <> v_profile_id
    and profile.can_own_opportunities = true;

  if v_unrelated_enabled_after <> v_unrelated_enabled_before then
    raise exception 'La migración alteró la capacidad comercial de perfiles no relacionados.';
  end if;
end
$$;

commit;
