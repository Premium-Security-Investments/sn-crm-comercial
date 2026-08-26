import assert from 'node:assert/strict';
import {
  AGT002_RADAR_FORBIDDEN_ALLOWED_TERMS,
  AGT002_RADAR_PREANALYSIS_OUTPUT_SCHEMA,
  AGT002_RADAR_PREANALYSIS_POLICY_VERSION,
  findAgt002RadarForbiddenVocabulary,
  validateAgt002RadarPreanalysis,
} from '../agt002-radar-preanalysis-contract.js';
import { buildAgt002RadarPreanalysisInput } from '../agt002-radar-preanalysis-input.js';

const valid = {
  schema_version: 'agt002-radar-preanalysis-v1', agent_id: 'AGT-002', run_id: 'run-1',
  policy_version: 'agt002-radar-preanalysis-policy-v1', context_version: 'agt002-radar-context-v1',
  tender_id: '22222222-2222-4222-8222-222222222222', gate_evaluation_id: '33333333-3333-4333-8333-333333333333',
  status: 'completed', visibility_verdict: 'mostrar_en_radar', summary: 'Proceso de vigilancia con cierre verificable.',
  signals: [{ signal_id: 's1', text: 'Objeto compatible con vigilancia armada.', evidence_refs: ['e1'] }],
  evidence: [{ evidence_id: 'e1', evidence_type: 'tender_field', reference: 'psi_public_tenders.title', observed_value: 'Servicio de vigilancia armada', policy_version: 'agt002-radar-preanalysis-policy-v1', context_version: 'agt002-radar-context-v1' }],
  data_gaps: [], human_review_required: true,
  usage: { provider: 'hetzner_bridge', model: 'm1', input_tokens: 10, output_tokens: 5, cost_usd: 0 },
};

