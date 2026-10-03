-- AGT-002 P0-02 — evidence packages (initial-analysis slice). Strictly additive beside every
-- deployed document/AGT-002 object: nothing here drops a table or a column, and no preexisting
-- function is redefined. In particular public.psi_record_tender_document_version (026/065),
-- public.psi_record_tender_document_extraction (065),
-- public.psi_resolve_agt002_governed_document_candidate,
-- public.psi_freeze_agt002_governed_document_workset (084),
-- public.psi_get_or_create_agt002_analysis_workset and
-- public.psi_finalize_agt002_durable_batched_analysis (081) stay byte-for-byte untouched.
--
-- Unlike the governed document workset (084), this is a NEUTRAL, job-free persistence
-- operation for the initial-analysis slice: freezing an evidence package never enqueues, binds
-- to, or otherwise touches any reanalysis job surface. There is no snapshot/context-version
-- binding and no per-package member ceiling — the only numeric ceiling in this migration is the
-- per-batch cap of 12 members.
--
-- Four new service-role-only, permanently append-only tables:
--   * psi_agt002_evidence_packages         -- one header row per exact (opportunity_id,
--     tender_id) identity. Every version for a tender hangs off this one header row.
--   * psi_agt002_evidence_package_versions -- one frozen version per exact package_hash under
--     a package header, carrying the three deterministic digests
--     (package_hash/document_manifest_hash/semantic_manifest_hash) computed by
--     agt002-evidence-packages.js, a monotonic version_number, and the idempotency_key the
--     freeze RPC uses to detect a conflicting replay.
--   * psi_agt002_evidence_package_members  -- one frozen evidence row per selected document
--     version, carrying only the server-resolved evidence fields (content_hash, extraction_id,
--     extraction_text_hash) plus the human's closed-vocabulary source_classification and
--     <=500-char inclusion_reason. Never raw extracted text, never a storage/source locator.
--     No upper bound of its own: a package may carry any number of members.
--   * psi_agt002_evidence_package_batches  -- the deterministic partition of a frozen
--     version's members into batches of at most 12, mirroring
--     partitionAgt002EvidencePackageBatches().
--
-- Two new SECURITY DEFINER, search_path-pinned, service_role-only RPCs:
--   * psi_resolve_agt002_evidence_package_candidate — server-side resolution of one
--     candidate's frozen evidence straight out of psi_tender_document_versions (026) and
--     psi_tender_document_extractions (065). The client never supplies a hash.
--   * psi_freeze_agt002_evidence_package — an active actor holding the Licitaciones
--     permission (021) re-verifies every submitted member against the live registers
--     (scope, currency, extraction status, both hashes), then freezes the package. A replay
--     under the same package identity and idempotency_key reuses the existing version; any
--     other combination of a matching package_hash or idempotency_key with a divergent
--     counterpart fails closed. An addendum (a new package_hash under the same package_id)
--     always inserts a brand-new version, never touching any prior frozen version. Freeze
--     and batch-partition happen atomically, in the same function body, with no exception
--     handler swallowing a validation or insert failure.
begin;

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_evidence_packages
-- Identity is exactly (opportunity_id, tender_id): every version for a tender hangs off
-- this one header row.
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_evidence_packages (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (opportunity_id, tender_id)
);

create index if not exists psi_agt002_evidence_packages_scope_idx
  on public.psi_agt002_evidence_packages (opportunity_id, tender_id, created_at desc);

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_evidence_package_versions
-- One frozen version per exact package_hash under a package header. version_number only
-- ever increases (computed as the current max plus one), and an exact-content replay under
-- the same package identity reuses the same version row rather than inserting a duplicate.
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_evidence_package_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.psi_agt002_evidence_packages(id) on delete restrict,
  version_number integer not null check (version_number >= 1),
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  package_hash text not null check (package_hash ~ '^[0-9a-f]{64}$'),
  document_manifest_hash text not null check (document_manifest_hash ~ '^[0-9a-f]{64}$'),
  semantic_manifest_hash text not null check (semantic_manifest_hash ~ '^[0-9a-f]{64}$'),
  member_count integer not null check (member_count >= 1),
  batch_count integer not null check (batch_count >= 1),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (package_id, version_number),
  unique (package_id, package_hash)
);

