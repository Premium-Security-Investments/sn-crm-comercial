import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/071_agt002_radar_gate.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/071_agt002_radar_gate_rollback.sql', import.meta.url), 'utf8');
const forbidden = /psi_sales_opportunities|psi_convert_tender_to_opportunity|converted_opportunity_id|internal_status/i;
assert.doesNotMatch(migration, forbidden);
assert.doesNotMatch(rollback, forbidden);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; grant service_role to current_user;
  create table public.psi_public_tenders (id uuid primary key, stable_key text not null, title text);
  insert into public.psi_public_tenders values ('00000000-0000-4000-8000-000000000001','k1','Original');
`);
const before = (await db.query('select * from public.psi_public_tenders order by id')).rows;
await db.exec(migration);

const payload = {
  tender: '00000000-0000-4000-8000-000000000001', stable: 'k1', verdict: 'sobreviviente',
  rules: [], reasons: [], gaps: [], policy: 'p1', context: 'c1', hash: 'a'.repeat(64), key: 'key-1', at: '2026-08-25T00:00:00Z',
};
async function record(overrides = {}) {
  const p = { ...payload, ...overrides };
  return (await db.query(`select public.psi_record_agt002_radar_gate_evaluation(
    $1::uuid,$2::text,$3::text,$4::text[],$5::jsonb,$6::jsonb,$7::text,$8::text,$9::text,$10::text,$11::timestamptz
  ) result`, [p.tender,p.stable,p.verdict,p.rules,JSON.stringify(p.reasons),JSON.stringify(p.gaps),p.policy,p.context,p.hash,p.key,p.at])).rows[0].result;
}

assert.equal((await record()).status, 'created');
assert.equal((await record()).status, 'existing');
assert.equal((await db.query('select count(*)::int count from public.psi_agt002_radar_gate_evaluations')).rows[0].count, 1);
await assert.rejects(() => record({ verdict: 'eliminada', rules: ['estado_terminal'], reasons: [{ rule_id: 'estado_terminal', field: 'status', observed_value: 'cancelado', source: 'psi_public_tenders', policy_version: 'p1', context_version: 'c1' }] }), /conflict|duplicate|23505/i);
await assert.rejects(() => record({ key: 'key-bad', verdict: 'eliminada', rules: ['estado_terminal'], reasons: [{}] }), /invalid|22023/i);
await assert.rejects(() => record({ key: 'key-empty-observed', verdict: 'eliminada', rules: ['fecha_no_verificable'], reasons: [{ rule_id: 'fecha_no_verificable', field: 'deadline_at', observed_value: '', source: 'psi_public_tenders', policy_version: 'p1', context_version: 'c1' }] }), /invalid|22023/i);

const created = (await db.query('select id from public.psi_agt002_radar_gate_evaluations')).rows[0];
await assert.rejects(() => db.query('update public.psi_agt002_radar_gate_evaluations set verdict=$1 where id=$2', ['eliminada', created.id]), /append-only|55000/i);
await assert.rejects(() => db.query('delete from public.psi_agt002_radar_gate_evaluations where id=$1', [created.id]), /append-only|55000/i);

await db.exec('set role service_role');
await assert.rejects(() => db.query(`insert into public.psi_agt002_radar_gate_evaluations(tender_id,stable_key,verdict,reasons,policy_version,context_version,source_row_hash,idempotency_key) values ($1,'k1','sobreviviente','[]','p1','c1',$2,'direct')`, [payload.tender, payload.hash]), /permission denied/i);
assert.equal((await record({ key: 'key-2' })).status, 'created');
await db.exec('reset role');

assert.deepEqual((await db.query('select * from public.psi_public_tenders order by id')).rows, before);
await db.exec(rollback);
assert.equal((await db.query("select to_regclass('public.psi_agt002_radar_gate_evaluations') value")).rows[0].value, null);
assert.deepEqual((await db.query('select * from public.psi_public_tenders order by id')).rows, before);
await db.close();
console.log('AGT-002 Radar gate ledger migration apply/rollback passed');
