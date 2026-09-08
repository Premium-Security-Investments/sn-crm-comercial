// Fase 2 SQL del traspaso AGT-002 -> expediente post-GO (migración 082). RED reason: ni
// `psi_tender_dossier_agt002_sources` ni `psi_sync_agt002_post_go_checklist` existían antes de
// 082, así que toda RPC de este archivo fallaría con "function does not exist".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const m040 = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const m041 = readFileSync(new URL('../supabase/migrations/041_tender_dossier_go_seed.sql', import.meta.url), 'utf8');
const m042 = readFileSync(new URL('../supabase/migrations/042_tender_dossier_offer_gate.sql', import.meta.url), 'utf8');
const m082 = readFileSync(new URL('../supabase/migrations/082_tender_dossier_agt002_handoff.sql', import.meta.url), 'utf8');
// 083 reemplaza la RPC de sincronización (decisión GO sin anclaje, issue #187): todo el contrato de
// 082 que este archivo fija debe seguir cumpliéndose EXACTAMENTE igual con 083 aplicada encima.
const m083 = readFileSync(new URL('../supabase/migrations/083_tender_dossier_agt002_unanchored_go.sql', import.meta.url), 'utf8');

const ACTOR = '11111111-1111-4111-8111-111111111111';
const UNAUTHORIZED_ACTOR = '11111111-1111-4111-8111-111111111112';
const O = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_1 = '44444444-4444-4444-8444-444444444441';
const SNAPSHOT_2 = '44444444-4444-4444-8444-444444444442';
const RUN_1 = '55555555-5555-4555-8555-555555555551';
const RUN_2 = '55555555-5555-4555-8555-555555555552';
const RUN_OTHER = '55555555-5555-4555-8555-555555555559';
const DECISION_1 = '66666666-6666-4666-8666-666666666661';
const DECISION_2 = '66666666-6666-4666-8666-666666666662';
const DECISION_NO_GO = '66666666-6666-4666-8666-666666666663';
const RANDOM_DECISION = '66666666-6666-4666-8666-666666666669';

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

async function exec(db, sql, params = []) {
  return db.query(sql, params);
}

async function count(db, table, where = '') {
  const r = await db.query(`select count(*)::int as c from public.${table} ${where}`);
  return r.rows[0].c;
}

