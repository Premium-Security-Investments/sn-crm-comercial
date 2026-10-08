import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAuthorizedLicitacionesAnalysisActor } from '../agt002-incremental-authority.js';

const profile = Object.freeze({
  id: 'profile-1', identity_type: 'human', active: true, role: 'admin',
  permissions: ['licitaciones', 'licitaciones_custodia'], areas: [],
});

test('requires an active human, opportunity access and current AI_ANALYSIS_RUN custody', async () => {
  let accessChecked = false;
  const opportunity = await requireAuthorizedLicitacionesAnalysisActor({
    database: {}, opportunityId: 'opportunity-1', profile,
    ensureOpportunityAccess: async (_database, opportunityId, actor) => {
      accessChecked = opportunityId === 'opportunity-1' && actor === profile;
      return { id: opportunityId };
    },
  });
  assert.equal(accessChecked, true);
  assert.deepEqual(opportunity, { id: 'opportunity-1' });
});

for (const [label, rejected] of [
  ['agent', { ...profile, identity_type: 'agent' }],
  ['inactive', { ...profile, active: false }],
  ['without custody', { ...profile, permissions: ['licitaciones'] }],
]) {
  test(`rejects ${label} before an incremental signal can be admitted`, async () => {
    await assert.rejects(() => requireAuthorizedLicitacionesAnalysisActor({
      database: {}, opportunityId: 'opportunity-1', profile: rejected,
      ensureOpportunityAccess: async () => ({ id: 'opportunity-1' }),
    }), error => error.code === 'AGT002_INCREMENTAL_ACTOR_UNAUTHORIZED');
  });
}

test('does not turn an access failure into an analysis authorization', async () => {
  await assert.rejects(() => requireAuthorizedLicitacionesAnalysisActor({
    database: {}, opportunityId: 'opportunity-1', profile,
    ensureOpportunityAccess: async () => { const error = new Error('denied'); error.status = 403; throw error; },
  }), /denied/);
});
