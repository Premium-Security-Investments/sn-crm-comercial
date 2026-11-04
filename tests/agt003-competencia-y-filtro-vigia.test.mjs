// AGT-003 — aviso del contrato de la competencia en Mi día, y renovación / servicio nuevo en el filtro de Vig-IA
// (Juan, 2026-11-03).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMPETITOR_GRACE_DAYS, COMPETITOR_WINDOW_DAYS, competitorContractsDue } from '../src/vigia/renewal-alerts.js';
import { CUSTOMER_SEGMENT_FILTER_OPTIONS, matchesCustomerSegmentFilter } from '../src/vigia/client-profile.js';
import { filterCommercialPriorities, filtersFromAlertsHash, priorityHashFiltersAreValid } from '../src/vigia/priority-filters.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const NOW = new Date('2026-11-03T15:00:00Z');
const base = { service_type_code: 'seguridad_fisica', customer_segment: 'cliente_nuevo', stage_code: 'prospecto' };
const opp = (name, end, extra = {}) => ({ ...base, id: name, company_name: name, current_contract_end_date: end, ...extra });

test('contrato de la competencia: seis meses hacia adelante, 30 días hacia atrás, con el nombre del proveedor', () => {
  assert.equal(COMPETITOR_WINDOW_DAYS, 180);
  assert.equal(COMPETITOR_GRACE_DAYS, 30);
  const rows = [
    opp('En ventana', '2027-03-01', { current_security_provider: 'Atlas' }),
    opp('Al límite', '2027-05-02'),                                   // 180 días
    opp('Muy lejos', '2027-05-03'),                                   // 181: todavía no
    opp('Recién vencido', '2026-10-10', { current_security_provider: 'Atlas' }),
    opp('Vencido hace rato', '2026-10-01'),                           // 33 días: ya se renovó o se perdió
    opp('Congelado', '2027-01-15', { frozen_until: '2027-01-01' }),   // congelar no detiene el contrato
    opp('Sin proveedor', '2027-01-15', { current_security_provider_none: true }),
    opp('Cliente actual', '2027-01-15', { customer_segment: 'cliente_actual' }),
    opp('Cerrado', '2027-01-15', { stage_code: 'descartado' }),
    opp('Licitación', '2027-01-15', { service_type_code: 'licitacion_publica' }),
    opp('Sin tipo de cliente', '2027-02-01', { customer_segment: null }),
  ];
  const due = competitorContractsDue(rows, NOW);
  assert.deepEqual(due.map(item => item.opportunity.company_name), ['Recién vencido', 'Congelado', 'Sin tipo de cliente', 'En ventana', 'Al límite']);
  assert.equal(due[0].phrase, 'El contrato con Atlas venció el 10/10/2026 (hace 24 días)');
  assert.equal(due[2].phrase, 'El contrato con su proveedor actual vence el 01/02/2027 (en 90 días)');
});

test('el filtro de tipo de cliente es la misma regla en la lista y en Vig-IA', () => {
  assert.deepEqual(CUSTOMER_SEGMENT_FILTER_OPTIONS.map(([code]) => code),
    ['cliente_nuevo', 'cliente_actual', 'cliente_actual:renovacion', 'cliente_actual:servicio_nuevo', 'cliente_actual:sin_clasificar']);
  const renov = { customer_segment: 'cliente_actual', client_deal_type: 'renovacion' };
  const nuevo = { customer_segment: 'cliente_actual', client_deal_type: 'servicio_nuevo' };
  const sin = { customer_segment: 'cliente_actual', client_deal_type: null };
  assert.equal(matchesCustomerSegmentFilter(renov, 'cliente_actual'), true);
  assert.equal(matchesCustomerSegmentFilter(renov, 'cliente_actual:renovacion'), true);
  assert.equal(matchesCustomerSegmentFilter(nuevo, 'cliente_actual:renovacion'), false);
  assert.equal(matchesCustomerSegmentFilter(sin, 'cliente_actual:sin_clasificar'), true);
  assert.equal(matchesCustomerSegmentFilter({ customer_segment: 'cliente_nuevo' }, 'cliente_actual:sin_clasificar'), false);

  const rows = [{ id: 'a', ...renov }, { id: 'b', ...nuevo }, { id: 'c', customer_segment: 'cliente_nuevo' }];
  assert.deepEqual(filterCommercialPriorities(rows, { customerSegment: 'cliente_actual:renovacion' }).map(r => r.id), ['a']);
  const fromHash = filtersFromAlertsHash('#/alerts?segment=cliente_actual:servicio_nuevo');
  assert.equal(fromHash.invalid, false);
  assert.equal(priorityHashFiltersAreValid(rows, fromHash), true);
  assert.equal(filtersFromAlertsHash('#/alerts?segment=cliente_actual:otra').invalid, true);
});

test('Vig-IA cruza el dato con las oportunidades ya cargadas y no toca el contrato del agente', () => {
  const vigia = read('../src/vigia/VigiaCommercial.tsx');
  assert.match(vigia, /const customerSegmentOptions = CUSTOMER_SEGMENT_FILTER_OPTIONS;/);
  assert.match(vigia, /client_deal_type: dealTypeById\?\.get\(row\.id\) \?\? null/);
  assert.match(read('../src/main.tsx'), /dealTypeById=\{new Map\(data\.opportunities\.map\(o => \[o\.id, o\.client_deal_type \?\? null\]\)\)\}/);
  assert.doesNotMatch(read('../verticales/comercial/agt003-priorities-service.js'), /client_deal_type/, 'el contrato de prioridades no cambia');
});
