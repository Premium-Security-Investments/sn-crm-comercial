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

test('pantalla y rutas: Empresa, Aliados y Lecciones juntos a la derecha; candidatos bajo la recomendación', () => {
  const nav = read('src/tenders/components/TenderModuleNavigation.tsx');
  const at = word => nav.indexOf(`\n        ${word}\n`);
  assert.ok(nav.indexOf('tender-module-actions') < at('Empresa') && at('Empresa') < at('Aliados') && at('Aliados') < at('Lecciones'));
  const view = read('src/tenders/TenderAlliesView.tsx');
  assert.doesNotMatch(view, /loadListing|Actualizar listado/, 'sin botón de recarga (Juan, 2026-11-10)');
  assert.match(view, /Vista en procesos/);
  assert.match(read('src/tenders/components/AllyDetail.tsx'), /\+ Agregar proceso/);
  assert.match(view, /<AllyDetail company=\{company\}/);
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

test('la pantalla sabe cuántas participaciones de la semilla faltan y no muestra ciudades vacías', async () => {
  const { missingSeedCount, listAllies } = await import('../verticales/licitaciones/tender-allies.js');
  const { normalizeSeedParticipation } = await import('../verticales/licitaciones/tender-allies.js');
  const loaded = VIGILANCE_PARTICIPATIONS_SEED.slice(0, 41).map(normalizeSeedParticipation);
  assert.equal(missingSeedCount(loaded, VIGILANCE_PARTICIPATIONS_SEED), VIGILANCE_PARTICIPATIONS_SEED.length - 41);
  assert.equal(missingSeedCount(VIGILANCE_PARTICIPATIONS_SEED.map(normalizeSeedParticipation), VIGILANCE_PARTICIPATIONS_SEED), 0);
  const rows = {
    psi_vigilance_companies: [{ nit: '900000001', name: 'Uno', role: 'sin_clasificar' }],
    psi_vigilance_company_offices: [{ nit: '900000001', city: 'CALI', city_key: 'cali' }, { nit: '900000001', city: ' ', city_key: '' }, { nit: '900000001', city: 'TULUÁ', city_key: 'tulua' }],
    psi_vigilance_participations: [],
  };
  const database = { from: table => ({ select() { return this; }, range: async () => ({ data: rows[table], error: null }) }) };
  const result = await listAllies(database, { participationsSeed: VIGILANCE_PARTICIPATIONS_SEED });
  assert.deepEqual(result.companies[0].cities.map(city => city.city), ['CALI', 'TULUÁ']);
  assert.equal(result.seed_missing, VIGILANCE_PARTICIPATIONS_SEED.length);
});

// 2026-11-10 (Juan): el contacto en cuatro campos (197) y los correos del PDF sin el espacio partido.
test('migración 197: el contacto en cuatro campos; sin la 197, se guarda junto en el texto libre', async () => {
  const { cleanEmail, updateAlly, listAllies } = await import('../verticales/licitaciones/tender-allies.js');
  assert.equal(cleanEmail('notificaciones@expertoseguridad.co m.co'), 'notificaciones@expertoseguridad.com.co');
  const migration = read('supabase/migrations/197_aliados_contacto_separado.sql');
  assert.match(migration, /revoke all on function public\.psi_save_vigilance_company\(uuid, text, text, jsonb, text\) from public, anon, authenticated/);
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table psi_sales_profiles (id uuid primary key, active boolean, identity_type text, role text);
    create table psi_access_permissions (code text primary key, active boolean);
    create table psi_profile_permissions (profile_id uuid, permission_code text);
    create table psi_sales_opportunities (id uuid primary key);
    insert into psi_sales_profiles values ('00000000-0000-4000-8000-00000000000a', true, 'human', 'admin');
    insert into psi_access_permissions values ('licitaciones', true);
    insert into psi_profile_permissions values ('00000000-0000-4000-8000-00000000000a', 'licitaciones');`);
  await pg.exec(read('supabase/migrations/196_aliados_empresas_vigilancia.sql'));
  await pg.exec(migration);
  await pg.query('select public.psi_load_vigilance_listing($1, $2, $3)', ['00000000-0000-4000-8000-00000000000a', 's', JSON.stringify([{ nit: '900000001', name: 'Uno', offices: [] }])]);
  await pg.query('select public.psi_save_vigilance_company($1, $2, $3, $4, $5)', ['00000000-0000-4000-8000-00000000000a', '900000001', 'aliado', JSON.stringify({ name: 'Ana Gómez', title: 'Gerente comercial', phone: '300 1', email: 'ana@uno.co' }), 'Nota']);
  const row = (await pg.query('select role, contact_name, contact_title, contact_phone, contact_email, notes from psi_vigilance_companies')).rows[0];
  assert.deepEqual(Object.values(row), ['aliado', 'Ana Gómez', 'Gerente comercial', '300 1', 'ana@uno.co', 'Nota']);
  await pg.close();

  const calls = [];
  const without197 = { rpc: async (name, args) => { calls.push([name, args.p_contact]); return name === 'psi_save_vigilance_company' ? { error: { code: 'PGRST202', message: 'not found' } } : { data: {}, error: null }; } };
  await updateAlly(without197, { actorId: 'a', nit: '900000001', role: 'aliado', contact: { name: 'Ana', title: 'Gerente', phone: '300', email: 'a@b. co' }, notes: '' });
  assert.deepEqual(calls[1], ['psi_update_vigilance_company', 'Ana · Gerente · 300 · a@b.co']);

  const rows = { psi_vigilance_company_offices: [], psi_vigilance_participations: [] };
  let first = true;
  const db = { from: table => ({ select(columns) { this.columns = columns; return this; }, range: async function () {
    if (table !== 'psi_vigilance_companies') return { data: rows[table], error: null };
    if (first && this.columns.includes('contact_name')) { first = false; return { data: null, error: { code: '42703', message: 'column contact_name does not exist' } }; }
    return { data: [{ nit: '900000001', name: 'Uno', role: 'aliado', email: 'x@y.co m.co' }], error: null };
  } }) };
  const listed = await listAllies(db);
  assert.equal(listed.companies[0].email, 'x@y.com.co');
});

// 2026-11-10 (Juan): desde «Posibles socios» en Decidir se abre la ficha de la empresa en una ventana.
test('la ficha de una empresa se abre en una ventana desde «Posibles socios»', async () => {
  const { getAlly } = await import('../verticales/licitaciones/tender-allies.js');
  const rows = {
    psi_vigilance_companies: { nit: '800010866', name: 'EXPERTOS SEGURIDAD LTDA', role: 'sin_clasificar', email: 'notificaciones@expertoseguridad.co m.co' },
    psi_vigilance_company_offices: [{ nit: '800010866', city: 'QUIBDO', city_key: 'quibdo' }, { nit: '800010866', city: 'ARMENIA', city_key: 'armenia' }, { nit: '800010866', city: 'ARMENIA', city_key: 'armenia' }],
    psi_vigilance_participations: [{ id: 'p1', nit: '800010866', process_ref: 'SIC 23 DE 2026', kind: 'observo_proyecto' }],
  };
  const database = { from: table => { const chain = { select() { return chain; }, eq() { return table === 'psi_vigilance_companies' ? chain : Promise.resolve({ data: rows[table], error: null }); }, maybeSingle: async () => ({ data: rows[table], error: null }) }; return chain; } };
  const company = await getAlly(database, '800010866');
  assert.deepEqual(company.cities.map(city => city.city), ['QUIBDO', 'ARMENIA']);
  assert.equal(company.email, 'notificaciones@expertoseguridad.com.co');
  assert.equal(company.participations.length, 1);
  await assert.rejects(getAlly(database, 'x'), /no es válida/);
  const candidates = read('src/tenders/components/TenderAllyCandidates.tsx');
  assert.match(candidates, /onClick=\{\(\) => onOpen\(candidate\.nit\)\}/);
  assert.match(candidates, /<CandidateList candidates=\{data\.candidates\} onOpen=\{setCard\} \/>/);
  assert.match(candidates, /<AllyCardDialog nit=\{card\}/);
  assert.match(read('server/index.js'), /'GET \/api\/tender-allies\/company': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/);
});
