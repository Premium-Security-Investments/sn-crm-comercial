-- Operación diaria: abrir periodo desde los turnos tipo, ver el día, registrar novedades,
-- sugerir reemplazos, cubrir turnos y cambiar horarios.
-- Regla de modelo: al abrir el periodo, lo realizado arranca igual a lo programado (como el
-- Excel arranca desde la plantilla). Cada cambio del día modifica lo realizado; lo programado
-- queda como referencia para medir cumplimiento.

-- ---------- Generación desde turnos tipo ----------
-- Turnos de un patrón entre dos fechas. 'plan_mensual' y 'manual' no generan nada (se programan a mano).
create or replace function programacion.turnos_de_patron(p_patron bigint, p_ancla date, p_desde date, p_hasta date)
returns table (inicio timestamp, fin timestamp)
language sql stable security definer set search_path = '' as $$
  with p as (select * from programacion.patrones_turno where id = p_patron and tipo in ('rotativo', 'semanal')),
  dias as (
    select d::date as fecha from generate_series(p_desde, p_hasta, interval '1 day') d
  ),
  dia_patron as (
    select dias.fecha,
      case
        when p.tipo = 'rotativo' then p.dias -> (((dias.fecha - p_ancla) % p.ciclo_dias + p.ciclo_dias) % p.ciclo_dias)
        when extract(isodow from dias.fecha) <> 7 and p.horario_festivo is not null
             and exists (select 1 from programacion.festivos f where f.fecha = dias.fecha) then p.horario_festivo
        else p.dias -> (extract(isodow from dias.fecha)::int - 1)
      end as dia
    from dias, p
  )
  select (dp.fecha + (t ->> 'inicio')::time)::timestamp,
         (case when (t ->> 'fin')::time <= (t ->> 'inicio')::time then dp.fecha + 1 else dp.fecha end + (t ->> 'fin')::time)::timestamp
  from dia_patron dp, jsonb_array_elements(coalesce(dp.dia -> 'tramos', '[]'::jsonb)) t
  order by 1
$$;

