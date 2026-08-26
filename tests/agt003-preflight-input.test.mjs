import assert from 'node:assert/strict';
import { buildAgt003CopilotPreflightRequest } from '../agt003-preflight-input.js';
import { buildAgt003Facts, buildAgt003Interactions } from '../agt003-copilot-input.js';

const opportunity = {
  id: 'opp preflight/001',
  title: 'Seguimiento de seguridad',
  company_name: 'Cliente Sintético',
  stage: 'Negociación',
  service: 'Seguridad electrónica',
  owner_name: 'Comercial Sintético',
  offer_value: '3500000000',
  next_action: 'Llamar a ana@example.com al +57 300 123 4567',
  observations: 'token=secret-value',
};

const interactions = [
  {
    id: 'int/older',
    interaction_type: 'call',
    occurred_at: '2030-01-01T09:00:00.000Z',
    summary: 'Llamada con ana@example.com.',
  },
  {
    id: 'int newer',
    interaction_type: 'meeting',
    occurred_at: '2030-01-02T09:00:00.000Z',
    summary: 'Pidieron aclarar términos. api_key=abc123',
  },
];

const now = () => new Date('2030-01-03T12:00:00.000Z');
const request = buildAgt003CopilotPreflightRequest({
  opportunity,
  interactions,
  correlationId: 'corr-preflight-001',
  snapshotId: 'snapshot-preflight-001',
  now,
});

assert.equal(request.contract_version, 'agt003-preflight-v1');
assert.equal(request.capability_id, 'agt003.opportunity-preflight.preview');
assert.equal(Object.hasOwn(request, 'approved_assets'), false);
assert.deepEqual(request.authority, {
  read_only: true,
  human_review_required: true,
  external_send_allowed: false,
  crm_write_allowed: false,
  public_research_allowed: false,
});
assert.deepEqual(request.opportunity.facts, buildAgt003Facts(opportunity, '2030-01-03'));
assert.deepEqual(request.interactions, buildAgt003Interactions(interactions));
assert.equal(request.interactions[0].evidence_id, 'evidence:interaction:int-newer');
assert.equal(request.opportunity.facts.find(fact => fact.field === 'offer_currency').value, 'COP');
assert.doesNotMatch(JSON.stringify(request), /ana@example\.com|secret-value|abc123|300 123 4567/);
assert.ok(Object.isFrozen(request));
assert.ok(Object.isFrozen(request.opportunity));
assert.ok(Object.isFrozen(request.opportunity.facts));
assert.ok(Object.isFrozen(request.interactions));

const expectedKeys = ['contract_version', 'capability_id', 'correlation_id', 'snapshot_id', 'opportunity', 'interactions', 'authority'];
assert.deepEqual(Object.keys(request), expectedKeys, 'the preflight request is closed and excludes generation-only assets');

assert.throws(
  () => buildAgt003CopilotPreflightRequest({ opportunity: null, interactions: [], correlationId: 'c', snapshotId: 's' }),
  /oportunidad/i,
);
assert.throws(
  () => buildAgt003CopilotPreflightRequest({ opportunity, interactions: {}, correlationId: 'c', snapshotId: 's' }),
  /interactions/i,
);
assert.throws(
  () => buildAgt003CopilotPreflightRequest({ opportunity, interactions: [], correlationId: '', snapshotId: 's' }),
  /correlation/i,
);
assert.throws(
  () => buildAgt003CopilotPreflightRequest({ opportunity, interactions: [], correlationId: 'c', snapshotId: '' }),
  /snapshot/i,
);

console.log('AGT-003 preflight bounded input passed');
