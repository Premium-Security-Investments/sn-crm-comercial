-- Programar a mano a los guardas que no tienen turnos en un periodo abierto
-- (sin turno tipo o con plan mensual): copiar el plan del periodo anterior respetando el día
-- de la semana, o asignarles un turno tipo.

-- Asignaciones del periodo sin ningún turno programado.
create or replace function programacion.pendientes_de_programar(p_periodo bigint)
returns table (asignacion_id bigint, empleado_id bigint, empleado text, puesto_id bigint, puesto text,
               patron text, motivo text, turnos_mes_anterior int)
language sql stable security definer set search_path = '' as $$
  with per as (select * from programacion.periodos where id = p_periodo),
  asig as (
    select a.* from programacion.asignaciones a
    join programacion.empleados e on e.id = a.empleado_id
    cross join per
    where e.ciudad_id = per.ciudad_id
      and a.desde = per.inicio and a.hasta = per.fin
      and a.empleado_id in (select programacion.empleados_visibles())
      and not exists (select 1 from programacion.turnos_programados tp where tp.asignacion_id = a.id)
  ),
  anterior as (  -- última asignación de cada guarda antes del periodo
    select distinct on (x.empleado_id) x.empleado_id, x.id
    from programacion.asignaciones x, per
    where x.hasta < per.inicio and x.empleado_id in (select empleado_id from asig)
    order by x.empleado_id, x.hasta desc
  ),
  conteo as (
    select an.empleado_id, count(t.id)::int as n
    from anterior an left join programacion.turnos t on t.asignacion_id = an.id
    group by an.empleado_id
  )
  select a.id, a.empleado_id, e.nombre, a.puesto_id, pu.nombre, pt.codigo,
    case when a.patron_id is null then 'sin_turno_tipo' else 'plan_mensual' end,
    coalesce(c.n, 0)
  from asig a
  join programacion.empleados e on e.id = a.empleado_id
  left join programacion.puestos pu on pu.id = a.puesto_id
  left join programacion.patrones_turno pt on pt.id = a.patron_id
  left join conteo c on c.empleado_id = a.empleado_id
  order by pu.nombre, e.nombre
$$;
create index if not exists asignaciones_empleado_hasta on programacion.asignaciones (empleado_id, hasta);
create index if not exists turnos_asignacion on programacion.turnos (asignacion_id);
create index if not exists turnos_programados_asignacion on programacion.turnos_programados (asignacion_id);

