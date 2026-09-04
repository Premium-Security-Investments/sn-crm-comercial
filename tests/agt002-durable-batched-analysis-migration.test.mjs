// AGT-002 durable batched analysis — static migration contract (RED, no production change).
//
// Pins the SQL half of the AGT-002 durable checkpoint + atomic finalization foundation
// (docs/plans/2026-09-03-agt002-durable-batched-analysis.md, Task 1): one NEW, additive
// migration (081, the next available number) that adds two service-role-only tables —
//   * public.psi_agt002_analysis_worksets      — one durable workset per canonical
//     analysis idempotency key ("work identity"), immutable except for a one-way
//     publication-marker transition;
//   * public.psi_agt002_analysis_checkpoints   — one immutable row per (workset_id,
//     stage, batch_index) ("work identity", distinct from any job/attempt identity) —
// plus SECURITY DEFINER RPCs:
//   * psi_get_or_create_agt002_analysis_workset(uuid,uuid,uuid,uuid,text,jsonb)
//   * psi_get_agt002_analysis_workset(text)
//   * psi_list_agt002_analysis_checkpoints(uuid)
//   * psi_record_agt002_analysis_checkpoint(uuid,uuid,uuid,text,integer,text,text,jsonb,text,jsonb,text,
//     text,integer,integer) — the trailing p_progress_phase/p_completed_batch_count/p_total_batch_count
//     triplet lets the SAME call that durably records a batch also advance the fenced running job's
//     phase/progress in one transaction: no separate, unfenced "update progress" RPC ever exists.
//   * psi_mark_agt002_analysis_workset_published(uuid,uuid,uuid,uuid)
//   * psi_finalize_agt002_durable_batched_analysis(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)
//     — the one atomic, lease-fenced RPC that calls the existing, untouched
//     public.psi_record_agt002_canonical_analysis_run(...) contract (067/076 signature)
//     and completes the durable-batched queue job in the SAME transaction, so a failure
//     inside (a malformed V3 payload, a lease already lost) rolls back canonical
//     persistence and job completion together. The legacy public.psi_complete_agt002_
//     reanalysis_job(uuid,uuid,uuid) RPC (068) must survive untouched for the existing
//     single-turn completion path.
//
// Neither file exists yet — that absence is the RED signal, reported explicitly below as
// an ordinary failed assertion (assert.ok(existsSync(...), '<message>')) instead of an
// unreadable-file crash. Assertions target SECURITY and IDENTITY semantics (definer +
// pinned search_path, revoke-then-grant to service_role only, closed stage vocabulary,
// exact-identity uniqueness, immutability, lease fencing by BOTH job_id and lease_id, and
// no raw prompt/source/credential column anywhere) — not formatting or whitespace.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATION_URL = new URL('../supabase/migrations/081_agt002_durable_batched_analysis.sql', import.meta.url);
const ROLLBACK_URL = new URL('../supabase/rollbacks/081_agt002_durable_batched_analysis_rollback.sql', import.meta.url);

const WORKSET_TABLE = 'psi_agt002_analysis_worksets';
const CHECKPOINT_TABLE = 'psi_agt002_analysis_checkpoints';

const GET_OR_CREATE_WORKSET_FN = 'psi_get_or_create_agt002_analysis_workset';
const GET_OR_CREATE_WORKSET_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*jsonb\s*\)`;
const GET_WORKSET_FN = 'psi_get_agt002_analysis_workset';
const GET_WORKSET_ARGS = String.raw`\(\s*text\s*\)`;
const LIST_CHECKPOINTS_FN = 'psi_list_agt002_analysis_checkpoints';
const LIST_CHECKPOINTS_ARGS = String.raw`\(\s*uuid\s*\)`;
const RECORD_CHECKPOINT_FN = 'psi_record_agt002_analysis_checkpoint';
const RECORD_CHECKPOINT_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*integer\s*,\s*text\s*,\s*text\s*,\s*jsonb\s*,\s*text\s*,\s*jsonb\s*,\s*text\s*,\s*text\s*,\s*integer\s*,\s*integer\s*\)`;
// The types-only RECORD_CHECKPOINT_ARGS above matches positional-type signatures (REVOKE/GRANT,
// DROP FUNCTION IF EXISTS), which never carry parameter names. The CREATE FUNCTION declaration
// itself names every parameter, so asserting its exact signature needs the named form below.
const RECORD_CHECKPOINT_NAMED_ARGS = String.raw`\(\s*p_job_id\s+uuid\s*,\s*p_lease_id\s+uuid\s*,\s*p_workset_id\s+uuid\s*,\s*p_stage\s+text\s*,\s*p_batch_index\s+integer\s*,\s*p_request_hash\s+text\s*,\s*p_stage_contract_version\s+text\s*,\s*p_output\s+jsonb\s*,\s*p_output_sha256\s+text\s*,\s*p_usage\s+jsonb\s*,\s*p_provider_idempotency_key\s+text\s*,\s*p_progress_phase\s+text\s*,\s*p_completed_batch_count\s+integer\s*,\s*p_total_batch_count\s+integer\s*\)`;
// The old, pre-progress 11-argument overload: after 081 lands, this exact signature must never
// appear in either the migration (as a second overload) or a rollback DROP FUNCTION target.
const RECORD_CHECKPOINT_OLD_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*integer\s*,\s*text\s*,\s*text\s*,\s*jsonb\s*,\s*text\s*,\s*jsonb\s*,\s*text\s*\)`;
const MARK_PUBLISHED_FN = 'psi_mark_agt002_analysis_workset_published';
const MARK_PUBLISHED_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*\)`;
const FINALIZE_FN = 'psi_finalize_agt002_durable_batched_analysis';
const FINALIZE_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*jsonb\s*,\s*integer\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*jsonb\s*,\s*uuid\s*,\s*uuid\s*\)`;

// Task 1 follow-up (this file's RED expansion): the governed archival RPC that lets rollback
// ever proceed again after the first checkpoint exists (docs/plans/2026-09-03-agt002-durable-
// batched-analysis.md, "Rollback safety" + database-changes section). One-way, service-role
// only, gated on no active job for the workset's own canonical identity.
const ARCHIVE_WORKSET_FN = 'psi_archive_agt002_analysis_workset';
const ARCHIVE_WORKSET_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*\)`;

// The pre-existing enqueue/claim RPCs (068) that 081 must extend IN PLACE (server-owned
// execution_mode, bounded reclaim) without ever widening their caller-facing signature.
const CREATE_JOB_FN = 'psi_create_agt002_reanalysis_job';
const CLAIM_JOB_FN = 'psi_claim_agt002_reanalysis_job';

