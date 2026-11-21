-- Solicitudes → Novedades reportadas por Operaciones (decisión de Juan, 2026-10-16).
-- La operación del día vive en SecurityOps: allá se aprueba la novedad y se decide quién cubre.
-- A Programación le llega lo que pasó; una persona de Programación revisa cada novedad y escoge:
--   aplicar            → se refleja tal como llegó (novedad, cambio de turno);
--   aplicar con ajuste → se aplica cambiando cómo cuenta para la nómina (p. ej. incapacidad sin
--                        soporte → ausencia), con motivo;
--   devolver a Ops     → faltan datos o hay un error; no se aplica.
-- Mientras SecurityOps no las envíe solas, Programación las registra a mano.
-- La tabla conserva su nombre (solicitudes) para no romper lo existente.

alter table programacion.solicitudes drop constraint if exists solicitudes_estado_check;
update programacion.solicitudes set estado = case estado
  when 'pendiente' then 'por_revisar' when 'aprobada' then 'aplicada' when 'rechazada' then 'devuelta' else estado end;
alter table programacion.solicitudes alter column estado set default 'por_revisar';
alter table programacion.solicitudes add constraint solicitudes_estado_check
  check (estado in ('por_revisar', 'aplicada', 'aplicada_con_ajuste', 'devuelta', 'anulada'));

alter table programacion.solicitudes drop constraint if exists solicitudes_canal_check;
alter table programacion.solicitudes add constraint solicitudes_canal_check
  check (canal in ('app', 'llamada', 'whatsapp', 'vigia', 'securityops'));

alter table programacion.solicitudes
  add column if not exists origen text not null default 'manual' check (origen in ('manual', 'securityops')),
  add column if not exists id_externo text,                 -- número del reporte en SecurityOps
  add column if not exists documento text,                  -- cédula reportada (aunque el guarda no exista aquí)
  add column if not exists documento_destino text,          -- cédula de quien cubrió
  add column if not exists cubre_inicio timestamp,          -- horario en que cubrió (si Ops lo reporta)
  add column if not exists cubre_fin timestamp,
  add column if not exists reportado_por text,              -- quién lo reportó en Ops (supervisor, radio operador…)
  add column if not exists motivo text,                     -- motivo del ajuste o de la devolución
  add column if not exists ajuste jsonb;                    -- {"de": "incapacidad", "a": "ausencia"}
create unique index if not exists solicitudes_id_externo on programacion.solicitudes (origen, id_externo) where id_externo is not null;
comment on table programacion.solicitudes is
  'Novedades reportadas (por Operaciones o registradas a mano). Una persona de Programación las aplica, las aplica con ajuste o las devuelve.';

-- La novedad con reemplazo deja de exigir el turno: basta la fecha y quién cubrió.
alter table programacion.solicitudes drop constraint if exists solicitudes_check;
alter table programacion.solicitudes drop constraint if exists solicitudes_check1;
alter table programacion.solicitudes add constraint solicitudes_novedad_check
  check (tipo <> 'novedad' or (subtipo in ('incapacidad', 'permiso_remunerado', 'permiso_no_remunerado', 'ausencia', 'vacaciones', 'sancion') and desde is not null));
alter table programacion.solicitudes add constraint solicitudes_fechas_check check (hasta is null or desde is null or hasta >= desde);
alter table programacion.solicitudes add constraint solicitudes_cubre_check check (cubre_fin is null or cubre_inicio is null or cubre_fin > cubre_inicio);

-- Guarda por cédula (sin puntos ni espacios).
create or replace function programacion.empleado_por_documento(p_documento text)
returns bigint language sql stable security definer set search_path = '' as $$
  select e.id from programacion.empleados e
  where regexp_replace(e.documento, '\D', '', 'g') = regexp_replace(coalesce(p_documento, ''), '\D', '', 'g')
    and regexp_replace(coalesce(p_documento, ''), '\D', '', 'g') <> ''
  order by (e.estado = 'retirado'), e.id limit 1
$$;

