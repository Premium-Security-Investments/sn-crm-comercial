import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { getAgt002WorkbenchApi, postAgt002MessageApi, postAgt002RetryApi } from '../agt002-workbench-api.js';
import { AGT002_WORKBENCH_CAPABILITIES } from '../agt002-workbench-contract.js';
import {
  apply,
  countEvidence,
  detectState,
  preflight,
  rollback,
  verify,
} from '../scripts/agt002-workbench-job-status-migration.mjs';

// Migración 070 contra PostgreSQL real (PGlite) sobre las migraciones productivas 040 +
// 045: el runner dedicado la aplica y la verifica, y la lectura gobernada pasa a proyectar
// el último evento de cada trabajo, de modo que un fallo terminal sea VISIBLE y
// reintentable en lugar de confundirse con un trabajo en curso.
const dossierMigration = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const workbenchMigration = readFileSync(new URL('../supabase/migrations/045_agt002_dossier_workbench.sql', import.meta.url), 'utf8');

const ids = Object.freeze({
  operator: '11111111-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222301',
  tender: '33333333-3333-4333-8333-333333333301',
  snapshot: '44444444-4444-4444-8444-444444444401',
  run: '55555555-5555-4555-8555-555555555501',
});
const operator = Object.freeze({
  id: ids.operator, active: true, identity_type: 'human', role: 'comercial', permissions: ['licitaciones'],
});
const enabled = Object.freeze({ enabled: true });

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
  create table public.psi_tender_analysis_runs (
    id uuid primary key, opportunity_id uuid not null, tender_id uuid not null, snapshot_id uuid not null,
    producer text not null, method text not null, status text not null,
    canonical boolean not null default false, context_version_id uuid, legal_corpus_version_id uuid,
    result jsonb, created_at timestamptz not null default now());
  insert into public.psi_access_permissions(code) values ('licitaciones'),('licitaciones_custodia');
  insert into public.psi_sales_profiles(id,identity_type,role,full_name) values
    ('${ids.operator}','human','comercial','Encargada');
  insert into public.psi_profile_permissions(profile_id,permission_code) values ('${ids.operator}','licitaciones');
  insert into public.psi_sales_opportunities(id,tender_offer_status) values ('${ids.opportunity}','en_preparacion');
  insert into public.psi_public_tenders(id,converted_opportunity_id) values ('${ids.tender}','${ids.opportunity}');
  insert into public.psi_tender_go_no_go_decisions(opportunity_id,tender_id,decision) values
    ('${ids.opportunity}','${ids.tender}','go');
  insert into public.psi_tender_analysis_runs
    (id,opportunity_id,tender_id,snapshot_id,producer,method,status,canonical,result)
  values ('${ids.run}','${ids.opportunity}','${ids.tender}','${ids.snapshot}','AGT-002','agent_ai','completed',true,'{"questions":[]}'::jsonb);
