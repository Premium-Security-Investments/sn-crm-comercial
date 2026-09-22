// AGT-002 operator-governed recovery — PGlite integration.
//
// A bare unaudited operator_recovery_count slot would not be database-enforced — nothing would
// record who authorized bypassing the automatic reclaim cap or why, and nothing would stop a
// bare `UPDATE ... SET status = 'queued'` on an at-cap unavailable row outside any governed
// path, or a second undocumented recovery.
//
// Migration 089 instead adds an append-only, service_role-readable-only audit table
// (public.psi_agt002_operator_recoveries), a nullable/unique jobs.operator_recovery_id FK to
// it, a jobs guard trigger that only ever lets operator_recovery_id move null -> a real,
// same-job audit row exactly once and REQUIRES that exact atomic binding for any status
// transition into 'queued' while resume_count was already at the automatic cap (5), and the
// admin-only SECURITY DEFINER function public.psi_authorize_agt002_operator_recovery(uuid,
// uuid, integer, text) — reachable by NO application role, only a direct database-owner/admin
// action — that re-verifies every precondition itself before inserting the one audit row and
// requeuing the job in the same transaction. resume_count itself is never touched: it stays
// exactly the automatic-reclaim budget, capped at <=5, exactly as before.
//
// Exercised against a real PostgreSQL engine (PGlite), built up through the real, unmodified
// migration chain (050/051/053/056/063/067/068/076/077/028/079/081) that already governs
// psi_agt002_reanalysis_jobs / psi_agt002_analysis_worksets / psi_agt002_analysis_checkpoints /
// psi_tender_analysis_runs in production, so the precondition state this suite drives a job
// into (unavailable, error_code=timeout, durable_batched_v1, resume_count=5, a contiguous
// semantic-discovery checkpoint history) is reached the same way the real system reaches it —
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
const rollback089 = strip(readFileSync(new URL('../supabase/rollbacks/089_agt002_operator_recovery_slot_rollback.sql', import.meta.url), 'utf8'));

const V3_SCHEMA_VERSION = '3.0.0';
const V3_CONTRACT_VERSION = 'agt002-integral-analysis-v3';
const DEFECT_SHA = 'deadbeef'.repeat(5); // 40 lowercase hex characters

const P = '44444444-4444-4444-8444-444444444444';
const O = '11111111-1111-4111-8111-111111111111';
const O2 = '55555555-5555-4555-8555-555555555555';
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

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

async function createBaseDatabase() {
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
    insert into public.psi_sales_opportunities values ('${O2}');
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

  const context = await callRpc(pg, 'psi_record_agt002_context_version', {
    p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version: 2,
    p_context: { snapshot_id: S, human_evidence: [] }, p_context_hash: 'context-hash-1',
    p_human_evidence_count: 0, p_idempotency_key: 'context-key-1', p_actor_id: P,
  });
  pg.contextVersionId = context.id;
  return pg;
}

async function createDatabase() {
  const pg = await createBaseDatabase();
  await pg.exec(migration089);
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

function v3Result(overrides = {}) {
  return {
    recommendation: 'pause', summary: 'Batched sintético', strengths: [], weaknesses: [],
    blockers: [], questions: [], unverified: [], next_action: 'x', human_review_required: true,
    integral_analysis: {
      contract_version: V3_CONTRACT_VERSION,
      coverage: {
        manifest_version: 'synthetic-manifest-v1', expected_requirement_ids: ['req-1'],
        analyzed_requirement_ids: ['req-1'], material_omissions: false, legal_corpus_version_id: null,
      },
      analysis_units: [{ unit_id: 'SYNTH-UNIT-1', unit_kind: 'tender_requirement', requirement_id: 'req-1', assessment_mode: 'abstained' }],
    },
    ...overrides,
  };
}

/** Drives a real job through the durable-batched pipeline into the EXACT documented recovery
 * precondition: unavailable / error_code=timeout / durable_batched_v1 / phase=semantic_discovery
 * / a contiguous (by default) checkpoint history / resume_count exactly at the automatic cap
 * (5) — reached only through the real, unmodified 068/081 RPCs, never a hand-faked row. */
async function setupAtCapUnavailableJob(pg, {
  opportunityId = O, tenderId = T, snapshotId = S, idempotencyKey = 'workset-key-1', tag = 'v1',
  checkpointBatchIndexes = [0, 1], totalBatchCount = 3,
} = {}) {
  const workset = await callRpc(pg, 'psi_get_or_create_agt002_analysis_workset', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_snapshot_id: snapshotId, p_context_version_id: pg.contextVersionId,
    p_idempotency_key: idempotencyKey, p_frozen_identity: frozenIdentity(),
  });
  const job = await callRpc(pg, 'psi_create_agt002_reanalysis_job', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_snapshot_id: snapshotId, p_context_version_id: pg.contextVersionId,
    p_idempotency_key: idempotencyKey, p_frozen_engine_input: { manifest: tag }, p_requested_by: P,
  });
  let claim = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
  assert.equal(claim.job_id, job.job_id, 'setup check: the freshly created job must be the one claimed');

  let completed = 0;
  for (const batchIndex of checkpointBatchIndexes) {
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
  assert.equal(atCap.resume_count, 5, 'setup check: resume_count must be exactly at the automatic cap before terminal failure');
  assert.equal(atCap.status, 'running');

  // Terminally fail with error_code='timeout' (never the automatic sweep's 'lease_lost'),
  // still holding the lease issued by the 5th reclaim.
  const failed = await callRpc(pg, 'psi_fail_agt002_reanalysis_job', { p_job_id: job.job_id, p_lease_id: claim.lease_id, p_error_code: 'timeout' });
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.error_code, 'timeout');

  return { jobId: job.job_id, worksetId: workset.workset_id, idempotencyKey, completedBatchCount: completed, totalBatchCount };
}