-- Abre un periodo: copia las asignaciones vigentes del periodo anterior (sin retirados) y genera
-- lo programado y lo realizado. Devuelve un resumen.
create or replace function programacion.abrir_periodo(p_ciudad text, p_inicio date, p_fin date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_periodo bigint; v_anterior programacion.periodos; v_parametros bigint;
  v_asig int := 0; v_prog int := 0; v_sin_patron int := 0; v_manual int := 0; v_retirados int := 0;
begin
  if not programacion.es_admin() and not (auth.uid() is null) then
    raise exception 'Solo un administrador de Programación puede abrir periodos';
  end if;
  if p_fin < p_inicio then raise exception 'La fecha final es anterior a la inicial'; end if;
  if exists (select 1 from programacion.periodos where ciudad_id = p_ciudad and daterange(inicio, fin, '[]') && daterange(p_inicio, p_fin, '[]')) then
    raise exception 'Ya existe un periodo de % que se cruza con esas fechas', p_ciudad;
  end if;
  select * into v_anterior from programacion.periodos where ciudad_id = p_ciudad and fin < p_inicio order by fin desc limit 1;
  if v_anterior.id is null then raise exception 'No hay periodo anterior de % para tomar las asignaciones', p_ciudad; end if;
  select id into v_parametros from programacion.parametros_nomina
    where (ciudad_id = p_ciudad or ciudad_id is null) and vigente_desde <= p_inicio order by vigente_desde desc limit 1;

  -- La generación masiva no se registra fila por fila en el historial (sí el periodo y los cambios posteriores).
  alter table programacion.turnos disable trigger historial_turnos;
  alter table programacion.turnos_programados disable trigger historial_turnos_programados;
  alter table programacion.asignaciones disable trigger historial_asignaciones;

  insert into programacion.periodos (ciudad_id, inicio, fin, estado, parametros_id)
  values (p_ciudad, p_inicio, p_fin, 'abierto', v_parametros) returning id into v_periodo;

  -- Retirados en el periodo anterior: no siguen.
  create temp table _retirados on commit drop as
    select distinct n.empleado_id from programacion.novedades n
    where n.tipo = 'retiro' and n.hasta >= v_anterior.fin - 1;
  select count(*) into v_retirados from _retirados;

  create temp table _nuevas (like programacion.asignaciones) on commit drop;
  with origen as (
    select a.* from programacion.asignaciones a
    join programacion.empleados e on e.id = a.empleado_id
    where a.desde <= v_anterior.fin and coalesce(a.hasta, v_anterior.fin) >= v_anterior.fin
      and e.ciudad_id = p_ciudad and e.estado <> 'retirado'
      and a.empleado_id not in (select empleado_id from _retirados)
  ), ins as (
    insert into programacion.asignaciones (empleado_id, puesto_id, patron_id, grupo, ancla, desde, hasta, regla_dominical_antigua)
    select empleado_id, puesto_id, patron_id, grupo, ancla, p_inicio, p_fin, regla_dominical_antigua from origen
    returning *
  ) insert into _nuevas select * from ins;
  select count(*) into v_asig from _nuevas;
  select count(*) into v_sin_patron from _nuevas where patron_id is null;
  select count(*) into v_manual from _nuevas n join programacion.patrones_turno p on p.id = n.patron_id where p.tipo in ('plan_mensual', 'manual');

  with prog as (
    insert into programacion.turnos_programados (empleado_id, puesto_id, asignacion_id, periodo_id, inicio, fin, origen)
    select n.empleado_id, n.puesto_id, n.id, v_periodo, t.inicio, t.fin, 'patron'
    from _nuevas n cross join lateral programacion.turnos_de_patron(n.patron_id, n.ancla, p_inicio, p_fin) t
    where n.patron_id is not null
    returning *
  ), rea as (
    insert into programacion.turnos (empleado_id, puesto_id, asignacion_id, inicio, fin, origen, turno_programado_id)
    select empleado_id, puesto_id, asignacion_id, inicio, fin, 'plantilla', id from prog
    returning 1
  ) select count(*) into v_prog from rea;

  alter table programacion.turnos enable trigger historial_turnos;
  alter table programacion.turnos_programados enable trigger historial_turnos_programados;
  alter table programacion.asignaciones enable trigger historial_asignaciones;
  insert into programacion.historial (tabla, registro_id, accion, despues, usuario)
  values ('periodos', v_periodo, 'insert', jsonb_build_object('ciudad', p_ciudad, 'inicio', p_inicio, 'fin', p_fin, 'turnos_generados', v_prog), auth.uid());

  return jsonb_build_object(
    'periodo_id', v_periodo, 'asignaciones', v_asig, 'turnos_generados', v_prog,
    'guardas_sin_turno_tipo', v_sin_patron, 'guardas_con_plan_a_mano', v_manual, 'retirados_excluidos', v_retirados);
end $$;

-- ---------- El día ----------
create or replace function programacion.turnos_del_dia(p_fecha date, p_ciudad text default null)
returns table (
  puesto_id bigint, puesto text, turno_programado_id bigint, turno_id bigint,
  programado_empleado_id bigint, programado_nombre text, programado_inicio timestamp, programado_fin timestamp,
  realizado_empleado_id bigint, realizado_nombre text, realizado_inicio timestamp, realizado_fin timestamp,
  origen text, novedad text, estado text)
language sql stable security definer set search_path = '' as $$
  with vis as (select programacion.empleados_visibles() as id),
  prog as (
    select tp.* from programacion.turnos_programados tp
    join programacion.empleados e on e.id = tp.empleado_id
    where tp.inicio::date = p_fecha and tp.empleado_id in (select id from vis)
      and (p_ciudad is null or e.ciudad_id = p_ciudad)
  ),
  con_real as (
    select p.*, t.id as t_id, t.empleado_id as t_emp, t.inicio as t_ini, t.fin as t_fin, t.origen as t_origen
    from prog p left join programacion.turnos t on t.turno_programado_id = p.id
  ),
  adicionales as (
    select t.* from programacion.turnos t
    join programacion.empleados e on e.id = t.empleado_id
    where t.inicio::date = p_fecha and t.turno_programado_id is null and t.empleado_id in (select id from vis)
      and (p_ciudad is null or e.ciudad_id = p_ciudad)
  )
  select c.puesto_id, pu.nombre, c.id, c.t_id,
    c.empleado_id, ep.nombre, c.inicio, c.fin,
    c.t_emp, er.nombre, c.t_ini, c.t_fin, c.t_origen,
    (select n.tipo from programacion.novedades n where n.empleado_id = c.empleado_id and p_fecha between n.desde and n.hasta limit 1),
    case
      when c.t_id is null then 'sin_cubrir'
      when c.t_emp <> c.empleado_id then 'cubierto'
      when c.t_ini <> c.inicio or c.t_fin <> c.fin then 'cambio_horario'
      else 'programado'
    end
  from con_real c
  left join programacion.puestos pu on pu.id = c.puesto_id
  join programacion.empleados ep on ep.id = c.empleado_id
  left join programacion.empleados er on er.id = c.t_emp
  union all
  select a.puesto_id, pu.nombre, null, a.id, null, null, null, null,
    a.empleado_id, er.nombre, a.inicio, a.fin, a.origen, null, 'adicional'
  from adicionales a
  left join programacion.puestos pu on pu.id = a.puesto_id
  join programacion.empleados er on er.id = a.empleado_id
  order by 2, 7, 11
$$;

-- ---------- Validación de un turno para un guarda ----------
-- Devuelve avisos: 'cruce' bloquea; los demás son advertencias.
create or replace function programacion.validar_turno(p_empleado bigint, p_inicio timestamp, p_fin timestamp, p_ignorar_turno bigint default null)
returns text[] language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when exists (select 1 from programacion.turnos t where t.empleado_id = p_empleado and t.id is distinct from p_ignorar_turno
                      and tsrange(t.inicio, t.fin) && tsrange(p_inicio, p_fin)) then 'cruce' end,
    case when exists (select 1 from programacion.turnos t where t.empleado_id = p_empleado and t.id is distinct from p_ignorar_turno
                      and not tsrange(t.inicio, t.fin) && tsrange(p_inicio, p_fin)
                      and (t.fin between p_inicio - interval '8 hours' and p_inicio
                           or t.inicio between p_fin and p_fin + interval '8 hours')) then 'descanso_menor_8h' end,
    case when exists (select 1 from programacion.novedades n where n.empleado_id = p_empleado and n.estado <> 'anulada'
                      and p_inicio::date between n.desde and n.hasta) then 'tiene_novedad' end,
    case when p_fin - p_inicio > interval '16 hours' then 'turno_mayor_16h' end
  ], null)
