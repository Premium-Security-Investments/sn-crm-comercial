import { buildAgt003PrioritiesData, deepFreeze, snapshotPlainInput } from './agt003-priorities-service.js';

const CONTRACT_VERSION = '1.0.0';
const CAPABILITY = 'agt003.priorities.read';
const POLICY_VERSION = 'gate0-v1.0';
const AGENT_ID = 'AGT-003';
const DATASET = 'v_psi_sales_opportunity_enriched';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{4,127}$/;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const EVIDENCE_TYPES = new Set(['record_set', 'record', 'analysis', 'policy']);
const objectKeys = Object.keys;
const objectHasOwn = Object.hasOwn;
const arrayIsArray = Array.isArray;
const dateParse = Date.parse;
const setHas = Set.prototype.has;

function deny(cause) {
  throw new Error('Synthetic AGT-003 response denied', { cause });
}

function exactKeys(value, expected) {
  const keys = objectKeys(value);
  return keys.length === expected.length && expected.every((key) => objectHasOwn(value, key));
}

function validDateTime(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(dateParse(value));
}

function validateEvidence(evidence) {
  if (!arrayIsArray(evidence) || evidence.length < 1 || evidence.length > 100) deny();
  for (const item of evidence) {
    if (!exactKeys(item, ['evidence_id', 'evidence_type', 'record_id', 'captured_at'])
      || !ID_PATTERN.test(item.evidence_id)
      || !setHas.call(EVIDENCE_TYPES, item.evidence_type)
      || !ID_PATTERN.test(item.record_id)
      || !validDateTime(item.captured_at)) deny();
  }
}

export function buildSyntheticAgt003PrioritiesResponse(input) {
  try {
    const safe = snapshotPlainInput(input);
    if (!exactKeys(safe, ['decision', 'request', 'rows', 'metadata', 'now'])) deny();
    const { decision, request, rows, metadata, now } = safe;
    if (!exactKeys(decision, ['allowed', 'agent_id', 'capability', 'correlation_id', 'resolved_scope_digest', 'policy_version'])
      || decision.allowed !== true
      || decision.agent_id !== AGENT_ID
      || decision.capability !== CAPABILITY
      || decision.policy_version !== POLICY_VERSION
      || !CORRELATION_PATTERN.test(decision.correlation_id)
      || typeof decision.resolved_scope_digest !== 'string'
      || !decision.resolved_scope_digest.startsWith('sha256:')
      || decision.resolved_scope_digest.length < 8) deny();
    if (!exactKeys(request, ['contract_version', 'capability_id', 'correlation_id', 'query'])
      || request.contract_version !== CONTRACT_VERSION
      || request.capability_id !== CAPABILITY
      || request.correlation_id !== decision.correlation_id
      || !exactKeys(request.query, [])) deny();
    if (!exactKeys(metadata, ['run_id', 'record_set_id', 'cutoff_at', 'resolved_scope_digest', 'evidence'])
      || !ID_PATTERN.test(metadata.run_id)
      || !ID_PATTERN.test(metadata.record_set_id)
      || !validDateTime(metadata.cutoff_at)
      || metadata.resolved_scope_digest !== decision.resolved_scope_digest) deny();
    validateEvidence(metadata.evidence);

    const data = buildAgt003PrioritiesData(rows, { now });
    if (data.policy.version !== decision.policy_version) deny();
    if (data.source.as_of !== null && data.source.as_of !== metadata.cutoff_at) deny();

    return deepFreeze({
      contract_version: CONTRACT_VERSION,
      capability_id: CAPABILITY,
      correlation_id: decision.correlation_id,
      run_id: metadata.run_id,
      policy_version: POLICY_VERSION,
      source: {
        system: 'SIIO',
        dataset: DATASET,
        record_set_id: metadata.record_set_id,
        persisted: false,
      },
      cutoff_at: metadata.cutoff_at,
      evidence: metadata.evidence.map((item) => ({ ...item })),
      data,
    });
  } catch (error) {
    if (error?.message === 'Synthetic AGT-003 response denied') throw error;
    deny(error);
  }
}
