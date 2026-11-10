// Aliados para uniones temporales (encargo AGT-002 del 2026-11-09; Juan, 2026-11-09).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { citiesToCover, cityKey, rankAllyCandidates } from '../verticales/licitaciones/tender-allies.js';
import { VIGILANCE_LISTING } from '../data/aliados/listado-supervigilancia-2026-11-07.js';
import { VIGILANCE_PARTICIPATIONS_SEED } from '../data/aliados/participaciones-semilla-2026-11-09.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const companies = (overrides = {}) => VIGILANCE_LISTING.map(company => ({
  ...company, role: overrides[company.nit]?.role || 'sin_clasificar', participations: overrides[company.nit]?.participations || [],
  cities: [...new Map(company.offices.map(office => [office.city_key, { city: office.city, city_key: office.city_key }])).values()],
}));
const known = new Set(VIGILANCE_LISTING.flatMap(company => company.offices.map(office => office.city_key)));
// Nuestra ficha: autorizadas Pereira, Medellín, Bogotá, Manizales, Cartago y Cali; Armenia pendiente (no cuenta).
const ours = new Set(['Pereira', 'Medellín', 'Bogotá', 'Manizales', 'Cartago', 'Cali'].map(cityKey));
const FISCALIA = 'Solo en unión temporal: la empresa no tiene sede o agencia autorizada en Quibdó (Chocó) y la de Armenia sigue pendiente de resolución de la Superintendencia, así que el socio debería aportar sede o agencia autorizada en esas dos ciudades.';

test('el listado empacado: 794 empresas, 2.426 oficinas, 60 participaciones', () => {
  assert.equal(VIGILANCE_LISTING.length, 794);
  assert.equal(VIGILANCE_LISTING.reduce((total, company) => total + company.offices.length, 0), 2426);
  assert.equal(VIGILANCE_PARTICIPATIONS_SEED.length, 60);
});

test('caso Fiscalía: falta Quibdó y Armenia (pendiente en la ficha), y salen las candidatas con las dos ciudades', () => {
  const keys = citiesToCover(FISCALIA, { ourCityKeys: ours, knownCityKeys: known });
  assert.deepEqual(keys.sort(), ['armenia', 'quibdo']);
  const names = rankAllyCandidates(companies(), { cityKeys: keys }).map(candidate => candidate.name);
  assert.equal(names.length, 5);
  assert.ok(names.some(name => /AMCOVIT/.test(name)));
});

test('no propone descartados ni a nosotros, y avisa si es el contratista actual del proceso', () => {
  const keys = ['armenia', 'quibdo'];
  const amcovit = VIGILANCE_LISTING.find(company => /AMCOVIT/.test(company.name)).nit;
  const serviconfor = VIGILANCE_LISTING.find(company => /SERVICONFOR/.test(company.name)).nit;
  const list = rankAllyCandidates(companies({
    [amcovit]: { role: 'descartado' },
    [serviconfor]: { participations: [{ process_ref: 'FGN-REC-IPSE-0058-2026', kind: 'contratista_actual' }] },
  }), { cityKeys: keys, processRef: 'FGN-REC-IPSE-0058-2026' });
  assert.ok(!list.some(candidate => candidate.nit === amcovit));
  assert.match(list.find(candidate => candidate.nit === serviconfor).warning, /contratista actual/);
});

test('si la falta no es una ciudad (DEAJ, liquidez), no inventa candidatos; si todas son nuestras, usa lo que debe aportar el socio', () => {
  assert.deepEqual(citiesToCover('Solo en unión temporal: la empresa sola no cumple la liquidez (2,37 frente a 2,73).', { ourCityKeys: ours, knownCityKeys: known }), []);
  assert.deepEqual(citiesToCover('Solo en unión temporal: sede principal en Pereira y agencia en Cali sin 5 años; el socio debería aportar domicilio principal en Cali', { ourCityKeys: ours, knownCityKeys: known }), ['cali']);
});

