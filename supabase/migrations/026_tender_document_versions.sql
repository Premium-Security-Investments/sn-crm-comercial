-- Versioned company procurement documents.  This migration deliberately owns
-- only the corporate document register; tender-specific document versions land later.
begin;

create table if not exists public.psi_company_procurement_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (nullif(btrim(document_type), '') is not null),
  display_name text not null check (nullif(btrim(display_name), '') is not null),
  issued_at date not null,
  expires_at date,
  version integer not null check (version > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  storage_path text not null check (storage_path like 'company-profile/%'),
  mime_type text not null check (nullif(btrim(mime_type), '') is not null),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 50 * 1024 * 1024),
  current boolean not null default true,
  -- `current` means latest registered version, not temporal validity; expires_at is retained for UI alerts.
  uploaded_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at >= issued_at),
  unique (document_type, version),
  unique (document_type, content_hash)
);

create index if not exists psi_company_procurement_documents_current_idx
  on public.psi_company_procurement_documents (document_type, current, issued_at desc, version desc);
create unique index if not exists psi_company_procurement_documents_one_current_rup
  on public.psi_company_procurement_documents (document_type)
  where current and document_type = 'rup';

drop trigger if exists trg_psi_company_procurement_documents_updated_at on public.psi_company_procurement_documents;
create trigger trg_psi_company_procurement_documents_updated_at before update on public.psi_company_procurement_documents
for each row execute function public.psi_sales_set_updated_at();

alter table public.psi_company_procurement_documents enable row level security;
revoke all on table public.psi_company_procurement_documents from public;
revoke all on table public.psi_company_procurement_documents from authenticated;
revoke all on table public.psi_company_procurement_documents from service_role;

create or replace function public.psi_record_company_procurement_document(
  p_document_type text,
  p_display_name text,
  p_issued_at date,
  p_expires_at date,
  p_content_hash text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_uploaded_by uuid,
  p_replace_document_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document_type text := lower(btrim(p_document_type));
  v_document public.psi_company_procurement_documents%rowtype;
  v_replaced public.psi_company_procurement_documents%rowtype;
  v_version integer;
begin
  if nullif(v_document_type, '') is null or nullif(btrim(p_display_name), '') is null
     or p_issued_at is null or nullif(btrim(p_mime_type), '') is null then
    raise exception 'El tipo, nombre, fecha de expedición y MIME son obligatorios.' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at < p_issued_at then
    raise exception 'Las fechas del documento no son válidas.' using errcode = '22023';
  end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El hash del documento debe ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if p_storage_path is null or btrim(p_storage_path) <> p_storage_path
     or p_storage_path not like 'company-profile/%'
     or p_storage_path like '%..%' then
    raise exception 'La ruta del documento debe pertenecer a company-profile/.' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 50 * 1024 * 1024 then
    raise exception 'El tamaño del documento debe estar entre 1 byte y 50 MB.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_uploaded_by
      and p.active = true
      and coalesce(p.identity_type, 'human') = 'human'
  ) then
    raise exception 'El actor que carga el documento debe ser un perfil humano activo.' using errcode = '42501';
  end if;

  -- Low-volume corporate uploads serialize as one transaction so retries and
  -- version assignment cannot race across document types.
  lock table public.psi_company_procurement_documents in share row exclusive mode;

  select * into v_document
  from public.psi_company_procurement_documents
  where document_type = v_document_type
    and content_hash = p_content_hash;
  if found then
    return jsonb_build_object(
      'id', v_document.id,
      'document_type', v_document.document_type,
      'version', v_document.version,
      'current', v_document.current,
      'issued_at', v_document.issued_at,
      'expires_at', v_document.expires_at,
      'created_at', v_document.created_at
    );
  end if;

  if p_replace_document_id is not null then
    select * into v_replaced
    from public.psi_company_procurement_documents
    where id = p_replace_document_id
    for update;
    if not found or v_replaced.document_type is distinct from v_document_type or not v_replaced.current then
      raise exception 'El documento a reemplazar no existe, no es la versión actual o no corresponde al tipo indicado.' using errcode = '22023';
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.psi_company_procurement_documents
  where document_type = v_document_type;

  if v_document_type = 'rup' then
    update public.psi_company_procurement_documents
    set current = false
    where document_type = 'rup' and current;
  elsif p_replace_document_id is not null then
    update public.psi_company_procurement_documents
    set current = false
    where id = p_replace_document_id;
  end if;

  insert into public.psi_company_procurement_documents (
    document_type, display_name, issued_at, expires_at, version, content_hash,
    storage_path, mime_type, size_bytes, current, uploaded_by
  ) values (
    v_document_type, btrim(p_display_name), p_issued_at, p_expires_at, v_version, p_content_hash,
    p_storage_path, btrim(p_mime_type), p_size_bytes, true, p_uploaded_by
  ) returning * into v_document;

  return jsonb_build_object(
    'id', v_document.id,
    'document_type', v_document.document_type,
    'version', v_document.version,
    'current', v_document.current,
    'issued_at', v_document.issued_at,
    'expires_at', v_document.expires_at,
    'created_at', v_document.created_at
  );
