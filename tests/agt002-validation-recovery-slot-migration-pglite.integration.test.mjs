// AGT-002 validation-recovery — PGlite integration.
//
// Migration 091 layers a THIRD, still narrower database-enforced audit trail + one-way
// binding on top of 089's operator-recovery slot (see tests/agt002-operator-recovery-slot-
// migration-pglite.integration.test.mjs) and 090's context-recovery slot (see
// tests/agt002-context-recovery-slot-migration-pglite.integration.test.mjs), whose setup
// patterns this file reuses/extends in miniature. It targets jobs that already carry a real
// 089 operator_recovery_id AND a real 090 context_recovery_id and then failed a THIRD time,
// at exactly the automatic cap, because the engine's own output was rejected by validation
// (material-omissions abstention policy). The audit row's attestation_kind/
// attested_rejected_output_hash/attested_validation_code columns record the authorizing
// admin/operator's own manual attestation, taken from their trusted external journal (e.g.
// the engine's rejection log) -- this suite never treats them as, and the migration never
// checks them against, a persisted, DB-verified validator record: no such record of the
// rejected engine output exists in this database.
//
// Exercised against a real PostgreSQL engine (PGlite), built up through the real, unmodified
// migration chain (050/051/053/056/063/067/068/076/077/028/079/081/089/090/091) that already
// governs psi_agt002_reanalysis_jobs / psi_agt002_analysis_worksets /
// psi_agt002_analysis_checkpoints / psi_agt002_context_versions in production, so the
// precondition state this suite drives a job into — unavailable, error_code=invalid_output,
// durable_batched_v1, resume_count=5, 64/64 (63 contiguous semantic_discovery_batch
// checkpoints + exactly one semantic_manifest checkpoint), a real prior 089 operator
// recovery, a real prior 090 context recovery, and a governed context version whose root
// shape and exact context_hash the authorize call must reproduce — is reached the same way
// the real system reaches it: through the real 068/081/089/090 RPCs, never a hand-faked row.
//
// All ids/content below are synthetic; no real expediente.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migrationSource = name => strip(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));

const migration050 = migrationSource('050_agt002_canonical_analysis.sql');
const migration051 = migrationSource('051_agt002_context_versions.sql');
const migration053 = migrationSource('053_agt002_legal_corpus.sql');
const migration056 = migrationSource('056_agt002_legal_corpus_publication_gate.sql');
const migration063 = migrationSource('063_agt002_canonical_promotion.sql');
const migration067 = migrationSource('067_agt002_integral_v3_persistence.sql');
const migration068 = migrationSource('068_agt002_reanalysis_jobs.sql');
const migration028 = migrationSource('028_agt002_preview_claims.sql');
const migration076 = migrationSource('076_agt002_canonical_lock_contention_fix.sql');
const migration077 = migrationSource('077_agt002_canonical_persistence_statement_timeout.sql');
const migration079 = migrationSource('079_agt002_lease_heartbeat.sql');
const migration081 = migrationSource('081_agt002_durable_batched_analysis.sql');
const migration089 = migrationSource('089_agt002_operator_recovery_slot.sql');
const migration090 = migrationSource('090_agt002_context_recovery_slot.sql');
const migration091 = migrationSource('091_agt002_validation_recovery_slot.sql');
const rollback091 = strip(readFileSync(new URL('../supabase/rollbacks/091_agt002_validation_recovery_slot_rollback.sql', import.meta.url), 'utf8'));

const P = '44444444-4444-4444-8444-444444444444';
const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

const DEFECT_SHA = 'deadbeef'.repeat(5); // 089's own defect_commit_sha: 40 lowercase hex characters
const REPAIR_SHA_090 = 'cafebabe'.repeat(5); // 090's own repair_commit_sha: 40 lowercase hex characters
const REPAIR_SHA_091 = 'abcdef01'.repeat(5); // 091's own repair_commit_sha: 40 lowercase hex characters, distinct from 089/090
const VALID_CONTEXT_HASH = 'a1b2c3d4'.repeat(8); // 64 lowercase hex characters
const MISMATCHED_CONTEXT_HASH = 'f9e8d7c6'.repeat(8); // 64 lowercase hex characters, distinct from VALID_CONTEXT_HASH
const ATTESTED_REJECTED_OUTPUT_HASH = '13579bdf'.repeat(8); // 64 lowercase hex characters — the admin's manual attestation of the engine's rejected output, from their own trusted external journal; never DB-verified against any persisted validator record
const ALTERNATE_ATTESTED_REJECTED_OUTPUT_HASH = '2468ace0'.repeat(8); // a different, equally well-formed 64 lowercase hex attestation — proves any syntactically valid hash is accepted and recorded verbatim as the admin's attestation, not compared against a specific expected value
const MALFORMED_HASH = 'zz'.repeat(32); // 64 characters, not hex

const TOTAL_BATCH_COUNT = 64; // N: 63 discovery batches + 1 manifest = 64/64

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function callRpc(pg, name, params) {
  const args = Object.values(params).map(sqlLiteral).join(',');
  const result = await pg.query(`select public.${name}(${args}) as data`);
  return result.rows[0]?.data ?? null;
}

