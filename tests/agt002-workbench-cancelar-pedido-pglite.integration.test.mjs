import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import { postAgt002CancelApi } from '../verticales/licitaciones/agt002-workbench-api.js';
import { waitingVigiaJobs } from '../src/tenders/workspace/vigiaChannelFailure.ts';

// F6 de la auditoría del piloto Fiscalía (migración 183): el 4-nov hubo que insertar a mano un `failed` para cancelar
// el relleno `6028444b` que esperaba turno. Ahora hay una función, una ruta y un botón, con quién y por qué.
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const dossierMigration = migration('040_tender_dossier_workspace.sql');
const pilotMigration = migration('044_agt003_copilot_pilot_permission.sql');
const workbenchMigration = migration('045_agt002_dossier_workbench.sql');
const hardeningMigration = migration('046_agt002_workbench_runtime_hardening.sql');
const unlimitedMigration = migration('048_agt002_workbench_unlimited_production.sql');
const cancelMigration = migration('183_agt002_workbench_cancelar_pedido.sql');
const cancelRollback = readFileSync(new URL('../supabase/rollbacks/183_agt002_workbench_cancelar_pedido_rollback.sql', import.meta.url), 'utf8');

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

async function freshDb({ withF6 = true } = {}) {
  const db = new PGlite();
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
  if (withF6) await db.exec(cancelMigration); // 183
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



const cancel = (db, jobId, reason = 'Relleno para despertar al worker; ya no hace falta.') => db.query(
  `select public.psi_cancel_agt002_workbench_job($1,$2,$3,$4) as r`, [ids.opportunity, ids.operator, jobId, reason]);

test('caso Fiscalía: un pedido en espera se cancela con quién y por qué, y sale de la cola', async () => {
  const db = await freshDb();
  const threadId = (await getOrCreateThread(db)).id;
  const relleno = await queueJob(db, threadId);
  assert.equal((await cancel(db, relleno)).rows[0].r.status, 'cancelled');
  const evento = (await db.query(`select event_type, event_metadata from public.psi_agt002_workbench_job_events
    where job_id=$1 order by created_at desc, id desc limit 1`, [relleno])).rows[0];
  assert.equal(evento.event_type, 'failed');
  assert.equal(evento.event_metadata.code, 'AGT002_CANCELLED_BY_OPERATOR');
  assert.equal(evento.event_metadata.cancelled_by, ids.operator);
  assert.match(evento.event_metadata.message, /Relleno/);
  const claim = (await db.query(`select public.psi_claim_agt002_workbench_job('w',0,0,300) as r`)).rows[0].r;
  assert.equal(claim.status, 'empty', 'el cancelado ya no se reclama');
});

test('lo que Vig-IA ya está atendiendo no se cancela; sin motivo tampoco', async () => {
  const db = await freshDb();
  const threadId = (await getOrCreateThread(db)).id;
  const jobId = await queueJob(db, threadId);
  await assert.rejects(cancel(db, jobId, '  '), /motivo/);
  await db.query(`select public.psi_claim_agt002_workbench_job('w',0,0,300)`);
  await assert.rejects(cancel(db, jobId), /todavía espera turno/);
});

test('un pedido de otra oportunidad no se cancela desde ésta, y un actor sin permiso tampoco', async () => {
  const db = await freshDb();
  const threadId = (await getOrCreateThread(db)).id;
  const jobId = await queueJob(db, threadId);
  await assert.rejects(db.query(`select public.psi_cancel_agt002_workbench_job($1,$2,$3,'motivo válido')`,
    ['99999999-9999-4999-8999-999999999999', ids.operator, jobId]), /no pertenece/);
  await assert.rejects(db.query(`select public.psi_cancel_agt002_workbench_job($1,$2,$3,'motivo válido')`,
    [ids.opportunity, ids.juan, jobId]));
});

test('la función sólo la ejecuta service_role, y la reversa la quita', async () => {
  const db = await freshDb();
  const grants = (await db.query(`select grantee from information_schema.routine_privileges
    where routine_name='psi_cancel_agt002_workbench_job' and privilege_type='EXECUTE'`)).rows.map(row => row.grantee);
  assert.ok(grants.includes('service_role'));
  for (const role of ['anon', 'authenticated', 'PUBLIC']) assert.ok(!grants.includes(role));
  await db.exec(cancelRollback);
  assert.equal((await db.query(`select 1 from pg_proc where proname='psi_cancel_agt002_workbench_job'`)).rows.length, 0);
});

test('la API exige motivo y no acepta claves de más', async () => {
  const profile = { id: ids.operator, active: true, identity_type: 'human', role: 'comercial', permissions: ['licitaciones'] };
  const database = { rpc: async () => ({ data: { status: 'cancelled' }, error: null }) };
  const body = { opportunity_id: ids.opportunity, job_id: '55555555-5555-4555-8555-555555555555' };
  await assert.rejects(postAgt002CancelApi(database, { ...body, reason: '' }, profile, { enabled: true }), /motivo/);
  await assert.rejects(postAgt002CancelApi(database, { ...body, reason: 'ok de verdad', actor_id: ids.juan }, profile, { enabled: true }), /claves inesperadas/);
});

test('la pantalla ofrece cancelar sólo lo que espera turno, del más antiguo al más reciente', () => {
  const jobs = [
    { id: 'b', status: 'queued', created_at: '2026-11-05T01:00:00Z' },
    { id: 'a', status: 'queued', created_at: '2026-11-04T23:19:00Z' },
    { id: 'c', status: 'in_progress', created_at: '2026-11-05T01:30:00Z' },
    { id: 'd', status: 'failed', created_at: '2026-11-05T01:40:00Z' },
  ];
  assert.deepEqual(waitingVigiaJobs(jobs).map(job => job.id), ['a', 'b']);
  const channel = readFileSync(new URL('../src/tenders/workspace/TenderVigiaChannel.tsx', import.meta.url), 'utf8');
  assert.match(channel, /cancelTenderDossierWorkbenchJob\(request, \{ opportunity_id: opportunityId, job_id: jobId, reason \}\)/);
  for (const file of ['../api/[...path].js', '../server/index.js']) {
    assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /app\.post\('\/api\/tender-dossier-workbench\/jobs\/cancel'/);
  }
});
