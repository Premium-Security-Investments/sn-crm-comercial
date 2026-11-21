-- Reportes del supervisor y horario de Programación (decisiones de Juan, 2026-10-17).
-- En el día a día el supervisor avisa que un turno se cae (falta, llega tarde, no marcó, no respondió
-- en la noche) y el programador escoge al reemplazo. Fuera del horario de Programación lo resuelve el
-- supervisor, lo registra en SecurityOps y llega a Novedades como "resuelto por el supervisor".
--   · horario_atencion     → por ciudad (L–V 7:00–17:00 por defecto) y minutos de respaldo (30);
--   · alertas_reportadas   → lo que reporta el supervisor; aparece en Alertas del día. Mientras
--                            SecurityOps no lo envíe solo, el programador lo registra a mano;
--   · responsable          → Programación en horario; si nadie la toma en los minutos de respaldo,
--                            también el supervisor; fuera de horario, el supervisor.
-- El aviso al guarda que cubre sigue siendo a mano (llamada o WhatsApp) hasta tener WhatsApp.

create table if not exists programacion.horario_atencion (
  ciudad_id         text primary key references programacion.ciudades(id),
  dias              smallint[] not null default '{1,2,3,4,5}',   -- 1 = lunes … 7 = domingo
  desde             time not null default '07:00',
  hasta             time not null default '17:00',
  atiende_festivos  boolean not null default false,
  minutos_respaldo  int not null default 30 check (minutos_respaldo between 5 and 240),
  actualizado_por   uuid,
  actualizado_en    timestamptz not null default now(),
  check (hasta > desde),
  check (dias <@ '{1,2,3,4,5,6,7}'::smallint[])
);
insert into programacion.horario_atencion (ciudad_id) select id from programacion.ciudades on conflict do nothing;
alter table programacion.horario_atencion enable row level security;
grant select on programacion.horario_atencion to authenticated;
create policy ver on programacion.horario_atencion for select to authenticated using (programacion.puede_ver(ciudad_id));
create trigger historial_horario_atencion after insert or update or delete on programacion.horario_atencion
  for each row execute function programacion.registrar_historial();

-- Hora de Colombia (los turnos se guardan en hora local).
create or replace function programacion.ahora_local()
returns timestamp language sql stable set search_path = '' as $$ select (now() at time zone 'America/Bogota')::timestamp $$;

-- ¿Programación atiende a esa hora en esa ciudad? Sin fila, vale el horario por defecto.
create or replace function programacion.en_horario(p_ciudad text, p_ts timestamp)
returns boolean language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_ts)::smallint = any(h.dias) and p_ts::time >= h.desde and p_ts::time < h.hasta
    and (h.atiende_festivos or not exists (select 1 from programacion.festivos f where f.fecha = p_ts::date))
  from (select coalesce(x.dias, '{1,2,3,4,5}') as dias, coalesce(x.desde, '07:00') as desde, coalesce(x.hasta, '17:00') as hasta,
               coalesce(x.atiende_festivos, false) as atiende_festivos
        from (select 1) uno left join programacion.horario_atencion x on x.ciudad_id = p_ciudad) h
$$;

create or replace function programacion.guardar_horario_atencion(p_ciudad text, p_dias smallint[], p_desde time, p_hasta time,
  p_atiende_festivos boolean default false, p_minutos_respaldo int default 30)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not programacion.es_admin() then raise exception 'Solo el administrador cambia el horario de Programación'; end if;
  if cardinality(coalesce(p_dias, '{}')) = 0 then raise exception 'Escoja al menos un día'; end if;
  insert into programacion.horario_atencion (ciudad_id, dias, desde, hasta, atiende_festivos, minutos_respaldo, actualizado_por, actualizado_en)
  values (p_ciudad, p_dias, p_desde, p_hasta, p_atiende_festivos, p_minutos_respaldo, auth.uid(), now())
  on conflict (ciudad_id) do update set dias = excluded.dias, desde = excluded.desde, hasta = excluded.hasta,
    atiende_festivos = excluded.atiende_festivos, minutos_respaldo = excluded.minutos_respaldo,
    actualizado_por = excluded.actualizado_por, actualizado_en = now();
