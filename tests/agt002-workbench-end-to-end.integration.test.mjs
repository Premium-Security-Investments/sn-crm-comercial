import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { runAgt002WorkbenchWorker } from '../agt002-workbench-worker.js';
import {
  claimAgt002WorkbenchJob,
  appendAgt002WorkbenchJobEvent,
  completeAgt002WorkbenchJob,
} from '../agt002-workbench-persistence.js';
import { createSyntheticAgt002Responder } from './fixtures/agt002-workbench-synthetic-responder.mjs';
import { ACTIONS, can } from '../access-control.js';

// End-to-end de la Mesa Vig-IA: versión agente + revisión por custodia + aprendizaje
// gobernado, atravesando worker → adapter → RPC transaccional contra PGlite real.
const dossierMigration = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const workbenchMigration = readFileSync(new URL('../supabase/migrations/045_agt002_dossier_workbench.sql', import.meta.url), 'utf8');

const ids = Object.freeze({
  operator: '11111111-1111-4111-8111-111111111111',
  custodian: '11111111-1111-4111-8111-111111111112',
  agent: '11111111-1111-4111-8111-111111111113',
  opportunity: '22222222-2222-4222-8222-222222222222',
  otherOpportunity: '22222222-2222-4222-8222-222222222223',
  tender: '33333333-3333-4333-8333-333333333333',
  snapshot: '44444444-4444-4444-8444-444444444444',
  draftMessage: '66666666-6666-4666-8666-666666666601',
  staleMessage: '66666666-6666-4666-8666-666666666602',
  learningMessage: '66666666-6666-4666-8666-666666666603',
  immutableMessage: '66666666-6666-4666-8666-666666666604',
  learningProposal: '55555555-5555-4555-8555-555555555501',
  immutableProposal: '55555555-5555-4555-8555-555555555502',
});
const key = char => char.repeat(64);
const limits = Object.freeze({
  workerId: 'worker-e2e', dailyMaxJobs: 20, maxConcurrent: 2, leaseSeconds: 300,
  responderTimeoutMs: 1000, agentId: ids.agent,
});

// Perfiles del matrix de autoridad, para verificar que la custodia no adquiere GO/NO-GO.
const custodianProfile = Object.freeze({
  id: ids.custodian, active: true, identity_type: 'human', role: 'comercial',
  permissions: ['licitaciones', 'licitaciones_custodia'],
});
const operatorProfile = Object.freeze({
  id: ids.operator, active: true, identity_type: 'human', role: 'comercial',
  permissions: ['licitaciones'],
});

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
  await db.exec(workbenchMigration);
  return db;
}

// Shim que traduce el adapter Supabase (.rpc con params nombrados) a las llamadas
// posicionales de PGlite, para ejercitar worker+adapter+RPC sin fingir persistencia.
const ARG_ORDER = Object.freeze({
  psi_claim_agt002_workbench_job: ['p_worker_id', 'p_daily_max_jobs', 'p_max_concurrent', 'p_lease_seconds'],
  psi_complete_agt002_workbench_job: ['p_job_id', 'p_claim_id', 'p_agent_id', 'p_result'],
  psi_append_agt002_workbench_job_event: ['p_job_id', 'p_claim_id', 'p_event_type', 'p_metadata'],
});
function makeAdapterDb(db) {
  return {
    async rpc(name, args) {
      const order = ARG_ORDER[name];
      if (!order) throw new Error(`RPC no mapeada en el shim E2E: ${name}`);
      const params = order.map(k => args[k]);
      const placeholders = order.map((_, index) => `$${index + 1}`).join(',');
      try {
        const res = await db.query(`select public.${name}(${placeholders}) as r`, params);
        return { data: res.rows[0].r, error: null };
      } catch (error) {
        return { data: null, error: { message: error.message, code: error.code } };
      }
    },
  };
}
function makeWorkerPersistence(db) {
  const database = makeAdapterDb(db);
  return {
    claimAgt002WorkbenchJob: args => claimAgt002WorkbenchJob(database, args),
    appendAgt002WorkbenchJobEvent: args => appendAgt002WorkbenchJobEvent(database, args),
    completeAgt002WorkbenchJob: args => completeAgt002WorkbenchJob(database, args),
  };
}

function rejectsSqlState(code, messagePattern) {
  return error => {
    assert.equal(error.code, code, `SQLSTATE esperado ${code}, recibido ${error.code}`);
    if (messagePattern) assert.match(error.message, messagePattern);
    return true;
  };
}

