import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  apply,
  buildStateSql,
  classifyState,
  preflight,
  rollback,
  verify,
} from '../scripts/agt002-program-migrations.mjs';

// Load both transactional artifacts up front so a missing half fails closed.
const migration055 = readFileSync(new URL('../supabase/migrations/055_agt002_company_documents_service_read.sql', import.meta.url), 'utf8');
const rollback055 = readFileSync(new URL('../supabase/rollbacks/055_agt002_company_documents_service_read_rollback.sql', import.meta.url), 'utf8');

const P = '55555555-5555-4555-8555-555555555555';

const ALL_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const TABLE = 'public.psi_company_procurement_documents';

function stripTxn(sql) {
  return sql.replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '').trim();
}

async function baseDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    alter default privileges in schema public grant all on tables to anon;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true);
    create table public.psi_company_procurement_documents (
      id uuid primary key default gen_random_uuid(),
      document_type text not null,
      display_name text not null,
      issued_at date not null,
      expires_at date,
      version integer not null,
      content_hash text not null,
      storage_path text not null,
      mime_type text not null,
      size_bytes bigint not null,
      current boolean not null default true,
      uploaded_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table public.psi_company_procurement_documents enable row level security;
    revoke all on table public.psi_company_procurement_documents from public;
    revoke all on table public.psi_company_procurement_documents from authenticated;
    revoke all on table public.psi_company_procurement_documents from service_role;
    revoke all on table public.psi_company_procurement_documents from anon;
    insert into public.psi_sales_profiles values ('${P}', true);
  `);
  return pg;
}

async function rlsEnabled(pg) {
  const { rows } = await pg.query(`
    select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'psi_company_procurement_documents'
  `);
  return rows[0]?.relrowsecurity === true;
}

async function hasPriv(pg, role, priv) {
  const { rows } = await pg.query(`select has_table_privilege('${role}', '${TABLE}', '${priv}') ok`);
  return rows[0].ok === true;
}

function runnerExec(pg) {
  return async sql => {
    if (/AGT002_RUNNER:(STATE|PREREQUISITES|ROLLBACK_VERIFY):055/.test(sql)) {
      return (await pg.query(sql)).rows;
    }
    await pg.exec(sql);
    return [];
  };
}

async function assertExactServiceRoleSelectOnly(pg, label) {
  assert.equal(await rlsEnabled(pg), true, `${label}: RLS must remain enabled`);
  for (const priv of ALL_PRIVS) {
    const expected = priv === 'SELECT';
    assert.equal(await hasPriv(pg, 'service_role', priv), expected, `${label}: service_role ${priv} expected ${expected}`);
  }
  for (const role of ['public', 'anon', 'authenticated']) {
    for (const priv of ALL_PRIVS) {
      assert.equal(await hasPriv(pg, role, priv), false, `${label}: ${role} must not have ${priv}`);
    }
  }
}

async function assertNoDirectPrivilegesAnyRole(pg, label) {
  assert.equal(await rlsEnabled(pg), true, `${label}: RLS must remain enabled`);
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    for (const priv of ALL_PRIVS) {
      assert.equal(await hasPriv(pg, role, priv), false, `${label}: ${role} must not have ${priv}`);
    }
  }
}

// Core lifecycle: pre-055 fixture -> apply -> apply/apply idempotent ->
// rollback -> rollback/rollback idempotent.
{
  const pg = await baseDatabase();
  await assertNoDirectPrivilegesAnyRole(pg, 'pre-055 fixture');

  await pg.exec(stripTxn(migration055));
  await assertExactServiceRoleSelectOnly(pg, 'after apply 055');

  // apply/apply: re-applying against an already-applied database must not
  // error and must leave the exact same grant set.
  await pg.exec(stripTxn(migration055));
  await assertExactServiceRoleSelectOnly(pg, 'after apply/apply 055');

  await pg.exec(stripTxn(rollback055));
  await assertNoDirectPrivilegesAnyRole(pg, 'after rollback 055');

  // rollback/rollback: re-running rollback against an already-rolled-back
  // database must not error and must leave the same no-privilege state.
  await pg.exec(stripTxn(rollback055));
  await assertNoDirectPrivilegesAnyRole(pg, 'after rollback/rollback 055');
}

// Unexpected-grant detection: migration 055 must normalize the grant set even
// from a dirty/drifted starting point (e.g. a stray legacy grant to anon),
// not merely add SELECT for service_role on top of whatever already exists.
{
  const pg = await baseDatabase();
  await pg.exec(`grant insert, select on table ${TABLE} to anon`);
  assert.equal(await hasPriv(pg, 'anon', 'INSERT'), true, 'fixture must contain the unexpected anon grant before apply');

  await pg.exec(stripTxn(migration055));
  await assertExactServiceRoleSelectOnly(pg, 'after apply 055 over drifted anon grant');
}

// Real runner lifecycle: detect an unexpected backend privilege, normalize it
// atomically, and prove apply/apply + rollback/rollback terminal idempotence.
{
  const pg = await baseDatabase();
  await pg.exec(`grant insert on table ${TABLE} to service_role`);
  const dirty = (await pg.query(buildStateSql('055'))).rows[0];
  assert.equal(classifyState(dirty), 'absent');
  assert.equal(Number(dirty.unsafe_service_table_grants), 1, 'runner must expose the unexpected service_role INSERT grant');

  const execSql = runnerExec(pg);
  assert.equal((await preflight(execSql, '055')).status, 'absent');
  assert.equal((await apply(execSql, '055')).status, 'applied');
  await assertExactServiceRoleSelectOnly(pg, 'runner apply 055');
  assert.equal((await verify(execSql, '055')).status, 'applied');
  assert.equal((await apply(execSql, '055')).skipped, true, 'runner apply/apply must skip safely');

  assert.equal((await rollback(execSql, '055')).ok, true);
  await assertNoDirectPrivilegesAnyRole(pg, 'runner rollback 055');
  assert.equal((await rollback(execSql, '055')).skipped, true, 'runner rollback/rollback must skip safely');
}

console.log('AGT-002 migration 055 (company documents service-only read) PGlite integration passed');
