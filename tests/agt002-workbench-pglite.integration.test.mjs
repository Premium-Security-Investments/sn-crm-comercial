import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dossierMigration = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const workbenchMigration = readFileSync(new URL('../supabase/migrations/045_agt002_dossier_workbench.sql', import.meta.url), 'utf8');
const ids = Object.freeze({
  operator: '11111111-1111-4111-8111-111111111111',
  custodian: '11111111-1111-4111-8111-111111111112',
  agent: '11111111-1111-4111-8111-111111111113',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  snapshot: '44444444-4444-4444-8444-444444444444',
  learningProposal: '55555555-5555-4555-8555-555555555555',
  replyMessage: '66666666-6666-4666-8666-666666666661',
  learningMessage: '66666666-6666-4666-8666-666666666662',
  draftMessage: '66666666-6666-4666-8666-666666666663',
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
const terminalPrivileges = (await db.query(`select
  has_function_privilege('service_role','public.psi_complete_agt002_workbench_job(uuid,uuid,uuid,jsonb)','EXECUTE') as atomic_allowed,
  has_function_privilege('service_role','public.psi_append_agt002_agent_result(uuid,uuid,uuid,jsonb)','EXECUTE') as legacy_result_allowed,
  has_function_privilege('service_role','public.psi_append_agt002_agent_artifact_version(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE') as legacy_version_allowed
`)).rows[0];
assert.equal(terminalPrivileges.atomic_allowed, true);
assert.equal(terminalPrivileges.legacy_result_allowed, false);
assert.equal(terminalPrivileges.legacy_version_allowed, false);

const replyQueued = (await db.query(
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
  [ids.opportunity, ids.operator, thread.id, ids.replyMessage, 'Liste faltantes.', [], key('a'),
    'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
    'agt002.dossier-workbench.reply.v1', ids.snapshot, null],
)).rows[0].r;
assert.equal(replyQueued.status, 'queued');
const duplicate = (await db.query(
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
  [ids.opportunity, ids.operator, thread.id, ids.replyMessage, 'Liste faltantes.', [], key('a'),
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
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
  [ids.opportunity, ids.operator, thread.id, ids.learningMessage, 'Proponga aprendizaje.', [], key('b'),
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
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
  [ids.opportunity, ids.operator, thread.id, ids.draftMessage, 'Redacte versión.', [], key('c'),
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

// --- Task 7: RPC terminal transaccional psi_complete_agt002_workbench_job ---
// Mensaje agente + acciones requeridas + versión documental + evento completed en
// una única transacción PL/pgSQL: todo-o-nada, idempotente, revalidando base vigente.
const t = Object.freeze({
  draftMessage: '66666666-6666-4666-8666-666666666671',
  staleMessage: '66666666-6666-4666-8666-666666666672',
  rollbackMessage: '66666666-6666-4666-8666-666666666673',
  crossedSourceMessage: '66666666-6666-4666-8666-666666666674',
  crossedSource: '77777777-7777-4777-8777-777777777777',
});

const artB = (await db.query(
  `select public.psi_create_tender_dossier_artifact($1,$2,'tecnico_b','Documento B',true) as r`,
  [ids.opportunity, ids.operator],
)).rows[0].r.artifact;
const bv1 = (await db.query(
  `select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# B v1',null) as r`,
  [ids.opportunity, artB.id, ids.operator],
)).rows[0].r;

const draftJob = (await db.query(
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
  [ids.opportunity, ids.operator, thread.id, t.draftMessage, 'Redacte el documento B.', [], key('d'),
    'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
    'agt002.dossier-workbench.draft.v1', ids.snapshot, bv1.version_id],
)).rows[0].r;
const draftJobClaim = (await db.query(
  `select public.psi_claim_agt002_workbench_job('worker-test',20,2,300) as r`,
)).rows[0].r;
const draftResult = {
  kind: 'draft', visible_agent_name: 'Vig-IA', human_review_required: true,
  snapshot_id: ids.snapshot, base_version_id: bv1.version_id,
  artifact_id: artB.id, content_kind: 'markdown', content_text: '# B v2 agente', content_metadata: {},
  source_links: [], missing_information: [],
  required_actions: ['La encargada debe revisar el borrador de Vig-IA.'],
};
const completed = (await db.query(
  `select public.psi_complete_agt002_workbench_job($1,$2,$3,$4) as r`,
  [draftJob.job_id, draftJobClaim.claim_id, ids.agent, draftResult],
)).rows[0].r;
assert.equal(completed.status, 'completed');
// Un solo mensaje agente, una acción requerida y una versión v2 con procedencia al job.
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_messages where origin_job_id=$1`, [draftJob.job_id])).rows[0].n, 1);
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_required_actions where job_id=$1`, [draftJob.job_id])).rows[0].n, 1);
const v2 = (await db.query(`select version,author_kind,origin_agent_job_id,supersedes_version_id from public.psi_tender_dossier_artifact_versions where artifact_id=$1 order by version desc,id desc limit 1`, [artB.id])).rows[0];
assert.equal(v2.version, 2);
assert.equal(v2.author_kind, 'agent');
assert.equal(v2.origin_agent_job_id, draftJob.job_id);
assert.equal(v2.supersedes_version_id, bv1.version_id);
// El evento completed es el último y se emite al cierre de la transacción.
assert.equal((await db.query(`select event_type from public.psi_agt002_workbench_job_events where job_id=$1 order by created_at desc,id desc limit 1`, [draftJob.job_id])).rows[0].event_type, 'completed');

// Idempotencia: reintentar el mismo trabajo terminal retorna existing sin duplicar nada.
const replay = (await db.query(
  `select public.psi_complete_agt002_workbench_job($1,$2,$3,$4) as r`,
  [draftJob.job_id, draftJobClaim.claim_id, ids.agent, draftResult],
)).rows[0].r;
assert.equal(replay.status, 'existing');
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_messages where origin_job_id=$1`, [draftJob.job_id])).rows[0].n, 1);
assert.equal((await db.query(`select count(*)::int as n from public.psi_tender_dossier_artifact_versions where artifact_id=$1`, [artB.id])).rows[0].n, 2);
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_job_events where job_id=$1 and event_type='completed'`, [draftJob.job_id])).rows[0].n, 1);

// Un nuevo trabajo con base v1 obsoleta queda stale: no crea versión 3 ni mensaje agente.
const staleJob = (await db.query(
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
  [ids.opportunity, ids.operator, thread.id, t.staleMessage, 'Redacte el documento B otra vez.', [], key('e'),
    'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
    'agt002.dossier-workbench.draft.v1', ids.snapshot, bv1.version_id],
)).rows[0].r;
const staleJobClaim = (await db.query(`select public.psi_claim_agt002_workbench_job('worker-test',20,2,300) as r`)).rows[0].r;
const staleOut = (await db.query(
  `select public.psi_complete_agt002_workbench_job($1,$2,$3,$4) as r`,
  [staleJob.job_id, staleJobClaim.claim_id, ids.agent, { ...draftResult, content_text: '# B v3 agente' }],
)).rows[0].r;
assert.equal(staleOut.status, 'stale');
assert.equal((await db.query(`select count(*)::int as n from public.psi_tender_dossier_artifact_versions where artifact_id=$1`, [artB.id])).rows[0].n, 2);
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_messages where origin_job_id=$1`, [staleJob.job_id])).rows[0].n, 0);
assert.equal((await db.query(`select event_type from public.psi_agt002_workbench_job_events where job_id=$1 order by created_at desc,id desc limit 1`, [staleJob.job_id])).rows[0].event_type, 'stale');

// Atomicidad ante error tardío: contenido inválido rompe el insert de versión y hace
// rollback total; no queda mensaje, acción, versión ni evento terminal parcial.
const artC = (await db.query(
  `select public.psi_create_tender_dossier_artifact($1,$2,'tecnico_c','Documento C',true) as r`,
  [ids.opportunity, ids.operator],
)).rows[0].r.artifact;
const cv1 = (await db.query(
  `select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# C v1',null) as r`,
  [ids.opportunity, artC.id, ids.operator],
)).rows[0].r;
const rollbackJob = (await db.query(
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
  [ids.opportunity, ids.operator, thread.id, t.rollbackMessage, 'Redacte el documento C.', [], key('f'),
    'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
    'agt002.dossier-workbench.draft.v1', ids.snapshot, cv1.version_id],
)).rows[0].r;
const rollbackJobClaim = (await db.query(`select public.psi_claim_agt002_workbench_job('worker-test',20,2,300) as r`)).rows[0].r;
await assert.rejects(
  () => db.query(
    `select public.psi_complete_agt002_workbench_job($1,$2,$3,$4)`,
    [rollbackJob.job_id, rollbackJobClaim.claim_id, ids.agent,
      { ...draftResult, artifact_id: artC.id, base_version_id: cv1.version_id, content_text: '   ' }],
  ),
);
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_messages where origin_job_id=$1`, [rollbackJob.job_id])).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_required_actions where job_id=$1`, [rollbackJob.job_id])).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int as n from public.psi_tender_dossier_artifact_versions where artifact_id=$1`, [artC.id])).rows[0].n, 1);
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_job_events where job_id=$1 and event_type in ('completed','stale')`, [rollbackJob.job_id])).rows[0].n, 0);

