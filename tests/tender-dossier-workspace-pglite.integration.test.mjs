import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  actorComercial: '1a1a1a1a-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
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
    insert into public.psi_access_permissions(code) values ('licitaciones');
    insert into public.psi_sales_profiles(id, role, full_name) values
      ('${ids.actor}', 'director', 'Directora Licitaciones'),
      ('${ids.actorComercial}', 'comercial', 'Comercial Uno');
    insert into public.psi_profile_permissions(profile_id, permission_code) values
      ('${ids.actor}', 'licitaciones'), ('${ids.actorComercial}', 'licitaciones');
    insert into public.psi_sales_opportunities(id, tender_offer_status) values ('${ids.opportunity}', 'en_preparacion');
    insert into public.psi_public_tenders(id, converted_opportunity_id) values ('${ids.tender}', '${ids.opportunity}');
    insert into public.psi_tender_go_no_go_decisions(opportunity_id, tender_id, decision)
      values ('${ids.opportunity}', '${ids.tender}', 'go');
  `);
  return db;
}

// 1) Idempotencia: aplicar dos veces no falla.
await (async function migrationIsReexecutable() {
  const db = await freshDb();
  await db.exec(migration);
  await db.exec(migration);
  const tables = (await db.query(`
    select table_name from information_schema.tables
    where table_schema='public' and table_name like 'psi_tender_dossier%' order by table_name
  `)).rows.map(r => r.table_name);
  assert.deepEqual(tables, [
    'psi_tender_dossier_artifact_reviews',
    'psi_tender_dossier_artifact_versions',
    'psi_tender_dossier_artifacts',
    'psi_tender_dossier_item_actions',
    'psi_tender_dossier_items',
  ]);
  await db.close();
})();

// 2) Grants: service_role puede ejecutar RPC; escritura directa denegada.
await (async function directDmlIsDenied() {
  const db = await freshDb();
  await db.exec(migration);
  await db.exec('set role service_role');
  await assert.rejects(
    () => db.query(`insert into public.psi_tender_dossier_items(opportunity_id, tender_id, item_key, title, item_type, required, created_by) values ('${ids.opportunity}','${ids.tender}','x','X','general',true,'${ids.actor}')`),
    /permission denied/i,
  );
  await db.exec('reset role');
  await db.close();
})();

// 3) Crear ítem por RPC y proyección inicial.
await (async function createItemProjectsPending() {
  const db = await freshDb();
  await db.exec(migration);
  const created = (await db.query(
    `select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'validar_experiencia', 'Validar experiencia', 'pendiente_humano', true],
  )).rows[0].r;
  assert.equal(created.item.status, 'pendiente');
  assert.equal(created.item.applicability, 'requerido');
  assert.equal(created.item.required, true);
  await db.close();
})();

// 4) Append-only: el trigger prohíbe UPDATE/DELETE del stream de acciones.
await (async function actionStreamIsAppendOnly() {
  const db = await freshDb();
  await db.exec(migration);
  // El trigger es FOR EACH ROW: necesita al menos una fila existente para poder dispararse.
  await db.query(
    `select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'append_only_probe', 'Append only probe', 'general', false],
  );
  await db.exec('set role service_role');
  await assert.rejects(() => db.query(`update public.psi_tender_dossier_item_actions set note='x'`), /append-only/i);
  await assert.rejects(() => db.query(`delete from public.psi_tender_dossier_item_actions`), /append-only/i);
  await db.exec('reset role');
  await db.close();
})();

// 5) Requiere una decisión GO vigente: máquina de estados y no_aplica manager-only.
await (async function statusAndNotApplicableProjection() {
  const db = await freshDb();
  await db.exec(migration);
  const created = (await db.query(
    `select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'validar_financiero', 'Validar financiero', 'pendiente_humano', true],
  )).rows[0].r;
  const itemId = created.item.id;

  const listo = (await db.query(
    `select public.psi_append_tender_dossier_item_action($1,$2,$3,'status_changed','listo') as r`,
    [ids.opportunity, itemId, ids.actor],
  )).rows[0].r;
  assert.equal(listo.item.status, 'listo');

  // Marcar no_aplica sin justificación falla.
  await assert.rejects(
    () => db.query(`select public.psi_append_tender_dossier_item_action($1,$2,$3,'marked_not_applicable',null,null,null,null,null,null,null) as r`,
      [ids.opportunity, itemId, ids.actor]),
    /justificaci/i,
  );

  // Comercial no puede marcar no_aplica (manager-only).
  await assert.rejects(
    () => db.query(`select public.psi_append_tender_dossier_item_action($1,$2,$3,'marked_not_applicable',null,null,null,null,null,null,'no aplica por pliego') as r`,
      [ids.opportunity, itemId, ids.actorComercial]),
    /permisos/i,
  );

  const naParams = [ids.opportunity, itemId, ids.actor];
  const na = (await db.query(
    `select public.psi_append_tender_dossier_item_action($1,$2,$3,'marked_not_applicable',null,null,null,null,null,null,'no aplica por pliego') as r`,
    naParams,
  )).rows[0].r;
  assert.equal(na.item.applicability, 'no_aplica');
  await db.close();
})();

