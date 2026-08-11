begin;

-- AGT-002 F1.2: append-only, immutable-linked extraction integrity register. Each row
-- ties one deterministic parse attempt (tender-document-text-extraction.js, identified by
-- extractor_version) to one immutable psi_tender_document_versions row. A document version
-- can accumulate multiple rows over time (e.g. after the extractor is upgraded), but a
-- given (document_version_id, extractor_version) pair is recorded exactly once — this is
-- the idempotency key the governed RPC below enforces.
--
-- status honestly represents the extractor's own ok/gap contract (see
-- tender-document-text-extraction.js's okResult/gapResult): 'ok' rows always carry real,
-- non-blank text with an exact SHA-256 hash and exact char/byte counts; 'gap' rows never
-- carry text/hash and always carry a typed gap_reason instead — never a fabricated
-- success, and never a silent truncation. The CHECK constraint below enforces this
-- invariant at the storage layer, not just in application code.
create table if not exists public.psi_tender_document_extractions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  document_version_id uuid not null references public.psi_tender_document_versions(id) on delete restrict,
  extractor_version text not null check (nullif(btrim(extractor_version), '') is not null),
  status text not null check (status in ('ok', 'gap')),
  parser text not null check (nullif(btrim(parser), '') is not null),
  extracted_text text,
  text_hash text check (text_hash is null or text_hash ~ '^[0-9a-f]{64}$'),
  char_count integer not null default 0 check (char_count >= 0),
  text_byte_count integer not null default 0 check (text_byte_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  gap_reason text,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (document_version_id, extractor_version),
  check (
    (
      status = 'ok'
      and extracted_text is not null and nullif(btrim(extracted_text), '') is not null
      and text_hash is not null and text_hash ~ '^[0-9a-f]{64}$'
      and char_count > 0 and char_count = char_length(extracted_text)
      and text_byte_count > 0 and text_byte_count = octet_length(extracted_text)
      and gap_reason is null
    ) or (
      status = 'gap'
      and extracted_text is null
      and text_hash is null
      and char_count = 0
      and text_byte_count = 0
      and gap_reason is not null and nullif(btrim(gap_reason), '') is not null
    )
  )
);

create index if not exists psi_tender_document_extractions_opportunity_idx
  on public.psi_tender_document_extractions (opportunity_id, created_at desc);
create index if not exists psi_tender_document_extractions_version_idx
  on public.psi_tender_document_extractions (document_version_id, created_at desc);
-- Narrow partial index for the "latest successful extraction per version" lookup that
-- tender-document-extraction-persistence.js performs on every document read.
create index if not exists psi_tender_document_extractions_latest_ok_idx
  on public.psi_tender_document_extractions (document_version_id, created_at desc)
  where status = 'ok';

create or replace function public.psi_tender_document_extractions_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_document_extractions is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_tender_document_extractions_immutable on public.psi_tender_document_extractions;
create trigger psi_tender_document_extractions_immutable
  before update or delete on public.psi_tender_document_extractions
  for each row execute function public.psi_tender_document_extractions_prevent_mutation();

alter table public.psi_tender_document_extractions enable row level security;
revoke all on table public.psi_tender_document_extractions from public, authenticated, anon, service_role;
grant select on table public.psi_tender_document_extractions to service_role;

