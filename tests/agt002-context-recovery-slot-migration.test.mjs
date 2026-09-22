// AGT-002 context-recovery — static migration contract.
//
// Migration 090 layers a SECOND, narrower database-enforced audit trail + one-way binding on
// top of 089's operator-recovery slot. It targets jobs that already carry a 089
// operator_recovery_id and then failed a second time, at exactly the automatic cap, because
// their frozen engine input predates contextV2Sections while the job's own environment flag
// still requires AGT002_CONTEXT_V2. Migration 090:
//
//   * Adds an append-only, service_role-readable-only audit table,
//     public.psi_agt002_context_recoveries (job_id unique), with a repair_commit_sha and a
//     source_context_hash of the governed context version at the moment of recovery, a
//     closed-vocabulary reason_code fixed to 'rehydrated_legacy_context_v2_sections', and a
//     server-derived authorized_by/authorized_at.
//   * Adds jobs.context_recovery_id (nullable, unique, FK to the audit table, ON DELETE
//     RESTRICT) and replaces the 089 jobs guard trigger function in place so that
//     context_recovery_id gains the analogous null -> real-audit-row-once rule, gated to an
//     unavailable -> queued transition at the automatic cap where the job's existing
//     operator_recovery_id is already set and stays unchanged, while every existing 089
//     operator_recovery_id rule is preserved byte-for-byte, and any at-cap requeue must bind
//     exactly one of operator_recovery_id/context_recovery_id.
//   * Adds the owner-only SECURITY DEFINER function
//     public.psi_authorize_agt002_context_recovery(uuid, uuid, integer, text), reachable by NO
//     role (not even service_role), that re-verifies every precondition (job state, prior 089
//     recovery, workset identity, exact semantic-discovery checkpoint history, the governed
//     context version's rehydrated contextV2Sections, the job's own frozen analysis_context/
//     analysis_flags, no colliding tender analysis run, no other active job for the
//     opportunity) before inserting the one audit row and requeuing the job in the same
//     transaction. resume_count/the automatic cap stay exactly at 5, untouched.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATION_URL = new URL('../supabase/migrations/090_agt002_context_recovery_slot.sql', import.meta.url);
const ROLLBACK_URL = new URL('../supabase/rollbacks/090_agt002_context_recovery_slot_rollback.sql', import.meta.url);

const JOBS_TABLE = 'psi_agt002_reanalysis_jobs';
const WORKSETS_TABLE = 'psi_agt002_analysis_worksets';
const CHECKPOINTS_TABLE = 'psi_agt002_analysis_checkpoints';
const ANALYSIS_RUNS_TABLE = 'psi_tender_analysis_runs';
const CONTEXT_VERSIONS_TABLE = 'psi_agt002_context_versions';
const OPERATOR_AUDIT_TABLE = 'psi_agt002_operator_recoveries';
const AUDIT_TABLE = 'psi_agt002_context_recoveries';
const NEW_JOBS_COLUMN = 'context_recovery_id';
const OPERATOR_JOBS_COLUMN = 'operator_recovery_id';
const REASON_CODE = 'rehydrated_legacy_context_v2_sections';
const FUNCTION_NAME = 'psi_authorize_agt002_context_recovery';
const FUNCTION_SIGNATURE = `${FUNCTION_NAME}(uuid, uuid, integer, text, text)`;
const GUARD_FUNCTION_NAME = 'psi_agt002_reanalysis_jobs_guard_operator_recovery';

/** Statement text only: an explanatory `--` comment must never satisfy — or trip — a check. */
function withoutComments(sql) {
  return sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
}

function readSql(url, label) {
  assert.ok(
    existsSync(url),
    `${label} must exist: the AGT-002 context-recovery slot needs the additive migration 090_agt002_context_recovery_slot`,
  );
  return readFileSync(url, 'utf8');
}

function migrationSql() {
  return withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/090_agt002_context_recovery_slot.sql'));
}

function rollbackSql() {
  return withoutComments(readSql(ROLLBACK_URL, 'supabase/rollbacks/090_agt002_context_recovery_slot_rollback.sql'));
}

function authorizeFunctionBody(migration) {
  const match = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,20000}?\$\$;`, 'i'),
  );
  assert.ok(match, `must find the full body of public.${FUNCTION_NAME}`);
  return match[0];
}

function guardFunctionBody(migration) {
  const match = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${GUARD_FUNCTION_NAME}\s*\(\s*\)[\s\S]{0,8000}?\$\$;`, 'i'),
  );
  assert.ok(match, `must find the full body of public.${GUARD_FUNCTION_NAME}`);
  return match[0];
}

// -------------------------------------------------------------------------------------------
// Migration shape
// -------------------------------------------------------------------------------------------

test('migration 090 exists and is one transaction', () => {
  const migration = migrationSql();
  assert.match(migration, /^\s*begin;/im, 'the migration must run inside one transaction');
  assert.match(migration, /^\s*commit;/im, 'the migration must commit its single transaction');
});

