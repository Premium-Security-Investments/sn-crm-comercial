// Mejora 10 (Juan, 2026-11-10; migración 200): las condiciones diferenciales en la ficha y el aviso en Decidir de dónde
// el pliego las premia. Los textos son los de los pliegos reales de Terminal y Fiscalía.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { assessDifferentialBenefits, findDifferentialMentions, listDifferentialConditions, saveDifferentialCondition } from '../verticales/licitaciones/differential-conditions.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const TERMINAL = { name: 'PLIEGO DE CONDICIONES DEFINITIVO TT-SPO-07-2026.pdf', extracted_text: 'GARANTÍA DE SERIEDAD DE LA OFERTA. Cuantía: El equivalente al Doce (12%) del presupuesto oficial. Nota 1: En cumplimiento de lo establecido en los artículos 2.2.1.2.4.2.15. Criterios diferenciales para Mipyme en el sistema de compras públicas del Decreto 1860 de 2021, los proponentes que acrediten ya sea individual o como miembros de la estructura plural, que es emprendimientos y empresas de mujeres o acredita la calidad Mipyme, el valor asegurado mínimo de la garantía de seriedad será equivalente al diez por ciento (10%) del valor del presupuesto oficial estimado.' };
const FISCALIA_ADENDA = { name: 'ADENDA FGN-REC-IPSE-0058-2026.pdf', extracted_text: 'Dando cumplimiento a lo dispuesto en los ART. 2.2.1.2.4.2.15 del Decreto 1082 de 2015, adicionado por el artículo 3 del Decreto 1860 de 2021 – Para emprendimientos y empresas de mujeres y Mipymes, se dará aplicación al siguiente criterio diferencial: El oferente deberá acreditar en el Registro Único de Proponentes la ejecución de hasta seis (6) contratos ejecutados.' };
const DEFINICION = { name: 'COMPLEMENTO PLIEGO DEFINITIVO.pdf', extracted_text: 'ARTÍCULO 2.2.1.2.4.2.14. Definición de emprendimientos y empresas de mujeres. Con el propósito de adoptar medidas afirmativas que incentiven la participación de las mujeres en el sistema de compras públicas, se entenderán como emprendimientos y empresas de mujeres aquellas que cumplan alguna de las siguientes condiciones.' };
const CONDITIONS = [
  { code: 'empresa_mujeres', status: 'cumple', certified_on: '2026-06-22' },
  { code: 'tamano_empresarial', status: 'cumple', value: 'gran_empresa' },
  { code: 'discapacidad_nomina', status: 'por_confirmar' },
];

test('Terminal: empresa de mujeres baja la garantía al 10 %; Mipyme no nos aplica por ser Gran Empresa', () => {
  const benefits = assessDifferentialBenefits(CONDITIONS, findDifferentialMentions([TERMINAL]), { today: new Date('2026-11-03T00:00:00Z') });
  const women = benefits.find(item => item.code === 'empresa_mujeres');
  assert.equal(women.verdict, 'aplica');
  assert.ok(women.kinds.includes('garantia'));
  assert.match(women.action, /2026-06-22, hay que actualizarla\); calcular la garantía con el porcentaje reducido/);
  const size = benefits.find(item => item.code === 'tamano_empresarial');
  assert.equal(size.verdict, 'no_aplica');
  assert.match(size.action, /Gran Empresa/);
});

test('Fiscalía: el beneficio es de experiencia, y la definición legal repetida no tapa lo que importa', () => {
  const mentions = findDifferentialMentions([DEFINICION, DEFINICION, FISCALIA_ADENDA]);
  assert.equal(mentions.empresa_mujeres[0].document, 'ADENDA FGN-REC-IPSE-0058-2026.pdf');
  assert.ok(mentions.empresa_mujeres[0].kinds.includes('experiencia'));
  assert.equal(mentions.empresa_mujeres.filter(item => item.document === 'COMPLEMENTO PLIEGO DEFINITIVO.pdf').length, 2, 'la misma frase no se repite aunque venga en dos documentos');
  const women = assessDifferentialBenefits(CONDITIONS, mentions).find(item => item.code === 'empresa_mujeres');
  assert.match(women.action, /revisar el requisito de experiencia diferencial/);
});

