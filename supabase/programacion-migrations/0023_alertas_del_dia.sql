-- Alertas del día (antes "Cambios del día"), decisión de Juan del 2026-10-16. Muestra lo que quedó mal
-- después de un cambio y nadie ha resuelto, para que Programación ayude. Cada alerta tiene dos
-- caminos: resolverla aquí (con sugerencias de guardas) o avisar a Operaciones y hacerle seguimiento.
--   sin_cubrir   → turno programado que nadie está haciendo (p. ej. tras una incapacidad);
--   descubierto  → franja contratada sin guarda suficiente (y sin turno sin cubrir que la explique);
--   regla        → turno realizado que rompe una regla (descanso, horas máximas, habilitación, novedad);
--   devuelta     → novedad devuelta a Operaciones que sigue sin corregirse ese día.

create table if not exists programacion.alertas_avisos (
  id          bigint generated always as identity primary key,
  ciudad_id   text not null references programacion.ciudades(id),
  fecha       date not null,
  clave       text not null,
  nota        text,
  avisado_por uuid,
  avisado_en  timestamptz not null default now(),
  unique (ciudad_id, fecha, clave)
);
alter table programacion.alertas_avisos enable row level security;
grant select on programacion.alertas_avisos to authenticated;
create policy ver on programacion.alertas_avisos for select to authenticated using (programacion.puede_ver(ciudad_id));
create trigger historial_alertas_avisos after insert or update or delete on programacion.alertas_avisos
  for each row execute function programacion.registrar_historial();

-- Alertas de un día en una ciudad, con el aviso a Operaciones si ya se dio.
create or replace function programacion.alertas_del_dia(p_ciudad text, p_fecha date)
returns table (clave text, tipo text, puesto_id bigint, puesto text, desde timestamp, hasta timestamp,
               empleado_id bigint, empleado text, detalle text, turno_programado_id bigint, turno_id bigint,
               solicitud_id bigint, avisos text[], avisado_en timestamptz, nota text)
language sql stable security definer set search_path = '' as $$
  with dia as (select * from programacion.turnos_del_dia(p_fecha, p_ciudad)),
  sin as (
    select 'sin_cubrir:' || d.turno_programado_id as clave, 'sin_cubrir'::text as tipo, d.puesto_id, d.puesto,
      d.programado_inicio as desde, d.programado_fin as hasta, d.programado_empleado_id as empleado_id, d.programado_nombre as empleado,
      d.novedad as detalle, d.turno_programado_id, null::bigint as turno_id, null::bigint as solicitud_id, null::text[] as avisos
    from dia d where d.estado = 'sin_cubrir'
  ),
  descubierto as (
    select 'descubierto:' || c.puesto_id || ':' || (b->>'desde'), 'descubierto'::text, c.puesto_id, c.puesto,
      (b->>'desde')::timestamp, (b->>'hasta')::timestamp, null::bigint, null::text,
      'Faltan ' || (b->>'faltan') || ' guarda(s) frente a lo contratado' || coalesce(' · ' || c.cliente, ''),
      null::bigint, null::bigint, null::bigint, null::text[]
    from programacion.cobertura_dia(p_ciudad, p_fecha) c
    cross join lateral jsonb_array_elements(c.descubierto) b
    where not exists (select 1 from sin where sin.puesto_id = c.puesto_id)
  ),
  regla as (
    select 'regla:' || t.id, 'regla'::text, t.puesto_id, pu.nombre, t.inicio, t.fin, t.empleado_id, e.nombre,
      null::text, t.turno_programado_id, t.id, null::bigint, av.avisos
    from programacion.turnos t
    join programacion.empleados e on e.id = t.empleado_id
    left join programacion.puestos pu on pu.id = t.puesto_id
    cross join lateral (select programacion.validar_turno(t.empleado_id, t.inicio, t.fin, t.id, t.puesto_id) as avisos) av
    where e.ciudad_id = p_ciudad and t.inicio::date = p_fecha and programacion.puede_ver(p_ciudad) and cardinality(av.avisos) > 0
  ),
  devuelta as (
    select 'devuelta:' || s.id, 'devuelta'::text, null::bigint, null::text, s.desde::timestamp, (coalesce(s.hasta, s.desde) + 1)::timestamp,
      s.empleado_id, coalesce(e.nombre, 'Cédula ' || s.documento), s.motivo, null::bigint, null::bigint, s.id, null::text[]
    from programacion.solicitudes s left join programacion.empleados e on e.id = s.empleado_id
    where s.ciudad_id = p_ciudad and s.estado = 'devuelta' and programacion.puede_ver(p_ciudad)
      and p_fecha between s.desde and coalesce(s.hasta, s.desde)
  ),
  todas as (select * from sin union all select * from descubierto union all select * from regla union all select * from devuelta)
  select x.*, a.avisado_en, a.nota
  from todas x
  left join programacion.alertas_avisos a on a.ciudad_id = p_ciudad and a.fecha = p_fecha and a.clave = x.clave
  order by case x.tipo when 'sin_cubrir' then 1 when 'descubierto' then 2 when 'regla' then 3 else 4 end, x.desde, x.puesto
$$;