test('migration 090 creates the append-only context-recovery audit table with every required column and type', () => {
  const migration = migrationSql();
  assert.match(
    migration,
    new RegExp(String.raw`create\s+table\s+(if\s+not\s+exists\s+)?public\.${AUDIT_TABLE}\s*\(`, 'i'),
    `migration 090 must create public.${AUDIT_TABLE}`,
  );
  assert.match(migration, /id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid\s*\(\s*\)/i, 'the audit table id must be uuid primary key default gen_random_uuid()');
  assert.match(
    migration,
    new RegExp(String.raw`job_id\s+uuid\s+not\s+null\s+unique\s+references\s+public\.${JOBS_TABLE}\s*\(\s*id\s*\)\s*on\s+delete\s+restrict`, 'i'),
    `job_id must be uuid not null unique, FK to public.${JOBS_TABLE}(id) on delete restrict`,
  );
  assert.match(
    migration,
    new RegExp(String.raw`workset_id\s+uuid\s+not\s+null\s+references\s+public\.${WORKSETS_TABLE}\s*\(\s*id\s*\)\s*on\s+delete\s+restrict`, 'i'),
    `workset_id must be uuid not null, FK to public.${WORKSETS_TABLE}(id) on delete restrict`,
  );
  assert.match(
    migration,
    /completed_batch_count\s+integer\s+not\s+null\s+check\s*\(\s*completed_batch_count\s*>\s*0\s*\)/i,
    'completed_batch_count must be integer not null, bounded > 0',
  );
  assert.match(
    migration,
    /repair_commit_sha\s+text\s+not\s+null\s+check\s*\(\s*repair_commit_sha\s*~\s*'\^\[0-9a-f\]\{40\}\$'\s*\)/i,
    'repair_commit_sha must be text not null, bounded to exactly lowercase 40 hex characters',
  );
  assert.match(
    migration,
    /source_context_hash\s+text\s+not\s+null\s+check\s*\(\s*source_context_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\s*\)/i,
    'source_context_hash must be text not null, bounded to exactly lowercase 64 hex characters',
  );
  assert.match(
    migration,
    new RegExp(String.raw`reason_code\s+text\s+not\s+null[\s\S]{0,160}check\s*\(\s*reason_code\s*=\s*'${REASON_CODE}'\s*\)`, 'i'),
    `reason_code must be text not null and closed to exactly '${REASON_CODE}'`,
  );
  assert.match(migration, /authorized_by\s+text\s+not\s+null/i, 'authorized_by must be text not null');
  assert.match(migration, /authorized_at\s+timestamptz\s+not\s+null\s+default\s+now\s*\(\s*\)/i, 'authorized_at must be timestamptz not null default now()');
});

test('migration 090 never accepts authorized_by as a literal caller-suppliable table default', () => {
  const migration = migrationSql();
  assert.doesNotMatch(
    migration, /authorized_by\s+text\s+not\s+null\s+default/i,
    'authorized_by must never have a DDL-level default: it is only ever derived server-side inside the authorize function',
  );
});

test('migration 090 enables RLS on the context-recovery audit table, revokes every direct role, and grants only service_role SELECT', () => {
  const migration = migrationSql();
  assert.match(
    migration, new RegExp(String.raw`alter\s+table\s+public\.${AUDIT_TABLE}\s+enable\s+row\s+level\s+security`, 'i'),
    `migration 090 must enable row level security on public.${AUDIT_TABLE}`,
  );
  assert.match(
    migration,
    new RegExp(String.raw`revoke\s+all\s+on\s+table\s+public\.${AUDIT_TABLE}\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role`, 'i'),
    `migration 090 must revoke all privileges on public.${AUDIT_TABLE} from public, anon, authenticated, and service_role`,
  );
  assert.match(
    migration, new RegExp(String.raw`grant\s+select\s+on\s+table\s+public\.${AUDIT_TABLE}\s+to\s+service_role`, 'i'),
    `migration 090 must grant SELECT only on public.${AUDIT_TABLE} to service_role`,
  );
  assert.doesNotMatch(
    migration, new RegExp(String.raw`grant\s+(insert|update|delete|all)\s+on\s+table\s+public\.${AUDIT_TABLE}`, 'i'),
    `migration 090 must never grant INSERT/UPDATE/DELETE on public.${AUDIT_TABLE} to any role`,
  );
});

test('migration 090 creates an immutable-audit trigger that rejects UPDATE and DELETE on the context-recovery audit table', () => {
  const migration = migrationSql();
  assert.match(
    migration, /raise\s+exception[\s\S]{0,400}(append-only|immutable|inmutable)/i,
    'the audit table must have a trigger function that raises an exception rejecting mutation',
  );
  assert.match(
    migration,
    new RegExp(String.raw`create\s+trigger\s+\S+\s+before\s+update\s+or\s+delete\s+on\s+public\.${AUDIT_TABLE}`, 'i'),
    `migration 090 must create a BEFORE UPDATE OR DELETE trigger on public.${AUDIT_TABLE}`,
  );
});

test(`migration 090 adds ${JOBS_TABLE}.${NEW_JOBS_COLUMN} as a nullable, unique FK to the context-recovery audit table`, () => {
  const migration = migrationSql();
  assert.match(
    migration,
    new RegExp(
      String.raw`alter\s+table\s+public\.${JOBS_TABLE}\s+add\s+column\s+(if\s+not\s+exists\s+)?${NEW_JOBS_COLUMN}\s+uuid\s+unique\s+references\s+public\.${AUDIT_TABLE}\s*\(\s*id\s*\)\s*on\s+delete\s+restrict`,
      'i',
    ),
    `migration 090 must add public.${JOBS_TABLE}.${NEW_JOBS_COLUMN} as a nullable uuid, unique, FK to public.${AUDIT_TABLE}(id) on delete restrict`,
  );
  assert.doesNotMatch(
    migration,
    new RegExp(String.raw`${NEW_JOBS_COLUMN}\s+uuid\s+not\s+null`, 'i'),
    `${NEW_JOBS_COLUMN} must stay nullable: a job never context-recovered keeps it null`,
  );
});

