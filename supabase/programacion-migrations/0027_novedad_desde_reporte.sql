-- Una sola vez (decisión de Juan, 2026-10-17): al resolver un reporte de un guarda que faltó, se crea
-- sola la novedad "por revisar" en Novedades. Llega como ausencia provisional; el programador confirma
-- qué fue (incapacidad, permiso, ausencia…) al aplicarla, sin tener que registrarla otra vez.

alter table programacion.solicitudes
  add column if not exists tipo_por_confirmar boolean not null default false,
  add column if not exists alerta_reportada_id bigint references programacion.alertas_reportadas(id);
create unique index if not exists solicitudes_alerta_reportada on programacion.solicitudes (alerta_reportada_id) where alerta_reportada_id is not null;

create or replace function programacion.resolver_alerta_reportada(p_id bigint, p_empleado bigint, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r programacion.alertas_reportadas; t programacion.turnos; v_av text[]; v_turno bigint; v_nov bigint;
begin
  select * into r from programacion.alertas_reportadas where id = p_id for update;
  if r.id is null then raise exception 'Reporte no encontrado'; end if;
  if not programacion.puede_editar(r.ciudad_id) or not programacion.puede_editar(programacion.ciudad_de_empleado(p_empleado)) then
    raise exception 'No tiene permiso para resolver este reporte';
  end if;
  if r.estado in ('resuelta', 'cerrada') then raise exception 'El reporte ya fue resuelto'; end if;
  if r.empleado_id is not null then
    select * into t from programacion.turnos where empleado_id = r.empleado_id and inicio < r.hasta and fin > r.desde
      and (r.puesto_id is null or puesto_id = r.puesto_id) order by inicio limit 1 for update;
  end if;
  if t.id is not null then
    v_av := programacion.validar_turno(p_empleado, t.inicio, t.fin, t.id, t.puesto_id);
  else
    v_av := programacion.validar_turno(p_empleado, r.desde, r.hasta, null, r.puesto_id);
  end if;
  if 'cruce' = any(v_av) then raise exception 'El guarda ya tiene un turno que se cruza con ese horario'; end if;
  if cardinality(v_av) > 0 and coalesce(trim(p_comentario), '') = '' then raise exception 'MOTIVO_REQUERIDO:%', array_to_string(v_av, ','); end if;
  if t.id is not null then
    update programacion.turnos set empleado_id = p_empleado, origen = 'cambio',
      comentario = coalesce(p_comentario, 'Reemplazo por reporte ' || r.id || ' (Alertas del día)') where id = t.id;
    v_turno := t.id;
  else
    insert into programacion.turnos (empleado_id, puesto_id, inicio, fin, origen, comentario, creado_por)
    values (p_empleado, r.puesto_id, r.desde, r.hasta, 'apoyo', coalesce(p_comentario, 'Cubre por reporte ' || r.id || ' (Alertas del día)'),
      public.psi_sales_current_profile_id())
    returning id into v_turno;
  end if;
  update programacion.alertas_reportadas set estado = 'resuelta', reemplazo_empleado_id = p_empleado, turno_id = v_turno,
    nota = nullif(trim(p_comentario), ''), resuelta_por = public.psi_sales_current_profile_id(), resuelta_en = now(),
    tomada_por = coalesce(tomada_por, public.psi_sales_current_profile_id()), tomada_en = coalesce(tomada_en, now())
  where id = r.id;
  -- El guarda que faltó queda como novedad por revisar (el programador confirma qué fue y la aplica).
  if r.empleado_id is not null and r.tipo in ('turno_por_cubrir', 'no_marco', 'no_respondio')
     and not exists (select 1 from programacion.solicitudes where alerta_reportada_id = r.id) then
    insert into programacion.solicitudes (ciudad_id, empleado_id, tipo, subtipo, desde, hasta, detalle, canal, origen, documento,
      reportado_por, tipo_por_confirmar, alerta_reportada_id, creado_por)
    values (r.ciudad_id, r.empleado_id, 'novedad', 'ausencia', r.desde::date, r.desde::date,
      concat_ws(' · ', 'Desde Alertas del día', (select 'Cubrió ' || e.nombre from programacion.empleados e where e.id = p_empleado), r.detalle),
      case when r.origen = 'securityops' then 'securityops' else 'llamada' end, r.origen, r.documento, r.reportado_por, true, r.id, auth.uid())
    returning id into v_nov;
  end if;
  return jsonb_build_object('turno_id', v_turno, 'avisos', v_av, 'movido', t.id is not null, 'novedad_id', v_nov);
end $$;

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
  -- Novedad creada desde un reporte de Alertas del día: al aplicar se confirma qué fue (sin pedir motivo).
  if p_accion = 'aplicar' and s.tipo_por_confirmar then
    if p_subtipo is null then raise exception 'Confirme qué fue: incapacidad, permiso, ausencia…'; end if;
    if p_subtipo not in ('incapacidad', 'permiso_remunerado', 'permiso_no_remunerado', 'ausencia', 'vacaciones', 'sancion') then
      raise exception 'Tipo de novedad no válido';
    end if;
    v_tipo := p_subtipo;
  end if;
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
    subtipo = case when s.tipo_por_confirmar and p_accion = 'aplicar' then v_tipo else subtipo end,
    tipo_por_confirmar = false,
    motivo = nullif(trim(p_motivo), ''),
    ajuste = case when p_accion = 'aplicar_con_ajuste' then jsonb_build_object('de', s.subtipo, 'a', v_tipo) end,
    resultado = r, resuelta_por = auth.uid(), resuelta_en = now()
  where id = s.id;
  return jsonb_build_object('estado', case when p_accion = 'aplicar_con_ajuste' then 'aplicada_con_ajuste' else 'aplicada' end, 'resultado', r);
end $$;
