// AGT-002 migration 077 — raise ONLY the backend service_role statement budget to a bounded 30s.
//
// Two layers, both deterministic and offline: a static contract over the SQL text (nothing but two
// GUCs on one role may ever appear in these files) and a structural PGlite lifecycle that applies,
// re-applies, rolls back, re-rolls-back and re-applies the migration against a real PostgreSQL and
// asserts the observable pg_db_role_setting state at every step.
//
// The two regressions this file exists to make impossible:
//   1. Raising lock_timeout along with statement_timeout. A 30s statement budget is only safe
//      because a lock wait still dies at 8s with 55P03 instead of hanging for 30s.
//   2. Turning a role-settings migration into a grant/privilege migration. 077 must never grant,
//      revoke, or touch a role attribute, a schema object or a row.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/077_agt002_canonical_persistence_statement_timeout.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/077_agt002_canonical_persistence_statement_timeout_rollback.sql', import.meta.url), 'utf8');

// The budget 077 is allowed to grant, and the lock budget it must never widen. Changing either
// value is a deliberate act that has to change this line too.
const STATEMENT_TIMEOUT_AFTER_APPLY = '30s';
const STATEMENT_TIMEOUT_AFTER_ROLLBACK = '8s';
const LOCK_TIMEOUT = '8s';
const MAX_ALLOWED_STATEMENT_TIMEOUT_SECONDS = 30;
const MANAGED_SETTINGS = ['statement_timeout', 'lock_timeout'];

// Only `--` line comments are used in these files, and no string literal contains `--`, so this is
// an exact split between prose and executable SQL. Every static scan below runs on the executable
// half, so the header's plain-English mention of "insert", "grant" or "index" cannot mask a real one.
const executable = (sql) => sql.replace(/--[^\n]*/g, '');
const migrationCode = executable(migration);
const rollbackCode = executable(rollback);

const FILES = [['migration 077', migration, migrationCode], ['rollback 077', rollback, rollbackCode]];

