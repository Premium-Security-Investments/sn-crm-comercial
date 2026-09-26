import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// P2-1 (PR #229 review, RED-closure): the existing race regressions all drive a single PGlite
// session -- tests/siio-client-master-sibling-race.test.mjs inspects the 093 migration's SQL text
// statically, and tests/siio-client-master-sibling-race-pglite.integration.test.mjs /
// tests/siio-client-master-create-race-master-fields-pglite.integration.test.mjs both sequence one
// insert/call strictly before the next inside one connection. None of those exercise what actually
// happens when two independent sessions hold overlapping, uncommitted transactions against
// psi_persist_sales_opportunity at the same time -- the exact situation the P1 fixes in migration
// 093 (unique-index/ON CONFLICT locking, `for update` client+sibling locking, the authorized-
// sibling-set fail-closed re-check) are meant to survive. This file is that missing evidence: it
// opens two real pg.Client connections against a real PostgreSQL server, starts a transaction on
// each, and proves one session's persist call stays genuinely blocked/pending while the other is
// uncommitted, only settling once the first session commits (or, for scenario 2, failing closed).
//
// This file is entirely gated behind SIIO_PR229_PG_URL and does nothing (exit 0) if that env var
// is not set, so `npm test` (which runs everything under tests/*.test.mjs, including this file)
// stays green in every environment without a local Postgres. It never reads DATABASE_URL,
// SUPABASE_DB_URL, or any .env file, and it refuses (throws, without connecting) to run against
// anything that isn't a loopback host, so it can never accidentally point at a shared or
// production database.

const PG_URL = process.env.SIIO_PR229_PG_URL;

if (!PG_URL) {
  console.log('SIIO client master pg concurrency test skipped: SIIO_PR229_PG_URL not set (requires a real, disposable local PostgreSQL instance)');
  process.exit(0);
}

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const BLOCKED_HOST_SUBSTRINGS = ['supabase', 'amazonaws', 'neon', 'rds', 'premiumsecurity'];

function assertLoopbackOnly(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch (error) {
    throw new Error(`SIIO_PR229_PG_URL must be a valid postgres connection string: ${error.message}`);
  }
  const hostname = (parsed.hostname || '').toLowerCase();
  for (const blocked of BLOCKED_HOST_SUBSTRINGS) {
    if (hostname.includes(blocked)) {
      throw new Error(`SIIO_PR229_PG_URL host "${hostname}" contains "${blocked}" -- refusing to connect. This test must only ever run against a disposable local PostgreSQL instance, never a shared or production database.`);
    }
  }
  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new Error(`SIIO_PR229_PG_URL host "${hostname}" is not localhost/127.0.0.1/::1 -- refusing to connect (fail-closed: only loopback hosts are permitted for this concurrency test).`);
  }
}

// Fail-closed host check happens before any import that could connect eagerly.
assertLoopbackOnly(PG_URL);

const { default: pg } = await import('pg');
const { Client } = pg;

const migrationPath = new URL('../supabase/migrations/093_siio_sales_clients.sql', import.meta.url);
const MIGRATION_SQL = readFileSync(migrationPath, 'utf8');

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

const MASTER_FIELD_KEYS = ['company_name', 'customer_segment', 'regional_nombre', 'sede', 'quote_city', 'economic_sector', 'decision_maker_name', 'decision_maker_email', 'decision_maker_phone'];
const OWNER_A = '00000000-0000-0000-0000-0000000000a1';
const OWNER_B = '00000000-0000-0000-0000-0000000000b2';
const OPPORTUNITY_BASE = { owner_id: null, stage_code: 'prospecto', service_type_code: 'vigilancia' };
const OVERLAP_CHECK_DELAY_MS = 600;
const STATEMENT_TIMEOUT_MS = 10_000;

