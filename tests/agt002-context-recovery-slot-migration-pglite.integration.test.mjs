// AGT-002 context-recovery — PGlite integration.
//
// Migration 090 layers a SECOND, narrower database-enforced audit trail + one-way binding on
// top of 089's operator-recovery slot (see tests/agt002-operator-recovery-slot-migration-pglite.
// integration.test.mjs, whose setup patterns this file reuses/copies in miniature). It targets
// jobs that already carry a real 089 operator_recovery_id and then failed a SECOND time, at
// exactly the automatic cap, because their frozen engine input predates contextV2Sections while
// the job's own environment flag still requires AGT002_CONTEXT_V2.
//
// Exercised against a real PostgreSQL engine (PGlite), built up through the real, unmodified
// migration chain (050/051/053/056/063/067/068/076/077/028/079/081/089/090) that already governs
// psi_agt002_reanalysis_jobs / psi_agt002_analysis_worksets / psi_agt002_analysis_checkpoints /
// psi_agt002_context_versions in production, so the precondition state this suite drives a job
// into — unavailable, error_code=invalid_output, durable_batched_v1, resume_count=5, N/N
// (N-1 contiguous semantic_discovery_batch checkpoints + exactly one semantic_manifest
// checkpoint), a real prior 089 operator recovery, and a governed context version whose root
// shape (context_version/opportunity/company_dossier/commercial_context/human_evidence) and
// exact context_hash the authorize call must reproduce as its p_expected_context_hash argument
// — is reached the same way the real system reaches it: through the real 068/081/089 RPCs,
// never a hand-faked row.
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
const rollback090 = strip(readFileSync(new URL('../supabase/rollbacks/090_agt002_context_recovery_slot_rollback.sql', import.meta.url), 'utf8'));

const P = '44444444-4444-4444-8444-444444444444';
const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

const DEFECT_SHA = 'deadbeef'.repeat(5); // 40 lowercase hex characters (089's own defect_commit_sha)
const REPAIR_SHA = 'cafebabe'.repeat(5); // 40 lowercase hex characters (090's repair_commit_sha)
const VALID_CONTEXT_HASH = 'a1b2c3d4'.repeat(8); // 64 lowercase hex characters
const MISMATCHED_CONTEXT_HASH = 'f9e8d7c6'.repeat(8); // 64 lowercase hex characters, distinct from VALID_CONTEXT_HASH
const INVALID_CONTEXT_HASH = 'zz'.repeat(32); // 64 characters, not hex

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

