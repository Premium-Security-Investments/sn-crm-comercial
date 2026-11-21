-- Enlaza cada turno realizado con su turno programado cuando son el mismo guarda, el mismo puesto y el
-- mismo día y los horarios se cruzan. La carga del Excel de Pereira solo enlazaba horarios idénticos:
-- quien entró o salió a otra hora aparecía como "sin cubrir" + "no programado" (1.728 casos el 2026-10-17).
-- Así quedan como "cambio de horario", que es lo que pasó. No borra nada; no cambia horas ni nómina.
-- Uno a uno: cada programado toma el realizado con más horas en común, y cada realizado va a un solo programado.

create or replace function programacion.enlazar_realizados(p_desde date, p_hasta date)
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  if not (programacion.es_admin() or auth.uid() is null) then
    raise exception 'Solo un administrador de Programación puede enlazar turnos';
  end if;
  with cand as (
    select tp.id as tp_id, r.id as r_id,
      extract(epoch from (upper(tsrange(r.inicio, r.fin) * tsrange(tp.inicio, tp.fin)) - lower(tsrange(r.inicio, r.fin) * tsrange(tp.inicio, tp.fin)))) as comun
    from programacion.turnos_programados tp
    join programacion.turnos r on r.turno_programado_id is null and r.empleado_id = tp.empleado_id
      and r.puesto_id is not distinct from tp.puesto_id and r.inicio::date = tp.inicio::date
      and tsrange(r.inicio, r.fin) && tsrange(tp.inicio, tp.fin)
    where tp.inicio::date between p_desde and p_hasta
      and not exists (select 1 from programacion.turnos t where t.turno_programado_id = tp.id)
  ),
  por_programado as (select distinct on (tp_id) * from cand order by tp_id, comun desc, r_id),
  uno as (select distinct on (r_id) * from por_programado order by r_id, comun desc, tp_id)
  update programacion.turnos t set turno_programado_id = uno.tp_id
  from uno where t.id = uno.r_id;
  get diagnostics v = row_count;
  return v;
end $$;

revoke execute on function programacion.enlazar_realizados(date, date) from anon, public;
grant execute on function programacion.enlazar_realizados(date, date) to authenticated;

-- Corrección de lo ya cargado.
select programacion.enlazar_realizados('2000-01-01', '2100-12-31');
