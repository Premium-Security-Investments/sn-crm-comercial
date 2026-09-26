import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Blocker D (PR #229 RED): api/[...path].js persists client-master + opportunity changes as a
// sequence of direct REST writes (create/update psi_sales_clients, then insert/update
// psi_sales_opportunities, then sync sibling opportunities) -- see resolveClientForNewOpportunity
// / updateClientMasterAndSync / commitClientForOpportunityUpdate. There is no transaction
// spanning these calls: if the opportunity write fails after the client master write succeeded,
// the client master is left behind with no opportunity referencing it, and two racing
// create-with-new-name calls can each independently decide "no existing client" and both insert,
// relying only on the unique index to fail one of them after the fact (not tested, not handled).
// The fix must land inside 093_siio_sales_clients.sql itself (single migration, no separate patch
// file) as a single transactional RPC, public.psi_persist_sales_opportunity, so the API can
// replace its direct write sequence with exactly one atomic call.
const migrationPath = new URL('../supabase/migrations/093_siio_sales_clients.sql', import.meta.url);

{
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

  const RPC_SIGNATURE = 'public.psi_persist_sales_opportunity(text,uuid,uuid,uuid,jsonb,jsonb,uuid[])';
  const CLIENT = {
    company_name: 'Fuerza Atomica SA',
    customer_segment: 'cliente_nuevo',
    regional_nombre: 'Nariño',
    sede: 'Sede A',
    quote_city: 'Pasto',
    economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez',
    decision_maker_email: 'juan@example.test',
    decision_maker_phone: '3000000000',
  };
  const OPPORTUNITY = {
    owner_id: null,
    stage_code: 'prospecto',
    service_type_code: 'vigilancia',
  };

  // authorizedSiblingIds defaults to NULL: these are trusted setup/integration calls that bypass
  // the API's server-authorized sibling-snapshot check, exactly like a trusted/service_role 6-arg
  // caller would. Only the sibling-sync test below passes the real, exact snapshot array.
  async function callPersist(db, { mode = 'create', opportunityId = null, actorProfileId = null, requestedClientId = null, opportunity = OPPORTUNITY, client = CLIENT, authorizedSiblingIds = null }) {
    return db.query(
      `select public.psi_persist_sales_opportunity($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::uuid[]) as result`,
      [mode, opportunityId, actorProfileId, requestedClientId, JSON.stringify(opportunity), client === null ? null : JSON.stringify(client), authorizedSiblingIds],
    );
  }

  // The RPC contract must exist with the expected atomic create/update signature.
  {
    const db = await migratedDb();
    try {
      const { rows } = await db.query(`select to_regprocedure('${RPC_SIGNATURE}') as proc`);
      assert.notEqual(rows[0].proc, null, `093 must define ${RPC_SIGNATURE}`);
    } finally {
      await db.close();
    }
  }

  // Complete rollback when the final opportunity-write step fails: the client master created
  // earlier in the same call must not survive.
  {
    const db = await migratedDb();
    try {
      await db.exec(`
        create function public.test_fail_opportunity_insert() returns trigger language plpgsql as $$
        begin
          if new.company_name = 'Force Fail Co' then raise exception 'forced opportunity insert failure'; end if;
          return new;
        end;
        $$;
        create trigger test_fail_opportunity_insert before insert on public.psi_sales_opportunities
          for each row execute function public.test_fail_opportunity_insert();
      `);
      await assert.rejects(
        () => callPersist(db, { opportunity: { ...OPPORTUNITY, company_name: 'Force Fail Co' }, client: { ...CLIENT, company_name: 'Force Fail Co' } }),
        /forced opportunity insert failure/i,
        'a forced failure on the final opportunity insert must abort the whole call',
      );
      const clients = await db.query(`select count(*)::int as n from public.psi_sales_clients where company_name = 'Force Fail Co'`);
      assert.equal(clients.rows[0].n, 0, 'the client master created earlier in the same call must be rolled back, not left orphaned');
      const opportunities = await db.query(`select count(*)::int as n from public.psi_sales_opportunities`);
      assert.equal(opportunities.rows[0].n, 0, 'no opportunity row may survive a rolled-back call');
    } finally {
      await db.exec('drop trigger if exists test_fail_opportunity_insert on public.psi_sales_opportunities;');
      await db.close();
    }
  }

  // Updating client master data synchronizes every sibling opportunity in the same statement.
  {
    const db = await migratedDb();
    try {
      // This test exercises the real sibling-authorization mechanism (not the trusted bypass), so
      // each call passes the exact server-authorized snapshot a real API caller would have
      // computed immediately beforehand.
      const created = await callPersist(db, {
        opportunity: { ...OPPORTUNITY, company_name: 'Hermanas SA' },
        client: { ...CLIENT, company_name: 'Hermanas SA' },
        authorizedSiblingIds: [],
      });
      const clientId = created.rows[0].result.client_id;
      const firstOpportunityId = created.rows[0].result.opportunity_id;
      const second = await callPersist(db, {
        opportunity: { ...OPPORTUNITY, company_name: 'Hermanas SA' },
        requestedClientId: clientId,
        client: null,
        authorizedSiblingIds: [firstOpportunityId],
      });
      const secondOpportunityId = second.rows[0].result.opportunity_id;

      await callPersist(db, {
        mode: 'update',
        opportunityId: firstOpportunityId,
        requestedClientId: clientId,
        opportunity: { ...OPPORTUNITY, company_name: 'Hermanas Actualizada SA', customer_segment: 'cliente_actual' },
        client: { ...CLIENT, company_name: 'Hermanas Actualizada SA', customer_segment: 'cliente_actual' },
        authorizedSiblingIds: [secondOpportunityId],
      });

      const siblings = await db.query(
        'select id, company_name, customer_segment from public.psi_sales_opportunities where id in ($1,$2) order by id',
        [firstOpportunityId, secondOpportunityId],
      );
      assert.equal(siblings.rows.length, 2);
      for (const row of siblings.rows) {
        assert.equal(row.company_name, 'Hermanas Actualizada SA');
        assert.equal(row.customer_segment, 'cliente_actual');
      }
    } finally {
      await db.close();
    }
  }

  // A public tender always detaches the client at the database transaction boundary.
  {
    const db = await migratedDb();
    try {
      const created = await callPersist(db, {
        opportunity: { ...OPPORTUNITY, company_name: 'Privada a Publica SA' },
        client: { ...CLIENT, company_name: 'Privada a Publica SA' },
      });
      const opportunityId = created.rows[0].result.opportunity_id;
      await callPersist(db, {
        mode: 'update',
        opportunityId,
        requestedClientId: created.rows[0].result.client_id,
        opportunity: { ...OPPORTUNITY, company_name: 'Licitacion Publica', service_type_code: 'licitacion_publica' },
        client: null,
      });
      const { rows } = await db.query('select client_id from public.psi_sales_opportunities where id = $1', [opportunityId]);
      assert.equal(rows[0].client_id, null);
    } finally {
      await db.close();
    }
  }

  // Duplicate-name race, sequenced deterministically (PGlite has a single connection, so a true
  // concurrent race cannot be reproduced; two immediately-sequential create calls for the same
  // normalized name is the deterministic equivalent this suite can drive). The result must be
  // exactly one client master and no partial/duplicate state, however the second call resolves.
  {
    const db = await migratedDb();
    try {
      const first = await callPersist(db, { opportunity: { ...OPPORTUNITY, company_name: 'Carrera SA' }, client: { ...CLIENT, company_name: 'Carrera SA' } });
      const firstClientId = first.rows[0].result.client_id;
      assert.ok(firstClientId, 'first create call must resolve a client_id');

      let secondClientId = null;
      try {
        const second = await callPersist(db, { opportunity: { ...OPPORTUNITY, company_name: 'Carrera SA' }, client: { ...CLIENT, company_name: 'Carrera SA' } });
        secondClientId = second.rows[0].result.client_id;
      } catch (error) {
        assert.match(String(error?.message || error), /duplicate|unique|existente/i, 'a rejected second call must fail with a clean duplicate-name error, not an unrelated crash');
      }

      const clients = await db.query(`select count(*)::int as n from public.psi_sales_clients where company_name = 'Carrera SA'`);
      assert.equal(clients.rows[0].n, 1, 'a duplicate-name race must never leave more than one client master row');

      if (secondClientId) {
        assert.equal(secondClientId, firstClientId, 'if the second call succeeds it must resolve to the same client, never create a second one');
      }

      const opportunities = await db.query(`select client_id from public.psi_sales_opportunities`);
      for (const row of opportunities.rows) {
        assert.equal(row.client_id, firstClientId, 'every opportunity created during the race must end up referencing the single resolved client_id, never an orphaned one');
      }
    } finally {
      await db.close();
    }
  }
}
