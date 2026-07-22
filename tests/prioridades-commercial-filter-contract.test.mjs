import assert from 'node:assert/strict';
import { categoryFromAlertsHash, filterCommercialPriorities, summarizeCommercialPriorities } from '../src/vigia/priority-filters.js';

const signal = code => ({ code, label: code, points: 1, evidence: code });
const row = (id, overrides = {}) => ({
  id,
  company_name: `Empresa ${id}`,
  owner_id: 'owner-a',
  owner_name: 'Ana',
  regional_nombre: 'Bogotá',
  stage_code: 'prospecto',
  service_type_code: 'vigilancia',
  level: 'medio',
  signals: [],
  evidence: { next_action_at: null },
  ...overrides,
});

const rows = [
  row('risk', { level: 'alto', owner_id: 'owner-b', owner_name: 'Bruno', regional_nombre: 'Medellín', signals: [signal('stalled_critical')] }),
  row('missing', { signals: [signal('missing_next_action')] }),
  row('overdue', { level: 'alto', signals: [signal('next_action_overdue')], evidence: { next_action_at: '2026-07-01T00:00:00Z' } }),
  row('managed', { level: 'bajo', stage_code: 'negociacion', service_type_code: 'tecnologia', evidence: { next_action_at: '2026-07-30T00:00:00Z' } }),
  row('closing', { signals: [signal('close_soon')] }),
];

assert.deepEqual(filterCommercialPriorities(rows, { category: 'missing' }).map(item => item.id), ['missing']);
assert.deepEqual(filterCommercialPriorities(rows, { category: 'overdue' }).map(item => item.id), ['overdue']);
assert.deepEqual(filterCommercialPriorities(rows, { category: 'managed' }).map(item => item.id), ['managed']);
assert.deepEqual(filterCommercialPriorities(rows, { category: 'closing' }).map(item => item.id), ['closing']);
assert.deepEqual(filterCommercialPriorities(rows, { category: 'risk' }).map(item => item.id), ['risk', 'overdue']);
const highValueStalled = row('high-value-stalled', { signals: [signal('high_value'), signal('stalled_warning')] });
assert.deepEqual(filterCommercialPriorities([highValueStalled, ...rows], { category: 'high_value_stalled' }).map(item => item.id), ['high-value-stalled']);

const summary = summarizeCommercialPriorities(rows);
assert.deepEqual(summary, { total: 5, risk: 2, missing: 1, overdue: 1, closing: 1, managed: 1, highValueStalled: 0 });

assert.deepEqual(filterCommercialPriorities(rows, { query: 'bruno', owner: 'owner-b', regional: 'Medellín', level: 'alto' }).map(item => item.id), ['risk']);
assert.deepEqual(filterCommercialPriorities(rows, { stage: 'negociacion', service: 'tecnologia' }).map(item => item.id), ['managed']);
assert.deepEqual(filterCommercialPriorities(rows, { reviewedIds: new Set(['risk', 'managed']) }).map(item => item.id), ['missing', 'overdue', 'closing']);
assert.deepEqual(filterCommercialPriorities(rows, { category: 'unknown' }), [], 'categoría desconocida falla cerrada');
assert.deepEqual(filterCommercialPriorities(null, {}), [], 'entrada inválida devuelve bandeja vacía');

assert.equal(categoryFromAlertsHash('#/alerts?status=managed'), 'managed');
assert.equal(categoryFromAlertsHash('#/alerts?status=risk'), 'risk');
assert.equal(categoryFromAlertsHash('#/alerts?status=missing'), 'missing');
assert.equal(categoryFromAlertsHash('#/alerts?status=overdue'), 'overdue');
assert.equal(categoryFromAlertsHash('#/alerts?status=closing_soon'), 'closing');
assert.equal(categoryFromAlertsHash('#/vig-ia?status=high_value_stalled'), 'high_value_stalled');
assert.equal(categoryFromAlertsHash('#/alerts?status=unknown'), '');

console.log('Prioridades Comerciales filter contract passed');
