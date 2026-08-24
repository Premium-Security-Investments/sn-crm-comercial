import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERACTION_TYPE_LABELS, capitalizeVisibleLabel, followUpInteractionTypeLabel,
  normalizeFollowUpText, isObservationCapturedInNotes, buildMigratedObservationEvent, buildFollowUpHistory,
} from '../src/opportunity-followup-presentation.js';

test('labels are frozen and cover the seven internal values', () => {
  assert.equal(Object.isFrozen(INTERACTION_TYPE_LABELS), true);
  assert.deepEqual(Object.keys(INTERACTION_TYPE_LABELS), ['llamada','correo','reunion','whatsapp','nota','cambio_estado','documento']);
  assert.equal(INTERACTION_TYPE_LABELS.cambio_estado, 'Cambio de estado');
});

test('capitalize only touches the first character', () => {
  assert.equal(capitalizeVisibleLabel('llamada urgente'), 'Llamada urgente');
  for (const empty of ['', null, undefined]) assert.equal(capitalizeVisibleLabel(empty), '');
});

test('type label falls back without inheriting prototype members', () => {
  for (const [input, expected] of [['reunion', 'Reunión'], ['visita_tecnica', 'Visita_tecnica'], ['constructor', 'Constructor'], ['toString', 'ToString'], [null, '']]) {
    assert.equal(followUpInteractionTypeLabel(input), expected);
  }
});

test('normalization only serves comparison', () => {
  assert.equal(normalizeFollowUpText('  Cliente\n  pidió   PROPUESTA '), 'cliente pidió propuesta');
  assert.equal(normalizeFollowUpText(null), '');
});

test('observation coverage uses containment, not equality', () => {
  const notes = [{ id: 'a', interaction_type: 'nota', notes: 'Reunión inicial. Cliente pidió propuesta antes del viernes.' }];
  assert.equal(isObservationCapturedInNotes('cliente pidió propuesta', notes), true);
  assert.equal(isObservationCapturedInNotes('Cliente pidió visita técnica', notes), false);
  for (const [obs, list] of [['   ', notes], ['algo', []], ['algo', null]]) assert.equal(isObservationCapturedInNotes(obs, list), false);
});

test('migrated event keeps the original text and dates', () => {
  for (const empty of [null, { observaciones: '   ' }]) assert.equal(buildMigratedObservationEvent(empty), null);
  const event = buildMigratedObservationEvent({ observaciones: '  Pendiente   visita\ntécnica  ', quote_date: '2026-03-01T10:00:00.000Z', created_at: '2026-01-01T10:00:00.000Z' });
  assert.equal(event.id, 'observacion-migrada');
  assert.equal(event.interaction_type, 'nota');
  assert.equal(event.notes, '  Pendiente   visita\ntécnica  ');
  assert.equal(event.occurred_at, '2026-03-01T10:00:00.000Z');
  assert.equal(event.created_at, '2026-03-01T10:00:00.000Z');
  assert.equal(event.actor_label, 'Migrado / sistema');
  assert.equal(event.psi_sales_profiles, null);
});

test('history hides documents, interleaves the migrated note and never mutates', () => {
  const interactions = [
    { id: 'i2', interaction_type: 'llamada', notes: 'Llamada de cierre', occurred_at: '2026-05-10T10:00:00.000Z', created_at: '2026-05-10T10:00:00.000Z' },
    { id: 'i1', interaction_type: 'documento', notes: '{"kind":"tender"}', occurred_at: '2026-04-10T10:00:00.000Z', created_at: '2026-04-10T10:00:00.000Z' },
    { id: 'i0', interaction_type: 'correo', notes: 'Correo inicial', occurred_at: '2026-01-10T10:00:00.000Z', created_at: '2026-01-10T10:00:00.000Z' },
  ];
  const snapshot = JSON.stringify(interactions);
  const history = buildFollowUpHistory({ observaciones: 'Migrada desde Excel', quote_date: '2026-03-01T10:00:00.000Z', created_at: '2026-01-01T10:00:00.000Z' }, interactions);
  assert.deepEqual(history.map(i => i.id), ['i2', 'observacion-migrada', 'i0']);
  assert.equal(JSON.stringify(interactions), snapshot);
  assert.equal(history.some(i => i.interaction_type === 'documento'), false);
});

test('history drops the migrated note when a visible note already covers it', () => {
  const history = buildFollowUpHistory(
    { observaciones: 'Cliente pidió propuesta' },
    [{ id: 'i1', interaction_type: 'nota', notes: 'Cliente pidió propuesta antes del viernes', occurred_at: '2026-05-10T10:00:00.000Z', created_at: '2026-05-10T10:00:00.000Z' }],
  );
  assert.deepEqual(history.map(i => i.id), ['i1']);
});

test('history tolerates empty and unparseable inputs', () => {
  assert.deepEqual(buildFollowUpHistory(null, null), []);
  assert.deepEqual(buildFollowUpHistory({ observaciones: '' }, []), []);
  const history = buildFollowUpHistory({ observaciones: 'Sólo observación' }, [{ id: 'x', interaction_type: 'nota', notes: 'Nota sin fecha', occurred_at: null, created_at: null }]);
  assert.deepEqual(history.map(i => i.id), ['x', 'observacion-migrada']);
});
