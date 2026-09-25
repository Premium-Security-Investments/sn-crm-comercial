import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Blocker B (PR #229 RED): migration 093 only enforces the licitacion_publica/client_id
// exclusion at seed time (a one-off DO block). Nothing in the schema stops a later direct
// INSERT or UPDATE from pairing service_type_code='licitacion_publica' with a non-null
// client_id -- there is no CHECK constraint or trigger. This is a database-level fail-closed
// gap that 093_siio_sales_clients.sql itself must close (single migration, no separate patch
// file).
const migrationPath = new URL('../supabase/migrations/093_siio_sales_clients.sql', import.meta.url);

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

async function migratedDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    ${BASE_SCHEMA}
  `);
  await db.exec(readFileSync(migrationPath, 'utf8'));
  return db;
}

test('INSERT directo licitacion_publica con client_id no nulo se rechaza', async () => {
  const db = await migratedDb();
  try {
    const client = await db.query(`insert into public.psi_sales_clients (company_name) values ('Cliente Licitacion') returning id`);
    await assert.rejects(
      () => db.exec(`insert into public.psi_sales_opportunities (company_name, service_type_code, client_id) values ('Entidad Publica', 'licitacion_publica', '${client.rows[0].id}')`),
      /licitacion|client_id|check|constraint/i,
      'un INSERT directo no debe poder crear una oportunidad licitacion_publica con client_id asignado',
    );
  } finally {
    await db.close();
  }
});

test('UPDATE directo que asigna client_id a una oportunidad licitacion_publica existente se rechaza', async () => {
  const db = await migratedDb();
  try {
    const client = await db.query(`insert into public.psi_sales_clients (company_name) values ('Cliente Licitacion 2') returning id`);
    const opp = await db.query(`insert into public.psi_sales_opportunities (company_name, service_type_code) values ('Entidad Publica 2', 'licitacion_publica') returning id`);
    await assert.rejects(
      () => db.exec(`update public.psi_sales_opportunities set client_id = '${client.rows[0].id}' where id = '${opp.rows[0].id}'`),
      /licitacion|client_id|check|constraint/i,
      'un UPDATE directo no debe poder asignar client_id a una oportunidad licitacion_publica',
    );
  } finally {
    await db.close();
  }
});

test('UPDATE directo que cambia service_type_code a licitacion_publica mientras client_id sigue asignado se rechaza', async () => {
  const db = await migratedDb();
  try {
    const client = await db.query(`insert into public.psi_sales_clients (company_name) values ('Cliente Privado') returning id`);
    const opp = await db.query(
      `insert into public.psi_sales_opportunities (company_name, service_type_code, client_id) values ('Empresa Privada', 'vigilancia', $1) returning id`,
      [client.rows[0].id],
    );
    await assert.rejects(
      () => db.exec(`update public.psi_sales_opportunities set service_type_code = 'licitacion_publica' where id = '${opp.rows[0].id}'`),
      /licitacion|client_id|check|constraint/i,
      'un UPDATE directo no debe poder convertir una oportunidad en licitacion_publica mientras conserva un client_id',
    );
  } finally {
    await db.close();
  }
});

test('combinaciones validas siguen permitidas (control, no debe romper con la guardia)', async () => {
  const db = await migratedDb();
  try {
    const client = await db.query(`insert into public.psi_sales_clients (company_name) values ('Cliente Valido') returning id`);
    await assert.doesNotReject(
      () => db.query(`insert into public.psi_sales_opportunities (company_name, service_type_code, client_id) values ('Empresa Valida', 'vigilancia', $1)`, [client.rows[0].id]),
      'oportunidad privada con client_id debe seguir permitida',
    );
    await assert.doesNotReject(
      () => db.query(`insert into public.psi_sales_opportunities (company_name, service_type_code, client_id) values ('Entidad Valida', 'licitacion_publica', null)`),
      'oportunidad licitacion_publica sin client_id debe seguir permitida',
    );
  } finally {
    await db.close();
  }
});