$$;

-- ---------- Acciones ----------
create or replace function programacion.registrar_novedad(p_empleado bigint, p_tipo text, p_desde date, p_hasta date, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_quitados int;
begin
  if not programacion.puede_editar(programacion.ciudad_de_empleado(p_empleado)) then
    raise exception 'No tiene permiso para registrar novedades de este guarda';
  end if;
  insert into programacion.novedades (empleado_id, tipo, desde, hasta, comentario, estado, creado_por)
  values (p_empleado, p_tipo, p_desde, p_hasta, p_comentario, 'registrada', public.psi_sales_current_profile_id())
  returning id into v_id;
  -- El guarda no presta sus turnos en esas fechas: se quitan de lo realizado (lo programado queda).
  with q as (
    delete from programacion.turnos t
    where t.empleado_id = p_empleado and t.inicio::date between p_desde and p_hasta
    returning 1
  ) select count(*) into v_quitados from q;
  return jsonb_build_object('novedad_id', v_id, 'turnos_sin_cubrir', v_quitados);
end $$;

create or replace function programacion.sugerir_reemplazos(p_turno_programado bigint, p_limite int default 12)
returns table (empleado_id bigint, nombre text, conoce_el_puesto boolean, horas_en_periodo numeric, avisos text[])
language sql stable security definer set search_path = '' as $$
  with tp as (select * from programacion.turnos_programados where id = p_turno_programado),
  per as (select p.* from programacion.periodos p, tp where p.id = tp.periodo_id),
  cand as (
    select e.id, e.nombre from programacion.empleados e, tp
    where e.ciudad_id = programacion.ciudad_de_empleado(tp.empleado_id)
      and e.estado <> 'retirado' and e.id <> tp.empleado_id
      and e.id in (select programacion.empleados_editables())
  )
  select * from (
    select c.id, c.nombre,
      exists (select 1 from programacion.turnos t, tp where t.empleado_id = c.id and t.puesto_id = tp.puesto_id) as conoce,
      coalesce((select round(sum(extract(epoch from (t.fin - t.inicio)) / 3600)::numeric, 1) from programacion.turnos t, per
                where t.empleado_id = c.id and t.inicio::date between per.inicio and per.fin), 0) as horas,
      programacion.validar_turno(c.id, tp.inicio, tp.fin) as avisos
    from cand c, tp
  ) x
  where not ('cruce' = any(x.avisos)) and not ('tiene_novedad' = any(x.avisos))
  order by cardinality(x.avisos) = 0 desc, x.conoce desc, x.horas asc
  limit p_limite
$$;

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
  update programacion.turnos set inicio = p_inicio, fin = p_fin,
    origen = case when origen = 'plantilla' then 'cambio' else origen end,
    comentario = coalesce(p_comentario, comentario)
  where id = p_turno;
  return jsonb_build_object('turno_id', p_turno, 'avisos', v_avisos);
end $$;

create or replace function programacion.quitar_turno(p_turno bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not programacion.puede_editar(programacion.ciudad_de_empleado((select empleado_id from programacion.turnos where id = p_turno))) then
    raise exception 'No tiene permiso para quitar este turno';
  end if;
  delete from programacion.turnos where id = p_turno;
end $$;

revoke execute on function
  programacion.turnos_de_patron(bigint, date, date, date), programacion.abrir_periodo(text, date, date),
  programacion.turnos_del_dia(date, text), programacion.validar_turno(bigint, timestamp, timestamp, bigint),
  programacion.registrar_novedad(bigint, text, date, date, text), programacion.sugerir_reemplazos(bigint, int),
  programacion.cubrir_turno(bigint, bigint, text, text), programacion.cambiar_horario(bigint, timestamp, timestamp, text),
  programacion.quitar_turno(bigint)
from anon, public;
grant execute on function
  programacion.abrir_periodo(text, date, date), programacion.turnos_del_dia(date, text),
  programacion.validar_turno(bigint, timestamp, timestamp, bigint), programacion.registrar_novedad(bigint, text, date, date, text),
  programacion.sugerir_reemplazos(bigint, int), programacion.cubrir_turno(bigint, bigint, text, text),
  programacion.cambiar_horario(bigint, timestamp, timestamp, text), programacion.quitar_turno(bigint)
to authenticated;
