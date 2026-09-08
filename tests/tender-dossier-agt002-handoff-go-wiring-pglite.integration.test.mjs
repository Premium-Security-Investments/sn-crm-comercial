// Fase 3A del traspaso AGT-002 -> expediente post-GO: cableado atómico del GO. Ejercita el
// overload de NUEVE argumentos de psi_record_tender_go_no_go (082) end-to-end: el wrapper de
// ocho argumentos (siembra 041 incluida) + la sincronización (082 §3) dentro de la MISMA llamada
// y transacción. RED reason: el overload de nueve argumentos no existía antes de esta fase, así
// que toda RPC de este archivo fallaría con "function does not exist" / "no matching function".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const m040 = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const m041 = readFileSync(new URL('../supabase/migrations/041_tender_dossier_go_seed.sql', import.meta.url), 'utf8');
const m082 = readFileSync(new URL('../supabase/migrations/082_tender_dossier_agt002_handoff.sql', import.meta.url), 'utf8');

const ACTOR = '11111111-1111-4111-8111-111111111111';
const O = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_1 = '44444444-4444-4444-8444-444444444441';
const RUN_1 = '55555555-5555-4555-8555-555555555551';
const RUN_2 = '55555555-5555-4555-8555-555555555552';
const SNAPSHOT_2 = '44444444-4444-4444-8444-444444444442';

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object' && value.__jsonb) return `'${JSON.stringify(value.value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
const jsonbArg = value => ({ __jsonb: true, value });

async function callRpc(db, name, args) {
  const literal = args.map(sqlLiteral).join(',');
  const result = await db.query(`select public.${name}(${literal}) as data`);
  return result.rows[0]?.data ?? null;
}

async function count(db, table, where = '') {
  const r = await db.query(`select count(*)::int as c from public.${table} ${where}`);
  return r.rows[0].c;
}

function unit(requirementId, overrides = {}) {
  return {
    unit_id: `unit-${requirementId}`,
    requirement_id: requirementId,
    unit_kind: 'tender_requirement',
    closure: { status: 'open' },
    ...overrides,
  };
}
function runResult(units) {
  return { integral_analysis: { contract_version: 'agt002-integral-analysis-v3', coverage: {}, analysis_units: units } };
}
function item(requirementId, overrides = {}) {
  return {
    item_key: `agt002_post_go:${requirementId}`,
    requirement_id: requirementId,
    required: true,
    status: 'pendiente',
    title: 'Revisar capital de trabajo mínimo exigido',
    instruction: 'Revisar los estados financieros y el capital de trabajo.',
    source_kind: 'integral_unit',
    source_id: `unit-${requirementId}`,
    source_hash: 'a'.repeat(64),
    ...overrides,
  };
}

const PREPARATION = {
  kind: 'tender_offer_preparation',
  human_required_items: [{ key: 'validar_experiencia', title: 'Validar experiencia', priority: 'alta' }],
  planned_documents: [],
};

async function baseDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean default true, identity_type text default 'human', role text, full_name text);
    create table public.psi_access_permissions (code text primary key, active boolean default true);
    create table public.psi_profile_permissions (profile_id uuid, permission_code text);
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_go_no_go_decisions (
      id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, tender_id uuid, decision text, analysis_run_id uuid,
      decided_at timestamptz default now(), supersedes_decision_id uuid
    );
    create table public.psi_tender_analysis_runs (
      id uuid primary key, opportunity_id uuid, tender_id uuid, snapshot_id uuid,
      status text, canonical boolean default true, result jsonb
    );
    create table public.psi_tender_document_state (
      opportunity_id uuid primary key, current_snapshot_id uuid, refresh_in_progress boolean default false
    );
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, interaction_type text, created_by uuid, occurred_at timestamptz default now(), notes text);
    create or replace function public.psi_safe_jsonb(p_value text) returns jsonb language plpgsql immutable as $$
      begin return p_value::jsonb; exception when others then return null; end; $$;

    -- Stub REALISTA del core de ocho argumentos que 041 renombra (patrón 039): a diferencia de un
    -- stub trivial, éste inserta de verdad la decisión (con su analysis_run_id) y devuelve su
    -- decision_id, para poder ejercer el anclaje atómico de la fase 3A end-to-end.
    create or replace function public.psi_record_tender_go_no_go(
      p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text,
      p_analysis_run_id uuid, p_justification text, p_preparation jsonb, p_document_hash text
    ) returns jsonb language plpgsql as $$
    declare
      v_decision_id uuid;
      v_previous_id uuid;
    begin
      select d.id into v_previous_id from public.psi_tender_go_no_go_decisions d
        where d.opportunity_id = p_opportunity_id and d.tender_id = p_tender_id
          and not exists (select 1 from public.psi_tender_go_no_go_decisions c where c.supersedes_decision_id = d.id)
        order by d.decided_at desc, d.id desc limit 1;
      insert into public.psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision, analysis_run_id, supersedes_decision_id)
      values (p_opportunity_id, p_tender_id, p_decision, p_analysis_run_id, v_previous_id)
      returning id into v_decision_id;
      if p_preparation is not null then
        insert into public.psi_sales_interactions (opportunity_id, interaction_type, created_by, notes)
        values (p_opportunity_id, 'documento', p_actor_id, p_preparation::text);
      end if;
      return jsonb_build_object(
        'decision_id', v_decision_id, 'supersedes_decision_id', v_previous_id, 'decision', p_decision,
        'preparation_created', p_preparation is not null,
        'tender_offer_status', case when p_decision = 'go' then 'en_preparacion' else 'cerrada_no_go' end
      );
    end; $$;

    insert into public.psi_access_permissions(code) values ('licitaciones');
    insert into public.psi_sales_profiles(id, role, full_name) values ('${ACTOR}','director','Ana Autorizada');
    insert into public.psi_profile_permissions values ('${ACTOR}','licitaciones');
    insert into public.psi_sales_opportunities values ('${O}','pendiente_decision');
    insert into public.psi_public_tenders values ('${T}','${O}');
  `);
  await db.exec(m040);
  await db.exec(m041);
  await db.exec(m082);
  return db;
}

async function seedAnalysis(db, { runId, snapshotId, units }) {
  await db.query(`insert into public.psi_tender_analysis_runs (id, opportunity_id, tender_id, snapshot_id, status, canonical, result) values ($1,$2,$3,$4,'completed',true,$5)`,
    [runId, O, T, snapshotId, JSON.stringify(runResult(units))]);
  await db.query(`insert into public.psi_tender_document_state (opportunity_id, current_snapshot_id, refresh_in_progress) values ($1,$2,false)
    on conflict (opportunity_id) do update set current_snapshot_id = excluded.current_snapshot_id, refresh_in_progress = false`, [O, snapshotId]);
}

function decideWithHandoff(db, { decision = 'go', runId = RUN_1, items = null, preparation = PREPARATION } = {}) {
  return callRpc(db, 'psi_record_tender_go_no_go', [
    O, T, ACTOR, decision, runId, 'Margen y capacidad aprobados',
    preparation === null ? null : jsonbArg(preparation), 'a'.repeat(64),
    items === null ? null : jsonbArg(items),
  ]);
}

// --- migration is re-executable ----------------------------------------------------------------
await (async function migrationIsReexecutable() {
  const db = await baseDb();
  await db.exec(m082);
  await db.close();
})();

// --- happy path: seed (041) then sync (082) run inside the SAME call, decision preserved -------
await (async function seedThenSyncInSameCallPreservesPriorResult() {
  const db = await baseDb();
  await seedAnalysis(db, { runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('financial-working-capital')] });

  const result = await decideWithHandoff(db, { items: [item('financial-working-capital')] });
  assert.equal(result.decision, 'go');
  assert.equal(result.tender_offer_status, 'en_preparacion'); // prior 8-arg result key preserved.
  assert.ok(result.decision_id, 'decision_id from the eight-argument wrapper must survive untouched');
  assert.deepEqual(result.agt002_handoff, { synced: true, items_synced: 1 }); // non-technical handoff field.

  assert.equal(await count(db, 'psi_tender_go_no_go_decisions'), 1);
  const items = (await db.query(`select item_key, origin from public.psi_tender_dossier_items where opportunity_id = $1 order by item_key`, [O])).rows;
  const origins = new Set(items.map(row => row.origin));
  assert.ok(origins.has('seed_go'), 'seed 041 must still run inside the same call');
  assert.ok(origins.has('seed_agt002_post_go'), 'sync 082 must run inside the same call');
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 1);

  const source = (await db.query(`select decision_id, analysis_run_id from public.psi_tender_dossier_agt002_sources`)).rows[0];
  assert.equal(source.decision_id, result.decision_id);
  assert.equal(source.analysis_run_id, RUN_1);
  await db.close();
})();

// --- atomicity: a failing sync rolls back the decision AND the 041 seed --------------------------
await (async function failingSyncRollsBackDecisionAndSeed() {
  const db = await baseDb();
  await seedAnalysis(db, { runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('financial-working-capital')] });

  await assert.rejects(
    () => decideWithHandoff(db, { items: [item('financial-working-capital', { source_hash: 'not-a-hash' })] }),
    /source_hash/i,
  );
  assert.equal(await count(db, 'psi_tender_go_no_go_decisions'), 0, 'a failed sync must roll back the decision this same call inserted');
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0, 'a failed sync must roll back the 041 seed of this same call');
  assert.equal(await count(db, 'psi_sales_interactions'), 0, 'a failed sync must roll back the preparation interaction of this same call');
  await db.close();
})();

// --- NO-GO never syncs, no matter what p_agt002_items carries -----------------------------------
await (async function noGoNeverSyncsRegardlessOfItems() {
  const db = await baseDb();
  await seedAnalysis(db, { runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('financial-working-capital')] });

  const result = await decideWithHandoff(db, { decision: 'no_go', preparation: null, items: [item('financial-working-capital')] });
  assert.deepEqual(result.agt002_handoff, { synced: false });
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 0);
  await db.close();
})();

// --- null items is the explicit backward-compatible no-op ---------------------------------------
await (async function nullItemsIsExplicitNoOp() {
  const db = await baseDb();
  await seedAnalysis(db, { runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('financial-working-capital')] });

  const result = await decideWithHandoff(db, { items: null });
  assert.deepEqual(result.agt002_handoff, { synced: false });
  assert.equal(await count(db, 'psi_tender_go_no_go_decisions'), 1, 'the decision itself must still be recorded');
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 0);
  await db.close();
})();

// --- eight-argument overload keeps working unchanged (compat) -----------------------------------
await (async function eightArgumentOverloadStaysCompatible() {
  const db = await baseDb();
  const result = (await db.query(
    `select public.psi_record_tender_go_no_go($1::uuid,$2::uuid,$3::uuid,'go',null,'justificación',$4::jsonb,null) as r`,
    [O, T, ACTOR, JSON.stringify(PREPARATION)],
  )).rows[0].r;
  assert.equal(result.decision, 'go');
  assert.equal(Object.hasOwn(result, 'agt002_handoff'), false, 'the eight-argument overload must never add the nine-argument field');
  await db.close();
})();

// --- idempotency through the wrapper: a second GO/re-analysis never duplicates the item ---------
await (async function repeatedGoThroughWrapperIsIdempotent() {
  const db = await baseDb();
  await seedAnalysis(db, { runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('financial-working-capital')] });
  const first = await decideWithHandoff(db, { items: [item('financial-working-capital')] });
  assert.deepEqual(first.agt002_handoff, { synced: true, items_synced: 1 });

  await seedAnalysis(db, { runId: RUN_2, snapshotId: SNAPSHOT_2, units: [unit('financial-working-capital')] });
  const second = await decideWithHandoff(db, { runId: RUN_2, items: [item('financial-working-capital')] });
  assert.deepEqual(second.agt002_handoff, { synced: true, items_synced: 1 });

  assert.equal(await count(db, 'psi_tender_dossier_items', `where item_key = 'agt002_post_go:financial-working-capital'`), 1, 'unchanged re-sync must never duplicate the dossier item');
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 2, 'each GO still appends its own provenance row');
  await db.close();
})();

// --- grants: only service_role may execute the nine-argument overload ---------------------------
await (async function nineArgumentOverloadIsServiceRoleOnly() {
  const db = await baseDb();
  const signature = 'public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text,jsonb)';
  const privileges = (await db.query(
    `select
       has_function_privilege('anon', '${signature}', 'execute') as anon_can,
       has_function_privilege('authenticated', '${signature}', 'execute') as authenticated_can,
       has_function_privilege('service_role', '${signature}', 'execute') as service_role_can`,
  )).rows[0];
  assert.equal(privileges.anon_can, false);
  assert.equal(privileges.authenticated_can, false);
  assert.equal(privileges.service_role_can, true);
  await db.close();
})();

console.log('PGlite tender dossier AGT-002 handoff GO wiring (fase 3A, 082) passed');
