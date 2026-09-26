import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// P1-2 (PR #229 review, RED): migration 093 and its rollback are not idempotent.
//  - Re-applying 093 on an already-migrated database fails: "alter table ... add constraint
//    psi_sales_opportunities_public_tender_client_check check (...)" has no IF NOT EXISTS guard
//    (PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS for check constraints), so the second apply
//    aborts with "constraint ... already exists".
//  - Re-running the rollback on an already-rolled-back database fails: "lock table public.
//    psi_sales_clients in access exclusive mode" targets a table the first rollback already
//    dropped, so the second rollback aborts with "relation ... does not exist".
// Both are exactly the kind of operational hazard an operator hits by re-running a migration/
// rollback script after a partial failure or a duplicate deploy trigger. Across every scenario, no
// row of psi_sales_opportunities may ever be deleted.
const migrationPath = new URL('../supabase/migrations/093_siio_sales_clients.sql', import.meta.url);
const rollbackPath = new URL('../supabase/rollbacks/093_siio_sales_clients_rollback.sql', import.meta.url);

const BASE_SCHEMA = `
  create table public.psi_sales_opportunities (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid,
    company_name text,
    economic_sector text,
    decision_maker_name text,
    decision_maker_email text,
    decision_maker_phone text,
    quote_city text,
    quote_date date,
    offer_value numeric,
    service_type_code text,
    stage_code text,
    loss_reason_code text,
    loss_notes text,
    next_action_at timestamptz,
    expected_close_date date,
    commission_rate numeric,
    regional_nombre text,
    sede text,
    tipo_producto_original text,
    observaciones text,
    customer_segment text,
    external_source text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
`;

async function seedOpportunities(db) {
  await db.exec(`
    insert into public.psi_sales_opportunities
      (owner_id, company_name, service_type_code, stage_code, customer_segment, regional_nombre)
    values
      (null, 'Seed Privada Uno SA', 'vigilancia', 'prospecto', 'cliente_nuevo', 'Nariño'),
      (null, 'Seed Privada Dos SA', 'escolta', 'prospecto', 'cliente_actual', 'Cauca'),
      (null, 'Seed Publica Tres SA', 'licitacion_publica', 'prospecto', 'cliente_nuevo', 'Nariño');
  `);
}

async function baseDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    ${BASE_SCHEMA}
  `);
  await seedOpportunities(db);
  return db;
}

async function opportunityIds(db) {
  const { rows } = await db.query('select id from public.psi_sales_opportunities order by id');
  return rows.map(row => row.id).sort();
}

// Applying migration 093 twice on the same database must be idempotent.
{
  const db = await baseDb();
  try {
    const before = await opportunityIds(db);
    await db.exec(readFileSync(migrationPath, 'utf8'));

    await assert.doesNotReject(
      () => db.exec(readFileSync(migrationPath, 'utf8')),
      'applying migration 093 a second time on an already-migrated database must be idempotent, not fail',
    );

    const after = await opportunityIds(db);
    assert.deepEqual(after, before, 'no opportunity may be deleted by re-applying migration 093 twice');
  } finally {
    await db.close();
  }
}

// Rolling back migration 093 twice on the same database must be idempotent.
{
  const db = await baseDb();
  try {
    await db.exec(readFileSync(migrationPath, 'utf8'));
    const before = await opportunityIds(db);
    await db.exec(readFileSync(rollbackPath, 'utf8'));

    await assert.doesNotReject(
      () => db.exec(readFileSync(rollbackPath, 'utf8')),
      'rolling back migration 093 a second time on an already-rolled-back database must be idempotent, not fail',
    );

    const after = await opportunityIds(db);
    assert.deepEqual(after, before, 'no opportunity may be deleted by re-running the 093 rollback twice');
  } finally {
    await db.close();
  }
}

// A full apply -> rollback -> apply cycle must leave migration 093 fully re-appliable, with the
// client master rebuilt from current opportunity data and no opportunity ever deleted.
{
  const db = await baseDb();
  try {
    const before = await opportunityIds(db);
    await db.exec(readFileSync(migrationPath, 'utf8'));
    await db.exec(readFileSync(rollbackPath, 'utf8'));

    await assert.doesNotReject(
      () => db.exec(readFileSync(migrationPath, 'utf8')),
      'apply -> rollback -> apply must leave migration 093 re-appliable, not fail',
    );

    const after = await opportunityIds(db);
    assert.deepEqual(after, before, 'no opportunity may be deleted across an apply -> rollback -> apply cycle');

    const clientCount = await db.query('select count(*)::int as n from public.psi_sales_clients');
    const privateCompanyCount = await db.query(`
      select count(distinct public.psi_sales_normalize_client_name(company_name))::int as n
      from public.psi_sales_opportunities
      where service_type_code is distinct from 'licitacion_publica'
    `);
    assert.equal(
      clientCount.rows[0].n,
      privateCompanyCount.rows[0].n,
      'the client master must be fully rebuilt (one row per distinct private company name) after an apply -> rollback -> apply cycle',
    );
  } finally {
    await db.close();
  }
}

console.log('SIIO client master migration/rollback idempotency regression passed');
