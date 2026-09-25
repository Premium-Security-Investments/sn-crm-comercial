import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationUrl = new URL('../supabase/migrations/093_siio_sales_clients.sql', import.meta.url);
const rollbackUrl = new URL('../supabase/rollbacks/093_siio_sales_clients_rollback.sql', import.meta.url);

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

async function openDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    ${BASE_SCHEMA}
  `);
  return db;
}

async function migrate(db) {
  assert.equal(existsSync(migrationUrl), true, '093_siio_sales_clients.sql debe existir');
  const sql = await readFile(migrationUrl, 'utf8');
  await db.exec(sql);
}

test('cliente queda con 0 oportunidades', async () => {
  const db = await openDb();
  try {
    await migrate(db);
    await db.exec(`insert into public.psi_sales_clients (company_name) values ('Cliente huerfano')`);
    const clients = await db.query('select count(*)::int as n from public.psi_sales_clients');
    const opps = await db.query('select count(*)::int as n from public.psi_sales_opportunities');
    assert.equal(clients.rows[0].n, 1);
    assert.equal(opps.rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('unique por nombre normalizado rechaza duplicado', async () => {
  const db = await openDb();
  try {
    await migrate(db);
    await db.exec(`insert into public.psi_sales_clients (company_name) values ('  Acme   Ltd ')`);
    await assert.rejects(
      () => db.exec(`insert into public.psi_sales_clients (company_name) values ('acme ltd')`),
    );
  } finally {
    await db.close();
  }
});

test('client_id FK ON DELETE RESTRICT', async () => {
  const db = await openDb();
  try {
    await migrate(db);
    const client = await db.query(`insert into public.psi_sales_clients (company_name) values ('FK Co') returning id`);
    const clientId = client.rows[0].id;
    await assert.rejects(
      () => db.query(`insert into public.psi_sales_opportunities (company_name, client_id) values ('FK Co', '00000000-0000-4000-8000-000000000099')`),
    );
    await db.query(
      `insert into public.psi_sales_opportunities (company_name, service_type_code, client_id) values ('FK Co', 'vigilancia', $1)`,
      [clientId],
    );
    await assert.rejects(() => db.query('delete from public.psi_sales_clients where id = $1', [clientId]));
    const orphan = await db.query(`insert into public.psi_sales_clients (company_name) values ('Orphan Co') returning id`);
    await db.query('delete from public.psi_sales_clients where id = $1', [orphan.rows[0].id]);
    const left = await db.query(`select count(*)::int as n from public.psi_sales_clients where company_name = 'Orphan Co'`);
    assert.equal(left.rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('seed: un cliente por nombre privado reciente; licitaciones fuera', async () => {
  const db = await openDb();
  try {
    await db.exec(`
      insert into public.psi_sales_opportunities (company_name, service_type_code, decision_maker_name, created_at, updated_at) values
        ('Acme Ltd', 'vigilancia', 'Viejo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        ('  ACME   LTD ', 'tecnologia', 'Nuevo', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        ('Entidad Publica', 'licitacion_publica', 'Publico', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
    `);
    await migrate(db);
    const clients = await db.query('select company_name, decision_maker_name from public.psi_sales_clients order by company_name');
    assert.equal(clients.rows.length, 1, 'N seed fixture = 1');
    assert.equal(clients.rows[0].decision_maker_name, 'Nuevo');
    const names = await db.query('select company_name from public.psi_sales_clients');
    assert.equal(names.rows.some((row) => /entidad publica/i.test(row.company_name)), false);
    const privateRow = await db.query(`select client_id from public.psi_sales_opportunities where service_type_code is distinct from 'licitacion_publica'`);
    assert.ok(privateRow.rows.every((row) => row.client_id));
    const publicRow = await db.query(`select client_id from public.psi_sales_opportunities where service_type_code = 'licitacion_publica'`);
    assert.ok(publicRow.rows.every((row) => row.client_id == null));
  } finally {
    await db.close();
  }
});

test('seed vacio es OK', async () => {
  const db = await openDb();
  try {
    await migrate(db);
    const clients = await db.query('select count(*)::int as n from public.psi_sales_clients');
    assert.equal(clients.rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('seed mezcla privada y licitacion escala (RAISE)', async () => {
  const db = await openDb();
  try {
    await db.exec(`
      insert into public.psi_sales_opportunities (company_name, service_type_code) values
        ('Acme Ltd', 'vigilancia'),
        ('acme ltd', 'licitacion_publica');
    `);
    await assert.rejects(() => migrate(db), /licitacion|mix|escala|mezcla/i);
  } finally {
    await db.close();
  }
});

// Blocker E (PR #229 RED): the real operational lifecycle is apply -> seed/backfill -> rollback.
// Migration 093's own seed+backfill assigns client_id to every private opportunity as part of
// applying 093 itself. Rollback 093 then refuses to run ("bloqueado: no se puede revertir...")
// because it fails closed on any non-null client_id -- but that guard, as written, blocks the
// migration's own backfill output, so 093 can never be rolled back for real once any private
// opportunity existed before it ran. This test runs the actual shipped migration and rollback
// files (not a hand-picked easy case) and requires the full lifecycle to succeed while
// preserving every opportunity row and never issuing a DELETE against psi_sales_opportunities.
test('rollback real: apply -> seed/backfill -> rollback preserva oportunidades y nunca hace DELETE', async () => {
  assert.equal(existsSync(rollbackUrl), true, 'rollback 093 debe existir');
  const rollbackSql = await readFile(rollbackUrl, 'utf8');
  assert.doesNotMatch(rollbackSql, /delete\s+from\s+public\.psi_sales_opportunities/i, 'el rollback nunca debe hacer DELETE de oportunidades');

  const db = await openDb();
  try {
    await db.exec(`
      insert into public.psi_sales_opportunities (id, company_name, service_type_code, decision_maker_name, created_at, updated_at) values
        ('11111111-1111-4111-8111-111111111111', 'Acme Ltd', 'vigilancia', 'Titular Acme', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        ('22222222-2222-4222-8222-222222222222', 'Entidad Publica', 'licitacion_publica', 'Titular Publico', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
    `);
    await migrate(db);

    const beforeRollback = await db.query('select id, company_name, service_type_code, client_id from public.psi_sales_opportunities order by id');
    assert.equal(beforeRollback.rows.length, 2, 'fixture proof: ambas oportunidades existen antes del rollback');
    assert.ok(beforeRollback.rows.find(r => r.id === '11111111-1111-4111-8111-111111111111').client_id, 'fixture proof: 093 backfillea client_id en la oportunidad privada (esto es lo que bloquea el rollback tal como esta hoy)');

    await assert.doesNotReject(
      () => db.exec(rollbackSql),
      'el rollback real de 093 debe poder revertirse despues de un apply -> seed/backfill real, no solo cuando la base quedo vacia',
    );

    const clientIdColumn = await db.query(`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'psi_sales_opportunities' and column_name = 'client_id'
    `);
    assert.equal(clientIdColumn.rows[0].n, 0, 'la columna client_id debe quedar eliminada tras el rollback');

    const clientsTable = await db.query(`select to_regclass('public.psi_sales_clients') as relation`);
    assert.equal(clientsTable.rows[0].relation, null, 'la tabla psi_sales_clients debe quedar eliminada tras el rollback');

    const afterRollback = await db.query('select id, company_name, service_type_code from public.psi_sales_opportunities order by id');
    assert.deepEqual(
      afterRollback.rows,
      beforeRollback.rows.map(({ client_id, ...rest }) => rest),
      'todas las filas y datos originales de psi_sales_opportunities deben preservarse exactamente (sin client_id) tras el rollback',
    );
  } finally {
    await db.close();
  }
});
