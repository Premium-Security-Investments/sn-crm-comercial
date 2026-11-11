// Punto 5 del encargo de Aliados (2026-11-11): la Mesa recibe la lista de «Posibles socios» con su regla, y la
// competencia del proceso, para explicar por qué sale cada socio. En Fiscalía Vig-IA respondió que no tenía «la lista de
// aliados del CRM ni su regla de filtrado».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolverAliadosCandidatos, resolverCompetenciaDelProceso } from '../catalogo-fuentes.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('sin pregunta de socios o competencia no se lee nada', async () => {
  const database = { from: () => { throw new Error('no debe consultar'); } };
  assert.equal((await resolverAliadosCandidatos(database, { tenderId: 't', pregunta: '¿Qué nos falta para la garantía?' })).valor, null);
  assert.equal((await resolverCompetenciaDelProceso(database, { tenderId: 't', pregunta: '¿Qué nos falta para la garantía?' })).valor, null);
  assert.equal((await resolverAliadosCandidatos(database, { tenderId: '', pregunta: 'socios' })).valor, null);
});

test('la competencia del proceso llega agrupada, con lo registrado en Aliados', async () => {
  const OPP = 'fc613a47-a9b0-4389-a7c8-196b05a7e795';
  const tables = {
    psi_public_tenders: { data: { converted_opportunity_id: OPP, ref: 'FGN-REC-IPSE-0058-2026' } },
    psi_vigilance_companies: { data: [{ nit: '860526603', name: 'SEPECOL', role: 'sin_clasificar' }] },
    psi_vigilance_company_offices: { data: [{ nit: '860526603', city: 'MANIZALES', city_key: 'manizales' }] },
    psi_vigilance_participations: { data: [{ id: 'p1', nit: '860526603', process_ref: 'FGN-REC-IPSE-0058-2026', opportunity_id: null, kind: 'observo_definitivo', detail: 'Pidió aclarar el 5.3.2.' }] },
    psi_company_sites: { data: [{ city: 'Manizales', supervigilancia_authorization: 'Resolución vigente' }] },
    psi_tender_plural_readings: { data: null },
  };
  const database = { from: table => { const chain = { select() { return chain; }, eq() { return chain; }, not() { return chain; }, order() { return chain; }, limit() { return chain; },
    maybeSingle: async () => tables[table], range: async () => tables[table], then: resolve => Promise.resolve(tables[table]).then(resolve) }; return chain; } };
  const fuente = await resolverCompetenciaDelProceso(database, { tenderId: 't', pregunta: '¿Quiénes observaron el pliego?' });
  assert.equal(fuente.estado, 'vigente');
  assert.deepEqual(fuente.valor.map(group => group.grupo), ['Observaron el pliego definitivo']);
  assert.equal(fuente.valor[0].empresas[0].detalle, 'Pidió aclarar el 5.3.2.');
  assert.deepEqual(fuente.valor[0].empresas[0].oficina_en_nuestra_zona, ['Manizales']);
});

test('Decidir y la Mesa usan la misma lista; la Mesa tiene la regla para explicarla', () => {
  const server = read('server/index.js');
  assert.match(server, /res\.json\(await buildAllyBoard\(database/);
  assert.match(read('catalogo-fuentes.js'), /const board = await buildAllyBoard\(database/);
  assert.match(read('verticales/licitaciones/agt002-workbench-responder.js'), /aliados\.candidatos, es la lista de «Posibles socios»/);
  assert.match(read('verticales/licitaciones/tender-allies-board.js'), /no una recomendación de Vig-IA/);
});
