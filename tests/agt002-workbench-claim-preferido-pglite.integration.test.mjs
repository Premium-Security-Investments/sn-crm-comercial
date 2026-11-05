import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import { claimAgt002WorkbenchJob } from '../verticales/licitaciones/agt002-workbench-persistence.js';

// F4 de la auditoría del piloto Fiscalía (migración 184; en el libro, 181): la pregunta de Fiscalía esperó 2 h 16 min porque el drain
// del mensaje reclamaba el pedido más antiguo de todas las oportunidades (un pedido viejo de Supersalud). El drain
// ahora reclama primero el pedido del propio mensaje.
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const dossierMigration = migration('040_tender_dossier_workspace.sql');
const pilotMigration = migration('044_agt003_copilot_pilot_permission.sql');
const workbenchMigration = migration('045_agt002_dossier_workbench.sql');
const hardeningMigration = migration('046_agt002_workbench_runtime_hardening.sql');
const unlimitedMigration = migration('048_agt002_workbench_unlimited_production.sql');
const preferredMigration = migration('184_agt002_workbench_claim_preferido.sql');
const preferredRollback = readFileSync(new URL('../supabase/rollbacks/184_agt002_workbench_claim_preferido_rollback.sql', import.meta.url), 'utf8');

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

async function freshDb({ withPreferred = true } = {}) {
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
  if (withPreferred) await db.exec(preferredMigration); // 184
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


// La persistencia real sobre PGlite: `database.rpc(nombre, args)` como lo hace supabase-js, con el mismo código de
// error de PostgREST cuando la función no existe.
function pgliteDatabase(db) {
  return {
    async rpc(name, args) {
      const keys = Object.keys(args);
      const exists = (await db.query('select 1 from pg_proc where proname=$1', [name])).rows.length > 0;
      if (!exists) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
      const call = `select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(',')}) as r`;
      return { data: (await db.query(call, keys.map(key => args[key]))).rows[0].r, error: null };
    },
  };
}

const LIMITS = Object.freeze({ workerId: 'mesa-inline', dailyMaxJobs: 0, maxConcurrent: 0, leaseSeconds: 300 });

test('caso Fiscalía: con un pedido viejo en cola, el drain del mensaje nuevo reclama el pedido nuevo', async () => {
  const db = await freshDb();
  const threadId = (await getOrCreateThread(db)).id;
  const viejo = await queueJob(db, threadId);
  const nuevo = await queueJob(db, threadId);
  const claim = await claimAgt002WorkbenchJob(pgliteDatabase(db), { ...LIMITS, preferredJobId: nuevo });
  assert.equal(claim.status, 'claimed');
  assert.equal(claim.job.id, nuevo);
  // El viejo no se pierde: el reclamo de siempre (barrido periódico) lo toma después.
  const siguiente = await claimAgt002WorkbenchJob(pgliteDatabase(db), LIMITS);
  assert.equal(siguiente.job.id, viejo);
});

test('si el pedido preferido ya no está en cola, se reclama el más antiguo como siempre', async () => {
  const db = await freshDb();
  const threadId = (await getOrCreateThread(db)).id;
  const viejo = await queueJob(db, threadId);
  const claim = await claimAgt002WorkbenchJob(pgliteDatabase(db), { ...LIMITS, preferredJobId: '99999999-9999-4999-8999-999999999999' });
  assert.equal(claim.job.id, viejo);
});

test('el reclamo preferido respeta el tope de concurrencia', async () => {
  const db = await freshDb();
  const threadId = (await getOrCreateThread(db)).id;
  await queueJob(db, threadId);
  const nuevo = await queueJob(db, threadId);
  await claimAgt002WorkbenchJob(pgliteDatabase(db), { ...LIMITS, maxConcurrent: 1 });
  const saturado = await claimAgt002WorkbenchJob(pgliteDatabase(db), { ...LIMITS, maxConcurrent: 1, preferredJobId: nuevo });
  assert.equal(saturado.status, 'saturated');
});

test('sin la 181 aplicada el código no se cae: reclama el más antiguo', async () => {
  const db = await freshDb({ withPreferred: false });
  const threadId = (await getOrCreateThread(db)).id;
  const viejo = await queueJob(db, threadId);
  const nuevo = await queueJob(db, threadId);
  const claim = await claimAgt002WorkbenchJob(pgliteDatabase(db), { ...LIMITS, preferredJobId: nuevo });
  assert.equal(claim.job.id, viejo);
});

test('la función nueva sólo la ejecuta service_role, y la reversa la quita', async () => {
  const db = await freshDb();
  const grants = (await db.query(`select grantee from information_schema.routine_privileges
    where routine_name='psi_claim_agt002_workbench_job_preferido' and privilege_type='EXECUTE'`)).rows.map(row => row.grantee);
  assert.ok(grants.includes('service_role'));
  for (const role of ['anon', 'authenticated', 'PUBLIC']) assert.ok(!grants.includes(role), `${role} no debe ejecutarla`);
  await db.exec(preferredRollback);
  assert.equal((await db.query(`select 1 from pg_proc where proname='psi_claim_agt002_workbench_job_preferido'`)).rows.length, 0);
});

test('el mensaje de la Mesa le pasa su propio pedido al drain (Vercel y servidor)', () => {
  for (const file of ['../api/[...path].js', '../server/index.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /drainAgt002WorkbenchAfterMessage\(database, queued\?\.job_id\)/);
    assert.match(source, /drain\.runOnce\(\{ preferredJobId:/);
  }
  const runtime = readFileSync(new URL('../verticales/licitaciones/agt002-workbench-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /async runOnce\(\{ preferredJobId = null \} = \{\}\)/);
});
