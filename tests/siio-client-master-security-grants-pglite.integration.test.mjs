import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration093 = readFileSync(new URL('../supabase/migrations/093_siio_sales_clients.sql', import.meta.url), 'utf8');
const BASE_SCHEMA = `
create table public.psi_sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  company_name text,
  service_type_code text,
  customer_segment text,
  regional_nombre text,
  sede text,
  quote_city text,
  economic_sector text,
  decision_maker_name text,
  decision_maker_email text,
  decision_maker_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`;
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    grant anon, authenticated, service_role to current_user;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    ${BASE_SCHEMA}
  `);
  return db;
}

async function hasTablePrivilege(db, role, privilege) {
  const { rows } = await db.query(
    "select has_table_privilege($1, 'public.psi_sales_clients', $2) as allowed",
    [role, privilege],
  );
  return rows[0].allowed === true;
}

test('093 protege PII de psi_sales_clients y reserva acceso directo a service_role', async () => {
  const db = await freshDb();
  try {
    await db.exec(migration093);

    const { rows: tableRows } = await db.query(`
      select c.relrowsecurity,
        exists (
          select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
          where acl.grantee = 0
        ) as public_has_acl
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'psi_sales_clients'
    `);
    assert.equal(tableRows[0].relrowsecurity, true, 'psi_sales_clients debe tener RLS habilitado');
    assert.equal(tableRows[0].public_has_acl, false, 'PUBLIC no debe conservar privilegios directos');

    for (const role of ['anon', 'authenticated']) {
      for (const privilege of TABLE_PRIVILEGES) {
        assert.equal(await hasTablePrivilege(db, role, privilege), false, `${role} no debe tener ${privilege}`);
      }
    }
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
      assert.equal(await hasTablePrivilege(db, 'service_role', privilege), true, `service_role debe tener ${privilege}`);
    }
    for (const privilege of ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      assert.equal(await hasTablePrivilege(db, 'service_role', privilege), false, `service_role no debe tener ${privilege}`);
    }

    await db.exec('set role anon');
    await assert.rejects(() => db.query('select * from public.psi_sales_clients'), /permission denied/i);
    await assert.rejects(() => db.query("insert into public.psi_sales_clients (company_name) values ('Anon Co')"), /permission denied/i);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(() => db.query('select * from public.psi_sales_clients'), /permission denied/i);
    await assert.rejects(() => db.query("insert into public.psi_sales_clients (company_name) values ('Auth Co')"), /permission denied/i);
    await db.exec('reset role; set role service_role');
    await assert.doesNotReject(() => db.query('select * from public.psi_sales_clients'));
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});

test('093 revoca EXECUTE de todas sus funciones a PUBLIC/anon/authenticated y lo concede a service_role', async () => {
  const db = await freshDb();
  try {
    await db.exec(migration093);
    const functionNames = [...new Set(
      [...migration093.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)/gi)].map((match) => match[1]),
    )];
    assert.ok(functionNames.length > 0);

    for (const name of functionNames) {
      const { rows: functions } = await db.query(
        "select oid from pg_proc where pronamespace = 'public'::regnamespace and proname = $1",
        [name],
      );
      assert.ok(functions.length > 0, `debe existir public.${name}`);
      for (const fn of functions) {
        for (const role of ['anon', 'authenticated']) {
          const { rows } = await db.query("select has_function_privilege($1, $2, 'execute') as allowed", [role, fn.oid]);
          assert.equal(rows[0].allowed, false, `${role} no debe ejecutar public.${name}`);
        }
        const { rows: serviceRows } = await db.query("select has_function_privilege('service_role', $1, 'execute') as allowed", [fn.oid]);
        assert.equal(serviceRows[0].allowed, true, `service_role debe ejecutar public.${name}`);
      }
    }
  } finally {
    await db.close();
  }
});
