begin;

-- Fails closed while ANY workset row is not explicitly archived, or while any
-- durable_batched_v1 job is still active (queued/running): a workset is durable history of
-- governed work (possibly with immutable, append-only checkpoints hanging off it via FK
-- restrict), and rollback must never silently strand or destroy resumable/un-governed
-- history. Governed teardown requires BOTH: every workset explicitly archived via
-- psi_archive_agt002_analysis_workset (archived_at is not null), AND no active job remains
-- for any durable-batched canonical identity. Once both hold, the DROP TABLE statements
-- below intentionally remove checkpoint history too, as the explicit governed archival
-- teardown this rollback exists to perform — but no DELETE is ever issued against a
-- checkpoint row (append-only stays honored right up to the table's removal).
do $$
begin
  if to_regclass('public.psi_agt002_analysis_worksets') is not null
     and exists (select 1 from public.psi_agt002_analysis_worksets where archived_at is null limit 1) then
    raise exception 'Rollback 081 bloqueado: existen worksets AGT-002 sin archivar explícitamente (historial); el rollback se bloquea para no extraviar trabajo recuperable.';
  end if;

  if to_regclass('public.psi_agt002_reanalysis_jobs') is not null
     and exists (
       select 1 from public.psi_agt002_reanalysis_jobs
       where execution_mode = 'durable_batched_v1' and status in ('queued', 'running')
       limit 1
     ) then
    raise exception 'Rollback 081 bloqueado: existe un trabajo AGT-002 durable_batched_v1 activo (queued/running); el rollback se bloquea hasta que ese trabajo termine.';
  end if;
end $$;

-- 081 redefined these three 068 functions in place (same signatures, extended for
-- execution_mode/reclaim). Restore the exact pre-081 bodies from 068 BEFORE dropping any
-- 081 table/RPC below: once this transaction commits, public.psi_agt002_reanalysis_jobs
-- must behave exactly as it did pre-081 again (no execution_mode reference, no durable
-- reclaim), and that restoration must never race with or depend on the drops that follow.
create or replace function public.psi_agt002_reanalysis_jobs_prevent_identity_mutation()
returns trigger language plpgsql as $$
begin
  if new.opportunity_id is distinct from old.opportunity_id
     or new.tender_id is distinct from old.tender_id
     or new.snapshot_id is distinct from old.snapshot_id
     or new.context_version_id is distinct from old.context_version_id
     or new.idempotency_key is distinct from old.idempotency_key
     or new.frozen_engine_input is distinct from old.frozen_engine_input
     or new.requested_by is distinct from old.requested_by
     or new.created_at is distinct from old.created_at then
    raise exception 'psi_agt002_reanalysis_jobs: la identidad y el insumo congelado son inmutables' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.psi_create_agt002_reanalysis_job(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_snapshot_id uuid,
  p_context_version_id uuid,
  p_idempotency_key text,
  p_frozen_engine_input jsonb,
  p_requested_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_id uuid;
  v_existing_active public.psi_agt002_reanalysis_jobs%rowtype;
  v_snapshot public.psi_tender_document_snapshots%rowtype;
  v_context public.psi_agt002_context_versions%rowtype;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'La clave de idempotencia es obligatoria.' using errcode = '22023';
  end if;
  if p_frozen_engine_input is null or jsonb_typeof(p_frozen_engine_input) <> 'object' then
    raise exception 'El insumo congelado del motor debe ser un objeto estructurado.' using errcode = '22023';
  end if;

  select * into v_snapshot from public.psi_tender_document_snapshots where id = p_snapshot_id for share;
  if not found then
    raise exception 'El snapshot documental no existe.' using errcode = 'P0002';
  end if;
  if v_snapshot.opportunity_id is distinct from p_opportunity_id or v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot no corresponde a la oportunidad o licitación indicadas.' using errcode = '22023';
  end if;

  if p_context_version_id is null then
    raise exception 'La versión de contexto es obligatoria.' using errcode = '22023';
  end if;
  select * into v_context from public.psi_agt002_context_versions where id = p_context_version_id for share;
  if not found then
    raise exception 'La versión de contexto no existe.' using errcode = 'P0002';
  end if;
  if v_context.opportunity_id is distinct from p_opportunity_id
     or v_context.tender_id is distinct from p_tender_id
     or v_context.snapshot_id is distinct from p_snapshot_id then
    raise exception 'La versión de contexto no corresponde a la identidad congelada del job.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('psi_agt002_reanalysis_jobs:' || p_opportunity_id::text));

  select * into v_existing_active
  from public.psi_agt002_reanalysis_jobs
  where opportunity_id = p_opportunity_id
    and status in ('queued', 'running')
  limit 1;

  if found then
    if v_existing_active.idempotency_key is distinct from p_idempotency_key
       or v_existing_active.tender_id is distinct from p_tender_id
       or v_existing_active.snapshot_id is distinct from p_snapshot_id
       or v_existing_active.context_version_id is distinct from p_context_version_id
       or v_existing_active.frozen_engine_input is distinct from p_frozen_engine_input then
      raise exception 'Ya existe otro trabajo AGT-002 activo para la oportunidad.' using errcode = '55000';
    end if;
    return jsonb_build_object('status', 'existing', 'job_id', v_existing_active.id);
  end if;

  insert into public.psi_agt002_reanalysis_jobs
    (opportunity_id, tender_id, snapshot_id, context_version_id, idempotency_key, frozen_engine_input, status, requested_by)
  values
    (p_opportunity_id, p_tender_id, p_snapshot_id, p_context_version_id, p_idempotency_key, p_frozen_engine_input, 'queued', p_requested_by)
  returning id into v_job_id;

  return jsonb_build_object('status', 'created', 'job_id', v_job_id);
end;
$$;

create or replace function public.psi_claim_agt002_reanalysis_job(
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_lease_id uuid;
  v_seconds integer;
  v_lease_expires_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('psi_agt002_reanalysis_jobs:claim'));

  v_seconds := least(greatest(coalesce(p_lease_seconds, 60), 1), 600);

  -- A crashed worker is terminally failed. Closing expired leases here
  -- gives the next drain cycle a deterministic recovery path without invoking the model again.
  update public.psi_agt002_reanalysis_jobs
  set status = 'unavailable',
      error_code = 'lease_lost',
      error_message = 'El trabajo perdió su reserva antes de completarse.',
      lease_id = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where status = 'running' and lease_expires_at <= now();

  select *
  into v_job
  from public.psi_agt002_reanalysis_jobs
  where status = 'queued'
    and lease_id is null
  order by created_at, id
  for update skip locked
  limit 1;

  if v_job.id is null then
    return jsonb_build_object('status', 'empty');
  end if;

  v_lease_id := gen_random_uuid();
  v_lease_expires_at := now() + make_interval(secs => v_seconds);

  update public.psi_agt002_reanalysis_jobs
  set status = 'running',
      lease_id = v_lease_id,
      lease_expires_at = v_lease_expires_at,
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = v_job.id;

  return jsonb_build_object(
    'status', 'claimed',
    'job_id', v_job.id,
    'lease_id', v_lease_id,
    'lease_expires_at', v_lease_expires_at,
    'opportunity_id', v_job.opportunity_id,
    'tender_id', v_job.tender_id,
    'snapshot_id', v_job.snapshot_id,
    'context_version_id', v_job.context_version_id,
    'idempotency_key', v_job.idempotency_key,
    'frozen_engine_input', v_job.frozen_engine_input,
    'requested_by', v_job.requested_by
  );
end;
$$;

revoke all on function public.psi_create_agt002_reanalysis_job(uuid, uuid, uuid, uuid, text, jsonb, uuid) from public, authenticated, anon;
grant execute on function public.psi_create_agt002_reanalysis_job(uuid, uuid, uuid, uuid, text, jsonb, uuid) to service_role;
revoke all on function public.psi_claim_agt002_reanalysis_job(integer) from public, authenticated, anon;
grant execute on function public.psi_claim_agt002_reanalysis_job(integer) to service_role;

revoke all on function public.psi_archive_agt002_analysis_workset(uuid, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_archive_agt002_analysis_workset(uuid, uuid);

revoke all on function public.psi_finalize_agt002_durable_batched_analysis(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_finalize_agt002_durable_batched_analysis(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid);

revoke all on function public.psi_mark_agt002_analysis_workset_published(uuid, uuid, uuid, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_mark_agt002_analysis_workset_published(uuid, uuid, uuid, uuid);

revoke all on function public.psi_record_agt002_analysis_checkpoint(uuid, uuid, uuid, text, integer, text, text, jsonb, text, jsonb, text, text, integer, integer) from public, authenticated, anon, service_role;
drop function if exists public.psi_record_agt002_analysis_checkpoint(uuid, uuid, uuid, text, integer, text, text, jsonb, text, jsonb, text, text, integer, integer);

revoke all on function public.psi_list_agt002_analysis_checkpoints(uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_list_agt002_analysis_checkpoints(uuid);

revoke all on function public.psi_get_agt002_analysis_workset(text) from public, authenticated, anon, service_role;
drop function if exists public.psi_get_agt002_analysis_workset(text);

revoke all on function public.psi_get_or_create_agt002_analysis_workset(uuid, uuid, uuid, uuid, text, jsonb) from public, authenticated, anon, service_role;
drop function if exists public.psi_get_or_create_agt002_analysis_workset(uuid, uuid, uuid, uuid, text, jsonb);

drop trigger if exists psi_agt002_analysis_checkpoints_immutable on public.psi_agt002_analysis_checkpoints;
drop function if exists public.psi_agt002_analysis_checkpoints_prevent_mutation();

drop trigger if exists psi_agt002_analysis_worksets_publication_guard on public.psi_agt002_analysis_worksets;
drop function if exists public.psi_agt002_analysis_worksets_guard_publication();

-- Checkpoints reference worksets: drop in dependency order so a partial rollback never
-- leaves an orphaned checkpoint table.
drop table if exists public.psi_agt002_analysis_checkpoints;
drop table if exists public.psi_agt002_analysis_worksets;

commit;