test('migration 090 does not create a new jobs trigger: it replaces the existing 089 guard function body in place', () => {
  const migration = migrationSql();
  assert.doesNotMatch(
    migration,
    new RegExp(String.raw`create\s+trigger\s+\S+\s+before\s+update\s+on\s+public\.${JOBS_TABLE}`, 'i'),
    `migration 090 must not create a new BEFORE UPDATE trigger on public.${JOBS_TABLE}: it reuses 089's trigger and only replaces the function it points to`,
  );
  assert.match(
    migration,
    new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${GUARD_FUNCTION_NAME}\s*\(\s*\)`, 'i'),
    `migration 090 must replace public.${GUARD_FUNCTION_NAME} in place with CREATE OR REPLACE FUNCTION`,
  );
});

test('the replaced jobs guard preserves 089 operator_recovery_id immutability and same-job binding unchanged', () => {
  const guard = guardFunctionBody(migrationSql());
  assert.match(
    guard,
    new RegExp(String.raw`old\.${OPERATOR_JOBS_COLUMN}\s+is\s+not\s+null\s+and\s+new\.${OPERATOR_JOBS_COLUMN}\s+is\s+distinct\s+from\s+old\.${OPERATOR_JOBS_COLUMN}[\s\S]{0,200}raise\s+exception`, 'i'),
    'the guard must still reject any rewrite of operator_recovery_id once it is already set',
  );
  assert.match(
    guard,
    new RegExp(String.raw`from\s+public\.${OPERATOR_AUDIT_TABLE}[\s\S]{0,200}job_id[\s\S]{0,120}new\.id`, 'i'),
    'the guard must still verify the operator_recovery_id audit row belongs to the same job',
  );
  assert.match(
    guard, /resume_count\s*>=\s*5/i,
    'the guard must still gate operator_recovery_id binding on old.resume_count >= 5 (the automatic reclaim cap)',
  );
});

test('the replaced jobs guard adds one-way context_recovery_id binding fenced to the same job at exactly the automatic cap', () => {
  const guard = guardFunctionBody(migrationSql());
  assert.match(
    guard,
    new RegExp(String.raw`old\.${NEW_JOBS_COLUMN}\s+is\s+not\s+null\s+and\s+new\.${NEW_JOBS_COLUMN}\s+is\s+distinct\s+from\s+old\.${NEW_JOBS_COLUMN}[\s\S]{0,200}raise\s+exception`, 'i'),
    'the guard must reject any rewrite of context_recovery_id once it is already set',
  );
  assert.match(
    guard,
    new RegExp(String.raw`from\s+public\.${AUDIT_TABLE}[\s\S]{0,200}job_id[\s\S]{0,120}new\.id`, 'i'),
    'the guard must verify the context_recovery_id audit row belongs to the same job',
  );
  assert.match(
    guard, /old\.resume_count\s*=\s*5/i,
    'the guard must gate context_recovery_id binding on old.resume_count = 5 exactly (already at the automatic cap)',
  );
});

test('the replaced jobs guard requires context_recovery_id binding to keep the existing operator_recovery_id unchanged', () => {
  const guard = guardFunctionBody(migrationSql());
  assert.match(
    guard,
    new RegExp(
      String.raw`old\.${OPERATOR_JOBS_COLUMN}\s+is\s+null\s+or\s+new\.${OPERATOR_JOBS_COLUMN}\s+is\s+distinct\s+from\s+old\.${OPERATOR_JOBS_COLUMN}`,
      'i',
    ),
    `the guard must require old.${OPERATOR_JOBS_COLUMN} already set and new.${OPERATOR_JOBS_COLUMN} unchanged whenever ${NEW_JOBS_COLUMN} is being bound`,
  );
});

test('the replaced jobs guard requires exactly one of operator_recovery_id/context_recovery_id on any at-cap requeue', () => {
  const guard = guardFunctionBody(migrationSql());
  assert.match(
    guard, /v_operator_bound\s+and\s+v_context_bound/i,
    'the guard must detect the case where both recovery ids are bound in the same statement',
  );
  assert.match(
    guard, /not\s+v_operator_bound\s+and\s+not\s+v_context_bound/i,
    'the guard must detect the case where neither recovery id is bound in the same statement',
  );
  assert.match(
    guard,
    /\(v_operator_bound\s+and\s+v_context_bound\)\s*or\s*\(not\s+v_operator_bound\s+and\s+not\s+v_context_bound\)[\s\S]{0,200}raise\s+exception/i,
    'the guard must raise an exception unless exactly one of the two recovery ids is bound on an at-cap unavailable -> queued transition',
  );
});

// -------------------------------------------------------------------------------------------
// The owner-only authorize function
// -------------------------------------------------------------------------------------------

test('migration 090 creates the owner-only authorize function with exactly the required 5-parameter signature', () => {
  const migration = migrationSql();
  assert.match(
    migration,
    new RegExp(
      String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\(\s*p_job_id\s+uuid\s*,\s*p_workset_id\s+uuid\s*,\s*p_expected_completed_batch_count\s+integer\s*,\s*p_expected_context_hash\s+text\s*,\s*p_repair_commit_sha\s+text\s*\)\s*returns\s+jsonb`,
      'i',
    ),
    `migration 090 must create public.${FUNCTION_NAME}(p_job_id uuid, p_workset_id uuid, p_expected_completed_batch_count integer, p_expected_context_hash text, p_repair_commit_sha text) returns jsonb`,
  );
});

test('the authorize function is SECURITY DEFINER with a pinned search_path', () => {
  const body = authorizeFunctionBody(migrationSql());
  assert.match(body, /security\s+definer/i, 'the authorize function must be SECURITY DEFINER');
  assert.match(body, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i, 'the authorize function must pin search_path to public, pg_temp');
});

