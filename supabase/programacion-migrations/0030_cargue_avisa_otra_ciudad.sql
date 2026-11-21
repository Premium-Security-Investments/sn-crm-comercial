-- El cargue avisa cuando la persona ya está registrada en otra ciudad.
--
-- Encontrado el 2026-10-29 al traer Medellín: el cargue reportó "673 altas y 24 cambios" aunque
-- Medellín no tenía ningún empleado. Esos 24 ya existían en la lista de Pereira —el Excel de Pereira
-- les pagaba— y el cargue los actualizó en silencio, dejándolos en Pereira. Nada en la pantalla decía
-- que esas 24 personas estaban en otra ciudad.
--
-- El cargue NO los mueve de ciudad, y es a propósito: `programacion.ciudad_de_empleado` sale de
-- `empleados.ciudad_id` y gobierna dos cosas, el cierre del periodo (`cerrar_periodo` solo toma a los
-- empleados cuya ciudad es la del periodo) y las políticas de RLS de turnos, novedades y asignaciones.
-- Mover a alguien de ciudad le quitaría sus turnos a la ciudad donde los trabajó: esos 24 tienen
-- 1.016 turnos en los periodos de Pereira. Cambiar de ciudad a una persona es una decisión aparte, no
-- un efecto secundario de un cargue.
--
-- Lo único que cambia aquí es que esas filas lo digan. El resto de la función queda igual.

create or replace function programacion.preparar_cargue_empleados(p_ciudad text, p_origen text, p_archivo text, p_filas jsonb, p_marcar_ausentes boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_res jsonb;
begin
  if not programacion.es_admin() and auth.uid() is not null then raise exception 'Solo un administrador puede cargar datos'; end if;
  insert into programacion.cargues (entidad, origen, ciudad_id, archivo, creado_por)
  values ('empleados', p_origen, p_ciudad, p_archivo, auth.uid()) returning id into v_id;

  with entrada as (
    select programacion.normalizar_documento(f->>'documento') as doc,
      coalesce(nullif(upper(trim(f->>'tipo_documento')), ''), 'CC') as tipo,
      nullif(upper(regexp_replace(trim(f->>'nombre'), '\s+', ' ', 'g')), '') as nombre,
      nullif(lower(trim(f->>'cargo')), '') as cargo,
      nullif(f->>'fecha_ingreso', '')::date as fecha_ingreso,
      nullif(f->>'fecha_retiro', '')::date as fecha_retiro,
      case when nullif(f->>'fecha_retiro', '') is not null and (f->>'fecha_retiro')::date <= current_date then 'retirado'
           else coalesce(nullif(lower(trim(f->>'estado')), ''), 'activo') end as estado,
      nullif(regexp_replace(coalesce(f->>'telefono', ''), '[^0-9+]', '', 'g'), '') as telefono,
      f as crudo
    from jsonb_array_elements(p_filas) f
  ), dedup as (
    select distinct on (doc) * from entrada where doc is not null order by doc
  ), cmp as (
    select d.*, e.id as emp_id, e.ciudad_id as ciudad_actual, to_jsonb(e) as antes,
      array_remove(array[
        case when e.id is not null and d.nombre is distinct from e.nombre and d.nombre is not null then 'nombre' end,
        case when e.id is not null and d.cargo is not null and d.cargo is distinct from e.cargo then 'cargo' end,
        case when e.id is not null and d.fecha_ingreso is not null and d.fecha_ingreso is distinct from e.fecha_ingreso then 'fecha_ingreso' end,
        case when e.id is not null and d.fecha_retiro is distinct from e.fecha_retiro and d.fecha_retiro is not null then 'fecha_retiro' end,
        case when e.id is not null and d.telefono is not null and d.telefono is distinct from e.telefono then 'telefono' end,
        case when e.id is not null and d.estado is distinct from e.estado and d.estado <> 'retirado' then 'estado' end
      ], null) as cambios
    from dedup d
    left join programacion.empleados e on programacion.normalizar_documento(e.documento) = d.doc
  )
  insert into programacion.cargue_filas (cargue_id, accion, clave, datos, antes, cambios, mensaje)
  select v_id,
    case when c.nombre is null and c.emp_id is null then 'error'
         when c.emp_id is null then 'alta'
         when c.estado = 'retirado' and (c.antes->>'estado') <> 'retirado' then 'retiro'
         when cardinality(c.cambios) > 0 then 'cambio'
         else 'sin_cambio' end,
    c.doc,
    jsonb_build_object('tipo_documento', c.tipo, 'documento', c.doc, 'nombre', c.nombre, 'cargo', c.cargo,
      'fecha_ingreso', c.fecha_ingreso, 'fecha_retiro', c.fecha_retiro, 'estado', c.estado, 'telefono', c.telefono),
    case when c.emp_id is null then null else c.antes - 'habilitaciones' end,
    c.cambios,
    case when c.nombre is null and c.emp_id is null then 'Falta el nombre'
         when c.emp_id is not null and c.ciudad_actual is distinct from p_ciudad
           then 'Ya está registrado en ' || coalesce(c.ciudad_actual, 'otra ciudad')
                || '. Este cargue actualiza sus datos pero no lo mueve de ciudad: sus turnos quedaron allá.'
    end
  from cmp c;

  -- filas sin documento
  insert into programacion.cargue_filas (cargue_id, accion, datos, mensaje)
  select v_id, 'error', f, 'Falta el documento' from jsonb_array_elements(p_filas) f
  where programacion.normalizar_documento(f->>'documento') is null;

  -- activos de la ciudad que no vienen en el archivo (no se retiran solos: se marcan para revisar)
  if p_marcar_ausentes then
    insert into programacion.cargue_filas (cargue_id, accion, clave, antes, mensaje, aplicar)
    select v_id, 'no_viene', programacion.normalizar_documento(e.documento), to_jsonb(e) - 'habilitaciones',
      'Está activo aquí pero no viene en el cargue', false
    from programacion.empleados e
    where e.ciudad_id = p_ciudad and e.estado <> 'retirado' and e.tipo_documento <> 'NA'
      and programacion.normalizar_documento(e.documento) not in (
        select programacion.normalizar_documento(f->>'documento') from jsonb_array_elements(p_filas) f
        where programacion.normalizar_documento(f->>'documento') is not null);
  end if;

  select jsonb_object_agg(accion, n) into v_res from (select accion, count(*) n from programacion.cargue_filas where cargue_id = v_id group by accion) x;
  update programacion.cargues set resumen = coalesce(v_res, '{}') where id = v_id;
  return jsonb_build_object('cargue_id', v_id, 'resumen', coalesce(v_res, '{}'),
    'en_otra_ciudad', (select count(*) from programacion.cargue_filas where cargue_id = v_id and mensaje like 'Ya está registrado en %'));
end $$;
