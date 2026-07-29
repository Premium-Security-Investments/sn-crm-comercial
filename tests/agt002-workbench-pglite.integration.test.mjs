import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dossierMigration = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const workbenchMigration = readFileSync(new URL('../supabase/migrations/044_agt002_dossier_workbench.sql', import.meta.url), 'utf8');
const ids = Object.freeze({
  operator: '11111111-1111-4111-8111-111111111111',
  custodian: '11111111-1111-4111-8111-111111111112',
  agent: '11111111-1111-4111-8111-111111111113',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  snapshot: '44444444-4444-4444-8444-444444444444',
  learningProposal: '55555555-5555-4555-8555-555555555555',
});
const key = char => char.repeat(64);

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key, active boolean not null default true,
      identity_type text default 'human', role text not null, full_name text
    );
    create table public.psi_access_permissions (code text primary key, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null, permission_code text not null);
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_go_no_go_decisions (
      id uuid primary key default gen_random_uuid(), opportunity_id uuid, tender_id uuid,
      decision text, decided_at timestamptz default now(), supersedes_decision_id uuid);
    insert into public.psi_access_permissions(code) values ('licitaciones'),('licitaciones_custodia');
    insert into public.psi_sales_profiles(id,identity_type,role,full_name) values
      ('${ids.operator}','human','comercial','Operador'),
      ('${ids.custodian}','human','comercial','Encargada'),
      ('${ids.agent}','agent','comercial','AGT-002');
    insert into public.psi_profile_permissions(profile_id,permission_code) values
      ('${ids.operator}','licitaciones'),
      ('${ids.custodian}','licitaciones'),
      ('${ids.custodian}','licitaciones_custodia');
    insert into public.psi_sales_opportunities(id,tender_offer_status) values ('${ids.opportunity}','en_preparacion');
    insert into public.psi_public_tenders(id,converted_opportunity_id) values ('${ids.tender}','${ids.opportunity}');
    insert into public.psi_tender_go_no_go_decisions(opportunity_id,tender_id,decision)
      values ('${ids.opportunity}','${ids.tender}','go');
  `);
  await db.exec(dossierMigration);
  return db;
}

const db = await freshDb();
await db.exec(workbenchMigration);
await db.exec(workbenchMigration);

const tableNames = (await db.query(`
  select table_name from information_schema.tables
  where table_schema='public' and (table_name like 'psi_agt002_workbench_%' or table_name like 'psi_agt002_learning_%')
  order by table_name
`)).rows.map(row => row.table_name);
assert.deepEqual(tableNames, [
  'psi_agt002_learning_decisions',
  'psi_agt002_learning_proposals',
  'psi_agt002_workbench_job_events',
  'psi_agt002_workbench_jobs',
  'psi_agt002_workbench_message_links',
  'psi_agt002_workbench_messages',
  'psi_agt002_workbench_required_actions',
  'psi_agt002_workbench_threads',
]);

const thread = (await db.query(
  `select public.psi_get_or_create_agt002_workbench_thread($1,$2) as r`,
  [ids.opportunity, ids.operator],
)).rows[0].r;
const sameThread = (await db.query(
  `select public.psi_get_or_create_agt002_workbench_thread($1,$2) as r`,
  [ids.opportunity, ids.custodian],
)).rows[0].r;
assert.equal(sameThread.id, thread.id);

await db.exec('set role service_role');
await assert.rejects(
  () => db.query(`insert into public.psi_agt002_workbench_threads(opportunity_id,tender_id,created_by) values ($1,$2,$3)`, [ids.opportunity, ids.tender, ids.operator]),
  /permission denied/i,
);
await assert.rejects(
  () => db.query(`update public.psi_agt002_workbench_threads set closed_at=now() where id=$1`, [thread.id]),
  /append-only/i,
);
await db.exec('reset role');

const replyQueued = (await db.query(
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r`,
  [ids.opportunity, ids.operator, thread.id, 'Liste faltantes.', [], key('a'),
    'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
    'agt002.dossier-workbench.reply.v1', ids.snapshot, null],
)).rows[0].r;
assert.equal(replyQueued.status, 'queued');
const duplicate = (await db.query(
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r`,
  [ids.opportunity, ids.operator, thread.id, 'Liste faltantes.', [], key('a'),
    'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
    'agt002.dossier-workbench.reply.v1', ids.snapshot, null],
)).rows[0].r;
assert.equal(duplicate.status, 'existing');
assert.equal(duplicate.job_id, replyQueued.job_id);

const claim = (await db.query(
  `select public.psi_claim_agt002_workbench_job('worker-test',20,2,300) as r`,
)).rows[0].r;
assert.equal(claim.status, 'claimed');
assert.equal(claim.job.contract_version, 'agt002.dossier-workbench.v1');
assert.equal(claim.job.policy_version, 'agt002.dossier-workbench.policy.v1');

const replyResult = {
  kind: 'reply', visible_agent_name: 'Vig-IA', human_review_required: true,
  snapshot_id: ids.snapshot, base_version_id: null,
  content_text: 'Falta el certificado de experiencia.', source_links: [],
  missing_information: ['Certificado de experiencia'],
  required_actions: ['La encargada debe verificar la vigencia.'],
};
const savedReply = (await db.query(
  `select public.psi_append_agt002_agent_result($1,$2,$3,$4) as r`,
  [replyQueued.job_id, claim.claim_id, ids.agent, replyResult],
)).rows[0].r;
assert.equal(savedReply.status, 'completed');
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_required_actions`)).rows[0].n, 1);

