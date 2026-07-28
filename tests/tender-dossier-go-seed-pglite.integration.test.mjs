import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const m040 = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const m041 = readFileSync(new URL('../supabase/migrations/041_tender_dossier_go_seed.sql', import.meta.url), 'utf8');

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
};
const preparation = {
  kind: 'tender_offer_preparation',
  human_required_items: [
    { key: 'validar_experiencia', title: 'Validar experiencia', priority: 'alta' },
    { key: 'camara_comercio', title: 'Cámara de Comercio', priority: 'media' },
  ],
  planned_documents: [
    { key: 'carta_presentacion', name: 'Carta de presentación' },
    { key: 'indice_expediente', name: 'Índice del expediente' },
  ],
};

async function seededDb() {
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
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, interaction_type text, created_by uuid, occurred_at timestamptz default now(), notes text);
    create or replace function public.psi_safe_jsonb(p text) returns jsonb language plpgsql immutable as $$
      begin return p::jsonb; exception when others then return null; end; $$;
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
    insert into public.psi_sales_interactions(opportunity_id, interaction_type, created_by, notes)
      values ('${ids.opportunity}','documento','${ids.actor}', $prep$${JSON.stringify(preparation)}$prep$);
  `);
  await db.exec(m040);
  await db.exec(m041);
  return db;
}

await (async function migrationIsReexecutable() {
  const db = await seededDb();
  await db.exec(m041);
  await db.close();
})();

await (async function seedFromPreparationIsIdempotent() {
  const db = await seededDb();
  const first = (await db.query(`select public.psi_seed_tender_dossier($1,$2) as r`, [ids.opportunity, ids.actor])).rows[0].r;
  assert.equal(first.seeded, true);
  const second = (await db.query(`select public.psi_seed_tender_dossier($1,$2) as r`, [ids.opportunity, ids.actor])).rows[0].r;
  assert.equal(second.seeded, false);
  // Re-ejecutar no crea duplicados.
  const items = Number((await db.query(`select count(*)::int c from public.psi_tender_dossier_items where opportunity_id=$1`, [ids.opportunity])).rows[0].c);
  const artifacts = Number((await db.query(`select count(*)::int c from public.psi_tender_dossier_artifacts where opportunity_id=$1`, [ids.opportunity])).rows[0].c);
  assert.equal(items, 4); // 2 pendientes humanos + 2 documentos como ítems
  assert.equal(artifacts, 2);
  // required correcto: todo pendiente humano sembrado, sea prioridad alta o media, queda requerido.
  const reqItem = (await db.query(`select required from public.psi_tender_dossier_items where opportunity_id=$1 and item_key='validar_experiencia'`, [ids.opportunity])).rows[0];
  assert.equal(reqItem.required, true);
  const reqMedium = (await db.query(`select required from public.psi_tender_dossier_items where opportunity_id=$1 and item_key='camara_comercio'`, [ids.opportunity])).rows[0];
  assert.equal(reqMedium.required, true);
  const reqArt = (await db.query(`select required from public.psi_tender_dossier_artifacts where opportunity_id=$1 and artifact_key='carta_presentacion'`, [ids.opportunity])).rows[0];
  assert.equal(reqArt.required, true);
  const optArt = (await db.query(`select required from public.psi_tender_dossier_artifacts where opportunity_id=$1 and artifact_key='indice_expediente'`, [ids.opportunity])).rows[0];
  assert.equal(optArt.required, false);
  await db.close();
})();

await (async function seedWithoutPreparationReturnsFalse() {
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
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, interaction_type text, created_by uuid, occurred_at timestamptz default now(), notes text);
    create or replace function public.psi_safe_jsonb(p text) returns jsonb language plpgsql immutable as $$
      begin return p::jsonb; exception when others then return null; end; $$;
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
  await db.exec(m040);
  await db.exec(m041);
  const r = (await db.query(`select public.psi_seed_tender_dossier($1,$2) as r`, [ids.opportunity, ids.actor])).rows[0].r;
  assert.equal(r.seeded, false);
  assert.equal(r.reason, 'sin_preparacion');
  await db.close();
})();

// Wrapper de GO: el rename-to-core deja psi_record_tender_go_no_go_core_041 disponible
// y el público nuevo siembra el expediente automáticamente al decidir 'go'.
await (async function goWrapperSeedsDossier() {
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
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, interaction_type text, created_by uuid, occurred_at timestamptz default now(), notes text);
    create or replace function public.psi_safe_jsonb(p text) returns jsonb language plpgsql immutable as $$
      begin return p::jsonb; exception when others then return null; end; $$;
    insert into public.psi_access_permissions(code) values ('licitaciones');
    insert into public.psi_sales_profiles(id, role, full_name) values ('${ids.actor}','director','Dir');
    insert into public.psi_profile_permissions values ('${ids.actor}','licitaciones');
    insert into public.psi_sales_opportunities values ('${ids.opportunity}','pendiente_decision');
    insert into public.psi_public_tenders values ('${ids.tender}','${ids.opportunity}');
    -- Stub mínimo del core auditado de 8 argumentos que 041 renombrará (patrón 039).
    create or replace function public.psi_record_tender_go_no_go(
      p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text,
      p_analysis_run_id uuid, p_justification text, p_preparation jsonb, p_document_hash text
    ) returns jsonb language plpgsql as $$
    declare v_decision_id uuid;
    begin
      insert into public.psi_tender_go_no_go_decisions(opportunity_id, tender_id, decision) values (p_opportunity_id, p_tender_id, p_decision)
        returning id into v_decision_id;
      update public.psi_sales_opportunities set tender_offer_status = 'en_preparacion' where id = p_opportunity_id;
      insert into public.psi_sales_interactions(opportunity_id, interaction_type, created_by, notes)
        values (p_opportunity_id, 'documento', p_actor_id, p_preparation::text);
      return jsonb_build_object('decision_id', v_decision_id, 'tender_offer_status', 'en_preparacion');
    end; $$;
  `);
  await db.exec(m040);
  await db.exec(m041);
  assert.notEqual(
    (await db.query(`select to_regprocedure('public.psi_record_tender_go_no_go_core_041(uuid,uuid,uuid,text,uuid,text,jsonb,text)') as r`)).rows[0].r,
    null,
  );
  const prep = { ...preparation };
  await db.query(
    `select public.psi_record_tender_go_no_go($1,$2,$3,'go',null,'justificación',$4,null)`,
    [ids.opportunity, ids.tender, ids.actor, JSON.stringify(prep)],
  );
  const items = Number((await db.query(`select count(*)::int c from public.psi_tender_dossier_items where opportunity_id=$1`, [ids.opportunity])).rows[0].c);
  assert.equal(items, 4);
  await db.close();
})();

console.log('PGlite tender dossier GO seed passed');