// Unidad V3 mínima: la RPC sólo inspecta unit_id/requirement_id/unit_kind/closure.status.
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
      producer text default 'AGT-002', method text default 'agent_ai',
      status text, canonical boolean default true, result jsonb
    );
    create table public.psi_tender_document_state (
      opportunity_id uuid primary key, current_snapshot_id uuid, refresh_in_progress boolean default false
    );
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, interaction_type text, created_by uuid, occurred_at timestamptz default now(), notes text);
    create or replace function public.psi_safe_jsonb(p_value text) returns jsonb language plpgsql immutable as $$
      begin return p_value::jsonb; exception when others then return null; end; $$;

    -- Stub mínimo del core de 8 argumentos que 041 renombra (patrón 039).
    create or replace function public.psi_record_tender_go_no_go(
      p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text,
      p_analysis_run_id uuid, p_justification text, p_preparation jsonb, p_document_hash text
    ) returns jsonb language plpgsql as $$
    begin
      return jsonb_build_object('tender_offer_status', 'en_preparacion');
    end; $$;

    -- Stub mínimo del core de 5 argumentos que 042 renombra (patrón 039).
    create table public.psi_tender_offer_status_transitions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, tender_id uuid, actor_id uuid, from_status text, to_status text, note text, changed_at timestamptz default now());
    create or replace function public.psi_transition_tender_offer_status(
      p_opportunity_id uuid, p_actor_id uuid, p_to_status text, p_expected_current_status text, p_note text default null)
    returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
    begin
      update public.psi_sales_opportunities set tender_offer_status = p_to_status where id = p_opportunity_id;
      return jsonb_build_object('status', p_to_status);
    end; $$;
    grant execute on function public.psi_transition_tender_offer_status(uuid,uuid,text,text,text) to service_role;

    insert into public.psi_access_permissions(code) values ('licitaciones');
    insert into public.psi_sales_profiles(id, role, full_name) values ('${ACTOR}','director','Ana Autorizada');
    insert into public.psi_profile_permissions values ('${ACTOR}','licitaciones');
    insert into public.psi_sales_profiles(id, active, role, full_name) values ('${UNAUTHORIZED_ACTOR}', false, 'director', 'Beto Inactivo');
    insert into public.psi_sales_opportunities values ('${O}','en_preparacion');
    insert into public.psi_public_tenders values ('${T}','${O}');
  `);
  await db.exec(m040);
  await db.exec(m041);
  await db.exec(m042);
  await db.exec(m082);
  await db.exec(m083);
  return db;
}

// Siembra una decisión GO vigente anclada a una corrida canónica completada, con el snapshot
// de la corrida marcado como el vigente de la oportunidad (sin refresco en curso).
async function seedGo(db, { decisionId, runId, snapshotId, units, supersedes = null, canonical = true, status = 'completed' }) {
  await exec(db, `insert into public.psi_tender_analysis_runs (id, opportunity_id, tender_id, snapshot_id, status, canonical, result) values ($1,$2,$3,$4,$5,$6,$7)`,
    [runId, O, T, snapshotId, status, canonical, JSON.stringify(runResult(units))]);
  await exec(db, `insert into public.psi_tender_document_state (opportunity_id, current_snapshot_id, refresh_in_progress) values ($1,$2,false)
    on conflict (opportunity_id) do update set current_snapshot_id = excluded.current_snapshot_id, refresh_in_progress = false`, [O, snapshotId]);
  await exec(db, `insert into public.psi_tender_go_no_go_decisions (id, opportunity_id, tender_id, decision, analysis_run_id, supersedes_decision_id) values ($1,$2,$3,'go',$4,$5)`,
    [decisionId, O, T, runId, supersedes]);
}

async function sync(db, { decisionId, runId, items, actorId = ACTOR }) {
  return callRpc(db, 'psi_sync_agt002_post_go_checklist', [O, actorId, decisionId, runId, jsonbArg(items)]);
}

// --- migration is re-executable -------------------------------------------------------------
await (async function migrationIsReexecutable() {
  const db = await baseDb();
  await db.exec(m082);
  // 082 vuelve a instalar su propia versión de la RPC, así que 083 debe reaplicarse después: ambas
  // son reejecutables y el orden de aplicación (083 > 082) es el que gobierna.
  await db.exec(m083);
  await db.exec(m083);
  await db.close();
})();

// --- happy path: creates item + source + created action; projection + readiness -------------
await (async function happyPathCreatesItemSourceAndProjection() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });

  const result = await sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].item_created, true);
  assert.equal(result.items[0].source_recorded, true);
  assert.equal(result.items[0].requirement_changed, false);

  assert.equal(await count(db, 'psi_tender_dossier_items', `where opportunity_id = '${O}'`), 1);
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 1);
  assert.equal(await count(db, 'psi_tender_dossier_item_actions'), 1);

  const dbItem = (await db.query(`select * from public.psi_tender_dossier_items where opportunity_id = $1`, [O])).rows[0];
  assert.equal(dbItem.origin, 'seed_agt002_post_go');
  assert.equal(dbItem.item_type, 'pendiente_humano');
  assert.equal(dbItem.required, true);

  const projected = await callRpc(db, 'psi_project_tender_dossier_item', [dbItem.id]);
  assert.equal(projected.status, 'pendiente');
  assert.equal(projected.instruction, item('req-1').instruction);
  assert.equal(projected.analysis_source.decision_id, DECISION_1);
  assert.equal(projected.analysis_source.analysis_run_id, RUN_1);
  assert.equal(projected.analysis_source.source_id, 'unit-req-1');
  assert.equal(projected.analysis_source.requirement_id, 'req-1');

  const readiness = await callRpc(db, 'psi_evaluate_tender_dossier_readiness', [O]);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.pending_required_items.some(p => p.item_key === 'agt002_post_go:req-1'));

  await db.close();
})();

// --- idempotencia completa: repetición exacta no duplica item/source/action -----------------
await (async function exactRepetitionIsFullyIdempotent() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  await sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] });

  const again = await sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] });
  assert.equal(again.items[0].item_created, false);
  assert.equal(again.items[0].source_recorded, false);
  assert.equal(again.items[0].requirement_changed, false);

  assert.equal(await count(db, 'psi_tender_dossier_items'), 1);
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 1);
  assert.equal(await count(db, 'psi_tender_dossier_item_actions'), 1);
  await db.close();
})();

// --- el source_hash es auditivo: repetir la MISMA unidad de la MISMA corrida con un hash
// arbitrariamente distinto sigue siendo un no-op, nunca una segunda fila de proveniencia --------
await (async function repeatedUnitWithDifferentHashIsStillANoOp() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  await sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] });

  const again = await sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1', { source_hash: 'b'.repeat(64) })] });
  assert.equal(again.items[0].source_recorded, false, 'un hash distinto no puede fabricar una nueva fila de proveniencia');
  assert.equal(again.items[0].requirement_changed, false, 'un hash distinto sobre la misma unidad no es un cambio de requisito');

  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 1);
  assert.equal(await count(db, 'psi_tender_dossier_item_actions'), 1);
  const stored = (await db.query(`select source_hash from public.psi_tender_dossier_agt002_sources`)).rows[0];
  assert.equal(stored.source_hash, 'a'.repeat(64), 'la fila auditiva original se conserva sin reescribirse');
  await db.close();
})();

// --- source_payload: la unidad V3 exacta leída del run, no nada suministrado por el llamador ---
await (async function sourcePayloadIsDerivedFromTheAnchoredRunUnit() {
  const db = await baseDb();
  const v3Unit = unit('req-1', { title: 'Capital de trabajo', closure: { status: 'open', condition: 'Revisión humana.' } });
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [v3Unit] });
  await sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] });

  const stored = (await db.query(`select source_payload from public.psi_tender_dossier_agt002_sources`)).rows[0];
  assert.deepEqual(stored.source_payload, { ...v3Unit, source_kind: 'integral_unit' });
  await db.close();
})();

// --- all-or-nothing: un candidato inválido en el lote descarta el lote completo --------------
await (async function batchIsAllOrNothingOnMalformedHash() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1'), unit('req-2')] });

  await assert.rejects(
    () => sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1'), item('req-2', { source_hash: 'not-a-hash' })] }),
    /source_hash/i,
  );
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 0);
  await db.close();
})();

// --- all-or-nothing: satisfied/malformed unit rejection --------------------------------------
await (async function evidenceSatisfiedAndMalformedUnitsAreRejected() {
  const db = await baseDb();
  await seedGo(db, {
    decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1,
    units: [unit('req-satisfied', { closure: { status: 'evidence_satisfied' } }), unit('req-wrong-kind', { unit_kind: 'strategic_consideration' })],
  });

  await assert.rejects(
    () => sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-satisfied')] }),
    /no corresponde a exactamente una unidad/i,
  );
  await assert.rejects(
    () => sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-wrong-kind')] }),
    /no corresponde a exactamente una unidad/i,
  );
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);
  await db.close();
})();

// --- malformed p_items shape: missing key rejects without mutating --------------------------
await (async function malformedItemShapeRejects() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  const bad = item('req-1');
  delete bad.instruction;
  await assert.rejects(
    () => sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [bad] }),
    /claves cerradas/i,
  );
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);
  await db.close();
})();

// --- exact decision/run required --------------------------------------------------------------
await (async function exactDecisionAndRunAreRequired() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  // Otra corrida completada/canónica de la misma oportunidad, no anclada a la decisión vigente.
  await exec(db, `insert into public.psi_tender_analysis_runs (id, opportunity_id, tender_id, snapshot_id, status, canonical, result) values ($1,$2,$3,$4,'completed',true,$5)`,
    [RUN_OTHER, O, T, SNAPSHOT_1, JSON.stringify(runResult([unit('req-1')]))]);

  await assert.rejects(
    () => sync(db, { decisionId: DECISION_1, runId: RUN_OTHER, items: [item('req-1')] }),
    /no es el análisis anclado/i,
  );
  await assert.rejects(
    () => sync(db, { decisionId: RANDOM_DECISION, runId: RUN_1, items: [item('req-1')] }),
    /no es la decisión GO vigente/i,
  );
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);
  await db.close();
})();

// --- run must be completed/canonical/current --------------------------------------------------
await (async function runMustBeCompletedCanonicalAndCurrent() {
  const nonCanonicalDb = await baseDb();
  await seedGo(nonCanonicalDb, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')], canonical: false });
  await assert.rejects(
    () => sync(nonCanonicalDb, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] }),
    /corrida canónica AGT-002 completada/i,
  );
  await nonCanonicalDb.close();

  const notCompletedDb = await baseDb();
  await seedGo(notCompletedDb, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')], status: 'failed' });
  await assert.rejects(
    () => sync(notCompletedDb, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] }),
    /corrida canónica AGT-002 completada/i,
  );
  await notCompletedDb.close();

  const staleSnapshotDb = await baseDb();
  await seedGo(staleSnapshotDb, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  // Un refresco documental posterior movió el snapshot vigente: la corrida anclada quedó vieja.
  await exec(staleSnapshotDb, `update public.psi_tender_document_state set current_snapshot_id = $1 where opportunity_id = $2`, [SNAPSHOT_2, O]);
  await assert.rejects(
    () => sync(staleSnapshotDb, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] }),
    /ya no es el análisis vigente/i,
  );
  await staleSnapshotDb.close();

  const refreshInProgressDb = await baseDb();
  await seedGo(refreshInProgressDb, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  await exec(refreshInProgressDb, `update public.psi_tender_document_state set refresh_in_progress = true where opportunity_id = $1`, [O]);
  await assert.rejects(
    () => sync(refreshInProgressDb, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] }),
    /ya no es el análisis vigente/i,
  );
  await refreshInProgressDb.close();
})();

// --- unauthorized actor ------------------------------------------------------------------------
await (async function unauthorizedActorRejected() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  await assert.rejects(
    () => sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')], actorId: UNAUTHORIZED_ACTOR }),
    /permisos/i,
  );
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);
  await db.close();
})();

// --- re-GO / nueva corrida: un cambio REAL de la unidad V3 (no del hash enviado) añade
// EXACTAMENTE una acción requirement_changed y conserva el status humano ------------------------
await (async function requirementChangeOnReGoAddsExactlyOneActionAndKeepsStatus() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  const first = await sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1', { status: 'bloqueado' })] });
  const itemId = first.items[0].item_id;

  // Humano avanza el estado manualmente antes de la re-corrida (para probar que no se revierte).
  await callRpc(db, 'psi_append_tender_dossier_item_action', [O, itemId, ACTOR, 'status_changed', 'en_progreso']);

  // Re-GO: nueva decisión vigente anclada a una nueva corrida canónica cuyo mismo requisito
  // cambió de verdad — closure.condition es distinto. El source_hash enviado es IDÉNTICO al de la
  // primera corrida: el cambio se detecta por la unidad verificada, nunca por el hash del cliente.
  const changedUnit = unit('req-1', { closure: { status: 'open', condition: 'Nueva condición de cierre.' } });
  await seedGo(db, { decisionId: DECISION_2, runId: RUN_2, snapshotId: SNAPSHOT_2, units: [changedUnit], supersedes: DECISION_1 });
  const second = await sync(db, { decisionId: DECISION_2, runId: RUN_2, items: [item('req-1', { status: 'bloqueado' })] });

  assert.equal(second.items[0].item_created, false);
  assert.equal(second.items[0].item_id, itemId);
  assert.equal(second.items[0].source_recorded, true);
  assert.equal(second.items[0].requirement_changed, true);

  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources', `where dossier_item_id = '${itemId}'`), 2);
  const actions = (await db.query(`select action_type, to_status from public.psi_tender_dossier_item_actions where item_id = $1 order by created_at, id`, [itemId])).rows;
  assert.deepEqual(actions.map(a => a.action_type), ['created', 'status_changed', 'requirement_changed']);
  assert.equal(actions[2].to_status, 'en_progreso'); // conserva el status humano vigente, no lo revierte a bloqueado.

  const projected = await callRpc(db, 'psi_project_tender_dossier_item', [itemId]);
  assert.equal(projected.status, 'en_progreso');
  assert.equal(projected.analysis_source.analysis_run_id, RUN_2);

  // Repetir la corrida ya sincronizada no vuelve a emitir el evento (una sola acción).
  const repeated = await sync(db, { decisionId: DECISION_2, runId: RUN_2, items: [item('req-1', { status: 'bloqueado' })] });
  assert.equal(repeated.items[0].source_recorded, false);
  assert.equal(repeated.items[0].requirement_changed, false);
  assert.equal(await count(db, 'psi_tender_dossier_item_actions', `where item_id = '${itemId}' and action_type = 'requirement_changed'`), 1);

  await db.close();
})();

// --- re-GO con la MISMA unidad y un hash arbitrario distinto: agrega proveniencia de la nueva
// corrida, pero NUNCA un falso cambio de requisito ---------------------------------------------
await (async function reGoWithUnchangedUnitNeverFakesAChangeEvenWithADifferentHash() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  const first = await sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] });
  const itemId = first.items[0].item_id;

  await seedGo(db, { decisionId: DECISION_2, runId: RUN_2, snapshotId: SNAPSHOT_2, units: [unit('req-1')], supersedes: DECISION_1 });
  const second = await sync(db, { decisionId: DECISION_2, runId: RUN_2, items: [item('req-1', { source_hash: 'b'.repeat(64) })] });

  assert.equal(second.items[0].source_recorded, true);
  assert.equal(second.items[0].requirement_changed, false, 'la unidad V3 no cambió: el hash enviado no puede declarar un cambio');
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources', `where dossier_item_id = '${itemId}'`), 2);
  assert.equal(await count(db, 'psi_tender_dossier_item_actions', `where item_id = '${itemId}'`), 1);
  await db.close();
})();

// --- GO -> NO-GO: sync falla por current GO, pero conserva la historia previa ----------------
await (async function noGoFailsSyncButPreservesHistory() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  await sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] });
  assert.equal(await count(db, 'psi_tender_dossier_items'), 1);

  await exec(db, `insert into public.psi_tender_go_no_go_decisions (id, opportunity_id, tender_id, decision, supersedes_decision_id) values ($1,$2,$3,'no_go',$4)`,
    [DECISION_NO_GO, O, T, DECISION_1]);

  await assert.rejects(
    () => sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] }),
    /decisión GO vigente/i,
  );
  // La historia previa (ítem, acción, proveniencia) permanece intacta.
  assert.equal(await count(db, 'psi_tender_dossier_items'), 1);
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 1);
  await db.close();
})();

// --- append-only: UPDATE/DELETE directos sobre la tabla de proveniencia se rechazan ----------
await (async function sourcesTableIsAppendOnly() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });
  await sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] });
  await assert.rejects(
    () => db.query(`update public.psi_tender_dossier_agt002_sources set source_hash = $1`, ['f'.repeat(64)]),
    /append-only/i,
  );
  await assert.rejects(
    () => db.query(`delete from public.psi_tender_dossier_agt002_sources`),
    /append-only/i,
  );
  await db.close();
})();

// --- seed 041 (seed_go) sigue intacto tras 082 -----------------------------------------------
await (async function seed041RemainsIntactAfter082() {
  const db = await baseDb();
  await exec(db, `insert into public.psi_tender_go_no_go_decisions (id, opportunity_id, tender_id, decision) values (gen_random_uuid(), $1, $2, 'go')`, [O, T]);
  const preparation = {
    kind: 'tender_offer_preparation',
    human_required_items: [{ key: 'validar_experiencia', title: 'Validar experiencia', priority: 'alta' }],
    planned_documents: [{ key: 'carta_presentacion', name: 'Carta de presentación' }],
  };
  await exec(db, `insert into public.psi_sales_interactions (opportunity_id, interaction_type, created_by, notes) values ($1,'documento',$2,$3)`,
    [O, ACTOR, JSON.stringify(preparation)]);

  const seeded = await callRpc(db, 'psi_seed_tender_dossier', [O, ACTOR]);
  assert.equal(seeded.seeded, true);
  const seedGoItem = (await db.query(`select * from public.psi_tender_dossier_items where opportunity_id = $1 and item_key = 'validar_experiencia'`, [O])).rows[0];
  assert.equal(seedGoItem.origin, 'seed_go');
  assert.equal(seedGoItem.required, true);

  const again = await callRpc(db, 'psi_seed_tender_dossier', [O, ACTOR]);
  assert.equal(again.seeded, false); // reejecutable, no duplica.
  await db.close();
})();

// --- item-key squatting: una fila humana preexistente con la clave reservada NUNCA se adopta ---
await (async function preexistingHumanRowOnAReservedKeyIsNeverAdopted() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });

  // Fila sembrada a mano directamente sobre la tabla (la RPC de creación ya rechaza el prefijo):
  // ocupa exactamente la clave que el traspaso iba a sembrar, con origin/item_type/required ajenos.
  await exec(db, `insert into public.psi_tender_dossier_items
    (opportunity_id, tender_id, item_key, title, item_type, required, origin, created_by)
    values ($1,$2,'agt002_post_go:req-1','Ítem humano que ocupa la clave','general',false,'human',$3)`, [O, T, ACTOR]);

  await assert.rejects(
    () => sync(db, { decisionId: DECISION_1, runId: RUN_1, items: [item('req-1')] }),
    /no adopta ítems ajenos/i,
  );

  // Ni proveniencia, ni acción, ni mutación de la fila ocupante: el lote entero se revierte.
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 0);
  assert.equal(await count(db, 'psi_tender_dossier_item_actions'), 0);
  const squatter = (await db.query(`select origin, item_type, required from public.psi_tender_dossier_items where item_key = 'agt002_post_go:req-1'`)).rows[0];
  assert.deepEqual(squatter, { origin: 'human', item_type: 'general', required: false });
  await db.close();
})();

// --- item-key squatting: la creación manual del prefijo reservado se rechaza de entrada --------
await (async function manualCreationCannotClaimTheReservedKeyPrefix() {
  const db = await baseDb();
  await seedGo(db, { decisionId: DECISION_1, runId: RUN_1, snapshotId: SNAPSHOT_1, units: [unit('req-1')] });

  for (const reserved of ['agt002_post_go:req-1', '  agt002_post_go:req-1  ', 'agt002_post_go:']) {
    await assert.rejects(
      () => callRpc(db, 'psi_create_tender_dossier_item', [O, ACTOR, reserved, 'Título', 'pendiente_humano', true]),
      /reservado al traspaso/i,
    );
  }
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);

  // El resto de la lógica de 040 sigue intacta: una clave normal se crea igual que antes.
  const created = await callRpc(db, 'psi_create_tender_dossier_item', [O, ACTOR, ' validar_experiencia ', ' Validar experiencia ', 'pendiente_humano', true]);
  assert.equal(created.item.item_key, 'validar_experiencia');
  assert.equal(created.item.title, 'Validar experiencia');
  assert.equal(created.item.origin, 'human');
  assert.equal(created.item.status, 'pendiente');
  await assert.rejects(
    () => callRpc(db, 'psi_create_tender_dossier_item', [O, ACTOR, 'x', 'Título', 'inexistente', true]),
    /Tipo de ítem inválido/i,
  );
  await assert.rejects(
    () => callRpc(db, 'psi_create_tender_dossier_item', [O, ACTOR, 'y', '   ', 'general', true]),
    /requiere un título/i,
  );
  await db.close();
})();

// --- privilegios: la proyección deja de ser ejecutable por public/anon/authenticated, y el
// overload legado de ocho argumentos deja de serlo por service_role -----------------------------
await (async function functionPrivilegesAreClosed() {
  const db = await baseDb();
  const projection = 'public.psi_project_tender_dossier_item(uuid)';
  const legacyEightArg = 'public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)';
  const privileges = (await db.query(
    `select
       has_function_privilege('anon', '${projection}', 'execute') as projection_anon,
       has_function_privilege('authenticated', '${projection}', 'execute') as projection_authenticated,
       has_function_privilege('service_role', '${projection}', 'execute') as projection_service_role,
       has_function_privilege('anon', '${legacyEightArg}', 'execute') as legacy_anon,
       has_function_privilege('authenticated', '${legacyEightArg}', 'execute') as legacy_authenticated,
       has_function_privilege('service_role', '${legacyEightArg}', 'execute') as legacy_service_role`,
  )).rows[0];
  assert.equal(privileges.projection_anon, false);
  assert.equal(privileges.projection_authenticated, false);
  assert.equal(privileges.projection_service_role, true, 'el backend sigue necesitando la proyección');
  assert.equal(privileges.legacy_anon, false);
  assert.equal(privileges.legacy_authenticated, false);
  assert.equal(privileges.legacy_service_role, false, 'ningún rol cliente puede registrar un GO saltándose el traspaso');
  await db.close();
})();

console.log('PGlite tender dossier AGT-002 handoff (082) passed');