async function connect() {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  await client.query(`set statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
  return client;
}

async function resetDatabase(setupClient) {
  await setupClient.query('drop schema if exists public cascade');
  await setupClient.query('create schema public');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await setupClient.query(`drop role if exists ${role}`);
  }
  await setupClient.query('create role anon');
  await setupClient.query('create role authenticated');
  await setupClient.query('create role service_role bypassrls');
  await setupClient.query(BASE_SCHEMA);
  await setupClient.query(MIGRATION_SQL);
}

function persistQuery({ mode = 'create', opportunityId = null, actorProfileId = null, requestedClientId = null, client, opportunityExtra, authorizedSiblingIds }) {
  const opportunity = { ...OPPORTUNITY_BASE, ...opportunityExtra };
  return {
    text: `select public.psi_persist_sales_opportunity($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::uuid[]) as result`,
    values: [
      mode,
      opportunityId,
      actorProfileId,
      requestedClientId,
      JSON.stringify(opportunity),
      client === null || client === undefined ? null : JSON.stringify(client),
      authorizedSiblingIds ?? null,
    ],
  };
}

function callPersist(client, args) {
  const { text, values } = persistQuery(args);
  return client.query(text, values);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------------------------
// Scenario 1: concurrent duplicate-name create / master coherence.
// ---------------------------------------------------------------------------------------------
async function scenarioConcurrentDuplicateNameCreate(observer) {
  const clientA = await connect();
  const clientB = await connect();
  try {
    const WINNER_CLIENT = {
      company_name: 'Carrera Concurrente SA',
      customer_segment: 'cliente_nuevo',
      regional_nombre: 'Nariño',
      sede: 'Sede A',
      quote_city: 'Pasto',
      economic_sector: 'seguridad_fisica',
      decision_maker_name: 'Ana Winner',
      decision_maker_email: 'ana.winner.pg@example.test',
      decision_maker_phone: '3000000011',
    };
    const LOSER_CLIENT = {
      company_name: '  CARRERA   CONCURRENTE SA  ',
      customer_segment: 'cliente_actual',
      regional_nombre: 'Cauca',
      sede: 'Sede B',
      quote_city: 'Popayán',
      economic_sector: 'tecnologia',
      decision_maker_name: 'Beto Loser',
      decision_maker_email: 'beto.loser.pg@example.test',
      decision_maker_phone: '3000000012',
    };

    await clientA.query('begin');
    await clientB.query('begin');

    // Session A starts first and holds its transaction open (uncommitted) while we prove B blocks.
    const aPromise = callPersist(clientA, {
      client: WINNER_CLIENT,
      opportunityExtra: { ...WINNER_CLIENT },
      authorizedSiblingIds: [],
    });

    // Give A a moment to actually reach and hold its INSERT before B starts racing it.
    await sleep(150);

    let bFinished = false;
    const bPromise = callPersist(clientB, {
      client: LOSER_CLIENT,
      opportunityExtra: { ...LOSER_CLIENT },
      authorizedSiblingIds: [],
    }).then(result => {
      bFinished = true;
      return result;
    });

    const aResult = await aPromise;

    // A has now completed its own persist call but has NOT committed yet -- its row is still only
    // visible inside its own uncommitted transaction. B, blocked on the unique normalized-name
    // index / row lock A is holding, must still be pending right now.
    await sleep(OVERLAP_CHECK_DELAY_MS);
    assert.equal(
      bFinished,
      false,
      'session B (the duplicate-name loser) must still be pending while session A holds its uncommitted transaction -- if B already finished here, this is not proving real concurrent-transaction overlap, only sequential execution with extra async wrapping',
    );

    await clientA.query('commit');

    // Only now, after A's commit unblocks the lock B was waiting on, must B be allowed to finish.
    const bResult = await bPromise;
    assert.equal(bFinished, true, 'session B must complete only after session A commits');
    await clientB.query('commit');

    const winnerOpportunityId = aResult.rows[0].result.opportunity_id;
    const winnerClientId = aResult.rows[0].result.client_id;
    const loserOpportunityId = bResult.rows[0].result.opportunity_id;
    const loserClientId = bResult.rows[0].result.client_id;

    const clientCount = await observer.query(
      `select count(*)::int as n from public.psi_sales_clients where public.psi_sales_normalize_client_name(company_name) = public.psi_sales_normalize_client_name($1)`,
      [WINNER_CLIENT.company_name],
    );
    assert.equal(clientCount.rows[0].n, 1, 'a genuinely concurrent duplicate-name create race must still leave exactly one client master row');
    assert.equal(loserClientId, winnerClientId, 'the losing concurrent create must resolve to the same (winning) client_id, never create a second client');

    const masterRow = (await observer.query('select * from public.psi_sales_clients where id = $1', [winnerClientId])).rows[0];
    const opportunityRows = (await observer.query(
      'select * from public.psi_sales_opportunities where id in ($1,$2) order by id',
      [winnerOpportunityId, loserOpportunityId],
    )).rows;
    assert.equal(opportunityRows.length, 2, 'both concurrent create calls must have inserted an opportunity row');

    for (const opportunity of opportunityRows) {
      for (const field of MASTER_FIELD_KEYS) {
        assert.equal(
          opportunity[field],
          masterRow[field],
          `opportunity ${opportunity.id} field "${field}" must match the winning client master exactly under a real concurrent race (got "${opportunity[field]}", master has "${masterRow[field]}")`,
        );
      }
    }
  } finally {
    await clientA.query('rollback').catch(() => {});
    await clientB.query('rollback').catch(() => {});
    await clientA.end();
    await clientB.end();
  }
}

// ---------------------------------------------------------------------------------------------
// Scenario 2: overlapping sibling-authorization RPC must fail closed under a real concurrent race.
// ---------------------------------------------------------------------------------------------
async function scenarioOverlappingSiblingAuthorization(observer) {
  const CLIENT = {
    company_name: 'Sincronizacion Concurrente SA',
    customer_segment: 'cliente_nuevo',
    regional_nombre: 'Nariño',
    sede: 'Sede A',
    quote_city: 'Pasto',
    economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez',
    decision_maker_email: 'juan.pg@example.test',
    decision_maker_phone: '3000000021',
  };
  const CLIENT_UPDATE_FIELDS = {
    company_name: 'Hermanas Cambiada Concurrente SA',
    customer_segment: 'cliente_actual',
    regional_nombre: CLIENT.regional_nombre,
    sede: CLIENT.sede,
    quote_city: CLIENT.quote_city,
    economic_sector: CLIENT.economic_sector,
    decision_maker_name: CLIENT.decision_maker_name,
    decision_maker_email: CLIENT.decision_maker_email,
    decision_maker_phone: CLIENT.decision_maker_phone,
  };

  const setupClient = await connect();
  let clientId;
  let o1Id;
  let o2Id;
  try {
    const created1 = await callPersist(setupClient, {
      client: CLIENT,
      opportunityExtra: { ...CLIENT, owner_id: OWNER_A },
      authorizedSiblingIds: [],
    });
    clientId = created1.rows[0].result.client_id;
    o1Id = created1.rows[0].result.opportunity_id;

    const created2 = await callPersist(setupClient, {
      requestedClientId: clientId,
      client: null,
      opportunityExtra: { owner_id: OWNER_A },
      authorizedSiblingIds: [o1Id],
    });
    o2Id = created2.rows[0].result.opportunity_id;
    assert.ok(o2Id, 'setup: the second (committed) sibling opportunity must be created and linked to the shared client');
  } finally {
    await setupClient.end();
  }

  const clientA = await connect();
  const clientB = await connect();
  try {
    await clientA.query('begin');
    await clientB.query('begin');

    // Session A: attaches a brand-new sibling (O3, a different owner) to the shared client,
    // authorizing against the pre-O3 sibling set [O1, O2] -- this is the legitimate call that
    // introduces the newcomer -- and leaves its transaction open, holding the client/sibling locks.
    const aPromise = callPersist(clientA, {
      requestedClientId: clientId,
      client: null,
      opportunityExtra: { owner_id: OWNER_B, company_name: 'Intrusa Concurrente SA' },
      authorizedSiblingIds: [o1Id, o2Id],
    });

    await sleep(150);

    // Session B: concurrently tries to update O1's master field using a STALE authorized-sibling
    // snapshot taken before A's newcomer (O3) attached -- exactly the interleaving the P1 fix must
    // reject. B must block on A's locks first, then fail closed once it can see A's committed O3.
    let bSettled = false;
    let bError = null;
    const bPromise = callPersist(clientB, {
      mode: 'update',
      opportunityId: o1Id,
      requestedClientId: clientId,
      opportunityExtra: { owner_id: OWNER_A, ...CLIENT_UPDATE_FIELDS },
      client: CLIENT_UPDATE_FIELDS,
      authorizedSiblingIds: [o2Id],
    }).catch(error => {
      bError = error;
      return null;
    }).finally(() => {
      bSettled = true;
    });

    await sleep(OVERLAP_CHECK_DELAY_MS);
    assert.equal(
      bSettled,
      false,
      'session B (the stale sibling-authorization update) must still be pending while session A holds its uncommitted transaction attaching the newcomer sibling -- if B already settled here, this is not proving real concurrent-transaction overlap',
    );

    const aResult = await aPromise;
    await clientA.query('commit');
    const o3Id = aResult.rows[0].result.opportunity_id;

    await bPromise;
    assert.equal(bSettled, true, 'session B must settle only after session A commits');
    assert.ok(
      bError,
      'session B must FAIL CLOSED (reject/throw) once it observes, under lock, that the real current sibling set (including the newcomer O3 that session A committed) no longer matches its stale authorized snapshot -- silently skipping the newcomer instead of raising is not acceptable',
    );
    await clientB.query('rollback').catch(() => {});

    const rows = await observer.query(
      'select id, company_name, customer_segment from public.psi_sales_opportunities where id in ($1,$2,$3) order by id',
      [o1Id, o2Id, o3Id],
    );
    for (const row of rows.rows) {
      assert.notEqual(
        row.company_name,
        'Hermanas Cambiada Concurrente SA',
        `opportunity ${row.id} must not have session B's rejected master-field change applied -- a fail-closed RPC call must roll back completely`,
      );
    }
  } finally {
    await clientA.query('rollback').catch(() => {});
    await clientB.query('rollback').catch(() => {});
    await clientA.end();
    await clientB.end();
  }
}

const setupClient = await connect();
const observer = await connect();
try {
  await resetDatabase(setupClient);
  await scenarioConcurrentDuplicateNameCreate(observer);
  await scenarioOverlappingSiblingAuthorization(observer);
} finally {
  await setupClient.end();
  await observer.end();
}

console.log('SIIO client master real-PostgreSQL concurrency (two independent connections) regression passed');
