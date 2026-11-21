-- Cierre del periodo: guardar los resultados calculados, cerrar (bloquea cambios) y reabrir.
-- El cálculo lo hace la app con el motor verificado contra el Excel; la base guarda y controla.

alter table programacion.periodos add column if not exists resultados_calculados_en timestamptz;
-- Punto del historial en el que se calculó: los cambios posteriores tienen id mayor
-- (más robusto que comparar horas, que coinciden dentro de una misma transacción).
alter table programacion.periodos add column if not exists resultados_historial_id bigint;

create or replace function programacion.puede_cerrar(p_ciudad text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from programacion.mi_acceso() m
                 where m.rol in ('admin', 'nomina') and (m.ciudad_id is null or m.ciudad_id = p_ciudad))
$$;

-- Guarda (reemplaza) los resultados de un lote de guardas.
-- p_resultados: [{ "empleado_id": 1, "totales": {...}, "traza": {...} }, ...]
create or replace function programacion.guardar_resultados(p_periodo bigint, p_metodo text, p_version text, p_resultados jsonb, p_es_primer_lote boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare per programacion.periodos; n int;
begin
  select * into per from programacion.periodos where id = p_periodo;
  if per.id is null then raise exception 'Periodo no encontrado'; end if;
  if not programacion.puede_cerrar(per.ciudad_id) then raise exception 'Solo nómina o un administrador pueden calcular el cierre'; end if;
  if per.estado = 'cerrado' then raise exception 'El periodo ya está cerrado'; end if;
  if p_es_primer_lote then
    delete from programacion.resultados_nomina where periodo_id = p_periodo and metodo = p_metodo;
  end if;
  insert into programacion.resultados_nomina (periodo_id, empleado_id, metodo, version_motor, totales, traza, calculado_en)
  select p_periodo, r.empleado_id, p_metodo, p_version, r.totales, r.traza, now()
  from jsonb_to_recordset(p_resultados) as r(empleado_id bigint, totales jsonb, traza jsonb)
  on conflict (periodo_id, empleado_id, metodo) do update
    set totales = excluded.totales, traza = excluded.traza, version_motor = excluded.version_motor, calculado_en = now();
  get diagnostics n = row_count;
  update programacion.periodos set resultados_calculados_en = now(),
    resultados_historial_id = (select coalesce(max(id), 0) from programacion.historial) where id = p_periodo;
  return n;
end $$;

-- ¿Hubo cambios en turnos o novedades del periodo después del último cálculo?
create or replace function programacion.cambios_despues_del_calculo(p_periodo bigint)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from programacion.historial h, programacion.periodos p
  where p.id = p_periodo and p.resultados_historial_id is not null and h.id > p.resultados_historial_id
    and (
      (h.tabla in ('turnos', 'turnos_programados')
        and coalesce(h.despues ->> 'inicio', h.antes ->> 'inicio')::date between p.inicio and p.fin)
      or (h.tabla = 'novedades'
        and daterange(coalesce(h.despues ->> 'desde', h.antes ->> 'desde')::date, coalesce(h.despues ->> 'hasta', h.antes ->> 'hasta')::date, '[]')
            && daterange(p.inicio, p.fin, '[]'))
    )
$$;

create or replace function programacion.cerrar_periodo(p_periodo bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare per programacion.periodos; v_guardas int; v_resultados int; v_cambios int;
begin
  select * into per from programacion.periodos where id = p_periodo;
  if per.id is null then raise exception 'Periodo no encontrado'; end if;
  if not programacion.puede_cerrar(per.ciudad_id) then raise exception 'Solo nómina o un administrador pueden cerrar el periodo'; end if;
  if per.estado = 'cerrado' then raise exception 'El periodo ya está cerrado'; end if;
  select count(distinct a.empleado_id) into v_guardas from programacion.asignaciones a
    where a.desde <= per.fin and coalesce(a.hasta, per.fin) >= per.inicio
      and programacion.ciudad_de_empleado(a.empleado_id) = per.ciudad_id;
  select count(*) into v_resultados from programacion.resultados_nomina where periodo_id = p_periodo;
  if v_resultados < v_guardas then
    raise exception 'Faltan resultados: hay % guardas y % calculados. Calcule de nuevo antes de cerrar.', v_guardas, v_resultados;
  end if;
  v_cambios := programacion.cambios_despues_del_calculo(p_periodo);
  if v_cambios > 0 then
    raise exception 'Hubo % cambios después del último cálculo. Calcule de nuevo antes de cerrar.', v_cambios;
  end if;
  update programacion.periodos set estado = 'cerrado', cerrado_por = auth.uid(), cerrado_en = now(),
    parametros_congelados = (select to_jsonb(x) from programacion.parametros_nomina x where x.id = per.parametros_id)
  where id = p_periodo;
  insert into programacion.historial (tabla, registro_id, accion, antes, despues, usuario)
  values ('periodos', p_periodo, 'update', jsonb_build_object('estado', per.estado), jsonb_build_object('estado', 'cerrado', 'guardas', v_guardas), auth.uid());
  return jsonb_build_object('guardas', v_guardas, 'estado', 'cerrado');
end $$;

create or replace function programacion.reabrir_periodo(p_periodo bigint, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not programacion.es_admin() then raise exception 'Solo un administrador puede reabrir un periodo'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indique el motivo para reabrir'; end if;
  update programacion.periodos set estado = 'abierto', cerrado_por = null, cerrado_en = null where id = p_periodo;
  insert into programacion.historial (tabla, registro_id, accion, antes, despues, usuario)
  values ('periodos', p_periodo, 'update', jsonb_build_object('estado', 'cerrado'), jsonb_build_object('estado', 'abierto', 'motivo', p_motivo), auth.uid());
end $$;

revoke execute on function programacion.puede_cerrar(text), programacion.guardar_resultados(bigint, text, text, jsonb, boolean),
  programacion.cambios_despues_del_calculo(bigint), programacion.cerrar_periodo(bigint), programacion.reabrir_periodo(bigint, text) from anon, public;
grant execute on function programacion.puede_cerrar(text), programacion.guardar_resultados(bigint, text, text, jsonb, boolean),
  programacion.cambios_despues_del_calculo(bigint), programacion.cerrar_periodo(bigint), programacion.reabrir_periodo(bigint, text) to authenticated;