function authorizeRecovery(pg, { jobId, worksetId, expectedCompletedBatchCount, defectCommitSha = DEFECT_SHA }) {
  return callRpc(pg, 'psi_authorize_agt002_operator_recovery', {
    p_job_id: jobId, p_workset_id: worksetId, p_expected_completed_batch_count: expectedCompletedBatchCount, p_defect_commit_sha: defectCommitSha,
  });
}

async function jobRow(pg, jobId) {
  return (await pg.query(
    `select status, error_code, error_message, completed_at, lease_id, lease_expires_at, resume_count,
            completed_batch_count, total_batch_count, phase, operator_recovery_id
     from public.psi_agt002_reanalysis_jobs where id = '${jobId}'`,
  )).rows[0];
}

async function auditRows(pg, jobId) {
  return (await pg.query(`select * from public.psi_agt002_operator_recoveries where job_id = '${jobId}'`)).rows;
}

async function auditCount(pg) {
  return (await pg.query(`select count(*)::int n from public.psi_agt002_operator_recoveries`)).rows[0].n;
}

test('happy path: the authorize function creates exactly one immutable audit row and requeues the job at the unchanged resume_count=5', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupAtCapUnavailableJob(pg);
    const outcome = await authorizeRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    assert.equal(outcome.job_id, setup.jobId);
    assert.equal(outcome.status, 'queued');
    assert.equal(outcome.resume_count, 5, 'the response must report the unchanged automatic-reclaim resume_count');
    assert.ok(outcome.operator_recovery_id, 'the response must surface the new audit row id');

    const audit = await auditRows(pg, setup.jobId);
    assert.equal(audit.length, 1, 'exactly one audit row must exist for this job');
    assert.equal(audit[0].workset_id, setup.worksetId);
    assert.equal(audit[0].completed_batch_count, setup.completedBatchCount);
    assert.equal(audit[0].defect_commit_sha, DEFECT_SHA);
    assert.equal(audit[0].reason_code, 'corrected_deterministic_bridge_defect');
    assert.ok(audit[0].authorized_by, 'authorized_by must be derived server-side, never null');
    assert.ok(audit[0].authorized_at, 'authorized_at must be stamped');

    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'queued');
    assert.equal(row.error_code, null, 'the requeue must clear error_code');
    assert.equal(row.error_message, null, 'the requeue must clear error_message');
    assert.equal(row.completed_at, null, 'the requeue must clear completed_at');
    assert.equal(row.lease_id, null, 'the requeue must clear the lease');
    assert.equal(row.lease_expires_at, null);
    assert.equal(row.resume_count, 5, 'resume_count must stay exactly what automatic reclaim left it at: 089 never changes it');
    assert.equal(row.completed_batch_count, setup.completedBatchCount, 'the requeue must preserve durable progress: it is a resume, not a reset');
    assert.equal(row.total_batch_count, setup.totalBatchCount);
    assert.equal(row.phase, 'semantic_discovery');
    assert.equal(row.operator_recovery_id, outcome.operator_recovery_id);

    // Adapter-compatible: the worker adapter hard-rejects any claim with resume_count > 5, so
    // the requeued job must still be claimable at exactly 5, never 6.
    const reclaimed = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
    assert.equal(reclaimed.job_id, setup.jobId, 'the recovered job must be claimable again like any other queued job');
    assert.equal(reclaimed.resume_count, 5, 'claiming a recovered job must never increment resume_count past the adapter-compatible cap of 5');
  } finally {
    await pg.close();
  }
});