const NEW_RPCS = [
  [GET_OR_CREATE_WORKSET_FN, GET_OR_CREATE_WORKSET_ARGS],
  [GET_WORKSET_FN, GET_WORKSET_ARGS],
  [LIST_CHECKPOINTS_FN, LIST_CHECKPOINTS_ARGS],
  [RECORD_CHECKPOINT_FN, RECORD_CHECKPOINT_ARGS],
  [MARK_PUBLISHED_FN, MARK_PUBLISHED_ARGS],
  [FINALIZE_FN, FINALIZE_ARGS],
  [ARCHIVE_WORKSET_FN, ARCHIVE_WORKSET_ARGS],
];

const LEGACY_RPCS_TO_PRESERVE = [
  'psi_create_agt002_reanalysis_job',
  'psi_claim_agt002_reanalysis_job',
  'psi_complete_agt002_reanalysis_job',
  'psi_fail_agt002_reanalysis_job',
  'psi_record_agt002_canonical_analysis_run',
];

// The 079 fenced heartbeat renewal RPCs: 081 may extend psi_agt002_reanalysis_jobs, but the
// heartbeat itself must stay identical and fenced for both legacy and durable_batched_v1 jobs.
const HEARTBEAT_RPCS_TO_PRESERVE = ['psi_renew_agt002_preview_claim', 'psi_renew_agt002_reanalysis_job_lease'];

/** Statement text only: an explanatory `--` comment must never satisfy — or trip — a check. */
function withoutComments(sql) {
  return sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
}

function readSql(url, label) {
  assert.ok(
    existsSync(url),
    `${label} must exist: the AGT-002 durable checkpoint + atomic finalization foundation needs the next available additive migration 081_agt002_durable_batched_analysis`,
  );
  return readFileSync(url, 'utf8');
}

function migrationSql() {
  return withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/081_agt002_durable_batched_analysis.sql'));
}

function rollbackSql() {
  return withoutComments(readSql(ROLLBACK_URL, 'supabase/rollbacks/081_agt002_durable_batched_analysis_rollback.sql'));
}

/** The text of one `create table ... (...)` block for a given table name. */
function tableBlock(sql, name) {
  const start = sql.search(new RegExp(String.raw`create\s+table\s+(if\s+not\s+exists\s+)?public\.${name}\b`, 'i'));
  assert.notEqual(start, -1, `migration 081 must define public.${name}`);
  let depth = 0;
  let end = -1;
  for (let i = sql.indexOf('(', start); i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, `public.${name} must be a complete, balanced table definition`);
  return sql.slice(start, end + 1);
}

/** The text of one `create or replace function ... $$;` block. */
function functionBlock(sql, name) {
  const start = sql.search(new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${name}\b`, 'i'));
  assert.notEqual(start, -1, `migration 081 must define public.${name}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `public.${name} must be a complete function body`);
  return sql.slice(start, end + 3);
}

/** The text of one `create trigger ... on public.<table> ...` block, ending at the statement `;`. */
function triggerBlockOn(sql, table) {
  const start = sql.search(new RegExp(String.raw`create\s+trigger\s+\S+\s+before\s+(update|update\s+or\s+delete|insert\s+or\s+update|update\s+or\s+delete\s+or\s+insert)\s+on\s+public\.${table}\b`, 'i'));
  assert.notEqual(start, -1, `migration 081 must define an immutability/transition trigger on public.${table}`);
  const end = sql.indexOf(';', start);
  assert.notEqual(end, -1, `the trigger on public.${table} must be a complete statement`);
  return sql.slice(start, end + 1);
}

/** Every role named in any `revoke all on function public.<fn>(<args>) from <roles>;` /
 * `grant execute on function ... to <roles>;` statement. */
function privilegeRoles(sql, keyword, fn, args) {
  const preposition = keyword === 'grant' ? 'to' : 'from';
  const verb = keyword === 'grant' ? String.raw`grant\s+execute` : String.raw`revoke\s+all`;
  const pattern = new RegExp(String.raw`${verb}\s+on\s+function\s+public\.${fn}\s*${args}\s+${preposition}\s+([^;]+);`, 'gi');
  const roles = new Set();
  const indices = [];
  for (const match of sql.matchAll(pattern)) {
    indices.push(match.index);
    for (const role of match[1].split(',')) roles.add(role.trim().toLowerCase());
  }
  return { roles, indices };
}

function assertServiceRoleOnlyRpc(sql, name, args) {
  const revoked = privilegeRoles(sql, 'revoke', name, args);
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.ok(revoked.roles.has(role), `public.${name} must revoke all from ${role} before granting anything`);
  }
  const granted = privilegeRoles(sql, 'grant', name, args);
  assert.deepEqual([...granted.roles].sort(), ['service_role'], `public.${name} must grant execute to service_role only`);
  assert.ok(granted.indices.length > 0, `public.${name} must grant execute to service_role`);
  assert.ok(
    Math.max(...revoked.indices) < Math.min(...granted.indices),
    `public.${name} must revoke first and grant afterwards`,
  );
}

function assertDefinerAndSearchPath(block, name) {
  assert.match(block, /security\s+definer/i, `public.${name} must be SECURITY DEFINER`);
  assert.match(block, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i, `public.${name} must pin its search_path`);
}