end;
$$;

revoke all on function public.psi_record_company_procurement_document(text, text, date, date, text, text, text, bigint, uuid, uuid) from public;
revoke all on function public.psi_record_company_procurement_document(text, text, date, date, text, text, text, bigint, uuid, uuid) from authenticated;
revoke all on function public.psi_record_company_procurement_document(text, text, date, date, text, text, text, bigint, uuid, uuid) from service_role;
grant execute on function public.psi_record_company_procurement_document(text, text, date, date, text, text, text, bigint, uuid, uuid) to service_role;

-- Official tender documents are a separate append-only version register.  Their
-- identity is external source + source document id within a converted opportunity.
create table if not exists public.psi_tender_document_versions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  source text not null check (nullif(btrim(source), '') is not null),
  source_document_id text not null check (nullif(btrim(source_document_id), '') is not null),
  version integer not null check (version > 0),
  supersedes_version_id uuid references public.psi_tender_document_versions(id) on delete restrict,
  name text not null check (nullif(btrim(name), '') is not null),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  storage_path text not null check (storage_path like 'tender-documents/%' and storage_path not like '%..%'),
  mime_type text not null check (nullif(btrim(mime_type), '') is not null),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 50 * 1024 * 1024),
  document_type text not null check (nullif(btrim(document_type), '') is not null),
  extracted_text text not null check (nullif(btrim(extracted_text), '') is not null and octet_length(extracted_text) <= 10 * 1024 * 1024),
  source_url text check (source_url is null or source_url ~ '^https?://[^/[:space:]]+([/?#][^[:space:]]*)?$'),
  current boolean not null default true,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (opportunity_id, source, source_document_id, version)
);

create index if not exists psi_tender_document_versions_opportunity_source_current_idx
  on public.psi_tender_document_versions (opportunity_id, source, source_document_id, current, version desc);
create unique index if not exists psi_tender_document_versions_one_current_identity
  on public.psi_tender_document_versions (opportunity_id, source, source_document_id)
  where current;

alter table public.psi_tender_document_versions enable row level security;
revoke all on table public.psi_tender_document_versions from public;
revoke all on table public.psi_tender_document_versions from authenticated;
revoke all on table public.psi_tender_document_versions from service_role;
grant select on table public.psi_tender_document_versions to service_role;

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
  if p_source_url is not null and (btrim(p_source_url) <> p_source_url or p_source_url !~ '^https?://[^/[:space:]]+([/?#][^[:space:]]*)?$') then
    raise exception 'La URL de origen debe ser HTTP(S) válida.' using errcode = '22023';
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
grant execute on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid) to service_role;

commit;