test('a direct at-cap unavailable -> queued transition without an atomic audit binding is rejected by the jobs guard trigger', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupAtCapUnavailableJob(pg);

    await assert.rejects(
      pg.exec(
        `update public.psi_agt002_reanalysis_jobs
         set status = 'queued', error_code = null, error_message = null, completed_at = null
         where id = '${setup.jobId}'`,
      ),
      /guard|operator_recovery|inmutable|bloque/i,
      'a bare UPDATE requeuing an at-cap job without binding operator_recovery_id in the same statement must be rejected',
    );

    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'a rejected direct requeue must leave the job exactly as it was');
    assert.equal(row.operator_recovery_id, null);
    assert.equal(await auditCount(pg), 0, 'a rejected direct requeue must never create an audit row');
  } finally {
    await pg.close();
  }
});

test('a second recovery attempt after a simulated repeat failure is rejected, and the audit trail stays singular', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupAtCapUnavailableJob(pg);
    const first = await authorizeRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    // Simulate the worker picking the recovered job back up and failing it again for the same
    // reason, without ever touching resume_count or operator_recovery_id.
    const claim = await callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
    assert.equal(claim.job_id, setup.jobId);
    const refailed = await callRpc(pg, 'psi_fail_agt002_reanalysis_job', { p_job_id: setup.jobId, p_lease_id: claim.lease_id, p_error_code: 'timeout' });
    assert.equal(refailed.status, 'unavailable');

    const beforeRetry = await jobRow(pg, setup.jobId);
    assert.equal(beforeRetry.resume_count, 5);
    assert.equal(beforeRetry.operator_recovery_id, first.operator_recovery_id, 'operator_recovery_id must remain the original binding: it is immutable once set');

    await assert.rejects(
      authorizeRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: beforeRetry.completed_batch_count }),
      /./,
      'a second recovery of the same job must be rejected outright: operator_recovery_id is already set',
    );

    const afterRetry = await jobRow(pg, setup.jobId);
    assert.equal(afterRetry.status, 'unavailable', 'a rejected second recovery must leave the job exactly as it was');
    assert.equal(afterRetry.operator_recovery_id, first.operator_recovery_id);
    assert.equal(await auditCount(pg), 1, 'a rejected second recovery must never add a second audit row');

    // A direct bare UPDATE second requeue must also be rejected: the jobs guard trigger only
    // ever lets operator_recovery_id move null -> a real audit row exactly once, so re-binding
    // the same (already-set) audit id, or leaving it untouched while forcing status back to
    // 'queued', must both be refused.
    await assert.rejects(
      pg.exec(
        `update public.psi_agt002_reanalysis_jobs
         set status = 'queued', error_code = null, error_message = null, completed_at = null
         where id = '${setup.jobId}'`,
      ),
      /guard|operator_recovery|inmutable|bloque/i,
      'a direct second requeue without a fresh atomic audit binding must be rejected once operator_recovery_id is already set',
    );
    await assert.rejects(
      pg.exec(
        `update public.psi_agt002_reanalysis_jobs
         set status = 'queued', error_code = null, error_message = null, completed_at = null,
             operator_recovery_id = '${first.operator_recovery_id}'
         where id = '${setup.jobId}'`,
      ),
      /./,
      're-asserting the same already-bound operator_recovery_id to force a second requeue must be rejected: the binding is one-way and exactly-once',
    );

    const afterDirectRetry = await jobRow(pg, setup.jobId);
    assert.equal(afterDirectRetry.status, 'unavailable', 'a rejected direct second requeue must leave the job exactly as it was');
    assert.equal(afterDirectRetry.operator_recovery_id, first.operator_recovery_id);
    assert.equal(await auditCount(pg), 1, 'a rejected direct second requeue must never add a second audit row');
  } finally {
    await pg.close();
  }
});