test('the authorize function never accepts an operator identity, a reason, or any free-text parameter beyond the documented 5', () => {
  const migration = migrationSql();
  const signatureMatch = migration.match(
    new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\(([\s\S]*?)\)\s*returns\s+jsonb`, 'i'),
  );
  assert.ok(signatureMatch, `must find the parameter list of public.${FUNCTION_NAME}`);
  const params = signatureMatch[1].toLowerCase();
  for (const forbidden of ['p_actor', 'p_authorized_by', 'p_reason', 'p_notes', 'p_operator', 'p_message', 'p_comment']) {
    assert.doesNotMatch(
      params, new RegExp(forbidden, 'i'),
      `public.${FUNCTION_NAME} must never accept a caller-supplied '${forbidden}*' parameter: identity and reason are always server-derived`,
    );
  }
  assert.equal(
    (params.match(/\bp_\w+/g) || []).length, 5,
    `public.${FUNCTION_NAME} must accept exactly the 5 documented parameters, no more`,
  );
});

test('the authorize function derives authorized_by from session_user and the fixed reason_code internally', () => {
  const body = authorizeFunctionBody(migrationSql());
  assert.match(body, /session_user/i, 'the authorize function must derive authorized_by from session_user');
  assert.match(
    body, new RegExp(`'${REASON_CODE}'`),
    `the authorize function must insert the fixed reason_code '${REASON_CODE}' internally`,
  );
});

test('the authorize function validates a lowercase 40-hex repair_commit_sha before doing anything else', () => {
  const body = authorizeFunctionBody(migrationSql());
  assert.match(
    body, /p_repair_commit_sha\s*!~\s*'\^\[0-9a-f\]\{40\}\$'/i,
    'the authorize function must validate p_repair_commit_sha against ^[0-9a-f]{40}$',
  );
});

test('the authorize function locks the exact job row and validates every documented precondition', () => {
  const body = authorizeFunctionBody(migrationSql());

  assert.match(
    body, new RegExp(String.raw`from\s+public\.${JOBS_TABLE}[\s\S]{0,120}for\s+update`, 'i'),
    `the authorize function must SELECT ... FOR UPDATE the exact job row from public.${JOBS_TABLE}`,
  );

  const requiredJobChecks = [
    /v_job\.status\s+is\s+distinct\s+from\s+'unavailable'/i,
    /v_job\.error_code\s+is\s+distinct\s+from\s+'invalid_output'/i,
    /v_job\.error_message\s+is\s+distinct\s+from\s+'El resultado del motor no super/i,
    /v_job\.execution_mode\s+is\s+distinct\s+from\s+'durable_batched_v1'/i,
    /v_job\.phase\s+is\s+distinct\s+from\s+'semantic_discovery'/i,
    /v_job\.resume_count\s+is\s+distinct\s+from\s+5/i,
    /v_job\.lease_id\s+is\s+not\s+null/i,
    /v_job\.analysis_run_id\s+is\s+not\s+null/i,
    new RegExp(String.raw`v_job\.${OPERATOR_JOBS_COLUMN}\s+is\s+null`, 'i'),
    new RegExp(String.raw`v_job\.${NEW_JOBS_COLUMN}\s+is\s+not\s+null`, 'i'),
    /v_job\.completed_batch_count\s+is\s+distinct\s+from\s+p_expected_completed_batch_count/i,
    /v_job\.total_batch_count\s+is\s+distinct\s+from\s+p_expected_completed_batch_count/i,
  ];
  for (const pattern of requiredJobChecks) {
    assert.match(body, pattern, `the authorize function must validate: ${pattern}`);
  }
});

test('the authorize function requires a valid prior 089 operator recovery bound to the same job', () => {
  const body = authorizeFunctionBody(migrationSql());
  assert.match(
    body,
    new RegExp(String.raw`from\s+public\.${OPERATOR_AUDIT_TABLE}\s+where\s+id\s*=\s*v_job\.${OPERATOR_JOBS_COLUMN}`, 'i'),
    `the authorize function must look up public.${OPERATOR_AUDIT_TABLE} by v_job.${OPERATOR_JOBS_COLUMN}`,
  );
  assert.match(
    body, /not\s+found\s+or\s+v_operator_audit\.job_id\s+is\s+distinct\s+from\s+v_job\.id/i,
    'the authorize function must require the 089 operator audit row to belong to this exact job',
  );
});

test('the authorize function takes the canonical opportunity advisory lock after locking the job but before touching tender analysis runs or writing the audit/requeue', () => {
  const body = authorizeFunctionBody(migrationSql());

  const forUpdateIdx = body.search(
    new RegExp(String.raw`from\s+public\.${JOBS_TABLE}[\s\S]{0,120}for\s+update`, 'i'),
  );
  assert.ok(forUpdateIdx >= 0, `the authorize function must SELECT ... FOR UPDATE the job from public.${JOBS_TABLE}`);

  const lockMatch = body.match(
    /pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*'agt002-canonical:'\s*\|\|\s*v_job\.opportunity_id\s*::\s*text\s*,\s*0\s*\)\s*\)/i,
  );
  assert.ok(
    lockMatch,
    "the authorize function must take pg_advisory_xact_lock(hashtextextended('agt002-canonical:' || v_job.opportunity_id::text, 0)) to serialize concurrent recovery/reclaim on the same opportunity",
  );
  const lockIdx = body.indexOf(lockMatch[0]);

  const analysisRunsIdx = body.search(new RegExp(String.raw`from\s+public\.${ANALYSIS_RUNS_TABLE}`, 'i'));
  assert.ok(analysisRunsIdx >= 0, `the authorize function must query public.${ANALYSIS_RUNS_TABLE}`);

  const insertIdx = body.search(new RegExp(String.raw`insert\s+into\s+public\.${AUDIT_TABLE}`, 'i'));
  const updateIdx = body.search(new RegExp(String.raw`update\s+public\.${JOBS_TABLE}\s+set`, 'i'));
  assert.ok(insertIdx >= 0, `the authorize function must insert into public.${AUDIT_TABLE}`);
  assert.ok(updateIdx >= 0, `the authorize function must update public.${JOBS_TABLE}`);

  assert.ok(
    forUpdateIdx < lockIdx,
    'the advisory lock must be taken only after the job row is already locked with SELECT ... FOR UPDATE',
  );
  assert.ok(
    lockIdx < analysisRunsIdx,
    `the advisory lock must be taken before the first query of public.${ANALYSIS_RUNS_TABLE}`,
  );
  assert.ok(
    lockIdx < insertIdx,
    `the advisory lock must be taken before the audit row is inserted into public.${AUDIT_TABLE}`,
  );
  assert.ok(
    lockIdx < updateIdx,
    `the advisory lock must be taken before the job is requeued via public.${JOBS_TABLE}`,
  );
});

test('the authorize function validates the exact 5-field workset identity: idempotency_key, opportunity/tender/snapshot/context_version, unpublished, no published run, not archived', () => {
  const body = authorizeFunctionBody(migrationSql());

  assert.match(
    body, new RegExp(String.raw`from\s+public\.${WORKSETS_TABLE}`, 'i'),
    `the authorize function must read public.${WORKSETS_TABLE}`,
  );
  assert.match(
    body, /v_workset\.idempotency_key\s+is\s+distinct\s+from\s+v_job\.idempotency_key/i,
    'the authorize function must bind the workset to the job by idempotency_key',
  );

  for (const field of ['opportunity_id', 'tender_id', 'snapshot_id', 'context_version_id']) {
    assert.match(
      body, new RegExp(String.raw`v_workset\.${field}\s+is\s+distinct\s+from\s+v_job\.${field}`, 'i'),
      `the authorize function must reject a workset whose ${field} does not equal the job's ${field}`,
    );
  }

  assert.match(body, /v_workset\.published\s+is\s+true/i, 'the authorize function must reject a published workset');
  assert.match(
    body, /v_workset\.published_analysis_run_id\s+is\s+not\s+null/i,
    'the authorize function must reject a workset carrying a published_analysis_run_id',
  );
  assert.match(body, /v_workset\.archived_at\s+is\s+not\s+null/i, 'the authorize function must reject an archived workset');
});

