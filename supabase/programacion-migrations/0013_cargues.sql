-- Cargues de datos maestros desde Avancys: por archivo o por conexión directa (API).
-- Las dos puertas dejan las filas en un "cargue" con la comparación contra lo que ya existe
-- (altas, cambios, retiros); nada se aplica hasta que un administrador lo aprueba.

-- Teléfono del guarda: lo necesita el canal de Vig-IA (WhatsApp). Dato personal mínimo.
alter table programacion.empleados add column if not exists telefono text;

create table if not exists programacion.cargues (
  id           bigint generated always as identity primary key,
  entidad      text not null check (entidad in ('empleados', 'clientes')),
  origen       text not null check (origen in ('archivo', 'avancys')),
  ciudad_id    text references programacion.ciudades(id),
  archivo      text,
  estado       text not null default 'previsualizado' check (estado in ('previsualizado', 'aplicado', 'descartado')),
  resumen      jsonb not null default '{}'::jsonb,
  creado_por   uuid,
  creado_en    timestamptz not null default now(),
  aplicado_por uuid,
  aplicado_en  timestamptz
);

create table if not exists programacion.cargue_filas (
  id        bigint generated always as identity primary key,
  cargue_id bigint not null references programacion.cargues(id) on delete cascade,
  accion    text not null check (accion in ('alta', 'cambio', 'retiro', 'sin_cambio', 'no_viene', 'error')),
  clave     text,
  datos     jsonb,
  antes     jsonb,
  cambios   text[],
  mensaje   text,
  aplicar   boolean not null default true
);
create index if not exists cargue_filas_cargue on programacion.cargue_filas (cargue_id, accion);

-- Configuración de la conexión con Avancys (sin secretos: las claves van en los secretos de la
-- función del servidor). El mapeo de campos se ajusta cuando se conozca la instancia real.
create table if not exists programacion.integraciones (
  id          text primary key,              -- 'avancys'
  activa      boolean not null default false,
  config      jsonb not null default '{}'::jsonb,
  ultima_sincronizacion timestamptz,
  actualizado_en timestamptz not null default now()
);
insert into programacion.integraciones (id, activa, config) values ('avancys', false, jsonb_build_object(
  'tipo', 'odoo_jsonrpc',
  'empleados', jsonb_build_object('modelo', 'hr.employee', 'dominio', '[]'::jsonb,
     'campos', jsonb_build_object('documento', 'identification_id', 'nombre', 'name', 'cargo', 'job_id',
                                  'telefono', 'mobile_phone', 'activo', 'active', 'fecha_ingreso', 'first_contract_date',
                                  'ciudad', 'work_location_id')),
  'clientes', jsonb_build_object('modelo', 'res.partner', 'dominio', '[["customer_rank", ">", 0]]'::jsonb,
     'campos', jsonb_build_object('nit', 'vat', 'razon_social', 'name', 'activo', 'active')),
  'nota', 'Mapeo por defecto de Odoo estándar; confirmar modelos y campos con la instancia de Avancys.'
)) on conflict (id) do nothing;

alter table programacion.cargues enable row level security;
alter table programacion.cargue_filas enable row level security;
alter table programacion.integraciones enable row level security;
grant select on programacion.cargues, programacion.cargue_filas, programacion.integraciones to authenticated;
grant update (aplicar) on programacion.cargue_filas to authenticated;
create policy admin_ver on programacion.cargues for select to authenticated using (programacion.es_admin());
create policy admin_ver on programacion.cargue_filas for select to authenticated using (programacion.es_admin());
create policy admin_marcar on programacion.cargue_filas for update to authenticated using (programacion.es_admin()) with check (programacion.es_admin());
create policy admin_ver on programacion.integraciones for select to authenticated using (programacion.es_admin());

