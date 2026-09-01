begin;
-- 078 (GREEN sub-block 2A + 2B): AGT-002 «Revisar pendiente» actionable
-- review and reusable knowledge (design
-- docs/superpowers/specs/2026-08-31-agt002-actionable-review-knowledge-design.md
-- §§5-8, 9-12, 14-16, 19, 23). Sub-block 2A created the append-only
-- table/index/FK/check/unique/immutable-trigger foundation for the ten fact
-- tables of §9 plus the two deferred constraint triggers of §9.3/§9.8.
-- Sub-block 2B appends, on top of that foundation and only for the two
-- tables it touches (`psi_tender_actionable_review_items` and
-- `psi_tender_actionable_review_events`), RLS + revoke/grant per §9 and the
-- review-item lifecycle RPCs of §11: `psi_ensure_tender_actionable_review_item`,
-- `psi_record_tender_actionable_review_comment`,
-- `psi_record_tender_actionable_review_outcome` and
-- `psi_reopen_tender_actionable_review`. Sub-block 2C appends, on top of
-- that, RLS + revoke/grant for the three tables it touches
-- (`psi_tender_actionable_review_upload_tickets`,
-- `psi_tender_actionable_review_attachments` and
-- `psi_tender_actionable_review_resolution_supports`) and the private
-- upload-ticket/attachment RPCs of §9.3-9.4/§11/§13:
-- `psi_issue_tender_actionable_review_upload_ticket` and
-- `psi_complete_tender_actionable_review_attachment`. Sub-block 2D completes
-- the migration: RLS + revoke/grant for the five knowledge tables
-- (`psi_tender_knowledge_items`, `psi_tender_knowledge_versions`,
-- `psi_tender_knowledge_version_sources`, `psi_tender_knowledge_events`,
-- `psi_tender_knowledge_publications`) and the full candidate/review/
-- publication lifecycle RPCs of §11: `psi_create_tender_knowledge_candidate`,
-- `psi_add_tender_knowledge_version`, `psi_submit_tender_knowledge_version`,
-- `psi_approve_tender_knowledge_version`, `psi_reject_tender_knowledge_version`
-- and `psi_record_tender_knowledge_publication`. Sub-block 2E appends, on top
-- of all of the above, the single read-only projection RPC of §16.3:
-- `psi_select_tender_knowledge_assets`, the server-side query behind
-- `vigia-approved-assets.js`'s async `selectVigiaApprovedAssets` selector. It
-- only ever reads the five knowledge tables above (no writes, no automatic
-- publication, no reanalysis) and joins item + current approved/published
-- version + events + publication, discarding before returning any row that
-- is not the current approved/published, non-replaced, non-superseded
-- version of its item; is not `confidentiality = 'interno'` and
-- `agent_reuse_allowed = true`; is not currently within
-- `valid_from`/`valid_until`/`review_on`; or whose publication lacks a
-- valid SharePoint `web_url`/`content_hash`/library root. No automatic
-- publication, no background reanalysis: every knowledge-lifecycle
-- transition requires an explicit human actor id validated against
-- `psi_sales_profiles` (active, `identity_type = 'human'`); `service_role`
-- is only ever the transport credential that carries an already-authorized,
-- human-scoped call into the SECURITY DEFINER RPC — it is never itself
-- treated as an authorization decision.
--
-- Note on `request_hash`/`declared_content_hash`: unlike content hashes
-- (still constrained to `^[0-9a-f]{64}$`, always real SHA-256 hex from the
-- Node hashing module of §6.4), `request_hash` is only constrained to
-- `length(...) = 64` — an opaque, server-owned idempotency correlation
-- value, never recomputed or interpreted as hex by SQL.
--
-- Autonomous of "Archivar como aprendizaje" (migration 045) and of the
-- canonical AGT-002 reanalysis/document-refresh path: this file defines only
-- the ten new tables of §9 above and never references the Mesa Vig-IA tables,
-- the human-answer reanalysis trigger or the canonical document refresh RPC.

-- ---------------------------------------------------------------------------
-- §9.1 / §6.2 — psi_tender_actionable_review_items: stable pendiente identity.
-- ---------------------------------------------------------------------------
create table if not exists public.psi_tender_actionable_review_items (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  analysis_run_id uuid not null references public.psi_tender_analysis_runs(id) on delete restrict,
  source_kind text not null check (source_kind in ('integral_unit','decision_review_finding')),
  source_id text not null check (nullif(btrim(source_id), '') is not null),
  requirement_id text,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  hash_contract text not null check (hash_contract = 'agt002-actionable-review-json-v1'),
  origin text not null check (origin = 'canonical_analysis_projection'),
  created_at timestamptz not null default now(),
  constraint psi_tender_actionable_review_items_identity_key unique (analysis_run_id, source_kind, source_id)
);
create index if not exists psi_tender_actionable_review_items_opportunity_run_idx
  on public.psi_tender_actionable_review_items(opportunity_id, analysis_run_id);