-- Copia el plan del periodo anterior a las asignaciones indicadas (deben estar sin turnos).
-- Cada día nuevo toma el mismo día de la semana del periodo anterior (desfase en semanas
-- completas). Fuente: lo programado si había plan mensual; si no, lo realizado.
create or replace function programacion.copiar_plan_anterior(p_asignaciones bigint[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a programacion.asignaciones; per programacion.periodos; ant programacion.asignaciones; ant_per_ini date; ant_per_fin date;
  v_desfase int; v_ok int := 0; v_sin_fuente int := 0; v_ya int := 0; v_turnos int := 0; n int;
begin
  for a in select * from programacion.asignaciones where id = any(p_asignaciones) loop
    if not programacion.puede_editar(programacion.ciudad_de_empleado(a.empleado_id)) then
      raise exception 'No tiene permiso para programar a uno de los guardas';
    end if;
    select * into per from programacion.periodos p
      where p.ciudad_id = programacion.ciudad_de_empleado(a.empleado_id) and a.desde between p.inicio and p.fin;
    if per.estado <> 'abierto' then raise exception 'El periodo % a % no está abierto', per.inicio, per.fin; end if;
    if exists (select 1 from programacion.turnos_programados where asignacion_id = a.id) then v_ya := v_ya + 1; continue; end if;
    select * into ant from programacion.asignaciones x
      where x.empleado_id = a.empleado_id and x.hasta < a.desde order by x.hasta desc, (x.puesto_id = a.puesto_id) desc limit 1;
    if ant.id is null then v_sin_fuente := v_sin_fuente + 1; continue; end if;
    ant_per_ini := ant.desde; ant_per_fin := ant.hasta;
    v_desfase := round((a.desde - ant_per_ini) / 7.0)::int * 7;

    create temp table if not exists _fuente (inicio timestamp, fin timestamp) on commit drop;
    truncate _fuente;
    if exists (select 1 from programacion.turnos_programados where asignacion_id = ant.id)
       and exists (select 1 from programacion.patrones_turno p where p.id = ant.patron_id and p.tipo = 'plan_mensual') then
      insert into _fuente select inicio, fin from programacion.turnos_programados where asignacion_id = ant.id;
    else
      insert into _fuente select inicio, fin from programacion.turnos where asignacion_id = ant.id;
    end if;
    if not exists (select 1 from _fuente) then v_sin_fuente := v_sin_fuente + 1; continue; end if;

    with dias as (
      select d::date as fecha from generate_series(a.desde, a.hasta, interval '1 day') d
    ), origen as (
      -- primer día equivalente (mismo día de la semana) que caiga dentro del periodo anterior
      select dias.fecha,
        (select o from unnest(array[dias.fecha - v_desfase, dias.fecha - v_desfase - 7, dias.fecha - v_desfase + 7,
                                    dias.fecha - v_desfase - 14, dias.fecha - v_desfase + 14]) o
         where o between ant_per_ini and ant_per_fin limit 1) as fuente
      from dias
    ), nuevos as (
      select f.inicio + (o.fecha - o.fuente) * interval '1 day' as inicio, f.fin + (o.fecha - o.fuente) * interval '1 day' as fin
      from origen o join _fuente f on f.inicio::date = o.fuente
    ), prog as (
      insert into programacion.turnos_programados (empleado_id, puesto_id, asignacion_id, periodo_id, inicio, fin, origen, creado_por)
      select a.empleado_id, a.puesto_id, a.id, per.id, nv.inicio, nv.fin, 'manual', public.psi_sales_current_profile_id() from nuevos nv
      returning *
    ), rea as (
      insert into programacion.turnos (empleado_id, puesto_id, asignacion_id, inicio, fin, origen, turno_programado_id, creado_por)
      select empleado_id, puesto_id, asignacion_id, inicio, fin, 'plantilla', id, creado_por from prog
      returning 1
    ) select count(*) into n from rea;
    v_turnos := v_turnos + n;
    v_ok := v_ok + 1;
  end loop;
  return jsonb_build_object('guardas_programados', v_ok, 'turnos_creados', v_turnos, 'sin_mes_anterior', v_sin_fuente, 'ya_tenian_turnos', v_ya);
end $$;

-- Asigna un turno tipo a una asignación sin turnos y genera su mes.
create or replace function programacion.asignar_turno_tipo(p_asignacion bigint, p_patron bigint, p_ancla date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a programacion.asignaciones; per programacion.periodos; n int;
begin
  select * into a from programacion.asignaciones where id = p_asignacion;
  if a.id is null then raise exception 'Asignación no encontrada'; end if;
  if not programacion.puede_editar(programacion.ciudad_de_empleado(a.empleado_id)) then
    raise exception 'No tiene permiso para programar a este guarda';
  end if;
  select * into per from programacion.periodos p
    where p.ciudad_id = programacion.ciudad_de_empleado(a.empleado_id) and a.desde between p.inicio and p.fin;
  if per.estado <> 'abierto' then raise exception 'El periodo no está abierto'; end if;
  if exists (select 1 from programacion.turnos_programados where asignacion_id = a.id) then
    raise exception 'Este guarda ya tiene turnos en el periodo';
  end if;
  if not exists (select 1 from programacion.patrones_turno where id = p_patron and tipo in ('rotativo', 'semanal')) then
    raise exception 'Escoja un turno tipo rotativo o semanal';
  end if;
  update programacion.asignaciones set patron_id = p_patron, ancla = p_ancla where id = a.id;
  with prog as (
    insert into programacion.turnos_programados (empleado_id, puesto_id, asignacion_id, periodo_id, inicio, fin, origen, creado_por)
    select a.empleado_id, a.puesto_id, a.id, per.id, t.inicio, t.fin, 'patron', public.psi_sales_current_profile_id()
    from programacion.turnos_de_patron(p_patron, p_ancla, a.desde, a.hasta) t
    returning *
  ), rea as (
    insert into programacion.turnos (empleado_id, puesto_id, asignacion_id, inicio, fin, origen, turno_programado_id, creado_por)
    select empleado_id, puesto_id, asignacion_id, inicio, fin, 'plantilla', id, creado_por from prog returning 1
  ) select count(*) into n from rea;
  return jsonb_build_object('turnos_creados', n);
end $$;

revoke execute on function programacion.pendientes_de_programar(bigint), programacion.copiar_plan_anterior(bigint[]),
  programacion.asignar_turno_tipo(bigint, bigint, date) from anon, public;
grant execute on function programacion.pendientes_de_programar(bigint), programacion.copiar_plan_anterior(bigint[]),
  programacion.asignar_turno_tipo(bigint, bigint, date) to authenticated;
