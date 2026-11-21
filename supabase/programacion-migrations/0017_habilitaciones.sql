-- Habilitaciones del guarda (curso de vigilancia, credencial, arma, moto, canino…) con vencimiento.
-- Los puestos que piden arma, moto o canino avisan si el guarda no tiene esa habilitación vigente:
-- el aviso pide motivo al cubrir un turno (como los demás controles) y baja al guarda en las sugerencias.

create table programacion.habilitaciones (
  id           bigint generated always as identity primary key,
  empleado_id  bigint not null references programacion.empleados(id) on delete cascade,
  tipo         text not null check (tipo in ('curso_vigilancia', 'credencial', 'arma', 'moto', 'canino', 'licencia_conduccion', 'otro')),
  detalle      text,                 -- p. ej. "Reentrenamiento énfasis en armas", "Moto placa ABC12D"
  numero       text,                 -- número del certificado, credencial o licencia
  expedida     date,
  vence        date,                 -- null = no vence
  creado_por   uuid,
  creado_en    timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (vence is null or expedida is null or vence >= expedida)
);
create index habilitaciones_empleado on programacion.habilitaciones (empleado_id, tipo, vence);

alter table programacion.habilitaciones enable row level security;
grant select, insert, update, delete on programacion.habilitaciones to authenticated;
create policy ver_habilitaciones on programacion.habilitaciones for select to authenticated
  using (empleado_id in (select programacion.empleados_visibles()));
create policy crear_habilitaciones on programacion.habilitaciones for insert to authenticated
  with check (empleado_id in (select programacion.empleados_editables()));
create policy editar_habilitaciones on programacion.habilitaciones for update to authenticated
  using (empleado_id in (select programacion.empleados_editables())) with check (empleado_id in (select programacion.empleados_editables()));
create policy borrar_habilitaciones on programacion.habilitaciones for delete to authenticated
  using (empleado_id in (select programacion.empleados_editables()));
create trigger historial_habilitaciones after insert or update or delete on programacion.habilitaciones
  for each row execute function programacion.registrar_historial();

-- Lo que el puesto exige y el guarda no tiene vigente en esa fecha.
create or replace function programacion.faltantes_habilitacion(p_empleado bigint, p_puesto bigint, p_fecha date)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(r.tipo order by r.tipo), '{}')
  from programacion.puestos pu
  cross join lateral (values ('arma', pu.requiere_arma), ('moto', pu.requiere_moto), ('canino', pu.requiere_canino)) r(tipo, exige)
  where pu.id = p_puesto and r.exige
    and not exists (select 1 from programacion.habilitaciones h where h.empleado_id = p_empleado and h.tipo = r.tipo
                    and (h.vence is null or h.vence >= p_fecha) and (h.expedida is null or h.expedida <= p_fecha))
$$;

-- validar_turno: igual que en 0012, más el puesto opcional para revisar habilitaciones.
drop function if exists programacion.validar_turno(bigint, timestamp, timestamp, bigint);
create or replace function programacion.validar_turno(p_empleado bigint, p_inicio timestamp, p_fin timestamp, p_ignorar_turno bigint default null, p_puesto bigint default null)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare par programacion.parametros_nomina; v_desc interval; v_horas numeric; av text[] := '{}'; f text;
begin
  par := programacion.parametros_de(p_empleado, p_inicio::date);
  v_desc := make_interval(mins => (coalesce(par.descanso_minimo_horas, 8) * 60)::int);
  if exists (select 1 from programacion.turnos t where t.empleado_id = p_empleado and t.id is distinct from p_ignorar_turno
             and tsrange(t.inicio, t.fin) && tsrange(p_inicio, p_fin)) then av := array_append(av, 'cruce'::text); end if;
  if exists (select 1 from programacion.turnos t where t.empleado_id = p_empleado and t.id is distinct from p_ignorar_turno
             and not tsrange(t.inicio, t.fin) && tsrange(p_inicio, p_fin)
             and (t.fin > p_inicio - v_desc and t.fin <= p_inicio or t.inicio >= p_fin and t.inicio < p_fin + v_desc)) then
    av := array_append(av, 'descanso_menor_al_minimo'::text);
  end if;
  select coalesce(sum(extract(epoch from least(t.fin, p_fin) - greatest(t.inicio, p_fin - interval '7 days')) / 3600), 0)
    into v_horas from programacion.turnos t
    where t.empleado_id = p_empleado and t.id is distinct from p_ignorar_turno
      and t.fin > p_fin - interval '7 days' and t.inicio < p_fin;
  if v_horas + extract(epoch from p_fin - p_inicio) / 3600 > coalesce(par.max_horas_semana, 60) then
    av := array_append(av, 'horas_semana_sobre_el_maximo'::text);
  end if;
  if exists (select 1 from programacion.novedades n where n.empleado_id = p_empleado and n.estado <> 'anulada'
             and p_inicio::date between n.desde and n.hasta) then av := array_append(av, 'tiene_novedad'::text); end if;
  if p_fin - p_inicio > interval '16 hours' then av := array_append(av, 'turno_mayor_16h'::text); end if;
  if p_puesto is not null then
    foreach f in array programacion.faltantes_habilitacion(p_empleado, p_puesto, p_inicio::date) loop
      av := array_append(av, 'sin_habilitacion_' || f);
    end loop;
  end if;
  return av;
