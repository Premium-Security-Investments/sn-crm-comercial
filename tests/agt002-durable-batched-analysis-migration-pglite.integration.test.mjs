// AGT-002 durable batched analysis — PGlite integration (RED, no production change).
//
// Exercises migration 081 (docs/plans/2026-09-03-agt002-durable-batched-analysis.md, Task 1)
// against a real PostgreSQL engine: durable workset get-or-create with byte-exact reuse and
// fail-closed conflict, checkpoint stage/batch identity with idempotent replay and fail-closed
// conflict, lease/fencing rejection of a stale job/lease, checkpoint payload/hash/usage
// persistence, checkpoints never becoming/exposing a canonical run, and the one atomic
// lease-fenced finalize RPC that calls the existing, untouched public.psi_record_agt002_
// canonical_analysis_run(...) contract (067/076) and completes the queue job in the same
// transaction — rolling back both together on failure — while the legacy public.psi_
// complete_agt002_reanalysis_job(...) RPC (068) keeps working unchanged for a single_turn_v1
// job. All ids/content below are synthetic; no real expediente.
//
// Mirrors the tests/agt002-v3-persistence-migration-pglite.integration.test.mjs convention:
// migration 081 does not exist yet, so this file must load and run cleanly regardless. A
// HAS_081 guard means requiring the file never throws an unreadable-file/ENOENT crash, and a
// "behavior-gap" block always runs first, demonstrating today's absence as an ordinary,
// expected assertion failure (caught and logged) rather than an unhandled rejection. Once 081
// exists, the full scenario suite below runs for real and must be green.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
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
// 079's psi_renew_agt002_preview_claim(...) extends public.psi_agt002_preview_claims, the
// reservations table 028 created; it must exist before 079 is applied.
const migration028 = migrationSource('028_agt002_preview_claims.sql');
// The CURRENT canonical persistence chain, not just 067: 076 redefines
// psi_record_agt002_canonical_analysis_run in place (advisory lock instead of the opportunity
// row FOR UPDATE), and 077 pins the service_role statement/lock timeout budget the RPC actually
// runs under in production. 079 adds the fenced heartbeat renewal RPCs Task 1's finalize/claim
// compatibility scenarios below exercise. Applying only through 067/068 would exercise a stale,
// already-superseded version of the exact function migration 081's finalize RPC calls.
const migration076 = migrationSource('076_agt002_canonical_lock_contention_fix.sql');
const migration077 = migrationSource('077_agt002_canonical_persistence_statement_timeout.sql');
const migration079 = migrationSource('079_agt002_lease_heartbeat.sql');

const migration081Url = new URL('../supabase/migrations/081_agt002_durable_batched_analysis.sql', import.meta.url);
const rollback081Url = new URL('../supabase/rollbacks/081_agt002_durable_batched_analysis_rollback.sql', import.meta.url);
const HAS_081 = existsSync(migration081Url) && existsSync(rollback081Url);
const migration081 = HAS_081 ? strip(readFileSync(migration081Url, 'utf8')) : null;
const rollback081 = HAS_081 ? strip(readFileSync(rollback081Url, 'utf8')) : null;

const V3_SCHEMA_VERSION = '3.0.0';
const V3_CONTRACT_VERSION = 'agt002-integral-analysis-v3';

const P = '44444444-4444-4444-8444-444444444444';
const O = '11111111-1111-4111-8111-111111111111';
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
  if (HAS_081) await pg.exec(migration081);
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

async function getOrCreateWorkset(pg, overrides = {}) {
  return callRpc(pg, 'psi_get_or_create_agt002_analysis_workset', {
    p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version_id: pg.contextVersionId,
    p_idempotency_key: 'workset-key-1', p_frozen_identity: frozenIdentity(),
    ...overrides,
  });
}

async function createJob(pg, { idempotencyKey = 'workset-key-1', tag = 'v1' } = {}) {
  return callRpc(pg, 'psi_create_agt002_reanalysis_job', {
    p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version_id: pg.contextVersionId,
    p_idempotency_key: idempotencyKey, p_frozen_engine_input: { manifest: tag }, p_requested_by: P,
  });
}

async function claimJob(pg, leaseSeconds = 600) {
  return callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: leaseSeconds });
}

function checkpointArgs(overrides = {}) {
  return {
    p_job_id: overrides.jobId, p_lease_id: overrides.leaseId, p_workset_id: overrides.worksetId,
    p_stage: overrides.stage ?? 'semantic_discovery_batch', p_batch_index: overrides.batchIndex ?? 0,
    p_request_hash: overrides.requestHash ?? 'd'.repeat(64),
    p_stage_contract_version: overrides.stageContractVersion ?? 'discovery-batch-contract-v1',
    p_output: overrides.output ?? { batch_index: overrides.batchIndex ?? 0, units: [] },
    p_output_sha256: overrides.outputSha256 ?? 'e'.repeat(64),
    p_usage: overrides.usage ?? { input_tokens: 100, output_tokens: 20 },
    p_provider_idempotency_key: overrides.providerIdempotencyKey ?? 'provider-key-1',
  };
}

async function recordCheckpoint(pg, overrides = {}) {
  return callRpc(pg, 'psi_record_agt002_analysis_checkpoint', checkpointArgs(overrides));
}

