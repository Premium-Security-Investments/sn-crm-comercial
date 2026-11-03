// AGT-003 — congelar una oportunidad hasta una fecha, no sólo 30, 60 o 90 días (Juan, 2026-11-03).
// Cubre la validación del servidor, la pantalla y las migraciones 170/171 sobre PostgreSQL aislado (PGlite):
// que quede UNA sola firma de la función y que sólo `service_role` la pueda ejecutar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { addBogotaDays, FREEZE_MAX_DAYS, normalizeDecisionRequest } from '../src/vigia/opportunity-decision-rules.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = sql => sql.replace(/^\s*begin;\s*$/gim, '').replace(/^\s*commit;\s*$/gim, '');
const NOW = new Date('2026-11-03T15:00:00Z'); // 10:00 a. m. en Bogotá
const freeze = extra => normalizeDecisionRequest({ decision: 'freeze', notes: 'Contrato vigente hasta 2027', ...extra }, NOW);

test('congelar: días o fecha, exactamente una, por día de Bogotá y con tope de 2 años', () => {
  assert.equal(FREEZE_MAX_DAYS, 730);
  assert.equal(addBogotaDays('2026-11-03', 730), '2028-11-02');
  assert.equal(freeze({ freeze_days: 60 }).p_freeze_days, 60);
  assert.equal(freeze({ freeze_days: 60 }).p_frozen_until, null);
  const byDate = freeze({ frozen_until: '2027-06-30' });
  assert.equal(byDate.p_frozen_until, '2027-06-30');
  assert.equal(byDate.p_freeze_days, null);
  assert.equal(freeze({ frozen_until: '2027-06-30T00:00:00.000Z' }).p_frozen_until, '2027-06-30', 'basta el día');
  assert.equal(freeze({ frozen_until: '2028-11-02' }).p_frozen_until, '2028-11-02', 'el último día del tope entra');
  assert.throws(() => freeze({ frozen_until: '2028-11-03' }), /más de 2 años/);
  assert.throws(() => freeze({ frozen_until: '2026-11-03' }), /tiene que ser futura/, 'hoy no es futuro, igual que en la base');
  assert.throws(() => freeze({ frozen_until: '2026-10-01' }), /tiene que ser futura/);
  assert.throws(() => freeze({ frozen_until: '2027-02-30' }), /no es válida/);
  assert.throws(() => freeze({ frozen_until: 'pronto' }), /no es válida/);
  assert.throws(() => freeze({}), /Diga hasta cuándo/);
  assert.throws(() => freeze({ freeze_days: 30, frozen_until: '2027-01-15' }), /no las dos cosas/);
  assert.throws(() => freeze({ freeze_days: 45 }), /30, 60 o 90/);
});

test('la pantalla ofrece "hasta una fecha" en la decisión individual y en la masiva', () => {
  const src = read('../src/vigia/OpportunityDecision.tsx');
  assert.equal((src.match(/<option value="fecha">Hasta una fecha…<\/option>/g) || []).length, 2);
  assert.match(src, /body\.frozen_until = frozenUntil/);
  assert.match(src, /frozen_until: bulk\.until/);
  assert.equal((src.match(/max=\{addDays\([a-zA-Z]+, FREEZE_MAX_DAYS\)\}/g) || []).length, 2, 'el control de fecha lleva el tope');
  assert.match(src, /const parkedDay = /, 'si la próxima gestión ya está parqueada lejos, propone congelar hasta esa fecha');
});

test('la 170 borra la firma vieja antes de crear la nueva y deja los permisos de la 110', () => {
  const sql = read('../supabase/migrations/170_crm_congelar_hasta_una_fecha.sql');
  const drop = sql.indexOf('drop function if exists public.psi_record_opportunity_decision(uuid, uuid, text, text, text, timestamptz, text, numeric, integer, text);');
  const create = sql.indexOf('create or replace function public.psi_record_opportunity_decision(');
  assert.ok(drop > 0 && drop < create, 'el drop de 10 parámetros va antes del create');
  assert.match(sql, /revoke all on function public\.psi_record_opportunity_decision\([^)]*integer, text, date\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.psi_record_opportunity_decision\([^)]*integer, text, date\) to service_role;/);
  const fix = read('../supabase/migrations/171_crm_decision_permisos_firma_nueva.sql');
  assert.match(fix, /revoke all on function public\.psi_record_opportunity_decision\([^)]*integer, text, date\) from public, anon, authenticated;/);
});

