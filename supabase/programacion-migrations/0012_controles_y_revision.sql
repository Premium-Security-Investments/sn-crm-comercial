-- Controles de descanso y horas máximas (configurables), motivo obligatorio cuando se pasan por
-- alto, reemplazos ordenados por costo y revisión antes del cierre.

alter table programacion.parametros_nomina add column if not exists max_horas_semana numeric(5,1) not null default 60;
alter table programacion.parametros_nomina add column if not exists descanso_minimo_horas numeric(4,1) not null default 8;
comment on column programacion.parametros_nomina.max_horas_semana is
  'Límite de aviso de horas trabajadas en 7 días. 60 h es provisional (mediana real de Pereira en ago-2026); el valor lo define nómina o jurídica.';

-- Parámetros vigentes para un guarda en una fecha.
create or replace function programacion.parametros_de(p_empleado bigint, p_fecha date)
returns programacion.parametros_nomina language sql stable security definer set search_path = '' as $$
  select x.* from programacion.parametros_nomina x
  where (x.ciudad_id = programacion.ciudad_de_empleado(p_empleado) or x.ciudad_id is null) and x.vigente_desde <= p_fecha
  order by (x.ciudad_id is null), x.vigente_desde desc limit 1
$$;

create or replace function programacion.validar_turno(p_empleado bigint, p_inicio timestamp, p_fin timestamp, p_ignorar_turno bigint default null)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare par programacion.parametros_nomina; v_desc interval; v_horas numeric; av text[] := '{}';
begin
  par := programacion.parametros_de(p_empleado, p_inicio::date);
  v_desc := make_interval(mins => (coalesce(par.descanso_minimo_horas, 8) * 60)::int);
  if exists (select 1 from programacion.turnos t where t.empleado_id = p_empleado and t.id is distinct from p_ignorar_turno
             and tsrange(t.inicio, t.fin) && tsrange(p_inicio, p_fin)) then av := array_append(av, 'cruce'::text); end if;
  if exists (select 1 from programacion.turnos t where t.empleado_id = p_empleado and t.id is distinct from p_ignorar_turno
             and not tsrange(t.inicio, t.fin) && tsrange(p_inicio, p_fin)
             and (t.fin > p_inicio - v_desc and t.fin <= p_inicio or t.inicio >= p_fin and t.inicio < p_fin + v_desc)) then
    av := array_append(av, 'descanso_menor_al_minimo'::text);
  end if;
  -- horas en la ventana de 7 días que termina con este turno, contándolo
  select coalesce(sum(extract(epoch from least(t.fin, p_fin) - greatest(t.inicio, p_fin - interval '7 days')) / 3600), 0)
    into v_horas from programacion.turnos t
    where t.empleado_id = p_empleado and t.id is distinct from p_ignorar_turno
      and t.fin > p_fin - interval '7 days' and t.inicio < p_fin;
  if v_horas + extract(epoch from p_fin - p_inicio) / 3600 > coalesce(par.max_horas_semana, 60) then
    av := array_append(av, 'horas_semana_sobre_el_maximo'::text);
  end if;
  if exists (select 1 from programacion.novedades n where n.empleado_id = p_empleado and n.estado <> 'anulada'
             and p_inicio::date between n.desde and n.hasta) then av := array_append(av, 'tiene_novedad'::text); end if;
  if p_fin - p_inicio > interval '16 hours' then av := array_append(av, 'turno_mayor_16h'::text); end if;
  return av;
end $$;