async function createDatabase() {
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

/** Only used to shape a job's frozen_engine_input.analysis_context.contextV2Sections fixture
 * (the legacy per-job payload the guard checks for) — the governed context version itself now
 * uses the flat production root shape built by createContextVersion(). */
function contextV2Sections(overrides = {}) {
  return {
    requirement_summary: [{ id: 'req-1' }],
    legal_financial: [{ id: 'lf-1' }],
    technical_operational: [{ id: 'to-1' }],
    company_evidence: [{ id: 'ce-1' }],
    ...overrides,
  };
}

function buildFrozenEngineInput({ analysisContext = { note: 'legacy synthetic context' }, flags = { AGT002_CONTEXT_V2: true } } = {}) {
  return { manifest: 'synthetic', analysis_context: analysisContext, analysis_flags: flags };
}

async function createContextVersion(pg, {
  opportunityId = O, tenderId = T, snapshotId = S, idempotencyKey,
  contextHash = VALID_CONTEXT_HASH, contextOverrides = {}, snapshotIdField,
} = {}) {
  const context = {
    context_version: 2,
    snapshot_id: snapshotIdField ?? snapshotId,
    opportunity: {},
    company_dossier: {},
    commercial_context: {},
    human_evidence: [],
    ...contextOverrides,
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
  jobId, worksetId, expectedCompletedBatchCount, contextHash = VALID_CONTEXT_HASH, repairCommitSha = REPAIR_SHA,
}) {
  return callRpc(pg, 'psi_authorize_agt002_context_recovery', {
    p_job_id: jobId, p_workset_id: worksetId, p_expected_completed_batch_count: expectedCompletedBatchCount,
    p_expected_context_hash: contextHash, p_repair_commit_sha: repairCommitSha,
  });
}

async function jobRow(pg, jobId) {
  return (await pg.query(
    `select status, error_code, error_message, completed_at, lease_id, lease_expires_at, resume_count,
            completed_batch_count, total_batch_count, phase, operator_recovery_id, context_recovery_id
     from public.psi_agt002_reanalysis_jobs where id = '${jobId}'`,
  )).rows[0];
}

async function contextAuditRows(pg, jobId) {
  return (await pg.query(`select * from public.psi_agt002_context_recoveries where job_id = '${jobId}'`)).rows;
}

async function contextAuditCount(pg) {
  return (await pg.query(`select count(*)::int n from public.psi_agt002_context_recoveries`)).rows[0].n;
}

/** Drives a real job through: creation -> claim -> N-1 semantic-discovery-batch checkpoints ->
 * 5 automatic reclaim cycles -> terminal failure (timeout) -> a real 089 operator recovery ->
 * a fresh claim -> the final unit of semantic-discovery work (by default the semantic_manifest
 * checkpoint, completing exactly N/N) -> a SECOND terminal failure (invalid_output) — the exact
 * documented 090 context-recovery precondition. Every step goes through the real, unmodified
 * 068/081/089 RPCs, never a hand-faked row. */
async function setupContextRecoverableJob(pg, {
  opportunityId = O, tenderId = T, snapshotId = S, idempotencyKey = 'ctx-recovery-key-1', tag = 'ctx1',
  totalBatchCount = 3, discoveryBatchIndexes = [0, 1],
  contextHash = VALID_CONTEXT_HASH, contextOverrides = {}, contextSnapshotIdField,
  frozenEngineInput = buildFrozenEngineInput(),
  finalCheckpointMode = 'manifest', // 'manifest' (valid N/N) | 'extraDiscoveryBatch' (wrong checkpoint accounting)
} = {}) {
  const contextVersionId = await createContextVersion(pg, {
    opportunityId, tenderId, snapshotId, idempotencyKey: `${idempotencyKey}-context`,
    contextHash, contextOverrides, snapshotIdField: contextSnapshotIdField,
  });

  const workset = await callRpc(pg, 'psi_get_or_create_agt002_analysis_workset', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_snapshot_id: snapshotId, p_context_version_id: contextVersionId,
    p_idempotency_key: idempotencyKey, p_frozen_identity: frozenIdentity(),
  });
  const job = await callRpc(pg, 'psi_create_agt002_reanalysis_job', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_snapshot_id: snapshotId, p_context_version_id: contextVersionId,
    p_idempotency_key: idempotencyKey, p_frozen_engine_input: frozenEngineInput, p_requested_by: P,
  });

  let claim = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
  assert.equal(claim.job_id, job.job_id, 'setup check: the freshly created job must be the one claimed');

  let completed = 0;
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
  assert.ok(operatorOutcome.operator_recovery_id, 'setup check: the real 089 operator recovery must succeed before this suite ever exercises 090');

  // Resume the real job: claim it back (resume_count stays at 5: a claim of a queued job never
  // increments it, only automatic reclaim of an expired running job does), then complete the
  // final unit of semantic-discovery work.
  claim = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
  assert.equal(claim.job_id, job.job_id);

  completed += 1;
  if (finalCheckpointMode === 'manifest') {
    await callRpc(pg, 'psi_record_agt002_analysis_checkpoint', {
      p_job_id: job.job_id, p_lease_id: claim.lease_id, p_workset_id: workset.workset_id,
      p_stage: 'semantic_manifest', p_batch_index: 0,
      p_request_hash: 'd'.repeat(64), p_stage_contract_version: 'manifest-contract-v1',
      p_output: { manifest: true }, p_output_sha256: 'e'.repeat(64),
      p_usage: { input_tokens: 5, output_tokens: 1 }, p_provider_idempotency_key: `provider-key-${tag}-manifest`,
      p_progress_phase: 'semantic_discovery', p_completed_batch_count: completed, p_total_batch_count: totalBatchCount,
    });
  } else if (finalCheckpointMode === 'extraDiscoveryBatch') {
    // A wrong checkpoint history: the job's own progress counters say semantic-discovery is
    // fully done (N/N), but the durable checkpoint trail is N discovery batches and NO
    // manifest, instead of the required N-1 discovery batches + exactly one manifest.
    const extraIndex = discoveryBatchIndexes.length;
    await callRpc(pg, 'psi_record_agt002_analysis_checkpoint', {
      p_job_id: job.job_id, p_lease_id: claim.lease_id, p_workset_id: workset.workset_id,
      p_stage: 'semantic_discovery_batch', p_batch_index: extraIndex,
      p_request_hash: 'd'.repeat(64), p_stage_contract_version: 'discovery-batch-contract-v1',
      p_output: { batch_index: extraIndex, units: [] }, p_output_sha256: 'e'.repeat(64),
      p_usage: { input_tokens: 10, output_tokens: 2 }, p_provider_idempotency_key: `provider-key-${tag}-${extraIndex}`,
      p_progress_phase: 'semantic_discovery', p_completed_batch_count: completed, p_total_batch_count: totalBatchCount,
    });
  } else {
    throw new Error(`unknown finalCheckpointMode: ${finalCheckpointMode}`);
  }
  assert.equal(completed, totalBatchCount, 'setup check: the job must reach exactly N/N before the second terminal failure');

  const failedSecond = await callRpc(pg, 'psi_fail_agt002_reanalysis_job', { p_job_id: job.job_id, p_lease_id: claim.lease_id, p_error_code: 'invalid_output' });
  assert.equal(failedSecond.status, 'unavailable');
  assert.equal(failedSecond.error_code, 'invalid_output');

  const row = await jobRow(pg, job.job_id);
  assert.equal(row.status, 'unavailable');
  assert.equal(row.error_code, 'invalid_output');
  assert.equal(row.error_message, 'El resultado del motor no superó la validación.');
  assert.equal(row.resume_count, 5, 'setup check: the second failure must never change resume_count');
  assert.equal(row.phase, 'semantic_discovery');
  assert.equal(row.completed_batch_count, totalBatchCount);
  assert.equal(row.total_batch_count, totalBatchCount);
  assert.ok(row.operator_recovery_id, 'setup check: the real 089 operator_recovery_id must already be bound');
  assert.equal(row.context_recovery_id, null);

  return {
    jobId: job.job_id, worksetId: workset.workset_id, contextVersionId, idempotencyKey,
    completedBatchCount: totalBatchCount, totalBatchCount, operatorRecoveryId: row.operator_recovery_id,
  };
}

