// AGT-002 operator recovery — real PostgreSQL advisory-lock concurrency evidence.
//
// Complements tests/agt002-operator-recovery-slot-migration.test.mjs (which proves, statically,
// that migration 089's psi_authorize_agt002_operator_recovery function takes
// pg_advisory_xact_lock(hashtextextended('agt002-canonical:' || opportunity_id::text, 0)) in
// exactly the right place). This suite is release evidence, not a design proof: it drives that
// same lock expression on a real PostgreSQL engine (not PGlite) with two truly independent
// sessions — separate OS processes, separate connections — to demonstrate the lock actually
// serializes concurrent work on the same opportunity, end to end, the way production psql/libpq
// clients would see it.
//
// Skipped entirely unless AGT002_TEST_POSTGRES_URL points at a reachable PostgreSQL instance.
// Uses the `psql` CLI via child_process only — no pg/postgres npm client is added. The schema
// under test is a uniquely named, disposable schema (name generated internally from hex only,
// never derived from any external input) containing two tiny tables of its own; nothing in
// supabase/migrations or supabase/rollbacks is touched, and the schema is always dropped in a
// finally block.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const POSTGRES_URL = process.env.AGT002_TEST_POSTGRES_URL;
const SKIP_REASON = 'set AGT002_TEST_POSTGRES_URL to a reachable PostgreSQL connection string to run this integration test';

// Fixed, hardcoded opportunity id: both sessions lock on the exact same
// 'agt002-canonical:' || opportunity::text key, so the fixture never needs to invent one.
const OPPORTUNITY_ID = '00000000-0000-4000-8000-0000000c0002';

const CHILD_TIMEOUT_MS = 15_000;
const MARKER_A = 'AGT002_ORP_LOCK_ACQUIRED_A';
const WAITED_PREFIX = 'AGT002_ORP_WAITED_MS=';

/** Schema name generated internally from hex only: never built from user/external input, so it
 * is always a safe bare identifier to interpolate directly into DDL text. */
function makeSchemaName() {
  return `agt002_orp_${randomBytes(8).toString('hex')}`;
}

/** Spawns one independent psql session against a temp script file. The connection URL is passed
 * as a plain argv element (no shell involved, so nothing is shell-interpolated); psql itself
 * parses it as a libpq connection string. */