async function tryRun(promise) {
  try {
    return { data: await promise, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

async function createDatabase({ withMigration091 = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', full_name text, role text not null default 'admin');
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key);
    create table public.psi_tender_document_snapshots (id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id));
    create table public.psi_tender_analysis_runs (
      id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.psi_tender_document_snapshots(id),
      opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id),
      producer text not null, method text not null, status text not null, result jsonb, critical_open_count integer not null default 0,
      idempotency_key text not null unique, schema_version text not null, policy_version text not null, model text, usage jsonb,
      created_at timestamptz not null default now(), completed_at timestamptz
    );
    alter table public.psi_tender_analysis_runs enable row level security;
    grant select on public.psi_tender_analysis_runs to service_role;
    create or replace function public.psi_tender_analysis_runs_prevent_mutation()
    returns trigger language plpgsql as $$
    begin
      raise exception 'psi_tender_analysis_runs is append-only: UPDATE and DELETE are prohibited';
    end;
    $$;
    create trigger psi_tender_analysis_runs_immutable
      before update or delete on public.psi_tender_analysis_runs
      for each row execute function public.psi_tender_analysis_runs_prevent_mutation();
    insert into public.psi_sales_profiles values ('${P}', true, 'human', 'Ana Revisora', 'admin');
    insert into public.psi_sales_opportunities values ('${O}');
    insert into public.psi_public_tenders values ('${T}');
    insert into public.psi_tender_document_snapshots values ('${S}','${O}','${T}');
  `);
  await pg.exec(migration050);
  await pg.exec(migration051);
  await pg.exec(migration053);
  await pg.exec(migration056);
  await pg.exec(migration063);
  await pg.exec(migration067);
  await pg.exec(migration068);
  await pg.exec(migration076);
  await pg.exec(migration077);
  await pg.exec(migration028);
  await pg.exec(migration079);
  await pg.exec(migration081);
  await pg.exec(migration089);
  await pg.exec(migration090);
  if (withMigration091) await pg.exec(migration091);
  return pg;
}

function frozenIdentity(overrides = {}) {
  return {
    model: 'test-model', reasoning_effort: 'medium', v3_policy_version: 'v3-policy-1',
    discovery_policy_version: 'discovery-policy-1', analysis_batch_policy_version: 'analysis-batch-policy-1',
    inventory_hash: 'a'.repeat(64), snapshot_hash: 'b'.repeat(64), frozen_engine_input_hash: 'c'.repeat(64),
    company_evidence_identity: 'evidence-v1', legal_corpus_identity: 'corpus-v1',
    ...overrides,
  };
}

function buildFrozenEngineInput({ analysisContext = { note: 'legacy synthetic context' }, flags = { AGT002_CONTEXT_V2: true } } = {}) {
  return { manifest: 'synthetic', analysis_context: analysisContext, analysis_flags: flags };
}

async function createContextVersion(pg, {
  opportunityId = O, tenderId = T, snapshotId = S, idempotencyKey,
  contextHash = VALID_CONTEXT_HASH,
} = {}) {
  const context = {
    context_version: 2, snapshot_id: snapshotId, opportunity: {}, company_dossier: {}, commercial_context: {}, human_evidence: [],
  };
  const result = await callRpc(pg, 'psi_record_agt002_context_version', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_snapshot_id: snapshotId, p_context_version: 2,
    p_context: context, p_context_hash: contextHash, p_human_evidence_count: 0,
    p_idempotency_key: idempotencyKey, p_actor_id: P,
  });
  return result.id;
}

function authorizeOperatorRecovery(pg, { jobId, worksetId, expectedCompletedBatchCount, defectCommitSha = DEFECT_SHA }) {
  return callRpc(pg, 'psi_authorize_agt002_operator_recovery', {
    p_job_id: jobId, p_workset_id: worksetId, p_expected_completed_batch_count: expectedCompletedBatchCount, p_defect_commit_sha: defectCommitSha,
  });
}

function authorizeContextRecovery(pg, {
  jobId, worksetId, expectedCompletedBatchCount, contextHash = VALID_CONTEXT_HASH, repairCommitSha = REPAIR_SHA_090,
}) {
  return callRpc(pg, 'psi_authorize_agt002_context_recovery', {
    p_job_id: jobId, p_workset_id: worksetId, p_expected_completed_batch_count: expectedCompletedBatchCount,
    p_expected_context_hash: contextHash, p_repair_commit_sha: repairCommitSha,
  });
}

function authorizeValidationRecovery(pg, {
  jobId, worksetId, expectedCompletedBatchCount, contextHash = VALID_CONTEXT_HASH,
  attestedRejectedOutputHash = ATTESTED_REJECTED_OUTPUT_HASH, repairCommitSha = REPAIR_SHA_091,
}) {
  return callRpc(pg, 'psi_authorize_agt002_validation_recovery', {
    p_job_id: jobId, p_workset_id: worksetId, p_expected_completed_batch_count: expectedCompletedBatchCount,
    p_expected_context_hash: contextHash, p_attested_rejected_output_hash: attestedRejectedOutputHash, p_repair_commit_sha: repairCommitSha,
  });
}

async function jobRow(pg, jobId) {
  return (await pg.query(
    `select * from public.psi_agt002_reanalysis_jobs where id = '${jobId}'`,
  )).rows[0];
}

// Direct default-connection reads bypass RLS (the bootstrap PGlite role is a superuser, which
// always bypasses row security regardless of FORCE), exactly like a trusted admin/migration
// session would in production. This is deliberately NOT how service_role sees the table — see
// the dedicated RLS test below, which switches role first.
async function validationAuditRows(pg, jobId) {
  return (await pg.query(`select * from public.psi_agt002_validation_recoveries where job_id = '${jobId}'`)).rows;
}

async function validationAuditCount(pg) {
  return (await pg.query(`select count(*)::int n from public.psi_agt002_validation_recoveries`)).rows[0].n;
}

async function insertRawValidationRecovery(pg, {
  jobId, worksetId, completedBatchCount = 1, sourceContextHash = VALID_CONTEXT_HASH,
  attestedRejectedOutputHash = ATTESTED_REJECTED_OUTPUT_HASH, repairCommitSha = REPAIR_SHA_091, authorizedBy = 'raw-test-insert',
}) {
  const result = await pg.query(
    `insert into public.psi_agt002_validation_recoveries
       (job_id, workset_id, completed_batch_count, source_context_hash, attestation_kind, attested_rejected_output_hash, attested_validation_code, repair_commit_sha, reason_code, authorized_by)
     values
       ('${jobId}', '${worksetId}', ${completedBatchCount}, '${sourceContextHash}', 'manual_operator_attestation', '${attestedRejectedOutputHash}',
        'v3_material_omissions_abstention_required', '${repairCommitSha}', 'manually_attested_material_omissions_abstention_policy_v6', '${authorizedBy}')
     returning id`,
  );
  return result.rows[0].id;
}

async function insertRawContextRecovery(pg, {
  jobId, worksetId, completedBatchCount = 1, sourceContextHash = VALID_CONTEXT_HASH,
  repairCommitSha = REPAIR_SHA_090, authorizedBy = 'raw-test-insert',
}) {
  const result = await pg.query(
    `insert into public.psi_agt002_context_recoveries
       (job_id, workset_id, completed_batch_count, repair_commit_sha, source_context_hash, reason_code, authorized_by)
     values
       ('${jobId}', '${worksetId}', ${completedBatchCount}, '${repairCommitSha}', '${sourceContextHash}',
        'rehydrated_legacy_context_v2_sections', '${authorizedBy}')
     returning id`,
  );
  return result.rows[0].id;
}

/** Drives a real job through: creation -> claim -> 63 contiguous semantic-discovery-batch
 * checkpoints -> 5 automatic reclaim cycles -> terminal failure (timeout) -> a real 089
 * operator recovery -> a fresh claim -> the semantic_manifest checkpoint (completing exactly
 * 64/64) -> a SECOND terminal failure (invalid_output) — the exact documented 090 precondition,
 * with context_recovery_id and validation_recovery_id both still null. Every step goes through
 * the real, unmodified 068/081/089 RPCs, never a hand-faked row. */
async function setupContextRecoverableJob(pg, {
  opportunityId = O, tenderId = T, snapshotId = S, idempotencyKey = 'val-recovery-key-1', tag = 'v1',
  totalBatchCount = TOTAL_BATCH_COUNT, contextHash = VALID_CONTEXT_HASH,
} = {}) {
  const contextVersionId = await createContextVersion(pg, {
    opportunityId, tenderId, snapshotId, idempotencyKey: `${idempotencyKey}-context`, contextHash,
  });

  const workset = await callRpc(pg, 'psi_get_or_create_agt002_analysis_workset', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_snapshot_id: snapshotId, p_context_version_id: contextVersionId,
    p_idempotency_key: idempotencyKey, p_frozen_identity: frozenIdentity(),
  });
  const job = await callRpc(pg, 'psi_create_agt002_reanalysis_job', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_snapshot_id: snapshotId, p_context_version_id: contextVersionId,
    p_idempotency_key: idempotencyKey, p_frozen_engine_input: buildFrozenEngineInput(), p_requested_by: P,
  });

  let claim = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
  assert.equal(claim.job_id, job.job_id, 'setup check: the freshly created job must be the one claimed');

  let completed = 0;
  const discoveryBatchIndexes = Array.from({ length: totalBatchCount - 1 }, (_, i) => i);
  for (const batchIndex of discoveryBatchIndexes) {
    completed += 1;
    await callRpc(pg, 'psi_record_agt002_analysis_checkpoint', {
      p_job_id: job.job_id, p_lease_id: claim.lease_id, p_workset_id: workset.workset_id,
      p_stage: 'semantic_discovery_batch', p_batch_index: batchIndex,
      p_request_hash: 'd'.repeat(64), p_stage_contract_version: 'discovery-batch-contract-v1',
      p_output: { batch_index: batchIndex, units: [] }, p_output_sha256: 'e'.repeat(64),
      p_usage: { input_tokens: 10, output_tokens: 2 }, p_provider_idempotency_key: `provider-key-${tag}-${batchIndex}`,
      p_progress_phase: 'semantic_discovery', p_completed_batch_count: completed, p_total_batch_count: totalBatchCount,
    });
  }

  // Exactly 5 expire/reclaim cycles: the real 081 automatic-reclaim path, never a hand-set
  // resume_count.
  for (let i = 0; i < 5; i += 1) {
    await pg.exec(`update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() - interval '1 hour' where id = '${job.job_id}'`);
    claim = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
    assert.equal(claim.job_id, job.job_id, `setup check: reclaim #${i + 1} must reissue the same job`);
  }
  const atCap = (await pg.query(`select resume_count, status from public.psi_agt002_reanalysis_jobs where id = '${job.job_id}'`)).rows[0];
  assert.equal(atCap.resume_count, 5, 'setup check: resume_count must be exactly at the automatic cap before the first terminal failure');

  const failedFirst = await callRpc(pg, 'psi_fail_agt002_reanalysis_job', { p_job_id: job.job_id, p_lease_id: claim.lease_id, p_error_code: 'timeout' });
  assert.equal(failedFirst.status, 'unavailable');

  const operatorOutcome = await authorizeOperatorRecovery(pg, { jobId: job.job_id, worksetId: workset.workset_id, expectedCompletedBatchCount: completed });
  assert.ok(operatorOutcome.operator_recovery_id, 'setup check: the real 089 operator recovery must succeed before this suite ever exercises 090/091');

  // Resume the real job: claim it back (resume_count stays at 5), then complete the final unit
  // of semantic-discovery work (the manifest checkpoint), reaching exactly 64/64.
  claim = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
  assert.equal(claim.job_id, job.job_id);

  completed += 1;
  await callRpc(pg, 'psi_record_agt002_analysis_checkpoint', {
    p_job_id: job.job_id, p_lease_id: claim.lease_id, p_workset_id: workset.workset_id,
    p_stage: 'semantic_manifest', p_batch_index: 0,
    p_request_hash: 'd'.repeat(64), p_stage_contract_version: 'manifest-contract-v1',
    p_output: { manifest: true }, p_output_sha256: 'e'.repeat(64),
    p_usage: { input_tokens: 5, output_tokens: 1 }, p_provider_idempotency_key: `provider-key-${tag}-manifest`,
    p_progress_phase: 'semantic_discovery', p_completed_batch_count: completed, p_total_batch_count: totalBatchCount,
  });
  assert.equal(completed, totalBatchCount, 'setup check: the job must reach exactly 64/64 before the second terminal failure');

  const failedSecond = await callRpc(pg, 'psi_fail_agt002_reanalysis_job', { p_job_id: job.job_id, p_lease_id: claim.lease_id, p_error_code: 'invalid_output' });
  assert.equal(failedSecond.status, 'unavailable');
  assert.equal(failedSecond.error_code, 'invalid_output');

  const row = await jobRow(pg, job.job_id);
  assert.equal(row.status, 'unavailable');
  assert.equal(row.error_code, 'invalid_output');
  assert.equal(row.error_message, 'El resultado del motor no superó la validación.');
  assert.equal(row.resume_count, 5, 'setup check: the second failure must never change resume_count');
  assert.equal(row.completed_batch_count, totalBatchCount);
  assert.equal(row.total_batch_count, totalBatchCount);
  assert.ok(row.operator_recovery_id, 'setup check: the real 089 operator_recovery_id must already be bound');
  assert.equal(row.context_recovery_id, null);
  if ('validation_recovery_id' in row) {
    assert.equal(row.validation_recovery_id, null);
  }

  return {
    jobId: job.job_id, worksetId: workset.workset_id, contextVersionId, idempotencyKey,
    completedBatchCount: totalBatchCount, totalBatchCount, operatorRecoveryId: row.operator_recovery_id,
  };
}

