import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// P1-3 / P2-1 (PR #229 review, RED): the existing atomicity suite's "duplicate-name race" block
// only asserts that a second concurrent create resolves to a single client row -- it never checks
// what ends up written on the *opportunity* rows themselves, and it explicitly documents that it is
// "sequenced deterministically" rather than a real race. That is an insufficient reproduction of
// this finding: two sequential calls that happen to both succeed are not evidence about what a real
// interleaving does to data, only about client-row uniqueness.
//
// The actual bug: in psi_persist_sales_opportunity's 'create' mode, the newly-inserted opportunity
// row's master fields (company_name, customer_segment, regional_nombre, sede, quote_city,
// economic_sector, decision_maker_*) are populated straight from p_opportunity/p_client -- i.e.
// from whatever THIS caller submitted -- never from the client master that request actually ends up
// linked to. The 'update' mode has an explicit block that copies the resolved client's fields back
// onto the opportunity when syncing; 'create' has no equivalent. So when two concurrent creates use
// the same canonical company name with *different* other master-field data and no explicit
// client_id, the loser's INSERT ... ON CONFLICT DO NOTHING branch resolves to the winner's already-
// committed client_id, but the loser's opportunity row keeps its own (losing) submitted field
// values -- which can now permanently disagree with the one client master both opportunities
// reference.
//
// This test forces that ON CONFLICT branch deterministically rather than via two live connections
// (PGlite exposes a single session, so true concurrency cannot be reproduced), but it is not "two
// equivalent sequential calls": under PostgreSQL's default READ COMMITTED isolation, a genuinely
// concurrent second session's "INSERT ... ON CONFLICT DO NOTHING" blocks on the first session's
// uncommitted unique-index entry and, once that first session commits, unblocks and observes
// exactly the same "0 rows inserted, conflicting row now committed" outcome that a sequential second
// call produces -- the interleaving point this test reproduces (call 2 running strictly after call
// 1's commit) is the same database-visible state a real race resolves to for this specific conflict
// branch, and the invariant under test (both opportunities must carry the *winning* master's field
// values, not their own submitted ones) does not depend on which session's clock started first.
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

const MASTER_FIELD_KEYS = ['company_name', 'customer_segment', 'regional_nombre', 'sede', 'quote_city', 'economic_sector', 'decision_maker_name', 'decision_maker_email', 'decision_maker_phone'];

// Same canonical normalized name ("carrera real sa"), deliberately different casing/spacing (as a
// real duplicate submission would look) and deliberately DIFFERENT other master-field data, so a
// mismatch is unambiguous.
const WINNER_CLIENT = {
  company_name: 'Carrera Real SA',
  customer_segment: 'cliente_nuevo',
  regional_nombre: 'Nariño',
  sede: 'Sede A',
  quote_city: 'Pasto',
  economic_sector: 'seguridad_fisica',
  decision_maker_name: 'Ana Winner',
  decision_maker_email: 'ana.winner@example.test',
  decision_maker_phone: '3000000001',
};
const LOSER_CLIENT = {
  company_name: '  CARRERA   REAL SA  ',
  customer_segment: 'cliente_actual',
  regional_nombre: 'Cauca',
  sede: 'Sede B',
  quote_city: 'Popayán',
  economic_sector: 'tecnologia',
  decision_maker_name: 'Beto Loser',
  decision_maker_email: 'beto.loser@example.test',
  decision_maker_phone: '3000000002',
};
const OPPORTUNITY_BASE = { owner_id: null, stage_code: 'prospecto', service_type_code: 'vigilancia' };

