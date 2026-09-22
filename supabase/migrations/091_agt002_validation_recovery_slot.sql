begin;

-- AGT-002 validation-governed recovery (migration 091): a third, still narrower
-- database-enforced audit trail plus one-way binding, layered on top of 089's
-- operator-recovery slot and 090's context-recovery slot. It targets jobs that already
-- carry a 089 operator_recovery_id AND a 090 context_recovery_id and then failed a THIRD
-- time, at exactly the automatic cap, because the engine's own output was rejected by
-- validation (material-omissions abstention policy).
--
-- resume_count/the automatic cap stay exactly at 5: this migration never assigns or
-- increments resume_count, exactly like 089/090. Every 068/079/081/089/090 function/RPC/
-- grant is left byte-for-byte untouched except for the jobs guard trigger function, which
-- is replaced in place (same name) to additionally recognize validation_recovery_id while
-- preserving every existing operator_recovery_id/context_recovery_id rule.
--
-- Adds:
--   * public.psi_agt002_validation_recoveries -- one immutable, append-only row per
--     validation-recovered job (job_id unique). Unlike 089/090, RLS is both enabled AND
--     forced, and no policy is ever created for any role. Whether the granted SELECT is
--     actually reachable depends entirely on whether service_role carries BYPASSRLS in the
--     deployed database (see the RLS comment below); no role is ever granted DML or EXECUTE.
--     Two of this table's columns -- attested_rejected_output_hash and
--     attested_validation_code -- are the authorizing admin/operator's manual attestation,
--     taken from their own trusted external journal (e.g. the engine's rejection log), and
--     are NOT verified by this migration against any persisted validator output; see the
--     comment above those columns.
--   * psi_agt002_reanalysis_jobs.validation_recovery_id -- nullable, unique FK to the audit
--     table, plus an extended jobs guard trigger that only ever lets it move null -> a
--     real, same-job audit row exactly once, only during an unavailable -> queued
--     transition already at the automatic cap where the job's existing operator_recovery_id
--     AND context_recovery_id both stay non-null and unchanged, and that requires that
--     every at-cap unavailable -> queued transition bind exactly one of
--     operator_recovery_id/context_recovery_id/validation_recovery_id.
--   * public.psi_authorize_agt002_validation_recovery(uuid, uuid, integer, text, text, text)
--     -- the owner-only SECURITY DEFINER function that re-verifies every precondition and
--     performs the one audited requeue. Reachable by NO role: not even service_role. Its
--     INSERT into the forced-RLS audit table above only succeeds if the role that owns this
--     function (whoever deploys this migration) carries BYPASSRLS -- a deploy prerequisite,
--     documented where the INSERT happens, not a guarantee this migration can itself enforce.
--     Before taking the canonical agt002 lock, it also takes the same
--     pg_advisory_xact_lock(hashtext('psi_agt002_reanalysis_jobs:' || opportunity_id)) that
--     psi_create_agt002_reanalysis_job (068/081) takes, in that order; see the comment at
--     the lock site.

create table public.psi_agt002_validation_recoveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.psi_agt002_reanalysis_jobs(id) on delete restrict,
  workset_id uuid not null references public.psi_agt002_analysis_worksets(id) on delete restrict,
  completed_batch_count integer not null check (completed_batch_count > 0),
  source_context_hash text not null check (source_context_hash ~ '^[0-9a-f]{64}$'),
  -- attestation_kind/attested_rejected_output_hash/attested_validation_code are the
  -- authorizing admin/operator's manual attestation, taken from their own trusted external
  -- journal (e.g. the engine's rejection log) -- NOT verified by this migration, or by
  -- psi_authorize_agt002_validation_recovery below, against any persisted validator output:
  -- no such persisted record of the rejected engine output exists in this database to check
  -- against. The CHECK constraints below only constrain shape/format (a fixed literal for
  -- attestation_kind/attested_validation_code, 64 lowercase hex chars for
  -- attested_rejected_output_hash). Any other syntactically valid 64-hex string supplied by
  -- the admin would be accepted and recorded exactly the same way, as that admin's
  -- attestation -- this column proves an admin attested to a hash, not that the hash matches
  -- any specific rejected output.
  attestation_kind text not null
    constraint psi_agt002_validation_recoveries_attestation_kind_check check (attestation_kind = 'manual_operator_attestation'),
  attested_rejected_output_hash text not null check (attested_rejected_output_hash ~ '^[0-9a-f]{64}$'),
  attested_validation_code text not null
    constraint psi_agt002_validation_recoveries_attested_validation_code_check check (attested_validation_code = 'v3_material_omissions_abstention_required'),
  repair_commit_sha text not null check (repair_commit_sha ~ '^[0-9a-f]{40}$'),
  reason_code text not null
    constraint psi_agt002_validation_recoveries_reason_code_check check (reason_code = 'manually_attested_material_omissions_abstention_policy_v6'),
  authorized_by text not null check (btrim(authorized_by) <> ''),
  authorized_at timestamptz not null default now()
);

-- Append-only against ordinary UPDATE/DELETE: this trigger blocks every such statement,
-- regardless of role. It cannot and does not claim to bind the database owner or a schema
-- alteration (DROP/DISABLE TRIGGER, ALTER TABLE, etc.) -- that remains the explicit, trusted
-- administrative boundary outside the reach of any in-database guard.
create function public.psi_agt002_validation_recoveries_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_validation_recoveries is append-only: UPDATE and DELETE are prohibited' using errcode = '55000';
end;
$$;

create trigger psi_agt002_validation_recoveries_immutable
  before update or delete on public.psi_agt002_validation_recoveries
  for each row execute function public.psi_agt002_validation_recoveries_prevent_mutation();

-- Stricter than 089/090: RLS is enabled AND forced, and no policy is ever created for any
-- role. RLS -- FORCE ROW LEVEL SECURITY included -- never applies to a role that carries the
-- BYPASSRLS attribute, regardless of policies. So whether the GRANT SELECT below is actually
-- reachable is conditional on deployment, not universal:
--   * if the production service_role has BYPASSRLS (Supabase's default service_role does),
--     RLS does not apply to it at all, and it CAN read rows via direct SELECT despite RLS
--     being forced and no policy existing;
--   * if service_role does NOT have BYPASSRLS, FORCE RLS applies, no policy permits
--     anything, and the GRANT SELECT is inert -- no role can read a row via direct query.
-- Either way, no role is ever granted INSERT/UPDATE/DELETE here, and the owner-only
-- SECURITY DEFINER function below has EXECUTE revoked from every role including
-- service_role, so no role can reach it as an RPC regardless of BYPASSRLS.
alter table public.psi_agt002_validation_recoveries enable row level security;
alter table public.psi_agt002_validation_recoveries force row level security;
revoke all on table public.psi_agt002_validation_recoveries from public, anon, authenticated, service_role;
grant select on table public.psi_agt002_validation_recoveries to service_role;

-- Nullable, unique, one-way binding: a job that was never validation-recovered keeps this null.
alter table public.psi_agt002_reanalysis_jobs
  add column validation_recovery_id uuid unique references public.psi_agt002_validation_recoveries(id) on delete restrict;

-- Guard: extends the 089/090 job guard in place. Every existing operator_recovery_id and
-- context_recovery_id rule is preserved unchanged. validation_recovery_id gains the
-- analogous null -> real-audit-once rule, gated to an unavailable -> queued transition at
-- exactly the automatic cap where the job's own operator_recovery_id AND context_recovery_id
-- are already set and stay unchanged (validation recovery is always a THIRD recovery,
-- layered on top of an existing 089 operator recovery and 090 context recovery). Any at-cap
-- unavailable -> queued transition must bind exactly one of the three recovery ids in the
-- same statement -- never zero, never two, never three.
create or replace function public.psi_agt002_reanalysis_jobs_guard_operator_recovery()
returns trigger language plpgsql as $$
declare
  v_operator_audit public.psi_agt002_operator_recoveries%rowtype;
  v_context_audit public.psi_agt002_context_recoveries%rowtype;
  v_validation_audit public.psi_agt002_validation_recoveries%rowtype;
  v_operator_bound boolean;
  v_context_bound boolean;
  v_validation_bound boolean;
begin
  if old.operator_recovery_id is not null and new.operator_recovery_id is distinct from old.operator_recovery_id then
    raise exception 'operator_recovery_id es inmutable una vez fijado' using errcode = '55000';
  end if;

  if old.context_recovery_id is not null and new.context_recovery_id is distinct from old.context_recovery_id then
    raise exception 'context_recovery_id es inmutable una vez fijado' using errcode = '55000';
  end if;

  if old.validation_recovery_id is not null and new.validation_recovery_id is distinct from old.validation_recovery_id then
    raise exception 'validation_recovery_id es inmutable una vez fijado' using errcode = '55000';
  end if;

  v_operator_bound := old.operator_recovery_id is null and new.operator_recovery_id is not null;
  v_context_bound := old.context_recovery_id is null and new.context_recovery_id is not null;
  v_validation_bound := old.validation_recovery_id is null and new.validation_recovery_id is not null;

  if new.operator_recovery_id is distinct from old.operator_recovery_id then
    if not v_operator_bound then
      raise exception 'operator_recovery_id sólo puede pasar de null a un valor real, una única vez' using errcode = '55000';
    end if;
    select * into v_operator_audit from public.psi_agt002_operator_recoveries where id = new.operator_recovery_id;
    if not found or v_operator_audit.job_id is distinct from new.id then
      raise exception 'operator_recovery_id no pertenece a este job' using errcode = '55000';
    end if;
    if not (old.status = 'unavailable' and old.resume_count >= 5 and new.status = 'queued') then
      raise exception 'la vinculación de operator_recovery_id sólo aplica a una transición unavailable -> queued en el tope automático' using errcode = '55000';
    end if;
  end if;

  if new.context_recovery_id is distinct from old.context_recovery_id then
    if not v_context_bound then
      raise exception 'context_recovery_id sólo puede pasar de null a un valor real, una única vez' using errcode = '55000';
    end if;
    select * into v_context_audit from public.psi_agt002_context_recoveries where id = new.context_recovery_id;
    if not found or v_context_audit.job_id is distinct from new.id then
      raise exception 'context_recovery_id no pertenece a este job' using errcode = '55000';
    end if;
    if not (old.status = 'unavailable' and old.resume_count = 5 and new.status = 'queued') then
      raise exception 'la vinculación de context_recovery_id sólo aplica a una transición unavailable -> queued en el tope automático' using errcode = '55000';
    end if;
    if old.operator_recovery_id is null or new.operator_recovery_id is distinct from old.operator_recovery_id then
      raise exception 'la vinculación de context_recovery_id exige un operator_recovery_id (089) ya fijado y sin cambios' using errcode = '55000';
    end if;
  end if;

  if new.validation_recovery_id is distinct from old.validation_recovery_id then
    if not v_validation_bound then
      raise exception 'validation_recovery_id sólo puede pasar de null a un valor real, una única vez' using errcode = '55000';
    end if;
    select * into v_validation_audit from public.psi_agt002_validation_recoveries where id = new.validation_recovery_id;
    if not found or v_validation_audit.job_id is distinct from new.id then
      raise exception 'validation_recovery_id no pertenece a este job' using errcode = '55000';
    end if;
    if not (old.status = 'unavailable' and old.resume_count = 5 and new.status = 'queued') then
      raise exception 'la vinculación de validation_recovery_id sólo aplica a una transición unavailable -> queued en el tope automático' using errcode = '55000';
    end if;
    if old.operator_recovery_id is null or new.operator_recovery_id is distinct from old.operator_recovery_id then
      raise exception 'la vinculación de validation_recovery_id exige un operator_recovery_id (089) ya fijado y sin cambios' using errcode = '55000';
    end if;
    if old.context_recovery_id is null or new.context_recovery_id is distinct from old.context_recovery_id then
      raise exception 'la vinculación de validation_recovery_id exige un context_recovery_id (090) ya fijado y sin cambios' using errcode = '55000';
    end if;
  end if;

  if new.status = 'queued' and old.status = 'unavailable' and old.resume_count >= 5 then
    if (v_operator_bound::int + v_context_bound::int + v_validation_bound::int) is distinct from 1 then
      raise exception 'un requeue en el tope automático exige vincular exactamente uno de operator_recovery_id, context_recovery_id o validation_recovery_id en la misma sentencia' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

-- The owner-only SECURITY DEFINER function: a direct database-owner/admin action, never an
-- application RPC surface. Re-verifies every precondition itself, then inserts the one audit
-- row and requeues the job in the same transaction.
--
-- Deploy prerequisite, not a universal guarantee: psi_agt002_validation_recoveries has RLS
-- both enabled and forced (above) with no policy, so its INSERT below only succeeds if the
-- role that owns this function -- i.e. whichever role runs/owns this migration -- itself
-- carries BYPASSRLS. That is true for a Postgres superuser (e.g. Supabase's default
-- migration/owner role) but is not guaranteed by anything in this file; deploying this
-- migration as an owner role without BYPASSRLS would make every call to this function fail
-- at the INSERT.
--
-- p_attested_rejected_output_hash is the admin/operator's manual attestation of the engine
-- output hash that validation rejected, taken from their own trusted external journal -- see
-- the column comment on psi_agt002_validation_recoveries.attested_rejected_output_hash. This
-- function only checks its syntactic shape (64 lowercase hex chars); it is never compared
-- against any persisted validator output, because no such record exists in this database.
create function public.psi_authorize_agt002_validation_recovery(
  p_job_id uuid,
  p_workset_id uuid,
  p_expected_completed_batch_count integer,
  p_expected_context_hash text,
  p_attested_rejected_output_hash text,
  p_repair_commit_sha text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_workset public.psi_agt002_analysis_worksets%rowtype;
  v_context public.psi_agt002_context_versions%rowtype;
  v_operator_audit public.psi_agt002_operator_recoveries%rowtype;
  v_context_audit public.psi_agt002_context_recoveries%rowtype;
  v_authorized_by text;
  v_recovery_id uuid;
  v_batch_count integer;
  v_max_batch_index integer;
  v_manifest_count integer;
begin
  if p_repair_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'repair_commit_sha inválido: se requieren 40 caracteres hexadecimales en minúscula' using errcode = '22023';
  end if;
  if p_expected_context_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'expected_context_hash inválido: se requieren 64 caracteres hexadecimales en minúscula' using errcode = '22023';
  end if;
  if p_attested_rejected_output_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'attested_rejected_output_hash inválido: se requieren 64 caracteres hexadecimales en minúscula' using errcode = '22023';
  end if;
  if p_expected_completed_batch_count is null or p_expected_completed_batch_count <= 0 then
    raise exception 'expected_completed_batch_count debe ser un entero positivo' using errcode = '22023';
  end if;

  select * into v_job from public.psi_agt002_reanalysis_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job % no encontrado', p_job_id using errcode = 'P0002';
  end if;

  if v_job.status is distinct from 'unavailable' then
    raise exception 'job % no está en estado unavailable', p_job_id using errcode = '55000';
  end if;
  if v_job.error_code is distinct from 'invalid_output' then
    raise exception 'job % no falló por invalid_output', p_job_id using errcode = '55000';
  end if;
  if v_job.error_message is distinct from 'El resultado del motor no superó la validación.' then
    raise exception 'job % no tiene el mensaje de error esperado', p_job_id using errcode = '55000';
  end if;
  if v_job.execution_mode is distinct from 'durable_batched_v1' then
    raise exception 'job % no es durable_batched_v1', p_job_id using errcode = '55000';
  end if;
  if v_job.phase is distinct from 'semantic_discovery' then
    raise exception 'job % no está en la fase semantic_discovery', p_job_id using errcode = '55000';
  end if;
  if v_job.resume_count is distinct from 5 then
    raise exception 'job % no está en el tope automático de reintentos (debe ser 5)', p_job_id using errcode = '55000';
  end if;
  if v_job.lease_id is not null then
    raise exception 'job % todavía retiene una reserva activa', p_job_id using errcode = '55000';
  end if;
  if v_job.analysis_run_id is not null then
    raise exception 'job % ya tiene una ejecución canónica asociada', p_job_id using errcode = '55000';
  end if;
  if v_job.operator_recovery_id is null then
    raise exception 'job % no cuenta con una recuperación de operador (089) previa', p_job_id using errcode = '55000';
  end if;
  if v_job.context_recovery_id is null then
    raise exception 'job % no cuenta con una recuperación de contexto (090) previa', p_job_id using errcode = '55000';
  end if;
  if v_job.validation_recovery_id is not null then
    raise exception 'job % ya fue recuperado por validación (validation_recovery_id ya está fijado)', p_job_id using errcode = '55000';
  end if;
  if v_job.completed_batch_count is distinct from p_expected_completed_batch_count
     or v_job.total_batch_count is distinct from p_expected_completed_batch_count then
    raise exception 'completed_batch_count y total_batch_count deben ser exactamente iguales al valor esperado' using errcode = '55000';
  end if;

  select * into v_operator_audit from public.psi_agt002_operator_recoveries where id = v_job.operator_recovery_id;
  if not found or v_operator_audit.job_id is distinct from v_job.id then
    raise exception 'job % tiene una recuperación de operador (089) inválida', p_job_id using errcode = '55000';
  end if;

  select * into v_context_audit from public.psi_agt002_context_recoveries where id = v_job.context_recovery_id;
  if not found or v_context_audit.job_id is distinct from v_job.id then
    raise exception 'job % tiene una recuperación de contexto (090) inválida', p_job_id using errcode = '55000';
  end if;
  if v_context_audit.workset_id is distinct from p_workset_id then
    raise exception 'la recuperación de contexto (090) no corresponde al workset esperado' using errcode = '55000';
  end if;
  if v_context_audit.source_context_hash is distinct from p_expected_context_hash then
    raise exception 'la recuperación de contexto (090) no corresponde al hash de contexto esperado' using errcode = '55000';
  end if;

  select * into v_workset from public.psi_agt002_analysis_worksets where id = p_workset_id for update;
  if not found then
    raise exception 'workset % no existe', p_workset_id using errcode = 'P0002';
  end if;
  if v_workset.idempotency_key is distinct from v_job.idempotency_key then
    raise exception 'el workset no corresponde a la identidad (idempotency_key) del job' using errcode = '22023';
  end if;
  if v_workset.opportunity_id is distinct from v_job.opportunity_id
     or v_workset.tender_id is distinct from v_job.tender_id
     or v_workset.snapshot_id is distinct from v_job.snapshot_id
     or v_workset.context_version_id is distinct from v_job.context_version_id then
    raise exception 'el workset no corresponde a la identidad (opportunity/tender/snapshot/context_version) del job' using errcode = '22023';
  end if;
  if v_workset.published is true then
    raise exception 'el workset ya está publicado' using errcode = '55000';
  end if;
  if v_workset.published_analysis_run_id is not null then
    raise exception 'el workset ya tiene una ejecución publicada asociada' using errcode = '55000';
  end if;
  if v_workset.archived_at is not null then
    raise exception 'el workset está archivado' using errcode = '55000';
  end if;

  select count(*), max(batch_index) into v_batch_count, v_max_batch_index
  from public.psi_agt002_analysis_checkpoints
  where workset_id = p_workset_id and stage = 'semantic_discovery_batch';
  if v_batch_count is distinct from (p_expected_completed_batch_count - 1) then
    raise exception 'los checkpoints de semantic_discovery_batch no son exactamente contiguos 0..N-2' using errcode = '55000';
  end if;
  if v_batch_count > 0 and v_max_batch_index is distinct from (p_expected_completed_batch_count - 2) then
    raise exception 'los checkpoints de semantic_discovery_batch no son exactamente contiguos 0..N-2' using errcode = '55000';
  end if;

  select count(*) into v_manifest_count
  from public.psi_agt002_analysis_checkpoints
  where workset_id = p_workset_id and stage = 'semantic_manifest';
  if v_manifest_count is distinct from 1 then
    raise exception 'el workset no tiene exactamente un checkpoint semantic_manifest' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.psi_agt002_analysis_checkpoints
    where workset_id = p_workset_id and stage not in ('semantic_discovery_batch', 'semantic_manifest')
  ) then
    raise exception 'el workset tiene checkpoints fuera de semantic_discovery_batch/semantic_manifest' using errcode = '55000';
  end if;

  select * into v_context from public.psi_agt002_context_versions where id = v_job.context_version_id for share;
  if not found then
    raise exception 'la versión de contexto del job no existe' using errcode = 'P0002';
  end if;
  if v_context.opportunity_id is distinct from v_job.opportunity_id
     or v_context.tender_id is distinct from v_job.tender_id
     or v_context.snapshot_id is distinct from v_job.snapshot_id then
    raise exception 'la versión de contexto no coincide con la identidad del job' using errcode = '22023';
  end if;
  if v_context.context_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'context_hash de la versión de contexto no es un hash hexadecimal de 64 caracteres en minúscula' using errcode = '55000';
  end if;
  if v_context.context_hash is distinct from p_expected_context_hash then
    raise exception 'context_hash de la versión de contexto no coincide con expected_context_hash' using errcode = '55000';
  end if;
  if (v_context.context ->> 'snapshot_id') is distinct from v_job.snapshot_id::text then
    raise exception 'context.snapshot_id no coincide con el snapshot_id del job' using errcode = '55000';
  end if;

  if jsonb_typeof(v_context.context -> 'context_version') is distinct from 'number' then
    raise exception 'context.context_version debe ser numérico' using errcode = '55000';
  end if;
  if (v_context.context ->> 'context_version')::numeric is distinct from 2 then
    raise exception 'context.context_version debe ser igual a 2' using errcode = '55000';
  end if;
  if jsonb_typeof(v_context.context -> 'opportunity') is distinct from 'object'
     or jsonb_typeof(v_context.context -> 'company_dossier') is distinct from 'object'
     or jsonb_typeof(v_context.context -> 'commercial_context') is distinct from 'object' then
    raise exception 'context debe tener opportunity/company_dossier/commercial_context como objetos' using errcode = '55000';
  end if;
  if jsonb_typeof(v_context.context -> 'human_evidence') is distinct from 'array' then
    raise exception 'context.human_evidence debe ser un arreglo' using errcode = '55000';
  end if;

  if jsonb_typeof(v_job.frozen_engine_input -> 'analysis_context') is distinct from 'object' then
    raise exception 'el analysis_context congelado del job debe ser un objeto estructurado' using errcode = '55000';
  end if;
  if (v_job.frozen_engine_input -> 'analysis_context') ? 'contextV2Sections' then
    raise exception 'el analysis_context congelado del job ya contiene contextV2Sections' using errcode = '55000';
  end if;
  if (v_job.frozen_engine_input #>> '{analysis_flags,AGT002_CONTEXT_V2}') is distinct from 'true' then
    raise exception 'el job no requiere AGT002_CONTEXT_V2' using errcode = '55000';
  end if;

  -- Lock order: the normal job-creation lock first, then the canonical lock, matching the
  -- order every other agt002 canonical-mutation path in this schema already uses when it
  -- also needs the creation lock. This is the exact same lock
  -- psi_create_agt002_reanalysis_job (068/081) takes -- same key string, same hashtext(),
  -- not hashtextextended() -- so this authorization serializes against an ordinary,
  -- concurrent create-job attempt for the same opportunity, not just against other
  -- canonical-lock holders.
  perform pg_advisory_xact_lock(hashtext('psi_agt002_reanalysis_jobs:' || v_job.opportunity_id::text));
  perform pg_advisory_xact_lock(hashtextextended('agt002-canonical:' || v_job.opportunity_id::text, 0));

  if exists (select 1 from public.psi_tender_analysis_runs where idempotency_key = v_job.idempotency_key) then
    raise exception 'ya existe una ejecución de análisis con esta idempotency_key' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.psi_agt002_reanalysis_jobs
    where opportunity_id = v_job.opportunity_id and id <> v_job.id and status in ('queued', 'running')
  ) then
    raise exception 'existe otro trabajo activo (queued/running) para la oportunidad' using errcode = '55000';
  end if;

  v_authorized_by := session_user;

  -- This INSERT is the point documented above the function/table where forced RLS applies:
  -- it only succeeds if this function's owner role carries BYPASSRLS.
  insert into public.psi_agt002_validation_recoveries
    (job_id, workset_id, completed_batch_count, source_context_hash, attestation_kind,
     attested_rejected_output_hash, attested_validation_code, repair_commit_sha, reason_code, authorized_by)
  values
    (v_job.id, p_workset_id, p_expected_completed_batch_count, p_expected_context_hash, 'manual_operator_attestation',
     p_attested_rejected_output_hash, 'v3_material_omissions_abstention_required', p_repair_commit_sha,
     'manually_attested_material_omissions_abstention_policy_v6', v_authorized_by)
  returning id into v_recovery_id;

  update public.psi_agt002_reanalysis_jobs set
    status = 'queued',
    error_code = null,
    error_message = null,
    completed_at = null,
    lease_id = null,
    lease_expires_at = null,
    validation_recovery_id = v_recovery_id,
    updated_at = now()
  where id = v_job.id;

  return jsonb_build_object(
    'job_id', v_job.id, 'workset_id', p_workset_id, 'validation_recovery_id', v_recovery_id,
    'status', 'queued', 'resume_count', v_job.resume_count,
    'completed_batch_count', v_job.completed_batch_count, 'total_batch_count', v_job.total_batch_count
  );
end;
$$;

revoke all on function public.psi_authorize_agt002_validation_recovery(uuid, uuid, integer, text, text, text) from public;
revoke all on function public.psi_authorize_agt002_validation_recovery(uuid, uuid, integer, text, text, text) from anon;
revoke all on function public.psi_authorize_agt002_validation_recovery(uuid, uuid, integer, text, text, text) from authenticated;
revoke all on function public.psi_authorize_agt002_validation_recovery(uuid, uuid, integer, text, text, text) from service_role;

commit;