async function tryRun(promise) {
  try {
    return { data: await promise, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

/** Reads the resume_count upper bound Hermes chose (`resume_count <= N`) straight out of the
 * migration text, so the reclaim scenarios below exercise whatever bounded cap is actually
 * implemented instead of pinning an arbitrary number no implementation is required to match. */
function extractResumeCap(sql) {
  const match = sql && sql.match(/resume_count\s*<=\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function expireLease(pg, jobId) {
  await pg.exec(`update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() - interval '1 hour' where id = '${jobId}'`);
}

function integralAnalysis(overrides = {}) {
  return {
    contract_version: V3_CONTRACT_VERSION,
    coverage: {
      manifest_version: 'synthetic-manifest-v1', expected_requirement_ids: ['req-1'],
      analyzed_requirement_ids: ['req-1'], material_omissions: false, legal_corpus_version_id: null,
    },
    analysis_units: [{ unit_id: 'SYNTH-UNIT-1', unit_kind: 'tender_requirement', requirement_id: 'req-1', assessment_mode: 'abstained' }],
    ...overrides,
  };
}

function v3Result(overrides = {}) {
  return {
    recommendation: 'pause', summary: 'Batched sintético', strengths: [], weaknesses: [],
    blockers: [], questions: [], unverified: [], next_action: 'x', human_review_required: true,
    integral_analysis: integralAnalysis(),
    ...overrides,
  };
}

async function finalize(pg, overrides = {}) {
  return callRpc(pg, 'psi_finalize_agt002_durable_batched_analysis', {
    p_job_id: overrides.jobId, p_lease_id: overrides.leaseId, p_workset_id: overrides.worksetId,
    p_snapshot_id: S, p_opportunity_id: O, p_tender_id: T,
    p_result: overrides.result ?? v3Result(),
    p_critical_open_count: overrides.criticalOpenCount ?? 0,
    p_idempotency_key: overrides.idempotencyKey ?? 'workset-key-1',
    p_schema_version: overrides.schemaVersion ?? V3_SCHEMA_VERSION,
    p_policy_version: overrides.policyVersion ?? 'policy-1',
    p_model: overrides.model ?? 'model-1',
    p_usage: overrides.usage ?? { model: 'model-1', input_tokens: 1, output_tokens: 1 },
    p_context_version_id: overrides.contextVersionId ?? pg.contextVersionId,
    p_legal_corpus_version_id: overrides.legalCorpusVersionId ?? null,
  });
}

let redFailures = 0;

if (!HAS_081) {
  // --- Behavior-gap block: runs only before 081 exists. Under migrations through 068 alone
  // there is no durable workset/checkpoint capability at all: the whole surface this migration
  // adds is simply absent. Proven as a real, ordinary assertion failure — not a thrown
  // "function does not exist" crash — by checking to_regprocedure()/to_regclass() first.
  {
    const pg = await createBaseDatabase();
    const hasWorksetTable = (await pg.query("select to_regclass('public.psi_agt002_analysis_worksets') is not null present")).rows[0].present;
    const hasFinalizeFn = (await pg.query(
      "select to_regprocedure('public.psi_finalize_agt002_durable_batched_analysis(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)') is not null present",
    )).rows[0].present;
    try {
      assert.equal(hasWorksetTable, true, 'public.psi_agt002_analysis_worksets must exist so a durable workset can be created/reused (RED before migration 081)');
      assert.equal(hasFinalizeFn, true, 'public.psi_finalize_agt002_durable_batched_analysis must exist so canonical persistence and job completion can commit atomically (RED before migration 081)');
    } catch (error) {
      redFailures += 1;
      console.log(`RED (behavior gap, expected before 081): ${error.message}`);
      assert.equal(hasWorksetTable, false, 'the documented pre-081 gap: no durable workset table exists yet');
      assert.equal(hasFinalizeFn, false, 'the documented pre-081 gap: no atomic finalize RPC exists yet');
    }
    await pg.close();
  }

  console.log(`AGT-002 durable batched analysis migration: 081 not present yet — ran only the behavior-gap RED block (${redFailures} failure(s) demonstrated as expected). Add 081 to run the full GREEN suite.`);
} else {
  assert.equal(redFailures, 0, 'the behavior-gap block must be green once 081 exists and is applied');

  // (1) Apply/apply idempotency: re-running 081 against an already-migrated database must not error.
  {
    const pg = await createDatabase();
    await pg.exec(migration081);
    const workset = await getOrCreateWorkset(pg);
    assert.equal(workset.status, 'created');
    await pg.close();
  }

  // (2) Workset get-or-create: byte-exact reuse, fail-closed on any conflicting bound field.
  {
    const pg = await createDatabase();
    const created = await getOrCreateWorkset(pg);
    assert.equal(created.status, 'created');
    assert.ok(created.workset_id);

    const replay = await getOrCreateWorkset(pg);
    assert.equal(replay.status, 'existing');
    assert.equal(replay.workset_id, created.workset_id);

    // Any single bound-field mismatch under the same idempotency_key must fail closed, never
    // silently return the wrong workset and never derive a second workset for the same key.
    const conflict = await tryRun(getOrCreateWorkset(pg, { p_frozen_identity: frozenIdentity({ model: 'different-model' }) }));
    assert.ok(conflict.error, 'a conflicting frozen_identity under an existing idempotency_key must be rejected, never silently accepted');

    const rows = (await pg.query(`select id from public.psi_agt002_analysis_worksets where idempotency_key = 'workset-key-1'`)).rows;
    assert.equal(rows.length, 1, 'a conflicting replay must never create a second workset row for the same key');
    await pg.close();
  }

  // (3) Checkpoint stage/batch identity: idempotent-reuse and fail-closed conflict, keyed by
  // (workset_id, stage, batch_index) and never by job/lease identity.
  {
    const pg = await createDatabase();
    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);
    assert.equal(claim.job_id, job.job_id);

    const first = await recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, stage: 'semantic_discovery_batch', batchIndex: 0 });
    assert.equal(first.status, 'created');
    assert.ok(first.checkpoint_id);

    // Exact replay (same job, same content) returns the existing row rather than duplicating it.
    const replay = await recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, stage: 'semantic_discovery_batch', batchIndex: 0 });
    assert.equal(replay.status, 'existing');
    assert.equal(replay.checkpoint_id, first.checkpoint_id);

    // A different payload under the SAME (workset_id, stage, batch_index) fails closed.
    const conflict = await tryRun(recordCheckpoint(pg, {
      jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, stage: 'semantic_discovery_batch', batchIndex: 0,
      output: { batch_index: 0, units: [{ tampered: true }] }, outputSha256: 'f'.repeat(64),
    }));
    assert.ok(conflict.error, 'a different payload under an existing (workset_id, stage, batch_index) must be rejected, never silently overwrite an immutable checkpoint');

    // A different batch_index is a distinct work identity and must be accepted independently.
    const secondBatch = await recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, stage: 'semantic_discovery_batch', batchIndex: 1, output: { batch_index: 1, units: [] } });
    assert.equal(secondBatch.status, 'created');
    assert.notEqual(secondBatch.checkpoint_id, first.checkpoint_id);

    const rows = (await pg.query(`select stage, batch_index from public.psi_agt002_analysis_checkpoints where workset_id = '${workset.workset_id}' order by batch_index`)).rows;
    assert.equal(rows.length, 2, 'no duplicate row may ever exist for one (workset_id, stage, batch_index)');
    await pg.close();
  }

  // (4) Checkpoint payload/hash/usage persistence: everything written is exactly what is read back.
  {
    const pg = await createDatabase();
    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);
    const output = { batch_index: 0, units: [{ label_owner_ref: 'req-1', status: 'validated' }] };
    const usage = { input_tokens: 4321, output_tokens: 987 };
    const created = await recordCheckpoint(pg, {
      jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id,
      stage: 'semantic_discovery_batch', batchIndex: 0, output, usage,
      outputSha256: 'a'.repeat(64), requestHash: 'b'.repeat(64), providerIdempotencyKey: 'provider-key-checkpoint-1',
    });
    assert.equal(created.status, 'created');

    const list = await callRpc(pg, 'psi_list_agt002_analysis_checkpoints', { p_workset_id: workset.workset_id });
    const rows = list.checkpoints;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].output, output, 'the exact validated JSON output must round-trip unchanged');
    assert.equal(rows[0].output_sha256, 'a'.repeat(64));
    assert.equal(rows[0].request_hash, 'b'.repeat(64));
    assert.deepEqual(rows[0].usage, usage, 'the accepted usage counts must round-trip unchanged');
    assert.equal(rows[0].provider_idempotency_key, 'provider-key-checkpoint-1');
    assert.equal(rows[0].stage, 'semantic_discovery_batch');
    assert.equal(rows[0].batch_index, 0);
    await pg.close();
  }

  // (5) Checkpoint rows are immutable: no UPDATE or DELETE survives, even for service_role.
  {
    const pg = await createDatabase();
    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);
    const created = await recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id });
    await assert.rejects(
      pg.exec(`update public.psi_agt002_analysis_checkpoints set output = '{"tampered":true}'::jsonb where id = '${created.checkpoint_id}'`),
      /immutable|append-only|inmutable/i,
    );
    await assert.rejects(
      pg.exec(`delete from public.psi_agt002_analysis_checkpoints where id = '${created.checkpoint_id}'`),
      /immutable|append-only|inmutable/i,
    );
    await pg.close();
  }

  // (6) Lease/fencing: a stale lease id, an expired lease, and a non-running job are all
  // rejected for both checkpoint writes and workset publication.
  {
    const pg = await createDatabase();
    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);

    await assert.rejects(
      recordCheckpoint(pg, { jobId: job.job_id, leaseId: '99999999-9999-4999-8999-999999999999', worksetId: workset.workset_id }),
      /lease|reserva/i,
      'a stale/wrong lease_id must never be able to write a checkpoint',
    );

    await pg.exec(`update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() - interval '1 hour' where id = '${job.job_id}'`);
    await assert.rejects(
      recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id }),
      /lease|reserva|expir/i,
      'an expired lease must never be resurrected by a checkpoint write',
    );
    await pg.exec(`update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() + interval '10 minutes' where id = '${job.job_id}'`);

    // Close the first job through the existing terminal-failure RPC so it no longer holds
    // the opportunity's single active-job slot (enforced by migration 068).
    const closed = await callRpc(pg, 'psi_fail_agt002_reanalysis_job', { p_job_id: job.job_id, p_lease_id: claim.lease_id, p_error_code: 'lease_lost' });
    assert.equal(closed.status, 'unavailable', 'closing the first job via the existing terminal-failure RPC must leave it in the unavailable terminal status');

    // A queued (never claimed) job can never write a checkpoint either.
    const secondWorkset = await getOrCreateWorkset(pg, { p_idempotency_key: 'workset-key-2' });
    const secondJob = await createJob(pg, { idempotencyKey: 'workset-key-2', tag: 'v2' });
    await assert.rejects(
      recordCheckpoint(pg, { jobId: secondJob.job_id, leaseId: '11111111-1111-4111-8111-111111111112', worksetId: secondWorkset.workset_id }),
      /running|lease|reserva/i,
      'a job that was never claimed (status queued, no lease) can never write a checkpoint',
    );
    await pg.close();
  }

  // (7) Lease/fencing: the job's frozen canonical idempotency key must equal the workset's.
  {
    const pg = await createDatabase();
    const worksetA = await getOrCreateWorkset(pg, { p_idempotency_key: 'workset-key-a' });
    await getOrCreateWorkset(pg, { p_idempotency_key: 'workset-key-b' });
    const jobB = await createJob(pg, { idempotencyKey: 'workset-key-b', tag: 'job-b' });
    const claimB = await claimJob(pg);
    assert.equal(claimB.job_id, jobB.job_id);

    await assert.rejects(
      recordCheckpoint(pg, { jobId: jobB.job_id, leaseId: claimB.lease_id, worksetId: worksetA.workset_id }),
      /identidad|idempotenc|workset/i,
      "a job whose frozen idempotency_key is 'workset-key-b' must never be able to write a checkpoint onto workset 'workset-key-a'",
    );
    await pg.close();
  }

  // (8) Checkpoints never publish canonical analysis: accepting checkpoints leaves
  // psi_tender_analysis_runs completely untouched and produces no canonical/current row.
  {
    const pg = await createDatabase();
    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);
    await recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, stage: 'semantic_discovery_batch', batchIndex: 0 });
    await recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, stage: 'semantic_manifest', batchIndex: 0 });
    await recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, stage: 'integral_analysis_plan', batchIndex: 0 });
    await recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, stage: 'integral_analysis_batch', batchIndex: 0 });

    const runCount = (await pg.query(`select count(*)::int n from public.psi_tender_analysis_runs`)).rows[0].n;
    assert.equal(runCount, 0, 'no amount of accepted checkpoints may ever insert a row into psi_tender_analysis_runs');

    const worksetRow = (await pg.query(`select published from public.psi_agt002_analysis_worksets where id = '${workset.workset_id}'`)).rows[0];
    assert.equal(worksetRow.published, false, 'a workset with accepted checkpoints is not published until the atomic finalize RPC succeeds');
    await pg.close();
  }

  // (9) The atomic finalize RPC: a successful call records exactly one canonical run,
  // publishes the workset, and completes the job — all as one committed unit.
  {
    const pg = await createDatabase();
    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);

    const outcome = await finalize(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id });
    assert.ok(outcome.analysis_run_id, 'finalize must return the newly recorded canonical analysis run id');

    const run = (await pg.query(`select canonical, status, schema_version from public.psi_tender_analysis_runs where id = '${outcome.analysis_run_id}'`)).rows[0];
    assert.equal(run.canonical, true);
    assert.equal(run.status, 'completed');
    assert.equal(run.schema_version, V3_SCHEMA_VERSION);

    const worksetRow = (await pg.query(`select published, published_analysis_run_id from public.psi_agt002_analysis_worksets where id = '${workset.workset_id}'`)).rows[0];
    assert.equal(worksetRow.published, true);
    assert.equal(worksetRow.published_analysis_run_id, outcome.analysis_run_id);

    const jobRow = (await pg.query(`select status, analysis_run_id, lease_id, lease_expires_at from public.psi_agt002_reanalysis_jobs where id = '${job.job_id}'`)).rows[0];
    assert.equal(jobRow.status, 'completed');
    assert.equal(jobRow.analysis_run_id, outcome.analysis_run_id);
    assert.equal(jobRow.lease_id, null, 'finalize must clear the lease exactly as the legacy completion RPC does');
    assert.equal(jobRow.lease_expires_at, null);
    await pg.close();
  }

  // (10) The atomic finalize RPC rolls back completely on failure: a malformed V3 payload
  // (rejected by the untouched 067/076 canonical gate) must record no canonical run, must
  // never publish the workset, and must leave the job exactly as it was (still running,
  // still leased) so the worker can retry or explicitly fail it.
  {
    const pg = await createDatabase();
    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);

    const malformedResult = v3Result({ integral_analysis: { contract_version: V3_CONTRACT_VERSION, coverage: { legal_corpus_version_id: null } } });
    await assert.rejects(
      finalize(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, result: malformedResult }),
      /integral V3|analysis_units/i,
      'a malformed V3 payload must be rejected by the same 067/076 gate psi_record_agt002_canonical_analysis_run already enforces',
    );

    assert.equal((await pg.query(`select count(*)::int n from public.psi_tender_analysis_runs`)).rows[0].n, 0, 'a failed finalize must record zero canonical runs');
    const worksetRow = (await pg.query(`select published from public.psi_agt002_analysis_worksets where id = '${workset.workset_id}'`)).rows[0];
    assert.equal(worksetRow.published, false, 'a failed finalize must never publish the workset');
    const jobRow = (await pg.query(`select status, lease_id, analysis_run_id from public.psi_agt002_reanalysis_jobs where id = '${job.job_id}'`)).rows[0];
    assert.equal(jobRow.status, 'running', 'a failed finalize must leave the job running, exactly as before the call, so it can be retried or explicitly failed');
    assert.equal(jobRow.lease_id, claim.lease_id, 'a failed finalize must never release the lease it did not successfully use');
    assert.equal(jobRow.analysis_run_id, null);

    // The worker can still retry finalize with a corrected payload using the SAME lease.
    const retried = await finalize(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id });
    assert.ok(retried.analysis_run_id);
    await pg.close();
  }

  // (11) The atomic finalize RPC preserves the prior canonical analysis on failure: an
  // opportunity with an existing canonical run must keep it canonical, untouched, after a
  // rejected finalize attempt.
  {
    const pg = await createDatabase();
    const priorOutcome = await callRpc(pg, 'psi_record_agt002_canonical_analysis_run', {
      p_snapshot_id: S, p_opportunity_id: O, p_tender_id: T, p_result: v3Result({ summary: 'previo' }),
      p_critical_open_count: 0, p_idempotency_key: 'prior-canonical-key', p_schema_version: V3_SCHEMA_VERSION,
      p_policy_version: 'policy-0', p_model: 'model-0', p_usage: { model: 'model-0', input_tokens: 1, output_tokens: 1 },
      p_context_version_id: pg.contextVersionId, p_legal_corpus_version_id: null,
    });
    assert.equal(priorOutcome.canonical, true);

    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);
    const malformedResult = v3Result({ integral_analysis: { contract_version: V3_CONTRACT_VERSION, coverage: { legal_corpus_version_id: null } } });
    await assert.rejects(finalize(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, result: malformedResult }));

    const canonicalCount = (await pg.query(`select count(*)::int n from public.psi_tender_analysis_runs where opportunity_id = '${O}' and canonical`)).rows[0].n;
    assert.equal(canonicalCount, 1, 'exactly one canonical run must remain — the prior one — after a rejected finalize attempt');
    const stillCanonical = (await pg.query(`select id, canonical from public.psi_tender_analysis_runs where idempotency_key = 'prior-canonical-key'`)).rows[0];
    assert.equal(stillCanonical.id, priorOutcome.id);
    assert.equal(stillCanonical.canonical, true);
    await pg.close();
  }

  // (12) The legacy single-turn completion RPC keeps working unchanged for a single_turn_v1
  // job that never touches a workset/checkpoint at all.
  {
    const pg = await createDatabase();
    const legacyJob = await createJob(pg, { idempotencyKey: 'legacy-single-turn-key', tag: 'legacy' });
    const legacyClaim = await claimJob(pg);
    assert.equal(legacyClaim.job_id, legacyJob.job_id);

    const legacyRun = await callRpc(pg, 'psi_record_agt002_canonical_analysis_run', {
      p_snapshot_id: S, p_opportunity_id: O, p_tender_id: T, p_result: v3Result({ summary: 'legacy single turn' }),
      p_critical_open_count: 0, p_idempotency_key: 'legacy-single-turn-key', p_schema_version: V3_SCHEMA_VERSION,
      p_policy_version: 'policy-legacy', p_model: 'model-legacy', p_usage: { model: 'model-legacy', input_tokens: 1, output_tokens: 1 },
      p_context_version_id: pg.contextVersionId, p_legal_corpus_version_id: null,
    });
    assert.equal(legacyRun.canonical, true);

    const completed = await callRpc(pg, 'psi_complete_agt002_reanalysis_job', {
      p_job_id: legacyJob.job_id, p_lease_id: legacyClaim.lease_id, p_analysis_run_id: legacyRun.id,
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.analysis_run_id, legacyRun.id);
    const jobRow = (await pg.query(`select status, lease_id from public.psi_agt002_reanalysis_jobs where id = '${legacyJob.job_id}'`)).rows[0];
    assert.equal(jobRow.status, 'completed');
    assert.equal(jobRow.lease_id, null);
    await pg.close();
  }

  // (13) Rollback refuses while any workset row exists, and only removes what 081 added.
  // Uses two isolated databases rather than deleting checkpoint rows in place: checkpoints
  // are append-only (immutable trigger), so the only valid way to reach a "no history" state
  // for the success path is a database that never created workset/checkpoint history at all.
  {
    const dbA = await createDatabase();
    const worksetA = await getOrCreateWorkset(dbA);
    const jobA = await createJob(dbA);
    const claimA = await claimJob(dbA);
    await recordCheckpoint(dbA, { jobId: jobA.job_id, leaseId: claimA.lease_id, worksetId: worksetA.workset_id });
    await assert.rejects(
      dbA.exec(rollback081), /bloque|histor|existen/i,
      'rollback 081 must refuse while workset/checkpoint history exists',
    );
    await dbA.close();

    const dbB = await createDatabase();
    await dbB.exec(rollback081);
    assert.equal((await dbB.query(`select to_regclass('public.psi_agt002_analysis_worksets') as t`)).rows[0].t, null);
    assert.equal((await dbB.query(`select to_regclass('public.psi_agt002_analysis_checkpoints') as t`)).rows[0].t, null);
    // 068's reanalysis jobs table and RPCs must survive the 081 rollback untouched.
    assert.ok((await dbB.query(`select to_regclass('public.psi_agt002_reanalysis_jobs') as t`)).rows[0].t, 'the 081 rollback must never remove the preexisting reanalysis jobs table');
    const stillClaimable = await callRpc(dbB, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 60 });
    assert.equal(stillClaimable.status, 'empty', 'the base claim RPC must still work after only the 081 rollback');
    await dbB.close();
  }

  console.log('AGT-002 durable batched analysis migration (081) PGlite integration passed');
}

