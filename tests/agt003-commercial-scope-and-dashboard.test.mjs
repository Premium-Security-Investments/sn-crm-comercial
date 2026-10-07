import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { isAgt003CommercialOpportunity, isPublicTenderOpportunity, splitByAgentDomain } from '../src/vigia/commercial-scope.js';

// AGT-003 — frontera de dominio con AGT-002 y consistencia del Dashboard comercial (2026-10-07).
// Las licitaciones públicas (AGT-002) deformaban pipeline, forecast, rankings y alertas comerciales; y la misma
// pregunta (regional, cumplimiento, estancadas) tenía respuestas distintas en la misma pantalla.

const entry = new URL('../src/vigia/commercial-dashboard-model.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const model = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('una sola regla decide el agente dueño de cada oportunidad', () => {
  const rows = [
    { id: 'a', service_type_code: 'seguridad_fisica' },
    { id: 'b', service_type_code: 'licitacion_publica' },
    { id: 'c', service_type_code: null },
  ];
  const { commercial, tenders } = splitByAgentDomain(rows);
  assert.deepEqual(commercial.map(row => row.id), ['a', 'c']);
  assert.deepEqual(tenders.map(row => row.id), ['b']);
  assert.equal(isPublicTenderOpportunity(rows[1]), true);
  assert.equal(isAgt003CommercialOpportunity(rows[1]), false);
  assert.equal(isAgt003CommercialOpportunity(null), false);
});

test('la API de prioridades de AGT-003 excluye las licitaciones en ambos servidores', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /attachVigiaCustomerSegments\(viewRows, segmentRows\)\.filter\(isAgt003CommercialOpportunity\)/);
  }
});

test('el Dashboard comercial cuenta sólo el pipeline comercial y resume las licitaciones aparte', () => {
  const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const v2 = src.slice(src.indexOf('function ManagerDashboardV2('), src.indexOf('function ConsultantDetail('));
  assert.match(v2, /splitByAgentDomain\(data\.opportunities\)/);
  assert.doesNotMatch(v2, /data\.opportunities\.filter\(/, 'ningún cálculo del tablero parte del universo mezclado');
  assert.match(v2, /v2-tender-aside/);
  assert.match(v2, /buildMonthlyTrendRows\(commercialData\)/);
});

test('una sola regional por comercial: la de su meta, o la más frecuente normalizada', () => {
  const normalize = value => String(value || '').trim().replace(/\.$/, '').toLowerCase().replace(/^\w/, c => c.toUpperCase());
  const rows = [
    { owner_id: 'jhon', regional_nombre: 'EJE CAFETERO' },
    { owner_id: 'jhon', regional_nombre: 'Eje cafetero.' },
    { owner_id: 'jhon', regional_nombre: 'Risaralda' },
    { owner_id: 'viviana', regional_nombre: 'Caldas' },
  ];
  const map = model.ownerRegionalMap(rows, [{ user_id: 'viviana', regional_nombre: 'Cundinamarca' }, { user_id: 'jhon', regional_nombre: 'todas' }], normalize, row => row.owner_id);
  assert.equal(map.get('jhon'), 'Eje cafetero');
  assert.equal(map.get('viviana'), 'Cundinamarca', 'la meta manda sobre las oportunidades');
  assert.equal(model.regionalOf(map, 'nadie'), 'Regional pendiente');
});

test('sin meta propia no hay porcentaje de cumplimiento', () => {
  assert.equal(model.compliancePct(62, 0), null);
  assert.equal(model.compliancePct(717, 451), 159);
});

test('la salud comercial se explica en una frase y no colapsa a cero por volumen', () => {
  assert.equal(model.commercialHealthScore({ active: 116, managed: 0, compliance: 159 }), 40);
  assert.equal(model.commercialHealthScore({ active: 10, managed: 10, compliance: 77 }), 91);
  assert.equal(model.commercialHealthScore({ active: 4, managed: 2, compliance: null }), 50);
  assert.equal(model.commercialHealthScore({ active: 0, managed: 0, compliance: null }), 100);
});

test('calidad de datos dice cuántas activas no tienen valor, tipo de cliente o regional', () => {
  const quality = model.dataQualitySummary([
    { offer_value: 0, customer_segment: null, regional_nombre: 'Risaralda' },
    { offer_value: 101_000_000, customer_segment: 'cliente_nuevo', regional_nombre: '' },
  ], value => String(value || '').trim());
  assert.equal(quality.missingValue, 1);
  assert.equal(quality.summary, '1 sin valor · 1 sin tipo de cliente · 1 sin regional');
  assert.equal(quality.complete, false);
});

test('ventas por trimestre transcurrido y nombres sin números que no cuadren', () => {
  assert.deepEqual(model.elapsedQuarters(new Date(2026, 9, 7)), [0, 1, 2, 3]);
  assert.deepEqual(model.elapsedQuarters(new Date(2026, 1, 1)), [0]);
  assert.equal(model.namesSummary(['Lina', 'Viviana', 'Katherine']), 'Lina, Viviana, Katherine');
  assert.equal(model.namesSummary(['A', 'B', 'C', 'D', 'E']), 'A, B, C y 2 más');
});
