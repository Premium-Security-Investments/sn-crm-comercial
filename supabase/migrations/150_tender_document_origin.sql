-- AGT-002 Vig-IA Licitaciones — el origen del documento se declara al cargarlo (pendiente de Juan, 2026-10-22,
-- construido el 2026-10-23).
--
-- Hasta hoy el expediente guarda QUÉ es un documento (`document_type`: pliego, adenda, anexo) pero no QUIÉN lo
-- produjo. Y como no lo guarda, la cadena lo asume: `agt002InitialRequestedMembers` le pone
-- `source_classification: 'official'` a TODO documento admitido, que el constructor del agregado traduce a
-- `OFFICIAL_PROCESS_DOCUMENT` / `VERIFIED_OFFICIAL`. Una carta de un tercero termina con el peso del pliego de
-- la entidad.
--
-- Cuatro casos reales, todos de octubre de 2026:
--   * las seis cartas de observaciones de terceros que Juan cargó en la Fiscalía el 21-oct;
--   * `OBSERVACIONES AL PROYECTO DE PLIEGOS PEREIRA ADMINISTRATIVO.docx.pdf`, carta de un tercero, tipificada
--     `pliego` porque el nombre del archivo contiene esa palabra;
--   * los dos consolidados de respuestas de Supersalud, que SÍ son de la entidad;
--   * un resumen que hizo el propio equipo, guardado con el mismo peso que el pliego.
--
-- El mismo vacío produce un segundo defecto, en otro lado: la verificación de frescura ignora toda carga manual
-- (`agt002IsOfficialDocumentSource`), regla correcta para nuestros documentos pero equivocada para un documento
-- DE LA ENTIDAD que alguien baja del módulo de mensajes de SECOP II y sube a mano. El 23-oct la alarma afirmaba
-- que Supersalud no había publicado nada, teniendo sus respuestas en el expediente.
--
-- Esta migración agrega el campo que faltaba. El origen es ortogonal al tipo: un `pliego` puede venir de la
-- entidad o ser un borrador nuestro, y una `respuesta a observaciones` es de la entidad aunque responda a un
-- tercero.
--
-- Lo NO declarado se queda en null a propósito, y la cadena lo trata como `third_party`: falla hacia "esto no
-- es una regla del proceso", que es el lado seguro. Nunca se vuelve a asumir que algo es oficial.
begin;

alter table public.psi_tender_document_versions
  add column if not exists origin text;

alter table public.psi_tender_document_versions
  drop constraint if exists psi_tender_document_versions_origin_check;

alter table public.psi_tender_document_versions
  add constraint psi_tender_document_versions_origin_check
  check (origin is null or origin in ('entidad', 'tercero', 'propio', 'borrador'));

comment on column public.psi_tender_document_versions.origin is
  'Quién produjo el documento: entidad | tercero | propio | borrador. Ortogonal a document_type (qué es). '
  'null = sin declarar, y la cadena de análisis lo trata como third_party, nunca como oficial.';

-- Relleno determinista y conservador. Sólo se declara `entidad` lo que entró por un portal oficial: ahí el
-- origen no es una suposición, es de dónde se bajó. Las cargas manuales quedan SIN DECLARAR, incluso las que
-- sabemos que son de la entidad, porque declararlas desde aquí sería adivinar por el nombre del archivo —
-- exactamente el error que esta migración existe para quitar. Se declaran desde la pantalla, una por una.
update public.psi_tender_document_versions
set origin = 'entidad'
where origin is null
  and lower(btrim(coalesce(source, ''))) not in ('carga manual', 'legacy', 'carga')
  and nullif(btrim(coalesce(source, '')), '') is not null;

create index if not exists psi_tender_document_versions_origin_idx
  on public.psi_tender_document_versions (opportunity_id, origin)
  where current;

-- El RPC recibe el origen. Se reemplaza la firma de 13 parámetros por una de 14 cuyo último es opcional, para
-- que un llamador anterior siga resolviendo durante el despliegue y el origen entre como null (= sin declarar).
drop function if exists public.psi_record_tender_document_version(
  uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid
);