`);
await db.exec(dossierMigration);
await db.exec(workbenchMigration);

// exec_sql equivalente al de producción: una cadena SQL entra, las filas del último
// resultado salen. Es la ÚNICA vía por la que el runner toca la base.
async function execSql(sql) {
  const results = await db.exec(sql);
  const last = results[results.length - 1];
  return Array.isArray(last?.rows) ? last.rows : [];
}

// Shim del cliente Supabase sobre PGlite (mismo que usa el arranque de la Mesa).
const RPC_ARGS = Object.freeze({
  psi_get_or_create_agt002_workbench_thread: ['p_opportunity_id', 'p_actor_id'],
  psi_get_agt002_workbench: ['p_opportunity_id', 'p_actor_id'],
  psi_retry_agt002_workbench_job: ['p_opportunity_id', 'p_actor_id', 'p_job_id'],
  psi_append_agt002_workbench_message: [
    'p_opportunity_id', 'p_actor_id', 'p_thread_id', 'p_message_id', 'p_content', 'p_context_links',
    'p_idempotency_key', 'p_contract_version', 'p_policy_version', 'p_capability_id',
    'p_snapshot_id', 'p_base_version_id',
  ],
});

const api = {
  async rpc(name, args) {
    const order = RPC_ARGS[name];
    if (!order) throw new Error(`RPC no mapeada en el shim: ${name}`);
    const params = order.map(key => {
      const value = args[key];
      if (value === undefined) return null;
      return typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
    });
    const placeholders = order.map((_, index) => `$${index + 1}`).join(',');
    try {
      const result = await db.query(`select public.${name}(${placeholders}) as r`, params);
      return { data: result.rows[0].r, error: null };
    } catch (error) {
      return { data: null, error: { message: error.message, code: error.code } };
    }
  },
  from(table) {
    const conditions = [];
    const params = [];
    const orders = [];
    let columns = '*';
    const builder = {
      select(selected) { columns = selected; return builder; },
      eq(column, value) { params.push(value); conditions.push(`${column} = $${params.length}`); return builder; },
      order(column, options) { orders.push(`${column} ${options?.ascending === false ? 'desc' : 'asc'}`); return builder; },
      async limit(count) {
        const sql = `select ${columns} from public.${table}`
          + (conditions.length ? ` where ${conditions.join(' and ')}` : '')
          + (orders.length ? ` order by ${orders.join(',')}` : '')
          + ` limit ${Number.parseInt(count, 10)}`;
        try {
          const result = await db.query(sql, params);
          return { data: result.rows, error: null };
        } catch (error) {
          return { data: null, error: { message: error.message, code: error.code } };
        }
      },
    };
    return builder;
  },
};

// ===========================================================================
// 1. Runner: preflight sobre 045 detecta 070 ausente y la aplica atómicamente.
// ===========================================================================
assert.equal(await detectState(execSql), 'absent', '045 sin 070 debe clasificar como ausente');
const beforeApply = await preflight(execSql);
assert.equal(beforeApply.state, 'absent');

const applied = await apply(execSql);
assert.equal(applied.ok, true, 'la verificación posterior a apply debe pasar');
assert.equal(await detectState(execSql), 'applied');

// La verificación cubre definición, seguridad y ACL: se comprueban explícitamente.
assert.equal(applied.row.security_definer, true, '070 debe conservar security definer');
assert.equal(applied.row.stable_volatility, true, '070 debe conservar el carácter stable');
assert.equal(applied.row.search_path_set, true, '070 debe conservar search_path=public,pg_temp');
assert.equal(applied.row.service_exec, true, 'sólo service_role ejecuta la lectura gobernada');
assert.equal(Number(applied.row.role_exec), 0, 'anon/authenticated jamás pueden ejecutarla');
assert.equal(applied.row.public_exec, false, 'PUBLIC no puede tener EXECUTE (proacl nulo incluido)');
assert.equal(Number(applied.row.tables_present), 8, '070 no puede tocar las tablas de 045');
assert.equal(Number(applied.row.untouched_rpc_present), 7, 'los otros 7 RPC de servicio siguen presentes');
assert.equal(Number(applied.row.untouched_rpc_service_exec), 7, 'y siguen siendo ejecutables por service_role');

// Aplicar dos veces es no-op idempotente, no un error.
assert.equal((await apply(execSql)).ok, true, 'aplicar 070 dos veces debe ser no-op verificado');

// ===========================================================================
// 2. Seis trabajos reales del hilo, uno por estado observable del log de eventos.
// ===========================================================================
const opened = await getAgt002WorkbenchApi(api, ids.opportunity, operator, enabled);
assert.equal(opened.reference.snapshot_id, ids.snapshot);

const CASES = Object.freeze([
  { key: 'queued', message: 'aa000000-0000-4000-8000-000000000001', events: [], expected: 'queued' },
  { key: 'released', message: 'aa000000-0000-4000-8000-000000000002', events: ['released'], expected: 'queued' },
  { key: 'claimed', message: 'aa000000-0000-4000-8000-000000000003', events: ['claimed'], expected: 'in_progress' },
  { key: 'completed', message: 'aa000000-0000-4000-8000-000000000004', events: ['claimed', 'completed'], expected: 'completed' },
  { key: 'failed', message: 'aa000000-0000-4000-8000-000000000005', events: ['claimed', 'failed'], expected: 'failed' },
  { key: 'stale', message: 'aa000000-0000-4000-8000-000000000006', events: ['claimed', 'stale'], expected: 'obsolete' },
]);

const jobIds = new Map();
for (const testCase of CASES) {
  const queued = await postAgt002MessageApi(api, {
    opportunity_id: ids.opportunity,
    thread_id: opened.thread_id,
    client_message_id: testCase.message,
    content: `Trabajo de prueba ${testCase.key}.`,
    context_links: opened.reference.context_links,
    capability_id: AGT002_WORKBENCH_CAPABILITIES.reply,
    snapshot_id: opened.reference.snapshot_id,
    base_version_id: null,
  }, operator, enabled);
  assert.equal(queued.status, 'queued');
  jobIds.set(testCase.key, queued.job_id);

  // Cada evento sembrado se sella justo después del último evento YA existente del trabajo.
  // No es cosmética: el desempate de "último evento" es `created_at desc, id desc` y los id
  // son uuid v4, así que dos eventos en el mismo instante se ordenarían al azar. Sellar
  // respecto del máximo (y no en el futuro) mantiene la cadena estrictamente creciente y deja
  // que cualquier evento real posterior —el `released` que inserta el RPC de reintento— siga
  // siendo el más reciente, igual que en producción.
  for (const event of testCase.events) {
    const columns = event === 'claimed'
      ? `,claim_id,worker_id,lease_expires_at`
      : '';
    const values = event === 'claimed'
      ? `,gen_random_uuid(),'worker-prueba',next.at+interval '5 minutes'`
      : '';
    await db.query(
      `insert into public.psi_agt002_workbench_job_events(job_id,event_type,created_at${columns})
       select $1,$2,next.at${values}
       from (select max(created_at)+interval '1 millisecond' as at
             from public.psi_agt002_workbench_job_events where job_id=$1) next`,
      [queued.job_id, event],
    );
  }
}

// Un trabajo SIN ningún evento (anomalía) debe seguir siendo visible y nunca completado:
// se inserta directamente porque el log es append-only y no admite borrar sus eventos.
const orphanJob = (await db.query(
  `insert into public.psi_agt002_workbench_jobs(
     thread_id,origin_message_id,opportunity_id,tender_id,snapshot_id,capability_id,
     contract_version,policy_version,context_links,message,requested_by,idempotency_key)
   select j.thread_id,j.origin_message_id,j.opportunity_id,j.tender_id,j.snapshot_id,j.capability_id,
     j.contract_version,j.policy_version,j.context_links,'Trabajo sin evento.',j.requested_by,
     repeat('f',64)
   from public.psi_agt002_workbench_jobs j where j.id=$1 returning id`,
  [jobIds.get('queued')],
)).rows[0].id;

// ===========================================================================
// 3. La lectura proyecta el estado real de cada trabajo.
// ===========================================================================
const projected = await getAgt002WorkbenchApi(api, ids.opportunity, operator, enabled);
const byId = new Map(projected.jobs.map(job => [job.id, job]));
assert.equal(projected.jobs.length, CASES.length + 1, 'todos los trabajos deben ser visibles, con evento o sin él');

for (const testCase of CASES) {
  const job = byId.get(jobIds.get(testCase.key));
  assert.ok(job, `el trabajo ${testCase.key} debe ser visible`);
  assert.equal(job.status, testCase.expected, `${testCase.key} debe proyectarse como ${testCase.expected}`);
  assert.equal(
    job.latest_event_type, testCase.events.at(-1) || 'queued',
    `${testCase.key} debe llevar su último evento observado`,
  );
  assert.ok(job.latest_event_at, 'el último evento debe traer su instante');
  // Todos los campos previos del trabajo se conservan intactos.
  assert.equal(job.snapshot_id, ids.snapshot);
  assert.equal(job.thread_id, opened.thread_id);
  assert.equal(job.opportunity_id, ids.opportunity);
  assert.equal(job.tender_id, ids.tender);
  assert.equal(job.capability_id, AGT002_WORKBENCH_CAPABILITIES.reply);
  assert.equal(job.contract_version, 'agt002.dossier-workbench.v1');
  assert.equal(job.policy_version, 'agt002.dossier-workbench.policy.v1');
  assert.equal(job.requested_by, ids.operator);
  assert.match(job.idempotency_key, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(job.context_links) && job.context_links.length === 2);
  assert.ok(job.created_at);
}

// El fallo terminal es VISIBLE como fallo, que es el único estado reintentable; la
// obsolescencia documental es igualmente VISIBLE, pero con estado propio y sin reintento.
assert.equal(byId.get(jobIds.get('failed')).status, 'failed');
assert.equal(byId.get(jobIds.get('stale')).status, 'obsolete');
assert.deepEqual(
  projected.jobs.filter(job => job.status === 'failed').map(job => job.latest_event_type), ['failed'],
  'ningún otro evento puede proyectarse como reintentable',
);
// Y lo desconocido/ausente nunca se afirma completado ni reintentable.
assert.equal(byId.get(orphanJob).latest_event_type, null);
assert.equal(byId.get(orphanJob).status, 'in_progress', 'un trabajo sin evento se proyecta conservadoramente');

// El resto del payload gobernado sigue exactamente igual que en 045.
assert.equal(projected.thread_id, opened.thread_id);
assert.equal(projected.messages.length, CASES.length);
assert.deepEqual(projected.required_actions, []);
assert.deepEqual(projected.learning_proposals, []);
assert.deepEqual(projected.active_learning_policies, []);

// ===========================================================================
// 4. Reintento: sólo el fallo terminal se acepta; el resto se rechaza mapeado.
// ===========================================================================
const retried = await postAgt002RetryApi(
  api, { opportunity_id: ids.opportunity, job_id: jobIds.get('failed') }, operator, enabled,
);
assert.equal(retried.status, 'released', 'un trabajo fallido debe poder reintentarse');

const afterRetry = await getAgt002WorkbenchApi(api, ids.opportunity, operator, enabled);
const retriedJob = afterRetry.jobs.find(job => job.id === jobIds.get('failed'));
assert.equal(retriedJob.latest_event_type, 'released');
assert.equal(retriedJob.status, 'queued', 'tras reintentar, el trabajo vuelve a la cola y deja de ofrecer reintento');

for (const key of ['queued', 'claimed', 'completed']) {
  await assert.rejects(
    () => postAgt002RetryApi(api, { opportunity_id: ids.opportunity, job_id: jobIds.get(key) }, operator, enabled),
    error => error.status === 409 && error.code === 'AGT002_WORKBENCH_IN_PROGRESS',
    `un trabajo ${key} no puede reintentarse`,
  );
}

// Coherencia superficie/base para `stale`: la base lo rechaza (045 sólo admite reintentar
// desde `failed`) y la proyección NO lo ofrece como reintentable, sino como `obsolete`. No se
// hace reintentable porque no puede serlo: ambos emisores de `stale` (045) lo levantan cuando
// el artefacto superó el `base_version_id` congelado del trabajo, y el trabajo es inmutable
// (append-only), así que reencolarlo volvería a quedar obsoleto en cada intento. La
// recuperación real es pedirlo de nuevo sobre la versión vigente, que la Mesa ya permite.
assert.equal(byId.get(jobIds.get('stale')).status, 'obsolete');
await assert.rejects(
  () => postAgt002RetryApi(api, { opportunity_id: ids.opportunity, job_id: jobIds.get('stale') }, operator, enabled),
  error => error.status === 409 && error.code === 'AGT002_WORKBENCH_IN_PROGRESS',
  'la base rechaza reintentar un trabajo obsoleto, y la superficie tampoco lo ofrece',
);

// ===========================================================================
// 5. Reversa: restaura 045 sin tocar evidencia, y la lectura vuelve a su forma previa.
// ===========================================================================
const evidenceBefore = await countEvidence(execSql);
assert.ok(evidenceBefore.jobs > 0 && evidenceBefore.job_events > 0, 'la reversa se prueba con evidencia real presente');

const reverted = await rollback(execSql);
assert.equal(reverted.ok, true, 'la reversa debe verificar como 045 restaurada');
assert.equal(await detectState(execSql), 'absent');
assert.deepEqual(await countEvidence(execSql), evidenceBefore, 'la reversa no puede alterar evidencia alguna');

const afterRollback = await getAgt002WorkbenchApi(api, ids.opportunity, operator, enabled);
assert.equal(afterRollback.jobs.length, CASES.length + 1, 'la lectura revertida sigue sirviendo todos los trabajos');
for (const job of afterRollback.jobs) {
  assert.equal(job.latest_event_type, null, 'sin 070 la lectura no expone el último evento');
  assert.equal(job.status, 'in_progress', 'sin 070 el estado degrada conservadoramente, nunca a completado');
}

// La reversa desde el estado ya revertido es no-op verificada.
assert.equal((await rollback(execSql)).ok, true);

// Y 070 vuelve a aplicarse limpiamente sobre la reversa (aditiva y reversible de verdad),
// incluso con un trabajo sin eventos presente: una anomalía de datos no invalida la
// migración, sólo se informa.
const evidenceBeforeReapply = await countEvidence(execSql);
assert.equal((await apply(execSql)).ok, true);
assert.deepEqual(await countEvidence(execSql), evidenceBeforeReapply, 'reaplicar no puede tocar evidencia');

const reapplied = await getAgt002WorkbenchApi(api, ids.opportunity, operator, enabled);
const reappliedById = new Map(reapplied.jobs.map(job => [job.id, job]));
assert.equal(
  reappliedById.get(jobIds.get('completed')).status, 'completed',
  'reaplicar 070 restituye la proyección exacta sobre la misma evidencia',
);
assert.equal(reappliedById.get(jobIds.get('stale')).status, 'obsolete');
assert.equal(reappliedById.get(orphanJob).status, 'in_progress');

// ===========================================================================
// 6. Preflight fail-closed: sin la superficie 045 el runner no envía nada.
// ===========================================================================
{
  const bare = new PGlite();
  await bare.exec('create table public.irrelevante(id int);');
  const bareExec = async sql => {
    const results = await bare.exec(sql);
    const last = results[results.length - 1];
    return Array.isArray(last?.rows) ? last.rows : [];
  };
  await assert.rejects(
    () => preflight(bareExec),
    /Prerrequisitos de la migración 045/,
    'sin 045 el preflight debe abortar en modo cerrado',
  );
  await assert.rejects(() => apply(bareExec), /Prerrequisitos de la migración 045/);
  await bare.close();
}

// Estado PARCIAL (función editada a mano): se aborta y se exige intervención humana.
{
  await db.exec(`
    create or replace function public.psi_get_agt002_workbench(p_opportunity_id uuid,p_actor_id uuid)
    returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
    begin
      -- migration-marker: agt002_workbench_job_status_v1
      return '{}'::jsonb;
    end;
    $$;
  `);
  assert.equal(await detectState(execSql), 'partial', 'marca sin proyección debe clasificar parcial');
  await assert.rejects(() => preflight(execSql), /PARCIAL/);
  await assert.rejects(() => apply(execSql), /PARCIAL/);
  await assert.rejects(() => rollback(execSql), /PARCIAL/);
}

await db.close();
console.log('AGT-002 workbench job status (070 + runner) PGlite integration passed');
