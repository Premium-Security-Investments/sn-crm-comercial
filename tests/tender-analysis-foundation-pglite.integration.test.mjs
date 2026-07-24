import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/025_tender_analysis_foundation.sql', import.meta.url), 'utf8');
const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222222',
  wrongOpportunity: '33333333-3333-4333-8333-333333333333',
  tender: '44444444-4444-4444-8444-444444444444',
  wrongTender: '55555555-5555-4555-8555-555555555555',
};
const documentHash = 'a'.repeat(64);
const profileHash = 'b'.repeat(64);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role service_role; alter role service_role bypassrls; grant service_role to current_user;
    create table public.psi_sales_profiles (id uuid primary key);
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    insert into public.psi_sales_profiles values ('${ids.actor}');
    insert into public.psi_sales_opportunities values ('${ids.opportunity}'), ('${ids.wrongOpportunity}');
    insert into public.psi_public_tenders values ('${ids.tender}', '${ids.opportunity}'), ('${ids.wrongTender}', '${ids.wrongOpportunity}');
  `);
  await db.exec(migration);
  return db;
}

async function snapshot(db, overrides = {}) {
  const input = {
    opportunity: ids.opportunity, tender: ids.tender, documentHash, profileHash,
    manifest: { documents: [{ id: 'doc-1' }] }, profile: { version: 'v1' }, actor: ids.actor,
    ...overrides,
  };
  return (await one(db, `select public.psi_record_tender_document_snapshot(
    $1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,$6::jsonb,$7::uuid
  ) as result`, [input.opportunity, input.tender, input.documentHash, input.profileHash, JSON.stringify(input.manifest), JSON.stringify(input.profile), input.actor])).result;
}

async function run(db, snapshotId, overrides = {}) {
  const input = {
    opportunity: ids.opportunity, tender: ids.tender, producer: 'siio_rules_v1', method: 'rules', status: 'completed',
    result: { recommendation: 'pause' }, criticalOpenCount: 0, idempotencyKey: 'run-1', schemaVersion: '1.0', policyVersion: 'siio-rules-v1', model: null, usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
    ...overrides,
  };
  return (await one(db, `select public.psi_record_tender_analysis_run(
    $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::jsonb,$8::int,$9::text,$10::text,$11::text,$12::text,$13::jsonb
  ) as result`, [snapshotId, input.opportunity, input.tender, input.producer, input.method, input.status, input.result === null ? null : JSON.stringify(input.result), input.criticalOpenCount, input.idempotencyKey, input.schemaVersion, input.policyVersion, input.model, input.usage === null ? null : JSON.stringify(input.usage)])).result;
}

await (async function snapshotsAreImmutableDeduplicatedAndScoped() {
  const db = await createDatabase();
  const first = await snapshot(db); const retry = await snapshot(db);
  assert.equal(first.id, retry.id);
  assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_snapshots')).count), 1);
  await assert.rejects(() => snapshot(db, { tender: ids.wrongTender }), /vinculada|oportunidad/i);
  await assert.rejects(() => snapshot(db, { documentHash: 'A'.repeat(64) }), /hash/i);
  await assert.rejects(() => snapshot(db, { documentHash: 'a'.repeat(63) }), /hash/i);
  await assert.rejects(() => snapshot(db, { actor: null }), /actor|null/i);
  await assert.rejects(() => snapshot(db, { documentHash: 'c'.repeat(64), actor: '66666666-6666-4666-8666-666666666666' }), /foreign key/i);
  await db.exec('set role service_role');
  await assert.rejects(() => db.query(`insert into public.psi_tender_document_snapshots (opportunity_id,tender_id,document_hash,profile_hash,document_manifest,profile_snapshot) values ('${ids.opportunity}','${ids.tender}','${documentHash}','${profileHash}', '{}'::jsonb, '{}'::jsonb)`), /permission denied/i);
  await db.exec('reset role; set role authenticated');
  await assert.rejects(() => db.query(`insert into public.psi_tender_document_snapshots (opportunity_id,tender_id,document_hash,profile_hash,document_manifest,profile_snapshot) values ('${ids.opportunity}','${ids.tender}','${documentHash}','${profileHash}', '{}'::jsonb, '{}'::jsonb)`), /permission denied/i);
  await db.exec('reset role');
  await assert.rejects(() => db.query(`update public.psi_tender_document_snapshots set document_manifest='{}'::jsonb where id=$1`, [first.id]), /append-only/i);
  await assert.rejects(() => db.query(`delete from public.psi_tender_document_snapshots where id=$1`, [first.id]), /append-only/i);
  await db.close();
})();

await (async function runsRequireAuthorizedConsistentCompletedResultsAndAreImmutable() {
  const db = await createDatabase(); const savedSnapshot = await snapshot(db);
  const first = await run(db, savedSnapshot.id); const retry = await run(db, savedSnapshot.id);
  assert.equal(first.id, retry.id);
  assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_analysis_runs')).count), 1);
  await assert.rejects(() => run(db, savedSnapshot.id, { result: { recommendation: 'advance' } }), /idempotencia|clave/i);
  await assert.rejects(() => run(db, savedSnapshot.id, { policyVersion: 'siio-rules-v2' }), /idempotencia|clave/i);
  await assert.rejects(() => run(db, savedSnapshot.id, { producer: 'other', idempotencyKey: 'unauthorized' }), /productor/i);
  await assert.rejects(() => run(db, savedSnapshot.id, { producer: 'HERMES-INTERIM', method: 'rules', idempotencyKey: 'bad-pair' }), /método/i);
  for (const [producer, idempotencyKey] of [['HERMES-INTERIM', 'hermes-interim-agent-ai'], ['AGT-002', 'agt-002-agent-ai']]) {
    const agentRun = await run(db, savedSnapshot.id, { producer, method: 'agent_ai', idempotencyKey });
    assert.equal(agentRun.producer, producer);
    assert.equal(agentRun.status, 'completed');
  }
  await assert.rejects(() => run(db, savedSnapshot.id, { result: null, idempotencyKey: 'no-result' }), /resultado estructurado/i);
  await assert.rejects(() => run(db, savedSnapshot.id, { opportunity: ids.wrongOpportunity, idempotencyKey: 'wrong-opportunity' }), /no coincide|vinculado/i);
  await assert.rejects(() => run(db, savedSnapshot.id, { tender: ids.wrongTender, idempotencyKey: 'wrong-tender' }), /no coincide|vinculado/i);
  const failed = await run(db, savedSnapshot.id, { status: 'failed', result: null, idempotencyKey: 'failed-run' });
  assert.equal(failed.status, 'failed');
  await db.exec('set role service_role');
  await assert.rejects(() => db.query(`insert into public.psi_tender_analysis_runs (snapshot_id,opportunity_id,tender_id,producer,method,status,result,critical_open_count,idempotency_key,schema_version,policy_version) values ('${savedSnapshot.id}','${ids.opportunity}','${ids.tender}','siio_rules_v1','rules','completed','{}',0,'direct-service','1','rules')`), /permission denied/i);
  await db.exec('reset role; set role authenticated');
  await assert.rejects(() => db.query(`insert into public.psi_tender_analysis_runs (snapshot_id,opportunity_id,tender_id,producer,method,status,result,critical_open_count,idempotency_key,schema_version,policy_version) values ('${savedSnapshot.id}','${ids.opportunity}','${ids.tender}','siio_rules_v1','rules','completed','{}',0,'direct-authenticated','1','rules')`), /permission denied/i);
  await db.exec('reset role');
  await assert.rejects(() => db.query(`update public.psi_tender_analysis_runs set result='{}'::jsonb where id=$1`, [first.id]), /append-only/i);
  await assert.rejects(() => db.query(`delete from public.psi_tender_analysis_runs where id=$1`, [first.id]), /append-only/i);
  await db.close();
})();

console.log('PGlite tender analysis foundation integration passed');
