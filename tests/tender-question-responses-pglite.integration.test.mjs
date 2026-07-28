import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrationUrl = new URL('../supabase/migrations/038_tender_question_responses.sql', import.meta.url);
assert.equal(existsSync(migrationUrl), true, 'Falta la migración 038.');
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';
const ids = {
  human: '11111111-1111-4111-8111-111111111111',
  agent: '22222222-2222-4222-8222-222222222222',
  opportunity: '33333333-3333-4333-8333-333333333333',
  tender: '44444444-4444-4444-8444-444444444444',
  run: '55555555-5555-4555-8555-555555555555',
  otherRun: '66666666-6666-4666-8666-666666666666',
};
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; grant anon, service_role to current_user;
  create table public.psi_sales_profiles (id uuid primary key, full_name text, active boolean not null default true, identity_type text not null default 'human');
  create table public.psi_sales_opportunities (id uuid primary key);
  create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid not null);
  create table public.psi_tender_analysis_runs (id uuid primary key, opportunity_id uuid not null, tender_id uuid not null, result jsonb, created_at timestamptz not null default now());
  insert into public.psi_sales_profiles values ('${ids.human}','Licitaciones',true,'human'),('${ids.agent}','Agente',true,'agent');
  insert into public.psi_sales_opportunities values ('${ids.opportunity}');
  insert into public.psi_public_tenders values ('${ids.tender}','${ids.opportunity}');
  insert into public.psi_tender_analysis_runs values
    ('${ids.run}','${ids.opportunity}','${ids.tender}','{"questions":[{"id":"q-1","text":"¿Existe RUP?"}]}',now()),
    ('${ids.otherRun}','${ids.opportunity}','${ids.tender}','{"questions":[]}',now());
`);
await db.exec(migration); await db.exec(migration);
const record = async ({ actor = ids.human, run = ids.run, status = 'resolved', response = 'Sí, vigente.', evidence = 'RUP 2026' } = {}) => (await db.query(
  `select public.psi_record_tender_question_response($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::uuid) as result`,
  [ids.opportunity, run, 'q-1', '¿Existe RUP?', status, response, evidence, actor]
)).rows[0].result;

const first = await record();
assert.equal(first.status, 'resolved');
assert.equal(first.responded_by, ids.human);
assert.ok(first.responded_at);
const second = await record({ status: 'pending', response: 'Solicitado a Jurídica.', evidence: '' });
assert.notEqual(first.id, second.id, 'Actualizar respuesta debe agregar una versión.');
assert.equal(Number((await db.query('select count(*)::int as count from public.psi_tender_question_responses')).rows[0].count), 2);
await assert.rejects(() => record({ actor: ids.agent }), /humana|humano/i);
await assert.rejects(() => record({ status: 'invalid' }), /estado/i);
await assert.rejects(() => record({ response: '   ' }), /respuesta/i);
await assert.rejects(() => db.query(`update public.psi_tender_question_responses set status='resolved'`), /append-only/i);
await assert.rejects(() => db.query(`delete from public.psi_tender_question_responses`), /append-only/i);
await db.exec('set role anon');
await assert.rejects(() => db.query('select * from public.psi_tender_question_responses'), /permission denied/i);
await assert.rejects(() => record({ response: 'Intento anónimo.' }), /permission denied/i);
await db.exec('reset role');
await db.exec('set role service_role');
await assert.rejects(() => db.query(`insert into public.psi_tender_question_responses(opportunity_id,analysis_run_id,question_id,question_text,status,response,responded_by) values ('${ids.opportunity}','${ids.run}','q-x','x','resolved','x','${ids.human}')`), /permission denied/i);
const viaRpc = await record({ response: 'Desde RPC.' });
assert.equal(viaRpc.responded_by, ids.human);
await db.exec('reset role');
await db.close();
console.log('PGlite tender question responses append-only contract passed');