/** Extends setupContextRecoverableJob with a real 090 context recovery, then simulates the
 * worker picking the resumed job back up and immediately failing it a THIRD time with
 * invalid_output — no new checkpoint work is needed or performed, since the 64/64 checkpoint
 * history from setup is already exactly what 091 requires unchanged. Reaches the exact
 * documented 091 precondition: unavailable/invalid_output, resume_count=5, 64/64, a real 089
 * operator_recovery_id AND a real 090 context_recovery_id, validation_recovery_id still null. */
async function setupValidationRecoverableJob(pg, opts = {}) {
  const setup = await setupContextRecoverableJob(pg, opts);

  const contextOutcome = await authorizeContextRecovery(pg, {
    jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount,
  });
  assert.ok(contextOutcome.context_recovery_id, 'setup check: the real 090 context recovery must succeed before this suite ever exercises 091');

  const claim = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
  assert.equal(claim.job_id, setup.jobId);
  assert.equal(claim.resume_count, 5, 'setup check: re-claiming the context-recovered job must never change resume_count');

  const failedThird = await callRpc(pg, 'psi_fail_agt002_reanalysis_job', { p_job_id: setup.jobId, p_lease_id: claim.lease_id, p_error_code: 'invalid_output' });
  assert.equal(failedThird.status, 'unavailable');
  assert.equal(failedThird.error_code, 'invalid_output');

  const row = await jobRow(pg, setup.jobId);
  assert.equal(row.status, 'unavailable');
  assert.equal(row.error_code, 'invalid_output');
  assert.equal(row.resume_count, 5, 'setup check: the third failure must never change resume_count');
  assert.equal(row.completed_batch_count, setup.totalBatchCount);
  assert.equal(row.total_batch_count, setup.totalBatchCount);
  assert.ok(row.operator_recovery_id, 'setup check: the 089 operator_recovery_id must survive the third failure unchanged');
  assert.ok(row.context_recovery_id, 'setup check: the real 090 context_recovery_id must already be bound');
  assert.equal(row.validation_recovery_id, null);

  return { ...setup, contextRecoveryId: row.context_recovery_id };
}