// -------------------------------------------------------------------------------------------
// RED expansion below (Task 1 requirements the current migration 081 does not implement yet):
// each scenario is its own isolated node:test case, so every gap is reported independently
// instead of the whole file halting at the first failure. Each skips cleanly pre-081 instead
// of crashing on a missing file/column, per the "load cleanly" requirement.
// -------------------------------------------------------------------------------------------

test('finalize rejects an idempotent replay whose returned run has since been demoted (canonical=false): no false publication or job completion', async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createDatabase();
  try {
    const workset = await getOrCreateWorkset(pg);
    const jobA = await createJob(pg);
    const claimA = await claimJob(pg);
    const outcomeA = await finalize(pg, { jobId: jobA.job_id, leaseId: claimA.lease_id, worksetId: workset.workset_id });
    assert.ok(outcomeA.analysis_run_id);

    // An unrelated later canonical promotion for the SAME opportunity demotes the first run.
    const demote = await callRpc(pg, 'psi_record_agt002_canonical_analysis_run', {
      p_snapshot_id: S, p_opportunity_id: O, p_tender_id: T, p_result: v3Result({ summary: 'mas reciente' }),
      p_critical_open_count: 0, p_idempotency_key: 'other-canonical-key', p_schema_version: V3_SCHEMA_VERSION,
      p_policy_version: 'policy-2', p_model: 'model-2', p_usage: { model: 'model-2', input_tokens: 1, output_tokens: 1 },
      p_context_version_id: pg.contextVersionId, p_legal_corpus_version_id: null,
    });
    assert.equal(demote.canonical, true);
    const demotedFirst = (await pg.query(`select canonical from public.psi_tender_analysis_runs where id = '${outcomeA.analysis_run_id}'`)).rows[0];
    assert.equal(demotedFirst.canonical, false, 'setup check: the first run must actually have been demoted by the second canonical promotion');

    // A retry job reusing the SAME workset/idempotency key replays the canonical RPC, which
    // short-circuits to the now-demoted run. Finalize must reject this outright.
    const jobB = await createJob(pg, { idempotencyKey: 'workset-key-1', tag: 'retry' });
    const claimB = await claimJob(pg);
    assert.equal(claimB.job_id, jobB.job_id);

    await assert.rejects(
      finalize(pg, { jobId: jobB.job_id, leaseId: claimB.lease_id, worksetId: workset.workset_id }),
      /./,
      'finalize must reject an idempotent replay whose returned run is no longer the canonical/completed run',
    );

    const jobBRow = (await pg.query(`select status, lease_id, analysis_run_id from public.psi_agt002_reanalysis_jobs where id = '${jobB.job_id}'`)).rows[0];
    assert.equal(jobBRow.status, 'running', 'a rejected finalize must never mark the retry job completed');
    assert.equal(jobBRow.lease_id, claimB.lease_id);
    assert.equal(jobBRow.analysis_run_id, null, 'a rejected finalize must never attach a demoted/stale run id to the job');

    const canonicalRows = (await pg.query(`select id from public.psi_tender_analysis_runs where opportunity_id = '${O}' and canonical`)).rows;
    assert.equal(canonicalRows.length, 1);
    assert.equal(canonicalRows[0].id, demote.id, 'the truly latest canonical run must remain the only canonical row after the rejected replay');
  } finally {
    await pg.close();
  }
});

