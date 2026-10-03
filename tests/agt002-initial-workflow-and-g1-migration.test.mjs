// AGT-002 P0-03 — migration 100 structural contract (RED, no production change). Mirrors the
// conventions of tests/agt002-evidence-packages-migration.test.mjs (P0-02), but pins a
// DISTINCT, neutral migration for the initial-analysis slice:
// supabase/migrations/100_agt002_initial_workflow_and_g1.sql. This migration must NEVER touch,
// reference, or enqueue into the reanalysis operational surface
// (psi_agt002_reanalysis_jobs and its four RPCs), and must NEVER redefine any preexisting
// AGT-002 object — in particular every object 099 (evidence packages) introduced stays
// byte-for-byte untouched.
//
// Contract pinned here:
//   * psi_agt002_workflow_instances / psi_agt002_workflow_events /
//     psi_agt002_analysis_authorizations are permanently append-only, RLS-protected,
//     service_role-select-only tables; every write goes through a governed SECURITY DEFINER RPC.
//   * The legal initial-analysis state transition matrix (REQUESTED -> AUTHORIZED|REJECTED;
//     AUTHORIZED -> CONSUMED|REVOKED|EXPIRED; CONSUMED -> COMPLETED|FAILED) is enforced inside
//     psi_append_agt002_workflow_event, not merely by a table CHECK (it depends on the prior
//     event's to_state).
//   * Every event row carries actor/authority/target/env/scope/preconditions/evidence/
//     expires_at/rollback_of_event_id.
//   * G1 authorizes only INITIAL (psi_agt002_analysis_authorizations.workflow_type is
//     CHECK-pinned to 'INITIAL'; psi_grant_agt002_g1_analysis_authorization re-asserts it).
//   * scope is exactly 'A' or 'A_PLUS_B'; A_PLUS_B requires an immutable
//     profile_snapshot_id/profile_snapshot_hash pair, A forbids both.
//   * psi_consume_agt002_analysis_authorization is the prepared, atomic consume-on-create
//     boundary RPC that P0-04 job creation will call — it fails closed on double consumption
//     and on any workflow/package version+hash/opportunity/tender mismatch, and it must never
//     reference any job table: creating jobs is explicitly out of scope for P0-03.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATION_URL = new URL('../supabase/migrations/100_agt002_initial_workflow_and_g1.sql', import.meta.url);
const ROLLBACK_URL = new URL('../supabase/rollbacks/100_agt002_initial_workflow_and_g1_rollback.sql', import.meta.url);

const INSTANCE_TABLE = 'psi_agt002_workflow_instances';
const EVENT_TABLE = 'psi_agt002_workflow_events';
const AUTHORIZATION_TABLE = 'psi_agt002_analysis_authorizations';
const TABLES = [INSTANCE_TABLE, EVENT_TABLE, AUTHORIZATION_TABLE];

