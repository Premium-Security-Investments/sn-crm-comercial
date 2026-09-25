import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  AGT002_F0B_SCHEMA_VERSION,
  AGT002_F0B_APPLY,
  parseChatQueryExecuteGrantees,
  applyRevokeStatements,
  classifySecurityDefiner,
  AGT002_F0B_INCIDENT_LANGUAGE,
  AGT002_F0B_ALLOWLIST,
} from '../agt002-f0b-chat-query.js';

const MODULE_SPECIFIER = '../agt002-f0b-chat-query.js';

const MIGRATION_SQL = readFileSync(
  new URL('../supabase/migrations/092_agt002_f0b_chat_query_revoke.sql', import.meta.url),
  'utf8',
);
const INVENTORY = JSON.parse(
  readFileSync(
    new URL('../docs/evidence/2026-09-25-agt002-f0b-security-definer-inventory.json', import.meta.url),
    'utf8',
  ),
);
const DICTAMEN_MD = readFileSync(
  new URL('../docs/evidence/2026-09-25-agt002-f0b-chat-query-dictamen.md', import.meta.url),
  'utf8',
);

const INCIDENT_SENTENCE = 'sin evidencia de explotación y sin capacidad suficiente para descartarla retrospectivamente';

function extractStatements(sql) {
  return sql
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

test('AGT002_F0B_APPLY is false (cero apply) and AGT002_F0B_SCHEMA_VERSION is 1', () => {
  assert.equal(AGT002_F0B_APPLY, false);
  assert.equal(AGT002_F0B_SCHEMA_VERSION, 1);
});

test('migration revokes EXECUTE/ALL on chat_query(text) from PUBLIC, anon and authenticated, and grants none of them access', () => {
  const chatQueryRevokeStatements = extractStatements(MIGRATION_SQL).filter(
    statement =>
      /revoke\s+(execute|all)\s+on\s+function\s+public\.chat_query\s*\(\s*text\s*\)/i.test(statement) &&
      /\bfrom\b/i.test(statement),
  );
  assert.ok(chatQueryRevokeStatements.length > 0, 'expected at least one REVOKE statement targeting public.chat_query(text)');

  const combinedRevokeText = chatQueryRevokeStatements.join(' | ');
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      combinedRevokeText,
      new RegExp(`\\b${role}\\b`, 'i'),
      `expected REVOKE on chat_query(text) to include role ${role}`,
    );
  }

  const chatQueryGrantStatements = extractStatements(MIGRATION_SQL).filter(statement =>
    /grant\s+(execute|all)\s+on\s+function\s+public\.chat_query\s*\(\s*text\s*\)/i.test(statement),
  );
  for (const statement of chatQueryGrantStatements) {
    const toIndex = statement.search(/\bto\b/i);
    const toClause = toIndex >= 0 ? statement.slice(toIndex) : statement;
    for (const role of ['public', 'anon', 'authenticated']) {
      assert.doesNotMatch(
        toClause,
        new RegExp(`\\b${role}\\b`, 'i'),
        `migration must not grant EXECUTE on chat_query(text) to ${role}`,
      );
    }
  }
});