test("finalize rejects a p_context_version_id that disagrees with the workset's own context_version_id", async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createDatabase();
  try {
    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);
    const otherContext = await callRpc(pg, 'psi_record_agt002_context_version', {
      p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version: 2,
      p_context: { snapshot_id: S, human_evidence: [] }, p_context_hash: 'context-hash-2',
      p_human_evidence_count: 0, p_idempotency_key: 'context-key-2', p_actor_id: P,
    });
    assert.notEqual(otherContext.id, pg.contextVersionId);

    await assert.rejects(
      finalize(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, contextVersionId: otherContext.id }),
      /./,
      "finalize must reject a p_context_version_id that disagrees with the workset's own context_version_id",
    );

    const jobRow = (await pg.query(`select status, analysis_run_id from public.psi_agt002_reanalysis_jobs where id = '${job.job_id}'`)).rows[0];
    assert.equal(jobRow.status, 'running', 'a rejected finalize must leave the job running');
    assert.equal(jobRow.analysis_run_id, null);
  } finally {
    await pg.close();
  }
});

test('a freshly enqueued job is server-owned durable_batched_v1 with resume_count 0, using the existing enqueue signature unchanged', async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createDatabase();
  try {
    const job = await createJob(pg);
    const row = (await pg.query(`select execution_mode, resume_count from public.psi_agt002_reanalysis_jobs where id = '${job.job_id}'`)).rows[0];
    assert.equal(row.execution_mode, 'durable_batched_v1', 'a freshly enqueued job must be server-owned durable_batched_v1');
    assert.equal(row.resume_count, 0);
  } finally {
    await pg.close();
  }
});

