-- Bandeja de solicitudes del personal y bandeja de salida de mensajes.
-- Entran por la app (el coordinador registra lo que le reportaron), y más adelante por WhatsApp a
-- través de Vig-IA. Un coordinador o administrador de la ciudad las aprueba o rechaza; al aprobar,
-- la base hace el cambio (novedad, cesión de turno) y deja la respuesta para enviar al guarda.

create table if not exists programacion.solicitudes (
  id                  bigint generated always as identity primary key,
  ciudad_id           text not null references programacion.ciudades(id),
  empleado_id         bigint references programacion.empleados(id),
  tipo                text not null check (tipo in ('novedad', 'llegada_tarde', 'ceder_turno', 'otro')),
  subtipo             text,                 -- para novedad: incapacidad, permiso_remunerado, ausencia…
  desde               date,
  hasta               date,
  turno_id            bigint references programacion.turnos(id) on delete set null,
  empleado_destino_id bigint references programacion.empleados(id),
  detalle             text,                 -- lo que dijo la persona, tal cual
  soporte_url         text,                 -- foto de la incapacidad u otro soporte (más adelante)
  canal               text not null default 'app' check (canal in ('app', 'llamada', 'whatsapp', 'vigia')),
  propuesta           jsonb,                -- lo que propone Vig-IA (p. ej. reemplazo sugerido)
  estado              text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'anulada')),
  respuesta           text,
  resultado           jsonb,
  creado_por          uuid,
  creado_en           timestamptz not null default now(),
  resuelta_por        uuid,
  resuelta_en         timestamptz,
  check (tipo <> 'novedad' or (subtipo in ('incapacidad', 'permiso_remunerado', 'permiso_no_remunerado', 'ausencia', 'vacaciones', 'sancion') and desde is not null)),
  check (hasta is null or desde is null or hasta >= desde)
);
create index if not exists solicitudes_ciudad_estado on programacion.solicitudes (ciudad_id, estado, creado_en);

-- Mensajes para enviar al personal (WhatsApp vía Vig-IA). La app los deja; el canal los envía.
create table if not exists programacion.mensajes_salientes (
  id           bigint generated always as identity primary key,
  empleado_id  bigint references programacion.empleados(id),
  telefono     text,
  canal        text not null default 'whatsapp',
  texto        text not null,
  solicitud_id bigint references programacion.solicitudes(id),
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'fallido', 'sin_telefono')),
  creado_en    timestamptz not null default now(),
  enviado_en   timestamptz,
  error        text
);

alter table programacion.solicitudes enable row level security;
alter table programacion.mensajes_salientes enable row level security;
grant select on programacion.solicitudes, programacion.mensajes_salientes to authenticated;
create policy ver on programacion.solicitudes for select to authenticated using (programacion.puede_ver(ciudad_id));
create policy ver on programacion.mensajes_salientes for select to authenticated
  using (empleado_id in (select programacion.empleados_visibles()));

create trigger historial_solicitudes after insert or update or delete on programacion.solicitudes
  for each row execute function programacion.registrar_historial();

