// Encargo AGT-002 del 2026-11-10 (aprobado por Juan): «Posibles socios» según cómo deja el pliego cumplir a una unión
// temporal. El caso de prueba es Fiscalía FGN-REC-IPSE-0058-2026: el complemento del pliego definitivo, 5.3.2 punto 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { blockingRequirements, citiesNamed, pluralReadingFor, pluralSentences, readPluralRule, readPluralRuleFromText } from '../verticales/licitaciones/tender-plural-reading.js';
import { rankAllyCandidates } from '../verticales/licitaciones/tender-allies.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const COMPLEMENTO = {
  id: '61faf1bb-2a74-4cba-88a3-d3cbc90a58d4', name: 'COMPLEMENTO PLIEGO DEFINITIVO FGN-REC-IPSE-0058-2026.pdf',
  extracted_text: `5.3.1. EXPERIENCIA\nTexto de experiencia.\n\n5.3.2. REQUISITO TÉCNICO HABILITANTE ADICIONAL  \n \n1. Licencia de funcionamiento  \n \nEl  oferente  deberá  anexar  a  su oferta la licencia. La infraestructura a la que se hace alusión puede corresponder a la sede principal, sucursal o agencia, la cual deberá estar autorizada por la Superintendencia de vigilancia y Seguridad Privada y registrada en la respectiva Cámara de Comercio. En cuanto a los consorcios o uniones temporales, si uno de los integrantes cumple con el requisito de tener domicilio principal, sucursal o agencia en la ciudad capital de cada seccional que conforma la regional, se entenderá cumplido el requisito. 2.  LICENCIA  DE  SERVICIO  DE  ASESORÍA\n\n5.3.3. OTRO\nnada`,
};
const ENVELOPE = {
  claims: [
    { claim_id: 'CLM-REQ-PRESENCIA', display_text: 'El pliego exige infraestructura física en Pereira, Manizales, Armenia y Quibdó.', source_refs: [{ locator: 'Numeral 5.3.2, punto 1', document_id: COMPLEMENTO.id }] },
    { claim_id: 'CLM-SEDES-SUMA-AUSENTE', display_text: 'No consta si la presencia en Armenia y Quibdó puede acreditarla un solo integrante.', source_refs: [{ locator: 'Numeral 5.3.2, punto 1', document_id: COMPLEMENTO.id }] },
  ],
  requirements: [
    { requirement_id: 'REQ-SEDES-CUATRO-CIUDADES', company_evaluation: 'BLOCKER', category: 'TECHNICAL', text_claim_id: 'CLM-REQ-PRESENCIA', evidence_claim_ids: ['CLM-SEDES-SUMA-AUSENTE'] },
    { requirement_id: 'REQ-CODIGOS', company_evaluation: 'AVAILABLE', category: 'TECHNICAL', text_claim_id: null, evidence_claim_ids: [] },
  ],
};
const KNOWN = new Set(['pereira', 'manizales', 'armenia', 'quibdo', 'cali', 'bogota']);
const LABEL = 'Solo en unión temporal: sin sede ni agencia autorizada en Armenia (resolución pendiente) ni en Quibdó; el socio debería aportar presencia con licencia de la SuperVigilancia en ambas ciudades.';

test('Fiscalía: la frase del 5.3.2 se lee sola, sin modelo: un solo integrante con las cuatro ciudades', async () => {
  const reading = await readPluralRule({ envelope: ENVELOPE, label: LABEL, documents: [COMPLEMENTO], knownCityKeys: KNOWN, environment: {} });
  assert.equal(reading.mode, 'uno_cumple');
  assert.equal(reading.quote_verified, true);
  assert.match(reading.quote, /^En cuanto a los consorcios o uniones temporales, si uno de los integrantes cumple/);
  assert.equal(reading.locator, 'Numeral 5.3.2');
  assert.equal(reading.document_name, COMPLEMENTO.name);
  assert.deepEqual(reading.required_cities.sort(), ['armenia', 'manizales', 'pereira', 'quibdo']);
});

test('se suma, no dice, y una cita del modelo que no está en el texto no vale', async () => {
  assert.equal(readPluralRuleFromText(pluralSentences('Para consorcios y uniones temporales, la presencia en las ciudades podrá acreditarse con la suma de las sedes de sus integrantes.')).mode, 'se_suma');
  assert.equal(readPluralRuleFromText(pluralSentences('Los consorcios presentarán el documento de constitución.')), null);
  const sinFrase = { ...COMPLEMENTO, extracted_text: COMPLEMENTO.extracted_text.replace(/En cuanto a los consorcios[^.]*\./, '') };
  assert.equal((await readPluralRule({ envelope: ENVELOPE, label: LABEL, documents: [sinFrase], knownCityKeys: KNOWN, environment: {} })).mode, 'no_dice');
  const ENV = { AGT002_WORKBENCH_RUNTIME: 'agt002_workbench_bridge_v1', AGT002_WORKBENCH_DRAIN_ENABLED: 'true', AGT002_WORKBENCH_MODEL: 'm', AGT002_HETZNER_BRIDGE_URL: 'https://p.example.com/run', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48), AGT002_WORKBENCH_AGENT_ID: '33333333-3333-4333-8333-333333333333', AGT002_WORKBENCH_WORKER_ID: 'w' };
  const inventa = { run: async () => ({ content: JSON.stringify({ modo: 'se_suma', cita_textual: 'Se podrá sumar la presencia de todos los integrantes.', document_id: '', numeral: '5.3.2', ciudades_del_requisito: [], explicacion: 'x' }) }) };
  const reading = await readPluralRule({ envelope: ENVELOPE, label: LABEL, documents: [sinFrase], knownCityKeys: KNOWN, environment: ENV, bridgeClient: inventa });
  assert.equal(reading.mode, 'no_dice');
  assert.match(reading.explanation, /no aparece en el texto/);
});

