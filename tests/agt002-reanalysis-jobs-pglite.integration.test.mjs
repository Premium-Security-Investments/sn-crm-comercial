import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration = strip(readFileSync(new URL('../supabase/migrations/068_agt002_reanalysis_jobs.sql', import.meta.url), 'utf8'));
const rollback = strip(readFileSync(new URL('../supabase/rollbacks/068_agt002_reanalysis_jobs_rollback.sql', import.meta.url), 'utf8'));

const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const CV = '55555555-5555-4555-8555-555555555555';
const S2 = '66666666-6666-4666-8666-666666666666';
const CV2 = '77777777-7777-4777-8777-777777777777';

async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null);
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key);
    create table public.psi_tender_document_snapshots (id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id));
    create table public.psi_agt002_context_versions (id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id), snapshot_id uuid not null references public.psi_tender_document_snapshots(id));
    create table public.psi_tender_analysis_runs (
      id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.psi_tender_document_snapshots(id),
      opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id),
      producer text not null, method text not null, status text not null, canonical boolean not null default false,
      created_at timestamptz not null default now(), completed_at timestamptz
    );
    insert into public.psi_sales_profiles values ('${ACTOR}', true, 'admin');
    insert into public.psi_sales_opportunities values ('${O}');
    insert into public.psi_public_tenders values ('${T}');
    insert into public.psi_tender_document_snapshots values ('${S}','${O}','${T}');
    insert into public.psi_tender_document_snapshots values ('${S2}','${O}','${T}');
    insert into public.psi_agt002_context_versions values ('${CV}','${O}','${T}','${S}');
    insert into public.psi_agt002_context_versions values ('${CV2}','${O}','${T}','${S2}');
  `);
  await pg.exec(migration);
  return pg;
}

function frozenInput(tag = 'v1') {
  return JSON.stringify({ manifest: tag, chunks: [1, 2, 3] });
}

async function run() {
  const pg = await freshDb();

  // Create: first call creates a queued job, frozen to the given context version.
  const created = (await pg.query(
    `select public.psi_create_agt002_reanalysis_job('${O}','${T}','${S}','${CV}','key-a','${frozenInput()}'::jsonb,'${ACTOR}') r`,
  )).rows[0].r;
  assert.equal(created.status, 'created');
  const jobId = created.job_id;
  assert.ok(jobId);
  assert.equal((await pg.query(`select context_version_id from public.psi_agt002_reanalysis_jobs where id='${jobId}'`)).rows[0].context_version_id, CV);

  // Idempotent replay by key returns the same job.
  const replay = (await pg.query(
    `select public.psi_create_agt002_reanalysis_job('${O}','${T}','${S}','${CV}','key-a','${frozenInput()}'::jsonb,'${ACTOR}') r`,
  )).rows[0].r;
  assert.equal(replay.status, 'existing');
  assert.equal(replay.job_id, jobId);

  // A different identity/input can never be mislabeled as the active job. It fails
  // closed rather than creating a second active row or returning the wrong job id.
  await assert.rejects(
    pg.query(`select public.psi_create_agt002_reanalysis_job('${O}','${T}','${S}','${CV}','key-b','${frozenInput('v2')}'::jsonb,'${ACTOR}')`),
    /otro trabajo|activo/i,
  );

  // context_version_id is required, and validated for identity even while an active job
  // already exists (identity checks run before the active-job dedup, not after).
  await assert.rejects(
    pg.query(`select public.psi_create_agt002_reanalysis_job('${O}','${T}','${S}',null,'key-null','${frozenInput('v-null')}'::jsonb,'${ACTOR}')`),
    /context/i,
  );
  await assert.rejects(
    pg.query(`select public.psi_create_agt002_reanalysis_job('${O}','${T}','${S}','${CV2}','key-mismatch','${frozenInput('v-mismatch')}'::jsonb,'${ACTOR}')`),
    /contexto/i,
  );

  // Frozen identity/input columns are immutable after insert.
  await assert.rejects(
    pg.exec(`update public.psi_agt002_reanalysis_jobs set frozen_engine_input = '{"tampered":true}'::jsonb where id='${jobId}'`),
    /inmutable/i,
  );
  await assert.rejects(
    pg.exec(`update public.psi_agt002_reanalysis_jobs set opportunity_id = '${T}' where id='${jobId}'`),
    /inmutable/i,
  );
  await assert.rejects(
    pg.exec(`update public.psi_agt002_reanalysis_jobs set context_version_id = '${CV2}' where id='${jobId}'`),
    /inmutable/i,
  );

  // Claim: FOR UPDATE SKIP LOCKED path claims the sole queued job, bounds the lease, and
  // returns the frozen context_version_id.
  const claimed = (await pg.query(`select public.psi_claim_agt002_reanalysis_job(100000) r`)).rows[0].r;
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.job_id, jobId);
  assert.equal(claimed.context_version_id, CV);
  assert.ok(claimed.lease_id);
  const leaseId = claimed.lease_id;
  const leaseExpires = Date.parse(claimed.lease_expires_at);
  assert.ok(leaseExpires - Date.now() <= 601_000, 'lease must be bounded to at most ~600s regardless of requested value');

  // No second job available: claim now returns empty.
  const emptyClaim = (await pg.query(`select public.psi_claim_agt002_reanalysis_job(60) r`)).rows[0].r;
  assert.equal(emptyClaim.status, 'empty');

  // The same fail-closed identity rule applies while the job is running.
  await assert.rejects(
    pg.query(`select public.psi_create_agt002_reanalysis_job('${O}','${T}','${S}','${CV}','key-c','${frozenInput('v3')}'::jsonb,'${ACTOR}')`),
    /otro trabajo|activo/i,
  );

  // Complete requires a real canonical run: reject a non-canonical / non-completed run.
  const nonCanonicalRun = (await pg.query(
    `insert into public.psi_tender_analysis_runs (snapshot_id, opportunity_id, tender_id, producer, method, status, canonical)
     values ('${S}','${O}','${T}','siio_rules_v1','rules','completed',false) returning id`,
  )).rows[0].id;
  await assert.rejects(
    pg.query(`select public.psi_complete_agt002_reanalysis_job('${jobId}','${leaseId}','${nonCanonicalRun}')`),
    /canónic/i,
  );

  // Complete rejects a mismatched lease.
  await assert.rejects(
    pg.query(`select public.psi_complete_agt002_reanalysis_job('${jobId}', gen_random_uuid(), '${nonCanonicalRun}')`),
    /lease|reserva/i,
  );

  const canonicalRun = (await pg.query(
    `insert into public.psi_tender_analysis_runs (snapshot_id, opportunity_id, tender_id, producer, method, status, canonical)
     values ('${S}','${O}','${T}','AGT-002','agent_ai','completed',true) returning id`,
  )).rows[0].id;

  const completed = (await pg.query(
    `select public.psi_complete_agt002_reanalysis_job('${jobId}','${leaseId}','${canonicalRun}') r`,
  )).rows[0].r;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.analysis_run_id, canonicalRun);

  // Completion clears the lease: a completed job can never be mistaken for a live claim.
  const completedRow = (await pg.query(`select lease_id, lease_expires_at from public.psi_agt002_reanalysis_jobs where id='${jobId}'`)).rows[0];
  assert.equal(completedRow.lease_id, null);
  assert.equal(completedRow.lease_expires_at, null);

  // Idempotent replay of complete with the same run id returns existing, not an error.
  const completeReplay = (await pg.query(
    `select public.psi_complete_agt002_reanalysis_job('${jobId}','${leaseId}','${canonicalRun}') r`,
  )).rows[0].r;
  assert.equal(completeReplay.status, 'existing');

  // A terminal completed job can never transition again.
  await assert.rejects(
    pg.query(`select public.psi_fail_agt002_reanalysis_job('${jobId}','${leaseId}','timeout')`),
    /terminal|completed/i,
  );

  // --- Lease-expiry sweep: a job that crashes mid-run (never completed, never failed)
  // must never sit claimable again, and must never be silently requeued. The very next
  // claim call closes it out as unavailable/lease_lost before looking for other work.
  const sweepJob = (await pg.query(
    `select public.psi_create_agt002_reanalysis_job('${O}','${T}','${S}','${CV}','key-sweep','${frozenInput('v-sweep')}'::jsonb,'${ACTOR}') r`,
  )).rows[0].r;
  assert.equal(sweepJob.status, 'created');
  const sweepClaim = (await pg.query(`select public.psi_claim_agt002_reanalysis_job(60) r`)).rows[0].r;
  assert.equal(sweepClaim.job_id, sweepJob.job_id);

  // Simulate a crashed worker: the lease silently expires without a complete/fail call.
  await pg.exec(`update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() - interval '1 hour' where id='${sweepJob.job_id}'`);

  const claimAfterExpiry = (await pg.query(`select public.psi_claim_agt002_reanalysis_job(60) r`)).rows[0].r;
  assert.equal(claimAfterExpiry.status, 'empty', 'the sweep closes the expired job out; it is never handed back as newly claimed');

  const sweptRow = (await pg.query(
    `select status, error_code, error_message, lease_id, lease_expires_at, completed_at from public.psi_agt002_reanalysis_jobs where id='${sweepJob.job_id}'`,
  )).rows[0];
  assert.equal(sweptRow.status, 'unavailable');
  assert.equal(sweptRow.error_code, 'lease_lost');
  assert.ok(sweptRow.error_message && sweptRow.error_message.length > 0);
  assert.equal(sweptRow.lease_id, null);
  assert.equal(sweptRow.lease_expires_at, null);
  assert.ok(sweptRow.completed_at);

  // Never reclaimable again: a further claim call still finds nothing for this job.
  const claimAfterSweep = (await pg.query(`select public.psi_claim_agt002_reanalysis_job(60) r`)).rows[0].r;
  assert.equal(claimAfterSweep.status, 'empty');

  // --- Fail path: closed error codes only, and fail also clears the lease.
  const secondJob = (await pg.query(
    `select public.psi_create_agt002_reanalysis_job('${O}','${T}','${S}','${CV}','key-d','${frozenInput('v4')}'::jsonb,'${ACTOR}') r`,
  )).rows[0].r;
  assert.equal(secondJob.status, 'created');
  const secondClaim = (await pg.query(`select public.psi_claim_agt002_reanalysis_job(60) r`)).rows[0].r;
  assert.equal(secondClaim.job_id, secondJob.job_id);

  // Fail rejects any error code outside the closed set (no raw provider text ever accepted).
  await assert.rejects(
    pg.query(`select public.psi_fail_agt002_reanalysis_job('${secondJob.job_id}','${secondClaim.lease_id}','raw provider secret leak')`),
    /error/i,
  );

  const failed = (await pg.query(
    `select public.psi_fail_agt002_reanalysis_job('${secondJob.job_id}','${secondClaim.lease_id}','provider_error') r`,
  )).rows[0].r;
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.error_code, 'provider_error');
  assert.ok(failed.error_message && failed.error_message.length > 0);

  const failedRow = (await pg.query(`select lease_id, lease_expires_at from public.psi_agt002_reanalysis_jobs where id='${secondJob.job_id}'`)).rows[0];
  assert.equal(failedRow.lease_id, null);
  assert.equal(failedRow.lease_expires_at, null);

  // Unavailable never requeues automatically: no queued job remains for this opportunity.
  const afterFailClaim = (await pg.query(`select public.psi_claim_agt002_reanalysis_job(60) r`)).rows[0].r;
  assert.equal(afterFailClaim.status, 'empty');

  // A new explicit human retry with the exact same deterministic identity/input creates
  // a fresh queued row. The terminal unavailable row remains immutable history and is
  // never mislabeled as running or claimed again.
  const explicitRetry = (await pg.query(
    `select public.psi_create_agt002_reanalysis_job('${O}','${T}','${S}','${CV}','key-d','${frozenInput('v4')}'::jsonb,'${ACTOR}') r`,
  )).rows[0].r;
  assert.equal(explicitRetry.status, 'created');
  assert.notEqual(explicitRetry.job_id, secondJob.job_id);
  const sameIdentityRows = (await pg.query(`select id, status from public.psi_agt002_reanalysis_jobs where idempotency_key='key-d' order by created_at, id`)).rows;
  assert.equal(sameIdentityRows.length, 2);
  assert.equal(sameIdentityRows.find(row => row.id === secondJob.job_id)?.status, 'unavailable');
  assert.equal(sameIdentityRows.find(row => row.id === explicitRetry.job_id)?.status, 'queued');
  const retryClaim = (await pg.query(`select public.psi_claim_agt002_reanalysis_job(60) r`)).rows[0].r;
  assert.equal(retryClaim.job_id, explicitRetry.job_id);

  // Rollback fails closed while any row (including terminal history) exists.
  await assert.rejects(pg.exec(rollback), /bloque|histor/i);

  await pg.exec(`delete from public.psi_agt002_reanalysis_jobs`);
  await pg.exec(rollback);
  const remaining = (await pg.query(`select to_regclass('public.psi_agt002_reanalysis_jobs') as t`)).rows[0].t;
  assert.equal(remaining, null);

  console.log('agt002-reanalysis-jobs pglite integration passed');
}

run();
