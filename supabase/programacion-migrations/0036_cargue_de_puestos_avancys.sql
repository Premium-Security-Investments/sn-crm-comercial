-- Traer los puestos de Avancys, por la misma puerta de siempre: vista previa y aprobación.
--
-- Hasta el 2026-10-30 esto estaba bloqueado porque "Avancys no sabe en qué ciudad queda un puesto".
-- **Era falso, y el error estuvo en dónde se buscó.** La ciudad no está en `hr.roster.puesto`: está
-- en la línea de la orden de servicio (`project.service.order.line.city_id`), que es lo que se le
-- vende al cliente. En Avancys el puesto es un objeto comercial, no de personal; por eso el precio,
-- la ciudad y hasta los vigilantes asignados viven todos en la orden de servicio.
--
-- Medido el 2026-10-31 sobre las 6.217 líneas activas: 3.429 puestos con orden, **1.035 con ciudad**,
-- y ninguno con dos ciudades distintas. Donde el dato está, está limpio.
--
-- **El municipio se traduce a ciudad de Programación con un mapa declarado**, no adivinado: se dedujo
-- de los propios contratos de Avancys, viendo qué agencia tiene los contratos de cada municipio
-- (`work_city_id` contra `subzone_id`, 2.714 contratos abiertos). 88 municipios quedaron asignados
-- sin ambigüedad. Tres quedaron por fuera a propósito, porque están repartidos entre dos agencias:
-- Armenia (Pereira 36 / Armenia 16), Quinchía y Villavicencio.
--
-- Un puesto sin ciudad no entra: `puestos.ciudad_id` es obligatorio y no se inventa. La vista previa
-- lo muestra como error con la razón escrita.

alter table programacion.puestos add column if not exists avancys_id bigint;
alter table programacion.puestos add column if not exists origen text not null default 'manual'
  check (origen in ('manual', 'excel', 'avancys'));
create unique index if not exists puestos_avancys on programacion.puestos (avancys_id) where avancys_id is not null;

alter table programacion.cargues drop constraint if exists cargues_entidad_check;
alter table programacion.cargues add constraint cargues_entidad_check
  check (entidad in ('empleados', 'clientes', 'patrones', 'puestos'));

