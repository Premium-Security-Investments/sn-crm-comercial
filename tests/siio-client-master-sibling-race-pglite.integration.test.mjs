import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// P1-1 (PR #229 review, RED): requireSiblingOpportunityAuthorization (server/index.js) reads the
// sibling set of a client master via a plain REST GET, authorizes the actor against that set, and
// only afterwards calls psi_persist_sales_opportunity in a *separate* HTTP round-trip. Nothing ties
// the authorized snapshot to the transaction that performs the sync: if a sibling is attached to the
// same client_id after the authorization read but before the RPC call runs -- exactly the
// interleaving a second, concurrent request produces -- psi_persist_sales_opportunity's
// unconditional "update ... from psi_sales_clients c where c.id = v_client_id and o.client_id =
// v_client_id" happily pushes the master-field change onto that newcomer sibling too, even though
// nobody has ever authorized the acting profile against its owner.
//
// This test drives the real migration 093 RPC directly and checks the invariant by reading the rows
// PGlite actually persisted -- not by asserting on which HTTP calls were made. It reproduces the
// interleaving deterministically by inserting the newcomer sibling, via a raw SQL statement, in
// between creating the snapshot the API would have authorized and invoking the sync RPC. That
// ordering is the same one a genuine second, concurrent session produces under PostgreSQL's default
// READ COMMITTED isolation: an UPDATE only ever operates on whatever rows are committed and visible
// at the instant it runs, regardless of which session's write got there first, so a single PGlite
// connection driven in this order exercises exactly the statement-time visibility a true race would.
const migrationPath = new URL('../supabase/migrations/093_siio_sales_clients.sql', import.meta.url);

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

const OWNER_A = '00000000-0000-0000-0000-000000000001';
const OWNER_B = '00000000-0000-0000-0000-000000000002';

const CLIENT = {
  company_name: 'Sincronizacion Racial SA',
  customer_segment: 'cliente_nuevo',
  regional_nombre: 'Nariño',
  sede: 'Sede A',
  quote_city: 'Pasto',
  economic_sector: 'seguridad_fisica',
  decision_maker_name: 'Juan Perez',
  decision_maker_email: 'juan@example.test',
  decision_maker_phone: '3000000000',
};
const OPPORTUNITY = { owner_id: OWNER_A, stage_code: 'prospecto', service_type_code: 'vigilancia' };

async function callPersist(db, { mode = 'create', opportunityId = null, actorProfileId = null, requestedClientId = null, opportunity = OPPORTUNITY, client = CLIENT, authorizedSiblingIds = undefined }) {
  if (authorizedSiblingIds !== undefined) {
    return db.query(
      `select public.psi_persist_sales_opportunity($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::uuid[]) as result`,
      [mode, opportunityId, actorProfileId, requestedClientId, JSON.stringify(opportunity), client === null ? null : JSON.stringify(client), authorizedSiblingIds],
    );
  }
  return db.query(
    `select public.psi_persist_sales_opportunity($1,$2,$3,$4,$5::jsonb,$6::jsonb) as result`,
    [mode, opportunityId, actorProfileId, requestedClientId, JSON.stringify(opportunity), client === null ? null : JSON.stringify(client)],
  );
}

async function insertIntruderSibling(db, clientId, ownerId) {
  const { rows } = await db.query(
    `insert into public.psi_sales_opportunities (owner_id, company_name, service_type_code, stage_code, client_id)
     values ($1, 'Intrusa SA', 'vigilancia', 'prospecto', $2) returning id, company_name`,
    [ownerId, clientId],
  );
  return rows[0];
}

{
  const db = await migratedDb();
  try {
    // O1: the opportunity whose owner (owner-a) will edit a master field, triggering the sibling
    // sync inside psi_persist_sales_opportunity.
    const created1 = await callPersist(db, {
      opportunity: { ...OPPORTUNITY, company_name: 'Hermanas Carrera SA' },
      client: { ...CLIENT, company_name: 'Hermanas Carrera SA' },
    });
    const clientId = created1.rows[0].result.client_id;
    const o1Id = created1.rows[0].result.opportunity_id;

    // O2: a sibling that legitimately existed before the race -- also owner-a's, so the
    // authorization snapshot the API would have taken at this point is fully authorized.
    const created2 = await callPersist(db, { opportunity: { ...OPPORTUNITY }, requestedClientId: clientId, client: null });
    const o2Id = created2.rows[0].result.opportunity_id;
    assert.ok(o2Id, 'setup: the second opportunity must be created and linked to the shared client');

    // Race: a second, concurrent request attaches a brand-new sibling under a *different* owner
    // (owner-b) to the same client, landing after the authorization snapshot would have been taken
    // and before the sync RPC call below runs. Nobody has ever authorized owner-a against owner-b.
    const intruder = await insertIntruderSibling(db, clientId, OWNER_B);

    let threw = false;
    try {
      await callPersist(db, {
        mode: 'update',
        opportunityId: o1Id,
        requestedClientId: clientId,
        opportunity: { ...OPPORTUNITY, company_name: 'Hermanas Carrera Actualizada SA', customer_segment: 'cliente_actual' },
        client: { ...CLIENT, company_name: 'Hermanas Carrera Actualizada SA', customer_segment: 'cliente_actual' },
        authorizedSiblingIds: [o2Id],
      });
    } catch (error) {
      threw = true;
    }

    // The finding requires the call to fail/rollback outright when the authorized sibling snapshot
    // is stale -- not to silently skip the unauthorized newcomer while still applying the rest.
    assert.ok(
      threw,
      'a master-field sync must fail-closed (reject the whole call, rolling back) when a sibling attaches to the client between authorization time and the RPC call -- the RPC must never silently sync onto a sibling nobody authorized',
    );

    const rows = await db.query(
      'select id, company_name from public.psi_sales_opportunities where id in ($1,$2,$3) order by id',
      [o1Id, o2Id, intruder.id],
    );
    for (const row of rows.rows) {
      assert.notEqual(
        row.company_name,
        'Hermanas Carrera Actualizada SA',
        `opportunity ${row.id} must not have been updated -- a rejected call must roll back completely, not partially apply the sync`,
      );
    }
  } finally {
    await db.close();
  }
}

console.log('SIIO client master sibling authorization race (fail-closed) regression passed');
