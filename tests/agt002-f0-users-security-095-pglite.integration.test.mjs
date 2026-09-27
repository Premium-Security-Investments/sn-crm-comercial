// AGT-002 F0 (migration 095) — PGlite integration.
//
// Local isolated PGlite only. CERO APPLY: this test never runs against, connects to, or
// otherwise touches any remote/production/staging database. It builds a minimal
// public.usuarios table plus the pre-existing public.ia_usage ledger and role fixtures,
// drives them through the real, unmodified migration 095 (usuarios RLS + registrar_uso_ia
// hardening), then through the rollback SQL at
// supabase/rollbacks/095_agt002_f0_users_security_rollback.sql, and asserts the
// grant/RLS/behavioral contract at each step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = new URL('../supabase/migrations/095_agt002_f0_users_security.sql', import.meta.url);
const rollbackPath = new URL('../supabase/rollbacks/095_agt002_f0_users_security_rollback.sql', import.meta.url);

const migrationSql = readFileSync(migrationPath, 'utf8');

const FUNC_SIGNATURE = 'public.registrar_uso_ia(uuid, integer, integer, text)';
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

const USUARIOS = {
  admin: '00000000-0000-0000-0000-000000000001',
  directivo: '00000000-0000-0000-0000-000000000002',
  coordinador: '00000000-0000-0000-0000-000000000003',
  supervisor: '00000000-0000-0000-0000-000000000004',
  cliente: '00000000-0000-0000-0000-000000000005',
  guarda: '00000000-0000-0000-0000-000000000006',
  auditor: '00000000-0000-0000-0000-000000000007',
  inactiveAdmin: '00000000-0000-0000-0000-000000000008',
};
const UNKNOWN_USER_ID = '00000000-0000-0000-0000-00000000dead';

// Strip `--` line comments before scanning migration/rollback SQL text so an
// uncommented-code assertion cannot pass because of prose in a comment.
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');
}

