-- El primer periodo de una ciudad.
--
-- `abrir_periodo` exige un periodo anterior del que heredar las asignaciones —"No hay periodo
-- anterior de % para tomar las asignaciones"— porque fue escrito para la operación normal: un mes
-- sigue al otro y la gente sigue en su puesto. Una ciudad que arranca no tiene de dónde heredar, así
-- que hasta hoy no había forma de abrirle el primero.
--
-- Esto no es un dato que falte: es un hueco del producto. Lo va a encontrar toda ciudad nueva, y hoy
-- lo encontraron cuatro a la vez (Medellín, Bogotá, Cali y Manizales), que ya tienen su gente de
-- Avancys pero ningún periodo donde programarla.
--
-- `abrir_primer_periodo` crea el periodo vacío y nada más: sin asignaciones y sin turnos, porque no
-- hay de dónde sacarlos. Quien programe la ciudad asigna su gente a sus puestos y de ahí en adelante
-- `abrir_periodo` ya funciona, porque habrá un periodo anterior.
--
-- Se niega si la ciudad ya tiene periodos, para que nadie la use por equivocación en vez de
-- `abrir_periodo` y pierda el arrastre de las asignaciones.

create or replace function programacion.abrir_primer_periodo(p_ciudad text, p_inicio date, p_fin date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_periodo bigint;
begin
  if not programacion.es_admin() and auth.uid() is not null then
    raise exception 'Solo un administrador de Programación puede abrir periodos';
  end if;
  if not exists (select 1 from programacion.ciudades where id = p_ciudad) then
    raise exception 'La ciudad % no existe', p_ciudad;
  end if;
  if p_fin < p_inicio then raise exception 'La fecha final es anterior a la inicial'; end if;
  if exists (select 1 from programacion.periodos where ciudad_id = p_ciudad) then
    raise exception 'La ciudad % ya tiene periodos. Use abrir_periodo, que arrastra las asignaciones del anterior.', p_ciudad;
  end if;

  -- `parametros_id` lo pone el disparador `parametros_del_periodo`.
  insert into programacion.periodos (ciudad_id, inicio, fin, estado)
  values (p_ciudad, p_inicio, p_fin, 'abierto') returning id into v_periodo;

  insert into programacion.historial (tabla, registro_id, accion, despues, usuario)
  values ('periodos', v_periodo, 'insert',
          jsonb_build_object('ciudad', p_ciudad, 'inicio', p_inicio, 'fin', p_fin, 'primero', true), auth.uid());

  return jsonb_build_object('periodo_id', v_periodo, 'ciudad', p_ciudad, 'inicio', p_inicio, 'fin', p_fin,
                            'asignaciones', 0, 'turnos_generados', 0,
                            'nota', 'Primer periodo de la ciudad: queda vacío. Asigne la gente a sus puestos.');
end $$;

grant execute on function programacion.abrir_primer_periodo(text, date, date) to authenticated;

-- Los primeros periodos de las cuatro ciudades que ya tienen su gente de Avancys.
--
-- Bogotá, Cali y Manizales cortan el día 23, igual que Pereira, así que se les abre el periodo que
-- contiene hoy (24-oct a 23-nov) y pueden empezar a programar de una vez.
--
-- Medellín liquida por mes calendario. Octubre se acaba mañana y no tiene nada programado, así que
-- abrirlo no serviría de nada: se le abre noviembre.
select programacion.abrir_primer_periodo('bogota',    date '2026-10-24', date '2026-11-23');
select programacion.abrir_primer_periodo('cali',      date '2026-10-24', date '2026-11-23');
select programacion.abrir_primer_periodo('manizales', date '2026-10-24', date '2026-11-23');
select programacion.abrir_primer_periodo('medellin',  date '2026-11-01', date '2026-11-30');
