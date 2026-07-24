import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const ENVELOPE_KEYS = [
  'schema_version', 'agent_id', 'run_id', 'policy_version', 'snapshot_id', 'status', 'method',
  'recommendation', 'summary', 'strengths', 'weaknesses', 'blockers', 'questions', 'unverified',
  'next_action', 'human_review_required', 'usage',
];
const FINDING_KEYS = ['id', 'text', 'critical', 'evidence_refs'];
const USAGE_KEYS = ['provider', 'model', 'input_tokens', 'output_tokens', 'cost_usd'];
const SNAPSHOT_KEYS = ['snapshot_id', 'opportunity_id', 'tender_id', 'document_hash', 'profile_hash', 'documents', 'company_profile'];
const RECOMMENDATIONS = new Set(['advance', 'advance_conditionally', 'pause', 'do_not_advance']);

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function validateFinding(item, field) {
  if (!exactKeys(item, FINDING_KEYS)
    || typeof item.id !== 'string' || item.id.length < 1
    || typeof item.text !== 'string' || item.text.length < 1
    || typeof item.critical !== 'boolean'
    || !Array.isArray(item.evidence_refs)
    || !item.evidence_refs.every((reference) => typeof reference === 'string' && reference.length > 0)) {
    throw new Error(`${field} debe contener hallazgos cerrados.`);
  }
}

function validateSnapshot(snapshot) {
  if (!exactKeys(snapshot, SNAPSHOT_KEYS)
    || !UUID.test(String(snapshot.snapshot_id || ''))
    || !UUID.test(String(snapshot.opportunity_id || ''))
    || !UUID.test(String(snapshot.tender_id || ''))
    || !SHA256.test(String(snapshot.document_hash || ''))
    || !SHA256.test(String(snapshot.profile_hash || ''))
    || !Array.isArray(snapshot.documents)
    || !snapshot.company_profile || typeof snapshot.company_profile !== 'object' || Array.isArray(snapshot.company_profile)) {
    throw new Error('El snapshot SIIO está incompleto o no tiene la forma esperada.');
  }
}

export function validateAgt002TenderAnalysisEnvelope(value) {
  if (!exactKeys(value, ENVELOPE_KEYS)) throw new Error('El envelope AGT-002 debe ser cerrado.');
  if (value.schema_version !== '2.0-draft') throw new Error('La versión de esquema AGT-002 no es compatible.');
  if (value.agent_id !== 'AGT-002') throw new Error('El productor debe ser AGT-002.');
  if (!UUID.test(String(value.run_id || '')) || !UUID.test(String(value.snapshot_id || ''))) throw new Error('Run y snapshot deben ser UUID.');
  if (typeof value.policy_version !== 'string' || value.policy_version.length < 1) throw new Error('La política debe ser texto.');
  if (value.status !== 'completed' || value.method !== 'agent_ai') throw new Error('El envelope AGT-002 no está completado.');
  if (!RECOMMENDATIONS.has(value.recommendation)) throw new Error('La recomendación AGT-002 no es válida.');
  if (typeof value.summary !== 'string' || value.summary.length < 1 || typeof value.next_action !== 'string' || value.next_action.length < 1) throw new Error('Resumen y siguiente acción son obligatorios.');
  if (value.human_review_required !== true) throw new Error('La revisión humana es obligatoria.');
  for (const field of ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified']) {
    if (!Array.isArray(value[field])) throw new Error(`${field} debe ser arreglo.`);
    value[field].forEach((item) => validateFinding(item, field));
  }
  if (!exactKeys(value.usage, USAGE_KEYS)
    || typeof value.usage.provider !== 'string' || value.usage.provider.length < 1
    || typeof value.usage.model !== 'string' || value.usage.model.length < 1
    || !Number.isInteger(value.usage.input_tokens) || value.usage.input_tokens < 0
    || !Number.isInteger(value.usage.output_tokens) || value.usage.output_tokens < 0
    || typeof value.usage.cost_usd !== 'number' || !Number.isFinite(value.usage.cost_usd) || value.usage.cost_usd < 0) {
    throw new Error('El uso AGT-002 no es válido.');
  }
  return value;
}

export function buildSyntheticAgt002TenderAnalysis(snapshot) {
  validateSnapshot(snapshot);
  return validateAgt002TenderAnalysisEnvelope({
    schema_version: '2.0-draft',
    agent_id: 'AGT-002',
    run_id: randomUUID(),
    policy_version: 'synthetic-v1',
    snapshot_id: snapshot.snapshot_id,
    status: 'completed',
    method: 'agent_ai',
    recommendation: 'pause',
    summary: 'Respuesta sintética de integración; no usar en producción.',
    strengths: [],
    weaknesses: [],
    blockers: [],
    questions: [{ id: 'q-docs', text: 'Validar evidencia documental.', critical: true, evidence_refs: [] }],
    unverified: [],
    next_action: 'Esperar activación institucional de AGT-002.',
    human_review_required: true,
    usage: { provider: 'synthetic', model: 'synthetic', input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  });
}