-- Governed, service-role-only write path. SECURITY DEFINER so service_role can record an
-- extraction without holding a direct INSERT grant on the table (mirrors 052's
-- psi_record_tender_document_chunk). Idempotent by (document_version_id, extractor_version):
-- the same key with the same payload returns the existing row; the same key with a
-- different payload raises 23505 instead of silently overwriting evidence.
create or replace function public.psi_record_tender_document_extraction(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_document_version_id uuid,
  p_extractor_version text,
  p_status text,
  p_parser text,
  p_extracted_text text,
  p_text_hash text,
  p_char_count integer,
  p_text_byte_count integer,
  p_metadata jsonb,
  p_gap_reason text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.psi_tender_document_versions%rowtype;
  v_extraction public.psi_tender_document_extractions%rowtype;
  v_extractor_version text := btrim(p_extractor_version);
  v_parser text := btrim(p_parser);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if nullif(v_extractor_version, '') is null or nullif(v_parser, '') is null then
    raise exception 'La versión del extractor y el parser son obligatorios.' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('ok', 'gap') then
    raise exception 'El estado de la extracción debe ser ok o gap.' using errcode = '22023';
  end if;

  if p_status = 'ok' then
    if nullif(btrim(p_extracted_text), '') is null then
      raise exception 'Una extracción ok requiere texto no vacío.' using errcode = '22023';
    end if;
    if p_text_hash is null or p_text_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'El hash de texto debe ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
    end if;
    if p_char_count is null or p_char_count <= 0 or p_char_count <> char_length(p_extracted_text) then
      raise exception 'El conteo de caracteres no coincide con el texto extraído.' using errcode = '22023';
    end if;
    if p_text_byte_count is null or p_text_byte_count <= 0 or p_text_byte_count <> octet_length(p_extracted_text) then
      raise exception 'El conteo de bytes no coincide con el texto extraído.' using errcode = '22023';
    end if;
    if p_gap_reason is not null then
      raise exception 'Una extracción ok no puede tener gap_reason.' using errcode = '22023';
    end if;
  else
    if p_extracted_text is not null or p_text_hash is not null then
      raise exception 'Una extracción gap no puede tener texto ni hash.' using errcode = '22023';
    end if;
    if coalesce(p_char_count, 0) <> 0 or coalesce(p_text_byte_count, 0) <> 0 then
      raise exception 'Una extracción gap debe tener conteos en cero.' using errcode = '22023';
    end if;
    if nullif(btrim(p_gap_reason), '') is null then
      raise exception 'Una extracción gap requiere gap_reason.' using errcode = '22023';
    end if;
  end if;

  select * into v_version from public.psi_tender_document_versions where id = p_document_version_id for share;
  if not found then raise exception 'La versión documental no existe.' using errcode = 'P0002'; end if;
  if v_version.opportunity_id is distinct from p_opportunity_id or v_version.tender_id is distinct from p_tender_id then
    raise exception 'La versión documental no coincide con la oportunidad y licitación indicadas.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') in ('human', 'agent')
  ) then
    raise exception 'El actor debe ser un perfil humano o agente activo.' using errcode = '42501';
  end if;

  insert into public.psi_tender_document_extractions (
    opportunity_id, tender_id, document_version_id, extractor_version, status, parser,
    extracted_text, text_hash, char_count, text_byte_count, metadata, gap_reason, actor_id
  ) values (
    p_opportunity_id, p_tender_id, p_document_version_id, v_extractor_version, p_status, v_parser,
    p_extracted_text, p_text_hash, coalesce(p_char_count, 0), coalesce(p_text_byte_count, 0),
    v_metadata, p_gap_reason, p_actor_id
  )
  on conflict (document_version_id, extractor_version) do nothing;

  select * into v_extraction from public.psi_tender_document_extractions
  where document_version_id = p_document_version_id and extractor_version = v_extractor_version
  for share;

  if not found
     or v_extraction.opportunity_id is distinct from p_opportunity_id
     or v_extraction.tender_id is distinct from p_tender_id
     or v_extraction.status is distinct from p_status
     or v_extraction.parser is distinct from v_parser
     or v_extraction.extracted_text is distinct from p_extracted_text
     or v_extraction.text_hash is distinct from p_text_hash
     or v_extraction.char_count is distinct from coalesce(p_char_count, 0)
     or v_extraction.text_byte_count is distinct from coalesce(p_text_byte_count, 0)
     or v_extraction.gap_reason is distinct from p_gap_reason
     or v_extraction.metadata is distinct from v_metadata then
    raise exception 'La extracción ya existe con un contenido distinto para esta versión y extractor.' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'id', v_extraction.id,
    'opportunity_id', v_extraction.opportunity_id,
    'tender_id', v_extraction.tender_id,
    'document_version_id', v_extraction.document_version_id,
    'extractor_version', v_extraction.extractor_version,
    'status', v_extraction.status,
    'parser', v_extraction.parser,
    'char_count', v_extraction.char_count,
    'text_byte_count', v_extraction.text_byte_count,
    'text_hash', v_extraction.text_hash,
    'gap_reason', v_extraction.gap_reason,
    'created_at', v_extraction.created_at
  );
end;
$$;

revoke all on function public.psi_record_tender_document_extraction(
  uuid, uuid, uuid, text, text, text, text, text, integer, integer, jsonb, text, uuid
) from public, authenticated, anon, service_role;
grant execute on function public.psi_record_tender_document_extraction(
  uuid, uuid, uuid, text, text, text, text, text, integer, integer, jsonb, text, uuid
) to service_role;

commit;
