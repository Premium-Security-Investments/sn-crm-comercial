// AGT-002 · Empresa fase 1 (Juan, 2026-10-13): estado de bloques, cálculos "por confirmar", servidor y migración 127.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { stripTopLevelTransactionWrapper } from '../scripts/agt002-initial-analysis-migrations.mjs';
import { COMPANY_BASE_REGISTRY_SELECT, cleanCompanyExperience, cleanCompanySite, loadCompanyBase } from '../company-base.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const bundle = buildSync({ entryPoints: [new URL('../src/tenders/companyBase.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const base = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const NOW = new Date('2026-10-13T15:00:00Z');
// Filas con la forma del registro vigente en producción (solo las columnas que la vista lee).
const REGISTRY = [
  { entry_id: 'supervigilancia_operating_license', document_class: 'Licencia de funcionamiento SuperVigilancia', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Resolución 20214100005697; vigencia observada hasta 2029-05-10', expiry: '2029-05-10' },
  { entry_id: 'corporate_background_checks', document_class: 'Antecedentes y consultas de la persona jurídica', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Tres (3) consultas fechadas 2026-06-01', expiry: '2026-08-29' },
  { entry_id: 'authorized_weapons_list', document_class: 'Listado de armas autorizadas', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Expedido 2026-06-19; vigencia declarada de 60 días', expiry: null },
  { entry_id: 'no_fines_sanctions_certificate', document_class: 'Certificado de multas y sanciones', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Expedido 2026-06-18; vigencia declarada de 90 días hábiles', expiry: null },
  { entry_id: 'collective_life_policy', document_class: 'Póliza de seguro de vida colectivo', existence_status: 'reported', human_review_status: 'approved', vigencia_text: 'Renovación 2026-2027; fechas y pago deben verificarse en original', expiry: null },
  { entry_id: 'overtime_authorization', document_class: 'Certificado o autorización de horas extras', existence_status: 'not_verified', human_review_status: 'pending_human_review', vigencia_text: 'Vigencia no confirmada', expiry: '2027-01-01' },
  { entry_id: 'rut', document_class: 'Registro Único Tributario (RUT)', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Edición 2026; validar fecha de generación', expiry: null },
  { entry_id: 'nuevo_bloque', document_class: 'Bloque sin área conocida', existence_status: 'reported', human_review_status: 'rejected', vigencia_text: '', expiry: null },
];
const DOCUMENTS = [
  { id: 'd1', document_type: 'collective_life_policy', display_name: 'Póliza vida', current: true, expires_at: '2027-05-26', version: 1, state: 'vigente', size_bytes: 1, created_at: '2026-10-01', url: 'https://example.test/p' },
  { id: 'd0', document_type: 'rut', display_name: 'RUT viejo', current: false, expires_at: '2026-01-01', version: 1, state: 'vencido', size_bytes: 1, created_at: '2026-01-01' },
];

test('el estado sale de la fecha registrada, del soporte cargado o de un cálculo marcado por confirmar', () => {
  const blocks = Object.fromEntries(base.deriveCompanyBlocks(REGISTRY, DOCUMENTS, NOW).map(block => [block.entryId, block]));
  assert.equal(blocks.supervigilancia_operating_license.state, 'al_dia');
  assert.equal(blocks.supervigilancia_operating_license.porConfirmar, false);
  assert.equal(blocks.corporate_background_checks.state, 'vencido');
  assert.equal(blocks.authorized_weapons_list.expiry, '2026-08-18');
  assert.equal(blocks.authorized_weapons_list.expirySource, 'calculada');
  assert.equal(blocks.authorized_weapons_list.state, 'vencido');
  assert.equal(blocks.authorized_weapons_list.porConfirmar, true);
  assert.equal(blocks.no_fines_sanctions_certificate.expiry, '2026-10-29', '90 días hábiles con festivos de Colombia');
  assert.equal(blocks.no_fines_sanctions_certificate.state, 'vence_pronto');
  assert.equal(blocks.collective_life_policy.expiry, '2027-05-26');
  assert.equal(blocks.collective_life_policy.expirySource, 'documento');
  assert.equal(blocks.collective_life_policy.supportLoaded, true);
  // Aprobada sin `decision_support_document_id` —como quedaron las decisiones anteriores a la migración 159— y con
  // un soporte vigente cargado: nadie puede saber qué documento se miró, así que pide confirmación en vez de
  // afirmar que está aprobada.
  assert.equal(blocks.collective_life_policy.review, 'Falta confirmar');
  assert.equal(blocks.overtime_authorization.state, 'sin_verificar', 'no verificado nunca cuenta como al día aunque tenga fecha');
  assert.equal(blocks.rut.state, 'sin_verificar');
  assert.equal(blocks.rut.supportLoaded, false, 'una versión no vigente no cuenta como soporte');
  assert.equal(blocks.rut.porConfirmar, true);
  assert.equal(blocks.nuevo_bloque.area, 'Otros');
  assert.equal(blocks.nuevo_bloque.review, 'Rechazado');
});

test('vence pronto es hasta 30 días; el día 31 está al día y ayer está vencido', () => {
  const at = expiry => base.deriveCompanyBlock({ entry_id: 'x', document_class: 'X', existence_status: 'reported', expiry }, [], NOW).state;
  assert.equal(at('2026-11-12'), 'vence_pronto');
  assert.equal(at('2026-11-13'), 'al_dia');
  assert.equal(at('2026-10-13'), 'vence_pronto');
  assert.equal(at('2026-10-12'), 'vencido');
});

test('resumen, agrupación por área y filtro', () => {
  const blocks = base.deriveCompanyBlocks(REGISTRY, DOCUMENTS, NOW);
  const summary = base.summarizeCompanyBlocks(blocks);
  assert.deepEqual(summary.counts, { al_dia: 2, vence_pronto: 1, vencido: 2, sin_verificar: 3 });
  assert.equal(summary.total, 8);
  assert.equal(summary.withSupport, 1);
  // Una sola decisión queda en pie: la póliza de vida está aprobada sin ancla y vuelve a "Falta confirmar".
  assert.equal(summary.reviewed, 1);
  assert.deepEqual(base.groupCompanyBlocks(blocks).map(group => group.area), ['Identidad y registro', 'Jurídico', 'Financiero', 'Operaciones', 'Otros']);
  const expired = base.groupCompanyBlocks(blocks, 'vencido');
  assert.deepEqual(expired.flatMap(group => group.blocks.map(block => block.entryId)).sort(), ['authorized_weapons_list', 'corporate_background_checks']);
  assert.equal(base.estimateExpiryFromText('Edición 2026'), null, 'sin expedición y plazo no se calcula nada');
});

test('indicadores financieros y códigos UNSPSC se leen del texto de la ficha', () => {
  const { cut, values } = base.parseFinancialIndicators({
    financial_capacity: 'Corte financiero: 31/12/2025.\nActivo corriente: $16.583.084.264,00\nActivo total: $23.026.819.474,00\nPasivo corriente: $6.993.368.280,00\nPatrimonio: $11.383.759.299,00\nÍndice de liquidez: 2,37 — capacidad holgada.\nÍndice de endeudamiento: 0,50 — equilibrada.\nRazón de cobertura de intereses: 17,47 — alta.',
    organizational_capacity: 'Corte: 31/12/2025.\nRentabilidad del patrimonio (ROE): 0,49.\nRentabilidad del activo (ROA): 0,24.',
  });
  assert.equal(cut, '31/12/2025');
  const byKey = Object.fromEntries(values.map(item => [item.key, item]));
  assert.equal(byKey.liquidez.value, 2.37);
  assert.equal(byKey.endeudamiento.value, 0.5);
  assert.equal(byKey.cobertura.value, 17.47);
  assert.equal(byKey.roe.value, 0.49);
  assert.equal(byKey.roa.value, 0.24);
  assert.equal(byKey.patrimonio.value, 11383759299);
  assert.equal(byKey.capital_trabajo.value, 9589715984);
  assert.equal(byKey.capital_trabajo.calculated, true);
  assert.deepEqual(base.parseUnspscCodes('32151800: Dispositivos de control de seguridad\n92121500: Servicios de guardias\ntexto suelto'), [
    { code: '32151800', description: 'Dispositivos de control de seguridad' },
    { code: '92121500', description: 'Servicios de guardias' },
  ]);
});

test('servidor: exposición mínima del registro y validación de sedes y experiencia', async () => {
  // 159: se agrega el ancla de la decisión al documento. Es el id de un documento que esta misma
  // pantalla ya lista, así que no amplía la exposición, y es lo que permite que una versión nueva
  // no herede la aprobación de la anterior.
  assert.equal(COMPANY_BASE_REGISTRY_SELECT, 'entry_id,document_class,existence_status,human_review_status,vigencia_text,expiry,current,integration_active,decision_support_document_id');
  assert.throws(() => cleanCompanySite({ city: 'Pereira' }), /departamento es obligatorio/);
  assert.deepEqual(cleanCompanySite({ department: ' Nariño ', is_main: 'true' }), { department: 'Nariño', city: null, address: null, is_main: false, supervigilancia_authorization: null, support_document_id: null, notes: null, source: null });
  assert.throws(() => cleanCompanyExperience({ contracting_party: 'X' }), /de dónde sale el dato/);
  assert.throws(() => cleanCompanyExperience({ contracting_party: 'X', source: 'RUP', value_smmlv: '-1' }), /SMMLV no es un número válido/);
  assert.throws(() => cleanCompanyExperience({ contracting_party: 'X', source: 'RUP', rup_number: '1.5' }), /número del RUP/);
  assert.deepEqual(cleanCompanyExperience({ contracting_party: 'Megabús S.A.', source: 'RUP', rup_number: '85', value_smmlv: '5658.95', contract_year: '' }), {
    rup_number: 85, contracting_party: 'Megabús S.A.', contract_object: null, value_smmlv: 5658.95, value_cop: null, contract_year: null, source: 'RUP', notes: null,
  });

  const absent = { data: null, error: { code: 'PGRST205', message: 'missing' } };
  const query = result => { const chain = { select: () => chain, eq: () => chain, order: () => chain, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }; return chain; };
  const database = { from: table => query(table === 'psi_agt002_company_evidence_registry' ? { data: [REGISTRY[0]], error: null } : absent) };
  assert.deepEqual(await loadCompanyBase(database), { registry: [REGISTRY[0]], sites: [], experience: [], structured_tables_available: false });
});

test('endpoints: lectura con permiso de ver, escritura con permiso de configurar, iguales en ambos backends', () => {
  for (const path of ['../server/index.js', '../api/[...path].js']) {
    const source = read(path);
    assert.match(source, /app\.get\('\/api\/tender-company-base'[\s\S]{0,200}requireAction\(currentProfile, ACTIONS\.LICITACIONES_VIEW\)/);
    assert.match(source, /app\.post\('\/api\/tender-company-sites'[\s\S]{0,200}requireAction\(currentProfile, ACTIONS\.LICITACIONES_CONFIGURE\)/);
    assert.match(source, /app\.post\('\/api\/tender-company-experience'[\s\S]{0,200}requireAction\(currentProfile, ACTIONS\.LICITACIONES_CONFIGURE\)/);
  }
});

test('la vista Empresa ya no muestra el informe pegado y conserva carga de RUP y documentos', () => {
  const view = read('../src/tenders/TenderConfigurationView.tsx');
  assert.doesNotMatch(view, /Información útil para cruzar contra pliegos|key: 'useful_company_info'/);
  for (const marker of ['CompanyStatusSummary', 'CompanyBlocksTable', 'CompanySitesSection', 'CompanyExperienceSection', 'CompanyFinancialSection', 'Actualizar RUP', 'Actualizar documento empresarial', 'TenderCompanyDocuments']) assert.ok(view.includes(marker), marker);
  const order = ['<CompanyStatusSummary', '<CompanyBlocksTable', '<CompanySitesSection', '<CompanyExperienceSection', '<CompanyFinancialSection'].map(marker => view.indexOf(marker));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'orden: resumen, bloques, sedes, experiencia, indicadores');
});

const M127 = '../supabase/migrations/127_company_sites_experience.sql';
const R127 = '../supabase/rollbacks/127_company_sites_experience_rollback.sql';

test('127: número único, transacción, reversa, sin borrados y sólo service_role', () => {
  const numbers = readdirSync(new URL('../supabase/migrations/', import.meta.url)).map(name => name.slice(0, 3));
  assert.equal(numbers.filter(value => value === '127').length, 1);
  const sql = read(M127);
  assert.match(sql, /^-- [\s\S]*?\nbegin;/);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(sql, /\b(drop table|delete from|truncate)\b/i);
  assert.match(sql, /grant select, insert, update on table public\.psi_company_sites to service_role;/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated|public)/i);
  assert.match(read(R127), /drop table if exists public\.psi_company_experience;[\s\S]*drop table if exists public\.psi_company_sites;/);
});

async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.psi_sales_profiles (id uuid primary key);
    create table public.psi_company_procurement_documents (id uuid primary key);
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
  `);
  return pg;
}

test('127 en PGlite: siembra 1 sede y 8 contratos, es repetible y la reversa limpia', async () => {
  const pg = await freshDb();
  const migration = stripTopLevelTransactionWrapper(read(M127));
  await pg.exec(migration);
  await pg.exec(migration);
  const sites = (await pg.query('select department, city, address, is_main, supervigilancia_authorization, source from public.psi_company_sites order by is_main desc, city')).rows;
  assert.equal(sites.length, 7);
  assert.deepEqual(sites[0], { department: 'Risaralda', city: 'Pereira', address: 'Calle 10 # 15-64', is_main: true, supervigilancia_authorization: null, source: 'RUP 17-jun-2026 (informe); Juan 2026-10-13' });
  assert.deepEqual(sites.slice(1).map(row => row.city), ['Armenia', 'Bogotá', 'Cali', 'Cartago', 'Manizales', 'Medellín']);
  assert.equal(sites.find(row => row.city === 'Armenia').supervigilancia_authorization, 'Pendiente de resolución de la SVSP');
  const experience = (await pg.query('select rup_number, value_smmlv::text, value_cop::text, source from public.psi_company_experience order by seed_key')).rows;
  assert.equal(experience.length, 8);
  assert.ok(experience.every(row => row.source === 'RUP 17-jun-2026 (informe)'));
  assert.ok(experience.some(row => row.rup_number === 70 && row.value_smmlv === '49113.99'));
  await assert.rejects(pg.query("insert into public.psi_company_sites(department) values ('  ')"), /check/);
  await assert.rejects(pg.query("insert into public.psi_company_experience(contracting_party, source, value_smmlv) values ('X', 'RUP', -1)"), /check/);
  const grants = (await pg.query("select grantee, privilege_type from information_schema.role_table_grants where table_name = 'psi_company_sites' and grantee in ('anon','authenticated','service_role') order by 1, 2")).rows;
  assert.deepEqual(grants.map(row => `${row.grantee}:${row.privilege_type}`), ['service_role:INSERT', 'service_role:SELECT', 'service_role:UPDATE']);
  await pg.exec(stripTopLevelTransactionWrapper(read(R127)));
  const remaining = (await pg.query("select count(*)::int as n from information_schema.tables where table_name in ('psi_company_sites','psi_company_experience')")).rows[0].n;
  assert.equal(remaining, 0);
  await pg.close();
});
