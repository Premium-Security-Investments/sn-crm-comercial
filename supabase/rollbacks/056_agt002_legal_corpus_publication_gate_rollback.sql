begin;

-- Non-destructive rollback: withdraw only the new write surfaces this migration
-- introduced — the human-only/eligible-source/hash-carrying publish RPC and the
-- canonical-run RPC's published-only hardening — restoring both exactly to their
-- pre-056 (053) definitions. Every schema addition (content_sha256,
-- superseded_at/superseded_by_version_id, the widened status/lifecycle checks, the
-- one-published unique index, and the extended immutability guard) stays in place:
-- none of it is a write surface by itself, none of it can be exercised once the
-- publish RPC below reverts to disallowing 'superseded' status again, and dropping
-- any of it would risk existing corpus data or run references. No column, table,
-- row or index is ever dropped/deleted/truncated here.

drop function if exists public.psi_publish_agt002_legal_corpus(uuid, uuid, text);

create function public.psi_publish_agt002_legal_corpus(
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

revoke all on function public.psi_publish_agt002_legal_corpus(uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_publish_agt002_legal_corpus(uuid, uuid) to service_role;

-- Restore the canonical-run RPC body to its pre-056 (053) form: same signature, but
-- no longer requiring a referenced corpus version's status to be 'published'.
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