test('the audit table is append-only: UPDATE and DELETE fail for both the definer/owner and service_role', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupAtCapUnavailableJob(pg);
    const outcome = await authorizeRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    await assert.rejects(
      pg.exec(`update public.psi_agt002_operator_recoveries set defect_commit_sha = '${'a'.repeat(40)}' where id = '${outcome.operator_recovery_id}'`),
      /immutable|append-only|inmutable/i,
    );
    await assert.rejects(
      pg.exec(`delete from public.psi_agt002_operator_recoveries where id = '${outcome.operator_recovery_id}'`),
      /immutable|append-only|inmutable/i,
    );

    await pg.exec('set role service_role');
    try {
      await assert.rejects(
        pg.exec(`delete from public.psi_agt002_operator_recoveries where id = '${outcome.operator_recovery_id}'`),
        /immutable|append-only|inmutable|permission|privilegio|denied/i,
        'service_role only ever has SELECT: it must never be able to delete an audit row either',
      );
    } finally {
      await pg.exec('reset role');
    }

    assert.equal(await auditCount(pg), 1, 'the audit row must survive every mutation attempt unchanged');
  } finally {
    await pg.close();
  }
});

test('the authorize function rejects a non-lowercase-40-hex defect_commit_sha and mutates nothing', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupAtCapUnavailableJob(pg);

    for (const badSha of ['A'.repeat(40), 'g'.repeat(40), 'deadbeef'.repeat(4), DEFECT_SHA + '0']) {
      const attempt = await tryRun(authorizeRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount, defectCommitSha: badSha }));
      assert.ok(attempt.error, `a malformed defect_commit_sha (${JSON.stringify(badSha)}) must be rejected`);
    }

    assert.equal(await auditCount(pg), 0, 'no malformed attempt may ever create an audit row');
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'a rejected authorize call must leave the job exactly as it was');
    assert.equal(row.operator_recovery_id, null);
  } finally {
    await pg.close();
  }
});

test('the authorize function rejects a p_expected_completed_batch_count that does not match the job and mutates nothing', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupAtCapUnavailableJob(pg);

    await assert.rejects(
      authorizeRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount + 1 }),
      /./,
      'a p_expected_completed_batch_count that does not exactly match the job row must be rejected: this is a caller-verifies-what-it-expects guard, not a trusted input',
    );

    assert.equal(await auditCount(pg), 0, 'a rejected count-mismatch attempt must never create an audit row');
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable', 'a rejected count-mismatch attempt must leave the job exactly as it was');
    assert.equal(row.operator_recovery_id, null);
  } finally {
    await pg.close();
  }
});

test('the authorize function rejects a non-contiguous semantic-discovery checkpoint history and mutates nothing', async (t) => {
  const pg = await createDatabase();
  try {
    // Batches 0 and 2 exist, batch 1 is missing: not contiguous 0..N-1.
    const setup = await setupAtCapUnavailableJob(pg, { checkpointBatchIndexes: [0, 2] });

    await assert.rejects(
      authorizeRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount }),
      /./,
      'a checkpoint gap must be rejected: the semantic-discovery history is not exactly contiguous 0..N-1',
    );

    assert.equal(await auditCount(pg), 0);
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable');
    assert.equal(row.operator_recovery_id, null);
  } finally {
    await pg.close();
  }
});

test('the authorize function rejects a published workset and mutates nothing', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupAtCapUnavailableJob(pg);

    // A real completed canonical run under an UNRELATED idempotency key, then a direct
    // publication of the workset onto it — exactly the state a workset reaches once its
    // analysis is already published, independent of this stuck job.
    const unrelatedRun = await callRpc(pg, 'psi_record_agt002_canonical_analysis_run', {
      p_snapshot_id: S, p_opportunity_id: O, p_tender_id: T, p_result: v3Result(),
      p_critical_open_count: 0, p_idempotency_key: 'unrelated-canonical-key', p_schema_version: V3_SCHEMA_VERSION,
      p_policy_version: 'policy-1', p_model: 'model-1', p_usage: { model: 'model-1', input_tokens: 1, output_tokens: 1 },
      p_context_version_id: pg.contextVersionId, p_legal_corpus_version_id: null,
    });
    await pg.exec(
      `update public.psi_agt002_analysis_worksets set published = true, published_analysis_run_id = '${unrelatedRun.id}' where id = '${setup.worksetId}'`,
    );

    await assert.rejects(
      authorizeRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount }),
      /./,
      'a published workset must never be recovered into',
    );

    assert.equal(await auditCount(pg), 0);
    const row = await jobRow(pg, setup.jobId);
    assert.equal(row.status, 'unavailable');
    assert.equal(row.operator_recovery_id, null);
  } finally {
    await pg.close();
  }
});