test('the authorize function requires exactly N-1 contiguous semantic checkpoints, exactly one manifest, and no checkpoint of any other stage', () => {
  const body = authorizeFunctionBody(migrationSql());

  assert.match(
    body,
    new RegExp(String.raw`from\s+public\.${CHECKPOINTS_TABLE}[\s\S]{0,200}stage\s*=\s*'semantic_discovery_batch'`, 'i'),
    `the authorize function must count public.${CHECKPOINTS_TABLE} rows restricted to stage = 'semantic_discovery_batch'`,
  );
  assert.match(
    body, /v_batch_count\s+is\s+distinct\s+from\s*\(\s*p_expected_completed_batch_count\s*-\s*1\s*\)/i,
    'the authorize function must require exactly p_expected_completed_batch_count - 1 semantic_discovery_batch checkpoints',
  );
  assert.match(
    body, /v_max_batch_index\s+is\s+distinct\s+from\s*\(\s*p_expected_completed_batch_count\s*-\s*2\s*\)/i,
    'the authorize function must verify the checkpoints are exactly contiguous 0..N-2 via max(batch_index)',
  );
  assert.match(
    body,
    new RegExp(String.raw`from\s+public\.${CHECKPOINTS_TABLE}[\s\S]{0,200}stage\s*=\s*'semantic_manifest'`, 'i'),
    `the authorize function must count public.${CHECKPOINTS_TABLE} rows restricted to stage = 'semantic_manifest'`,
  );
  assert.match(
    body, /v_manifest_count\s+is\s+distinct\s+from\s+1/i,
    'the authorize function must require exactly one semantic_manifest checkpoint',
  );
  assert.match(
    body,
    new RegExp(String.raw`from\s+public\.${CHECKPOINTS_TABLE}[\s\S]{0,200}stage\s+not\s+in\s*\(\s*'semantic_discovery_batch'\s*,\s*'semantic_manifest'\s*\)`, 'i'),
    `the authorize function must reject any public.${CHECKPOINTS_TABLE} row outside semantic_discovery_batch/semantic_manifest`,
  );
});