async function postMessage(db, { messageId, capabilityId, baseVersionId, idempotencyKey, content }) {
  return (await db.query(
    `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
    [ids.opportunity, ids.operator, threadId, messageId, content, [], idempotencyKey,
      'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
      capabilityId, ids.snapshot, baseVersionId ?? null],
  )).rows[0].r;
}

const db = await freshDb();
const threadId = (await db.query(
  `select public.psi_get_or_create_agt002_workbench_thread($1,$2) as r`,
  [ids.opportunity, ids.operator],
)).rows[0].r.id;
const persistence = makeWorkerPersistence(db);

// ===========================================================================
// Escenario 1 — versión agente + revisión por custodia (invariante 2).
// ===========================================================================
const artifact = (await db.query(
  `select public.psi_create_tender_dossier_artifact($1,$2,'carta_presentacion','Carta',true) as r`,
  [ids.opportunity, ids.operator],
)).rows[0].r.artifact;
const v1 = (await db.query(
  `select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# Carta v1',null) as r`,
  [ids.opportunity, artifact.id, ids.operator],
)).rows[0].r;

// (1) humano operativo crea mensaje/job sobre la versión 1.
const draftJob = await postMessage(db, {
  messageId: ids.draftMessage, capabilityId: 'agt002.dossier-workbench.draft.v1',
  baseVersionId: v1.version_id, idempotencyKey: key('a'), content: 'Redacte la carta.',
});
assert.equal(draftJob.status, 'queued');

// (2) worker con claim válido crea la versión 2 agente, todo mediante el RPC terminal.
const draftResponder = createSyntheticAgt002Responder({
  [ids.draftMessage]: {
    kind: 'draft', visible_agent_name: 'Vig-IA', human_review_required: true,
    snapshot_id: ids.snapshot, base_version_id: v1.version_id,
    artifact_id: artifact.id, content_kind: 'markdown', content_text: '# Carta v2 agente', content_metadata: {},
    source_links: [], missing_information: [],
    required_actions: ['La encargada debe revisar y aprobar la versión de Vig-IA.'],
  },
});
const draftOutcome = await runAgt002WorkbenchWorker({ persistence, responder: draftResponder, limits });
assert.deepEqual(draftOutcome, { status: 'completed', job_id: draftJob.job_id });

// (3) versión 2: author_kind='agent', origin_agent_job_id, perfil identity_type='agent'.
const v2 = (await db.query(
  `select v.id, v.version, v.author_kind, v.origin_agent_job_id, v.supersedes_version_id, p.identity_type
   from public.psi_tender_dossier_artifact_versions v
   join public.psi_sales_profiles p on p.id=v.author_id
   where v.artifact_id=$1 order by v.version desc limit 1`,
  [artifact.id],
)).rows[0];
assert.equal(v2.version, 2);
assert.equal(v2.author_kind, 'agent');
assert.equal(v2.origin_agent_job_id, draftJob.job_id);
assert.equal(v2.supersedes_version_id, v1.version_id);
assert.equal(v2.identity_type, 'agent');

// (4) proyección: review_status='pendiente' y has_approved_version=false.
let projection = (await db.query(`select public.psi_project_tender_dossier_artifact($1) as r`, [artifact.id])).rows[0].r;
assert.equal(projection.review_status, 'pendiente');
assert.equal(projection.has_approved_version, false);
assert.equal(projection.current_version.version, 2);
assert.equal(projection.current_version.author_kind, 'agent');
assert.equal(projection.current_version.origin_agent_job_id, draftJob.job_id);

// (5) intento de revisión por operador sin custodia → 42501.
await assert.rejects(
  () => db.query(`select public.psi_record_tender_dossier_artifact_review($1,$2,'aprobado','ok')`, [v2.id, ids.operator]),
  rejectsSqlState('42501', /custodia|permis/i),
);
projection = (await db.query(`select public.psi_project_tender_dossier_artifact($1) as r`, [artifact.id])).rows[0].r;
assert.equal(projection.has_approved_version, false);

// (6) custodia aprueba la versión 2.
await db.query(`select public.psi_record_tender_dossier_artifact_review($1,$2,'aprobado','Revisado por la encargada')`, [v2.id, ids.custodian]);
projection = (await db.query(`select public.psi_project_tender_dossier_artifact($1) as r`, [artifact.id])).rows[0].r;
assert.equal(projection.review_status, 'aprobado');
assert.equal(projection.has_approved_version, true);

// (7) la custodia sigue sin poder ejecutar GO/NO-GO (matrix de autoridad).
assert.equal(can(custodianProfile, ACTIONS.LICITACIONES_WORKBENCH_CUSTODY, {}), true);
assert.equal(can(custodianProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, {}), false);
assert.equal(can(operatorProfile, ACTIONS.LICITACIONES_WORKBENCH_CUSTODY, {}), false);

// (8) un nuevo job con base versión 1 queda stale y no crea la versión 3.
const staleJob = await postMessage(db, {
  messageId: ids.staleMessage, capabilityId: 'agt002.dossier-workbench.draft.v1',
  baseVersionId: v1.version_id, idempotencyKey: key('b'), content: 'Redacte la carta de nuevo.',
});
const staleResponder = createSyntheticAgt002Responder({
  [ids.staleMessage]: {
    kind: 'draft', visible_agent_name: 'Vig-IA', human_review_required: true,
    snapshot_id: ids.snapshot, base_version_id: v1.version_id,
    artifact_id: artifact.id, content_kind: 'markdown', content_text: '# Carta v3 agente', content_metadata: {},
    source_links: [], missing_information: [],
    required_actions: ['La encargada debe revisar el borrador.'],
  },
});
const staleOutcome = await runAgt002WorkbenchWorker({ persistence, responder: staleResponder, limits });
assert.deepEqual(staleOutcome, { status: 'stale', job_id: staleJob.job_id });
assert.equal((await db.query(`select count(*)::int as n from public.psi_tender_dossier_artifact_versions where artifact_id=$1`, [artifact.id])).rows[0].n, 2);
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_messages where origin_job_id=$1`, [staleJob.job_id])).rows[0].n, 0);

// ===========================================================================
// Escenario 2 — aprendizaje institucional gobernado (invariante 3).
// ===========================================================================
const learningJob = await postMessage(db, {
  messageId: ids.learningMessage, capabilityId: 'agt002.dossier-workbench.learning-proposal.v1',
  baseVersionId: null, idempotencyKey: key('c'), content: 'Corrija: siempre pedir el certificado de experiencia.',
});
const learningClaim = (await db.query(`select public.psi_claim_agt002_workbench_job('worker-e2e',20,2,300) as r`)).rows[0].r;
assert.equal(learningClaim.job.id, learningJob.job_id);
const learningResult = {
  kind: 'learning_proposal', visible_agent_name: 'Vig-IA', human_review_required: true,
  snapshot_id: ids.snapshot, base_version_id: null,
  proposal_id: ids.learningProposal, proposal_type: 'pattern',
  proposed_rule: 'Solicitar el certificado de experiencia cuando el pliego lo exija.', scope: 'entity',
  valid_from: '2026-07-28T00:00:00.000Z', valid_until: '2027-07-28T00:00:00.000Z',
  source_message_id: learningClaim.job.origin_message_id, source_links: [],
};
assert.equal((await db.query(
  `select public.psi_complete_agt002_workbench_job($1,$2,$3,$4) as r`,
  [learningJob.job_id, learningClaim.claim_id, ids.agent, learningResult],
)).rows[0].r.status, 'completed');

// La propuesta existe como pendiente y NO se proyecta como política activa.
let workspace = (await db.query(`select public.psi_get_agt002_workbench($1,$2) as r`, [ids.opportunity, ids.custodian])).rows[0].r;
let learningProjection = workspace.learning_proposals.find(p => p.id === ids.learningProposal);
assert.ok(learningProjection);
assert.equal(learningProjection.review_status, 'pendiente');
assert.equal(workspace.active_learning_policies.some(p => p.proposal_id === ids.learningProposal), false);

// Rechazos gobernados antes de aprobar.
// (a) actor sin custodia no puede aprobar.
await assert.rejects(
  () => db.query(`select public.psi_review_agt002_learning_proposal($1,$2,$3,'approved','entity','ok')`, [ids.opportunity, ids.operator, ids.learningProposal]),
  rejectsSqlState('42501', /permis/i),
);
// (b) auto-promoción por el agente rechazada (identidad no humana).
await assert.rejects(
  () => db.query(`select public.psi_review_agt002_learning_proposal($1,$2,$3,'approved','entity','ok')`, [ids.opportunity, ids.agent, ids.learningProposal]),
  rejectsSqlState('42501', /permis/i),
);
// (c) scope inválido rechazado.
await assert.rejects(
  () => db.query(`select public.psi_review_agt002_learning_proposal($1,$2,$3,'approved','global','ok')`, [ids.opportunity, ids.custodian, ids.learningProposal]),
  rejectsSqlState('22023', /alcance|scope/i),
);
// (d) decisión que cruza oportunidad rechazada.
await assert.rejects(
  () => db.query(`select public.psi_review_agt002_learning_proposal($1,$2,$3,'approved','entity','ok')`, [ids.otherOpportunity, ids.custodian, ids.learningProposal]),
  rejectsSqlState('23514', /oportunidad|expediente/i),
);
// Ninguno de los rechazos escribió una decisión.
assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_learning_decisions where proposal_id=$1`, [ids.learningProposal])).rows[0].n, 0);

