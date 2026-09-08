// Issue #187 (caso REAL de Cali): la decisión GO vigente del expediente quedó registrada con
// `analysis_run_id` NULL. 082 exige igualdad exacta con `p_analysis_run_id`, de modo que ese
// expediente no podía sembrarse nunca. 083 reemplaza `psi_sync_agt002_post_go_checklist`
// conservando toda la lógica de 082 y abriendo un único caso legado ESTRICTO para ese GO sin
// anclaje. RED reason: contra 082 sola, el primer sync de este archivo falla con "El análisis
// indicado no es el análisis anclado a la decisión GO vigente".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const m040 = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const m041 = readFileSync(new URL('../supabase/migrations/041_tender_dossier_go_seed.sql', import.meta.url), 'utf8');
const m042 = readFileSync(new URL('../supabase/migrations/042_tender_dossier_offer_gate.sql', import.meta.url), 'utf8');
const m082 = readFileSync(new URL('../supabase/migrations/082_tender_dossier_agt002_handoff.sql', import.meta.url), 'utf8');
const m083 = readFileSync(new URL('../supabase/migrations/083_tender_dossier_agt002_unanchored_go.sql', import.meta.url), 'utf8');

const ACTOR = '11111111-1111-4111-8111-111111111111';
const O = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_1 = '44444444-4444-4444-8444-444444444441';
const SNAPSHOT_2 = '44444444-4444-4444-8444-444444444442';
const RUN_1 = '55555555-5555-4555-8555-555555555551';
const RUN_OTHER = '55555555-5555-4555-8555-555555555559';
const DECISION_UNANCHORED = '66666666-6666-4666-8666-666666666661';

// Cinco requisitos abiertos: el lote real de un expediente legado, no un único ítem de juguete.
const REQUIREMENTS = ['req-financiero', 'req-experiencia', 'req-juridico', 'req-tecnico', 'req-plazo'];

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

// Corrida LEGADA: sobre V3 estructurado sin la propiedad propia `evidence_coverage` (anterior a ese
// bloque), que es exactamente el caso que 083 admite sin anclaje.
function legacyRunResult(units) {
  return { integral_analysis: { contract_version: 'agt002-integral-analysis-v3', coverage: {}, analysis_units: units } };
}