assert.deepEqual(validateAgt002RadarPreanalysis(valid), valid);
assert.deepEqual(Object.keys(AGT002_RADAR_PREANALYSIS_OUTPUT_SCHEMA.properties).sort(), Object.keys(valid).sort(), 'el JSON Schema cerrado declara todas las claves requeridas');
assert.equal(AGT002_RADAR_PREANALYSIS_OUTPUT_SCHEMA.properties.policy_version.const, AGT002_RADAR_PREANALYSIS_POLICY_VERSION);
for (const field of ['signals', 'evidence', 'usage']) {
  const schema = field === 'usage' ? AGT002_RADAR_PREANALYSIS_OUTPUT_SCHEMA.properties[field] : AGT002_RADAR_PREANALYSIS_OUTPUT_SCHEMA.properties[field].items;
  assert.equal(schema.additionalProperties, false, `${field} debe tener forma cerrada`);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${field} declara todas sus claves`);
}
assert.throws(() => validateAgt002RadarPreanalysis({
  ...valid,
  policy_version: 'agt002-radar-gate-policy-v1',
  evidence: valid.evidence.map(item => ({ ...item, policy_version: 'agt002-radar-gate-policy-v1' })),
}), /policy_version/i);
assert.equal(valid.policy_version, AGT002_RADAR_PREANALYSIS_POLICY_VERSION);
for (const value of [false, 'true', 1, null, undefined]) {
  const candidate = { ...valid };
  if (value === undefined) delete candidate.human_review_required; else candidate.human_review_required = value;
  assert.throws(() => validateAgt002RadarPreanalysis(candidate), /human_review_required|closed/i);
}
for (const key of ['recommendation', 'decision', 'go_no_go', 'opportunity_id', 'converted_opportunity_id']) {
  assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, [key]: 'go' }), /closed|forbidden/i);
}
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, summary: 'Recomendación: GO' }), /forbidden/i);
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, summary: 'Convertir en oportunidad' }), /forbidden/i);
// Regresión: el vocabulario prohibido de columnas de conversión debe detectarse también
// como valor de texto libre, no sólo como clave extra que `exactKeys` ya rechaza.
for (const leak of ['opportunity_id', 'converted_opportunity_id']) {
  assert.ok(findAgt002RadarForbiddenVocabulary(`Se escribió ${leak} en la fila.`).length > 0, leak);
  assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, summary: `Se escribió ${leak} en la fila.` }), /forbidden/i);
}
for (const allowed of AGT002_RADAR_FORBIDDEN_ALLOWED_TERMS) {
  assert.equal(findAgt002RadarForbiddenVocabulary(`Análisis de ${allowed}.`).length, 0, allowed);
  assert.equal(validateAgt002RadarPreanalysis({ ...valid, summary: `Análisis de ${allowed}.` }).summary, `Análisis de ${allowed}.`);
}
assert.equal(findAgt002RadarForbiddenVocabulary('GO / NO-GO').length > 0, true);

assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, evidence: [] }), /evidence/i);
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, signals: [{ signal_id: 's1', text: 't', evidence_refs: ['missing'] }] }), /evidence/i);
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, status: 'abstained' }), /coherence/i);
const abstained = { ...valid, status: 'abstained', visibility_verdict: 'no_concluyente', signals: [] };
assert.equal(validateAgt002RadarPreanalysis(abstained).visibility_verdict, 'no_concluyente');
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, status: 'completed', visibility_verdict: 'no_concluyente' }), /coherence/i);
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, visibility_verdict: 'no_mostrar_en_radar', evidence: [{ ...valid.evidence[0], evidence_type: 'learning_signal', reference: 'ls1' }] }, { expectedLearningSignalIds: ['ls1'] }), /own evidence/i);
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, evidence: [{ ...valid.evidence[0], evidence_type: 'learning_signal', reference: 'invented' }] }, { expectedLearningSignalIds: ['ls1'] }), /learning signal/i);
assert.deepEqual(validateAgt002RadarPreanalysis({ ...valid, evidence: [{ ...valid.evidence[0], evidence_type: 'learning_signal', reference: 'ls1' }] }, { expectedLearningSignalIds: ['ls1'] }).evidence[0].reference, 'ls1');
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, agent_id: 'AGT-003' }), /AGT-002/);

const tenderRow = {
  id: valid.tender_id, stable_key: 'k-1', source: 'SECOP II', entity: 'E', title: 'T', description: 'D', city: 'Bogotá', dept: 'Cundinamarca',
  value: 100, status: 'abierto', category: 'Licitación', published_at: null, deadline_at: '2026-12-31T23:59:59.000Z', reasons: [], risks: [], raw: {},
  internal_status: 'nueva', converted_opportunity_id: null,
};
const gateEvaluation = {
  id: valid.gate_evaluation_id, tender_id: valid.tender_id, verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [],
  policy_version: 'p', context_version: 'c', source_row_hash: 'a'.repeat(64),
};
const input = buildAgt002RadarPreanalysisInput({ tenderRow, gateEvaluation, learningSignals: null });
assert.equal(Object.isFrozen(input), true);
const serialized = JSON.stringify(input);
for (const leak of ['converted_opportunity_id', 'internal_status', 'opportunity', 'go_no_go']) assert.equal(serialized.includes(leak), false, leak);
assert.equal(input.learning_signals, null);
assert.equal(input.learning_signals_count, 0);

const learningSignals = {
  version: 'learning-v1', candidate_id: valid.tender_id, max_signals: 2, considered: 1,
  signals: [{ signal_id: 'ls1', observation_id: 'o1', signal_polarity: 'favorable', effect: 'raise_relative_priority', score: 10, max_score: 10, candidate_match: [{ dimension: 'servicio_objeto', score: 10 }], evidence: [{ evidence_id: 'le1', record_id: 'r1', evidence_type: 'converted_tender' }] }],
};
const withLearning = buildAgt002RadarPreanalysisInput({ tenderRow, gateEvaluation, learningSignals });
assert.equal(withLearning.learning_signals_count, 1);
assert.equal(withLearning.learning_signals.candidate_id, valid.tender_id);
assert.throws(() => buildAgt002RadarPreanalysisInput({ tenderRow, gateEvaluation, learningSignals: { ...learningSignals, considered: 0, signals: [] } }), /learning signals invalid/i);
assert.throws(() => buildAgt002RadarPreanalysisInput({ tenderRow, gateEvaluation, learningSignals: { ...learningSignals, candidate_id: 'other' } }), /CANDIDATE_INVALID/);
assert.throws(() => buildAgt002RadarPreanalysisInput({ tenderRow, gateEvaluation, learningSignals: { ...learningSignals, signals: [{ ...learningSignals.signals[0], candidate_match: [] }] } }), /NOT_CANDIDATE_SPECIFIC/);
assert.throws(() => buildAgt002RadarPreanalysisInput({ tenderRow, gateEvaluation, learningSignals: { ...learningSignals, max_signals: 0 } }), /INVALID/);
assert.throws(() => buildAgt002RadarPreanalysisInput({ tenderRow: null, gateEvaluation: null, learningSignals: null }), /INVALID/);
assert.throws(() => buildAgt002RadarPreanalysisInput({ tenderRow, gateEvaluation: { ...gateEvaluation, verdict: 'eliminada' }, learningSignals: null }), /survivor/i);

console.log('AGT-002 Radar closed preanalysis contract and input passed');