// La custodia aprueba con alcance y vigencia → decisión append-only → política activa.
const reviewed = (await db.query(
  `select public.psi_review_agt002_learning_proposal($1,$2,$3,'approved','entity','Aprobado por la encargada') as r`,
  [ids.opportunity, ids.custodian, ids.learningProposal],
)).rows[0].r;
assert.equal(reviewed.decision, 'approved');
assert.equal(reviewed.approved_scope, 'entity');
// Append-only: no se puede volver a decidir la misma propuesta.
await assert.rejects(
  () => db.query(`select public.psi_review_agt002_learning_proposal($1,$2,$3,'rejected','entity','otra')`, [ids.opportunity, ids.custodian, ids.learningProposal]),
  rejectsSqlState('23505', /revisad|ya fue/i),
);
// La decisión es inmutable (append-only) a nivel de tabla.
await assert.rejects(
  () => db.query(`update public.psi_agt002_learning_decisions set decision='rejected' where proposal_id=$1`, [ids.learningProposal]),
  /append-only/i,
);

// La proyección ahora muestra la política activa con alcance y vigencia.
workspace = (await db.query(`select public.psi_get_agt002_workbench($1,$2) as r`, [ids.opportunity, ids.custodian])).rows[0].r;
learningProjection = workspace.learning_proposals.find(p => p.id === ids.learningProposal);
assert.equal(learningProjection.review_status, 'approved');
const activePolicy = workspace.active_learning_policies.find(p => p.proposal_id === ids.learningProposal);
assert.ok(activePolicy, 'la política aprobada debe proyectarse como activa');
assert.equal(activePolicy.scope, 'entity');
assert.equal(activePolicy.valid_from, '2026-07-28T00:00:00+00:00');
assert.equal(activePolicy.valid_until, '2027-07-28T00:00:00+00:00');