test('migration 081 exists, is one transaction, and stays additive beside every legacy RPC/table', () => {
  const migration = migrationSql();
  assert.match(migration, /^\s*begin;/im, 'the migration must run inside one transaction');
  assert.match(migration, /^\s*commit;/im, 'the migration must commit its single transaction');
  assert.doesNotMatch(migration, /drop\s+table/i, 'migration 081 must never drop an existing table');
  assert.doesNotMatch(migration, /alter\s+table[^;]*drop\s+column/i, 'migration 081 must never drop an existing column');

  for (const fn of LEGACY_RPCS_TO_PRESERVE) {
    assert.doesNotMatch(
      migration, new RegExp(String.raw`drop\s+function\s+(if\s+exists\s+)?public\.${fn}\b`, 'i'),
      `migration 081 must never drop the preexisting public.${fn}`,
    );
  }
  // psi_record_agt002_canonical_analysis_run and psi_complete_agt002_reanalysis_job are the
  // two contracts the new atomic RPC must call, unmodified: 081 may reference them but must
  // not redefine them (a redefinition would mean the "existing canonical contract" is no
  // longer the one 067/076 already hardened, and the "legacy completion RPC" would no longer
  // be preserved byte-for-byte for single_turn_v1 jobs).
  for (const fn of ['psi_record_agt002_canonical_analysis_run', 'psi_complete_agt002_reanalysis_job']) {
    assert.doesNotMatch(
      migration, new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${fn}\b`, 'i'),
      `migration 081 must call public.${fn} rather than redefine it, so it stays exactly as 067/076/068 left it`,
    );
  }
});

test('psi_agt002_analysis_worksets: one durable row per canonical idempotency key, service-role only', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, WORKSET_TABLE);

  assert.match(block, /idempotency_key\s+text\s+not\s+null/i, 'a workset is keyed by the canonical analysis idempotency_key');
  assert.match(
    block, /unique\s*\(\s*idempotency_key\s*\)|idempotency_key\s+text\s+not\s+null\s+unique|primary\s+key[^,]*idempotency_key/i,
    'idempotency_key must be unique: one durable workset per canonical analysis identity, the "work identity"',
  );
  assert.match(
    block, /frozen_identity\s+jsonb\s+not\s+null[^,]*check\s*\(\s*jsonb_typeof\(\s*frozen_identity\s*\)\s*=\s*'object'\s*\)/is,
    'frozen_identity must be a required structured jsonb object binding every immutable input (model, effort, policy/schema/planner versions, inventory/snapshot hashes, evidence/legal identity, frozen-engine-input hash)',
  );
  assert.match(block, /opportunity_id\s+uuid\s+not\s+null\s+references\s+public\.psi_sales_opportunities/i);
  assert.match(block, /tender_id\s+uuid\s+not\s+null\s+references\s+public\.psi_public_tenders/i);
  assert.match(block, /snapshot_id\s+uuid\s+not\s+null\s+references\s+public\.psi_tender_document_snapshots/i);
  assert.match(block, /context_version_id\s+uuid\s+not\s+null\s+references\s+public\.psi_agt002_context_versions/i);
  assert.match(block, /published\s+boolean\s+not\s+null\s+default\s+false/i, 'publication is a narrow marker, false until the canonical RPC actually returns');
  assert.match(
    block, /published_analysis_run_id\s+uuid[^,]*references\s+public\.psi_tender_analysis_runs/i,
    'the published run id must reference the real canonical run row, never a free-text/foreign id',
  );

  assert.match(migration, new RegExp(String.raw`alter\s+table\s+public\.${WORKSET_TABLE}\s+enable\s+row\s+level\s+security`, 'i'));
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.match(
      migration, new RegExp(String.raw`revoke\s+all\s+on\s+table\s+public\.${WORKSET_TABLE}\s+from\s+(public\s*,\s*)?${role}|revoke\s+all\s+on\s+table\s+public\.${WORKSET_TABLE}\s+from\s+[^;]*\b${role}\b`, 'i'),
      `public.${WORKSET_TABLE} must revoke all from ${role} before any narrower grant`,
    );
  }
});

test('psi_agt002_analysis_checkpoints: work identity is (workset_id, stage, batch_index), never a job/attempt id', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, CHECKPOINT_TABLE);

  assert.match(block, /workset_id\s+uuid\s+not\s+null\s+references\s+public\.psi_agt002_analysis_worksets/i);
  assert.match(
    block, /stage\s+text\s+not\s+null[^,]*check\s*\(\s*stage\s+in\s*\(([^)]+)\)\s*\)/is,
    'stage must be a closed check constraint',
  );
  const stageMatch = block.match(/stage\s+text\s+not\s+null[^,]*check\s*\(\s*stage\s+in\s*\(([^)]+)\)\s*\)/is);
  const stages = stageMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(
    stages.sort(),
    ['integral_analysis_batch', 'integral_analysis_plan', 'semantic_discovery_batch', 'semantic_manifest'].sort(),
    'the stage vocabulary must be exactly the four stages the plan defines, no more, no fewer',
  );
  assert.match(block, /batch_index\s+integer\s+not\s+null[^,]*check\s*\([^)]*batch_index\s*>=\s*0\)/is, 'batch_index must be a non-negative integer');

  assert.match(
    block, /unique\s*\(\s*workset_id\s*,\s*stage\s*,\s*batch_index\s*\)/i,
    'the checkpoint identity is (workset_id, stage, batch_index) exactly — the "work identity" — distinct from any job_id/lease/attempt column',
  );
  assert.doesNotMatch(
    block, /\bjob_id\b|\blease_id\b|\battempt\b|\bworker_id\b/i,
    'the checkpoint table must never carry a job/attempt/worker column: fencing identity belongs to the queue job, not to the durable checkpoint row',
  );

  assert.match(
    block, /request_hash\s+text\s+not\s+null[^,]*check\s*\([^)]*request_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\)/is,
    'request_hash must be a validated SHA-256 hex digest',
  );
  assert.match(
    block, /output\s+jsonb\s+not\s+null[^,]*check\s*\(\s*jsonb_typeof\(\s*output\s*\)\s*=\s*'object'\s*\)/is,
    'the accepted validated JSON output must be a required structured object',
  );
  assert.match(
    block, /output_sha256\s+text\s+not\s+null[^,]*check\s*\([^)]*output_sha256\s*~\s*'\^\[0-9a-f\]\{64\}\$'\)/is,
    'output_sha256 must be a validated SHA-256 hex digest of the stored output',
  );
  assert.match(
    block, /usage\s+jsonb[^,]*check\s*\(\s*usage\s+is\s+null\s+or\s+jsonb_typeof\(\s*usage\s*\)\s*=\s*'object'\s*\)/is,
    'usage must be optional but, when present, a structured object',
  );
  assert.match(
    block, /stage_contract_version\s+text\s+not\s+null/i,
    'every checkpoint must record which stage contract/policy/planner version produced it',
  );
  assert.match(block, /provider_idempotency_key\s+text\s+not\s+null/i, 'every checkpoint must record the provider idempotency key used to obtain it');

  assert.doesNotMatch(
    block, /\bprompt\b|\braw_output\b|\bsource_text\b|\bcredential\b|\brejected\b/i,
    'a checkpoint may never carry a raw prompt, raw source text, credential or rejected provider output column',
  );
});

test('checkpoints are append-only: no update or delete is possible after insert', () => {
  const migration = migrationSql();
  const trigger = triggerBlockOn(migration, CHECKPOINT_TABLE);
  assert.match(trigger, /before\s+update\s+or\s+delete/i, 'the checkpoint immutability trigger must fire on both UPDATE and DELETE');
  const fnNameMatch = trigger.match(/execute\s+function\s+public\.(\S+)\s*\(/i);
  assert.ok(fnNameMatch, 'the trigger must name its enforcement function');
  const fn = functionBlock(migration, fnNameMatch[1]);
  assert.match(fn, /raise\s+exception/i, `public.${fnNameMatch[1]} must unconditionally reject the mutation`);
});

test('worksets allow only a one-way false-to-true publication transition, nothing else mutable', () => {
  const migration = migrationSql();
  const trigger = triggerBlockOn(migration, WORKSET_TABLE);
  assert.match(trigger, /before\s+update/i, 'worksets need an update guard, not a blanket append-only trigger, to allow the publication marker to transition');
  const fnNameMatch = trigger.match(/execute\s+function\s+public\.(\S+)\s*\(/i);
  assert.ok(fnNameMatch, 'the trigger must name its enforcement function');
  const fn = functionBlock(migration, fnNameMatch[1]);
  assert.match(fn, /raise\s+exception/i, `public.${fnNameMatch[1]} must reject any mutation outside the narrow publication transition`);
  assert.match(
    fn, /old\.published\s+(and|=\s*true)|old\.published\s+is\s+true/i,
    'the guard must forbid ever un-publishing a workset (true -> false)',
  );
  assert.match(
    fn, /idempotency_key|frozen_identity|opportunity_id|snapshot_id|context_version_id/i,
    'the guard must forbid rewriting identity-bearing columns (idempotency_key, frozen_identity, opportunity/tender/snapshot/context ids)',
  );
});

test('every new RPC is SECURITY DEFINER, search_path-pinned, and service_role only', () => {
  const migration = migrationSql();
  for (const [fn, args] of NEW_RPCS) {
    const block = functionBlock(migration, fn);
    assertDefinerAndSearchPath(block, fn);
    assertServiceRoleOnlyRpc(migration, fn, args);
  }
});

test('psi_get_or_create_agt002_analysis_workset: byte-exact reuse, fail-closed on any conflicting bound field', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, GET_OR_CREATE_WORKSET_FN);
  assert.match(block, /is\s+distinct\s+from/i, 'reuse must compare every bound field with IS DISTINCT FROM (null-safe exact equality), never a loose match');
  assert.match(block, /raise\s+exception/i, 'a conflicting replay under the same idempotency_key must fail closed, never silently pick one side');
  assert.match(block, /insert\s+into\s+public\.psi_agt002_analysis_worksets/i, 'a genuinely new key must insert a new workset row');
});

test('psi_record_agt002_analysis_checkpoint: stage/batch identity is idempotent-reuse, insert-or-compare, fail-closed on conflict', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, RECORD_CHECKPOINT_FN);

  assert.match(block, /insert\s+into\s+public\.psi_agt002_analysis_checkpoints/i, 'a genuinely new (workset_id, stage, batch_index) must insert');
  assert.match(block, /is\s+distinct\s+from/i, 'an exact replay must be compared field-by-field (output, output_sha256, usage, request_hash, provider_idempotency_key) with IS DISTINCT FROM');
  assert.match(block, /raise\s+exception/i, 'a different payload under the same (workset_id, stage, batch_index) must fail closed rather than silently overwrite an immutable checkpoint');
});

test('lease/fencing: checkpoint write, workset publication and the atomic finalize RPC all fence on BOTH job_id and lease_id, and require a running, unexpired lease', () => {
  const migration = migrationSql();
  for (const fn of [RECORD_CHECKPOINT_FN, MARK_PUBLISHED_FN, FINALIZE_FN]) {
    const block = functionBlock(migration, fn);
    assert.match(
      block, /\bid\s*=\s*p_job_id\b/i,
      `public.${fn} must look up the queue job by p_job_id`,
    );
    assert.match(
      block, /lease_id\s*=\s*p_lease_id\b/i,
      `public.${fn} must fence on the lease_id token, not the job id alone (a stale worker holding a superseded lease must never write)`,
    );
    assert.match(
      block, /status\s*=\s*'running'/i,
      `public.${fn} must require the job status to be 'running'; a queued, completed or unavailable job must never accept a checkpoint/publication/finalization write`,
    );
    assert.match(
      block, /lease_expires_at\s*>\s*(now\(\)|clock_timestamp\(\))/i,
      `public.${fn} must reject an already-expired lease instead of resurrecting a reservation someone else may now own`,
    );
  }
});

test('lease/fencing: the job canonical idempotency key must equal the workset identity key', () => {
  const migration = migrationSql();
  for (const fn of [RECORD_CHECKPOINT_FN, MARK_PUBLISHED_FN, FINALIZE_FN]) {
    const block = functionBlock(migration, fn);
    assert.match(
      block, /idempotency_key/i,
      `public.${fn} must compare the job's frozen idempotency_key against the workset it is writing to, so a mismatched job can never write another workset's checkpoints`,
    );
  }
});

test('checkpoint acceptance never publishes canonical analysis', () => {
  const migration = migrationSql();
  const recordBlock = functionBlock(migration, RECORD_CHECKPOINT_FN);
  assert.doesNotMatch(
    recordBlock, /psi_tender_analysis_runs|canonical\s*=\s*true|psi_record_agt002_canonical_analysis_run/i,
    'public.psi_record_agt002_analysis_checkpoint must never touch psi_tender_analysis_runs or set canonical=true: a checkpoint is durable provider acceptance, never a publication',
  );
  const listBlock = functionBlock(migration, LIST_CHECKPOINTS_FN);
  assert.doesNotMatch(
    listBlock, /psi_tender_analysis_runs/i,
    'reading checkpoints must never surface or join current-analysis rows',
  );
  const publishBlock = functionBlock(migration, MARK_PUBLISHED_FN);
  assert.match(
    publishBlock, /canonical\s*(=|is)\s*true/i,
    'marking a workset published must itself verify the referenced run is a real completed canonical run (mirroring 068\'s psi_complete_agt002_reanalysis_job canonical check), never take an unverified id on faith',
  );
});

test('psi_finalize_agt002_durable_batched_analysis calls the existing canonical contract and completes the job in the same transaction', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FINALIZE_FN);
  assert.match(
    block, /public\.psi_record_agt002_canonical_analysis_run\s*\(/i,
    'the atomic finalize RPC must call the existing, unmodified canonical persistence contract rather than reimplement promotion',
  );
  assert.match(
    block, /update\s+public\.psi_agt002_reanalysis_jobs\s+set[^;]*status\s*=\s*'completed'/is,
    'the atomic finalize RPC must complete the queue job (status = completed) in the same function body/transaction as the canonical call, not via a second round trip',
  );
  assert.match(
    block, /update\s+public\.psi_agt002_analysis_worksets\s+set[^;]*published\s*=\s*true/is,
    'the atomic finalize RPC must also mark the workset published in the same transaction',
  );
  // A single PL/pgSQL function body is one transaction: an exception raised by the V3 gate
  // inside psi_record_agt002_canonical_analysis_run (067/076) or by any check here must
  // unwind every write this function made, leaving the job exactly as it was (still
  // 'running', still leased) so the worker can retry or explicitly fail it. This is asserted
  // structurally: the function must not swallow the canonical call's exception (no
  // surrounding EXCEPTION WHEN OTHERS THEN block that would convert a hard failure into a
  // partial commit).
  assert.doesNotMatch(
    block, /exception\s+when\s+others\s+then/i,
    'the atomic finalize RPC must never catch-and-continue past a canonical persistence failure: the whole transaction must roll back on any error, preserving the prior canonical run untouched',
  );
});

test('the legacy single-turn completion RPC is preserved untouched and still callable', () => {
  const migration = migrationSql();
  assert.doesNotMatch(
    migration, /create\s+or\s+replace\s+function\s+public\.psi_complete_agt002_reanalysis_job\b/i,
    'migration 081 must leave the 068 single-turn completion RPC exactly as it is: durable-batched jobs finalize atomically, but legacy single_turn_v1 jobs must keep completing exactly as before',
  );
  const finalizeBlock = functionBlock(migration, FINALIZE_FN);
  assert.doesNotMatch(
    finalizeBlock, /public\.psi_complete_agt002_reanalysis_job\s*\(/i,
    'the new atomic finalize RPC must complete the job directly (in its own transaction), never by calling out to the separate legacy completion RPC, which would reintroduce the two-step non-atomicity this RPC exists to remove',
  );
});

test('no new RPC accepts a raw prompt, model output text, or credential as a parameter', () => {
  const migration = migrationSql();
  for (const [fn] of NEW_RPCS) {
    const block = functionBlock(migration, fn);
    const signature = block.slice(0, block.indexOf(')') + 1);
    assert.doesNotMatch(
      signature, /p_(prompt|raw[a-z_]*|source_text|credential|api_key|secret)\b/i,
      `public.${fn} must never accept a raw prompt/source/credential parameter`,
    );
  }
});

test('the rollback exists, is one transaction, and refuses to run while any workset/checkpoint history exists', () => {
  const rollback = rollbackSql();
  assert.match(rollback, /^\s*begin;/im, 'the rollback must run inside one transaction');
  assert.match(rollback, /^\s*commit;/im, 'the rollback must commit its single transaction');

  assert.match(
    rollback, /raise\s+exception/i,
    'the rollback must fail closed (raise exception) while resumable/terminal history still exists in the new tables, mirroring 068\'s rollback guard, so rollback can never silently strand durable checkpoints',
  );
  assert.match(
    rollback, new RegExp(String.raw`select\s+1\s+from\s+public\.${WORKSET_TABLE}|exists\s*\(\s*select[^)]*public\.${WORKSET_TABLE}`, 'is'),
    'the rollback guard must check for existing rows in psi_agt002_analysis_worksets before dropping anything',
  );

  for (const [fn] of NEW_RPCS) {
    assert.match(
      rollback, new RegExp(String.raw`drop\s+function\s+if\s+exists\s+public\.${fn}\b`, 'i'),
      `the rollback must remove public.${fn}`,
    );
  }
  for (const table of [CHECKPOINT_TABLE, WORKSET_TABLE]) {
    assert.match(rollback, new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${table}\b`, 'i'), `the rollback must remove public.${table}`);
  }
  // Checkpoints reference worksets; the rollback must drop them in dependency order (or rely
  // on a guarded cascade) so a partial rollback can never leave an orphaned checkpoint table.
  assert.ok(
    rollback.search(new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${CHECKPOINT_TABLE}\b`, 'i'))
      < rollback.search(new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${WORKSET_TABLE}\b`, 'i')),
    'the rollback must drop psi_agt002_analysis_checkpoints before psi_agt002_analysis_worksets',
  );

  for (const fn of LEGACY_RPCS_TO_PRESERVE) {
    assert.doesNotMatch(
      rollback, new RegExp(String.raw`drop\s+function\s+(if\s+exists\s+)?public\.${fn}\b`, 'i'),
      `the rollback must never remove the preexisting public.${fn}`,
    );
  }
  assert.doesNotMatch(rollback, /drop\s+table\s+if\s+exists\s+public\.psi_agt002_reanalysis_jobs\b/i, 'the rollback must never drop the preexisting reanalysis jobs table');
});

