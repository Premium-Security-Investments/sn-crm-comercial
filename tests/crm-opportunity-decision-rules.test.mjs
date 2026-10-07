import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOutOfActivePipeline, isPendingDecision, normalizeDecisionRequest, pendingDecisions } from '../src/vigia/opportunity-decision-rules.js';
import { getVisibleNavGroups, preferredLandingRoute } from '../src/navPermissions.ts';

// CRM comercial — regla única de "pendiente de decisión" (2026-10-07) y su uso en servidor y pantallas.
const NOW = new Date('2026-10-07T15:00:00Z'); // 10:00 a. m. en Bogotá
const base = { service_type_code: 'seguridad_fisica', stage_code: 'prospecto' };

test('pendiente: sin agenda, o gestión de un día anterior en Bogotá', () => {
  assert.equal(isPendingDecision({ ...base, next_action_at: null }, NOW), true);
  assert.equal(isPendingDecision({ ...base, next_action_at: '2026-10-06T23:00:00Z' }, NOW), true, '6-oct 18:00 en Bogotá ya pasó');
  assert.equal(isPendingDecision({ ...base, next_action_at: '2026-10-07T13:00:00Z' }, NOW), false, 'la de hoy todavía está vigente');
  assert.equal(isPendingDecision({ ...base, next_action_at: '2026-10-20T14:00:00Z' }, NOW), false);
});

test('no pendiente: cerradas, licitaciones, congeladas vigentes y eliminación pedida', () => {
  assert.equal(isPendingDecision({ ...base, stage_code: 'perdido' }, NOW), false);
  assert.equal(isPendingDecision({ ...base, service_type_code: 'licitacion_publica' }, NOW), false);
  assert.equal(isPendingDecision({ ...base, frozen_until: '2026-11-06' }, NOW), false);
  assert.equal(isPendingDecision({ ...base, frozen_until: '2026-10-07' }, NOW), false, 'vence hoy: todavía congelada');
  assert.equal(isPendingDecision({ ...base, frozen_until: '2026-10-06', next_action_at: '2026-10-06T13:00:00Z' }, NOW), true, 'al vencer vuelve a pedir decisión');
  assert.equal(isPendingDecision({ ...base, delete_requested_at: '2026-10-07T12:00:00Z' }, NOW), false);
  assert.equal(isOutOfActivePipeline({ ...base, frozen_until: '2026-11-06' }, NOW), true);
  assert.equal(pendingDecisions([{ ...base }, { ...base, stage_code: 'aprobado' }], NOW).length, 1);
});

test('la decisión que llega por HTTP se valida con esquema cerrado', () => {
  assert.throws(() => normalizeDecisionRequest({ decision: 'borrar', notes: 'hola mundo' }), /no reconocida/);
  assert.throws(() => normalizeDecisionRequest({ decision: 'continue', notes: 'ok' }), /qué pasó/);
  assert.throws(() => normalizeDecisionRequest({ decision: 'continue', notes: 'Llamé al cliente' }), /próxima gestión/);
  assert.throws(() => normalizeDecisionRequest({ decision: 'freeze', notes: 'Sin presupuesto', freeze_days: 45 }), /30, 60 o 90/);
  assert.throws(() => normalizeDecisionRequest({ decision: 'discard', notes: 'No aplica aquí' }), /motivo/);
  const params = normalizeDecisionRequest({ decision: 'continue', notes: ' Llamé al cliente ', next_action_at: '2026-10-14T14:00:00Z', offer_value: '80000000', interaction_type: 'llamada', owner_id: 'otro' });
  assert.deepEqual(params, {
    p_decision: 'continue', p_notes: 'Llamé al cliente', p_interaction_type: 'llamada', p_next_action_at: '2026-10-14T14:00:00.000Z',
    p_stage_code: null, p_offer_value: 80_000_000, p_freeze_days: null, p_loss_reason_code: null,
  });
});

test('el servidor bloquea crear oportunidades comerciales con pendientes y expone las rutas de decisión', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /if \(currentProfile\.role === 'comercial' && !isPublicTender\) await requireNoPendingDecisions\(database, currentProfile\.id\);/);
    assert.match(src, /return pendingDecisions\(rows \|\| \[\], new Date\(\)\)\.length;/, 'el servidor usa la misma regla que las pantallas');
    assert.match(src, /app\.post\('\/api\/opportunity-decision'/);
    assert.match(src, /hasPermission\(currentProfile, DELETE_PERMISSION\)/, 'sólo quien tiene el permiso confirma eliminaciones');
    assert.match(src, /if \(opportunity\.deleted_at\) \{ const error = new Error\('Oportunidad no encontrada\.'\); error\.status = 404;/);
  }
});

test('el comercial ve Mi día como inicio; los directivos no lo ven en el menú', () => {
  const comercial = { id: 'c', active: true, role: 'comercial', permissions: ['modulo_oportunidades', 'modulo_alertas_comerciales'] };
  const gerencia = { id: 'g', active: true, role: 'gerencia', permissions: ['modulo_dashboard_comercial', 'modulo_oportunidades'] };
  assert.equal(preferredLandingRoute(comercial), 'home');
  const comercialItems = getVisibleNavGroups(comercial).flatMap(group => group.items.map(item => item.label));
  assert.equal(comercialItems[0], 'Mi día');
  const gerenciaItems = getVisibleNavGroups(gerencia).flatMap(group => group.items.map(item => item.label));
  assert.ok(!gerenciaItems.includes('Mi día'));
  assert.notEqual(preferredLandingRoute(gerencia), 'home');
});
