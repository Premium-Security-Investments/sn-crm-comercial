-- Turnos tipo editables desde la app y grupos de rotación.
-- Un rotativo con grupos (p. ej. 3 en un puesto 24 h) reemplaza a G1, G2 y G3: el grupo g va
-- (g-1)·desfase días adelante en el mismo ciclo. Lo ya generado no cambia (es equivalente).

-- Generación con grupo. La versión de 4 argumentos queda como grupo 1.
create or replace function programacion.turnos_de_patron(p_patron bigint, p_ancla date, p_desde date, p_hasta date, p_grupo smallint)
returns table (inicio timestamp, fin timestamp)
language sql stable security definer set search_path = '' as $$
  with p as (select * from programacion.patrones_turno where id = p_patron and tipo in ('rotativo', 'semanal')),
  dias as (
    select d::date as fecha from generate_series(p_desde, p_hasta, interval '1 day') d
  ),
  dia_patron as (
    select dias.fecha,
      case
        when p.tipo = 'rotativo' then
          p.dias -> ((((dias.fecha - p_ancla) + (greatest(coalesce(p_grupo, 1), 1) - 1) * p.desfase_grupos) % p.ciclo_dias + p.ciclo_dias) % p.ciclo_dias)
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

create or replace function programacion.turnos_de_patron(p_patron bigint, p_ancla date, p_desde date, p_hasta date)
returns table (inicio timestamp, fin timestamp)
language sql stable security definer set search_path = '' as $$
  select * from programacion.turnos_de_patron(p_patron, p_ancla, p_desde, p_hasta, 1::smallint)
$$;

-- abrir_periodo: igual que en 0007, pero genera cada asignación con su grupo.
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
    from _nuevas n cross join lateral programacion.turnos_de_patron(n.patron_id, n.ancla, p_inicio, p_fin, n.grupo) t
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

-- asignar_turno_tipo: ahora con grupo (por defecto 1).
drop function if exists programacion.asignar_turno_tipo(bigint, bigint, date);
create or replace function programacion.asignar_turno_tipo(p_asignacion bigint, p_patron bigint, p_ancla date, p_grupo smallint default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a programacion.asignaciones; per programacion.periodos; pat programacion.patrones_turno; n int;
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
  select * into pat from programacion.patrones_turno where id = p_patron and tipo in ('rotativo', 'semanal') and activo;
  if pat.id is null then raise exception 'Escoja un turno tipo rotativo o semanal activo'; end if;
  if coalesce(p_grupo, 1) not between 1 and pat.grupos then
    raise exception 'Este turno tipo tiene % grupo(s); escoja uno entre 1 y %', pat.grupos, pat.grupos;
  end if;
  update programacion.asignaciones set patron_id = p_patron, ancla = p_ancla, grupo = coalesce(p_grupo, 1) where id = a.id;
  with prog as (
    insert into programacion.turnos_programados (empleado_id, puesto_id, asignacion_id, periodo_id, inicio, fin, origen, creado_por)
    select a.empleado_id, a.puesto_id, a.id, per.id, t.inicio, t.fin, 'patron', public.psi_sales_current_profile_id()
    from programacion.turnos_de_patron(p_patron, p_ancla, a.desde, a.hasta, coalesce(p_grupo, 1)::smallint) t
    returning *
  ), rea as (
    insert into programacion.turnos (empleado_id, puesto_id, asignacion_id, inicio, fin, origen, turno_programado_id, creado_por)
    select empleado_id, puesto_id, asignacion_id, inicio, fin, 'plantilla', id, creado_por from prog returning 1
  ) select count(*) into n from rea;
  return jsonb_build_object('turnos_creados', n);
end $$;

-- Revisa el ciclo (mismas reglas que revisarDias en src/motor/patrones.ts).
create or replace function programacion.revisar_dias_patron(p_tipo text, p_dias jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare d jsonb; t jsonb; i int := 0; trabajados int := 0;
begin
  if jsonb_typeof(p_dias) <> 'array' then return 'El ciclo no es una lista de días'; end if;
  if p_tipo = 'semanal' and jsonb_array_length(p_dias) <> 7 then return 'Un horario semanal tiene 7 días (lunes a domingo)'; end if;
  if jsonb_array_length(p_dias) not between 1 and 62 then return 'El ciclo debe tener entre 1 y 62 días'; end if;
  for d in select * from jsonb_array_elements(p_dias) loop
    i := i + 1;
    if jsonb_typeof(d -> 'tramos') <> 'array' then return format('Día %s: falta la lista de tramos', i); end if;
    for t in select * from jsonb_array_elements(d -> 'tramos') loop
      if coalesce(t ->> 'inicio', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(t ->> 'fin', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
        return format('Día %s: escriba las horas como 06:00', i);
      end if;
      trabajados := trabajados + 1;
    end loop;
  end loop;
  if trabajados = 0 then return 'El turno tipo no tiene ningún día trabajado'; end if;
  return null;
end $$;

-- Crea o edita un turno tipo (solo administradores). Lo ya generado no cambia; se usa en
-- las nuevas asignaciones y al abrir el siguiente periodo.
create or replace function programacion.guardar_turno_tipo(
  p_id bigint, p_ciudad text, p_codigo text, p_tipo text, p_dias jsonb, p_festivo jsonb default null,
  p_grupos smallint default 1, p_desfase smallint default 0, p_descripcion text default null, p_activo boolean default true)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_error text; v_ciclo int;
begin
  if not programacion.es_admin() then raise exception 'Solo un administrador de Programación puede editar turnos tipo'; end if;
  if coalesce(trim(p_codigo), '') = '' then raise exception 'Ponga un nombre al turno tipo'; end if;
  if p_tipo not in ('rotativo', 'semanal') then raise exception 'El turno tipo debe ser rotativo o semanal'; end if;
  v_error := programacion.revisar_dias_patron(p_tipo, p_dias);
  if v_error is not null then raise exception '%', v_error; end if;
  if p_festivo is not null and programacion.revisar_dias_patron('rotativo', jsonb_build_array(p_festivo)) like 'Día%' then
    raise exception 'Revise el horario de festivos: escriba las horas como 06:00';
  end if;
  v_ciclo := jsonb_array_length(p_dias);
  if p_tipo = 'semanal' and coalesce(p_grupos, 1) <> 1 then raise exception 'Los grupos solo aplican a turnos rotativos'; end if;
  if coalesce(p_grupos, 1) not between 1 and 9 then raise exception 'Entre 1 y 9 grupos'; end if;
  if coalesce(p_grupos, 1) > 1 and coalesce(p_desfase, 0) not between 1 and v_ciclo - 1 then
    raise exception 'Con varios grupos, el desfase va de 1 a % días', v_ciclo - 1;
  end if;
  if exists (select 1 from programacion.patrones_turno where ciudad_id is not distinct from p_ciudad
             and lower(codigo) = lower(trim(p_codigo)) and id is distinct from p_id) then
    raise exception 'Ya existe un turno tipo con el nombre %', trim(p_codigo);
  end if;
  if p_id is null then
    insert into programacion.patrones_turno (ciudad_id, codigo, tipo, ciclo_dias, dias, horario_festivo, grupos, desfase_grupos, descripcion, activo)
    values (p_ciudad, trim(p_codigo), p_tipo, v_ciclo, p_dias, case when p_tipo = 'semanal' then p_festivo end,
            coalesce(p_grupos, 1), case when coalesce(p_grupos, 1) > 1 then p_desfase else 0 end, nullif(trim(p_descripcion), ''), coalesce(p_activo, true))
    returning id into v_id;
  else
    if exists (select 1 from programacion.patrones_turno where id = p_id and tipo not in ('rotativo', 'semanal')) then
      raise exception 'Los planes a mano no se editan como turno tipo';
    end if;
    -- Bajar el número de grupos no puede dejar guardas en un grupo que ya no existe.
    if exists (select 1 from programacion.asignaciones a where a.patron_id = p_id and a.grupo > coalesce(p_grupos, 1)
               and (a.hasta is null or a.hasta >= current_date)) then
      raise exception 'Hay guardas vigentes en un grupo mayor a %; muévalos antes de quitar grupos', coalesce(p_grupos, 1);
    end if;
    update programacion.patrones_turno set codigo = trim(p_codigo), tipo = p_tipo, ciclo_dias = v_ciclo, dias = p_dias,
      horario_festivo = case when p_tipo = 'semanal' then p_festivo end, grupos = coalesce(p_grupos, 1),
      desfase_grupos = case when coalesce(p_grupos, 1) > 1 then p_desfase else 0 end,
      descripcion = nullif(trim(p_descripcion), ''), activo = coalesce(p_activo, true)
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Turno tipo no encontrado'; end if;
  end if;
  return v_id;
end $$;

-- Cuántos guardas vigentes usan cada turno tipo (para avisar antes de editar).
create or replace function programacion.uso_turnos_tipo(p_ciudad text)
returns table (patron_id bigint, guardas bigint, puestos bigint)
language sql stable security definer set search_path = '' as $$
  select a.patron_id, count(distinct a.empleado_id), count(distinct a.puesto_id)
  from programacion.asignaciones a join programacion.puestos pu on pu.id = a.puesto_id
  where a.patron_id is not null and (a.hasta is null or a.hasta >= current_date)
    and pu.ciudad_id = p_ciudad and programacion.puede_ver(p_ciudad)
  group by a.patron_id
$$;

-- Une G1, G2, G3… (en ese orden) en el primero, con grupos y desfase. Verifica que sean la misma
-- rotación corrida un número fijo de días; mueve las asignaciones vigentes a su grupo y desactiva
-- los demás. Los turnos ya generados no cambian (son los mismos por construcción).
create or replace function programacion.unir_grupos_turno_tipo(p_patrones bigint[], p_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare base programacion.patrones_turno; otro programacion.patrones_turno; g int; s int; d int; n int; v_movidas int := 0; k int;
begin
  if not programacion.es_admin() then raise exception 'Solo un administrador de Programación puede unir turnos tipo'; end if;
  if coalesce(array_length(p_patrones, 1), 0) < 2 then raise exception 'Escoja al menos dos turnos tipo'; end if;
  select * into base from programacion.patrones_turno where id = p_patrones[1];
  if base.tipo <> 'rotativo' or base.grupos <> 1 then raise exception 'El primero debe ser un rotativo sin grupos'; end if;
  n := base.ciclo_dias;
  for g in 2 .. array_length(p_patrones, 1) loop
    select * into otro from programacion.patrones_turno where id = p_patrones[g];
    if otro.id is null or otro.tipo <> 'rotativo' or otro.ciclo_dias <> n or otro.grupos <> 1
       or otro.ciudad_id is distinct from base.ciudad_id then
      raise exception 'El grupo % no es un rotativo de % días de la misma ciudad', g, n;
    end if;
    s := null;
    for k in 0 .. n - 1 loop
      if (select jsonb_agg(base.dias -> ((i + k) % n) order by i) from generate_series(0, n - 1) i) = otro.dias then s := k; exit; end if;
    end loop;
    if s is null then raise exception 'El grupo % no es la misma rotación del grupo 1', g; end if;
    if g = 2 then d := s;
    elsif s <> ((g - 1) * d) % n then raise exception 'El grupo % no va % días después del grupo %', g, d, g - 1;
    end if;
  end loop;
  if d = 0 then raise exception 'Los grupos son idénticos; no hay rotación entre ellos'; end if;
  if exists (select 1 from programacion.patrones_turno where ciudad_id is not distinct from base.ciudad_id
             and lower(codigo) = lower(trim(p_codigo)) and id <> base.id) then
    raise exception 'Ya existe un turno tipo con el nombre %', trim(p_codigo);
  end if;

  update programacion.patrones_turno set codigo = trim(p_codigo), grupos = array_length(p_patrones, 1), desfase_grupos = d where id = base.id;
  for g in 2 .. array_length(p_patrones, 1) loop
    update programacion.asignaciones set patron_id = base.id, grupo = g
    where patron_id = p_patrones[g] and (hasta is null or hasta >= current_date);
    get diagnostics k = row_count;
    v_movidas := v_movidas + k;
    update programacion.patrones_turno set activo = false where id = p_patrones[g];
  end loop;
  return jsonb_build_object('patron_id', base.id, 'grupos', array_length(p_patrones, 1), 'desfase', d, 'asignaciones_movidas', v_movidas);
end $$;

revoke execute on function programacion.turnos_de_patron(bigint, date, date, date, smallint),
  programacion.asignar_turno_tipo(bigint, bigint, date, smallint), programacion.revisar_dias_patron(text, jsonb),
  programacion.guardar_turno_tipo(bigint, text, text, text, jsonb, jsonb, smallint, smallint, text, boolean),
  programacion.uso_turnos_tipo(text), programacion.unir_grupos_turno_tipo(bigint[], text) from anon, public;
grant execute on function programacion.turnos_de_patron(bigint, date, date, date, smallint),
  programacion.asignar_turno_tipo(bigint, bigint, date, smallint), programacion.revisar_dias_patron(text, jsonb),
  programacion.guardar_turno_tipo(bigint, text, text, text, jsonb, jsonb, smallint, smallint, text, boolean),
  programacion.uso_turnos_tipo(text), programacion.unir_grupos_turno_tipo(bigint[], text) to authenticated;
