// AGT-002 operator-governed recovery — static migration contract.
//
// A bare unaudited operator_recovery_count slot (operator_recovery_count integer 0..1, no audit
// trail, no guard against a human directly UPDATE-ing an at-cap job back to queued) would not be
// database-enforced — nothing would stop a second, undocumented recovery, nothing would record
// WHO authorized bypassing the automatic reclaim cap or WHY, and nothing would stop a bare
// `UPDATE ... SET status = 'queued'` on an at-cap unavailable row outside any governed path.
// Migration 089 instead:
//
//   * Add an append-only, service_role-readable-only audit table,
//     public.psi_agt002_operator_recoveries, with one immutable row per recovered job (job_id
//     unique), the workset it recovered into, the exact completed_batch_count it recovered at,
//     a lowercase 40-hex defect_commit_sha, a closed-vocabulary reason_code fixed to
//     'corrected_deterministic_bridge_defect', and a server-derived authorized_by/authorized_at
//     — never a caller-supplied identity or free text.
//   * Add jobs.operator_recovery_id (nullable, unique, FK to the audit table, ON DELETE
//     RESTRICT) and a jobs guard trigger that only ever lets it move null -> a real audit row
//     belonging to that same job, exactly once, and that requires that exact atomic binding
//     for any status transition into 'queued' while resume_count was already at the automatic
//     cap (5) — so no bare UPDATE can ever requeue an at-cap job, and no second recovery can
//     ever happen once operator_recovery_id is set. resume_count itself is untouched: it stays
//     exactly the automatic-reclaim budget, capped at <=5, exactly as before.
//   * Add the admin-only SECURITY DEFINER function
//     public.psi_authorize_agt002_operator_recovery(uuid, uuid, integer, text), reachable by
//     NO role (not even service_role) — a direct database-owner/admin action, never an
//     application RPC surface — that re-verifies every precondition itself (job state,
//     workset state, exact contiguous semantic-discovery checkpoint history, no colliding
//     tender analysis run, no other active job for the opportunity) before inserting the one
//     audit row and requeuing the job in the same transaction.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATION_URL = new URL('../supabase/migrations/089_agt002_operator_recovery_slot.sql', import.meta.url);
const ROLLBACK_URL = new URL('../supabase/rollbacks/089_agt002_operator_recovery_slot_rollback.sql', import.meta.url);

const JOBS_TABLE = 'psi_agt002_reanalysis_jobs';
const WORKSETS_TABLE = 'psi_agt002_analysis_worksets';
const CHECKPOINTS_TABLE = 'psi_agt002_analysis_checkpoints';
const ANALYSIS_RUNS_TABLE = 'psi_tender_analysis_runs';
const AUDIT_TABLE = 'psi_agt002_operator_recoveries';
const NEW_JOBS_COLUMN = 'operator_recovery_id';
const REASON_CODE = 'corrected_deterministic_bridge_defect';
const FUNCTION_NAME = 'psi_authorize_agt002_operator_recovery';
const FUNCTION_SIGNATURE = `${FUNCTION_NAME}(uuid, uuid, integer, text)`;

/** Statement text only: an explanatory `--` comment must never satisfy — or trip — a check. */
function withoutComments(sql) {
  return sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
}

