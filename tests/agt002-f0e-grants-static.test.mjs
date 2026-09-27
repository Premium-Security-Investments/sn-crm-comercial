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
const MIGRATION_095_SQL = readFileSync(
  new URL('../supabase/migrations/095_agt002_f0_users_security.sql', import.meta.url),
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

test('checkAgt002GrantsStaticFromSql returns ok:true for the current 092/094/095 SQL', async () => {
  const { checkAgt002GrantsStaticFromSql } = await import(GRANTS_STATIC_MODULE_SPECIFIER);
  assert.equal(typeof checkAgt002GrantsStaticFromSql, 'function');

  const result = checkAgt002GrantsStaticFromSql({
    sql092: MIGRATION_092_SQL,
    sql094: MIGRATION_094_SQL,
    sql095: MIGRATION_095_SQL,
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('checkAgt002GrantsStaticFromSql skips 095 checks when sql095 is not provided (API compatibility)', async () => {
  const { checkAgt002GrantsStaticFromSql } = await import(GRANTS_STATIC_MODULE_SPECIFIER);

  const result = checkAgt002GrantsStaticFromSql({ sql092: MIGRATION_092_SQL, sql094: MIGRATION_094_SQL });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('checkAgt002GrantsStaticFromSql returns ok:true for a valid, differently-formatted 095 covering every invariant', async () => {
  const { checkAgt002GrantsStaticFromSql } = await import(GRANTS_STATIC_MODULE_SPECIFIER);

  const validSql095 = `
    -- enable but do not force RLS
    alter table public.usuarios enable row level security;

    revoke all on table public.usuarios from public;
    revoke all on table public.usuarios from anon;
    revoke all on table public.usuarios from authenticated;
    grant all on table public.usuarios to service_role;

    create or replace function public.registrar_uso_ia(
      p_usuario_id uuid, p_tokens_input integer, p_tokens_output integer, p_modelo text default 'haiku'
    )
    returns json language plpgsql security definer set search_path = pg_catalog, public
    as $function$
    begin
      insert into public.ia_usage as u (usuario_id, fecha, consultas_count)
      values (p_usuario_id, current_date, 1)
      on conflict (usuario_id, fecha) do update
        set consultas_count = u.consultas_count + 1
      where u.consultas_count < v_limite
      returning u.consultas_count into v_consultas_hoy;
    end;
    $function$;

    revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from public;
    revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from anon;
    revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from authenticated;
    grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to service_role;
  `;

  const result = checkAgt002GrantsStaticFromSql({
    sql092: MIGRATION_092_SQL,
    sql094: MIGRATION_094_SQL,
    sql095: validSql095,
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

const MIGRATION_095_REGRESSIONS = [
  {
    label: 'FORCEs row level security on usuarios',
    mutate: sql =>
      `${sql}\nalter table public.usuarios force row level security;\n`,
    expectedErrorSubstring: 'must not FORCE row level security',
  },
  {
    label: 'drops the revoke of table privileges on usuarios from anon',
    mutate: sql => sql.replace('revoke all on table public.usuarios from anon;\n', ''),
    expectedErrorSubstring: 'revoke ALL table privileges on public.usuarios from anon',
  },
  {
    label: 'grants ALL on usuarios to anon alongside service_role',
    mutate: sql =>
      sql.replace(
        'grant all on table public.usuarios to service_role;',
        'grant all on table public.usuarios to service_role, anon;',
      ),
    expectedErrorSubstring: 'must not grant ALL on public.usuarios to anon',
  },
  {
    label: 'never grants ALL on usuarios to service_role at all',
    mutate: sql => sql.replace('grant all on table public.usuarios to service_role;\n', ''),
    expectedErrorSubstring: 'expected uncommented SQL to grant ALL on public.usuarios to service_role',
  },
  {
    label: 'drops the revoke of EXECUTE on registrar_uso_ia from authenticated',
    mutate: sql =>
      sql.replace(
        'revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from authenticated;\n',
        '',
      ),
    expectedErrorSubstring: 'revoke EXECUTE/ALL on public.registrar_uso_ia from authenticated',
  },
  {
    label: 'grants EXECUTE on registrar_uso_ia to authenticated alongside service_role',
    mutate: sql =>
      sql.replace(
        'grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to service_role;',
        'grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to service_role, authenticated;',
      ),
    expectedErrorSubstring: 'must not grant EXECUTE/ALL on public.registrar_uso_ia to authenticated',
  },
  {
    label: 'reintroduces the legacy uso_ia_diario table name',
    mutate: sql => `${sql}\n-- keep in sync\nselect 1 from public.uso_ia_diario;\n`,
    expectedErrorSubstring: 'must not reference the legacy uso_ia_diario table',
  },
  {
    label: 'stops using public.ia_usage entirely',
    mutate: sql => sql.split('public.ia_usage').join('public.usage_ledger'),
    expectedErrorSubstring: 'expected uncommented SQL to use public.ia_usage',
  },
  {
    label: 'drops the WHERE guard on the ON CONFLICT DO UPDATE (reintroduces the TOCTOU race)',
    mutate: sql =>
      sql.replace(
        'where u.consultas_count < v_limite\n  returning u.consultas_count into v_consultas_hoy;',
        'returning u.consultas_count into v_consultas_hoy;',
      ),
    expectedErrorSubstring: 'guarded INSERT .. ON CONFLICT DO UPDATE',
  },
  {
    label: 'replaces the v_limite guard with a hardcoded large constant (defeats the per-role daily limit)',
    mutate: sql => sql.replace('where u.consultas_count < v_limite', 'where u.consultas_count < 999999999'),
    expectedErrorSubstring: 'guarded INSERT .. ON CONFLICT DO UPDATE',
  },
];

test('checkAgt002GrantsStaticFromSql returns ok:false for 095 regressions of each invariant', async () => {
  const { checkAgt002GrantsStaticFromSql } = await import(GRANTS_STATIC_MODULE_SPECIFIER);

  for (const { label, mutate, expectedErrorSubstring } of MIGRATION_095_REGRESSIONS) {
    const mutatedSql095 = mutate(MIGRATION_095_SQL);
    assert.notEqual(mutatedSql095, MIGRATION_095_SQL, `${label}: mutation must actually change the SQL`);

    const result = checkAgt002GrantsStaticFromSql({
      sql092: MIGRATION_092_SQL,
      sql094: MIGRATION_094_SQL,
      sql095: mutatedSql095,
    });
    assert.equal(result.ok, false, `${label}: expected ok:false`);
    assert.ok(
      result.errors.some(error => error.includes(expectedErrorSubstring)),
      `${label}: expected an error containing "${expectedErrorSubstring}", got ${JSON.stringify(result.errors)}`,
    );
  }
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
