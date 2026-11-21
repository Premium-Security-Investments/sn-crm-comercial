-- Periodos históricos (Juan, 2026-10-17): el de Pereira 24-jul a 23-ago se cargó cerrado desde el Excel y nunca
-- se calculó, así que no se podía ver su costo en pesos. Un administrador puede guardar el cálculo de un periodo
-- cerrado UNA vez, solo si nunca se calculó. No cambia turnos ni novedades; el periodo sigue cerrado.
create or replace function programacion.guardar_resultados(p_periodo bigint, p_metodo text, p_version text, p_resultados jsonb, p_es_primer_lote boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare per programacion.periodos; n int;
begin
  select * into per from programacion.periodos where id = p_periodo;
  if per.id is null then raise exception 'Periodo no encontrado'; end if;
  if not programacion.puede_cerrar(per.ciudad_id) then raise exception 'Solo nómina o un administrador pueden calcular el cierre'; end if;
  if per.estado = 'cerrado' then
    if not programacion.es_admin() then raise exception 'El periodo ya está cerrado'; end if;
    -- Primer lote: solo si nunca se calculó. Lotes siguientes: solo si el primero se guardó en esta misma pasada (últimos 30 min).
    if p_es_primer_lote and (per.resultados_calculados_en is not null
         or exists (select 1 from programacion.resultados_nomina where periodo_id = p_periodo)) then
      raise exception 'El periodo ya está cerrado y tiene un cálculo guardado';
    end if;
    if not p_es_primer_lote and (per.resultados_calculados_en is null or per.resultados_calculados_en < now() - interval '30 minutes') then
      raise exception 'El periodo ya está cerrado';
    end if;
  end if;
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
