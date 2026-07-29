import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Fase A de endurecimiento operacional de la Mesa AGT-002 (migración 046, aditiva sobre
// 045): barrido de leases expirados (crash de worker -> reclamable), cupo diario por
// trabajo DISTINTO (no por evento `claimed` repetido) e índice único parcial contra un
// segundo mensaje terminal para el mismo trabajo. No activa AGT-002 real; sólo dominio.
const dossierMigration = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const pilotMigration = readFileSync(new URL('../supabase/migrations/044_agt003_copilot_pilot_permission.sql', import.meta.url), 'utf8');
const workbenchMigration = readFileSync(new URL('../supabase/migrations/045_agt002_dossier_workbench.sql', import.meta.url), 'utf8');
const hardeningMigration = readFileSync(new URL('../supabase/migrations/046_agt002_workbench_runtime_hardening.sql', import.meta.url), 'utf8');
const hardeningRollback = readFileSync(new URL('../supabase/rollbacks/046_agt002_workbench_runtime_hardening_rollback.sql', import.meta.url), 'utf8');

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

async function freshDb() {
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

async function claim(db, { worker = 'worker-test', daily = 20, concurrent = 5, lease = 300 } = {}) {
  return (await db.query(
    `select public.psi_claim_agt002_workbench_job($1,$2,$3,$4) as r`,
    [worker, daily, concurrent, lease],
  )).rows[0].r;
}

async function sweep(db, pMax = 10) {
  return (await db.query(`select public.psi_sweep_agt002_workbench_expired_leases($1) as r`, [pMax])).rows[0].r;
}

async function latestEvent(db, jobId) {
  return (await db.query(
    `select event_type, claim_id, event_metadata from public.psi_agt002_workbench_job_events
     where job_id=$1 order by created_at desc, id desc limit 1`,
    [jobId],
  )).rows[0];
}

// --- Crash -> expiry -> sweep -> released -> re-claim ---
{
  const db = await freshDb();
  const thread = await getOrCreateThread(db);
  const jobId = await queueJob(db, thread.id);

  const claimed = await claim(db, { lease: 1 });
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.job.id, jobId);

  // El worker "se cae": nunca emite released/completed/failed. Esperamos a que el lease
  // de 1s expire de verdad (tiempo de reloj real; no hay mock de tiempo en este runner).
  await sleep(1100);

  const before = await sweep(db, 10);
  assert.equal(before.status, 'swept');
  assert.equal(before.released, 1);
  assert.deepEqual(before.job_ids, [jobId]);
  assert.equal(before.more, false);

  const ev = await latestEvent(db, jobId);
  assert.equal(ev.event_type, 'released');
  assert.equal(ev.claim_id, claimed.claim_id);
  assert.equal(ev.event_metadata.reason, 'lease_expired');

  const reclaimed = await claim(db, { worker: 'worker-recovered', lease: 300 });
  assert.equal(reclaimed.status, 'claimed');
  assert.equal(reclaimed.job.id, jobId);
  assert.notEqual(reclaimed.claim_id, claimed.claim_id);

  await db.close();
  console.log('AGT-002 046: crash -> expiry -> sweep -> released -> re-claim passed');
}

// --- Sweep is idempotent across repeated/overlapping invocations (no double release) ---
{
  const db = await freshDb();
  const thread = await getOrCreateThread(db);
  const jobA = await queueJob(db, thread.id);
  const jobB = await queueJob(db, thread.id);
  const jobC = await queueJob(db, thread.id);

  await claim(db, { worker: 'w1', lease: 1, concurrent: 10 });
  await claim(db, { worker: 'w2', lease: 1, concurrent: 10 });
  await claim(db, { worker: 'w3', lease: 1, concurrent: 10 });
  await sleep(1100);

  // Dos barridos concurrentes (misma clave de advisory lock que el claim): el total
  // liberado debe ser exactamente 3, sin duplicados, sin importar el entrelazado real.
  const [first, second] = await Promise.all([sweep(db, 2), sweep(db, 2)]);
  const totalReleased = first.released + second.released;
  assert.equal(totalReleased, 3, 'el barrido concurrente no debe perder ni duplicar liberaciones');
  const allIds = [...first.job_ids, ...second.job_ids].sort();
  assert.deepEqual(allIds, [jobA, jobB, jobC].sort(), 'cada trabajo se libera exactamente una vez');

  for (const jobId of [jobA, jobB, jobC]) {
    const releasedCount = (await db.query(
      `select count(*)::int as n from public.psi_agt002_workbench_job_events where job_id=$1 and event_type='released'`,
      [jobId],
    )).rows[0].n;
    assert.equal(releasedCount, 1, `job ${jobId} debe tener exactamente un evento released`);
  }

  // Un tercer barrido, ya sin nada expirado, es un no-op seguro.
  const third = await sweep(db, 10);
  assert.equal(third.released, 0);
  assert.deepEqual(third.job_ids, []);

  await db.close();
  console.log('AGT-002 046: barrido concurrente/repetido es seguro (sin duplicar liberaciones)');
}

// --- p_max bound ---
{
  const db = await freshDb();
  await assert.rejects(() => sweep(db, 0), /22023|rango/i);
  await assert.rejects(() => sweep(db, -1), /22023|rango/i);
  await assert.rejects(() => sweep(db, 501), /22023|rango/i);
  await assert.rejects(() => db.query(`select public.psi_sweep_agt002_workbench_expired_leases(null) as r`), /22023|rango/i);
  const ok = await sweep(db, 500);
  assert.equal(ok.status, 'swept');
  await db.close();
  console.log('AGT-002 046: p_max acotado (0, negativo, >500 y NULL rechazados; 500 aceptado)');
}

// --- ACL: PUBLIC/anon/authenticated cannot execute; service_role can ---
{
  const db = await freshDb();
  const priv = (await db.query(`select
    has_function_privilege('service_role','public.psi_sweep_agt002_workbench_expired_leases(integer)','EXECUTE') as svc,
    has_function_privilege('anon','public.psi_sweep_agt002_workbench_expired_leases(integer)','EXECUTE') as anon_exec,
    has_function_privilege('authenticated','public.psi_sweep_agt002_workbench_expired_leases(integer)','EXECUTE') as auth_exec
  `)).rows[0];
  assert.equal(priv.svc, true);
  assert.equal(priv.anon_exec, false);
  assert.equal(priv.auth_exec, false);

  const publicAcl = (await db.query(`select exists (
    select 1 from aclexplode(coalesce(
      (select proacl from pg_proc where oid=to_regprocedure('public.psi_sweep_agt002_workbench_expired_leases(integer)')),
      '{}'::aclitem[])) a
    where a.grantee=0 and a.privilege_type='EXECUTE'
  ) as public_exec`)).rows[0];
  assert.equal(publicAcl.public_exec, false, 'proacl no debe conceder EXECUTE a PUBLIC (grantee 0)');

  await db.exec('set role authenticated');
  await assert.rejects(() => db.query(`select public.psi_sweep_agt002_workbench_expired_leases(10)`), /permission denied/i);
  await db.exec('reset role');
  await db.exec('set role anon');
  await assert.rejects(() => db.query(`select public.psi_sweep_agt002_workbench_expired_leases(10)`), /permission denied/i);
  await db.exec('reset role');
  await db.exec('set role service_role');
  const asService = await sweep(db, 5);
  assert.equal(asService.status, 'swept');
  await db.exec('reset role');

  await db.close();
  console.log('AGT-002 046: sólo service_role ejecuta el barrido (ACL + proacl + intento real)');
}

// --- maxConcurrent=1 allows exactly one claim ---
{
  const db = await freshDb();
  const thread = await getOrCreateThread(db);
  await queueJob(db, thread.id);
  await queueJob(db, thread.id);

  const [a, b] = await Promise.all([
    claim(db, { worker: 'w-a', concurrent: 1 }),
    claim(db, { worker: 'w-b', concurrent: 1 }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ['claimed', 'saturated'], 'maxConcurrent=1 debe permitir exactamente un claim');

  await db.close();
  console.log('AGT-002 046: maxConcurrent=1 permite exactamente un claim');
}

// --- Repeated claim of same job after release consumes one distinct-job quota ---
{
  const db = await freshDb();
  const thread = await getOrCreateThread(db);
  const jobA = await queueJob(db, thread.id);
  const jobB = await queueJob(db, thread.id);

  // daily=2: con la semántica antigua (contar eventos claimed), 2 eventos sobre el MISMO
  // trabajo agotarían el cupo del día y bloquearían jobB indebidamente. Con la semántica
  // corregida (trabajos distintos), jobA sólo cuenta una vez pese a reclamarse dos veces.
  const firstClaim = await claim(db, { worker: 'w1', daily: 2, concurrent: 10, lease: 1 });
  assert.equal(firstClaim.status, 'claimed');
  assert.equal(firstClaim.job.id, jobA);
  await sleep(1100);
  await sweep(db, 10);

  const reclaim = await claim(db, { worker: 'w2', daily: 2, concurrent: 10, lease: 300 });
  assert.equal(reclaim.status, 'claimed');
  assert.equal(reclaim.job.id, jobA, 'jobA reclamado vuelve a ser el candidato más antiguo');

  const distinctClaimedToday = (await db.query(
    `select count(distinct job_id)::int as n from public.psi_agt002_workbench_job_events where event_type='claimed'`,
  )).rows[0].n;
  assert.equal(distinctClaimedToday, 1, 'dos claims del mismo trabajo cuentan como un solo trabajo distinto');

  const claimJobB = await claim(db, { worker: 'w3', daily: 2, concurrent: 10 });
  assert.equal(claimJobB.status, 'claimed', 'jobB (segundo trabajo distinto del día) aún cabe en el cupo de 2');
  assert.equal(claimJobB.job.id, jobB);

  // Ahora el cupo (2 trabajos distintos: jobA, jobB) está agotado. Un tercer trabajo NUEVO
  // debe quedar en quota, mientras que reclamar jobA o jobB de nuevo (tras liberarlos) NO
  // debe bloquearse por cupo, porque ya fueron contados hoy.
  const jobC = await queueJob(db, thread.id);
  const claimJobC = await claim(db, { worker: 'w4', daily: 2, concurrent: 10 });
  assert.equal(claimJobC.status, 'quota', 'un tercer trabajo distinto excede el cupo diario de 2');

  await db.query(`select public.psi_append_agt002_workbench_job_event($1,$2,'released','{}'::jsonb)`, [jobB, claimJobB.claim_id]);
  const reclaimJobB = await claim(db, { worker: 'w5', daily: 2, concurrent: 10 });
  assert.equal(reclaimJobB.status, 'claimed', 'reclamar un trabajo ya contado hoy no vuelve a cobrar cupo');
  assert.equal(reclaimJobB.job.id, jobB);

  await db.close();
  console.log('AGT-002 046: reclamar el mismo trabajo tras liberarlo consume un solo cupo distinto');
}

// --- Duplicate terminal message blocked by partial unique index ---
{
  const db = await freshDb();
  const thread = await getOrCreateThread(db);
  const jobId = await queueJob(db, thread.id);

  // Inserción directa (como dueño de la tabla, igual que las funciones SECURITY DEFINER)
  // para probar el índice como defensa en profundidad, más allá de la revalidación de
  // idempotencia del RPC terminal.
  await db.query(
    `insert into public.psi_agt002_workbench_messages(thread_id,opportunity_id,author_id,author_kind,visible_agent_name,content,origin_job_id)
     values ($1,$2,$3,'agent','Vig-IA','Primera respuesta terminal.',$4)`,
    [thread.id, ids.opportunity, ids.agent, jobId],
  );
  await assert.rejects(
    () => db.query(
      `insert into public.psi_agt002_workbench_messages(thread_id,opportunity_id,author_id,author_kind,visible_agent_name,content,origin_job_id)
       values ($1,$2,$3,'agent','Vig-IA','Segunda respuesta terminal duplicada.',$4)`,
      [thread.id, ids.opportunity, ids.agent, jobId],
    ),
    /duplicate key|unique/i,
  );
  // Un mensaje humano sin origin_job_id (NULL) nunca choca con el índice parcial.
  await db.query(
    `insert into public.psi_agt002_workbench_messages(thread_id,opportunity_id,author_id,author_kind,content)
     values ($1,$2,$3,'human','Comentario humano sin job de origen.')`,
    [thread.id, ids.opportunity, ids.operator],
  );

  await db.close();
  console.log('AGT-002 046: índice único parcial bloquea un segundo mensaje terminal del mismo trabajo');
}

// --- AGT-003 044 untouched ---
{
  const db = await freshDb();
  const holders = (await db.query(
    `select count(*)::int as n from public.psi_profile_permissions where permission_code='vigia_copilot_pilot'`,
  )).rows[0].n;
  assert.equal(holders, 1);
  const permActive = (await db.query(
    `select active from public.psi_access_permissions where code='vigia_copilot_pilot'`,
  )).rows[0].active;
  assert.equal(permActive, true);
  await db.close();
  console.log('AGT-002 046: AGT-003 (044) permanece intacto tras aplicar 046');
}

// --- 045 domain functions unaffected by 046 (spot check) ---
{
  const db = await freshDb();
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
  ], '046 no crea ni elimina tablas');
  await db.close();
}

// --- Rollback / reapply cycle ---
{
  const db = await freshDb();
  const thread = await getOrCreateThread(db);
  const jobId = await queueJob(db, thread.id);

  // Antes del rollback: cupo corregido (distinto) y sweep RPC presente.
  const preClaim = await claim(db, { daily: 1, concurrent: 10, lease: 1 });
  assert.equal(preClaim.status, 'claimed');
  await sleep(1100);
  await sweep(db, 10);
  const preReclaim = await claim(db, { daily: 1, concurrent: 10 });
  assert.equal(preReclaim.status, 'claimed', 'antes del rollback, reclamar no cobra cupo extra');

  await db.exec(hardeningRollback);

  const sweptGone = (await db.query(
    `select to_regprocedure('public.psi_sweep_agt002_workbench_expired_leases(integer)') is null as gone`,
  )).rows[0].gone;
  assert.equal(sweptGone, true, 'el RPC de barrido debe desaparecer tras el rollback');
  const indexGone = (await db.query(
    `select to_regclass('public.psi_agt002_workbench_messages_origin_job_unique') is null as gone`,
  )).rows[0].gone;
  assert.equal(indexGone, true, 'el índice único parcial debe desaparecer tras el rollback');

  // Tras el rollback, el cupo vuelve a ser por EVENTO (comportamiento exacto de 045):
  // dos eventos claimed sobre el MISMO trabajo agotan un cupo diario de 1.
  await db.query(`select public.psi_append_agt002_workbench_job_event($1,$2,'released','{}'::jsonb)`, [jobId, preReclaim.claim_id]);
  const afterRollbackReclaim = await claim(db, { daily: 1, concurrent: 10 });
  assert.equal(afterRollbackReclaim.status, 'quota', 'restaurado el comportamiento EXACTO de 045: el segundo evento claimed agota el cupo de 1');

  // Reaplicar 046 sobre el mismo estado: create-or-replace idempotente, sweep vuelve a existir.
  await db.exec(hardeningMigration);
  const sweptBack = (await db.query(
    `select to_regprocedure('public.psi_sweep_agt002_workbench_expired_leases(integer)') is not null as present`,
  )).rows[0].present;
  assert.equal(sweptBack, true);
  const indexBack = (await db.query(
    `select to_regclass('public.psi_agt002_workbench_messages_origin_job_unique') is not null as present`,
  )).rows[0].present;
  assert.equal(indexBack, true);
  // Tras reaplicar, el cupo vuelve a ser por trabajo distinto: el mismo trabajo ya
  // contado hoy no vuelve a bloquear con daily=1.
  const afterReapply = await claim(db, { daily: 1, concurrent: 10 });
  assert.equal(afterReapply.status, 'claimed', 'reaplicado 046, el trabajo ya contado hoy no vuelve a cobrar cupo');
  assert.equal(afterReapply.job.id, jobId);

  await db.close();
  console.log('AGT-002 046: ciclo rollback -> comportamiento exacto de 045 -> reaplicar -> comportamiento 046');
}

console.log('AGT-002 workbench runtime hardening (046) PGlite tests passed');