/** Ignore quoted string contents (e.g. exception messages) so prose never satisfies — or trips — a DDL check. */
function withoutStringLiterals(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

function readSql(url, label) {
  assert.ok(
    existsSync(url),
    `${label} must exist: the AGT-002 operator-governed recovery needs the additive migration 089_agt002_operator_recovery_slot`,
  );
  return readFileSync(url, 'utf8');
}

function migrationSql() {
  return withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/089_agt002_operator_recovery_slot.sql'));
}

function rollbackSql() {
  return withoutComments(readSql(ROLLBACK_URL, 'supabase/rollbacks/089_agt002_operator_recovery_slot_rollback.sql'));
}

// -------------------------------------------------------------------------------------------
// Migration shape
// -------------------------------------------------------------------------------------------

test('migration 089 exists and is one transaction', () => {
  const migration = migrationSql();
  assert.match(migration, /^\s*begin;/im, 'the migration must run inside one transaction');
  assert.match(migration, /^\s*commit;/im, 'the migration must commit its single transaction');
});

test('migration 089 creates the append-only audit table with every required column and type', () => {
  const migration = migrationSql();
  assert.match(
    migration,
    new RegExp(String.raw`create\s+table\s+(if\s+not\s+exists\s+)?public\.${AUDIT_TABLE}\s*\(`, 'i'),
    `migration 089 must create public.${AUDIT_TABLE}`,
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
    /defect_commit_sha\s+text\s+not\s+null\s+check\s*\(\s*defect_commit_sha\s*~\s*'\^\[0-9a-f\]\{40\}\$'\s*\)/i,
    'defect_commit_sha must be text not null, bounded to exactly lowercase 40 hex characters',
  );
  assert.match(
    migration,
    new RegExp(String.raw`reason_code\s+text\s+not\s+null[\s\S]{0,120}check\s*\(\s*reason_code\s*=\s*'${REASON_CODE}'\s*\)`, 'i'),
    `reason_code must be text not null and closed to exactly '${REASON_CODE}'`,
  );
  assert.match(migration, /authorized_by\s+text\s+not\s+null/i, 'authorized_by must be text not null');
  assert.match(migration, /authorized_at\s+timestamptz\s+not\s+null\s+default\s+now\s*\(\s*\)/i, 'authorized_at must be timestamptz not null default now()');
});

test('migration 089 never accepts authorized_by/reason_code as literal caller-suppliable table defaults (no free-text bypass at the DDL level)', () => {
  const migration = migrationSql();
  // authorized_by must carry no DEFAULT literal string: it is only ever set by the function
  // below from session_user, never a static/default value a bare INSERT could rely on.
  assert.doesNotMatch(
    migration, /authorized_by\s+text\s+not\s+null\s+default/i,
    'authorized_by must never have a DDL-level default: it is only ever derived server-side inside the authorize function',
  );
});

test('migration 089 enables RLS on the audit table, revokes every direct role, and grants only service_role SELECT', () => {
  const migration = migrationSql();
  assert.match(
    migration, new RegExp(String.raw`alter\s+table\s+public\.${AUDIT_TABLE}\s+enable\s+row\s+level\s+security`, 'i'),
    `migration 089 must enable row level security on public.${AUDIT_TABLE}`,
  );
  const revokeAll = new RegExp(
    String.raw`revoke\s+all\s+on\s+table\s+public\.${AUDIT_TABLE}\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role`, 'i',
  );
  const revokeAllAlt = new RegExp(
    String.raw`revoke\s+all\s+on\s+table\s+public\.${AUDIT_TABLE}\s+from\s+(public|anon|authenticated|service_role)(\s*,\s*(public|anon|authenticated|service_role)){3}`, 'i',
  );
  assert.ok(
    revokeAll.test(migration) || revokeAllAlt.test(migration),
    `migration 089 must revoke all privileges on public.${AUDIT_TABLE} from public, anon, authenticated, and service_role`,
  );
  assert.match(
    migration, new RegExp(String.raw`grant\s+select\s+on\s+table\s+public\.${AUDIT_TABLE}\s+to\s+service_role`, 'i'),
    `migration 089 must grant SELECT only on public.${AUDIT_TABLE} to service_role`,
  );
  assert.doesNotMatch(
    migration, new RegExp(String.raw`grant\s+(insert|update|delete|all)\s+on\s+table\s+public\.${AUDIT_TABLE}`, 'i'),
    `migration 089 must never grant INSERT/UPDATE/DELETE on public.${AUDIT_TABLE} to any role`,
  );
});

test('migration 089 creates an immutable-audit trigger that rejects UPDATE and DELETE on the audit table', () => {
  const migration = migrationSql();
  assert.match(
    migration, /raise\s+exception[\s\S]{0,400}(append-only|immutable|inmutable)/i,
    'the audit table must have a trigger function that raises an exception rejecting mutation',
  );
  assert.match(
    migration,
    new RegExp(String.raw`create\s+trigger\s+\S+\s+before\s+update\s+or\s+delete\s+on\s+public\.${AUDIT_TABLE}`, 'i'),
    `migration 089 must create a BEFORE UPDATE OR DELETE trigger on public.${AUDIT_TABLE}`,
  );
});

test(`migration 089 adds ${JOBS_TABLE}.${NEW_JOBS_COLUMN} as a nullable, unique FK to the audit table`, () => {
  const migration = migrationSql();
  assert.match(
    migration,
    new RegExp(
      String.raw`alter\s+table\s+public\.${JOBS_TABLE}\s+add\s+column\s+(if\s+not\s+exists\s+)?${NEW_JOBS_COLUMN}\s+uuid\s+unique\s+references\s+public\.${AUDIT_TABLE}\s*\(\s*id\s*\)\s*on\s+delete\s+restrict`,
      'i',
    ),
    `migration 089 must add public.${JOBS_TABLE}.${NEW_JOBS_COLUMN} as a nullable uuid, unique, FK to public.${AUDIT_TABLE}(id) on delete restrict`,
  );
  assert.doesNotMatch(
    migration,
    new RegExp(String.raw`${NEW_JOBS_COLUMN}\s+uuid\s+not\s+null`, 'i'),
    `${NEW_JOBS_COLUMN} must stay nullable: an automatically-reclaimed job never has one`,
  );
});

test('migration 089 creates a jobs guard trigger enforcing a one-way null -> audit-bound transition, fenced to the same job, gating any at-cap requeue', () => {
  const migration = migrationSql();
  const guardTriggerMatch = migration.match(
    new RegExp(String.raw`create\s+trigger\s+(\S+)\s+before\s+update\s+on\s+public\.${JOBS_TABLE}[\s\S]{0,4000}`, 'i'),
  );
  assert.ok(guardTriggerMatch, `migration 089 must create a BEFORE UPDATE trigger on public.${JOBS_TABLE}`);

  // The guard must reject rewriting operator_recovery_id once it has ever been set (no
  // null -> X -> Y, no X -> null, no X -> Y).
  assert.match(
    migration,
    new RegExp(String.raw`old\.${NEW_JOBS_COLUMN}\s+is\s+not\s+null[\s\S]{0,300}new\.${NEW_JOBS_COLUMN}\s+is\s+distinct\s+from\s+old\.${NEW_JOBS_COLUMN}`, 'i'),
    `the jobs guard trigger must reject any rewrite of ${NEW_JOBS_COLUMN} once it is already set`,
  );

  // The guard must confirm any newly-bound audit row actually belongs to this same job.
  assert.match(
    migration,
    new RegExp(String.raw`select[\s\S]{0,200}from\s+public\.${AUDIT_TABLE}[\s\S]{0,300}job_id[\s\S]{0,200}new\.id|job_id\s*(<>|is\s+distinct\s+from)\s*new\.id`, 'i'),
    `the jobs guard trigger must verify the audit row bound into ${NEW_JOBS_COLUMN} belongs to the same job`,
  );

  // The guard must require the atomic null -> audit binding for any at-cap (resume_count >= 5)
  // transition into 'queued'.
  assert.match(
    migration, /resume_count\s*>=\s*5/i,
    'the jobs guard trigger must gate on old.resume_count >= 5 (the automatic reclaim cap)',
  );
  assert.match(
    migration, /new\.status\s*=\s*'queued'|new\.status\s+is\s+not\s+distinct\s+from\s+'queued'/i,
    "the jobs guard trigger must recognize a transition whose new.status = 'queued'",
  );
});

test('migration 089 documents that resume_count/the automatic cap stays untouched at 5', () => {
  const raw = readFileSync(MIGRATION_URL, 'utf8'); // comments included: this test targets the documentation itself
  assert.doesNotMatch(
    withoutStringLiterals(migrationSql()), /resume_count\s*=|resume_count\s*\+/i,
    'migration 089 DDL must never assign or increment resume_count: only the pre-existing automatic reclaim path (081) ever changes it',
  );
  assert.match(
    raw, /resume_count[\s\S]{0,200}\b5\b|\b5\b[\s\S]{0,200}resume_count/i,
    'migration 089 must document that resume_count and the automatic reclaim cap stay exactly at 5, unchanged',
  );
});

// -------------------------------------------------------------------------------------------
// The admin-only authorize function
// -------------------------------------------------------------------------------------------

test('migration 089 creates the admin-only authorize function with exactly the required 4-parameter signature', () => {
  const migration = migrationSql();
  assert.match(
    migration,
    new RegExp(
      String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\(\s*p_job_id\s+uuid\s*,\s*p_workset_id\s+uuid\s*,\s*p_expected_completed_batch_count\s+integer\s*,\s*p_defect_commit_sha\s+text\s*\)\s*returns\s+jsonb`,
      'i',
    ),
    `migration 089 must create public.${FUNCTION_NAME}(p_job_id uuid, p_workset_id uuid, p_expected_completed_batch_count integer, p_defect_commit_sha text) returns jsonb`,
  );
});

test('the authorize function is SECURITY DEFINER with a pinned search_path', () => {
  const migration = migrationSql();
  const fnMatch = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,12000}?\$\$;`, 'i'),
  );
  assert.ok(fnMatch, `must find the full body of public.${FUNCTION_NAME}`);
  const body = fnMatch[0];
  assert.match(body, /security\s+definer/i, 'the authorize function must be SECURITY DEFINER');
  assert.match(body, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i, 'the authorize function must pin search_path to public, pg_temp');
});

test('the authorize function never accepts an operator identity, a reason, or any free-text parameter', () => {
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
    (params.match(/\bp_\w+/g) || []).length, 4,
    `public.${FUNCTION_NAME} must accept exactly the 4 documented parameters, no more`,
  );
});