-- Registrar una novedad reportada. La usa Programación (a mano) y, más adelante, la conexión con
-- SecurityOps (con su credencial de servidor y el número del reporte, sin duplicar).
create or replace function programacion.registrar_novedad_reportada(
  p_ciudad text, p_tipo text, p_documento text, p_subtipo text default null, p_desde date default null, p_hasta date default null,
  p_documento_destino text default null, p_cubre_inicio timestamp default null, p_cubre_fin timestamp default null,
  p_turno bigint default null, p_detalle text default null, p_canal text default 'llamada', p_origen text default 'manual',
  p_id_externo text default null, p_reportado_por text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_emp bigint; v_dest bigint;
begin
  if not programacion.puede_editar(p_ciudad) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No tiene permiso para registrar novedades en esta ciudad';
  end if;
  if coalesce(trim(p_documento), '') = '' then raise exception 'Indique la cédula del guarda'; end if;
  if p_tipo not in ('novedad', 'llegada_tarde', 'ceder_turno', 'otro') then raise exception 'Tipo de novedad no válido'; end if;
  if p_tipo <> 'ceder_turno' and p_desde is null then raise exception 'Indique la fecha'; end if;
  if p_id_externo is not null then
    select id into v_id from programacion.solicitudes where origen = p_origen and id_externo = p_id_externo;
    if v_id is not null then return v_id; end if;
  end if;
  v_emp := programacion.empleado_por_documento(p_documento);
  v_dest := programacion.empleado_por_documento(p_documento_destino);
  insert into programacion.solicitudes (ciudad_id, empleado_id, tipo, subtipo, desde, hasta, turno_id, empleado_destino_id,
    detalle, canal, origen, id_externo, documento, documento_destino, cubre_inicio, cubre_fin, reportado_por, creado_por)
  values (p_ciudad, v_emp, p_tipo, case when p_tipo = 'novedad' then p_subtipo end, p_desde, coalesce(p_hasta, p_desde), p_turno, v_dest,
    nullif(trim(p_detalle), ''), p_canal, p_origen, p_id_externo, trim(p_documento), nullif(trim(p_documento_destino), ''),
    p_cubre_inicio, p_cubre_fin, nullif(trim(p_reportado_por), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Revisar una novedad: aplicar, aplicar con ajuste o devolver a Ops.
create or replace function programacion.revisar_novedad(p_id bigint, p_accion text, p_subtipo text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s programacion.solicitudes; v_tipo text; v_nov bigint; v_av text[]; r jsonb := '{}'; t record; v_movidos int := 0; v_quitados int := 0;
  v_ini timestamp; v_fin timestamp;
begin
  select * into s from programacion.solicitudes where id = p_id for update;
  if s.id is null then raise exception 'Novedad no encontrada'; end if;
  if not programacion.puede_editar(s.ciudad_id) then raise exception 'No tiene permiso para revisar novedades de esta ciudad'; end if;
  if s.estado <> 'por_revisar' then raise exception 'La novedad ya fue revisada'; end if;
  if p_accion not in ('aplicar', 'aplicar_con_ajuste', 'devolver') then raise exception 'Acción no válida'; end if;

  if p_accion = 'devolver' then
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Indique qué debe corregir Operaciones'; end if;
    update programacion.solicitudes set estado = 'devuelta', motivo = trim(p_motivo), resuelta_por = auth.uid(), resuelta_en = now() where id = s.id;
    return jsonb_build_object('estado', 'devuelta');
  end if;

  if s.empleado_id is null then raise exception 'La cédula % no existe en Programación: devuélvala a Operaciones o cargue primero al guarda', s.documento; end if;
  if s.documento_destino is not null and s.empleado_destino_id is null then
    raise exception 'La cédula de quien cubrió (%) no existe en Programación', s.documento_destino;
  end if;

  v_tipo := s.subtipo;
  if p_accion = 'aplicar_con_ajuste' then
    if s.tipo <> 'novedad' then raise exception 'Solo las novedades (incapacidad, permiso, ausencia…) se pueden aplicar con ajuste'; end if;
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Indique el motivo del ajuste'; end if;
    if p_subtipo is null or p_subtipo = s.subtipo then raise exception 'Escoja cómo debe contar para la nómina'; end if;
    if p_subtipo not in ('incapacidad', 'permiso_remunerado', 'permiso_no_remunerado', 'ausencia', 'vacaciones', 'sancion') then
      raise exception 'Tipo de novedad no válido';
    end if;
    v_tipo := p_subtipo;
  end if;

  if s.tipo = 'novedad' then
    insert into programacion.novedades (empleado_id, tipo, desde, hasta, comentario, estado, creado_por)
    values (s.empleado_id, v_tipo, s.desde, coalesce(s.hasta, s.desde),
      concat_ws(' · ', 'Novedad reportada ' || s.id, s.detalle, case when p_accion = 'aplicar_con_ajuste' then 'Ajuste: ' || trim(p_motivo) end),
      'aprobada', public.psi_sales_current_profile_id())
    returning id into v_nov;
    -- Turnos del guarda en esas fechas: si alguien cubrió, pasan a esa persona; si no, quedan sin cubrir.
    for t in select * from programacion.turnos where empleado_id = s.empleado_id and inicio::date between s.desde and coalesce(s.hasta, s.desde) order by inicio loop
      if s.empleado_destino_id is not null then
        -- El horario reportado solo aplica si la novedad es de un día; si no, se conserva el de cada turno.
        v_ini := case when coalesce(s.hasta, s.desde) = s.desde then coalesce(s.cubre_inicio, t.inicio) else t.inicio end;
        v_fin := case when coalesce(s.hasta, s.desde) = s.desde then coalesce(s.cubre_fin, t.fin) else t.fin end;
        v_av := programacion.validar_turno(s.empleado_destino_id, v_ini, v_fin, t.id);
        if 'cruce' = any(v_av) then raise exception 'Quien cubrió ya tiene un turno que se cruza el %: devuélvala a Operaciones', to_char(t.inicio, 'DD/MM HH24:MI'); end if;
        update programacion.turnos set empleado_id = s.empleado_destino_id, origen = 'cambio', inicio = v_ini, fin = v_fin,
          comentario = 'Cubre por novedad reportada ' || s.id where id = t.id;
        v_movidos := v_movidos + 1;
      else
        delete from programacion.turnos where id = t.id;
        v_quitados := v_quitados + 1;
      end if;
    end loop;
    r := jsonb_build_object('novedad_id', v_nov, 'turnos_cubiertos', v_movidos, 'turnos_sin_cubrir', v_quitados);
  elsif s.tipo = 'ceder_turno' then
    select * into t from programacion.turnos where id = s.turno_id;
    if t.id is null then
      select * into t from programacion.turnos where empleado_id = s.empleado_id and inicio::date = s.desde order by inicio limit 1;
    end if;
    if t.id is null then raise exception 'No se encontró el turno del guarda ese día: devuélvala a Operaciones'; end if;
    if s.empleado_destino_id is null then raise exception 'Falta quién tomó el turno'; end if;
    v_av := programacion.validar_turno(s.empleado_destino_id, coalesce(s.cubre_inicio, t.inicio), coalesce(s.cubre_fin, t.fin), t.id);
    if 'cruce' = any(v_av) then raise exception 'Quien tomó el turno ya tiene otro que se cruza: devuélvala a Operaciones'; end if;
    update programacion.turnos set empleado_id = s.empleado_destino_id, origen = 'cambio',
      inicio = coalesce(s.cubre_inicio, inicio), fin = coalesce(s.cubre_fin, fin),
      comentario = 'Cambio por novedad reportada ' || s.id where id = t.id;
    r := jsonb_build_object('turno_cambiado', t.id, 'avisos', v_av);
  end if;
  -- llegada_tarde y otro: quedan registradas para el cierre; el efecto en nómina lo define Nómina.

  update programacion.solicitudes set
    estado = case when p_accion = 'aplicar_con_ajuste' then 'aplicada_con_ajuste' else 'aplicada' end,
    motivo = nullif(trim(p_motivo), ''),
    ajuste = case when p_accion = 'aplicar_con_ajuste' then jsonb_build_object('de', s.subtipo, 'a', v_tipo) end,
    resultado = r, resuelta_por = auth.uid(), resuelta_en = now()
  where id = s.id;
  return jsonb_build_object('estado', case when p_accion = 'aplicar_con_ajuste' then 'aplicada_con_ajuste' else 'aplicada' end, 'resultado', r);
end $$;

-- El menú y el tablero cuentan las novedades por revisar.
create or replace function programacion.solicitudes_pendientes(p_ciudad text)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from programacion.solicitudes where ciudad_id = p_ciudad and estado = 'por_revisar' and programacion.puede_ver(p_ciudad)
$$;

-- Lo anterior (aprobar o rechazar la solicitud del guarda y responderle) ya no aplica: la decisión es de Ops.
drop function if exists programacion.resolver_solicitud(bigint, boolean, text);
drop function if exists programacion.crear_solicitud(bigint, text, text, date, date, bigint, bigint, text, text, jsonb);

revoke execute on function programacion.empleado_por_documento(text),
  programacion.registrar_novedad_reportada(text, text, text, text, date, date, text, timestamp, timestamp, bigint, text, text, text, text, text),
  programacion.revisar_novedad(bigint, text, text, text) from anon, public;
grant execute on function programacion.registrar_novedad_reportada(text, text, text, text, date, date, text, timestamp, timestamp, bigint, text, text, text, text, text),
  programacion.revisar_novedad(bigint, text, text, text) to authenticated;
