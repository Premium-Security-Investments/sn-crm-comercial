-- Administración de accesos desde la app (solo administradores de Programación).

create or replace function programacion.listar_accesos()
returns table (profile_id uuid, correo text, nombre text, rol text, ciudad_id text, activo boolean, actualizado_en timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.profile_id, p.microsoft_email, p.full_name, a.rol, a.ciudad_id, a.activo, a.actualizado_en
  from programacion.accesos a join public.psi_sales_profiles p on p.id = a.profile_id
  where programacion.es_admin()
  order by a.activo desc, p.full_name
$$;

-- Usuarios activos del SIIO para dar acceso (búsqueda por nombre o correo, mínimo 3 letras).
create or replace function programacion.buscar_usuarios_siio(p_q text)
returns table (correo text, nombre text, ya_tiene_acceso boolean)
language sql stable security definer set search_path = '' as $$
  select p.microsoft_email, p.full_name, exists (select 1 from programacion.accesos a where a.profile_id = p.id and a.activo)
  from public.psi_sales_profiles p
  where programacion.es_admin() and p.active and length(trim(p_q)) >= 3
    and (p.full_name ilike '%' || trim(p_q) || '%' or p.microsoft_email ilike '%' || trim(p_q) || '%')
  order by p.full_name limit 10
$$;

revoke execute on function programacion.listar_accesos(), programacion.buscar_usuarios_siio(text) from anon, public;
grant execute on function programacion.listar_accesos(), programacion.buscar_usuarios_siio(text) to authenticated;

-- dar_acceso: igual que en 0005, más la protección para no quitar al último administrador.
create or replace function programacion.dar_acceso(p_correo text, p_rol text, p_ciudad text default null, p_activo boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare v_profile uuid;
begin
  if not (programacion.es_admin() or coalesce(auth.role(), '') = 'service_role' or auth.uid() is null) then
    raise exception 'Solo un administrador de Programación puede dar accesos';
  end if;
  select p.id into v_profile from public.psi_sales_profiles p where lower(p.microsoft_email) = lower(trim(p_correo)) and p.active;
  if v_profile is null then
    raise exception 'El correo % no tiene usuario activo en el SIIO. Créelo primero en Usuarios y permisos.', p_correo;
  end if;
  if exists (select 1 from programacion.accesos a where a.profile_id = v_profile and a.rol = 'admin' and a.activo)
     and (p_rol <> 'admin' or not p_activo)
     and (select count(*) from programacion.accesos a where a.rol = 'admin' and a.activo) <= 1 then
    raise exception 'No se puede quitar al último administrador de Programación';
  end if;
  insert into programacion.accesos (profile_id, rol, ciudad_id, activo, creado_por)
  values (v_profile, p_rol, p_ciudad, p_activo, public.psi_sales_current_profile_id())
  on conflict (profile_id) do update
    set rol = excluded.rol, ciudad_id = excluded.ciudad_id, activo = excluded.activo, actualizado_en = now();
  return format('Acceso %s para %s (%s)', case when p_activo then 'activo' else 'inactivo' end, p_correo, coalesce(p_ciudad, 'todas las ciudades'));
end $$;
revoke execute on function programacion.dar_acceso(text, text, text, boolean) from anon, public;
grant execute on function programacion.dar_acceso(text, text, text, boolean) to authenticated;