test('a job enqueued BEFORE 081 keeps the legacy single_turn_v1 execution mode and still completes through the untouched 068 path', async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createBaseDatabase();
  try {
    const legacyJob = await createJob(pg, { idempotencyKey: 'pre-081-key', tag: 'pre-081' });
    await pg.exec(migration081);

    const row = (await pg.query(`select execution_mode, resume_count from public.psi_agt002_reanalysis_jobs where id = '${legacyJob.job_id}'`)).rows[0];
    assert.equal(row.execution_mode, 'single_turn_v1', 'a pre-081 row must default to the legacy execution mode, never be silently upgraded');
    assert.equal(row.resume_count, 0);

    const claim = await claimJob(pg);
    assert.equal(claim.job_id, legacyJob.job_id);
    const legacyRun = await callRpc(pg, 'psi_record_agt002_canonical_analysis_run', {
      p_snapshot_id: S, p_opportunity_id: O, p_tender_id: T, p_result: v3Result({ summary: 'legacy pre-081' }),
      p_critical_open_count: 0, p_idempotency_key: 'pre-081-key', p_schema_version: V3_SCHEMA_VERSION,
      p_policy_version: 'policy-pre-081', p_model: 'model-pre-081', p_usage: { model: 'model-pre-081', input_tokens: 1, output_tokens: 1 },
      p_context_version_id: pg.contextVersionId, p_legal_corpus_version_id: null,
    });
    const completed = await callRpc(pg, 'psi_complete_agt002_reanalysis_job', {
      p_job_id: legacyJob.job_id, p_lease_id: claim.lease_id, p_analysis_run_id: legacyRun.id,
    });
    assert.equal(completed.status, 'completed');
  } finally {
    await pg.close();
  }
});