-- Crear una solicitud (coordinador o admin desde la app; Vig-IA desde el servidor con su propia credencial).
create or replace function programacion.crear_solicitud(
  p_empleado bigint, p_tipo text, p_subtipo text default null, p_desde date default null, p_hasta date default null,
  p_turno bigint default null, p_empleado_destino bigint default null, p_detalle text default null,
  p_canal text default 'app', p_propuesta jsonb default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_ciudad text; v_id bigint;
begin
  v_ciudad := programacion.ciudad_de_empleado(p_empleado);
  if v_ciudad is null then raise exception 'Guarda no encontrado'; end if;
  if not programacion.puede_editar(v_ciudad) and coalesce(auth.role(), '') <> 'service_role' and auth.uid() is not null then
    raise exception 'No tiene permiso para registrar solicitudes de este guarda';
  end if;
  if p_tipo = 'ceder_turno' and (p_turno is null or p_empleado_destino is null) then
    raise exception 'Para ceder un turno indique el turno y el compañero que lo toma';
  end if;
  insert into programacion.solicitudes (ciudad_id, empleado_id, tipo, subtipo, desde, hasta, turno_id, empleado_destino_id,
    detalle, canal, propuesta, creado_por)
  values (v_ciudad, p_empleado, p_tipo, p_subtipo, p_desde, coalesce(p_hasta, p_desde), p_turno, p_empleado_destino,
    p_detalle, p_canal, p_propuesta, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Turnos que afecta una solicitud (para mostrar en la bandeja).
create or replace function programacion.turnos_de_solicitud(p_solicitud bigint)
returns table (turno_id bigint, puesto text, inicio timestamp, fin timestamp)
language sql stable security definer set search_path = '' as $$
  select t.id, p.nombre, t.inicio, t.fin
  from programacion.solicitudes s
  join programacion.turnos t on (s.turno_id is not null and t.id = s.turno_id)
    or (s.turno_id is null and t.empleado_id = s.empleado_id and s.desde is not null and t.inicio::date between s.desde and coalesce(s.hasta, s.desde))
  left join programacion.puestos p on p.id = t.puesto_id
  where s.id = p_solicitud and programacion.puede_ver(s.ciudad_id)
  order by t.inicio
$$;

-- Aprobar o rechazar. Al aprobar hace el cambio y deja el mensaje de respuesta al guarda.
create or replace function programacion.resolver_solicitud(p_solicitud bigint, p_aprobar boolean, p_respuesta text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s programacion.solicitudes; r jsonb := '{}'; t programacion.turnos; v_av text[]; v_tel text; v_txt text;
  ETIQ constant jsonb := '{"incapacidad":"incapacidad","permiso_remunerado":"permiso remunerado","permiso_no_remunerado":"permiso no remunerado","ausencia":"ausencia","vacaciones":"vacaciones","sancion":"sanción"}';
begin
  select * into s from programacion.solicitudes where id = p_solicitud for update;
  if s.id is null then raise exception 'Solicitud no encontrada'; end if;
  if not programacion.puede_editar(s.ciudad_id) then raise exception 'No tiene permiso para resolver solicitudes de esta ciudad'; end if;
  if s.estado <> 'pendiente' then raise exception 'La solicitud ya fue resuelta'; end if;
  if not p_aprobar and coalesce(trim(p_respuesta), '') = '' then raise exception 'Indique el motivo del rechazo'; end if;

  if p_aprobar then
    if s.tipo = 'novedad' then
      r := programacion.registrar_novedad(s.empleado_id, s.subtipo, s.desde, coalesce(s.hasta, s.desde),
             coalesce(s.detalle, '') || ' (solicitud ' || s.id || ')');
      update programacion.novedades set estado = 'aprobada' where id = (r->>'novedad_id')::bigint;
    elsif s.tipo = 'ceder_turno' then
      select * into t from programacion.turnos where id = s.turno_id;
      if t.id is null then raise exception 'El turno ya no existe'; end if;
      v_av := programacion.validar_turno(s.empleado_destino_id, t.inicio, t.fin, t.id);
      if 'cruce' = any(v_av) then raise exception 'El compañero ya tiene un turno que se cruza con ese horario'; end if;
      if cardinality(v_av) > 0 and coalesce(trim(p_respuesta), '') = '' then
        raise exception 'MOTIVO_REQUERIDO:%', array_to_string(v_av, ',');
      end if;
      update programacion.turnos set empleado_id = s.empleado_destino_id, origen = 'cambio',
        comentario = 'Cedido por solicitud ' || s.id || coalesce(': ' || p_respuesta, '')
      where id = t.id;
      r := jsonb_build_object('turno_cedido', t.id, 'avisos', v_av);
    end if;
  end if;

  update programacion.solicitudes set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
    respuesta = p_respuesta, resultado = r, resuelta_por = auth.uid(), resuelta_en = now()
  where id = s.id;

  -- Respuesta para el guarda (la envía el canal de Vig-IA cuando esté conectado).
  select telefono into v_tel from programacion.empleados where id = s.empleado_id;
  v_txt := case
    when s.tipo = 'novedad' then format('Tu solicitud de %s del %s%s fue %s.', coalesce(ETIQ->>s.subtipo, s.subtipo), to_char(s.desde, 'DD/MM'),
             case when coalesce(s.hasta, s.desde) <> s.desde then ' al ' || to_char(s.hasta, 'DD/MM') else '' end,
             case when p_aprobar then 'aprobada' else 'rechazada' end)
    when s.tipo = 'ceder_turno' then format('Tu solicitud de ceder el turno fue %s.', case when p_aprobar then 'aprobada' else 'rechazada' end)
    else format('Tu solicitud fue %s.', case when p_aprobar then 'atendida' else 'rechazada' end) end
    || coalesce(' ' || nullif(trim(p_respuesta), ''), '');
  insert into programacion.mensajes_salientes (empleado_id, telefono, texto, solicitud_id, estado)
  values (s.empleado_id, v_tel, v_txt, s.id, case when v_tel is null then 'sin_telefono' else 'pendiente' end);
  if p_aprobar and s.tipo = 'ceder_turno' then
    select telefono into v_tel from programacion.empleados where id = s.empleado_destino_id;
    insert into programacion.mensajes_salientes (empleado_id, telefono, texto, solicitud_id, estado)
    values (s.empleado_destino_id, v_tel, format('Se te asignó un turno el %s de %s a %s.', to_char(t.inicio, 'DD/MM'), to_char(t.inicio, 'HH24:MI'), to_char(t.fin, 'HH24:MI')),
            s.id, case when v_tel is null then 'sin_telefono' else 'pendiente' end);
  end if;
  return jsonb_build_object('estado', case when p_aprobar then 'aprobada' else 'rechazada' end, 'resultado', r);
end $$;

-- El tablero cuenta las solicitudes pendientes.
create or replace function programacion.solicitudes_pendientes(p_ciudad text)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from programacion.solicitudes where ciudad_id = p_ciudad and estado = 'pendiente' and programacion.puede_ver(p_ciudad)
$$;

revoke execute on function programacion.crear_solicitud(bigint, text, text, date, date, bigint, bigint, text, text, jsonb),
  programacion.turnos_de_solicitud(bigint), programacion.resolver_solicitud(bigint, boolean, text),
  programacion.solicitudes_pendientes(text) from anon, public;
grant execute on function programacion.crear_solicitud(bigint, text, text, date, date, bigint, bigint, text, text, jsonb),
  programacion.turnos_de_solicitud(bigint), programacion.resolver_solicitud(bigint, boolean, text),
  programacion.solicitudes_pendientes(text) to authenticated;