function item(requirementId, overrides = {}) {
  return {
    item_key: `agt002_post_go:${requirementId}`,
    requirement_id: requirementId,
    required: true,
    status: 'pendiente',
    title: `Revisar ${requirementId}`,
    instruction: `Revisar la evidencia de ${requirementId}.`,
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

    create or replace function public.psi_record_tender_go_no_go(
      p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text,
      p_analysis_run_id uuid, p_justification text, p_preparation jsonb, p_document_hash text
    ) returns jsonb language plpgsql as $$
    begin
      return jsonb_build_object('tender_offer_status', 'en_preparacion');
    end; $$;

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

// Siembra la situación de Cali: decisión GO vigente SIN analysis_run_id y una corrida canónica
// completada vigente que sí es AGT-002/agent_ai.
async function seedUnanchoredGo(db, {
  runId = RUN_1,
  snapshotId = SNAPSHOT_1,
  units = REQUIREMENTS.map(id => unit(id)),
  result = null,
  canonical = true,
  status = 'completed',
  producer = 'AGT-002',
  method = 'agent_ai',
  decisionId = DECISION_UNANCHORED,
  analysisRunId = null,
} = {}) {
  await db.query(
    `insert into public.psi_tender_analysis_runs (id, opportunity_id, tender_id, snapshot_id, producer, method, status, canonical, result)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [runId, O, T, snapshotId, producer, method, status, canonical, JSON.stringify(result ?? legacyRunResult(units))],
  );
  await db.query(
    `insert into public.psi_tender_document_state (opportunity_id, current_snapshot_id, refresh_in_progress) values ($1,$2,false)
     on conflict (opportunity_id) do update set current_snapshot_id = excluded.current_snapshot_id, refresh_in_progress = false`,
    [O, snapshotId],
  );
  await db.query(
    `insert into public.psi_tender_go_no_go_decisions (id, opportunity_id, tender_id, decision, analysis_run_id) values ($1,$2,$3,'go',$4)`,
    [decisionId, O, T, analysisRunId],
  );
}

function sync(db, { decisionId = DECISION_UNANCHORED, runId = RUN_1, items = REQUIREMENTS.map(id => item(id)), actorId = ACTOR } = {}) {
  return callRpc(db, 'psi_sync_agt002_post_go_checklist', [O, actorId, decisionId, runId, jsonbArg(items)]);
}

// --- 083 es reejecutable y se aplica después de 082 ---------------------------------------------
await (async function migrationIsReexecutable() {
  const db = await baseDb();
  await db.exec(m083);
  await db.exec(m082); // 082 reinstala su versión...
  await db.exec(m083); // ...y 083 vuelve a reemplazarla: el orden de aplicación es el que gobierna.
  await db.close();
})();

// --- éxito: GO sin anclaje + corrida legada vigente -> 5 ítems y 5 filas de proveniencia --------
await (async function unanchoredGoSeedsTheWholeLegacyBatch() {
  const db = await baseDb();
  await seedUnanchoredGo(db);

  const result = await sync(db);
  assert.equal(result.items.length, 5);
  assert.equal(result.analysis_run_id, RUN_1, 'el resultado reporta la corrida server-owned usada');
  assert.equal(result.decision_id, DECISION_UNANCHORED);
  for (const entry of result.items) {
    assert.equal(entry.item_created, true);
    assert.equal(entry.source_recorded, true);
    assert.equal(entry.requirement_changed, false);
  }

  assert.equal(await count(db, 'psi_tender_dossier_items', `where opportunity_id = '${O}'`), 5);
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 5);
  assert.equal(await count(db, 'psi_tender_dossier_item_actions'), 5);

  const items = (await db.query(
    `select item_key, origin, item_type, required from public.psi_tender_dossier_items where opportunity_id = $1 order by item_key`, [O],
  )).rows;
  assert.deepEqual(items.map(row => row.item_key), REQUIREMENTS.map(id => `agt002_post_go:${id}`).sort());
  for (const row of items) {
    assert.equal(row.origin, 'seed_agt002_post_go');
    assert.equal(row.item_type, 'pendiente_humano');
    assert.equal(row.required, true);
  }

  // La proveniencia ancla decisión + corrida, aunque la decisión no tenga anclaje propio.
  const sources = (await db.query(`select decision_id, analysis_run_id from public.psi_tender_dossier_agt002_sources`)).rows;
  assert.equal(sources.length, 5);
  for (const source of sources) {
    assert.equal(source.decision_id, DECISION_UNANCHORED);
    assert.equal(source.analysis_run_id, RUN_1);
  }

  // La decisión NO se toca: sigue sin anclaje (083 no la actualiza ni la reinserta).
  const decisions = (await db.query(`select id, analysis_run_id from public.psi_tender_go_no_go_decisions`)).rows;
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].analysis_run_id, null, 'el traspaso nunca escribe el run en la decisión');

  await db.close();
})();

// --- segundo sync idempotente + campos humanos preservados ---------------------------------------
await (async function secondSyncIsIdempotentAndPreservesHumanFields() {
  const db = await baseDb();
  await seedUnanchoredGo(db);
  const first = await sync(db);
  const itemId = first.items[0].item_id;

  // Trabajo humano sobre el ítem sembrado, entre los dos syncs.
  await callRpc(db, 'psi_append_tender_dossier_item_action', [O, itemId, ACTOR, 'status_changed', 'en_progreso']);
  await callRpc(db, 'psi_append_tender_dossier_item_action', [O, itemId, ACTOR, 'assigned', null, ACTOR]);

  const again = await sync(db);
  assert.equal(again.items.length, 5);
  for (const entry of again.items) {
    assert.equal(entry.item_created, false, 'la repetición exacta no vuelve a crear el ítem');
    assert.equal(entry.source_recorded, false, 'la repetición exacta no duplica proveniencia');
    assert.equal(entry.requirement_changed, false, 'la unidad V3 no cambió: no hay evento de cambio');
  }
  assert.equal(await count(db, 'psi_tender_dossier_items'), 5);
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 5);

  const projected = await callRpc(db, 'psi_project_tender_dossier_item', [itemId]);
  assert.equal(projected.status, 'en_progreso', 'el estado humano no se revierte al repetir el sync');
  assert.equal(projected.assignee_id, ACTOR, 'la asignación humana se conserva');
  assert.equal(projected.assignee_name, 'Ana Autorizada');
  assert.equal(projected.analysis_source.analysis_run_id, RUN_1);
  assert.equal(projected.analysis_source.decision_id, DECISION_UNANCHORED);

  await db.close();
})();

// --- rechazo: la corrida indicada no es la vigente ------------------------------------------------
await (async function unanchoredGoStillRequiresACurrentCanonicalRun() {
  // Corrida de otro id (no vigente por snapshot ajeno) enviada como p_analysis_run_id.
  const otherRunDb = await baseDb();
  await seedUnanchoredGo(otherRunDb);
  await otherRunDb.query(
    `insert into public.psi_tender_analysis_runs (id, opportunity_id, tender_id, snapshot_id, producer, method, status, canonical, result)
     values ($1,$2,$3,$4,'AGT-002','agent_ai','completed',true,$5)`,
    [RUN_OTHER, O, T, SNAPSHOT_2, JSON.stringify(legacyRunResult(REQUIREMENTS.map(id => unit(id))))],
  );
  await assert.rejects(
    () => sync(otherRunDb, { runId: RUN_OTHER }),
    /ya no es el análisis vigente/i,
    'sin anclaje, el servidor sigue exigiendo que la corrida sea la vigente del conjunto documental',
  );
  assert.equal(await count(otherRunDb, 'psi_tender_dossier_items'), 0);
  await otherRunDb.close();

  const staleDb = await baseDb();
  await seedUnanchoredGo(staleDb);
  await staleDb.query(`update public.psi_tender_document_state set current_snapshot_id = $1 where opportunity_id = $2`, [SNAPSHOT_2, O]);
  await assert.rejects(() => sync(staleDb), /ya no es el análisis vigente/i);
  await staleDb.close();

  const refreshDb = await baseDb();
  await seedUnanchoredGo(refreshDb);
  await refreshDb.query(`update public.psi_tender_document_state set refresh_in_progress = true where opportunity_id = $1`, [O]);
  await assert.rejects(() => sync(refreshDb), /ya no es el análisis vigente/i);
  await refreshDb.close();

  const nonCanonicalDb = await baseDb();
  await seedUnanchoredGo(nonCanonicalDb, { canonical: false });
  await assert.rejects(() => sync(nonCanonicalDb), /corrida canónica AGT-002 completada/i);
  await nonCanonicalDb.close();

  const notCompletedDb = await baseDb();
  await seedUnanchoredGo(notCompletedDb, { status: 'failed' });
  await assert.rejects(() => sync(notCompletedDb), /corrida canónica AGT-002 completada/i);
  await notCompletedDb.close();
})();

// --- rechazo: la corrida no es AGT-002/agent_ai ---------------------------------------------------
await (async function unanchoredGoRequiresTheAgt002Producer() {
  const db = await baseDb();
  await seedUnanchoredGo(db, { producer: 'siio_rules_v1', method: 'rules' });
  await assert.rejects(() => sync(db), /corrida AGT-002 \(agent_ai\)/i);
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 0);
  await db.close();
})();

// --- rechazo: `result` tiene la propiedad evidence_coverage (aunque sea JSON null) ---------------
await (async function unanchoredGoRejectsAnyPresentEvidenceCoverage() {
  for (const coverage of [
    { tender_requirement_inventory: { decision_ready: true } },
    null,
    {},
    false,
  ]) {
    const db = await baseDb();
    await seedUnanchoredGo(db, {
      result: { ...legacyRunResult(REQUIREMENTS.map(id => unit(id))), evidence_coverage: coverage },
    });
    await assert.rejects(
      () => sync(db),
      /declara evidence_coverage/i,
      'la mera presencia de la propiedad saca a la corrida del caso legado del issue #187',
    );
    assert.equal(await count(db, 'psi_tender_dossier_items'), 0);
    assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 0);
    await db.close();
  }
})();

// --- rechazo: sin sobre V3 estructurado no hay traspaso, con o sin anclaje -----------------------
await (async function unanchoredGoStillRequiresTheV3Envelope() {
  const db = await baseDb();
  await seedUnanchoredGo(db, { result: { recommendation: 'GO' } });
  await assert.rejects(() => sync(db), /análisis integral V3 estructurado/i);
  await db.close();
})();

// --- regresión: con anclaje presente, la igualdad exacta de 082 sigue siendo obligatoria ---------
await (async function anchoredDecisionStillDemandsExactEquality() {
  const db = await baseDb();
  await seedUnanchoredGo(db, { analysisRunId: RUN_1 });
  await db.query(
    `insert into public.psi_tender_analysis_runs (id, opportunity_id, tender_id, snapshot_id, producer, method, status, canonical, result)
     values ($1,$2,$3,$4,'AGT-002','agent_ai','completed',true,$5)`,
    [RUN_OTHER, O, T, SNAPSHOT_1, JSON.stringify(legacyRunResult(REQUIREMENTS.map(id => unit(id))))],
  );
  await assert.rejects(
    () => sync(db, { runId: RUN_OTHER }),
    /no es el análisis anclado/i,
    'una decisión CON anclaje nunca puede sembrarse desde otra corrida',
  );
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);

  // Y la corrida anclada sigue sembrando exactamente igual que con 082.
  const ok = await sync(db, { runId: RUN_1 });
  assert.equal(ok.items.length, 5);
  assert.equal(await count(db, 'psi_tender_dossier_agt002_sources'), 5);
  await db.close();
})();

// --- regresión: sin decisión GO vigente no hay traspaso, tampoco sin anclaje ---------------------
await (async function supersededOrNoGoDecisionNeverSyncs() {
  const db = await baseDb();
  await seedUnanchoredGo(db);
  await db.query(
    `insert into public.psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision, supersedes_decision_id) values ($1,$2,'no_go',$3)`,
    [O, T, DECISION_UNANCHORED],
  );
  await assert.rejects(() => sync(db), /decisión GO vigente/i);
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);
  await db.close();
})();

// --- regresión: el actor no autorizado nunca llega a mutar nada ---------------------------------
await (async function unauthorizedActorIsStillRejected() {
  const db = await baseDb();
  await db.query(`insert into public.psi_sales_profiles(id, active, role, full_name) values ($1, false, 'director', 'Beto Inactivo')`,
    ['11111111-1111-4111-8111-111111111112']);
  await seedUnanchoredGo(db);
  await assert.rejects(() => sync(db, { actorId: '11111111-1111-4111-8111-111111111112' }), /permisos|activo/i);
  assert.equal(await count(db, 'psi_tender_dossier_items'), 0);
  await db.close();
})();

console.log('PGlite tender dossier AGT-002 unanchored GO (083) passed');