test('finalize accepts only durable_batched_v1 jobs and rejects a legacy single_turn_v1 job outright', async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createDatabase();
  try {
    const workset = await getOrCreateWorkset(pg);
    const legacyJobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await pg.exec(`
      insert into public.psi_agt002_reanalysis_jobs
        (id, opportunity_id, tender_id, snapshot_id, context_version_id, idempotency_key, frozen_engine_input, status, requested_by, execution_mode)
      values
        ('${legacyJobId}', '${O}', '${T}', '${S}', '${pg.contextVersionId}', 'workset-key-1', '{"manifest":"legacy-mode"}'::jsonb, 'queued', '${P}', 'single_turn_v1')
    `);
    const claim = await claimJob(pg);
    assert.equal(claim.job_id, legacyJobId);

    await assert.rejects(
      finalize(pg, { jobId: legacyJobId, leaseId: claim.lease_id, worksetId: workset.workset_id }),
      /./,
      'finalize must reject a job whose execution_mode is not durable_batched_v1',
    );
  } finally {
    await pg.close();
  }
});

test('claim reclaims an expired running durable job below the resume cap, incrementing resume_count and retaining checkpoints', async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createDatabase();
  try {
    const cap = extractResumeCap(migration081);
    assert.ok(Number.isInteger(cap) && cap > 0, 'migration 081 must define a positive, extractable resume_count upper bound (resume_count <= N)');

    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);
    await recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id, stage: 'semantic_discovery_batch', batchIndex: 0 });

    await expireLease(pg, job.job_id);
    const reclaimed = await claimJob(pg);
    assert.equal(reclaimed.job_id, job.job_id, 'a durable job below the resume cap must be reclaimed and reissued, not terminated');

    const afterReclaim = (await pg.query(`select status, resume_count, lease_id from public.psi_agt002_reanalysis_jobs where id = '${job.job_id}'`)).rows[0];
    assert.equal(afterReclaim.status, 'running');
    assert.equal(afterReclaim.resume_count, 1);
    assert.notEqual(afterReclaim.lease_id, claim.lease_id, 'a reclaim must issue a fresh lease token');

    const checkpoints = await callRpc(pg, 'psi_list_agt002_analysis_checkpoints', { p_workset_id: workset.workset_id });
    assert.equal(checkpoints.checkpoints.length, 1, 'a reclaim must never drop an already-accepted checkpoint');
  } finally {
    await pg.close();
  }
});

test('claim terminally fails a durable job once it reaches the resume cap, so automatic reclaim can never be unbounded', async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createDatabase();
  try {
    const cap = extractResumeCap(migration081);
    assert.ok(Number.isInteger(cap) && cap > 0, 'migration 081 must define a positive, extractable resume_count upper bound (resume_count <= N)');

    const job = await createJob(pg);
    await claimJob(pg);
    for (let i = 0; i < cap; i += 1) {
      await expireLease(pg, job.job_id);
      const reclaim = await claimJob(pg);
      assert.equal(reclaim.job_id, job.job_id, `reclaim #${i + 1} (resume_count -> ${i + 1}, at/below cap ${cap}) must still reissue the job`);
    }
    const atCap = (await pg.query(`select resume_count, status from public.psi_agt002_reanalysis_jobs where id = '${job.job_id}'`)).rows[0];
    assert.equal(atCap.resume_count, cap);
    assert.equal(atCap.status, 'running');

    // One more expiry, now AT the cap, must terminally fail the job instead of reclaiming again.
    await expireLease(pg, job.job_id);
    await claimJob(pg);
    const overCap = (await pg.query(`select status, error_code from public.psi_agt002_reanalysis_jobs where id = '${job.job_id}'`)).rows[0];
    assert.equal(overCap.status, 'unavailable', 'a durable job at/over the resume cap must become terminally unavailable, never reclaimed again');
    assert.equal(overCap.error_code, 'lease_lost');
  } finally {
    await pg.close();
  }
});