async function freshDb() {
  const db = new PGlite();
  let rolesAvailable = true;
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      grant anon, authenticated, service_role to current_user;
    `);
  } catch (err) {
    rolesAvailable = false;
    assert.ok(true, `role creation unsupported in this PGlite build: ${err.message}`);
  }
  if (!rolesAvailable) {
    await db.close();
    return null;
  }

  await db.exec(`
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table public.usuarios (
      id uuid primary key,
      rol text not null,
      activo boolean not null default true
    );
    create table public.ia_usage (
      usuario_id uuid not null references public.usuarios(id),
      fecha date not null default current_date,
      consultas_count integer not null default 0,
      tokens_input integer not null default 0,
      tokens_output integer not null default 0,
      costo_estimado numeric not null default 0,
      updated_at timestamptz not null default now(),
      unique (usuario_id, fecha)
    );
  `);
  return db;
}

async function seedUsuarios(db) {
  await db.exec(`
    insert into public.usuarios (id, rol, activo) values
      ('${USUARIOS.admin}', 'admin', true),
      ('${USUARIOS.directivo}', 'directivo', true),
      ('${USUARIOS.coordinador}', 'coordinador', true),
      ('${USUARIOS.supervisor}', 'supervisor', true),
      ('${USUARIOS.cliente}', 'cliente', true),
      ('${USUARIOS.guarda}', 'guarda', true),
      ('${USUARIOS.auditor}', 'auditor', true),
      ('${USUARIOS.inactiveAdmin}', 'admin', false);
  `);
}

async function relRowSecurity(db, tableName) {
  const { rows } = await db.query(
    `select relrowsecurity, relforcerowsecurity
     from pg_class
     where relnamespace = 'public'::regnamespace and relname = $1`,
    [tableName],
  );
  return rows[0];
}

async function publicHasTableAcl(db, tableName) {
  const { rows } = await db.query(
    `select exists (
       select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
       where acl.grantee = 0
     ) as public_has_acl
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = $1`,
    [tableName],
  );
  return rows[0].public_has_acl;
}

async function hasTablePriv(db, role, tableName, priv) {
  const { rows } = await db.query(
    `select has_table_privilege($1, 'public.${tableName}', $2) as allowed`,
    [role, priv],
  );
  return rows[0].allowed;
}

async function hasFuncExecute(db, role) {
  const { rows } = await db.query(
    `select has_function_privilege($1, '${FUNC_SIGNATURE}', 'execute') as allowed`,
    [role],
  );
  return rows[0].allowed;
}

async function publicHasFuncAcl(db) {
  const { rows } = await db.query(
    `select exists (
       select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where a.grantee = 0 and a.privilege_type = 'EXECUTE'
     ) as public_execute
     from pg_proc p
     where p.oid = '${FUNC_SIGNATURE}'::regprocedure`,
  );
  return rows[0].public_execute;
}

async function registrarUsoIa(db, usuarioId, tokensInput, tokensOutput, modelo) {
  if (modelo === undefined) {
    const { rows } = await db.query(
      `select public.registrar_uso_ia($1, $2, $3) as result`,
      [usuarioId, tokensInput, tokensOutput],
    );
    return rows[0].result;
  }
  const { rows } = await db.query(
    `select public.registrar_uso_ia($1, $2, $3, $4) as result`,
    [usuarioId, tokensInput, tokensOutput, modelo],
  );
  return rows[0].result;
}

async function getUsage(db, usuarioId) {
  const { rows } = await db.query(
    `select consultas_count, tokens_input, tokens_output, costo_estimado
     from public.ia_usage where usuario_id = $1`,
    [usuarioId],
  );
  return rows[0] || null;
}

test('rollback 095 file exists', () => {
  assert.equal(
    existsSync(rollbackPath),
    true,
    'expected supabase/rollbacks/095_agt002_f0_users_security_rollback.sql',
  );
});

test('095: usuarios gets RLS enabled (not forced) and privileges locked to service_role; registrar_uso_ia locked to service_role', async () => {
  const db = await freshDb();
  if (!db) return;
  try {
    await db.exec(migrationSql);

    const rls = await relRowSecurity(db, 'usuarios');
    assert.equal(rls.relrowsecurity, true, 'usuarios must have RLS enabled');
    assert.equal(rls.relforcerowsecurity, false, 'usuarios must NOT have RLS forced');

    assert.equal(await publicHasTableAcl(db, 'usuarios'), false, 'PUBLIC must not retain usuarios privileges');
    for (const role of ['anon', 'authenticated']) {
      for (const priv of TABLE_PRIVILEGES) {
        assert.equal(await hasTablePriv(db, role, 'usuarios', priv), false, `${role} must not have ${priv} on usuarios`);
      }
    }
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(await hasTablePriv(db, 'service_role', 'usuarios', priv), true, `service_role must have ${priv} on usuarios`);
    }

    assert.equal(await publicHasFuncAcl(db), false, 'PUBLIC must not retain EXECUTE on registrar_uso_ia');
    assert.equal(await hasFuncExecute(db, 'anon'), false, 'anon must not execute registrar_uso_ia');
    assert.equal(await hasFuncExecute(db, 'authenticated'), false, 'authenticated must not execute registrar_uso_ia');
    assert.equal(await hasFuncExecute(db, 'service_role'), true, 'service_role must execute registrar_uso_ia');

    await seedUsuarios(db);
    await db.exec('set role anon');
    await assert.rejects(
      () => registrarUsoIa(db, USUARIOS.admin, 10, 10),
      /permission denied|42501/i,
      'anon must be denied at the grant layer',
    );
    await db.exec('reset role; set role authenticated');
    await assert.rejects(
      () => registrarUsoIa(db, USUARIOS.admin, 10, 10),
      /permission denied|42501/i,
      'authenticated must be denied at the grant layer',
    );
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});

test('095: registrar_uso_ia rejects invalid, unknown, inactive, and zero-limit input without writing a usage row', async () => {
  const db = await freshDb();
  if (!db) return;
  try {
    await db.exec(migrationSql);
    await seedUsuarios(db);
    await db.exec('set role service_role');

    const invalidInputCases = [
      { label: 'null usuario_id', args: [null, 10, 10, 'haiku'], error: 'usuario_requerido' },
      { label: 'negative tokens_input', args: [USUARIOS.admin, -1, 10, 'haiku'], error: 'tokens_invalidos' },
      { label: 'tokens_output over max', args: [USUARIOS.admin, 10, 1_000_001, 'haiku'], error: 'tokens_invalidos' },
      { label: 'null tokens_input', args: [USUARIOS.admin, null, 10, 'haiku'], error: 'tokens_invalidos' },
      { label: 'blank model', args: [USUARIOS.admin, 10, 10, '   '], error: 'modelo_invalido' },
      { label: 'model over 100 chars', args: [USUARIOS.admin, 10, 10, 'x'.repeat(101)], error: 'modelo_invalido' },
    ];

    for (const { label, args, error } of invalidInputCases) {
      const result = await registrarUsoIa(db, ...args);
      assert.equal(result.permitido, false, `${label}: permitido must be false`);
      assert.equal(result.error, error, `${label}: unexpected error`);
      if (args[0]) {
        const usage = await getUsage(db, args[0]);
        assert.equal(usage, null, `${label}: must not write an ia_usage row`);
      }
    }

    const unknownAndInactiveCases = [
      { label: 'unknown user', args: [UNKNOWN_USER_ID, 10, 10, 'haiku'] },
      { label: 'inactive user (existing but activo=false)', args: [USUARIOS.inactiveAdmin, 10, 10, 'haiku'] },
    ];
    for (const { label, args } of unknownAndInactiveCases) {
      const result = await registrarUsoIa(db, ...args);
      assert.equal(result.permitido, false, `${label}: permitido must be false`);
      assert.equal(result.rol, null, `${label}: rol must be null`);
      assert.equal('error' in result, false, `${label}: must not carry an error key`);
      const usage = await getUsage(db, args[0]);
      assert.equal(usage, null, `${label}: must not write an ia_usage row`);
    }

    const zeroLimitCases = [
      { label: 'guarda role has a zero daily limit', args: [USUARIOS.guarda, 10, 10, 'haiku'] },
      { label: 'unlisted role falls back to a zero daily limit', args: [USUARIOS.auditor, 10, 10, 'haiku'] },
    ];
    for (const { label, args } of zeroLimitCases) {
      const result = await registrarUsoIa(db, ...args);
      assert.equal(result.permitido, false, `${label}: permitido must be false`);
      assert.equal(result.consultas_hoy, 0, `${label}: consultas_hoy must be 0`);
      assert.equal(result.limite, 0, `${label}: limite must be 0`);
      const usage = await getUsage(db, args[0]);
      assert.equal(usage, null, `${label}: must not write an ia_usage row`);
    }
  } finally {
    await db.close();
  }
});

test('095: registrar_uso_ia enforces the exact per-role daily limit atomically, preserves the JSON/cost shape, and denies the 11th call unchanged', async () => {
  const db = await freshDb();
  if (!db) return;
  try {
    await db.exec(migrationSql);
    await seedUsuarios(db);
    await db.exec('set role service_role');

    for (let i = 1; i <= 10; i += 1) {
      const result = await registrarUsoIa(db, USUARIOS.admin, 100, 200, 'haiku');
      assert.deepEqual(
        Object.keys(result).sort(),
        ['consultas_hoy', 'costo', 'limite', 'permitido', 'rol'],
        `admin call ${i} must preserve the original JSON keys`,
      );
      assert.equal(result.permitido, true, `admin call ${i} must be permitted`);
      assert.equal(result.consultas_hoy, i, `admin call ${i} must report consultas_hoy ${i}`);
      assert.equal(result.limite, 10, 'admin limite must be 10');
      assert.equal(result.rol, 'admin', 'admin rol must be echoed back');
      assert.equal(Number(result.costo), 0.00088, 'cost formula must be tokens_input*0.0000008 + tokens_output*0.000004');
    }
    const atLimit = await getUsage(db, USUARIOS.admin);
    assert.equal(atLimit.consultas_count, 10);
    assert.equal(atLimit.tokens_input, 1000);
    assert.equal(atLimit.tokens_output, 2000);
    assert.ok(Math.abs(Number(atLimit.costo_estimado) - 0.0088) < 1e-9);

    const denied = await registrarUsoIa(db, USUARIOS.admin, 100, 200, 'haiku');
    assert.equal(denied.permitido, false, 'the 11th admin call must be denied');
    assert.equal(denied.consultas_hoy, 10, 'denied call must report the unchanged count');
    assert.equal(denied.costo, null, 'denied call must not report a cost');

    const afterDenied = await getUsage(db, USUARIOS.admin);
    assert.equal(afterDenied.consultas_count, 10, 'a denied call must not increment the stored count');
    assert.equal(afterDenied.tokens_input, 1000, 'a denied call must not add its tokens');

    const roleLimits = [
      { rol: 'directivo', id: USUARIOS.directivo, limite: 10 },
      { rol: 'coordinador', id: USUARIOS.coordinador, limite: 5 },
      { rol: 'supervisor', id: USUARIOS.supervisor, limite: 5 },
      { rol: 'cliente', id: USUARIOS.cliente, limite: 5 },
    ];
    for (const { rol, id, limite } of roleLimits) {
      const result = await registrarUsoIa(db, id, 10, 10, 'sonnet');
      assert.equal(result.permitido, true, `${rol} first call must be permitted`);
      assert.equal(result.limite, limite, `${rol} must have limite ${limite}`);
      assert.equal(result.rol, rol, `${rol} must be echoed back`);
    }
  } finally {
    await db.close();
  }
});

test('095: the atomic guarded upsert lives in the forward migration only; the rollback restores the non-atomic read-then-write shape (static SQL check, no fake concurrency — PGlite is a single connection so overlapping transactions cannot be exercised here)', () => {
  const forward = stripSqlComments(migrationSql);
  const rollback = stripSqlComments(readFileSync(rollbackPath, 'utf8'));

  assert.match(
    forward,
    /on conflict\s*\(usuario_id,\s*fecha\)\s*do update[\s\S]*?where\s+u\.consultas_count\s*<\s*v_limite[\s\S]*?returning\s+u\.consultas_count\s+into\s+v_consultas_hoy/i,
    'forward migration must contain a single atomic INSERT .. ON CONFLICT DO UPDATE .. WHERE .. RETURNING statement guarding the daily limit',
  );

  assert.doesNotMatch(
    rollback,
    /do update[\s\S]*?where\s+u\.consultas_count\s*<\s*v_limite/i,
    'rollback must restore the original non-atomic read-count-then-upsert shape, not the atomic guarded upsert',
  );
  assert.match(
    rollback,
    /select\s+coalesce\(consultas_count,\s*0\)\s+into\s+v_consultas_hoy[\s\S]*?v_permitido\s*:=\s*v_consultas_hoy\s*<\s*v_limite_diario/i,
    'rollback must restore the read-count-then-branch (TOCTOU) shape',
  );
});

test('095 rollback restores the pre-095 usuarios ACL/RLS state and the original permissive, unvalidated registrar_uso_ia', async () => {
  const db = await freshDb();
  if (!db) return;
  try {
    await db.exec(migrationSql);
    await seedUsuarios(db);

    const preRollbackAuthDenied = await (async () => {
      await db.exec('reset role; set role authenticated');
      try {
        await registrarUsoIa(db, USUARIOS.admin, 1, 1);
        return false;
      } catch (err) {
        return /permission denied|42501/i.test(err.message);
      } finally {
        await db.exec('reset role');
      }
    })();
    assert.equal(preRollbackAuthDenied, true, 'before rollback, authenticated must still be denied EXECUTE');

    const rollbackSql = readFileSync(rollbackPath, 'utf8');
    await db.exec(rollbackSql);

    const rls = await relRowSecurity(db, 'usuarios');
    assert.equal(rls.relrowsecurity, false, 'rollback must disable RLS on usuarios');

    assert.equal(await publicHasTableAcl(db, 'usuarios'), false, 'PUBLIC must still have no direct usuarios ACL after rollback');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.equal(await hasTablePriv(db, role, 'usuarios', priv), true, `rollback must restore ${priv} on usuarios to ${role}`);
      }
    }

    assert.equal(await publicHasFuncAcl(db), false, 'PUBLIC must still have no EXECUTE after rollback');
    assert.equal(await hasFuncExecute(db, 'anon'), false, 'rollback must not grant EXECUTE to anon');
    assert.equal(await hasFuncExecute(db, 'authenticated'), true, 'rollback must restore EXECUTE to authenticated');
    assert.equal(await hasFuncExecute(db, 'service_role'), true, 'rollback must keep EXECUTE for service_role');

    await db.exec('set role anon');
    await assert.rejects(
      () => registrarUsoIa(db, USUARIOS.admin, 1, 1),
      /permission denied|42501/i,
      'anon must remain denied after rollback',
    );
    await db.exec('reset role; set role authenticated');

    // Contrast case: the hardened function rejected this same inactive admin as
    // permitido=false with no write and no `rol` echoed. The restored original
    // never checks `activo`, but its SELECT INTO against ia_usage still hits the
    // classic PL/pgSQL quirk: with no existing row for today, the query matches
    // zero rows, so v_consultas_hoy (and everything NULL-propagated from it)
    // comes back NULL rather than the COALESCE-defaulted 0 — permitido is NULL,
    // consultas_hoy is NULL, and `IF v_permitido THEN` treats NULL as not-true,
    // so nothing is inserted. `rol` and the unconditionally-computed `costo`
    // are still populated, since neither depends on the ia_usage lookup.
    const noRowYet = await registrarUsoIa(db, USUARIOS.inactiveAdmin, 5, 5, 'haiku');
    assert.equal(noRowYet.permitido, null, 'with no ia_usage row yet, SELECT INTO yields NULL so permitido is NULL, not true');
    assert.equal(noRowYet.consultas_hoy, null, 'consultas_hoy must also be NULL (NULL propagates through the +1)');
    assert.equal(noRowYet.limite, 10, 'limite is derived from rol alone, unaffected by the NULL ia_usage lookup');
    assert.equal(noRowYet.rol, 'admin', 'rol is looked up from usuarios, not ia_usage, so it is still populated');
    assert.ok(
      Math.abs(Number(noRowYet.costo) - (5 * 0.0000008 + 5 * 0.000004)) < 1e-9,
      'costo is computed unconditionally, before the permitido check, so it is populated even though permitido is NULL',
    );
    assert.equal(await getUsage(db, USUARIOS.inactiveAdmin), null, 'the NULL-permitido call must not write an ia_usage row');

    // Seed a zero-count row for today so the SELECT INTO above resolves to a
    // real 0 instead of NULL, then re-run the same inactive-admin call to prove
    // the restored original genuinely trusts p_usuario_id and never checks
    // `activo` once a baseline row exists.
    await db.exec(`
      insert into public.ia_usage (usuario_id, fecha, consultas_count, tokens_input, tokens_output, costo_estimado)
      values ('${USUARIOS.inactiveAdmin}', current_date, 0, 0, 0, 0);
    `);
    const inactiveAdminResult = await registrarUsoIa(db, USUARIOS.inactiveAdmin, 5, 5, 'haiku');
    assert.equal(inactiveAdminResult.permitido, true, 'restored original behavior must trust an inactive user id once a baseline row exists');
    assert.equal(inactiveAdminResult.consultas_hoy, 1);
    assert.equal(inactiveAdminResult.limite, 10);
    const inactiveAdminUsage = await getUsage(db, USUARIOS.inactiveAdmin);
    assert.equal(inactiveAdminUsage.consultas_count, 1, 'the seeded row must be updated, not replaced');
    assert.equal(inactiveAdminUsage.tokens_input, 5);
    assert.equal(inactiveAdminUsage.tokens_output, 5);

    // Contrast case: the hardened function rejected out-of-range tokens and a
    // blank model with no write. The restored original performs no such checks,
    // and still uses the same unchanged cost formula (model is not consulted).
    // Seed a zero-count row first so the SELECT INTO resolves to 0 rather than
    // NULL, isolating this assertion to token/model validation.
    await db.exec(`
      insert into public.ia_usage (usuario_id, fecha, consultas_count, tokens_input, tokens_output, costo_estimado)
      values ('${USUARIOS.directivo}', current_date, 0, 0, 0, 0);
    `);
    const unvalidatedResult = await registrarUsoIa(db, USUARIOS.directivo, -50, 2_000_000, '   ');
    assert.equal(unvalidatedResult.permitido, true, 'restored original behavior must not validate token bounds or model text');
    const directivoUsage = await getUsage(db, USUARIOS.directivo);
    assert.equal(directivoUsage.tokens_input, -50, 'restored original must accept out-of-bounds tokens verbatim');
    assert.equal(directivoUsage.tokens_output, 2_000_000, 'restored original must accept out-of-bounds tokens verbatim');
    const expectedCost = -50 * 0.0000008 + 2_000_000 * 0.000004;
    assert.ok(
      Math.abs(Number(directivoUsage.costo_estimado) - expectedCost) < 1e-9,
      'restored original must still apply the unchanged cost formula regardless of model text',
    );

    await db.exec('reset role');
  } finally {
    await db.close();
  }
});

test('095 rollback restores the exact pre-095 registrar_uso_ia body (live-captured MD5 e4a458b6cacbddb05da83967d1a92c43)', async () => {
  const db = await freshDb();
  if (!db) return;
  try {
    await db.exec(migrationSql);
    await db.exec(readFileSync(rollbackPath, 'utf8'));

    const { rows } = await db.query(
      `select md5(pg_get_functiondef('${FUNC_SIGNATURE}'::regprocedure)) as body_md5`,
    );
    assert.equal(
      rows[0].body_md5,
      'e4a458b6cacbddb05da83967d1a92c43',
      'rollback must restore registrar_uso_ia to the exact pre-095 live-captured definition',
    );
  } finally {
    await db.close();
  }
});