test('happy path: context-recovery authorize creates exactly one immutable audit row and requeues the job at the unchanged resume_count=5, keeping the prior 089 binding', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupContextRecoverableJob(pg);
    const outcome = await authorizeContextRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    assert.equal(outcome.job_id, setup.jobId);
    assert.equal(outcome.status, 'queued');
    assert.equal(outcome.resume_count, 5, 'the response must report the unchanged automatic-reclaim resume_count');
    assert.ok(outcome.context_recovery_id, 'the response must surface the new audit row id');

    const audit = await contextAuditRows(pg, setup.jobId);
    assert.equal(audit.length, 1, 'exactly one context-recovery audit row must exist for this job');
    assert.equal(audit[0].workset_id, setup.worksetId);
    assert.equal(audit[0].completed_batch_count, setup.completedBatchCount);
    assert.equal(audit[0].repair_commit_sha, REPAIR_SHA);
    assert.equal(audit[0].source_context_hash, VALID_CONTEXT_HASH);
    assert.equal(audit[0].reason_code, 'rehydrated_legacy_context_v2_sections');
    assert.ok(audit[0].authorized_by, 'authorized_by must be derived server-side, never null');
    assert.ok(audit[0].authorized_at, 'authorized_at must be stamped');

    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'queued');
    assert.equal(row.error_code, null, 'the requeue must clear error_code');
    assert.equal(row.error_message, null, 'the requeue must clear error_message');
    assert.equal(row.completed_at, null, 'the requeue must clear completed_at');
    assert.equal(row.lease_id, null, 'the requeue must clear the lease');
    assert.equal(row.lease_expires_at, null);
    assert.equal(row.resume_count, 5, 'resume_count must stay exactly what automatic reclaim left it at: 090 never changes it');
    assert.equal(row.completed_batch_count, setup.completedBatchCount, 'the requeue must preserve durable progress: it is a resume, not a reset');
    assert.equal(row.total_batch_count, setup.totalBatchCount);
    assert.equal(row.phase, 'semantic_discovery');
    assert.equal(row.operator_recovery_id, setup.operatorRecoveryId, 'the original 089 binding must survive unchanged');
    assert.equal(row.context_recovery_id, outcome.context_recovery_id);

    const reclaimed = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
    assert.equal(reclaimed.job_id, setup.jobId, 'the context-recovered job must be claimable again like any other queued job');
    assert.equal(reclaimed.resume_count, 5, 'claiming a recovered job must never increment resume_count past the adapter-compatible cap of 5');
  } finally {
    await pg.close();
  }
});

