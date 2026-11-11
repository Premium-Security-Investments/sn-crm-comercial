import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { withAdvancingClock } from './helpers/pglite-advancing-clock.mjs';

// F5 de la auditoría del piloto Fiscalía (migración 182): el pedido de Supersalud `b8352089` falló 5 veces con
// AGT002_INVALID_JOB_INPUT y cada «Reintentar» lo devolvía al frente de la cola. Una entrada inválida y un pedido
// cancelado por el operador no se reintentan; un fallo pasajero (tiempo agotado) sí.
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const dossierMigration = migration('040_tender_dossier_workspace.sql');
const pilotMigration = migration('044_agt003_copilot_pilot_permission.sql');
const workbenchMigration = migration('045_agt002_dossier_workbench.sql');
const hardeningMigration = migration('046_agt002_workbench_runtime_hardening.sql');
const unlimitedMigration = migration('048_agt002_workbench_unlimited_production.sql');
const retryMigration = migration('182_agt002_workbench_retry_sin_invalidos.sql');
const retryRollback = readFileSync(new URL('../supabase/rollbacks/182_agt002_workbench_retry_sin_invalidos_rollback.sql', import.meta.url), 'utf8');

const ids = Object.freeze({
  operator: '11111111-1111-4111-8111-111111111111',
  agent: '11111111-1111-4111-8111-111111111113',
  juan: '11111111-1111-4111-8111-11111111111a',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  snapshot: '44444444-4444-4444-8444-444444444444',
});
const key = char => char.repeat(64);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freshDb({ withF5 = true } = {}) {
  const db = withAdvancingClock(new PGlite());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key, active boolean not null default true,
      identity_type text default 'human', role text not null, full_name text, microsoft_email text
    );
    create table public.psi_access_permissions (
      code text primary key, name text not null default '', description text, active boolean not null default true
    );
    create table public.psi_profile_permissions (
      profile_id uuid not null, permission_code text not null,
      created_at timestamptz not null default now(), created_by uuid,
      primary key(profile_id, permission_code)
    );
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_go_no_go_decisions (
      id uuid primary key default gen_random_uuid(), opportunity_id uuid, tender_id uuid,
      decision text, decided_at timestamptz default now(), supersedes_decision_id uuid);
    insert into public.psi_access_permissions(code) values ('licitaciones'),('licitaciones_custodia');
    insert into public.psi_sales_profiles(id,identity_type,role,full_name,microsoft_email) values
      ('${ids.operator}','human','comercial','Operador',null),
      ('${ids.agent}','agent','comercial','AGT-002',null),
      ('${ids.juan}','human','admin','Juan Botero','juanbotero@premiumsecurity.ai');
    insert into public.psi_profile_permissions(profile_id,permission_code) values
      ('${ids.operator}','licitaciones');
    insert into public.psi_sales_opportunities(id,tender_offer_status) values ('${ids.opportunity}','en_preparacion');
    insert into public.psi_public_tenders(id,converted_opportunity_id) values ('${ids.tender}','${ids.opportunity}');
    insert into public.psi_tender_go_no_go_decisions(opportunity_id,tender_id,decision)
      values ('${ids.opportunity}','${ids.tender}','go');
  `);
  await db.exec(dossierMigration);   // 040
  await db.exec(pilotMigration);     // 044 (AGT-003, independiente)
  await db.exec(workbenchMigration); // 045
  await db.exec(hardeningMigration); // 046
  await db.exec(unlimitedMigration); // 048
  if (withF5) await db.exec(retryMigration); // 182
  return db;
}

async function getOrCreateThread(db, actorId = ids.operator) {
  return (await db.query(
    `select public.psi_get_or_create_agt002_workbench_thread($1,$2) as r`,
    [ids.opportunity, actorId],
  )).rows[0].r;
}

let messageSeq = 0x60;
async function queueJob(db, threadId, { actorId = ids.operator } = {}) {
  messageSeq += 1;
  const messageId = `66666666-6666-4666-8666-6666666666${messageSeq.toString(16).padStart(2, '0')}`;
  const idem = messageSeq.toString(16).padStart(64, '0');
  const queued = (await db.query(
    `select public.psi_append_agt002_workbench_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
    [ids.opportunity, actorId, threadId, messageId, `Mensaje ${messageSeq}`, [], idem,
      'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
      'agt002.dossier-workbench.reply.v1', ids.snapshot, null],
  )).rows[0].r;
  return queued.job_id;
}


async function latestEvent(db, jobId) {
  return (await db.query(
    `select event_type from public.psi_agt002_workbench_job_events where job_id=$1 order by created_at desc, id desc limit 1`,
    [jobId],
  )).rows[0];
}


async function failWith(db, threadId, code) {
  const jobId = await queueJob(db, threadId);
  const claimed = (await db.query(`select public.psi_claim_agt002_workbench_job($1,$2,$3,$4) as r`, ['w', 0, 0, 300])).rows[0].r;
  assert.equal(claimed.job.id, jobId);
  await db.query(`select public.psi_append_agt002_workbench_job_event($1,$2,'failed',$3::jsonb)`,
    [jobId, claimed.claim_id, JSON.stringify({ code, message: 'prueba' })]);
  return jobId;
}

const retry = (db, jobId) => db.query(`select public.psi_retry_agt002_workbench_job($1,$2,$3) as r`, [ids.opportunity, ids.operator, jobId]);

test('caso Supersalud: un pedido con entrada inválida no se reintenta, y lo dice', async () => {
  const db = await freshDb();
  const threadId = (await getOrCreateThread(db)).id;
  const jobId = await failWith(db, threadId, 'AGT002_INVALID_JOB_INPUT');
  await assert.rejects(retry(db, jobId), /no se puede reintentar.*Escriba el mensaje de nuevo/);
  assert.equal((await latestEvent(db, jobId)).event_type, 'failed', 'no vuelve a la cola');
});

test('un pedido cancelado por el operador no se reintenta', async () => {
  const db = await freshDb();
  const threadId = (await getOrCreateThread(db)).id;
  const jobId = await failWith(db, threadId, 'AGT002_CANCELLED_BY_OPERATOR');
  await assert.rejects(retry(db, jobId), /fue cancelado/);
});

test('un fallo pasajero (tiempo agotado) sí se reintenta, como antes', async () => {
  const db = await freshDb();
  const threadId = (await getOrCreateThread(db)).id;
  const jobId = await failWith(db, threadId, 'AGT002_RESPONDER_TIMEOUT');
  assert.equal((await retry(db, jobId)).rows[0].r.status, 'released');
  assert.equal((await latestEvent(db, jobId)).event_type, 'released');
});

test('la reversa vuelve al reintento de la 045 y los permisos quedan sólo en service_role', async () => {
  const db = await freshDb();
  const grants = async () => (await db.query(`select grantee from information_schema.routine_privileges
    where routine_name='psi_retry_agt002_workbench_job' and privilege_type='EXECUTE'`)).rows.map(row => row.grantee);
  for (const role of ['anon', 'authenticated', 'PUBLIC']) assert.ok(!(await grants()).includes(role));
  assert.ok((await grants()).includes('service_role'));
  await db.exec(retryRollback);
  const threadId = (await getOrCreateThread(db)).id;
  const jobId = await failWith(db, threadId, 'AGT002_INVALID_JOB_INPUT');
  assert.equal((await retry(db, jobId)).rows[0].r.status, 'released');
  assert.ok(!(await grants()).includes('anon'));
});
