-- AGT-002 governed document worksets — Phase 2 of
-- .hermes/plans/2026-09-17-agt002-governed-document-worksets.md ("Additive secure schema /
-- RLS / RPCs"). Strictly additive beside every deployed document/AGT-002 object: nothing
-- here drops a table or a column, and no preexisting function is redefined. In particular
-- public.psi_record_tender_document_version (026/065),
-- public.psi_record_tender_document_extraction (065),
-- public.psi_get_or_create_agt002_analysis_workset and
-- public.psi_finalize_agt002_durable_batched_analysis (081) stay byte-for-byte untouched:
-- document identity/extraction and the durable canonical analysis workset are governed
-- elsewhere and this migration only reads them.
--
-- Three new service-role-only, permanently append-only tables:
--   * psi_agt002_governed_document_worksets        -- one frozen header per exact
--     (opportunity_id, tender_id, selection_hash) identity, bounded 1..12 members, binding
--     the exact (snapshot_id, context_version_id, idempotency_key) the durable reanalysis
--     job (068) is created from: the frozen package and the queued job are one identity,
--     never two loosely related ones.
--   * psi_agt002_governed_document_workset_members -- one frozen evidence row per selected
--     document version, carrying only the three server-resolved evidence fields
--     (content_hash, extraction_id, extraction_text_hash) plus the human's closed-vocabulary
--     source_classification and <=500-char inclusion_reason. Never raw extracted text, never
--     a storage/source locator: those stay in the 026/065 registers behind their own grants.
--   * psi_agt002_governed_document_workset_runs    -- exactly one enqueued run per frozen
--     workset (single "Run AGT-002 analysis" CTA; a frozen package is never re-run), bound
--     by foreign key to the real psi_agt002_reanalysis_jobs row it enqueued. The run row
--     carries no status of its own: a run's lifecycle IS its job's lifecycle, reached
--     through reanalysis_job_id, so a run can never sit "queued" locally while disconnected
--     from any real durable job.
--
-- Two new SECURITY DEFINER, search_path-pinned, service_role-only RPCs:
--   * psi_resolve_agt002_governed_document_candidate — server-side resolution of one
--     candidate's frozen evidence straight out of psi_tender_document_versions (026) and
--     psi_tender_document_extractions (065). The client never supplies a hash. Also returns
--     extracted_text_char_count (char_length of the real extracted text, never the text
--     itself) so the governed-workset freeze route's operational batch-capacity preflight
--     (agt002-governed-workset-capacity.js) can derive its size evidence from a server-resolved
--     candidate field, never from a client-declared size.
--   * psi_freeze_agt002_governed_document_workset — Licitaciones- AND custody-authorized
--     (licitaciones + licitaciones_custodia, 021/029) human-only. It re-verifies every
--     submitted member against the live registers, recomputes the selection hash itself,
--     re-reads the submitted snapshot (026) and AGT-002 context version (051) to confirm
--     both belong to this exact (opportunity_id, tender_id) scope, refuses any
--     p_frozen_engine_input whose declared document_workset_identity is not this very
--     freeze, then freezes the package AND enqueues its single run through the canonical
--     durable queue — public.psi_create_agt002_reanalysis_job (068/081) — in the same
--     function body/transaction, persisting the returned job id onto the run row. A package
--     is never left frozen without a real durable job (or vice versa). No exception handler
--     swallows a validation, enqueue or insert failure.
begin;

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_governed_document_worksets
-- Identity is exactly (opportunity_id, tender_id, selection_hash): an exact-content replay
-- reuses the row, any conflicting replay fails closed inside the freeze RPC below.
--
-- snapshot_id / context_version_id / idempotency_key are the SAME three identity columns
-- psi_agt002_reanalysis_jobs (068) is created from, bound here by foreign key / non-blank
-- check so the frozen package and the durable job it enqueues can never drift apart: a
-- replay under the same selection identity but a different snapshot, context version or
-- idempotency key fails closed in the freeze RPC below instead of silently reusing a stale
-- header.
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_governed_document_worksets (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  snapshot_id uuid not null references public.psi_tender_document_snapshots(id) on delete restrict,
  context_version_id uuid not null references public.psi_agt002_context_versions(id) on delete restrict,
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  selection_hash text not null check (selection_hash ~ '^[0-9a-f]{64}$'),
  member_count integer not null check (member_count >= 1 and member_count <= 12),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (opportunity_id, tender_id, selection_hash)
);

create index if not exists psi_agt002_governed_document_worksets_scope_idx
  on public.psi_agt002_governed_document_worksets (opportunity_id, tender_id, created_at desc);

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_governed_document_workset_members
-- The three evidence columns mirror freezeAgt002WorksetEvidence()'s output shape exactly and
-- are always resolved server-side from the real registers, never trusted from the client.
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_governed_document_workset_members (
  id uuid primary key default gen_random_uuid(),
  workset_id uuid not null references public.psi_agt002_governed_document_worksets(id) on delete restrict,
  member_index integer not null check (member_index >= 1 and member_index <= 12),
  document_version_id uuid not null references public.psi_tender_document_versions(id) on delete restrict,
  source_classification text not null check (source_classification in ('official', 'corporate', 'third_party', 'internal', 'draft')),
  inclusion_reason text not null check (nullif(btrim(inclusion_reason), '') is not null and char_length(inclusion_reason) <= 500),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  extraction_id uuid not null references public.psi_tender_document_extractions(id) on delete restrict,
  extraction_text_hash text not null check (extraction_text_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (workset_id, document_version_id),
  unique (workset_id, member_index)
);

create index if not exists psi_agt002_governed_document_workset_members_workset_idx
  on public.psi_agt002_governed_document_workset_members (workset_id, member_index);

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_governed_document_workset_runs
-- One enqueued run per frozen workset, bound by foreign key to the real durable
-- psi_agt002_reanalysis_jobs row (068) the freeze RPC created for it. The row is the
-- binding between a frozen package and its single canonical job, nothing more: there is
-- deliberately NO status column here. Status/lease/attempt/progress and canonical
-- persistence live exactly once, on psi_agt002_reanalysis_jobs, reached through
-- reanalysis_job_id — a run can never exist as a disconnected, locally "queued" row. And
-- never a prompt, model output or credential.
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_governed_document_workset_runs (
  id uuid primary key default gen_random_uuid(),
  workset_id uuid not null references public.psi_agt002_governed_document_worksets(id) on delete restrict,
  reanalysis_job_id uuid not null references public.psi_agt002_reanalysis_jobs(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  requested_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workset_id),
  unique (reanalysis_job_id)
);

create index if not exists psi_agt002_governed_document_workset_runs_scope_idx
  on public.psi_agt002_governed_document_workset_runs (opportunity_id, tender_id, created_at desc);

-- ---------------------------------------------------------------------------------------
-- Permanent append-only enforcement for all three tables. A frozen governed package is the
-- custody record a human signed off on: rewriting or removing any part of it after the fact
-- would silently rewrite governed history, so no UPDATE and no DELETE ever survives, for
-- any role, including service_role and the definer of the RPCs below.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_agt002_governed_document_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '%: los paquetes documentales gobernados AGT-002 son append-only: UPDATE y DELETE están prohibidos', tg_table_name using errcode = '55000';
end;
$$;

drop trigger if exists psi_agt002_governed_document_worksets_immutable on public.psi_agt002_governed_document_worksets;
create trigger psi_agt002_governed_document_worksets_immutable
  before update or delete on public.psi_agt002_governed_document_worksets
  for each row execute function public.psi_agt002_governed_document_prevent_mutation();

drop trigger if exists psi_agt002_governed_document_workset_members_immutable on public.psi_agt002_governed_document_workset_members;
create trigger psi_agt002_governed_document_workset_members_immutable
  before update or delete on public.psi_agt002_governed_document_workset_members
  for each row execute function public.psi_agt002_governed_document_prevent_mutation();

drop trigger if exists psi_agt002_governed_document_workset_runs_immutable on public.psi_agt002_governed_document_workset_runs;
create trigger psi_agt002_governed_document_workset_runs_immutable
  before update or delete on public.psi_agt002_governed_document_workset_runs
  for each row execute function public.psi_agt002_governed_document_prevent_mutation();

-- ---------------------------------------------------------------------------------------
-- RLS + grants: revoked from every direct role, then service_role read-only. Every write
-- goes exclusively through the governed SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------------------
alter table public.psi_agt002_governed_document_worksets enable row level security;
revoke all on table public.psi_agt002_governed_document_worksets from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_governed_document_worksets to service_role;

alter table public.psi_agt002_governed_document_workset_members enable row level security;
revoke all on table public.psi_agt002_governed_document_workset_members from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_governed_document_workset_members to service_role;

alter table public.psi_agt002_governed_document_workset_runs enable row level security;
revoke all on table public.psi_agt002_governed_document_workset_runs from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_governed_document_workset_runs to service_role;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_resolve_agt002_governed_document_candidate
-- Server-side resolution of one candidate document version's frozen evidence. The caller
-- supplies only identifiers; content_hash / extraction_id / extraction_text_hash are read
-- out of the real 026/065 registers. A version outside the (opportunity, tender) scope, a
-- superseded version, or a version without a typed `ok` extraction fails closed instead of
-- silently returning cross-scope or stale evidence.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_resolve_agt002_governed_document_candidate(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_document_version_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.psi_tender_document_versions%rowtype;
  v_extraction public.psi_tender_document_extractions%rowtype;
begin
  if p_opportunity_id is null or p_tender_id is null or p_document_version_id is null then
    raise exception 'La oportunidad, la licitación y la versión documental son obligatorias.' using errcode = '22023';
  end if;

  select * into v_version
  from public.psi_tender_document_versions
  where id = p_document_version_id
  for share;
  if not found then
    raise exception 'La versión documental no existe.' using errcode = 'P0002';
  end if;
  if v_version.opportunity_id is distinct from p_opportunity_id
     or v_version.tender_id is distinct from p_tender_id then
    raise exception 'La versión documental no pertenece a la oportunidad y licitación indicadas.' using errcode = '42501';
  end if;
  if v_version.current is distinct from true then
    raise exception 'La versión documental ya no es la vigente; actualice la selección antes de congelarla.' using errcode = '55000';
  end if;

  select * into v_extraction
  from public.psi_tender_document_extractions
  where document_version_id = v_version.id
    and status = 'ok'
  order by created_at desc, id desc
  limit 1;
  if not found then
    raise exception 'La versión documental no tiene una extracción tipada ok; no puede integrar un paquete gobernado.' using errcode = '55000';
  end if;
  if v_extraction.opportunity_id is distinct from p_opportunity_id
     or v_extraction.tender_id is distinct from p_tender_id then
    raise exception 'La extracción resuelta no pertenece a la oportunidad y licitación indicadas.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'document_version_id', v_version.id,
    'opportunity_id', v_version.opportunity_id,
    'tender_id', v_version.tender_id,
    'name', v_version.name,
    'document_type', v_version.document_type,
    'version', v_version.version,
    'current', v_version.current,
    'content_hash', v_version.content_hash,
    'extraction_id', v_extraction.id,
    'extraction_text_hash', v_extraction.text_hash,
    'extraction_status', v_extraction.status,
    'extractor_version', v_extraction.extractor_version,
    'extracted_text_char_count', char_length(v_extraction.extracted_text)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_freeze_agt002_governed_document_workset
-- Only an active HUMAN profile holding BOTH 'licitaciones' (021) and 'licitaciones_custodia'
-- (029) may freeze: an agent identity, or a general Licitaciones user without document
-- custody authority, can never freeze a governed document package. Every submitted member
-- is re-checked against the live 026/065 rows (scope, currency, extraction status, both
-- hashes) — the Node-computed payload is never taken on faith — and the selection hash is
-- recomputed here from that re-verified evidence, byte-for-byte as
-- freezeAgt002WorksetEvidence() computes it, so the caller cannot declare an identity the
-- package does not actually have.
--
-- The submitted (p_snapshot_id, p_context_version_id, p_idempotency_key,
-- p_frozen_engine_input) quadruple is exactly what psi_create_agt002_reanalysis_job (068,
-- extended in place by 081) requires. Snapshot and context version are re-read from their
-- real registers and must belong to this freeze's (opportunity_id, tender_id) scope, and
-- p_frozen_engine_input must itself declare a document_workset_identity equal to this very
-- freeze. Freeze and enqueue then happen in this same function body, with no exception
-- handler: the frozen header, its members, the canonical durable job and the run row that
-- binds them either all commit or all roll back.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_freeze_agt002_governed_document_workset(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_snapshot_id uuid,
  p_context_version_id uuid,
  p_idempotency_key text,
  p_members jsonb,
  p_frozen_engine_input jsonb,
  p_actor_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_count integer;
  v_element jsonb;
  v_document_version_id uuid;
  v_source_classification text;
  v_inclusion_reason text;
  v_content_hash text;
  v_extraction_id uuid;
  v_extraction_text_hash text;
  v_seen uuid[] := '{}'::uuid[];
  v_normalized jsonb := '[]'::jsonb;
  v_ordered_members jsonb;
  v_canonical_projected_members jsonb;
  v_canonical_members text;
  v_canonical_payload text;
  v_selection_hash text;
  v_declared_identity jsonb;
  v_snapshot public.psi_tender_document_snapshots%rowtype;
  v_context public.psi_agt002_context_versions%rowtype;
  v_version public.psi_tender_document_versions%rowtype;
  v_extraction public.psi_tender_document_extractions%rowtype;
  v_workset public.psi_agt002_governed_document_worksets%rowtype;
  v_member public.psi_agt002_governed_document_workset_members%rowtype;
  v_run public.psi_agt002_governed_document_workset_runs%rowtype;
  v_is_replay boolean := false;
  v_workset_id uuid;
  v_run_id uuid;
  v_job_result jsonb;
  v_job_id uuid;
begin
  if p_opportunity_id is null or p_tender_id is null then
    raise exception 'La oportunidad y la licitación son obligatorias.' using errcode = '22023';
  end if;
  if p_snapshot_id is null or p_context_version_id is null then
    raise exception 'El snapshot documental y la versión de contexto AGT-002 son obligatorios.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'La clave de idempotencia es obligatoria.' using errcode = '22023';
  end if;
  if p_frozen_engine_input is null or jsonb_typeof(p_frozen_engine_input) <> 'object' then
    raise exception 'El insumo congelado del motor debe ser un objeto estructurado.' using errcode = '22023';
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'La selección documental debe ser un arreglo estructurado.' using errcode = '22023';
  end if;

  -- Server-side bound, mirroring normalizeRequestedAgt002WorksetMembers()'s 1..12 instead
  -- of trusting whatever the caller sent.
  v_member_count := jsonb_array_length(p_members);
  if v_member_count < 1 or v_member_count > 12 then
    raise exception 'Un paquete documental gobernado debe incluir entre 1 y 12 documentos.' using errcode = '22023';
  end if;

  -- Licitaciones-authorized human custody actor, checked against the real module
  -- authorization table (021/019), never an ad hoc role string.
  if not exists (
    select 1
    from public.psi_sales_profiles pr
    join public.psi_profile_permissions pp on pp.profile_id = pr.id
    join public.psi_access_permissions ap on ap.code = pp.permission_code
    where pr.id = p_actor_profile_id
      and pr.active = true
      and pr.identity_type = 'human'
      and pp.permission_code = 'licitaciones'
      and ap.active = true
  ) then
    raise exception 'El actor debe ser una persona activa autorizada en el módulo Licitaciones.' using errcode = '42501';
  end if;

  -- Document custody authority (029) on top of general Licitaciones access: congelar un
  -- paquete gobernado es un acto de custodia documental, no una consulta del módulo.
  if not exists (
    select 1
    from public.psi_sales_profiles pr
    join public.psi_profile_permissions pp on pp.profile_id = pr.id
    join public.psi_access_permissions ap on ap.code = pp.permission_code
    where pr.id = p_actor_profile_id
      and pr.active = true
      and pr.identity_type = 'human'
      and pp.permission_code = 'licitaciones_custodia'
      and ap.active = true
  ) then
    raise exception 'El actor debe tener la autoridad de custodia documental de Licitaciones.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.psi_public_tenders t
    where t.id = p_tender_id and t.converted_opportunity_id = p_opportunity_id
  ) then
    raise exception 'La licitación no corresponde a la oportunidad.' using errcode = '22023';
  end if;

  -- The queue identity is re-read from its real registers, never trusted from the caller:
  -- a snapshot or a context version outside this (opportunity_id, tender_id) scope — or a
  -- context version built over a different snapshot — fails closed here, before anything
  -- is frozen or enqueued.
  select * into v_snapshot
  from public.psi_tender_document_snapshots
  where id = p_snapshot_id
  for share;
  if not found then
    raise exception 'El snapshot documental no existe.' using errcode = 'P0002';
  end if;
  if v_snapshot.opportunity_id is distinct from p_opportunity_id
     or v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot no corresponde a la oportunidad y licitación indicadas.' using errcode = '42501';
  end if;

  select * into v_context
  from public.psi_agt002_context_versions
  where id = p_context_version_id
  for share;
  if not found then
    raise exception 'La versión de contexto AGT-002 no existe.' using errcode = 'P0002';
  end if;
  if v_context.opportunity_id is distinct from p_opportunity_id
     or v_context.tender_id is distinct from p_tender_id
     or v_context.snapshot_id is distinct from p_snapshot_id then
    raise exception 'La versión de contexto no corresponde a la identidad congelada de este paquete.' using errcode = '42501';
  end if;

  -- Pass 1: structural validation of every submitted member, and canonicalization. Nothing
  -- is written and no identity is derived until the whole selection is well formed.
  for v_element in select value from jsonb_array_elements(p_members) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'Cada documento de la selección debe ser un objeto estructurado.' using errcode = '22023';
    end if;

    v_document_version_id := nullif(btrim(coalesce(v_element ->> 'document_version_id', '')), '')::uuid;
    v_extraction_id := nullif(btrim(coalesce(v_element ->> 'extraction_id', '')), '')::uuid;
    v_source_classification := btrim(coalesce(v_element ->> 'source_classification', ''));
    v_inclusion_reason := btrim(coalesce(v_element ->> 'inclusion_reason', ''));
    v_content_hash := btrim(coalesce(v_element ->> 'content_hash', ''));
    v_extraction_text_hash := btrim(coalesce(v_element ->> 'extraction_text_hash', ''));

    if v_document_version_id is null or v_extraction_id is null then
      raise exception 'Cada documento de la selección requiere versión documental y extracción reales.' using errcode = '22023';
    end if;
    if v_source_classification not in ('official', 'corporate', 'third_party', 'internal', 'draft') then
      raise exception 'La clasificación de origen del documento no pertenece al vocabulario permitido.' using errcode = '22023';
    end if;
    if v_inclusion_reason = '' or char_length(v_inclusion_reason) > 500 then
      raise exception 'La justificación de inclusión es obligatoria y no puede superar 500 caracteres.' using errcode = '22023';
    end if;
    if v_content_hash !~ '^[0-9a-f]{64}$' or v_extraction_text_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Las huellas del documento deben ser SHA-256 hexadecimales en minúscula.' using errcode = '22023';
    end if;
    if v_document_version_id = any (v_seen) then
      raise exception 'Una versión documental no puede repetirse dentro del mismo paquete gobernado.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_document_version_id;

    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'document_version_id', v_document_version_id::text,
      'source_classification', v_source_classification,
      'inclusion_reason', v_inclusion_reason,
      'content_hash', v_content_hash,
      'extraction_id', v_extraction_id::text,
      'extraction_text_hash', v_extraction_text_hash
    ));
  end loop;

  -- The selection identity is computed HERE, never accepted as a parameter: the canonical
  -- payload below is byte-for-byte the one freezeAgt002WorksetEvidence() hashes (members
  -- sorted by document_version_id, the same six fields in the same order, no whitespace),
  -- over canonical lowercase UUID text.
  select
    jsonb_agg(e order by e ->> 'document_version_id' collate "C"),
    string_agg(
      '{"document_version_id":' || to_json(e ->> 'document_version_id')::text
      || ',"source_classification":' || to_json(e ->> 'source_classification')::text
      || ',"inclusion_reason":' || to_json(e ->> 'inclusion_reason')::text
      || ',"content_hash":' || to_json(e ->> 'content_hash')::text
      || ',"extraction_id":' || to_json(e ->> 'extraction_id')::text
      || ',"extraction_text_hash":' || to_json(e ->> 'extraction_text_hash')::text || '}',
      ',' order by e ->> 'document_version_id' collate "C")
  into v_ordered_members, v_canonical_members
  from jsonb_array_elements(v_normalized) as t(e);

  v_canonical_payload := '{"opportunityId":' || to_json(p_opportunity_id::text)::text
    || ',"tenderId":' || to_json(p_tender_id::text)::text
    || ',"members":[' || coalesce(v_canonical_members, '') || ']}';
  v_selection_hash := encode(sha256(convert_to(v_canonical_payload, 'UTF8')), 'hex');

  -- The engine input that will be executed must declare THIS freeze: a frozen input whose
  -- document_workset_identity names another opportunity, another tender or another
  -- selection can never ride along with this package into the durable queue.
  v_declared_identity := p_frozen_engine_input -> 'document_workset_identity';
  if v_declared_identity is null or jsonb_typeof(v_declared_identity) <> 'object' then
    raise exception 'El insumo congelado del motor debe declarar document_workset_identity.' using errcode = '22023';
  end if;
  -- Exactly the five canonical identity keys — no fewer, no more — before any value is
  -- compared: an extension carrying an extra or missing key fails closed here.
  if (
    select count(*) from jsonb_object_keys(v_declared_identity) k
    where k not in ('opportunity_id', 'tender_id', 'snapshot_id', 'context_version_id', 'selection_hash')
  ) > 0
  or (select count(*) from jsonb_object_keys(v_declared_identity)) <> 5 then
    raise exception 'document_workset_identity debe declarar exactamente sus cinco llaves canónicas.' using errcode = '22023';
  end if;
  if v_declared_identity ->> 'opportunity_id' is distinct from p_opportunity_id::text
     or v_declared_identity ->> 'tender_id' is distinct from p_tender_id::text
     or v_declared_identity ->> 'snapshot_id' is distinct from p_snapshot_id::text
     or v_declared_identity ->> 'context_version_id' is distinct from p_context_version_id::text
     or v_declared_identity ->> 'selection_hash' is distinct from v_selection_hash then
    raise exception 'El insumo congelado del motor declara una identidad documental distinta de este paquete.' using errcode = '22023';
  end if;

  -- Structural canonical validation of the frozen engine input, before anything is written:
  -- only the shape this freeze itself governs (schema_version, engine_identity,
  -- analysis_flags, analysis_context, governed_workset_members) is checked here — never a
  -- secret, and never a replica of the AGT-002 executor's own semantics.
  if p_frozen_engine_input -> 'schema_version' is null
     or jsonb_typeof(p_frozen_engine_input -> 'schema_version') <> 'number'
     or (p_frozen_engine_input ->> 'schema_version')::numeric <> 2 then
    raise exception 'El insumo congelado del motor debe declarar schema_version = 2.' using errcode = '22023';
  end if;
  if p_frozen_engine_input -> 'engine_identity' is null
     or jsonb_typeof(p_frozen_engine_input -> 'engine_identity') <> 'object' then
    raise exception 'El insumo congelado del motor debe declarar engine_identity como objeto estructurado.' using errcode = '22023';
  end if;
  if p_frozen_engine_input -> 'analysis_flags' is null
     or jsonb_typeof(p_frozen_engine_input -> 'analysis_flags') <> 'object' then
    raise exception 'El insumo congelado del motor debe declarar analysis_flags como objeto estructurado.' using errcode = '22023';
  end if;
  if p_frozen_engine_input -> 'analysis_context' is null
     or jsonb_typeof(p_frozen_engine_input -> 'analysis_context') <> 'object' then
    raise exception 'El insumo congelado del motor debe declarar analysis_context como objeto estructurado.' using errcode = '22023';
  end if;

  -- governed_workset_members must be exactly the canonical SIX-field ordered evidence
  -- (v_ordered_members — document_version_id, source_classification, inclusion_reason,
  -- content_hash, extraction_id, extraction_text_hash — already re-verified, C-collated by
  -- document_version_id, byte-for-byte the same shape the selection hash itself was computed
  -- over). Any absence, wrong type, extra/omitted member, reordering, altered field, or field
  -- outside this exact six-field shape fails closed here.
  if p_frozen_engine_input -> 'governed_workset_members' is null
     or jsonb_typeof(p_frozen_engine_input -> 'governed_workset_members') <> 'array' then
    raise exception 'El insumo congelado del motor debe declarar governed_workset_members como arreglo estructurado.' using errcode = '22023';
  end if;

  if (p_frozen_engine_input -> 'governed_workset_members') is distinct from v_ordered_members then
    raise exception 'El insumo congelado del motor declara documentos gobernados distintos de la selección congelada.' using errcode = '22023';
  end if;

  -- analysis_context.documents stays the PUBLIC three-field projection only
  -- (document_version_id, source_classification, inclusion_reason) — never the six-field
  -- evidence shape governed_workset_members now carries. Extra, omitted, reordered, divergent
  -- or live documents, or any per-document key outside this exact projection, all fail closed
  -- here. Every other analysis_context key (e.g. canonicalOnly/snapshot/locale) is left
  -- untouched.
  select jsonb_agg(jsonb_build_object(
    'document_version_id', e ->> 'document_version_id',
    'source_classification', e ->> 'source_classification',
    'inclusion_reason', e ->> 'inclusion_reason'
  ))
  into v_canonical_projected_members
  from jsonb_array_elements(v_ordered_members) as t(e);

  if p_frozen_engine_input -> 'analysis_context' -> 'documents' is null
     or jsonb_typeof(p_frozen_engine_input -> 'analysis_context' -> 'documents') <> 'array'
     or (p_frozen_engine_input -> 'analysis_context' -> 'documents') is distinct from v_canonical_projected_members then
    raise exception 'El insumo congelado del motor declara analysis_context.documents distinto de la selección congelada.' using errcode = '22023';
  end if;

  -- One transaction-scoped identity lock serializes concurrent freezes/replays of the same
  -- selection so the lookup-then-insert below cannot race itself.
  perform pg_advisory_xact_lock(hashtextextended(
    'agt002-governed-document-workset:' || p_opportunity_id::text || ':' || p_tender_id::text || ':' || v_selection_hash, 0));

  select * into v_workset
  from public.psi_agt002_governed_document_worksets
  where opportunity_id = p_opportunity_id
    and tender_id = p_tender_id
    and selection_hash = v_selection_hash
  for share;
  v_is_replay := found;

  if v_is_replay then
    -- Same selection identity: only a byte-identical request may reuse the frozen header.
    -- A different snapshot, context version or idempotency key is a DIFFERENT request and
    -- fails closed instead of silently reusing a stale queue identity.
    if v_workset.member_count is distinct from v_member_count
       or v_workset.snapshot_id is distinct from p_snapshot_id
       or v_workset.context_version_id is distinct from p_context_version_id
       or v_workset.idempotency_key is distinct from p_idempotency_key then
      raise exception 'Ya existe un paquete congelado con esta identidad y un contenido distinto.' using errcode = '23505';
    end if;
    v_workset_id := v_workset.id;
  else
    v_workset_id := gen_random_uuid();
    insert into public.psi_agt002_governed_document_worksets (
      id, opportunity_id, tender_id, snapshot_id, context_version_id, idempotency_key,
      selection_hash, member_count, created_by
    ) values (
      v_workset_id, p_opportunity_id, p_tender_id, p_snapshot_id, p_context_version_id,
      p_idempotency_key, v_selection_hash, v_member_count, p_actor_profile_id
    );
  end if;

  -- Pass 2: canonical order (the same order the selection hash was computed over), one
  -- member at a time.
  for v_index in 1 .. v_member_count loop
    v_element := v_ordered_members -> (v_index - 1);
    v_document_version_id := (v_element ->> 'document_version_id')::uuid;
    v_extraction_id := (v_element ->> 'extraction_id')::uuid;
    v_source_classification := v_element ->> 'source_classification';
    v_inclusion_reason := v_element ->> 'inclusion_reason';
    v_content_hash := v_element ->> 'content_hash';
    v_extraction_text_hash := v_element ->> 'extraction_text_hash';

    if v_is_replay then
      -- Exact-identity replay: compare against what was frozen, and fail closed on any
      -- divergence rather than silently picking one side.
      select * into v_member
      from public.psi_agt002_governed_document_workset_members
      where workset_id = v_workset_id and document_version_id = v_document_version_id;
      if not found
         or v_member.member_index is distinct from v_index
         or v_member.source_classification is distinct from v_source_classification
         or v_member.inclusion_reason is distinct from v_inclusion_reason
         or v_member.content_hash is distinct from v_content_hash
         or v_member.extraction_id is distinct from v_extraction_id
         or v_member.extraction_text_hash is distinct from v_extraction_text_hash then
        raise exception 'Ya existe un paquete congelado con esta identidad y un contenido distinto.' using errcode = '23505';
      end if;
    else
      -- Fail-closed re-verification against live evidence: scope, staleness, extraction
      -- status and BOTH hashes are re-read here, never taken from the client payload.
      select * into v_version
      from public.psi_tender_document_versions
      where id = v_document_version_id
      for share;
      if not found then
        raise exception 'La versión documental del paquete no existe.' using errcode = 'P0002';
      end if;
      if v_version.opportunity_id is distinct from p_opportunity_id
         or v_version.tender_id is distinct from p_tender_id then
        raise exception 'La versión documental no pertenece a la oportunidad y licitación indicadas.' using errcode = '42501';
      end if;
      if v_version.current is distinct from true then
        raise exception 'La versión documental ya no es la vigente; el paquete completo se rechaza.' using errcode = '55000';
      end if;
      if v_version.content_hash is distinct from v_content_hash then
        raise exception 'La huella del documento no coincide con el registro documental vigente.' using errcode = '55000';
      end if;

      select * into v_extraction
      from public.psi_tender_document_extractions
      where id = v_extraction_id
      for share;
      if not found then
        raise exception 'La extracción tipada del paquete no existe.' using errcode = 'P0002';
      end if;
      if v_extraction.document_version_id is distinct from v_document_version_id
         or v_extraction.opportunity_id is distinct from p_opportunity_id
         or v_extraction.tender_id is distinct from p_tender_id then
        raise exception 'La extracción no corresponde a la versión documental ni al alcance indicados.' using errcode = '42501';
      end if;
      if v_extraction.status is distinct from 'ok' then
        raise exception 'La extracción del documento no está en estado ok; el paquete completo se rechaza.' using errcode = '55000';
      end if;
      if v_extraction_text_hash is distinct from v_extraction.text_hash then
        raise exception 'La huella del texto extraído no coincide con el registro de extracciones.' using errcode = '55000';
      end if;

      insert into public.psi_agt002_governed_document_workset_members (
        workset_id, member_index, document_version_id, source_classification, inclusion_reason,
        content_hash, extraction_id, extraction_text_hash
      ) values (
        v_workset_id, v_index, v_document_version_id, v_source_classification, v_inclusion_reason,
        v_version.content_hash, v_extraction.id, v_extraction.text_hash
      );
    end if;
  end loop;

  if v_is_replay then
    select * into v_run
    from public.psi_agt002_governed_document_workset_runs
    where workset_id = v_workset_id;
    if not found then
      raise exception 'El paquete congelado no tiene una ejecución asociada; el estado es inconsistente.' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'status', 'existing',
      'workset_id', v_workset_id,
      'run_id', v_run.id,
      'reanalysis_job_id', v_run.reanalysis_job_id,
      'member_count', v_workset.member_count,
      'selection_hash', v_workset.selection_hash
    );
  end if;

  -- Same body, same transaction: the canonical durable queue row is created by the
  -- existing, untouched psi_create_agt002_reanalysis_job (068, extended in place by 081) —
  -- this migration never reimplements queueing and never invents a second, local run
  -- status. Any exception it raises (another active job for the opportunity, a snapshot or
  -- context version it refuses) unwinds the freeze above with it.
  select public.psi_create_agt002_reanalysis_job(
    p_opportunity_id, p_tender_id, p_snapshot_id, p_context_version_id,
    p_idempotency_key, p_frozen_engine_input, p_actor_profile_id
  ) into v_job_result;
  v_job_id := (v_job_result ->> 'job_id')::uuid;
  if v_job_id is null then
    raise exception 'La cola durable AGT-002 no devolvió un trabajo real para el paquete congelado.' using errcode = '55000';
  end if;

  -- The run row exists only as the binding between the frozen package and that real job:
  -- it is inserted after the job exists, with the returned id, and carries no status of
  -- its own.
  v_run_id := gen_random_uuid();
  insert into public.psi_agt002_governed_document_workset_runs (
    id, workset_id, reanalysis_job_id, opportunity_id, tender_id, requested_by
  ) values (
    v_run_id, v_workset_id, v_job_id, p_opportunity_id, p_tender_id, p_actor_profile_id
  );

  return jsonb_build_object(
    'status', 'created',
    'workset_id', v_workset_id,
    'run_id', v_run_id,
    'reanalysis_job_id', v_job_id,
    'member_count', v_member_count,
    'selection_hash', v_selection_hash
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Grants: revoke from every role first, then grant execute to service_role only.
-- ---------------------------------------------------------------------------------------
revoke all on function public.psi_resolve_agt002_governed_document_candidate(uuid, uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_resolve_agt002_governed_document_candidate(uuid, uuid, uuid) to service_role;

revoke all on function public.psi_freeze_agt002_governed_document_workset(uuid, uuid, uuid, uuid, text, jsonb, jsonb, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_freeze_agt002_governed_document_workset(uuid, uuid, uuid, uuid, text, jsonb, jsonb, uuid) to service_role;

commit;
