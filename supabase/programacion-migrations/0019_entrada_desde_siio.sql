-- La entrada a Programación la da el SIIO (Juan Botero, 2026-10-15).
--
-- En Usuarios y permisos del SIIO se marca la casilla "Programación de turnos" (permiso modulo_programacion, migración
-- 130 del SIIO). Aquí, en la pestaña Usuarios, el administrador de Programación le asigna rol y ciudad.
--   * Sin la casilla del SIIO no se entra, aunque exista una fila en programacion.accesos (quitarla cierra la entrada).
--   * Con la casilla y sin rol asignado: "pendiente" (la persona ve un aviso; no ve datos).
-- REQUISITO: aplicar antes la migración 130 del SIIO (otorga modulo_programacion a quien ya tiene acceso activo); si no,
-- nadie entra a Programación hasta que se le marque la casilla.

-- ¿Tiene la casilla Programación en el SIIO?
create or replace function programacion.tiene_entrada_siio(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.psi_profile_permissions pp
    join public.psi_sales_profiles p on p.id = pp.profile_id and p.active
    where pp.profile_id = p_profile and pp.permission_code = 'modulo_programacion'
  )
$$;

-- Acceso de quien está conectado: ahora exige también la entrada del SIIO.
create or replace function programacion.mi_acceso()
returns table (rol text, ciudad_id text)
language sql stable security definer set search_path = '' as $$
  select a.rol, a.ciudad_id
  from programacion.accesos a
  where a.profile_id = public.psi_sales_current_profile_id() and a.activo
    and programacion.tiene_entrada_siio(a.profile_id)
$$;

-- Estado de entrada de quien está conectado: 'activo', 'pendiente' (casilla del SIIO sin rol) o 'sin_acceso'.
create or replace function programacion.mi_estado()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not programacion.tiene_entrada_siio(public.psi_sales_current_profile_id()) then 'sin_acceso'
    when exists (select 1 from programacion.mi_acceso()) then 'activo'
    else 'pendiente'
  end
$$;

-- Pestaña Usuarios: todas las personas con la casilla del SIIO, tengan o no rol asignado.
drop function if exists programacion.listar_accesos();
create function programacion.listar_accesos()
returns table (profile_id uuid, correo text, nombre text, rol text, ciudad_id text, activo boolean, actualizado_en timestamptz, estado text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.microsoft_email, p.full_name, a.rol, a.ciudad_id, coalesce(a.activo, false), a.actualizado_en,
         case when a.activo then 'activo' when a.profile_id is null then 'pendiente' else 'pausado' end
  from public.psi_sales_profiles p
  left join programacion.accesos a on a.profile_id = p.id
  where programacion.es_admin() and p.active and programacion.tiene_entrada_siio(p.id)
  order by (a.activo is true) desc, (a.profile_id is null) desc, p.full_name
$$;

-- dar_acceso: igual que en 0015, pero sólo para quien tiene la casilla del SIIO.
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
  if p_activo and not programacion.tiene_entrada_siio(v_profile) then
    raise exception 'Primero marque "Programación de turnos" para % en Usuarios y permisos del SIIO.', p_correo;
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

-- tiene_entrada_siio sólo la usan las funciones de arriba (no se expone: diría quién tiene la casilla).
revoke execute on function programacion.tiene_entrada_siio(uuid) from anon, public, authenticated;
revoke execute on function programacion.mi_estado(), programacion.listar_accesos() from anon, public;
grant execute on function programacion.mi_estado(), programacion.listar_accesos() to authenticated;
revoke execute on function programacion.dar_acceso(text, text, text, boolean) from anon, public;
grant execute on function programacion.dar_acceso(text, text, text, boolean) to authenticated;