end $$;

create table if not exists programacion.alertas_reportadas (
  id                     bigint generated always as identity primary key,
  ciudad_id              text not null references programacion.ciudades(id),
  tipo                   text not null check (tipo in ('turno_por_cubrir', 'no_marco', 'no_respondio', 'otro')),
  documento              text,                                   -- cédula del guarda afectado
  empleado_id            bigint references programacion.empleados(id),
  puesto_id              bigint references programacion.puestos(id),
  desde                  timestamp not null,
  hasta                  timestamp,
  detalle                text,
  origen                 text not null default 'manual' check (origen in ('manual', 'securityops')),
  id_externo             text,                                   -- número del reporte en SecurityOps
  reportado_por          text,
  estado                 text not null default 'abierta' check (estado in ('abierta', 'tomada', 'resuelta', 'cerrada')),
  tomada_por             uuid,
  tomada_en              timestamptz,
  reemplazo_empleado_id  bigint references programacion.empleados(id),
  turno_id               bigint,
  nota                   text,
  resuelta_por           uuid,
  resuelta_en            timestamptz,
  creado_por             uuid,
  creado_en              timestamptz not null default now(),
  check (hasta is null or hasta > desde)
);
create unique index if not exists alertas_reportadas_id_externo on programacion.alertas_reportadas (origen, id_externo) where id_externo is not null;
create index if not exists alertas_reportadas_dia on programacion.alertas_reportadas (ciudad_id, desde);
alter table programacion.alertas_reportadas enable row level security;
grant select on programacion.alertas_reportadas to authenticated;
create policy ver on programacion.alertas_reportadas for select to authenticated using (programacion.puede_ver(ciudad_id));
create trigger historial_alertas_reportadas after insert or update or delete on programacion.alertas_reportadas
  for each row execute function programacion.registrar_historial();
comment on table programacion.alertas_reportadas is
  'Reportes del supervisor (turno por cubrir, no marcó, no respondió). Programación escoge el reemplazo en horario; fuera de horario, el supervisor.';