// ---------------------------------------------------------------------------------------------
// RED expansion below: Task 1 requirements the current migration 081 does not implement yet
// (execution_mode/phase/progress/resume_count on psi_agt002_reanalysis_jobs, server-owned
// enqueue, bounded reclaim, finalize's canonical/status/context_version_id/execution_mode
// gates, and the governed one-way archival RPC that ever lets rollback proceed again). Every
// assertion below targets a real, currently-missing behavior, not formatting.
// ---------------------------------------------------------------------------------------------

/** Every `alter table public.<table> ...;` statement in the migration, concatenated. */
function alterTableStatementsOn(sql, table) {
  const re = new RegExp(String.raw`alter\s+table\s+public\.${table}\b[^;]*;`, 'gis');
  return [...sql.matchAll(re)].map(m => m[0]).join('\n');
}

/** Column names declared as `<name> integer not null default 0 ... check (<name> >= 0)`. */
function nonNegativeIntegerColumns(sql) {
  const re = /(\w+)\s+integer\s+not\s+null\s+default\s+0[^,;]*check\s*\(\s*\1\s*>=\s*0\)/gi;
  return new Set([...sql.matchAll(re)].map(m => m[1].toLowerCase()));
}

test('psi_agt002_reanalysis_jobs additively gains execution_mode, a closed nullable phase, non-negative progress counters, and a bounded resume_count', () => {
  const migration = migrationSql();
  const jobsAlter = alterTableStatementsOn(migration, 'psi_agt002_reanalysis_jobs');
  assert.ok(
    jobsAlter.length > 0,
    'migration 081 must additively extend public.psi_agt002_reanalysis_jobs (execution_mode, phase, progress counters, resume_count) via ALTER TABLE, never by redefining the 068 table',
  );

  assert.match(
    migration, /execution_mode\s+text\s+not\s+null\s+default\s+'single_turn_v1'/i,
    "execution_mode must default to the legacy 'single_turn_v1' so every pre-081 row (and any row inserted without an explicit mode) stays valid and behaviorally unchanged",
  );
  assert.match(
    migration,
    /execution_mode\s+in\s*\(\s*'single_turn_v1'\s*,\s*'durable_batched_v1'\s*\)|execution_mode\s+in\s*\(\s*'durable_batched_v1'\s*,\s*'single_turn_v1'\s*\)/i,
    'execution_mode must be a closed check constraint with exactly the two allowlisted values',
  );

  assert.match(migration, /\bphase\s+text\b/i, 'a nullable phase column must exist for safe progress reporting');
  assert.doesNotMatch(migration, /phase\s+text\s+not\s+null/i, 'phase must be nullable: a legacy or not-yet-started job has no phase');
  assert.match(
    migration, /phase\s+is\s+null\s+or\s+phase\s+in\s*\(|phase\s+in\s*\([^)]+\)\s*or\s+phase\s+is\s+null/i,
    'phase must be closed to a fixed vocabulary, not free text',
  );

  const counters = nonNegativeIntegerColumns(migration);
  assert.ok(counters.has('resume_count'), 'resume_count must be declared integer not null default 0 with a resume_count >= 0 check');
  const progressCounters = [...counters].filter(name => name !== 'resume_count');
  assert.ok(
    progressCounters.length >= 2,
    `at least two additional non-negative safe progress counters are required beside resume_count (found: ${[...counters].join(', ') || 'none'})`,
  );

  const capMatch = migration.match(/resume_count\s*<=\s*(\d+)/i);
  assert.ok(capMatch, 'resume_count must carry a closed upper bound (resume_count <= N) so automatic reclaim can never be unbounded');
  const cap = Number(capMatch[1]);
  assert.ok(cap > 0 && cap <= 50, 'the resume_count cap must be a small, sane positive bound');
});