end $$;
revoke execute on function programacion.validar_turno(bigint, timestamp, timestamp, bigint, bigint) from anon, public;
grant execute on function programacion.validar_turno(bigint, timestamp, timestamp, bigint, bigint) to authenticated;

-- Quien cubre o recibe un turno de otro puesto se revisa contra ese puesto (mismo cuerpo de 0012/0014).
do $do$
declare r record; f text;
begin
  for r in select * from (values
    ('programacion.sugerir_reemplazos(bigint, integer)', 'validar_turno(c.id, tp.inicio, tp.fin)', 'validar_turno(c.id, tp.inicio, tp.fin, null, tp.puesto_id)'),
    ('programacion.cubrir_turno(bigint, bigint, text, text)', 'validar_turno(p_empleado, tp.inicio, tp.fin)', 'validar_turno(p_empleado, tp.inicio, tp.fin, null, tp.puesto_id)'),
    ('programacion.resolver_solicitud(bigint, boolean, text)', 'validar_turno(s.empleado_destino_id, t.inicio, t.fin, t.id)', 'validar_turno(s.empleado_destino_id, t.inicio, t.fin, t.id, t.puesto_id)')
  ) x(fn, antes, despues) loop
    f := pg_get_functiondef(r.fn::regprocedure);
    if position(r.antes in f) = 0 then raise exception '% no coincide con la versión esperada', r.fn; end if;
    execute replace(f, r.antes, r.despues);
  end loop;
end $do$;

-- Habilitaciones vencidas o por vencer de guardas activos (la más reciente de cada tipo).
create or replace function programacion.habilitaciones_por_vencer(p_ciudad text, p_dias int default 30)
returns table (empleado_id bigint, nombre text, tipo text, detalle text, vence date, dias_restantes int, exigida_en_su_puesto boolean)
language sql stable security definer set search_path = '' as $$
  with ult as (
    select distinct on (h.empleado_id, h.tipo) h.*
    from programacion.habilitaciones h join programacion.empleados e on e.id = h.empleado_id
    where e.ciudad_id = p_ciudad and e.estado <> 'retirado' and programacion.puede_ver(p_ciudad)
    order by h.empleado_id, h.tipo, h.vence desc nulls first
  )
  select u.empleado_id, e.nombre, u.tipo, u.detalle, u.vence, (u.vence - current_date)::int,
    exists (select 1 from programacion.asignaciones a join programacion.puestos pu on pu.id = a.puesto_id
            where a.empleado_id = u.empleado_id and (a.hasta is null or a.hasta >= current_date)
              and ((u.tipo = 'arma' and pu.requiere_arma) or (u.tipo = 'moto' and pu.requiere_moto) or (u.tipo = 'canino' and pu.requiere_canino)))
  from ult u join programacion.empleados e on e.id = u.empleado_id
  where u.vence is not null and u.vence <= current_date + p_dias
  order by u.vence, e.nombre
$$;

-- Guardas vigentes en puestos que exigen algo que no tienen hoy.
create or replace function programacion.guardas_sin_habilitacion(p_ciudad text)
returns table (empleado_id bigint, nombre text, puesto_id bigint, puesto text, faltan text[])
language sql stable security definer set search_path = '' as $$
  select distinct on (a.empleado_id, a.puesto_id) a.empleado_id, e.nombre, a.puesto_id, pu.nombre,
    programacion.faltantes_habilitacion(a.empleado_id, a.puesto_id, current_date)
  from programacion.asignaciones a
  join programacion.puestos pu on pu.id = a.puesto_id
  join programacion.empleados e on e.id = a.empleado_id
  where pu.ciudad_id = p_ciudad and programacion.puede_ver(p_ciudad) and e.estado <> 'retirado'
    and (a.hasta is null or a.hasta >= current_date)
    and (pu.requiere_arma or pu.requiere_moto or pu.requiere_canino)
    and cardinality(programacion.faltantes_habilitacion(a.empleado_id, a.puesto_id, current_date)) > 0
$$;

revoke execute on function programacion.faltantes_habilitacion(bigint, bigint, date), programacion.habilitaciones_por_vencer(text, int),
  programacion.guardas_sin_habilitacion(text) from anon, public;
grant execute on function programacion.faltantes_habilitacion(bigint, bigint, date), programacion.habilitaciones_por_vencer(text, int),
  programacion.guardas_sin_habilitacion(text) to authenticated;
