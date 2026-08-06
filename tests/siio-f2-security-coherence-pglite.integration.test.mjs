import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// F2 Task 1: the 10 SIIO tables created by migration 014 rely on implicit
// Supabase default grants (anon/authenticated/service_role all get ALL by
// default on new public-schema tables). RLS is enabled but no policy exists,
// so today's only protection against exposure is "nobody added a policy
// yet". This migration closes that gap with explicit, minimal privileges
// instead of relying on RLS policies (deliberately none are added here).
const migrationPath = new URL('../supabase/migrations/058_siio_f2_security_coherence.sql', import.meta.url);
const migration = readFileSync(migrationPath, 'utf8');

const ALL_TABLES = [
  'siio_fronts',
  'siio_sources',
  'siio_gerencial_records',
  'siio_decisions_commitments',
  'siio_monthly_board_reports',
  'siio_board_sections',
  'siio_financial_metrics',
  'siio_commercial_signals',
  'siio_payroll_aggregates',
  'siio_strategic_opportunities',
];

const MUTABLE_TABLES = ['siio_sources', 'siio_gerencial_records', 'siio_decisions_commitments'];
const READONLY_TABLES = ALL_TABLES.filter(t => !MUTABLE_TABLES.includes(t));

const ALL_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

function stripTxn(sql) {
  return sql.replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '').trim();
}

async function baseDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated;
    create role service_role;
    create role anon;
    -- Supabase's service_role always bypasses RLS at the platform-role
    -- level (not via a policy); reproduce that here so the behavioral
    -- assertions below reflect real production semantics.
    alter role service_role bypassrls;
    grant service_role to current_user;
    -- Reproduce Supabase's default-privilege behavior: new public-schema
    -- tables are granted ALL to anon/authenticated/service_role unless a
    -- migration explicitly revokes it. This is the exact starting state the
    -- 10 SIIO tables are in today (created by 014, never revoked since).
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

    create table public.siio_fronts (id text primary key);
    create table public.siio_sources (id text primary key);
    create table public.siio_gerencial_records (
      id text primary key,
      front_id text not null references public.siio_fronts(id)
    );
    create table public.siio_decisions_commitments (
      id uuid primary key default gen_random_uuid(),
      related_record_id text references public.siio_gerencial_records(id) on delete set null
    );
    create table public.siio_monthly_board_reports (id text primary key);
    create table public.siio_board_sections (id uuid primary key default gen_random_uuid());
    create table public.siio_financial_metrics (id uuid primary key default gen_random_uuid());
    create table public.siio_commercial_signals (id uuid primary key default gen_random_uuid());
    create table public.siio_payroll_aggregates (id uuid primary key default gen_random_uuid());
    create table public.siio_strategic_opportunities (id text primary key);

    alter table public.siio_fronts enable row level security;
    alter table public.siio_sources enable row level security;
    alter table public.siio_gerencial_records enable row level security;
    alter table public.siio_decisions_commitments enable row level security;
    alter table public.siio_monthly_board_reports enable row level security;
    alter table public.siio_board_sections enable row level security;
    alter table public.siio_financial_metrics enable row level security;
    alter table public.siio_commercial_signals enable row level security;
    alter table public.siio_payroll_aggregates enable row level security;
    alter table public.siio_strategic_opportunities enable row level security;

    insert into public.siio_fronts values ('FRT-001');
  `);
  return pg;
}

async function rlsEnabled(pg, table) {
  const { rows } = await pg.query(`
    select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = $1
  `, [table]);
  return rows[0]?.relrowsecurity === true;
}

async function hasPriv(pg, role, table, priv) {
  const { rows } = await pg.query(`select has_table_privilege($1, $2, $3) ok`, [role, `public.${table}`, priv]);
  return rows[0].ok === true;
}

async function assertExactPrivileges(pg, label) {
  for (const table of ALL_TABLES) {
    assert.equal(await rlsEnabled(pg, table), true, `${label}: ${table} RLS must remain enabled`);

    for (const role of ['public', 'anon', 'authenticated']) {
      for (const priv of ALL_PRIVS) {
        assert.equal(await hasPriv(pg, role, table, priv), false, `${label}: ${table} ${role} must not have ${priv}`);
      }
    }

    const mutable = MUTABLE_TABLES.includes(table);
    for (const priv of ALL_PRIVS) {
      let expected = priv === 'SELECT';
      if (mutable && (priv === 'INSERT' || priv === 'UPDATE')) expected = true;
      assert.equal(await hasPriv(pg, 'service_role', table, priv), expected, `${label}: ${table} service_role ${priv} expected ${expected}`);
    }
  }
}

// RED-first fixture check: before 058 is applied, the drifted default-grant
// starting point must actually expose the tables (proves the fixture is a
// faithful pre-hardening reproduction, not an already-safe no-op).
{
  const pg = await baseDatabase();
  assert.equal(await hasPriv(pg, 'anon', 'siio_sources', 'SELECT'), true, 'fixture must start with anon SELECT (Supabase default grant) before hardening');
  assert.equal(await hasPriv(pg, 'authenticated', 'siio_gerencial_records', 'DELETE'), true, 'fixture must start with authenticated DELETE (Supabase default grant) before hardening');
}

// Core contract: apply 058 over the drifted default-grant fixture and prove
// the exact resulting privilege matrix, then confirm apply/apply idempotence.
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration));
  await assertExactPrivileges(pg, 'after apply 058');

  await pg.exec(stripTxn(migration));
  await assertExactPrivileges(pg, 'after apply/apply 058 (idempotent)');
}

// Behavioral proof via real role impersonation, not just privilege bits.
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration));

  await pg.exec('set role anon');
  for (const table of ALL_TABLES) {
    await assert.rejects(() => pg.query(`select * from public.${table}`), /permission denied/i, `anon must not SELECT ${table}`);
  }
  await pg.exec('reset role; set role authenticated');
  for (const table of ALL_TABLES) {
    await assert.rejects(() => pg.query(`select * from public.${table}`), /permission denied/i, `authenticated must not SELECT ${table}`);
  }
  await pg.exec('reset role');

  await pg.exec('set role service_role');
  for (const table of ALL_TABLES) {
    await assert.doesNotReject(() => pg.query(`select * from public.${table}`), `service_role must SELECT ${table}`);
  }

  await pg.query(`insert into public.siio_sources (id) values ('SRC-901')`);
  await pg.query(`insert into public.siio_gerencial_records (id, front_id) values ('REC-901', 'FRT-001')`);
  const inserted = await pg.query(`insert into public.siio_decisions_commitments (related_record_id) values ('REC-901') returning id`);
  await pg.query(`update public.siio_sources set id = id where id = 'SRC-901'`);
  await pg.query(`update public.siio_gerencial_records set id = id where id = 'REC-901'`);
  await pg.query(`update public.siio_decisions_commitments set related_record_id = related_record_id where id = $1`, [inserted.rows[0].id]);

  for (const table of READONLY_TABLES) {
    await assert.rejects(() => pg.query(`insert into public.${table} default values`), /permission denied/i, `service_role must not INSERT ${table}`);
  }

  for (const table of ALL_TABLES) {
    await assert.rejects(() => pg.query(`delete from public.${table}`), /permission denied/i, `service_role must not DELETE ${table}`);
  }
  await pg.exec('reset role');
}

console.log('SIIO F2 Task 1 (058) security coherence PGlite integration passed');
