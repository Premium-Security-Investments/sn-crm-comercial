-- Rollback operativo de 057_tender_document_logical_identity.
-- Restaura la identidad de escritura de 026 (source_document_id) y sus permisos.
-- Conserva toda la evidencia: no elimina versiones ni reactiva filas retiradas por
-- la reparación de 057. Esa reparación de datos es intencionalmente no reversible
-- porque reactivar duplicados volvería a exponerlos como vigentes.
begin;

drop index if exists public.psi_tender_document_versions_one_current_logical_name;

-- Restoring 026 is safe only while its old identity keys remain unique. Never
-- renumber or delete append-only evidence during rollback; abort with an explicit
-- remediation requirement instead.
do $$
begin
  if exists (
    select 1 from public.psi_tender_document_versions
    group by opportunity_id, source, source_document_id, version
    having count(*) > 1
  ) or exists (
    select 1 from public.psi_tender_document_versions
    where current
    group by opportunity_id, source, source_document_id
    having count(*) > 1
  ) then
    raise exception 'No se puede restaurar la identidad de 026: existen linajes incompatibles por source_document_id. Se requiere remediación manual sin eliminar evidencia.'
      using errcode = '23505';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_tender_document_versions'::regclass
      and conname = 'psi_tender_document_versions_opportunity_id_source_source_d_key'
  ) then
    alter table public.psi_tender_document_versions
      add constraint psi_tender_document_versions_opportunity_id_source_source_d_key
      unique (opportunity_id, source, source_document_id, version);
  end if;
end;
$$;

create unique index if not exists psi_tender_document_versions_one_current_identity
  on public.psi_tender_document_versions (opportunity_id, source, source_document_id)
  where current;

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
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text := lower(btrim(p_source));
  v_source_document_id text := btrim(p_source_document_id);
  v_document public.psi_tender_document_versions%rowtype;
  v_previous public.psi_tender_document_versions%rowtype;
  v_version integer;
begin
  if p_opportunity_id is null or p_tender_id is null
     or nullif(v_source, '') is null or nullif(v_source_document_id, '') is null
     or nullif(btrim(p_name), '') is null or nullif(btrim(p_mime_type), '') is null
     or nullif(btrim(p_document_type), '') is null
     or nullif(btrim(p_extracted_text), '') is null then
    raise exception 'La oportunidad, licitación, identidad, nombre, MIME, tipo y texto extraído son obligatorios.' using errcode = '22023';
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

  -- One transaction-scoped identity lock serializes retries and simultaneous refreshes.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_opportunity_id, v_source, v_source_document_id)::text, 0));

  select * into v_document
  from public.psi_tender_document_versions
  where opportunity_id = p_opportunity_id
    and source = v_source
    and source_document_id = v_source_document_id
    and content_hash = p_content_hash;
  if found then
    return jsonb_build_object(
      'status', 'unchanged',
      'id', v_document.id,
      'version', v_document.version,
      'current', v_document.current,
      'content_hash', v_document.content_hash,
      'created_at', v_document.created_at
    );
  end if;

  select * into v_previous
  from public.psi_tender_document_versions
  where opportunity_id = p_opportunity_id
    and source = v_source
    and source_document_id = v_source_document_id
    and current
  for update;

  select coalesce(max(version), 0) + 1 into v_version
  from public.psi_tender_document_versions
  where opportunity_id = p_opportunity_id
    and source = v_source
    and source_document_id = v_source_document_id;

  if v_previous.id is not null then
    update public.psi_tender_document_versions set current = false where id = v_previous.id;
  end if;

  insert into public.psi_tender_document_versions (
    opportunity_id, tender_id, source, source_document_id, version, supersedes_version_id,
    name, content_hash, storage_path, mime_type, size_bytes, document_type, extracted_text,
    source_url, current, actor_id
  ) values (
    p_opportunity_id, p_tender_id, v_source, v_source_document_id, v_version, v_previous.id,
    btrim(p_name), p_content_hash, p_storage_path, btrim(p_mime_type), p_size_bytes,
    btrim(p_document_type), p_extracted_text, p_source_url, true, p_actor_id
  ) returning * into v_document;

  return jsonb_build_object(
    'status', 'created',
    'id', v_document.id,
    'version', v_document.version,
    'current', v_document.current,
    'content_hash', v_document.content_hash,
    'supersedes_version_id', v_document.supersedes_version_id,
    'created_at', v_document.created_at
  );
end;
$$;

revoke all on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid) from public;
revoke all on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid) from authenticated;
revoke all on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid) from service_role;
revoke all on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid) from anon;
grant execute on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid) to service_role;

drop function if exists public.psi_normalize_tender_document_name(text);

commit;