// Defensa en profundidad: el RPC service-role también rechaza una fuente que no está
// en context_links congelado, aunque el llamador eluda el validador JavaScript.
const crossedJob = (await db.query(
  `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
  [ids.opportunity, ids.operator, thread.id, t.crossedSourceMessage, 'Responda sólo con el contexto autorizado.', [], key('9'),
    'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
    'agt002.dossier-workbench.reply.v1', ids.snapshot, null],
)).rows[0].r;
const crossedClaim = (await db.query(`select public.psi_claim_agt002_workbench_job('worker-test',20,2,300) as r`)).rows[0].r;
const crossedResult = {
  kind: 'reply', visible_agent_name: 'Vig-IA', human_review_required: true,
  snapshot_id: ids.snapshot, base_version_id: null,
  content_text: 'Respuesta con fuente ajena.', source_links: [t.crossedSource],
  missing_information: [], required_actions: ['La encargada debe verificar la fuente.'],
};
await assert.rejects(
  () => db.query(
    `select public.psi_complete_agt002_workbench_job($1,$2,$3,$4)`,
    [crossedJob.job_id, crossedClaim.claim_id, ids.agent, crossedResult],
  ),
  error => error.code === '23514' && /fuente|contexto/i.test(error.message),
);
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_messages where origin_job_id=$1`, [crossedJob.job_id])).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_job_events where job_id=$1 and event_type='completed'`, [crossedJob.job_id])).rows[0].n, 0);

await db.close();
console.log('PGlite AGT-002 workbench domain passed');
