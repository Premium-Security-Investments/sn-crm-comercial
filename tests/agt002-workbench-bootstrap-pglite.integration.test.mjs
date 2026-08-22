import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { getAgt002WorkbenchApi, postAgt002MessageApi } from '../agt002-workbench-api.js';
import { AGT002_WORKBENCH_CAPABILITIES } from '../agt002-workbench-contract.js';

// Arranque real de la Mesa post-GO contra PostgreSQL (PGlite) con las migraciones
// productivas 040 + 045: un primer GET crea el hilo de forma idempotente y deriva la
// referencia canónica del servidor, de modo que el primer mensaje de un expediente
// recién abierto (jobs=[]) encola trabajo sin bloqueo, sin hilos ni trabajos duplicados.
const dossierMigration = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const workbenchMigration = readFileSync(new URL('../supabase/migrations/045_agt002_dossier_workbench.sql', import.meta.url), 'utf8');

const ids = Object.freeze({
  operator: '11111111-1111-4111-8111-111111111111',
  fresh: '22222222-2222-4222-8222-222222222201',
  freshTender: '33333333-3333-4333-8333-333333333301',
  freshSnapshot: '44444444-4444-4444-8444-444444444401',
  freshRun: '55555555-5555-4555-8555-555555555501',
  contextVersion: '55555555-5555-4555-8555-555555555511',
  preGo: '22222222-2222-4222-8222-222222222202',
  preGoTender: '33333333-3333-4333-8333-333333333302',
  preGoSnapshot: '44444444-4444-4444-8444-444444444402',
  preGoRun: '55555555-5555-4555-8555-555555555502',
  noRun: '22222222-2222-4222-8222-222222222203',
  noRunTender: '33333333-3333-4333-8333-333333333303',
  nonCanonical: '22222222-2222-4222-8222-222222222204',
  nonCanonicalTender: '33333333-3333-4333-8333-333333333304',
  nonCanonicalSnapshot: '44444444-4444-4444-8444-444444444404',
  nonCanonicalRun: '55555555-5555-4555-8555-555555555504',
  firstMessage: '66666666-6666-4666-8666-666666666601',
  secondMessage: '66666666-6666-4666-8666-666666666602',
});
const operator = Object.freeze({
  id: ids.operator, active: true, identity_type: 'human', role: 'comercial', permissions: ['licitaciones'],
});
const enabled = Object.freeze({ enabled: true });

