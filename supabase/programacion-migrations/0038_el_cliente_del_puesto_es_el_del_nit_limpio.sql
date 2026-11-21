-- El cliente de un puesto es el del NIT limpio, no el del id más bajo.
--
-- La 0037 desempataba por `c.id` cuando el mismo NIT aparecía varias veces. Con los clientes ya
-- traídos de Avancys (2026-11-02, de 144 a 1.440) quedó claro que ese desempate escoge mal: de las
-- cuatro filas del NIT de Jerónimo Martins, la de id más bajo es "900480569-CEDI JMC", una variante
-- que dejó el Excel, y la buena es "900480569". Un recargue de puestos habría devuelto los 447
-- puestos de ese cliente a la fila vieja.
--
-- Ahora manda el que esté activo y cuyo NIT esté escrito limpio. Las cinco filas residuales del
-- Excel —tres variantes de ese NIT y dos cuyo "NIT" es un texto de experiencia laboral— quedaron
-- inactivadas el 2026-11-02, con su razón anotada en el campo de notas.

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
    -- Un solo cliente por NIT. Cuando el mismo NIT está varias veces —el Excel dejó variantes como
    -- "900480569-CEDI JMC-BARRANQUILLA"— manda el que esté activo y cuyo NIT esté limpio, no el de
    -- id más bajo: el más viejo suele ser justamente el que trae el sufijo.
    left join lateral (
      select c.id from programacion.clientes c
      where e.nit is not null and programacion.normalizar_nit(c.nit) = e.nit
      order by c.activo desc, (programacion.normalizar_nit(c.nit) = c.nit) desc, c.id
      limit 1) cl on true
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