-- ---------------------------------------------------------------------------
-- §9.4 / §13.2 — psi_tender_actionable_review_upload_tickets: single-use,
-- persisted upload authorization. Its consumed_at transition is the one
-- documented exception to append-only (§9 preamble).
-- ---------------------------------------------------------------------------
create table if not exists public.psi_tender_actionable_review_upload_tickets (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references public.psi_tender_actionable_review_items(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  logical_attachment_id uuid not null,
  version integer not null check (version > 0),
  storage_path text not null,
  name text not null check (nullif(btrim(name), '') is not null and length(name) <= 140),
  extension text not null check (extension in ('.pdf','.png','.jpg','.jpeg','.docx','.xlsx','.txt')),
  declared_mime_type text not null check (nullif(btrim(declared_mime_type), '') is not null),
  declared_size_bytes bigint not null check (declared_size_bytes > 0 and declared_size_bytes <= 26214400),
  declared_content_hash text not null check (declared_content_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  hash_contract text not null check (hash_contract = 'agt002-actionable-review-json-v1'),
  idempotency_key uuid not null,
  request_hash text not null check (length(request_hash) = 64),
  request_hash_contract text not null check (request_hash_contract = 'agt002-actionable-review-json-v1'),
  nonce_hash text not null check (nonce_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint psi_tender_actionable_review_upload_tickets_storage_path_key unique (storage_path),
  constraint psi_tender_actionable_review_upload_tickets_logical_version_key unique (logical_attachment_id, version),
  constraint psi_tender_actionable_review_upload_tickets_nonce_key unique (nonce_hash),
  constraint psi_tender_actionable_review_upload_tickets_idempotency_key unique (actor_id, idempotency_key),
  constraint psi_tender_actionable_review_upload_tickets_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint psi_tender_actionable_review_upload_tickets_consumed_after_created
    check (consumed_at is null or consumed_at >= created_at)
);
create index if not exists psi_tender_actionable_review_upload_tickets_item_idx
  on public.psi_tender_actionable_review_upload_tickets(review_item_id);
create index if not exists psi_tender_actionable_review_upload_tickets_pending_idx
  on public.psi_tender_actionable_review_upload_tickets(expires_at) where consumed_at is null;

-- ---------------------------------------------------------------------------
-- §9.3 — psi_tender_actionable_review_attachments: one row per immutable
-- version. A replacement creates version n+1; the prior version stays visible.
-- ---------------------------------------------------------------------------
create table if not exists public.psi_tender_actionable_review_attachments (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references public.psi_tender_actionable_review_items(id) on delete restrict,
  upload_ticket_id uuid not null unique references public.psi_tender_actionable_review_upload_tickets(id) on delete restrict,
  logical_attachment_id uuid not null,
  version integer not null check (version > 0),
  supersedes_attachment_id uuid references public.psi_tender_actionable_review_attachments(id) on delete restrict,
  name text not null check (nullif(btrim(name), '') is not null and length(name) <= 140),
  extension text not null check (extension in ('.pdf','.png','.jpg','.jpeg','.docx','.xlsx','.txt')),
  declared_mime_type text not null check (nullif(btrim(declared_mime_type), '') is not null),
  detected_mime_type text not null check (nullif(btrim(detected_mime_type), '') is not null),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  storage_path text not null unique,
  validation_status text not null check (validation_status = 'content_validated'),
  uploaded_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  origin text not null check (origin = 'human_ui'),
  uploaded_at timestamptz not null default now(),
  constraint psi_tender_actionable_review_attachments_logical_version_key unique (logical_attachment_id, version),
  constraint psi_tender_actionable_review_attachments_item_hash_key unique (review_item_id, content_hash)
);
create index if not exists psi_tender_actionable_review_attachments_item_idx
  on public.psi_tender_actionable_review_attachments(review_item_id);

-- ---------------------------------------------------------------------------
-- §9.2 — psi_tender_actionable_review_events: the single append-only
-- collaboration/lifecycle log, sharing one global per-item sequence.
-- ---------------------------------------------------------------------------
create table if not exists public.psi_tender_actionable_review_events (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references public.psi_tender_actionable_review_items(id) on delete restrict,
  sequence bigint not null check (sequence > 0),
  event_type text not null check (event_type in (
    'review_started','comment_added','attachment_added','outcome_recorded','reopened','knowledge_requested'
  )),
  attachment_id uuid references public.psi_tender_actionable_review_attachments(id) on delete restrict deferrable initially deferred,
  outcome text check (outcome is null or outcome in (
    'aclarado_con_soporte','riesgo_confirmado','no_aplica','informacion_insuficiente'
  )),
  note text,
  reusable_requested boolean,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  origin text not null check (origin = 'human_ui'),
  idempotency_key uuid not null,
  request_hash text not null check (length(request_hash) = 64),
  request_hash_contract text not null check (request_hash_contract = 'agt002-actionable-review-json-v1'),
  created_at timestamptz not null default now(),
  constraint psi_tender_actionable_review_events_sequence_key unique (review_item_id, sequence),
  constraint psi_tender_actionable_review_events_idempotency_key unique (actor_id, idempotency_key),
  -- Row shape per event_type (§9.2 validations): which columns are required
  -- vs. must stay null. Cross-row invariants (e.g. "knowledge_requested only
  -- after a closed outcome") are RPC-level and land with the RPCs in 2B-2D.
  constraint psi_tender_actionable_review_events_shape_check check (
    case event_type
      when 'review_started' then
        attachment_id is null and outcome is null and note is null and reusable_requested is null
      when 'comment_added' then
        attachment_id is null and outcome is null and reusable_requested is null
        and note is not null and length(note) between 1 and 10000
      when 'attachment_added' then
        attachment_id is not null and outcome is null and note is null and reusable_requested is null
      when 'outcome_recorded' then
        attachment_id is null and outcome is not null
        and note is not null and length(note) between 1 and 10000
      when 'reopened' then
        attachment_id is null and outcome is null and reusable_requested is null
        and note is not null and length(note) between 1 and 10000
      when 'knowledge_requested' then
        attachment_id is null and outcome is null and note is null and reusable_requested is null
      else false
    end
  ),
  constraint psi_tender_actionable_review_events_reusable_requires_closed_outcome check (
    reusable_requested is not true
    or (event_type = 'outcome_recorded' and outcome in ('aclarado_con_soporte','riesgo_confirmado','no_aplica'))
  )
);
create unique index if not exists psi_tender_actionable_review_events_attachment_unique
  on public.psi_tender_actionable_review_events(attachment_id) where attachment_id is not null;

-- ---------------------------------------------------------------------------
-- §9.5 — psi_tender_actionable_review_resolution_supports: immutable
-- selection of approved supports for one closed resolution.
-- ---------------------------------------------------------------------------
create table if not exists public.psi_tender_actionable_review_resolution_supports (
  resolution_event_id uuid not null references public.psi_tender_actionable_review_events(id) on delete restrict,
  attachment_id uuid not null references public.psi_tender_actionable_review_attachments(id) on delete restrict,
  selected_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  origin text not null check (origin = 'human_ui'),
  selected_at timestamptz not null default now(),
  primary key (resolution_event_id, attachment_id)
);

-- ---------------------------------------------------------------------------
-- §9.6 — psi_tender_knowledge_items: the concept identity. scope_type is
-- immutable by construction (append-only guard below forbids any UPDATE).
-- ---------------------------------------------------------------------------
create table if not exists public.psi_tender_knowledge_items (
  id uuid primary key default gen_random_uuid(),
  source_review_item_id uuid not null references public.psi_tender_actionable_review_items(id) on delete restrict,
  source_resolution_event_id uuid not null references public.psi_tender_actionable_review_events(id) on delete restrict,
  scope_type text not null check (scope_type in ('general','regional','cliente','tipo_servicio')),
  scope_value text,
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  origin text not null check (origin in ('human_ui','vigia_candidate')),
  created_at timestamptz not null default now(),
  constraint psi_tender_knowledge_items_scope_value_check check (
    (scope_type = 'general' and scope_value is null)
    or (scope_type <> 'general' and nullif(btrim(scope_value), '') is not null)
  )
);
create index if not exists psi_tender_knowledge_items_source_idx
  on public.psi_tender_knowledge_items(source_review_item_id);

-- Helper immutable function backing the tags check below (§9.7): a CHECK
-- constraint cannot contain a subquery, so cardinality/length validation over
-- the text[] is expressed as a small immutable PL/pgSQL function instead.
create or replace function public.psi_agt002_knowledge_tags_are_valid(p_tags text[])
returns boolean language plpgsql immutable as $$
declare
  v_tag text;
begin
  if p_tags is null then
    return true;
  end if;
  if cardinality(p_tags) > 20 then
    return false;
  end if;
  foreach v_tag in array p_tags loop
    if length(v_tag) < 1 or length(v_tag) > 64 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- §9.7 — psi_tender_knowledge_versions: immutable content of one version.
-- ---------------------------------------------------------------------------
create table if not exists public.psi_tender_knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  knowledge_item_id uuid not null references public.psi_tender_knowledge_items(id) on delete restrict,
  version integer not null check (version > 0),
  supersedes_version_id uuid references public.psi_tender_knowledge_versions(id) on delete restrict,
  reusable_summary text not null check (length(reusable_summary) between 1 and 4000),
  valid_from date not null,
  valid_until date,
  review_on date not null,
  tags text[] not null default '{}'::text[] check (public.psi_agt002_knowledge_tags_are_valid(tags)),
  confidentiality text not null check (confidentiality in ('interno','restringido')),
  agent_reuse_allowed boolean not null default false,
  responsible_profile_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  sanitization_attestation text not null check (length(sanitization_attestation) between 20 and 2000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  origin text not null check (origin in ('human_ui','vigia_candidate')),
  created_at timestamptz not null default now(),
  constraint psi_tender_knowledge_versions_item_version_key unique (knowledge_item_id, version),
  constraint psi_tender_knowledge_versions_validity_check check (valid_until is null or valid_until > valid_from),
  constraint psi_tender_knowledge_versions_review_on_check check (
    (valid_until is not null and review_on >= valid_from and review_on <= valid_until)
    or (valid_until is null and review_on > valid_from)
  ),
  constraint psi_tender_knowledge_versions_restricted_no_agent_reuse check (
    confidentiality <> 'restringido' or agent_reuse_allowed = false
  )
);
create index if not exists psi_tender_knowledge_versions_item_idx
  on public.psi_tender_knowledge_versions(knowledge_item_id);

-- ---------------------------------------------------------------------------
-- §9.8 — psi_tender_knowledge_version_sources: closed source set per version.
-- source_id is polymorphic (resolution_event | approved_attachment) by
-- source_type, so it carries no direct FK; the deferred constraint trigger
-- below enforces the exact bijection at commit.
-- ---------------------------------------------------------------------------
create table if not exists public.psi_tender_knowledge_version_sources (
  knowledge_version_id uuid not null references public.psi_tender_knowledge_versions(id) on delete restrict,
  source_type text not null check (source_type in ('resolution_event','approved_attachment')),
  source_id uuid not null,
  added_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  origin text not null check (origin in ('human_ui','vigia_candidate')),
  added_at timestamptz not null default now(),
  primary key (knowledge_version_id, source_type, source_id)
);
create index if not exists psi_tender_knowledge_version_sources_version_idx
  on public.psi_tender_knowledge_version_sources(knowledge_version_id);

-- ---------------------------------------------------------------------------
-- §9.9 — psi_tender_knowledge_events: append-only state events per version.
-- ---------------------------------------------------------------------------
create table if not exists public.psi_tender_knowledge_events (
  id uuid primary key default gen_random_uuid(),
  knowledge_version_id uuid not null references public.psi_tender_knowledge_versions(id) on delete restrict,
  sequence bigint not null check (sequence > 0),
  event_type text not null check (event_type in (
    'draft_created','submitted','approved','rejected','published','replaced'
  )),
  note text check (note is null or length(note) between 1 and 10000),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  origin text not null check (origin in ('human_ui','sharepoint_publication')),
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request_hash_contract text not null check (request_hash_contract = 'agt002-actionable-review-json-v1'),
  created_at timestamptz not null default now(),
  constraint psi_tender_knowledge_events_sequence_key unique (knowledge_version_id, sequence),
  constraint psi_tender_knowledge_events_idempotency_key unique (actor_id, idempotency_key),
  constraint psi_tender_knowledge_events_rejected_requires_note check (
    event_type <> 'rejected' or (note is not null and length(note) between 1 and 10000)
  )
);

-- ---------------------------------------------------------------------------
-- §9.10 — psi_tender_knowledge_publications: append-only proof of external
-- publication. library_root is pinned to the exact approved corporate root.
-- ---------------------------------------------------------------------------
create table if not exists public.psi_tender_knowledge_publications (
  id uuid primary key default gen_random_uuid(),
  knowledge_version_id uuid not null unique references public.psi_tender_knowledge_versions(id) on delete restrict,
  knowledge_item_id uuid not null references public.psi_tender_knowledge_items(id) on delete restrict,
  library_root text not null check (library_root = 'Comercial/Licitaciones/02 Biblioteca corporativa'),
  relative_path text not null check (nullif(btrim(relative_path), '') is not null),
  site_id text not null check (nullif(btrim(site_id), '') is not null),
  drive_id text not null check (nullif(btrim(drive_id), '') is not null),
  drive_item_id text not null check (nullif(btrim(drive_item_id), '') is not null),
  web_url text not null check (web_url ~ '^https://[a-z0-9.-]+\.sharepoint\.com/' and web_url !~ '[?#]'),
  e_tag text not null check (nullif(btrim(e_tag), '') is not null),
  sharepoint_version text not null check (nullif(btrim(sharepoint_version), '') is not null),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  published_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  origin text not null check (origin = 'sharepoint_publication'),
  published_at timestamptz not null default now(),
  constraint psi_tender_knowledge_publications_drive_item_version_key unique (drive_id, drive_item_id, sharepoint_version)
);
create index if not exists psi_tender_knowledge_publications_item_idx
  on public.psi_tender_knowledge_publications(knowledge_item_id);

-- ---------------------------------------------------------------------------
-- §9 preamble — append-only guard: BEFORE UPDATE OR DELETE rejects mutation
-- on every fact table except upload_tickets (dedicated guard further below).
-- ---------------------------------------------------------------------------
create or replace function public.psi_block_agt002_actionable_review_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'La bitácora de revisión accionable y conocimiento de AGT-002 es de solo inserción (append-only): UPDATE y DELETE están prohibidos.'
    using errcode = '55000';
end;
$$;

drop trigger if exists trg_psi_tender_actionable_review_items_append_only on public.psi_tender_actionable_review_items;
create trigger trg_psi_tender_actionable_review_items_append_only
  before update or delete on public.psi_tender_actionable_review_items
  for each row execute function public.psi_block_agt002_actionable_review_mutation();

drop trigger if exists trg_psi_tender_actionable_review_events_append_only on public.psi_tender_actionable_review_events;
create trigger trg_psi_tender_actionable_review_events_append_only
  before update or delete on public.psi_tender_actionable_review_events
  for each row execute function public.psi_block_agt002_actionable_review_mutation();

drop trigger if exists trg_psi_tender_actionable_review_attachments_append_only on public.psi_tender_actionable_review_attachments;
create trigger trg_psi_tender_actionable_review_attachments_append_only
  before update or delete on public.psi_tender_actionable_review_attachments
  for each row execute function public.psi_block_agt002_actionable_review_mutation();

drop trigger if exists trg_psi_tender_actionable_review_resolution_supports_append_only on public.psi_tender_actionable_review_resolution_supports;
create trigger trg_psi_tender_actionable_review_resolution_supports_append_only
  before update or delete on public.psi_tender_actionable_review_resolution_supports
  for each row execute function public.psi_block_agt002_actionable_review_mutation();

drop trigger if exists trg_psi_tender_knowledge_items_append_only on public.psi_tender_knowledge_items;
create trigger trg_psi_tender_knowledge_items_append_only
  before update or delete on public.psi_tender_knowledge_items
  for each row execute function public.psi_block_agt002_actionable_review_mutation();

drop trigger if exists trg_psi_tender_knowledge_versions_append_only on public.psi_tender_knowledge_versions;
create trigger trg_psi_tender_knowledge_versions_append_only
  before update or delete on public.psi_tender_knowledge_versions
  for each row execute function public.psi_block_agt002_actionable_review_mutation();

drop trigger if exists trg_psi_tender_knowledge_version_sources_append_only on public.psi_tender_knowledge_version_sources;
create trigger trg_psi_tender_knowledge_version_sources_append_only
  before update or delete on public.psi_tender_knowledge_version_sources
  for each row execute function public.psi_block_agt002_actionable_review_mutation();

drop trigger if exists trg_psi_tender_knowledge_events_append_only on public.psi_tender_knowledge_events;
create trigger trg_psi_tender_knowledge_events_append_only
  before update or delete on public.psi_tender_knowledge_events
  for each row execute function public.psi_block_agt002_actionable_review_mutation();

drop trigger if exists trg_psi_tender_knowledge_publications_append_only on public.psi_tender_knowledge_publications;
create trigger trg_psi_tender_knowledge_publications_append_only
  before update or delete on public.psi_tender_knowledge_publications
  for each row execute function public.psi_block_agt002_actionable_review_mutation();

-- ---------------------------------------------------------------------------
-- §9.4 — dedicated upload_tickets guard: rejects DELETE outright and only
-- allows the single monotonic UPDATE consumed_at: null -> timestamp, with
-- every other column held constant. A second consumption attempt, a reset,
-- or any other column change is rejected.
-- ---------------------------------------------------------------------------
create or replace function public.psi_guard_agt002_review_upload_ticket_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'psi_tender_actionable_review_upload_tickets es de solo consumo: DELETE está prohibido.'
      using errcode = '55000';
  end if;

  if old.consumed_at is not null then
    raise exception 'El ticket de carga ya fue consumido y no admite una segunda transición.'
      using errcode = '55000';
  end if;

  if new.consumed_at is null then
    raise exception 'La única transición permitida en upload_tickets es asignar consumed_at una sola vez.'
      using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.review_item_id is distinct from old.review_item_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.actor_id is distinct from old.actor_id
    or new.logical_attachment_id is distinct from old.logical_attachment_id
    or new.version is distinct from old.version
    or new.storage_path is distinct from old.storage_path
    or new.name is distinct from old.name
    or new.extension is distinct from old.extension
    or new.declared_mime_type is distinct from old.declared_mime_type
    or new.declared_size_bytes is distinct from old.declared_size_bytes
    or new.declared_content_hash is distinct from old.declared_content_hash
    or new.payload_hash is distinct from old.payload_hash
    or new.hash_contract is distinct from old.hash_contract
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_hash is distinct from old.request_hash
    or new.request_hash_contract is distinct from old.request_hash_contract
    or new.nonce_hash is distinct from old.nonce_hash
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'La transición de upload_tickets sólo puede asignar consumed_at; ninguna otra columna admite cambios.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_psi_tender_actionable_review_upload_tickets_guard on public.psi_tender_actionable_review_upload_tickets;
create trigger trg_psi_tender_actionable_review_upload_tickets_guard
  before update or delete on public.psi_tender_actionable_review_upload_tickets
  for each row execute function public.psi_guard_agt002_review_upload_ticket_mutation();

-- ---------------------------------------------------------------------------
-- §9.3 — deferred constraint trigger: exact adjunto <-> attachment_added
-- bijection, enforced at COMMIT (not merely at RPC time).
-- ---------------------------------------------------------------------------
create or replace function public.psi_check_agt002_review_attachment_bijection()
returns trigger language plpgsql as $$
declare
  v_attachment_id uuid;
begin
  if tg_table_name = 'psi_tender_actionable_review_attachments' then
    v_attachment_id := new.id;
  else
    if new.event_type <> 'attachment_added' then
      return null;
    end if;
    v_attachment_id := new.attachment_id;
  end if;

  if (
    select count(*) from public.psi_tender_actionable_review_events
    where attachment_id = v_attachment_id and event_type = 'attachment_added'
  ) <> 1 then
    raise exception 'El adjunto % debe tener exactamente un evento attachment_added correspondiente.', v_attachment_id
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.psi_tender_actionable_review_attachments a
    join public.psi_tender_actionable_review_events e
      on e.attachment_id = a.id and e.event_type = 'attachment_added'
    where a.id = v_attachment_id
      and a.review_item_id = e.review_item_id
      and a.uploaded_by = e.actor_id
  ) then
    raise exception 'El evento attachment_added del adjunto % debe coincidir en item y actor con el mismo complete.', v_attachment_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

drop trigger if exists ctrg_psi_tender_actionable_review_attachments_bijection on public.psi_tender_actionable_review_attachments;
create constraint trigger ctrg_psi_tender_actionable_review_attachments_bijection
  after insert on public.psi_tender_actionable_review_attachments
  deferrable initially deferred
  for each row execute function public.psi_check_agt002_review_attachment_bijection();

drop trigger if exists ctrg_psi_tender_actionable_review_events_bijection on public.psi_tender_actionable_review_events;
create constraint trigger ctrg_psi_tender_actionable_review_events_bijection
  after insert on public.psi_tender_actionable_review_events
  deferrable initially deferred
  for each row execute function public.psi_check_agt002_review_attachment_bijection();

-- ---------------------------------------------------------------------------
-- §9.8 — deferred constraint trigger: every knowledge version is backed by
-- exactly one vigente resolution_event source and only approved_attachment
-- sources that are listed as approved supports of that exact resolution,
-- enforced at COMMIT.
-- ---------------------------------------------------------------------------
create or replace function public.psi_check_agt002_knowledge_version_sources()
returns trigger language plpgsql as $$
declare
  v_version_id uuid;
  v_source_review_item_id uuid;
  v_source_resolution_event_id uuid;
  v_resolution_count integer;
  v_resolution_id uuid;
  v_vigente_resolution_id uuid;
begin
  if tg_table_name = 'psi_tender_knowledge_versions' then
    v_version_id := new.id;
  else
    v_version_id := new.knowledge_version_id;
  end if;

  select ki.source_review_item_id, ki.source_resolution_event_id
    into v_source_review_item_id, v_source_resolution_event_id
    from public.psi_tender_knowledge_versions v
    join public.psi_tender_knowledge_items ki on ki.id = v.knowledge_item_id
    where v.id = v_version_id;

  select count(*)
    into v_resolution_count
    from public.psi_tender_knowledge_version_sources
    where knowledge_version_id = v_version_id and source_type = 'resolution_event';

  select source_id
    into v_resolution_id
    from public.psi_tender_knowledge_version_sources
    where knowledge_version_id = v_version_id and source_type = 'resolution_event'
    limit 1;

  if v_resolution_count <> 1 then
    raise exception 'La versión de conocimiento % debe tener exactamente una fuente resolution_event (encontradas: %).', v_version_id, v_resolution_count
      using errcode = '23514';
  end if;

  if v_resolution_id is distinct from v_source_resolution_event_id then
    raise exception 'La fuente resolution_event de la versión % no coincide con la resolución registrada del conocimiento.', v_version_id
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.psi_tender_actionable_review_events e
    where e.id = v_resolution_id
      and e.review_item_id = v_source_review_item_id
      and e.event_type = 'outcome_recorded'
      and e.outcome in ('aclarado_con_soporte','riesgo_confirmado','no_aplica')
  ) then
    raise exception 'La resolución fuente de la versión % no es un resultado cerrado del mismo pendiente.', v_version_id
      using errcode = '23514';
  end if;

  select e.id into v_vigente_resolution_id
  from public.psi_tender_actionable_review_events e
  where e.review_item_id = v_source_review_item_id
    and e.event_type = 'outcome_recorded'
    and e.outcome in ('aclarado_con_soporte','riesgo_confirmado','no_aplica')
    and not exists (
      select 1 from public.psi_tender_actionable_review_events r
      where r.review_item_id = e.review_item_id and r.event_type = 'reopened' and r.sequence > e.sequence
    )
  order by e.sequence desc
  limit 1;

  if v_vigente_resolution_id is distinct from v_resolution_id then
    raise exception 'La resolución fuente de la versión % ya no es la resolución vigente del pendiente.', v_version_id
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.psi_tender_knowledge_version_sources s
    where s.knowledge_version_id = v_version_id
      and s.source_type = 'approved_attachment'
      and not exists (
        select 1 from public.psi_tender_actionable_review_resolution_supports rs
        where rs.resolution_event_id = v_resolution_id and rs.attachment_id = s.source_id
      )
  ) then
    raise exception 'La versión % cita como fuente un adjunto que no está aprobado como soporte de su resolución exacta (constraint de fuentes de conocimiento).', v_version_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

drop trigger if exists ctrg_psi_tender_knowledge_versions_sources on public.psi_tender_knowledge_versions;
create constraint trigger ctrg_psi_tender_knowledge_versions_sources
  after insert on public.psi_tender_knowledge_versions
  deferrable initially deferred
  for each row execute function public.psi_check_agt002_knowledge_version_sources();

drop trigger if exists ctrg_psi_tender_knowledge_version_sources_sources on public.psi_tender_knowledge_version_sources;
create constraint trigger ctrg_psi_tender_knowledge_version_sources_sources
  after insert on public.psi_tender_knowledge_version_sources
  deferrable initially deferred
  for each row execute function public.psi_check_agt002_knowledge_version_sources();

-- ---------------------------------------------------------------------------
-- GREEN sub-block 2B — §9 RLS/grants for the two tables this sub-block's
-- RPCs touch. `service_role` keeps read-only access; all writes happen only
-- through the SECURITY DEFINER RPCs below (§9 preamble, §11).
-- ---------------------------------------------------------------------------
alter table public.psi_tender_actionable_review_items enable row level security;
revoke all on public.psi_tender_actionable_review_items from public, anon, authenticated;
revoke insert, update, delete on public.psi_tender_actionable_review_items from service_role;
grant select on public.psi_tender_actionable_review_items to service_role;

alter table public.psi_tender_actionable_review_events enable row level security;
revoke all on public.psi_tender_actionable_review_events from public, anon, authenticated;
revoke insert, update, delete on public.psi_tender_actionable_review_events from service_role;
grant select on public.psi_tender_actionable_review_events to service_role;

-- ---------------------------------------------------------------------------
-- §6.2/§11 — psi_ensure_tender_actionable_review_item: reads or creates the
-- stable pendiente identity by re-locating the source inside the run's
-- canonical projection. Never trusts a client-fabricated identity, and a
-- re-ensure with a source_hash that disagrees with the stored one is a
-- conflict, never a silent overwrite.
-- ---------------------------------------------------------------------------
create or replace function public.psi_ensure_tender_actionable_review_item(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_analysis_run_id uuid,
  p_source_kind text,
  p_source_id text,
  p_requirement_id text,
  p_source_hash text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.psi_tender_analysis_runs%rowtype;
  v_item public.psi_tender_actionable_review_items%rowtype;
  v_source_found boolean;
begin
  if p_source_kind not in ('integral_unit', 'decision_review_finding') then
    raise exception 'source_kind inválido: %.', p_source_kind using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_source_id, '')), '') is null then
    raise exception 'source_id vacío.' using errcode = '22023';
  end if;
  if p_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'source_hash inválido: debe ser un SHA-256 hexadecimal en minúsculas.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;

  select * into v_run from public.psi_tender_analysis_runs where id = p_analysis_run_id;
  if not found then
    raise exception 'La corrida de análisis % no existe.', p_analysis_run_id using errcode = 'P0002';
  end if;
  if v_run.opportunity_id is distinct from p_opportunity_id or v_run.tender_id is distinct from p_tender_id then
    raise exception 'La corrida % no pertenece a la oportunidad/licitación indicada.', p_analysis_run_id using errcode = '22023';
  end if;

  select * into v_item
    from public.psi_tender_actionable_review_items
    where analysis_run_id = p_analysis_run_id
      and source_kind = p_source_kind
      and source_id = p_source_id;

  if found then
    if v_item.source_hash <> p_source_hash then
      raise exception 'Conflicto de hash: el pendiente % ya existe con un source_hash distinto.', v_item.id using errcode = '23514';
    end if;
    return jsonb_build_object(
      'id', v_item.id, 'opportunity_id', v_item.opportunity_id, 'tender_id', v_item.tender_id,
      'analysis_run_id', v_item.analysis_run_id, 'source_kind', v_item.source_kind, 'source_id', v_item.source_id,
      'requirement_id', v_item.requirement_id, 'source_hash', v_item.source_hash, 'created_at', v_item.created_at
    );
  end if;

  if p_source_kind = 'integral_unit' then
    v_source_found := exists (
      select 1 from jsonb_array_elements(coalesce(v_run.result #> '{integral_analysis,analysis_units}'::text[], '[]'::jsonb)) as u
      where u ->> 'unit_id' = p_source_id
    );
  else
    v_source_found := exists (
      select 1 from jsonb_array_elements(coalesce(v_run.result #> '{decision_review,blockers}'::text[], '[]'::jsonb)) as f
      where f ->> 'id' = p_source_id
    ) or exists (
      select 1 from jsonb_array_elements(coalesce(v_run.result #> '{decision_review,decision_questions}'::text[], '[]'::jsonb)) as f
      where f ->> 'id' = p_source_id
    );
  end if;

  if not v_source_found then
    raise exception 'El origen % no existe en el resultado canónico de la corrida %.', p_source_id, p_analysis_run_id using errcode = 'P0002';
  end if;

  insert into public.psi_tender_actionable_review_items(
    opportunity_id, tender_id, analysis_run_id, source_kind, source_id, requirement_id, source_hash, hash_contract, origin
  ) values (
    p_opportunity_id, p_tender_id, p_analysis_run_id, p_source_kind, p_source_id, p_requirement_id, p_source_hash,
    'agt002-actionable-review-json-v1', 'canonical_analysis_projection'
  )
  on conflict (analysis_run_id, source_kind, source_id) do nothing
  returning * into v_item;

  if not found then
    select * into v_item
      from public.psi_tender_actionable_review_items
      where analysis_run_id = p_analysis_run_id and source_kind = p_source_kind and source_id = p_source_id;
    if v_item.source_hash <> p_source_hash then
      raise exception 'Conflicto de hash: el pendiente % ya existe con un source_hash distinto.', v_item.id using errcode = '23514';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_item.id, 'opportunity_id', v_item.opportunity_id, 'tender_id', v_item.tender_id,
    'analysis_run_id', v_item.analysis_run_id, 'source_kind', v_item.source_kind, 'source_id', v_item.source_id,
    'requirement_id', v_item.requirement_id, 'source_hash', v_item.source_hash, 'created_at', v_item.created_at
  );
end;
$$;

revoke all on function public.psi_ensure_tender_actionable_review_item(uuid, uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.psi_ensure_tender_actionable_review_item(uuid, uuid, uuid, text, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- §9.2/§10.1/§11 — psi_record_tender_actionable_review_comment: appends a
-- comment_added event, inserting the implicit review_started when this is
-- the item's first ever action. Idempotent on (actor_id, idempotency_key):
-- a replay with the same request_hash returns the prior event; a replay
-- with a different request_hash fails without mutating state.
-- ---------------------------------------------------------------------------
create or replace function public.psi_record_tender_actionable_review_comment(
  p_review_item_id uuid,
  p_actor_id uuid,
  p_comment text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_expected_sequence bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.psi_tender_actionable_review_events%rowtype;
  v_event public.psi_tender_actionable_review_events%rowtype;
  v_seq bigint;
begin
  if nullif(btrim(coalesce(p_comment, '')), '') is null or length(p_comment) > 10000 then
    raise exception 'El comentario debe tener entre 1 y 10000 caracteres.' using errcode = '22023';
  end if;
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;

  perform 1 from public.psi_tender_actionable_review_items where id = p_review_item_id for update;
  if not found then
    raise exception 'El pendiente % no existe.', p_review_item_id using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.psi_tender_actionable_review_events
    where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash then
      return jsonb_build_object(
        'id', v_existing.id, 'review_item_id', v_existing.review_item_id, 'sequence', v_existing.sequence,
        'event_type', v_existing.event_type, 'note', v_existing.note, 'created_at', v_existing.created_at
      );
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_actor_id
      using errcode = '23505';
  end if;

  select coalesce(max(sequence), 0) into v_seq
    from public.psi_tender_actionable_review_events
    where review_item_id = p_review_item_id;

  if p_expected_sequence is not null and p_expected_sequence <> v_seq then
    raise exception 'La revisión % cambió mientras se enviaba el comentario (secuencia esperada % pero actual %).', p_review_item_id, p_expected_sequence, v_seq
      using errcode = '40001';
  end if;

  if v_seq = 0 then
    insert into public.psi_tender_actionable_review_events(
      review_item_id, sequence, event_type, actor_id, origin, idempotency_key, request_hash, request_hash_contract
    ) values (
      p_review_item_id, 1, 'review_started', p_actor_id, 'human_ui', gen_random_uuid(), p_request_hash, 'agt002-actionable-review-json-v1'
    );
    v_seq := 1;
  end if;

  insert into public.psi_tender_actionable_review_events(
    review_item_id, sequence, event_type, note, actor_id, origin, idempotency_key, request_hash, request_hash_contract
  ) values (
    p_review_item_id, v_seq + 1, 'comment_added', p_comment, p_actor_id, 'human_ui', p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1'
  )
  returning * into v_event;

  return jsonb_build_object(
    'id', v_event.id, 'review_item_id', v_event.review_item_id, 'sequence', v_event.sequence,
    'event_type', v_event.event_type, 'note', v_event.note, 'created_at', v_event.created_at
  );
end;
$$;

revoke all on function public.psi_record_tender_actionable_review_comment(uuid, uuid, text, uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.psi_record_tender_actionable_review_comment(uuid, uuid, text, uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- §8.4/§10.1/§11 — psi_record_tender_actionable_review_outcome: records one
-- of the four closed structured outcomes (or the still-open
-- informacion_insuficiente) with a mandatory note. Legal only from
-- pendiente/en_revision/reabierto — never directly from resuelto, which must
-- go through reopen first. Inserts the implicit review_started when this is
-- the item's first ever action, and a companion knowledge_requested event
-- when reutilización is requested on a closing outcome.
-- ---------------------------------------------------------------------------
create or replace function public.psi_record_tender_actionable_review_outcome(
  p_review_item_id uuid,
  p_actor_id uuid,
  p_outcome text,
  p_note text,
  p_reusable_requested boolean,
  p_idempotency_key uuid,
  p_request_hash text,
  p_expected_sequence bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.psi_tender_actionable_review_events%rowtype;
  v_event public.psi_tender_actionable_review_events%rowtype;
  v_seq bigint;
  v_status text;
  v_last_relevant text;
  v_reusable boolean;
begin
  v_reusable := coalesce(p_reusable_requested, false);
  if p_outcome not in ('aclarado_con_soporte', 'riesgo_confirmado', 'no_aplica', 'informacion_insuficiente') then
    raise exception 'outcome inválido: %.', p_outcome using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null or length(p_note) > 10000 then
    raise exception 'La nota de resolución debe tener entre 1 y 10000 caracteres.' using errcode = '22023';
  end if;
  if v_reusable and p_outcome = 'informacion_insuficiente' then
    raise exception 'reusable_requested sólo es válido cuando el resultado cierra el pendiente.' using errcode = '22023';
  end if;
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;

  perform 1 from public.psi_tender_actionable_review_items where id = p_review_item_id for update;
  if not found then
    raise exception 'El pendiente % no existe.', p_review_item_id using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.psi_tender_actionable_review_events
    where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash then
      return jsonb_build_object(
        'id', v_existing.id, 'review_item_id', v_existing.review_item_id, 'sequence', v_existing.sequence,
        'event_type', v_existing.event_type, 'outcome', v_existing.outcome, 'note', v_existing.note,
        'reusable_requested', v_existing.reusable_requested, 'created_at', v_existing.created_at,
        'resolution_event_id', v_existing.id
      );
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_actor_id
      using errcode = '23505';
  end if;

  select event_type into v_last_relevant
    from public.psi_tender_actionable_review_events
    where review_item_id = p_review_item_id
      and ((event_type = 'outcome_recorded' and outcome <> 'informacion_insuficiente') or event_type = 'reopened')
    order by sequence desc
    limit 1;

  if v_last_relevant = 'outcome_recorded' then
    v_status := 'resuelto';
  elsif v_last_relevant = 'reopened' then
    v_status := 'reabierto';
  elsif exists (select 1 from public.psi_tender_actionable_review_events where review_item_id = p_review_item_id) then
    v_status := 'en_revision';
  else
    v_status := 'pendiente';
  end if;

  if v_status = 'resuelto' then
    raise exception 'La revisión % ya está resuelta (estado resuelto); reabra antes de registrar otro resultado.', p_review_item_id
      using errcode = '55000';
  end if;

  select coalesce(max(sequence), 0) into v_seq
    from public.psi_tender_actionable_review_events
    where review_item_id = p_review_item_id;

  if p_expected_sequence is not null and p_expected_sequence <> v_seq then
    raise exception 'La revisión % cambió mientras se enviaba el resultado (secuencia esperada % pero actual %).', p_review_item_id, p_expected_sequence, v_seq
      using errcode = '40001';
  end if;

  if v_seq = 0 then
    insert into public.psi_tender_actionable_review_events(
      review_item_id, sequence, event_type, actor_id, origin, idempotency_key, request_hash, request_hash_contract
    ) values (
      p_review_item_id, 1, 'review_started', p_actor_id, 'human_ui', gen_random_uuid(), p_request_hash, 'agt002-actionable-review-json-v1'
    );
    v_seq := 1;
  end if;

  insert into public.psi_tender_actionable_review_events(
    review_item_id, sequence, event_type, outcome, note, reusable_requested, actor_id, origin, idempotency_key, request_hash, request_hash_contract
  ) values (
    p_review_item_id, v_seq + 1, 'outcome_recorded', p_outcome, p_note, v_reusable, p_actor_id, 'human_ui', p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1'
  )
  returning * into v_event;
  v_seq := v_seq + 1;

  if v_reusable then
    insert into public.psi_tender_actionable_review_events(
      review_item_id, sequence, event_type, actor_id, origin, idempotency_key, request_hash, request_hash_contract
    ) values (
      p_review_item_id, v_seq + 1, 'knowledge_requested', p_actor_id, 'human_ui', gen_random_uuid(), p_request_hash, 'agt002-actionable-review-json-v1'
    );
  end if;

  return jsonb_build_object(
    'id', v_event.id, 'review_item_id', v_event.review_item_id, 'sequence', v_event.sequence,
    'event_type', v_event.event_type, 'outcome', v_event.outcome, 'note', v_event.note,
    'reusable_requested', v_event.reusable_requested, 'created_at', v_event.created_at,
    'resolution_event_id', v_event.id
  );
end;
$$;

revoke all on function public.psi_record_tender_actionable_review_outcome(uuid, uuid, text, text, boolean, uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.psi_record_tender_actionable_review_outcome(uuid, uuid, text, text, boolean, uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- §10.1/§11 — psi_reopen_tender_actionable_review: legal only from resuelto,
-- with a mandatory note; never overwrites the prior resolution, only appends
-- a reopened event that stops it from counting as vigente.
-- ---------------------------------------------------------------------------
create or replace function public.psi_reopen_tender_actionable_review(
  p_review_item_id uuid,
  p_actor_id uuid,
  p_note text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_expected_sequence bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.psi_tender_actionable_review_events%rowtype;
  v_event public.psi_tender_actionable_review_events%rowtype;
  v_seq bigint;
  v_status text;
  v_last_relevant text;
begin
  if nullif(btrim(coalesce(p_note, '')), '') is null or length(p_note) > 10000 then
    raise exception 'La nota de reapertura debe tener entre 1 y 10000 caracteres.' using errcode = '22023';
  end if;
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;

  perform 1 from public.psi_tender_actionable_review_items where id = p_review_item_id for update;
  if not found then
    raise exception 'El pendiente % no existe.', p_review_item_id using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.psi_tender_actionable_review_events
    where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash then
      return jsonb_build_object(
        'id', v_existing.id, 'review_item_id', v_existing.review_item_id, 'sequence', v_existing.sequence,
        'event_type', v_existing.event_type, 'note', v_existing.note, 'created_at', v_existing.created_at
      );
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_actor_id
      using errcode = '23505';
  end if;

  select event_type into v_last_relevant
    from public.psi_tender_actionable_review_events
    where review_item_id = p_review_item_id
      and ((event_type = 'outcome_recorded' and outcome <> 'informacion_insuficiente') or event_type = 'reopened')
    order by sequence desc
    limit 1;

  if v_last_relevant = 'outcome_recorded' then
    v_status := 'resuelto';
  elsif v_last_relevant = 'reopened' then
    v_status := 'reabierto';
  elsif exists (select 1 from public.psi_tender_actionable_review_events where review_item_id = p_review_item_id) then
    v_status := 'en_revision';
  else
    v_status := 'pendiente';
  end if;

  if v_status <> 'resuelto' then
    raise exception 'La revisión % sólo puede reabrirse desde el estado resuelto (estado actual: %); un pendiente ya reabierto no admite otra reapertura directa.', p_review_item_id, v_status
      using errcode = '55000';
  end if;

  select coalesce(max(sequence), 0) into v_seq
    from public.psi_tender_actionable_review_events
    where review_item_id = p_review_item_id;

  if p_expected_sequence is not null and p_expected_sequence <> v_seq then
    raise exception 'La revisión % cambió mientras se enviaba la reapertura (secuencia esperada % pero actual %).', p_review_item_id, p_expected_sequence, v_seq
      using errcode = '40001';
  end if;

  insert into public.psi_tender_actionable_review_events(
    review_item_id, sequence, event_type, note, actor_id, origin, idempotency_key, request_hash, request_hash_contract
  ) values (
    p_review_item_id, v_seq + 1, 'reopened', p_note, p_actor_id, 'human_ui', p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1'
  )
  returning * into v_event;

  return jsonb_build_object(
    'id', v_event.id, 'review_item_id', v_event.review_item_id, 'sequence', v_event.sequence,
    'event_type', v_event.event_type, 'note', v_event.note, 'created_at', v_event.created_at
  );
end;
$$;

revoke all on function public.psi_reopen_tender_actionable_review(uuid, uuid, text, uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.psi_reopen_tender_actionable_review(uuid, uuid, text, uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- GREEN sub-block 2C — §9 RLS/grants for the three tables this sub-block's
-- RPCs touch (upload tickets, attachments, resolution supports). All writes
-- happen only through the SECURITY DEFINER RPCs below; service_role keeps
-- only the read-only access needed to project timelines/eligibility later.
-- ---------------------------------------------------------------------------
alter table public.psi_tender_actionable_review_upload_tickets enable row level security;
revoke all on public.psi_tender_actionable_review_upload_tickets from public, anon, authenticated;
revoke insert, update, delete on public.psi_tender_actionable_review_upload_tickets from service_role;
grant select on public.psi_tender_actionable_review_upload_tickets to service_role;

alter table public.psi_tender_actionable_review_attachments enable row level security;
revoke all on public.psi_tender_actionable_review_attachments from public, anon, authenticated;
revoke insert, update, delete on public.psi_tender_actionable_review_attachments from service_role;
grant select on public.psi_tender_actionable_review_attachments to service_role;

alter table public.psi_tender_actionable_review_resolution_supports enable row level security;
revoke all on public.psi_tender_actionable_review_resolution_supports from public, anon, authenticated;
revoke insert, update, delete on public.psi_tender_actionable_review_resolution_supports from service_role;
grant select on public.psi_tender_actionable_review_resolution_supports to service_role;

-- ---------------------------------------------------------------------------
-- §13.1 — allowlist helper: extension <-> declared MIME pairing. Immutable
-- so it doubles as a defense-in-depth SQL check behind the HTTP allowlist.
-- ---------------------------------------------------------------------------
create or replace function public.psi_agt002_attachment_extension_mime_matches(p_extension text, p_mime_type text)
returns boolean
language sql
immutable
as $$
  select case p_extension
    when '.pdf' then p_mime_type = 'application/pdf'
    when '.png' then p_mime_type = 'image/png'
    when '.jpg' then p_mime_type = 'image/jpeg'
    when '.jpeg' then p_mime_type = 'image/jpeg'
    when '.docx' then p_mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when '.xlsx' then p_mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when '.txt' then p_mime_type = 'text/plain'
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- §9.4/§13.2 — single, generic rejection point for every upload-ticket
-- consumption failure (foreign, expired, consumed, nonce/payload/metadata
-- mismatch). One call site keeps every failure indistinguishable to the
-- caller, so a replay/tamper attempt can never learn which check tripped.
-- ---------------------------------------------------------------------------
create or replace function public.psi_reject_agt002_review_attachment_ticket()
returns void
language plpgsql
as $$
begin
  raise exception 'attachment_ticket_invalid: el ticket de carga no es válido, expiró, ya fue consumido o no coincide con los datos presentados.'
    using errcode = '55000';
end;
$$;

-- ---------------------------------------------------------------------------
-- §9.4/§13.2 — psi_issue_tender_actionable_review_upload_ticket: persists a
-- single-use upload authorization bound to the human actor, review item,
-- tenant/opportunity scope, normalized name/extension/MIME/size/hash and a
-- deterministic private storage path/version. The nonce is generated in Node
-- with a CSPRNG immediately before this call and returned to the caller
-- exactly once from there; this RPC only ever receives and persists its
-- SHA-256 digest (`p_nonce_hash`), never the plaintext (§9.4, §6.4). Node
-- likewise computes `p_payload_hash` — the closed canonical hash of the
-- ticket's semantic contract — and passes it in; this RPC persists it as-is.
-- ---------------------------------------------------------------------------
create or replace function public.psi_issue_tender_actionable_review_upload_ticket(
  p_review_item_id uuid,
  p_opportunity_id uuid,
  p_actor_id uuid,
  p_logical_attachment_id uuid,
  p_version integer,
  p_name text,
  p_extension text,
  p_declared_mime_type text,
  p_declared_size_bytes bigint,
  p_declared_content_hash text,
  p_payload_hash text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_nonce_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.psi_tender_actionable_review_items%rowtype;
  v_existing public.psi_tender_actionable_review_upload_tickets%rowtype;
  v_name text;
  v_expected_version integer;
  v_storage_path text;
  v_ticket_id uuid;
  v_created_at timestamptz;
  v_expires_at timestamptz;
begin
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' or length(v_name) > 140 then
    raise exception 'El nombre del archivo debe tener entre 1 y 140 caracteres.' using errcode = '22023';
  end if;
  if v_name like '%/%' or v_name like ('%' || chr(92) || '%') or v_name like '%..%' then
    raise exception 'El nombre del archivo contiene caracteres no permitidos.' using errcode = '22023';
  end if;
  if p_extension not in ('.pdf', '.png', '.jpg', '.jpeg', '.docx', '.xlsx', '.txt') then
    raise exception 'Extensión no permitida: %.', p_extension using errcode = '22023';
  end if;
  if not public.psi_agt002_attachment_extension_mime_matches(p_extension, p_declared_mime_type) then
    raise exception 'attachment_type_not_allowed: el MIME % no corresponde a la extensión %.', p_declared_mime_type, p_extension
      using errcode = '22023';
  end if;
  if p_declared_size_bytes <= 0 or p_declared_size_bytes > 26214400 then
    raise exception 'attachment_too_large: el tamaño declarado excede el límite de 25 MiB.' using errcode = '22023';
  end if;
  if p_declared_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'declared_content_hash inválido: debe ser un SHA-256 hexadecimal en minúsculas.' using errcode = '22023';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'payload_hash inválido: debe ser un SHA-256 hexadecimal en minúsculas.' using errcode = '22023';
  end if;
  if p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'nonce_hash inválido: debe ser un SHA-256 hexadecimal en minúsculas.' using errcode = '22023';
  end if;
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;

  select * into v_item from public.psi_tender_actionable_review_items where id = p_review_item_id for update;
  if not found then
    raise exception 'El pendiente % no existe.', p_review_item_id using errcode = 'P0002';
  end if;
  if v_item.opportunity_id is distinct from p_opportunity_id then
    raise exception 'El pendiente % no pertenece a la oportunidad indicada.', p_review_item_id using errcode = '22023';
  end if;

  select * into v_existing
    from public.psi_tender_actionable_review_upload_tickets
    where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash then
      return jsonb_build_object(
        'id', v_existing.id, 'review_item_id', v_existing.review_item_id,
        'opportunity_id', v_existing.opportunity_id, 'logical_attachment_id', v_existing.logical_attachment_id,
        'version', v_existing.version, 'storage_path', v_existing.storage_path, 'name', v_existing.name,
        'extension', v_existing.extension, 'declared_mime_type', v_existing.declared_mime_type,
        'declared_size_bytes', v_existing.declared_size_bytes, 'declared_content_hash', v_existing.declared_content_hash,
        'expires_at', v_existing.expires_at, 'consumed_at', v_existing.consumed_at, 'created_at', v_existing.created_at
      );
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_actor_id
      using errcode = '23505';
  end if;

  select coalesce(max(version), 0) + 1 into v_expected_version
    from public.psi_tender_actionable_review_attachments
    where logical_attachment_id = p_logical_attachment_id;
  if p_version <> v_expected_version then
    raise exception 'version_conflict: se esperaba la versión % para el adjunto lógico %, se recibió %.', v_expected_version, p_logical_attachment_id, p_version
      using errcode = '23514';
  end if;

  v_ticket_id := gen_random_uuid();
  v_created_at := now();
  v_expires_at := v_created_at + interval '15 minutes';
  v_storage_path := 'actionable-reviews/' || p_opportunity_id::text || '/' || p_review_item_id::text || '/'
    || p_logical_attachment_id::text || '/v' || p_version::text || '/' || p_declared_content_hash || '-'
    || translate(v_name, '/' || chr(92), '__');

  insert into public.psi_tender_actionable_review_upload_tickets(
    id, review_item_id, opportunity_id, actor_id, logical_attachment_id, version, storage_path, name, extension,
    declared_mime_type, declared_size_bytes, declared_content_hash, payload_hash, hash_contract,
    idempotency_key, request_hash, request_hash_contract, nonce_hash, created_at, expires_at
  ) values (
    v_ticket_id, p_review_item_id, p_opportunity_id, p_actor_id, p_logical_attachment_id, p_version, v_storage_path, v_name, p_extension,
    p_declared_mime_type, p_declared_size_bytes, p_declared_content_hash, p_payload_hash, 'agt002-actionable-review-json-v1',
    p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1', p_nonce_hash, v_created_at, v_expires_at
  );

  return jsonb_build_object(
    'id', v_ticket_id, 'review_item_id', p_review_item_id, 'opportunity_id', p_opportunity_id,
    'logical_attachment_id', p_logical_attachment_id, 'version', p_version, 'storage_path', v_storage_path,
    'name', v_name, 'extension', p_extension, 'declared_mime_type', p_declared_mime_type,
    'declared_size_bytes', p_declared_size_bytes, 'declared_content_hash', p_declared_content_hash,
    'expires_at', v_expires_at, 'consumed_at', null, 'created_at', v_created_at
  );
end;
$$;

revoke all on function public.psi_issue_tender_actionable_review_upload_ticket(uuid, uuid, uuid, uuid, integer, text, text, text, bigint, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.psi_issue_tender_actionable_review_upload_ticket(uuid, uuid, uuid, uuid, integer, text, text, text, bigint, text, text, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- §9.3/§9.4/§13.2 — psi_complete_tender_actionable_review_attachment: the
-- only way to turn a validated ticket into a real attachment. Locks and
-- consumes the ticket exactly once, hard-rejects any expiration/replay or
-- actor/item/scope/path/hash/metadata mismatch with one generic error, and
-- creates attachment + attachment_added atomically on the item's shared
-- global sequence right after the implicit review_started (§9.2/§17). The
-- caller never presents the plaintext nonce here: Node validates it and
-- SHA-256-hashes it before this call, and `p_nonce_hash` is compared directly
-- against the persisted `nonce_hash` — an equality check over two already-
-- hashed 256-bit digests, not a comparison of secret plaintext (§9.4).
-- ---------------------------------------------------------------------------
create or replace function public.psi_complete_tender_actionable_review_attachment(
  p_ticket_id uuid,
  p_nonce_hash text,
  p_actor_id uuid,
  p_detected_mime_type text,
  p_size_bytes bigint,
  p_content_hash text,
  p_storage_path text,
  p_idempotency_key uuid,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.psi_tender_actionable_review_upload_tickets%rowtype;
  v_existing public.psi_tender_actionable_review_events%rowtype;
  v_attachment public.psi_tender_actionable_review_attachments%rowtype;
  v_event public.psi_tender_actionable_review_events%rowtype;
  v_supersedes uuid;
  v_seq bigint;
begin
  if p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'content_hash inválido: debe ser un SHA-256 hexadecimal en minúsculas.' using errcode = '22023';
  end if;
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_detected_mime_type, '')), '') is null then
    raise exception 'detected_mime_type vacío.' using errcode = '22023';
  end if;
  if p_size_bytes <= 0 or p_size_bytes > 26214400 then
    raise exception 'El tamaño detectado excede el límite de 25 MiB.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'storage_path vacío.' using errcode = '22023';
  end if;
  if p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'nonce_hash inválido: debe ser un SHA-256 hexadecimal en minúsculas.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;

  select * into v_ticket
    from public.psi_tender_actionable_review_upload_tickets
    where id = p_ticket_id
    for update;
  if not found then
    perform public.psi_reject_agt002_review_attachment_ticket();
  end if;

  -- Idempotent replay of a prior successful complete: same actor + key +
  -- request_hash returns the earlier result without touching ticket state.
  select * into v_existing
    from public.psi_tender_actionable_review_events
    where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash and v_existing.event_type = 'attachment_added' then
      select * into v_attachment from public.psi_tender_actionable_review_attachments where id = v_existing.attachment_id;
      return jsonb_build_object(
        'attachment_id', v_attachment.id, 'review_item_id', v_attachment.review_item_id,
        'logical_attachment_id', v_attachment.logical_attachment_id, 'version', v_attachment.version,
        'event_id', v_existing.id, 'sequence', v_existing.sequence, 'uploaded_at', v_attachment.uploaded_at
      );
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_actor_id
      using errcode = '23505';
  end if;

  if v_ticket.consumed_at is not null then
    perform public.psi_reject_agt002_review_attachment_ticket();
  end if;
  if now() >= v_ticket.expires_at then
    perform public.psi_reject_agt002_review_attachment_ticket();
  end if;
  if v_ticket.actor_id is distinct from p_actor_id then
    perform public.psi_reject_agt002_review_attachment_ticket();
  end if;

  if p_nonce_hash is distinct from v_ticket.nonce_hash then
    perform public.psi_reject_agt002_review_attachment_ticket();
  end if;
  if v_ticket.storage_path is distinct from p_storage_path then
    perform public.psi_reject_agt002_review_attachment_ticket();
  end if;
  if v_ticket.declared_content_hash is distinct from p_content_hash then
    perform public.psi_reject_agt002_review_attachment_ticket();
  end if;
  if v_ticket.declared_size_bytes is distinct from p_size_bytes then
    perform public.psi_reject_agt002_review_attachment_ticket();
  end if;
  if v_ticket.declared_mime_type is distinct from p_detected_mime_type then
    perform public.psi_reject_agt002_review_attachment_ticket();
  end if;

  -- Single monotonic transition allowed by the upload_tickets guard trigger.
  update public.psi_tender_actionable_review_upload_tickets
    set consumed_at = now()
    where id = v_ticket.id;

  if v_ticket.version > 1 then
    select id into v_supersedes
      from public.psi_tender_actionable_review_attachments
      where logical_attachment_id = v_ticket.logical_attachment_id and version = v_ticket.version - 1;
  end if;

  perform 1 from public.psi_tender_actionable_review_items where id = v_ticket.review_item_id for update;

  select coalesce(max(sequence), 0) into v_seq
    from public.psi_tender_actionable_review_events
    where review_item_id = v_ticket.review_item_id;

  if v_seq = 0 then
    insert into public.psi_tender_actionable_review_events(
      review_item_id, sequence, event_type, actor_id, origin, idempotency_key, request_hash, request_hash_contract
    ) values (
      v_ticket.review_item_id, 1, 'review_started', p_actor_id, 'human_ui', gen_random_uuid(), p_request_hash, 'agt002-actionable-review-json-v1'
    );
    v_seq := 1;
  end if;

  insert into public.psi_tender_actionable_review_attachments(
    review_item_id, upload_ticket_id, logical_attachment_id, version, supersedes_attachment_id,
    name, extension, declared_mime_type, detected_mime_type, content_hash, size_bytes, storage_path,
    validation_status, uploaded_by, origin
  ) values (
    v_ticket.review_item_id, v_ticket.id, v_ticket.logical_attachment_id, v_ticket.version, v_supersedes,
    v_ticket.name, v_ticket.extension, v_ticket.declared_mime_type, p_detected_mime_type, p_content_hash, p_size_bytes, v_ticket.storage_path,
    'content_validated', p_actor_id, 'human_ui'
  )
  returning * into v_attachment;

  insert into public.psi_tender_actionable_review_events(
    review_item_id, sequence, event_type, attachment_id, actor_id, origin, idempotency_key, request_hash, request_hash_contract
  ) values (
    v_ticket.review_item_id, v_seq + 1, 'attachment_added', v_attachment.id, p_actor_id, 'human_ui', p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1'
  )
  returning * into v_event;

  return jsonb_build_object(
    'attachment_id', v_attachment.id, 'review_item_id', v_attachment.review_item_id,
    'logical_attachment_id', v_attachment.logical_attachment_id, 'version', v_attachment.version,
    'event_id', v_event.id, 'sequence', v_event.sequence, 'uploaded_at', v_attachment.uploaded_at
  );
end;
$$;

revoke all on function public.psi_complete_tender_actionable_review_attachment(uuid, text, uuid, text, bigint, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.psi_complete_tender_actionable_review_attachment(uuid, text, uuid, text, bigint, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- GREEN sub-block 2D — §9 RLS/grants for the five knowledge tables. Same
-- fail-closed shape as 2B/2C: RLS enabled, public/anon/authenticated fully
-- revoked, service_role's direct writes revoked, service_role keeps only the
-- reads needed to project timelines/eligibility; every write happens through
-- the SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------
alter table public.psi_tender_knowledge_items enable row level security;
revoke all on public.psi_tender_knowledge_items from public, anon, authenticated;
revoke insert, update, delete on public.psi_tender_knowledge_items from service_role;
grant select on public.psi_tender_knowledge_items to service_role;

alter table public.psi_tender_knowledge_versions enable row level security;
revoke all on public.psi_tender_knowledge_versions from public, anon, authenticated;
revoke insert, update, delete on public.psi_tender_knowledge_versions from service_role;
grant select on public.psi_tender_knowledge_versions to service_role;

alter table public.psi_tender_knowledge_version_sources enable row level security;
revoke all on public.psi_tender_knowledge_version_sources from public, anon, authenticated;
revoke insert, update, delete on public.psi_tender_knowledge_version_sources from service_role;
grant select on public.psi_tender_knowledge_version_sources to service_role;

alter table public.psi_tender_knowledge_events enable row level security;
revoke all on public.psi_tender_knowledge_events from public, anon, authenticated;
revoke insert, update, delete on public.psi_tender_knowledge_events from service_role;
grant select on public.psi_tender_knowledge_events to service_role;

alter table public.psi_tender_knowledge_publications enable row level security;
revoke all on public.psi_tender_knowledge_publications from public, anon, authenticated;
revoke insert, update, delete on public.psi_tender_knowledge_publications from service_role;
grant select on public.psi_tender_knowledge_publications to service_role;

-- ---------------------------------------------------------------------------
-- §10.2 helper — projects a knowledge version's current lifecycle status
-- from the event with the highest sequence. Read-only; no privileged access,
-- so it carries no SECURITY DEFINER and no separate grant (called only from
-- inside the SECURITY DEFINER RPCs below, which already run authorized).
-- ---------------------------------------------------------------------------
create or replace function public.psi_agt002_knowledge_version_status(p_version_id uuid)
returns text
language sql
stable
as $$
  select case (
    select event_type
    from public.psi_tender_knowledge_events
    where knowledge_version_id = p_version_id
    order by sequence desc
    limit 1
  )
    when 'draft_created' then 'borrador'
    when 'submitted' then 'pendiente_aprobacion'
    when 'approved' then 'pendiente_aprobacion'
    when 'rejected' then 'rechazado'
    when 'published' then 'publicado'
    when 'replaced' then 'reemplazado'
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- §9.8 helper — mirrors the deferred trigger's "resolución vigente" check
-- (§9.8 point 2) so `psi_create_tender_knowledge_candidate` and
-- `psi_add_tender_knowledge_version` can fail early with a clear
-- knowledge_state_conflict before ever inserting a row, while the deferred
-- trigger remains the authoritative COMMIT-time backstop.
-- ---------------------------------------------------------------------------
create or replace function public.psi_agt002_review_resolution_is_vigente(p_review_item_id uuid, p_resolution_event_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.psi_tender_actionable_review_events e
    where e.id = p_resolution_event_id
      and e.review_item_id = p_review_item_id
      and e.event_type = 'outcome_recorded'
      and e.outcome in ('aclarado_con_soporte', 'riesgo_confirmado', 'no_aplica')
      and not exists (
        select 1 from public.psi_tender_actionable_review_events r
        where r.review_item_id = e.review_item_id and r.event_type = 'reopened' and r.sequence > e.sequence
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- §9.6/§9.8/§11/§14.3 — psi_create_tender_knowledge_candidate: materializes
-- the knowledge item + version 1 + draft_created from exactly one vigente,
-- closed resolution of a review item. Early checks mirror the deferred
-- trigger of §9.8; the trigger is the COMMIT-time backstop for this same
-- invariant. No automatic publication and no canonical reanalysis: this RPC
-- only ever inserts into the five knowledge tables.
-- ---------------------------------------------------------------------------
create or replace function public.psi_create_tender_knowledge_candidate(
  p_review_item_id uuid,
  p_resolution_event_id uuid,
  p_actor_id uuid,
  p_scope_type text,
  p_scope_value text,
  p_reusable_summary text,
  p_valid_from date,
  p_valid_until date,
  p_review_on date,
  p_tags text[],
  p_confidentiality text,
  p_agent_reuse_allowed boolean,
  p_responsible_profile_id uuid,
  p_sanitization_attestation text,
  p_idempotency_key uuid,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.psi_tender_knowledge_events%rowtype;
  v_item_id uuid;
  v_version_id uuid;
  v_content_hash text;
  v_canonical text;
  v_event public.psi_tender_knowledge_events%rowtype;
  v_result jsonb;
begin
  if p_scope_type not in ('general', 'regional', 'cliente', 'tipo_servicio') then
    raise exception 'scope_type inválido: %.', p_scope_type using errcode = '22023';
  end if;
  if (p_scope_type = 'general' and nullif(btrim(coalesce(p_scope_value, '')), '') is not null)
    or (p_scope_type <> 'general' and nullif(btrim(coalesce(p_scope_value, '')), '') is null) then
    raise exception 'scope_value inválido para scope_type %.', p_scope_type using errcode = '22023';
  end if;
  if p_confidentiality not in ('interno', 'restringido') then
    raise exception 'confidentiality inválida: %.', p_confidentiality using errcode = '22023';
  end if;
  if p_agent_reuse_allowed and p_confidentiality = 'restringido' then
    raise exception 'agent_reuse_allowed no puede ser true cuando confidentiality = restringido.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reusable_summary, '')), '') is null or length(p_reusable_summary) > 4000 then
    raise exception 'reusable_summary debe tener entre 1 y 4000 caracteres.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_sanitization_attestation, '')), '') is null
    or length(p_sanitization_attestation) < 20 or length(p_sanitization_attestation) > 2000 then
    raise exception 'sanitization_attestation debe tener entre 20 y 2000 caracteres.' using errcode = '22023';
  end if;
  if not public.psi_agt002_knowledge_tags_are_valid(p_tags) then
    raise exception 'tags inválidos: máximo 20 valores de 1 a 64 caracteres.' using errcode = '22023';
  end if;
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_responsible_profile_id and active and identity_type = 'human'
  ) then
    raise exception 'responsible_profile_id % no corresponde a una persona activa.', p_responsible_profile_id using errcode = '28000';
  end if;

  perform 1 from public.psi_tender_actionable_review_items where id = p_review_item_id for update;
  if not found then
    raise exception 'El pendiente % no existe.', p_review_item_id using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.psi_tender_knowledge_events
    where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash then
      select jsonb_build_object(
        'knowledge_item_id', ki.id, 'version_id', v.id, 'id', v.id, 'version', v.version,
        'status', public.psi_agt002_knowledge_version_status(v.id),
        'source_review_item_id', ki.source_review_item_id, 'source_resolution_event_id', ki.source_resolution_event_id,
        'scope_type', ki.scope_type, 'scope_value', ki.scope_value, 'reusable_summary', v.reusable_summary,
        'confidentiality', v.confidentiality, 'agent_reuse_allowed', v.agent_reuse_allowed, 'created_at', ki.created_at
      ) into v_result
      from public.psi_tender_knowledge_events e
      join public.psi_tender_knowledge_versions v on v.id = e.knowledge_version_id
      join public.psi_tender_knowledge_items ki on ki.id = v.knowledge_item_id
      where e.id = v_existing.id;
      return v_result;
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_actor_id
      using errcode = '23505';
  end if;

  if not public.psi_agt002_review_resolution_is_vigente(p_review_item_id, p_resolution_event_id) then
    raise exception 'knowledge_state_conflict: la resolución % no es la resolución vigente del pendiente % (fue reabierta o no está cerrada).', p_resolution_event_id, p_review_item_id
      using errcode = '55000';
  end if;

  insert into public.psi_tender_knowledge_items(
    source_review_item_id, source_resolution_event_id, scope_type, scope_value, created_by, origin
  ) values (
    p_review_item_id, p_resolution_event_id, p_scope_type, p_scope_value, p_actor_id, 'vigia_candidate'
  ) returning id into v_item_id;

  v_canonical := v_item_id::text || '|' || p_reusable_summary || '|' || p_valid_from::text || '|' || coalesce(p_valid_until::text, '') || '|' || p_review_on::text;
  v_content_hash := encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex');

  insert into public.psi_tender_knowledge_versions(
    knowledge_item_id, version, supersedes_version_id, reusable_summary, valid_from, valid_until, review_on,
    tags, confidentiality, agent_reuse_allowed, responsible_profile_id, sanitization_attestation, content_hash,
    created_by, origin
  ) values (
    v_item_id, 1, null, p_reusable_summary, p_valid_from, p_valid_until, p_review_on,
    coalesce(p_tags, '{}'::text[]), p_confidentiality, coalesce(p_agent_reuse_allowed, false), p_responsible_profile_id, p_sanitization_attestation, v_content_hash,
    p_actor_id, 'vigia_candidate'
  ) returning id into v_version_id;

  insert into public.psi_tender_knowledge_version_sources(
    knowledge_version_id, source_type, source_id, added_by, origin
  ) values (
    v_version_id, 'resolution_event', p_resolution_event_id, p_actor_id, 'vigia_candidate'
  );

  insert into public.psi_tender_knowledge_events(
    knowledge_version_id, sequence, event_type, actor_id, origin, idempotency_key, request_hash, request_hash_contract
  ) values (
    v_version_id, 1, 'draft_created', p_actor_id, 'human_ui', p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1'
  ) returning * into v_event;

  if not public.psi_agt002_review_resolution_is_vigente(p_review_item_id, p_resolution_event_id) then
    raise exception 'knowledge_state_conflict: la resolución % dejó de ser vigente durante la creación de la ficha.', p_resolution_event_id
      using errcode = '55000';
  end if;

  return jsonb_build_object(
    'knowledge_item_id', v_item_id, 'version_id', v_version_id, 'id', v_version_id, 'version', 1,
    'status', 'borrador', 'source_review_item_id', p_review_item_id, 'source_resolution_event_id', p_resolution_event_id,
    'scope_type', p_scope_type, 'scope_value', p_scope_value, 'reusable_summary', p_reusable_summary,
    'confidentiality', p_confidentiality, 'agent_reuse_allowed', coalesce(p_agent_reuse_allowed, false), 'created_at', v_event.created_at
  );
end;
$$;

revoke all on function public.psi_create_tender_knowledge_candidate(uuid, uuid, uuid, text, text, text, date, date, date, text[], text, boolean, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.psi_create_tender_knowledge_candidate(uuid, uuid, uuid, text, text, text, date, date, date, text[], text, boolean, uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- §9.8/§10.2/§11 — psi_add_tender_knowledge_version: appends the successor
-- version after a rejection (or any later revision). Never edits/resubmits
-- the rejected version; always a new borrador row backed by the same early
-- vigente-resolution check as candidate creation.
-- ---------------------------------------------------------------------------
create or replace function public.psi_add_tender_knowledge_version(
  p_knowledge_item_id uuid,
  p_resolution_event_id uuid,
  p_actor_id uuid,
  p_reusable_summary text,
  p_valid_from date,
  p_valid_until date,
  p_review_on date,
  p_tags text[],
  p_confidentiality text,
  p_agent_reuse_allowed boolean,
  p_responsible_profile_id uuid,
  p_sanitization_attestation text,
  p_idempotency_key uuid,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.psi_tender_knowledge_items%rowtype;
  v_existing public.psi_tender_knowledge_events%rowtype;
  v_prev_version_id uuid;
  v_next_version integer;
  v_version_id uuid;
  v_content_hash text;
  v_canonical text;
  v_event public.psi_tender_knowledge_events%rowtype;
  v_result jsonb;
begin
  if p_confidentiality not in ('interno', 'restringido') then
    raise exception 'confidentiality inválida: %.', p_confidentiality using errcode = '22023';
  end if;
  if p_agent_reuse_allowed and p_confidentiality = 'restringido' then
    raise exception 'agent_reuse_allowed no puede ser true cuando confidentiality = restringido.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reusable_summary, '')), '') is null or length(p_reusable_summary) > 4000 then
    raise exception 'reusable_summary debe tener entre 1 y 4000 caracteres.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_sanitization_attestation, '')), '') is null
    or length(p_sanitization_attestation) < 20 or length(p_sanitization_attestation) > 2000 then
    raise exception 'sanitization_attestation debe tener entre 20 y 2000 caracteres.' using errcode = '22023';
  end if;
  if not public.psi_agt002_knowledge_tags_are_valid(p_tags) then
    raise exception 'tags inválidos: máximo 20 valores de 1 a 64 caracteres.' using errcode = '22023';
  end if;
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_responsible_profile_id and active and identity_type = 'human'
  ) then
    raise exception 'responsible_profile_id % no corresponde a una persona activa.', p_responsible_profile_id using errcode = '28000';
  end if;

  select * into v_item from public.psi_tender_knowledge_items where id = p_knowledge_item_id for update;
  if not found then
    raise exception 'El conocimiento % no existe.', p_knowledge_item_id using errcode = 'P0002';
  end if;

  perform 1 from public.psi_tender_actionable_review_items where id = v_item.source_review_item_id for update;

  select * into v_existing
    from public.psi_tender_knowledge_events
    where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash then
      select jsonb_build_object(
        'knowledge_item_id', v.knowledge_item_id, 'version_id', v.id, 'id', v.id, 'version', v.version,
        'status', public.psi_agt002_knowledge_version_status(v.id),
        'source_resolution_event_id', p_resolution_event_id, 'reusable_summary', v.reusable_summary,
        'confidentiality', v.confidentiality, 'agent_reuse_allowed', v.agent_reuse_allowed, 'created_at', v.created_at
      ) into v_result
      from public.psi_tender_knowledge_events e
      join public.psi_tender_knowledge_versions v on v.id = e.knowledge_version_id
      where e.id = v_existing.id;
      return v_result;
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_actor_id
      using errcode = '23505';
  end if;

  if not public.psi_agt002_review_resolution_is_vigente(v_item.source_review_item_id, p_resolution_event_id) then
    raise exception 'knowledge_state_conflict: la resolución % no es la resolución vigente del pendiente de origen.', p_resolution_event_id
      using errcode = '55000';
  end if;

  select v.id, v.version into v_prev_version_id, v_next_version
    from public.psi_tender_knowledge_versions v
    where v.knowledge_item_id = p_knowledge_item_id
    order by v.version desc
    limit 1;
  v_next_version := coalesce(v_next_version, 0) + 1;

  v_canonical := p_knowledge_item_id::text || '|' || p_reusable_summary || '|' || p_valid_from::text || '|' || coalesce(p_valid_until::text, '') || '|' || p_review_on::text || '|v' || v_next_version::text;
  v_content_hash := encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex');

  insert into public.psi_tender_knowledge_versions(
    knowledge_item_id, version, supersedes_version_id, reusable_summary, valid_from, valid_until, review_on,
    tags, confidentiality, agent_reuse_allowed, responsible_profile_id, sanitization_attestation, content_hash,
    created_by, origin
  ) values (
    p_knowledge_item_id, v_next_version, v_prev_version_id, p_reusable_summary, p_valid_from, p_valid_until, p_review_on,
    coalesce(p_tags, '{}'::text[]), p_confidentiality, coalesce(p_agent_reuse_allowed, false), p_responsible_profile_id, p_sanitization_attestation, v_content_hash,
    p_actor_id, 'human_ui'
  ) returning id into v_version_id;

  insert into public.psi_tender_knowledge_version_sources(
    knowledge_version_id, source_type, source_id, added_by, origin
  ) values (
    v_version_id, 'resolution_event', p_resolution_event_id, p_actor_id, 'human_ui'
  );

  insert into public.psi_tender_knowledge_events(
    knowledge_version_id, sequence, event_type, actor_id, origin, idempotency_key, request_hash, request_hash_contract
  ) values (
    v_version_id, 1, 'draft_created', p_actor_id, 'human_ui', p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1'
  ) returning * into v_event;

  return jsonb_build_object(
    'knowledge_item_id', p_knowledge_item_id, 'version_id', v_version_id, 'id', v_version_id, 'version', v_next_version,
    'status', 'borrador', 'source_resolution_event_id', p_resolution_event_id, 'reusable_summary', p_reusable_summary,
    'confidentiality', p_confidentiality, 'agent_reuse_allowed', coalesce(p_agent_reuse_allowed, false), 'created_at', v_event.created_at
  );
end;
$$;

revoke all on function public.psi_add_tender_knowledge_version(uuid, uuid, uuid, text, date, date, date, text[], text, boolean, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.psi_add_tender_knowledge_version(uuid, uuid, uuid, text, date, date, date, text[], text, boolean, uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- §10.2/§11 — psi_submit_tender_knowledge_version: borrador -> pendiente_
-- aprobacion. Legal only from borrador; a rechazado version is never
-- resubmitted (only a new version via psi_add_tender_knowledge_version is).
-- ---------------------------------------------------------------------------
create or replace function public.psi_submit_tender_knowledge_version(
  p_knowledge_version_id uuid,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.psi_tender_knowledge_events%rowtype;
  v_status text;
  v_seq bigint;
  v_event public.psi_tender_knowledge_events%rowtype;
begin
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;

  perform 1 from public.psi_tender_knowledge_versions where id = p_knowledge_version_id for update;
  if not found then
    raise exception 'La versión de conocimiento % no existe.', p_knowledge_version_id using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.psi_tender_knowledge_events
    where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash then
      return jsonb_build_object(
        'id', p_knowledge_version_id, 'version_id', p_knowledge_version_id,
        'status', public.psi_agt002_knowledge_version_status(p_knowledge_version_id), 'sequence', v_existing.sequence
      );
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_actor_id
      using errcode = '23505';
  end if;

  v_status := public.psi_agt002_knowledge_version_status(p_knowledge_version_id);
  if v_status = 'rechazado' then
    raise exception 'knowledge_state_conflict: una versión rechazada nunca se reenvía; cree una nueva versión con psi_add_tender_knowledge_version.'
      using errcode = '55000';
  end if;
  if v_status <> 'borrador' then
    raise exception 'knowledge_state_conflict: sólo una versión en borrador puede someterse (estado actual: %).', v_status using errcode = '55000';
  end if;

  select coalesce(max(sequence), 0) into v_seq from public.psi_tender_knowledge_events where knowledge_version_id = p_knowledge_version_id;

  insert into public.psi_tender_knowledge_events(
    knowledge_version_id, sequence, event_type, actor_id, origin, idempotency_key, request_hash, request_hash_contract
  ) values (
    p_knowledge_version_id, v_seq + 1, 'submitted', p_actor_id, 'human_ui', p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1'
  ) returning * into v_event;

  return jsonb_build_object('id', p_knowledge_version_id, 'version_id', p_knowledge_version_id, 'status', 'pendiente_aprobacion', 'sequence', v_event.sequence);
end;
$$;

revoke all on function public.psi_submit_tender_knowledge_version(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.psi_submit_tender_knowledge_version(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- §10.2/§11 — psi_approve_tender_knowledge_version: human approval, append-
-- only. Keeps the version in pendiente_aprobacion (habilita publicación, no
-- afirma que SharePoint ya la recibió).
-- ---------------------------------------------------------------------------
create or replace function public.psi_approve_tender_knowledge_version(
  p_knowledge_version_id uuid,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.psi_tender_knowledge_events%rowtype;
  v_status text;
  v_seq bigint;
  v_event public.psi_tender_knowledge_events%rowtype;
begin
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;

  perform 1 from public.psi_tender_knowledge_versions where id = p_knowledge_version_id for update;
  if not found then
    raise exception 'La versión de conocimiento % no existe.', p_knowledge_version_id using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.psi_tender_knowledge_events
    where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash then
      return jsonb_build_object(
        'id', p_knowledge_version_id, 'version_id', p_knowledge_version_id,
        'status', public.psi_agt002_knowledge_version_status(p_knowledge_version_id), 'sequence', v_existing.sequence
      );
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_actor_id
      using errcode = '23505';
  end if;

  v_status := public.psi_agt002_knowledge_version_status(p_knowledge_version_id);
  if v_status <> 'pendiente_aprobacion' then
    raise exception 'knowledge_state_conflict: sólo una versión pendiente de aprobación puede aprobarse (estado actual: %).', v_status using errcode = '55000';
  end if;

  select coalesce(max(sequence), 0) into v_seq from public.psi_tender_knowledge_events where knowledge_version_id = p_knowledge_version_id;

  insert into public.psi_tender_knowledge_events(
    knowledge_version_id, sequence, event_type, actor_id, origin, idempotency_key, request_hash, request_hash_contract
  ) values (
    p_knowledge_version_id, v_seq + 1, 'approved', p_actor_id, 'human_ui', p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1'
  ) returning * into v_event;

  return jsonb_build_object('id', p_knowledge_version_id, 'version_id', p_knowledge_version_id, 'status', 'pendiente_aprobacion', 'sequence', v_event.sequence);
end;
$$;

revoke all on function public.psi_approve_tender_knowledge_version(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.psi_approve_tender_knowledge_version(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- §10.2/§11 — psi_reject_tender_knowledge_version: pendiente_aprobacion ->
-- rechazado, with a mandatory note. The rejected version is never edited or
-- resubmitted; only psi_add_tender_knowledge_version creates its successor.
-- ---------------------------------------------------------------------------
create or replace function public.psi_reject_tender_knowledge_version(
  p_knowledge_version_id uuid,
  p_actor_id uuid,
  p_note text,
  p_idempotency_key uuid,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.psi_tender_knowledge_events%rowtype;
  v_status text;
  v_seq bigint;
  v_event public.psi_tender_knowledge_events%rowtype;
begin
  if nullif(btrim(coalesce(p_note, '')), '') is null or length(p_note) > 10000 then
    raise exception 'La nota de rechazo debe tener entre 1 y 10000 caracteres.' using errcode = '22023';
  end if;
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;

  perform 1 from public.psi_tender_knowledge_versions where id = p_knowledge_version_id for update;
  if not found then
    raise exception 'La versión de conocimiento % no existe.', p_knowledge_version_id using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.psi_tender_knowledge_events
    where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash then
      return jsonb_build_object(
        'id', p_knowledge_version_id, 'version_id', p_knowledge_version_id,
        'status', public.psi_agt002_knowledge_version_status(p_knowledge_version_id), 'sequence', v_existing.sequence
      );
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_actor_id
      using errcode = '23505';
  end if;

  v_status := public.psi_agt002_knowledge_version_status(p_knowledge_version_id);
  if v_status <> 'pendiente_aprobacion' then
    raise exception 'knowledge_state_conflict: sólo una versión pendiente de aprobación puede rechazarse (estado actual: %).', v_status using errcode = '55000';
  end if;

  select coalesce(max(sequence), 0) into v_seq from public.psi_tender_knowledge_events where knowledge_version_id = p_knowledge_version_id;

  insert into public.psi_tender_knowledge_events(
    knowledge_version_id, sequence, event_type, note, actor_id, origin, idempotency_key, request_hash, request_hash_contract
  ) values (
    p_knowledge_version_id, v_seq + 1, 'rejected', p_note, p_actor_id, 'human_ui', p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1'
  ) returning * into v_event;

  return jsonb_build_object('id', p_knowledge_version_id, 'version_id', p_knowledge_version_id, 'status', 'rechazado', 'sequence', v_event.sequence);
end;
$$;

revoke all on function public.psi_reject_tender_knowledge_version(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.psi_reject_tender_knowledge_version(uuid, uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- §9.10/§10.2/§11/§16.1 — psi_record_tender_knowledge_publication: only
-- callable on an approved current version; pins library_root to the exact
-- corporate root; records `published` on the new version and, when a prior
-- version of the same item is still publicado, `replaced` on that prior
-- version, atomically in the same transaction (§10.2/§16.1).
-- ---------------------------------------------------------------------------
create or replace function public.psi_record_tender_knowledge_publication(
  p_knowledge_version_id uuid,
  p_library_root text,
  p_relative_path text,
  p_site_id text,
  p_drive_id text,
  p_drive_item_id text,
  p_web_url text,
  p_e_tag text,
  p_sharepoint_version text,
  p_content_hash text,
  p_published_by uuid,
  p_idempotency_key uuid,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.psi_tender_knowledge_versions%rowtype;
  v_existing public.psi_tender_knowledge_events%rowtype;
  v_status text;
  v_seq bigint;
  v_prev_published_version_id uuid;
  v_prev_seq bigint;
  v_event public.psi_tender_knowledge_events%rowtype;
  v_publication public.psi_tender_knowledge_publications%rowtype;
begin
  if p_library_root <> 'Comercial/Licitaciones/02 Biblioteca corporativa' then
    raise exception 'library_root inválido: sólo se admite la raíz corporativa aprobada.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_relative_path, '')), '') is null then
    raise exception 'relative_path vacío.' using errcode = '22023';
  end if;
  if p_web_url !~ '^https://[a-z0-9.-]+\.sharepoint\.com/' or p_web_url ~ '[?#]' then
    raise exception 'web_url inválida: debe ser HTTPS de SharePoint sin query ni fragmento.' using errcode = '22023';
  end if;
  if p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'content_hash inválido: debe ser un SHA-256 hexadecimal en minúsculas.' using errcode = '22023';
  end if;
  if length(p_request_hash) <> 64 then
    raise exception 'request_hash inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_published_by and active and identity_type = 'human'
  ) then
    raise exception 'published_by % no corresponde a una persona activa.', p_published_by using errcode = '28000';
  end if;

  select * into v_version from public.psi_tender_knowledge_versions where id = p_knowledge_version_id for update;
  if not found then
    raise exception 'La versión de conocimiento % no existe.', p_knowledge_version_id using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.psi_tender_knowledge_events
    where actor_id = p_published_by and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash then
      select * into v_publication from public.psi_tender_knowledge_publications where knowledge_version_id = v_existing.knowledge_version_id;
      return jsonb_build_object(
        'id', v_publication.id, 'knowledge_version_id', v_publication.knowledge_version_id,
        'knowledge_item_id', v_publication.knowledge_item_id, 'library_root', v_publication.library_root,
        'relative_path', v_publication.relative_path, 'web_url', v_publication.web_url,
        'sharepoint_version', v_publication.sharepoint_version, 'published_at', v_publication.published_at
      );
    end if;
    raise exception 'idempotency_payload_mismatch: la clave % ya fue usada por % con un request_hash distinto.', p_idempotency_key, p_published_by
      using errcode = '23505';
  end if;

  v_status := public.psi_agt002_knowledge_version_status(p_knowledge_version_id);
  if v_status <> 'pendiente_aprobacion' or not exists (
    select 1 from public.psi_tender_knowledge_events where knowledge_version_id = p_knowledge_version_id and event_type = 'approved'
  ) then
    raise exception 'knowledge_state_conflict: sólo una versión aprobada puede publicarse (estado actual: %).', v_status using errcode = '55000';
  end if;

  select pv.id into v_prev_published_version_id
  from public.psi_tender_knowledge_versions pv
  where pv.knowledge_item_id = v_version.knowledge_item_id
    and pv.id <> p_knowledge_version_id
    and public.psi_agt002_knowledge_version_status(pv.id) = 'publicado';

  if v_prev_published_version_id is not null then
    perform 1 from public.psi_tender_knowledge_versions where id = v_prev_published_version_id for update;
    select coalesce(max(sequence), 0) into v_prev_seq
      from public.psi_tender_knowledge_events where knowledge_version_id = v_prev_published_version_id;
    insert into public.psi_tender_knowledge_events(
      knowledge_version_id, sequence, event_type, actor_id, origin, idempotency_key, request_hash, request_hash_contract
    ) values (
      v_prev_published_version_id, v_prev_seq + 1, 'replaced', p_published_by, 'human_ui', gen_random_uuid(), p_request_hash, 'agt002-actionable-review-json-v1'
    );
  end if;

  insert into public.psi_tender_knowledge_publications(
    knowledge_version_id, knowledge_item_id, library_root, relative_path, site_id, drive_id, drive_item_id,
    web_url, e_tag, sharepoint_version, content_hash, published_by, origin
  ) values (
    p_knowledge_version_id, v_version.knowledge_item_id, p_library_root, p_relative_path, p_site_id, p_drive_id, p_drive_item_id,
    p_web_url, p_e_tag, p_sharepoint_version, p_content_hash, p_published_by, 'sharepoint_publication'
  ) returning * into v_publication;

  select coalesce(max(sequence), 0) into v_seq from public.psi_tender_knowledge_events where knowledge_version_id = p_knowledge_version_id;

  insert into public.psi_tender_knowledge_events(
    knowledge_version_id, sequence, event_type, actor_id, origin, idempotency_key, request_hash, request_hash_contract
  ) values (
    p_knowledge_version_id, v_seq + 1, 'published', p_published_by, 'sharepoint_publication', p_idempotency_key, p_request_hash, 'agt002-actionable-review-json-v1'
  ) returning * into v_event;

  return jsonb_build_object(
    'id', v_publication.id, 'knowledge_version_id', v_publication.knowledge_version_id,
    'knowledge_item_id', v_publication.knowledge_item_id, 'library_root', v_publication.library_root,
    'relative_path', v_publication.relative_path, 'web_url', v_publication.web_url,
    'sharepoint_version', v_publication.sharepoint_version, 'published_at', v_publication.published_at
  );
end;
$$;

revoke all on function public.psi_record_tender_knowledge_publication(uuid, text, text, text, text, text, text, text, text, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.psi_record_tender_knowledge_publication(uuid, text, text, text, text, text, text, text, text, text, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- GREEN sub-block 2E — §16.3 — psi_select_tender_knowledge_assets: read-only
-- server-side projection consumed by `vigia-approved-assets.js`'s async
-- `selectVigiaApprovedAssets({ db, asOf })` selector
-- (`shapeKnowledgeSelectorAsset` / `isEligibleKnowledgeRow`). Joins item +
-- version + events + publication and discards, before returning any row:
-- a version that is not currently `publicado` (approved and published, with
-- no `replaced` event of its own and no later published version of the same
-- item); `confidentiality <> 'interno'`; `agent_reuse_allowed <> true`; a
-- version not yet `valid_from`, already past `valid_until`, or whose
-- `review_on` was reached; and a publication with a missing/invalid
-- SharePoint `web_url`, `content_hash` or library root, or an inactive/non-
-- human responsible profile. `title` is derived from the first line of the
-- curated `reusable_summary` (no separate title column exists on
-- `psi_tender_knowledge_versions`). Deterministic order by item then
-- version. STABLE, SECURITY DEFINER only to keep the same server-only RPC
-- transport model as the rest of this file (`service_role` already holds
-- direct SELECT on all five tables via 2D's grants); no writes, no
-- reanalysis.
-- ---------------------------------------------------------------------------
create or replace function public.psi_select_tender_knowledge_assets(p_as_of timestamptz)
returns table (
  asset_id text,
  title text,
  reusable_summary text,
  asset_type text,
  url text,
  status text,
  scope_type text,
  scope_value text,
  confidentiality text,
  agent_reuse_allowed boolean,
  valid_from date,
  valid_until date,
  review_on date,
  tags text[],
  content_hash text,
  knowledge_item_id uuid,
  knowledge_version_id uuid,
  version integer,
  publication_id uuid,
  published_at timestamptz,
  version_created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    'tender-knowledge:' || ki.id::text || ':v' || v.version::text as asset_id,
    left(btrim(split_part(v.reusable_summary, chr(10), 1)), 200) as title,
    v.reusable_summary,
    'tender_knowledge'::text as asset_type,
    p.web_url as url,
    'approved'::text as status,
    ki.scope_type,
    ki.scope_value,
    v.confidentiality,
    v.agent_reuse_allowed,
    v.valid_from,
    v.valid_until,
    v.review_on,
    v.tags,
    p.content_hash,
    ki.id as knowledge_item_id,
    v.id as knowledge_version_id,
    v.version,
    p.id as publication_id,
    p.published_at,
    v.created_at as version_created_at
  from public.psi_tender_knowledge_versions v
  join public.psi_tender_knowledge_items ki on ki.id = v.knowledge_item_id
  join public.psi_tender_knowledge_publications p on p.knowledge_version_id = v.id
  join public.psi_sales_profiles rp on rp.id = v.responsible_profile_id
  where public.psi_agt002_knowledge_version_status(v.id) = 'publicado'
    and exists (
      select 1 from public.psi_tender_knowledge_events e
      where e.knowledge_version_id = v.id and e.event_type = 'approved'
    )
    and not exists (
      select 1 from public.psi_tender_knowledge_events e
      where e.knowledge_version_id = v.id and e.event_type = 'replaced'
    )
    and not exists (
      select 1 from public.psi_tender_knowledge_versions ov
      where ov.knowledge_item_id = ki.id
        and ov.version > v.version
        and public.psi_agt002_knowledge_version_status(ov.id) = 'publicado'
    )
    and v.confidentiality = 'interno'
    and v.agent_reuse_allowed = true
    and v.valid_from <= p_as_of
    and (v.valid_until is null or v.valid_until >= p_as_of)
    and v.review_on > p_as_of
    and p.library_root = 'Comercial/Licitaciones/02 Biblioteca corporativa'
    and p.web_url ~ '^https://[a-z0-9.-]+\.sharepoint\.com/'
    and p.web_url !~ '[?#]'
    and p.content_hash ~ '^[0-9a-f]{64}$'
    and rp.active
    and rp.identity_type = 'human'
  order by ki.id, v.version;
$$;

revoke all on function public.psi_select_tender_knowledge_assets(timestamptz) from public, anon, authenticated;
grant execute on function public.psi_select_tender_knowledge_assets(timestamptz) to service_role;

commit;