-- Nombre comparable: sin tildes, sin signos, en mayúscula. Sirve para enganchar los puestos que
-- entraron del Excel con su puesto de Avancys en vez de duplicarlos.
create or replace function programacion.normalizar_nombre(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(translate(coalesce(p, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '[^0-9A-Za-z]', '', 'g')), '')
$$;

-- Prepara un cargue de puestos. p_filas: [{avancys_id, nombre, ciudad, nit_cliente, centro_costo, direccion, municipio}]
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
    select e.*,
      cl.id as cliente_id,
      -- Primero por el id de Avancys; si no, por nombre dentro de la misma ciudad, contra un puesto
      -- que todavía no esté enganchado a otro de Avancys.
      coalesce(pa.id, pn.id) as puesto_id,
      (pa.id is null and pn.id is not null) as engancha,
      to_jsonb(coalesce(pa, pn)) as antes,
      array_remove(array[
        case when coalesce(pa.id, pn.id) is not null and e.nombre is distinct from coalesce(pa.nombre, pn.nombre) then 'nombre' end,
        case when coalesce(pa.id, pn.id) is not null and e.ciudad is distinct from coalesce(pa.ciudad_id, pn.ciudad_id) then 'ciudad' end,
        case when coalesce(pa.id, pn.id) is not null and e.centro_costo is distinct from coalesce(pa.centro_costo, pn.centro_costo) then 'centro_costo' end,
        case when coalesce(pa.id, pn.id) is not null and cl.id is distinct from coalesce(pa.cliente_id, pn.cliente_id) and cl.id is not null then 'cliente' end,
        case when coalesce(pa.id, pn.id) is not null and e.direccion is distinct from coalesce(pa.direccion, pn.direccion) and e.direccion is not null then 'direccion' end
      ], null) as cambios
    from entrada e
    left join programacion.clientes cl on programacion.normalizar_nit(cl.nit) = e.nit
    left join programacion.puestos pa on pa.avancys_id = e.clave
    left join programacion.puestos pn on pa.id is null and e.ciudad is not null
      and pn.avancys_id is null and pn.ciudad_id = e.ciudad
      and programacion.normalizar_nombre(pn.nombre) = programacion.normalizar_nombre(e.nombre)
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
           then 'El municipio "' || c.municipio || '" no está asignado a ninguna ciudad de Programación.'
         when c.ciudad is null then 'Sin ciudad: ninguna orden de servicio activa dice dónde queda, o dicen dos ciudades distintas.'
         when c.engancha then 'Engancha con un puesto que venía del Excel: le queda el id de Avancys.'
         when c.nit is not null and c.cliente_id is null then 'El cliente ' || c.nit || ' todavía no está en Programación: el puesto entra sin cliente.'
    end
  from cmp c;

  select jsonb_object_agg(accion, n) into v_res from (select accion, count(*) n from programacion.cargue_filas where cargue_id = v_id group by accion) x;
  update programacion.cargues set resumen = coalesce(v_res, '{}') where id = v_id;
  return jsonb_build_object('cargue_id', v_id, 'resumen', coalesce(v_res, '{}'),
    'enganchados', (select count(*) from programacion.cargue_filas where cargue_id = v_id and mensaje like 'Engancha%'),
    'sin_ciudad', (select count(*) from programacion.cargue_filas where cargue_id = v_id and accion = 'error'));
end $$;

-- La rama de puestos en el aplicador.
create or replace function programacion.aplicar_cargue_puestos(p_cargue bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_alta int := 0; n_cambio int := 0;
begin
  insert into programacion.puestos (ciudad_id, nombre, cliente_id, centro_costo, direccion, avancys_id, origen)
  select f.datos->>'ciudad', f.datos->>'nombre', (f.datos->>'cliente_id')::bigint,
         f.datos->>'centro_costo', f.datos->>'direccion', (f.datos->>'avancys_id')::bigint, 'avancys'
  from programacion.cargue_filas f where f.cargue_id = p_cargue and f.accion = 'alta' and f.aplicar
  on conflict (avancys_id) where avancys_id is not null do nothing;
  get diagnostics n_alta = row_count;

  update programacion.puestos p set
    nombre = coalesce(f.datos->>'nombre', p.nombre),
    ciudad_id = coalesce(f.datos->>'ciudad', p.ciudad_id),
    cliente_id = coalesce((f.datos->>'cliente_id')::bigint, p.cliente_id),
    centro_costo = coalesce(f.datos->>'centro_costo', p.centro_costo),
    direccion = coalesce(f.datos->>'direccion', p.direccion),
    avancys_id = (f.datos->>'avancys_id')::bigint,
    origen = 'avancys',
    actualizado_en = now()
  from programacion.cargue_filas f
  where f.cargue_id = p_cargue and f.accion = 'cambio' and f.aplicar
    and (p.avancys_id = (f.datos->>'avancys_id')::bigint
         or (p.avancys_id is null and p.ciudad_id = f.datos->>'ciudad'
             and programacion.normalizar_nombre(p.nombre) = programacion.normalizar_nombre(f.datos->>'nombre')));
  get diagnostics n_cambio = row_count;
  return jsonb_build_object('altas', n_alta, 'cambios', n_cambio, 'retirados_por_no_venir', 0);
end $$;

-- El aplicador, con sus cuatro ramas. Las de empleados, clientes y patrones quedan como estaban.
create or replace function programacion.aplicar_cargue(p_cargue bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c programacion.cargues; n_alta int := 0; n_cambio int := 0; n_retiro int := 0; v jsonb;
begin
  if not programacion.es_admin() and auth.uid() is not null then raise exception 'Solo un administrador puede aplicar cargues'; end if;
  select * into c from programacion.cargues where id = p_cargue;
  if c.id is null or c.estado <> 'previsualizado' then raise exception 'El cargue no existe o ya fue aplicado o descartado'; end if;

  if c.entidad = 'empleados' then
    insert into programacion.empleados (ciudad_id, tipo_documento, documento, nombre, cargo, fecha_ingreso, fecha_retiro, estado, telefono)
    select c.ciudad_id, coalesce(f.datos->>'tipo_documento', 'CC'), f.datos->>'documento', f.datos->>'nombre',
      coalesce(f.datos->>'cargo', 'sin_clasificar'), (f.datos->>'fecha_ingreso')::date, (f.datos->>'fecha_retiro')::date,
      coalesce(f.datos->>'estado', 'activo'), f.datos->>'telefono'
    from programacion.cargue_filas f where f.cargue_id = c.id and f.accion = 'alta' and f.aplicar
    on conflict (tipo_documento, documento) do nothing;
    get diagnostics n_alta = row_count;

    update programacion.empleados e set
      nombre = coalesce(f.datos->>'nombre', e.nombre), cargo = coalesce(f.datos->>'cargo', e.cargo),
      fecha_ingreso = coalesce((f.datos->>'fecha_ingreso')::date, e.fecha_ingreso),
      fecha_retiro = coalesce((f.datos->>'fecha_retiro')::date, e.fecha_retiro),
      estado = case when f.accion = 'retiro' then 'retirado' else coalesce(f.datos->>'estado', e.estado) end,
      telefono = coalesce(f.datos->>'telefono', e.telefono), actualizado_en = now()
    from programacion.cargue_filas f
    where f.cargue_id = c.id and f.accion in ('cambio', 'retiro') and f.aplicar
      and programacion.normalizar_documento(e.documento) = f.clave;
    get diagnostics n_cambio = row_count;

    update programacion.empleados e set estado = 'retirado', fecha_retiro = coalesce(e.fecha_retiro, current_date), actualizado_en = now()
    from programacion.cargue_filas f
    where f.cargue_id = c.id and f.accion = 'no_viene' and f.aplicar and programacion.normalizar_documento(e.documento) = f.clave;
    get diagnostics n_retiro = row_count;

  elsif c.entidad = 'clientes' then
    insert into programacion.clientes (nit, razon_social, activo)
    select f.datos->>'nit', f.datos->>'razon_social', coalesce((f.datos->>'activo')::boolean, true)
    from programacion.cargue_filas f where f.cargue_id = c.id and f.accion = 'alta' and f.aplicar
    on conflict (nit) do nothing;
    get diagnostics n_alta = row_count;
    update programacion.clientes cl set razon_social = coalesce(f.datos->>'razon_social', cl.razon_social),
      activo = coalesce((f.datos->>'activo')::boolean, cl.activo), actualizado_en = now()
    from programacion.cargue_filas f
    where f.cargue_id = c.id and f.accion = 'cambio' and f.aplicar
      and programacion.normalizar_nit(cl.nit) = f.clave;
    get diagnostics n_cambio = row_count;

  elsif c.entidad = 'patrones' then
    insert into programacion.patrones_turno (ciudad_id, codigo, tipo, ciclo_dias, dias, grupos, desfase_grupos, descripcion, avancys_id, origen)
    select null, f.datos->>'codigo',
      case when (f.datos->>'ciclo_dias')::int = 7 then 'semanal' else 'rotativo' end,
      (f.datos->>'ciclo_dias')::int, f.datos->'dias',
      (f.datos->>'grupos')::int, (f.datos->>'desfase')::int,
      'Modalidad de Avancys', (f.datos->>'avancys_id')::bigint, 'avancys'
    from programacion.cargue_filas f where f.cargue_id = c.id and f.accion = 'alta' and f.aplicar
    on conflict (avancys_id) where avancys_id is not null do nothing;
    get diagnostics n_alta = row_count;

    update programacion.patrones_turno p set
      codigo = coalesce(f.datos->>'codigo', p.codigo),
      dias = coalesce(f.datos->'dias', p.dias),
      ciclo_dias = coalesce((f.datos->>'ciclo_dias')::int, p.ciclo_dias),
      grupos = coalesce((f.datos->>'grupos')::int, p.grupos),
      desfase_grupos = coalesce((f.datos->>'desfase')::int, p.desfase_grupos)
    from programacion.cargue_filas f
    where f.cargue_id = c.id and f.accion = 'cambio' and f.aplicar
      and p.avancys_id = f.clave::bigint;
    get diagnostics n_cambio = row_count;

  else
    v := programacion.aplicar_cargue_puestos(c.id);
    n_alta := (v->>'altas')::int; n_cambio := (v->>'cambios')::int;
  end if;

  update programacion.cargues set estado = 'aplicado', aplicado_por = auth.uid(), aplicado_en = now() where id = c.id;
  if c.origen = 'avancys' then update programacion.integraciones set ultima_sincronizacion = now() where id = 'avancys'; end if;
  return jsonb_build_object('altas', n_alta, 'cambios', n_cambio, 'retirados_por_no_venir', n_retiro);
end $$;

-- El mapeo de puestos y el mapa de municipios, deducido de los contratos de Avancys.
update programacion.integraciones
set config = jsonb_set(jsonb_set(config, '{puestos_avancys}', jsonb_build_object(
      'modelo', 'hr.roster.puesto', 'ordenes', 'project.service.order.line',
      'contratos', 'project.project', 'terceros', 'res.partner', 'cuentas', 'account.analytic.account'), true),
      '{municipios}', jsonb_build_object(
        'pereira',   jsonb_build_array('Alcala','Anserma','Apia','Balboa','Belalcazar','Belen De Umbria','Calarca','Cartago','Circasia','Cordoba','Dosquebradas','Filandia','La Celia','La Tebaida','La Virginia','Marsella','Pereira','Pueblo Rico','Risaralda','Salento','Santa Rosa De Cabal','Santuario','Viterbo'),
        'manizales', jsonb_build_array('Aranzazu','Chinchina','Manizales','Manzanares','Neira','Pensilvania','Riosucio','Supia','Villamaria'),
        'cali',      jsonb_build_array('Andalucia','Anserma Nuevo','Buenaventura','Bugalagrande','Caicedonia','Cali','Calima','Candelaria','Cartagena','El Cerrito','Florida','Guacari','Guadalajara De Buga','Jamundi','La Cumbre','La Union','Obando','Palmira','Pasto','Piendamo','Pitalito','Popayan','Pradera','Puerto Tejada','Riofrio','Roldanillo','San Pedro','San Vicente Del Caguan','Santander De Quilichao','Timbio','Toro','Trujillo','Tulua','Tumaco','Tuquerres','Villa Rica','Yotoco','Yumbo','Zarzal'),
        'medellin',  jsonb_build_array('Barranquilla','Fresno','Girardota','Itagui','La Ceja','Medellin','Ponedera','Puerto Berrio','Sabanalarga','San Diego','Soledad','Valledupar'),
        'bogota',    jsonb_build_array('Bogota D.C','Cota','Funza','La Mesa','Soacha')), true),
    actualizado_en = now()
where id = 'avancys';
