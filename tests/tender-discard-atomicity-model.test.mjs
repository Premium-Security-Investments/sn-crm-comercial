import { strict as assert } from 'node:assert';

function clone(value) {
  return structuredClone(value);
}

function discardInSingleTransaction(state, { expectedTrackingUpdatedAt, failAt } = {}) {
  const draft = clone(state);
  const tender = draft.tender;
  if (tender && expectedTrackingUpdatedAt !== tender.tracking_updated_at) throw new Error('Seguimiento desactualizado.');
  draft.opportunity.stage_code = 'descartado';
  draft.opportunity.loss_notes = 'Descartada';
  draft.opportunity.next_action_at = null;
  if (failAt === 'opportunity') throw new Error('forced opportunity write failure');
  draft.interactions.push({ interaction_type: 'nota' });
  if (failAt === 'interaction') throw new Error('forced interaction insert failure');
  if (tender) {
    tender.internal_status = 'descartada';
    tender.converted_opportunity_id = null;
    tender.tracking_updated_at = null;
  }
  if (failAt === 'tender') throw new Error('forced tender update failure');
  if (tender) draft.events.push({ event_type: 'discarded' });
  if (failAt === 'event') throw new Error('forced event insert failure');
  return draft;
}

for (const scenario of [
  { expectedTrackingUpdatedAt: 'stale', failAt: undefined },
  { expectedTrackingUpdatedAt: 'current', failAt: 'opportunity' },
  { expectedTrackingUpdatedAt: 'current', failAt: 'interaction' },
  { expectedTrackingUpdatedAt: 'current', failAt: 'tender' },
  { expectedTrackingUpdatedAt: 'current', failAt: 'event' },
]) {
  const state = {
    opportunity: { stage_code: 'calificada', loss_notes: null, next_action_at: '2026-07-20' },
    tender: { internal_status: 'convertida_oportunidad', converted_opportunity_id: 'opportunity-1', tracking_updated_at: 'current' },
    interactions: [],
    events: [],
  };
  const before = clone(state);
  assert.throws(() => discardInSingleTransaction(state, scenario));
  assert.deepEqual(state, before, `failure ${scenario.failAt || 'stale'} must leave all four persisted state groups unchanged`);
}

console.log('tender discard atomicity failure-path model passed');
