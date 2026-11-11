// Mejora 9, tercera parte (Juan, 2026-11-11; migración 207): la experiencia para cada oferta. Caso: Fiscalía pide hasta
// 5 contratos que sumen 14.985 SMMLV con alguno de los códigos 92121500, 92121700 o 46171600.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { evaluateExperiencePlan, experienceCatalog, experienceRequirements, presentExperiencePlan, proposeExperiencePlan } from '../verticales/licitaciones/tender-experience-plan.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const ROWS = [
  { id: 'a', rup_consecutive: '070', contracting_party: 'Jerónimo Martins (Tiendas Ara)', value_smmlv: '49113.99', unspsc_codes: ['92121500', '92121700'], certificate_status: 'falta' },
  { id: 'b', rup_consecutive: '089', contracting_party: 'Jerónimo Martins (Tiendas Ara)', value_smmlv: '43454.45', unspsc_codes: ['92121500'], certificate_status: 'pedido' },
  { id: 'c', rup_consecutive: '050', contracting_party: 'Aeropuerto Matecaña', value_smmlv: '2893.07', unspsc_codes: ['92121500', '46171600'], certificate_status: 'recibido' },
  { id: 'd', rup_consecutive: '086', contracting_party: 'Terminales Medellín', value_smmlv: '4555.52', unspsc_codes: ['43221700'], certificate_status: 'incompleto' },
  { id: 'e', rup_consecutive: null, contracting_party: 'Sin consecutivo', value_smmlv: 10 },
];
const REQ = { minimo_smmlv: 14985, maximo_contratos: 2, codigos: ['92121500', '92121700', '46171600'], codigos_regla: 'alguno' };

test('el servidor revisa la propuesta: existe, sin repetir, máximo, códigos, suma y certificados', () => {
  const catalog = experienceCatalog(ROWS);
  assert.equal(catalog.length, 4);
  const plan = evaluateExperiencePlan(REQ, { habilitante: ['070', '089', '050', '999'], ponderable: ['089', '086'] }, catalog);
  assert.deepEqual(plan.habilitante.map(item => item.consecutivo), ['070', '089']);
  assert.deepEqual(plan.ponderable.map(item => item.consecutivo), ['086']);
  assert.equal(plan.suma_habilitante_smmlv, 92568.44);
  assert.equal(plan.cumple_minimo, true);
  assert.match(plan.avisos[0], /máximo 2 contratos; se quitaron de la habilitante: 050/);
  assert.ok(plan.avisos.some(aviso => /086 no tiene los códigos/.test(aviso)));
  assert.deepEqual(plan.faltan_certificados.map(item => item.consecutivo), ['070', '089', '086']);
  assert.equal(evaluateExperiencePlan({ ...REQ, minimo_smmlv: 100000 }, { habilitante: ['050'] }, catalog).cumple_minimo, false);
});

