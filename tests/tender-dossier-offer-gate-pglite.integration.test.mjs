import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const files = ['040_tender_dossier_workspace','041_tender_dossier_go_seed','042_tender_dossier_offer_gate']
  .map(n => readFileSync(new URL(`../supabase/migrations/${n}.sql`, import.meta.url), 'utf8'));

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
};

async function gateDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean default true, identity_type text default 'human', role text, full_name text);
    create table public.psi_access_permissions (code text primary key, active boolean default true);
    create table public.psi_profile_permissions (profile_id uuid, permission_code text);
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_go_no_go_decisions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, tender_id uuid, decision text, decided_at timestamptz default now(), supersedes_decision_id uuid);
    -- tabla de transiciones append-only y función core mínima que 042 renombrará.
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
    -- Stub mínimo del core auditado de 8 argumentos que 041 renombra (patrón 039); el gate
    -- de 042 no ejercita la siembra de GO, pero 041 exige que exista para aplicarse.
    create or replace function public.psi_record_tender_go_no_go(
      p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text,
      p_analysis_run_id uuid, p_justification text, p_preparation jsonb, p_document_hash text
    ) returns jsonb language plpgsql as $$
    begin
      return jsonb_build_object('tender_offer_status', 'en_preparacion');
    end; $$;
    insert into public.psi_access_permissions(code) values ('licitaciones');
    insert into public.psi_sales_profiles(id, role, full_name) values ('${ids.actor}','director','Dir');
    insert into public.psi_profile_permissions values ('${ids.actor}','licitaciones');
    insert into public.psi_sales_opportunities values ('${ids.opportunity}','en_preparacion');
    insert into public.psi_public_tenders values ('${ids.tender}','${ids.opportunity}');
    insert into public.psi_tender_go_no_go_decisions(opportunity_id, tender_id, decision) values ('${ids.opportunity}','${ids.tender}','go');
  `);
  for (const sql of files) await db.exec(sql);
  return db;
}

await (async function migrationIsReexecutable() {
  const db = await gateDb();
  await db.exec(files[2]);
  await db.close();
})();

await (async function gateBlocksUntilReady() {
  const db = await gateDb();
  const itemId = (await db.query(`select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'validar_experiencia', 'Exp', 'pendiente_humano', true])).rows[0].r.item.id;
  const artId = (await db.query(`select public.psi_create_tender_dossier_artifact($1,$2,$3,$4,$5) as r`,
    [ids.opportunity, ids.actor, 'carta_presentacion', 'Carta', true])).rows[0].r.artifact.id;

  // 1) Bloqueado: ítem pendiente y artefacto sin aprobar.
  await assert.rejects(
    () => db.query(`select public.psi_transition_tender_offer_status($1,$2,'lista_para_presentar','en_preparacion',null)`,
      [ids.opportunity, ids.actor]),
    /expediente no está listo|requerido|aprobad/i,
  );

  // 2) Resolver ítem y aprobar artefacto.
  await db.query(`select public.psi_append_tender_dossier_item_action($1,$2,$3,'status_changed','listo')`, [ids.opportunity, itemId, ids.actor]);
  const vId = (await db.query(`select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# c', null) as r`,
    [ids.opportunity, artId, ids.actor])).rows[0].r.version_id;
  await db.query(`select public.psi_record_tender_dossier_artifact_review($1,$2,'aprobado','ok')`, [vId, ids.actor]);

  const ready = (await db.query(`select public.psi_evaluate_tender_dossier_readiness($1) as r`, [ids.opportunity])).rows[0].r;
  assert.equal(ready.ready, true);

  // 3) Ahora la transición pasa.
  const t = (await db.query(`select public.psi_transition_tender_offer_status($1,$2,'lista_para_presentar','en_preparacion',null) as r`,
    [ids.opportunity, ids.actor])).rows[0].r;
  assert.equal(t.status, 'lista_para_presentar');

  await db.close();
})();