create index if not exists psi_agt002_evidence_package_versions_package_idx
  on public.psi_agt002_evidence_package_versions (package_id, version_number desc);

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_evidence_package_members
-- The evidence columns mirror freezeAgt002EvidencePackageEvidence()'s output shape exactly
-- and are always resolved server-side from the real registers, never trusted from the
-- client. Deliberately NO upper-bound check constraint on any per-package/per-version total:
-- the only numeric ceiling in this whole migration is the per-batch cap on the table below.
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_evidence_package_members (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references public.psi_agt002_evidence_package_versions(id) on delete restrict,
  document_version_id uuid not null references public.psi_tender_document_versions(id) on delete restrict,
  batch_index integer not null check (batch_index >= 0),
  source_classification text not null check (source_classification in ('official', 'corporate', 'internal', 'third_party', 'draft')),
  inclusion_reason text not null check (nullif(btrim(inclusion_reason), '') is not null and char_length(inclusion_reason) <= 500),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  extraction_id uuid not null references public.psi_tender_document_extractions(id) on delete restrict,
  extraction_text_hash text not null check (extraction_text_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (package_version_id, document_version_id)
);

create index if not exists psi_agt002_evidence_package_members_version_idx
  on public.psi_agt002_evidence_package_members (package_version_id, batch_index);

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_evidence_package_batches
-- The deterministic partition of a frozen version's members into batches of at most 12 —
-- the ONLY numeric ceiling in this migration.
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_evidence_package_batches (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references public.psi_agt002_evidence_package_versions(id) on delete restrict,
  batch_index integer not null check (batch_index >= 0),
  member_count integer not null check (member_count >= 1 and member_count <= 12),
  created_at timestamptz not null default now(),
  unique (package_version_id, batch_index)
);

create index if not exists psi_agt002_evidence_package_batches_version_idx
  on public.psi_agt002_evidence_package_batches (package_version_id, batch_index);

-- ---------------------------------------------------------------------------------------
-- Permanent append-only enforcement for all four tables. A frozen evidence package is a
-- custody record: rewriting or removing any part of it after the fact would silently
-- rewrite history, so no UPDATE and no DELETE ever survives, for any role.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_agt002_evidence_package_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '%: los paquetes de evidencia AGT-002 son append-only: UPDATE y DELETE están prohibidos', tg_table_name using errcode = '55000';
end;
$$;

drop trigger if exists psi_agt002_evidence_packages_immutable on public.psi_agt002_evidence_packages;
create trigger psi_agt002_evidence_packages_immutable
  before update or delete on public.psi_agt002_evidence_packages
  for each row execute function public.psi_agt002_evidence_package_prevent_mutation();

drop trigger if exists psi_agt002_evidence_package_versions_immutable on public.psi_agt002_evidence_package_versions;
create trigger psi_agt002_evidence_package_versions_immutable
  before update or delete on public.psi_agt002_evidence_package_versions
  for each row execute function public.psi_agt002_evidence_package_prevent_mutation();

drop trigger if exists psi_agt002_evidence_package_members_immutable on public.psi_agt002_evidence_package_members;
create trigger psi_agt002_evidence_package_members_immutable
  before update or delete on public.psi_agt002_evidence_package_members
  for each row execute function public.psi_agt002_evidence_package_prevent_mutation();

drop trigger if exists psi_agt002_evidence_package_batches_immutable on public.psi_agt002_evidence_package_batches;
create trigger psi_agt002_evidence_package_batches_immutable
  before update or delete on public.psi_agt002_evidence_package_batches
  for each row execute function public.psi_agt002_evidence_package_prevent_mutation();

-- ---------------------------------------------------------------------------------------
-- RLS + grants: revoked from every direct role, then service_role read-only. Every write
-- goes exclusively through the governed SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------------------
alter table public.psi_agt002_evidence_packages enable row level security;
revoke all on table public.psi_agt002_evidence_packages from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_evidence_packages to service_role;

alter table public.psi_agt002_evidence_package_versions enable row level security;
revoke all on table public.psi_agt002_evidence_package_versions from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_evidence_package_versions to service_role;

alter table public.psi_agt002_evidence_package_members enable row level security;
revoke all on table public.psi_agt002_evidence_package_members from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_evidence_package_members to service_role;

alter table public.psi_agt002_evidence_package_batches enable row level security;
revoke all on table public.psi_agt002_evidence_package_batches from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_evidence_package_batches to service_role;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_resolve_agt002_evidence_package_candidate
-- Server-side resolution of one candidate document version's frozen evidence. The caller
-- supplies only identifiers; content_hash / extraction_id / extraction_text_hash are read
-- out of the real 026/065 registers. A version outside the (opportunity, tender) scope, a
-- superseded version, or a version without a typed `ok` extraction fails closed instead of
-- silently returning cross-scope or stale evidence.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_resolve_agt002_evidence_package_candidate(
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
    raise exception 'La versión documental no tiene una extracción tipada ok; no puede integrar un paquete de evidencia.' using errcode = '55000';
  end if;
  if v_extraction.opportunity_id is distinct from p_opportunity_id
     or v_extraction.tender_id is distinct from p_tender_id then
    raise exception 'La extracción resuelta no pertenece a la oportunidad y licitación indicadas.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'document_version_id', v_version.id,
    'opportunity_id', v_version.opportunity_id,
    'tender_id', v_version.tender_id,
    'current', v_version.current,
    'content_hash', v_version.content_hash,
    'extraction_id', v_extraction.id,
    'extraction_text_hash', v_extraction.text_hash,
    'extraction_status', v_extraction.status
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_freeze_agt002_evidence_package
-- Only an active actor holding the Licitaciones permission (021) may freeze. Every
-- submitted member is re-checked against the live 026/065 rows (scope, currency, extraction
-- status, both hashes) — the caller's declared evidence is never taken on faith. The three
-- deterministic digests (package_hash/document_manifest_hash/semantic_manifest_hash) are
-- supplied by the caller (computed by agt002-evidence-packages.js) and used as the version
-- identity: a replay under the same package_hash and idempotency_key reuses the existing
-- version; a matching package_hash or idempotency_key paired with a divergent counterpart
-- fails closed instead of silently picking one side. There is no functional upper bound on
-- the number of members — only each batch is capped at 12. Freeze and batch-partition
-- happen atomically, in this same function body, with no exception handler swallowing a
-- validation or insert failure.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_freeze_agt002_evidence_package(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_idempotency_key text,
  p_members jsonb,
  p_package_hash text,
  p_document_manifest_hash text,
  p_semantic_manifest_hash text,
  p_actor_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_count integer;
  v_index integer;
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
  v_version public.psi_tender_document_versions%rowtype;
  v_extraction public.psi_tender_document_extractions%rowtype;
  v_package_id uuid;
  v_existing_version public.psi_agt002_evidence_package_versions%rowtype;
  v_version_id uuid;
  v_version_number integer;
  v_batch_count integer;
  v_batch_index integer;
  v_is_replay boolean := false;
  v_batch_row record;
begin
  if p_opportunity_id is null or p_tender_id is null then
    raise exception 'La oportunidad y la licitación son obligatorias.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'La clave de idempotencia es obligatoria.' using errcode = '22023';
  end if;
  if p_package_hash !~ '^[0-9a-f]{64}$'
     or p_document_manifest_hash !~ '^[0-9a-f]{64}$'
     or p_semantic_manifest_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Las huellas del paquete deben ser SHA-256 hexadecimales en minúscula.' using errcode = '22023';
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'La selección de evidencia debe ser un arreglo estructurado.' using errcode = '22023';
  end if;

  v_member_count := jsonb_array_length(p_members);
  if v_member_count < 1 then
    raise exception 'Un paquete de evidencia debe incluir al menos un documento.' using errcode = '22023';
  end if;

  -- Active actor authorized in the real Licitaciones module authorization table (021),
  -- never an ad hoc role string. A deactivated actor fails closed even while their
  -- permission row still exists.
  if not exists (
    select 1
    from public.psi_sales_profiles pr
    join public.psi_profile_permissions pp on pp.profile_id = pr.id
    join public.psi_access_permissions ap on ap.code = pp.permission_code
    where pr.id = p_actor_profile_id
      and pr.active = true
      and pp.permission_code = 'licitaciones'
      and ap.active = true
  ) then
    raise exception 'El actor debe ser una persona activa autorizada en el módulo Licitaciones.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.psi_public_tenders t
    where t.id = p_tender_id and t.converted_opportunity_id = p_opportunity_id
  ) then
    raise exception 'La licitación no corresponde a la oportunidad.' using errcode = '22023';
  end if;

  -- Pass 1: structural validation of every submitted member, plus fail-closed
  -- re-verification of its declared evidence against the live 026/065 registers. Nothing
  -- is written until the whole selection is well formed and re-verified.
  for v_index in 0 .. v_member_count - 1 loop
    v_element := p_members -> v_index;
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
    if v_source_classification not in ('official', 'corporate', 'internal', 'third_party', 'draft') then
      raise exception 'La clasificación de origen del documento no pertenece al vocabulario permitido.' using errcode = '22023';
    end if;
    if v_inclusion_reason = '' or char_length(v_inclusion_reason) > 500 then
      raise exception 'La justificación de inclusión es obligatoria y no puede superar 500 caracteres.' using errcode = '22023';
    end if;
    if v_content_hash !~ '^[0-9a-f]{64}$' or v_extraction_text_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Las huellas del documento y su extracción deben ser SHA-256 hexadecimales en minúscula.' using errcode = '22023';
    end if;
    if v_document_version_id = any (v_seen) then
      raise exception 'Una versión documental no puede repetirse dentro del mismo paquete de evidencia.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_document_version_id;

    -- Fail-closed re-verification: scope, staleness, extraction status and BOTH hashes are
    -- re-read here, never taken from the client payload.
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
    if v_extraction.text_hash is distinct from v_extraction_text_hash then
      raise exception 'La huella del texto extraído no coincide con el registro de extracciones.' using errcode = '55000';
    end if;

    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'document_version_id', v_document_version_id::text,
      'source_classification', v_source_classification,
      'inclusion_reason', v_inclusion_reason,
      'content_hash', v_content_hash,
      'extraction_id', v_extraction_id::text,
      'extraction_text_hash', v_extraction_text_hash
    ));
  end loop;

  select jsonb_agg(e order by e ->> 'document_version_id' collate "C")
  into v_ordered_members
  from jsonb_array_elements(v_normalized) as t(e);

  v_batch_count := ((v_member_count - 1) / 12) + 1;

  -- One transaction-scoped identity lock serializes concurrent freezes/replays for the same
  -- (opportunity, tender) scope so the lookup-then-insert below cannot race itself.
  perform pg_advisory_xact_lock(hashtextextended(
    'agt002-evidence-package:' || p_opportunity_id::text || ':' || p_tender_id::text, 0));

  select id into v_package_id
  from public.psi_agt002_evidence_packages
  where opportunity_id = p_opportunity_id and tender_id = p_tender_id
  for share;

  if v_package_id is null then
    insert into public.psi_agt002_evidence_packages (opportunity_id, tender_id)
    values (p_opportunity_id, p_tender_id)
    returning id into v_package_id;
  end if;

  select * into v_existing_version
  from public.psi_agt002_evidence_package_versions
  where package_id = v_package_id
    and (package_hash = p_package_hash or idempotency_key = p_idempotency_key)
  order by version_number desc
  limit 1
  for share;

  if found then
    if v_existing_version.package_hash is distinct from p_package_hash
       or v_existing_version.idempotency_key is distinct from p_idempotency_key then
      raise exception 'Ya existe un paquete de evidencia congelado con una identidad o clave de idempotencia distinta.' using errcode = '23505';
    end if;

    return jsonb_build_object(
      'status', 'existing',
      'package_id', v_package_id,
      'package_version_id', v_existing_version.id,
      'version_number', v_existing_version.version_number,
      'member_count', v_existing_version.member_count,
      'batch_count', v_existing_version.batch_count,
      'package_hash', v_existing_version.package_hash,
      'document_manifest_hash', v_existing_version.document_manifest_hash,
      'semantic_manifest_hash', v_existing_version.semantic_manifest_hash
    );
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_version_number
  from public.psi_agt002_evidence_package_versions
  where package_id = v_package_id;

  insert into public.psi_agt002_evidence_package_versions (
    package_id, version_number, idempotency_key, package_hash, document_manifest_hash,
    semantic_manifest_hash, member_count, batch_count, created_by
  ) values (
    v_package_id, v_version_number, p_idempotency_key, p_package_hash, p_document_manifest_hash,
    p_semantic_manifest_hash, v_member_count, v_batch_count, p_actor_profile_id
  ) returning id into v_version_id;

  for v_index in 1 .. v_member_count loop
    v_element := v_ordered_members -> (v_index - 1);
    v_batch_index := (v_index - 1) / 12;
    insert into public.psi_agt002_evidence_package_members (
      package_version_id, document_version_id, batch_index, source_classification,
      inclusion_reason, content_hash, extraction_id, extraction_text_hash
    ) values (
      v_version_id, (v_element ->> 'document_version_id')::uuid, v_batch_index,
      v_element ->> 'source_classification', v_element ->> 'inclusion_reason',
      v_element ->> 'content_hash', (v_element ->> 'extraction_id')::uuid,
      v_element ->> 'extraction_text_hash'
    );
  end loop;

  for v_batch_row in
    select batch_index, count(*) as member_count
    from public.psi_agt002_evidence_package_members
    where package_version_id = v_version_id
    group by batch_index
    order by batch_index
  loop
    insert into public.psi_agt002_evidence_package_batches (
      package_version_id, batch_index, member_count
    ) values (
      v_version_id, v_batch_row.batch_index, v_batch_row.member_count
    );
  end loop;

  return jsonb_build_object(
    'status', 'created',
    'package_id', v_package_id,
    'package_version_id', v_version_id,
    'version_number', v_version_number,
    'member_count', v_member_count,
    'batch_count', v_batch_count,
    'package_hash', p_package_hash,
    'document_manifest_hash', p_document_manifest_hash,
    'semantic_manifest_hash', p_semantic_manifest_hash
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Grants: revoke from every role first, then grant execute to service_role only.
-- ---------------------------------------------------------------------------------------
revoke all on function public.psi_resolve_agt002_evidence_package_candidate(uuid, uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_resolve_agt002_evidence_package_candidate(uuid, uuid, uuid) to service_role;

revoke all on function public.psi_freeze_agt002_evidence_package(uuid, uuid, text, jsonb, text, text, text, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_freeze_agt002_evidence_package(uuid, uuid, text, jsonb, text, text, text, uuid) to service_role;

commit;