const CREATE_INSTANCE_FN = 'psi_create_agt002_workflow_instance';
const CREATE_INSTANCE_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*uuid\s*\)`;
const APPEND_EVENT_FN = 'psi_append_agt002_workflow_event';
// (p_workflow_instance_id, p_to_state, p_actor_profile_id, p_actor_kind, p_authority,
// p_target, p_env, p_preconditions, p_evidence, p_expires_at, p_rollback_of_event_id,
// p_idempotency_key)
const APPEND_EVENT_ARGS = String.raw`\(\s*uuid\s*,\s*text\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*jsonb\s*,\s*jsonb\s*,\s*timestamptz\s*,\s*uuid\s*,\s*text\s*\)`;
const GRANT_FN = 'psi_grant_agt002_g1_analysis_authorization';
const GRANT_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*timestamptz\s*,\s*text\s*,\s*uuid\s*\)`;
const CONSUME_FN = 'psi_consume_agt002_analysis_authorization';
const CONSUME_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*uuid\s*\)`;
const NEW_RPCS = [
  [CREATE_INSTANCE_FN, CREATE_INSTANCE_ARGS],
  [APPEND_EVENT_FN, APPEND_EVENT_ARGS],
  [GRANT_FN, GRANT_ARGS],
  [CONSUME_FN, CONSUME_ARGS],
];

const PREEXISTING_TO_PRESERVE = [
  'psi_resolve_agt002_evidence_package_candidate',
  'psi_freeze_agt002_evidence_package',
  'psi_record_agt002_context_version',
  'psi_record_agt002_canonical_analysis_run',
];
const PREEXISTING_TABLES_TO_PRESERVE = [
  'psi_agt002_evidence_packages',
  'psi_agt002_evidence_package_versions',
  'psi_agt002_evidence_package_members',
  'psi_agt002_evidence_package_batches',
  'psi_agt002_context_versions',
];

const REANALYSIS_TABLE_NAME = 'psi_agt002_reanalysis_jobs';
const REANALYSIS_RPC_NAMES = [
  'psi_create_agt002_reanalysis_job',
  'psi_claim_agt002_reanalysis_job',
  'psi_complete_agt002_reanalysis_job',
  'psi_fail_agt002_reanalysis_job',
];

const LEGAL_TRANSITIONS = [
  ['REQUESTED', 'AUTHORIZED'],
  ['REQUESTED', 'REJECTED'],
  ['AUTHORIZED', 'CONSUMED'],
  ['AUTHORIZED', 'REVOKED'],
  ['AUTHORIZED', 'EXPIRED'],
  ['CONSUMED', 'COMPLETED'],
  ['CONSUMED', 'FAILED'],
];

/** Statement text only: an explanatory `--` comment must never satisfy — or trip — a check. */
function withoutComments(sql) {
  return sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
}

function readSql(url, label) {
  assert.ok(
    existsSync(url),
    `${label} must exist: AGT-002 P0-03 needs the next available additive migration 100_agt002_initial_workflow_and_g1`,
  );
  return readFileSync(url, 'utf8');
}

function migrationSql() {
  return withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/100_agt002_initial_workflow_and_g1.sql'));
}

function rollbackSql() {
  return withoutComments(readSql(ROLLBACK_URL, 'supabase/rollbacks/100_agt002_initial_workflow_and_g1_rollback.sql'));
}

function tableBlock(sql, name) {
  const start = sql.search(new RegExp(String.raw`create\s+table\s+(if\s+not\s+exists\s+)?public\.${name}\b`, 'i'));
  assert.notEqual(start, -1, `migration 100 must define public.${name}`);
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

function functionBlock(sql, name) {
  const start = sql.search(new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${name}\b`, 'i'));
  assert.notEqual(start, -1, `migration 100 must define public.${name}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `public.${name} must be a complete function body`);
  return sql.slice(start, end + 3);
}

function triggerBlockOn(sql, table) {
  const start = sql.search(new RegExp(String.raw`create\s+trigger\s+\S+\s+before\s+update\s+or\s+delete\s+on\s+public\.${table}\b`, 'i'));
  assert.notEqual(start, -1, `migration 100 must define an append-only trigger on public.${table}`);
  const end = sql.indexOf(';', start);
  assert.notEqual(end, -1, `the trigger on public.${table} must be a complete statement`);
  return sql.slice(start, end + 1);
}

function assertDefinerAndSearchPath(block, name) {
  assert.match(block, /security\s+definer/i, `public.${name} must be SECURITY DEFINER`);
  assert.match(block, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i, `public.${name} must pin its search_path`);
}

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

test('migration 100 exists, is one transaction, and stays additive beside every preexisting AGT-002 object', () => {
  const migration = migrationSql();
  assert.match(migration, /^\s*begin;/im, 'the migration must run inside one transaction');
  assert.match(migration, /^\s*commit;/im, 'the migration must commit its single transaction');
  assert.doesNotMatch(migration, /drop\s+table/i, 'migration 100 must never drop an existing table');
  assert.doesNotMatch(migration, /alter\s+table[^;]*drop\s+column/i, 'migration 100 must never drop an existing column');

  for (const fn of PREEXISTING_TO_PRESERVE) {
    assert.doesNotMatch(
      migration, new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${fn}\b`, 'i'),
      `migration 100 must never redefine the preexisting public.${fn}`,
    );
  }
});

test('migration 100 never references the reanalysis operational surface, and never creates a job of any kind', () => {
  const migration = migrationSql();
  assert.doesNotMatch(
    migration, new RegExp(REANALYSIS_TABLE_NAME, 'i'),
    'migration 100 must never reference psi_agt002_reanalysis_jobs anywhere: P0-03 prepares the consume RPC contract but never creates a job',
  );
  for (const rpc of REANALYSIS_RPC_NAMES) {
    assert.doesNotMatch(
      migration, new RegExp(rpc, 'i'),
      `migration 100 must never call or reference ${rpc}`,
    );
  }
  assert.doesNotMatch(migration, /create\s+table[^;]*\bjobs?\b/i, 'migration 100 must never define any job table: job creation is P0-04\'s scope, not P0-03\'s');
});