test('the authorize function derives authorized_by from session_user and the reason_code internally, never from a parameter', () => {
  const migration = migrationSql();
  const fnMatch = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,12000}?\$\$;`, 'i'),
  );
  assert.ok(fnMatch);
  const body = fnMatch[0];
  assert.match(body, /session_user/i, 'the authorize function must derive authorized_by from session_user');
  assert.match(
    body, new RegExp(`'${REASON_CODE}'`),
    `the authorize function must insert the fixed reason_code '${REASON_CODE}' internally`,
  );
});

test('the authorize function validates a lowercase 40-hex defect_commit_sha before doing anything else', () => {
  const migration = migrationSql();
  assert.match(
    migration, /p_defect_commit_sha\s*!?~\s*'\^\[0-9a-f\]\{40\}\$'|p_defect_commit_sha\s+!?~\s+'\^\[0-9a-f\]\{40\}\$'/i,
    'the authorize function must validate p_defect_commit_sha against ^[0-9a-f]{40}$',
  );
});

test('the authorize function locks the exact job row and validates every documented precondition', () => {
  const migration = migrationSql();
  const fnMatch = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,12000}?\$\$;`, 'i'),
  );
  assert.ok(fnMatch);
  const body = fnMatch[0];

  assert.match(
    body, new RegExp(String.raw`from\s+public\.${JOBS_TABLE}[\s\S]{0,120}for\s+update`, 'i'),
    `the authorize function must SELECT ... FOR UPDATE the exact job row from public.${JOBS_TABLE}`,
  );

  const requiredJobChecks = [
    /status\s*=\s*'unavailable'|status\s+is\s+distinct\s+from\s+'unavailable'/i,
    /error_code\s*=\s*'timeout'|error_code\s+is\s+distinct\s+from\s+'timeout'/i,
    /execution_mode\s*=\s*'durable_batched_v1'|execution_mode\s+is\s+distinct\s+from\s+'durable_batched_v1'/i,
    /analysis_run_id\s+is\s+not\s+null|analysis_run_id\s+is\s+null/i,
    /lease_id\s+is\s+not\s+null|lease_id\s+is\s+null/i,
    /phase\s*=\s*'semantic_discovery'|phase\s+is\s+distinct\s+from\s+'semantic_discovery'/i,
    /completed_batch_count\s+is\s+distinct\s+from\s+p_expected_completed_batch_count|completed_batch_count\s*<>\s*p_expected_completed_batch_count/i,
    /total_batch_count\s*<=\s*completed_batch_count|total_batch_count\s*>\s*completed_batch_count/i,
    /resume_count\s*=\s*5|resume_count\s+is\s+distinct\s+from\s+5/i,
    new RegExp(String.raw`${NEW_JOBS_COLUMN}\s+is\s+not\s+null|${NEW_JOBS_COLUMN}\s+is\s+null`, 'i'),
  ];
  for (const pattern of requiredJobChecks) {
    assert.match(body, pattern, `the authorize function must validate: ${pattern}`);
  }
});