test('psi_create_agt002_reanalysis_job keeps its exact 7-parameter enqueue signature but stamps every new job execution_mode = durable_batched_v1 server-side', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, CREATE_JOB_FN);
  assert.match(
    block,
    /create\s+or\s+replace\s+function\s+public\.psi_create_agt002_reanalysis_job\s*\(\s*p_opportunity_id\s+uuid\s*,\s*p_tender_id\s+uuid\s*,\s*p_snapshot_id\s+uuid\s*,\s*p_context_version_id\s+uuid\s*,\s*p_idempotency_key\s+text\s*,\s*p_frozen_engine_input\s+jsonb\s*,\s*p_requested_by\s+uuid\s*\)/i,
    'the enqueue signature must stay byte-identical to 068 (uuid,uuid,uuid,uuid,text,jsonb,uuid): callers can never add or forge an execution_mode parameter',
  );
  assert.match(
    block, /execution_mode[\s\S]{0,400}?'durable_batched_v1'|'durable_batched_v1'[\s\S]{0,400}?execution_mode/i,
    'every newly enqueued job must be stamped durable_batched_v1 explicitly by the server, never left to rely on the column default alone',
  );
});

test('execution_mode is server-owned end to end: no RPC in migration 081 accepts a caller-supplied p_execution_mode parameter', () => {
  const migration = migrationSql();
  assert.doesNotMatch(migration, /p_execution_mode\b/i, 'execution_mode must never appear as an RPC parameter; the caller can never pass or forge it');
});

