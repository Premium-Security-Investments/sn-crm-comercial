begin;

-- Reverts migration 067 by restoring psi_record_agt002_canonical_analysis_run to its
-- exact 063 body — the canonical-promotion RPC WITH demote-in-place supersession, the
-- idempotency short-circuit, the same-opportunity row lock and the published-corpus gate,
-- but WITHOUT 067's integral v3 payload gate. The signature is unchanged across
-- 063/067, so create-or-replace is sufficient. This rollback touches no
-- psi_tender_analysis_runs row and undoes none of 063's own schema: the supersedes_run_id
-- column and the psi_tender_analysis_runs_one_canonical_current_idx unique index are 063's,
-- not 067's, and remain in place. No table, index or trigger is altered here.
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
  v_previous public.psi_tender_analysis_runs%rowtype;
  v_had_previous boolean;
  v_new_id uuid;
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

  -- Idempotency short-circuit first, before any lock or mutation: a replay of an
  -- already-recorded key must never touch supersession state again, and a
  -- conflicting payload under the same key must still be rejected exactly as before
  -- promotion existed.
  select * into v_run from public.psi_tender_analysis_runs where idempotency_key = p_idempotency_key for share;
  if found then
    if v_run.snapshot_id is distinct from p_snapshot_id
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
       or v_run.context_version_id is distinct from p_context_version_id
       or v_run.legal_corpus_version_id is distinct from p_legal_corpus_version_id then
      raise exception 'La clave de idempotencia ya pertenece a otro análisis.' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'id', v_run.id, 'snapshot_id', v_run.snapshot_id, 'opportunity_id', v_run.opportunity_id,
      'tender_id', v_run.tender_id, 'producer', v_run.producer, 'method', v_run.method,
      'status', v_run.status, 'canonical', v_run.canonical, 'critical_open_count', v_run.critical_open_count,
      'context_version_id', v_run.context_version_id, 'legal_corpus_version_id', v_run.legal_corpus_version_id,
      'supersedes_run_id', v_run.supersedes_run_id, 'created_at', v_run.created_at, 'completed_at', v_run.completed_at
    );
  end if;

  -- Serialize concurrent promotions for the same opportunity: two simultaneous
  -- callers must never both believe they are the one promoting a new canonical run.
  -- The lock is held for the rest of the transaction.
  perform 1 from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;

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

  -- Lock the current canonical run (if any) for this opportunity so a concurrent
  -- promotion attempt cannot race the demote-then-insert sequence below.
  select * into v_previous from public.psi_tender_analysis_runs
    where opportunity_id = p_opportunity_id and canonical and status = 'completed'
    for update;
  v_had_previous := found;

  if v_had_previous then
    -- The only column that changes is canonical; the append-only trigger mechanically
    -- rejects anything else, including any attempt to also rewrite result/context here.
    update public.psi_tender_analysis_runs set canonical = false where id = v_previous.id;
  end if;

  v_new_id := gen_random_uuid();
  insert into public.psi_tender_analysis_runs (
    id, snapshot_id, opportunity_id, tender_id, producer, method, status, result, critical_open_count,
    idempotency_key, schema_version, policy_version, model, usage, completed_at, canonical,
    context_version_id, legal_corpus_version_id, supersedes_run_id
  ) values (
    v_new_id, p_snapshot_id, p_opportunity_id, p_tender_id, 'AGT-002', 'agent_ai', 'completed', p_result,
    p_critical_open_count, p_idempotency_key, p_schema_version, p_policy_version,
    nullif(btrim(p_model), ''), p_usage, now(), true, p_context_version_id, p_legal_corpus_version_id,
    case when v_had_previous then v_previous.id else null end
  ) returning * into v_run;

  return jsonb_build_object(
    'id', v_run.id, 'snapshot_id', v_run.snapshot_id, 'opportunity_id', v_run.opportunity_id,
    'tender_id', v_run.tender_id, 'producer', v_run.producer, 'method', v_run.method,
    'status', v_run.status, 'canonical', v_run.canonical, 'critical_open_count', v_run.critical_open_count,
    'context_version_id', v_run.context_version_id, 'legal_corpus_version_id', v_run.legal_corpus_version_id,
    'supersedes_run_id', v_run.supersedes_run_id, 'created_at', v_run.created_at, 'completed_at', v_run.completed_at
  );
end;
$$;

revoke all on function public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid) to service_role;

commit;