test('migración 196: la recarga no toca rol, contacto ni notas; las participaciones no se editan', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean default true, identity_type text default 'human', role text, full_name text);
    create table public.psi_access_permissions (code text primary key, active boolean default true);
    create table public.psi_profile_permissions (profile_id uuid, permission_code text);
    create table public.psi_sales_opportunities (id uuid primary key);
    insert into psi_access_permissions values ('licitaciones'); insert into psi_sales_profiles (id, role) values ('8c172493-12aa-4be1-893a-2e5e93f7fba2', 'comercial');
    insert into psi_profile_permissions values ('8c172493-12aa-4be1-893a-2e5e93f7fba2', 'licitaciones');`);
  await pg.exec(read('supabase/migrations/196_aliados_empresas_vigilancia.sql'));
  const K = '8c172493-12aa-4be1-893a-2e5e93f7fba2';
  const sample = VIGILANCE_LISTING.slice(0, 3);
  await pg.query('select public.psi_load_vigilance_listing($1, $2, $3)', [K, 'prueba', JSON.stringify(sample)]);
  await pg.query('select public.psi_update_vigilance_company($1, $2, $3, $4, $5)', [K, sample[0].nit, 'aliado', 'Gerente: 300 000 0000', 'Conversamos en octubre']);
  await pg.query('select public.psi_load_vigilance_listing($1, $2, $3)', [K, 'prueba 2', JSON.stringify(sample.map(company => ({ ...company, name: company.name + ' (nuevo)' })))]);
  const row = (await pg.query('select name, role, contact, notes from psi_vigilance_companies where nit = $1', [sample[0].nit])).rows[0];
  assert.deepEqual([row.role, row.contact, row.notes], ['aliado', 'Gerente: 300 000 0000', 'Conversamos en octubre']);
  assert.match(row.name, /\(nuevo\)/);
  await pg.query('select public.psi_add_vigilance_participation($1, $2)', [K, JSON.stringify({ nit: sample[0].nit, company_label: 'x', process_ref: 'P-1', kind: 'oferto' })]);
  await assert.rejects(pg.exec('delete from psi_vigilance_participations'), /no se editan/);
  await assert.rejects(pg.query('select public.psi_update_vigilance_company($1, $2, $3, null, null)', ['11111111-1111-4111-8111-111111111111', sample[0].nit, 'aliado']), /Licitaciones/);
  await pg.close();
});

test('pantalla y rutas: botón «Aliados» junto a «Lecciones», candidatos bajo la recomendación', () => {
  const nav = read('src/tenders/components/TenderModuleNavigation.tsx');
  assert.ok(nav.indexOf('Lecciones') < nav.indexOf('Aliados'));
  assert.match(read('src/tenders/workspace/TenderWorkspace.tsx'), /initialReportRecommendationText\(report\.recommendation\.label\)\}<\/p>\n\s+\{\/\*[^\n]*\*\/\}\n\s+\{allies\}/);
  const server = read('server/index.js');
  assert.match(server, /'GET \/api\/tender-allies\/candidates': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/);
  assert.equal(server, read('api/[...path].js'));
});

// 2026-11-10: la primera carga en producción se cayó en la participación 42, que traía sólo el año («2023»).
test('una fecha que sólo trae el año va al detalle, y la recarga sólo agrega las participaciones que faltan', async () => {
  const { normalizeSeedParticipation, loadAlliesListing } = await import('../verticales/licitaciones/tender-allies.js');
  assert.deepEqual(normalizeSeedParticipation({ occurred_on: '2023', detail: 'Adjudicatario' }), { occurred_on: null, detail: 'Año 2023. Adjudicatario' });
  assert.equal(VIGILANCE_PARTICIPATIONS_SEED.map(normalizeSeedParticipation).filter(part => part.occurred_on && !/^\d{4}-\d{2}-\d{2}$/.test(part.occurred_on)).length, 0);
  const inserted = VIGILANCE_PARTICIPATIONS_SEED.slice(0, 41).map(part => ({ process_ref: part.process_ref, company_label: part.company_label, kind: part.kind }));
  const calls = [];
  const database = {
    rpc: async (name, args) => { calls.push(name); if (name === 'psi_add_vigilance_participation') inserted.push(args.p_payload); return { data: { companies: 0, offices: 0 }, error: null }; },
    from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { role: 'nosotros' } }), range: async () => ({ data: inserted.slice(0, 41), error: null }) }),
  };
  const result = await loadAlliesListing(database, { actorId: 'k', listing: [], source: 's', participationsSeed: VIGILANCE_PARTICIPATIONS_SEED });
  assert.equal(result.participations_seeded, 19);
});
