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
  unique (document_type, version)
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

commit;
