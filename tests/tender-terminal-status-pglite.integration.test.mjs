import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let trackingMigration = readFileSync(new URL('../supabase/migrations/018_tender_tracking_rpc.sql', import.meta.url), 'utf8');
const terminalMigration = readFileSync(new URL('../supabase/migrations/031_tender_terminal_status_guard.sql', import.meta.url), 'utf8');
trackingMigration = trackingMigration.replaceAll(
  "(p.role in ('admin', 'director', 'gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')",
  'public.psi_profile_has_tender_custody(p.id)',
);

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  owner: '22222222-2222-4222-8222-222222222222',
  cancelled: '33333333-3333-4333-8333-333333333333',
  active: '44444444-4444-4444-8444-444444444444',
  converted: '55555555-5555-4555-8555-555555555555',
  opportunity: '66666666-6666-4666-8666-666666666666',
};
const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create table public.psi_sales_profiles (
    id uuid primary key, active boolean not null default true, role text not null, microsoft_email text not null
  );
  create table public.psi_sales_opportunities (
    id uuid primary key default gen_random_uuid(), company_name text not null, owner_id uuid,
    stage_code text not null, service_type_code text not null, offer_value numeric,
    expected_close_date date, quote_city text, regional_nombre text, sede text,
    economic_sector text, tipo_producto_original text, observaciones text, external_source text,
    loss_notes text, next_action_at timestamptz
  );
  create table public.psi_public_tenders (
    id uuid primary key, stable_key text not null unique, source text, status text, raw jsonb,
    internal_status text, converted_opportunity_id uuid, tracking_owner_id uuid, tracking_status text,
    tracking_next_action text, tracking_due_at timestamptz, tracking_blocker text,
    tracking_last_note text, tracking_started_at timestamptz, tracking_updated_at timestamptz,
    reviewed_by uuid, reviewed_at timestamptz
  );
  create table public.psi_sales_interactions (
    id uuid primary key default gen_random_uuid(), opportunity_id uuid not null,
    interaction_type text not null, created_by uuid not null, occurred_at timestamptz not null, notes text not null
  );
  create table public.psi_tender_tracking_events (
    id uuid primary key default gen_random_uuid(), tender_id uuid not null, event_type text not null,
    note text, from_status text, to_status text, assigned_to uuid, next_action text,
    due_at timestamptz, blocker text, created_by uuid not null, created_at timestamptz not null default now()
  );
  create function public.psi_profile_has_tender_custody(p_profile_id uuid) returns boolean
    language sql stable as $$ select p_profile_id = '${ids.actor}'::uuid $$;
  insert into public.psi_sales_profiles (id, active, role, microsoft_email) values
    ('${ids.actor}', true, 'admin', 'admin@example.com'),
    ('${ids.owner}', true, 'comercial', 'owner@example.com');
`);
await db.exec(trackingMigration);
await db.exec(terminalMigration);

async function convert(tenderId, source) {
  return db.query(`select public.psi_convert_tender_to_opportunity(
    '${tenderId}'::uuid, '${ids.actor}'::uuid, 'secop_radar:SECOP II:${source}', 'Entidad pública', '${ids.owner}'::uuid,
    'prospecto', 'licitacion_publica', 500000, '2026-08-01'::date, 'Bogotá', 'Cundinamarca', 'SECOP-1',
    'Sector público', 'Licitación Pública', 'Origen Radar', null
  ) as result`);
}

await db.exec(`
  insert into public.psi_public_tenders (id, stable_key, source, status, raw, internal_status) values
    ('${ids.cancelled}', 'cancelled', 'SECOP II', 'Presentación de observaciones', '{"estado_del_procedimiento":"Cancelado"}', 'nueva'),
    ('${ids.active}', 'active', 'SECOP II', 'Publicado', '{"estado_del_procedimiento":"Publicado"}', 'nueva');
  insert into public.psi_sales_opportunities (id, company_name, owner_id, stage_code, service_type_code, external_source)
    values ('${ids.opportunity}', 'Entidad histórica', '${ids.owner}', 'prospecto', 'licitacion_publica', 'secop_radar:SECOP II:converted');
  insert into public.psi_public_tenders (id, stable_key, source, status, raw, internal_status, converted_opportunity_id) values
    ('${ids.converted}', 'converted', 'SECOP II', 'Cancelado', '{"estado_del_procedimiento":"Cancelado"}', 'convertida_oportunidad', '${ids.opportunity}');
`);

await assert.rejects(() => convert(ids.cancelled, 'cancelled'), /cancelada, revocada o declarada desierta/i);
const activeResult = (await convert(ids.active, 'active')).rows[0].result;
assert.equal(activeResult.duplicate, false);
const historicalResult = (await convert(ids.converted, 'converted')).rows[0].result;
assert.equal(historicalResult.duplicate, true, 'Una conversión histórica ya vinculada conserva idempotencia aunque después sea cancelada.');

await db.close();
console.log('PGlite terminal tender conversion guard passed');