-- Registrar un reporte. Lo usa Programación (a mano) y, más adelante, SecurityOps con su credencial
-- de servidor y el número del reporte (sin duplicar). Si no se indica puesto u hora de fin, se toman
-- del turno que el guarda tenía a esa hora.
create or replace function programacion.registrar_alerta_reportada(p_ciudad text, p_tipo text, p_documento text, p_desde timestamp,
  p_hasta timestamp default null, p_puesto bigint default null, p_detalle text default null, p_origen text default 'manual',
  p_id_externo text default null, p_reportado_por text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_emp bigint; t programacion.turnos;
begin
  if not programacion.puede_editar(p_ciudad) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No tiene permiso para registrar reportes en esta ciudad';
  end if;
  if p_tipo not in ('turno_por_cubrir', 'no_marco', 'no_respondio', 'otro') then raise exception 'Tipo de reporte no válido'; end if;
  if p_desde is null then raise exception 'Indique la fecha y la hora'; end if;
  if p_id_externo is not null then
    select id into v_id from programacion.alertas_reportadas where origen = p_origen and id_externo = p_id_externo;
    if v_id is not null then return v_id; end if;
  end if;
  v_emp := programacion.empleado_por_documento(p_documento);
  if v_emp is null and p_puesto is null then raise exception 'Indique la cédula de un guarda que esté en Programación o el puesto'; end if;
  if v_emp is not null then
    select * into t from programacion.turnos where empleado_id = v_emp and inicio <= p_desde + interval '2 hours' and fin > p_desde
      and (p_puesto is null or puesto_id = p_puesto) order by abs(extract(epoch from (inicio - p_desde))) limit 1;
  end if;
  if coalesce(p_hasta, t.fin) is null then raise exception 'El guarda no tenía turno a esa hora: indique hasta qué hora hay que cubrir'; end if;
  if coalesce(p_puesto, t.puesto_id) is null then raise exception 'Indique el puesto'; end if;
  insert into programacion.alertas_reportadas (ciudad_id, tipo, documento, empleado_id, puesto_id, desde, hasta, detalle, origen, id_externo,
    reportado_por, creado_por)
  values (p_ciudad, p_tipo, nullif(trim(p_documento), ''), v_emp, coalesce(p_puesto, t.puesto_id), p_desde, coalesce(p_hasta, t.fin),
    nullif(trim(p_detalle), ''), p_origen, p_id_externo, nullif(trim(p_reportado_por), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- El programador toma el reporte (así se sabe que alguien lo está atendiendo y no corre el respaldo).
create or replace function programacion.tomar_alerta_reportada(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare r programacion.alertas_reportadas;
begin
  select * into r from programacion.alertas_reportadas where id = p_id for update;
  if r.id is null then raise exception 'Reporte no encontrado'; end if;
  if not programacion.puede_editar(r.ciudad_id) then raise exception 'No tiene permiso en esta ciudad'; end if;
  if r.estado <> 'abierta' then raise exception 'El reporte ya fue tomado o resuelto'; end if;
  update programacion.alertas_reportadas set estado = 'tomada', tomada_por = public.psi_sales_current_profile_id(), tomada_en = now() where id = r.id;
end $$;

-- Resolver con un reemplazo: si el guarda reportado tenía turno en esa franja, el turno pasa al
-- reemplazo; si no, se agrega un turno de apoyo en el puesto.
create or replace function programacion.resolver_alerta_reportada(p_id bigint, p_empleado bigint, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r programacion.alertas_reportadas; t programacion.turnos; v_av text[]; v_turno bigint;
begin
  select * into r from programacion.alertas_reportadas where id = p_id for update;
  if r.id is null then raise exception 'Reporte no encontrado'; end if;
  if not programacion.puede_editar(r.ciudad_id) or not programacion.puede_editar(programacion.ciudad_de_empleado(p_empleado)) then
    raise exception 'No tiene permiso para resolver este reporte';
  end if;
  if r.estado in ('resuelta', 'cerrada') then raise exception 'El reporte ya fue resuelto'; end if;
  if r.empleado_id is not null then
    select * into t from programacion.turnos where empleado_id = r.empleado_id and inicio < r.hasta and fin > r.desde
      and (r.puesto_id is null or puesto_id = r.puesto_id) order by inicio limit 1 for update;
  end if;
  if t.id is not null then
    v_av := programacion.validar_turno(p_empleado, t.inicio, t.fin, t.id, t.puesto_id);
  else
    v_av := programacion.validar_turno(p_empleado, r.desde, r.hasta, null, r.puesto_id);
  end if;
  if 'cruce' = any(v_av) then raise exception 'El guarda ya tiene un turno que se cruza con ese horario'; end if;
  if cardinality(v_av) > 0 and coalesce(trim(p_comentario), '') = '' then raise exception 'MOTIVO_REQUERIDO:%', array_to_string(v_av, ','); end if;
  if t.id is not null then
    update programacion.turnos set empleado_id = p_empleado, origen = 'cambio',
      comentario = coalesce(p_comentario, 'Reemplazo por reporte ' || r.id || ' (Alertas del día)') where id = t.id;
    v_turno := t.id;
  else
    insert into programacion.turnos (empleado_id, puesto_id, inicio, fin, origen, comentario, creado_por)
    values (p_empleado, r.puesto_id, r.desde, r.hasta, 'apoyo', coalesce(p_comentario, 'Cubre por reporte ' || r.id || ' (Alertas del día)'),
      public.psi_sales_current_profile_id())
    returning id into v_turno;
  end if;
  update programacion.alertas_reportadas set estado = 'resuelta', reemplazo_empleado_id = p_empleado, turno_id = v_turno,
    nota = nullif(trim(p_comentario), ''), resuelta_por = public.psi_sales_current_profile_id(), resuelta_en = now(),
    tomada_por = coalesce(tomada_por, public.psi_sales_current_profile_id()), tomada_en = coalesce(tomada_en, now())
  where id = r.id;
  return jsonb_build_object('turno_id', v_turno, 'avisos', v_av, 'movido', t.id is not null);
end $$;

-- Cerrar sin reemplazo (p. ej. el guarda llegó tarde y ya está en el puesto). Exige nota.
create or replace function programacion.cerrar_alerta_reportada(p_id bigint, p_nota text)
returns void language plpgsql security definer set search_path = '' as $$
declare r programacion.alertas_reportadas;
begin
  select * into r from programacion.alertas_reportadas where id = p_id for update;
  if r.id is null then raise exception 'Reporte no encontrado'; end if;
  if not programacion.puede_editar(r.ciudad_id) then raise exception 'No tiene permiso en esta ciudad'; end if;
  if r.estado in ('resuelta', 'cerrada') then raise exception 'El reporte ya fue resuelto'; end if;
  if coalesce(trim(p_nota), '') = '' then raise exception 'Escriba por qué se cierra sin reemplazo'; end if;
  update programacion.alertas_reportadas set estado = 'cerrada', nota = trim(p_nota), resuelta_por = public.psi_sales_current_profile_id(),
    resuelta_en = now(), tomada_por = coalesce(tomada_por, public.psi_sales_current_profile_id()), tomada_en = coalesce(tomada_en, now())
  where id = r.id;
end $$;

-- Quién debe atender un reporte abierto ahora mismo.
create or replace function programacion.responsable_reporte(p_ciudad text, p_estado text, p_creado timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_estado in ('resuelta', 'cerrada') then 'cerrada'
    when not programacion.en_horario(p_ciudad, programacion.ahora_local()) then 'supervisor'
    when p_estado = 'abierta' and programacion.ahora_local() > greatest((p_creado at time zone 'America/Bogota')::timestamp,
           programacion.ahora_local()::date + coalesce(h.desde, '07:00')) + make_interval(mins => coalesce(h.minutos_respaldo, 30)) then 'respaldo'
    else 'programacion' end
  from (select 1) uno left join programacion.horario_atencion h on h.ciudad_id = p_ciudad
$$;

-- Alertas del día: se agregan los reportes del supervisor (columna "reporte" con su estado y responsable).
drop function if exists programacion.alertas_del_dia(text, date);
create function programacion.alertas_del_dia(p_ciudad text, p_fecha date)
returns table (clave text, tipo text, puesto_id bigint, puesto text, desde timestamp, hasta timestamp,
               empleado_id bigint, empleado text, detalle text, turno_programado_id bigint, turno_id bigint,
               solicitud_id bigint, avisos text[], avisado_en timestamptz, nota text, reporte jsonb)
language sql stable security definer set search_path = '' as $$
  with dia as (select * from programacion.turnos_del_dia(p_fecha, p_ciudad)),
  sin as (
    select 'sin_cubrir:' || d.turno_programado_id as clave, 'sin_cubrir'::text as tipo, d.puesto_id, d.puesto,
      d.programado_inicio as desde, d.programado_fin as hasta, d.programado_empleado_id as empleado_id, d.programado_nombre as empleado,
      d.novedad as detalle, d.turno_programado_id, null::bigint as turno_id, null::bigint as solicitud_id, null::text[] as avisos,
      null::jsonb as reporte
    from dia d where d.estado = 'sin_cubrir'
  ),
  descubierto as (
    select 'descubierto:' || c.puesto_id || ':' || (b->>'desde'), 'descubierto'::text, c.puesto_id, c.puesto,
      (b->>'desde')::timestamp, (b->>'hasta')::timestamp, null::bigint, null::text,
      'Faltan ' || (b->>'faltan') || ' guarda(s) frente a lo contratado' || coalesce(' · ' || c.cliente, ''),
      null::bigint, null::bigint, null::bigint, null::text[], null::jsonb
    from programacion.cobertura_dia(p_ciudad, p_fecha) c
    cross join lateral jsonb_array_elements(c.descubierto) b
    where not exists (select 1 from sin where sin.puesto_id = c.puesto_id)
  ),
  regla as (
    select 'regla:' || t.id, 'regla'::text, t.puesto_id, pu.nombre, t.inicio, t.fin, t.empleado_id, e.nombre,
      null::text, t.turno_programado_id, t.id, null::bigint, av.avisos, null::jsonb
    from programacion.turnos t
    join programacion.empleados e on e.id = t.empleado_id
    left join programacion.puestos pu on pu.id = t.puesto_id
    cross join lateral (select programacion.validar_turno(t.empleado_id, t.inicio, t.fin, t.id, t.puesto_id) as avisos) av
    where e.ciudad_id = p_ciudad and t.inicio::date = p_fecha and programacion.puede_ver(p_ciudad) and cardinality(av.avisos) > 0
  ),
  devuelta as (
    select 'devuelta:' || s.id, 'devuelta'::text, null::bigint, null::text, s.desde::timestamp, (coalesce(s.hasta, s.desde) + 1)::timestamp,
      s.empleado_id, coalesce(e.nombre, 'Cédula ' || s.documento), s.motivo, null::bigint, null::bigint, s.id, null::text[], null::jsonb
    from programacion.solicitudes s left join programacion.empleados e on e.id = s.empleado_id
    where s.ciudad_id = p_ciudad and s.estado = 'devuelta' and programacion.puede_ver(p_ciudad)
      and p_fecha between s.desde and coalesce(s.hasta, s.desde)
  ),
  reportada as (
    select 'reporte:' || r.id as clave, 'reportada'::text as tipo, r.puesto_id, pu.nombre as puesto, r.desde, r.hasta, r.empleado_id,
      coalesce(e.nombre, case when r.documento is not null then 'Cédula ' || r.documento end) as empleado, r.detalle,
      null::bigint as turno_programado_id, r.turno_id, null::bigint as solicitud_id, null::text[] as avisos,
      jsonb_build_object('id', r.id, 'tipo', r.tipo, 'estado', r.estado, 'origen', r.origen, 'id_externo', r.id_externo,
        'reportado_por', r.reportado_por, 'creado_en', r.creado_en, 'tomada_en', r.tomada_en, 'tomada_por', pt.full_name,
        'resuelta_en', r.resuelta_en, 'reemplazo', er.nombre, 'nota', r.nota,
        'responsable', programacion.responsable_reporte(r.ciudad_id, r.estado, r.creado_en)) as reporte
    from programacion.alertas_reportadas r
    left join programacion.empleados e on e.id = r.empleado_id
    left join programacion.empleados er on er.id = r.reemplazo_empleado_id
    left join programacion.puestos pu on pu.id = r.puesto_id
    left join public.psi_sales_profiles pt on pt.id = r.tomada_por
    where r.ciudad_id = p_ciudad and programacion.puede_ver(p_ciudad)
      and p_fecha between r.desde::date and coalesce(r.hasta, r.desde)::date
  ),
  todas as (select * from reportada union all select * from sin union all select * from descubierto union all select * from regla union all select * from devuelta)
  select x.clave, x.tipo, x.puesto_id, x.puesto, x.desde, x.hasta, x.empleado_id, x.empleado, x.detalle, x.turno_programado_id, x.turno_id,
    x.solicitud_id, x.avisos, a.avisado_en, a.nota, x.reporte
  from todas x
  left join programacion.alertas_avisos a on a.ciudad_id = p_ciudad and a.fecha = p_fecha and a.clave = x.clave
  order by case when x.reporte->>'estado' in ('resuelta', 'cerrada') then 9
                else case x.tipo when 'reportada' then 0 when 'sin_cubrir' then 1 when 'descubierto' then 2 when 'regla' then 3 else 4 end end,
    x.desde, x.puesto
$$;

-- Novedades: marca de "resuelto por el supervisor" (lo que se resolvió cuando Programación no estaba).
alter table programacion.solicitudes add column if not exists resuelto_por_supervisor boolean not null default false;

drop function if exists programacion.registrar_novedad_reportada(text, text, text, text, date, date, text, timestamp, timestamp, bigint, text, text, text, text, text);
create function programacion.registrar_novedad_reportada(
  p_ciudad text, p_tipo text, p_documento text, p_subtipo text default null, p_desde date default null, p_hasta date default null,
  p_documento_destino text default null, p_cubre_inicio timestamp default null, p_cubre_fin timestamp default null,
  p_turno bigint default null, p_detalle text default null, p_canal text default 'llamada', p_origen text default 'manual',
  p_id_externo text default null, p_reportado_por text default null, p_resuelto_por_supervisor boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_emp bigint; v_dest bigint;
begin
  if not programacion.puede_editar(p_ciudad) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No tiene permiso para registrar novedades en esta ciudad';
  end if;
  if coalesce(trim(p_documento), '') = '' then raise exception 'Indique la cédula del guarda'; end if;
  if p_tipo not in ('novedad', 'llegada_tarde', 'ceder_turno', 'otro') then raise exception 'Tipo de novedad no válido'; end if;
  if p_tipo <> 'ceder_turno' and p_desde is null then raise exception 'Indique la fecha'; end if;
  if p_id_externo is not null then
    select id into v_id from programacion.solicitudes where origen = p_origen and id_externo = p_id_externo;
    if v_id is not null then return v_id; end if;
  end if;
  v_emp := programacion.empleado_por_documento(p_documento);
  v_dest := programacion.empleado_por_documento(p_documento_destino);
  insert into programacion.solicitudes (ciudad_id, empleado_id, tipo, subtipo, desde, hasta, turno_id, empleado_destino_id,
    detalle, canal, origen, id_externo, documento, documento_destino, cubre_inicio, cubre_fin, reportado_por, resuelto_por_supervisor, creado_por)
  values (p_ciudad, v_emp, p_tipo, case when p_tipo = 'novedad' then p_subtipo end, p_desde, coalesce(p_hasta, p_desde), p_turno, v_dest,
    nullif(trim(p_detalle), ''), p_canal, p_origen, p_id_externo, trim(p_documento), nullif(trim(p_documento_destino), ''),
    p_cubre_inicio, p_cubre_fin, nullif(trim(p_reportado_por), ''), coalesce(p_resuelto_por_supervisor, false), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function programacion.ahora_local(), programacion.en_horario(text, timestamp),
  programacion.guardar_horario_atencion(text, smallint[], time, time, boolean, int),
  programacion.registrar_alerta_reportada(text, text, text, timestamp, timestamp, bigint, text, text, text, text),
  programacion.tomar_alerta_reportada(bigint), programacion.resolver_alerta_reportada(bigint, bigint, text),
  programacion.cerrar_alerta_reportada(bigint, text), programacion.responsable_reporte(text, text, timestamptz),
  programacion.alertas_del_dia(text, date),
  programacion.registrar_novedad_reportada(text, text, text, text, date, date, text, timestamp, timestamp, bigint, text, text, text, text, text, boolean)
from anon, public;
grant execute on function programacion.en_horario(text, timestamp),
  programacion.guardar_horario_atencion(text, smallint[], time, time, boolean, int),
  programacion.registrar_alerta_reportada(text, text, text, timestamp, timestamp, bigint, text, text, text, text),
  programacion.tomar_alerta_reportada(bigint), programacion.resolver_alerta_reportada(bigint, bigint, text),
  programacion.cerrar_alerta_reportada(bigint, text), programacion.alertas_del_dia(text, date),
  programacion.registrar_novedad_reportada(text, text, text, text, date, date, text, timestamp, timestamp, bigint, text, text, text, text, text, boolean)
to authenticated;
grant execute on function programacion.registrar_alerta_reportada(text, text, text, timestamp, timestamp, bigint, text, text, text, text),
  programacion.registrar_novedad_reportada(text, text, text, text, date, date, text, timestamp, timestamp, bigint, text, text, text, text, text, boolean)
to service_role;