-- Avisar a Operaciones (queda quién, cuándo y la nota). Un segundo aviso actualiza la nota.
create or replace function programacion.avisar_operaciones(p_ciudad text, p_fecha date, p_clave text, p_nota text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v timestamptz;
begin
  if not programacion.puede_editar(p_ciudad) then raise exception 'No tiene permiso en esta ciudad'; end if;
  insert into programacion.alertas_avisos (ciudad_id, fecha, clave, nota, avisado_por)
  values (p_ciudad, p_fecha, p_clave, nullif(trim(p_nota), ''), auth.uid())
  on conflict (ciudad_id, fecha, clave) do update set nota = excluded.nota, avisado_por = excluded.avisado_por, avisado_en = now()
  returning avisado_en into v;
  return v;
end $$;

-- Guardas sugeridos para un puesto y un horario: sin avisos primero, luego quien conoce el puesto,
-- luego quien menos horas lleva en los últimos 7 días.
create or replace function programacion.sugerir_para_franja(p_ciudad text, p_puesto bigint, p_inicio timestamp, p_fin timestamp,
  p_excluir bigint default null, p_limite int default 12)
returns table (empleado_id bigint, nombre text, conoce_el_puesto boolean, horas_7_dias numeric, avisos text[])
language sql stable security definer set search_path = '' as $$
  select x.id, x.nombre, x.conoce, x.horas, x.avisos from (
    select e.id, e.nombre,
      exists (select 1 from programacion.turnos t where t.empleado_id = e.id and t.puesto_id = p_puesto) as conoce,
      coalesce((select round(sum(extract(epoch from (t.fin - t.inicio)) / 3600)::numeric, 1) from programacion.turnos t
                where t.empleado_id = e.id and t.inicio >= p_inicio - interval '7 days' and t.inicio < p_inicio), 0) as horas,
      programacion.validar_turno(e.id, p_inicio, p_fin, null, p_puesto) as avisos
    from programacion.empleados e
    where e.ciudad_id = p_ciudad and e.estado <> 'retirado' and e.id is distinct from p_excluir
      and e.id in (select programacion.empleados_editables())
  ) x
  where not ('cruce' = any(x.avisos)) and not ('tiene_novedad' = any(x.avisos))
  order by cardinality(x.avisos) = 0 desc, x.conoce desc, x.horas asc
  limit p_limite
$$;

-- Agregar un turno para cubrir una franja descubierta.
create or replace function programacion.agregar_turno(p_puesto bigint, p_empleado bigint, p_inicio timestamp, p_fin timestamp, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_av text[]; v_id bigint;
begin
  if not programacion.puede_editar(programacion.ciudad_de_empleado(p_empleado)) then raise exception 'No tiene permiso para programar a este guarda'; end if;
  if p_fin <= p_inicio then raise exception 'La hora de salida debe ser posterior a la de entrada'; end if;
  v_av := programacion.validar_turno(p_empleado, p_inicio, p_fin, null, p_puesto);
  if 'cruce' = any(v_av) then raise exception 'El guarda ya tiene un turno que se cruza con ese horario'; end if;
  if cardinality(v_av) > 0 and coalesce(trim(p_comentario), '') = '' then raise exception 'MOTIVO_REQUERIDO:%', array_to_string(v_av, ','); end if;
  insert into programacion.turnos (empleado_id, puesto_id, inicio, fin, origen, comentario, creado_por)
  values (p_empleado, p_puesto, p_inicio, p_fin, 'apoyo', coalesce(p_comentario, 'Cubre franja descubierta (Alertas del día)'), public.psi_sales_current_profile_id())
  returning id into v_id;
  return jsonb_build_object('turno_id', v_id, 'avisos', v_av);
end $$;

-- Cambiar el guarda de un turno realizado (cuando el actual rompe una regla).
create or replace function programacion.reemplazar_guarda(p_turno bigint, p_empleado bigint, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t programacion.turnos; v_av text[];
begin
  select * into t from programacion.turnos where id = p_turno for update;
  if t.id is null then raise exception 'Turno no encontrado'; end if;
  if not programacion.puede_editar(programacion.ciudad_de_empleado(t.empleado_id)) or not programacion.puede_editar(programacion.ciudad_de_empleado(p_empleado)) then
    raise exception 'No tiene permiso para cambiar este turno';
  end if;
  v_av := programacion.validar_turno(p_empleado, t.inicio, t.fin, t.id, t.puesto_id);
  if 'cruce' = any(v_av) then raise exception 'El guarda ya tiene un turno que se cruza con ese horario'; end if;
  if cardinality(v_av) > 0 and coalesce(trim(p_comentario), '') = '' then raise exception 'MOTIVO_REQUERIDO:%', array_to_string(v_av, ','); end if;
  update programacion.turnos set empleado_id = p_empleado, origen = 'cambio',
    comentario = coalesce(p_comentario, 'Reemplazo desde Alertas del día') where id = t.id;
  return jsonb_build_object('turno_id', t.id, 'avisos', v_av);
end $$;

revoke execute on function programacion.alertas_del_dia(text, date), programacion.avisar_operaciones(text, date, text, text),
  programacion.sugerir_para_franja(text, bigint, timestamp, timestamp, bigint, int), programacion.agregar_turno(bigint, bigint, timestamp, timestamp, text),
  programacion.reemplazar_guarda(bigint, bigint, text) from anon, public;
grant execute on function programacion.alertas_del_dia(text, date), programacion.avisar_operaciones(text, date, text, text),
  programacion.sugerir_para_franja(text, bigint, timestamp, timestamp, bigint, int), programacion.agregar_turno(bigint, bigint, timestamp, timestamp, text),
  programacion.reemplazar_guarda(bigint, bigint, text) to authenticated;
