import { randomUUID } from 'node:crypto';
import {
  validateAgt002TenderAnalysisEnvelope,
  validateAgt002TenderAnalysisRequest,
} from '../../agt002-tender-adapter.js';

/**
 * Test-only fixture. It must never be imported by runtime code: it imitates
 * an institutional AGT-002 envelope only to exercise the consumer boundary.
 */
export function buildSyntheticAgt002TenderAnalysis(snapshot) {
  validateAgt002TenderAnalysisRequest(snapshot);
  return validateAgt002TenderAnalysisEnvelope({
    schema_version: '2.0-draft',
    agent_id: 'AGT-002',
    run_id: randomUUID(),
    policy_version: 'synthetic-test-v1',
    snapshot_id: snapshot.snapshot_id,
    status: 'completed',
    method: 'agent_ai',
    recommendation: 'pause',
    summary: 'Fixture sintético de prueba; no representa una corrida institucional.',
    strengths: [],
    weaknesses: [],
    blockers: [],
    questions: [{ id: 'q-docs', text: 'Validar evidencia documental.', critical: true, evidence_refs: [] }],
    unverified: [],
    next_action: 'Esperar una respuesta institucional de AGT-002.',
    human_review_required: true,
    usage: { provider: 'synthetic-test', model: 'synthetic-test', input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  });
}