test('every new table is additive: RLS on, revoked from every direct role, service_role read-only', () => {
  const migration = migrationSql();
  for (const table of TABLES) {
    tableBlock(migration, table);
    assert.match(
      migration, new RegExp(String.raw`alter\s+table\s+public\.${table}\s+enable\s+row\s+level\s+security`, 'i'),
      `public.${table} must enable row level security`,
    );
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      assert.match(
        migration,
        new RegExp(String.raw`revoke\s+all\s+on\s+table\s+public\.${table}\s+from\s+[^;]*\b${role}\b`, 'i'),
        `public.${table} must revoke all from ${role} before any narrower grant`,
      );
    }
    assert.match(
      migration, new RegExp(String.raw`grant\s+select\s+on\s+table\s+public\.${table}\s+to\s+service_role`, 'i'),
      `public.${table} must grant service_role read-only access`,
    );
  }
});

test('every new table is permanently append-only: no UPDATE or DELETE survives for any role', () => {
  const migration = migrationSql();
  for (const table of TABLES) {
    const trigger = triggerBlockOn(migration, table);
    const fnNameMatch = trigger.match(/execute\s+function\s+public\.(\S+)\s*\(/i);
    assert.ok(fnNameMatch, `the append-only trigger on public.${table} must name its enforcement function`);
    const fn = functionBlock(migration, fnNameMatch[1]);
    assert.match(fn, /raise\s+exception/i, `public.${fnNameMatch[1]} must unconditionally reject the mutation`);
  }
});

test('psi_agt002_workflow_instances: opportunity/tender/workflow_type/scope identity, and scope<->snapshot coherence', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, INSTANCE_TABLE);
  assert.match(block, /opportunity_id\s+uuid\s+not\s+null\s+references\s+public\.psi_sales_opportunities/i);
  assert.match(block, /tender_id\s+uuid\s+not\s+null\s+references\s+public\.psi_public_tenders/i);

  const typeMatch = block.match(/workflow_type\s+text\s+not\s+null[^,]*check\s*\(\s*workflow_type\s+in\s*\(([^)]+)\)\s*\)/is);
  assert.ok(typeMatch, 'workflow_type must be a closed check constraint');
  assert.deepEqual(typeMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort(), ['INITIAL', 'REANALYSIS']);

  const scopeMatch = block.match(/scope\s+text\s+not\s+null[^,]*check\s*\(\s*scope\s+in\s*\(([^)]+)\)\s*\)/is);
  assert.ok(scopeMatch, 'scope must be a closed check constraint');
  assert.deepEqual(
    scopeMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort(),
    ['A', 'A_PLUS_B'],
    'scope must be exactly A or A_PLUS_B, no more, no fewer',
  );

  assert.match(block, /profile_snapshot_id\s+uuid/i, 'the immutable profile snapshot id column must exist');
  assert.match(block, /profile_snapshot_hash\s+text/i, 'the immutable profile snapshot hash column must exist');
  assert.match(
    block, /profile_snapshot_hash[\s\S]{0,120}\^\[0-9a-f\]\{64\}\$/i,
    'profile_snapshot_hash must be validated as a SHA-256 hex digest when present',
  );
  assert.match(
    block, /scope\s*=\s*'A_PLUS_B'[\s\S]{0,200}profile_snapshot_id\s+is\s+not\s+null[\s\S]{0,200}profile_snapshot_hash\s+is\s+not\s+null/is,
    'A_PLUS_B must require both profile_snapshot_id and profile_snapshot_hash to be present',
  );
  assert.match(
    block, /scope\s*=\s*'A'[\s\S]{0,200}profile_snapshot_id\s+is\s+null[\s\S]{0,200}profile_snapshot_hash\s+is\s+null/is,
    'scope A must forbid both profile_snapshot_id and profile_snapshot_hash',
  );

  assert.match(
    block, /idempotency_key\s+text\s+not\s+null[^,]*check\s*\([^)]*nullif\s*\(\s*btrim\s*\(\s*idempotency_key\s*\)/is,
    'the instance must carry a non-blank idempotency_key',
  );
  assert.match(block, /created_by\s+uuid\s+not\s+null\s+references\s+public\.psi_sales_profiles/i);
});

