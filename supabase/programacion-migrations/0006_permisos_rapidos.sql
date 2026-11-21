-- Rendimiento de permisos. Las políticas de 0005 evaluaban la ciudad del empleado fila por fila
-- (29.823 turnos → ~10 s, por encima del límite de 8 s de la API). Ahora se calcula una vez
-- la lista de empleados visibles/editables y se filtra con ella. Además, las políticas de
-- edición ya no aplican a SELECT (antes "for all" sumaba una segunda evaluación por fila).

create or replace function programacion.empleados_visibles()
returns setof bigint language sql stable security definer set search_path = '' as $$
  select e.id from programacion.empleados e
  where exists (select 1 from programacion.mi_acceso() m where m.ciudad_id is null or m.ciudad_id = e.ciudad_id)
$$;

create or replace function programacion.empleados_editables()
returns setof bigint language sql stable security definer set search_path = '' as $$
  select e.id from programacion.empleados e
  where exists (select 1 from programacion.mi_acceso() m
                where m.rol in ('admin', 'coordinador') and (m.ciudad_id is null or m.ciudad_id = e.ciudad_id))
$$;

revoke execute on function programacion.empleados_visibles(), programacion.empleados_editables() from anon, public;
grant execute on function programacion.empleados_visibles(), programacion.empleados_editables() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['asignaciones', 'turnos_programados', 'turnos', 'novedades'] loop
    execute format('drop policy if exists ver_%1$s on programacion.%2$s', case t when 'turnos_programados' then 'programados' else t end, t);
    execute format('drop policy if exists editar_%1$s on programacion.%2$s', case t when 'turnos_programados' then 'programados' else t end, t);
    execute format('create policy ver on programacion.%1$s for select to authenticated using (empleado_id in (select programacion.empleados_visibles()))', t);
    execute format('create policy crear on programacion.%1$s for insert to authenticated with check (empleado_id in (select programacion.empleados_editables()))', t);
    execute format('create policy editar on programacion.%1$s for update to authenticated using (empleado_id in (select programacion.empleados_editables())) with check (empleado_id in (select programacion.empleados_editables()))', t);
    execute format('create policy borrar on programacion.%1$s for delete to authenticated using (empleado_id in (select programacion.empleados_editables()))', t);
  end loop;
end $$;

drop policy if exists ver_resultados on programacion.resultados_nomina;
create policy ver on programacion.resultados_nomina for select to authenticated
  using (empleado_id in (select programacion.empleados_visibles()));