create or replace function programacion.cubrir_turno(p_turno_programado bigint, p_empleado bigint, p_origen text default 'cambio', p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tp programacion.turnos_programados; v_avisos text[]; v_id bigint;
begin
  select * into tp from programacion.turnos_programados where id = p_turno_programado;
  if tp.id is null then raise exception 'Turno programado no encontrado'; end if;
  if not programacion.puede_editar(programacion.ciudad_de_empleado(p_empleado)) then
    raise exception 'No tiene permiso para programar a este guarda';
  end if;
  if exists (select 1 from programacion.turnos where turno_programado_id = p_turno_programado) then
    raise exception 'Ese turno ya está cubierto';
  end if;
  v_avisos := programacion.validar_turno(p_empleado, tp.inicio, tp.fin);
  if 'cruce' = any(v_avisos) then raise exception 'El guarda ya tiene un turno que se cruza con ese horario'; end if;
  if cardinality(v_avisos) > 0 and coalesce(trim(p_comentario), '') = '' then
    raise exception 'MOTIVO_REQUERIDO:%', array_to_string(v_avisos, ',');
  end if;
  insert into programacion.turnos (empleado_id, puesto_id, asignacion_id, inicio, fin, origen, turno_programado_id, comentario, creado_por)
  values (p_empleado, tp.puesto_id, null, tp.inicio, tp.fin, p_origen, tp.id, p_comentario, public.psi_sales_current_profile_id())
  returning id into v_id;
  return jsonb_build_object('turno_id', v_id, 'avisos', v_avisos);
end $$;

create or replace function programacion.cambiar_horario(p_turno bigint, p_inicio timestamp, p_fin timestamp, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t programacion.turnos; v_avisos text[];
begin
  select * into t from programacion.turnos where id = p_turno;
  if t.id is null then raise exception 'Turno no encontrado'; end if;
  if not programacion.puede_editar(programacion.ciudad_de_empleado(t.empleado_id)) then
    raise exception 'No tiene permiso para cambiar este turno';
  end if;
  if p_fin <= p_inicio then raise exception 'La hora de salida debe ser posterior a la de entrada'; end if;
  v_avisos := programacion.validar_turno(t.empleado_id, p_inicio, p_fin, p_turno);
  if 'cruce' = any(v_avisos) then raise exception 'El guarda ya tiene un turno que se cruza con ese horario'; end if;
  if cardinality(v_avisos) > 0 and coalesce(trim(p_comentario), '') = '' then
    raise exception 'MOTIVO_REQUERIDO:%', array_to_string(v_avisos, ',');
  end if;
  update programacion.turnos set inicio = p_inicio, fin = p_fin,
    origen = case when origen = 'plantilla' then 'cambio' else origen end,
    comentario = coalesce(p_comentario, comentario)
  where id = p_turno;
  return jsonb_build_object('turno_id', p_turno, 'avisos', v_avisos);
end $$;

-- Reemplazos ordenados: sin avisos, conoce el puesto, menos horas extra estimadas, menos horas.
drop function if exists programacion.sugerir_reemplazos(bigint, int);
create function programacion.sugerir_reemplazos(p_turno_programado bigint, p_limite int default 12)
returns table (empleado_id bigint, nombre text, conoce_el_puesto boolean, horas_en_periodo numeric, horas_extra_estimadas numeric, avisos text[])
language sql stable security definer set search_path = '' as $$
  with tp as (select * from programacion.turnos_programados where id = p_turno_programado),
  per as (select p.* from programacion.periodos p, tp where p.id = tp.periodo_id),
  par as (select programacion.parametros_de(tp.empleado_id, tp.inicio::date) as x from tp),
  exigidas as (  -- horas exigidas del periodo: días hábiles (sin domingos ni festivos) × jornada diaria
    select (select count(*) from generate_series(per.inicio, per.fin, interval '1 day') d
            where extract(isodow from d) <> 7 and not exists (select 1 from programacion.festivos f where f.fecha = d::date))
           * (select (x).jornada_semanal / 6.0 from par) as h
    from per
  ),
  cand as (
    select e.id, e.nombre from programacion.empleados e, tp
    where e.ciudad_id = programacion.ciudad_de_empleado(tp.empleado_id)
      and e.estado <> 'retirado' and e.id <> tp.empleado_id
      and e.id in (select programacion.empleados_editables())
  )
  select x.id, x.nombre, x.conoce, x.horas,
    greatest(0, round(x.horas + extract(epoch from tp.fin - tp.inicio) / 3600 - (select h from exigidas), 1)), x.avisos
  from (
    select c.id, c.nombre,
      exists (select 1 from programacion.turnos t, tp where t.empleado_id = c.id and t.puesto_id = tp.puesto_id) as conoce,
      coalesce((select round(sum(extract(epoch from (t.fin - t.inicio)) / 3600)::numeric, 1) from programacion.turnos t, per
                where t.empleado_id = c.id and t.inicio::date between per.inicio and per.fin), 0) as horas,
      programacion.validar_turno(c.id, tp.inicio, tp.fin) as avisos
    from cand c, tp
  ) x, tp
  where not ('cruce' = any(x.avisos)) and not ('tiene_novedad' = any(x.avisos))
  order by cardinality(x.avisos) = 0 desc, x.conoce desc,
    greatest(0, x.horas + extract(epoch from tp.fin - tp.inicio) / 3600 - (select h from exigidas)) asc, x.horas asc
  limit p_limite
$$;

-- Revisión antes del cierre: lista de chequeo con conteos y ejemplos.
create or replace function programacion.revision_cierre(p_periodo bigint)
returns table (control text, cantidad int, ejemplos jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare per programacion.periodos; par programacion.parametros_nomina;
begin
  select * into per from programacion.periodos where id = p_periodo;
  if per.id is null or not programacion.puede_ver(per.ciudad_id) then return; end if;
  select x.* into par from programacion.parametros_nomina x where x.id = per.parametros_id;

  return query
  with tur as (
    select t.*, e.nombre from programacion.turnos t join programacion.empleados e on e.id = t.empleado_id
    where e.ciudad_id = per.ciudad_id and t.inicio::date between per.inicio and per.fin
  ), sin_cubrir as (
    select tp.inicio, e.nombre, pu.nombre puesto from programacion.turnos_programados tp
    join programacion.empleados e on e.id = tp.empleado_id left join programacion.puestos pu on pu.id = tp.puesto_id
    where tp.periodo_id = per.id and not exists (select 1 from programacion.turnos t where t.turno_programado_id = tp.id)
      and not exists (select 1 from programacion.novedades n where n.empleado_id = tp.empleado_id and tp.inicio::date between n.desde and n.hasta
                      and n.tipo in ('retiro', 'no_vinculado', 'fuera_de_corte'))
  ), cruces as (
    select a.nombre, a.inicio from tur a join tur b on a.empleado_id = b.empleado_id and a.id < b.id
      and tsrange(a.inicio, a.fin) && tsrange(b.inicio, b.fin)
  ), semanas as (
    select t.nombre, date_trunc('week', t.inicio)::date semana, sum(extract(epoch from t.fin - t.inicio) / 3600) horas
    from tur t group by t.empleado_id, t.nombre, 2
    having sum(extract(epoch from t.fin - t.inicio) / 3600) > coalesce(par.max_horas_semana, 60)
  ), largos as (
    select nombre, inicio, extract(epoch from fin - inicio) / 3600 horas from tur where fin - inicio > interval '16 hours'
  ), sin_aprobar as (
    select n.tipo, n.desde, e.nombre from programacion.novedades n join programacion.empleados e on e.id = n.empleado_id
    where e.ciudad_id = per.ciudad_id and n.estado = 'registrada' and n.desde <= per.fin and n.hasta >= per.inicio
  ), vacios as (
    select e.nombre from programacion.asignaciones a join programacion.empleados e on e.id = a.empleado_id
    where a.desde <= per.fin and coalesce(a.hasta, per.fin) >= per.inicio and e.ciudad_id = per.ciudad_id
      and not exists (select 1 from tur t where t.empleado_id = a.empleado_id)
      and not exists (select 1 from programacion.novedades n where n.empleado_id = a.empleado_id and n.desde <= per.fin and n.hasta >= per.inicio)
  )
  select 'Turnos programados que nadie cubrió (sin novedad que lo explique)', (select count(*)::int from sin_cubrir),
         (select coalesce(jsonb_agg(jsonb_build_object('guarda', nombre, 'puesto', puesto, 'fecha', inicio) order by inicio), '[]') from (select * from sin_cubrir order by inicio limit 30) x)
  union all
  select 'Guardas con turnos que se cruzan', (select count(*)::int from cruces),
         (select coalesce(jsonb_agg(jsonb_build_object('guarda', nombre, 'fecha', inicio)), '[]') from (select * from cruces limit 30) x)
  union all
  select format('Semanas con más de %s horas', coalesce(par.max_horas_semana, 60)), (select count(*)::int from semanas),
         (select coalesce(jsonb_agg(jsonb_build_object('guarda', nombre, 'semana', semana, 'horas', round(horas::numeric, 1)) order by horas desc), '[]') from (select * from semanas order by horas desc limit 30) x)
  union all
  select 'Turnos de más de 16 horas', (select count(*)::int from largos),
         (select coalesce(jsonb_agg(jsonb_build_object('guarda', nombre, 'fecha', inicio, 'horas', round(horas::numeric, 1))), '[]') from (select * from largos limit 30) x)
  union all
  select 'Novedades registradas sin aprobar', (select count(*)::int from sin_aprobar),
         (select coalesce(jsonb_agg(jsonb_build_object('guarda', nombre, 'tipo', tipo, 'desde', desde)), '[]') from (select * from sin_aprobar limit 30) x)
  union all
  select 'Guardas asignados sin turnos ni novedades en el periodo', (select count(*)::int from vacios),
         (select coalesce(jsonb_agg(jsonb_build_object('guarda', nombre)), '[]') from (select * from vacios limit 30) x);
end $$;

-- Aprobar novedades registradas (coordinador o admin de la ciudad).
create or replace function programacion.aprobar_novedad(p_novedad bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not programacion.puede_editar(programacion.ciudad_de_empleado((select empleado_id from programacion.novedades where id = p_novedad))) then
    raise exception 'No tiene permiso para aprobar esta novedad';
  end if;
  update programacion.novedades set estado = 'aprobada' where id = p_novedad;
end $$;

revoke execute on function programacion.parametros_de(bigint, date), programacion.sugerir_reemplazos(bigint, int),
  programacion.revision_cierre(bigint), programacion.aprobar_novedad(bigint) from anon, public;
grant execute on function programacion.sugerir_reemplazos(bigint, int), programacion.revision_cierre(bigint),
  programacion.aprobar_novedad(bigint), programacion.validar_turno(bigint, timestamp, timestamp, bigint) to authenticated;