test('psi_agt002_workflow_events: every transition carries actor/authority/target/env/scope/preconditions/evidence/expiry/rollback', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, EVENT_TABLE);
  assert.match(block, new RegExp(String.raw`workflow_instance_id\s+uuid\s+not\s+null\s+references\s+public\.${INSTANCE_TABLE}`, 'i'));

  assert.match(block, /from_state\s+text\b/i, 'from_state must be recorded (null only for the creation event)');
  assert.match(block, /to_state\s+text\s+not\s+null/i, 'to_state is mandatory on every event');

  assert.match(block, /actor_profile_id\s+uuid\s+references\s+public\.psi_sales_profiles/i, 'actor');
  assert.match(block, /actor_kind\s+text\s+not\s+null[^,]*check\s*\([^)]*actor_kind\s+in\s*\(([^)]*)\)/is, 'actor_kind must be a closed check constraint');
  assert.match(
    block, /authority\s+text\s+not\s+null[^,]*check\s*\([^)]*authority\s+in\s*\([^)]*'G1'[^)]*\)/is,
    'authority',
  );
  assert.match(block, /target\s+text\s+not\s+null/i, 'target');
  assert.match(block, /env\s+text\s+not\s+null[^,]*check\s*\([^)]*env\s+in\s*\([^)]*\)/is, 'env must be a closed check constraint');

  const eventScopeMatch = block.match(/scope\s+text\s+not\s+null[^,]*check\s*\(\s*scope\s+in\s*\(([^)]+)\)\s*\)/is);
  assert.ok(eventScopeMatch, 'scope must be recorded on every event, closed to A/A_PLUS_B');
  assert.deepEqual(eventScopeMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort(), ['A', 'A_PLUS_B']);

  assert.match(block, /preconditions\s+jsonb\s+not\s+null[^,]*check\s*\([^)]*jsonb_typeof\s*\(\s*preconditions\s*\)\s*=\s*'object'/is, 'preconditions');
  assert.match(block, /evidence\s+jsonb\s+not\s+null[^,]*check\s*\([^)]*jsonb_typeof\s*\(\s*evidence\s*\)\s*=\s*'object'/is, 'evidence');
  assert.match(block, /expires_at\s+timestamptz/i, 'expiry');
  assert.match(
    block, /rollback_of_event_id\s+uuid\s+references\s+public\.psi_agt002_workflow_events/i,
    'rollback must be representable as a self-referencing pointer to the event it rolls back',
  );

  assert.match(
    block, /to_state\s*=\s*'AUTHORIZED'[\s\S]{0,200}expires_at\s+is\s+not\s+null/is,
    'an AUTHORIZED transition must require a non-null expires_at',
  );

  assert.match(
    block, /idempotency_key\s+text\s+not\s+null[^,]*check\s*\([^)]*nullif\s*\(\s*btrim\s*\(\s*idempotency_key\s*\)/is,
    'every event must carry a non-blank idempotency_key',
  );
});