// Destination client for the relink scenario below: already has one committed opportunity carrying
// its canonical master fields.
const DESTINATION_CLIENT = {
  company_name: 'Destino Total SA',
  customer_segment: 'cliente_actual',
  regional_nombre: 'Antioquia',
  sede: 'Sede Norte',
  quote_city: 'Medellín',
  economic_sector: 'logistica',
  decision_maker_name: 'Diana Destino',
  decision_maker_email: 'diana.destino@example.test',
  decision_maker_phone: '3100000001',
};
// Unrelated client/opportunity that will later be relinked onto DESTINATION_CLIENT.
const UNRELATED_CLIENT = {
  company_name: 'Unrelated Corp SA',
  customer_segment: 'cliente_nuevo',
  regional_nombre: 'Valle',
  sede: 'Sede Sur',
  quote_city: 'Cali',
  economic_sector: 'retail',
  decision_maker_name: 'Uriel Unrelated',
  decision_maker_email: 'uriel.unrelated@example.test',
  decision_maker_phone: '3200000002',
};
// Deliberately conflicting raw master-field values submitted as p_opportunity on the relink call --
// none of these must survive onto the relinked row.
const CONFLICTING_RAW_FIELDS = {
  company_name: 'Conflicting Raw Co',
  customer_segment: 'cliente_perdido',
  regional_nombre: 'Choco',
  sede: 'Sede Fantasma',
  quote_city: 'Quibdó',
  economic_sector: 'mineria',
  decision_maker_name: 'Raul Raw',
  decision_maker_email: 'raul.raw@example.test',
  decision_maker_phone: '3300000003',
};

async function callPersist(db, { mode = 'create', opportunityId = null, requestedClientId = null, client, opportunityExtra, authorizedSiblingIds = null }) {
  const opportunity = { ...OPPORTUNITY_BASE, ...opportunityExtra };
  return db.query(
    `select public.psi_persist_sales_opportunity($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::uuid[]) as result`,
    [
      mode,
      opportunityId,
      null,
      requestedClientId,
      JSON.stringify(opportunity),
      client === null ? null : JSON.stringify(client),
      authorizedSiblingIds,
    ],
  );
}

{
  const db = await migratedDb();
  try {
    // Call 1 ("winner"): commits first, its INSERT into psi_sales_clients succeeds outright. Real
    // HTTP new-name creates never send `null` here -- prepareClientForNewOpportunity's no-
    // requestedClientId branch returns `[]` (an authorized-empty-set claim), not a null bypass of
    // the RPC's sibling re-check -- so this test must send the same `[]` a live request sends.
    const winnerResult = await callPersist(db, {
      client: WINNER_CLIENT,
      opportunityExtra: { ...WINNER_CLIENT },
      authorizedSiblingIds: [],
    });
    const winnerOpportunityId = winnerResult.rows[0].result.opportunity_id;
    const winnerClientId = winnerResult.rows[0].result.client_id;

    // Call 2 ("loser"): submitted independently, unaware call 1 already won -- its own INSERT into
    // psi_sales_clients hits the unique normalized-name index and takes the ON CONFLICT DO NOTHING
    // branch, resolving v_client_id to the winner's already-committed row. Same real-path
    // `authorizedSiblingIds: []` as the winner: this caller also believes it is creating a brand
    // new client with no siblings yet, so the RPC must re-check that empty claim against the
    // locked current sibling set it actually resolves to (the winner's opportunity) once the
    // ON CONFLICT branch attaches it there instead of null-bypassing the check entirely.
    const loserResult = await callPersist(db, {
      client: LOSER_CLIENT,
      opportunityExtra: { ...LOSER_CLIENT },
      authorizedSiblingIds: [],
    });
    const loserOpportunityId = loserResult.rows[0].result.opportunity_id;
    const loserClientId = loserResult.rows[0].result.client_id;

    // Invariant 1: exactly one client master row for the canonical name, and both opportunities
    // reference it.
    const clients = await db.query(`select count(*)::int as n from public.psi_sales_clients where public.psi_sales_normalize_client_name(company_name) = public.psi_sales_normalize_client_name($1)`, [WINNER_CLIENT.company_name]);
    assert.equal(clients.rows[0].n, 1, 'a duplicate-name create race must leave exactly one client master row');
    assert.equal(loserClientId, winnerClientId, 'the losing create must resolve to the same (winning) client_id, never create a second client');

    // Invariant 2 (the finding under test): BOTH opportunities' master fields must exactly match
    // the winning, persisted client master -- never their own submitted (possibly losing) values.
    const masterRow = (await db.query('select * from public.psi_sales_clients where id = $1', [winnerClientId])).rows[0];
    const opportunityRows = (await db.query(
      'select * from public.psi_sales_opportunities where id in ($1,$2) order by id',
      [winnerOpportunityId, loserOpportunityId],
    )).rows;
    assert.equal(opportunityRows.length, 2, 'both create calls must have inserted an opportunity row');

    for (const opportunity of opportunityRows) {
      for (const field of MASTER_FIELD_KEYS) {
        assert.equal(
          opportunity[field],
          masterRow[field],
          `opportunity ${opportunity.id} field "${field}" must match the winning client master exactly (got "${opportunity[field]}", master has "${masterRow[field]}") -- an opportunity created during a duplicate-name race must never keep its own submitted master-field data once a different client master won`,
        );
      }
    }
  } finally {
    await db.close();
  }
}

