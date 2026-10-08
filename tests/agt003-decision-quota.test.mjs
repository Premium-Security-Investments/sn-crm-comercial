import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionQuota, bogotaDayStartIso, DAILY_DECISION_QUOTA } from '../src/vigia/opportunity-decision-rules.js';

test('cuota diaria de decisiones (Juan, 2026-10-08)', () => {
  assert.equal(DAILY_DECISION_QUOTA, 10);
  assert.deepEqual(decisionQuota(0, 0), { pending: 0, required: 0, done: 0, remaining: 0, blocked: false }, 'al día: libre');
  assert.deepEqual(decisionQuota(50, 0), { pending: 50, required: 10, done: 0, remaining: 10, blocked: true }, '50 atrasadas: debe decidir 10');
  assert.deepEqual(decisionQuota(46, 4), { pending: 46, required: 10, done: 4, remaining: 6, blocked: true }, 'lleva 4 de 10');
  assert.equal(decisionQuota(40, 10).blocked, false, 'decidió 10 hoy: libre aunque queden 40');
  assert.equal(decisionQuota(3, 0).required, 3, 'con menos de 10 pendientes debe decidirlas todas');
  assert.equal(decisionQuota(1, 2).blocked, true, '3 pendientes al empezar, decidió 2: falta 1');
  assert.equal(decisionQuota(0, 2).blocked, false);
});

test('inicio del día de Bogotá', () => {
  assert.equal(bogotaDayStartIso(new Date('2026-10-08T03:00:00Z')), '2026-10-07T05:00:00.000Z', '10 p. m. del 7 en Bogotá');
  assert.equal(bogotaDayStartIso(new Date('2026-10-08T15:00:00Z')), '2026-10-08T05:00:00.000Z');
});