await (async function blockerBlocksReadiness() {
  const db = await gateDb();
  const itemId = (await db.query(`select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'k', 'K', 'general', false])).rows[0].r.item.id;
  await db.query(`select public.psi_append_tender_dossier_item_action($1,$2,$3,'status_changed','bloqueado')`, [ids.opportunity, itemId, ids.actor]);
  const ready = (await db.query(`select public.psi_evaluate_tender_dossier_readiness($1) as r`, [ids.opportunity])).rows[0].r;
  assert.equal(ready.ready, false);
  assert.ok(ready.active_blockers.length >= 1);
  await db.close();
})();

// Ítem requerido resuelto vía no_aplica (con justificación, actor manager) también habilita el gate.
await (async function notApplicableSatisfiesGate() {
  const db = await gateDb();
  const itemId = (await db.query(`select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'validar_experiencia', 'Exp', 'pendiente_humano', true])).rows[0].r.item.id;
  const artId = (await db.query(`select public.psi_create_tender_dossier_artifact($1,$2,$3,$4,$5) as r`,
    [ids.opportunity, ids.actor, 'carta_presentacion', 'Carta', true])).rows[0].r.artifact.id;
  await db.query(
    `select public.psi_append_tender_dossier_item_action($1,$2,$3,'marked_not_applicable',null,null,null,null,null,null,'no aplica por pliego')`,
    [ids.opportunity, itemId, ids.actor],
  );
  const vId = (await db.query(`select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# c', null) as r`,
    [ids.opportunity, artId, ids.actor])).rows[0].r.version_id;
  await db.query(`select public.psi_record_tender_dossier_artifact_review($1,$2,'aprobado','ok')`, [vId, ids.actor]);
  const ready = (await db.query(`select public.psi_evaluate_tender_dossier_readiness($1) as r`, [ids.opportunity])).rows[0].r;
  assert.equal(ready.ready, true);
  await db.close();
})();

// Una aprobación histórica de v1 no habilita v2 pendiente: el gate exige la vigente aprobada.
await (async function historicalApprovalDoesNotSatisfyNewVersion() {
  const db = await gateDb();
  const itemId = (await db.query(`select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'validar_experiencia', 'Exp', 'pendiente_humano', true])).rows[0].r.item.id;
  await db.query(`select public.psi_append_tender_dossier_item_action($1,$2,$3,'status_changed','listo')`, [ids.opportunity, itemId, ids.actor]);
  const artId = (await db.query(`select public.psi_create_tender_dossier_artifact($1,$2,$3,$4,$5) as r`,
    [ids.opportunity, ids.actor, 'carta_presentacion', 'Carta', true])).rows[0].r.artifact.id;
  const v1 = (await db.query(`select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# v1', null) as r`,
    [ids.opportunity, artId, ids.actor])).rows[0].r.version_id;
  await db.query(`select public.psi_record_tender_dossier_artifact_review($1,$2,'aprobado','ok')`, [v1, ids.actor]);
  let ready = (await db.query(`select public.psi_evaluate_tender_dossier_readiness($1) as r`, [ids.opportunity])).rows[0].r;
  assert.equal(ready.ready, true);

  // Nueva versión v2 sin revisar: el gate vuelve a false.
  await db.query(`select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# v2', null) as r`,
    [ids.opportunity, artId, ids.actor]);
  ready = (await db.query(`select public.psi_evaluate_tender_dossier_readiness($1) as r`, [ids.opportunity])).rows[0].r;
  assert.equal(ready.ready, false);
  assert.ok(ready.unapproved_artifacts.some(a => a.artifact_key === 'carta_presentacion'));

  await assert.rejects(
    () => db.query(`select public.psi_transition_tender_offer_status($1,$2,'lista_para_presentar','en_preparacion',null)`,
      [ids.opportunity, ids.actor]),
    /expediente no está listo|requerido|aprobad/i,
  );
  await db.close();
})();

// El gate solo aplica al destino lista_para_presentar; otros destinos delegan directo al core.
await (async function gateOnlyAppliesToListaParaPresentar() {
  const db = await gateDb();
  const t = (await db.query(`select public.psi_transition_tender_offer_status($1,$2,'presentada','en_preparacion',null) as r`,
    [ids.opportunity, ids.actor])).rows[0].r;
  assert.equal(t.status, 'presentada');
  await db.close();
})();

console.log('PGlite tender dossier offer gate passed');