// 6) Artefactos: versión → revisión → proyección. Nueva versión no hereda la aprobación previa.
await (async function artifactVersionAndReview() {
  const db = await freshDb();
  await db.exec(migration);
  const art = (await db.query(
    `select public.psi_create_tender_dossier_artifact($1,$2,$3,$4,$5) as r`,
    [ids.opportunity, ids.actor, 'carta_presentacion', 'Carta de presentación', true],
  )).rows[0].r;
  const artifactId = art.artifact.id;
  assert.equal(art.artifact.review_status, 'pendiente');

  const v1 = (await db.query(
    `select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# Carta v1', null) as r`,
    [ids.opportunity, artifactId, ids.actor],
  )).rows[0].r;
  assert.equal(v1.artifact.current_version.version, 1);

  // Rechazar sin comentario falla.
  await assert.rejects(
    () => db.query(`select public.psi_record_tender_dossier_artifact_review($1,$2,'rechazado',null) as r`, [v1.version_id, ids.actor]),
    /comentario/i,
  );

  const approved = (await db.query(
    `select public.psi_record_tender_dossier_artifact_review($1,$2,'aprobado','ok') as r`,
    [v1.version_id, ids.actor],
  )).rows[0].r;
  assert.equal(approved.artifact.review_status, 'aprobado');
  assert.equal(approved.artifact.has_approved_version, true);

  // Nueva versión: la proyección vigente avanza a v2 sin mutar v1; review_status vuelve a pendiente y la aprobación histórica no habilita v2.
  const v2 = (await db.query(
    `select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# Carta v2', null) as r`,
    [ids.opportunity, artifactId, ids.actor],
  )).rows[0].r;
  assert.equal(v2.artifact.current_version.version, 2);
  assert.equal(v2.artifact.review_status, 'pendiente');
  assert.equal(v2.artifact.has_approved_version, false);
  await db.close();
})();

// 7) Lectura del workspace: compone checklist + artefactos + readiness (stub en 040).
await (async function workspaceReadComposes() {
  const db = await freshDb();
  await db.exec(migration);
  await db.query(`select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6)`,
    [ids.opportunity, ids.actor, 'k1', 'Item 1', 'pendiente_humano', true]);
  await db.query(`select public.psi_create_tender_dossier_artifact($1,$2,$3,$4,$5)`,
    [ids.opportunity, ids.actor, 'carta_presentacion', 'Carta', true]);
  const ws = (await db.query(`select public.psi_get_tender_dossier_workspace($1) as r`, [ids.opportunity])).rows[0].r;
  assert.equal(ws.checklist.length, 1);
  assert.equal(ws.artifacts.length, 1);
  assert.equal(ws.readiness.ready, false);
  await db.close();
})();

console.log('PGlite tender dossier workspace schema passed');
