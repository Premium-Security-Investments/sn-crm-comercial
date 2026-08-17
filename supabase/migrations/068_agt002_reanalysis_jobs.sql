-- Durable, human-triggered queue for canonical AGT-002 reanalysis, executed by a Node
-- worker directly on Hetzner (outside Vercel's 180-second function limit). The human
-- POST only creates/reuses one row here; the model call and canonical persistence stay
-- exactly where they already happen (createAgt002PreviewRuntime / runAgt002PostBridgeAnalysis).
-- A job that loses its lease is closed as unavailable and is never executed again.
-- service_role-only end to end; frozen input and raw error detail never
-- reach anon/authenticated.
begin;

create table if not exists public.psi_agt002_reanalysis_jobs (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  snapshot_id uuid not null references public.psi_tender_document_snapshots(id) on delete restrict,
  context_version_id uuid not null references public.psi_agt002_context_versions(id) on delete restrict,
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  frozen_engine_input jsonb not null check (jsonb_typeof(frozen_engine_input) = 'object'),
  status text not null check (status in ('queued', 'running', 'completed', 'unavailable')),
  lease_id uuid,
  lease_expires_at timestamptz,
  requested_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  analysis_run_id uuid references public.psi_tender_analysis_runs(id) on delete restrict,
  error_code text check (error_code is null or error_code in (
    'timeout', 'provider_error', 'invalid_output', 'persistence_failure', 'lease_lost', 'capacity_unavailable'
  )),
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint psi_agt002_reanalysis_jobs_lease_all_or_none check (
    (lease_id is null and lease_expires_at is null) or (lease_id is not null and lease_expires_at is not null)),
  constraint psi_agt002_reanalysis_jobs_terminal_shape check (
    (status in ('queued', 'running') and analysis_run_id is null and error_code is null and error_message is null)
    or (status = 'completed' and analysis_run_id is not null and error_code is null and error_message is null)
    or (status = 'unavailable' and analysis_run_id is null and error_code is not null and error_message is not null)
  )
);

create unique index if not exists psi_agt002_reanalysis_jobs_one_active
  on public.psi_agt002_reanalysis_jobs (opportunity_id)
  where status in ('queued', 'running');
create index if not exists psi_agt002_reanalysis_jobs_idempotency_idx
  on public.psi_agt002_reanalysis_jobs (idempotency_key, created_at desc);
create index if not exists psi_agt002_reanalysis_jobs_claimable_idx
  on public.psi_agt002_reanalysis_jobs (status, created_at)
  where status = 'queued' and lease_id is null;

-- Frozen identity/input columns are immutable after insert: no code path (including a
-- future bug in the worker) can ever rewrite what a queued/claimed job was frozen against.
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

drop trigger if exists psi_agt002_reanalysis_jobs_identity_immutable on public.psi_agt002_reanalysis_jobs;
create trigger psi_agt002_reanalysis_jobs_identity_immutable
  before update on public.psi_agt002_reanalysis_jobs
  for each row execute function public.psi_agt002_reanalysis_jobs_prevent_identity_mutation();

alter table public.psi_agt002_reanalysis_jobs enable row level security;
revoke all on public.psi_agt002_reanalysis_jobs from public, authenticated, anon;
grant select on public.psi_agt002_reanalysis_jobs to service_role;

-- Idempotent create/reuse: one active (queued|running) job per opportunity at a time, and
-- a replay of the same idempotency key always resolves to the same row.
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

-- Claims at most one queued job per call. A lost lease is closed terminally before
-- selecting fresh work and can never be handed to the model again.
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

-- Completion requires a real canonical run already recorded by the existing engine/
-- persistence path: this RPC never writes psi_tender_analysis_runs itself, it only closes
-- the queue row against one that already exists there. A stale/mismatched lease can never
-- overwrite terminal state.
create or replace function public.psi_complete_agt002_reanalysis_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_analysis_run_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_run public.psi_tender_analysis_runs%rowtype;
begin
  select * into v_job from public.psi_agt002_reanalysis_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'psi_complete_agt002_reanalysis_job: job % no encontrado', p_job_id using errcode = 'P0002';
  end if;

  if v_job.status = 'completed' then
    if v_job.analysis_run_id is distinct from p_analysis_run_id then
      raise exception 'psi_complete_agt002_reanalysis_job: el job % ya se completó con otra ejecución', p_job_id using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'job_id', v_job.id, 'analysis_run_id', v_job.analysis_run_id);
  end if;

  if v_job.status = 'unavailable' then
    raise exception 'psi_complete_agt002_reanalysis_job: el job % ya está en estado terminal unavailable', p_job_id using errcode = '55000';
  end if;

  if v_job.status <> 'running' then
    raise exception 'psi_complete_agt002_reanalysis_job: el job % no está en ejecución', p_job_id using errcode = '55000';
  end if;

  if v_job.lease_id is distinct from p_lease_id or v_job.lease_expires_at <= now() then
    raise exception 'psi_complete_agt002_reanalysis_job: reserva inválida o expirada para el job %', p_job_id using errcode = '55000';
  end if;

  if p_analysis_run_id is null then
    raise exception 'psi_complete_agt002_reanalysis_job: se requiere una ejecución canónica real.' using errcode = '22023';
  end if;

  select * into v_run from public.psi_tender_analysis_runs where id = p_analysis_run_id for share;
  if v_run.id is null
     or v_run.canonical is distinct from true
     or v_run.status is distinct from 'completed'
     or v_run.opportunity_id is distinct from v_job.opportunity_id
     or v_run.tender_id is distinct from v_job.tender_id
     or v_run.snapshot_id is distinct from v_job.snapshot_id then
    raise exception 'psi_complete_agt002_reanalysis_job: la ejecución no es un análisis canónico válido para este job.' using errcode = '22023';
  end if;

  update public.psi_agt002_reanalysis_jobs
  set status = 'completed',
      analysis_run_id = p_analysis_run_id,
      lease_id = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('status', 'completed', 'job_id', p_job_id, 'analysis_run_id', p_analysis_run_id);
