// Punto 7 del encargo de Aliados (Juan, 2026-11-11): quiénes se han movido en este proceso, en Decidir. Sólo lectura.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { participationInProcess, processParticipants } from '../verticales/licitaciones/tender-allies.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const MANIZALES = 'aaaaaaaa-0000-4000-8000-000000000001';
const PEREIRA = 'bbbbbbbb-0000-4000-8000-000000000002';
const city = key => ({ city: key.toUpperCase(), city_key: key });

test('con oportunidad cuenta sólo la exacta: «LP-01-2026» es de Manizales y de Pereira', () => {
  const part = { process_ref: 'LP-01-2026', opportunity_id: MANIZALES };
  assert.equal(participationInProcess(part, { opportunityId: MANIZALES, tenderRef: 'LP-01-2026' }), true);
  assert.equal(participationInProcess(part, { opportunityId: PEREIRA, tenderRef: 'LP-01-2026' }), false);
  assert.equal(participationInProcess({ process_ref: 'SIC 23 DE 2026', opportunity_id: null }, { opportunityId: 'x', tenderRef: 'SIC 23 DE 2026' }), true);
  assert.equal(participationInProcess({ process_ref: 'SA-24-2026', opportunity_id: null }, { opportunityId: 'x', tenderRef: 'CE-28-2026 / SA-24-2026' }), true);
  assert.equal(participationInProcess({ process_ref: 'TT-SPO-07-2026', opportunity_id: null }, { opportunityId: 'x', tenderRef: 'SIC 23 DE 2026' }), false);
});

test('agrupa por lo que hicieron, con otros procesos, marca y oficina en nuestra zona', () => {
  const companies = [
    { nit: '900000001', name: 'CAMALEÓN', role: 'competidor', cities: ['manizales', 'cali'].map(city), participations: [
      { process_ref: 'LP-01-2026', opportunity_id: MANIZALES, kind: 'observo_proyecto', detail: 'Pidió bajar el capital de trabajo; no lo aceptaron.' },
      { process_ref: 'SIC 23 DE 2026', opportunity_id: null, kind: 'observo_proyecto' },
      { process_ref: 'TT-SPO-07-2026', opportunity_id: null, kind: 'oferto' },
    ] },
    { nit: '900000002', name: 'EXPERTOS', role: 'sin_clasificar', cities: ['pereira', 'manizales'].map(city), participations: [
      { process_ref: 'CE-28-2026 / SA-24-2026', opportunity_id: null, kind: 'contratista_actual', detail: 'Año 2026.' },
    ] },
    { nit: '900000003', name: 'OTRA', role: 'aliado', cities: [], participations: [{ process_ref: 'LP-01-2026', opportunity_id: PEREIRA, kind: 'observo_proyecto' }] },
  ];
  const groups = processParticipants({ companies, withoutNit: [{ company_label: 'UT VIGILANCIA 2026', process_ref: 'LP-01-2026', opportunity_id: MANIZALES, kind: 'oferto' }],
    opportunityId: MANIZALES, tenderRef: 'LP-01-2026', zoneCities: new Map([['pereira', 'Pereira'], ['manizales', 'Manizales']]) });
  assert.deepEqual(groups.map(group => [group.key, group.items.map(item => item.name)]), [['observo_proyecto', ['CAMALEÓN']], ['oferto', ['UT VIGILANCIA 2026']]]);
  const camaleon = groups[0].items[0];
  assert.equal(camaleon.other_processes, 2);
  assert.deepEqual(camaleon.zone_cities, ['Manizales']);
  assert.equal(camaleon.detail, 'Pidió bajar el capital de trabajo; no lo aceptaron.');
  const manizalesSa = processParticipants({ companies, opportunityId: 'z', tenderRef: 'SA-24-2026', zoneCities: new Map([['pereira', 'Pereira']]) });
  assert.deepEqual(manizalesSa.map(group => group.key), ['contratista']);
  assert.deepEqual(manizalesSa[0].items[0].zone_cities, ['Pereira']);
});

test('ruta de sólo lectura con permiso de ver, y el bloque plegado en Decidir', () => {
  const server = read('server/index.js');
  assert.match(server, /'GET \/api\/tender-allies\/process-participants': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/);
  assert.equal(server, read('api/[...path].js'));
  assert.match(read('src/main.tsx'), /<TenderProcessParticipants opportunityId=\{o\.id\} request=\{api\}/);
  assert.match(read('src/tenders/components/TenderProcessParticipants.tsx'), /<summary>Quiénes se han movido en este proceso \(\{total\}\)<\/summary>/);
  assert.match(read('verticales/licitaciones/tender-allies.js'), /'id,nit,company_label,entity,process_ref,opportunity_id,kind/);
});

// Punto 3 (2026-11-11): el orden sale de la relación y de si compitió contra nosotros; el tamaño se muestra, no ordena.
test('orden: aliados primero, luego quienes no compitieron contra nosotros; el tamaño es un dato', async () => {
  const { rankAllyCandidates } = await import('../verticales/licitaciones/tender-allies.js');
  const four = ['pereira', 'manizales', 'armenia', 'quibdo'].map(city);
  const many = Array.from({ length: 51 }, (_, index) => city(`ciudad${index}`));
  const companies = [
    { nit: '800010866', name: 'EXPERTOS', role: 'sin_clasificar', cities: four, participations: [{ process_ref: 'SIC 23 DE 2026', opportunity_id: null }, { process_ref: 'LP-01-2026', opportunity_id: MANIZALES }] },
    { nit: '860011268', name: 'AMCOVIT', role: 'sin_clasificar', cities: [...four, ...many], participations: [] },
    { nit: '860523408', name: 'NAPOLES', role: 'aliado_potencial', cities: four, participations: [{ process_ref: 'SIC 23 DE 2026', opportunity_id: null }] },
    { nit: '891502104', name: 'COVISUR', role: 'competidor', cities: four, participations: [] },
  ];
  const ranked = rankAllyCandidates(companies, { cityKeys: ['pereira', 'manizales', 'armenia', 'quibdo'], ourProcessRefs: new Set(['SIC23DE2026']) });
  assert.deepEqual(ranked.map(item => item.name), ['NAPOLES', 'AMCOVIT', 'EXPERTOS', 'COVISUR']);
  assert.equal(ranked.find(item => item.name === 'EXPERTOS').competed_against_us, 2);
  assert.match(ranked.find(item => item.name === 'AMCOVIT').size_note, /^Grande: 55 ciudades con oficina; querrá liderar la unión\.$/);
  assert.equal(ranked.find(item => item.name === 'NAPOLES').competed_against_us, 1);
});