test('la propuesta de Vig-IA se guarda y la persona la puede cambiar; la pantalla ve la selección vigente', async () => {
  const saved = [];
  const database = { from: () => ({ upsert: async row => { saved.push(row); return { error: null }; } }) };
  const envelope = { claims: [{ claim_id: 'C1', display_text: 'Hasta 5 contratos que sumen 14.985 SMMLV.', source_refs: [{ locator: 'Numeral 5.3.1', document_id: 'doc' }] }],
    requirements: [{ requirement_id: 'REQ-EXP', category: 'EXPERIENCE', company_evaluation: 'AVAILABLE', text_claim_id: 'C1', evidence_claim_ids: [] }] };
  assert.equal(experienceRequirements(envelope).length, 1);
  const ENV = { AGT002_WORKBENCH_RUNTIME: 'agt002_workbench_bridge_v1', AGT002_WORKBENCH_DRAIN_ENABLED: 'true', AGT002_WORKBENCH_MODEL: 'm', AGT002_HETZNER_BRIDGE_URL: 'https://p.example.com/run', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48), AGT002_WORKBENCH_AGENT_ID: '33333333-3333-4333-8333-333333333333', AGT002_WORKBENCH_WORKER_ID: 'w' };
  let input;
  const bridgeClient = { run: async request => { input = request.input; return { content: JSON.stringify({ requisito: { ...REQ, maximo_contratos: 5, objeto: 'Vigilancia', otras_condiciones: null, cita: 'hasta cinco (5) contratos…', ponderable_criterio: null, ponderable_cita: null }, habilitante: ['070'], ponderable: [], explicacion: 'Con el 070 basta.', dudas: [] }) }; } };
  const result = await proposeExperiencePlan(database, { opportunityId: 'opp', runId: 'run', envelope, documents: [{ id: 'doc', name: 'Pliego', extracted_text: '5.3.1. EXPERIENCIA\nHasta cinco (5) contratos.\n5.3.2. OTRO' }], experience: ROWS, environment: ENV, bridgeClient, log: () => {} });
  assert.equal(result.status, 'ran');
  assert.equal(input.contratos_del_rup.length, 4);
  assert.ok(!('id' in input.contratos_del_rup[0]), 'al modelo no viajan los identificadores internos');
  assert.equal(input.secciones_del_pliego[0].numeral, '5.3.1');
  const row = { ...saved[0], created_at: '2026-11-11T21:00:00Z' };
  assert.deepEqual(presentExperiencePlan(row, ROWS).habilitante.map(item => item.consecutivo), ['070']);
  const changed = presentExperiencePlan({ ...row, selection: { habilitante: ['089', '050'], ponderable: ['070'] } }, ROWS);
  assert.equal(changed.ajustada_por_persona, true);
  assert.deepEqual(changed.ponderable.map(item => item.consecutivo), ['070']);
  assert.equal((await proposeExperiencePlan(database, { opportunityId: 'opp', envelope: { requirements: [] }, experience: ROWS, environment: ENV, bridgeClient })).reason, 'sin_requisito_de_experiencia');
});

test('la 207 llena los códigos de las 101 experiencias, crea las propuestas sólo para el servidor y es reversible', async () => {
  const migration = read('supabase/migrations/207_experiencia_codigos_unspsc.sql');
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_opportunities (id uuid primary key); create table public.psi_sales_profiles (id uuid primary key);
    create table public.psi_company_experience (id uuid primary key default gen_random_uuid(), rup_number integer, updated_at timestamptz);
    insert into psi_company_experience (rup_number) select n from generate_series(1, 101) n;`);
  await pg.exec(migration);
  const counts = (await pg.query(`select code, count(*)::int n from psi_company_experience, unnest(unspsc_codes) code group by code order by code`)).rows;
  const byCode = Object.fromEntries(counts.map(row => [row.code, row.n]));
  assert.deepEqual([byCode['92121500'], byCode['92121700'], byCode['46171600'], byCode['43221700']], [101, 79, 66, 18], 'cuadra con psi_company_rup_codes');
  await pg.exec(`update psi_company_experience set unspsc_codes = array['1'] where rup_number = 1`);
  await pg.exec(migration);
  assert.deepEqual((await pg.query(`select unspsc_codes from psi_company_experience where rup_number = 1`)).rows[0].unspsc_codes, ['1'], 'no pisa');
  await pg.exec(read('supabase/rollbacks/207_experiencia_codigos_unspsc_rollback.sql'));
  await pg.close();
  assert.match(migration, /revoke all on table public\.psi_tender_experience_plans from public, anon, authenticated, service_role/);
});

test('rutas y pantalla: en Preparar, proponer y guardar piden aprobar GO; ver pide ver Licitaciones', () => {
  const server = read('server/index.js');
  assert.match(server, /'POST \/api\/tender-experience-plan\/propose': \['tenders', ACTIONS\.LICITACIONES_GO_NO_GO_APPROVE\]/);
  assert.match(server, /'GET \/api\/tender-experience-plan': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/);
  assert.equal(server, read('api/[...path].js'));
  assert.match(read('src/main.tsx'), /experience=\{<TenderExperiencePlan opportunityId=\{o\.id\}/);
});