end;
$$;

-- Terminal failure closes the job as 'unavailable' with a closed error code/message only:
-- no raw provider/model/DB text is ever accepted as a parameter, so nothing can leak
-- through this surface. unavailable is terminal, exactly like completed: nothing else runs.
create or replace function public.psi_fail_agt002_reanalysis_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_error_message text;
begin
  if p_error_code not in ('timeout', 'provider_error', 'invalid_output', 'persistence_failure', 'lease_lost', 'capacity_unavailable') then
    raise exception 'psi_fail_agt002_reanalysis_job: código de error no reconocido.' using errcode = '22023';
  end if;

  v_error_message := case p_error_code
    when 'timeout' then 'El análisis no se completó dentro del tiempo permitido.'
    when 'provider_error' then 'El proveedor del modelo no pudo completar la solicitud.'
    when 'invalid_output' then 'El resultado del motor no superó la validación.'
    when 'persistence_failure' then 'No fue posible confirmar el estado final del trabajo; la corrida canónica puede haberse registrado.'
    when 'lease_lost' then 'El trabajo perdió su reserva antes de completarse.'
    when 'capacity_unavailable' then 'Vig-IA no tenía capacidad disponible para ejecutar el trabajo.'
  end;

  select * into v_job from public.psi_agt002_reanalysis_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'psi_fail_agt002_reanalysis_job: job % no encontrado', p_job_id using errcode = 'P0002';
  end if;

  if v_job.status = 'unavailable' then
    return jsonb_build_object('status', 'existing', 'job_id', v_job.id, 'error_code', v_job.error_code, 'error_message', v_job.error_message);
  end if;

  if v_job.status = 'completed' then
    raise exception 'psi_fail_agt002_reanalysis_job: el job % ya está en estado terminal completed', p_job_id using errcode = '55000';
  end if;

  if v_job.status <> 'running' then
    raise exception 'psi_fail_agt002_reanalysis_job: el job % no está en ejecución', p_job_id using errcode = '55000';
  end if;

  if v_job.lease_id is distinct from p_lease_id then
    raise exception 'psi_fail_agt002_reanalysis_job: reserva inválida para el job %', p_job_id using errcode = '55000';
  end if;

  update public.psi_agt002_reanalysis_jobs
  set status = 'unavailable',
      error_code = p_error_code,
      error_message = v_error_message,
      lease_id = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('status', 'unavailable', 'job_id', p_job_id, 'error_code', p_error_code, 'error_message', v_error_message);
end;
$$;

revoke all on function public.psi_create_agt002_reanalysis_job(uuid, uuid, uuid, uuid, text, jsonb, uuid) from public, authenticated, anon;
grant execute on function public.psi_create_agt002_reanalysis_job(uuid, uuid, uuid, uuid, text, jsonb, uuid) to service_role;
revoke all on function public.psi_claim_agt002_reanalysis_job(integer) from public, authenticated, anon;
grant execute on function public.psi_claim_agt002_reanalysis_job(integer) to service_role;
revoke all on function public.psi_complete_agt002_reanalysis_job(uuid, uuid, uuid) from public, authenticated, anon;
grant execute on function public.psi_complete_agt002_reanalysis_job(uuid, uuid, uuid) to service_role;
revoke all on function public.psi_fail_agt002_reanalysis_job(uuid, uuid, text) from public, authenticated, anon;
grant execute on function public.psi_fail_agt002_reanalysis_job(uuid, uuid, text) to service_role;

commit;
