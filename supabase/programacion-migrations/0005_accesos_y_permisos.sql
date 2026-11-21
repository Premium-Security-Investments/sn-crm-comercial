-- Accesos a Programación: mismos usuarios del SIIO (public.psi_sales_profiles, ingreso con
-- correo y clave). Cada usuario recibe un rol de Programación y, si aplica, una ciudad.
--   admin        → todo, en todas las ciudades; administra accesos.
--   coordinador  → ve y edita la programación de su ciudad.
--   nomina       → ve todo lo de su ciudad (o todas) y cierra periodos; no edita turnos.
--   consulta     → solo lectura (p. ej. Gerencia).
-- Sin fila en programacion.accesos = sin acceso, aunque tenga usuario en el SIIO.

create table programacion.accesos (
  profile_id  uuid primary key references public.psi_sales_profiles(id) on delete cascade,
  rol         text not null check (rol in ('admin', 'coordinador', 'nomina', 'consulta')),
  ciudad_id   text references programacion.ciudades(id),      -- null = todas las ciudades
  activo      boolean not null default true,
  creado_por  uuid,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table programacion.accesos enable row level security;

-- Acceso de quien está conectado.
create or replace function programacion.mi_acceso()
returns table (rol text, ciudad_id text)
language sql stable security definer set search_path = '' as $$
  select a.rol, a.ciudad_id
  from programacion.accesos a
  where a.profile_id = public.psi_sales_current_profile_id() and a.activo
$$;

create or replace function programacion.puede_ver(p_ciudad text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from programacion.mi_acceso() m where m.ciudad_id is null or m.ciudad_id = p_ciudad)
$$;

create or replace function programacion.puede_editar(p_ciudad text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from programacion.mi_acceso() m
    where m.rol in ('admin', 'coordinador') and (m.ciudad_id is null or m.ciudad_id = p_ciudad)
  )
$$;

create or replace function programacion.es_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from programacion.mi_acceso() m where m.rol = 'admin')
$$;

create or replace function programacion.ciudad_de_empleado(p_empleado bigint)
returns text language sql stable security definer set search_path = '' as $$
  select e.ciudad_id from programacion.empleados e where e.id = p_empleado
$$;

-- Dar o cambiar acceso por correo (lo usa un admin de Programación o el equipo técnico).
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
  insert into programacion.accesos (profile_id, rol, ciudad_id, activo, creado_por)
  values (v_profile, p_rol, p_ciudad, p_activo, public.psi_sales_current_profile_id())
  on conflict (profile_id) do update
    set rol = excluded.rol, ciudad_id = excluded.ciudad_id, activo = excluded.activo, actualizado_en = now();
  return format('Acceso %s para %s (%s)', case when p_activo then 'activo' else 'inactivo' end, p_correo, coalesce(p_ciudad, 'todas las ciudades'));
end $$;

-- ---------- Permisos de tabla para usuarios conectados (RLS decide qué filas) ----------
grant usage on schema programacion to authenticated;
grant select on all tables in schema programacion to authenticated;
grant insert, update, delete on programacion.turnos, programacion.turnos_programados,
  programacion.novedades, programacion.asignaciones to authenticated;
grant execute on function programacion.mi_acceso(), programacion.puede_ver(text), programacion.puede_editar(text),
  programacion.es_admin(), programacion.ciudad_de_empleado(bigint), programacion.dar_acceso(text, text, text, boolean) to authenticated;
grant usage, select on all sequences in schema programacion to authenticated;

-- ---------- Políticas ----------
create policy ver_ciudades on programacion.ciudades for select to authenticated using (programacion.puede_ver(id));
create policy ver_festivos on programacion.festivos for select to authenticated using (exists (select 1 from programacion.mi_acceso()));
create policy ver_parametros on programacion.parametros_nomina for select to authenticated using (ciudad_id is null or programacion.puede_ver(ciudad_id));
create policy ver_clientes on programacion.clientes for select to authenticated using (exists (select 1 from programacion.mi_acceso()));
create policy ver_puestos on programacion.puestos for select to authenticated using (programacion.puede_ver(ciudad_id));
create policy ver_empleados on programacion.empleados for select to authenticated using (programacion.puede_ver(ciudad_id));
create policy ver_patrones on programacion.patrones_turno for select to authenticated using (ciudad_id is null or programacion.puede_ver(ciudad_id));
create policy ver_periodos on programacion.periodos for select to authenticated using (programacion.puede_ver(ciudad_id));
create policy ver_resultados on programacion.resultados_nomina for select to authenticated
  using (programacion.puede_ver(programacion.ciudad_de_empleado(empleado_id)));