test('psi_claim_agt002_reanalysis_job reclaims an expired durable job below the resume cap and still terminally fails a legacy or at/over-cap job', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, CLAIM_JOB_FN);
  assert.match(
    block,
    /execution_mode\s*=\s*'durable_batched_v1'|execution_mode\s*<>\s*'durable_batched_v1'|execution_mode\s+is\s+distinct\s+from\s+'durable_batched_v1'/i,
    'the claim sweep must branch on execution_mode to tell a durable_batched_v1 job from a legacy single_turn_v1 job',
  );
  assert.match(block, /resume_count\s*<\s*\d+/i, 'the reclaim branch must only fire below a bounded resume_count cap, so reclaim can never be unbounded');
  assert.match(block, /resume_count\s*\+\s*1/i, 'a reclaim must increment resume_count');
  assert.match(block, /status\s*=\s*'queued'/i, 'a reclaimed durable job must go back to queued so it (and its retained checkpoints) can be claimed again');
  assert.match(block, /status\s*=\s*'unavailable'/i, 'a legacy job, or a durable job at/over the resume cap, must still be closed terminally exactly as 068 already does');
});

test('psi_claim_agt002_reanalysis_job returns the durable resume/progress fields the worker needs to resume a claimed job', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, CLAIM_JOB_FN);
  const fieldsFromClaimedRow = [
    ['execution_mode', 'v_job.execution_mode'],
    ['phase', 'v_job.phase'],
    ['completed_batch_count', 'v_job.completed_batch_count'],
    ['total_batch_count', 'v_job.total_batch_count'],
    ['resume_count', 'v_job.resume_count'],
  ];
  for (const [key, sourceExpr] of fieldsFromClaimedRow) {
    const pattern = new RegExp(
      String.raw`'${key}'\s*,\s*${sourceExpr.replace('.', String.raw`\s*\.\s*`)}\b`,
      'i',
    );
    assert.match(
      block, pattern,
      `the claimed-job jsonb response must include '${key}' sourced from ${sourceExpr}, so a resumed durable job can pick up where it left off`,
    );
  }
});

test("migration 081 leaves the 079 fenced heartbeat renewal RPCs untouched: heartbeat stays fenced and compatible for every execution_mode", () => {
  const migration = migrationSql();
  for (const fn of HEARTBEAT_RPCS_TO_PRESERVE) {
    assert.doesNotMatch(
      migration, new RegExp(String.raw`(create\s+or\s+replace|drop)\s+function\s+(if\s+exists\s+)?public\.${fn}\b`, 'i'),
      `migration 081 must never redefine or drop public.${fn}: the heartbeat must remain identical for both legacy and durable_batched_v1 jobs`,
    );
  }
});

test('psi_finalize_agt002_durable_batched_analysis accepts only durable_batched_v1 jobs and rejects a legacy single_turn_v1 job', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FINALIZE_FN);
  assert.match(
    block,
    /execution_mode\s+is\s+distinct\s+from\s+'durable_batched_v1'|execution_mode\s*<>\s*'durable_batched_v1'/i,
    'finalize must reject a job whose execution_mode is not durable_batched_v1: legacy jobs finalize only through the untouched 068 psi_complete_agt002_reanalysis_job path',
  );
});

test("psi_finalize_agt002_durable_batched_analysis rejects a p_context_version_id that disagrees with the workset's own context_version_id", () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FINALIZE_FN);
  assert.match(
    block, /context_version_id\s+is\s+distinct\s+from\s+p_context_version_id/i,
    "finalize must compare the workset's stored context_version_id against p_context_version_id, exactly like it already does for opportunity_id/tender_id/snapshot_id",
  );
});

test('psi_finalize_agt002_durable_batched_analysis validates that the canonical RPC actually returned canonical=true and status=completed before publishing or completing the job', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FINALIZE_FN);
  assert.match(
    block,
    /v_run_result\s*->>?\s*'canonical'|\(\s*v_run_result\s*->>\s*'canonical'\s*\)::boolean/i,
    "finalize must inspect the canonical flag on the value returned by psi_record_agt002_canonical_analysis_run: an idempotent replay of a run that has SINCE been demoted (canonical=false by a later, unrelated promotion) must never be treated as success",
  );
  assert.match(
    block, /v_run_result\s*->>\s*'status'/i,
    "finalize must also inspect the returned run's status: a replay whose status is not 'completed' must never publish/complete either",
  );
});