// Rechazo de límites inmutables: una propuesta que promueve categoría exclusivamente
// humana no puede aprobarse aunque el alcance sea válido.
const immutableJob = await postMessage(db, {
  messageId: ids.immutableMessage, capabilityId: 'agt002.dossier-workbench.learning-proposal.v1',
  baseVersionId: null, idempotencyKey: key('e'), content: 'Corrección de autonomía documental.',
});
const immutableClaim = (await db.query(`select public.psi_claim_agt002_workbench_job('worker-e2e',20,2,300) as r`)).rows[0].r;
const immutableResult = {
  kind: 'learning_proposal', visible_agent_name: 'Vig-IA', human_review_required: true,
  snapshot_id: ids.snapshot, base_version_id: null,
  proposal_id: ids.immutableProposal, proposal_type: 'rule',
  proposed_rule: 'Permitir que Vig-IA firmar y presentar las garantías sin revisión humana.', scope: 'psi_rule',
  valid_from: '2026-07-28T00:00:00.000Z', valid_until: null,
  source_message_id: immutableClaim.job.origin_message_id, source_links: [],
};
assert.equal((await db.query(
  `select public.psi_complete_agt002_workbench_job($1,$2,$3,$4) as r`,
  [immutableJob.job_id, immutableClaim.claim_id, ids.agent, immutableResult],
)).rows[0].r.status, 'completed');
await assert.rejects(
  () => db.query(`select public.psi_review_agt002_learning_proposal($1,$2,$3,'approved','psi_rule','ok')`, [ids.opportunity, ids.custodian, ids.immutableProposal]),
  rejectsSqlState('42501', /inmutable|exclusivamente humana/i),
);
// La propuesta inmutable no puede activarse.
workspace = (await db.query(`select public.psi_get_agt002_workbench($1,$2) as r`, [ids.opportunity, ids.custodian])).rows[0].r;
assert.equal(workspace.active_learning_policies.some(p => p.proposal_id === ids.immutableProposal), false);

await db.close();
console.log('E2E AGT-002 workbench governance passed');