test('migration replaces chat_query(p_sql text) retiring dynamic SQL via RAISE EXCEPTION', () => {
  assert.match(
    MIGRATION_SQL,
    /create\s+or\s+replace\s+function\s+public\.chat_query\s*\(\s*p_sql\s+text/i,
    'expected CREATE OR REPLACE FUNCTION public.chat_query(p_sql text ...)',
  );
  assert.doesNotMatch(
    MIGRATION_SQL,
    /execute\s+format\s*\(/i,
    'migration must not retain EXECUTE format(...) of user-provided SQL',
  );
  assert.match(MIGRATION_SQL, /raise\s+exception/i, 'expected the retired body to RAISE EXCEPTION');
});

test('negative grant-matrix fixture: applyRevokeStatements strips PUBLIC, anon and authenticated', () => {
  const routineGrants = ['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role'].map(grantee => ({
    grantee,
    routine_name: 'chat_query',
    privilege_type: 'EXECUTE',
  }));

  const grantees = parseChatQueryExecuteGrantees(routineGrants);
  const granteeList = Array.from(grantees);
  assert.deepEqual(
    [...granteeList].sort(),
    ['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role'].sort(),
  );

  const remaining = Array.from(applyRevokeStatements(grantees, MIGRATION_SQL));
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    assert.ok(!remaining.includes(role), `expected ${role} to be revoked from the grant matrix`);
  }
});

test('PGlite: migration 092 revokes chat_query execution for anon and authenticated', async () => {
  const db = new PGlite();
  let rolesAvailable = true;
  try {
    await db.exec('create role anon; create role authenticated;');
  } catch (err) {
    rolesAvailable = false;
    assert.ok(true, `role creation unsupported in this PGlite build: ${err.message}`);
  }

  if (!rolesAvailable) {
    await db.close();
    return;
  }

  await db.exec(`
    create or replace function public.chat_query(p_sql text)
    returns json
    language plpgsql
    security definer
    as $fn$
    declare
      v_result json;
    begin
      execute format('select json_agg(t) from (%s) t', p_sql) into v_result;
      return v_result;
    end;
    $fn$;
    grant execute on function public.chat_query(text) to public, anon, authenticated;
  `);

  await db.exec('set role anon');
  const before = await db.query("select public.chat_query('select 1 as x') as result");
  assert.ok(before.rows[0].result, 'expected chat_query to succeed for anon before the migration is applied');
  await db.exec('reset role');

  await db.exec(MIGRATION_SQL);

  await db.exec('set role anon');
  await assert.rejects(
    () => db.query("select public.chat_query('select 1 as x') as result"),
    /permission denied|raise|exception/i,
  );
  await db.exec('reset role');

  await db.exec('set role authenticated');
  await assert.rejects(
    () => db.query("select public.chat_query('select 1 as x') as result"),
    /permission denied|raise|exception/i,
  );
  await db.exec('reset role');

  await db.close();
});

test('security-definer inventory: reconciliation claims, routine coverage and dictamen completeness', () => {
  assert.equal(INVENTORY.claims.agt002_control_plane_reconciled, false);
  assert.equal(INVENTORY.claims.applied, false);
  assert.equal(INVENTORY.routines.length, 108);

  const routineName = routine => routine.proname ?? routine.routine_name;

  for (const routine of INVENTORY.routines) {
    assert.ok(routine.dictamen, `routine ${routineName(routine)} is missing a dictamen`);
    assert.equal(typeof routine.dictamen.status, 'string');
    assert.ok(routine.dictamen.status.length > 0, `routine ${routineName(routine)} has an empty dictamen.status`);
    assert.equal(typeof routine.dictamen.rationale, 'string');
    assert.ok(routine.dictamen.rationale.length > 0, `routine ${routineName(routine)} has an empty dictamen.rationale`);
    assert.notEqual(routine.dictamen.status, 'pending', `routine ${routineName(routine)} left in pending status`);
  }

  const byName = name => INVENTORY.routines.find(routine => routineName(routine) === name);

  const chatQuery = byName('chat_query');
  assert.ok(chatQuery, 'expected a chat_query routine entry');
  assert.equal(chatQuery.dictamen.status, 'f0b_revoke_unapplied');
  assert.equal(chatQuery.has_dynamic_sql, true);

  for (const name of ['psi_assert_tender_dossier_actor', 'psi_assert_tender_dossier_go']) {
    const routine = byName(name);
    assert.ok(routine, `expected a ${name} routine entry`);
    assert.equal(routine.dictamen.status, 'residual_public_anon_auth_predicate_f0e');
  }

  const execSql = byName('exec_sql');
  assert.ok(execSql, 'expected an exec_sql routine entry');
  assert.equal(execSql.dictamen.status, 'restricted_service_role_dynamic_sql_not_f0b');
});

test('dictamen markdown states the exact non-exploitability disclaimer sentence', () => {
  assert.ok(
    DICTAMEN_MD.includes(INCIDENT_SENTENCE),
    'expected the dictamen markdown to contain the exact Spanish disclaimer sentence',
  );
});

test('classifySecurityDefiner distinguishes chat_query dynamic SQL from restricted service-role routines', () => {
  assert.equal(
    classifySecurityDefiner({
      proname: 'chat_query',
      prosecdef: true,
      acl: '{=X/postgres,anon=X/postgres,authenticated=X/postgres}',
    }),
    'f0b_revoke_dynamic_sql',
  );

  assert.equal(
    classifySecurityDefiner({
      proname: 'exec_sql',
      prosecdef: true,
      acl: '{postgres=X/postgres,service_role=X/postgres}',
    }),
    'restricted_service_role_dynamic_sql_not_f0b',
  );
});

test('AGT002_F0B_ALLOWLIST is frozen and empty, and the module exposes no arbitrary-SQL runner', async () => {
  assert.ok(Object.isFrozen(AGT002_F0B_ALLOWLIST), 'AGT002_F0B_ALLOWLIST must be frozen');
  assert.deepEqual(Object.keys(AGT002_F0B_ALLOWLIST), [], 'AGT002_F0B_ALLOWLIST must be empty (no named queries)');

  const moduleExports = await import(MODULE_SPECIFIER);
  const forbiddenExportNamePattern = /^(run|execute)(user|arbitrary)?(sql|query)$/i;
  for (const [name, value] of Object.entries(moduleExports)) {
    if (typeof value === 'function') {
      assert.doesNotMatch(
        name,
        forbiddenExportNamePattern,
        `module must not export an arbitrary SQL runner named ${name}`,
      );
    }
  }
});

test('AGT002_F0B_INCIDENT_LANGUAGE equals the exact Spanish disclaimer sentence', () => {
  assert.equal(AGT002_F0B_INCIDENT_LANGUAGE, INCIDENT_SENTENCE);
});