test('an expired running legacy (single_turn_v1) job keeps the pre-081 terminal-unavailable behavior and never touches resume_count', async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createDatabase();
  try {
    const legacyJobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const someLease = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await pg.exec(`
      insert into public.psi_agt002_reanalysis_jobs
        (id, opportunity_id, tender_id, snapshot_id, context_version_id, idempotency_key, frozen_engine_input, status, requested_by, execution_mode, lease_id, lease_expires_at, started_at)
      values
        ('${legacyJobId}', '${O}', '${T}', '${S}', '${pg.contextVersionId}', 'legacy-reclaim-key', '{"manifest":"legacy"}'::jsonb, 'running', '${P}', 'single_turn_v1', '${someLease}', now() - interval '1 hour', now() - interval '2 hours')
    `);
    await claimJob(pg);
    const row = (await pg.query(`select status, error_code, resume_count from public.psi_agt002_reanalysis_jobs where id = '${legacyJobId}'`)).rows[0];
    assert.equal(row.status, 'unavailable');
    assert.equal(row.error_code, 'lease_lost');
    assert.equal(row.resume_count, 0, 'a legacy job must never have its resume_count touched by the reclaim sweep');
  } finally {
    await pg.close();
  }
});

test('the 079 heartbeat renewal RPC keeps extending a durable job lease compatibly after 081', async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createDatabase();
  try {
    const job = await createJob(pg);
    const claim = await claimJob(pg);
    const renewed = await callRpc(pg, 'psi_renew_agt002_reanalysis_job_lease', {
      p_job_id: job.job_id, p_lease_id: claim.lease_id, p_lease_seconds: 120,
    });
    assert.equal(renewed.status, 'renewed');
    const row = (await pg.query(`select lease_id, lease_expires_at from public.psi_agt002_reanalysis_jobs where id = '${job.job_id}'`)).rows[0];
    assert.equal(row.lease_id, claim.lease_id, 'the heartbeat must never rotate the lease token');
    assert.ok(row.lease_expires_at);
  } finally {
    await pg.close();
  }
});

test('governed archival lets rollback proceed once every workset is archived and terminal, but still refuses unarchived history or an active job', async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createDatabase();
  try {
    const workset = await getOrCreateWorkset(pg);
    const job = await createJob(pg);
    const claim = await claimJob(pg);
    await recordCheckpoint(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id });

    // Rollback refuses while the job is still active, even before archival is attempted.
    await assert.rejects(pg.exec(rollback081), /./, 'rollback must refuse while an active job still references this workset');

    // Archival itself must refuse while an active job remains for the canonical identity.
    await assert.rejects(
      callRpc(pg, 'psi_archive_agt002_analysis_workset', { p_workset_id: workset.workset_id, p_actor_id: P }),
      /./,
      'archival must refuse while an active job remains for the canonical identity',
    );

    await finalize(pg, { jobId: job.job_id, leaseId: claim.lease_id, worksetId: workset.workset_id });

    // The job is terminal now, but the workset is not yet explicitly archived: rollback still refuses.
    await assert.rejects(pg.exec(rollback081), /./, 'rollback must refuse unarchived history even once the job is terminal');

    const archived = await callRpc(pg, 'psi_archive_agt002_analysis_workset', { p_workset_id: workset.workset_id, p_actor_id: P });
    assert.equal(archived.status, 'archived');

    const archivedRow = (await pg.query(`select archived_at, archived_by from public.psi_agt002_analysis_worksets where id = '${workset.workset_id}'`)).rows[0];
    assert.ok(archivedRow.archived_at);
    assert.equal(archivedRow.archived_by, P);

    // Archival is one-way: nothing can ever clear archived_at again.
    await assert.rejects(
      pg.exec(`update public.psi_agt002_analysis_worksets set archived_at = null where id = '${workset.workset_id}'`),
      /./,
      'a workset can never be un-archived',
    );

    // Checkpoints stay append-only even through the archival path.
    const checkpointRow = (await pg.query(`select id from public.psi_agt002_analysis_checkpoints where workset_id = '${workset.workset_id}' limit 1`)).rows[0];
    await assert.rejects(
      pg.exec(`delete from public.psi_agt002_analysis_checkpoints where id = '${checkpointRow.id}'`),
      /immutable|append-only|inmutable/i,
    );

    // Now every workset in this database is archived and terminal: rollback may finally proceed.
    await pg.exec(rollback081);
    assert.equal((await pg.query(`select to_regclass('public.psi_agt002_analysis_worksets') as t`)).rows[0].t, null);
  } finally {
    await pg.close();
  }
});