test('the authorize function validates the exact governed context identity, hash equality against p_expected_context_hash, snapshot binding, and the root context shape', () => {
  const body = authorizeFunctionBody(migrationSql());

  assert.match(
    body, new RegExp(String.raw`from\s+public\.${CONTEXT_VERSIONS_TABLE}\s+where\s+id\s*=\s*v_job\.context_version_id`, 'i'),
    `the authorize function must read public.${CONTEXT_VERSIONS_TABLE} by the job's context_version_id`,
  );
  for (const field of ['opportunity_id', 'tender_id', 'snapshot_id']) {
    assert.match(
      body, new RegExp(String.raw`v_context\.${field}\s+is\s+distinct\s+from\s+v_job\.${field}`, 'i'),
      `the authorize function must reject a context version whose ${field} does not equal the job's ${field}`,
    );
  }
  assert.match(
    body, /v_context\.context_hash\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/i,
    'the authorize function must validate v_context.context_hash against ^[0-9a-f]{64}$',
  );
  assert.match(
    body, /v_context\.context_hash\s+is\s+distinct\s+from\s+p_expected_context_hash/i,
    'the authorize function must reject unless v_context.context_hash equals the caller-supplied p_expected_context_hash',
  );
  assert.match(
    body, /v_context\.context\s*->>\s*'snapshot_id'\s*\)\s+is\s+distinct\s+from\s+v_job\.snapshot_id\s*::\s*text/i,
    "the authorize function must require the context's snapshot_id field to match the job's snapshot_id",
  );

  assert.match(
    body, /jsonb_typeof\s*\(\s*v_context\.context\s*->\s*'context_version'\s*\)\s+is\s+distinct\s+from\s+'number'/i,
    "the authorize function must require the context's context_version field to be numeric",
  );
  assert.match(
    body, /v_context\.context\s*->>\s*'context_version'\s*\)\s*::\s*numeric\s+is\s+distinct\s+from\s+2/i,
    "the authorize function must require the context's context_version field to equal 2",
  );
  for (const field of ['opportunity', 'company_dossier', 'commercial_context']) {
    assert.match(
      body, new RegExp(String.raw`jsonb_typeof\s*\(\s*v_context\.context\s*->\s*'${field}'\s*\)\s+is\s+distinct\s+from\s+'object'`, 'i'),
      `the authorize function must require the context's ${field} field to be a jsonb object`,
    );
  }
  assert.match(
    body, /jsonb_typeof\s*\(\s*v_context\.context\s*->\s*'human_evidence'\s*\)\s+is\s+distinct\s+from\s+'array'/i,
    "the authorize function must require the context's human_evidence field to be a jsonb array",
  );
});

test('the authorize function requires the frozen root analysis_context to be missing contextV2Sections while analysis_flags.AGT002_CONTEXT_V2 is true', () => {
  const body = authorizeFunctionBody(migrationSql());

  assert.match(
    body, /jsonb_typeof\s*\(\s*v_job\.frozen_engine_input\s*->\s*'analysis_context'\s*\)\s+is\s+distinct\s+from\s+'object'/i,
    "the authorize function must require the job's frozen_engine_input.analysis_context to be a structured object",
  );
  assert.match(
    body, /\(\s*v_job\.frozen_engine_input\s*->\s*'analysis_context'\s*\)\s*\?\s*'contextV2Sections'/i,
    'the authorize function must reject a frozen analysis_context that already carries contextV2Sections',
  );
  assert.match(
    body,
    /v_job\.frozen_engine_input\s*#>>\s*'\{analysis_flags,AGT002_CONTEXT_V2\}'\s*\)\s+is\s+distinct\s+from\s+'true'/i,
    "the authorize function must require frozen_engine_input.analysis_flags.AGT002_CONTEXT_V2 to be exactly 'true'",
  );
});

test('the authorize function requires no colliding tender analysis run and no other active job for the opportunity', () => {
  const body = authorizeFunctionBody(migrationSql());

  assert.match(
    body, new RegExp(String.raw`from\s+public\.${ANALYSIS_RUNS_TABLE}[\s\S]{0,200}idempotency_key`, 'i'),
    `the authorize function must reject if public.${ANALYSIS_RUNS_TABLE} already has a run under the job's idempotency_key`,
  );
  assert.match(
    body, new RegExp(String.raw`from\s+public\.${JOBS_TABLE}[\s\S]{0,300}status\s+in\s*\(\s*'queued'\s*,\s*'running'\s*\)`, 'i'),
    'the authorize function must reject if any other job is queued/running for the same opportunity',
  );
});

test('the authorize function inserts exactly one audit row, then atomically requeues the same job binding context_recovery_id, without ever changing resume_count', () => {
  const body = authorizeFunctionBody(migrationSql());

  const insertIdx = body.search(new RegExp(String.raw`insert\s+into\s+public\.${AUDIT_TABLE}`, 'i'));
  const updateIdx = body.search(new RegExp(String.raw`update\s+public\.${JOBS_TABLE}\s+set`, 'i'));
  assert.ok(insertIdx >= 0, `the authorize function must insert into public.${AUDIT_TABLE}`);
  assert.ok(updateIdx >= 0, `the authorize function must update public.${JOBS_TABLE}`);
  assert.ok(insertIdx < updateIdx, 'the audit row must be inserted before the job is requeued, so a failed insert never leaves an unaudited requeue');

  const updateStatement = body.slice(updateIdx, updateIdx + 800);
  assert.match(updateStatement, /status\s*=\s*'queued'/i, "the update must set status = 'queued'");
  assert.match(updateStatement, /error_code\s*=\s*null/i, 'the update must clear error_code');
  assert.match(updateStatement, /error_message\s*=\s*null/i, 'the update must clear error_message');
  assert.match(updateStatement, /completed_at\s*=\s*null/i, 'the update must clear completed_at');
  assert.match(updateStatement, /lease_id\s*=\s*null/i, 'the update must clear lease_id');
  assert.match(updateStatement, /lease_expires_at\s*=\s*null/i, 'the update must clear lease_expires_at');
  assert.match(
    updateStatement, new RegExp(String.raw`${NEW_JOBS_COLUMN}\s*=\s*v_recovery_id`, 'i'),
    `the update must bind ${NEW_JOBS_COLUMN} to the newly inserted audit row id`,
  );
  assert.doesNotMatch(
    updateStatement, /resume_count\s*=/i,
    'the update must never assign resume_count: the automatic-reclaim budget is left exactly as the automatic path set it',
  );
});

