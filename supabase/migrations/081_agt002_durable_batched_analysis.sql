-- AGT-002 durable checkpoint + atomic finalization foundation
-- (docs/plans/2026-09-03-agt002-durable-batched-analysis.md, Task 1). Additive beside
-- every existing AGT-002 table/RPC: nothing already deployed (025, 028, 050, 051, 053,
-- 056, 063, 067/076, 068, 079, 080) is dropped or column-truncated here. Two 068 RPCs
-- (psi_create_agt002_reanalysis_job, psi_claim_agt002_reanalysis_job) and 068's identity
-- trigger function ARE redefined in place, compatibly: same signatures, same existing
-- validations/actor checks/idempotent behavior/active-job invariant, only extended for a
-- server-owned execution_mode stamp and bounded durable reclaim (see below). Every other
-- preexisting RPC (psi_complete_agt002_reanalysis_job, psi_fail_agt002_reanalysis_job,
-- psi_record_agt002_canonical_analysis_run, both 079 heartbeat renewal RPCs) is left
-- byte-for-byte untouched.
--
-- Two new service-role-only tables:
--   * psi_agt002_analysis_worksets    -- one durable "work identity" row per canonical
--     analysis idempotency_key, immutable except for the one-way false->true publication
--     marker.
--   * psi_agt002_analysis_checkpoints -- one immutable, append-only row per
--     (workset_id, stage, batch_index). This identity is deliberately distinct from any
--     queue job/lease/attempt identity: a checkpoint records durable provider acceptance
--     of one unit of work, not a queue execution.
--
-- Six new SECURITY DEFINER, search_path-pinned, service_role-only RPCs. The last one,
-- psi_finalize_agt002_durable_batched_analysis, is the single atomic, lease-fenced call
-- that invokes the existing, untouched public.psi_record_agt002_canonical_analysis_run
-- (067/076 signature) and completes the durable-batched queue job in the SAME function
-- body/transaction, so any failure inside rolls back canonical persistence and job
-- completion together. The legacy public.psi_complete_agt002_reanalysis_job (068) is left
-- byte-for-byte untouched for the existing single-turn completion path.
--
-- psi_agt002_reanalysis_jobs (068) additively gains execution_mode/phase/progress
-- counters/resume_count. psi_agt002_analysis_worksets additively gains archived_at/
-- archived_by, a one-way null->timestamp archival marker enforced by the same publication
-- guard trigger, plus the governed psi_archive_agt002_analysis_workset RPC: the only path
-- that ever lets rollback 081 proceed again once a workset has checkpoints.
begin;

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_analysis_worksets
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_analysis_worksets (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  snapshot_id uuid not null references public.psi_tender_document_snapshots(id) on delete restrict,
  context_version_id uuid not null references public.psi_agt002_context_versions(id) on delete restrict,
  frozen_identity jsonb not null check (jsonb_typeof(frozen_identity) = 'object'),
  published boolean not null default false,
  published_analysis_run_id uuid references public.psi_tender_analysis_runs(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Governed archival marker (this subphase): additive, idempotent/re-appliable columns.
-- archived_at/archived_by move null -> set exactly once, by the governed
-- psi_archive_agt002_analysis_workset RPC below; the update guard right below forbids ever
-- reversing or rewriting either once set.
alter table public.psi_agt002_analysis_worksets
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.psi_sales_profiles(id) on delete restrict;

-- Worksets are identity-immutable and can only ever move published false -> true, once,
-- with a real published_analysis_run_id set at the same time. Nothing else may change.
-- Delete is intentionally NOT blocked here (unlike checkpoints below): archival/rollback
-- cleanup of a fully terminal, checkpoint-free workset happens by ordinary row delete.
create or replace function public.psi_agt002_analysis_worksets_guard_publication()
returns trigger language plpgsql as $$
begin
  if new.idempotency_key is distinct from old.idempotency_key
     or new.frozen_identity is distinct from old.frozen_identity
     or new.opportunity_id is distinct from old.opportunity_id
     or new.tender_id is distinct from old.tender_id
     or new.snapshot_id is distinct from old.snapshot_id
     or new.context_version_id is distinct from old.context_version_id
     or new.created_at is distinct from old.created_at then
    raise exception 'psi_agt002_analysis_worksets: la identidad del workset es inmutable' using errcode = '55000';
  end if;
  if old.published is true and new.published is distinct from true then
    raise exception 'psi_agt002_analysis_worksets: un workset publicado nunca puede despublicarse' using errcode = '55000';
  end if;
  if new.published is true and old.published is distinct from true and new.published_analysis_run_id is null then
    raise exception 'psi_agt002_analysis_worksets: la publicación requiere una ejecución canónica real' using errcode = '55000';
  end if;
  if old.published is true and new.published_analysis_run_id is distinct from old.published_analysis_run_id then
    raise exception 'psi_agt002_analysis_worksets: la ejecución publicada es inmutable una vez fijada' using errcode = '55000';
  end if;
  -- Archival is a one-way null -> timestamp transition, stamped together with a real actor,
  -- exactly once. Once set, neither archived_at nor archived_by may ever change again (no
  -- un-archive, no rewriting who/when), and the archival transition may never be combined
  -- with any other rewritten column in the same statement.
  if old.archived_at is not null and new.archived_at is distinct from old.archived_at then
    raise exception 'psi_agt002_analysis_worksets: un workset archivado nunca puede des-archivarse ni cambiar su marca de archivado' using errcode = '55000';
  end if;
  if old.archived_by is not null and new.archived_by is distinct from old.archived_by then
    raise exception 'psi_agt002_analysis_worksets: el actor de archivado es inmutable una vez fijado' using errcode = '55000';
  end if;
  if new.archived_at is distinct from old.archived_at then
    if old.archived_at is not null or new.archived_at is null or new.archived_by is null then
      raise exception 'psi_agt002_analysis_worksets: la transición de archivado sólo puede ir de null a una marca real, con un actor real' using errcode = '55000';
    end if;
    if new.published is distinct from old.published
       or new.published_analysis_run_id is distinct from old.published_analysis_run_id then
      raise exception 'psi_agt002_analysis_worksets: el archivado no puede combinarse con ningún otro cambio' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists psi_agt002_analysis_worksets_publication_guard on public.psi_agt002_analysis_worksets;
create trigger psi_agt002_analysis_worksets_publication_guard
  before update on public.psi_agt002_analysis_worksets
  for each row execute function public.psi_agt002_analysis_worksets_guard_publication();

alter table public.psi_agt002_analysis_worksets enable row level security;
revoke all on table public.psi_agt002_analysis_worksets from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_analysis_worksets to service_role;

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_analysis_checkpoints
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_analysis_checkpoints (
  id uuid primary key default gen_random_uuid(),
  workset_id uuid not null references public.psi_agt002_analysis_worksets(id) on delete restrict,
  stage text not null check (stage in ('semantic_discovery_batch', 'semantic_manifest', 'integral_analysis_plan', 'integral_analysis_batch')),
  batch_index integer not null check (batch_index >= 0),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  stage_contract_version text not null check (nullif(btrim(stage_contract_version), '') is not null),
  output jsonb not null check (jsonb_typeof(output) = 'object'),
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
  provider_idempotency_key text not null check (nullif(btrim(provider_idempotency_key), '') is not null),
  created_at timestamptz not null default now(),
  unique (workset_id, stage, batch_index)
);

-- Checkpoints are permanently append-only: no UPDATE or DELETE survives, for any role,
-- ever. A checkpoint is durable provider acceptance of one unit of work; rewriting or
-- removing one after the fact would silently rewrite governed history.
create or replace function public.psi_agt002_analysis_checkpoints_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_analysis_checkpoints is append-only: UPDATE and DELETE are prohibited' using errcode = '55000';
end;
$$;

drop trigger if exists psi_agt002_analysis_checkpoints_immutable on public.psi_agt002_analysis_checkpoints;
create trigger psi_agt002_analysis_checkpoints_immutable
  before update or delete on public.psi_agt002_analysis_checkpoints
  for each row execute function public.psi_agt002_analysis_checkpoints_prevent_mutation();

alter table public.psi_agt002_analysis_checkpoints enable row level security;
revoke all on table public.psi_agt002_analysis_checkpoints from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_analysis_checkpoints to service_role;

-- ---------------------------------------------------------------------------------------
-- Extend psi_agt002_reanalysis_jobs (068) additively: execution_mode/phase/progress/
-- resume_count for durable batched analysis. Every pre-081 row defaults to
-- execution_mode = 'single_turn_v1' and resume_count = 0, so existing legacy jobs stay
-- valid and behaviorally unchanged. Only a newly enqueued job is ever stamped
-- durable_batched_v1, and only by the server (psi_create_agt002_reanalysis_job below) —
-- no RPC in this migration accepts a caller-supplied execution_mode.
-- ---------------------------------------------------------------------------------------
alter table public.psi_agt002_reanalysis_jobs
  add column if not exists execution_mode text not null default 'single_turn_v1'
    check (execution_mode in ('single_turn_v1', 'durable_batched_v1')),
  add column if not exists phase text
    check (phase is null or phase in (
      'semantic_discovery', 'integral_analysis', 'merge', 'finalize'
    )),
  add column if not exists completed_batch_count integer not null default 0
    check (completed_batch_count >= 0),
  add column if not exists total_batch_count integer not null default 0
    check (total_batch_count >= 0),
  add column if not exists resume_count integer not null default 0
    check (resume_count >= 0) check (resume_count <= 5);

-- execution_mode joins the frozen-identity allowlist: it is stamped once, server-side, at
-- creation and must never be rewritten afterward, exactly like every other frozen input
-- column. phase/completed_batch_count/total_batch_count/resume_count are deliberately NOT
-- added here: they are the safe, mutable progress/resume state this migration adds.
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
     or new.created_at is distinct from old.created_at
     or new.execution_mode is distinct from old.execution_mode then
    raise exception 'psi_agt002_reanalysis_jobs: la identidad y el insumo congelado son inmutables' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_get_or_create_agt002_analysis_workset
-- Byte-exact reuse under the same idempotency_key; any bound-field mismatch fails closed.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_get_or_create_agt002_analysis_workset(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_snapshot_id uuid,
  p_context_version_id uuid,
  p_idempotency_key text,
  p_frozen_identity jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workset public.psi_agt002_analysis_worksets%rowtype;
  v_snapshot public.psi_tender_document_snapshots%rowtype;
  v_context public.psi_agt002_context_versions%rowtype;
  v_new_id uuid;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'La clave de idempotencia del workset es obligatoria.' using errcode = '22023';
  end if;
  if p_frozen_identity is null or jsonb_typeof(p_frozen_identity) <> 'object' then
    raise exception 'La identidad congelada del workset debe ser un objeto estructurado.' using errcode = '22023';
  end if;

  select * into v_snapshot from public.psi_tender_document_snapshots where id = p_snapshot_id for share;
  if not found then raise exception 'El snapshot documental no existe.' using errcode = 'P0002'; end if;
  if v_snapshot.opportunity_id is distinct from p_opportunity_id or v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot no coincide con la oportunidad y licitación indicadas.' using errcode = '22023';
  end if;

  select * into v_context from public.psi_agt002_context_versions where id = p_context_version_id for share;
  if not found then raise exception 'La versión de contexto AGT-002 no existe.' using errcode = 'P0002'; end if;
  if v_context.opportunity_id is distinct from p_opportunity_id
     or v_context.tender_id is distinct from p_tender_id
     or v_context.snapshot_id is distinct from p_snapshot_id then
    raise exception 'La versión de contexto no coincide con la identidad indicada.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-workset:' || p_idempotency_key, 0));

  select * into v_workset from public.psi_agt002_analysis_worksets where idempotency_key = p_idempotency_key for share;
  if found then
    if v_workset.opportunity_id is distinct from p_opportunity_id
       or v_workset.tender_id is distinct from p_tender_id
       or v_workset.snapshot_id is distinct from p_snapshot_id
       or v_workset.context_version_id is distinct from p_context_version_id
       or v_workset.frozen_identity is distinct from p_frozen_identity then
      raise exception 'La clave de idempotencia del workset ya pertenece a otra identidad congelada.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'workset_id', v_workset.id, 'published', v_workset.published);
  end if;

  v_new_id := gen_random_uuid();
  insert into public.psi_agt002_analysis_worksets (
    id, idempotency_key, opportunity_id, tender_id, snapshot_id, context_version_id, frozen_identity
  ) values (
    v_new_id, p_idempotency_key, p_opportunity_id, p_tender_id, p_snapshot_id, p_context_version_id, p_frozen_identity
  );

  return jsonb_build_object('status', 'created', 'workset_id', v_new_id, 'published', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_get_agt002_analysis_workset
-- Narrow read by canonical idempotency_key only.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_get_agt002_analysis_workset(
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workset public.psi_agt002_analysis_worksets%rowtype;
begin
  select * into v_workset from public.psi_agt002_analysis_worksets where idempotency_key = p_idempotency_key;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'workset_id', v_workset.id, 'idempotency_key', v_workset.idempotency_key,
    'opportunity_id', v_workset.opportunity_id, 'tender_id', v_workset.tender_id,
    'snapshot_id', v_workset.snapshot_id, 'context_version_id', v_workset.context_version_id,
    'frozen_identity', v_workset.frozen_identity, 'published', v_workset.published,
    'published_analysis_run_id', v_workset.published_analysis_run_id, 'created_at', v_workset.created_at
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_list_agt002_analysis_checkpoints
-- Narrow read by workset_id only; never surfaces/joins current-analysis rows.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_list_agt002_analysis_checkpoints(
  p_workset_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_checkpoints jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'checkpoint_id', c.id, 'workset_id', c.workset_id, 'stage', c.stage, 'batch_index', c.batch_index,
      'request_hash', c.request_hash, 'stage_contract_version', c.stage_contract_version,
      'output', c.output, 'output_sha256', c.output_sha256, 'usage', c.usage,
      'provider_idempotency_key', c.provider_idempotency_key, 'created_at', c.created_at
    ) order by c.stage, c.batch_index
  ), '[]'::jsonb)
  into v_checkpoints
  from public.psi_agt002_analysis_checkpoints c
  where c.workset_id = p_workset_id;

  return jsonb_build_object('checkpoints', v_checkpoints);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_record_agt002_analysis_checkpoint
-- Insert-or-compare on (workset_id, stage, batch_index): exact replay reuses the row,
-- any content mismatch under the same identity fails closed. Lease-fenced by BOTH job_id
-- and lease_id against a running, unexpired job whose frozen idempotency_key equals the
-- workset's. Never touches psi_tender_analysis_runs: a checkpoint is durable acceptance,
-- never a publication. The trailing p_progress_phase/p_completed_batch_count/
-- p_total_batch_count triplet lets this SAME call also advance the fenced running job's
-- phase/progress counters in one transaction: no separate, unfenced "update progress" RPC
-- ever exists. Progress may never regress within a phase, and the only legal phase
-- transition is semantic_discovery -> integral_analysis.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_record_agt002_analysis_checkpoint(
  p_job_id uuid,
  p_lease_id uuid,
  p_workset_id uuid,
  p_stage text,
  p_batch_index integer,
  p_request_hash text,
  p_stage_contract_version text,
  p_output jsonb,
  p_output_sha256 text,
  p_usage jsonb,
  p_provider_idempotency_key text,
  p_progress_phase text,
  p_completed_batch_count integer,
  p_total_batch_count integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_workset public.psi_agt002_analysis_worksets%rowtype;
  v_checkpoint public.psi_agt002_analysis_checkpoints%rowtype;
  v_new_id uuid;
  v_result jsonb;
  v_row_count integer;
begin
  select * into v_job from public.psi_agt002_reanalysis_jobs where id = p_job_id for share;
  if not found then
    raise exception 'psi_record_agt002_analysis_checkpoint: job % no encontrado', p_job_id using errcode = 'P0002';
  end if;

  if v_job.lease_id is null or not (v_job.lease_id = p_lease_id) then
    raise exception 'psi_record_agt002_analysis_checkpoint: reserva inválida para el job %', p_job_id using errcode = '55000';
  end if;
  if not (v_job.status = 'running') then
    raise exception 'psi_record_agt002_analysis_checkpoint: el job % no está en ejecución (running)', p_job_id using errcode = '55000';
  end if;
  if v_job.lease_expires_at is null or not (v_job.lease_expires_at > now()) then
    raise exception 'psi_record_agt002_analysis_checkpoint: la reserva del job % expiró', p_job_id using errcode = '55000';
  end if;

  select * into v_workset from public.psi_agt002_analysis_worksets where id = p_workset_id for share;
  if not found then
    raise exception 'El workset de análisis no existe.' using errcode = 'P0002';
  end if;
  if v_job.idempotency_key is distinct from v_workset.idempotency_key then
    raise exception 'psi_record_agt002_analysis_checkpoint: la identidad (idempotency_key) del job no coincide con el workset.' using errcode = '22023';
  end if;

  if p_stage not in ('semantic_discovery_batch', 'semantic_manifest', 'integral_analysis_plan', 'integral_analysis_batch') then
    raise exception 'Etapa de checkpoint no reconocida.' using errcode = '22023';
  end if;
  if p_batch_index is null or p_batch_index < 0 then
    raise exception 'El índice de lote del checkpoint no es válido.' using errcode = '22023';
  end if;
  if p_output is null or jsonb_typeof(p_output) <> 'object' then
    raise exception 'La salida validada del checkpoint debe ser un objeto estructurado.' using errcode = '22023';
  end if;
  if p_usage is not null and jsonb_typeof(p_usage) <> 'object' then
    raise exception 'El uso del checkpoint debe ser un objeto estructurado.' using errcode = '22023';
  end if;
  if nullif(btrim(p_request_hash), '') is null
     or nullif(btrim(p_stage_contract_version), '') is null
     or nullif(btrim(p_output_sha256), '') is null
     or nullif(btrim(p_provider_idempotency_key), '') is null then
    raise exception 'Los metadatos del checkpoint son obligatorios.' using errcode = '22023';
  end if;

  if p_progress_phase is null or p_progress_phase not in ('semantic_discovery', 'integral_analysis') then
    raise exception 'La fase de progreso del checkpoint no es válida.' using errcode = '22023';
  end if;
  if p_completed_batch_count is null or not (p_completed_batch_count > 0) then
    raise exception 'El conteo de lotes completados debe ser al menos 1.' using errcode = '22023';
  end if;
  if p_total_batch_count is null or p_total_batch_count < p_completed_batch_count then
    raise exception 'El total de lotes no puede ser menor que los lotes completados.' using errcode = '22023';
  end if;
  if p_stage in ('semantic_discovery_batch', 'semantic_manifest') and p_progress_phase is distinct from 'semantic_discovery' then
    raise exception 'La etapa % requiere la fase de progreso semantic_discovery.', p_stage using errcode = '22023';
  end if;
  if p_stage in ('integral_analysis_plan', 'integral_analysis_batch') and p_progress_phase is distinct from 'integral_analysis' then
    raise exception 'La etapa % requiere la fase de progreso integral_analysis.', p_stage using errcode = '22023';
  end if;

  -- No progress regression, fenced against the same running job locked above: the same
  -- phase can never lower its completed/total counts, and the only legal phase transition
  -- is semantic_discovery -> integral_analysis (a null job phase, i.e. not yet started,
  -- accepts either phase).
  if v_job.phase is not null then
    if v_job.phase = p_progress_phase then
      if p_completed_batch_count < v_job.completed_batch_count or p_total_batch_count < v_job.total_batch_count then
        raise exception 'psi_record_agt002_analysis_checkpoint: el progreso del job % no puede retroceder', p_job_id using errcode = '55000';
      end if;
    elsif v_job.phase = 'integral_analysis' and p_progress_phase = 'semantic_discovery' then
      raise exception 'psi_record_agt002_analysis_checkpoint: el job % no puede retroceder de integral_analysis a semantic_discovery', p_job_id using errcode = '55000';
    end if;
  end if;

  select * into v_checkpoint from public.psi_agt002_analysis_checkpoints
    where workset_id = p_workset_id and stage = p_stage and batch_index = p_batch_index
    for share;
  if found then
    if v_checkpoint.request_hash is distinct from p_request_hash
       or v_checkpoint.stage_contract_version is distinct from p_stage_contract_version
       or v_checkpoint.output is distinct from p_output
       or v_checkpoint.output_sha256 is distinct from p_output_sha256
       or v_checkpoint.usage is distinct from p_usage
       or v_checkpoint.provider_idempotency_key is distinct from p_provider_idempotency_key then
      raise exception 'psi_record_agt002_analysis_checkpoint: (workset_id, stage, batch_index) ya tiene un checkpoint distinto.' using errcode = '23505';
    end if;
    v_result := jsonb_build_object('status', 'existing', 'checkpoint_id', v_checkpoint.id);
  else
    v_new_id := gen_random_uuid();
    insert into public.psi_agt002_analysis_checkpoints (
      id, workset_id, stage, batch_index, request_hash, stage_contract_version, output, output_sha256, usage, provider_idempotency_key
    ) values (
      v_new_id, p_workset_id, p_stage, p_batch_index, p_request_hash, p_stage_contract_version, p_output, p_output_sha256, p_usage, p_provider_idempotency_key
    );
    v_result := jsonb_build_object('status', 'created', 'checkpoint_id', v_new_id);
  end if;

  -- The SAME fenced running job the checkpoint identity/lease checks above already locked:
  -- advance its phase/progress counters in this same transaction, failing closed unless
  -- exactly one row (still running, still under this lease) actually updated.
  update public.psi_agt002_reanalysis_jobs
  set phase = p_progress_phase,
      completed_batch_count = p_completed_batch_count,
      total_batch_count = p_total_batch_count,
      updated_at = now()
  where id = p_job_id and lease_id = p_lease_id and status = 'running';
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'psi_record_agt002_analysis_checkpoint: no se pudo actualizar el progreso del job % (reserva perdida o job no en ejecución)', p_job_id using errcode = '55000';
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_mark_agt002_analysis_workset_published
-- Narrow one-way publication marker: verifies the referenced run is a real completed
-- canonical run for this workset's identity (mirroring 068's canonical check) before ever
-- flipping published to true. Lease-fenced exactly like the checkpoint write above.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_mark_agt002_analysis_workset_published(
  p_job_id uuid,
  p_lease_id uuid,
  p_workset_id uuid,
  p_analysis_run_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_workset public.psi_agt002_analysis_worksets%rowtype;
  v_run public.psi_tender_analysis_runs%rowtype;
begin
  select * into v_job from public.psi_agt002_reanalysis_jobs where id = p_job_id for share;
  if not found then
    raise exception 'psi_mark_agt002_analysis_workset_published: job % no encontrado', p_job_id using errcode = 'P0002';
  end if;

  if v_job.lease_id is null or not (v_job.lease_id = p_lease_id) then
    raise exception 'psi_mark_agt002_analysis_workset_published: reserva inválida para el job %', p_job_id using errcode = '55000';
  end if;
  if not (v_job.status = 'running') then
    raise exception 'psi_mark_agt002_analysis_workset_published: el job % no está en ejecución (running)', p_job_id using errcode = '55000';
  end if;
  if v_job.lease_expires_at is null or not (v_job.lease_expires_at > now()) then
    raise exception 'psi_mark_agt002_analysis_workset_published: la reserva del job % expiró', p_job_id using errcode = '55000';
  end if;

  select * into v_workset from public.psi_agt002_analysis_worksets where id = p_workset_id for update;
  if not found then
    raise exception 'El workset de análisis no existe.' using errcode = 'P0002';
  end if;
  if v_job.idempotency_key is distinct from v_workset.idempotency_key then
    raise exception 'psi_mark_agt002_analysis_workset_published: la identidad (idempotency_key) del job no coincide con el workset.' using errcode = '22023';
  end if;

  select * into v_run from public.psi_tender_analysis_runs where id = p_analysis_run_id for share;
  if not found then
    raise exception 'psi_mark_agt002_analysis_workset_published: la ejecución % no existe', p_analysis_run_id using errcode = 'P0002';
  end if;
  if not (v_run.canonical = true) then
    raise exception 'psi_mark_agt002_analysis_workset_published: la ejecución no es un análisis canónico.' using errcode = '22023';
  end if;
  if v_run.status is distinct from 'completed'
     or v_run.opportunity_id is distinct from v_workset.opportunity_id
     or v_run.tender_id is distinct from v_workset.tender_id
     or v_run.snapshot_id is distinct from v_workset.snapshot_id then
    raise exception 'psi_mark_agt002_analysis_workset_published: la ejecución no corresponde a este workset.' using errcode = '22023';
  end if;

  if v_workset.published then
    if v_workset.published_analysis_run_id is distinct from p_analysis_run_id then
      raise exception 'psi_mark_agt002_analysis_workset_published: el workset % ya está publicado con otra ejecución', p_workset_id using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'workset_id', v_workset.id, 'published_analysis_run_id', v_workset.published_analysis_run_id);
  end if;

  update public.psi_agt002_analysis_worksets
  set published = true, published_analysis_run_id = p_analysis_run_id
  where id = p_workset_id;

  return jsonb_build_object('status', 'published', 'workset_id', p_workset_id, 'published_analysis_run_id', p_analysis_run_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Extend the existing 068 enqueue/claim RPCs IN PLACE. Their caller-facing signatures
-- never change (no p_execution_mode parameter anywhere): every newly enqueued job is now
-- stamped durable_batched_v1 by the server, and an expired running durable_batched_v1 job
-- below the bounded resume cap is reclaimed (requeued, checkpoints retained) instead of
-- being closed terminally. A legacy (single_turn_v1) job, or a durable_batched_v1 job at
-- or over the resume cap, keeps the exact pre-081 terminal-unavailable behavior.
-- ---------------------------------------------------------------------------------------
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

  -- Every newly enqueued job is server-owned durable_batched_v1: no caller, past or
  -- present, can select or forge execution_mode.
  insert into public.psi_agt002_reanalysis_jobs
    (opportunity_id, tender_id, snapshot_id, context_version_id, idempotency_key, frozen_engine_input, status, requested_by, execution_mode)
  values
    (p_opportunity_id, p_tender_id, p_snapshot_id, p_context_version_id, p_idempotency_key, p_frozen_engine_input, 'queued', p_requested_by, 'durable_batched_v1')
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

  -- A legacy (single_turn_v1) job, or a durable_batched_v1 job already at/over the bounded
  -- resume cap, is terminally failed exactly as before: it can never be handed to the
  -- model again.
  update public.psi_agt002_reanalysis_jobs
  set status = 'unavailable',
      error_code = 'lease_lost',
      error_message = 'El trabajo perdió su reserva antes de completarse.',
      lease_id = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where status = 'running' and lease_expires_at <= now()
    and (execution_mode is distinct from 'durable_batched_v1' or resume_count >= 5);

  -- A durable_batched_v1 job below the resume cap is reclaimed instead of terminated: it
  -- goes back to queued with a bounded resume_count increment, retaining every
  -- already-accepted checkpoint for the same canonical identity so it can be claimed and
  -- resumed again without repeating completed provider work.
  update public.psi_agt002_reanalysis_jobs
  set status = 'queued',
      resume_count = resume_count + 1,
      lease_id = null,
      lease_expires_at = null,
      updated_at = now()
  where status = 'running' and lease_expires_at <= now()
    and execution_mode = 'durable_batched_v1' and resume_count < 5;

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
    'requested_by', v_job.requested_by,
    'execution_mode', v_job.execution_mode,
    'phase', v_job.phase,
    'completed_batch_count', v_job.completed_batch_count,
    'total_batch_count', v_job.total_batch_count,
    'resume_count', v_job.resume_count
  );
end;
$$;

-- Redefined in place (068's revoke-then-grant posture is restated defensively, exactly
-- like 076 does for psi_record_agt002_canonical_analysis_run): no caller-facing privilege
-- change, only the server-owned execution_mode stamp and bounded reclaim behavior above.
revoke all on function public.psi_create_agt002_reanalysis_job(uuid, uuid, uuid, uuid, text, jsonb, uuid) from public, authenticated, anon;
grant execute on function public.psi_create_agt002_reanalysis_job(uuid, uuid, uuid, uuid, text, jsonb, uuid) to service_role;
revoke all on function public.psi_claim_agt002_reanalysis_job(integer) from public, authenticated, anon;
grant execute on function public.psi_claim_agt002_reanalysis_job(integer) to service_role;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_finalize_agt002_durable_batched_analysis
-- The one atomic, lease-fenced finalize call. Calls the existing, unmodified
-- public.psi_record_agt002_canonical_analysis_run(...) (067/076 signature) and completes
-- the queue job in the SAME function body: no exception handler here swallows the
-- canonical call's failure, so any error (a malformed V3 payload, a lease already lost)
-- unwinds every write this function made and leaves the job exactly as it was. Never
-- calls the separate legacy public.psi_complete_agt002_reanalysis_job (068), which stays
-- reserved for single_turn_v1 jobs.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_finalize_agt002_durable_batched_analysis(
  p_job_id uuid,
  p_lease_id uuid,
  p_workset_id uuid,
  p_snapshot_id uuid,
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_result jsonb,
  p_critical_open_count integer,
  p_idempotency_key text,
  p_schema_version text,
  p_policy_version text,
  p_model text,
  p_usage jsonb,
  p_context_version_id uuid,
  p_legal_corpus_version_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_workset public.psi_agt002_analysis_worksets%rowtype;
  v_run_result jsonb;
  v_run_id uuid;
begin
  select * into v_job from public.psi_agt002_reanalysis_jobs where id = p_job_id for update;
  if not found then
    raise exception 'psi_finalize_agt002_durable_batched_analysis: job % no encontrado', p_job_id using errcode = 'P0002';
  end if;

  if v_job.lease_id is null or not (v_job.lease_id = p_lease_id) then
    raise exception 'psi_finalize_agt002_durable_batched_analysis: reserva inválida para el job %', p_job_id using errcode = '55000';
  end if;
  if not (v_job.status = 'running') then
    raise exception 'psi_finalize_agt002_durable_batched_analysis: el job % no está en ejecución (running)', p_job_id using errcode = '55000';
  end if;
  if v_job.lease_expires_at is null or not (v_job.lease_expires_at > now()) then
    raise exception 'psi_finalize_agt002_durable_batched_analysis: la reserva del job % expiró', p_job_id using errcode = '55000';
  end if;
  if v_job.execution_mode is distinct from 'durable_batched_v1' then
    raise exception 'psi_finalize_agt002_durable_batched_analysis: el job % no es de tipo durable_batched_v1; los jobs single_turn_v1 finalizan por psi_complete_agt002_reanalysis_job', p_job_id using errcode = '55000';
  end if;

  select * into v_workset from public.psi_agt002_analysis_worksets where id = p_workset_id for update;
  if not found then
    raise exception 'El workset de análisis no existe.' using errcode = 'P0002';
  end if;
  if v_job.idempotency_key is distinct from v_workset.idempotency_key
     or p_idempotency_key is distinct from v_workset.idempotency_key then
    raise exception 'psi_finalize_agt002_durable_batched_analysis: la identidad (idempotency_key) del job/finalización no coincide con el workset.' using errcode = '22023';
  end if;
  if v_workset.opportunity_id is distinct from p_opportunity_id
     or v_workset.tender_id is distinct from p_tender_id
     or v_workset.snapshot_id is distinct from p_snapshot_id then
    raise exception 'psi_finalize_agt002_durable_batched_analysis: la identidad del workset no coincide con los parámetros de finalización.' using errcode = '22023';
  end if;
  if v_workset.context_version_id is distinct from p_context_version_id then
    raise exception 'psi_finalize_agt002_durable_batched_analysis: la versión de contexto no coincide con la del workset.' using errcode = '22023';
  end if;

  -- One atomic unit: any exception raised by the canonical gate below (067/076) aborts
  -- this entire function, so the two updates that follow it never partially apply.
  select public.psi_record_agt002_canonical_analysis_run(
    p_snapshot_id, p_opportunity_id, p_tender_id, p_result, p_critical_open_count,
    p_idempotency_key, p_schema_version, p_policy_version, p_model, p_usage,
    p_context_version_id, p_legal_corpus_version_id
  ) into v_run_result;
  v_run_id := (v_run_result ->> 'id')::uuid;

  -- An idempotent replay of psi_record_agt002_canonical_analysis_run short-circuits to
  -- whatever the run row holds NOW, which may since have been demoted (canonical=false)
  -- by a later, unrelated promotion, or may never have completed. Never publish/complete
  -- on faith: require the returned run to actually be canonical and completed.
  if v_run_id is null
     or (v_run_result ->> 'canonical')::boolean is distinct from true
     or v_run_result ->> 'status' is distinct from 'completed' then
    raise exception 'psi_finalize_agt002_durable_batched_analysis: la ejecución canónica devuelta no es válida (id/canonical/status).' using errcode = '55000';
  end if;

  update public.psi_agt002_analysis_worksets
  set published = true, published_analysis_run_id = v_run_id
  where id = p_workset_id;

  update public.psi_agt002_reanalysis_jobs
  set status = 'completed',
      analysis_run_id = v_run_id,
      lease_id = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('analysis_run_id', v_run_id, 'workset_id', p_workset_id, 'job_id', p_job_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_archive_agt002_analysis_workset
-- The governed, one-way archival RPC that is the ONLY thing that can ever let rollback 081
-- proceed again once a workset has checkpoints: it fails closed while any queued/running job
-- still shares the workset's own canonical idempotency_key, then stamps archived_at/
-- archived_by exactly once. Never touches (let alone deletes) checkpoint rows: checkpoints
-- stay permanently append-only even through archival. Exact replay by the SAME actor is
-- idempotent; replay by a DIFFERENT actor fails closed rather than silently rewriting who
-- archived the workset.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_archive_agt002_analysis_workset(
  p_workset_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workset public.psi_agt002_analysis_worksets%rowtype;
begin
  if not exists (
    select 1 from public.psi_sales_profiles where id = p_actor_id and active and identity_type = 'human'
  ) then
    raise exception 'psi_archive_agt002_analysis_workset: actor_id % no corresponde a una persona activa.', p_actor_id using errcode = '28000';
  end if;

  select * into v_workset from public.psi_agt002_analysis_worksets where id = p_workset_id for update;
  if not found then
    raise exception 'El workset de análisis no existe.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.psi_agt002_reanalysis_jobs
    where idempotency_key = v_workset.idempotency_key
      and status in ('queued', 'running')
  ) then
    raise exception 'psi_archive_agt002_analysis_workset: existe un trabajo AGT-002 activo (queued/running) para esta identidad canónica; el archivado se bloquea.' using errcode = '55000';
  end if;

  if v_workset.archived_at is not null then
    if v_workset.archived_by is distinct from p_actor_id then
      raise exception 'psi_archive_agt002_analysis_workset: el workset % ya fue archivado por otro actor', p_workset_id using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status', 'existing', 'workset_id', v_workset.id,
      'archived_at', v_workset.archived_at, 'archived_by', v_workset.archived_by
    );
  end if;

  update public.psi_agt002_analysis_worksets
  set archived_at = now(), archived_by = p_actor_id
  where id = p_workset_id;

  return jsonb_build_object('status', 'archived', 'workset_id', p_workset_id, 'archived_by', p_actor_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Grants: revoke first, then grant execute to service_role only, per new RPC.
-- ---------------------------------------------------------------------------------------
revoke all on function public.psi_get_or_create_agt002_analysis_workset(uuid, uuid, uuid, uuid, text, jsonb) from public, authenticated, anon, service_role;
grant execute on function public.psi_get_or_create_agt002_analysis_workset(uuid, uuid, uuid, uuid, text, jsonb) to service_role;

revoke all on function public.psi_get_agt002_analysis_workset(text) from public, authenticated, anon, service_role;
grant execute on function public.psi_get_agt002_analysis_workset(text) to service_role;

revoke all on function public.psi_list_agt002_analysis_checkpoints(uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_list_agt002_analysis_checkpoints(uuid) to service_role;

revoke all on function public.psi_record_agt002_analysis_checkpoint(uuid, uuid, uuid, text, integer, text, text, jsonb, text, jsonb, text, text, integer, integer) from public, authenticated, anon, service_role;
grant execute on function public.psi_record_agt002_analysis_checkpoint(uuid, uuid, uuid, text, integer, text, text, jsonb, text, jsonb, text, text, integer, integer) to service_role;

revoke all on function public.psi_mark_agt002_analysis_workset_published(uuid, uuid, uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_mark_agt002_analysis_workset_published(uuid, uuid, uuid, uuid) to service_role;

revoke all on function public.psi_finalize_agt002_durable_batched_analysis(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_finalize_agt002_durable_batched_analysis(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid) to service_role;

revoke all on function public.psi_archive_agt002_analysis_workset(uuid, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_archive_agt002_analysis_workset(uuid, uuid) to service_role;

commit;
