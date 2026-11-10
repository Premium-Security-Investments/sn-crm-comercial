// La semana de licitaciones en Mi día (Juan, 2026-11-10): hitos del cronograma de hoy y los próximos 6 días de todas
// las licitaciones abiertas, sin importar el estado, con hoy destacado.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildTenderSemana, tenderSemanaDia, tenderSemanaTieneHora } from '../verticales/licitaciones/tender-semana.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const processes = [
  { opportunity_id: 'metro', entity: 'METRO DE BOGOTA SA', offer_status: 'pendiente_decision', deadlines: [
    { label: 'Plazo para presentar observaciones al proyecto de Pliego', value: '2026-11-10T23:59:00-05:00', certainty: 'CONFIRMED' },
    { label: 'Plazo para manifestación de Interés', value: '2026-11-20T23:59:00-05:00', certainty: 'CONFIRMED' },
  ] },
  { opportunity_id: 'fiscalia', entity: 'FISCALÍA', offer_status: 'pendiente_decision', deadlines: [
    { label: 'Cierre del proceso', value: '2026-11-12T11:00:00-05:00', certainty: 'CONFIRMED' },
    { label: 'Respuesta a observaciones', value: '2026-11-09T00:00:00-05:00', certainty: 'CONFIRMED' },
  ] },
  { opportunity_id: 'terminal', entity: 'TERMINAL', offer_status: 'presentada', deadlines: [
    { label: 'Observaciones a la evaluación y traslado para subsanar', value: '2026-11-12T17:00:00-05:00', certainty: 'CONFIRMED' },
    { label: 'Observaciones a la evaluación y traslado para subsanar', value: '2026-11-12T17:00:00-05:00', certainty: 'CONFIRMED' },
  ] },
  { opportunity_id: 'sic', entity: 'SIC', offer_status: null, deadlines: [
    { label: 'Observaciones al pliego definitivo', value: '2026-11-13T17:00:00-05:00', certainty: 'PROBABLE' },
    { kind: 'RESPONSES', value: '2026-11-16T00:00:00Z', certainty: 'CONFIRMED' },
  ] },
];

test('solo los próximos 7 días, hoy incluido, en orden; sin duplicados', () => {
  const semana = buildTenderSemana({ processes, today: '2026-11-10' });
  assert.equal(semana.hasta, '2026-11-16');
  assert.deepEqual(semana.items.map(item => [item.day, item.opportunity_id]), [
    ['2026-11-10', 'metro'], ['2026-11-12', 'fiscalia'], ['2026-11-12', 'terminal'], ['2026-11-13', 'sic'], ['2026-11-16', 'sic'],
  ]);
  assert.equal(semana.hoy, 1);
  assert.equal(semana.items.find(item => item.opportunity_id === 'terminal').offer_status, 'presentada', 'las presentadas también entran');
  assert.equal(semana.items.find(item => item.opportunity_id === 'sic' && item.day === '2026-11-13').por_confirmar, true);
  assert.equal(semana.items.find(item => item.day === '2026-11-16').label, 'RESPONSES', 'sin etiqueta, la clase del plazo');
});

test('medianoche es una fecha sin hora y no se corre de día', () => {
  assert.equal(tenderSemanaDia('2026-11-16T00:00:00Z'), '2026-11-16');
  assert.equal(tenderSemanaDia('2026-11-12T00:00:00-05:00'), '2026-11-12');
  assert.equal(tenderSemanaTieneHora('2026-11-16T00:00:00Z'), false);
  assert.equal(tenderSemanaTieneHora('2026-11-12T11:00:00-05:00'), true);
  assert.equal(tenderSemanaDia('2026-11-13T03:30:00Z'), '2026-11-12', 'una hora real se lee en Bogotá');
});

test('lo que tiene hora va primero dentro del día, en orden de hora', () => {
  const semana = buildTenderSemana({ today: '2026-11-12', processes: [
    { opportunity_id: 'a', entity: 'A', deadlines: [{ label: 'sin hora', value: '2026-11-12T00:00:00Z' }, { label: 'tarde', value: '2026-11-12T17:00:00-05:00' }] },
    { opportunity_id: 'b', entity: 'B', deadlines: [{ label: 'mañana', value: '2026-11-12T11:00:00-05:00' }] },
  ] });
  assert.deepEqual(semana.items.map(item => item.label), ['mañana', 'tarde', 'sin hora']);
});

test('la ruta y el aviso: solo con permiso de Licitaciones, primero en Mi día', () => {
  const server = read('server/index.js');
  assert.equal(server, read('api/[...path].js'));
  assert.match(server, /'GET \/api\/tender-semana': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/);
  assert.match(server, /\['cerrada_no_go', 'adjudicada', 'no_adjudicada'\]\.includes\(row\.tender_offer_status\)/);
  assert.match(server, /row\.stage_code !== 'descartado'/);
  const main = read('src/main.tsx');
  assert.match(main, /LICITACIONES_VIEW\) && <TenderMyDaySemana request=\{api\}/);
  assert.ok(main.indexOf('<TenderMyDaySemana') < main.indexOf('<TenderMyDayOverdue'));
  assert.match(read('src/tenders/components/TenderMyDaySemana.tsx'), /is-today/);
});

test('las tres de la Rama Judicial se distinguen con el nombre corto', () => {
  const component = read('src/tenders/components/TenderMyDaySemana.tsx');
  assert.match(component, /Rama Judicial · Seccional \$1/);
  assert.match(component, /Rama Judicial · Dirección Ejecutiva/);
  assert.match(component, /item\.ref && <small className="muted"> \(\{item\.ref\}\)<\/small>/);
});
