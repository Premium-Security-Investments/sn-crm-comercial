import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration071 = readFileSync(new URL('../supabase/migrations/071_agt002_radar_gate.sql', import.meta.url), 'utf8').replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration072 = readFileSync(new URL('../supabase/migrations/072_agt002_radar_preanalysis_ledger.sql', import.meta.url), 'utf8').replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const rollback072 = readFileSync(new URL('../supabase/rollbacks/072_agt002_radar_preanalysis_ledger_rollback.sql', import.meta.url), 'utf8').replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
for (const sql of [migration072, rollback072]) assert.doesNotMatch(sql, /psi_sales_opportunities|psi_convert_tender_to_opportunity|converted_opportunity_id|internal_status/i);

const T1 = '22222222-2222-4222-8222-222222222221';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '22222222-2222-4222-8222-222222222223';
const HASH1 = 'a'.repeat(64), HASH2 = 'b'.repeat(64), HASH3 = 'c'.repeat(64);
const db = new PGlite();
await db.exec(`
  create role authenticated; create role service_role; create role anon; alter role service_role bypassrls; grant service_role to current_user;
  create table public.psi_public_tenders(id uuid primary key, stable_key text not null unique, title text);
  insert into public.psi_public_tenders values ('${T1}','k1','One'),('${T2}','k2','Two'),('${T3}','k3','Three');
  ${migration071}
  ${migration072}
`);
const before = (await db.query('select * from public.psi_public_tenders order by id')).rows;

async function gate(tender, stable, hash, key, policy = 'p1', context = 'c1') {
  return (await db.query(`select public.psi_record_agt002_radar_gate_evaluation($1,$2,'sobreviviente',array[]::text[],'[]','[]',$3,$4,$5,$6,'2026-08-25T00:00:00Z') result`, [tender,stable,policy,context,hash,key])).rows[0].result;
}
async function enqueue(tender, gateId, hash, key, attempt = `${key}-attempt`, policy = 'p1', context = 'c1') {
  return (await db.query('select public.psi_enqueue_agt002_radar_preanalysis_job($1,$2,$3,$4,$5,$6,$7) result', [tender,gateId,attempt,key,policy,context,hash])).rows[0].result;
}
async function claim(seconds = 60) { return (await db.query('select public.psi_claim_agt002_radar_preanalysis_job($1) result', [seconds])).rows[0].result; }
const evidence = [{ evidence_id:'e1', evidence_type:'tender_field', reference:'title', observed_value:'vigilancia', policy_version:'p1', context_version:'c1' }];
async function run(tender, gateId, key, verdict = 'mostrar_en_radar', status = 'completed', learningVersion = null, learningCount = 0, context = 'c1') {
  const result = { summary:'ok', human_review_required:true };
  return (await db.query(`select public.psi_record_agt002_radar_preanalysis_run($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) result`, [tender,gateId,verdict,status,JSON.stringify(result),JSON.stringify(evidence.map(item => ({...item,context_version:context}))),'p1',context,learningVersion,learningCount,'m1',JSON.stringify({input_tokens:1}),key])).rows[0].result;
}

const g1 = await gate(T1,'k1',HASH1,'gate-1');
const created = await enqueue(T1,g1.id,HASH1,'job-1');
assert.equal(created.status, 'created');
assert.equal((await enqueue(T1,g1.id,HASH1,'job-1')).status, 'existing');
await assert.rejects(() => enqueue(T1,g1.id,HASH1,'job-conflict','other-attempt'), /55000|active/i);
const c1 = await claim();
assert.equal(c1.status, 'claimed');
assert.equal(c1.tender_id, T1);
const r1 = await run(T1,g1.id,'run-1');
assert.equal(r1.canonical, true);
assert.equal((await db.query('select public.psi_complete_agt002_radar_preanalysis_job($1,$2,$3) result',[c1.job_id,c1.lease_id,r1.id])).rows[0].result.status, 'completed');
assert.equal((await enqueue(T1,g1.id,HASH1,'job-satisfied')).status, 'satisfied');

const g2 = await gate(T1,'k1',HASH2,'gate-2');
assert.equal((await enqueue(T1,g2.id,HASH2,'job-2')).status, 'created');
const c2 = await claim();
const r2 = await run(T1,g2.id,'run-2','no_concluyente','abstained');
assert.equal(r2.supersedes_run_id, r1.id);
await db.query('select public.psi_complete_agt002_radar_preanalysis_job($1,$2,$3)',[c2.job_id,c2.lease_id,r2.id]);
let current = (await db.query('select id,status,visibility_verdict from public.psi_agt002_radar_preanalysis_runs where tender_id=$1 and canonical',[T1])).rows;
assert.deepEqual(current, [{ id:r2.id, status:'abstained', visibility_verdict:'no_concluyente' }]);
assert.equal((await enqueue(T1,g2.id,HASH2,'job-abstained-satisfied')).status, 'satisfied');