test('a direct at-cap requeue that binds neither recovery id is rejected by the extended jobs guard trigger', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupContextRecoverableJob(pg);

    await assert.rejects(
      pg.exec(
        `update public.psi_agt002_reanalysis_jobs
         set status = 'queued', error_code = null, error_message = null, completed_at = null
         where id = '${setup.jobId}'`,
      ),
      /guard|recovery|inmutable|bloque|vincular/i,
      'a bare UPDATE requeuing an at-cap job that already has operator_recovery_id set, without binding context_recovery_id, must be rejected: exactly one of the two ids must be bound',
    );

    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'a rejected direct requeue must leave the job exactly as it was');
    assert.equal(row.context_recovery_id, null);
    assert.equal(await contextAuditCount(pg), 0, 'a rejected direct requeue must never create a context-recovery audit row');
  } finally {
    await pg.close();
  }
});

test('a second context-recovery attempt after a simulated repeat failure is rejected, and the audit trail stays singular', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupContextRecoverableJob(pg);
    const first = await authorizeContextRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    await assert.rejects(
      authorizeContextRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount }),
      /./,
      'a second context recovery of the same job must be rejected outright: context_recovery_id is already set',
    );

    const afterRetry = await jobRow(pg, setup.jobId);
    assert.equal(afterRetry.status, 'queued', 'the rejected second attempt must leave the job exactly as the first (successful) recovery left it');
    assert.equal(afterRetry.context_recovery_id, first.context_recovery_id);
    assert.equal(await contextAuditCount(pg), 1, 'a rejected second attempt must never add a second audit row');

    await assert.rejects(
      pg.exec(
        `update public.psi_agt002_reanalysis_jobs
         set context_recovery_id = null
         where id = '${setup.jobId}'`,
      ),
      /guard|inmutable/i,
      'context_recovery_id must be immutable once bound: it can never be reset back to null either',
    );

    assert.equal(await contextAuditCount(pg), 1);
  } finally {
    await pg.close();
  }
});

test('the authorize function rejects a workset whose identity does not match the job and mutates nothing', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupContextRecoverableJob(pg);

    const unrelatedWorkset = await callRpc(pg, 'psi_get_or_create_agt002_analysis_workset', {
      p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version_id: setup.contextVersionId,
      p_idempotency_key: 'unrelated-workset-key', p_frozen_identity: frozenIdentity(),
    });

    await assert.rejects(
      authorizeContextRecovery(pg, { jobId: setup.jobId, worksetId: unrelatedWorkset.workset_id, expectedCompletedBatchCount: setup.completedBatchCount }),
      /./,
      "a workset whose idempotency_key does not match the job's must be rejected",
    );

    assert.equal(await contextAuditCount(pg), 0);
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'a rejected mismatched-workset attempt must leave the job exactly as it was');
    assert.equal(row.context_recovery_id, null);
  } finally {
    await pg.close();
  }
});

test('the authorize function rejects a checkpoint history that is not exactly N-1 contiguous semantic_discovery_batch rows plus one semantic_manifest, and mutates nothing', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupContextRecoverableJob(pg, { idempotencyKey: 'ctx-recovery-key-badcheckpoints', tag: 'badcp', finalCheckpointMode: 'extraDiscoveryBatch' });

    await assert.rejects(
      authorizeContextRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount }),
      /./,
      'a job whose job-level progress says N/N but whose durable checkpoint trail has N discovery batches and no manifest must be rejected',
    );

    assert.equal(await contextAuditCount(pg), 0);
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable');
    assert.equal(row.context_recovery_id, null);
  } finally {
    await pg.close();
  }
});

test('the authorize function rejects a governed context version whose context_hash is not a lowercase 64-hex string, and mutates nothing', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupContextRecoverableJob(pg, {
      idempotencyKey: 'ctx-recovery-key-badhash', tag: 'badhash', contextHash: INVALID_CONTEXT_HASH,
    });

    await assert.rejects(
      authorizeContextRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount }),
      /./,
      'a governed context version with a malformed context_hash must be rejected',
    );

    assert.equal(await contextAuditCount(pg), 0);
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable');
    assert.equal(row.context_recovery_id, null);
  } finally {
    await pg.close();
  }
});

