-- La vista previa de puestos se multiplicaba, y el cliente podía quedar mal.
--
-- En el primer cargue real (2026-10-31) la pantalla dijo **2.250 nuevos** cuando eran **969**: 568
-- puestos salieron una vez y 467 salieron **cuatro veces**. La causa no estaba en Avancys sino en la
-- consulta: `preparar_cargue_puestos` cruzaba con `programacion.clientes` por NIT normalizado, y el
-- NIT de Jerónimo Martins está **cuatro veces** en esa tabla, escrito distinto cada vez
-- ("900480569", "900480569-CEDI JMC", "900480569-CEDI JMC-BARRANQUILLA", "…-VALLEDUPAR"). Cada
-- puesto de ese cliente se multiplicaba por cuatro.
--
-- Los datos no se duplicaron —`on conflict (avancys_id) do nothing` lo impidió, entraron 987 puestos
-- una sola vez— pero **sí quedó mal el cliente**: 409 puestos de tiendas Ara quedaron colgados de la
-- fila cuyo NIT es el de Jerónimo Martins y cuya razón social es "AGROPECUARIA LAS CABUYAS ASTRID DE
-- LONDOÑO & CIA", que es una fila corrupta heredada del Excel. Se repuntaron a mano los 421 puestos
-- afectados al cliente correcto.
--
-- Una vista previa que dice 2.250 cuando son 969 es peor que un error de datos: enseña a desconfiar
-- de la pantalla. Aquí se arregla la causa.

create or replace function programacion.preparar_cargue_puestos(p_origen text, p_archivo text, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_res jsonb;
begin
  if not programacion.es_admin() and auth.uid() is not null then raise exception 'Solo un administrador puede cargar datos'; end if;
  insert into programacion.cargues (entidad, origen, archivo, creado_por)
  values ('puestos', p_origen, p_archivo, auth.uid()) returning id into v_id;

  with entrada as (
    select distinct on (clave) * from (
      select nullif(f->>'avancys_id', '')::bigint as clave,
        nullif(regexp_replace(trim(f->>'nombre'), '\s+', ' ', 'g'), '') as nombre,
        nullif(trim(f->>'ciudad'), '') as ciudad,
        nullif(trim(f->>'municipio'), '') as municipio,
        programacion.normalizar_nit(f->>'nit_cliente') as nit,
        nullif(trim(f->>'centro_costo'), '') as centro_costo,
        nullif(trim(f->>'direccion'), '') as direccion
      from jsonb_array_elements(p_filas) f) x
    where clave is not null
  ), cmp as (
    select e.*, cl.id as cliente_id, pp.id as puesto_id, pp.engancha, pp.fila as antes_fila,
      to_jsonb(pp.fila) as antes,
      array_remove(array[
        case when pp.id is not null and e.nombre is distinct from (pp.fila).nombre then 'nombre' end,
        case when pp.id is not null and e.ciudad is distinct from (pp.fila).ciudad_id then 'ciudad' end,
        case when pp.id is not null and e.centro_costo is distinct from (pp.fila).centro_costo then 'centro_costo' end,
        case when pp.id is not null and cl.id is distinct from (pp.fila).cliente_id and cl.id is not null then 'cliente' end,
        case when pp.id is not null and e.direccion is distinct from (pp.fila).direccion and e.direccion is not null then 'direccion' end
      ], null) as cambios
    from entrada e
    -- Un solo cliente por NIT: si la tabla tiene el mismo NIT escrito de varias formas, manda el de
    -- id más bajo. Antes esto era un join y multiplicaba la fila por cada copia.
    left join lateral (
      select c.id from programacion.clientes c
      where e.nit is not null and programacion.normalizar_nit(c.nit) = e.nit
      order by c.id limit 1) cl on true
    -- Un solo puesto: primero por el id de Avancys; si no, por nombre dentro de la misma ciudad.
    left join lateral (
      select p.id, p as fila, (p.avancys_id is null) as engancha
      from programacion.puestos p
      where p.avancys_id = e.clave
         or (e.ciudad is not null and p.avancys_id is null and p.ciudad_id = e.ciudad
             and programacion.normalizar_nombre(p.nombre) = programacion.normalizar_nombre(e.nombre))
      order by (p.avancys_id is distinct from e.clave), p.id limit 1) pp on true
  )
  insert into programacion.cargue_filas (cargue_id, accion, clave, datos, antes, cambios, mensaje)
  select v_id,
    case when c.ciudad is null then 'error'
         when c.puesto_id is null then 'alta'
         when c.engancha or cardinality(c.cambios) > 0 then 'cambio'
         else 'sin_cambio' end,
    c.clave::text,
    jsonb_build_object('avancys_id', c.clave, 'nombre', c.nombre, 'ciudad', c.ciudad, 'nit_cliente', c.nit,
                       'cliente_id', c.cliente_id, 'centro_costo', c.centro_costo, 'direccion', c.direccion),
    c.antes, c.cambios,
    case when c.ciudad is null and c.municipio is not null
           then 'El municipio "' || c.municipio || '" no esta asignado a ninguna ciudad de Programacion.'
         when c.ciudad is null then 'Sin ciudad: ninguna orden de servicio activa dice donde queda, o dicen dos ciudades distintas.'
         when c.engancha then 'Engancha con un puesto que venia del Excel: le queda el id de Avancys.'
         when c.nit is not null and c.cliente_id is null then 'El cliente ' || c.nit || ' todavia no esta en Programacion: el puesto entra sin cliente.'
    end
  from cmp c;

  select jsonb_object_agg(accion, n) into v_res from (select accion, count(*) n from programacion.cargue_filas where cargue_id = v_id group by accion) x;
  update programacion.cargues set resumen = coalesce(v_res, '{}') where id = v_id;
  return jsonb_build_object('cargue_id', v_id, 'resumen', coalesce(v_res, '{}'),
    'enganchados', (select count(*) from programacion.cargue_filas where cargue_id = v_id and mensaje like 'Engancha%'),
    'sin_ciudad', (select count(*) from programacion.cargue_filas where cargue_id = v_id and accion = 'error'));
end $$;