test('psi_agt002_analysis_authorizations: G1 authorizes only INITIAL, exactly one per workflow instance, bound to a real frozen package version', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, AUTHORIZATION_TABLE);
  assert.match(
    block, new RegExp(String.raw`workflow_instance_id\s+uuid\s+not\s+null\s+(unique\s+)?references\s+public\.${INSTANCE_TABLE}`, 'i'),
  );
  assert.match(
    block, /unique\s*\(\s*workflow_instance_id\s*\)|workflow_instance_id\s+uuid\s+not\s+null\s+unique/i,
    'exactly one authorization row per workflow instance',
  );

  const typeMatch = block.match(/workflow_type\s+text\s+not\s+null[^,]*check\s*\(\s*workflow_type\s*=\s*'([^']+)'\s*\)/is);
  assert.ok(typeMatch, 'workflow_type must be CHECK-pinned to a single literal');
  assert.equal(typeMatch[1], 'INITIAL', 'psi_agt002_analysis_authorizations.workflow_type must be pinned to INITIAL: G1 authorizes only INITIAL, never REANALYSIS');

  const scopeMatch = block.match(/scope\s+text\s+not\s+null[^,]*check\s*\(\s*scope\s+in\s*\(([^)]+)\)\s*\)/is);
  assert.ok(scopeMatch);
  assert.deepEqual(scopeMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort(), ['A', 'A_PLUS_B']);

  assert.match(
    block, new RegExp(String.raw`package_version_id\s+uuid\s+not\s+null\s+references\s+public\.psi_agt002_evidence_package_versions`, 'i'),
    'the authorization must bind to a real, existing frozen evidence package version from 099',
  );
  assert.match(block, /package_hash\s+text\s+not\s+null[^,]*check\s*\([^)]*package_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\)/is);

  assert.match(block, /granted_by\s+uuid\s+not\s+null\s+references\s+public\.psi_sales_profiles/i);
  assert.match(
    block, /expires_at\s+timestamptz\s+not\s+null[^,]*check\s*\([^)]*expires_at\s*>\s*granted_at\)/is,
    'expires_at must be strictly after granted_at',
  );
  assert.match(
    block, /idempotency_key\s+text\s+not\s+null[^,]*check\s*\([^)]*nullif\s*\(\s*btrim\s*\(\s*idempotency_key\s*\)/is,
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

test('psi_append_agt002_workflow_event enforces the exact legal initial-analysis state transition matrix', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, APPEND_EVENT_FN);
  for (const [from, to] of LEGAL_TRANSITIONS) {
    assert.match(
      block, new RegExp(`${from}[\\s\\S]{0,120}${to}`, 'i'),
      `the legal transition ${from} -> ${to} must appear in the transition matrix encoded in ${APPEND_EVENT_FN}`,
    );
  }
  assert.match(block, /raise\s+exception/i, 'an illegal transition must fail closed');
});

test('psi_grant_agt002_g1_analysis_authorization re-asserts G1 authorizes only INITIAL and fails closed on a REANALYSIS workflow instance', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, GRANT_FN);
  assert.match(block, /'INITIAL'/i, 'the grant RPC must check the workflow instance is INITIAL');
  assert.match(block, /workflow_type/i);
  assert.match(block, /raise\s+exception/i, 'granting against a REANALYSIS workflow instance must fail closed');
  assert.match(
    block, new RegExp(String.raw`from\s+public\.psi_agt002_evidence_package_versions`, 'i'),
    'the grant RPC must re-verify the package_version/package_hash pair against the live frozen version from 099',
  );
});

test('psi_consume_agt002_analysis_authorization: the atomic consume-on-create boundary contract P0-04 job creation will call', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, CONSUME_FN);

  assert.doesNotMatch(block, new RegExp(REANALYSIS_TABLE_NAME, 'i'), 'the consume RPC must never touch any job table: job creation is out of scope for P0-03');
  for (const rpc of REANALYSIS_RPC_NAMES) {
    assert.doesNotMatch(block, new RegExp(rpc, 'i'), `the consume RPC must never call ${rpc}`);
  }
  assert.doesNotMatch(block, /insert\s+into\s+public\.[a-z0-9_]*job/i, 'the consume RPC must never insert into any job table');

  assert.match(
    block, /pg_advisory_xact_lock/i,
    'consumption must be serialized with a transaction-scoped advisory lock so the check-then-mark boundary is atomic',
  );
  assert.doesNotMatch(
    block, /exception\s+when\s+others\s+then/i,
    'the consume RPC must never catch-and-continue past a validation failure: the whole transaction must roll back',
  );

  assert.match(block, /workflow_instance_id[\s\S]{0,400}is\s+distinct\s+from|is\s+distinct\s+from[\s\S]{0,400}workflow_instance_id/is, 'must verify exact workflow_instance_id binding');
  assert.match(block, /opportunity_id[\s\S]{0,400}is\s+distinct\s+from|is\s+distinct\s+from[\s\S]{0,400}opportunity_id/is, 'must verify exact opportunity_id binding');
  assert.match(block, /tender_id[\s\S]{0,400}is\s+distinct\s+from|is\s+distinct\s+from[\s\S]{0,400}tender_id/is, 'must verify exact tender_id binding');
  assert.match(block, /package_version_id[\s\S]{0,400}is\s+distinct\s+from|is\s+distinct\s+from[\s\S]{0,400}package_version_id/is, 'must verify exact package_version_id binding');
  assert.match(block, /package_hash[\s\S]{0,400}is\s+distinct\s+from|is\s+distinct\s+from[\s\S]{0,400}package_hash/is, 'must verify exact package_hash binding');

  assert.match(block, /'AUTHORIZED'/i, 'consumption requires the workflow to currently be AUTHORIZED: active, unrevoked, unconsumed');
  assert.match(block, /expires_at/i, 'consumption must re-check the authorization has not expired');
  assert.match(block, /raise\s+exception/i, 'any mismatch, double consumption, or expiry must fail closed');
});

