import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration = strip(readFileSync(new URL('../supabase/migrations/050_agt002_canonical_analysis.sql', import.meta.url), 'utf8'));
const rollback = strip(readFileSync(new URL('../supabase/rollbacks/050_agt002_canonical_analysis_rollback.sql', import.meta.url), 'utf8'));
const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

const pg = new PGlite();
await pg.exec(`
  create role authenticated; create role service_role; create role anon;
  create table public.psi_sales_opportunities (id uuid primary key);
  create table public.psi_public_tenders (id uuid primary key);
  create table public.psi_tender_document_snapshots (id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id));
  create table public.psi_tender_analysis_runs (
    id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.psi_tender_document_snapshots(id),
    opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id),
    producer text not null, method text not null, status text not null, result jsonb, critical_open_count integer not null default 0,
    idempotency_key text not null unique, schema_version text not null, policy_version text not null, model text, usage jsonb,
    created_at timestamptz not null default now(), completed_at timestamptz
  );
  insert into public.psi_sales_opportunities values ('${O}'); insert into public.psi_public_tenders values ('${T}');
  insert into public.psi_tender_document_snapshots values ('${S}','${O}','${T}');
  insert into public.psi_tender_analysis_runs (snapshot_id,opportunity_id,tender_id,producer,method,status,result,idempotency_key,schema_version,policy_version,completed_at)
  values ('${S}','${O}','${T}','siio_rules_v1','rules','completed','{"summary":"histórico"}','legacy','legacy','legacy',now());
`);
await pg.exec(migration);

const historical = (await pg.query("select producer, canonical from public.psi_tender_analysis_runs where idempotency_key='legacy'" )).rows[0];
assert.deepEqual(historical, { producer: 'siio_rules_v1', canonical: false });

await assert.rejects(pg.exec(`insert into public.psi_tender_analysis_runs
  (snapshot_id,opportunity_id,tender_id,producer,method,status,result,idempotency_key,schema_version,policy_version,canonical,completed_at)
  values ('${S}','${O}','${T}','siio_rules_v1','rules','completed','{}','bad-canonical','1','1',true,now())`), /canonical|AGT-002/i);

const queued = (await pg.query(`select public.psi_append_agt002_analysis_attempt('${S}','${O}','${T}','attempt-1','event-1','AGT-002','queued',null,null,null) r`)).rows[0].r;
assert.equal(queued.state, 'queued');
const running = (await pg.query(`select public.psi_append_agt002_analysis_attempt('${S}','${O}','${T}','attempt-1','event-2','AGT-002','running',null,null,null) r`)).rows[0].r;
assert.equal(running.state, 'running');
await assert.rejects(pg.query(`select public.psi_append_agt002_analysis_attempt('${S}','${O}','${T}','attempt-x','event-x','siio_rules_v1','queued',null,null,null)`), /AGT-002|productor/i);

const canonical = (await pg.query(`select public.psi_record_agt002_canonical_analysis_run(
  '${S}','${O}','${T}','{"summary":"Vig-IA"}'::jsonb,0,'canonical-1','schema-1','policy-1','model-1','{"input_tokens":1,"output_tokens":1}'::jsonb
) r`)).rows[0].r;
assert.equal(canonical.producer, 'AGT-002');
assert.equal(canonical.canonical, true);
const completed = (await pg.query(`select public.psi_append_agt002_analysis_attempt('${S}','${O}','${T}','attempt-1','event-3','AGT-002','completed',null,null,'${canonical.id}') r`)).rows[0].r;
assert.equal(completed.state, 'completed');
await assert.rejects(pg.query(`select public.psi_append_agt002_analysis_attempt('${S}','${O}','${T}','attempt-1','event-4','AGT-002','running',null,null,null)`), /terminal|transición/i);
await assert.rejects(pg.exec(`update public.psi_agt002_analysis_attempt_events set state='unavailable' where event_key='event-1'`), /append-only/i);

await pg.exec(rollback);
assert.equal((await pg.query('select count(*)::int count from public.psi_tender_analysis_runs')).rows[0].count, 2, 'rollback must preserve historical and canonical run rows');
assert.equal((await pg.query("select count(*)::int count from information_schema.columns where table_name='psi_tender_analysis_runs' and column_name='canonical'" )).rows[0].count, 0);
assert.equal((await pg.query("select to_regclass('public.psi_agt002_analysis_attempt_events') is null removed")).rows[0].removed, true);

console.log('AGT-002 canonical analysis migration apply/rollback passed');
