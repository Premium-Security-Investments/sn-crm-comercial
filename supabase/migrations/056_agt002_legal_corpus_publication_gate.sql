begin;

-- Hardens the legal-corpus publication gate introduced by migration 053 (E5 / Task
-- 056). 053 already made a published version mechanically immutable; this migration
-- adds the missing publication invariants without rewriting 053's history: a
-- deterministic content hash carried on every version, a human-only publish gate
-- that requires at least one verified+confirmed+applicable source (uncertain
-- sources may still coexist as review-only), an atomic supersede of the previously
-- published version, a DB-level guarantee that at most one version is ever
-- 'published' at a time, and a canonical-run RPC that only accepts a currently
-- published corpus reference.

alter table public.psi_agt002_legal_corpus_versions
  add column if not exists content_sha256 text,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_version_id uuid references public.psi_agt002_legal_corpus_versions(id) on delete restrict;

alter table public.psi_agt002_legal_corpus_versions
  add constraint psi_agt002_legal_corpus_versions_content_sha256_check
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

-- Widen the status enum from ('draft','published') to also admit 'superseded': the
-- state a previously published version moves to, atomically, the instant a new one
-- is published in its place.
alter table public.psi_agt002_legal_corpus_versions
  drop constraint if exists psi_agt002_legal_corpus_versions_status_check;
alter table public.psi_agt002_legal_corpus_versions
  add constraint psi_agt002_legal_corpus_versions_status_check
  check (status in ('draft', 'published', 'superseded'));

-- Replace 053's two-state lifecycle coherence check with a three-state one: a draft
-- carries none of the publication/supersession fields; a published version carries
-- publication fields but never supersession ones; a superseded version carries both.
alter table public.psi_agt002_legal_corpus_versions
  drop constraint if exists psi_agt002_legal_corpus_versions_check;
alter table public.psi_agt002_legal_corpus_versions
  add constraint psi_agt002_legal_corpus_versions_lifecycle_check
  check (
    (status = 'draft' and published_at is null and published_by is null and superseded_at is null and superseded_by_version_id is null)
    or (status = 'published' and published_at is not null and published_by is not null and superseded_at is null and superseded_by_version_id is null)
    or (status = 'superseded' and published_at is not null and published_by is not null and superseded_at is not null and superseded_by_version_id is not null)
  );

-- Defense in depth at the storage layer, on top of the atomic supersede performed by
-- the publish RPC below: the DB itself never admits two simultaneously published
-- versions, independent of any RPC bug.
create unique index if not exists psi_agt002_legal_corpus_versions_one_published_idx
  on public.psi_agt002_legal_corpus_versions (status)
  where status = 'published';

-- Extend 053's immutability guard: a published version may now transition exactly
-- once more, to superseded, and only as the narrow side effect of publishing its
-- replacement (new superseded_at/superseded_by_version_id, every other column
-- byte-for-byte unchanged). A superseded version becomes fully immutable, exactly
-- like a published one. Every other rule from 053 (draft-only publish transition,
-- append-only DELETE prohibition) is preserved unchanged.
create or replace function public.psi_agt002_legal_corpus_versions_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'psi_agt002_legal_corpus_versions is append-only: DELETE is prohibited';
  end if;
  if old.status = 'published' then
    if new.status = 'superseded'
       and new.superseded_at is not null
       and new.superseded_by_version_id is not null
       and new.corpus_version is not distinct from old.corpus_version
       and new.based_on_version_id is not distinct from old.based_on_version_id
       and new.description is not distinct from old.description
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at
       and new.published_at is not distinct from old.published_at
       and new.published_by is not distinct from old.published_by
       and new.content_sha256 is not distinct from old.content_sha256
    then
      return new;
    end if;
    raise exception 'Una versión publicada del corpus normativo es inmutable, salvo la transición a superseded al publicarse una nueva versión.';
  end if;
  if old.status = 'superseded' then
    raise exception 'Una versión reemplazada (superseded) del corpus normativo es inmutable.';
  end if;
  if new.corpus_version is distinct from old.corpus_version
     or new.based_on_version_id is distinct from old.based_on_version_id
     or new.description is distinct from old.description
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Solo se permite la transición de publicación sobre un borrador (status, published_at, published_by, content_sha256).';
  end if;
  if new.status is distinct from 'published' or new.published_at is null or new.published_by is null or new.content_sha256 is null then
    raise exception 'La única transición permitida sobre un borrador es a published, con published_at, published_by y content_sha256.';
  end if;
  return new;