test('happy path: validation-recovery authorize creates exactly one immutable audit row with exact values and requeues the job at the unchanged resume_count=5, keeping the prior 089/090 bindings', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupValidationRecoverableJob(pg);
    const outcome = await authorizeValidationRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    assert.equal(outcome.job_id, setup.jobId);
    assert.equal(outcome.status, 'queued');
    assert.equal(outcome.resume_count, 5, 'the response must report the unchanged automatic-reclaim resume_count');
    assert.ok(outcome.validation_recovery_id, 'the response must surface the new audit row id');

    const audit = await validationAuditRows(pg, setup.jobId);
    assert.equal(audit.length, 1, 'exactly one validation-recovery audit row must exist for this job');
    assert.equal(audit[0].workset_id, setup.worksetId);
    assert.equal(audit[0].completed_batch_count, setup.completedBatchCount);
    assert.equal(audit[0].source_context_hash, VALID_CONTEXT_HASH, 'the audit row must record the exact governed context_hash');
    assert.equal(audit[0].attestation_kind, 'manual_operator_attestation', 'the fixed attestation_kind must be recorded exactly: this row is the admin/operator\'s manual attestation, never a DB-verified validator record');
    assert.equal(audit[0].attested_rejected_output_hash, ATTESTED_REJECTED_OUTPUT_HASH, 'the audit row must record the caller-supplied attested rejected-output hash exactly, verbatim, as the admin\'s attestation');
    assert.equal(audit[0].attested_validation_code, 'v3_material_omissions_abstention_required', 'the fixed attested_validation_code must be recorded exactly');
    assert.equal(audit[0].reason_code, 'manually_attested_material_omissions_abstention_policy_v6', 'the fixed reason_code must be recorded exactly');
    assert.equal(audit[0].repair_commit_sha, REPAIR_SHA_091);
    assert.ok(audit[0].authorized_by, 'authorized_by must be derived server-side, never null');
    assert.ok(audit[0].authorized_at, 'authorized_at must be stamped');

    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'queued');
    assert.equal(row.error_code, null, 'the requeue must clear error_code');
    assert.equal(row.error_message, null, 'the requeue must clear error_message');
    assert.equal(row.completed_at, null, 'the requeue must clear completed_at');
    assert.equal(row.lease_id, null, 'the requeue must clear the lease');
    assert.equal(row.lease_expires_at, null);
    assert.equal(row.resume_count, 5, 'resume_count must stay exactly what automatic reclaim left it at: 091 never changes it');
    assert.equal(row.completed_batch_count, setup.completedBatchCount, 'the requeue must preserve durable progress: it is a resume, not a reset');
    assert.equal(row.total_batch_count, setup.totalBatchCount);
    assert.equal(row.operator_recovery_id, setup.operatorRecoveryId, 'the original 089 binding must survive unchanged');
    assert.equal(row.context_recovery_id, setup.contextRecoveryId, 'the original 090 binding must survive unchanged');
    assert.equal(row.validation_recovery_id, outcome.validation_recovery_id);

    const reclaimed = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
    assert.equal(reclaimed.job_id, setup.jobId, 'the validation-recovered job must be claimable again like any other queued job');
    assert.equal(reclaimed.resume_count, 5, 'claiming a recovered job must never increment resume_count past the adapter-compatible cap of 5');
  } finally {
    await pg.close();
  }
});