-- Normaliza un documento: solo dígitos y letras, sin puntos ni espacios.
create or replace function programacion.normalizar_documento(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')), '')
$$;

-- Normaliza un NIT: sin prefijo de país ("CO"), sin dígito de verificación tras el guion, solo dígitos.
create or replace function programacion.normalizar_nit(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(split_part(regexp_replace(upper(coalesce(p, '')), '^\s*CO', ''), '-', 1), '[^0-9]', '', 'g'), '')
$$;
create index if not exists empleados_documento_normal on programacion.empleados (programacion.normalizar_documento(documento));

-- Prepara un cargue de empleados. p_filas: [{documento, tipo_documento?, nombre, cargo?, fecha_ingreso?,
-- fecha_retiro?, estado? ('activo'|'retirado'|'disponible'), telefono?}]
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
    select d.*, e.id as emp_id, to_jsonb(e) as antes,
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
    case when c.nombre is null and c.emp_id is null then 'Falta el nombre' end
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
  return jsonb_build_object('cargue_id', v_id, 'resumen', coalesce(v_res, '{}'));
end $$;

-- Prepara un cargue de clientes. p_filas: [{nit, razon_social, activo?}]
create or replace function programacion.preparar_cargue_clientes(p_origen text, p_archivo text, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_res jsonb;
begin
  if not programacion.es_admin() and auth.uid() is not null then raise exception 'Solo un administrador puede cargar datos'; end if;
  insert into programacion.cargues (entidad, origen, archivo, creado_por) values ('clientes', p_origen, p_archivo, auth.uid()) returning id into v_id;
  with entrada as (
    select distinct on (nit) * from (
      select programacion.normalizar_nit(f->>'nit') as nit,
        nullif(regexp_replace(trim(f->>'razon_social'), '\s+', ' ', 'g'), '') as razon,
        coalesce((f->>'activo')::boolean, true) as activo
      from jsonb_array_elements(p_filas) f) x
    where nit is not null and nit <> '' order by nit
  ), cmp as (
    select en.*, c.id as cli_id, to_jsonb(c) as antes,
      array_remove(array[
        case when c.id is not null and en.razon is not null and en.razon is distinct from c.razon_social then 'razon_social' end,
        case when c.id is not null and en.activo is distinct from c.activo then 'activo' end], null) as cambios
    from entrada en left join programacion.clientes c on programacion.normalizar_nit(c.nit) = en.nit
  )
  insert into programacion.cargue_filas (cargue_id, accion, clave, datos, antes, cambios, mensaje)
  select v_id,
    case when c.razon is null and c.cli_id is null then 'error' when c.cli_id is null then 'alta'
         when cardinality(c.cambios) > 0 then 'cambio' else 'sin_cambio' end,
    c.nit, jsonb_build_object('nit', c.nit, 'razon_social', c.razon, 'activo', c.activo), c.antes, c.cambios,
    case when c.razon is null and c.cli_id is null then 'Falta la razón social' end
  from cmp c;
  select jsonb_object_agg(accion, n) into v_res from (select accion, count(*) n from programacion.cargue_filas where cargue_id = v_id group by accion) x;
  update programacion.cargues set resumen = coalesce(v_res, '{}') where id = v_id;
  return jsonb_build_object('cargue_id', v_id, 'resumen', coalesce(v_res, '{}'));
end $$;

-- Aplica las filas marcadas de un cargue (altas, cambios, retiros y, si se marcan, los "no viene" como retiro).
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
  else
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
  end if;

  update programacion.cargues set estado = 'aplicado', aplicado_por = auth.uid(), aplicado_en = now() where id = c.id;
  if c.origen = 'avancys' then update programacion.integraciones set ultima_sincronizacion = now() where id = 'avancys'; end if;
  return jsonb_build_object('altas', n_alta, 'cambios', n_cambio, 'retirados_por_no_venir', n_retiro);
end $$;

create or replace function programacion.descartar_cargue(p_cargue bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not programacion.es_admin() then raise exception 'Solo un administrador puede descartar cargues'; end if;
  update programacion.cargues set estado = 'descartado' where id = p_cargue and estado = 'previsualizado';
end $$;

revoke execute on function programacion.preparar_cargue_empleados(text, text, text, jsonb, boolean), programacion.preparar_cargue_clientes(text, text, jsonb),
  programacion.aplicar_cargue(bigint), programacion.descartar_cargue(bigint), programacion.normalizar_documento(text), programacion.normalizar_nit(text) from anon, public;
grant execute on function programacion.preparar_cargue_empleados(text, text, text, jsonb, boolean), programacion.preparar_cargue_clientes(text, text, jsonb),
  programacion.aplicar_cargue(bigint), programacion.descartar_cargue(bigint), programacion.normalizar_documento(text), programacion.normalizar_nit(text) to authenticated;