test('service_role can SELECT the audit table but can never execute the authorize function', async (t) => {
  const pg = await createDatabase();
  try {
    const setup = await setupAtCapUnavailableJob(pg);
    await authorizeRecovery(pg, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    await pg.exec('set role service_role');
    try {
      const seen = (await pg.query('select count(*)::int n from public.psi_agt002_operator_recoveries')).rows[0].n;
      assert.equal(seen, 1, 'service_role must be able to SELECT the audit table');

      await assert.rejects(
        pg.query(
          `select public.psi_authorize_agt002_operator_recovery('${setup.jobId}', '${setup.worksetId}', ${setup.completedBatchCount}, '${DEFECT_SHA}') as data`,
        ),
        /permission denied|privilegio|denied/i,
        'service_role must never be able to execute the recovery function: it is a direct database-owner/admin action only',
      );
    } finally {
      await pg.exec('reset role');
    }
  } finally {
    await pg.close();
  }
});

test('the jobs guard trigger rejects binding operator_recovery_id to an audit row that belongs to a different job', async (t) => {
  const pg = await createDatabase();
  try {
    const setupA = await setupAtCapUnavailableJob(pg, { opportunityId: O, idempotencyKey: 'workset-key-a', tag: 'job-a' });
    const setupB = await setupAtCapUnavailableJob(pg, { opportunityId: O, tenderId: T, snapshotId: S, idempotencyKey: 'workset-key-b', tag: 'job-b' });

    const outcomeB = await authorizeRecovery(pg, { jobId: setupB.jobId, worksetId: setupB.worksetId, expectedCompletedBatchCount: setupB.completedBatchCount });
    assert.ok(outcomeB.operator_recovery_id);

    await assert.rejects(
      pg.exec(
        `update public.psi_agt002_reanalysis_jobs
         set status = 'queued', error_code = null, error_message = null, completed_at = null,
             operator_recovery_id = '${outcomeB.operator_recovery_id}'
         where id = '${setupA.jobId}'`,
      ),
      /./,
      "binding job A's operator_recovery_id to job B's audit row must be rejected: the audit row does not belong to job A",
    );

    const rowA = await jobRow(pg, setupA.jobId);
    assert.equal(rowA.status, 'unavailable', 'the rejected cross-job binding must leave job A exactly as it was');
    assert.equal(rowA.operator_recovery_id, null);
  } finally {
    await pg.close();
  }
});

test('rollback 089 refuses with evidence, and succeeds cleanly on a separate database that never recovered anything', async (t) => {
  const dbA = await createDatabase();
  try {
    const setup = await setupAtCapUnavailableJob(dbA);
    await authorizeRecovery(dbA, { jobId: setup.jobId, worksetId: setup.worksetId, expectedCompletedBatchCount: setup.completedBatchCount });

    await assert.rejects(
      dbA.exec(rollback089),
      /bloque|audit|operator_recovery/i,
      'rollback 089 must refuse while an audit row or a non-null operator_recovery_id exists',
    );
    // A refused rollback must never mutate anything it was about to remove.
    assert.equal(await auditCount(dbA), 1);
  } finally {
    await dbA.close();
  }

  const dbB = await createDatabase();
  try {
    await dbB.exec(rollback089);

    assert.equal((await dbB.query(`select to_regclass('public.psi_agt002_operator_recoveries') as t`)).rows[0].t, null, 'the audit table must be gone');
    assert.equal(
      (await dbB.query(
        `select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'psi_agt002_reanalysis_jobs' and column_name = 'operator_recovery_id'`,
      )).rows[0].n,
      0,
      'jobs.operator_recovery_id must be gone',
    );
    assert.equal(
      (await dbB.query(`select to_regprocedure('public.psi_authorize_agt002_operator_recovery(uuid,uuid,integer,text)') as p`)).rows[0].p,
      null,
      'the authorize function must be gone',
    );

    // 068/081's jobs table and RPCs, and the original resume_count<=5 cap, must all survive
    // untouched.
    const job = await callRpc(dbB, 'psi_create_agt002_reanalysis_job', {
      p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version_id: dbB.contextVersionId,
      p_idempotency_key: 'post-rollback-key-1', p_frozen_engine_input: { manifest: 'post-rollback' }, p_requested_by: P,
    });
    assert.equal(job.status, 'created', 'job creation must still work after only the 089 rollback');
    const claim = await callRpc(dbB, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 60 });
    assert.equal(claim.job_id, job.job_id);

    await assert.rejects(
      dbB.exec(`update public.psi_agt002_reanalysis_jobs set resume_count = 6 where id = '${job.job_id}'`),
      /./,
      'the original resume_count <= 5 bound must still reject 6 after the 089 rollback',
    );
  } finally {
    await dbB.close();
  }
});