test('the authorize function returns only safe structural fields, never raw error detail or the frozen engine input', () => {
  const body = authorizeFunctionBody(migrationSql());
  const returnMatch = body.match(/return\s+jsonb_build_object\s*\(([\s\S]{0,600}?)\)\s*;/i);
  assert.ok(returnMatch, 'the authorize function must return jsonb_build_object(...)');
  const returned = returnMatch[1];
  assert.doesNotMatch(returned, /frozen_engine_input/i, 'the response must never surface frozen_engine_input');
  assert.doesNotMatch(returned, /error_message/i, 'the response must never surface raw error_message');
});

test('migration 090 revokes execute on the authorize function from every role and grants it to no one', () => {
  const migration = migrationSql();
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.match(
      migration,
      new RegExp(String.raw`revoke\s+all\s+on\s+function\s+public\.${FUNCTION_SIGNATURE.replace(/[()]/g, '\\$&')}\s+from\s+${role}`, 'i'),
      `migration 090 must revoke execute on public.${FUNCTION_SIGNATURE} from ${role}`,
    );
  }
  assert.doesNotMatch(
    migration,
    new RegExp(String.raw`grant\s+execute\s+on\s+function\s+public\.${FUNCTION_SIGNATURE.replace(/[()]/g, '\\$&')}`, 'i'),
    `migration 090 must never grant execute on public.${FUNCTION_SIGNATURE} to any role: it is a direct database-owner/admin action only`,
  );
});

test('migration 090 touches no other table and no other function/RPC besides its own', () => {
  const migration = migrationSql();
  const otherCreateTable = migration.match(/create\s+table[^;]*;/gi) || [];
  for (const stmt of otherCreateTable) {
    assert.match(stmt, new RegExp(AUDIT_TABLE, 'i'), `migration 090 must only ever create public.${AUDIT_TABLE}, found: ${stmt.slice(0, 80)}`);
  }
  const otherCreateFn = migration.match(/create\s+(or\s+replace\s+)?function\s+public\.(\w+)/gi) || [];
  for (const stmt of otherCreateFn) {
    assert.ok(
      new RegExp(`${FUNCTION_NAME}$`, 'i').test(stmt)
      || new RegExp(`${GUARD_FUNCTION_NAME}$`, 'i').test(stmt)
      || /_prevent_mutation$/i.test(stmt),
      `migration 090 must only create/replace ${FUNCTION_NAME}, ${GUARD_FUNCTION_NAME}, and its own trigger function, found: ${stmt}`,
    );
  }
});

// -------------------------------------------------------------------------------------------
// Rollback shape
// -------------------------------------------------------------------------------------------

test('the rollback exists, is one transaction, and fails closed while any context-recovery evidence exists', () => {
  const rollback = rollbackSql();
  assert.match(rollback, /^\s*begin;/im, 'the rollback must run inside one transaction');
  assert.match(rollback, /^\s*commit;/im, 'the rollback must commit its single transaction');
  assert.match(rollback, /raise\s+exception/i, 'the rollback must fail closed while recovery evidence exists');
  assert.match(
    rollback, new RegExp(String.raw`from\s+public\.${AUDIT_TABLE}`, 'i'),
    `the rollback guard must check public.${AUDIT_TABLE} for any row before dropping anything`,
  );
  assert.match(
    rollback, new RegExp(String.raw`from\s+public\.${JOBS_TABLE}[\s\S]{0,200}${NEW_JOBS_COLUMN}\s+is\s+not\s+null`, 'i'),
    `the rollback guard must also check public.${JOBS_TABLE} for any non-null ${NEW_JOBS_COLUMN}`,
  );
});

test('the rollback locks jobs, then operator_recoveries, then context_recoveries, in exactly that order, before any evidence check', () => {
  const rollback = rollbackSql();
  const jobsLockStmt = `lock table public.${JOBS_TABLE} in access exclusive mode;`;
  const operatorLockStmt = `lock table public.${OPERATOR_AUDIT_TABLE} in access exclusive mode;`;
  const contextLockStmt = `lock table public.${AUDIT_TABLE} in access exclusive mode;`;

  assert.ok(rollback.includes(jobsLockStmt), `the rollback must contain the exact statement: ${jobsLockStmt}`);
  assert.ok(rollback.includes(operatorLockStmt), `the rollback must contain the exact statement: ${operatorLockStmt}`);
  assert.ok(rollback.includes(contextLockStmt), `the rollback must contain the exact statement: ${contextLockStmt}`);

  const jobsLockIdx = rollback.indexOf(jobsLockStmt);
  const operatorLockIdx = rollback.indexOf(operatorLockStmt);
  const contextLockIdx = rollback.indexOf(contextLockStmt);

  assert.ok(
    jobsLockIdx < operatorLockIdx && operatorLockIdx < contextLockIdx,
    `the locks must occur in exactly this order: jobs (${jobsLockIdx}), operator_recoveries (${operatorLockIdx}), context_recoveries (${contextLockIdx})`,
  );

  const doBlockIdx = rollback.search(/do\s+\$\$/i);
  assert.ok(doBlockIdx >= 0, 'the rollback must have the evidence-check DO block');
  assert.ok(contextLockIdx < doBlockIdx, 'all three locks must occur before the evidence-check DO block');

  const firstSelectIdx = rollback.search(/select/i);
  assert.ok(firstSelectIdx >= 0, 'the rollback must contain an evidence SELECT/check');
  assert.ok(contextLockIdx < firstSelectIdx, 'all three locks must occur before any evidence SELECT/check');
});

