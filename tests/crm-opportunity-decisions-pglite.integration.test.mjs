// CRM comercial — migración 110 (decisión obligatoria por oportunidad) sobre PostgreSQL aislado (PGlite).
// Cubre las seis decisiones, la regla de licitaciones, la solicitud y resolución de eliminación, el permiso exclusivo
// y el rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = sql => sql.replace(/^\s*begin;\s*$/gim, '').replace(/^\s*commit;\s*$/gim, '');
const migration = strip(readFileSync(new URL('../supabase/migrations/110_crm_opportunity_decisions.sql', import.meta.url), 'utf8'));
const rollback = strip(readFileSync(new URL('../supabase/rollbacks/110_crm_opportunity_decisions_rollback.sql', import.meta.url), 'utf8'));

const JHON = '11111111-1111-4111-8111-111111111111';
const LUIS = '22222222-2222-4222-8222-222222222222';

const VIEW_COLUMNS = `economic_sector text, decision_maker_name text, decision_maker_email text, decision_maker_phone text,
  quote_city text, quote_date date, loss_notes text, expected_close_date date, commission_rate numeric default 0,
  approved_at timestamptz, discarded_at timestamptz, lost_at timestamptz, created_at timestamptz default now(),
  updated_at timestamptz default now(), legacy_excel_id text, excel_hoja_origen text, tipo_oportunidad text,
  item_origen text, cliente_clave_normalizada text, sede text, mes_origen text, anio_origen text, regional_nombre text,
  estado_pipeline_original text, tipo_producto_original text, unidad text, valor_servicio numeric, valor_proyecto numeric,
  tipo_seguimiento_migrado text, fecha_cierre_estimada_original text, fecha_estimada_es_aproximada boolean,
  observaciones text, external_source text, requiere_revision boolean`;