test('the authorize function takes the canonical opportunity advisory lock after locking the job but before touching tender analysis runs or writing the audit/requeue', () => {
  const migration = migrationSql();
  const fnMatch = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,12000}?\$\$;`, 'i'),
  );
  assert.ok(fnMatch, `must find the full body of public.${FUNCTION_NAME}`);
  const body = fnMatch[0];

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
  const lockIdx = body.search(lockMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

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

test('the authorize function validates the exact workset: bound by idempotency, unpublished, no published run, not archived', () => {
  const migration = migrationSql();
  const fnMatch = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,12000}?\$\$;`, 'i'),
  );
  assert.ok(fnMatch);
  const body = fnMatch[0];

  assert.match(
    body, new RegExp(String.raw`from\s+public\.${WORKSETS_TABLE}`, 'i'),
    `the authorize function must read public.${WORKSETS_TABLE}`,
  );
  assert.match(
    body, /idempotency_key\s+is\s+distinct\s+from|idempotency_key\s*<>/i,
    'the authorize function must bind the workset to the job by idempotency_key',
  );
  assert.match(
    body, /published\s*=\s*true|published\s+is\s+distinct\s+from\s+false|published\s+is\s+true/i,
    'the authorize function must reject a published workset',
  );
  assert.match(
    body, /published_analysis_run_id\s+is\s+not\s+null|published_analysis_run_id\s+is\s+null/i,
    'the authorize function must reject a workset carrying a published_analysis_run_id',
  );
  assert.match(
    body, /archived_at\s+is\s+not\s+null|archived_at\s+is\s+null/i,
    'the authorize function must reject an archived workset',
  );
});