test('the authorize function rejects a p_expected_context_hash that does not match the governed context version, mutating nothing', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupValidationRecoverableJob(pg);

    await assert.rejects(
      authorizeValidationRecovery(pg, {
        jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount,
        contextHash: MISMATCHED_CONTEXT_HASH,
      }),
      /./,
      'a p_expected_context_hash that does not equal the governed context version (and the prior 090 audit row) must be rejected',
    );

    assert.equal(await validationAuditCount(pg), 0, 'a rejected mismatched-hash attempt must never create an audit row');
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'a rejected mismatched-hash attempt must leave the job status exactly as it was');
    assert.equal(row.error_code, 'invalid_output');
    assert.equal(row.validation_recovery_id, null);
    assert.equal(row.operator_recovery_id, setup.operatorRecoveryId, 'a rejected attempt must never disturb the prior 089 binding');
    assert.equal(row.context_recovery_id, setup.contextRecoveryId, 'a rejected attempt must never disturb the prior 090 binding');
  } finally {
    await pg.close();
  }
});

test('the authorize function rejects a malformed (non-64-hex) p_attested_rejected_output_hash before ever touching the job row', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupValidationRecoverableJob(pg);

    for (const badHash of [MALFORMED_HASH, ATTESTED_REJECTED_OUTPUT_HASH.toUpperCase(), ATTESTED_REJECTED_OUTPUT_HASH.slice(0, 63), ATTESTED_REJECTED_OUTPUT_HASH + '0']) {
      const attempt = await tryRun(authorizeValidationRecovery(pg, {
        jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount, attestedRejectedOutputHash: badHash,
      }));
      assert.ok(attempt.error, `a malformed attested_rejected_output_hash (${JSON.stringify(badHash)}) must be rejected -- shape only, since it is never checked against a persisted validator record`);
    }

    assert.equal(await validationAuditCount(pg), 0, 'no malformed attempt may ever create an audit row');
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'a rejected authorize call must leave the job exactly as it was');
    assert.equal(row.validation_recovery_id, null);
    assert.equal(row.operator_recovery_id, setup.operatorRecoveryId);
    assert.equal(row.context_recovery_id, setup.contextRecoveryId);
  } finally {
    await pg.close();
  }
});