test('081 runtime authorization: anon/authenticated are denied all table access, table DML, and RPC EXECUTE; service_role retains only its intended SELECT/EXECUTE grants', async (t) => {
  if (!HAS_081) { t.skip('081 not present yet'); return; }
  const pg = await createDatabase();
  try {
    const WORKSETS = 'public.psi_agt002_analysis_worksets';
    const CHECKPOINTS = 'public.psi_agt002_analysis_checkpoints';
    // Deliberately synthetic and never created anywhere in this file: privilege denial
    // must occur before any FK/CHECK validation ever runs, so these values only need to
    // be well-typed, never real.
    const ZERO = '00000000-0000-4000-8000-000000000000';
    const HASH = 'a'.repeat(64);

    const tableStatements = {
      worksetsSelect: `select id from ${WORKSETS} limit 1`,
      worksetsInsert: `insert into ${WORKSETS} (idempotency_key, opportunity_id, tender_id, snapshot_id, context_version_id, frozen_identity) values ('placeholder-key', '${ZERO}', '${ZERO}', '${ZERO}', '${ZERO}', '{}'::jsonb)`,
      worksetsUpdate: `update ${WORKSETS} set published = true where id = '${ZERO}'`,
      worksetsDelete: `delete from ${WORKSETS} where id = '${ZERO}'`,
      checkpointsSelect: `select id from ${CHECKPOINTS} limit 1`,
      checkpointsInsert: `insert into ${CHECKPOINTS} (workset_id, stage, batch_index, request_hash, stage_contract_version, output, output_sha256, provider_idempotency_key) values ('${ZERO}', 'semantic_discovery_batch', 0, '${HASH}', 'v1', '{}'::jsonb, '${HASH}', 'k')`,
      checkpointsUpdate: `update ${CHECKPOINTS} set output = '{}'::jsonb where id = '${ZERO}'`,
      checkpointsDelete: `delete from ${CHECKPOINTS} where id = '${ZERO}'`,
    };

    // Every RPC 081 adds, invoked with harmless well-typed placeholder arguments — enough
    // to reach the privilege check, never expected to reach (let alone complete) any
    // business logic.
    const rpcSignatures = [
      ['psi_get_or_create_agt002_analysis_workset', '(uuid,uuid,uuid,uuid,text,jsonb)', `('${ZERO}'::uuid, '${ZERO}'::uuid, '${ZERO}'::uuid, '${ZERO}'::uuid, 'k', '{}'::jsonb)`],
      ['psi_get_agt002_analysis_workset', '(text)', `('k')`],
      ['psi_list_agt002_analysis_checkpoints', '(uuid)', `('${ZERO}'::uuid)`],
      ['psi_record_agt002_analysis_checkpoint', '(uuid,uuid,uuid,text,integer,text,text,jsonb,text,jsonb,text)', `('${ZERO}'::uuid, '${ZERO}'::uuid, '${ZERO}'::uuid, 'semantic_discovery_batch', 0, '${HASH}', 'v1', '{}'::jsonb, '${HASH}', null, 'k')`],
      ['psi_mark_agt002_analysis_workset_published', '(uuid,uuid,uuid,uuid)', `('${ZERO}'::uuid, '${ZERO}'::uuid, '${ZERO}'::uuid, '${ZERO}'::uuid)`],
      ['psi_finalize_agt002_durable_batched_analysis', '(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)', `('${ZERO}'::uuid, '${ZERO}'::uuid, '${ZERO}'::uuid, '${ZERO}'::uuid, '${ZERO}'::uuid, '${ZERO}'::uuid, '{}'::jsonb, 0, 'k', 'v', 'p', 'm', null, '${ZERO}'::uuid, null)`],
      ['psi_archive_agt002_analysis_workset', '(uuid,uuid)', `('${ZERO}'::uuid, '${ZERO}'::uuid)`],
    ];

    for (const role of ['anon', 'authenticated']) {
      try {
        await pg.exec(`set role ${role}`);

        for (const [label, statement] of Object.entries(tableStatements)) {
          await assert.rejects(pg.query(statement), /permission denied/i, `${role} must be denied: ${label}`);
        }
        for (const [name, argTypes, args] of rpcSignatures) {
          await assert.rejects(pg.query(`select public.${name}${args}`), /permission denied/i, `${role} must be denied EXECUTE on ${name}${argTypes}`);
        }

        // Catalog-level proof independent of the error text above: pg_catalog itself
        // grants this role no privilege on either table or any 081 RPC — actual denial,
        // not just a matched error string.
        const acl = (await pg.query(`
          select
            has_table_privilege('${role}', '${WORKSETS}', 'SELECT') as w_select,
            has_table_privilege('${role}', '${WORKSETS}', 'INSERT') as w_insert,
            has_table_privilege('${role}', '${WORKSETS}', 'UPDATE') as w_update,
            has_table_privilege('${role}', '${WORKSETS}', 'DELETE') as w_delete,
            has_table_privilege('${role}', '${CHECKPOINTS}', 'SELECT') as c_select,
            has_table_privilege('${role}', '${CHECKPOINTS}', 'INSERT') as c_insert,
            has_table_privilege('${role}', '${CHECKPOINTS}', 'UPDATE') as c_update,
            has_table_privilege('${role}', '${CHECKPOINTS}', 'DELETE') as c_delete
        `)).rows[0];
        for (const [key, value] of Object.entries(acl)) {
          assert.equal(value, false, `${role} must hold no ${key} per pg_catalog`);
        }
        for (const [name, argTypes] of rpcSignatures) {
          const granted = (await pg.query(`select has_function_privilege('${role}', 'public.${name}${argTypes}', 'EXECUTE') as ok`)).rows[0].ok;
          assert.equal(granted, false, `${role} must hold no EXECUTE on public.${name}${argTypes} per pg_catalog`);
        }
      } finally {
        // Reset unconditionally so one failed assertion above can never leak the
        // narrowed role into a later attempt or into the service_role checks below.
        await pg.exec('reset role');
      }
    }

    // service_role: prove the SELECT-only table grant and EXECUTE-only RPC grant purely
    // from pg_catalog plus one harmless direct-write attempt per table — never by actually
    // completing an RPC (which would need real business rows) and never by reading real
    // row content.
    const serviceAcl = (await pg.query(`
      select
        has_table_privilege('service_role', '${WORKSETS}', 'SELECT') as w_select,
        has_table_privilege('service_role', '${WORKSETS}', 'INSERT') as w_insert,
        has_table_privilege('service_role', '${WORKSETS}', 'UPDATE') as w_update,
        has_table_privilege('service_role', '${WORKSETS}', 'DELETE') as w_delete,
        has_table_privilege('service_role', '${CHECKPOINTS}', 'SELECT') as c_select,
        has_table_privilege('service_role', '${CHECKPOINTS}', 'INSERT') as c_insert,
        has_table_privilege('service_role', '${CHECKPOINTS}', 'UPDATE') as c_update,
        has_table_privilege('service_role', '${CHECKPOINTS}', 'DELETE') as c_delete
    `)).rows[0];
    assert.equal(serviceAcl.w_select, true, 'service_role must retain SELECT on worksets');
    assert.equal(serviceAcl.c_select, true, 'service_role must retain SELECT on checkpoints');
    for (const key of ['w_insert', 'w_update', 'w_delete', 'c_insert', 'c_update', 'c_delete']) {
      assert.equal(serviceAcl[key], false, `service_role must hold no ${key}: every write goes through a SECURITY DEFINER RPC only`);
    }
    for (const [name, argTypes] of rpcSignatures) {
      const granted = (await pg.query(`select has_function_privilege('service_role', 'public.${name}${argTypes}', 'EXECUTE') as ok`)).rows[0].ok;
      assert.equal(granted, true, `service_role must retain EXECUTE on public.${name}${argTypes}`);
    }

    try {
      await pg.exec('set role service_role');
      await assert.doesNotReject(pg.query(`select id from ${WORKSETS} limit 0`), 'service_role must retain runtime SELECT on worksets');
      await assert.doesNotReject(pg.query(`select id from ${CHECKPOINTS} limit 0`), 'service_role must retain runtime SELECT on checkpoints');
      await assert.rejects(pg.query(tableStatements.worksetsInsert), /permission denied/i, 'service_role must never INSERT worksets directly, only through the SECURITY DEFINER RPC');
      await assert.rejects(pg.query(tableStatements.checkpointsInsert), /permission denied/i, 'service_role must never INSERT checkpoints directly, only through the SECURITY DEFINER RPC');
    } finally {
      await pg.exec('reset role');
    }
  } finally {
    await pg.close();
  }
});
