import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const decisionMigration = readFileSync(new URL('../supabase/migrations/022_tender_go_no_go_workflow.sql', import.meta.url), 'utf8');
const analysisMigration = readFileSync(new URL('../supabase/migrations/025_tender_analysis_foundation.sql', import.meta.url), 'utf8');
const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  otherOpportunity: '44444444-4444-4444-8444-444444444444',
  otherTender: '55555555-5555-4555-8555-555555555555',
  fabricatedRun: '66666666-6666-4666-8666-666666666666',
};
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role service_role; alter role service_role bypassrls; grant service_role to current_user;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null, microsoft_email text not null, identity_type text default 'human');
    create table public.psi_access_permissions (code text primary key, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null references public.psi_sales_profiles(id), permission_code text not null references public.psi_access_permissions(code), primary key(profile_id, permission_code));
    create table public.psi_sales_opportunities (id uuid primary key, tipo_producto_original text, external_source text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null, interaction_type text not null, created_by uuid not null, occurred_at timestamptz not null default now(), notes text);
    insert into public.psi_sales_profiles values ('${ids.actor}', true, 'admin', 'admin@example.test', 'human');
    insert into public.psi_access_permissions values ('licitaciones', true);
    insert into public.psi_profile_permissions values ('${ids.actor}', 'licitaciones');
    insert into public.psi_sales_opportunities values ('${ids.opportunity}', 'Licitación Pública', 'secop_radar:current'), ('${ids.otherOpportunity}', 'Licitación Pública', 'secop_radar:other');
    insert into public.psi_public_tenders values ('${ids.tender}', '${ids.opportunity}'), ('${ids.otherTender}', '${ids.otherOpportunity}');
  `);
  await db.exec(decisionMigration);
  await db.exec(`insert into public.psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision, analysis_interaction_id, justification, decided_by)
    values ('${ids.opportunity}', '${ids.tender}', 'no_go', null, 'Decisión legacy', '${ids.actor}')`);
  await db.exec(analysisMigration);
  return db;
}

async function snapshot(db, { opportunity = ids.opportunity, tender = ids.tender, marker }) {
  const hash = marker.repeat(64);
  return (await one(db, `select public.psi_record_tender_document_snapshot($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,$6::jsonb,$7::uuid) as result`, [
    opportunity, tender, hash, 'b'.repeat(64), JSON.stringify({ documents: [{ marker }] }), JSON.stringify({ version: marker }), ids.actor,
  ])).result;
}

async function run(db, snapshotId, {
  opportunity = ids.opportunity,
  tender = ids.tender,
  producer = 'siio_rules_v1',
  method = producer === 'siio_rules_v1' ? 'rules' : 'agent_ai',
  status = 'completed',
  criticalOpenCount = 0,
  recommendation = 'pause',
  idempotencyKey,
} = {}) {
  return (await one(db, `select public.psi_record_tender_analysis_run($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::jsonb,$8::int,$9::text,$10::text,$11::text,$12::text,$13::jsonb) as result`, [
    snapshotId, opportunity, tender, producer, method, status, status === 'completed' ? JSON.stringify({ recommendation }) : null,
    criticalOpenCount, idempotencyKey || `${producer}-${status}-${criticalOpenCount}-${snapshotId}`, '2.0', 'test-policy', null, JSON.stringify({}),
  ])).result;
}

async function decide(db, { decision = 'go', analysisRunId = null, justification = null } = {}) {
  return (await one(db, `select public.psi_record_tender_go_no_go($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,$7::jsonb) as result`, [
    ids.opportunity, ids.tender, ids.actor, decision, analysisRunId ?? null, justification, decision === 'go' ? JSON.stringify({ kind: 'tender_offer_preparation' }) : null,
  ])).result;
}

await (async function authorizedHumanDecisionDoesNotDependOnAnalysisState() {
  const db = await createDatabase();
  const legacy = await one(db, `select analysis_interaction_id, analysis_run_id, justification from public.psi_tender_go_no_go_decisions where justification = 'Decisión legacy'`);
  assert.deepEqual(legacy, { analysis_interaction_id: null, analysis_run_id: null, justification: 'Decisión legacy' }, 'legacy decision rows remain readable after typed-run migration');

  const withoutAnalysis = await decide(db);
  assert.equal(withoutAnalysis.decision, 'go', 'an authorized human may record GO without analysis');
  const withoutAnalysisRow = await one(db, `select analysis_run_id, justification, decided_by, decided_at is not null as has_decided_at from public.psi_tender_go_no_go_decisions where id=$1`, [withoutAnalysis.decision_id]);
  assert.deepEqual(withoutAnalysisRow, { analysis_run_id: null, justification: null, decided_by: ids.actor, has_decided_at: true });

  const currentSnapshot = await snapshot(db, { marker: 'a' });
  const currentRules = await run(db, currentSnapshot.id, { idempotencyKey: 'current-rules', recommendation: 'do_not_advance' });
  await assert.rejects(() => decide(db, { analysisRunId: ids.fabricatedRun }), /análisis|oportunidad|licitación/i);
  const go = await decide(db, { analysisRunId: currentRules.id });
  assert.equal(go.decision, 'go', 'a human GO may contradict the recommendation');
  const preserved = await one(db, `select result->>'recommendation' as recommendation from public.psi_tender_analysis_runs where id=$1`, [currentRules.id]);
  assert.equal(preserved.recommendation, 'do_not_advance', 'the original recommendation remains immutable after the human decision');

  const otherSnapshot = await snapshot(db, { opportunity: ids.otherOpportunity, tender: ids.otherTender, marker: 'c' });
  const otherRun = await run(db, otherSnapshot.id, { opportunity: ids.otherOpportunity, tender: ids.otherTender, idempotencyKey: 'other-run' });
  await assert.rejects(() => decide(db, { analysisRunId: otherRun.id }), /análisis|oportunidad|licitación/i);

  const failed = await run(db, currentSnapshot.id, { status: 'failed', idempotencyKey: 'failed-run' });
  assert.equal((await decide(db, { analysisRunId: failed.id })).decision, 'go', 'a failed analysis warns but does not block an authorized human');

  const staleSnapshot = await snapshot(db, { marker: 'd' });
  const staleRun = await run(db, staleSnapshot.id, { idempotencyKey: 'stale-run' });
  await snapshot(db, { marker: 'e' });
  assert.equal((await decide(db, { analysisRunId: staleRun.id })).decision, 'go', 'a stale analysis warns but does not block an authorized human');
  await db.close();
})();

await (async function criticalQuestionsAndProducerRecommendationNeverAuthorizeOrBlockTheHuman() {
  const db = await createDatabase();
  const firstSnapshot = await snapshot(db, { marker: 'f' });
  const criticalAgt = await run(db, firstSnapshot.id, { producer: 'AGT-002', criticalOpenCount: 1, idempotencyKey: 'critical-agt' });
  assert.equal((await decide(db, { analysisRunId: criticalAgt.id })).decision, 'go', 'critical questions remain warnings and cannot block human GO');
  const noGo = await decide(db, { decision: 'no_go', analysisRunId: criticalAgt.id });
  assert.equal(noGo.decision, 'no_go', 'NO GO also remains available');

  const hermesSnapshot = await snapshot(db, { marker: 'a' });
  const hermes = await run(db, hermesSnapshot.id, { producer: 'HERMES-INTERIM', idempotencyKey: 'current-hermes' });
  assert.equal((await decide(db, { decision: 'no_go', analysisRunId: hermes.id })).decision, 'no_go');
  await db.close();
})();

await (async function unauthorizedAndTechnicalIdentitiesRemainBlocked() {
  const db = await createDatabase();
  await db.exec(`update public.psi_sales_profiles set identity_type='agent' where id='${ids.actor}'`);
  await assert.rejects(() => decide(db), /permisos/i);
  await db.exec(`update public.psi_sales_profiles set identity_type='human' where id='${ids.actor}'; delete from public.psi_profile_permissions where profile_id='${ids.actor}'`);
  await assert.rejects(() => decide(db), /permisos/i);
  assert.equal(Number((await one(db, `select count(*)::int as count from public.psi_tender_go_no_go_decisions where justification is null`)).count), 0, 'rejected identities cannot create decisions');
  await db.close();
})();

console.log('PGlite tender analysis GO/NO GO gate integration passed');