test('the authorize function accepts a different, syntactically valid lowercase 64-hex attested_rejected_output_hash and records it verbatim as the admin\'s manual attestation -- proving this column is never checked against any specific expected value -- while a malformed hash on the same job is still rejected outright', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupValidationRecoverableJob(pg);
    assert.notEqual(
      ALTERNATE_ATTESTED_REJECTED_OUTPUT_HASH, ATTESTED_REJECTED_OUTPUT_HASH,
      'setup check: the alternate attestation hash must be a different value from the default fixture hash',
    );

    // A malformed hash must still be rejected on this same job before the real attestation call.
    const malformedAttempt = await tryRun(authorizeValidationRecovery(pg, {
      jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount,
      attestedRejectedOutputHash: MALFORMED_HASH,
    }));
    assert.ok(malformedAttempt.error, 'a malformed (non-64-hex) attested_rejected_output_hash must still be rejected');
    assert.equal(await validationAuditCount(pg), 0, 'the rejected malformed attempt must never create an audit row');

    const outcome = await authorizeValidationRecovery(pg, {
      jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount,
      attestedRejectedOutputHash: ALTERNATE_ATTESTED_REJECTED_OUTPUT_HASH,
    });
    assert.equal(outcome.status, 'queued');

    const audit = await validationAuditRows(pg, setup.jobId);
    assert.equal(audit.length, 1, 'exactly one validation-recovery audit row must exist for this job');
    assert.equal(
      audit[0].attested_rejected_output_hash, ALTERNATE_ATTESTED_REJECTED_OUTPUT_HASH,
      'a different, syntactically valid 64-hex hash must be recorded exactly as supplied -- this column proves an admin attested to a hash, not that the hash matches any specific rejected output',
    );
    assert.equal(audit[0].attestation_kind, 'manual_operator_attestation', 'the recorded row must still be the fixed manual-attestation kind, not a DB-verified validator record');
    assert.equal(audit[0].attested_validation_code, 'v3_material_omissions_abstention_required');
    assert.equal(audit[0].reason_code, 'manually_attested_material_omissions_abstention_policy_v6');

    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.validation_recovery_id, outcome.validation_recovery_id);
  } finally {
    await pg.close();
  }
});

test('a second validation-recovery attempt on the same job is rejected outright, and the audit trail stays singular', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupValidationRecoverableJob(pg);
    const first = await authorizeValidationRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    await assert.rejects(
      authorizeValidationRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount }),
      /./,
      'a second validation recovery of the same job must be rejected outright: the job is no longer unavailable, and validation_recovery_id is already set',
    );

    const afterRetry = await jobRow(pg, setup.jobId);
    assert.equal(afterRetry.status, 'queued', 'the rejected second attempt must leave the job exactly as the first (successful) recovery left it');
    assert.equal(afterRetry.validation_recovery_id, first.validation_recovery_id);
    assert.equal(afterRetry.operator_recovery_id, setup.operatorRecoveryId);
    assert.equal(afterRetry.context_recovery_id, setup.contextRecoveryId);
    assert.equal(await validationAuditCount(pg), 1, 'a rejected second attempt must never add a second audit row');
  } finally {
    await pg.close();
  }
});

test('the jobs guard trigger rejects binding validation_recovery_id to an audit row that belongs to a different job (forged transition)', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupValidationRecoverableJob(pg);

    const contextVersionB = await createContextVersion(pg, { idempotencyKey: 'forged-job-b-context-key' });
    const worksetB = await callRpc(pg, 'psi_get_or_create_agt002_analysis_workset', {
      p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version_id: contextVersionB,
      p_idempotency_key: 'forged-job-b-key', p_frozen_identity: frozenIdentity(),
    });
    const jobB = await callRpc(pg, 'psi_create_agt002_reanalysis_job', {
      p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version_id: contextVersionB,
      p_idempotency_key: 'forged-job-b-key', p_frozen_engine_input: { manifest: 'job-b' }, p_requested_by: P,
    });
    const foreignAuditId = await insertRawValidationRecovery(pg, { jobId: jobB.job_id, worksetId: worksetB.workset_id });

    await assert.rejects(
      pg.exec(
        `update public.psi_agt002_reanalysis_jobs
         set status = 'queued', error_code = null, error_message = null, completed_at = null,
             validation_recovery_id = '${foreignAuditId}'
         where id = '${setup.jobId}'`,
      ),
      /./,
      "binding job A's validation_recovery_id to job B's audit row must be rejected: the audit row does not belong to job A",
    );

    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'the rejected forged binding must leave the job exactly as it was');
    assert.equal(row.validation_recovery_id, null);
    assert.equal(row.operator_recovery_id, setup.operatorRecoveryId);
    assert.equal(row.context_recovery_id, setup.contextRecoveryId);
    assert.equal(await validationAuditCount(pg), 1, 'the forged attempt must never create/consume a second real audit row for job A');
  } finally {
    await pg.close();
  }
});

