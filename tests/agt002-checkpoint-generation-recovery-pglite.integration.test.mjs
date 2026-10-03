import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { computeAgt002CheckpointGenerationRecoveryKey } from '../agt002-checkpoint-generation-recovery.js';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration = name => strip(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
const chain = [
  '050_agt002_canonical_analysis.sql',
  '051_agt002_context_versions.sql',
  '053_agt002_legal_corpus.sql',
  '056_agt002_legal_corpus_publication_gate.sql',
  '063_agt002_canonical_promotion.sql',
  '067_agt002_integral_v3_persistence.sql',
  '068_agt002_reanalysis_jobs.sql',
  '076_agt002_canonical_lock_contention_fix.sql',
  '077_agt002_canonical_persistence_statement_timeout.sql',
  '028_agt002_preview_claims.sql',
  '079_agt002_lease_heartbeat.sql',
  '081_agt002_durable_batched_analysis.sql',
  '089_agt002_operator_recovery_slot.sql',
  '090_agt002_context_recovery_slot.sql',
  '091_agt002_validation_recovery_slot.sql',
];
const migration097 = migration('097_agt002_checkpoint_generation_recovery.sql');
const rollback097 = strip(readFileSync(new URL('../supabase/rollbacks/097_agt002_checkpoint_generation_recovery_rollback.sql', import.meta.url), 'utf8'));

const PROFILE = '44444444-4444-4444-8444-444444444444';
const OPPORTUNITY = '11111111-1111-4111-8111-111111111111';
const TENDER = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT = '33333333-3333-4333-8333-333333333333';
const ROOT_KEY = 'a'.repeat(64);
const REPAIR_SHA = 'b'.repeat(40);
const REQUEST_HASH = 'c'.repeat(64);
const OUTPUT_HASH = 'd'.repeat(64);

function literal(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function rpc(pg, name, params) {
  const result = await pg.query(`select public.${name}(${Object.values(params).map(literal).join(',')}) data`);
  return result.rows[0].data;
}

async function database() {
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
    create function public.psi_tender_analysis_runs_prevent_mutation() returns trigger language plpgsql as $$
    begin raise exception 'append-only'; end; $$;
    create trigger psi_tender_analysis_runs_immutable before update or delete on public.psi_tender_analysis_runs
      for each row execute function public.psi_tender_analysis_runs_prevent_mutation();
    insert into public.psi_sales_profiles values ('${PROFILE}', true, 'human', 'Ana', 'admin');
    insert into public.psi_sales_opportunities values ('${OPPORTUNITY}');
    insert into public.psi_public_tenders values ('${TENDER}');
    insert into public.psi_tender_document_snapshots values ('${SNAPSHOT}', '${OPPORTUNITY}', '${TENDER}');
  `);
  for (const name of chain) await pg.exec(migration(name));
  await pg.exec(migration097);
  const context = await rpc(pg, 'psi_record_agt002_context_version', {
    p_opportunity_id: OPPORTUNITY, p_tender_id: TENDER, p_snapshot_id: SNAPSHOT,
    p_context_version: 2, p_context: { snapshot_id: SNAPSHOT, human_evidence: [] },
    p_context_hash: 'context-hash', p_human_evidence_count: 0,
    p_idempotency_key: 'context-key', p_actor_id: PROFILE,
  });
  pg.contextVersionId = context.id;
  return pg;
}

async function failedSource(pg) {
  const frozenEngineInput = {
    schema_version: 2,
    engine_identity: { idempotency_key: ROOT_KEY },
    document_workset_identity: {
      opportunity_id: OPPORTUNITY, tender_id: TENDER, snapshot_id: SNAPSHOT,
      context_version_id: pg.contextVersionId, selection_hash: 'e'.repeat(64),
    },
    governed_workset_members: [{ document_version_id: '55555555-5555-4555-8555-555555555555' }],
  };
  const workset = await rpc(pg, 'psi_get_or_create_agt002_analysis_workset', {
    p_opportunity_id: OPPORTUNITY, p_tender_id: TENDER, p_snapshot_id: SNAPSHOT,
    p_context_version_id: pg.contextVersionId, p_idempotency_key: ROOT_KEY,
    p_frozen_identity: { fixture: 'root' },
  });
  const job = await rpc(pg, 'psi_create_agt002_reanalysis_job', {
    p_opportunity_id: OPPORTUNITY, p_tender_id: TENDER, p_snapshot_id: SNAPSHOT,
    p_context_version_id: pg.contextVersionId, p_idempotency_key: ROOT_KEY,
    p_frozen_engine_input: frozenEngineInput, p_requested_by: PROFILE,
  });
  const claim = await rpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
  const checkpoint = async ({ stage, index, requestHash, outputHash, phase, completed, total }) => rpc(pg, 'psi_record_agt002_analysis_checkpoint', {
    p_job_id: job.job_id, p_lease_id: claim.lease_id, p_workset_id: workset.workset_id,
    p_stage: stage, p_batch_index: index, p_request_hash: requestHash,
    p_stage_contract_version: `${stage}-v1`, p_output: { stage, index }, p_output_sha256: outputHash,
    p_usage: {}, p_provider_idempotency_key: `provider:${stage}:${index}`,
    p_progress_phase: phase, p_completed_batch_count: completed, p_total_batch_count: total,
  });
  await checkpoint({ stage: 'semantic_discovery_batch', index: 0, requestHash: '1'.repeat(64), outputHash: '2'.repeat(64), phase: 'semantic_discovery', completed: 1, total: 2 });
  await checkpoint({ stage: 'semantic_manifest', index: 0, requestHash: '3'.repeat(64), outputHash: '4'.repeat(64), phase: 'semantic_discovery', completed: 2, total: 2 });
  const rejected = await checkpoint({ stage: 'integral_analysis_batch', index: 0, requestHash: REQUEST_HASH, outputHash: OUTPUT_HASH, phase: 'integral_analysis', completed: 1, total: 3 });
  await checkpoint({ stage: 'integral_analysis_batch', index: 1, requestHash: '5'.repeat(64), outputHash: '6'.repeat(64), phase: 'integral_analysis', completed: 2, total: 3 });
  await rpc(pg, 'psi_fail_agt002_reanalysis_job', {
    p_job_id: job.job_id, p_lease_id: claim.lease_id, p_error_code: 'persistence_failure',
  });
  return { jobId: job.job_id, worksetId: workset.workset_id, rejectedCheckpointId: rejected.checkpoint_id };
}

function authorize(pg, source, overrides = {}) {
  return rpc(pg, 'psi_authorize_agt002_checkpoint_generation_recovery', {
    p_source_job_id: source.jobId,
    p_source_workset_id: source.worksetId,
    p_rejected_checkpoint_id: source.rejectedCheckpointId,
    p_expected_completed_batch_count: 2,
    p_expected_total_batch_count: 3,
    p_expected_request_hash: REQUEST_HASH,
    p_expected_output_sha256: OUTPUT_HASH,
    p_repair_commit_sha: REPAIR_SHA,
    ...overrides,
  });
}

test('097 creates a fresh audited generation, preserves source evidence and isolates it from FIFO claim', async () => {
  const pg = await database();
  try {
    const source = await failedSource(pg);
    const result = await authorize(pg, source);
    const expectedKey = computeAgt002CheckpointGenerationRecoveryKey({
      rootIdempotencyKey: ROOT_KEY, sourceJobId: source.jobId,
      checkpointGeneration: 1, repairCommitSha: REPAIR_SHA,
    });
    assert.equal(result.status, 'created');
    assert.equal(result.recovery_idempotency_key, expectedKey, 'SQL and JavaScript key derivation must be byte-identical');

    const sourceRow = (await pg.query(`select status, error_code, completed_batch_count, total_batch_count from public.psi_agt002_reanalysis_jobs where id='${source.jobId}'`)).rows[0];
    assert.deepEqual(sourceRow, { status: 'unavailable', error_code: 'persistence_failure', completed_batch_count: 2, total_batch_count: 3 });
    assert.equal((await pg.query(`select count(*)::int n from public.psi_agt002_analysis_checkpoints where workset_id='${source.worksetId}'`)).rows[0].n, 4);

    const recovery = (await pg.query(`select * from public.psi_agt002_reanalysis_jobs where id='${result.recovery_job_id}'`)).rows[0];
    assert.equal(recovery.status, 'queued');
    assert.equal(recovery.completed_batch_count, 0);
    assert.equal(recovery.total_batch_count, 0);
    assert.equal(recovery.frozen_engine_input.engine_identity.idempotency_key, expectedKey);
    assert.equal(recovery.frozen_engine_input.checkpoint_generation_recovery.root_idempotency_key, ROOT_KEY);

    const fifo = await rpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: 600 });
    assert.equal(fifo.status, 'empty', 'ordinary FIFO must never claim the targeted recovery');
    const targeted = await rpc(pg, 'psi_claim_agt002_reanalysis_job_by_id', { p_job_id: result.recovery_job_id, p_lease_seconds: 600 });
    assert.equal(targeted.job_id, result.recovery_job_id);
    assert.equal(targeted.idempotency_key, expectedKey);
  } finally {
    await pg.close();
  }
});

test('097 rejects mismatched evidence atomically and exact-id claim rejects an unaudited job', async () => {
  const pg = await database();
  try {
    const source = await failedSource(pg);
    await assert.rejects(authorize(pg, source, { p_expected_output_sha256: 'f'.repeat(64) }));
    assert.equal((await pg.query('select count(*)::int n from public.psi_agt002_checkpoint_generation_recoveries')).rows[0].n, 0);
    assert.equal((await pg.query('select count(*)::int n from public.psi_agt002_reanalysis_jobs')).rows[0].n, 1);
    await assert.rejects(rpc(pg, 'psi_claim_agt002_reanalysis_job_by_id', { p_job_id: source.jobId, p_lease_seconds: 600 }));
  } finally {
    await pg.close();
  }
});

test('097 refuses a new generation when the source canonical run already exists', async () => {
  const pg = await database();
  try {
    const source = await failedSource(pg);
    await pg.exec(`
      insert into public.psi_tender_analysis_runs (
        snapshot_id, opportunity_id, tender_id, producer, method, status, result,
        critical_open_count, idempotency_key, schema_version, policy_version,
        completed_at, canonical
      ) values (
        '${SNAPSHOT}', '${OPPORTUNITY}', '${TENDER}', 'AGT-002', 'agent_ai',
        'completed', '{}'::jsonb, 0, '${ROOT_KEY}', '2', 'fixture', now(), true
      )
    `);
    await assert.rejects(authorize(pg, source), /corrida canónica persistida/);
    assert.equal((await pg.query('select count(*)::int n from public.psi_agt002_checkpoint_generation_recoveries')).rows[0].n, 0);
    assert.equal((await pg.query('select count(*)::int n from public.psi_agt002_reanalysis_jobs')).rows[0].n, 1);
  } finally {
    await pg.close();
  }
});

test('097 rollback succeeds before use and restores the ordinary claim surface', async () => {
  const pg = await database();
  try {
    await pg.exec(rollback097);
    assert.equal((await pg.query("select to_regclass('public.psi_agt002_checkpoint_generation_recoveries') v")).rows[0].v, null);
    assert.equal((await pg.query("select to_regprocedure('public.psi_claim_agt002_reanalysis_job_by_id(uuid,integer)') v")).rows[0].v, null);
    assert.ok((await pg.query("select to_regprocedure('public.psi_claim_agt002_reanalysis_job(integer)') v")).rows[0].v);
  } finally {
    await pg.close();
  }
});

test('097 rollback refuses to erase an authorized recovery and leaves its evidence intact', async () => {
  const pg = await database();
  try {
    const source = await failedSource(pg);
    await authorize(pg, source);
    await assert.rejects(pg.exec(rollback097));
    assert.equal((await pg.query('select count(*)::int n from public.psi_agt002_checkpoint_generation_recoveries')).rows[0].n, 1);
    assert.ok((await pg.query("select to_regprocedure('public.psi_claim_agt002_reanalysis_job_by_id(uuid,integer)') v")).rows[0].v);
  } finally {
    await pg.close();
  }
});

test('097 privileges keep authorization owner-only while service_role can claim only an audited exact id', async () => {
  const pg = await database();
  try {
    const privileges = (await pg.query(`
      select
        has_function_privilege('service_role', 'public.psi_authorize_agt002_checkpoint_generation_recovery(uuid,uuid,uuid,integer,integer,text,text,text)', 'EXECUTE') authorize,
        has_function_privilege('service_role', 'public.psi_claim_agt002_reanalysis_job_by_id(uuid,integer)', 'EXECUTE') target_claim,
        has_table_privilege('service_role', 'public.psi_agt002_checkpoint_generation_recoveries', 'INSERT') audit_insert,
        has_table_privilege('service_role', 'public.psi_agt002_checkpoint_generation_recoveries', 'UPDATE') audit_update,
        has_table_privilege('service_role', 'public.psi_agt002_checkpoint_generation_recoveries', 'DELETE') audit_delete
    `)).rows[0];
    assert.deepEqual(privileges, {
      authorize: false, target_claim: true, audit_insert: false, audit_update: false, audit_delete: false,
    });
  } finally {
    await pg.close();
  }
});
