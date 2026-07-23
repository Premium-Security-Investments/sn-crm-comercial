import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/023_tender_opportunities_listing.sql', import.meta.url), 'utf8');
const id = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

const db = new PGlite();
await db.exec(`
  create role authenticated; create role service_role; alter role service_role bypassrls; grant service_role to current_user;
  create table public.psi_sales_profiles (id uuid primary key, full_name text);
  create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
  create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid not null, tracking_updated_at timestamptz);
  create table public.psi_tender_go_no_go_decisions (id uuid primary key, opportunity_id uuid not null, tender_id uuid not null, decision text not null, decided_by uuid, decided_at timestamptz not null);
  insert into public.psi_sales_profiles values ('10000000-0000-4000-8000-000000000001', 'Directora');
`);

const values = [];
for (let n = 1; n <= 120; n++) {
  const opportunityId = id('20000000', n);
  const tenderId = id('30000000', n);
  values.push(`('${opportunityId}', 'pendiente_decision', '${tenderId}', '${opportunityId}', '2026-01-01T00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}Z')`);
}
await db.exec(`
  create temporary table seed_rows (opportunity_id uuid, tender_offer_status text, tender_id uuid, converted_opportunity_id uuid, tracking_updated_at timestamptz);
  insert into seed_rows values ${values.join(',')};
  insert into public.psi_sales_opportunities select opportunity_id, tender_offer_status from seed_rows;
  insert into public.psi_public_tenders select tender_id, converted_opportunity_id, tracking_updated_at from seed_rows;
  drop table seed_rows;
  insert into public.psi_sales_opportunities values
    ('40000000-0000-4000-8000-000000000001', 'lista_para_presentar'),
    ('40000000-0000-4000-8000-000000000002', 'no_adjudicada'),
    ('40000000-0000-4000-8000-000000000003', 'en_preparacion');
  insert into public.psi_public_tenders values
    ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '2027-01-01T00:00:00Z'),
    ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '2027-01-02T00:00:00Z'),
    ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', '2027-01-03T00:00:00Z');
  insert into public.psi_tender_go_no_go_decisions values
    ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'go', '10000000-0000-4000-8000-000000000001', '2027-02-01T00:00:00Z'),
    ('60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', 'go', '10000000-0000-4000-8000-000000000001', '2027-02-02T00:00:00Z'),
    ('60000000-0000-4000-8000-000000000010', '40000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', 'no_go', '10000000-0000-4000-8000-000000000001', '2027-02-02T00:00:00Z');
`);

await db.exec(migration);
await db.exec(migration);

const page = async (filter, limit, offset) => (await db.query(
  'select * from public.psi_list_tender_opportunity_page($1, $2, $3)', [filter, limit, offset]
)).rows;

const first = await page('all', 50, 0);
const second = await page('all', 50, 50);
assert.equal(first.length, 50, 'SQL LIMIT caps the first page at 50');
assert.equal(second.length, 50, 'SQL LIMIT caps every later page at 50');
assert.notDeepEqual(first.map(row => row.tender.id), second.map(row => row.tender.id), 'OFFSET advances without materializing a client candidate set');
assert.deepEqual((await page('go_authorized', 50, 0)).map(row => row.opportunity.id), ['40000000-0000-4000-8000-000000000001']);
assert.deepEqual((await page('in_preparation', 50, 0)).map(row => row.opportunity.id), ['40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001']);
assert.deepEqual((await page('closed', 50, 0)).map(row => row.opportunity.id), ['40000000-0000-4000-8000-000000000002']);
const tie = (await page('all', 50, 0)).find(row => row.opportunity.id === '40000000-0000-4000-8000-000000000003');
assert.equal(tie.latest_decision.id, '60000000-0000-4000-8000-000000000010', 'latest decision breaks identical timestamps by id DESC');
assert.equal(tie.latest_decision.psi_sales_profiles.full_name, 'Directora');
await assert.rejects(() => page('unknown', 1, 0), /filtro/i);
await assert.rejects(() => page('all', 51, 0), /límite/i);
await assert.rejects(() => page('all', 1, 10001), /desplazamiento/i);
await db.close();

console.log('PGlite tender opportunity SQL pagination, filters, ordering, and reapplication passed');