test('the jobs guard trigger rejects an at-cap requeue that binds none of the three recovery ids (missing transition)', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupValidationRecoverableJob(pg);

    await assert.rejects(
      pg.exec(
        `update public.psi_agt002_reanalysis_jobs
         set status = 'queued', error_code = null, error_message = null, completed_at = null
         where id = '${setup.jobId}'`,
      ),
      /guard|recovery|inmutable|bloque|vincular/i,
      'a bare UPDATE requeuing an at-cap job that already has operator_recovery_id and context_recovery_id set, without binding validation_recovery_id, must be rejected: exactly one of the three ids must be bound',
    );

    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'a rejected direct requeue must leave the job exactly as it was');
    assert.equal(row.validation_recovery_id, null);
    assert.equal(row.operator_recovery_id, setup.operatorRecoveryId);
    assert.equal(row.context_recovery_id, setup.contextRecoveryId);
    assert.equal(await validationAuditCount(pg), 0, 'a rejected direct requeue must never create an audit row');
  } finally {
    await pg.close();
  }
});

test('the jobs guard trigger rejects binding context_recovery_id and validation_recovery_id simultaneously in one statement (multiple transitions)', async (t) => {
  const pg = await createDatabase();
  try {
    // A job that has only cleared 089 (operator_recovery_id set) — context_recovery_id and
    // validation_recovery_id both still null — is the state right before a real 090 recovery.
    const setup = await setupContextRecoverableJob(pg, { idempotencyKey: 'val-recovery-key-multiple', tag: 'multi' });

    const rawContextId = await insertRawContextRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, completedBatchCount: setup.completedBatchCount });
    const rawValidationId = await insertRawValidationRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, completedBatchCount: setup.completedBatchCount });

    await assert.rejects(
      pg.exec(
        `update public.psi_agt002_reanalysis_jobs
         set status = 'queued', error_code = null, error_message = null, completed_at = null,
             context_recovery_id = '${rawContextId}', validation_recovery_id = '${rawValidationId}'
         where id = '${setup.jobId}'`,
      ),
      /./,
      'binding two recovery ids (context_recovery_id and validation_recovery_id) from null in the same statement must be rejected',
    );

    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'the rejected multiple-binding attempt must leave the job exactly as it was');
    assert.equal(row.context_recovery_id, null);
    assert.equal(row.validation_recovery_id, null);
    assert.equal(row.operator_recovery_id, setup.operatorRecoveryId);
  } finally {
    await pg.close();
  }
});

test("grants: service_role has SELECT (but no INSERT/UPDATE/DELETE) on the validation-recovery audit table, and no application role receives EXECUTE on the authorize function -- PGlite's non-BYPASSRLS fixture role also makes a direct SELECT return zero rows here, which is an emulator-specific RLS artifact of this fixture, not a production invariant (production service_role is BYPASSRLS, so its granted SELECT is fully effective there)", async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupValidationRecoverableJob(pg);
    const outcome = await authorizeValidationRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    assert.equal(await validationAuditCount(pg), 1, 'sanity: the privileged/admin default connection must see the real audit row');

    const privileges = (await pg.query(`
      select
        has_table_privilege('service_role', 'public.psi_agt002_validation_recoveries', 'SELECT') as can_select,
        has_table_privilege('service_role', 'public.psi_agt002_validation_recoveries', 'INSERT') as can_insert,
        has_table_privilege('service_role', 'public.psi_agt002_validation_recoveries', 'UPDATE') as can_update,
        has_table_privilege('service_role', 'public.psi_agt002_validation_recoveries', 'DELETE') as can_delete
    `)).rows[0];
    assert.equal(privileges.can_select, true, 'migration 091 must grant service_role SELECT on the validation-recovery audit table');
    assert.equal(privileges.can_insert, false, 'migration 091 must not grant service_role INSERT on the validation-recovery audit table');
    assert.equal(privileges.can_update, false, 'migration 091 must not grant service_role UPDATE on the validation-recovery audit table');
    assert.equal(privileges.can_delete, false, 'migration 091 must not grant service_role DELETE on the validation-recovery audit table');

    await pg.exec('set role service_role');
    try {
      // Emulator-specific: this PGlite fixture's service_role is not BYPASSRLS (unlike
      // production -- see agt002-operator-recovery-postgres-concurrency.integration.test.mjs,
      // whose destructive fixture runs `alter role service_role bypassrls;`), so RLS enabled AND
      // forced with no policy makes a direct SELECT return zero rows under this fixture. That is
      // an artifact of this non-BYPASSRLS emulator role, not evidence that service_role's granted
      // SELECT above is inert in production.
      const seenByServiceRole = (await pg.query('select count(*)::int n from public.psi_agt002_validation_recoveries')).rows[0].n;
      assert.equal(seenByServiceRole, 0, "emulator-specific: this fixture's non-BYPASSRLS service_role sees zero rows under RLS enabled+forced with no policy -- production's BYPASSRLS service_role sees the row instead");

      await assert.rejects(
        pg.query(
          `select public.psi_authorize_agt002_validation_recovery('${setup.jobId}', '${setup.worksetId}', ${setup.completedBatchCount}, '${VALID_CONTEXT_HASH}', '${ATTESTED_REJECTED_OUTPUT_HASH}', '${REPAIR_SHA_091}') as data`,
        ),
        /permission denied|privilegio|denied/i,
        'service_role must never be able to execute the validation-recovery function: it is a direct database-owner/admin action only, reachable by no role at all',
      );
    } finally {
      await pg.exec('reset role');
    }

    // The audit row must survive completely undisturbed by the service_role probe above.
    const audit = await validationAuditRows(pg, setup.jobId);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].id, outcome.validation_recovery_id);
  } finally {
    await pg.close();
  }
});