const learningQueued = (await db.query(
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r`,
  [ids.opportunity, ids.operator, thread.id, 'Proponga aprendizaje.', [], key('b'),
    'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
    'agt002.dossier-workbench.learning-proposal.v1', ids.snapshot, null],
)).rows[0].r;
const learningClaim = (await db.query(
  `select public.psi_claim_agt002_workbench_job('worker-test',20,2,300) as r`,
)).rows[0].r;
assert.equal(learningClaim.job.id, learningQueued.job_id);
const learningResult = {
  kind: 'learning_proposal', visible_agent_name: 'Vig-IA', human_review_required: true,
  snapshot_id: ids.snapshot, base_version_id: null,
  proposal_id: ids.learningProposal, proposal_type: 'pattern',
  proposed_rule: 'Solicitar certificado cuando el pliego lo exija.', scope: 'entity',
  valid_from: '2026-07-28T00:00:00.000Z', valid_until: null,
  source_message_id: learningClaim.job.origin_message_id, source_links: [],
};
assert.equal((await db.query(
  `select public.psi_append_agt002_agent_result($1,$2,$3,$4) as r`,
  [learningQueued.job_id, learningClaim.claim_id, ids.agent, learningResult],
)).rows[0].r.status, 'completed');
await assert.rejects(
  () => db.query(`select public.psi_review_agt002_learning_proposal($1,$2,$3,'approved','entity','ok')`, [ids.opportunity, ids.operator, ids.learningProposal]),
  /permisos/i,
);
const reviewed = (await db.query(
  `select public.psi_review_agt002_learning_proposal($1,$2,$3,'approved','entity','ok') as r`,
  [ids.opportunity, ids.custodian, ids.learningProposal],
)).rows[0].r;
assert.equal(reviewed.decision, 'approved');

const artifact = (await db.query(
  `select public.psi_create_tender_dossier_artifact($1,$2,'technical','Documento técnico',true) as r`,
  [ids.opportunity, ids.operator],
)).rows[0].r.artifact;
const v1 = (await db.query(
  `select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# V1',null) as r`,
  [ids.opportunity, artifact.id, ids.operator],
)).rows[0].r;
const draftQueued = (await db.query(
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r`,
  [ids.opportunity, ids.operator, thread.id, 'Redacte versión.', [], key('c'),
    'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
    'agt002.dossier-workbench.draft.v1', ids.snapshot, v1.version_id],
)).rows[0].r;
const draftClaim = (await db.query(
  `select public.psi_claim_agt002_workbench_job('worker-test',20,2,300) as r`,
)).rows[0].r;
await db.query(
  `select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# V2 humana',null)`,
  [ids.opportunity, artifact.id, ids.operator],
);
const stale = (await db.query(
  `select public.psi_append_agt002_agent_artifact_version($1,$2,$3,$4,$5,'markdown','# V2 agente',null) as r`,
  [draftQueued.job_id, draftClaim.claim_id, ids.agent, artifact.id, v1.version_id],
)).rows[0].r;
assert.equal(stale.status, 'stale');
assert.equal((await db.query(
  `select count(*)::int as n from public.psi_tender_dossier_artifact_versions where artifact_id=$1`,
  [artifact.id],
)).rows[0].n, 2);

await db.close();
console.log('PGlite AGT-002 workbench domain passed');
