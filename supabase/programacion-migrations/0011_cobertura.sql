-- Cobertura: lo contratado frente a lo realizado, en franjas de 30 minutos, y tablero del día.

-- Servicios propuestos desde la programación (borrador) frente a confirmados con el contrato.
alter table programacion.servicios_contratados add column if not exists confirmado boolean not null default true;

-- Franjas de un día: guardas requeridos (suma de servicios) y presentes (turnos realizados en el puesto).
-- Un servicio "del día" es el que empieza ese día (uno de 18:00 a 06:00 cuenta para el día en que empieza).
create or replace function programacion.cobertura_franjas(p_ciudad text, p_fecha date)
returns table (puesto_id bigint, franja timestamp, requeridos int, presentes int)
language sql stable security definer set search_path = '' as $$
  with serv as (
    select s.*, (case when s.hora_fin > s.hora_inicio then s.hora_fin - s.hora_inicio
                      else interval '24 hours' - (s.hora_inicio - s.hora_fin) end) as dur
    from programacion.servicios_contratados s
    join programacion.puestos p on p.id = s.puesto_id
    where p.ciudad_id = p_ciudad and p.activo and programacion.puede_ver(p_ciudad)
      and p_fecha between s.desde and coalesce(s.hasta, p_fecha)
      and extract(isodow from p_fecha)::smallint = any(s.dias)
      and (s.incluye_festivos or not exists (select 1 from programacion.festivos f where f.fecha = p_fecha))
  ), req as (
    select s.puesto_id, g.franja, sum(s.guardas)::int as requeridos
    from serv s
    cross join lateral generate_series(p_fecha + s.hora_inicio, p_fecha + s.hora_inicio + s.dur - interval '30 minutes', interval '30 minutes') as g(franja)
    group by 1, 2
  )
  select r.puesto_id, r.franja, r.requeridos,
    (select count(*)::int from programacion.turnos t
      where t.puesto_id = r.puesto_id and t.inicio <= r.franja and t.fin >= r.franja + interval '30 minutes'
        and t.inicio >= r.franja - interval '36 hours')
  from req r
$$;

-- Resumen por puesto: horas requeridas, cubiertas y franjas descubiertas agrupadas.
create or replace function programacion.cobertura_dia(p_ciudad text, p_fecha date)
returns table (puesto_id bigint, puesto text, cliente text, horas_requeridas numeric, horas_cubiertas numeric,
               descubierto jsonb, servicios_sin_confirmar int)
language sql stable security definer set search_path = '' as $$
  with f as (select * from programacion.cobertura_franjas(p_ciudad, p_fecha)),
  falta as (
    select f.puesto_id, f.franja, f.requeridos - least(f.presentes, f.requeridos) as faltan,
      f.franja - (row_number() over (partition by f.puesto_id, f.requeridos - least(f.presentes, f.requeridos) order by f.franja)) * interval '30 minutes' as grupo
    from f where f.presentes < f.requeridos
  ), bloques as (
    select puesto_id, faltan, min(franja) as desde, max(franja) + interval '30 minutes' as hasta
    from falta group by puesto_id, faltan, grupo
  )
  select p.id, p.nombre, c.razon_social,
    round(sum(f.requeridos) / 2.0, 1), round(sum(least(f.presentes, f.requeridos)) / 2.0, 1),
    coalesce((select jsonb_agg(jsonb_build_object('desde', b.desde, 'hasta', b.hasta, 'faltan', b.faltan) order by b.desde)
              from bloques b where b.puesto_id = p.id), '[]'::jsonb),
    (select count(*)::int from programacion.servicios_contratados s where s.puesto_id = p.id and not s.confirmado
       and p_fecha between s.desde and coalesce(s.hasta, p_fecha))
  from f
  join programacion.puestos p on p.id = f.puesto_id
  left join programacion.clientes c on c.id = p.cliente_id
  group by p.id, p.nombre, c.razon_social
  order by (sum(f.requeridos) - sum(least(f.presentes, f.requeridos))) desc, p.nombre
$$;

-- Tablero del día por ciudad.
create or replace function programacion.tablero_dia(p_ciudad text, p_fecha date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cob as (select * from programacion.cobertura_dia(p_ciudad, p_fecha)),
  dia as (select * from programacion.turnos_del_dia(p_fecha, p_ciudad))
  select case when not programacion.puede_ver(p_ciudad) then null else jsonb_build_object(
    'puestos_con_servicio', (select count(*) from cob),
    'puestos_descubiertos', (select count(*) from cob where jsonb_array_length(descubierto) > 0),
    'horas_descubiertas', (select coalesce(sum(horas_requeridas - horas_cubiertas), 0) from cob),
    'puestos_sin_servicio', (select count(*) from programacion.puestos p where p.ciudad_id = p_ciudad and p.activo
                               and not exists (select 1 from programacion.servicios_contratados s where s.puesto_id = p.id
                                               and p_fecha between s.desde and coalesce(s.hasta, p_fecha))),
    'turnos_del_dia', (select count(*) from dia),
    'turnos_sin_cubrir', (select count(*) from dia where estado = 'sin_cubrir'),
    'cambios_del_dia', (select count(*) from dia where estado in ('cubierto', 'cambio_horario', 'adicional')),
    'guardas_trabajando', (select count(distinct realizado_empleado_id) from dia where realizado_empleado_id is not null),
    'novedades_activas', (select count(*) from programacion.novedades n join programacion.empleados e on e.id = n.empleado_id
                          where e.ciudad_id = p_ciudad and p_fecha between n.desde and n.hasta and n.estado <> 'anulada'
                            and n.tipo not in ('no_vinculado', 'fuera_de_corte', 'retiro')),
    'novedades_por_tipo', (select coalesce(jsonb_object_agg(tipo, n), '{}'::jsonb) from (
                          select n.tipo, count(*) n from programacion.novedades n join programacion.empleados e on e.id = n.empleado_id
                          where e.ciudad_id = p_ciudad and p_fecha between n.desde and n.hasta and n.estado <> 'anulada'
                            and n.tipo not in ('no_vinculado', 'fuera_de_corte', 'retiro') group by n.tipo) x)
  ) end
$$;

revoke execute on function programacion.cobertura_franjas(text, date), programacion.cobertura_dia(text, date),
  programacion.tablero_dia(text, date) from anon, public;
grant execute on function programacion.cobertura_franjas(text, date), programacion.cobertura_dia(text, date),
  programacion.tablero_dia(text, date) to authenticated;
