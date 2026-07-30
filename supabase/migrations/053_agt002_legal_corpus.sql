begin;

-- Versioned, append-only official Colombian legal corpus (E5 / Task 30). A
-- corpus version identifies one immutable snapshot of official legal sources
-- (norms, articles, modifications) once published; draft revisions never
-- overwrite a published version — they clone into a brand-new draft with a
-- new identity/semantic version instead (agt002-legal-corpus.js remains the
-- pure validation/citation contract this table shape is compatible with).
create table if not exists public.psi_agt002_legal_corpus_versions (
  id uuid primary key default gen_random_uuid(),
  corpus_version text not null unique check (corpus_version ~ '^[a-z0-9][a-z0-9._-]*$'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  based_on_version_id uuid references public.psi_agt002_legal_corpus_versions(id) on delete restrict,
  description text not null check (nullif(btrim(description), '') is not null),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  published_by uuid references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  check (
    (status = 'draft' and published_at is null and published_by is null)
    or (status = 'published' and published_at is not null and published_by is not null)
  )
);

create index if not exists psi_agt002_legal_corpus_versions_status_idx
  on public.psi_agt002_legal_corpus_versions (status, created_at desc, id desc);

-- Official legal sources tied to an exact corpus version. Field shape mirrors
-- agt002-legal-corpus.js's SOURCE_KEYS: identity, norm/type/number/year/article,
-- current text, issuing authority, effective dates, structured modifications,
-- official URL, topic/sector tags, verified_at and the three closed status
-- dimensions (verification/validity/applicability).
create table if not exists public.psi_agt002_legal_sources (
  id uuid primary key default gen_random_uuid(),
  corpus_version_id uuid not null references public.psi_agt002_legal_corpus_versions(id) on delete restrict,
  source_id text not null check (source_id ~ '^[a-z0-9][a-z0-9._-]*$'),
  norm_type text not null check (nullif(btrim(norm_type), '') is not null),
  norm_number text not null check (nullif(btrim(norm_number), '') is not null),
  year integer not null check (year between 1810 and 2100),
  article_or_section text not null check (nullif(btrim(article_or_section), '') is not null),
  current_text text not null check (nullif(btrim(current_text), '') is not null),
  issuing_authority text not null check (nullif(btrim(issuing_authority), '') is not null),
  issued_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  modifications jsonb not null default '[]'::jsonb check (jsonb_typeof(modifications) = 'array'),
  -- HTTPS-only, closed official-host allowlist equivalent to Task 29's
  -- AGT002_LEGAL_OFFICIAL_HOSTS: exact host or a subdomain of it, no userinfo,
  -- no port, no fragment. Never trust a host merely containing these strings.
  official_url text not null check (
    official_url ~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*(funcionpublica\.gov\.co|suin-juriscol\.gov\.co|colombiacompra\.gov\.co|supervigilancia\.gov\.co)(/[^\s#@]*)?$'
  ),
  topic text[] not null check (array_length(topic, 1) > 0),
  sector text[] not null check (array_length(sector, 1) > 0),
  verified_at timestamptz not null,
  verification_status text not null check (verification_status in ('verified', 'unverified')),
  validity_status text not null check (validity_status in ('confirmed', 'uncertain')),
  applicability_status text not null check (applicability_status in ('applicable', 'uncertain', 'not_applicable')),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  unique (corpus_version_id, source_id),
  check (effective_from is null or effective_to is null or effective_to > effective_from),
  check (validity_status <> 'confirmed' or effective_from is not null)
);

create index if not exists psi_agt002_legal_sources_corpus_version_idx
  on public.psi_agt002_legal_sources (corpus_version_id, source_id);

-- Normalized catalog of every distinct topic/sector tag ever used across the
-- corpus (a global vocabulary, not scoped to one version), populated only by
-- psi_add_agt002_legal_source.
create table if not exists public.psi_agt002_legal_topics (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('topic', 'sector')),
  topic_key text not null check (topic_key = lower(btrim(topic_key)) and nullif(topic_key, '') is not null),
  created_at timestamptz not null default now(),
  unique (kind, topic_key)
);

-- Each canonical analysis run may reference the exact corpus version it
-- consulted. Historical rows (and rows recorded with the legal-corpus flag
-- off) keep this column null; nothing about past rows changes.
alter table public.psi_tender_analysis_runs
  add column if not exists legal_corpus_version_id uuid references public.psi_agt002_legal_corpus_versions(id) on delete restrict;

create index if not exists psi_tender_analysis_runs_legal_corpus_version_idx
  on public.psi_tender_analysis_runs (legal_corpus_version_id)
  where legal_corpus_version_id is not null;

-- A published version (and everything recorded under it) is mechanically
-- immutable: DELETE is always rejected; UPDATE is rejected outright once the
-- row is already published, and the only permitted UPDATE on a draft row is
-- the single publish transition (status/published_at/published_by only).
create or replace function public.psi_agt002_legal_corpus_versions_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'psi_agt002_legal_corpus_versions is append-only: DELETE is prohibited';
  end if;
  if old.status = 'published' then
    raise exception 'Una versión publicada del corpus normativo es inmutable.';
  end if;
  if new.corpus_version is distinct from old.corpus_version
     or new.based_on_version_id is distinct from old.based_on_version_id
     or new.description is distinct from old.description
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Solo se permite la transición de publicación sobre un borrador (status, published_at, published_by).';
  end if;
  if new.status is distinct from 'published' or new.published_at is null or new.published_by is null then
    raise exception 'La única transición permitida sobre un borrador es a published, con published_at y published_by.';
  end if;
  return new;
end;
$$;

drop trigger if exists psi_agt002_legal_corpus_versions_guard on public.psi_agt002_legal_corpus_versions;
create trigger psi_agt002_legal_corpus_versions_guard
  before update or delete on public.psi_agt002_legal_corpus_versions
  for each row execute function public.psi_agt002_legal_corpus_versions_guard();

-- Sources are always append-only: no UPDATE/DELETE ever, published or not.
create or replace function public.psi_agt002_legal_sources_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_legal_sources is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_agt002_legal_sources_immutable on public.psi_agt002_legal_sources;
create trigger psi_agt002_legal_sources_immutable
  before update or delete on public.psi_agt002_legal_sources
  for each row execute function public.psi_agt002_legal_sources_prevent_mutation();

-- Defense in depth at the storage layer: a source can never be inserted
-- against a version that is not (still) a draft, independent of the RPC guard.
create or replace function public.psi_agt002_legal_sources_guard_insert()
returns trigger language plpgsql as $$
declare
  v_status text;
begin
  select status into v_status from public.psi_agt002_legal_corpus_versions where id = new.corpus_version_id;
  if v_status is distinct from 'draft' then
    raise exception 'No se pueden agregar fuentes a una versión publicada o inexistente del corpus.';
  end if;
  return new;
end;
$$;

drop trigger if exists psi_agt002_legal_sources_guard_insert on public.psi_agt002_legal_sources;
create trigger psi_agt002_legal_sources_guard_insert
  before insert on public.psi_agt002_legal_sources
  for each row execute function public.psi_agt002_legal_sources_guard_insert();

-- Topic/sector catalog is append-only as well: entries are only ever added.
create or replace function public.psi_agt002_legal_topics_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_legal_topics is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_agt002_legal_topics_immutable on public.psi_agt002_legal_topics;
create trigger psi_agt002_legal_topics_immutable
  before update or delete on public.psi_agt002_legal_topics
  for each row execute function public.psi_agt002_legal_topics_prevent_mutation();

alter table public.psi_agt002_legal_corpus_versions enable row level security;
alter table public.psi_agt002_legal_sources enable row level security;
alter table public.psi_agt002_legal_topics enable row level security;
revoke all on table public.psi_agt002_legal_corpus_versions from public, authenticated, anon, service_role;
revoke all on table public.psi_agt002_legal_sources from public, authenticated, anon, service_role;
revoke all on table public.psi_agt002_legal_topics from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_legal_corpus_versions to service_role;
grant select on table public.psi_agt002_legal_sources to service_role;
grant select on table public.psi_agt002_legal_topics to service_role;

-- Creates a new draft corpus version. When p_based_on_version_id is given (it
-- must be an already-published version), the draft clones all of that
-- version's sources verbatim into the new draft's own rows: content revision
-- always produces a new, separate version rather than mutating the source one.
create or replace function public.psi_create_agt002_legal_corpus_draft(
  p_corpus_version text,
  p_description text,
  p_actor_id uuid,
  p_based_on_version_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_based public.psi_agt002_legal_corpus_versions%rowtype;
  v_version public.psi_agt002_legal_corpus_versions%rowtype;
  v_cloned integer := 0;
begin
  if p_corpus_version is null or p_corpus_version !~ '^[a-z0-9][a-z0-9._-]*$' then
    raise exception 'corpus_version debe usar solo minúsculas, dígitos, punto, guion o guion bajo.' using errcode = '22023';
  end if;
  if nullif(btrim(p_description), '') is null then
    raise exception 'La descripción de la versión del corpus es obligatoria.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') in ('human', 'agent')
  ) then
    raise exception 'El actor debe ser un perfil humano o agente activo.' using errcode = '42501';
  end if;

  if p_based_on_version_id is not null then
    select * into v_based from public.psi_agt002_legal_corpus_versions where id = p_based_on_version_id for share;
    if not found then raise exception 'La versión base del corpus no existe.' using errcode = 'P0002'; end if;
    if v_based.status <> 'published' then
      raise exception 'Solo puede clonarse una versión publicada del corpus.' using errcode = '22023';
    end if;
  end if;

  insert into public.psi_agt002_legal_corpus_versions (
    corpus_version, status, based_on_version_id, description, created_by
  ) values (
    p_corpus_version, 'draft', p_based_on_version_id, btrim(p_description), p_actor_id
  ) on conflict (corpus_version) do nothing;

  select * into v_version from public.psi_agt002_legal_corpus_versions where corpus_version = p_corpus_version for share;
  if not found
     or v_version.status is distinct from 'draft'
     or v_version.based_on_version_id is distinct from p_based_on_version_id
     or v_version.description is distinct from btrim(p_description)
     or v_version.created_by is distinct from p_actor_id then
    raise exception 'La versión del corpus ya pertenece a otro registro.' using errcode = '23505';
  end if;

  if p_based_on_version_id is not null and not exists (
    select 1 from public.psi_agt002_legal_sources where corpus_version_id = v_version.id
  ) then
    insert into public.psi_agt002_legal_sources (
      corpus_version_id, source_id, norm_type, norm_number, year, article_or_section, current_text,
      issuing_authority, issued_at, effective_from, effective_to, modifications, official_url, topic, sector,
      verified_at, verification_status, validity_status, applicability_status, created_by
    )
    select
      v_version.id, source_id, norm_type, norm_number, year, article_or_section, current_text,
      issuing_authority, issued_at, effective_from, effective_to, modifications, official_url, topic, sector,
      verified_at, verification_status, validity_status, applicability_status, p_actor_id
    from public.psi_agt002_legal_sources
    where corpus_version_id = p_based_on_version_id;
    get diagnostics v_cloned = row_count;
  end if;

  return jsonb_build_object(
    'id', v_version.id, 'corpus_version', v_version.corpus_version, 'status', v_version.status,
    'based_on_version_id', v_version.based_on_version_id, 'description', v_version.description,
    'created_by', v_version.created_by, 'created_at', v_version.created_at, 'cloned_sources', v_cloned
  );
end;
$$;

-- Adds one official legal source to a draft corpus version. Rejects sources
-- for a version that is not (still) draft; is idempotent for an identical
-- resubmission of the same source_id, but rejects a conflicting resubmission
-- under the same source_id. Every distinct topic/sector tag used is folded
-- into the normalized topic catalog.
create or replace function public.psi_add_agt002_legal_source(
  p_corpus_version_id uuid,
  p_source_id text,
  p_norm_type text,
  p_norm_number text,
  p_year integer,
  p_article_or_section text,
  p_current_text text,
  p_issuing_authority text,
  p_issued_at timestamptz,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_modifications jsonb,
  p_official_url text,
  p_topic text[],
  p_sector text[],
  p_verified_at timestamptz,
  p_verification_status text,
  p_validity_status text,
  p_applicability_status text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.psi_agt002_legal_corpus_versions%rowtype;
  v_source public.psi_agt002_legal_sources%rowtype;
  v_tag text;
begin
  if p_source_id is null or p_source_id !~ '^[a-z0-9][a-z0-9._-]*$' then
    raise exception 'source_id debe usar solo minúsculas, dígitos, punto, guion o guion bajo.' using errcode = '22023';
  end if;
  if nullif(btrim(p_norm_type), '') is null or nullif(btrim(p_norm_number), '') is null
     or nullif(btrim(p_article_or_section), '') is null or nullif(btrim(p_issuing_authority), '') is null then
    raise exception 'El tipo, número de norma, artículo/sección y autoridad emisora son obligatorios.' using errcode = '22023';
  end if;
  if p_year is null or p_year < 1810 or p_year > 2100 then
    raise exception 'El año de la norma no es válido.' using errcode = '22023';
  end if;
  if nullif(btrim(p_current_text), '') is null then
    raise exception 'El texto vigente de la norma no puede estar vacío.' using errcode = '22023';
  end if;
  if p_modifications is null or jsonb_typeof(p_modifications) <> 'array' then
    raise exception 'Las modificaciones deben ser una lista estructurada.' using errcode = '22023';
  end if;
  if p_official_url is null or p_official_url !~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*(funcionpublica\.gov\.co|suin-juriscol\.gov\.co|colombiacompra\.gov\.co|supervigilancia\.gov\.co)(/[^\s#@]*)?$' then
    raise exception 'official_url debe ser HTTPS y pertenecer a un host oficial permitido (allowlist cerrada).' using errcode = '22023';
  end if;
  if p_topic is null or array_length(p_topic, 1) is null then
    raise exception 'El tema (topic) es obligatorio.' using errcode = '22023';
  end if;
  if p_sector is null or array_length(p_sector, 1) is null then
    raise exception 'El sector es obligatorio.' using errcode = '22023';
  end if;
  if p_verified_at is null then
    raise exception 'La fecha de verificación (verified_at) es obligatoria.' using errcode = '22023';
  end if;
  if p_verification_status not in ('verified', 'unverified') then
    raise exception 'verification_status debe ser verified o unverified.' using errcode = '22023';
  end if;
  if p_validity_status not in ('confirmed', 'uncertain') then
    raise exception 'validity_status debe ser confirmed o uncertain.' using errcode = '22023';
  end if;
  if p_applicability_status not in ('applicable', 'uncertain', 'not_applicable') then
    raise exception 'applicability_status debe ser applicable, uncertain o not_applicable.' using errcode = '22023';
  end if;
  if p_validity_status = 'confirmed' and p_effective_from is null then
    raise exception 'validity_status confirmed exige effective_from.' using errcode = '22023';
  end if;
  if p_effective_from is not null and p_effective_to is not null and p_effective_to <= p_effective_from then
    raise exception 'effective_to debe ser posterior a effective_from.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') in ('human', 'agent')
  ) then
    raise exception 'El actor debe ser un perfil humano o agente activo.' using errcode = '42501';
  end if;

  select * into v_version from public.psi_agt002_legal_corpus_versions where id = p_corpus_version_id for share;
  if not found then raise exception 'La versión del corpus no existe.' using errcode = 'P0002'; end if;
  if v_version.status <> 'draft' then
    raise exception 'No se pueden agregar fuentes a una versión publicada del corpus.' using errcode = '22023';
  end if;

  insert into public.psi_agt002_legal_sources (
    corpus_version_id, source_id, norm_type, norm_number, year, article_or_section, current_text,
    issuing_authority, issued_at, effective_from, effective_to, modifications, official_url, topic, sector,
    verified_at, verification_status, validity_status, applicability_status, created_by
  ) values (
    p_corpus_version_id, p_source_id, btrim(p_norm_type), btrim(p_norm_number), p_year, btrim(p_article_or_section), btrim(p_current_text),
    btrim(p_issuing_authority), p_issued_at, p_effective_from, p_effective_to, p_modifications, p_official_url, p_topic, p_sector,
    p_verified_at, p_verification_status, p_validity_status, p_applicability_status, p_actor_id
  ) on conflict (corpus_version_id, source_id) do nothing;

  select * into v_source from public.psi_agt002_legal_sources
  where corpus_version_id = p_corpus_version_id and source_id = p_source_id for share;
  if not found
     or v_source.current_text is distinct from btrim(p_current_text)
     or v_source.official_url is distinct from p_official_url
     or v_source.verification_status is distinct from p_verification_status
     or v_source.validity_status is distinct from p_validity_status
     or v_source.applicability_status is distinct from p_applicability_status then
    raise exception 'El identificador de fuente ya pertenece a otro contenido en esta versión.' using errcode = '23505';
  end if;

  foreach v_tag in array p_topic loop
    insert into public.psi_agt002_legal_topics (kind, topic_key) values ('topic', v_tag) on conflict (kind, topic_key) do nothing;
  end loop;
  foreach v_tag in array p_sector loop
    insert into public.psi_agt002_legal_topics (kind, topic_key) values ('sector', v_tag) on conflict (kind, topic_key) do nothing;
  end loop;

  return jsonb_build_object(
    'id', v_source.id, 'corpus_version_id', v_source.corpus_version_id, 'source_id', v_source.source_id,
    'official_url', v_source.official_url, 'verification_status', v_source.verification_status,
    'validity_status', v_source.validity_status, 'applicability_status', v_source.applicability_status,
    'created_at', v_source.created_at
  );
end;
$$;

-- Publishes a draft corpus version exactly once. A version already published
-- cannot be published again (it is already mechanically immutable via the
-- guard trigger above); a draft with zero sources cannot be published.
create or replace function public.psi_publish_agt002_legal_corpus(
  p_corpus_version_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.psi_agt002_legal_corpus_versions%rowtype;
  v_source_count integer;
begin
  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') in ('human', 'agent')
  ) then
    raise exception 'El actor debe ser un perfil humano o agente activo.' using errcode = '42501';
  end if;

  select * into v_version from public.psi_agt002_legal_corpus_versions where id = p_corpus_version_id for update;
  if not found then raise exception 'La versión del corpus no existe.' using errcode = 'P0002'; end if;
  if v_version.status = 'published' then
    raise exception 'La versión del corpus ya está publicada; no puede publicarse de nuevo.' using errcode = '22023';
  end if;

  select count(*) into v_source_count from public.psi_agt002_legal_sources where corpus_version_id = p_corpus_version_id;
  if v_source_count = 0 then
    raise exception 'No se puede publicar una versión del corpus sin fuentes normativas.' using errcode = '22023';
  end if;

  update public.psi_agt002_legal_corpus_versions
  set status = 'published', published_at = now(), published_by = p_actor_id
  where id = p_corpus_version_id;

  select * into v_version from public.psi_agt002_legal_corpus_versions where id = p_corpus_version_id for share;

  return jsonb_build_object(
    'id', v_version.id, 'corpus_version', v_version.corpus_version, 'status', v_version.status,
    'published_at', v_version.published_at, 'published_by', v_version.published_by
  );
end;
$$;

revoke all on function public.psi_create_agt002_legal_corpus_draft(text, text, uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_create_agt002_legal_corpus_draft(text, text, uuid, uuid) to service_role;

revoke all on function public.psi_add_agt002_legal_source(
  uuid, text, text, text, integer, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text, text[], text[], timestamptz, text, text, text, uuid
) from public, authenticated, anon, service_role;
grant execute on function public.psi_add_agt002_legal_source(
  uuid, text, text, text, integer, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text, text[], text[], timestamptz, text, text, text, uuid
) to service_role;

revoke all on function public.psi_publish_agt002_legal_corpus(uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_publish_agt002_legal_corpus(uuid, uuid) to service_role;

-- Supersede 051's canonical-run RPC with one additional optional parameter so a
-- canonical AGT-002 run can reference the exact legal corpus version it
-- consulted. The 051 11-parameter overload is dropped (not left dangling) so
-- callers cannot silently keep recording canonical runs without an
-- attributable corpus version once this migration is applied.
drop function if exists public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid);

create function public.psi_record_agt002_canonical_analysis_run(
  p_snapshot_id uuid,
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_result jsonb,
  p_critical_open_count integer,
  p_idempotency_key text,
  p_schema_version text,
  p_policy_version text,
  p_model text default null,
  p_usage jsonb default null,
  p_context_version_id uuid default null,
  p_legal_corpus_version_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.psi_tender_document_snapshots%rowtype;
  v_run public.psi_tender_analysis_runs%rowtype;
  v_context_version public.psi_agt002_context_versions%rowtype;
  v_legal_corpus_version public.psi_agt002_legal_corpus_versions%rowtype;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'Un análisis canónico completado requiere resultado estructurado.' using errcode = '22023';
  end if;
  if p_critical_open_count is null or p_critical_open_count < 0 then
    raise exception 'El conteo de preguntas críticas no es válido.' using errcode = '22023';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or nullif(btrim(p_schema_version), '') is null
     or nullif(btrim(p_policy_version), '') is null then
    raise exception 'La clave de idempotencia y las versiones son obligatorias.' using errcode = '22023';
  end if;
  if p_usage is not null and jsonb_typeof(p_usage) <> 'object' then
    raise exception 'El uso del análisis debe ser un objeto estructurado.' using errcode = '22023';
  end if;
  if p_context_version_id is null then
    raise exception 'Todo nuevo análisis canónico AGT-002 requiere una versión de contexto atribuible.' using errcode = '22023';
  end if;

  select * into v_snapshot from public.psi_tender_document_snapshots where id = p_snapshot_id for share;
  if not found then raise exception 'El snapshot documental no existe.' using errcode = 'P0002'; end if;
  if v_snapshot.opportunity_id is distinct from p_opportunity_id or v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot no coincide con la oportunidad y licitación indicadas.' using errcode = '22023';
  end if;

  if p_context_version_id is not null then
    select * into v_context_version from public.psi_agt002_context_versions where id = p_context_version_id for share;
    if not found then raise exception 'La versión de contexto AGT-002 no existe.' using errcode = 'P0002'; end if;
    if v_context_version.opportunity_id is distinct from p_opportunity_id
       or v_context_version.tender_id is distinct from p_tender_id
       or v_context_version.snapshot_id is distinct from p_snapshot_id then
      raise exception 'La versión de contexto no coincide con la oportunidad, licitación y snapshot indicados.' using errcode = '22023';
    end if;
  end if;

  if p_legal_corpus_version_id is not null then
    select * into v_legal_corpus_version from public.psi_agt002_legal_corpus_versions where id = p_legal_corpus_version_id for share;
    if not found then raise exception 'La versión del corpus normativo no existe.' using errcode = 'P0002'; end if;
  end if;

  insert into public.psi_tender_analysis_runs (
    snapshot_id, opportunity_id, tender_id, producer, method, status, result, critical_open_count,
    idempotency_key, schema_version, policy_version, model, usage, completed_at, canonical,
    context_version_id, legal_corpus_version_id
  ) values (
    p_snapshot_id, p_opportunity_id, p_tender_id, 'AGT-002', 'agent_ai', 'completed', p_result,
    p_critical_open_count, p_idempotency_key, p_schema_version, p_policy_version,
    nullif(btrim(p_model), ''), p_usage, now(), true, p_context_version_id, p_legal_corpus_version_id
  ) on conflict (idempotency_key) do nothing;

  select * into v_run from public.psi_tender_analysis_runs where idempotency_key = p_idempotency_key for share;
  if not found
     or v_run.snapshot_id is distinct from p_snapshot_id
     or v_run.opportunity_id is distinct from p_opportunity_id
     or v_run.tender_id is distinct from p_tender_id
     or v_run.producer is distinct from 'AGT-002'
     or v_run.method is distinct from 'agent_ai'
     or v_run.status is distinct from 'completed'
     or v_run.result is distinct from p_result
     or v_run.critical_open_count is distinct from p_critical_open_count
     or v_run.schema_version is distinct from p_schema_version
     or v_run.policy_version is distinct from p_policy_version
     or v_run.model is distinct from nullif(btrim(p_model), '')
     or v_run.usage is distinct from p_usage
     or v_run.canonical is distinct from true
     or v_run.context_version_id is distinct from p_context_version_id
     or v_run.legal_corpus_version_id is distinct from p_legal_corpus_version_id then
    raise exception 'La clave de idempotencia ya pertenece a otro análisis.' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'id', v_run.id, 'snapshot_id', v_run.snapshot_id, 'opportunity_id', v_run.opportunity_id,
    'tender_id', v_run.tender_id, 'producer', v_run.producer, 'method', v_run.method,
    'status', v_run.status, 'canonical', v_run.canonical, 'critical_open_count', v_run.critical_open_count,
    'context_version_id', v_run.context_version_id, 'legal_corpus_version_id', v_run.legal_corpus_version_id,
    'created_at', v_run.created_at, 'completed_at', v_run.completed_at
  );
end;
$$;

revoke all on function public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid) to service_role;

commit;
