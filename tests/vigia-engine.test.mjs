import assert from 'node:assert/strict';
import { VIGIA_CONFIG, prioritizeVigiaOpportunities } from '../vigia-engine.js';

const now = '2026-07-18T12:00:00.000Z';
const base = {
  id: 'opp-1', owner_id: 'owner-1', owner_name: 'Ana', company_name: 'Cliente Uno',
  stage_code: 'prospecto', stage_name: 'Prospecto', stage_order: 1,
  service_type_code: 'seguridad_fisica', service_type_name: 'Seguridad Física', regional_nombre: 'VALLE DEL CAUCA ',
  offer_value: 10_000_000, weighted_pipeline_value: 1_000_000,
  next_action_at: '2026-07-20T12:00:00.000Z', last_interaction_at: '2026-07-17T12:00:00.000Z',
  updated_at: '2026-07-17T12:00:00.000Z', created_at: '2026-06-01T12:00:00.000Z', expected_close_date: '2026-08-10T12:00:00.000Z',
};

assert.equal(VIGIA_CONFIG.version, 'gate0-v1.0');
assert.equal(VIGIA_CONFIG.highValueCop, 75_000_000);

const [critical] = prioritizeVigiaOpportunities([{
  ...base,
  id: 'critical',
  stage_code: 'negociacion',
  stage_name: 'Negociación',
  offer_value: 100_000_000,
  next_action_at: null,
  last_interaction_at: '2026-05-01T12:00:00.000Z',
  expected_close_date: '2026-07-10T12:00:00.000Z',
}], { now });
assert.equal(critical.score, 110);
assert.equal(critical.level, 'alto');
assert.deepEqual(critical.signal_codes, ['missing_next_action', 'stalled_critical', 'critical_stage', 'close_overdue', 'high_value']);
assert.match(critical.explanation, /validación humana/i);
assert.equal(critical.source.id, 'CRM-F1');
assert.equal(critical.evidence.activity_basis, 'last_interaction_at');

const [missingData] = prioritizeVigiaOpportunities([{ ...base, id: 'missing', offer_value: 0, regional_nombre: null, next_action_at: null, last_interaction_at: null }], { now });
assert.equal(missingData.score, 40, 'agenda 25 + valor ausente 10 + regional 5');
assert.equal(missingData.level, 'medio');
assert.equal(missingData.evidence.activity_basis, 'updated_at');
assert.ok(missingData.signal_codes.includes('value_missing'));
assert.ok(missingData.signal_codes.includes('regional_missing'));

const [overdue] = prioritizeVigiaOpportunities([{ ...base, id: 'overdue', next_action_at: '2026-07-17T10:00:00.000Z' }], { now });
assert.equal(overdue.score, 30);
assert.ok(overdue.signal_codes.includes('next_action_overdue'));
assert.ok(!overdue.signal_codes.includes('missing_next_action'));

const terminal = prioritizeVigiaOpportunities([{ ...base, id: 'won', stage_code: 'aprobado', stage_name: 'Aprobado', next_action_at: null }], { now });
assert.deepEqual(terminal, [], 'terminal rows are never prioritized');
const malformed = prioritizeVigiaOpportunities([
  { ...base, id: 'invalid-next', next_action_at: 'not-a-date', last_interaction_at: now, updated_at: now, offer_value: 80_000_000, regional_nombre: 'Nacional' },
  { ...base, id: 'invalid-activity', next_action_at: '2026-08-01T00:00:00Z', last_interaction_at: 'bad-activity', updated_at: now, offer_value: 80_000_000, regional_nombre: 'Nacional' },
  { ...base, id: 'invalid-close', next_action_at: '2026-08-01T00:00:00Z', last_interaction_at: now, updated_at: now, expected_close_date: 'bad-close', offer_value: 80_000_000, regional_nombre: 'Nacional' },
  { ...base, id: 'invalid-updated', next_action_at: '2026-08-01T00:00:00Z', last_interaction_at: null, updated_at: 'bad-updated', created_at: now, expected_close_date: null, offer_value: 80_000_000, regional_nombre: 'Nacional' },
], { now });
assert.equal(malformed.find(row => row.id === 'invalid-next')?.signals.some(signal => signal.code === 'invalid_next_action'), true, 'fecha de próxima acción inválida queda explícita');
assert.equal(malformed.find(row => row.id === 'invalid-next')?.signals.some(signal => signal.code === 'missing_next_action'), false, 'fecha inválida no se presenta como ausente');
assert.equal(malformed.find(row => row.id === 'invalid-activity')?.signals.some(signal => signal.code === 'invalid_activity'), true, 'actividad inválida queda explícita');
assert.equal(malformed.find(row => row.id === 'invalid-close')?.signals.some(signal => signal.code === 'invalid_expected_close'), true, 'cierre inválido queda explícito');
assert.equal(malformed.find(row => row.id === 'invalid-updated')?.source.as_of, now, 'corte por fila nunca expone timestamp inválido');
for (const row of malformed) {
  assert.equal(row.score, 15, `${row.id}: fechas inválidas no crean ni escalan la prioridad de alto valor`);
  assert.equal(row.signals.filter(signal => signal.code.startsWith('invalid_')).every(signal => signal.points === 0), true, `${row.id}: evidencia de fecha inválida no puntúa`);
}

const clean = prioritizeVigiaOpportunities([{ ...base, id: 'clean' }], { now });
assert.deepEqual(clean, [], 'active rows without signals are not presented as priorities');

const sorted = prioritizeVigiaOpportunities([
  { ...base, id: 'low', regional_nombre: null },
  { ...base, id: 'high', next_action_at: null, last_interaction_at: '2026-05-01T12:00:00.000Z' },
], { now });
assert.deepEqual(sorted.map(row => row.id), ['high', 'low']);

// Huso horario: dayStart debe anclarse a America/Bogota, no a UTC ni al huso local del runtime.
// 2026-09-02T23:30:00-05:00 == 2026-09-03T04:30:00Z: son las 11:30pm en Bogotá, sigue siendo "hoy" 2 de sept.
// expected_close_date es una columna `date` (día calendario literal, sin componente horario); estas
// dos filas también verifican que dayStart preserve ese literal en vez de reinterpretarlo como un
// instante UTC y correrlo un día hacia atrás al formatearlo en America/Bogota.
const [bogotaNight] = prioritizeVigiaOpportunities([{
  ...base, id: 'row-bogota-night', expected_close_date: '2026-09-02',
  next_action_at: null, offer_value: 1, regional_nombre: 'Bogotá', updated_at: '2026-09-02T10:00:00Z',
}], { now: '2026-09-02T23:30:00-05:00' });
assert.ok(
  !bogotaNight.signal_codes.includes('close_overdue'),
  'un cierre "hoy" en Bogotá no debe verse como vencido por culpa del reloj UTC',
);

const [bogotaPast] = prioritizeVigiaOpportunities([{
  ...base, id: 'row-bogota-past', expected_close_date: '2026-09-01',
  next_action_at: null, offer_value: 1, regional_nombre: 'Bogotá', updated_at: '2026-09-01T10:00:00Z',
}], { now: '2026-09-02T23:30:00-05:00' });
assert.ok(
  bogotaPast.signal_codes.includes('close_overdue'),
  'un cierre de ayer en Bogotá sigue vencido, el fix no debe volverlo permisivo',
);

console.log('vigia deterministic engine contract passed');
