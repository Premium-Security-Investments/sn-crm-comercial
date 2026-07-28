begin;

insert into public.psi_access_permissions (code, name, description, active)
values (
  'vigia_copilot_pilot',
  'Piloto Copiloto Vig-IA',
  'Autoridad temporal y explícita para ejecutar el copiloto comercial de Vig-IA durante el canary.',
  true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  active = true;

do $$
declare
  v_profile_id uuid;
  v_match_count integer;
begin
  select count(*), min(id::text)::uuid
    into v_match_count, v_profile_id
  from public.psi_sales_profiles
  where lower(btrim(microsoft_email)) = 'juanbotero@premiumsecurity.ai'
    and active = true
    and coalesce(identity_type, 'human') = 'human';

  if v_match_count <> 1 or v_profile_id is null then
    raise exception 'El piloto Vig-IA debe resolver exactamente a una identidad PSI activa y humana.';
  end if;

  insert into public.psi_profile_permissions (profile_id, permission_code, created_by)
  values (v_profile_id, 'vigia_copilot_pilot', v_profile_id)
  on conflict (profile_id, permission_code) do nothing;
end
$$;

do $$
begin
  if (select count(*) from public.psi_profile_permissions where permission_code = 'vigia_copilot_pilot') <> 1
     or not exists (
       select 1
       from public.psi_profile_permissions pp
       join public.psi_sales_profiles p on p.id = pp.profile_id
       where pp.permission_code = 'vigia_copilot_pilot'
         and lower(btrim(p.microsoft_email)) = 'juanbotero@premiumsecurity.ai'
         and p.active = true
         and coalesce(p.identity_type, 'human') = 'human'
     ) then
    raise exception 'El permiso piloto Vig-IA no está limitado exclusivamente a Juan PSI.';
  end if;
end
$$;

commit;
