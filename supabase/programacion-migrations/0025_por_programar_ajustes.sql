-- Por programar: datos para agrupar por puesto, separar registros incompletos y ver activos sin puesto
-- (pedido de Juan, 2026-10-17). La lista solo mostraba a quien tenía puesto el mes anterior: un guarda
-- activo sin asignación en el periodo no aparecía en ninguna parte.

drop function if exists programacion.pendientes_de_programar(bigint);
create or replace function programacion.pendientes_de_programar(p_periodo bigint)
returns table (asignacion_id bigint, empleado_id bigint, empleado text, puesto_id bigint, puesto text,
               patron text, motivo text, turnos_mes_anterior int, documento text, datos_incompletos boolean)
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
    coalesce(c.n, 0), e.documento,
    -- Registros que vienen mal del Excel: nombre con error de Excel o marcado, sin cédula o sin puesto real.
    (e.nombre ~* '^(0x[0-9a-f]+|sin nombre)' or e.documento ilike 'SIN-DOC%' or a.puesto_id is null or coalesce(pu.nombre, '') ilike '(PUESTO SIN NOMBRE%')
  from asig a
  join programacion.empleados e on e.id = a.empleado_id
  left join programacion.puestos pu on pu.id = a.puesto_id
  left join programacion.patrones_turno pt on pt.id = a.patron_id
  left join conteo c on c.empleado_id = a.empleado_id
  order by pu.nombre, e.nombre
$$;


-- Guardas activos (no reserva ni retirados) sin asignación en el periodo.
create or replace function programacion.activos_sin_puesto(p_periodo bigint)
returns table (empleado_id bigint, nombre text, documento text, cargo text, fecha_ingreso date, ultimo_puesto text, ultimo_hasta date)
language sql stable security definer set search_path = '' as $$
  with per as (select * from programacion.periodos where id = p_periodo)
  select e.id, e.nombre, e.documento, e.cargo, e.fecha_ingreso, ult.puesto, ult.hasta
  from programacion.empleados e cross join per
  left join lateral (
    select pu.nombre as puesto, a.hasta from programacion.asignaciones a left join programacion.puestos pu on pu.id = a.puesto_id
    where a.empleado_id = e.id and a.desde < per.inicio order by a.desde desc limit 1
  ) ult on true
  where e.ciudad_id = per.ciudad_id and e.estado = 'activo'
    and e.id in (select programacion.empleados_visibles())
    and not exists (select 1 from programacion.asignaciones a where a.empleado_id = e.id
                    and a.desde <= per.fin and coalesce(a.hasta, per.fin) >= per.inicio)
  order by e.nombre
$$;

-- Asignar un puesto en el periodo abierto (después se le da turno tipo o se copia el mes anterior).
create or replace function programacion.asignar_puesto(p_periodo bigint, p_empleado bigint, p_puesto bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare per programacion.periodos; v_id bigint;
begin
  select * into per from programacion.periodos where id = p_periodo;
  if per.id is null then raise exception 'Periodo no encontrado'; end if;
  if per.estado <> 'abierto' then raise exception 'El periodo no está abierto'; end if;
  if not programacion.puede_editar(per.ciudad_id) then raise exception 'No tiene permiso en esta ciudad'; end if;
  if programacion.ciudad_de_empleado(p_empleado) is distinct from per.ciudad_id then raise exception 'El guarda es de otra ciudad'; end if;
  if not exists (select 1 from programacion.puestos where id = p_puesto and ciudad_id = per.ciudad_id and activo) then raise exception 'Puesto no válido'; end if;
  insert into programacion.asignaciones (empleado_id, puesto_id, ancla, desde, hasta)
  values (p_empleado, p_puesto, per.inicio, per.inicio, per.fin) returning id into v_id;
  return v_id;
end $$;

-- Marcar como reserva (disponible): deja de aparecer como activo sin puesto.
create or replace function programacion.marcar_reserva(p_empleado bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not programacion.puede_editar(programacion.ciudad_de_empleado(p_empleado)) then raise exception 'No tiene permiso para este guarda'; end if;
  update programacion.empleados set estado = 'disponible' where id = p_empleado and estado = 'activo';
end $$;

revoke execute on function programacion.pendientes_de_programar(bigint), programacion.activos_sin_puesto(bigint),
  programacion.asignar_puesto(bigint, bigint, bigint), programacion.marcar_reserva(bigint) from anon, public;
grant execute on function programacion.pendientes_de_programar(bigint), programacion.activos_sin_puesto(bigint),
  programacion.asignar_puesto(bigint, bigint, bigint), programacion.marcar_reserva(bigint) to authenticated;