const g3 = await gate(T1,'k1',HASH3,'gate-3');
await enqueue(T1,g3.id,HASH3,'job-3'); const c3 = await claim();
const r3 = await run(T1,g3.id,'run-3','no_mostrar_en_radar','completed');
await db.query('select public.psi_complete_agt002_radar_preanalysis_job($1,$2,$3)',[c3.job_id,c3.lease_id,r3.id]);
current = (await db.query('select id,status,visibility_verdict from public.psi_agt002_radar_preanalysis_runs where tender_id=$1 and canonical',[T1])).rows;
assert.deepEqual(current, [{ id:r3.id, status:'completed', visibility_verdict:'no_mostrar_en_radar' }]);
assert.equal((await db.query('select count(*)::int n from public.psi_agt002_radar_preanalysis_runs where tender_id=$1 and canonical',[T1])).rows[0].n, 1);
await assert.rejects(() => db.query("update public.psi_agt002_radar_preanalysis_runs set result='{}' where id=$1",[r1.id]), /append-only|55000/i);
await assert.rejects(() => db.query('delete from public.psi_agt002_radar_preanalysis_runs where id=$1',[r1.id]), /append-only|55000/i);

const gt2 = await gate(T2,'k2',HASH1,'gate-t2'); await enqueue(T2,gt2.id,HASH1,'job-t2'); const ct2 = await claim();
assert.equal((await db.query('select public.psi_fail_agt002_radar_preanalysis_job($1,$2,$3) result',[ct2.job_id,ct2.lease_id,'timeout'])).rows[0].result.status, 'unavailable');
await assert.rejects(() => db.query('select public.psi_fail_agt002_radar_preanalysis_job($1,$2,$3)',[ct2.job_id,ct2.lease_id,'raw-provider-message']), /22023|error code/i);
const retryT2 = await enqueue(T2,gt2.id,HASH1,'job-t2-retry','job-t2-retry-attempt');
assert.equal(retryT2.status, 'created', 'un job terminal no debe bloquear un intento posterior');
const retryCt2 = await claim();
assert.equal(retryCt2.job_id, retryT2.job_id);
await db.query('select public.psi_fail_agt002_radar_preanalysis_job($1,$2,$3)',[retryCt2.job_id,retryCt2.lease_id,'capacity_unavailable']);

const gt3 = await gate(T3,'k3',HASH1,'gate-t3'); await enqueue(T3,gt3.id,HASH1,'job-t3'); const ct3 = await claim(1);
await db.query("update public.psi_agt002_radar_preanalysis_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[ct3.job_id]);
assert.equal((await claim()).status, 'empty');
assert.equal((await db.query('select status,error_code from public.psi_agt002_radar_preanalysis_jobs where id=$1',[ct3.job_id])).rows[0].error_code, 'lease_lost');
assert.equal((await db.query("select count(*)::int n from public.psi_agt002_radar_preanalysis_attempt_events where event_key like '%:lease_lost'")).rows[0].n, 1);

await db.exec('set role service_role');
await assert.rejects(() => db.query(`insert into public.psi_agt002_radar_preanalysis_runs(tender_id,gate_evaluation_id,producer,method,status,visibility_verdict,result,evidence,policy_version,context_version,source_row_hash,idempotency_key) values ($1,$2,'AGT-002','agent_ai','completed','mostrar_en_radar','{"human_review_required":true}',$3,'p1','c1',$4,'direct')`,[T1,g1.id,JSON.stringify(evidence),HASH1]), /permission denied/i);
await db.exec('reset role; set role authenticated');
await assert.rejects(() => claim(), /permission denied/i);
await db.exec('reset role');

assert.deepEqual((await db.query('select * from public.psi_public_tenders order by id')).rows, before);
await db.exec(rollback072);
for (const table of ['psi_agt002_radar_preanalysis_jobs','psi_agt002_radar_preanalysis_attempt_events','psi_agt002_radar_preanalysis_runs']) assert.equal((await db.query('select to_regclass($1) value',[`public.${table}`])).rows[0].value, null);
assert.notEqual((await db.query("select to_regclass('public.psi_agt002_radar_gate_evaluations') value")).rows[0].value, null);
assert.deepEqual((await db.query('select * from public.psi_public_tenders order by id')).rows, before);
await db.close();
console.log('AGT-002 Radar preanalysis canonical ledger and durable queue apply/rollback passed');