test('the authorize function rejects a governed context version whose root shape is missing or has a malformed field, and mutates nothing', async (t) => {
  const variants = [
    { label: 'context_version is not 2', contextOverrides: { context_version: 3 } },
    { label: 'opportunity is not an object', contextOverrides: { opportunity: 'not-an-object' } },
    { label: 'company_dossier is not an object', contextOverrides: { company_dossier: 'not-an-object' } },
    { label: 'commercial_context is not an object', contextOverrides: { commercial_context: 'not-an-object' } },
    { label: 'human_evidence is not an array', contextOverrides: { human_evidence: 'not-an-array' } },
  ];
  for (const [i, variant] of variants.entries()) {
    const pg = await createDatabase();
    try {
      const setup = await setupContextRecoverableJob(pg, {
        idempotencyKey: `ctx-recovery-key-badshape-${i}`, tag: `badshape${i}`, contextOverrides: variant.contextOverrides,
      });

      await assert.rejects(
        authorizeContextRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount }),
        /./,
        `a governed context version where ${variant.label} must be rejected`,
      );

      assert.equal(await contextAuditCount(pg), 0);
      const row = await jobRow(pg, setup.jobId);
      assert.equal(row.status, 'unavailable');
      assert.equal(row.context_recovery_id, null);
    } finally {
      await pg.close();
    }
  }
});

test('the authorize function rejects a p_expected_context_hash that does not match the governed context version, mutating no audit row, binding, or job status', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupContextRecoverableJob(pg);

    await assert.rejects(
      authorizeContextRecovery(pg, {
        jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount,
        contextHash: MISMATCHED_CONTEXT_HASH,
      }),
      /./,
      "a p_expected_context_hash that does not equal the governed context version's own context_hash must be rejected",
    );

    assert.equal(await contextAuditCount(pg), 0, 'a rejected mismatched-hash attempt must never create an audit row');
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'a rejected mismatched-hash attempt must leave the job status exactly as it was');
    assert.equal(row.error_code, 'invalid_output', 'a rejected mismatched-hash attempt must leave error_code exactly as it was');
    assert.equal(row.context_recovery_id, null, 'a rejected mismatched-hash attempt must never bind context_recovery_id');
    assert.equal(row.operator_recovery_id, setup.operatorRecoveryId, "a rejected mismatched-hash attempt must never disturb the prior 089 operator_recovery_id binding");
  } finally {
    await pg.close();
  }
});

test("the authorize function rejects a job whose frozen root already carries contextV2Sections, and a job whose frozen root does not require AGT002_CONTEXT_V2, and mutates nothing", async (t) => {
  const variants = [
    {
      label: 'frozen analysis_context already contains contextV2Sections',
      frozenEngineInput: buildFrozenEngineInput({ analysisContext: { note: 'already rehydrated', contextV2Sections: contextV2Sections() } }),
    },
    {
      label: 'frozen analysis_flags.AGT002_CONTEXT_V2 is not true',
      frozenEngineInput: buildFrozenEngineInput({ flags: { AGT002_CONTEXT_V2: false } }),
    },
  ];
  for (const [i, variant] of variants.entries()) {
    const pg = await createDatabase();
    try {
      const setup = await setupContextRecoverableJob(pg, {
        idempotencyKey: `ctx-recovery-key-badflags-${i}`, tag: `badflags${i}`, frozenEngineInput: variant.frozenEngineInput,
      });

      await assert.rejects(
        authorizeContextRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount }),
        /./,
        `a job where ${variant.label} must be rejected`,
      );

      assert.equal(await contextAuditCount(pg), 0);
      const row = await jobRow(pg, setup.jobId);
      assert.equal(row.status, 'unavailable');
      assert.equal(row.context_recovery_id, null);
    } finally {
      await pg.close();
    }
  }
});

test('the authorize function rejects a non-lowercase-40-hex repair_commit_sha and mutates nothing', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupContextRecoverableJob(pg);

    for (const badSha of ['A'.repeat(40), 'g'.repeat(40), 'cafebabe'.repeat(4), REPAIR_SHA + '0']) {
      const attempt = await tryRun(authorizeContextRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount, repairCommitSha: badSha }));
      assert.ok(attempt.error, `a malformed repair_commit_sha (${JSON.stringify(badSha)}) must be rejected`);
    }

    assert.equal(await contextAuditCount(pg), 0, 'no malformed attempt may ever create an audit row');
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'a rejected authorize call must leave the job exactly as it was');
    assert.equal(row.context_recovery_id, null);
  } finally {
    await pg.close();
  }
});