test('ciudades: las que nombran la recomendación y las evidencias del requisito bloqueado', () => {
  assert.deepEqual(citiesNamed(['Armenia y Quibdó', 'Pereira, Manizales'], KNOWN).sort(), ['armenia', 'manizales', 'pereira', 'quibdo']);
  assert.equal(blockingRequirements(ENVELOPE).length, 1);
});

test('la lista avisa «compite en nuestra zona» y nunca propone a Estatal de Seguridad', () => {
  const city = key => ({ city: key.toUpperCase(), city_key: key });
  const companies = [
    { nit: '860517560', name: 'SERVICONFOR', role: 'sin_clasificar', cities: ['pereira', 'manizales', 'armenia', 'quibdo'].map(city), participations: [] },
    { nit: '816004965', name: 'ESTATAL DE SEGURIDAD', role: 'sin_clasificar', cities: ['pereira', 'manizales', 'armenia', 'quibdo'].map(city), participations: [] },
  ];
  const ranked = rankAllyCandidates(companies, { cityKeys: ['pereira', 'manizales', 'armenia', 'quibdo'], ourCities: new Map([['pereira', 'Pereira'], ['manizales', 'Manizales']]) });
  assert.deepEqual(ranked.map(item => item.name), ['SERVICONFOR']);
  assert.equal(ranked[0].zone_warning, 'Tiene oficina en Pereira y Manizales: compite en nuestra zona.');
});

test('la 202 guarda una lectura por análisis; sin ella se calcula igual; la ruta y la pantalla la usan', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role; create table public.psi_sales_opportunities (id uuid primary key);
    insert into psi_sales_opportunities values ('fc613a47-a9b0-4389-a7c8-196b05a7e795');`);
  await pg.exec(read('supabase/migrations/202_lectura_pliego_union_temporal.sql'));
  await pg.exec(`insert into psi_tender_plural_readings (opportunity_id, analysis_run_id, mode) values ('fc613a47-a9b0-4389-a7c8-196b05a7e795', '22f4bec0-0000-4000-8000-000000000000', 'uno_cumple')`);
  await assert.rejects(pg.exec(`insert into psi_tender_plural_readings (opportunity_id, analysis_run_id, mode) values ('fc613a47-a9b0-4389-a7c8-196b05a7e795', '22f4bec0-0000-4000-8000-000000000000', 'uno_cumple')`));
  await assert.rejects(pg.exec(`insert into psi_tender_plural_readings (opportunity_id, analysis_run_id, mode) values ('fc613a47-a9b0-4389-a7c8-196b05a7e795', '22f4bec0-0000-4000-8000-000000000001', 'otro')`));
  await pg.exec(read('supabase/rollbacks/202_lectura_pliego_union_temporal_rollback.sql'));
  await pg.close();
  const without202 = { from: () => { const chain = { select() { return chain; }, eq() { return chain; }, maybeSingle: async () => ({ data: null, error: { code: 'PGRST205' } }), insert: async () => { throw new Error('no debe guardar'); } }; return chain; } };
  const reading = await pluralReadingFor(without202, { opportunityId: 'o', runId: 'r', envelope: ENVELOPE, label: LABEL, documents: [COMPLEMENTO], knownCityKeys: KNOWN, environment: {} });
  assert.equal(reading.mode, 'uno_cumple');
  const server = read('server/index.js');
  assert.match(server, /const reading = await pluralReadingFor\(database/);
  assert.equal(server, read('api/[...path].js'));
  const ui = read('src/tenders/components/TenderAllyCandidates.tsx');
  assert.match(ui, /Lectura del pliego:/);
  assert.match(ui, /basta con que un integrante tenga \$\{cities\}\. No dice si la Entidad acepta sumar/);
  assert.match(server, /reading\.mode === 'uno_cumple' \|\| reading\.mode === 'no_dice'\) && one\) \{/);
  assert.match(server, /\.filter\(candidate => !first\.has\(candidate\.nit\)\)/);
  assert.match(ui, /no es una recomendación de Vig-IA/);
});