async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, full_name text, microsoft_email text, active boolean, identity_type text);
    create table public.psi_sales_pipeline_stages (code text primary key, name text, stage_order int, close_probability numeric, is_terminal boolean, counts_as_sale boolean);
    create table public.psi_sales_service_types (code text primary key, name text);
    create table public.psi_sales_loss_reasons (code text primary key, name text, active boolean);
    create table public.psi_sales_opportunities (
      id uuid primary key, owner_id uuid references public.psi_sales_profiles(id), company_name text,
      offer_value numeric default 0, service_type_code text, stage_code text references public.psi_sales_pipeline_stages(code),
      loss_reason_code text references public.psi_sales_loss_reasons(code), last_interaction_at timestamptz, next_action_at timestamptz,
      ${VIEW_COLUMNS});
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(), opportunity_id uuid, created_by uuid, interaction_type text, notes text, occurred_at timestamptz, created_at timestamptz default now());
    create table public.psi_sales_opportunity_audit_logs (id bigserial primary key, opportunity_id uuid, changed_by uuid, field_name text, old_value text, new_value text, notes text);
    create table public.psi_access_permissions (code text primary key, name text, description text, active boolean);
    create table public.psi_profile_permissions (profile_id uuid, permission_code text, created_by uuid, primary key (profile_id, permission_code));
    insert into public.psi_sales_profiles values
      ('${JHON}', 'Jhon Bermudez', 'jhon@x.co', true, 'human'),
      ('${LUIS}', 'Luis Fernando Lopez', 'DirectorFisica@seguridadnacional.co ', true, 'human');
    insert into public.psi_sales_pipeline_stages values
      ('prospecto','Prospecto',1,0.1,false,false), ('envio_oferta','Envío de Oferta',2,0.25,false,false),
      ('sustentacion','Sustentación',3,0.5,false,false), ('negociacion','Negociación',4,0.7,false,false),
      ('aprobado','Aprobado',5,1,true,true), ('descartado','Descartado',6,0,true,false), ('perdido','Perdido',7,0,true,false);
    insert into public.psi_sales_service_types values ('seguridad_fisica','Seguridad Física'), ('licitacion_publica','Licitación Pública');
    insert into public.psi_sales_loss_reasons values ('precio','Precio',true), ('no_viable','No viable',true);
    create view public.v_psi_sales_opportunity_enriched as select o.id from public.psi_sales_opportunities o;
  `);
  await pg.exec(`drop view public.v_psi_sales_opportunity_enriched;`);
  await pg.exec(migration);
  return pg;
}

let seq = 0;
async function opportunity(pg, fields = {}) {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  await pg.query(`insert into public.psi_sales_opportunities (id, owner_id, company_name, service_type_code, stage_code, offer_value, next_action_at)
    values ($1, $2, $3, $4, $5, $6, $7)`, [id, JHON, fields.company || `Cliente ${seq}`, fields.service || 'seguridad_fisica', fields.stage || 'prospecto', fields.value ?? 0, fields.next ?? null]);
  return id;
}

const decide = (pg, id, decision, extra = {}) => pg.query(
  `select public.psi_record_opportunity_decision($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r`,
  [id, JHON, decision, extra.notes ?? 'Hablé con el cliente hoy', extra.type ?? null, extra.next ?? null, extra.stage ?? null, extra.value ?? null, extra.days ?? null, extra.reason ?? null],
);
const row = async (pg, id) => (await pg.query('select * from public.psi_sales_opportunities where id = $1', [id])).rows[0];
const inDays = days => new Date(Date.now() + days * 86_400_000).toISOString();

test('el permiso de eliminar queda sólo en Luis Fernando', async () => {
  const pg = await freshDb();
  const { rows } = await pg.query(`select profile_id from public.psi_profile_permissions where permission_code = 'crm_eliminar_oportunidades'`);
  assert.deepEqual(rows.map(r => r.profile_id), [LUIS]);
});

test('sigue viva: exige fecha entre hoy y 90 días y qué pasó; registra seguimiento y valor', async () => {
  const pg = await freshDb();
  const id = await opportunity(pg);
  await assert.rejects(decide(pg, id, 'continue', { next: inDays(120) }), /90 días/);
  await assert.rejects(decide(pg, id, 'continue', { next: inDays(-3) }), /90 días/);
  await assert.rejects(decide(pg, id, 'continue', { next: inDays(5), notes: 'ok' }), /qué pasó/);
  await decide(pg, id, 'continue', { next: inDays(5), type: 'llamada', value: 80_000_000 });
  const after = await row(pg, id);
  assert.equal(Number(after.offer_value), 80_000_000);
  assert.ok(after.next_action_at > new Date());
  const { rows } = await pg.query('select interaction_type from public.psi_sales_interactions where opportunity_id = $1', [id]);
  assert.deepEqual(rows.map(r => r.interaction_type), ['llamada']);
});

test('avanza sólo hacia adelante; ganar la cierra sin próxima gestión', async () => {
  const pg = await freshDb();
  const id = await opportunity(pg, { stage: 'envio_oferta' });
  await assert.rejects(decide(pg, id, 'advance', { stage: 'prospecto', next: inDays(3) }), /más avanzada/);
  await assert.rejects(decide(pg, id, 'advance', { stage: 'negociacion' }), /90 días/);
  await decide(pg, id, 'advance', { stage: 'aprobado' });
  const after = await row(pg, id);
  assert.equal(after.stage_code, 'aprobado');
  assert.equal(after.next_action_at, null);
  assert.ok(after.approved_at);
});

test('congelar: 30/60/90 días; la próxima gestión queda el día que vence', async () => {
  const pg = await freshDb();
  const id = await opportunity(pg);
  await assert.rejects(decide(pg, id, 'freeze', { days: 120 }), /30, 60 o 90/);
  await decide(pg, id, 'freeze', { days: 60, notes: 'Presupuesto hasta enero' });
  const after = await row(pg, id);
  assert.equal(after.frozen_reason, 'Presupuesto hasta enero');
  const expected = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 7);
  assert.equal(after.frozen_until.toISOString().slice(0, 7), expected);
  assert.ok(after.next_action_at);
});

test('descartar y perder exigen motivo; seguir decidiendo una cerrada falla', async () => {
  const pg = await freshDb();
  const a = await opportunity(pg);
  await assert.rejects(decide(pg, a, 'discard'), /motivo/);
  await decide(pg, a, 'discard', { reason: 'no_viable' });
  assert.equal((await row(pg, a)).stage_code, 'descartado');
  await assert.rejects(decide(pg, a, 'continue', { next: inDays(3) }), /cerrada/);
  const b = await opportunity(pg);
  await decide(pg, b, 'lose', { reason: 'precio', notes: 'Ganó la competencia por precio' });
  const lost = await row(pg, b);
  assert.equal(lost.stage_code, 'perdido');
  assert.ok(lost.lost_at);
});

test('las licitaciones públicas no se deciden aquí', async () => {
  const pg = await freshDb();
  const id = await opportunity(pg, { service: 'licitacion_publica' });
  await assert.rejects(decide(pg, id, 'continue', { next: inDays(3) }), /Licitaciones/);
});

test('pedir eliminar la deja marcada; confirmar la oculta de la vista y conserva la historia', async () => {
  const pg = await freshDb();
  const id = await opportunity(pg);
  await decide(pg, id, 'request_delete', { notes: 'Duplicada con la de Coats Cadena' });
  assert.ok((await row(pg, id)).delete_requested_at);
  await assert.rejects(decide(pg, id, 'continue', { next: inDays(3) }), /solicitud de eliminación/);
  const resolve = (approve, notes = null) => pg.query('select public.psi_resolve_opportunity_delete_request($1, $2, $3, $4)', [id, LUIS, approve, notes]);
  await assert.rejects(resolve(false), /por qué no se elimina/);
  await resolve(true);
  const view = await pg.query('select count(*)::int n from public.v_psi_sales_opportunity_enriched where id = $1', [id]);
  assert.equal(view.rows[0].n, 0);
  assert.ok((await row(pg, id)).deleted_at, 'la fila se conserva con deleted_at');
  const { rows } = await pg.query('select count(*)::int n from public.psi_sales_interactions where opportunity_id = $1', [id]);
  assert.equal(rows[0].n, 2);
});

test('rechazar la eliminación la devuelve al comercial', async () => {
  const pg = await freshDb();
  const id = await opportunity(pg);
  await decide(pg, id, 'request_delete', { notes: 'Creada por error' });
  await pg.query('select public.psi_resolve_opportunity_delete_request($1, $2, false, $3)', [id, LUIS, 'Es un cliente real, llámelo']);
  assert.equal((await row(pg, id)).delete_requested_at, null);
});

test('el rollback quita funciones y permiso y la vista vuelve a mostrar todo', async () => {
  const pg = await freshDb();
  const id = await opportunity(pg);
  await decide(pg, id, 'request_delete', { notes: 'Duplicada' });
  await pg.query('select public.psi_resolve_opportunity_delete_request($1, $2, true, null)', [id, LUIS]);
  await pg.exec(rollback);
  const view = await pg.query('select count(*)::int n from public.v_psi_sales_opportunity_enriched where id = $1', [id]);
  assert.equal(view.rows[0].n, 1);
  const fn = await pg.query(`select count(*)::int n from pg_proc where proname in ('psi_record_opportunity_decision','psi_resolve_opportunity_delete_request')`);
  assert.equal(fn.rows[0].n, 0);
  const perm = await pg.query(`select count(*)::int n from public.psi_access_permissions where code = 'crm_eliminar_oportunidades'`);
  assert.equal(perm.rows[0].n, 0);
});