// --- PGlite: la 110 y después la 170, como en producción -------------------------------------------------------
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
      ('aprobado','Aprobado',5,1,true,true), ('descartado','Descartado',6,0,true,false), ('perdido','Perdido',7,0,true,false);
    insert into public.psi_sales_service_types values ('seguridad_fisica','Seguridad Física');
    insert into public.psi_sales_loss_reasons values ('precio','Precio',true);
    create view public.v_psi_sales_opportunity_enriched as select o.id from public.psi_sales_opportunities o;
    drop view public.v_psi_sales_opportunity_enriched;
  `);
  await pg.exec(strip(read('../supabase/migrations/110_crm_opportunity_decisions.sql')));
  await pg.exec(strip(read('../supabase/migrations/170_crm_congelar_hasta_una_fecha.sql')));
  await pg.exec(strip(read('../supabase/migrations/171_crm_decision_permisos_firma_nueva.sql')));
  return pg;
}

const ID = '00000000-0000-4000-8000-000000000001';
const bogotaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const signatures = async pg => (await pg.query(`select oid::regprocedure::text s from pg_proc where proname = 'psi_record_opportunity_decision'`)).rows.map(r => r.s);
// Con argumentos nombrados, como los manda supabase-js: es justo la llamada que se vuelve ambigua si quedan dos firmas.
const decideNamed = (pg, params) => pg.query(`select public.psi_record_opportunity_decision(p_opportunity_id => $1, p_actor_profile_id => $2,
  p_decision => 'freeze', p_notes => 'Contrato vigente hasta 2027', p_freeze_days => $3, p_frozen_until => $4) as r`, [ID, JHON, params.days ?? null, params.until ?? null]);

test('PGlite: queda una sola firma, ejecutable sólo por service_role, y congela hasta una fecha', async () => {
  const pg = await freshDb();
  assert.deepEqual(await signatures(pg), ['psi_record_opportunity_decision(uuid,uuid,text,text,text,timestamp with time zone,text,numeric,integer,text,date)']);
  const acl = (await pg.query(`select has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth,
    has_function_privilege('service_role', p.oid, 'execute') sr from pg_proc p where proname = 'psi_record_opportunity_decision'`)).rows[0];
  assert.deepEqual(acl, { anon: false, auth: false, sr: true });

  await pg.query(`insert into public.psi_sales_opportunities (id, owner_id, company_name, service_type_code, stage_code, next_action_at)
    values ($1, $2, 'Cliente parqueado', 'seguridad_fisica', 'prospecto', now() + interval '400 days')`, [ID, JHON]);
  const today = bogotaToday();
  await assert.rejects(decideNamed(pg, { until: today }), /tiene que ser futura/);
  await assert.rejects(decideNamed(pg, { until: addBogotaDays(today, 731) }), /más de 2 años/);
  await assert.rejects(decideNamed(pg, { days: 30, until: addBogotaDays(today, 200) }), /no las dos cosas/);
  await assert.rejects(decideNamed(pg, { days: 45 }), /30, 60 o 90 días, o dar una fecha/);

  const until = addBogotaDays(today, 400);
  await decideNamed(pg, { until });
  const row = (await pg.query(`select frozen_until::text f, (next_action_at at time zone 'America/Bogota')::date::text n from public.psi_sales_opportunities where id = $1`, [ID])).rows[0];
  assert.deepEqual(row, { f: until, n: until }, 'la próxima gestión queda el día que vence el congelamiento');
  const note = (await pg.query(`select notes from public.psi_sales_interactions where opportunity_id = $1`, [ID])).rows[0].notes;
  assert.match(note, new RegExp(`^Congelada hasta ${until.split('-').reverse().join('/')}: `));

  await decideNamed(pg, { days: 30 });
  const short = (await pg.query(`select frozen_until::text f from public.psi_sales_opportunities where id = $1`, [ID])).rows[0].f;
  assert.equal(short, addBogotaDays(today, 30), 'los atajos de días siguen igual');
});

test('PGlite: el rollback de la 170 deja la firma de 10 parámetros, sola y con sus permisos', async () => {
  const pg = await freshDb();
  await pg.exec(strip(read('../supabase/rollbacks/170_crm_congelar_hasta_una_fecha_rollback.sql')));
  assert.deepEqual(await signatures(pg), ['psi_record_opportunity_decision(uuid,uuid,text,text,text,timestamp with time zone,text,numeric,integer,text)']);
  const acl = (await pg.query(`select has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') sr
    from pg_proc p where proname = 'psi_record_opportunity_decision'`)).rows[0];
  assert.deepEqual(acl, { anon: false, sr: true });
});

test('PGlite: la 172 congela las parqueadas hasta su misma fecha y no toca la que alguien ya movió', async () => {
  const pg = await freshDb();
  const insert = (id, next) => pg.query(`insert into public.psi_sales_opportunities (id, owner_id, company_name, service_type_code, stage_code, next_action_at)
    values ($1, $2, 'x', 'seguridad_fisica', 'prospecto', $3)`, [id, JHON, next]);
  await insert('a6433fc2-007e-4bf1-a670-26211b51e0c0', '2027-02-26 14:19:00+00'); // como está en producción
  await insert('7b0301db-eab5-4478-8186-d63c2301cdb8', '2026-12-01 14:00:00+00'); // alguien ya la movió
  await pg.exec(strip(read('../supabase/migrations/172_crm_parqueadas_quedan_congeladas.sql')));
  const rows = (await pg.query(`select id::text, frozen_until::text f, next_action_at = '2027-02-26 14:19:00+00' same_next, frozen_reason
    from public.psi_sales_opportunities order by id desc`)).rows; // primero a6433fc2 (Unicentro), después 7b0301db (Coomeva)
  assert.equal(rows[0].f, '2027-02-26');
  assert.equal(rows[0].same_next, true, 'la próxima gestión no se toca');
  assert.match(rows[0].frozen_reason, /^El comercial la había dejado con la próxima gestión el 26\/02\/2027/);
  assert.equal(rows[1].f, null, 'el valor viejo no coincide: no se toca');
  const audit = (await pg.query(`select count(*)::int n from public.psi_sales_opportunity_audit_logs where field_name = 'frozen_until'`)).rows[0].n;
  assert.equal(audit, 1);
  await pg.exec(strip(read('../supabase/rollbacks/172_crm_parqueadas_quedan_congeladas_rollback.sql')));
  assert.equal((await pg.query(`select count(*)::int n from public.psi_sales_opportunities where frozen_until is not null`)).rows[0].n, 0);
});
