import assert from 'node:assert/strict';
import { categoryFromAlertsHash, filtersFromAlertsHash, filterCommercialPriorities, prioritiesHashFromDashboard, priorityContextSummary, priorityHashFiltersAreValid, summarizeCommercialPriorities } from '../src/vigia/priority-filters.js';

const signal = code => ({ code, label: code, points: 1, evidence: code });
const row = (id, overrides = {}) => ({
  id,
  company_name: `Empresa ${id}`,
  owner_id: 'owner-a',
  owner_name: 'Ana',
  regional_nombre: 'Bogotá',
  stage_code: 'prospecto',
  service_type_code: 'vigilancia',
  customer_segment: 'cliente_nuevo',
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
const stalledSustentacion = row('stalled-sustentacion', { stage_code: 'sustentacion', signals: [signal('stalled_warning')] });
const stalledElsewhere = row('stalled-elsewhere', { stage_code: 'negociacion', signals: [signal('stalled_critical')] });
assert.deepEqual(filterCommercialPriorities([stalledSustentacion, stalledElsewhere], { category: 'stalled_sustentacion' }).map(item => item.id), ['stalled-sustentacion']);

const summary = summarizeCommercialPriorities(rows);
assert.deepEqual(summary, { total: 5, risk: 2, missing: 1, overdue: 1, closing: 1, managed: 1, highValueStalled: 0, stalledSustentacion: 0 });

assert.deepEqual(filterCommercialPriorities(rows, { query: 'bruno', owner: 'owner-b', regional: 'Medellín', level: 'alto' }).map(item => item.id), ['risk']);
assert.deepEqual(filterCommercialPriorities(rows, { stage: 'negociacion', service: 'tecnologia' }).map(item => item.id), ['managed']);
assert.deepEqual(filterCommercialPriorities(rows, { customerSegment: 'cliente_nuevo' }).map(item => item.id), rows.map(item => item.id));
assert.deepEqual(filterCommercialPriorities([...rows, row('current-client', { customer_segment: 'cliente_actual' })], { customerSegment: 'cliente_actual' }).map(item => item.id), ['current-client']);
assert.deepEqual(filterCommercialPriorities(rows, { reviewedIds: new Set(['risk', 'managed']) }).map(item => item.id), ['missing', 'overdue', 'closing']);
assert.deepEqual(filterCommercialPriorities(rows, { category: 'unknown' }), [], 'categoría desconocida falla cerrada');
assert.deepEqual(filterCommercialPriorities(null, {}), [], 'entrada inválida devuelve bandeja vacía');

assert.equal(categoryFromAlertsHash('#/alerts?status=managed'), 'managed');
assert.equal(categoryFromAlertsHash('#/alerts?status=risk'), 'risk');
assert.equal(categoryFromAlertsHash('#/alerts?status=missing'), 'missing');
assert.equal(categoryFromAlertsHash('#/alerts?status=overdue'), 'overdue');
assert.equal(categoryFromAlertsHash('#/alerts?status=closing_soon'), 'closing');
assert.equal(categoryFromAlertsHash('#/vig-ia?status=high_value_stalled'), 'high_value_stalled');
assert.equal(categoryFromAlertsHash('#/alerts?status=stalled'), 'stalled_sustentacion');
assert.equal(categoryFromAlertsHash('#/alerts?status=unknown'), '__invalid__');

assert.deepEqual(filtersFromAlertsHash('#/alerts?status=stalled&owner=owner-a&regional=Bogot%C3%A1&stage=sustentacion&service=vigilancia&segment=cliente_actual'), {
  category: 'stalled_sustentacion',
  owner: 'owner-a',
  regional: 'Bogotá',
  stage: 'sustentacion',
  service: 'vigilancia',
  customerSegment: 'cliente_actual',
  invalid: false,
});
assert.equal(filtersFromAlertsHash('#/alerts?segment=desconocido').customerSegment, '__invalid__', 'segmento manipulado falla cerrado');
assert.equal(filtersFromAlertsHash('#/alerts?status=risk&admin=true').category, '__invalid__', 'parámetro desconocido falla cerrado');
assert.equal(filtersFromAlertsHash('#/alerts?owner=owner-a&owner=owner-b').category, '__invalid__', 'parámetro duplicado falla cerrado');
assert.equal(priorityHashFiltersAreValid(rows, filtersFromAlertsHash('#/alerts?owner=owner-b&regional=Medellín&stage=negociacion&service=tecnologia&segment=cliente_nuevo')), true);
assert.equal(priorityHashFiltersAreValid(rows, filtersFromAlertsHash('#/alerts?owner=owner-desconocido')), false, 'valor fuera de opciones visibles falla cerrado');
const regionalAliasRow = row('regional-alias', { regional_nombre: 'Distrito Capital de Bogota.' });
const canonicalRegionalFilters = filtersFromAlertsHash('#/alerts?regional=Bogot%C3%A1');
assert.equal(priorityHashFiltersAreValid([regionalAliasRow], canonicalRegionalFilters), true, 'regional canónica del Dashboard debe validar contra alias CRM equivalente');
assert.deepEqual(filterCommercialPriorities([regionalAliasRow], { regional: 'Bogotá' }).map(item => item.id), ['regional-alias'], 'handoff regional conserva el mismo alcance pese a alias de representación');

assert.equal(
  prioritiesHashFromDashboard('overdue', {
    owner: 'owner/a',
    regional: 'Bogotá',
    stage: 'negociacion',
    service: 'seguridad_fisica',
    segment: 'cliente_actual',
    q: 'dato libre que no cruza',
    period: 'anio_actual',
    active: '1',
  }),
  '#/alerts?status=overdue&owner=owner%2Fa&regional=Bogot%C3%A1&stage=negociacion&service=seguridad_fisica&segment=cliente_actual',
  'el handoff codifica y transporta sólo filtros autorizados',
);
assert.equal(prioritiesHashFromDashboard('missing', { owner: '', regional: '', stage: '', service: '', segment: '' }), '#/alerts?status=missing', 'filtros vacíos se omiten');
const invalidHandoff = prioritiesHashFromDashboard('inventado', { owner: 'owner-a' });
assert.equal(categoryFromAlertsHash(invalidHandoff), '__invalid__', 'status interno desconocido falla cerrado en el parser de destino');
assert.equal(
  priorityContextSummary(filtersFromAlertsHash('#/alerts?status=stalled&owner=owner-a&regional=Bogot%C3%A1&stage=sustentacion&service=vigilancia&segment=cliente_actual'), {
    owner: 'Ana Comercial',
    service: 'Vigilancia',
    segment: 'Cliente actual',
  }),
  'Sustentación estancada · Comercial: Ana Comercial · Región: Bogotá · Etapa: sustentacion · Producto: Vigilancia · Cliente: Cliente actual',
  'el resumen conserva categoría y alcance en formato compacto',
);
assert.equal(priorityContextSummary(filtersFromAlertsHash('#/alerts')), 'Bandeja completa', 'ruta base conserva contexto vacío compatible');
assert.equal(priorityContextSummary(filtersFromAlertsHash('#/alerts?status=desconocido')), 'Contexto inválido', 'contexto manipulado no se presenta como válido');

console.log('Prioridades Comerciales filter contract passed');