end;
$$;

-- Replace 053's publish RPC. New requirements: the caller must be human (agents may
-- still curate drafts/sources via 053's existing RPCs, but never publish); the draft
-- must carry at least one source that is verified+confirmed+applicable (uncertain
-- sources may still exist in the same version, staying review-only); a well-formed
-- lowercase-hex SHA-256 of the canonical manifest must be supplied and is stored
-- verbatim; and, atomically in the same transaction, any previously published
-- version is superseded before the new one is marked published — so at no instant
-- does more than one version carry status='published'.
drop function if exists public.psi_publish_agt002_legal_corpus(uuid, uuid);

create function public.psi_publish_agt002_legal_corpus(
  p_corpus_version_id uuid,
  p_actor_id uuid,
  p_content_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.psi_agt002_legal_corpus_versions%rowtype;
  v_previous public.psi_agt002_legal_corpus_versions%rowtype;
  v_previous_id uuid;
  v_eligible_count integer;
begin
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'content_sha256 debe ser un hash SHA-256 hexadecimal en minúsculas (64 caracteres).' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') = 'human'
  ) then
    raise exception 'Solo un actor humano puede publicar una versión del corpus normativo.' using errcode = '42501';
  end if;

  select * into v_version from public.psi_agt002_legal_corpus_versions where id = p_corpus_version_id for update;
  if not found then raise exception 'La versión del corpus no existe.' using errcode = 'P0002'; end if;
  if v_version.status = 'published' then
    raise exception 'La versión del corpus ya está publicada; no puede publicarse de nuevo.' using errcode = '22023';
  end if;
  if v_version.status = 'superseded' then
    raise exception 'Una versión reemplazada (superseded) del corpus no puede publicarse.' using errcode = '22023';
  end if;

  select count(*) into v_eligible_count from public.psi_agt002_legal_sources
  where corpus_version_id = p_corpus_version_id
    and verification_status = 'verified' and validity_status = 'confirmed' and applicability_status = 'applicable';
  if v_eligible_count = 0 then
    raise exception 'No se puede publicar sin al menos una fuente normativa verified+confirmed+applicable; las fuentes inciertas pueden coexistir pero permanecen en revisión humana.' using errcode = '22023';
  end if;

  select * into v_previous from public.psi_agt002_legal_corpus_versions where status = 'published' for update;
  v_previous_id := v_previous.id;

  if v_previous_id is not null then
    update public.psi_agt002_legal_corpus_versions
    set status = 'superseded', superseded_at = now(), superseded_by_version_id = p_corpus_version_id
    where id = v_previous_id;
  end if;

  update public.psi_agt002_legal_corpus_versions
  set status = 'published', published_at = now(), published_by = p_actor_id, content_sha256 = p_content_sha256
  where id = p_corpus_version_id;

  select * into v_version from public.psi_agt002_legal_corpus_versions where id = p_corpus_version_id for share;

  return jsonb_build_object(
    'id', v_version.id, 'corpus_version', v_version.corpus_version, 'status', v_version.status,
    'published_at', v_version.published_at, 'published_by', v_version.published_by,
    'content_sha256', v_version.content_sha256, 'superseded_version_id', v_previous_id
  );
end;
$$;

revoke all on function public.psi_publish_agt002_legal_corpus(uuid, uuid, text) from public, authenticated, anon, service_role;
grant execute on function public.psi_publish_agt002_legal_corpus(uuid, uuid, text) to service_role;

-- Harden the canonical-run RPC in place (signature unchanged from 053): a non-null
-- p_legal_corpus_version_id must now reference a currently published version. A
-- draft or superseded corpus can never be attributed to a new canonical run.
create or replace function public.psi_record_agt002_canonical_analysis_run(
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
    if v_legal_corpus_version.status <> 'published' then
      raise exception 'El análisis canónico solo puede referenciar una versión publicada (no borrador ni reemplazada) del corpus normativo.' using errcode = '22023';
    end if;
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

commit;
