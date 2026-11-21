-- Datos maestros: servicios contratados por puesto y edición de clientes, puestos y empleados.
-- Lo edita un administrador de Programación; todos los demás lo ven según su ciudad.

alter table programacion.clientes add column if not exists notas text;
alter table programacion.clientes add column if not exists actualizado_en timestamptz not null default now();
alter table programacion.puestos add column if not exists notas text;
alter table programacion.puestos add column if not exists actualizado_en timestamptz not null default now();
alter table programacion.empleados add column if not exists actualizado_en timestamptz not null default now();

-- Lo que el cliente contrató en un puesto. Un puesto puede tener varios servicios
-- (p. ej. 24 h todos los días + un refuerzo de 07:00 a 19:00 de lunes a viernes).
create table if not exists programacion.servicios_contratados (
  id               bigint generated always as identity primary key,
  puesto_id        bigint not null references programacion.puestos(id) on delete cascade,
  descripcion      text,
  dias             smallint[] not null default '{1,2,3,4,5,6,7}',   -- 1 = lunes … 7 = domingo
  incluye_festivos boolean not null default true,
  hora_inicio      time not null,
  hora_fin         time not null,   -- menor o igual que el inicio: termina al día siguiente; igual = 24 h
  guardas          smallint not null default 1 check (guardas between 1 and 50),
  armado           boolean not null default false,
  desde            date not null,
  hasta            date,
  notas            text,
  creado_por       uuid,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  check (hasta is null or hasta >= desde),
  check (dias <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(dias) > 0)
);
create index if not exists servicios_puesto on programacion.servicios_contratados (puesto_id);
alter table programacion.servicios_contratados enable row level security;

-- Horas contratadas por semana de un servicio (para estimar guardas necesarios).
create or replace function programacion.horas_semana_servicio(s programacion.servicios_contratados)
returns numeric language sql immutable set search_path = '' as $$
  select round((case when s.hora_fin > s.hora_inicio then extract(epoch from s.hora_fin - s.hora_inicio)
                     else 86400 - extract(epoch from s.hora_inicio - s.hora_fin) end) / 3600.0
               * cardinality(s.dias) * s.guardas, 1)
$$;

create or replace function programacion.ciudad_de_puesto(p_puesto bigint)
returns text language sql stable security definer set search_path = '' as $$
  select ciudad_id from programacion.puestos where id = p_puesto
$$;

-- Historial también para los maestros.
do $$
declare t text;
begin
  foreach t in array array['clientes', 'puestos', 'empleados', 'servicios_contratados', 'patrones_turno'] loop
    execute format('drop trigger if exists historial_%1$s on programacion.%1$s', t);
    execute format('create trigger historial_%1$s after insert or update or delete on programacion.%1$s for each row execute function programacion.registrar_historial()', t);
  end loop;
end $$;

-- Permisos: ver según ciudad; crear y editar solo el administrador.
grant insert, update, delete on programacion.clientes, programacion.puestos, programacion.empleados,
  programacion.servicios_contratados, programacion.patrones_turno to authenticated;
grant select on programacion.servicios_contratados to authenticated;

create policy ver_servicios on programacion.servicios_contratados for select to authenticated
  using (programacion.puede_ver(programacion.ciudad_de_puesto(puesto_id)));

do $$
declare t text;
begin
  foreach t in array array['clientes', 'puestos', 'empleados', 'servicios_contratados', 'patrones_turno'] loop
    execute format('create policy admin_crear on programacion.%1$s for insert to authenticated with check (programacion.es_admin())', t);
    execute format('create policy admin_editar on programacion.%1$s for update to authenticated using (programacion.es_admin()) with check (programacion.es_admin())', t);
    execute format('create policy admin_borrar on programacion.%1$s for delete to authenticated using (programacion.es_admin())', t);
  end loop;
end $$;

-- Resumen por cliente para la sección Clientes.
create or replace function programacion.resumen_clientes(p_ciudad text)
returns table (cliente_id bigint, nit text, razon_social text, activo boolean, puestos int, servicios_vigentes int,
               horas_contratadas_semana numeric, guardas_asignados int)
language sql stable security definer set search_path = '' as $$
  with per as (
    select * from programacion.periodos where ciudad_id = p_ciudad and estado = 'abierto' order by inicio limit 1
  ), pu as (
    select * from programacion.puestos where ciudad_id = p_ciudad
  )
  select c.id, c.nit, c.razon_social, c.activo,
    (select count(*)::int from pu where pu.cliente_id = c.id),
    (select count(*)::int from programacion.servicios_contratados s join pu on pu.id = s.puesto_id
      where pu.cliente_id = c.id and s.desde <= current_date and (s.hasta is null or s.hasta >= current_date)),
    coalesce((select sum(programacion.horas_semana_servicio(s)) from programacion.servicios_contratados s join pu on pu.id = s.puesto_id
      where pu.cliente_id = c.id and s.desde <= current_date and (s.hasta is null or s.hasta >= current_date)), 0),
    (select count(distinct a.empleado_id)::int from programacion.asignaciones a join pu on pu.id = a.puesto_id, per
      where pu.cliente_id = c.id and a.desde <= per.fin and coalesce(a.hasta, per.fin) >= per.inicio)
  from programacion.clientes c
  where programacion.puede_ver(p_ciudad)
    and exists (select 1 from pu where pu.cliente_id = c.id)
  order by c.razon_social
$$;

revoke execute on function programacion.resumen_clientes(text), programacion.ciudad_de_puesto(bigint) from anon, public;
grant execute on function programacion.resumen_clientes(text), programacion.ciudad_de_puesto(bigint),
  programacion.horas_semana_servicio(programacion.servicios_contratados) to authenticated;
