import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/024_tender_offer_status_transitions.sql', import.meta.url), 'utf8');
const ids = {
  admin: '11111111-1111-4111-8111-111111111111', commercial: '22222222-2222-4222-8222-222222222222', agent: '33333333-3333-4333-8333-333333333333',
  opportunity: '44444444-4444-4444-8444-444444444444', tender: '55555555-5555-4555-8555-555555555555',
};
const db = new PGlite();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const transition = async (actor, to, expected, note = null) => (await one(
  'select public.psi_transition_tender_offer_status($1::uuid,$2::uuid,$3::text,$4::text,$5::text) as result',
  [ids.opportunity, actor, to, expected, note],
)).result;

await db.exec(`
  create role authenticated; create role service_role; alter role service_role bypassrls; grant service_role to current_user;
  create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null, identity_type text default 'human');
  create table public.psi_access_permissions (code text primary key, active boolean not null default true);
  create table public.psi_profile_permissions (profile_id uuid not null references public.psi_sales_profiles(id), permission_code text not null references public.psi_access_permissions(code), primary key(profile_id, permission_code));
  create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
  create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
  create table public.psi_tender_go_no_go_decisions (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null, tender_id uuid not null, decision text not null, decided_at timestamptz not null default now());
  insert into public.psi_sales_profiles values
    ('${ids.admin}', true, 'admin', 'human'), ('${ids.commercial}', true, 'comercial', 'human'), ('${ids.agent}', true, 'admin', 'agent');
  insert into public.psi_access_permissions values ('licitaciones', true);
  insert into public.psi_profile_permissions values ('${ids.admin}', 'licitaciones'), ('${ids.agent}', 'licitaciones');
  insert into public.psi_sales_opportunities values ('${ids.opportunity}', 'en_preparacion');
  insert into public.psi_public_tenders values ('${ids.tender}', '${ids.opportunity}');
  insert into public.psi_tender_go_no_go_decisions(opportunity_id,tender_id,decision) values ('${ids.opportunity}','${ids.tender}','no_go');
`);
await db.exec(migration);
await db.exec(migration);

await assert.rejects(() => transition(ids.admin, 'lista_para_presentar', 'en_preparacion'), /GO formal vigente/i);
await db.exec(`insert into public.psi_tender_go_no_go_decisions(opportunity_id,tender_id,decision,decided_at) values ('${ids.opportunity}','${ids.tender}','go',now() + interval '1 second')`);
await assert.rejects(() => transition(ids.commercial, 'lista_para_presentar', 'en_preparacion'), /permisos/i);
await assert.rejects(() => transition(ids.agent, 'lista_para_presentar', 'en_preparacion'), /permisos/i);
await assert.rejects(() => transition(ids.admin, 'presentada', 'en_preparacion'), /Transición/i);

const ready = await transition(ids.admin, 'lista_para_presentar', 'en_preparacion', 'Checklist completo');
assert.equal(ready.status, 'lista_para_presentar');
assert.equal(ready.event.note, 'Checklist completo');
await assert.rejects(() => transition(ids.admin, 'presentada', 'en_preparacion'), /Conflicto de estado/i);
assert.equal((await transition(ids.admin, 'presentada', 'lista_para_presentar')).status, 'presentada');
assert.equal((await transition(ids.admin, 'adjudicada', 'presentada', 'Acta recibida')).status, 'adjudicada');
assert.equal((await one('select tender_offer_status from public.psi_sales_opportunities where id=$1', [ids.opportunity])).tender_offer_status, 'adjudicada');
assert.equal(Number((await one('select count(*)::int as count from public.psi_tender_offer_status_transitions')).count), 3);
await assert.rejects(() => db.exec("update public.psi_tender_offer_status_transitions set note='mutada'"), /append-only/i);
await assert.rejects(() => db.exec('delete from public.psi_tender_offer_status_transitions'), /append-only/i);

await db.exec('set role service_role');
await assert.rejects(() => db.exec(`insert into public.psi_tender_offer_status_transitions(opportunity_id,tender_id,actor_id,from_status,to_status) values ('${ids.opportunity}','${ids.tender}','${ids.admin}','presentada','no_adjudicada')`), /permission denied/i);
await db.exec('reset role');
await db.close();
console.log('PGlite tender offer status transitions passed');