const canonicalResult = {
  questions: [{ id: 'Q1', text: '¿Falta la póliza de cumplimiento?', critical: true, evidence_refs: ['doc:1#3'] }],
  evidence_coverage: { snapshot_id: ids.freshSnapshot, material_omissions: false, omitted_chunks: [] },
};

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
    create table public.psi_tender_analysis_runs (
      id uuid primary key, opportunity_id uuid not null, tender_id uuid not null, snapshot_id uuid not null,
      producer text not null, method text not null, status text not null,
      canonical boolean not null default false, context_version_id uuid, legal_corpus_version_id uuid,
      result jsonb, created_at timestamptz not null default now());
    insert into public.psi_access_permissions(code) values ('licitaciones'),('licitaciones_custodia');
    insert into public.psi_sales_profiles(id,identity_type,role,full_name) values
      ('${ids.operator}','human','comercial','Encargada');
    insert into public.psi_profile_permissions(profile_id,permission_code) values ('${ids.operator}','licitaciones');
    insert into public.psi_sales_opportunities(id,tender_offer_status) values
      ('${ids.fresh}','en_preparacion'),('${ids.preGo}','en_preparacion'),
      ('${ids.noRun}','en_preparacion'),('${ids.nonCanonical}','en_preparacion');
    insert into public.psi_public_tenders(id,converted_opportunity_id) values
      ('${ids.freshTender}','${ids.fresh}'),('${ids.preGoTender}','${ids.preGo}'),
      ('${ids.noRunTender}','${ids.noRun}'),('${ids.nonCanonicalTender}','${ids.nonCanonical}');
    -- El expediente pre-GO existe y tiene análisis canónico, pero nunca recibió el GO humano.
    insert into public.psi_tender_go_no_go_decisions(opportunity_id,tender_id,decision) values
      ('${ids.fresh}','${ids.freshTender}','go'),
      ('${ids.noRun}','${ids.noRunTender}','go'),
      ('${ids.nonCanonical}','${ids.nonCanonicalTender}','go');
  `);
  await db.query(
    `insert into public.psi_tender_analysis_runs
       (id,opportunity_id,tender_id,snapshot_id,producer,method,status,canonical,context_version_id,result)
     values ($1,$2,$3,$4,'AGT-002','agent_ai','completed',true,$5,$6)`,
    [ids.freshRun, ids.fresh, ids.freshTender, ids.freshSnapshot, ids.contextVersion, JSON.stringify(canonicalResult)],
  );
  await db.query(
    `insert into public.psi_tender_analysis_runs
       (id,opportunity_id,tender_id,snapshot_id,producer,method,status,canonical,result)
     values ($1,$2,$3,$4,'AGT-002','agent_ai','completed',true,$5)`,
    [ids.preGoRun, ids.preGo, ids.preGoTender, ids.preGoSnapshot, JSON.stringify({ questions: [] })],
  );
  // Una corrida AGT-002 completada pero NO canónica jamás puede sembrar la Mesa.
  await db.query(
    `insert into public.psi_tender_analysis_runs
       (id,opportunity_id,tender_id,snapshot_id,producer,method,status,canonical,result)
     values ($1,$2,$3,$4,'AGT-002','agent_ai','completed',false,$5)`,
    [ids.nonCanonicalRun, ids.nonCanonical, ids.nonCanonicalTender, ids.nonCanonicalSnapshot, JSON.stringify({ questions: [] })],
  );
  await db.exec(dossierMigration);
  await db.exec(workbenchMigration);
  return db;
}

// Shim del cliente Supabase sobre PGlite: `.rpc` posicional para los RPC gobernados y un
// `.from(...).select().eq().order().limit()` mínimo para la lectura del análisis canónico.
const RPC_ARGS = Object.freeze({
  psi_get_or_create_agt002_workbench_thread: ['p_opportunity_id', 'p_actor_id'],
  psi_get_agt002_workbench: ['p_opportunity_id', 'p_actor_id'],
  psi_append_agt002_workbench_message: [
    'p_opportunity_id', 'p_actor_id', 'p_thread_id', 'p_message_id', 'p_content', 'p_context_links',
    'p_idempotency_key', 'p_contract_version', 'p_policy_version', 'p_capability_id',
    'p_snapshot_id', 'p_base_version_id',
  ],
});

function makeApiDb(db) {
  return {
    async rpc(name, args) {
      const order = RPC_ARGS[name];
      if (!order) throw new Error(`RPC no mapeada en el shim de arranque: ${name}`);
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
}

const db = await freshDb();
const api = makeApiDb(db);
const count = async (table, opportunityId) => Number(
  (await db.query(`select count(*)::int as n from public.${table} where opportunity_id=$1`, [opportunityId])).rows[0].n,
);

// ===========================================================================
// 1. Primer GET de un expediente GO recién abierto: crea hilo + referencia canónica.
// ===========================================================================
assert.equal(await count('psi_agt002_workbench_threads', ids.fresh), 0, 'el expediente arranca sin hilo');

const first = await getAgt002WorkbenchApi(api, ids.fresh, operator, enabled);
assert.equal(first.enabled, true);
assert.equal(await count('psi_agt002_workbench_threads', ids.fresh), 1, 'el primer GET debe crear exactamente un hilo');
const persistedThread = (await db.query(
  `select id, tender_id, created_by from public.psi_agt002_workbench_threads where opportunity_id=$1`, [ids.fresh],
)).rows[0];
assert.equal(first.thread_id, persistedThread.id, 'el thread_id servido debe ser el hilo persistido');
assert.equal(persistedThread.tender_id, ids.freshTender, 'el hilo debe colgar de la licitación del GO');
assert.equal(persistedThread.created_by, ids.operator, 'el hilo debe atribuirse al actor autenticado');

assert.deepEqual(first.jobs, [], 'una Mesa fresca no tiene trabajos');
assert.deepEqual(first.messages, []);
assert.equal(first.reference.snapshot_id, ids.freshSnapshot, 'la referencia debe venir del análisis canónico, no del cliente');
assert.equal(first.reference.canonical_run_id, ids.freshRun);
assert.equal(first.reference.context_version_id, ids.contextVersion);
assert.deepEqual(first.reference.evidence_coverage, { material_omissions: false, omitted_count: 0 });
assert.deepEqual(first.reference.open_questions.map(question => question.id), ['Q1']);
assert.deepEqual(
  first.reference.context_links.map(link => [link.kind, link.id]),
  [['snapshot', ids.freshSnapshot], ['source', ids.freshRun], ['source', ids.contextVersion]],
  'los vínculos seguros deben apuntar al snapshot, la corrida canónica y la versión de contexto',
);

// ===========================================================================
// 2. El GET es idempotente: nunca aparece un segundo hilo.
// ===========================================================================
const second = await getAgt002WorkbenchApi(api, ids.fresh, operator, enabled);
assert.equal(second.thread_id, first.thread_id);
assert.equal(await count('psi_agt002_workbench_threads', ids.fresh), 1, 'un segundo GET no debe crear otro hilo');

// ===========================================================================
// 3. Primer mensaje con jobs=[]: encola trabajo usando el snapshot canónico servido.
// ===========================================================================
const messageBody = {
  opportunity_id: ids.fresh,
  thread_id: first.thread_id,
  client_message_id: ids.firstMessage,
  content: 'Liste los faltantes del expediente.',
  context_links: first.reference.context_links,
  capability_id: AGT002_WORKBENCH_CAPABILITIES.reply,
  snapshot_id: first.reference.snapshot_id,
  base_version_id: null,
};
const queued = await postAgt002MessageApi(api, messageBody, operator, enabled);
assert.equal(queued.status, 'queued', 'el primer mensaje de una Mesa fresca debe encolar trabajo');
assert.equal(await count('psi_agt002_workbench_jobs', ids.fresh), 1);

const persistedJob = (await db.query(
  `select snapshot_id, capability_id, thread_id, requested_by, base_version_id
     from public.psi_agt002_workbench_jobs where opportunity_id=$1`, [ids.fresh],
)).rows[0];
assert.equal(persistedJob.snapshot_id, ids.freshSnapshot, 'el trabajo debe congelarse sobre el snapshot canónico');
assert.equal(persistedJob.capability_id, AGT002_WORKBENCH_CAPABILITIES.reply, 'la capacidad de respuesta se conserva');
assert.equal(persistedJob.base_version_id, null, 'la respuesta no cuelga de una versión documental');
assert.equal(persistedJob.thread_id, first.thread_id);
assert.equal(persistedJob.requested_by, ids.operator);

const persistedLinks = (await db.query(
  `select link_kind, resource_id from public.psi_agt002_workbench_message_links
     where opportunity_id=$1 order by link_kind, resource_id`, [ids.fresh],
)).rows;
assert.equal(persistedLinks.length, 3, 'los vínculos seguros del servidor deben quedar registrados con el mensaje');
assert.ok(persistedLinks.some(link => link.link_kind === 'snapshot' && link.resource_id === ids.freshSnapshot));
assert.ok(persistedLinks.some(link => link.link_kind === 'source' && link.resource_id === ids.freshRun));

// ===========================================================================
// 4. Reenvío idéntico: idempotente, sin trabajos ni mensajes duplicados.
// ===========================================================================
const replay = await postAgt002MessageApi(api, messageBody, operator, enabled);
assert.equal(replay.status, 'existing', 'el reenvío del mismo mensaje no debe encolar un segundo trabajo');
assert.equal(await count('psi_agt002_workbench_jobs', ids.fresh), 1);
assert.equal(await count('psi_agt002_workbench_messages', ids.fresh), 1);

// El GET posterior proyecta el trabajo como en curso: nunca como fallido observable.
const afterMessage = await getAgt002WorkbenchApi(api, ids.fresh, operator, enabled);
assert.equal(afterMessage.thread_id, first.thread_id, 'el hilo sigue siendo el mismo tras el primer mensaje');
assert.equal(afterMessage.jobs.length, 1);
assert.equal(afterMessage.jobs[0].status, 'in_progress');
assert.equal(afterMessage.reference.snapshot_id, ids.freshSnapshot, 'la referencia canónica sigue disponible con trabajos existentes');

// Un segundo mensaje distinto reutiliza el mismo hilo y añade un solo trabajo.
const secondQueued = await postAgt002MessageApi(api, {
  ...messageBody, client_message_id: ids.secondMessage, content: 'Confirme la experiencia acreditada.',
}, operator, enabled);
assert.equal(secondQueued.status, 'queued');
assert.equal(await count('psi_agt002_workbench_jobs', ids.fresh), 2);
assert.equal(await count('psi_agt002_workbench_threads', ids.fresh), 1, 'ningún mensaje puede abrir un segundo hilo');

// ===========================================================================
// 5. Fail-closed: pre-GO, sin corrida canónica y con corrida no canónica.
// ===========================================================================
await assert.rejects(
  () => getAgt002WorkbenchApi(api, ids.preGo, operator, enabled),
  error => {
    assert.match(String(error.code), /^AGT002_WORKBENCH_/, 'el error pre-GO debe salir mapeado');
    assert.ok(error.status >= 400, 'el expediente pre-GO nunca puede responder 200');
    return true;
  },
  'un expediente sin GO humano vigente no puede abrir la Mesa',
);
assert.equal(await count('psi_agt002_workbench_threads', ids.preGo), 0, 'un expediente pre-GO no debe dejar hilo');

for (const opportunityId of [ids.noRun, ids.nonCanonical]) {
  await assert.rejects(
    () => getAgt002WorkbenchApi(api, opportunityId, operator, enabled),
    error => error.code === 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS' && error.status === 409,
    'sin análisis canónico completado la Mesa debe fallar cerrada',
  );
  assert.equal(await count('psi_agt002_workbench_jobs', opportunityId), 0, 'un fallo cerrado no debe encolar trabajo');
}

await db.close();
console.log('AGT-002 workbench bootstrap PGlite integration passed');
