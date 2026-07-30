begin;

-- Append-only, deterministic evidence chunks over already-extracted tender document
-- text (agt002-document-chunks.js builds the pure input this table stores). Chunks are
-- tied to an immutable document version, so a new version never overwrites a prior
-- version's chunks — it only adds new rows alongside them, preserving full history.
create table if not exists public.psi_tender_document_chunks (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  document_version_id uuid not null references public.psi_tender_document_versions(id) on delete restrict,
  snapshot_id uuid references public.psi_tender_document_snapshots(id) on delete restrict,
  chunk_id text not null unique check (nullif(btrim(chunk_id), '') is not null),
  evidence_ref text not null check (nullif(btrim(evidence_ref), '') is not null),
  document_type text not null check (nullif(btrim(document_type), '') is not null),
  name text not null check (nullif(btrim(name), '') is not null),
  version integer not null check (version > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  page integer not null check (page > 0),
  section integer not null check (section > 0),
  chunk_index integer not null check (chunk_index >= 0),
  text_content text not null check (nullif(btrim(text_content), '') is not null),
  char_count integer not null check (char_count > 0 and char_count = char_length(text_content)),
  chunk_hash text not null check (chunk_hash ~ '^[0-9a-f]{64}$'),
  current boolean not null,
  precedence text not null check (precedence in ('base', 'addendum')),
  superseded_by_addendum boolean not null default false,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (document_version_id, page, section, chunk_index)
);

create index if not exists psi_tender_document_chunks_opportunity_idx
  on public.psi_tender_document_chunks (opportunity_id, document_version_id, page, section, chunk_index);
create index if not exists psi_tender_document_chunks_snapshot_idx
  on public.psi_tender_document_chunks (snapshot_id)
  where snapshot_id is not null;
create index if not exists psi_tender_document_chunks_document_version_idx
  on public.psi_tender_document_chunks (document_version_id, page, section, chunk_index);

create or replace function public.psi_tender_document_chunks_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_document_chunks is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_tender_document_chunks_immutable on public.psi_tender_document_chunks;
create trigger psi_tender_document_chunks_immutable
  before update or delete on public.psi_tender_document_chunks
  for each row execute function public.psi_tender_document_chunks_prevent_mutation();

alter table public.psi_tender_document_chunks enable row level security;
revoke all on table public.psi_tender_document_chunks from public, authenticated, anon, service_role;
grant select on table public.psi_tender_document_chunks to service_role;

create or replace function public.psi_record_tender_document_chunk(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_document_version_id uuid,
  p_snapshot_id uuid,
  p_chunk_id text,
  p_evidence_ref text,
  p_document_type text,
  p_name text,
  p_version integer,
  p_content_hash text,
  p_page integer,
  p_section integer,
  p_chunk_index integer,
  p_text text,
  p_chunk_hash text,
  p_current boolean,
  p_precedence text,
  p_superseded_by_addendum boolean,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.psi_tender_document_versions%rowtype;
  v_snapshot public.psi_tender_document_snapshots%rowtype;
  v_chunk public.psi_tender_document_chunks%rowtype;
begin
  if nullif(btrim(p_chunk_id), '') is null or nullif(btrim(p_evidence_ref), '') is null then
    raise exception 'El identificador y la referencia de evidencia del chunk son obligatorios.' using errcode = '22023';
  end if;
  if nullif(btrim(p_document_type), '') is null or nullif(btrim(p_name), '') is null then
    raise exception 'El tipo de documento y el nombre son obligatorios.' using errcode = '22023';
  end if;
  if p_version is null or p_version <= 0 then
    raise exception 'La versión del documento debe ser un entero mayor que cero.' using errcode = '22023';
  end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El hash del documento debe ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if p_chunk_hash is null or p_chunk_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El hash del chunk debe ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if nullif(btrim(p_text), '') is null then
    raise exception 'El texto del chunk no puede estar vacío.' using errcode = '22023';
  end if;
  if p_page is null or p_page <= 0 or p_section is null or p_section <= 0 or p_chunk_index is null or p_chunk_index < 0 then
    raise exception 'La página, sección e índice del chunk deben ser válidos.' using errcode = '22023';
  end if;
  if p_current is null then
    raise exception 'La vigencia del documento (current) es obligatoria.' using errcode = '22023';
  end if;
  if p_precedence not in ('base', 'addendum') then
    raise exception 'La precedencia del chunk no es válida.' using errcode = '22023';
  end if;
  if p_superseded_by_addendum is null then
    raise exception 'superseded_by_addendum es obligatorio.' using errcode = '22023';
  end if;

  select * into v_version from public.psi_tender_document_versions where id = p_document_version_id for share;
  if not found then raise exception 'La versión documental no existe.' using errcode = 'P0002'; end if;
  if v_version.opportunity_id is distinct from p_opportunity_id or v_version.tender_id is distinct from p_tender_id then
    raise exception 'La versión documental no coincide con la oportunidad y licitación indicadas.' using errcode = '22023';
  end if;

  if p_snapshot_id is not null then
    select * into v_snapshot from public.psi_tender_document_snapshots where id = p_snapshot_id for share;
    if not found then raise exception 'El snapshot documental no existe.' using errcode = 'P0002'; end if;
    if v_snapshot.opportunity_id is distinct from p_opportunity_id or v_snapshot.tender_id is distinct from p_tender_id then
      raise exception 'El snapshot no puede citar chunks de otra oportunidad.' using errcode = '22023';
    end if;
  end if;

  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') in ('human', 'agent')
  ) then
    raise exception 'El actor debe ser un perfil humano o agente activo.' using errcode = '42501';
  end if;

  insert into public.psi_tender_document_chunks (
    opportunity_id, tender_id, document_version_id, snapshot_id, chunk_id, evidence_ref,
    document_type, name, version, content_hash, page, section, chunk_index, text_content,
    char_count, chunk_hash, current, precedence, superseded_by_addendum, actor_id
  ) values (
    p_opportunity_id, p_tender_id, p_document_version_id, p_snapshot_id, p_chunk_id, p_evidence_ref,
    btrim(p_document_type), btrim(p_name), p_version, p_content_hash, p_page, p_section, p_chunk_index, p_text,
    char_length(p_text), p_chunk_hash, p_current, p_precedence, p_superseded_by_addendum, p_actor_id
  ) on conflict (chunk_id) do nothing;

  select * into v_chunk from public.psi_tender_document_chunks where chunk_id = p_chunk_id for share;
  if not found
     or v_chunk.document_version_id is distinct from p_document_version_id
     or v_chunk.opportunity_id is distinct from p_opportunity_id
     or v_chunk.content_hash is distinct from p_content_hash
     or v_chunk.chunk_hash is distinct from p_chunk_hash
     or v_chunk.text_content is distinct from p_text
     or v_chunk.page is distinct from p_page
     or v_chunk.section is distinct from p_section
     or v_chunk.chunk_index is distinct from p_chunk_index then
    raise exception 'El identificador del chunk ya pertenece a otro contenido.' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'id', v_chunk.id, 'chunk_id', v_chunk.chunk_id, 'evidence_ref', v_chunk.evidence_ref,
    'opportunity_id', v_chunk.opportunity_id, 'document_version_id', v_chunk.document_version_id,
    'snapshot_id', v_chunk.snapshot_id, 'page', v_chunk.page, 'section', v_chunk.section,
    'chunk_index', v_chunk.chunk_index, 'precedence', v_chunk.precedence,
    'superseded_by_addendum', v_chunk.superseded_by_addendum, 'created_at', v_chunk.created_at
  );
end;
$$;

revoke all on function public.psi_record_tender_document_chunk(
  uuid, uuid, uuid, uuid, text, text, text, text, integer, text, integer, integer, integer, text, text, boolean, text, boolean, uuid
) from public, authenticated, anon, service_role;
grant execute on function public.psi_record_tender_document_chunk(
  uuid, uuid, uuid, uuid, text, text, text, text, integer, text, integer, integer, integer, text, text, boolean, text, boolean, uuid
) to service_role;

commit;
