-- AGT-002 P0-06 — initial-analysis canonical persistence and append-only aggregate
-- (docs/agt002/initial-analysis/CURRENT.md). Strictly additive beside every deployed
-- AGT-002/tender object: nothing here drops a table or a column, and no preexisting function
-- is redefined. psi_tender_analysis_runs_prevent_mutation (063) already diffs
-- `to_jsonb(old/new) - 'canonical'`, so it needs no change to keep every new AGT002 column
-- added below (analysis_kind, analysis_core_hash, etc.) immutable outside the one canonical
-- true -> false transition.
--
-- Three new service-role-only, permanently append-only tables:
--   * psi_agt002_initial_analysis_checkpoints    -- the durable backing store for the P0-05
--     checkpoint adapter (agt002-initial-analysis-checkpoints.js), which already shipped
--     against this RPC shape with no migration behind it until now.
--   * psi_agt002_initial_analysis_run_lineage    -- one append-only row per INITIAL analysis
--     run, binding it back to the exact job/workflow/authorization/package-version that
--     produced it.
--   * psi_agt002_pre_go_analysis_versions        -- one immutable pre_go_analysis.v1 envelope
--     per (analysis_run_id, aggregate_version). Structural support for the future closed stage
--     vocabulary (ANALYSIS_PUBLISHED | G2_RECORDED | DECISION_INVALIDATED |
--     PRESENTATION_STATUS_CHANGED) ships here; only ANALYSIS_PUBLISHED is ever written by this
--     migration's own RPC. A later stage is always a NEW row, never a mutation of a prior one.
--
-- Additive adaptation of the existing canonical surface:
--   * psi_tender_analysis_runs gains analysis_kind/analysis_version/g1_authorization_id/
--     g1_scope/package_version_id/analysis_core_hash, all nullable so every pre-existing row
--     (rules/HERMES) is unaffected, plus a CHECK constraint pinning the INITIAL shape
--     (analysis_version = 1). This migration only ever writes analysis_kind = 'INITIAL': it
--     defines no other analysis_kind shape, constraint or column — that is explicitly out of
--     scope for this additive slice. snapshot_id becomes nullable (INITIAL has no
--     psi_tender_document_snapshots row) but stays mandatory for every other row via an explicit
--     CHECK.
--   * psi_agt002_initial_analysis_jobs gains analysis_run_id and error_code plus a terminal-shape
--     CHECK: a COMPLETED job always carries a real run id and no error_code; a FAILED job always
--     carries an error_code and no run id; every other status carries neither. This is enforced
--     by Postgres itself, not by convention.
--
-- Two new SECURITY DEFINER, search_path-pinned, service_role-only RPCs:
--   * psi_complete_agt002_initial_analysis_job — the sole atomic terminal-completion boundary.
--     In one transaction it: re-verifies the caller's own (job_id, lease_id, fence_version);
--     requires a persisted `synthesis` checkpoint; re-verifies the G1 authorization/package
--     version/workflow-instance bindings already produced automatically by the trimmed P0-10
--     flow (no second human gate or button lives here — G1 is generated and consumed upstream
--     from that one click, this RPC only re-checks the resulting binding); requires no canonical
--     run already exists for the opportunity (INITIAL never supersedes); re-checks the
--     envelope's own meta block against every parameter before trusting it (the envelope itself
--     arrives opaque — the caller's JS already validated it against schemas/agt002/
--     pre_go_analysis.v1.schema.json, so SQL only cross-checks identity fields, never the full
--     shape); inserts the canonical run, the lineage row and the aggregate v1 envelope; marks
--     the job COMPLETED; and always appends the governed CONSUMED -> COMPLETED workflow event
--     (098) in the same transaction — p_workflow_instance_id is mandatory, never optional, so an
--     INITIAL completion can never leave its driving workflow instance without its terminal
--     event. Any failure at any step rolls back every write in the same call — there is no
--     partial terminal state. An exact replay (same job, already COMPLETED with the same run)
--     only returns the existing result once its lineage bindings and its aggregate v1 row
--     (analysis_core_hash, envelope_hash, schema_version, stage/version) match every incoming
--     parameter byte for byte; any discrepancy is a 23505 conflict, never a silent reuse.
--   * psi_fail_agt002_initial_analysis_job — the sole atomic terminal-failure boundary, mirroring
--     the completion RPC's fencing/idempotency shape for the FAILED terminal instead. Only a
--     closed, snake_case error code (`^[a-z0-9_]{3,80}$`) is ever accepted — never raw provider/
--     model/DB text. A replay with the same error code against an already-FAILED job is
--     idempotent; any other terminal state, or a stale/lost lease or fence, is rejected. If the
--     job's own payload.persistence.workflowInstanceId is bound and that workflow instance is
--     CONSUMED, the governed CONSUMED -> FAILED event (098) is appended in the same transaction
--     with evidence limited to {error_code}; a job that never reached a bound workflow instance
--     (an early failure, or a legacy admission) is still marked FAILED without inventing an
--     event. jobs.error_code (plain additive text column, closed-shape CHECK) backs this RPC.
begin;

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_initial_analysis_checkpoints
-- Backing store for agt002-initial-analysis-checkpoints.js's psi_store_/psi_load_ RPCs.
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_initial_analysis_checkpoints (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.psi_agt002_initial_analysis_jobs(id) on delete restrict,
  batch_index integer not null check (batch_index >= 0),
  phase text not null check (phase in ('member_batch_analysis', 'synthesis')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  output jsonb not null,
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
  created_at timestamptz not null default now(),
  unique (job_id, batch_index, phase)
);

create index if not exists psi_agt002_initial_analysis_checkpoints_job_idx
  on public.psi_agt002_initial_analysis_checkpoints (job_id, phase, batch_index);

-- An INITIAL job has exactly one terminal synthesis artifact. Member analysis may span many
-- batches, but admitting two independent synthesis checkpoints would leave completion with an
-- ambiguous publication source.
create unique index if not exists psi_agt002_initial_analysis_checkpoints_one_synthesis_idx
  on public.psi_agt002_initial_analysis_checkpoints (job_id)
  where phase = 'synthesis';

create or replace function public.psi_agt002_initial_analysis_checkpoints_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_initial_analysis_checkpoints es append-only: UPDATE y DELETE están prohibidos' using errcode = '55000';
end;
$$;

drop trigger if exists psi_agt002_initial_analysis_checkpoints_immutable on public.psi_agt002_initial_analysis_checkpoints;
create trigger psi_agt002_initial_analysis_checkpoints_immutable
  before update or delete on public.psi_agt002_initial_analysis_checkpoints
  for each row execute function public.psi_agt002_initial_analysis_checkpoints_prevent_mutation();

alter table public.psi_agt002_initial_analysis_checkpoints enable row level security;
revoke all on table public.psi_agt002_initial_analysis_checkpoints from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_initial_analysis_checkpoints to service_role;

-- Fenced write: identity/lease/fence are re-verified against the live job row on every call.
-- A stale fence or a lost/expired lease always reports errcode 55000 so the JS adapter can map
-- it to its dedicated LEASE_LOST code without ever persisting the provider output.
create or replace function public.psi_store_agt002_initial_analysis_checkpoint(
  p_job_id uuid,
  p_lease_id uuid,
  p_fence_version integer,
  p_batch_index integer,
  p_phase text,
  p_request_hash text,
  p_output jsonb,
  p_output_sha256 text,
  p_usage jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_initial_analysis_jobs%rowtype;
  v_existing public.psi_agt002_initial_analysis_checkpoints%rowtype;
  v_checkpoint_id uuid;
begin
  if p_job_id is null or p_lease_id is null or p_fence_version is null or p_batch_index is null
     or p_phase is null or p_request_hash is null or p_output is null or p_output_sha256 is null then
    raise exception 'Todos los campos del checkpoint de análisis inicial son obligatorios.' using errcode = '22023';
  end if;
  if p_phase not in ('member_batch_analysis', 'synthesis') then
    raise exception 'Fase de checkpoint no reconocida.' using errcode = '22023';
  end if;

  select * into v_job from public.psi_agt002_initial_analysis_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'El job de análisis inicial no existe.' using errcode = 'P0002';
  end if;
  if v_job.status not in ('CLAIMED', 'RUNNING')
     or v_job.lease_id is distinct from p_lease_id
     or v_job.fence_version is distinct from p_fence_version
     or v_job.lease_expires_at is null or v_job.lease_expires_at <= now() then
    raise exception 'El job perdió su reserva antes de poder persistir el checkpoint.' using errcode = '55000';
  end if;

  select * into v_existing
  from public.psi_agt002_initial_analysis_checkpoints
  where job_id = p_job_id and batch_index = p_batch_index and phase = p_phase
  for share;
  if found then
    if v_existing.request_hash is distinct from p_request_hash
       or v_existing.output is distinct from p_output
       or v_existing.output_sha256 is distinct from p_output_sha256
       or v_existing.usage is distinct from p_usage then
      raise exception 'Ya existe un checkpoint distinto para este job/lote/fase.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'checkpoint_id', v_existing.id);
  end if;

  insert into public.psi_agt002_initial_analysis_checkpoints (
    job_id, batch_index, phase, request_hash, output, output_sha256, usage
  ) values (
    p_job_id, p_batch_index, p_phase, p_request_hash, p_output, p_output_sha256, p_usage
  ) returning id into v_checkpoint_id;

  return jsonb_build_object('status', 'created', 'checkpoint_id', v_checkpoint_id);
end;
$$;

-- Narrow read; never lease-checked (resume is allowed to read across a lease boundary so the
-- caller's own assertAgt002InitialAnalysisCheckpointResumable can decide what is reusable).
create or replace function public.psi_load_agt002_initial_analysis_checkpoint(
  p_job_id uuid,
  p_batch_index integer,
  p_phase text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.psi_agt002_initial_analysis_checkpoints%rowtype;
begin
  select * into v_row
  from public.psi_agt002_initial_analysis_checkpoints
  where job_id = p_job_id and batch_index = p_batch_index and phase = p_phase;

  if v_row.id is null then
    return jsonb_build_object('checkpoint', null);
  end if;

  return jsonb_build_object('checkpoint', jsonb_build_object(
    'job_id', v_row.job_id, 'batch_index', v_row.batch_index, 'phase', v_row.phase,
    'request_hash', v_row.request_hash, 'output', v_row.output,
    'output_sha256', v_row.output_sha256, 'usage', v_row.usage
  ));
end;
$$;

revoke all on function public.psi_store_agt002_initial_analysis_checkpoint(uuid, uuid, integer, integer, text, text, jsonb, text, jsonb) from public, authenticated, anon, service_role;
grant execute on function public.psi_store_agt002_initial_analysis_checkpoint(uuid, uuid, integer, integer, text, text, jsonb, text, jsonb) to service_role;
revoke all on function public.psi_load_agt002_initial_analysis_checkpoint(uuid, integer, text) from public, authenticated, anon, service_role;
grant execute on function public.psi_load_agt002_initial_analysis_checkpoint(uuid, integer, text) to service_role;

-- ---------------------------------------------------------------------------------------
-- Additive adaptation: psi_tender_analysis_runs gains the AGT-002 analysis_kind columns, with
-- 'INITIAL' the only value this migration ever defines. Every column is nullable, so every
-- pre-existing row (rules/HERMES) is unaffected; the CHECK constraints below only ever
-- constrain a row that opts in by setting analysis_kind.
-- ---------------------------------------------------------------------------------------
alter table public.psi_tender_analysis_runs
  add column if not exists analysis_kind text,
  add column if not exists analysis_version integer,
  add column if not exists g1_authorization_id uuid references public.psi_agt002_analysis_authorizations(id) on delete restrict,
  add column if not exists g1_scope text,
  add column if not exists package_version_id uuid references public.psi_agt002_evidence_package_versions(id) on delete restrict,
  add column if not exists analysis_core_hash text;

-- INITIAL has no psi_tender_document_snapshots row (that concept belongs to the document-diff
-- path other analysis kinds use); every other row still requires one.
alter table public.psi_tender_analysis_runs alter column snapshot_id drop not null;

do $$
begin
  -- Only non-AGT002 rows (rules/HERMES-INTERIM, and any legacy row with analysis_kind still
  -- null) are required to carry a psi_tender_document_snapshots row; INITIAL has none by
  -- construction.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_tender_analysis_runs'::regclass
      and conname = 'psi_tender_analysis_runs_snapshot_legacy_check'
  ) then
    alter table public.psi_tender_analysis_runs
      add constraint psi_tender_analysis_runs_snapshot_legacy_check
      check (analysis_kind is not null or snapshot_id is not null);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_tender_analysis_runs'::regclass
      and conname = 'psi_tender_analysis_runs_agt002_kind_check'
  ) then
    -- Only INITIAL is defined by this migration. A future migration owns widening this enum
    -- (and its own shape CHECK) when it ships; this slice does not predict that shape.
    alter table public.psi_tender_analysis_runs
      add constraint psi_tender_analysis_runs_agt002_kind_check
      check (analysis_kind is null or analysis_kind = 'INITIAL');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_tender_analysis_runs'::regclass
      and conname = 'psi_tender_analysis_runs_agt002_scope_check'
  ) then
    alter table public.psi_tender_analysis_runs
      add constraint psi_tender_analysis_runs_agt002_scope_check
      check (g1_scope is null or g1_scope in ('A', 'A_PLUS_B'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_tender_analysis_runs'::regclass
      and conname = 'psi_tender_analysis_runs_agt002_hash_check'
  ) then
    alter table public.psi_tender_analysis_runs
      add constraint psi_tender_analysis_runs_agt002_hash_check
      check (analysis_core_hash is null or analysis_core_hash ~ '^[0-9a-f]{64}$');
  end if;
  -- The RED core: an INITIAL run must always be version 1. Checked here, at the table itself,
  -- so no RPC bug can ever smuggle a violating row in.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_tender_analysis_runs'::regclass
      and conname = 'psi_tender_analysis_runs_agt002_initial_shape_check'
  ) then
    alter table public.psi_tender_analysis_runs
      add constraint psi_tender_analysis_runs_agt002_initial_shape_check
      check (analysis_kind is distinct from 'INITIAL' or analysis_version = 1);
  end if;
  -- Every AGT002-kind row travels with its own full identity: an INITIAL run can never be
  -- recorded completed/canonical without the G1 authorization, scope, package version and
  -- stable core hash that produced it.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_tender_analysis_runs'::regclass
      and conname = 'psi_tender_analysis_runs_agt002_identity_complete_check'
  ) then
    alter table public.psi_tender_analysis_runs
      add constraint psi_tender_analysis_runs_agt002_identity_complete_check
      check (
        analysis_kind is null
        or (g1_authorization_id is not null and g1_scope is not null
            and analysis_core_hash is not null and package_version_id is not null)
      );
  end if;
  -- Composite unique, needed only as the FK target below: it forces every row of
  -- psi_agt002_pre_go_analysis_versions for a given run to reference the exact same
  -- analysis_core_hash the run itself was recorded with, so two versions of the same run can
  -- never disagree on lineage/core hash — enforced by the FK, not merely by re-deriving it from
  -- each envelope's JSON.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_tender_analysis_runs'::regclass
      and conname = 'psi_tender_analysis_runs_agt002_hash_unique'
  ) then
    alter table public.psi_tender_analysis_runs
      add constraint psi_tender_analysis_runs_agt002_hash_unique
      unique (id, analysis_core_hash);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- Additive adaptation: psi_agt002_initial_analysis_jobs gains a terminal-shape invariant: a
