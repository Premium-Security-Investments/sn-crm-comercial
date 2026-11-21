-- Traer el catálogo de patrones de turno de Avancys (`hr.roster.modalidad`) por la misma puerta que
-- empleados y clientes: vista previa, y nada se guarda hasta que un administrador lo aplica.
--
-- Medido el 2026-10-30: 542 modalidades, 523 con ciclo armado, en ciclos de 6 (231), 7 (136),
-- 14 (98) y 12 (11) días. Traen `desfase` —el corrimiento entre grupos, que es justo lo que en el
-- Excel estaba estallado en G1, G2 y G3— y `numero_personal`.
--
-- **No tienen ciudad:** 541 de las 542 no declaran regional. Son de toda la empresa, así que entran
-- con `ciudad_id = null`. El modelo ya lo soportaba: la columna siempre admitió nulo y la política
-- `ver_patrones` dice "ciudad_id is null or puede_ver(ciudad_id)", es decir, el patrón sin ciudad lo
-- ve todo el mundo. Los patrones que salieron del Excel conservan su ciudad y no se tocan.
--
-- Del cruce contra los 161 patrones propios: 36 calzan exacto y 36 calzan como rotación de otro
-- grupo. Esos no se duplican por nombre —se insertan con su id de Avancys— pero la vista previa
-- avisa cuando el ciclo ya existe, para que un administrador decida.

alter table programacion.patrones_turno add column if not exists avancys_id bigint;
alter table programacion.patrones_turno add column if not exists origen text not null default 'manual'
  check (origen in ('manual', 'excel', 'avancys'));
create unique index if not exists patrones_turno_avancys on programacion.patrones_turno (avancys_id) where avancys_id is not null;

alter table programacion.cargues drop constraint if exists cargues_entidad_check;
alter table programacion.cargues add constraint cargues_entidad_check
  check (entidad in ('empleados', 'clientes', 'patrones'));

-- Prepara un cargue de patrones. p_filas: [{avancys_id, codigo, dias, ciclo, grupos, desfase}]
create or replace function programacion.preparar_cargue_patrones(p_origen text, p_archivo text, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_res jsonb;
begin
  if not programacion.es_admin() and auth.uid() is not null then raise exception 'Solo un administrador puede cargar datos'; end if;
  insert into programacion.cargues (entidad, origen, archivo, creado_por)
  values ('patrones', p_origen, p_archivo, auth.uid()) returning id into v_id;

  with entrada as (
    select distinct on (clave) * from (
      select nullif(f->>'avancys_id', '')::bigint as clave,
        nullif(regexp_replace(trim(f->>'codigo'), '\s+', ' ', 'g'), '') as codigo,
        f->'dias' as dias,
        jsonb_array_length(coalesce(f->'dias', '[]'::jsonb)) as ciclo_dias,
        greatest(1, coalesce((f->>'grupos')::int, 1)) as grupos,
        coalesce((f->>'desfase')::int, 0) as desfase,
        -- el ciclo compacto sirve para avisar que ya existe un patrón igual
        (select string_agg(coalesce((select string_agg(replace(t->>'inicio', ':', '') || '-' || replace(t->>'fin', ':', ''), '+')
                                     from jsonb_array_elements(d->'tramos') t), '_'), '|')
         from jsonb_array_elements(coalesce(f->'dias', '[]'::jsonb)) d) as ciclo
      from jsonb_array_elements(p_filas) f) x
    where clave is not null and codigo is not null and ciclo_dias between 1 and 62
  ), cmp as (
    select e.*, p.id as patron_id, to_jsonb(p) as antes,
      array_remove(array[
        case when p.id is not null and e.codigo is distinct from p.codigo then 'codigo' end,
        case when p.id is not null and e.dias is distinct from p.dias then 'dias' end,
        case when p.id is not null and e.grupos is distinct from p.grupos then 'grupos' end,
        case when p.id is not null and e.desfase is distinct from p.desfase_grupos then 'desfase_grupos' end
      ], null) as cambios,
      -- ¿ya hay un patrón con el mismo ciclo, aunque sea de otro origen?
      (select p2.codigo from programacion.patrones_turno p2
        where p2.avancys_id is distinct from e.clave
          and (select string_agg(coalesce((select string_agg(replace(t->>'inicio', ':', '') || '-' || replace(t->>'fin', ':', ''), '+')
                                           from jsonb_array_elements(d->'tramos') t), '_'), '|')
               from jsonb_array_elements(p2.dias) d) = e.ciclo
        limit 1) as igual_a
    from entrada e
    left join programacion.patrones_turno p on p.avancys_id = e.clave
  )
  insert into programacion.cargue_filas (cargue_id, accion, clave, datos, antes, cambios, mensaje)
  select v_id,
    case when c.patron_id is null then 'alta'
         when cardinality(c.cambios) > 0 then 'cambio'
         else 'sin_cambio' end,
    c.clave::text,
    jsonb_build_object('avancys_id', c.clave, 'codigo', c.codigo, 'dias', c.dias,
                       'ciclo_dias', c.ciclo_dias, 'grupos', c.grupos, 'desfase', c.desfase),
    c.antes, c.cambios,
    case when c.igual_a is not null then 'El mismo ciclo ya existe como "' || c.igual_a || '". Revise antes de aplicar.' end
  from cmp c;

  select jsonb_object_agg(accion, n) into v_res from (select accion, count(*) n from programacion.cargue_filas where cargue_id = v_id group by accion) x;
  update programacion.cargues set resumen = coalesce(v_res, '{}') where id = v_id;
  return jsonb_build_object('cargue_id', v_id, 'resumen', coalesce(v_res, '{}'),
    'ciclo_repetido', (select count(*) from programacion.cargue_filas where cargue_id = v_id and mensaje is not null));
end $$;

-- Aplica el cargue. Se reescribe entera para agregar la rama de patrones; las de empleados y
-- clientes quedan exactamente como estaban.
create or replace function programacion.aplicar_cargue(p_cargue bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c programacion.cargues; n_alta int := 0; n_cambio int := 0; n_retiro int := 0;
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

  else
    -- Patrones: sin ciudad (son de toda la empresa) y con el id de Avancys como llave.
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
  end if;

  update programacion.cargues set estado = 'aplicado', aplicado_por = auth.uid(), aplicado_en = now() where id = c.id;
  if c.origen = 'avancys' then update programacion.integraciones set ultima_sincronizacion = now() where id = 'avancys'; end if;
  return jsonb_build_object('altas', n_alta, 'cambios', n_cambio, 'retirados_por_no_venir', n_retiro);
end $$;

-- El mapeo de las modalidades, para que la función del servidor sepa qué modelos leer.
update programacion.integraciones
set config = jsonb_set(config, '{patrones}', jsonb_build_object(
      'modelo', 'hr.roster.modalidad',
      'secuencias', 'hr.roster.sequence',
      'horarios', 'hr.roster.horario'), true),
    actualizado_en = now()
where id = 'avancys';
