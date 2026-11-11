// AGT-003 — tarifas del cotizador con vigencia y tablas de cotización (migración 204; entrega 2). Juan, 2026-11-11.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_GUARD_RATES, normalizeGuardRates, normalizeTechRates, quoteGuardPost, ratesInEffect } from '../src/vigia/quote-engine.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = sql => sql.replace(/^\s*begin;\s*$/gim, '').replace(/^\s*commit;\s*$/gim, '');

async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key);
    create table public.psi_sales_opportunities (id uuid primary key);
    insert into public.psi_sales_profiles values ('11111111-1111-4111-8111-111111111111');
  `);
  await pg.exec(strip(read('../supabase/migrations/204_agt003_cotizador_tarifas_y_cotizaciones.sql')));
  return pg;
}

test('migración 204: tablas, tarifas de 2026 con su historia y permisos sólo del servidor', async () => {
  const pg = await freshDb();
  const rates = (await pg.query(`select kind, valid_from::text, params from public.psi_quote_rates order by kind, valid_from`)).rows;
  assert.deepEqual(rates.map(r => `${r.kind} ${r.valid_from} ${r.params.factor ?? r.params.margin}`), [
    'tecnologia 2026-01-01 0.35', 'vigilancia 2026-01-01 9.77', 'vigilancia 2026-07-01 9.85', 'vigilancia 2026-07-15 10.21',
  ]);
  const vigente = ratesInEffect(rates.filter(r => r.kind === 'vigilancia'), '2026-11-11');
  assert.equal(vigente.params.factor, 10.21, 'hoy rige 10,21');
  assert.equal(ratesInEffect(rates.filter(r => r.kind === 'vigilancia'), '2026-07-10').params.factor, 9.85);
  // Lo que se cargó en la base sirve tal cual para el motor y da lo mismo que las tarifas del código.
  const desdeLaBase = normalizeGuardRates(vigente.params);
  const post = { start: '0600', end: '0600', dayTypes: ['lunes_a_viernes', 'sabados', 'domingos', 'festivos'], guards: 3, modality: 'con_arma' };
  assert.deepEqual(quoteGuardPost(post, desdeLaBase), quoteGuardPost(post, DEFAULT_GUARD_RATES));
  for (const table of ['psi_quote_rates', 'psi_quotes', 'psi_quote_guard_posts', 'psi_quote_tech_lines']) {
    const acl = (await pg.query(`select has_table_privilege('anon', 'public.${table}', 'select') anon, has_table_privilege('authenticated', 'public.${table}', 'select') auth,
      has_table_privilege('service_role', 'public.${table}', 'insert') sr, (select relrowsecurity from pg_class where oid = 'public.${table}'::regclass) rls`)).rows[0];
    assert.deepEqual(acl, { anon: false, auth: false, sr: true, rls: true }, table);
  }
  await assert.rejects(pg.query(`insert into public.psi_quote_rates (kind, valid_from, params) values ('vigilancia', '2026-07-15', '{}')`), /duplicate|unique/i, 'misma fecha de vigencia no se repite');
});

test('cotización mixta guardada: borrar la cotización borra sus puestos y líneas', async () => {
  const pg = await freshDb();
  const q = (await pg.query(`insert into public.psi_quotes (client_name, created_by) values ('Conjunto de prueba', '11111111-1111-4111-8111-111111111111') returning id`)).rows[0].id;
  await pg.query(`insert into public.psi_quote_guard_posts (quote_id, position, start_time, end_time, day_types, guards, modality) values ($1, 1, '0600', '0600', '{lunes_a_viernes}', 3, 'con_arma')`, [q]);
  await pg.query(`insert into public.psi_quote_tech_lines (quote_id, position, category, quantity, unit_cost) values ($1, 1, 'equipo', 2, 650)`, [q]);
  await assert.rejects(pg.query(`insert into public.psi_quote_guard_posts (quote_id, position, start_time, end_time, day_types, guards, modality) values ($1, 2, '0600', '1800', '{sabados}', 1, 'tanque')`, [q]), /check/i);
  await pg.query(`delete from public.psi_quotes where id = $1`, [q]);
  assert.equal((await pg.query(`select (select count(*) from public.psi_quote_guard_posts)::int + (select count(*) from public.psi_quote_tech_lines)::int n`)).rows[0].n, 0);
  await pg.exec(strip(read('../supabase/rollbacks/204_agt003_cotizador_tarifas_y_cotizaciones_rollback.sql')));
  assert.equal((await pg.query(`select to_regclass('public.psi_quote_rates') is null gone`)).rows[0].gone, true);
});

test('validación de tarifas: ataja errores de digitación', () => {
  assert.equal(normalizeGuardRates(DEFAULT_GUARD_RATES).factor, 10.21);
  assert.throws(() => normalizeGuardRates({ ...DEFAULT_GUARD_RATES, factor: 102.1 }), /factor/);
  assert.throws(() => normalizeGuardRates({ ...DEFAULT_GUARD_RATES, ivaRate: 19 }), /IVA/);
  assert.throws(() => normalizeGuardRates({ ...DEFAULT_GUARD_RATES, nightShare: 0.6 }), /sumar 100/);
  assert.throws(() => normalizeGuardRates({ ...DEFAULT_GUARD_RATES, modalities: { sin_arma: 0.08, con_arma: 0.1 } }), /canino/);
  assert.deepEqual(normalizeTechRates({ margin: 0.35, ivaRate: 0.19 }), { margin: 0.35, ivaRate: 0.19 });
  assert.throws(() => normalizeTechRates({ margin: 35, ivaRate: 0.19 }), /margen/);
});

test('servidor: leer tarifas quien cotiza, cargarlas sólo el administrador, sin sobrescribir', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    assert.match(src, /'GET \/api\/agt003\/quote-rates': \['opportunities', ACTIONS\.CRM_OPPORTUNITY_DETAIL_VIEW\]/);
    assert.match(src, /'POST \/api\/agt003\/quote-rates': \['opportunities', ACTIONS\.CRM_OPPORTUNITY_EDIT\]/);
    const post = src.slice(src.indexOf("app.post('/api/agt003/quote-rates'"));
    const handler = post.slice(0, post.indexOf('\n});'));
    assert.match(handler, /if \(currentProfile\.role !== 'admin'\)/);
    assert.match(handler, /const params = normalize\(req\.body\?\.params \|\| \{\}\);/);
    assert.match(handler, /\.insert\(/);
    assert.doesNotMatch(handler, /\.update\(|\.upsert\(|\.delete\(/, 'nunca se sobrescribe una tarifa');
    assert.match(src, /if \(error\.code === '42P01'\) return null;/, 'sin la migración, se cotiza con las tarifas del código');
  }
});