test('discapacidad por confirmar: si el pliego la premia, avisa que hay que confirmarla; sin menciones no hay aviso', () => {
  const doc = { name: 'Pliego.pdf', extracted_text: 'Criterios de desempate: preferir la propuesta del oferente que acredite que por lo menos el diez por ciento (10%) de su nómina está en condición de discapacidad, o personas en condición de discapacidad vinculadas.' };
  const benefits = assessDifferentialBenefits(CONDITIONS, findDifferentialMentions([doc]));
  assert.equal(benefits.length, 1);
  assert.equal(benefits[0].verdict, 'por_confirmar');
  assert.ok(benefits[0].kinds.includes('desempate'));
  assert.deepEqual(assessDifferentialBenefits(CONDITIONS, findDifferentialMentions([{ name: 'x', extracted_text: 'vigilancia y seguridad privada' }])), []);
});

test('la 200 crea las tres condiciones sin pisar lo escrito, sólo para el servidor, y es reversible', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key);`);
  const migration = read('supabase/migrations/200_condiciones_diferenciales.sql');
  await pg.exec(migration);
  await pg.exec(`update psi_company_differential_conditions set detail = 'escrito por Juan' where code = 'empresa_mujeres'`);
  await pg.exec(migration);
  const rows = (await pg.query('select code, status, value, detail from psi_company_differential_conditions order by code')).rows;
  assert.deepEqual(rows.map(row => [row.code, row.status]), [['discapacidad_nomina', 'por_confirmar'], ['empresa_mujeres', 'cumple'], ['tamano_empresarial', 'cumple']]);
  assert.equal(rows.find(row => row.code === 'empresa_mujeres').detail, 'escrito por Juan');
  assert.equal(rows.find(row => row.code === 'tamano_empresarial').value, 'gran_empresa');
  await assert.rejects(pg.exec(`insert into psi_company_differential_conditions (code) values ('otra')`));
  assert.match(migration, /revoke all on table public\.psi_company_differential_conditions from public, anon, authenticated, service_role/);
  await pg.exec(read('supabase/rollbacks/200_condiciones_diferenciales_rollback.sql'));
  assert.equal((await pg.query(`select to_regclass('public.psi_company_differential_conditions') r`)).rows[0].r, null);
  await pg.close();
});

test('sin la 200 la ficha no se rompe y guardar dice qué falta; las rutas y las pantallas están conectadas', async () => {
  const missing = { from: () => ({ select: async () => ({ data: null, error: { code: '42P01' } }), upsert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: 'PGRST205' } }) }) }) }) };
  assert.deepEqual(await listDifferentialConditions(missing), { installed: false, conditions: [] });
  await assert.rejects(saveDifferentialCondition(missing, { code: 'empresa_mujeres', status: 'cumple' }, 'u'), /migración 200/);
  await assert.rejects(saveDifferentialCondition(missing, { code: 'otra' }, 'u'), /no es válida/);
  const server = read('server/index.js');
  assert.match(server, /'GET \/api\/tender-differential-benefits': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/);
  assert.match(server, /'POST \/api\/tender-company-differential-conditions': \['tenders', ACTIONS\.LICITACIONES_CONFIGURE\]/);
  assert.equal(server, read('api/[...path].js'));
  assert.match(read('src/main.tsx'), /<TenderDifferentialBenefits opportunityId=\{o\.id\} request=\{api\} \/>/);
  assert.match(read('src/tenders/TenderConfigurationView.tsx'), /<CompanyDifferentialConditions request=\{request\} canEdit=\{canConfigure\} \/>/);
});

test('«experiencia» sola cerca de la mención no marca el beneficio como de experiencia (Fiscalía, 2026-11-10)', () => {
  const doc = { name: 'Formatos.zip', extracted_text: 'FORMATO B – VINCULACIÓN DE PERSONAS EN CONDICIÓN DE DISCAPACIDAD. El proponente con experiencia en vigilancia diligencia este formato para el desempate con las personas en condición de discapacidad vinculadas.' };
  const mention = findDifferentialMentions([doc]).discapacidad_nomina[0];
  assert.ok(!mention.kinds.includes('experiencia'));
  assert.ok(mention.kinds.includes('desempate'));
  assert.ok(findDifferentialMentions([FISCALIA_ADENDA]).empresa_mujeres[0].kinds.includes('experiencia'));
});