create or replace function public.psi_record_tender_document_version(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_source text,
  p_source_document_id text,
  p_name text,
  p_content_hash text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_document_type text,
  p_extracted_text text,
  p_source_url text,
  p_actor_id uuid,
  p_origin text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text := lower(btrim(p_source));
  v_source_document_id text := btrim(p_source_document_id);
  v_origin text := nullif(lower(btrim(coalesce(p_origin, ''))), '');
  v_normalized_name text;
  v_document public.psi_tender_document_versions%rowtype;
  v_current public.psi_tender_document_versions%rowtype;
  v_version integer;
begin
  if p_opportunity_id is null or p_tender_id is null
     or nullif(v_source, '') is null or nullif(v_source_document_id, '') is null
     or nullif(btrim(p_name), '') is null or nullif(btrim(p_mime_type), '') is null
     or nullif(btrim(p_document_type), '') is null
     or nullif(btrim(p_extracted_text), '') is null then
    raise exception 'La oportunidad, licitación, identidad, nombre, MIME, tipo y texto extraído son obligatorios.' using errcode = '22023';
  end if;
  if v_origin is not null and v_origin not in ('entidad', 'tercero', 'propio', 'borrador') then
    raise exception 'El origen del documento debe ser entidad, tercero, propio o borrador.' using errcode = '22023';
  end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El hash del documento debe ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if p_storage_path is null or btrim(p_storage_path) <> p_storage_path
     or p_storage_path not like 'tender-documents/%'
     or p_storage_path not like ('tender-documents/' || p_opportunity_id::text || '/%')
     or p_storage_path like '%..%' or position('\\' in p_storage_path) > 0 then
    raise exception 'La ruta del documento debe ser privada, pertenecer a la oportunidad y no contener traversal.' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 50 * 1024 * 1024 then
    raise exception 'El tamaño del documento debe estar entre 1 byte y 50 MB.' using errcode = '22023';
  end if;
  if octet_length(p_extracted_text) > 10 * 1024 * 1024 then
    raise exception 'El texto extraído no puede superar 10 MB.' using errcode = '22023';
  end if;
  if p_source_url is not null and (btrim(p_source_url) <> p_source_url or not public.psi_is_public_https_url(p_source_url)) then
    raise exception 'La URL de origen debe ser HTTPS pública, sin credenciales ni puerto explícito.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_public_tenders t
    where t.id = p_tender_id and t.converted_opportunity_id = p_opportunity_id
  ) then
    raise exception 'La licitación no corresponde a la oportunidad.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id
      and p.active = true
      and coalesce(p.identity_type, 'human') in ('human', 'agent')
  ) then
    raise exception 'El actor debe ser un perfil humano o agente activo.' using errcode = '42501';
  end if;

  v_normalized_name := public.psi_normalize_tender_document_name(p_name);

  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_opportunity_id, v_source, v_normalized_name)::text, 0));

  select * into v_current
  from public.psi_tender_document_versions
  where opportunity_id = p_opportunity_id
    and source = v_source
    and public.psi_normalize_tender_document_name(name) = v_normalized_name
    and current
  for update;

  -- Mismo contenido: no nace una versión. El origen SÍ se puede corregir sin recargar el archivo, porque es una
  -- declaración de la persona, no parte del contenido; corregir una mala clasificación no debe obligar a volver
  -- a subir un PDF de 3 MB. Sólo se escribe cuando viene declarado: un llamador que no lo manda no borra lo
  -- que alguien ya declaró.
  if v_current.id is not null and v_current.content_hash = p_content_hash then
    if v_origin is not null and v_origin is distinct from v_current.origin then
      update public.psi_tender_document_versions set origin = v_origin where id = v_current.id;
      v_current.origin := v_origin;
    end if;
    return jsonb_build_object(
      'status', 'unchanged',
      'id', v_current.id,
      'version', v_current.version,
      'current', v_current.current,
      'origin', v_current.origin,
      'content_hash', v_current.content_hash,
      'created_at', v_current.created_at
    );
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.psi_tender_document_versions
  where opportunity_id = p_opportunity_id
    and source = v_source
    and public.psi_normalize_tender_document_name(name) = v_normalized_name;

  if v_current.id is not null then
    update public.psi_tender_document_versions set current = false where id = v_current.id;
  end if;

  -- Una versión nueva del MISMO documento lógico hereda el origen ya declarado si el llamador no manda uno:
  -- que la entidad publique una corrección no convierte el documento en otra cosa.
  insert into public.psi_tender_document_versions (
    opportunity_id, tender_id, source, source_document_id, version, supersedes_version_id,
    name, content_hash, storage_path, mime_type, size_bytes, document_type, extracted_text,
    source_url, current, actor_id, origin
  ) values (
    p_opportunity_id, p_tender_id, v_source, v_source_document_id, v_version, v_current.id,
    btrim(p_name), p_content_hash, p_storage_path, btrim(p_mime_type), p_size_bytes,
    btrim(p_document_type), p_extracted_text, p_source_url, true, p_actor_id,
    coalesce(v_origin, v_current.origin)
  ) returning * into v_document;

  return jsonb_build_object(
    'status', 'created',
    'id', v_document.id,
    'version', v_document.version,
    'current', v_document.current,
    'origin', v_document.origin,
    'supersedes_version_id', v_document.supersedes_version_id,
    'content_hash', v_document.content_hash,
    'created_at', v_document.created_at
  );
end;
$$;

revoke all on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid, text) from public;
revoke all on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid, text) from authenticated;
revoke all on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid, text) from service_role;
revoke all on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid, text) from anon;
grant execute on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid, text) to service_role;

-- Declarar el origen de un documento ya cargado, sin volver a subirlo. Es la pantalla la que lo usa para
-- corregir una carga vieja o una mal declarada.
create or replace function public.psi_set_tender_document_origin(
  p_document_version_id uuid,
  p_origin text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_origin text := nullif(lower(btrim(coalesce(p_origin, ''))), '');
  v_document public.psi_tender_document_versions%rowtype;
begin
  if p_document_version_id is null then
    raise exception 'El documento es obligatorio.' using errcode = '22023';
  end if;
  if v_origin is null or v_origin not in ('entidad', 'tercero', 'propio', 'borrador') then
    raise exception 'El origen del documento debe ser entidad, tercero, propio o borrador.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id
      and p.active = true
      and coalesce(p.identity_type, 'human') in ('human', 'agent')
  ) then
    raise exception 'El actor debe ser un perfil humano o agente activo.' using errcode = '42501';
  end if;

  update public.psi_tender_document_versions
  set origin = v_origin
  where id = p_document_version_id
  returning * into v_document;

  if v_document.id is null then
    raise exception 'El documento no existe.' using errcode = '22023';
  end if;

  return jsonb_build_object('id', v_document.id, 'origin', v_document.origin, 'name', v_document.name);
end;
$$;

revoke all on function public.psi_set_tender_document_origin(uuid, text, uuid) from public;
revoke all on function public.psi_set_tender_document_origin(uuid, text, uuid) from authenticated;
revoke all on function public.psi_set_tender_document_origin(uuid, text, uuid) from service_role;
revoke all on function public.psi_set_tender_document_origin(uuid, text, uuid) from anon;
grant execute on function public.psi_set_tender_document_origin(uuid, text, uuid) to service_role;

commit;