// Relink/update scenario: an update that moves an unrelated opportunity onto an already-existing
// destination client (p_client null -- no client-field sync requested) must still construct every
// master-owned field on the opportunity from the persisted, locked destination client, never from
// this call's raw p_opportunity payload. 'update' mode's own client-field-sync block only fires when
// p_client is provided, so a pure relink (p_client null) currently falls through to
// jsonb_populate_record(v_existing, p_opportunity), which keeps whatever conflicting master-field
// values the caller submitted -- the same class of bug as the create-race above, but reachable via
// relink instead of a name collision.
{
  const db = await migratedDb();
  try {
    // Destination client + opportunity: canonical master fields already committed.
    const destinationResult = await callPersist(db, {
      client: DESTINATION_CLIENT,
      opportunityExtra: { ...DESTINATION_CLIENT },
    });
    const destinationOpportunityId = destinationResult.rows[0].result.opportunity_id;
    const destinationClientId = destinationResult.rows[0].result.client_id;

    // Unrelated target client + opportunity, sharing none of the destination's data.
    const targetResult = await callPersist(db, {
      client: UNRELATED_CLIENT,
      opportunityExtra: { ...UNRELATED_CLIENT },
    });
    const targetOpportunityId = targetResult.rows[0].result.opportunity_id;

    // Relink the target opportunity onto the destination client: p_client is null, p_requested_
    // client_id points at the destination, the authorized sibling snapshot is exactly the
    // destination's one pre-existing opportunity, and p_opportunity carries deliberately
    // conflicting raw values for every master-owned field.
    await callPersist(db, {
      mode: 'update',
      opportunityId: targetOpportunityId,
      requestedClientId: destinationClientId,
      client: null,
      opportunityExtra: { ...CONFLICTING_RAW_FIELDS },
      authorizedSiblingIds: [destinationOpportunityId],
    });

    const destinationMaster = (await db.query('select * from public.psi_sales_clients where id = $1', [destinationClientId])).rows[0];
    const relinkedOpportunity = (await db.query('select * from public.psi_sales_opportunities where id = $1', [targetOpportunityId])).rows[0];

    assert.equal(relinkedOpportunity.client_id, destinationClientId, 'relinking must set the opportunity client_id to the destination client');

    for (const field of MASTER_FIELD_KEYS) {
      assert.equal(
        relinkedOpportunity[field],
        destinationMaster[field],
        `relinked opportunity ${targetOpportunityId} field "${field}" must match the destination client master exactly (got "${relinkedOpportunity[field]}", master has "${destinationMaster[field]}") -- an update/relink must construct master-owned fields from the persisted, locked destination client, never keep the raw p_opportunity payload`,
      );
    }
  } finally {
    await db.close();
  }
}

console.log('SIIO client master create-race winning-master-fields regression passed');