-- COMPLETED job always carries a real run id and no error_code; a FAILED job always carries an
-- error_code and no run id; every other status carries neither. Enforced by Postgres itself, not
-- by RPC convention.
-- ---------------------------------------------------------------------------------------
alter table public.psi_agt002_initial_analysis_jobs
  add column if not exists analysis_run_id uuid references public.psi_tender_analysis_runs(id) on delete restrict,
  add column if not exists error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{3,80}$');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_agt002_initial_analysis_jobs'::regclass
      and conname = 'psi_agt002_initial_analysis_jobs_terminal_shape_check'
  ) then
    alter table public.psi_agt002_initial_analysis_jobs
      add constraint psi_agt002_initial_analysis_jobs_terminal_shape_check
      check (
        (status = 'COMPLETED' and analysis_run_id is not null and error_code is null)
        or (status = 'FAILED' and analysis_run_id is null and error_code is not null)
        or (status not in ('COMPLETED', 'FAILED') and analysis_run_id is null and error_code is null)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_initial_analysis_run_lineage
-- One append-only row per INITIAL analysis run, binding it to the exact job/workflow/
-- authorization/package-version that produced it.
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_initial_analysis_run_lineage (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null unique references public.psi_tender_analysis_runs(id) on delete restrict,
  job_id uuid not null unique references public.psi_agt002_initial_analysis_jobs(id) on delete restrict,
  workflow_instance_id uuid references public.psi_agt002_workflow_instances(id) on delete restrict,
  authorization_id uuid not null references public.psi_agt002_analysis_authorizations(id) on delete restrict,
  package_version_id uuid not null references public.psi_agt002_evidence_package_versions(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists psi_agt002_initial_analysis_run_lineage_opportunity_idx
  on public.psi_agt002_initial_analysis_run_lineage (opportunity_id, created_at desc);

create or replace function public.psi_agt002_initial_analysis_run_lineage_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_initial_analysis_run_lineage es append-only: UPDATE y DELETE están prohibidos' using errcode = '55000';
end;
$$;

drop trigger if exists psi_agt002_initial_analysis_run_lineage_immutable on public.psi_agt002_initial_analysis_run_lineage;
create trigger psi_agt002_initial_analysis_run_lineage_immutable
  before update or delete on public.psi_agt002_initial_analysis_run_lineage
  for each row execute function public.psi_agt002_initial_analysis_run_lineage_prevent_mutation();

alter table public.psi_agt002_initial_analysis_run_lineage enable row level security;
revoke all on table public.psi_agt002_initial_analysis_run_lineage from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_initial_analysis_run_lineage to service_role;

-- ---------------------------------------------------------------------------------------
-- Table: psi_agt002_pre_go_analysis_versions
-- One immutable pre_go_analysis.v1 envelope per (analysis_run_id, aggregate_version). The
-- closed stage vocabulary includes every future stage so the shape never needs to change again;
-- only ANALYSIS_PUBLISHED is ever written by this migration's own RPC. A later stage is always
-- a brand-new row (a higher aggregate_version), never a mutation of a prior one.
-- ---------------------------------------------------------------------------------------
create table if not exists public.psi_agt002_pre_go_analysis_versions (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.psi_tender_analysis_runs(id) on delete restrict,
  aggregate_version integer not null check (aggregate_version >= 1),
  aggregate_stage text not null check (aggregate_stage in (
    'ANALYSIS_PUBLISHED', 'G2_RECORDED', 'DECISION_INVALIDATED', 'PRESENTATION_STATUS_CHANGED'
  )),
  schema_version text not null check (schema_version = 'pre_go_analysis.v1'),
  envelope jsonb not null check (jsonb_typeof(envelope) = 'object'),
  envelope_hash text not null check (envelope_hash ~ '^[0-9a-f]{64}$'),
  -- Explicit column, not derived solely from the JSON envelope: the FK below forces every
  -- version row of a run to carry the exact same hash the run itself was recorded with.
  analysis_core_hash text not null check (analysis_core_hash ~ '^[0-9a-f]{64}$'),
  created_by text not null check (created_by in ('system', 'human')),
  created_at timestamptz not null default now(),
  unique (analysis_run_id, aggregate_version),
  foreign key (analysis_run_id, analysis_core_hash)
    references public.psi_tender_analysis_runs (id, analysis_core_hash) on delete restrict,
  -- RED: ANALYSIS_PUBLISHED is always aggregate_version 1 with a null human_decision; every
  -- later stage is always aggregate_version >= 2 with a non-null human_decision. Mirrors the
  -- immutable schema's own meta/human_decision invariants structurally.
  check ((aggregate_stage = 'ANALYSIS_PUBLISHED') = (aggregate_version = 1)),
  check (aggregate_stage <> 'ANALYSIS_PUBLISHED' or envelope -> 'human_decision' = 'null'::jsonb),
  check (aggregate_stage = 'ANALYSIS_PUBLISHED' or envelope -> 'human_decision' is not null)
);

create index if not exists psi_agt002_pre_go_analysis_versions_run_idx
  on public.psi_agt002_pre_go_analysis_versions (analysis_run_id, aggregate_version desc);

create or replace function public.psi_agt002_pre_go_analysis_versions_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_pre_go_analysis_versions es append-only: UPDATE y DELETE están prohibidos' using errcode = '55000';
end;
$$;

drop trigger if exists psi_agt002_pre_go_analysis_versions_immutable on public.psi_agt002_pre_go_analysis_versions;
create trigger psi_agt002_pre_go_analysis_versions_immutable
  before update or delete on public.psi_agt002_pre_go_analysis_versions
  for each row execute function public.psi_agt002_pre_go_analysis_versions_prevent_mutation();

alter table public.psi_agt002_pre_go_analysis_versions enable row level security;
revoke all on table public.psi_agt002_pre_go_analysis_versions from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_pre_go_analysis_versions to service_role;

-- Note: psi_tender_analysis_runs_prevent_mutation (063) is NOT redefined here. Its guard
-- already diffs `to_jsonb(old/new) - 'canonical'`, so every column added above
-- (analysis_kind, analysis_core_hash, etc.) is automatically covered without any change: a
-- change to analysis_core_hash — or any other column — on an existing row, with or without a
-- canonical flip, is still rejected exactly as before.

-- ---------------------------------------------------------------------------------------
-- RPC: psi_complete_agt002_initial_analysis_job
-- The sole atomic terminal-completion boundary for the INITIAL analysis path. Every write
-- (canonical run, lineage, aggregate v1 envelope, job COMPLETED, workflow event) happens in
-- this one function body; any failure rolls back everything.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_complete_agt002_initial_analysis_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_fence_version integer,
  p_analysis_run_id uuid,
  p_workflow_instance_id uuid,
  p_authorization_id uuid,
  p_package_version_id uuid,
  p_package_hash text,
  p_g1_scope text,
  p_analysis_core_hash text,
  p_policy_version text,
  p_schema_version text,
  p_envelope jsonb,
  p_envelope_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_initial_analysis_jobs%rowtype;
  v_existing_run public.psi_tender_analysis_runs%rowtype;
  v_existing_lineage public.psi_agt002_initial_analysis_run_lineage%rowtype;
  v_existing_version public.psi_agt002_pre_go_analysis_versions%rowtype;
  v_synthesis public.psi_agt002_initial_analysis_checkpoints%rowtype;
  v_version public.psi_agt002_evidence_package_versions%rowtype;
  v_package public.psi_agt002_evidence_packages%rowtype;
  v_auth public.psi_agt002_analysis_authorizations%rowtype;
  v_workflow public.psi_agt002_workflow_instances%rowtype;
  v_workflow_state text;
  v_meta jsonb;
  v_lineage_id uuid;
begin
  if p_job_id is null or p_lease_id is null or p_fence_version is null or p_analysis_run_id is null
     or p_workflow_instance_id is null or p_authorization_id is null or p_package_version_id is null
     or p_package_hash is null or p_g1_scope is null or p_analysis_core_hash is null
     or p_policy_version is null or p_schema_version is null or p_envelope is null or p_envelope_hash is null then
    raise exception 'Todos los campos de finalización del análisis inicial AGT-002 son obligatorios.' using errcode = '22023';
  end if;
  if p_schema_version is distinct from 'pre_go_analysis.v1' then
    raise exception 'La versión de esquema del agregado debe ser pre_go_analysis.v1.' using errcode = '22023';
  end if;
  if p_package_hash !~ '^[0-9a-f]{64}$'
     or p_analysis_core_hash !~ '^[0-9a-f]{64}$'
     or p_envelope_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Los hashes del análisis inicial deben ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if nullif(btrim(p_policy_version), '') is null then
    raise exception 'La versión de política del análisis inicial es obligatoria.' using errcode = '22023';
  end if;
  if p_g1_scope not in ('A', 'A_PLUS_B') then
    raise exception 'El alcance G1 no es válido.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_envelope) <> 'object' then
    raise exception 'El agregado debe ser un objeto estructurado.' using errcode = '22023';
  end if;

  select * into v_job from public.psi_agt002_initial_analysis_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'El job de análisis inicial no existe.' using errcode = 'P0002';
  end if;

  if v_job.status = 'COMPLETED' then
    select * into v_existing_run
    from public.psi_tender_analysis_runs
    where id = v_job.analysis_run_id
    for share;
    select * into v_existing_lineage from public.psi_agt002_initial_analysis_run_lineage where job_id = p_job_id for share;
    if found and v_existing_lineage.analysis_run_id = p_analysis_run_id then
      -- Same job, same run: still only idempotent if every lineage binding and the aggregate v1
      -- row itself match the incoming parameters byte for byte. This is a replay check, not a
      -- re-derivation — any discrepancy (a caller retrying with different bindings or a
      -- different envelope/hash under the same run id) is a 23505 conflict, never a silent reuse
      -- of whatever happened to be persisted first.
      select * into v_existing_version
      from public.psi_agt002_pre_go_analysis_versions
      where analysis_run_id = p_analysis_run_id and aggregate_version = 1
      for share;
      if v_job.analysis_run_id is distinct from p_analysis_run_id
         or v_existing_run.id is null
         or v_existing_run.opportunity_id is distinct from v_job.opportunity_id
         or v_existing_run.tender_id is distinct from v_job.tender_id
         or v_existing_run.analysis_kind is distinct from 'INITIAL'
         or v_existing_run.analysis_version is distinct from 1
         or v_existing_run.g1_authorization_id is distinct from p_authorization_id
         or v_existing_run.g1_scope is distinct from p_g1_scope
         or v_existing_run.package_version_id is distinct from p_package_version_id
         or v_existing_run.analysis_core_hash is distinct from p_analysis_core_hash
         or v_existing_run.policy_version is distinct from p_policy_version
         or v_existing_run.schema_version is distinct from p_schema_version
         or v_existing_run.result is distinct from p_envelope
         or v_existing_lineage.workflow_instance_id is distinct from p_workflow_instance_id
         or v_existing_lineage.authorization_id is distinct from p_authorization_id
         or v_existing_lineage.package_version_id is distinct from p_package_version_id
         or v_existing_version.id is null
         or v_existing_version.analysis_core_hash is distinct from p_analysis_core_hash
         or v_existing_version.envelope_hash is distinct from p_envelope_hash
         or v_existing_version.envelope is distinct from p_envelope
         or v_existing_version.schema_version is distinct from p_schema_version
         or v_existing_version.aggregate_stage is distinct from 'ANALYSIS_PUBLISHED'
         or v_existing_version.aggregate_version is distinct from 1 then
        raise exception 'El job de análisis inicial ya se completó con un resultado distinto; el reintento no es un replay idéntico.' using errcode = '23505';
      end if;
      return jsonb_build_object('status', 'existing', 'job_id', p_job_id, 'analysis_run_id', v_existing_lineage.analysis_run_id, 'aggregate_version', 1);
    end if;
    raise exception 'El job de análisis inicial ya se completó con otra ejecución.' using errcode = '23505';
  end if;

  if v_job.status not in ('CLAIMED', 'RUNNING') then
    raise exception 'El job de análisis inicial no está en ejecución.' using errcode = '55000';
  end if;
  if v_job.lease_id is distinct from p_lease_id
     or v_job.fence_version is distinct from p_fence_version
     or v_job.lease_expires_at is null or v_job.lease_expires_at <= now() then
    raise exception 'El job perdió su reserva antes de poder completarse.' using errcode = '55000';
  end if;

  select * into v_synthesis
  from public.psi_agt002_initial_analysis_checkpoints
  where job_id = p_job_id and phase = 'synthesis'
  for share;
  if v_synthesis.id is null then
    raise exception 'No puede completarse un análisis inicial sin su checkpoint de síntesis persistido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-initial-analysis-complete:' || v_job.opportunity_id::text, 0));

  if exists (
    select 1 from public.psi_tender_analysis_runs
    where opportunity_id = v_job.opportunity_id and canonical and status = 'completed'
  ) then
    raise exception 'Ya existe un análisis canónico para esta oportunidad; el análisis inicial nunca reemplaza uno existente.' using errcode = '55000';
  end if;

  select * into v_version from public.psi_agt002_evidence_package_versions where id = p_package_version_id for share;
  if v_version.id is null or v_version.package_hash is distinct from p_package_hash then
    raise exception 'La versión del paquete de evidencia congelada no coincide con la huella indicada.' using errcode = '22023';
  end if;
  select * into v_package from public.psi_agt002_evidence_packages where id = v_version.package_id for share;
  if v_package.opportunity_id is distinct from v_job.opportunity_id or v_package.tender_id is distinct from v_job.tender_id then
    raise exception 'El paquete de evidencia congelado no pertenece a la oportunidad y licitación del job.' using errcode = '42501';
  end if;

  select * into v_auth from public.psi_agt002_analysis_authorizations where id = p_authorization_id for share;
  if v_auth.id is null or v_auth.package_version_id is distinct from p_package_version_id
     or v_auth.package_hash is distinct from p_package_hash or v_auth.scope is distinct from p_g1_scope then
    raise exception 'La autorización G1 no coincide con el paquete de evidencia o el alcance indicados.' using errcode = '22023';
  end if;
  if v_auth.workflow_instance_id is distinct from p_workflow_instance_id then
    raise exception 'La autorización G1 no corresponde a la instancia de flujo de trabajo indicada.' using errcode = '22023';
  end if;
  select * into v_workflow
  from public.psi_agt002_workflow_instances
  where id = p_workflow_instance_id
  for share;
  if v_workflow.id is null
     or v_workflow.workflow_type is distinct from 'INITIAL'
     or v_workflow.opportunity_id is distinct from v_job.opportunity_id
     or v_workflow.tender_id is distinct from v_job.tender_id
     or v_workflow.scope is distinct from p_g1_scope then
    raise exception 'La instancia de flujo de trabajo no coincide con la identidad completa del job INITIAL.' using errcode = '42501';
  end if;
  select to_state into v_workflow_state
  from public.psi_agt002_workflow_events
  where workflow_instance_id = p_workflow_instance_id
  order by created_at desc, id desc
  limit 1;
  if v_workflow_state is distinct from 'CONSUMED' then
    raise exception 'La instancia de flujo de trabajo no está en estado CONSUMED; no puede completarse.' using errcode = '55000';
  end if;

  -- Re-check the envelope's own meta block against every parameter before trusting it: the
  -- caller's full JSON-Schema validation happens in JS, but the DB never takes the envelope's
  -- self-reported identity on faith.
  v_meta := p_envelope -> 'meta';
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception 'El agregado debe incluir un bloque meta estructurado.' using errcode = '22023';
  end if;
  if v_meta ->> 'schema_version' is distinct from 'pre_go_analysis.v1' then
    raise exception 'meta.schema_version del agregado debe ser pre_go_analysis.v1.' using errcode = '22023';
  end if;
  if v_meta ->> 'analysis_kind' is distinct from 'INITIAL' then
    raise exception 'meta.analysis_kind del agregado debe ser INITIAL.' using errcode = '22023';
  end if;
  if v_meta -> 'analysis_version' is distinct from '1'::jsonb then
    raise exception 'meta.analysis_version de un análisis INITIAL debe ser 1.' using errcode = '22023';
  end if;
  if v_meta ->> 'aggregate_stage' is distinct from 'ANALYSIS_PUBLISHED' then
    raise exception 'meta.aggregate_stage del primer agregado debe ser ANALYSIS_PUBLISHED.' using errcode = '22023';
  end if;
  if v_meta -> 'aggregate_version' is distinct from '1'::jsonb then
    raise exception 'meta.aggregate_version del primer agregado debe ser 1.' using errcode = '22023';
  end if;
  if p_envelope -> 'human_decision' is distinct from 'null'::jsonb then
    raise exception 'human_decision del primer agregado (ANALYSIS_PUBLISHED) debe ser nulo.' using errcode = '22023';
  end if;
  if v_meta ->> 'analysis_run_id' is distinct from p_analysis_run_id::text then
    raise exception 'meta.analysis_run_id del agregado no coincide con la ejecución indicada.' using errcode = '22023';
  end if;
  if v_meta ->> 'analysis_core_hash' is distinct from p_analysis_core_hash then
    raise exception 'meta.analysis_core_hash del agregado no coincide con el hash indicado.' using errcode = '22023';
  end if;
  if v_meta ->> 'g1_authorization_id' is distinct from p_authorization_id::text then
    raise exception 'meta.g1_authorization_id del agregado no coincide con la autorización indicada.' using errcode = '22023';
  end if;
  if v_meta ->> 'g1_scope' is distinct from p_g1_scope then
    raise exception 'meta.g1_scope del agregado no coincide con el alcance indicado.' using errcode = '22023';
  end if;
  if v_meta ->> 'package_hash' is distinct from p_package_hash then
    raise exception 'meta.package_hash del agregado no coincide con la huella del paquete indicado.' using errcode = '22023';
  end if;
  if v_meta ->> 'opportunity_id' is distinct from v_job.opportunity_id::text
     or v_meta ->> 'tender_id' is distinct from v_job.tender_id::text then
    raise exception 'meta.opportunity_id/tender_id del agregado no coinciden con el job.' using errcode = '22023';
  end if;
  if v_synthesis.output is distinct from p_envelope then
    raise exception 'El agregado final no coincide con el checkpoint de síntesis persistido.' using errcode = '22023';
  end if;

  insert into public.psi_tender_analysis_runs (
    id, snapshot_id, opportunity_id, tender_id, producer, method, status, result, critical_open_count,
    idempotency_key, schema_version, policy_version, completed_at, canonical,
    analysis_kind, analysis_version,
    g1_authorization_id, g1_scope, package_version_id, analysis_core_hash
  ) values (
    p_analysis_run_id, null, v_job.opportunity_id, v_job.tender_id, 'AGT-002', 'agent_ai', 'completed', p_envelope, 0,
    v_job.idempotency_key || ':initial-analysis', p_schema_version, p_policy_version, now(), true,
    'INITIAL', 1,
    p_authorization_id, p_g1_scope, p_package_version_id, p_analysis_core_hash
  );

  insert into public.psi_agt002_initial_analysis_run_lineage (
    analysis_run_id, job_id, workflow_instance_id, authorization_id, package_version_id, opportunity_id, tender_id
  ) values (
    p_analysis_run_id, p_job_id, p_workflow_instance_id, p_authorization_id, p_package_version_id, v_job.opportunity_id, v_job.tender_id
  ) returning id into v_lineage_id;

  insert into public.psi_agt002_pre_go_analysis_versions (
    analysis_run_id, aggregate_version, aggregate_stage, schema_version, envelope, envelope_hash, analysis_core_hash, created_by
  ) values (
    p_analysis_run_id, 1, 'ANALYSIS_PUBLISHED', p_schema_version, p_envelope, p_envelope_hash, p_analysis_core_hash, 'system'
  );

  update public.psi_agt002_initial_analysis_jobs
  set status = 'COMPLETED', analysis_run_id = p_analysis_run_id, lease_id = null, lease_expires_at = null, updated_at = now()
  where id = p_job_id;

  perform public.psi_append_agt002_workflow_event(
    p_workflow_instance_id, 'COMPLETED', null, 'system', 'SYSTEM',
    'INITIAL_ANALYSIS_WORKFLOW', 'production', '{}'::jsonb,
    jsonb_build_object('analysis_run_id', p_analysis_run_id::text), null, null,
    v_job.idempotency_key || ':workflow-completed'
  );

  return jsonb_build_object(
    'status', 'completed', 'job_id', p_job_id, 'analysis_run_id', p_analysis_run_id,
    'aggregate_version', 1, 'lineage_id', v_lineage_id
  );
end;
$$;

revoke all on function public.psi_complete_agt002_initial_analysis_job(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb, text) from public, authenticated, anon, service_role;
grant execute on function public.psi_complete_agt002_initial_analysis_job(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------------------
-- RPC: psi_fail_agt002_initial_analysis_job
-- The sole atomic terminal-failure boundary for the INITIAL analysis path, mirroring the
-- completion RPC's own fencing and idempotency shape for the FAILED terminal instead of
-- COMPLETED. The only input ever trusted as an error identity is a closed, snake_case code —
-- never raw provider/model/DB text, which is validated and discarded by the caller's own JS
-- wrapper (agt002-initial-analysis-jobs.js) before this RPC is ever invoked, and re-validated
-- here regardless.
-- ---------------------------------------------------------------------------------------
create or replace function public.psi_fail_agt002_initial_analysis_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_fence_version integer,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_initial_analysis_jobs%rowtype;
  v_workflow_instance_text text;
  v_workflow_instance_id uuid;
  v_workflow_state text;
begin
  if p_job_id is null or p_lease_id is null or p_fence_version is null or p_error_code is null then
    raise exception 'Todos los campos de fallo del job de análisis inicial AGT-002 son obligatorios.' using errcode = '22023';
  end if;
  if p_error_code !~ '^[a-z0-9_]{3,80}$' then
    raise exception 'El código de error del job de análisis inicial AGT-002 debe ser un código cerrado en snake_case.' using errcode = '22023';
  end if;

  select * into v_job from public.psi_agt002_initial_analysis_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'El job de análisis inicial no existe.' using errcode = 'P0002';
  end if;

  -- Idempotent replay: the exact same error code against an already-FAILED job returns the
  -- existing result without touching anything again; a different error code under the same job
  -- is a conflicting replay, never a silent overwrite.
  if v_job.status = 'FAILED' then
    if v_job.error_code is distinct from p_error_code then
      raise exception 'El job de análisis inicial ya falló con un código de error distinto.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'job_id', p_job_id, 'error_code', v_job.error_code);
  end if;

  if v_job.status = 'COMPLETED' then
    raise exception 'El job de análisis inicial ya se completó; no puede marcarse como fallido.' using errcode = '55000';
  end if;
  if v_job.status not in ('CLAIMED', 'RUNNING') then
    raise exception 'El job de análisis inicial no está en ejecución.' using errcode = '55000';
  end if;
  if v_job.lease_id is distinct from p_lease_id
     or v_job.fence_version is distinct from p_fence_version
     or v_job.lease_expires_at is null or v_job.lease_expires_at <= now() then
    raise exception 'El job perdió su reserva antes de poder marcarse como fallido.' using errcode = '55000';
  end if;

  -- payload.persistence.workflowInstanceId is only ever set once the future one-click
  -- orchestration has bound this job to its driving workflow instance; an early failure (before
  -- that binding exists) or a legacy admission predating it carries no such id, and the job is
  -- still marked FAILED without inventing a workflow event for an instance it was never bound to.
  v_workflow_instance_text := v_job.payload -> 'persistence' ->> 'workflowInstanceId';
  if v_workflow_instance_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_workflow_instance_id := v_workflow_instance_text::uuid;
  else
    -- The workflow binding is optional for failures that occur before orchestration finishes
    -- binding the job. A malformed value is treated as unbound: the job still reaches its
    -- durable FAILED terminal, but no workflow event is invented for an untrusted identity.
    v_workflow_instance_id := null;
  end if;

  if v_workflow_instance_id is not null then
    select to_state into v_workflow_state
    from public.psi_agt002_workflow_events
    where workflow_instance_id = v_workflow_instance_id
    order by created_at desc, id desc
    limit 1;
    if v_workflow_state is distinct from 'CONSUMED' then
      raise exception 'La instancia de flujo de trabajo no está en estado CONSUMED; no puede registrarse el fallo.' using errcode = '55000';
    end if;
  end if;

  update public.psi_agt002_initial_analysis_jobs
  set status = 'FAILED', error_code = p_error_code, lease_id = null, lease_expires_at = null, updated_at = now()
  where id = p_job_id;

  if v_workflow_instance_id is not null then
    perform public.psi_append_agt002_workflow_event(
      v_workflow_instance_id, 'FAILED', null, 'system', 'SYSTEM',
      'INITIAL_ANALYSIS_WORKFLOW', 'production', '{}'::jsonb,
      jsonb_build_object('error_code', p_error_code), null, null,
      v_job.idempotency_key || ':workflow-failed'
    );
  end if;

  return jsonb_build_object('status', 'unavailable', 'job_id', p_job_id, 'error_code', p_error_code);
end;
$$;

revoke all on function public.psi_fail_agt002_initial_analysis_job(uuid, uuid, integer, text) from public, authenticated, anon, service_role;
grant execute on function public.psi_fail_agt002_initial_analysis_job(uuid, uuid, integer, text) to service_role;

commit;
