import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration093 = readFileSync(new URL('../supabase/migrations/093_siio_sales_clients.sql', import.meta.url), 'utf8');
const NBSP = '\u00a0';

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

test('093 usa una normalizacion canonica unica en seed y backfill', async () => {
  const db = await openDb();
  try {
    await db.exec(`
      insert into public.psi_sales_opportunities
        (company_name, service_type_code, decision_maker_name, created_at, updated_at)
      values
        ('  Acme   Ltd  ', 'vigilancia', 'Viejo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        ('Acme${NBSP}Ltd', 'tecnologia', 'Intermedio', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        ('ACME\t\nLTD', 'vigilancia', 'MasNuevo', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
    `);
    await db.exec(migration093);

    const clients = await db.query('select id, decision_maker_name from public.psi_sales_clients');
    assert.equal(clients.rows.length, 1);
    assert.equal(clients.rows[0].decision_maker_name, 'MasNuevo');

    const opportunities = await db.query('select client_id from public.psi_sales_opportunities');
    assert.equal(opportunities.rows.length, 3);
    assert.ok(opportunities.rows.every((row) => row.client_id === clients.rows[0].id));
  } finally {
    await db.close();
  }
});

test('093 unique rechaza variantes NBSP, tab, newline, mayusculas y espacios repetidos', async () => {
  const db = await openDb();
  try {
    await db.exec(migration093);
    await db.exec("insert into public.psi_sales_clients (company_name) values ('Acme Ltd')");

    for (const variant of [
      `ACME${NBSP}LTD`,
      'Acme\tLtd',
      'Acme\nLtd',
      '  acme    ltd  ',
    ]) {
      await assert.rejects(
        () => db.query('insert into public.psi_sales_clients (company_name) values ($1)', [variant]),
        /duplicate|unique|constraint/i,
        `debe rechazar variante canonica: ${JSON.stringify(variant)}`,
      );
    }
  } finally {
    await db.close();
  }
});
