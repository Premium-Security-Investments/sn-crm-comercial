import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION_092_SQL = readFileSync(
  new URL('../supabase/migrations/092_agt002_f0b_chat_query_revoke.sql', import.meta.url),
  'utf8',
);
const MIGRATION_094_SQL = readFileSync(
  new URL('../supabase/migrations/094_agt002_f0b2_rpc_hardening.sql', import.meta.url),
  'utf8',
);

const GRANTS_STATIC_SCRIPT_PATH = fileURLToPath(
  new URL('../scripts/agt002-check-grants-static.mjs', import.meta.url),
);
const GRANTS_STATIC_MODULE_SPECIFIER = '../scripts/agt002-check-grants-static.mjs';

const PSI_ADMIN_FUNCTIONS = [
  'psi_admin_acquire_profile_lock',
  'psi_admin_release_profile_lock',
  'psi_admin_bind_profile_auth',
  'psi_admin_persist_profile_access',
];

function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map(line => {
      const commentIndex = line.indexOf('--');
      return commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    })
    .join('\n');
}

test('uncommented 092 revokes execute/all on public.chat_query from PUBLIC, anon and authenticated', () => {
  const uncommented = stripSqlComments(MIGRATION_092_SQL);
  assert.match(
    uncommented,
    /revoke\s+(execute|all)\s+on\s+function\s+public\.chat_query/i,
    'expected an uncommented REVOKE EXECUTE/ALL on public.chat_query',
  );
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      uncommented,
      new RegExp(`\\b${role}\\b`, 'i'),
      `expected uncommented 092 to mention role ${role}`,
    );
  }
});

test('uncommented 094 revokes the four psi_admin_* functions from anon and never grants them to anon or authenticated', () => {
  const uncommented = stripSqlComments(MIGRATION_094_SQL);
  const statements = uncommented
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);

  for (const fnName of PSI_ADMIN_FUNCTIONS) {
    const revokeFromAnon = statements.some(
      statement =>
        new RegExp(`revoke\\s+(execute|all)\\s+on\\s+function\\s+public\\.${fnName}\\s*\\(`, 'i').test(statement) &&
        /\bfrom\b/i.test(statement) &&
        /\banon\b/i.test(statement.slice(statement.search(/\bfrom\b/i))),
    );
    assert.ok(revokeFromAnon, `expected uncommented 094 to revoke EXECUTE/ALL on ${fnName} from anon`);

    const grantStatements = statements.filter(statement =>
      new RegExp(`grant\\s+(execute|all)\\s+on\\s+function\\s+public\\.${fnName}\\s*\\(`, 'i').test(statement),
    );
    for (const statement of grantStatements) {
      const toIndex = statement.search(/\bto\b/i);
      const toClause = toIndex >= 0 ? statement.slice(toIndex) : statement;
      for (const role of ['anon', 'authenticated']) {
        assert.doesNotMatch(
          toClause,
          new RegExp(`\\b${role}\\b`, 'i'),
          `uncommented 094 must not grant ${fnName} to ${role}`,
        );
      }
    }
  }
});

test('scripts/agt002-check-grants-static.mjs exists', () => {
  assert.ok(
    existsSync(GRANTS_STATIC_SCRIPT_PATH),
    `expected ${GRANTS_STATIC_SCRIPT_PATH} to exist`,
  );
});

test('checkAgt002GrantsStatic returns ok:true with no errors for current 092/094', async () => {
  const grantsStaticModule = await import(GRANTS_STATIC_MODULE_SPECIFIER);
  const { checkAgt002GrantsStatic } = grantsStaticModule;
  assert.equal(typeof checkAgt002GrantsStatic, 'function');

  const result = await checkAgt002GrantsStatic();
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('checkAgt002GrantsStaticFromSql returns ok:true for the current 092/094 SQL', async () => {
  const { checkAgt002GrantsStaticFromSql } = await import(GRANTS_STATIC_MODULE_SPECIFIER);
  assert.equal(typeof checkAgt002GrantsStaticFromSql, 'function');

  const result = checkAgt002GrantsStaticFromSql({ sql092: MIGRATION_092_SQL, sql094: MIGRATION_094_SQL });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('checkAgt002GrantsStaticFromSql returns ok:false when 092 revokes chat_query then re-grants EXECUTE to anon', async () => {
  const { checkAgt002GrantsStaticFromSql } = await import(GRANTS_STATIC_MODULE_SPECIFIER);

  const regressedSql092 = `
    revoke execute on function public.chat_query(p_sql text) from public;
    revoke execute on function public.chat_query(p_sql text) from anon;
    revoke execute on function public.chat_query(p_sql text) from authenticated;
    grant execute on function public.chat_query(p_sql text) to anon;
  `;

  const result = checkAgt002GrantsStaticFromSql({ sql092: regressedSql092, sql094: MIGRATION_094_SQL });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});