for (const [label, sql, code] of FILES) {
  assert.match(sql, /^--/, `${label}: must open with the explanatory header comment`);
  assert.match(sql, /\nbegin;\n/, `${label}: must be wrapped in a single top-level transaction`);
  assert.match(sql, /commit;\s*$/i, `${label}: must end with commit;`);

  // --- Nothing but role settings. No grants, no privileges, no schema, no rows. ---
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b/i, `${label}: must never grant or revoke anything`);
  assert.doesNotMatch(code, /\b(create|drop)\s+(table|function|index|trigger|policy|role|type|view|schema|extension)\b/i,
    `${label}: must never create or drop a schema object`);
  assert.doesNotMatch(code, /\balter\s+(table|function|index|policy|database|schema|system|default)\b/i,
    `${label}: must never alter anything other than the service_role settings`);
  assert.doesNotMatch(code, /\binsert\s+into\b|\bdelete\s+from\b|\btruncate\b|\bupdate\s+\w+\s+set\b/i,
    `${label}: must never touch a row`);
  assert.doesNotMatch(code, /\bpsi_[a-z0-9_]+/i,
    `${label}: must not reference any application object — the canonical RPC, its gates and its grants stay untouched`);
  assert.doesNotMatch(code, /\b(anon|authenticated|authenticator|postgres|public)\b/i,
    `${label}: must not touch any role other than service_role — human-facing roles keep their own budget`);

  // --- ALTER ROLE targets exactly one role, sets exactly the two managed GUCs, and never a role attribute. ---
  const targets = [...code.matchAll(/\balter\s+role\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
  assert.ok(targets.length > 0, `${label}: must contain at least one alter role statement`);
  assert.deepEqual([...new Set(targets)], ['service_role'], `${label}: every alter role must target service_role only`);

  const settings = [...code.matchAll(/\balter\s+role\s+service_role\s+set\s+([a-z_]+)\s*=\s*'([^']*)'\s*;/gi)]
    .map((m) => [m[1].toLowerCase(), m[2]]);
  assert.equal(settings.length, targets.length,
    `${label}: every alter role statement must be a plain \`set <guc> = '<literal>'\` — no RESET, no WITH, no attribute form`);
  assert.deepEqual([...new Set(settings.map(([name]) => name))].sort(), [...MANAGED_SETTINGS].sort(),
    `${label}: may set statement_timeout and lock_timeout, and nothing else`);
  assert.doesNotMatch(code, /\b(superuser|nosuperuser|createrole|createdb|bypassrls|replication|nologin|login|password|inherit|valid\s+until|connection\s+limit)\b/i,
    `${label}: must never change a role attribute`);

  // --- lock_timeout is pinned, never widened, in every occurrence. ---
  const lockValues = settings.filter(([name]) => name === 'lock_timeout').map(([, value]) => value);
  assert.ok(lockValues.length > 0, `${label}: must pin lock_timeout explicitly rather than leave it inherited`);
  for (const value of lockValues) {
    assert.equal(value, LOCK_TIMEOUT, `${label}: lock_timeout must stay at ${LOCK_TIMEOUT} — a wider statement budget must never become a wider lock budget`);
  }

  // --- statement_timeout is bounded. ---
  const statementValues = settings.filter(([name]) => name === 'statement_timeout').map(([, value]) => value);
  assert.ok(statementValues.length > 0, `${label}: must set statement_timeout explicitly`);
  for (const value of statementValues) {
    const seconds = /^(\d+)s$/.exec(value);
    assert.ok(seconds, `${label}: statement_timeout must be written as a whole number of seconds, got ${value}`);
    assert.ok(Number(seconds[1]) <= MAX_ALLOWED_STATEMENT_TIMEOUT_SECONDS,
      `${label}: statement_timeout must stay bounded at ${MAX_ALLOWED_STATEMENT_TIMEOUT_SECONDS}s or less, got ${value}`);
  }

  // --- Fail-closed self-verification and the PostgREST config reload. ---
  assert.match(code, /pg_db_role_setting/, `${label}: must verify the resulting role settings in-transaction`);
  assert.match(code, /setdatabase\s*<>\s*0/, `${label}: must refuse to run while a per-database statement_timeout/lock_timeout override could defeat it`);
  assert.match(code, /split_part\(entry, '=', 1\) in \('statement_timeout', 'lock_timeout'\)/,
    `${label}: the per-database guard must be scoped to statement_timeout/lock_timeout only — an unrelated service_role per-database GUC must never block it`);
  assert.match(code, /raise\s+exception/i, `${label}: the verification must abort rather than commit a half-applied state`);
  assert.match(code, /notify\s+pgrst\s*,\s*'reload config'/i,
    `${label}: PostgREST caches role settings; without the reload the running instance keeps the old budget`);
}

assert.deepEqual(
  [...migrationCode.matchAll(/statement_timeout\s*=\s*'([^']*)'/gi)].map((m) => m[1]),
  [STATEMENT_TIMEOUT_AFTER_APPLY],
  'migration 077 must set statement_timeout to exactly 30s, once',
);
assert.deepEqual(
  [...rollbackCode.matchAll(/statement_timeout\s*=\s*'([^']*)'/gi)].map((m) => m[1]),
  [STATEMENT_TIMEOUT_AFTER_ROLLBACK],
  'rollback 077 must restore statement_timeout to exactly 8s, once',
);

// --- Structural lifecycle against a real PostgreSQL (PGlite). ---

const OTHER_ROLES = ['anon', 'authenticated', 'authenticator'];
const ATTRIBUTE_COLUMNS = 'rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit';

async function freshDatabase({ withServiceRole = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role authenticator;`);
  if (withServiceRole) {
    // Reproduce the production posture 077 starts from: service_role has NO explicit
    // pg_db_role_setting entry at all. Its effective 8s statement/lock budget is inherited and
    // applied by PostgREST, not a pinned catalog row — 077 is the first migration to pin it.
    await pg.exec(`create role service_role;`);
  }
  return pg;
}

async function clusterSettings(pg, role) {
  const { rows } = await pg.query(`
    select split_part(entry, '=', 1) as name, split_part(entry, '=', 2) as value
    from pg_db_role_setting s
    join pg_roles r on r.oid = s.setrole
    cross join lateral unnest(s.setconfig) entry
    where r.rolname = $1 and s.setdatabase = 0
    order by 1
  `, [role]);
  return rows.map(({ name, value }) => [name, value]);
}

const WATCHED_ROLES_SQL = ['service_role', ...OTHER_ROLES].map((role) => `'${role}'`).join(', ');

async function roleAttributes(pg) {
  const { rows } = await pg.query(
    `select ${ATTRIBUTE_COLUMNS} from pg_roles where rolname in (${WATCHED_ROLES_SQL}) order by rolname`,
  );
  return rows;
}

async function assertNoServiceRoleSettings(pg, label) {
  assert.deepEqual(await clusterSettings(pg, 'service_role'), [],
    `${label}: service_role must have no explicit cluster-wide pg_db_role_setting entries`);
}

async function assertBudget(pg, label, statementTimeout) {
  assert.deepEqual(await clusterSettings(pg, 'service_role'),
    [['lock_timeout', LOCK_TIMEOUT], ['statement_timeout', statementTimeout]],
    `${label}: service_role must hold exactly lock_timeout=${LOCK_TIMEOUT} and statement_timeout=${statementTimeout}`);
  for (const role of OTHER_ROLES) {
    assert.deepEqual(await clusterSettings(pg, role), [],
      `${label}: ${role} must keep its inherited budget — 077 must never widen a human-facing role`);
  }
}

async function expectRejection(pg, sql, pattern, message) {
  await assert.rejects(() => pg.exec(sql), pattern, message);
  await pg.exec('rollback').catch(() => {});
}

{
  const pg = await freshDatabase();
  const attributesBefore = await roleAttributes(pg);
  await assertNoServiceRoleSettings(pg, 'before 077');

  await pg.exec(migration);
  await assertBudget(pg, 'after 077 apply', STATEMENT_TIMEOUT_AFTER_APPLY);

  await pg.exec(migration);
  await assertBudget(pg, 'after 077 apply/apply (idempotent)', STATEMENT_TIMEOUT_AFTER_APPLY);

  await pg.exec(rollback);
  await assertBudget(pg, 'after 077 rollback', STATEMENT_TIMEOUT_AFTER_ROLLBACK);

  await pg.exec(rollback);
  await assertBudget(pg, 'after 077 rollback/rollback (idempotent)', STATEMENT_TIMEOUT_AFTER_ROLLBACK);

  await pg.exec(migration);
  await assertBudget(pg, 'after 077 reapply', STATEMENT_TIMEOUT_AFTER_APPLY);

  assert.deepEqual(await roleAttributes(pg), attributesBefore,
    'no role attribute (superuser, bypassrls, createrole, login, connection limit, ...) may change across the whole 077 lifecycle');
}

// Fail-closed: a per-database statement_timeout/lock_timeout override would silently win over the
// cluster-wide setting, so 077 must refuse to report success, and must leave the cluster-wide
// budget exactly as it found it — which, matching production, is no explicit entry at all.
{
  const pg = await freshDatabase();
  await pg.exec(`do $$ begin execute format('alter role service_role in database %I set statement_timeout = %L', current_database(), '2s'); end $$;`);

  await expectRejection(pg, migration, /base de datos/i,
    '077 must refuse to apply while a per-database statement_timeout/lock_timeout override for service_role exists');
  await assertNoServiceRoleSettings(pg, 'after 077 refused (per-database override) — the transaction must roll back, leaving no cluster-wide entry');

  await expectRejection(pg, rollback, /base de datos/i,
    'the 077 rollback must refuse for the same reason rather than report a reversion it cannot guarantee');
  await assertNoServiceRoleSettings(pg, 'after 077 rollback refused (per-database override)');
}

// Fail-closed guard is narrow: an unrelated per-database GUC on service_role (not
// statement_timeout/lock_timeout) must never block 077 or its rollback.
{
  const pg = await freshDatabase();
  await pg.exec(`do $$ begin execute format('alter role service_role in database %I set work_mem = %L', current_database(), '16MB'); end $$;`);

  await pg.exec(migration);
  await assertBudget(pg, 'after 077 apply with unrelated per-database GUC on service_role', STATEMENT_TIMEOUT_AFTER_APPLY);

  await pg.exec(rollback);
  await assertBudget(pg, 'after 077 rollback with unrelated per-database GUC on service_role', STATEMENT_TIMEOUT_AFTER_ROLLBACK);
}

// Fail-closed: no service_role means no backend role to widen; 077 must abort, not create one.
{
  const pg = await freshDatabase({ withServiceRole: false });
  await expectRejection(pg, migration, /service_role/i, '077 must abort when service_role does not exist');
  const { rows } = await pg.query(`select count(*)::int n from pg_roles where rolname = 'service_role'`);
  assert.equal(rows[0].n, 0, '077 must never create the role it expects to already exist');
}

console.log('AGT-002 canonical persistence statement-timeout migration 077 static/PGlite contract passed');