test('rollback 090 refuses with evidence, and succeeds cleanly on a separate database that never context-recovered anything, restoring exact 089-only guard behavior', async (t) => {
  const dbA = await createDatabase();
  try {
    const setup = await setupContextRecoverableJob(dbA);
    await authorizeContextRecovery(dbA, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    await assert.rejects(
      dbA.exec(rollback090),
      /bloque|context_recover/i,
      'rollback 090 must refuse while a context-recovery audit row or a non-null context_recovery_id exists',
    );
    assert.equal(await contextAuditCount(dbA), 1, 'a refused rollback must never mutate anything it was about to remove');
  } finally {
    await dbA.close();
  }

  const dbB = await createDatabase();
  try {
    await dbB.exec(rollback090);

    assert.equal((await dbB.query(`select to_regclass('public.psi_agt002_context_recoveries') as t`)).rows[0].t, null, 'the context-recovery audit table must be gone');
    assert.equal(
      (await dbB.query(
        `select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'psi_agt002_reanalysis_jobs' and column_name = 'context_recovery_id'`,
      )).rows[0].n,
      0,
      'jobs.context_recovery_id must be gone',
    );
    assert.equal(
      (await dbB.query(`select to_regprocedure('public.psi_authorize_agt002_context_recovery(uuid,uuid,integer,text,text)') as p`)).rows[0].p,
      null,
      'the context-recovery authorize function must be gone',
    );

    // Exact 089-only behavior restored: build a fresh at-cap unavailable(timeout) job (no
    // context-recovery involvement at all) and operator-recover it exactly as 089 always did.
    const contextVersionId = await createContextVersion(dbB, { idempotencyKey: 'post-rollback-context-key' });
    const workset = await callRpc(dbB, 'psi_get_or_create_agt002_analysis_workset', {
      p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version_id: contextVersionId,
      p_idempotency_key: 'post-rollback-key-1', p_frozen_identity: frozenIdentity(),
    });
    const job = await callRpc(dbB, 'psi_create_agt002_reanalysis_job', {
      p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version_id: contextVersionId,
      p_idempotency_key: 'post-rollback-key-1', p_frozen_engine_input: { manifest: 'post-rollback' }, p_requested_by: P,
    });
    let claim = await callRpc(dbB, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
    assert.equal(claim.job_id, job.job_id);

    await callRpc(dbB, 'psi_record_agt002_analysis_checkpoint', {
      p_job_id: job.job_id, p_lease_id: claim.lease_id, p_workset_id: workset.workset_id,
      p_stage: 'semantic_discovery_batch', p_batch_index: 0,
      p_request_hash: 'd'.repeat(64), p_stage_contract_version: 'discovery-batch-contract-v1',
      p_output: { batch_index: 0, units: [] }, p_output_sha256: 'e'.repeat(64),
      p_usage: { input_tokens: 10, output_tokens: 2 }, p_provider_idempotency_key: 'provider-key-post-rollback-0',
      p_progress_phase: 'semantic_discovery', p_completed_batch_count: 1, p_total_batch_count: 3,
    });

    for (let i = 0; i < 5; i += 1) {
      await dbB.exec(`update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() - interval '1 hour' where id = '${job.job_id}'`);
      claim = await callRpc(dbB, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
      assert.equal(claim.job_id, job.job_id);
    }
    const failed = await callRpc(dbB, 'psi_fail_agt002_reanalysis_job', { p_job_id: job.job_id, p_lease_id: claim.lease_id, p_error_code: 'timeout' });
    assert.equal(failed.status, 'unavailable');

    const outcome = await authorizeOperatorRecovery(dbB, { jobId: job.job_id, worksetId: workset.workset_id, expectedCompletedBatchCount: 1 });
    assert.equal(outcome.status, 'queued');
    assert.equal(outcome.resume_count, 5);

    // The context_recovery_id column no longer exists after rollback, so a bare `select *`
    // (not a by-name select of a dropped column) is the only safe way to confirm the row.
    const row = (await dbB.query(`select * from public.psi_agt002_reanalysis_jobs where id = '${job.job_id}'`)).rows[0];
    assert.equal(row.status, 'queued');
    assert.ok(row.operator_recovery_id);
    assert.ok(!('context_recovery_id' in row), 'the context_recovery_id column must be entirely gone after rollback, not merely null');

    await assert.rejects(
      dbB.exec(`update public.psi_agt002_reanalysis_jobs set resume_count = 6 where id = '${job.job_id}'`),
      /./,
      'the original resume_count <= 5 bound must still reject 6 after the 090 rollback',
    );
  } finally {
    await dbB.close();
  }
});