test('rollback 091 succeeds before any validation-recovery evidence exists, restoring exact 090-only guard behavior', async (t) => {
  const pg = await createDatabase();
  try {
    await pg.exec(rollback091);

    assert.equal((await pg.query(`select to_regclass('public.psi_agt002_validation_recoveries') as t`)).rows[0].t, null, 'the validation-recovery audit table must be gone');
    assert.equal(
      (await pg.query(
        `select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'psi_agt002_reanalysis_jobs' and column_name = 'validation_recovery_id'`,
      )).rows[0].n,
      0,
      'jobs.validation_recovery_id must be gone',
    );
    assert.equal(
      (await pg.query(`select to_regprocedure('public.psi_authorize_agt002_validation_recovery(uuid,uuid,integer,text,text,text)') as p`)).rows[0].p,
      null,
      'the validation-recovery authorize function must be gone',
    );

    // Exact 090-only behavior restored: a fresh job can still be operator-recovered (089) and
    // then context-recovered (090) exactly as before 091 ever existed.
    const setup = await setupContextRecoverableJob(pg, { idempotencyKey: 'post-rollback-context-key', tag: 'post-rollback', totalBatchCount: 3 });
    const outcome = await authorizeContextRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });
    assert.equal(outcome.status, 'queued');
    assert.equal(outcome.resume_count, 5);

    // The validation_recovery_id column no longer exists after rollback, so a bare `select *`
    // (not a by-name select of a dropped column) is the only safe way to confirm the row.
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'queued');
    assert.ok(row.operator_recovery_id);
    assert.ok(row.context_recovery_id);
    assert.ok(!('validation_recovery_id' in row), 'the validation_recovery_id column must be entirely gone after rollback, not merely null');

    // Drive the context-recovered job back to a real at-cap unavailable state (claim, then fail
    // again) so the restored 090 guard is exercised on a genuine unavailable -> queued
    // transition, not a WHERE-guarded statement that matches zero rows because the job is
    // already queued.
    const claim = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
    assert.equal(claim.job_id, setup.jobId);
    assert.equal(claim.resume_count, 5, 're-claiming the context-recovered job must never change resume_count');

    const failed = await callRpc(pg, 'psi_fail_agt002_reanalysis_job', { p_job_id: setup.jobId, p_lease_id: claim.lease_id, p_error_code: 'invalid_output' });
    assert.equal(failed.status, 'unavailable');

    const atCapRow = await jobRow(pg, setup.jobId);
    assert.equal(atCapRow.status, 'unavailable');
    assert.equal(atCapRow.resume_count, 5);

    // The restored 090 two-way exactly-one rule (never zero, never both) must still hold: a
    // real at-cap requeue binding neither operator_recovery_id nor context_recovery_id is
    // rejected by the restored guard trigger.
    await assert.rejects(
      pg.exec(
        `update public.psi_agt002_reanalysis_jobs
         set status = 'queued', error_code = null, error_message = null, completed_at = null
         where id = '${setup.jobId}'`,
      ),
      /./,
      'a real at-cap requeue that binds neither operator_recovery_id nor context_recovery_id must still be rejected by the restored 090 guard',
    );
  } finally {
    await pg.close();
  }
});

test('rollback 091 fails closed while validation-recovery evidence exists, structurally: a real audit row and a non-null jobs.validation_recovery_id both block it', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupValidationRecoverableJob(pg);
    await authorizeValidationRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    await assert.rejects(
      pg.exec(rollback091),
      /bloque|validation_recover/i,
      'rollback 091 must refuse while a validation-recovery audit row or a non-null validation_recovery_id exists',
    );

    // A refused rollback must never mutate anything it was about to remove: the table, column,
    // function, and the single audit row must all still be exactly as they were.
    assert.equal(await validationAuditCount(pg), 1);
    assert.equal((await pg.query(`select to_regclass('public.psi_agt002_validation_recoveries') as t`)).rows[0].t, 'psi_agt002_validation_recoveries');
    assert.equal(
      (await pg.query(`select to_regprocedure('public.psi_authorize_agt002_validation_recovery(uuid,uuid,integer,text,text,text)') as p`)).rows[0].p,
      'psi_authorize_agt002_validation_recovery(uuid,uuid,integer,text,text,text)',
    );
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'queued');
    assert.ok(row.validation_recovery_id, 'the evidence that blocked the rollback must itself remain completely undisturbed');
  } finally {
    await pg.close();
  }
});
