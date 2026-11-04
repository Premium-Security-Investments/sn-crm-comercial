// AGT-003 — tablero de gerencia: ventas y pipeline por tipo de cliente, y renovaciones por vencer del equipo
// (Juan, 2026-11-03).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dealMix, dealMixKey } from '../src/vigia/deal-mix.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const o = (extra) => ({ service_type_code: 'seguridad_fisica', stage_code: 'prospecto', offer_value: 0, ...extra });

test('cada oportunidad cae en una sola fila', () => {
  assert.equal(dealMixKey({ customer_segment: 'cliente_nuevo', client_deal_type: 'renovacion' }), 'cliente_nuevo');
  assert.equal(dealMixKey({ customer_segment: 'cliente_actual', client_deal_type: 'renovacion' }), 'renovacion');
  assert.equal(dealMixKey({ customer_segment: 'cliente_actual', client_deal_type: 'servicio_nuevo' }), 'servicio_nuevo');
  assert.equal(dealMixKey({ customer_segment: 'cliente_actual' }), 'actual_sin_clasificar');
  assert.equal(dealMixKey({}), 'sin_tipo');
});

test('ventas del año por fecha de aprobación, pipeline de las abiertas; sin licitaciones ni años anteriores', () => {
  const rows = dealMix([
    o({ customer_segment: 'cliente_actual', client_deal_type: 'renovacion', stage_code: 'aprobado', approved_at: '2026-03-10T00:00:00Z', offer_value: 40 }),
    o({ customer_segment: 'cliente_actual', client_deal_type: 'renovacion', stage_code: 'aprobado', approved_at: '2025-12-30T00:00:00Z', offer_value: 99 }),
    o({ customer_segment: 'cliente_actual', client_deal_type: 'renovacion', stage_code: 'envio_oferta', offer_value: 10 }),
    o({ customer_segment: 'cliente_nuevo', stage_code: 'aprobado', approved_at: null, updated_at: '2026-07-01T00:00:00Z', offer_value: 25 }),
    o({ customer_segment: 'cliente_nuevo', stage_code: 'perdido', offer_value: 500 }),
    o({ customer_segment: 'cliente_nuevo', service_type_code: 'licitacion_publica', stage_code: 'prospecto', offer_value: 700 }),
    o({ stage_code: 'prospecto', offer_value: 3 }),
  ], '2026');
  assert.deepEqual(rows.map(r => [r.key, r.sales, r.salesCount, r.pipeline, r.pipelineCount]), [
    ['cliente_nuevo', 25, 1, 0, 0],
    ['renovacion', 40, 1, 10, 1],
    ['sin_tipo', 0, 0, 3, 1],
  ]);
});

test('el tablero muestra el desglose y las renovaciones del equipo', () => {
  const ui = read('../src/main.tsx');
  assert.match(ui, /<summary>Ventas y pipeline por tipo de cliente \{year\}<\/summary>/);
  assert.match(ui, /const dealMixRows = dealMix\(\[\.\.\.allCommercialOpportunities\.filter\(isApprovedSale\), \.\.\.activeRows\], year\);/);
  assert.match(ui, /const teamRenewals = renewalsDue\(allCommercialOpportunities, now\);/);
  assert.match(ui, /<Panel title="Renovaciones por vencer \(90 días\)">/);
});