function spawnPsql(url, sqlScript, { timeoutMs = CHILD_TIMEOUT_MS, extraEnv = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agt002-orp-'));
  const scriptPath = join(dir, 'script.sql');
  writeFileSync(scriptPath, sqlScript, 'utf8');

  const child = spawn('psql', [url, '-X', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-f', scriptPath], {
    env: { ...process.env, PGCONNECT_TIMEOUT: '10', ...extraEnv },
  });

  let stdout = '';
  let stderr = '';
  const dataListeners = new Set();
  child.stdout.on('data', chunk => {
    stdout += chunk.toString('utf8');
    for (const listener of dataListeners) listener();
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

  const killTimer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const done = new Promise(resolvePromise => {
    child.on('close', code => {
      clearTimeout(killTimer);
      rmSync(dir, { recursive: true, force: true });
      resolvePromise({ code, stdout, stderr });
    });
    child.on('error', error => {
      clearTimeout(killTimer);
      rmSync(dir, { recursive: true, force: true });
      resolvePromise({ code: -1, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });

  function waitForMarker(marker) {
    return new Promise((resolveMarker, rejectMarker) => {
      if (stdout.includes(marker)) { resolveMarker(); return; }
      const waitTimer = setTimeout(() => {
        dataListeners.delete(onData);
        rejectMarker(new Error(`timed out waiting for marker ${marker}; stdout so far: ${stdout}`));
      }, CHILD_TIMEOUT_MS);
      function onData() {
        if (stdout.includes(marker)) {
          clearTimeout(waitTimer);
          dataListeners.delete(onData);
          resolveMarker();
        }
      }
      dataListeners.add(onData);
    });
  }

  return { done, waitForMarker };
}

async function runPsqlOnce(url, sqlScript, options) {
  return spawnPsql(url, sqlScript, options).done;
}

async function queryScalar(url, sql, options) {
  const result = await runPsqlOnce(url, sql, options);
  assert.equal(result.code, 0, `query must succeed: ${sql}\n${result.stderr}`);
  // Take the last non-empty output line: a script may be prefixed with a non-SELECT
  // statement (e.g. `set role ...;`) whose own status tag (e.g. "SET") is still printed
  // even under -t -A, since that suppresses only SELECT result headers/footers.
  const lines = result.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  return lines[lines.length - 1] ?? '';
}

test(
  'two independent psql sessions serialize through the AGT-002 canonical advisory lock on real PostgreSQL',
  { skip: POSTGRES_URL ? false : SKIP_REASON },
  async () => {
    const schema = makeSchemaName();
    try {
      const setup = await runPsqlOnce(POSTGRES_URL, `
        set statement_timeout = '10s';
        create schema ${schema};
        create table ${schema}.canonical_runs (
          id bigserial primary key,
          opportunity uuid not null,
          created_at timestamptz not null default now()
        );
        create table ${schema}.recovery_events (
          id bigserial primary key,
          opportunity uuid not null,
          note text not null,
          created_at timestamptz not null default now()
        );
      `);
      assert.equal(setup.code, 0, `schema/table setup must succeed: ${setup.stderr}`);

      // Session A: BEGIN, take the advisory lock, announce it holds the lock, insert the
      // canonical run, hold the lock for ~1s, then commit (which releases the xact lock).
      const sessionA = spawnPsql(POSTGRES_URL, `
        set statement_timeout = '10s';
        begin;
        select pg_advisory_xact_lock(hashtextextended('agt002-canonical:' || '${OPPORTUNITY_ID}'::uuid::text, 0));
        \\echo ${MARKER_A}
        insert into ${schema}.canonical_runs (opportunity) values ('${OPPORTUNITY_ID}'::uuid);
        select pg_sleep(1);
        commit;
      `);

      await sessionA.waitForMarker(MARKER_A);

      // Session B starts only after A's marker: it records the time before requesting the
      // identical advisory lock, blocks behind A, then only writes a recovery_events row if no
      // canonical_runs row exists yet for the opportunity (it never will here, since A already
      // committed by the time B's lock request returns).
      const sessionB = spawnPsql(POSTGRES_URL, `
        set statement_timeout = '10s';
        begin;
        select clock_timestamp() as t_wait_start \\gset
        select pg_advisory_xact_lock(hashtextextended('agt002-canonical:' || '${OPPORTUNITY_ID}'::uuid::text, 0));
        select clock_timestamp() as t_wait_end \\gset
        insert into ${schema}.recovery_events (opportunity, note)
        select '${OPPORTUNITY_ID}'::uuid, 'no-canonical-run-found'
        where not exists (
          select 1 from ${schema}.canonical_runs where opportunity = '${OPPORTUNITY_ID}'::uuid
        );
        commit;
        select '${WAITED_PREFIX}' || (extract(epoch from (:'t_wait_end'::timestamptz - :'t_wait_start'::timestamptz)) * 1000)::numeric(12,3);
      `);

      const [resultA, resultB] = await Promise.all([sessionA.done, sessionB.done]);

      assert.equal(resultA.code, 0, `session A must exit 0: ${resultA.stderr}`);
      assert.equal(resultB.code, 0, `session B must exit 0: ${resultB.stderr}`);

      const waitedMatch = resultB.stdout.match(new RegExp(`${WAITED_PREFIX}([0-9.]+)`));
      assert.ok(waitedMatch, `session B must report its waited duration; stdout: ${resultB.stdout}`);
      const waitedMs = Number(waitedMatch[1]);
      assert.ok(
        waitedMs >= 700,
        `session B must have waited materially for the lock session A held (waited ${waitedMs}ms, expected >= 700ms)`,
      );

      const canonicalRunsCount = Number(await queryScalar(POSTGRES_URL, `select count(*) from ${schema}.canonical_runs;`));
      const recoveryEventsCount = Number(await queryScalar(POSTGRES_URL, `select count(*) from ${schema}.recovery_events;`));
      assert.equal(canonicalRunsCount, 1, 'exactly one canonical_runs row must exist: only session A ever wrote one');
      assert.equal(recoveryEventsCount, 0, 'no recovery_events row must exist: by the time session B checked, the canonical run already existed');
    } finally {
      try {
        await runPsqlOnce(POSTGRES_URL, `drop schema if exists ${schema} cascade;`);
      } catch (error) {
        console.error(`failed to drop schema ${schema}:`, error);
      }
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Second suite (Phase 1): a real-PostgreSQL, real-migration-chain check that migration 089's
// objects actually get created, complementing the PGlite suite
// (tests/agt002-operator-recovery-slot-migration-pglite.integration.test.mjs) against a real
// PostgreSQL engine's actual role/grant/extension handling instead of PGlite's.
//
// This phase only builds the schema up through the real, unmodified migration chain (the same
// minimal fixture tables/functions createBaseDatabase() uses in the PGlite suite, then migrations
// 050/051/053/056/063/067/068/076/077/028/079/081/089/090 in that exact order) and asserts that
// migration 089's objects exist: the audit table, the authorize function, and the jobs table's
// operator_recovery_id column -- and, layered on top, that migration 090's objects exist too: the
// context-recovery audit table, the jobs table's context_recovery_id column, and the
// psi_authorize_agt002_context_recovery(uuid,uuid,integer,text,text) function. It does not yet drive
// any job/recovery/role flow through those objects -- that is later phases' job.
//
// Unlike the two-session suite above (which only ever touches its own uniquely named, disposable
// schema), this suite resets the entire `public` schema: the real migrations create
// public-schema roles and SECURITY DEFINER functions that are only meaningfully exercised in
// `public`. That is destructive to whatever else may live in `public` on the target database, so
// this suite requires an explicit second opt-in (AGT002_TEST_POSTGRES_DESTRUCTIVE='1') on top of
// AGT002_TEST_POSTGRES_URL, and additionally refuses to run unless the URL's hostname is exactly
// 127.0.0.1 or localhost -- it must only ever be pointed at a dedicated, disposable,
// local/ephemeral PostgreSQL instance, never a shared or remote one. The `public` schema is reset
// (dropped and recreated) both before building the fixture/migrations and, unconditionally, in a
// finally block.
const DESTRUCTIVE_ENABLED = process.env.AGT002_TEST_POSTGRES_DESTRUCTIVE === '1';

/** Returns true only for a libpq URL whose hostname is exactly 127.0.0.1 or localhost; false
 * (never throws) for anything else, including a non-URL (e.g. keyword/value) connection string,
 * so an unparseable or unrecognized target fails closed into "not allowed". */
function isLoopbackPostgresUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost';
  } catch {
    return false;
  }
}

const DESTRUCTIVE_ALLOWED = Boolean(POSTGRES_URL) && DESTRUCTIVE_ENABLED && isLoopbackPostgresUrl(POSTGRES_URL);
const DESTRUCTIVE_SKIP_REASON =
  "set AGT002_TEST_POSTGRES_URL (hostname 127.0.0.1 or localhost only), and AGT002_TEST_POSTGRES_DESTRUCTIVE='1', " +
  'to run this schema-resetting real-migration-chain integration test';
const DESTRUCTIVE_CHILD_TIMEOUT_MS = 60_000;

const stripTopLevelBeginCommit = sql => sql.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const readMigration = name => stripTopLevelBeginCommit(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));

// Exact real migration order the PGlite 089 suite already proves this fixture works under,
// extended with 091 (which every destructive test below now builds on top of, harmlessly: 091
// only replaces the jobs guard trigger function in place to additionally recognize
// validation_recovery_id, and adds its own separate table/column/function, so none of the
// existing 089/090-only assertions below are affected by its presence).
const DESTRUCTIVE_MIGRATIONS_SQL = [
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
].map(readMigration).join('\n\n');

// Fixed, synthetic-only identifiers: the exact same literal ids the PGlite 089 suite's
// createBaseDatabase() fixture uses. No real expediente/opportunity/tender data.
const D_PROFILE_ID = '44444444-4444-4444-8444-444444444444';
const D_OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const D_OPPORTUNITY_ID_2 = '55555555-5555-4555-8555-555555555555';
const D_TENDER_ID = '22222222-2222-4222-8222-222222222222';
const D_SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';

// Minimal fixture DDL, exactly as createBaseDatabase() in
// tests/agt002-operator-recovery-slot-migration-pglite.integration.test.mjs, minus the role
// creation (handled separately below, with real-PostgreSQL-specific BYPASSRLS/pgcrypto setup).
const DESTRUCTIVE_FIXTURE_SQL = `
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
  returns trigger language plpgsql as $fn$
  begin
    raise exception 'psi_tender_analysis_runs is append-only: UPDATE and DELETE are prohibited';
  end;
  $fn$;
  create trigger psi_tender_analysis_runs_immutable
    before update or delete on public.psi_tender_analysis_runs
    for each row execute function public.psi_tender_analysis_runs_prevent_mutation();
  insert into public.psi_sales_profiles values ('${D_PROFILE_ID}', true, 'human', 'Ana Revisora', 'admin');
  insert into public.psi_sales_opportunities values ('${D_OPPORTUNITY_ID}');
  insert into public.psi_sales_opportunities values ('${D_OPPORTUNITY_ID_2}');
  insert into public.psi_public_tenders values ('${D_TENDER_ID}');
  insert into public.psi_tender_document_snapshots values ('${D_SNAPSHOT_ID}','${D_OPPORTUNITY_ID}','${D_TENDER_ID}');
`;

async function resetPublicSchema() {
  await runPsqlOnce(
    POSTGRES_URL,
    'drop schema if exists public cascade; create schema public; grant usage, create on schema public to current_user;',
    { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
  );
}

// ---------------------------------------------------------------------------------------------
// Phase 2: after the fixture/migration chain above builds migration 089's objects, drive a real
// job through the exact same RPC sequence as setupAtCapUnavailableJob() in
// tests/agt002-operator-recovery-slot-migration-pglite.integration.test.mjs -- record a context
// version, create a workset/job, claim it, record two contiguous semantic_discovery_batch
// checkpoints, run five expire/reclaim cycles to the automatic cap, fail with error_code=timeout,
// then authorize the operator recovery -- but here as one owner-session psql script (ON_ERROR_STOP
// plus \gset chaining), the exact real RPC signatures instead of a hand-shaped fixture. All ids are
// the same fixed, synthetic D_* constants the migration-089-objects check above already uses.
const DEFECT_COMMIT_SHA_EXPR = "repeat('deadbeef', 5)"; // 40 lowercase hex chars, same as the PGlite suite's DEFECT_SHA
const CONTEXT_HASH_EXPR = "repeat('a1b2c3d4', 8)"; // 64 lowercase hex chars: both the real context_hash recorded on the fixture's governed context version and the expected_context_hash a real context-recovery authorize call must reproduce
const REPAIR_COMMIT_SHA_EXPR = "repeat('cafebabe', 5)"; // 40 lowercase hex chars, migration 090's repair_commit_sha, distinct from DEFECT_COMMIT_SHA_EXPR
const WRONG_CONTEXT_HASH_EXPR = "repeat('f9e8d7c6', 8)"; // 64 lowercase hex chars, well-formed but distinct from CONTEXT_HASH_EXPR: proves a mismatched expected_context_hash denies context/validation recovery
const CONTEXT_HASH_LITERAL = 'a1b2c3d4'.repeat(8); // JS-side twin of CONTEXT_HASH_EXPR, for asserting the exact hash migration 091 records
const REJECTED_OUTPUT_HASH_EXPR = "repeat('13579bdf', 8)"; // 64 lowercase hex chars: migration 091's attested_rejected_output_hash (the admin/operator's manual attestation of the engine's rejected output, per psi_agt002_validation_recoveries.attested_rejected_output_hash)
const REJECTED_OUTPUT_HASH_LITERAL = '13579bdf'.repeat(8); // JS-side twin of REJECTED_OUTPUT_HASH_EXPR
const MALFORMED_REJECTED_OUTPUT_HASH_EXPR = "repeat('zz', 32)"; // 64 characters but not hex: proves a malformed attested_rejected_output_hash is rejected before ever touching the job row
const ALT_REJECTED_OUTPUT_HASH_EXPR = "repeat('2468ace0', 8)"; // 64 lowercase hex chars, well-formed but distinct from REJECTED_OUTPUT_HASH_EXPR and MALFORMED_REJECTED_OUTPUT_HASH_EXPR: attested_rejected_output_hash is the admin's own manual attestation (never verified against any persisted validator output, per the migration's column comment), so this alternate, equally well-formed hash must be accepted and recorded exactly like REJECTED_OUTPUT_HASH_EXPR would be
const ALT_REJECTED_OUTPUT_HASH_LITERAL = '2468ace0'.repeat(8); // JS-side twin of ALT_REJECTED_OUTPUT_HASH_EXPR
const REPAIR_COMMIT_SHA_091_EXPR = "repeat('abcdef01', 5)"; // 40 lowercase hex chars, migration 091's repair_commit_sha, distinct from DEFECT_COMMIT_SHA_EXPR and REPAIR_COMMIT_SHA_EXPR
const REPAIR_COMMIT_SHA_091_LITERAL = 'abcdef01'.repeat(5); // JS-side twin of REPAIR_COMMIT_SHA_091_EXPR

/** The owner-session setup portion: everything through failing the job with error_code=timeout,
 * leaving it 'unavailable' at the automatic resume_count cap of 5 with two contiguous
 * semantic_discovery_batch checkpoints -- but stopping short of authorization, so callers that
 * need to race something else against the authorize call (below) can drive it themselves. Every
 * \gset variable it sets (job_id, workset_id, lease_id, owner_session_user, ...) is scoped to this
 * one psql session. The governed context version's own root shape (context_version/snapshot_id/
 * opportunity/company_dossier/commercial_context/human_evidence) and its context_hash
 * (CONTEXT_HASH_EXPR) are the exact production shape migration 090's authorize function requires;
 * the job's frozen_engine_input carries an analysis_context without contextV2Sections and
 * analysis_flags.AGT002_CONTEXT_V2 = true, the exact 090 context-recovery precondition -- so this
 * same setup underlies both the 089-only tests below and the 090 context-recovery tests further
 * down. */
function buildOperatorRecoverySetupSql() {
  return `
    set statement_timeout = '${DESTRUCTIVE_CHILD_TIMEOUT_MS}ms';

    select session_user as owner_session_user \\gset

    select (public.psi_record_agt002_context_version(
      '${D_OPPORTUNITY_ID}'::uuid, '${D_TENDER_ID}'::uuid, '${D_SNAPSHOT_ID}'::uuid, 2,
      jsonb_build_object(
        'context_version', 2,
        'snapshot_id', '${D_SNAPSHOT_ID}',
        'opportunity', '{}'::jsonb,
        'company_dossier', '{}'::jsonb,
        'commercial_context', '{}'::jsonb,
        'human_evidence', '[]'::jsonb
      ),
      ${CONTEXT_HASH_EXPR}, 0, 'context-key-1', '${D_PROFILE_ID}'::uuid
    )) ->> 'id' as context_version_id \\gset

    select (public.psi_get_or_create_agt002_analysis_workset(
      '${D_OPPORTUNITY_ID}'::uuid, '${D_TENDER_ID}'::uuid, '${D_SNAPSHOT_ID}'::uuid, :'context_version_id'::uuid,
      'workset-key-1',
      jsonb_build_object(
        'model', 'test-model', 'reasoning_effort', 'medium', 'v3_policy_version', 'v3-policy-1',
        'discovery_policy_version', 'discovery-policy-1', 'analysis_batch_policy_version', 'analysis-batch-policy-1',
        'inventory_hash', repeat('a', 64), 'snapshot_hash', repeat('b', 64), 'frozen_engine_input_hash', repeat('c', 64),
        'company_evidence_identity', 'evidence-v1', 'legal_corpus_identity', 'corpus-v1'
      )
    )) ->> 'workset_id' as workset_id \\gset

    select (public.psi_create_agt002_reanalysis_job(
      '${D_OPPORTUNITY_ID}'::uuid, '${D_TENDER_ID}'::uuid, '${D_SNAPSHOT_ID}'::uuid, :'context_version_id'::uuid,
      'workset-key-1',
      jsonb_build_object(
        'manifest', 'v1',
        'analysis_context', jsonb_build_object('note', 'legacy synthetic context'),
        'analysis_flags', jsonb_build_object('AGT002_CONTEXT_V2', true)
      ),
      '${D_PROFILE_ID}'::uuid
    )) ->> 'job_id' as job_id \\gset

    select (public.psi_claim_agt002_reanalysis_job(600)) ->> 'lease_id' as lease_id \\gset

    select public.psi_record_agt002_analysis_checkpoint(
      :'job_id'::uuid, :'lease_id'::uuid, :'workset_id'::uuid, 'semantic_discovery_batch', 0,
      repeat('d', 64), 'discovery-batch-contract-v1',
      jsonb_build_object('batch_index', 0, 'units', '[]'::jsonb), repeat('e', 64),
      jsonb_build_object('input_tokens', 10, 'output_tokens', 2), 'provider-key-v1-0',
      'semantic_discovery', 1, 3
    );

    select public.psi_record_agt002_analysis_checkpoint(
      :'job_id'::uuid, :'lease_id'::uuid, :'workset_id'::uuid, 'semantic_discovery_batch', 1,
      repeat('d', 64), 'discovery-batch-contract-v1',
      jsonb_build_object('batch_index', 1, 'units', '[]'::jsonb), repeat('e', 64),
      jsonb_build_object('input_tokens', 10, 'output_tokens', 2), 'provider-key-v1-1',
      'semantic_discovery', 2, 3
    );

    update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() - interval '1 hour' where id = :'job_id'::uuid;
    select (public.psi_claim_agt002_reanalysis_job(600)) ->> 'lease_id' as lease_id \\gset

    update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() - interval '1 hour' where id = :'job_id'::uuid;
    select (public.psi_claim_agt002_reanalysis_job(600)) ->> 'lease_id' as lease_id \\gset

    update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() - interval '1 hour' where id = :'job_id'::uuid;
    select (public.psi_claim_agt002_reanalysis_job(600)) ->> 'lease_id' as lease_id \\gset

    update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() - interval '1 hour' where id = :'job_id'::uuid;
    select (public.psi_claim_agt002_reanalysis_job(600)) ->> 'lease_id' as lease_id \\gset

    update public.psi_agt002_reanalysis_jobs set lease_expires_at = now() - interval '1 hour' where id = :'job_id'::uuid;
    select (public.psi_claim_agt002_reanalysis_job(600)) ->> 'lease_id' as lease_id \\gset

    -- Poor-man's assert: exactly five reclaim cycles above must have left resume_count at the
    -- automatic cap. Under ON_ERROR_STOP=1 the deliberate division-by-zero aborts the whole
    -- script (nonzero exit) if that is ever not true, instead of silently continuing.
    select 1 / (case when (select resume_count from public.psi_agt002_reanalysis_jobs where id = :'job_id'::uuid) = 5 then 1 else 0 end) as resume_count_must_be_5;

    select public.psi_fail_agt002_reanalysis_job(:'job_id'::uuid, :'lease_id'::uuid, 'timeout');
  `;
}

/** The authorize portion, run in the same owner session immediately after the setup portion
 * above: calls the real authorize RPC and ends in exactly one delimiter-safe concat_ws('|', ...)
 * scalar for the JS side to parse and assert on. Split out from the setup portion so a caller can
 * stop at the at-cap 'unavailable' job (setup only) instead of authorizing it here. */
function buildOperatorRecoveryAuthorizeSql() {
  return `
    select (public.psi_authorize_agt002_operator_recovery(
      :'job_id'::uuid, :'workset_id'::uuid, 2, ${DEFECT_COMMIT_SHA_EXPR}
    )) ->> 'operator_recovery_id' as operator_recovery_id \\gset

    select status as final_status, resume_count::text as final_resume_count,
           operator_recovery_id::text as final_job_operator_recovery_id
    from public.psi_agt002_reanalysis_jobs where id = :'job_id'::uuid \\gset

    select count(*)::text as final_audit_count from public.psi_agt002_operator_recoveries where job_id = :'job_id'::uuid \\gset
    select authorized_by as final_authorized_by, reason_code as final_reason_code
    from public.psi_agt002_operator_recoveries where job_id = :'job_id'::uuid \\gset

    select concat_ws('|',
      :'job_id', :'workset_id', :'final_status', :'final_resume_count', :'final_audit_count',
      :'final_authorized_by', :'owner_session_user', :'final_reason_code',
      :'operator_recovery_id', :'final_job_operator_recovery_id'
    );
  `;
}

/** The owner-session recovery script used by the migration-089-objects test below: setup through
 * authorization, in one owner session. */
function buildOperatorRecoveryScriptSql() {
  return buildOperatorRecoverySetupSql() + buildOperatorRecoveryAuthorizeSql();
}

/** Setup-only variant for the authorization-vs-rollback race test below: stops right after the
 * job is failed into 'unavailable' at the automatic cap, and reports job_id/workset_id instead of
 * authorizing -- the race test authorizes separately, from its own second session. */
function buildOperatorRecoverySetupOnlySql() {
  return buildOperatorRecoverySetupSql() + `
    select concat_ws('|', :'job_id', :'workset_id');
  `;
}

/** Setup-only variant for migration 090's context-recovery race test below: extends the owner
 * script through a real 089 operator recovery (buildOperatorRecoveryScriptSql), then claims the
 * requeued job again, completes the final unit of semantic-discovery work with a semantic_manifest
 * checkpoint (batch_index 0, completed_batch_count/total_batch_count both 3, i.e. N/N), and fails
 * the job a SECOND time with invalid_output -- leaving it 'unavailable' at the same automatic cap
 * (resume_count=5), still bound to its 089 operator_recovery_id, with context_recovery_id still
 * null: the exact real 090 context-recovery precondition. Reports job_id/workset_id/the prior
 * operator_recovery_id instead of authorizing -- the race test authorizes context recovery
 * separately, from its own second session. */
function buildContextRecoverySetupOnlySql() {
  return buildOperatorRecoveryScriptSql() + `
    select (public.psi_claim_agt002_reanalysis_job(600)) ->> 'lease_id' as lease_id \\gset

    select public.psi_record_agt002_analysis_checkpoint(
      :'job_id'::uuid, :'lease_id'::uuid, :'workset_id'::uuid, 'semantic_manifest', 0,
      repeat('d', 64), 'manifest-contract-v1',
      jsonb_build_object('manifest', true), repeat('e', 64),
      jsonb_build_object('input_tokens', 5, 'output_tokens', 1), 'provider-key-v1-manifest',
      'semantic_discovery', 3, 3
    );

    select public.psi_fail_agt002_reanalysis_job(:'job_id'::uuid, :'lease_id'::uuid, 'invalid_output');

    select concat_ws('|', :'job_id', :'workset_id', :'operator_recovery_id');
  `;
}

/** The owner-session setup portion for migration 091's validation-recovery race/chain tests
 * below: extends buildContextRecoverySetupOnlySql() (a real 089 operator recovery, then a
 * SECOND failure with invalid_output -- the real 090 precondition) through a real 090 context
 * recovery, then re-claims the requeued job and immediately fails it a THIRD time with
 * invalid_output -- no new checkpoint work is needed, since the 3/3 checkpoint history from
 * setup is already exactly what 091 requires unchanged. Reaches the exact real 091
 * precondition: unavailable/invalid_output, resume_count=5, a real 089 operator_recovery_id
 * AND a real 090 context_recovery_id both already bound, validation_recovery_id still null.
 * Stops short of validation-recovery authorization, so callers that need to race something
 * else against the authorize call can drive it themselves. */
function buildValidationRecoverySetupSql() {
  return buildContextRecoverySetupOnlySql() + `
    select (public.psi_authorize_agt002_context_recovery(
      :'job_id'::uuid, :'workset_id'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_EXPR}
    )) ->> 'context_recovery_id' as context_recovery_id \\gset

    select (public.psi_claim_agt002_reanalysis_job(600)) ->> 'lease_id' as lease_id \\gset

    select public.psi_fail_agt002_reanalysis_job(:'job_id'::uuid, :'lease_id'::uuid, 'invalid_output');
  `;
}

/** Setup-only variant for the validation-recovery authorization-vs-rollback race test and the
 * migration-091-objects chain test below: stops right after the job is failed into
 * 'unavailable' the third time at the automatic cap, and reports
 * job_id/workset_id/operator_recovery_id/context_recovery_id instead of authorizing -- callers
 * authorize validation recovery separately. */
function buildValidationRecoverySetupOnlySql() {
  return buildValidationRecoverySetupSql() + `
    select concat_ws('|', :'job_id', :'workset_id', :'operator_recovery_id', :'context_recovery_id');
  `;
}

/** The validation-recovery authorize portion: calls the real authorize RPC (assumes
 * :'job_id'/:'workset_id'/:'owner_session_user' are already set, either by
 * buildValidationRecoverySetupSql() in the same owner session, or set directly from literal
 * values by buildValidationRecoveryAuthorizeStandaloneSql() below) and ends in exactly one
 * delimiter-safe concat_ws('|', ...) scalar for the JS side to parse and assert on. Reads the
 * prior 089/090 bindings back off the job row itself, rather than depending on psql variables
 * set by a possibly-different session, so it composes safely with both callers. */
function buildValidationRecoveryAuthorizeSql() {
  return `
    select (public.psi_authorize_agt002_validation_recovery(
      :'job_id'::uuid, :'workset_id'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${REJECTED_OUTPUT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_091_EXPR}
    )) ->> 'validation_recovery_id' as validation_recovery_id \\gset

    select status as final_status, resume_count::text as final_resume_count,
           completed_batch_count::text as final_completed_batch_count,
           operator_recovery_id::text as final_job_operator_recovery_id,
           context_recovery_id::text as final_job_context_recovery_id,
           validation_recovery_id::text as final_job_validation_recovery_id
    from public.psi_agt002_reanalysis_jobs where id = :'job_id'::uuid \\gset

    select count(*)::text as final_audit_count from public.psi_agt002_validation_recoveries where job_id = :'job_id'::uuid \\gset
    select authorized_by as final_authorized_by, reason_code as final_reason_code,
           attestation_kind as final_attestation_kind, attested_validation_code as final_validation_code,
           source_context_hash as final_source_context_hash,
           attested_rejected_output_hash as final_rejected_output_hash, repair_commit_sha as final_repair_commit_sha
    from public.psi_agt002_validation_recoveries where job_id = :'job_id'::uuid \\gset

    select concat_ws('|',
      :'job_id', :'workset_id', :'final_status', :'final_resume_count', :'final_completed_batch_count',
      :'final_audit_count', :'final_authorized_by', :'owner_session_user', :'final_reason_code',
      :'final_attestation_kind', :'final_validation_code', :'final_source_context_hash', :'final_rejected_output_hash',
      :'final_repair_commit_sha', :'validation_recovery_id', :'final_job_validation_recovery_id',
      :'final_job_operator_recovery_id', :'final_job_context_recovery_id'
    );
  `;
}

/** Standalone variant of buildValidationRecoveryAuthorizeSql() for a fresh psql session that did
 * not itself run the setup script: job_id/workset_id are real, server-generated uuids validated
 * by the caller before being interpolated here, so this is always a safe literal. */
function buildValidationRecoveryAuthorizeStandaloneSql(jobId, worksetId) {
  return `
    set statement_timeout = '${DESTRUCTIVE_CHILD_TIMEOUT_MS}ms';
    select session_user as owner_session_user \\gset
    select '${jobId}' as job_id \\gset
    select '${worksetId}' as workset_id \\gset
  ` + buildValidationRecoveryAuthorizeSql();
}

/** Builds the owner-session script for this phase: destructive `public` schema reset, pgcrypto +
 * roles (service_role BYPASSRLS), the minimal fixture DDL above, then the real migration chain.
 * No job/recovery/role flow is driven yet: this phase only proves migration 089's own objects
 * get created. */
function buildDestructiveSetupSql() {
  return `
    set statement_timeout = '${DESTRUCTIVE_CHILD_TIMEOUT_MS}ms';

    -- Dedicated ephemeral database only (guarded by the JS-side loopback-hostname + explicit
    -- destructive opt-in check before this script is ever run): reset the whole public schema.
    drop schema if exists public cascade;
    create schema public;
    grant usage, create on schema public to current_user;

    create extension if not exists pgcrypto;

    do $do$
    begin
      if not exists (select from pg_catalog.pg_roles where rolname = 'authenticated') then
        create role authenticated;
      end if;
      if not exists (select from pg_catalog.pg_roles where rolname = 'anon') then
        create role anon;
      end if;
      if not exists (select from pg_catalog.pg_roles where rolname = 'service_role') then
        create role service_role;
      end if;
    end
    $do$;
    alter role service_role bypassrls;
    grant service_role to current_user;
    grant usage on schema public to authenticated, anon, service_role;

    ${DESTRUCTIVE_FIXTURE_SQL}

    ${DESTRUCTIVE_MIGRATIONS_SQL}
  `;
}

test(
  'real PostgreSQL, real migration chain: migration 089 creates the operator-recovery audit table, authorize function, and jobs.operator_recovery_id column; migration 090 creates the context-recovery audit table, authorize function, and jobs.context_recovery_id column',
  { skip: DESTRUCTIVE_ALLOWED ? false : DESTRUCTIVE_SKIP_REASON },
  async () => {
    try {
      const setup = await runPsqlOnce(POSTGRES_URL, buildDestructiveSetupSql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(setup.code, 0, `fixture/migration setup script must succeed: ${setup.stderr}`);

      const auditTableExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regclass('public.psi_agt002_operator_recoveries') is not null)::text;`,
      );
      assert.equal(auditTableExists, 'true', 'migration 089 must create the operator-recovery audit table');

      const authorizeFunctionExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regprocedure('public.psi_authorize_agt002_operator_recovery(uuid,uuid,integer,text)') is not null)::text;`,
      );
      assert.equal(
        authorizeFunctionExists,
        'true',
        'migration 089 must create the psi_authorize_agt002_operator_recovery function',
      );

      const operatorRecoveryColumnExists = await queryScalar(
        POSTGRES_URL,
        `select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'psi_agt002_reanalysis_jobs' and column_name = 'operator_recovery_id')::text;`,
      );
      assert.equal(operatorRecoveryColumnExists, 'true', 'migration 089 must add jobs.operator_recovery_id');

      const contextAuditTableExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regclass('public.psi_agt002_context_recoveries') is not null)::text;`,
      );
      assert.equal(contextAuditTableExists, 'true', 'migration 090 must create the context-recovery audit table');

      const contextAuthorizeFunctionExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regprocedure('public.psi_authorize_agt002_context_recovery(uuid,uuid,integer,text,text)') is not null)::text;`,
      );
      assert.equal(
        contextAuthorizeFunctionExists,
        'true',
        'migration 090 must create the psi_authorize_agt002_context_recovery function',
      );

      const contextRecoveryColumnExists = await queryScalar(
        POSTGRES_URL,
        `select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'psi_agt002_reanalysis_jobs' and column_name = 'context_recovery_id')::text;`,
      );
      assert.equal(contextRecoveryColumnExists, 'true', 'migration 090 must add jobs.context_recovery_id');

      // Drive a real recovery through the real RPCs (one owner-session psql script), then assert
      // the full role contract: the owner-only authorize function actually queues the job and
      // writes exactly one audit row, service_role can read that row (BYPASSRLS) but can never
      // invoke the authorize function itself.
      const recovery = await runPsqlOnce(POSTGRES_URL, buildOperatorRecoveryScriptSql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(recovery.code, 0, `owner-session operator-recovery script must succeed: ${recovery.stderr}`);

      const recoveryLines = recovery.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const [
        jobId, worksetId, finalStatus, finalResumeCount, finalAuditCount,
        finalAuthorizedBy, ownerSessionUser, finalReasonCode, operatorRecoveryId, finalJobOperatorRecoveryId,
      ] = (recoveryLines[recoveryLines.length - 1] ?? '').split('|');

      assert.match(jobId, /^[0-9a-f-]{36}$/i, `owner script must report a well-formed job id; stdout: ${recovery.stdout}`);
      assert.match(worksetId, /^[0-9a-f-]{36}$/i, `owner script must report a well-formed workset id; stdout: ${recovery.stdout}`);
      assert.equal(finalStatus, 'queued', 'the authorized recovery must requeue the job');
      assert.equal(finalResumeCount, '5', 'resume_count must stay exactly at the unchanged automatic-reclaim cap');
      assert.equal(finalAuditCount, '1', 'exactly one audit row must exist for the recovered job');
      assert.ok(operatorRecoveryId, 'the authorize function must return a non-null operator_recovery_id');
      assert.equal(finalJobOperatorRecoveryId, operatorRecoveryId, 'the job row must be bound to the returned operator_recovery_id');
      assert.equal(
        finalAuthorizedBy,
        ownerSessionUser,
        'authorized_by must equal session_user, captured in the very same owner script that ran the authorize call',
      );
      assert.equal(finalReasonCode, 'corrected_deterministic_bridge_defect', "migration 089 hardcodes reason_code to this exact value in both its check constraint and its INSERT -- it takes no reason_code parameter, so no caller-supplied value can ever reach the audit row");

      // Separate session #1: service_role must be able to SELECT the one audit row (BYPASSRLS),
      // exactly as migration 089 grants -- reusing no state from the owner script above.
      const serviceRoleAuditCount = await queryScalar(
        POSTGRES_URL,
        `
          set role service_role;
          select count(*) from public.psi_agt002_operator_recoveries where job_id = '${jobId}'::uuid;
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.equal(serviceRoleAuditCount, '1', 'service_role (BYPASSRLS) must see the one audit row for the recovered job');

      // Separate session #2: service_role must never be able to execute the authorize function
      // itself -- migration 089 revokes it from every role, including service_role.
      const serviceRoleAuthorizeAttempt = await runPsqlOnce(
        POSTGRES_URL,
        `
          set role service_role;
          select public.psi_authorize_agt002_operator_recovery('${jobId}'::uuid, '${worksetId}'::uuid, 2, ${DEFECT_COMMIT_SHA_EXPR});
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.notEqual(serviceRoleAuthorizeAttempt.code, 0, 'service_role invoking the authorize function directly must fail');
      assert.match(
        serviceRoleAuthorizeAttempt.stderr,
        /permission denied/i,
        `service_role must be rejected with permission denied: ${serviceRoleAuthorizeAttempt.stderr}`,
      );

      // Migration 090's own role contract, layered on top of 089's: service_role may SELECT the
      // context-recovery audit table (BYPASSRLS covers row visibility; these has_table_privilege
      // checks cover the table-level grants themselves) but has no write privilege on it at all --
      // migration 090 revokes everything first and grants back only SELECT.
      const contextAuditPrivileges = await queryScalar(
        POSTGRES_URL,
        `
          select concat_ws('|',
            has_table_privilege('service_role', 'public.psi_agt002_context_recoveries', 'SELECT')::text,
            has_table_privilege('service_role', 'public.psi_agt002_context_recoveries', 'INSERT')::text,
            has_table_privilege('service_role', 'public.psi_agt002_context_recoveries', 'UPDATE')::text,
            has_table_privilege('service_role', 'public.psi_agt002_context_recoveries', 'DELETE')::text
          );
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      const [
        contextAuditCanSelect, contextAuditCanInsert, contextAuditCanUpdate, contextAuditCanDelete,
      ] = contextAuditPrivileges.split('|');
      assert.equal(contextAuditCanSelect, 'true', 'migration 090 must grant service_role SELECT on the context-recovery audit table');
      assert.equal(contextAuditCanInsert, 'false', 'migration 090 must not grant service_role INSERT on the context-recovery audit table');
      assert.equal(contextAuditCanUpdate, 'false', 'migration 090 must not grant service_role UPDATE on the context-recovery audit table');
      assert.equal(contextAuditCanDelete, 'false', 'migration 090 must not grant service_role DELETE on the context-recovery audit table');

      // Migration 090 revokes execute on the context-recovery authorize function from every role,
      // including service_role: unlike the audit table (readable), no application-facing role may
      // ever invoke this owner-only SECURITY DEFINER function directly.
      const serviceRoleContextAuthorizeAttempt = await runPsqlOnce(
        POSTGRES_URL,
        `
          set role service_role;
          select public.psi_authorize_agt002_context_recovery('${jobId}'::uuid, '${worksetId}'::uuid, 2, ${CONTEXT_HASH_EXPR}, ${DEFECT_COMMIT_SHA_EXPR});
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.notEqual(
        serviceRoleContextAuthorizeAttempt.code,
        0,
        'service_role invoking the context-recovery authorize function directly must fail',
      );
      assert.match(
        serviceRoleContextAuthorizeAttempt.stderr,
        /permission denied/i,
        `service_role must be rejected with permission denied: ${serviceRoleContextAuthorizeAttempt.stderr}`,
      );
    } finally {
      try {
        await resetPublicSchema();
      } catch (error) {
        console.error('failed to reset public schema after the AGT-002 operator-recovery migration-089 objects integration test:', error);
      }
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Third suite (Phase 3): a real-PostgreSQL, real-migration-chain, real-rollback-file regression
// test for the authorization-vs-rollback race that migration 089's rollback file guards against.
//
// psi_authorize_agt002_operator_recovery INSERTs the audit row and requeues the job inside one
// transaction; until that transaction commits, no other session can see that evidence under
// READ COMMITTED. The rollback file's two `lock table ... in access exclusive mode` statements
// exist precisely so that an in-flight, not-yet-committed authorization still wins the race: they
// force the rollback to wait for the authorizer's transaction to finish (commit or abort) before
// its own exists-checks run, so those checks always see the authorizer's final, committed state
// instead of a stale pre-commit snapshot. Without those locks, a concurrent rollback could run its
// exists-checks while the authorization is still uncommitted (finding no evidence yet), then block
// only on the DROP itself, and after the authorizer commits, proceed to drop the very objects that
// now have a real audit row and a bound job -- exactly the race this test regresses.
//
// This phase reuses the setup portion of buildOperatorRecoveryScriptSql() (above) to build a real,
// at-cap 'unavailable' job with two contiguous checkpoints and resume_count=5, but stops before
// authorization. It then drives the actual authorize RPC from one psql session (A) inside an open,
// uncommitted transaction, held open for ~1.2s, while a second psql session (B) runs the real
// supabase/rollbacks/089_agt002_operator_recovery_slot_rollback.sql file verbatim -- not a
// reconstruction of it -- against the same database. Like the two suites above, this requires
// AGT002_TEST_POSTGRES_DESTRUCTIVE opt-in plus a loopback-only URL, and always resets `public` in
// a finally block.
const MARKER_AUTH_UNCOMMITTED = 'AGT002_ORP_AUTH_UNCOMMITTED';
const RACE_CHILD_TIMEOUT_MS = 20_000;

const ROLLBACK_089_SQL = readFileSync(
  new URL('../supabase/rollbacks/089_agt002_operator_recovery_slot_rollback.sql', import.meta.url),
  'utf8',
);

/** Session A: opens a transaction, calls the real authorize RPC against the already-set-up at-cap
 * job/workset (job_id/workset_id are real, server-generated uuids validated by the caller before
 * being interpolated here, so this is always a safe literal), emits a marker once the function has
 * returned but while the transaction (and its audit-row/job-update evidence) is still uncommitted,
 * holds the transaction open for ~1.2s, then commits. */
function buildAuthorizeRaceSessionSql(jobId, worksetId) {
  return `
    set statement_timeout = '10s';
    begin;
    select (public.psi_authorize_agt002_operator_recovery(
      '${jobId}'::uuid, '${worksetId}'::uuid, 2, ${DEFECT_COMMIT_SHA_EXPR}
    )) ->> 'operator_recovery_id' as operator_recovery_id \\gset
    \\echo ${MARKER_AUTH_UNCOMMITTED}
    select pg_sleep(1.2);
    commit;
    select :'operator_recovery_id';
  `;
}

test(
  'real PostgreSQL, real migration chain, real rollback file: authorization-vs-rollback race is fixed by the rollback\'s pre-drop locks',
  { skip: DESTRUCTIVE_ALLOWED ? false : DESTRUCTIVE_SKIP_REASON },
  async () => {
    try {
      const setup = await runPsqlOnce(POSTGRES_URL, buildDestructiveSetupSql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(setup.code, 0, `fixture/migration setup script must succeed: ${setup.stderr}`);

      // Owner-session setup only: builds the real at-cap 'unavailable' job (two contiguous
      // checkpoints, resume_count=5), but stops before authorization.
      const jobSetup = await runPsqlOnce(POSTGRES_URL, buildOperatorRecoverySetupOnlySql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(jobSetup.code, 0, `owner-session at-cap job setup script must succeed: ${jobSetup.stderr}`);

      const jobSetupLines = jobSetup.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const [jobId, worksetId] = (jobSetupLines[jobSetupLines.length - 1] ?? '').split('|');
      assert.match(jobId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed job id; stdout: ${jobSetup.stdout}`);
      assert.match(worksetId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed workset id; stdout: ${jobSetup.stdout}`);

      // Session A: authorize the recovery, but hold the transaction open (uncommitted) for ~1.2s
      // after the function itself has returned.
      const sessionA = spawnPsql(POSTGRES_URL, buildAuthorizeRaceSessionSql(jobId, worksetId), { timeoutMs: RACE_CHILD_TIMEOUT_MS });
      await sessionA.waitForMarker(MARKER_AUTH_UNCOMMITTED);

      // Session B starts only once A's authorization evidence exists but is still uncommitted:
      // it runs the actual rollback file, unmodified. If the fix (the two pre-drop
      // `lock table ... in access exclusive mode` statements) is in place, B must block until A's
      // commit, then its exists-checks see the now-committed evidence and refuse to proceed.
      const tBeforeB = Date.now();
      const sessionBDone = runPsqlOnce(POSTGRES_URL, ROLLBACK_089_SQL, { timeoutMs: RACE_CHILD_TIMEOUT_MS });

      const [resultA, resultB] = await Promise.all([sessionA.done, sessionBDone]);
      const tAfterB = Date.now();

      assert.equal(resultA.code, 0, `session A (authorizer) must commit successfully: ${resultA.stderr}`);
      assert.notEqual(resultB.code, 0, 'session B (rollback) must fail once evidence exists for the recovered job');
      assert.match(
        resultB.stderr,
        /bloqueado/i,
        `rollback must refuse with its audit-evidence guard message: ${resultB.stderr}`,
      );
      assert.ok(
        tAfterB - tBeforeB >= 900,
        `session B must have blocked on the rollback's pre-drop lock until session A committed (took ${tAfterB - tBeforeB}ms)`,
      );

      // The rollback must not have dropped anything: migration 089's objects, the one audit row,
      // and the job's binding must all still be intact.
      const auditTableExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regclass('public.psi_agt002_operator_recoveries') is not null)::text;`,
      );
      assert.equal(auditTableExists, 'true', 'the operator-recovery audit table must still exist after the refused rollback');

      const authorizeFunctionExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regprocedure('public.psi_authorize_agt002_operator_recovery(uuid,uuid,integer,text)') is not null)::text;`,
      );
      assert.equal(
        authorizeFunctionExists,
        'true',
        'the psi_authorize_agt002_operator_recovery function must still exist after the refused rollback',
      );

      const operatorRecoveryColumnExists = await queryScalar(
        POSTGRES_URL,
        `select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'psi_agt002_reanalysis_jobs' and column_name = 'operator_recovery_id')::text;`,
      );
      assert.equal(operatorRecoveryColumnExists, 'true', 'jobs.operator_recovery_id must still exist after the refused rollback');

      const auditCount = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_operator_recoveries where job_id = '${jobId}'::uuid;`,
      );
      assert.equal(auditCount, '1', 'exactly one audit row must still exist for the recovered job');

      const jobRow = await queryScalar(
        POSTGRES_URL,
        `select concat_ws('|', status, (operator_recovery_id is not null)::text) from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid;`,
      );
      const [finalStatus, isBound] = jobRow.split('|');
      assert.equal(finalStatus, 'queued', 'the job must remain queued: the refused rollback must not have unwound the authorization');
      assert.equal(isBound, 'true', 'the job must remain bound to its operator_recovery_id after the refused rollback');
    } finally {
      try {
        await resetPublicSchema();
      } catch (error) {
        console.error('failed to reset public schema after the AGT-002 authorization-vs-rollback race integration test:', error);
      }
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Fourth suite (Phase 4): the same real-PostgreSQL, real-migration-chain, real-rollback-file
// authorization-vs-rollback race regression as the third suite above, but for migration 090's
// context recovery instead of 089's operator recovery -- proving rollback 090's own pair of
// pre-drop `lock table ... in access exclusive mode` statements defend against exactly the same
// race: a concurrent rollback 090 must wait for an in-flight, not-yet-committed context-recovery
// authorization to finish before its own exists-checks run, so those checks always see the
// authorizer's final, committed state instead of a stale pre-commit snapshot.
//
// This phase reuses buildContextRecoverySetupOnlySql() (above) to build a real job that already
// carries a genuine 089 operator_recovery_id and has since failed a SECOND time with
// invalid_output at the same automatic cap -- the exact real 090 context-recovery precondition --
// but stops before context-recovery authorization. It first proves a mismatched (but well-formed)
// expected_context_hash is denied outright, leaving no evidence at all. It then drives the actual
// context-recovery authorize RPC from one psql session (A) inside an open, uncommitted
// transaction, held open for ~1.2s, while a second psql session (B) runs the real
// supabase/rollbacks/090_agt002_context_recovery_slot_rollback.sql file verbatim against the same
// database. Like the third suite, this requires AGT002_TEST_POSTGRES_DESTRUCTIVE opt-in plus a
// loopback-only URL, and always resets `public` in a finally block.
const MARKER_CONTEXT_AUTH_UNCOMMITTED = 'AGT002_CTX_AUTH_UNCOMMITTED';

const ROLLBACK_090_SQL = readFileSync(
  new URL('../supabase/rollbacks/090_agt002_context_recovery_slot_rollback.sql', import.meta.url),
  'utf8',
);

/** Session A: opens a transaction, calls the real context-recovery authorize RPC against the
 * already-set-up, second-failure job/workset (job_id/workset_id are real, server-generated uuids
 * validated by the caller before being interpolated here, so this is always a safe literal), emits
 * a marker once the function has returned but while the transaction (and its audit-row/job-update
 * evidence) is still uncommitted, holds the transaction open for ~1.2s, then commits. */
function buildContextRecoveryAuthorizeRaceSessionSql(jobId, worksetId) {
  return `
    set statement_timeout = '10s';
    begin;
    select (public.psi_authorize_agt002_context_recovery(
      '${jobId}'::uuid, '${worksetId}'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_EXPR}
    )) ->> 'context_recovery_id' as context_recovery_id \\gset
    \\echo ${MARKER_CONTEXT_AUTH_UNCOMMITTED}
    select pg_sleep(1.2);
    commit;
    select :'context_recovery_id';
  `;
}

test(
  'real PostgreSQL, real migration chain, real rollback file: migration 090 context-recovery authorization-vs-rollback race is fixed by the rollback\'s pre-drop locks',
  { skip: DESTRUCTIVE_ALLOWED ? false : DESTRUCTIVE_SKIP_REASON },
  async () => {
    try {
      const setup = await runPsqlOnce(POSTGRES_URL, buildDestructiveSetupSql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(setup.code, 0, `fixture/migration setup script must succeed: ${setup.stderr}`);

      // Owner-session setup only: builds the real, already-089-recovered job that has since
      // failed a second time with invalid_output at the automatic cap, but stops before
      // context-recovery authorization.
      const jobSetup = await runPsqlOnce(POSTGRES_URL, buildContextRecoverySetupOnlySql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(jobSetup.code, 0, `owner-session context-recoverable job setup script must succeed: ${jobSetup.stderr}`);

      const jobSetupLines = jobSetup.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const [jobId, worksetId, priorOperatorRecoveryId] = (jobSetupLines[jobSetupLines.length - 1] ?? '').split('|');
      assert.match(jobId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed job id; stdout: ${jobSetup.stdout}`);
      assert.match(worksetId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed workset id; stdout: ${jobSetup.stdout}`);
      assert.match(priorOperatorRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the prior 089 operator_recovery_id; stdout: ${jobSetup.stdout}`);

      // A well-formed but mismatched expected_context_hash must be denied outright, and must
      // never create any context-recovery evidence at all.
      const wrongHashAttempt = await runPsqlOnce(
        POSTGRES_URL,
        `
          set statement_timeout = '10s';
          select public.psi_authorize_agt002_context_recovery(
            '${jobId}'::uuid, '${worksetId}'::uuid, 3, ${WRONG_CONTEXT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_EXPR}
          );
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.notEqual(wrongHashAttempt.code, 0, 'a mismatched (but well-formed) expected_context_hash must be rejected');

      const auditCountAfterWrongHash = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_context_recoveries where job_id = '${jobId}'::uuid;`,
      );
      assert.equal(auditCountAfterWrongHash, '0', 'a rejected mismatched-hash attempt must never create a context-recovery audit row');

      const jobRowAfterWrongHash = await queryScalar(
        POSTGRES_URL,
        `select concat_ws('|', status, (context_recovery_id is not null)::text) from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid;`,
      );
      const [statusAfterWrongHash, isContextBoundAfterWrongHash] = jobRowAfterWrongHash.split('|');
      assert.equal(statusAfterWrongHash, 'unavailable', 'a rejected mismatched-hash attempt must leave the job exactly as it was');
      assert.equal(isContextBoundAfterWrongHash, 'false', 'a rejected mismatched-hash attempt must never bind context_recovery_id');

      // Session A: authorize the context recovery with the correct hash, but hold the transaction
      // open (uncommitted) for ~1.2s after the function itself has returned.
      const sessionA = spawnPsql(POSTGRES_URL, buildContextRecoveryAuthorizeRaceSessionSql(jobId, worksetId), { timeoutMs: RACE_CHILD_TIMEOUT_MS });
      await sessionA.waitForMarker(MARKER_CONTEXT_AUTH_UNCOMMITTED);

      // Session B starts only once A's authorization evidence exists but is still uncommitted:
      // it runs the actual rollback 090 file, unmodified. If the fix (the two pre-drop
      // `lock table ... in access exclusive mode` statements) is in place, B must block until A's
      // commit, then its exists-checks see the now-committed evidence and refuse to proceed.
      const tBeforeB = Date.now();
      const sessionBDone = runPsqlOnce(POSTGRES_URL, ROLLBACK_090_SQL, { timeoutMs: RACE_CHILD_TIMEOUT_MS });

      const [resultA, resultB] = await Promise.all([sessionA.done, sessionBDone]);
      const tAfterB = Date.now();

      assert.equal(resultA.code, 0, `session A (context-recovery authorizer) must commit successfully: ${resultA.stderr}`);
      assert.notEqual(resultB.code, 0, 'session B (rollback) must fail once evidence exists for the context-recovered job');
      assert.match(
        resultB.stderr,
        /bloqueado/i,
        `rollback must refuse with its audit-evidence guard message: ${resultB.stderr}`,
      );
      assert.ok(
        tAfterB - tBeforeB >= 900,
        `session B must have blocked on the rollback's pre-drop lock until session A committed (took ${tAfterB - tBeforeB}ms)`,
      );

      // The rollback must not have dropped anything: migration 090's objects, the one context
      // audit row, and the job's bindings (both the prior 089 one and the new 090 one) must all
      // still be intact.
      const contextAuditTableExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regclass('public.psi_agt002_context_recoveries') is not null)::text;`,
      );
      assert.equal(contextAuditTableExists, 'true', 'the context-recovery audit table must still exist after the refused rollback');

      const contextAuthorizeFunctionExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regprocedure('public.psi_authorize_agt002_context_recovery(uuid,uuid,integer,text,text)') is not null)::text;`,
      );
      assert.equal(
        contextAuthorizeFunctionExists,
        'true',
        'the psi_authorize_agt002_context_recovery function must still exist after the refused rollback',
      );

      const contextRecoveryColumnExists = await queryScalar(
        POSTGRES_URL,
        `select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'psi_agt002_reanalysis_jobs' and column_name = 'context_recovery_id')::text;`,
      );
      assert.equal(contextRecoveryColumnExists, 'true', 'jobs.context_recovery_id must still exist after the refused rollback');

      const contextAuditCount = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_context_recoveries where job_id = '${jobId}'::uuid;`,
      );
      assert.equal(contextAuditCount, '1', 'exactly one context-recovery audit row must still exist for the recovered job');

      const jobRow = await queryScalar(
        POSTGRES_URL,
        `select concat_ws('|', status, resume_count::text, operator_recovery_id::text, (context_recovery_id is not null)::text) from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid;`,
      );
      const [finalStatus, finalResumeCount, finalOperatorRecoveryId, isContextBound] = jobRow.split('|');
      assert.equal(finalStatus, 'queued', 'the job must remain queued: the refused rollback must not have unwound the context recovery');
      assert.equal(finalResumeCount, '5', 'resume_count must remain exactly at the unchanged automatic-reclaim cap');
      assert.equal(finalOperatorRecoveryId, priorOperatorRecoveryId, 'the prior 089 operator_recovery_id binding must remain unchanged by the context recovery');
      assert.equal(isContextBound, 'true', 'the job must remain bound to its context_recovery_id after the refused rollback');
    } finally {
      try {
        await resetPublicSchema();
      } catch (error) {
        console.error('failed to reset public schema after the AGT-002 context-recovery authorization-vs-rollback race integration test:', error);
      }
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Fifth suite (Phase 5): the same real-PostgreSQL, real-migration-chain proof as the second
// suite above, but for migration 091's validation recovery layered on top of a real 089 -> 090
// chain -- driven entirely through the actual authorizer functions/RPCs, never a hand-faked
// row.
//
// This phase drives a real job through: creation -> claim -> two contiguous
// semantic_discovery_batch checkpoints -> five automatic expire/reclaim cycles to the cap ->
// terminal failure (timeout) -> a real 089 operator recovery -> resume/claim -> one
// semantic_manifest checkpoint (completing 3/3) -> a SECOND terminal failure (invalid_output) ->
// a real 090 context recovery -> resume/claim -> a THIRD terminal failure (invalid_output),
// which is the exact real 091 precondition. It then proves, against that one real job: a
// well-formed but mismatched expected_context_hash is denied outright, mutating nothing; a
// malformed (non-64-hex) attested_rejected_output_hash is denied outright, mutating nothing; the
// real, well-formed authorize call records the exact hashes/fixed attestation_kind, attested_
// validation_code, and reason_code/repair SHA and requeues the job while preserving the prior
// 089/090 bindings and resume_count=5/
// checkpoint-derived completed_batch_count unchanged; and a second validation-recovery attempt
// on the same (now-queued) job is rejected outright with the audit trail staying singular. It
// closes with migration 091's own, stricter-than-089/090 role contract: no application role
// receives EXECUTE on the authorize function; owner/admin is the trusted boundary. service_role
// retains its production-design SELECT on the audit table -- BYPASSRLS means FORCE ROW LEVEL
// SECURITY with no policy never applies to it, so a direct query still sees the one row.
//
// Like the second suite, this requires AGT002_TEST_POSTGRES_DESTRUCTIVE opt-in plus a
// loopback-only URL, and always resets `public` in a finally block.
test(
  "real PostgreSQL, real migration chain: migration 091 creates the validation-recovery audit table, authorize function, and jobs.validation_recovery_id column; a real 089->090->091 chain records exact hashes and requeues; wrong-hash and malformed-hash attempts mutate nothing; a second 091 attempt is rejected; no application role receives EXECUTE on the function (owner/admin is the trusted boundary), but service_role retains SELECT on the audit table",
  { skip: DESTRUCTIVE_ALLOWED ? false : DESTRUCTIVE_SKIP_REASON },
  async () => {
    try {
      const setup = await runPsqlOnce(POSTGRES_URL, buildDestructiveSetupSql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(setup.code, 0, `fixture/migration setup script must succeed: ${setup.stderr}`);

      const validationAuditTableExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regclass('public.psi_agt002_validation_recoveries') is not null)::text;`,
      );
      assert.equal(validationAuditTableExists, 'true', 'migration 091 must create the validation-recovery audit table');

      const validationAuthorizeFunctionExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regprocedure('public.psi_authorize_agt002_validation_recovery(uuid,uuid,integer,text,text,text)') is not null)::text;`,
      );
      assert.equal(
        validationAuthorizeFunctionExists,
        'true',
        'migration 091 must create the psi_authorize_agt002_validation_recovery function',
      );

      const validationRecoveryColumnExists = await queryScalar(
        POSTGRES_URL,
        `select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'psi_agt002_reanalysis_jobs' and column_name = 'validation_recovery_id')::text;`,
      );
      assert.equal(validationRecoveryColumnExists, 'true', 'migration 091 must add jobs.validation_recovery_id');

      // Drive a real 089 -> 090 -> (third failure) chain via the actual RPCs/authorizer
      // functions, leaving the job at the real 091 precondition.
      const jobSetup = await runPsqlOnce(POSTGRES_URL, buildValidationRecoverySetupOnlySql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(jobSetup.code, 0, `owner-session validation-recoverable job setup script must succeed: ${jobSetup.stderr}`);

      const jobSetupLines = jobSetup.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const [jobId, worksetId, operatorRecoveryId, contextRecoveryId] = (jobSetupLines[jobSetupLines.length - 1] ?? '').split('|');
      assert.match(jobId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed job id; stdout: ${jobSetup.stdout}`);
      assert.match(worksetId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed workset id; stdout: ${jobSetup.stdout}`);
      assert.match(operatorRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the real 089 operator_recovery_id; stdout: ${jobSetup.stdout}`);
      assert.match(contextRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the real 090 context_recovery_id; stdout: ${jobSetup.stdout}`);

      // A well-formed but mismatched expected_context_hash must be rejected outright, mutating nothing.
      const wrongHashAttempt = await runPsqlOnce(
        POSTGRES_URL,
        `
          set statement_timeout = '10s';
          select public.psi_authorize_agt002_validation_recovery(
            '${jobId}'::uuid, '${worksetId}'::uuid, 3, ${WRONG_CONTEXT_HASH_EXPR}, ${REJECTED_OUTPUT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_091_EXPR}
          );
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.notEqual(wrongHashAttempt.code, 0, 'a mismatched (but well-formed) expected_context_hash must be rejected');

      const auditCountAfterWrongHash = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid;`,
      );
      assert.equal(auditCountAfterWrongHash, '0', 'a rejected mismatched-hash attempt must never create a validation-recovery audit row');

      const jobRowAfterWrongHash = await queryScalar(
        POSTGRES_URL,
        `select concat_ws('|', status, resume_count::text, operator_recovery_id::text, context_recovery_id::text, (validation_recovery_id is not null)::text) from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid;`,
      );
      const [statusAfterWrongHash, resumeCountAfterWrongHash, operatorAfterWrongHash, contextAfterWrongHash, isValidationBoundAfterWrongHash] = jobRowAfterWrongHash.split('|');
      assert.equal(statusAfterWrongHash, 'unavailable', 'a rejected mismatched-hash attempt must leave the job exactly as it was');
      assert.equal(resumeCountAfterWrongHash, '5');
      assert.equal(operatorAfterWrongHash, operatorRecoveryId, 'a rejected attempt must never disturb the prior 089 binding');
      assert.equal(contextAfterWrongHash, contextRecoveryId, 'a rejected attempt must never disturb the prior 090 binding');
      assert.equal(isValidationBoundAfterWrongHash, 'false');

      // A malformed (non-64-hex) attested_rejected_output_hash must be rejected before ever touching the job row.
      const malformedHashAttempt = await runPsqlOnce(
        POSTGRES_URL,
        `
          set statement_timeout = '10s';
          select public.psi_authorize_agt002_validation_recovery(
            '${jobId}'::uuid, '${worksetId}'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${MALFORMED_REJECTED_OUTPUT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_091_EXPR}
          );
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.notEqual(malformedHashAttempt.code, 0, 'a malformed (non-64-hex) attested_rejected_output_hash must be rejected');

      const auditCountAfterMalformedHash = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid;`,
      );
      assert.equal(auditCountAfterMalformedHash, '0', 'a rejected malformed-hash attempt must never create a validation-recovery audit row');

      const jobRowAfterMalformedHash = await queryScalar(
        POSTGRES_URL,
        `select concat_ws('|', status, resume_count::text, operator_recovery_id::text, context_recovery_id::text, (validation_recovery_id is not null)::text) from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid;`,
      );
      const [
        statusAfterMalformedHash, resumeCountAfterMalformedHash, operatorAfterMalformedHash,
        contextAfterMalformedHash, isValidationBoundAfterMalformedHash,
      ] = jobRowAfterMalformedHash.split('|');
      assert.equal(statusAfterMalformedHash, 'unavailable', 'a rejected malformed-hash attempt must leave the job exactly as it was');
      assert.equal(resumeCountAfterMalformedHash, '5');
      assert.equal(operatorAfterMalformedHash, operatorRecoveryId);
      assert.equal(contextAfterMalformedHash, contextRecoveryId);
      assert.equal(isValidationBoundAfterMalformedHash, 'false');

      // Happy path: the real, well-formed authorize call must record exact hashes/fixed
      // validation_code+reason_code/repair SHA and requeue the job at the unchanged resume_count,
      // preserving the prior 089/090 bindings and the checkpoint-derived completed_batch_count.
      const recovery = await runPsqlOnce(POSTGRES_URL, buildValidationRecoveryAuthorizeStandaloneSql(jobId, worksetId), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(recovery.code, 0, `owner-session validation-recovery authorize script must succeed: ${recovery.stderr}`);

      const recoveryLines = recovery.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const [
        recJobId, recWorksetId, finalStatus, finalResumeCount, finalCompletedBatchCount,
        finalAuditCount, finalAuthorizedBy, ownerSessionUser, finalReasonCode, finalAttestationKind,
        finalValidationCode, finalSourceContextHash, finalRejectedOutputHash, finalRepairCommitSha,
        validationRecoveryId, finalJobValidationRecoveryId,
        finalJobOperatorRecoveryId, finalJobContextRecoveryId,
      ] = (recoveryLines[recoveryLines.length - 1] ?? '').split('|');

      assert.equal(recJobId, jobId);
      assert.equal(recWorksetId, worksetId);
      assert.equal(finalStatus, 'queued', 'the authorized validation recovery must requeue the job');
      assert.equal(finalResumeCount, '5', 'resume_count must stay exactly at the unchanged automatic-reclaim cap');
      assert.equal(finalCompletedBatchCount, '3', 'the requeue must preserve durable progress: it is a resume, not a reset');
      assert.equal(finalAuditCount, '1', 'exactly one validation-recovery audit row must exist for the recovered job');
      assert.ok(validationRecoveryId, 'the authorize function must return a non-null validation_recovery_id');
      assert.equal(finalJobValidationRecoveryId, validationRecoveryId, 'the job row must be bound to the returned validation_recovery_id');
      assert.equal(
        finalAuthorizedBy,
        ownerSessionUser,
        'authorized_by must equal session_user, captured in the very same script that ran the authorize call',
      );
      assert.equal(finalReasonCode, 'manually_attested_material_omissions_abstention_policy_v6', 'migration 091 hardcodes reason_code to this exact value in both its check constraint and its INSERT');
      assert.equal(finalAttestationKind, 'manual_operator_attestation', 'migration 091 hardcodes attestation_kind to this exact value in both its check constraint and its INSERT');
      assert.equal(finalValidationCode, 'v3_material_omissions_abstention_required', 'migration 091 hardcodes attested_validation_code to this exact value in both its check constraint and its INSERT');
      assert.equal(finalSourceContextHash, CONTEXT_HASH_LITERAL, 'the audit row must record the exact governed context_hash');
      assert.equal(finalRejectedOutputHash, REJECTED_OUTPUT_HASH_LITERAL, 'the audit row must record the exact rejected-output hash passed by the caller');
      assert.equal(finalRepairCommitSha, REPAIR_COMMIT_SHA_091_LITERAL, 'the audit row must record the exact repair_commit_sha passed by the caller');
      assert.equal(finalJobOperatorRecoveryId, operatorRecoveryId, 'the prior 089 binding must survive unchanged');
      assert.equal(finalJobContextRecoveryId, contextRecoveryId, 'the prior 090 binding must survive unchanged');

      // A second validation-recovery attempt on the same (now-queued) job must be rejected
      // outright, and the audit trail must stay singular.
      const secondAttempt = await runPsqlOnce(
        POSTGRES_URL,
        `
          set statement_timeout = '10s';
          select public.psi_authorize_agt002_validation_recovery(
            '${jobId}'::uuid, '${worksetId}'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${REJECTED_OUTPUT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_091_EXPR}
          );
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.notEqual(secondAttempt.code, 0, 'a second validation-recovery attempt on the same job must be rejected outright');

      const auditCountAfterSecond = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid;`,
      );
      assert.equal(auditCountAfterSecond, '1', 'a rejected second attempt must never add a second audit row');

      const jobRowAfterSecond = await queryScalar(
        POSTGRES_URL,
        `select concat_ws('|', status, validation_recovery_id::text, operator_recovery_id::text, context_recovery_id::text) from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid;`,
      );
      const [statusAfterSecond, validationIdAfterSecond, operatorAfterSecond, contextAfterSecond] = jobRowAfterSecond.split('|');
      assert.equal(statusAfterSecond, 'queued', 'the rejected second attempt must leave the job exactly as the first (successful) recovery left it');
      assert.equal(validationIdAfterSecond, validationRecoveryId);
      assert.equal(operatorAfterSecond, operatorRecoveryId);
      assert.equal(contextAfterSecond, contextRecoveryId);

      // Role contract: no application role receives EXECUTE on the validation-recovery
      // authorize function; owner/admin is the trusted boundary. Migration 091 revokes it from
      // every application role, including service_role.
      const serviceRoleValidationAuthorizeAttempt = await runPsqlOnce(
        POSTGRES_URL,
        `
          set role service_role;
          select public.psi_authorize_agt002_validation_recovery('${jobId}'::uuid, '${worksetId}'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${REJECTED_OUTPUT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_091_EXPR});
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.notEqual(
        serviceRoleValidationAuthorizeAttempt.code,
        0,
        'service_role invoking the validation-recovery authorize function directly must fail',
      );
      assert.match(
        serviceRoleValidationAuthorizeAttempt.stderr,
        /permission denied/i,
        `service_role must be rejected with permission denied: ${serviceRoleValidationAuthorizeAttempt.stderr}`,
      );

      // Migration 091's own role contract is stricter than 089/090's: RLS is enabled AND forced
      // on the validation-recovery audit table with no policy ever created. That FORCE ROW LEVEL
      // SECURITY only ever binds the table owner; service_role is BYPASSRLS by fixture (and by
      // production design -- see buildDestructiveSetupSql()'s `alter role service_role
      // bypassrls;`), so RLS never applies to it regardless of FORCE, and the GRANT SELECT to
      // service_role is a real, effective grant, not an inert one.
      const validationAuditPrivileges = await queryScalar(
        POSTGRES_URL,
        `
          select concat_ws('|',
            has_table_privilege('service_role', 'public.psi_agt002_validation_recoveries', 'SELECT')::text,
            has_table_privilege('service_role', 'public.psi_agt002_validation_recoveries', 'INSERT')::text,
            has_table_privilege('service_role', 'public.psi_agt002_validation_recoveries', 'UPDATE')::text,
            has_table_privilege('service_role', 'public.psi_agt002_validation_recoveries', 'DELETE')::text
          );
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      const [
        validationAuditCanSelect, validationAuditCanInsert, validationAuditCanUpdate, validationAuditCanDelete,
      ] = validationAuditPrivileges.split('|');
      assert.equal(validationAuditCanSelect, 'true', 'migration 091 must grant service_role the (inert, RLS-forced) SELECT privilege on the validation-recovery audit table');
      assert.equal(validationAuditCanInsert, 'false', 'migration 091 must not grant service_role INSERT on the validation-recovery audit table');
      assert.equal(validationAuditCanUpdate, 'false', 'migration 091 must not grant service_role UPDATE on the validation-recovery audit table');
      assert.equal(validationAuditCanDelete, 'false', 'migration 091 must not grant service_role DELETE on the validation-recovery audit table');

      const serviceRoleValidationAuditCount = await queryScalar(
        POSTGRES_URL,
        `
          set role service_role;
          select count(*) from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid;
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.equal(
        serviceRoleValidationAuditCount,
        '1',
        'service_role must see the one audit row via direct query: it is BYPASSRLS (by fixture and by production design), so FORCE ROW LEVEL SECURITY with no policy never applies to it, and its granted SELECT is fully effective',
      );
    } finally {
      try {
        await resetPublicSchema();
      } catch (error) {
        console.error('failed to reset public schema after the AGT-002 validation-recovery migration-091 objects integration test:', error);
      }
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Sixth suite (Phase 6): the same real-PostgreSQL, real-migration-chain, real-rollback-file
// authorization-vs-rollback race regression as the third/fourth suites above, but for migration
// 091's validation recovery instead of 089's operator recovery or 090's context recovery --
// proving rollback 091's own pair of pre-drop `lock table ... in access exclusive mode`
// statements defend against exactly the same race: a concurrent rollback 091 must wait for an
// in-flight, not-yet-committed validation-recovery authorization to finish before its own
// exists-checks run, so those checks always see the authorizer's final, committed state instead
// of a stale pre-commit snapshot.
//
// This phase reuses buildValidationRecoverySetupOnlySql() (above) to build a real job that
// already carries a genuine 089 operator_recovery_id and a genuine 090 context_recovery_id, and
// has since failed a THIRD time with invalid_output at the same automatic cap -- the exact real
// 091 precondition -- but stops before validation-recovery authorization. It drives the actual
// validation-recovery authorize RPC from one psql session (A) inside an open, uncommitted
// transaction, held open for ~1.2s, while a second psql session (B) runs the real
// supabase/rollbacks/091_agt002_validation_recovery_slot_rollback.sql file verbatim against the
// same database. Like the third/fourth suites, this requires AGT002_TEST_POSTGRES_DESTRUCTIVE
// opt-in plus a loopback-only URL, and always resets `public` in a finally block.
const MARKER_VALIDATION_AUTH_UNCOMMITTED = 'AGT002_VAL_AUTH_UNCOMMITTED';

const ROLLBACK_091_SQL = readFileSync(
  new URL('../supabase/rollbacks/091_agt002_validation_recovery_slot_rollback.sql', import.meta.url),
  'utf8',
);

/** Session A: opens a transaction, calls the real validation-recovery authorize RPC against the
 * already-set-up, third-failure job/workset (job_id/workset_id are real, server-generated uuids
 * validated by the caller before being interpolated here, so this is always a safe literal),
 * emits a marker once the function has returned but while the transaction (and its
 * audit-row/job-update evidence) is still uncommitted, holds the transaction open for ~1.2s,
 * then commits. */
function buildValidationRecoveryAuthorizeRaceSessionSql(jobId, worksetId) {
  return `
    set statement_timeout = '10s';
    begin;
    select (public.psi_authorize_agt002_validation_recovery(
      '${jobId}'::uuid, '${worksetId}'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${REJECTED_OUTPUT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_091_EXPR}
    )) ->> 'validation_recovery_id' as validation_recovery_id \\gset
    \\echo ${MARKER_VALIDATION_AUTH_UNCOMMITTED}
    select pg_sleep(1.2);
    commit;
    select :'validation_recovery_id';
  `;
}

test(
  "real PostgreSQL, real migration chain, real rollback file: migration 091 validation-recovery authorization-vs-rollback race is fixed by the rollback's pre-drop locks",
  { skip: DESTRUCTIVE_ALLOWED ? false : DESTRUCTIVE_SKIP_REASON },
  async () => {
    try {
      const setup = await runPsqlOnce(POSTGRES_URL, buildDestructiveSetupSql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(setup.code, 0, `fixture/migration setup script must succeed: ${setup.stderr}`);

      // Owner-session setup only: builds the real, already-089-and-090-recovered job that has
      // since failed a third time with invalid_output at the automatic cap, but stops before
      // validation-recovery authorization.
      const jobSetup = await runPsqlOnce(POSTGRES_URL, buildValidationRecoverySetupOnlySql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(jobSetup.code, 0, `owner-session validation-recoverable job setup script must succeed: ${jobSetup.stderr}`);

      const jobSetupLines = jobSetup.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const [jobId, worksetId, priorOperatorRecoveryId, priorContextRecoveryId] = (jobSetupLines[jobSetupLines.length - 1] ?? '').split('|');
      assert.match(jobId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed job id; stdout: ${jobSetup.stdout}`);
      assert.match(worksetId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed workset id; stdout: ${jobSetup.stdout}`);
      assert.match(priorOperatorRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the prior 089 operator_recovery_id; stdout: ${jobSetup.stdout}`);
      assert.match(priorContextRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the prior 090 context_recovery_id; stdout: ${jobSetup.stdout}`);

      // Session A: authorize the validation recovery, but hold the transaction open
      // (uncommitted) for ~1.2s after the function itself has returned.
      const sessionA = spawnPsql(POSTGRES_URL, buildValidationRecoveryAuthorizeRaceSessionSql(jobId, worksetId), { timeoutMs: RACE_CHILD_TIMEOUT_MS });
      await sessionA.waitForMarker(MARKER_VALIDATION_AUTH_UNCOMMITTED);

      // Session B starts only once A's authorization evidence exists but is still uncommitted:
      // it runs the actual rollback 091 file, unmodified. If the fix (the pre-drop
      // `lock table ... in access exclusive mode` statements) is in place, B must block until A's
      // commit, then its exists-checks see the now-committed evidence and refuse to proceed.
      const tBeforeB = Date.now();
      const sessionBDone = runPsqlOnce(POSTGRES_URL, ROLLBACK_091_SQL, { timeoutMs: RACE_CHILD_TIMEOUT_MS });

      const [resultA, resultB] = await Promise.all([sessionA.done, sessionBDone]);
      const tAfterB = Date.now();

      assert.equal(resultA.code, 0, `session A (validation-recovery authorizer) must commit successfully: ${resultA.stderr}`);
      assert.notEqual(resultB.code, 0, 'session B (rollback) must fail once evidence exists for the validation-recovered job');
      assert.match(
        resultB.stderr,
        /bloqueado/i,
        `rollback must refuse with its audit-evidence guard message: ${resultB.stderr}`,
      );
      assert.ok(
        tAfterB - tBeforeB >= 900,
        `session B must have blocked on the rollback's pre-drop lock until session A committed (took ${tAfterB - tBeforeB}ms)`,
      );

      // The rollback must not have dropped anything: migration 091's objects, the one audit row,
      // and all three of the job's bindings (089/090/091) must all still be intact.
      const validationAuditTableExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regclass('public.psi_agt002_validation_recoveries') is not null)::text;`,
      );
      assert.equal(validationAuditTableExists, 'true', 'the validation-recovery audit table must still exist after the refused rollback');

      const validationAuthorizeFunctionExists = await queryScalar(
        POSTGRES_URL,
        `select (to_regprocedure('public.psi_authorize_agt002_validation_recovery(uuid,uuid,integer,text,text,text)') is not null)::text;`,
      );
      assert.equal(
        validationAuthorizeFunctionExists,
        'true',
        'the psi_authorize_agt002_validation_recovery function must still exist after the refused rollback',
      );

      const validationRecoveryColumnExists = await queryScalar(
        POSTGRES_URL,
        `select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'psi_agt002_reanalysis_jobs' and column_name = 'validation_recovery_id')::text;`,
      );
      assert.equal(validationRecoveryColumnExists, 'true', 'jobs.validation_recovery_id must still exist after the refused rollback');

      const validationAuditCount = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid;`,
      );
      assert.equal(validationAuditCount, '1', 'exactly one validation-recovery audit row must still exist for the recovered job');

      const jobRow = await queryScalar(
        POSTGRES_URL,
        `select concat_ws('|', status, resume_count::text, operator_recovery_id::text, context_recovery_id::text, (validation_recovery_id is not null)::text) from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid;`,
      );
      const [finalStatus, finalResumeCount, finalOperatorRecoveryId, finalContextRecoveryId, isValidationBound] = jobRow.split('|');
      assert.equal(finalStatus, 'queued', 'the job must remain queued: the refused rollback must not have unwound the validation recovery');
      assert.equal(finalResumeCount, '5', 'resume_count must remain exactly at the unchanged automatic-reclaim cap');
      assert.equal(finalOperatorRecoveryId, priorOperatorRecoveryId, 'the prior 089 operator_recovery_id binding must remain unchanged by the validation recovery');
      assert.equal(finalContextRecoveryId, priorContextRecoveryId, 'the prior 090 context_recovery_id binding must remain unchanged by the validation recovery');
      assert.equal(isValidationBound, 'true', 'the job must remain bound to its validation_recovery_id after the refused rollback');

      // Role contract, re-verified after the refused rollback: no application role receives
      // EXECUTE on the validation-recovery authorize function; owner/admin is the trusted
      // boundary. Its audit table remains readable to service_role, which is BYPASSRLS (by
      // fixture and by production design), so FORCE ROW LEVEL SECURITY with no policy never
      // applies to it.
      const serviceRoleValidationAuthorizeAttempt = await runPsqlOnce(
        POSTGRES_URL,
        `
          set role service_role;
          select public.psi_authorize_agt002_validation_recovery('${jobId}'::uuid, '${worksetId}'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${REJECTED_OUTPUT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_091_EXPR});
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.notEqual(
        serviceRoleValidationAuthorizeAttempt.code,
        0,
        'service_role invoking the validation-recovery authorize function directly must fail',
      );
      assert.match(
        serviceRoleValidationAuthorizeAttempt.stderr,
        /permission denied/i,
        `service_role must be rejected with permission denied: ${serviceRoleValidationAuthorizeAttempt.stderr}`,
      );

      const serviceRoleValidationAuditCount = await queryScalar(
        POSTGRES_URL,
        `
          set role service_role;
          select count(*) from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid;
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.equal(
        serviceRoleValidationAuditCount,
        '1',
        'service_role must still see the one audit row via direct query after the refused rollback: it is BYPASSRLS (by fixture and by production design), so FORCE ROW LEVEL SECURITY with no policy never applies to it',
      );
    } finally {
      try {
        await resetPublicSchema();
      } catch (error) {
        console.error('failed to reset public schema after the AGT-002 validation-recovery authorization-vs-rollback race integration test:', error);
      }
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Seventh suite (Phase 7): a real-PostgreSQL, real-migration-chain, isolated-setup regression
// proving that migration 091's attested_rejected_output_hash is genuinely a manual attestation,
// never verified against any persisted validator output (see the column comment on
// psi_agt002_validation_recoveries.attested_rejected_output_hash in
// supabase/migrations/091_agt002_validation_recovery_slot.sql): an alternate, equally
// well-formed 64-hex hash -- distinct from the one every other suite in this file uses
// (REJECTED_OUTPUT_HASH_EXPR) -- must be accepted and recorded exactly as the admin's
// attestation_kind='manual_operator_attestation' attestation, while a malformed (non-64-hex)
// hash still must be rejected before ever touching the job row. This runs against its own,
// freshly built job (a full real 089 -> 090 -> third-failure chain, exactly like
// buildValidationRecoverySetupOnlySql() builds for the fifth suite above) so it never reuses or
// disturbs the job any other suite in this file authorizes.
//
// Like the fifth suite, this requires AGT002_TEST_POSTGRES_DESTRUCTIVE opt-in plus a
// loopback-only URL, and always resets `public` in a finally block.
test(
  "real PostgreSQL, real migration chain, isolated setup: migration 091 accepts and records an alternate, equally well-formed attested_rejected_output_hash as the admin's manual attestation, while a malformed one remains rejected",
  { skip: DESTRUCTIVE_ALLOWED ? false : DESTRUCTIVE_SKIP_REASON },
  async () => {
    try {
      const setup = await runPsqlOnce(POSTGRES_URL, buildDestructiveSetupSql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(setup.code, 0, `fixture/migration setup script must succeed: ${setup.stderr}`);

      const jobSetup = await runPsqlOnce(POSTGRES_URL, buildValidationRecoverySetupOnlySql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(jobSetup.code, 0, `owner-session validation-recoverable job setup script must succeed: ${jobSetup.stderr}`);

      const jobSetupLines = jobSetup.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const [jobId, worksetId, operatorRecoveryId, contextRecoveryId] = (jobSetupLines[jobSetupLines.length - 1] ?? '').split('|');
      assert.match(jobId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed job id; stdout: ${jobSetup.stdout}`);
      assert.match(worksetId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed workset id; stdout: ${jobSetup.stdout}`);
      assert.match(operatorRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the real 089 operator_recovery_id; stdout: ${jobSetup.stdout}`);
      assert.match(contextRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the real 090 context_recovery_id; stdout: ${jobSetup.stdout}`);

      // A malformed (non-64-hex) attested_rejected_output_hash must still be rejected before
      // ever touching the job row, exactly as the fifth suite proves against its own job.
      const malformedHashAttempt = await runPsqlOnce(
        POSTGRES_URL,
        `
          set statement_timeout = '10s';
          select public.psi_authorize_agt002_validation_recovery(
            '${jobId}'::uuid, '${worksetId}'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${MALFORMED_REJECTED_OUTPUT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_091_EXPR}
          );
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.notEqual(malformedHashAttempt.code, 0, 'a malformed (non-64-hex) attested_rejected_output_hash must be rejected');

      const auditCountAfterMalformedHash = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid;`,
      );
      assert.equal(auditCountAfterMalformedHash, '0', 'a rejected malformed-hash attempt must never create a validation-recovery audit row');

      // An alternate, equally well-formed hash -- distinct from REJECTED_OUTPUT_HASH_EXPR -- must
      // be accepted outright and recorded exactly as the admin's manual attestation: proves
      // attested_rejected_output_hash is never verified against one specific persisted value.
      const altHashRecovery = await runPsqlOnce(
        POSTGRES_URL,
        `
          set statement_timeout = '${DESTRUCTIVE_CHILD_TIMEOUT_MS}ms';
          select (public.psi_authorize_agt002_validation_recovery(
            '${jobId}'::uuid, '${worksetId}'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${ALT_REJECTED_OUTPUT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_091_EXPR}
          )) ->> 'validation_recovery_id' as validation_recovery_id \\gset

          select status as final_status, (validation_recovery_id is not null)::text as final_job_validation_bound
          from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid \\gset

          select count(*)::text as final_audit_count from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid \\gset
          select attestation_kind as final_attestation_kind, attested_rejected_output_hash as final_rejected_output_hash
          from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid \\gset

          select concat_ws('|',
            :'validation_recovery_id', :'final_status', :'final_job_validation_bound', :'final_audit_count',
            :'final_attestation_kind', :'final_rejected_output_hash'
          );
        `,
        { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS },
      );
      assert.equal(altHashRecovery.code, 0, `the alternate-hash authorize script must succeed: ${altHashRecovery.stderr}`);

      const altHashLines = altHashRecovery.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const [
        validationRecoveryId, finalStatus, finalJobValidationBound, finalAuditCount,
        finalAttestationKind, finalRejectedOutputHash,
      ] = (altHashLines[altHashLines.length - 1] ?? '').split('|');

      assert.ok(validationRecoveryId, 'the authorize function must return a non-null validation_recovery_id for the alternate, well-formed hash');
      assert.equal(finalStatus, 'queued', 'the authorized validation recovery must requeue the job even with the alternate attested hash');
      assert.equal(finalJobValidationBound, 'true', 'the job row must be bound to the returned validation_recovery_id');
      assert.equal(finalAuditCount, '1', 'exactly one audit row must exist for the recovered job');
      assert.equal(finalAttestationKind, 'manual_operator_attestation', 'the alternate hash must still be recorded under the fixed attestation_kind');
      assert.equal(
        finalRejectedOutputHash,
        ALT_REJECTED_OUTPUT_HASH_LITERAL,
        'the audit row must record the exact alternate hash the admin attested, not the one every other suite in this file uses',
      );
    } finally {
      try {
        await resetPublicSchema();
      } catch (error) {
        console.error('failed to reset public schema after the AGT-002 alternate-attested-hash integration test:', error);
      }
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Eighth suite (Phase 8): a real-PostgreSQL, real-migration-chain, two-session regression for
// migration 091's own "Lock order" comment in psi_authorize_agt002_validation_recovery (see
// supabase/migrations/091_agt002_validation_recovery_slot.sql): before taking the canonical
// agt002 lock, the validation-recovery authorizer takes the exact same
// pg_advisory_xact_lock(hashtext('psi_agt002_reanalysis_jobs:' || opportunity_id)) that the
// ordinary psi_create_agt002_reanalysis_job RPC (068/081) takes, in that order -- specifically so
// a genuinely concurrent, ordinary create-job attempt for the same opportunity is serialized
// against it rather than racing past either side's active-job check.
//
// Forward direction: session A opens a transaction, drives a real 091 validation-recovery
// authorization for a job already at the real 091 precondition, and holds the transaction (and
// both advisory locks it took) open for ~1.2s after the authorize function has itself returned --
// i.e. through the requeue, not just through the lock acquisition. Session B, started only once
// A's evidence exists but is still uncommitted, calls the real psi_create_agt002_reanalysis_job
// RPC for the SAME opportunity with a distinct idempotency_key/frozen_engine_input. B must block
// on the shared psi_agt002_reanalysis_jobs:<opportunity> lock until A commits; only once unblocked
// does B's own active-job check run, and -- now seeing A's freshly requeued job -- it must reject
// the mismatched create outright. The opportunity must end with exactly one queued/running job:
// the one 091 authorized.
//
// Reverse direction: session C opens a transaction, calls the real
// psi_create_agt002_reanalysis_job RPC for the SAME opportunity (inserting a second, genuinely new
// job), and holds its transaction open for ~1.2s after the insert. Session D, started only once
// C's insert exists but is still uncommitted, drives the real 091 authorize RPC for the job
// already at the 091 precondition. D must block on the same shared creation lock until C commits;
// only once unblocked does D's own active-job check run, and -- now seeing C's freshly committed
// job -- it must refuse the validation recovery outright, leaving the original job's
// validation_recovery_id null and no audit row.
//
// Neither direction can deadlock: every session that ever touches this lock always takes
// psi_agt002_reanalysis_jobs:<opportunity> first, and only the authorizer additionally takes the
// canonical agt002 lock second -- so lock-acquisition order is always consistent across sessions,
// never reversed between any pair of them.
//
// Like the fifth/seventh suites, this requires AGT002_TEST_POSTGRES_DESTRUCTIVE opt-in plus a
// loopback-only URL, and always resets `public` in a finally block.
const MARKER_CREATE_LOCK_HELD = 'AGT002_CREATE_LOCK_HELD';

/** Concurrent, ordinary create-job attempt for the SAME opportunity as the job under
 * validation-recovery, with a distinct idempotency_key/frozen_engine_input -- so that once it
 * does see the freshly authorized job as active, its own active-job guard must reject it outright
 * rather than return 'existing'. Reads opportunity_id/tender_id/snapshot_id/context_version_id
 * directly off the job row (job_id is a real, server-generated uuid validated by the caller
 * before being interpolated here, so this is always a safe literal) instead of depending on a
 * psql variable set by a possibly-different session. */
function buildConcurrentMismatchedCreateSql(jobId) {
  return `
    set statement_timeout = '10s';
    select opportunity_id, tender_id, snapshot_id, context_version_id
    from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid \\gset
    select public.psi_create_agt002_reanalysis_job(
      :'opportunity_id'::uuid, :'tender_id'::uuid, :'snapshot_id'::uuid, :'context_version_id'::uuid,
      'concurrent-mismatched-create-key', jsonb_build_object('manifest', 'v1-mismatched-concurrent-create'),
      '${D_PROFILE_ID}'::uuid
    );
  `;
}

test(
  'real PostgreSQL, real migration chain, two real sessions: a concurrent ordinary create-job attempt blocks on migration 091\'s shared creation lock during authorization, then is refused once it sees the freshly authorized job',
  { skip: DESTRUCTIVE_ALLOWED ? false : DESTRUCTIVE_SKIP_REASON },
  async () => {
    try {
      const setup = await runPsqlOnce(POSTGRES_URL, buildDestructiveSetupSql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(setup.code, 0, `fixture/migration setup script must succeed: ${setup.stderr}`);

      const jobSetup = await runPsqlOnce(POSTGRES_URL, buildValidationRecoverySetupOnlySql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(jobSetup.code, 0, `owner-session validation-recoverable job setup script must succeed: ${jobSetup.stderr}`);

      const jobSetupLines = jobSetup.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const [jobId, worksetId, operatorRecoveryId, contextRecoveryId] = (jobSetupLines[jobSetupLines.length - 1] ?? '').split('|');
      assert.match(jobId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed job id; stdout: ${jobSetup.stdout}`);
      assert.match(worksetId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed workset id; stdout: ${jobSetup.stdout}`);
      assert.match(operatorRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the real 089 operator_recovery_id; stdout: ${jobSetup.stdout}`);
      assert.match(contextRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the real 090 context_recovery_id; stdout: ${jobSetup.stdout}`);

      // Session A: authorize the validation recovery, but hold the transaction (and both
      // advisory locks it took) open for ~1.2s after the authorize function has itself returned.
      const sessionA = spawnPsql(POSTGRES_URL, buildValidationRecoveryAuthorizeRaceSessionSql(jobId, worksetId), { timeoutMs: RACE_CHILD_TIMEOUT_MS });
      await sessionA.waitForMarker(MARKER_VALIDATION_AUTH_UNCOMMITTED);

      // Session B starts only once A's authorization evidence exists but is still uncommitted:
      // it drives the real, ordinary create-job RPC for the same opportunity. It must block on
      // the shared creation lock until A commits.
      const tBeforeB = Date.now();
      const sessionBDone = runPsqlOnce(POSTGRES_URL, buildConcurrentMismatchedCreateSql(jobId), { timeoutMs: RACE_CHILD_TIMEOUT_MS });

      const [resultA, resultB] = await Promise.all([sessionA.done, sessionBDone]);
      const tAfterB = Date.now();

      assert.equal(resultA.code, 0, `session A (validation-recovery authorizer) must commit successfully: ${resultA.stderr}`);
      assert.notEqual(resultB.code, 0, 'session B (concurrent create) must be refused once it sees the freshly authorized, now-active job');
      assert.match(
        resultB.stderr,
        /Ya existe otro trabajo AGT-002 activo para la oportunidad/,
        `the concurrent create must fail with the ordinary active-job guard message: ${resultB.stderr}`,
      );
      assert.ok(
        tAfterB - tBeforeB >= 900,
        `session B must have blocked on the shared creation lock session A held through authorization (took ${tAfterB - tBeforeB}ms)`,
      );

      // Exactly one queued/running job must exist for the opportunity: the one 091 authorized.
      // B's refused create attempt must never have inserted anything.
      const activeJobCount = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_reanalysis_jobs where opportunity_id = '${D_OPPORTUNITY_ID}'::uuid and status in ('queued', 'running');`,
      );
      assert.equal(activeJobCount, '1', 'exactly one queued/running job must exist for the opportunity after the refused concurrent create');

      const jobRow = await queryScalar(
        POSTGRES_URL,
        `select concat_ws('|', status, (validation_recovery_id is not null)::text, operator_recovery_id::text, context_recovery_id::text) from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid;`,
      );
      const [finalStatus, isValidationBound, finalOperatorRecoveryId, finalContextRecoveryId] = jobRow.split('|');
      assert.equal(finalStatus, 'queued', 'the authorized job must remain queued after the refused concurrent create');
      assert.equal(isValidationBound, 'true', 'the authorized job must remain bound to its validation_recovery_id');
      assert.equal(finalOperatorRecoveryId, operatorRecoveryId, 'the prior 089 binding must remain unchanged');
      assert.equal(finalContextRecoveryId, contextRecoveryId, 'the prior 090 binding must remain unchanged');

      const auditCount = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid;`,
      );
      assert.equal(auditCount, '1', 'exactly one validation-recovery audit row must exist for the authorized job');
    } finally {
      try {
        await resetPublicSchema();
      } catch (error) {
        console.error('failed to reset public schema after the AGT-002 create-vs-091-authorizer forward-direction race integration test:', error);
      }
    }
  },
);

/** Session C: opens a transaction, calls the real, ordinary create-job RPC for the SAME
 * opportunity as the job under validation-recovery (inserting a second, genuinely new job),
 * emits a marker once the insert has returned but while the transaction (and its creation-lock
 * hold) is still uncommitted, holds the transaction open for ~1.2s, then commits. Reads
 * opportunity_id/tender_id/snapshot_id/context_version_id directly off the existing job row
 * (job_id is a real, server-generated uuid validated by the caller before being interpolated
 * here, so this is always a safe literal). */
function buildConcurrentCreatorHoldsLockSessionSql(jobId) {
  return `
    set statement_timeout = '10s';
    begin;
    select opportunity_id, tender_id, snapshot_id, context_version_id
    from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid \\gset
    select (public.psi_create_agt002_reanalysis_job(
      :'opportunity_id'::uuid, :'tender_id'::uuid, :'snapshot_id'::uuid, :'context_version_id'::uuid,
      'reverse-race-create-key', jsonb_build_object('manifest', 'v1-reverse-race-create'), '${D_PROFILE_ID}'::uuid
    )) ->> 'job_id' as new_job_id \\gset
    \\echo ${MARKER_CREATE_LOCK_HELD}
    select pg_sleep(1.2);
    commit;
    select :'new_job_id';
  `;
}

test(
  'real PostgreSQL, real migration chain, two real sessions, reverse ordering: a concurrent ordinary create-job attempt holds migration 091\'s shared creation lock first, and the validation-recovery authorizer blocks then refuses once it sees the freshly committed job',
  { skip: DESTRUCTIVE_ALLOWED ? false : DESTRUCTIVE_SKIP_REASON },
  async () => {
    try {
      const setup = await runPsqlOnce(POSTGRES_URL, buildDestructiveSetupSql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(setup.code, 0, `fixture/migration setup script must succeed: ${setup.stderr}`);

      const jobSetup = await runPsqlOnce(POSTGRES_URL, buildValidationRecoverySetupOnlySql(), { timeoutMs: DESTRUCTIVE_CHILD_TIMEOUT_MS });
      assert.equal(jobSetup.code, 0, `owner-session validation-recoverable job setup script must succeed: ${jobSetup.stderr}`);

      const jobSetupLines = jobSetup.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const [jobId, worksetId, priorOperatorRecoveryId, priorContextRecoveryId] = (jobSetupLines[jobSetupLines.length - 1] ?? '').split('|');
      assert.match(jobId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed job id; stdout: ${jobSetup.stdout}`);
      assert.match(worksetId, /^[0-9a-f-]{36}$/i, `setup must report a well-formed workset id; stdout: ${jobSetup.stdout}`);
      assert.match(priorOperatorRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the prior 089 operator_recovery_id; stdout: ${jobSetup.stdout}`);
      assert.match(priorContextRecoveryId, /^[0-9a-f-]{36}$/i, `setup must report the prior 090 context_recovery_id; stdout: ${jobSetup.stdout}`);

      // Session C: creates a second, genuinely new job for the same opportunity, but holds the
      // transaction (and the creation lock it took) open for ~1.2s after the insert.
      const sessionC = spawnPsql(POSTGRES_URL, buildConcurrentCreatorHoldsLockSessionSql(jobId), { timeoutMs: RACE_CHILD_TIMEOUT_MS });
      await sessionC.waitForMarker(MARKER_CREATE_LOCK_HELD);

      // Session D starts only once C's insert exists but is still uncommitted: it drives the
      // real 091 authorize RPC for the job already at the 091 precondition. It must block on the
      // same shared creation lock until C commits.
      const tBeforeD = Date.now();
      const sessionDDone = runPsqlOnce(
        POSTGRES_URL,
        `
          set statement_timeout = '10s';
          select public.psi_authorize_agt002_validation_recovery(
            '${jobId}'::uuid, '${worksetId}'::uuid, 3, ${CONTEXT_HASH_EXPR}, ${REJECTED_OUTPUT_HASH_EXPR}, ${REPAIR_COMMIT_SHA_091_EXPR}
          );
        `,
        { timeoutMs: RACE_CHILD_TIMEOUT_MS },
      );

      const [resultC, resultD] = await Promise.all([sessionC.done, sessionDDone]);
      const tAfterD = Date.now();

      assert.equal(resultC.code, 0, `session C (concurrent creator) must commit successfully: ${resultC.stderr}`);
      assert.notEqual(resultD.code, 0, 'session D (validation-recovery authorizer) must be refused once it sees the freshly committed, now-active job');
      assert.match(
        resultD.stderr,
        /existe otro trabajo activo \(queued\/running\) para la oportunidad/,
        `the validation-recovery authorization must fail with the same active-job guard message the 089/090 authorizers use: ${resultD.stderr}`,
      );
      assert.ok(
        tAfterD - tBeforeD >= 900,
        `session D must have blocked on the shared creation lock session C held (took ${tAfterD - tBeforeD}ms)`,
      );

      const cLines = resultC.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const newJobId = cLines[cLines.length - 1] ?? '';
      assert.match(newJobId, /^[0-9a-f-]{36}$/i, `session C must report a well-formed new job id; stdout: ${resultC.stdout}`);
      assert.notEqual(newJobId, jobId, 'the concurrently created job must be a genuinely different job from the one under validation-recovery');

      // Exactly one queued/running job must exist for the opportunity: session C's new job. The
      // original job under validation-recovery stays 'unavailable' (not active), and D's refused
      // authorization must never have requeued it.
      const activeJobCount = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_reanalysis_jobs where opportunity_id = '${D_OPPORTUNITY_ID}'::uuid and status in ('queued', 'running');`,
      );
      assert.equal(activeJobCount, '1', 'exactly one queued/running job must exist for the opportunity: only session C\'s new job');

      const newJobStatus = await queryScalar(
        POSTGRES_URL,
        `select status from public.psi_agt002_reanalysis_jobs where id = '${newJobId}'::uuid;`,
      );
      assert.equal(newJobStatus, 'queued', 'the concurrently created job must be queued');

      const jobRow = await queryScalar(
        POSTGRES_URL,
        `select concat_ws('|', status, (validation_recovery_id is not null)::text, operator_recovery_id::text, context_recovery_id::text) from public.psi_agt002_reanalysis_jobs where id = '${jobId}'::uuid;`,
      );
      const [finalStatus, isValidationBound, finalOperatorRecoveryId, finalContextRecoveryId] = jobRow.split('|');
      assert.equal(finalStatus, 'unavailable', 'the original job must remain unavailable: the refused authorization must never have requeued it');
      assert.equal(isValidationBound, 'false', 'the refused authorization must never bind validation_recovery_id');
      assert.equal(finalOperatorRecoveryId, priorOperatorRecoveryId, 'the prior 089 binding must remain unchanged by the refused authorization');
      assert.equal(finalContextRecoveryId, priorContextRecoveryId, 'the prior 090 binding must remain unchanged by the refused authorization');

      const auditCount = await queryScalar(
        POSTGRES_URL,
        `select count(*)::text from public.psi_agt002_validation_recoveries where job_id = '${jobId}'::uuid;`,
      );
      assert.equal(auditCount, '0', 'the refused authorization must never create a validation-recovery audit row');
    } finally {
      try {
        await resetPublicSchema();
      } catch (error) {
        console.error('failed to reset public schema after the AGT-002 create-vs-091-authorizer reverse-direction race integration test:', error);
      }
    }
  },
);