test('the authorize function requires the workset to equal the job on opportunity_id, tender_id, snapshot_id, and context_version_id, in addition to the existing idempotency binding', () => {
  const migration = migrationSql();
  const fnMatch = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,12000}?\$\$;`, 'i'),
  );
  assert.ok(fnMatch, `must find the full body of public.${FUNCTION_NAME}`);
  const body = fnMatch[0];

  assert.match(
    body, /idempotency_key\s+is\s+distinct\s+from|idempotency_key\s*<>/i,
    'the authorize function must still bind the workset to the job by idempotency_key',
  );

  const equalityPattern = field => new RegExp(
    String.raw`v_workset\.${field}\s+is\s+distinct\s+from\s+v_job\.${field}`
    + String.raw`|v_job\.${field}\s+is\s+distinct\s+from\s+v_workset\.${field}`
    + String.raw`|v_workset\.${field}\s*<>\s*v_job\.${field}`
    + String.raw`|v_job\.${field}\s*<>\s*v_workset\.${field}`,
    'i',
  );

  for (const field of ['opportunity_id', 'tender_id', 'snapshot_id', 'context_version_id']) {
    assert.match(
      body, equalityPattern(field),
      `the authorize function must reject a workset whose ${field} does not equal the job's ${field}`,
    );
  }
});