test("psi_agt002_analysis_worksets gains archived_at/archived_by columns and the update guard forbids ever un-archiving", () => {
  const migration = migrationSql();
  assert.match(migration, /archived_at\s+timestamptz/i, 'psi_agt002_analysis_worksets must additively gain a nullable archived_at column');
  assert.match(
    migration, /archived_by\s+uuid[^,;]*references\s+public\.psi_sales_profiles/i,
    'archived_by must reference a real actor profile, never a free-text/anonymous field',
  );

  const trigger = triggerBlockOn(migration, WORKSET_TABLE);
  const fnNameMatch = trigger.match(/execute\s+function\s+public\.(\S+)\s*\(/i);
  assert.ok(fnNameMatch, 'the trigger must name its enforcement function');
  const fn = functionBlock(migration, fnNameMatch[1]);
  assert.match(
    fn, /archived_at/i,
    'the worksets update guard must also police archived_at: it may move from null to a real timestamp, but never back, and never alongside any other rewritten column',
  );
});

test('psi_archive_agt002_analysis_workset is a governed, one-way archival RPC gated on no active job for the canonical identity', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, ARCHIVE_WORKSET_FN);
  assertDefinerAndSearchPath(block, ARCHIVE_WORKSET_FN);
  assert.match(
    block,
    /status\s+in\s*\(\s*'queued'\s*,\s*'running'\s*\)|status\s*=\s*'queued'\s+or\s+status\s*=\s*'running'/i,
    "archival must check for any active (queued/running) job under the workset's own canonical idempotency_key before archiving",
  );
  assert.match(block, /raise\s+exception/i, 'archival must fail closed while an active job remains for this canonical identity');
  assert.match(block, /archived_at\s*=\s*(now\(\)|clock_timestamp\(\))/i, 'archival must stamp a real archival timestamp');
  assert.match(block, /archived_by\s*=\s*p_actor_id/i, 'archival must record the acting profile, never an anonymous action');
  assert.doesNotMatch(
    block, /delete\s+from\s+public\.psi_agt002_analysis_checkpoints/i,
    'archival must never directly delete checkpoint rows: checkpoints stay append-only even through the archival path',
  );
});

test('archival RPC is SECURITY DEFINER, service_role only, and takes no prompt/raw-output/credential parameter', () => {
  const migration = migrationSql();
  assertServiceRoleOnlyRpc(migration, ARCHIVE_WORKSET_FN, ARCHIVE_WORKSET_ARGS);
  const block = functionBlock(migration, ARCHIVE_WORKSET_FN);
  const signature = block.slice(0, block.indexOf(')') + 1);
  assert.doesNotMatch(
    signature, /p_(prompt|raw[a-z_]*|source_text|credential|api_key|secret|result|output)\b/i,
    'psi_archive_agt002_analysis_workset must never accept a raw prompt/source/credential/output parameter: identity and actor only',
  );
});

test('the rollback allows dropping 081 artifacts once every workset is explicitly archived and every job for its identity is terminal', () => {
  const rollback = rollbackSql();
  assert.match(
    rollback, /archived_at\s+is\s+null/i,
    'the rollback guard must exempt explicitly archived worksets (archived_at is not null) instead of blocking on the mere existence of any row',
  );
  assert.match(
    rollback,
    /status\s+in\s*\(\s*'queued'\s*,\s*'running'\s*\)|status\s*=\s*'queued'\s+or\s+status\s*=\s*'running'/i,
    'the rollback guard must also refuse while an active (queued/running) job still references a workset identity, even once that workset row is archived',
  );
});

// ---------------------------------------------------------------------------------------------
// RED expansion: psi_record_agt002_analysis_checkpoint also carries the SQL progress contract —
// a closed progress phase, non-regressing completed/total batch counts, stage<->phase pairing,
// and the SAME fenced running-job update (id=p_job_id AND lease_id=p_lease_id), fail-closed
// unless exactly one row updates. No separate/unfenced "update progress" RPC may ever exist.
// ---------------------------------------------------------------------------------------------

test('psi_record_agt002_analysis_checkpoint signature carries p_progress_phase, p_completed_batch_count and p_total_batch_count', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, RECORD_CHECKPOINT_FN);
  const signature = block.slice(0, block.indexOf(')') + 1);
  assert.match(signature, /p_progress_phase\s+text\b/i, 'the signature must name a p_progress_phase text parameter');
  assert.match(signature, /p_completed_batch_count\s+integer\b/i, 'the signature must name a p_completed_batch_count integer parameter');
  assert.match(signature, /p_total_batch_count\s+integer\b/i, 'the signature must name a p_total_batch_count integer parameter');
  assert.match(
    signature, new RegExp(RECORD_CHECKPOINT_NAMED_ARGS, 'i'),
    'the full signature must match the exact new 14 named parameters/types, in order, trailing (..., p_progress_phase text, p_completed_batch_count integer, p_total_batch_count integer)',
  );
});

test('migration 081 defines psi_record_agt002_analysis_checkpoint exactly once, with only the new progress-aware signature (no old/new overload pair)', () => {
  const migration = migrationSql();
  const defineCount = [...migration.matchAll(new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${RECORD_CHECKPOINT_FN}\s*\(`, 'gi'))].length;
  assert.equal(defineCount, 1, 'psi_record_agt002_analysis_checkpoint must be defined exactly once');
  assert.doesNotMatch(
    migration,
    new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${RECORD_CHECKPOINT_FN}\s*${RECORD_CHECKPOINT_OLD_ARGS}`, 'i'),
    'the old 11-argument (pre-progress) signature must never be (re)defined alongside the new one',
  );
});

test('psi_record_agt002_analysis_checkpoint validates a closed progress-phase vocabulary, fail-closed on anything outside semantic_discovery/integral_analysis', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, RECORD_CHECKPOINT_FN);
  assert.match(
    block,
    /p_progress_phase\s+(not\s+)?in\s*\(\s*'semantic_discovery'\s*,\s*'integral_analysis'\s*\)|p_progress_phase\s+(not\s+)?in\s*\(\s*'integral_analysis'\s*,\s*'semantic_discovery'\s*\)/i,
    'p_progress_phase must be checked against the exact closed vocabulary (semantic_discovery, integral_analysis), no more, no fewer',
  );
});

test('psi_record_agt002_analysis_checkpoint requires a positive p_completed_batch_count and total_batch_count >= completed_batch_count', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, RECORD_CHECKPOINT_FN);
  assert.match(
    block,
    /p_completed_batch_count\s*<=\s*0|p_completed_batch_count\s*<\s*1|not\s*\(\s*p_completed_batch_count\s*>\s*0\s*\)/i,
    'a non-positive p_completed_batch_count (zero or negative) must fail closed: a checkpoint always records at least one completed batch',
  );
  assert.match(
    block,
    /p_total_batch_count\s*<\s*p_completed_batch_count/i,
    'p_total_batch_count must never be less than p_completed_batch_count within the same call',
  );
});