create policy ver_historial on programacion.historial for select to authenticated using (programacion.es_admin());
create policy ver_accesos on programacion.accesos for select to authenticated
  using (profile_id = public.psi_sales_current_profile_id() or programacion.es_admin());

-- Tablas operativas: ver si puede ver la ciudad del empleado; editar si es coordinador/admin de esa ciudad.
create policy ver_asignaciones on programacion.asignaciones for select to authenticated
  using (programacion.puede_ver(programacion.ciudad_de_empleado(empleado_id)));
create policy editar_asignaciones on programacion.asignaciones for all to authenticated
  using (programacion.puede_editar(programacion.ciudad_de_empleado(empleado_id)))
  with check (programacion.puede_editar(programacion.ciudad_de_empleado(empleado_id)));

create policy ver_programados on programacion.turnos_programados for select to authenticated
  using (programacion.puede_ver(programacion.ciudad_de_empleado(empleado_id)));
create policy editar_programados on programacion.turnos_programados for all to authenticated
  using (programacion.puede_editar(programacion.ciudad_de_empleado(empleado_id)))
  with check (programacion.puede_editar(programacion.ciudad_de_empleado(empleado_id)));

create policy ver_turnos on programacion.turnos for select to authenticated
  using (programacion.puede_ver(programacion.ciudad_de_empleado(empleado_id)));
create policy editar_turnos on programacion.turnos for all to authenticated
  using (programacion.puede_editar(programacion.ciudad_de_empleado(empleado_id)))
  with check (programacion.puede_editar(programacion.ciudad_de_empleado(empleado_id)));

create policy ver_novedades on programacion.novedades for select to authenticated
  using (programacion.puede_ver(programacion.ciudad_de_empleado(empleado_id)));
create policy editar_novedades on programacion.novedades for all to authenticated
  using (programacion.puede_editar(programacion.ciudad_de_empleado(empleado_id)))
  with check (programacion.puede_editar(programacion.ciudad_de_empleado(empleado_id)));

-- Periodos cerrados: nadie modifica turnos ni novedades con fechas dentro de ellos.
create or replace function programacion.bloquear_periodo_cerrado() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_fecha date; v_ciudad text;
begin
  v_ciudad := programacion.ciudad_de_empleado(coalesce(new.empleado_id, old.empleado_id));
  -- Un CASE con new.desde no compila en tablas sin esa columna: se separa con IF.
  if tg_table_name = 'novedades' then
    v_fecha := case when tg_op = 'DELETE' then old.desde else new.desde end;
  else
    v_fecha := (case when tg_op = 'DELETE' then old.inicio else new.inicio end)::date;
  end if;
  if exists (select 1 from programacion.periodos p
             where p.ciudad_id = v_ciudad and p.estado = 'cerrado' and v_fecha between p.inicio and p.fin)
     and coalesce(auth.role(), '') <> 'service_role' and auth.uid() is not null then
    raise exception 'El periodo de % ya está cerrado; no se puede modificar', v_fecha;
  end if;
  return coalesce(new, old);
end $$;
create trigger bloquear_cerrado_turnos before insert or update or delete on programacion.turnos
  for each row execute function programacion.bloquear_periodo_cerrado();
create trigger bloquear_cerrado_programados before insert or update or delete on programacion.turnos_programados
  for each row execute function programacion.bloquear_periodo_cerrado();
create trigger bloquear_cerrado_novedades before insert or update or delete on programacion.novedades
  for each row execute function programacion.bloquear_periodo_cerrado();

revoke all on all tables in schema programacion from anon;
revoke execute on all functions in schema programacion from anon, public;
grant execute on function programacion.mi_acceso(), programacion.puede_ver(text), programacion.puede_editar(text),
  programacion.es_admin(), programacion.ciudad_de_empleado(bigint), programacion.dar_acceso(text, text, text, boolean) to authenticated;
