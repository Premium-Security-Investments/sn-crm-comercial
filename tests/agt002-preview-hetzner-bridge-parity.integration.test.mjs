import assert from 'node:assert/strict';
import { startSyntheticAgt002HetznerBridge } from './fixtures/agt002-hetzner-bridge-synthetic-server.mjs';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';
import { createAgt002PreviewEngine, AGT002_PREVIEW_POLICY } from '../agt002-preview-engine.js';

const SECRET = 'a'.repeat(32);

function syntheticSuccessCodexClient(modelOutput) {
  // Mirrors the real codex client's effort acknowledgement contract: the engine always pins a
  // real `effort`, and the bridge client now requires this exact echo before accepting output.
  return { run: async ({ effort } = {}) => ({ content: JSON.stringify(modelOutput), usage: { input_tokens: 12, output_tokens: 34 }, rate_limit: null, effort_ack: effort ?? null }) };
}

async function testEngineProducesValidEnvelopeThroughSyntheticBridge() {
  const modelOutput = {
    recommendation: 'advance', summary: 'Resumen sintético.', strengths: [], weaknesses: [], blockers: [], questions: [], unverified: [],
    next_action: 'Continuar revisión humana.', human_review_required: true,
  };
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient: syntheticSuccessCodexClient(modelOutput) });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    const engine = createAgt002PreviewEngine({
      client, model: 'gpt-x', policyVersion: 'agt002-preview-policy-v1', policyText: AGT002_PREVIEW_POLICY,
      timeoutMs: 5000, maxConcurrent: 1, dailyMaxRuns: 5, countDailyRuns: async () => 0,
    });
    const envelope = await engine.analyze({
      opportunity: { id: '11111111-1111-1111-1111-111111111111' },
      documents: [{ document_id: '22222222-2222-2222-2222-222222222222', name: 'doc.pdf', document_type: 'legal', content: 'texto', content_sha256: 'a'.repeat(64), current: true }],
      companyProfile: { profile_version: 'v1', fields: [] },
      deepAnalysis: {},
      snapshotId: '33333333-3333-4333-8333-333333333333',
    }, { idempotencyKey: 'idem-parity-1' });
    assert.equal(envelope.agent_id, 'AGT-002');
    assert.equal(envelope.schema_version, '2.0-preview.1');
    assert.equal(envelope.human_review_required, true);
  } finally {
    await bridge.close();
  }
}

await testEngineProducesValidEnvelopeThroughSyntheticBridge();
console.log('agt002-preview-hetzner-bridge-parity.integration.test.mjs OK');
