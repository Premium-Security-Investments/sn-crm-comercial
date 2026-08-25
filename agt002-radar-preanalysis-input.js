function invalid(message, code = 'AGT002_RADAR_PREANALYSIS_INPUT_INVALID') {
  const error = new Error(`${code}: ${message}`); error.code = code; throw error;
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(deepFreeze);
  }
  return value;
}
function string(value, label) { if (typeof value !== 'string' || !value.trim()) invalid(label); return value; }

export function buildAgt002RadarPreanalysisInput({ tenderRow, gateEvaluation, learningSignals } = {}) {
  if (!tenderRow || typeof tenderRow !== 'object' || !gateEvaluation || typeof gateEvaluation !== 'object') invalid('closed input');
  const tenderId = string(tenderRow.id, 'tender id');
  if (gateEvaluation.verdict !== 'sobreviviente') invalid('gate evaluation must be survivor');
  if (String(gateEvaluation.tender_id || tenderId) !== tenderId) invalid('gate tender mismatch');
  string(gateEvaluation.id, 'gate evaluation id');
  string(gateEvaluation.source_row_hash, 'source row hash');
  string(gateEvaluation.policy_version, 'gate policy');
  string(gateEvaluation.context_version, 'gate context');

  let learning = null;
  if (learningSignals !== null) {
    if (!learningSignals || typeof learningSignals !== 'object' || !Array.isArray(learningSignals.signals)
      || !Number.isInteger(learningSignals.max_signals) || learningSignals.max_signals < 1
      || learningSignals.signals.length > learningSignals.max_signals || typeof learningSignals.version !== 'string') invalid('learning signals invalid');
    if (learningSignals.candidate_id !== tenderId) invalid('learning candidate mismatch', 'AGT002_RADAR_LEARNING_CANDIDATE_INVALID');
    for (const signal of learningSignals.signals) {
      if (!signal || !Array.isArray(signal.candidate_match) || !signal.candidate_match.length) invalid('learning signal not candidate specific', 'AGT002_RADAR_LEARNING_SIGNAL_NOT_CANDIDATE_SPECIFIC');
      if (!['favorable','desfavorable','neutra'].includes(signal.signal_polarity)) invalid('learning signal polarity');
      if (!Array.isArray(signal.evidence) || !signal.evidence.length) invalid('learning signal evidence');
    }
    learning = {
      version: learningSignals.version,
      candidate_id: learningSignals.candidate_id,
      max_signals: learningSignals.max_signals,
      considered: Number(learningSignals.considered || 0),
      signals: learningSignals.signals.map(signal => ({
        signal_id: signal.signal_id, observation_id: signal.observation_id, signal_polarity: signal.signal_polarity,
        effect: signal.effect, score: signal.score, max_score: signal.max_score,
        candidate_match: signal.candidate_match.map(match => ({ ...match })),
        evidence: signal.evidence.map(item => ({ ...item })),
      })),
    };
  }

  const output = {
    schema_version: 'agt002-radar-preanalysis-input-v1',
    tender: {
      tender_id: tenderId, stable_key: tenderRow.stable_key || null, source: tenderRow.source || null,
      entity: tenderRow.entity || null, title: tenderRow.title || null, description: tenderRow.description || tenderRow.desc || null,
      city: tenderRow.city || null, dept: tenderRow.dept || null, value: Number(tenderRow.value || 0),
      status: tenderRow.status || null, category: tenderRow.category || null, published_at: tenderRow.published_at || tenderRow.published || null,
      deadline_at: tenderRow.deadline_at || tenderRow.deadline || null,
      reasons: Array.isArray(tenderRow.reasons) ? [...tenderRow.reasons] : [], risks: Array.isArray(tenderRow.risks) ? [...tenderRow.risks] : [],
    },
    gate: {
      gate_evaluation_id: gateEvaluation.id, verdict: gateEvaluation.verdict,
      rule_ids: Array.isArray(gateEvaluation.rule_ids) ? [...gateEvaluation.rule_ids] : [],
      reasons: Array.isArray(gateEvaluation.reasons) ? gateEvaluation.reasons.map(item => ({ ...item })) : [],
      data_gaps: Array.isArray(gateEvaluation.data_gaps) ? gateEvaluation.data_gaps.map(item => ({ ...item })) : [],
      policy_version: gateEvaluation.policy_version, context_version: gateEvaluation.context_version,
      source_row_hash: gateEvaluation.source_row_hash,
    },
    learning_signals: learning,
    learning_signals_count: learning?.signals.length || 0,
  };
  return deepFreeze(output);
}