test('no new RPC accepts a raw prompt, extracted text, storage path, or credential as a parameter', () => {
  const migration = migrationSql();
  for (const [fn] of NEW_RPCS) {
    const block = functionBlock(migration, fn);
    const signature = block.slice(0, block.indexOf(')') + 1);
    assert.doesNotMatch(
      signature, /p_(prompt|raw[a-z_]*|extracted_text|storage_path|source_url|signed_url|credential|api_key|secret)\b/i,
      `public.${fn} must never accept a raw prompt/extracted-text/storage-path/credential parameter`,
    );
  }
});

test('idempotent replay support: each creating RPC looks up an existing row by idempotency_key before inserting, and fails closed on a payload mismatch', () => {
  const migration = migrationSql();
  for (const fn of [CREATE_INSTANCE_FN, GRANT_FN]) {
    const block = functionBlock(migration, fn);
    assert.match(block, /idempotency_key/i, `${fn} must key its idempotent replay path on idempotency_key`);
    assert.match(block, /is\s+distinct\s+from/i, `${fn} must detect a payload mismatch under a replayed idempotency_key`);
    assert.match(block, /raise\s+exception/i, `${fn} must fail closed on a conflicting replay`);
  }
});

test('the rollback exists, is one transaction, and fails closed while any workflow/authorization history exists', () => {
  const rollback = rollbackSql();
  assert.match(rollback, /^\s*begin;/im, 'the rollback must run inside one transaction');
  assert.match(rollback, /^\s*commit;/im, 'the rollback must commit its single transaction');
  assert.match(rollback, /raise\s+exception/i, 'the rollback must fail closed while history still exists');

  for (const table of TABLES) {
    assert.match(
      rollback, new RegExp(String.raw`select\s+1\s+from\s+public\.${table}|exists\s*\(\s*select[^)]*public\.${table}`, 'is'),
      `the rollback guard must check for existing rows in public.${table} before dropping anything`,
    );
  }

  for (const [fn, args] of NEW_RPCS) {
    assert.match(
      rollback, new RegExp(String.raw`drop\s+function\s+if\s+exists\s+public\.${fn}\s*${args}\s*;`, 'i'),
      `the rollback must drop public.${fn} by its exact signature`,
    );
  }
  for (const table of TABLES) {
    assert.match(
      rollback, new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${table}\b`, 'i'),
      `the rollback must remove public.${table}`,
    );
  }

  // Dependency order: events and authorizations both reference instances (and authorizations
  // additionally references the preexisting evidence_package_versions, which must never be
  // dropped by this rollback).
  const instancesDropIdx = rollback.search(new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${INSTANCE_TABLE}\b`, 'i'));
  for (const dependent of [EVENT_TABLE, AUTHORIZATION_TABLE]) {
    const dependentDropIdx = rollback.search(new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${dependent}\b`, 'i'));
    assert.ok(dependentDropIdx !== -1 && dependentDropIdx < instancesDropIdx, `the rollback must drop public.${dependent} before public.${INSTANCE_TABLE}`);
  }

  for (const fn of PREEXISTING_TO_PRESERVE) {
    assert.doesNotMatch(
      rollback, new RegExp(String.raw`drop\s+function\s+(if\s+exists\s+)?public\.${fn}\b`, 'i'),
      `the rollback must never remove the preexisting public.${fn}`,
    );
  }
  for (const table of PREEXISTING_TABLES_TO_PRESERVE) {
    assert.doesNotMatch(
      rollback, new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${table}\b`, 'i'),
      `the rollback must never drop the preexisting public.${table}`,
    );
  }
});

console.log('AGT-002 initial workflow and G1 migration 100 static structural contract passed');