test('the rollback refuses while audit rows exist or any job carries a non-null context_recovery_id', () => {
  const rollback = rollbackSql();
  assert.match(
    rollback,
    new RegExp(String.raw`exists\s*\(\s*select\s+1\s+from\s+public\.${AUDIT_TABLE}\s*\)`, 'i'),
    `the rollback must refuse while any row exists in public.${AUDIT_TABLE}`,
  );
  assert.match(
    rollback,
    new RegExp(String.raw`exists\s*\(\s*select\s+1\s+from\s+public\.${JOBS_TABLE}\s+where\s+${NEW_JOBS_COLUMN}\s+is\s+not\s+null\s*\)`, 'i'),
    `the rollback must refuse while any public.${JOBS_TABLE} row has a non-null ${NEW_JOBS_COLUMN}`,
  );
});

test('the rollback restores the jobs guard function to the exact pre-090 (089-only) body, with no reference to context_recovery_id', () => {
  const rollback = rollbackSql();
  const restoreMatch = rollback.match(
    new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${GUARD_FUNCTION_NAME}\s*\(\s*\)[\s\S]{0,6000}?\$\$;`, 'i'),
  );
  assert.ok(restoreMatch, `the rollback must restore public.${GUARD_FUNCTION_NAME} with CREATE OR REPLACE FUNCTION`);
  const restored = restoreMatch[0];

  assert.doesNotMatch(
    restored, new RegExp(NEW_JOBS_COLUMN, 'i'),
    `the restored ${GUARD_FUNCTION_NAME} must not reference ${NEW_JOBS_COLUMN} at all: it must be byte-for-byte the pre-090 089 body`,
  );
  assert.match(
    restored,
    new RegExp(String.raw`old\.${OPERATOR_JOBS_COLUMN}\s+is\s+not\s+null\s+and\s+new\.${OPERATOR_JOBS_COLUMN}\s+is\s+distinct\s+from\s+old\.${OPERATOR_JOBS_COLUMN}`, 'i'),
    'the restored guard must still reject any rewrite of operator_recovery_id once it is already set',
  );
  assert.match(
    restored,
    new RegExp(String.raw`old\.${OPERATOR_JOBS_COLUMN}\s+is\s+not\s+null\s+or\s+new\.${OPERATOR_JOBS_COLUMN}\s+is\s+null`, 'i'),
    'the restored guard must use the original 089 null -> real-value-once condition, not the 090 v_operator_bound variable form',
  );
  assert.match(restored, /resume_count\s*>=\s*5/i, 'the restored guard must gate on old.resume_count >= 5 (089 semantics)');
});

test('the rollback removes only what 090 added: the authorize function, the jobs column, the audit trigger/trigger function, and the audit table', () => {
  const rollback = rollbackSql();
  assert.match(
    rollback,
    new RegExp(String.raw`drop\s+function\s+if\s+exists\s+public\.${FUNCTION_NAME}`, 'i'),
    `the rollback must drop public.${FUNCTION_NAME}`,
  );
  assert.match(
    rollback,
    new RegExp(String.raw`alter\s+table\s+public\.${JOBS_TABLE}\s+drop\s+column\s+(if\s+exists\s+)?${NEW_JOBS_COLUMN}`, 'i'),
    `the rollback must drop public.${JOBS_TABLE}.${NEW_JOBS_COLUMN}`,
  );
  assert.match(
    rollback,
    new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${AUDIT_TABLE}`, 'i'),
    `the rollback must drop public.${AUDIT_TABLE}`,
  );
  assert.match(
    rollback, new RegExp(String.raw`drop\s+trigger\s+if\s+exists\s+\S+\s+on\s+public\.${AUDIT_TABLE}`, 'i'),
    'the rollback must explicitly drop the context-recovery audit table immutability trigger',
  );
  assert.match(
    rollback, /drop\s+function\s+if\s+exists\s+public\.\S*_prevent_mutation/i,
    'the rollback must drop the trigger function 090 created',
  );
});

test('the rollback never mutates a row and never grants anything', () => {
  const rollback = rollbackSql();
  assert.doesNotMatch(
    rollback, new RegExp(String.raw`update\s+public\.${JOBS_TABLE}\s+set`, 'i'),
    'the rollback must never mutate any job row: it only ever drops what 090 added, after refusing while evidence exists',
  );
  assert.doesNotMatch(
    rollback, new RegExp(String.raw`update\s+public\.${AUDIT_TABLE}\s+set`, 'i'),
    'the rollback must never mutate any audit row: it only ever drops what 090 added, after refusing while evidence exists',
  );
  assert.doesNotMatch(
    rollback, new RegExp(String.raw`insert\s+into\s+public\.(${JOBS_TABLE}|${AUDIT_TABLE})\b`, 'i'),
    'the rollback must never insert a job or audit row',
  );
  assert.doesNotMatch(
    rollback, new RegExp(String.raw`delete\s+from\s+public\.(${JOBS_TABLE}|${AUDIT_TABLE})\b`, 'i'),
    'the rollback must never delete a job or audit row',
  );
  assert.doesNotMatch(
    rollback, /resume_count\s*=(?!=)/i,
    'the rollback must never assign resume_count: it may only read old.resume_count in the restored 089 trigger',
  );
  assert.doesNotMatch(rollback, /\bgrant\b/i, 'the rollback must never grant anything: it only removes 090');
});
