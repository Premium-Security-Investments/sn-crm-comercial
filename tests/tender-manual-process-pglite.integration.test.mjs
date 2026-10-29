// AGT-002 — migración 165 contra Postgres de verdad (pglite): crear a mano un proceso que no está en SECOP.
//
// Fija lo que sólo la base puede responder: que la función cree la MISMA pareja licitación + oportunidad que produce
// la conversión del Radar (prospecto / licitacion_publica / Licitación Pública / convertida_oportunidad, que es lo que
// exigen los guardias de 022/025/027 y lo que lista la bandeja de 023); que el segundo registro del mismo proceso
// choque sin dejar una oportunidad huérfana; que un actor sin el permiso de Licitaciones, una identidad que no es
// humana y un responsable inactivo no pasen; y que el rollback deje la base como estaba.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { normalizeManualTenderProcessInput } from '../verticales/licitaciones/tender-manual-process.js';

const migration = readFileSync(new URL('../supabase/migrations/165_licitaciones_proceso_a_mano.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/165_licitaciones_proceso_a_mano_rollback.sql', import.meta.url), 'utf8');

const KATHERINE = '11111111-1111-4111-8111-111111111111';
const AGENTE = '22222222-2222-4222-8222-222222222222';
const SIN_PERMISO = '33333333-3333-4333-8333-333333333333';
const INACTIVO = '44444444-4444-4444-8444-444444444444';

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  alter role service_role bypassrls; grant service_role to current_user;

  create table public.psi_sales_profiles (
    id uuid primary key, microsoft_email text, full_name text, role text,
    active boolean not null default true, identity_type text
  );
  create table public.psi_profile_permissions (
    profile_id uuid not null references public.psi_sales_profiles(id), permission_code text not null
  );
  create table public.psi_sales_opportunities (
    id uuid primary key default gen_random_uuid(),
    company_name text not null, owner_id uuid references public.psi_sales_profiles(id),
    stage_code text not null default 'prospecto', service_type_code text,
    offer_value numeric not null default 0 check (offer_value >= 0), expected_close_date date,
    quote_city text, regional_nombre text, sede text, economic_sector text,
    tipo_producto_original text, observaciones text, external_source text, archived_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table public.psi_public_tenders (
    id uuid primary key default gen_random_uuid(),
    stable_key text not null unique, source text not null,
    section text not null check (section in ('hacer','revisar','prioridad_baja')),
    entity text not null, dept text, city text, ref text, process_id text,
    title text not null, description text, value numeric default 0, status text, category text,
    published_at timestamptz, deadline_at timestamptz, score numeric default 0,
    reasons text[] default '{}', risks text[] default '{}', url text, raw jsonb,
    internal_status text not null default 'nueva'
      check (internal_status in ('nueva','en_revision','descartada','convertida_oportunidad')),
    converted_opportunity_id uuid references public.psi_sales_opportunities(id) on delete set null,
    reviewed_by uuid references public.psi_sales_profiles(id) on delete set null, reviewed_at timestamptz,
    detected_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    tracking_owner_id uuid, tracking_status text, tracking_next_action text, tracking_due_at timestamptz,
    tracking_blocker text, tracking_last_note text, tracking_started_at timestamptz, tracking_updated_at timestamptz
  );
  create table public.psi_tender_tracking_events (
    id uuid primary key default gen_random_uuid(),
    tender_id uuid not null references public.psi_public_tenders(id) on delete cascade,
    event_type text not null, note text, from_status text, to_status text,
    created_by uuid references public.psi_sales_profiles(id) on delete set null,
    created_at timestamptz not null default now(), actor_kind text not null default 'human',
    metadata jsonb, visibility text not null default 'internal' check (visibility = 'internal')
  );

  insert into public.psi_sales_profiles (id, microsoft_email, full_name, role, active, identity_type) values
    ('${KATHERINE}', 'directora.licitaciones@seguridadnacional.co', 'Katherine', 'comercial', true, 'human'),
    ('${AGENTE}', 'vigia@premiumsecurity.ai', 'Vig-IA', 'comercial', true, 'agent'),
    ('${SIN_PERMISO}', 'comercial@seguridadnacional.co', 'Comercial', 'comercial', true, null),
    ('${INACTIVO}', 'retirado@seguridadnacional.co', 'Retirado', 'comercial', false, 'human');
  insert into public.psi_profile_permissions (profile_id, permission_code) values
    ('${KATHERINE}', 'licitaciones'), ('${KATHERINE}', 'licitaciones_custodia'), ('${AGENTE}', 'licitaciones'),
    ('${INACTIVO}', 'licitaciones');
`);

await db.exec(migration);

const PROCESS = normalizeManualTenderProcessInput({
  source: 'Portal de la entidad',
  entity: 'Terminal de Transporte de Pereira',
  title: 'Servicio de vigilancia y seguridad privada',
  ref: 'TT-004-2026',
  city: 'Pereira',
  dept: 'Risaralda',
  value: '1.200.000.000',
  close_date: '2026-11-20',
  url: 'https://portal.terminalpereira.gov.co/proceso/4',
  description: 'Lo encontró Katherine en el portal de la entidad.',
});

async function create({ actor = KATHERINE, owner = KATHERINE, process = PROCESS } = {}) {
  const { rows } = await db.query(
    `select public.psi_create_manual_tender_opportunity(
       $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,
       $11::text,$12::text,$13::numeric,$14::timestamptz,$15::date,$16::text,$17::text,$18::jsonb
     ) result`,
    [
      actor, owner, process.stableKey, process.source, process.section, process.entity, process.title,
      process.description, process.ref, process.url, process.city, process.dept, process.value,
      process.deadlineAt, process.closeDate, process.externalSource, process.observaciones,
      JSON.stringify(process.raw),
    ],
  );
  return rows[0].result;
}

async function rejects(call, pattern) {
  try {
    await call();
  } catch (error) {
    assert.match(String(error?.message || error), pattern);
    return;
  }
  assert.fail(`se esperaba un error que coincidiera con ${pattern}`);
}

// 1. El proceso creado a mano llega al mismo sitio que una conversión del Radar.
const created = await create();
assert.ok(created.opportunity_id && created.tender_id);
assert.equal(created.stable_key, PROCESS.stableKey);

const tender = (await db.query('select * from public.psi_public_tenders where id = $1', [created.tender_id])).rows[0];
assert.equal(tender.internal_status, 'convertida_oportunidad');
assert.equal(tender.converted_opportunity_id, created.opportunity_id);
assert.equal(tender.section, 'hacer');
assert.equal(tender.source, 'Portal de la entidad');
assert.equal(tender.entity, 'Terminal de Transporte de Pereira');
assert.equal(tender.ref, 'TT-004-2026');
assert.equal(Number(tender.value), 1200000000);
assert.equal(new Date(tender.deadline_at).toISOString(), '2026-11-20T00:00:00.000Z');
assert.equal(tender.raw.deadline, '2026-11-20');
assert.equal(tender.raw.manual_entry, true);
assert.equal(tender.manual_entry_by, KATHERINE);
assert.ok(tender.manual_entry_at);
assert.equal(tender.reviewed_by, KATHERINE);
assert.ok(tender.tracking_updated_at, 'el seguimiento necesita su marca de versión para el control optimista');

const opportunity = (await db.query('select * from public.psi_sales_opportunities where id = $1', [created.opportunity_id])).rows[0];
assert.equal(opportunity.stage_code, 'prospecto');
assert.equal(opportunity.service_type_code, 'licitacion_publica');
// Los guardias de 022/025/027 aceptan la oportunidad por `tipo_producto_original` o por `secop_radar:%`: lo manual
// pasa por el primero, así que esta línea es la que mantiene vivos el GO/NO GO y el análisis.
assert.equal(opportunity.tipo_producto_original, 'Licitación Pública');
assert.equal(opportunity.external_source, PROCESS.externalSource);
assert.equal(opportunity.owner_id, KATHERINE);
assert.equal(opportunity.company_name, 'Terminal de Transporte de Pereira');
assert.equal(opportunity.expected_close_date.toISOString().slice(0, 10), '2026-11-20');
assert.equal(Number(opportunity.offer_value), 1200000000);
assert.match(opportunity.observaciones, /creado a mano en el CRM/);

const events = (await db.query('select * from public.psi_tender_tracking_events where tender_id = $1', [created.tender_id])).rows;
assert.equal(events.length, 1);
assert.equal(events[0].event_type, 'converted');
assert.equal(events[0].to_status, 'convertida_oportunidad');
assert.equal(events[0].created_by, KATHERINE);
assert.deepEqual(events[0].metadata, { origen: 'manual', plataforma: 'Portal de la entidad' });

// 2. El mismo proceso otra vez: choca y no deja una oportunidad huérfana.
await rejects(() => create(), /ya está registrado en el CRM/);
assert.equal((await db.query('select count(*)::int count from public.psi_sales_opportunities')).rows[0].count, 1);
assert.equal((await db.query('select count(*)::int count from public.psi_public_tenders')).rows[0].count, 1);

// 3. Quién puede: el permiso de Licitaciones, humano y activo.
const OTRO = normalizeManualTenderProcessInput({ source: 'TVEC', entity: 'Supersalud', title: 'Vigilancia' });
await rejects(() => create({ actor: SIN_PERMISO, owner: SIN_PERMISO, process: OTRO }), /No tiene permisos/);
await rejects(() => create({ actor: AGENTE, owner: KATHERINE, process: OTRO }), /No tiene permisos/);
await rejects(() => create({ actor: INACTIVO, owner: KATHERINE, process: OTRO }), /No tiene permisos/);
await rejects(() => create({ actor: KATHERINE, owner: INACTIVO, process: OTRO }), /responsable del proceso no existe/);
assert.equal((await db.query('select count(*)::int count from public.psi_sales_opportunities')).rows[0].count, 1);

// 4. Los dos espacios de nombres propios son obligatorios: nadie cuela una llave del Radar por esta puerta.
await rejects(() => create({ process: { ...OTRO, stableKey: 'abc123' } }), /llave del proceso manual/);
await rejects(() => create({ process: { ...OTRO, externalSource: 'secop_radar:TVEC:abc' } }), /origen externo del proceso manual/);
await rejects(() => create({ process: { ...OTRO, section: 'inventada' } }), /sección del proceso/);
await rejects(() => create({ process: { ...OTRO, entity: '   ' } }), /obligatorios/);

// 5. Un segundo proceso distinto sí entra.
const segundo = await create({ process: OTRO });
assert.ok(segundo.tender_id);
assert.equal((await db.query('select count(*)::int count from public.psi_public_tenders')).rows[0].count, 2);

// 6. El rollback retira la capacidad y deja en pie lo ya creado.
await db.exec(rollback);
await rejects(() => create({ process: normalizeManualTenderProcessInput({ source: 'TVEC', entity: 'Otra', title: 'Otro' }) }), /psi_create_manual_tender_opportunity/);
assert.equal((await db.query('select count(*)::int count from public.psi_public_tenders')).rows[0].count, 2);
assert.equal((await db.query('select count(*)::int count from public.psi_sales_opportunities')).rows[0].count, 2);

await db.close();
console.log('migración 165: proceso creado a mano, choque sin huérfanos, permisos, espacios de nombres y rollback OK');