test('psi_record_agt002_analysis_checkpoint enforces stage<->progress_phase pairing (semantic_* stages require semantic_discovery, integral_* stages require integral_analysis)', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, RECORD_CHECKPOINT_FN);
  assert.match(
    block,
    /(semantic_discovery_batch|semantic_manifest)[\s\S]{0,300}p_progress_phase[\s\S]{0,80}'semantic_discovery'|p_progress_phase[\s\S]{0,80}'semantic_discovery'[\s\S]{0,300}(semantic_discovery_batch|semantic_manifest)/i,
    'a semantic_discovery_batch/semantic_manifest checkpoint stage must require p_progress_phase = semantic_discovery',
  );
  assert.match(
    block,
    /(integral_analysis_batch|integral_analysis_plan)[\s\S]{0,300}p_progress_phase[\s\S]{0,80}'integral_analysis'|p_progress_phase[\s\S]{0,80}'integral_analysis'[\s\S]{0,300}(integral_analysis_batch|integral_analysis_plan)/i,
    'an integral_analysis_batch/integral_analysis_plan checkpoint stage must require p_progress_phase = integral_analysis',
  );
  assert.match(block, /raise\s+exception/i, 'a mismatched stage<->phase pairing must fail closed');
});

test('psi_record_agt002_analysis_checkpoint rejects progress regression within the same phase, and any phase transition other than semantic_discovery -> integral_analysis', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, RECORD_CHECKPOINT_FN);
  assert.match(
    block,
    /p_completed_batch_count\s*<\s*v_job\.completed_batch_count|v_job\.completed_batch_count\s*>\s*p_completed_batch_count/i,
    'a lower p_completed_batch_count than the job already has recorded must be rejected: progress may never move backwards',
  );
  assert.match(
    block,
    /p_total_batch_count\s*<\s*v_job\.total_batch_count|v_job\.total_batch_count\s*>\s*p_total_batch_count/i,
    'a lower p_total_batch_count than the job already has recorded must be rejected: the total may never shrink',
  );
  assert.match(
    block,
    /v_job\.phase\s*=\s*'integral_analysis'[\s\S]{0,200}p_progress_phase\s*=\s*'semantic_discovery'|p_progress_phase\s*=\s*'semantic_discovery'[\s\S]{0,200}v_job\.phase\s*=\s*'integral_analysis'/i,
    'a reverse phase transition (already integral_analysis, incoming semantic_discovery) must be rejected; only semantic_discovery -> integral_analysis is a legal forward transition',
  );
});

test('psi_record_agt002_analysis_checkpoint updates the SAME fenced running job (id=p_job_id AND lease_id=p_lease_id) with the new phase and counts, after the immutable checkpoint insert/replay validation', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, RECORD_CHECKPOINT_FN);

  const insertIdx = block.search(/insert\s+into\s+public\.psi_agt002_analysis_checkpoints/i);
  assert.notEqual(insertIdx, -1, 'the checkpoint insert-or-compare must still exist');
  const updateIdx = block.search(/update\s+public\.psi_agt002_reanalysis_jobs\s+set[^;]*phase\s*=\s*p_progress_phase/is);
  assert.notEqual(updateIdx, -1, 'the function must update public.psi_agt002_reanalysis_jobs, setting phase = p_progress_phase');
  assert.ok(
    updateIdx > insertIdx,
    'the fenced job update must happen after the immutable checkpoint insert/exact-replay validation, in the same function body',
  );

  assert.match(
    block,
    /update\s+public\.psi_agt002_reanalysis_jobs\s+set[^;]*completed_batch_count\s*=\s*p_completed_batch_count[^;]*;/is,
    'the update must set completed_batch_count = p_completed_batch_count',
  );
  assert.match(
    block,
    /update\s+public\.psi_agt002_reanalysis_jobs\s+set[^;]*total_batch_count\s*=\s*p_total_batch_count[^;]*;/is,
    'the update must set total_batch_count = p_total_batch_count',
  );

  const updateStmtMatch = block.match(/update\s+public\.psi_agt002_reanalysis_jobs\s+set[\s\S]*?where[^;]*;/i);
  assert.ok(updateStmtMatch, 'the job update must carry a WHERE clause');
  assert.match(updateStmtMatch[0], /\bid\s*=\s*p_job_id\b/i, 'the job update must be fenced by id = p_job_id');
  assert.match(updateStmtMatch[0], /lease_id\s*=\s*p_lease_id\b/i, 'the job update must be fenced by lease_id = p_lease_id, not id alone');
  assert.match(updateStmtMatch[0], /status\s*=\s*'running'/i, 'the job update must require the job still be running');

  assert.match(
    block,
    /get\s+diagnostics\s+\S+\s*=\s*row_count/i,
    'the function must capture ROW_COUNT from the fenced job update so it can fail closed unless exactly one row updated',
  );
  assert.match(
    block,
    /(<>|!=|is\s+distinct\s+from)\s*1\b[\s\S]{0,200}raise\s+exception|raise\s+exception[\s\S]{0,200}(<>|!=|is\s+distinct\s+from)\s*1\b/i,
    'the function must raise an exception if the fenced job update did not affect exactly one row (stale/lost lease, job no longer running, or a wrong job/lease id)',
  );
});

test('no other RPC in migration 081 writes phase, completed_batch_count or total_batch_count: those columns are owned exclusively by psi_record_agt002_analysis_checkpoint', () => {
  const migration = migrationSql();
  const recordBlock = functionBlock(migration, RECORD_CHECKPOINT_FN);
  const recordStart = migration.indexOf(recordBlock);
  const migrationWithoutRecordBlock = migration.slice(0, recordStart) + migration.slice(recordStart + recordBlock.length);

  assert.doesNotMatch(
    migrationWithoutRecordBlock,
    /update\s+public\.psi_agt002_reanalysis_jobs\s+set[^;]*(completed_batch_count|total_batch_count)\s*=/is,
    'no RPC other than psi_record_agt002_analysis_checkpoint may ever write completed_batch_count/total_batch_count: a second writer would be an unfenced, duplicate progress-update surface',
  );
  assert.doesNotMatch(
    migrationWithoutRecordBlock,
    /update\s+public\.psi_agt002_reanalysis_jobs\s+set[^;]*\bphase\s*=\s*p_progress_phase\b/is,
    'no RPC other than psi_record_agt002_analysis_checkpoint may ever write phase from a caller-supplied progress phase',
  );
});

test('the rollback drops psi_record_agt002_analysis_checkpoint by its exact new signature, never a bare or old-overload DROP FUNCTION', () => {
  const rollback = rollbackSql();
  assert.match(
    rollback,
    new RegExp(String.raw`drop\s+function\s+if\s+exists\s+public\.${RECORD_CHECKPOINT_FN}\s*${RECORD_CHECKPOINT_ARGS}\s*;`, 'i'),
    'the rollback must drop psi_record_agt002_analysis_checkpoint by its exact, fully-typed new 14-argument signature',
  );
  assert.doesNotMatch(
    rollback,
    new RegExp(String.raw`drop\s+function\s+if\s+exists\s+public\.${RECORD_CHECKPOINT_FN}\s*${RECORD_CHECKPOINT_OLD_ARGS}\s*;`, 'i'),
    'the rollback must never target the old pre-progress 11-argument overload: migration 081 replaces that signature entirely rather than leaving a second overload behind',
  );
});