test('the authorize function requires exactly contiguous semantic checkpoints 0..N-1 and no checkpoint of any other stage', () => {
  const migration = migrationSql();
  const fnMatch = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,8000}?\$\$;`, 'i'),
  );
  assert.ok(fnMatch);
  const body = fnMatch[0];

  assert.match(
    body, new RegExp(String.raw`from\s+public\.${CHECKPOINTS_TABLE}`, 'i'),
    `the authorize function must read public.${CHECKPOINTS_TABLE}`,
  );
  assert.match(body, /semantic_discovery_batch/i, 'the authorize function must restrict checkpoints to the semantic_discovery_batch stage');
  assert.match(
    body, /max\s*\(\s*batch_index\s*\)|count\s*\(\s*distinct\s+batch_index\s*\)|generate_series/i,
    'the authorize function must verify checkpoint batch_index contiguity (0..N-1), not merely a row count',
  );
});

test('the authorize function requires no colliding tender analysis run and no other active job for the opportunity', () => {
  const migration = migrationSql();
  const fnMatch = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,8000}?\$\$;`, 'i'),
  );
  assert.ok(fnMatch);
  const body = fnMatch[0];

  assert.match(
    body, new RegExp(String.raw`from\s+public\.${ANALYSIS_RUNS_TABLE}[\s\S]{0,200}idempotency_key`, 'i'),
    `the authorize function must reject if public.${ANALYSIS_RUNS_TABLE} already has a run under the job's idempotency_key`,
  );
  assert.match(
    body, new RegExp(String.raw`from\s+public\.${JOBS_TABLE}[\s\S]{0,300}status\s+in\s*\(\s*'queued'\s*,\s*'running'\s*\)`, 'i'),
    'the authorize function must reject if any other job is queued/running for the same opportunity',
  );
});

test('the authorize function inserts exactly one audit row, then requeues the same job, clearing error/completed/lease and binding operator_recovery_id, without ever changing resume_count', () => {
  const migration = migrationSql();
  const fnMatch = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,8000}?\$\$;`, 'i'),
  );
  assert.ok(fnMatch);
  const body = fnMatch[0];

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
  assert.match(updateStatement, new RegExp(String.raw`${NEW_JOBS_COLUMN}\s*=`, 'i'), `the update must set ${NEW_JOBS_COLUMN}`);
  assert.doesNotMatch(updateStatement, /resume_count\s*=/i, 'the update must never assign resume_count: the automatic-reclaim budget is left exactly as the automatic path set it');
});

test('the authorize function returns only safe structural fields, never raw error detail or the frozen engine input', () => {
  const migration = migrationSql();
  const fnMatch = migration.match(
    new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${FUNCTION_NAME}\s*\([\s\S]{0,8000}?\$\$;`, 'i'),
  );
  assert.ok(fnMatch);
  const body = fnMatch[0];
  const returnMatch = body.match(/return\s+jsonb_build_object\s*\(([\s\S]{0,600}?)\)\s*;/i);
  assert.ok(returnMatch, 'the authorize function must return jsonb_build_object(...)');
  const returned = returnMatch[1];
  assert.doesNotMatch(returned, /frozen_engine_input/i, 'the response must never surface frozen_engine_input');
  assert.doesNotMatch(returned, /error_message/i, 'the response must never surface raw error_message');
});

test('migration 089 revokes execute on the authorize function from every role and grants it to no one', () => {
  const migration = migrationSql();
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.match(
      migration,
      new RegExp(String.raw`revoke\s+all\s+on\s+function\s+public\.${FUNCTION_SIGNATURE.replace(/[()]/g, '\\$&')}\s+from\s+${role}`, 'i'),
      `migration 089 must revoke execute on public.${FUNCTION_SIGNATURE} from ${role}`,
    );
  }
  assert.doesNotMatch(
    migration,
    new RegExp(String.raw`grant\s+execute\s+on\s+function\s+public\.${FUNCTION_SIGNATURE.replace(/[()]/g, '\\$&')}`, 'i'),
    `migration 089 must never grant execute on public.${FUNCTION_SIGNATURE} to any role: it is a direct database-owner/admin action only`,
  );
});

