-- Usuarios y permisos → "Acceso a Programación" (AGT-006; Juan Botero, 2026-10-15).
--
-- La aplicación de Programación (repo programacion-personal, esquema `programacion` en esta misma base) decide quién
-- entra con `programacion.accesos` (rol y ciudad por persona del SIIO). Hasta hoy ese acceso sólo se daba con SQL
-- (`programacion.dar_acceso`). Con esta migración se administra desde Usuarios y permisos del SIIO.
--
-- Dos funciones, sólo para service_role (el servidor del SIIO ya exige USERS_MANAGE antes de llamarlas):
--   * psi_admin_programacion_access_list(): ciudades y accesos actuales.
--   * psi_admin_set_programacion_access(perfil, rol, ciudad, actor): da, cambia o quita el acceso. Bloquea la fila,
--     rechaza identidades de agentes, no deja quitar al último administrador de Programación y deja el cambio en
--     psi_access_audit_log. Quitar = acceso inactivo (se conserva el registro).
-- Si el esquema `programacion` no existe, la migración no hace nada.
begin;

do $migration$
begin
  if to_regclass('programacion.accesos') is null or to_regclass('programacion.ciudades') is null then
    raise notice 'Esquema programacion no encontrado: se omite 129_programacion_access_admin';
    return;
  end if;

  execute $fn$
  create or replace function public.psi_admin_programacion_access_list()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
  as $body$
    select jsonb_build_object(
      'ciudades', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre) order by c.nombre) from programacion.ciudades c), '[]'::jsonb),
      'accesos', coalesce((select jsonb_agg(jsonb_build_object('profile_id', a.profile_id, 'rol', a.rol, 'ciudad_id', a.ciudad_id, 'activo', a.activo)) from programacion.accesos a), '[]'::jsonb)
    );
  $body$;
  $fn$;

  execute $fn$
  create or replace function public.psi_admin_set_programacion_access(
    p_profile_id uuid,
    p_rol text,
    p_ciudad_id text,
    p_actor_profile_id uuid
  )
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $body$
  declare
    v_identity text;
    v_before programacion.accesos%rowtype;
    v_ciudad text := nullif(btrim(coalesce(p_ciudad_id, '')), '');
    v_after jsonb;
  begin
    if p_profile_id is null or p_actor_profile_id is null then
      raise exception 'Parámetros inválidos' using errcode = '22023';
    end if;
    if p_rol is not null and p_rol not in ('admin', 'coordinador', 'nomina', 'consulta') then
      raise exception 'Rol de Programación inválido' using errcode = '22023';
    end if;
    if p_rol is not null and v_ciudad is not null and not exists (select 1 from programacion.ciudades where id = v_ciudad) then
      raise exception 'Ciudad de Programación inválida' using errcode = '22023';
    end if;
    select coalesce(identity_type, 'human') into v_identity from public.psi_sales_profiles where id = p_profile_id for update;
    if not found then
      raise exception 'Perfil no encontrado' using errcode = 'P0002';
    end if;
    if v_identity <> 'human' then
      raise exception 'Las identidades de agentes no tienen acceso a Programación' using errcode = '42501';
    end if;
    select * into v_before from programacion.accesos where profile_id = p_profile_id for update;

    -- No dejar Programación sin administrador.
    if v_before.profile_id is not null and v_before.rol = 'admin' and v_before.activo and (p_rol is distinct from 'admin')
       and (select count(*) from programacion.accesos where rol = 'admin' and activo) <= 1 then
      raise exception 'No se puede quitar al último administrador de Programación' using errcode = '42501';
    end if;

    if p_rol is null then
      if v_before.profile_id is null or not v_before.activo then
        return jsonb_build_object('profile_id', p_profile_id, 'rol', null, 'ciudad_id', null, 'activo', false);
      end if;
      update programacion.accesos set activo = false, actualizado_en = now() where profile_id = p_profile_id;
      v_after := jsonb_build_object('rol', null, 'ciudad_id', null, 'activo', false);
    else
      insert into programacion.accesos (profile_id, rol, ciudad_id, activo, creado_por)
      values (p_profile_id, p_rol, v_ciudad, true, p_actor_profile_id)
      on conflict (profile_id) do update
        set rol = excluded.rol, ciudad_id = excluded.ciudad_id, activo = true, actualizado_en = now();
      v_after := jsonb_build_object('rol', p_rol, 'ciudad_id', v_ciudad, 'activo', true);
    end if;

    if v_before.profile_id is null
       or v_before.activo is distinct from (v_after->>'activo')::boolean
       or v_before.rol is distinct from (v_after->>'rol')
       or v_before.ciudad_id is distinct from (v_after->>'ciudad_id') then
      insert into public.psi_access_audit_log(actor_profile_id, target_profile_id, action, before_state, after_state)
      values (p_actor_profile_id, p_profile_id, 'profile.programacion_access.set',
              case when v_before.profile_id is null then null
                   else jsonb_build_object('rol', v_before.rol, 'ciudad_id', v_before.ciudad_id, 'activo', v_before.activo) end,
              v_after);
    end if;
    return jsonb_build_object('profile_id', p_profile_id) || v_after;
  end;
  $body$;
  $fn$;

  revoke all on function public.psi_admin_programacion_access_list() from public, anon, authenticated;
  grant execute on function public.psi_admin_programacion_access_list() to service_role;
  revoke all on function public.psi_admin_set_programacion_access(uuid, text, text, uuid) from public, anon, authenticated;
  grant execute on function public.psi_admin_set_programacion_access(uuid, text, text, uuid) to service_role;
end;
$migration$;

commit;