test('migration 089 touches no other function/RPC and no other table', () => {
  const migration = migrationSql();
  const otherCreateTable = migration.match(/create\s+table[^;]*;/gi) || [];
  for (const stmt of otherCreateTable) {
    assert.match(stmt, new RegExp(AUDIT_TABLE, 'i'), `migration 089 must only ever create public.${AUDIT_TABLE}, found: ${stmt.slice(0, 80)}`);
  }
  const otherCreateFn = migration.match(/create\s+(or\s+replace\s+)?function\s+public\.(\w+)/gi) || [];
  for (const stmt of otherCreateFn) {
    assert.ok(
      new RegExp(`${FUNCTION_NAME}$`, 'i').test(stmt)
      || /_prevent_mutation$/i.test(stmt)
      || /_guard_operator_recovery$/i.test(stmt),
      `migration 089 must only create ${FUNCTION_NAME} and its own trigger functions, found: ${stmt}`,
    );
  }
});

// -------------------------------------------------------------------------------------------
// Rollback shape
// -------------------------------------------------------------------------------------------

test('the rollback exists, is one transaction, and fails closed while any audit evidence exists', () => {
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

test('the rollback locks the jobs table then the audit table in ACCESS EXCLUSIVE mode before checking any evidence (concurrency-safety)', () => {
  const rollback = rollbackSql();
  const jobsLockStmt = `lock table public.${JOBS_TABLE} in access exclusive mode;`;
  const auditLockStmt = `lock table public.${AUDIT_TABLE} in access exclusive mode;`;

  assert.ok(
    rollback.includes(jobsLockStmt),
    `the rollback must contain the exact statement: ${jobsLockStmt}`,
  );
  assert.ok(
    rollback.includes(auditLockStmt),
    `the rollback must contain the exact statement: ${auditLockStmt}`,
  );

  const jobsLockIdx = rollback.indexOf(jobsLockStmt);
  const auditLockIdx = rollback.indexOf(auditLockStmt);
  assert.ok(
    jobsLockIdx < auditLockIdx,
    `the jobs table lock must precede the audit table lock: found jobs lock at ${jobsLockIdx}, audit lock at ${auditLockIdx}`,
  );

  const doBlockIdx = rollback.search(/do\s+\$\$/i);
  assert.ok(doBlockIdx >= 0, 'the rollback must have the evidence-check DO block');
  assert.ok(
    jobsLockIdx < doBlockIdx,
    'the jobs table lock must occur before the evidence-check DO block',
  );
  assert.ok(
    auditLockIdx < doBlockIdx,
    'the audit table lock must occur before the evidence-check DO block',
  );

  const firstSelectIdx = rollback.search(/select/i);
  assert.ok(firstSelectIdx >= 0, 'the rollback must contain an evidence SELECT/check');
  assert.ok(
    jobsLockIdx < firstSelectIdx,
    'the jobs table lock must occur before any evidence SELECT/check',
  );
  assert.ok(
    auditLockIdx < firstSelectIdx,
    'the audit table lock must occur before any evidence SELECT/check',
  );
});

test('the rollback removes only what 089 added: the function, both triggers/trigger functions, the jobs column, and the audit table', () => {
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
    rollback, /drop\s+trigger\s+if\s+exists\s+\S+\s+on\s+public\./i,
    'the rollback must explicitly drop the jobs guard trigger',
  );
  assert.match(
    rollback, /drop\s+function\s+if\s+exists\s+public\.\S*(_guard_operator_recovery|_prevent_mutation)/i,
    'the rollback must drop the trigger functions 089 created',
  );
});

test('the rollback never mutates a row and never changes resume_count', () => {
  const rollback = rollbackSql();
  assert.doesNotMatch(
    rollback, new RegExp(String.raw`update\s+public\.${JOBS_TABLE}\s+set`, 'i'),
    'the rollback must never mutate any job row: it only ever drops what 089 added, after refusing while evidence exists',
  );
  assert.doesNotMatch(rollback, /insert\s+into|delete\s+from/i, 'the rollback must never insert or delete a row');
  assert.doesNotMatch(rollback, /resume_count/i, 'the rollback must never reference resume_count in any way');
  assert.doesNotMatch(rollback, /\bgrant\b/i, 'the rollback must never grant anything: it only removes 089');
});
