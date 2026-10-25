export const AGT002_RADAR_PREANALYSIS_SCHEMA_VERSION = 'agt002-radar-preanalysis-v1';
export const AGT002_RADAR_PREANALYSIS_POLICY_VERSION = 'agt002-radar-preanalysis-policy-v1';

export const AGT002_RADAR_FORBIDDEN_TOKENS = Object.freeze([
  'go', 'nogo', 'gonogo', 'recommendation', 'recomendacion',
  'decision', 'decidir', 'convert', 'convertir', 'conversion',
  'opportunity_id', 'converted_opportunity_id',
]);
export const AGT002_RADAR_FORBIDDEN_PHRASES = Object.freeze([
  Object.freeze(['no', 'go']), Object.freeze(['go', 'no', 'go']),
  Object.freeze(['recomendacion', 'de', 'go']), Object.freeze(['decision', 'de', 'go']),
  Object.freeze(['convertir', 'en', 'oportunidad']),
  // `opportunity_id` y `converted_opportunity_id` sólo son alcanzables como frase: la
  // tokenización parte por `[^a-z0-9]+`, así que nunca existe un token igual a ellos.
  Object.freeze(['opportunity', 'id']), Object.freeze(['converted', 'opportunity', 'id']),
]);
export const AGT002_RADAR_FORBIDDEN_ALLOWED_TERMS = Object.freeze([
  'riesgo', 'riesgos', 'matriz de riesgos', 'Bogotá', 'bogota', 'catálogo', 'código', 'pliego',
  'negociación', 'gobierno', 'agosto', 'algoritmo', 'cargo', 'obligaciones', 'logística', 'pago', 'rubro presupuestal',
]);

const ENVELOPE_KEYS = Object.freeze(['schema_version','agent_id','run_id','policy_version','context_version','tender_id','gate_evaluation_id','status','visibility_verdict','summary','signals','evidence','data_gaps','human_review_required','usage']);
const SIGNAL_KEYS = Object.freeze(['signal_id','text','evidence_refs']);
const EVIDENCE_KEYS = Object.freeze(['evidence_id','evidence_type','reference','observed_value','policy_version','context_version']);
const USAGE_KEYS = Object.freeze(['provider','model','input_tokens','output_tokens','cost_usd']);

const stringField = Object.freeze({ type: 'string', minLength: 1 });
const signalSchema = Object.freeze({
  type: 'object', required: SIGNAL_KEYS, additionalProperties: false,
  properties: Object.freeze({
    signal_id: stringField,
    text: stringField,
    evidence_refs: Object.freeze({ type: 'array', minItems: 1, items: stringField }),
  }),
});
const evidenceSchema = Object.freeze({
  type: 'object', required: EVIDENCE_KEYS, additionalProperties: false,
  properties: Object.freeze({
    evidence_id: stringField,
    evidence_type: Object.freeze({ enum: ['tender_field','gate_rule','learning_signal'] }),
    reference: stringField,
    observed_value: stringField,
    policy_version: Object.freeze({ const: AGT002_RADAR_PREANALYSIS_POLICY_VERSION }),
    context_version: stringField,
  }),
});
const usageSchema = Object.freeze({
  type: 'object', required: USAGE_KEYS, additionalProperties: false,
  properties: Object.freeze({
    provider: stringField,
    model: stringField,
    input_tokens: Object.freeze({ type: 'number', minimum: 0 }),
    output_tokens: Object.freeze({ type: 'number', minimum: 0 }),
    // `cost_usd` es expansión aditiva de tipo (issue #136): además del número >= 0 de siempre,
    // admite `null` para "el puente no midió costo". Las filas históricas, todas numéricas
    // (incluido el 0 que antes se usaba por ausencia de medición), siguen siendo válidas contra
    // este schema tal cual están persistidas; no se reescriben ni se migran.
    cost_usd: Object.freeze({ type: ['number', 'null'], minimum: 0 }),
  }),
});

export const AGT002_RADAR_PREANALYSIS_OUTPUT_SCHEMA = Object.freeze({
  type: 'object', required: ENVELOPE_KEYS, additionalProperties: false,
  properties: Object.freeze({
    schema_version: Object.freeze({ const: AGT002_RADAR_PREANALYSIS_SCHEMA_VERSION }),
    agent_id: Object.freeze({ const: 'AGT-002' }),
    run_id: stringField,
    policy_version: Object.freeze({ const: AGT002_RADAR_PREANALYSIS_POLICY_VERSION }),
    context_version: stringField,
    tender_id: stringField,
    gate_evaluation_id: stringField,
    status: Object.freeze({ enum: ['completed','abstained'] }),
    visibility_verdict: Object.freeze({ enum: ['mostrar_en_radar','no_mostrar_en_radar','no_concluyente'] }),
    summary: stringField,
    signals: Object.freeze({ type: 'array', items: signalSchema }),
    evidence: Object.freeze({ type: 'array', minItems: 1, items: evidenceSchema }),
    data_gaps: Object.freeze({ type: 'array', items: stringField }),
    human_review_required: Object.freeze({ const: true }),
    usage: usageSchema,
  }),
});

function contractError(message, code = 'AGT002_RADAR_PREANALYSIS_INVALID') {
  const error = new Error(`${code}: ${message}`); error.code = code; throw error;
}
function normalize(value) { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function tokens(value) { return normalize(value).split(/[^a-z0-9]+/).filter(Boolean); }

export function findAgt002RadarForbiddenVocabulary(value) {
  const findings = [];
  const visit = (current, path) => {
    if (typeof current === 'string') {
      const parts = tokens(current);
      for (let index = 0; index < parts.length; index += 1) {
        if (AGT002_RADAR_FORBIDDEN_TOKENS.includes(parts[index])) findings.push({ path, match: parts[index], kind: 'token', token_index: index });
        for (const phrase of AGT002_RADAR_FORBIDDEN_PHRASES) {
          if (phrase.every((token, offset) => parts[index + offset] === token)) findings.push({ path, match: phrase.join(' '), kind: 'phrase', token_index: index });
        }
      }
      return;
    }
    if (Array.isArray(current)) { current.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
    if (current && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) { visit(key, `${path}.${key}#key`); visit(child, `${path}.${key}`); }
    }
  };
  visit(value, '$');
  return findings;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contractError(`${label} must be an object`);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) contractError(`${label} closed shape`);
}
function nonempty(value, label) { if (typeof value !== 'string' || !value.trim()) contractError(`${label} required`); }

export function validateAgt002RadarPreanalysis(value, { expectedLearningSignalIds = [] } = {}) {
  exactKeys(value, ENVELOPE_KEYS, 'envelope');
  if (findAgt002RadarForbiddenVocabulary(value).length) contractError('forbidden vocabulary', 'AGT002_RADAR_PREANALYSIS_FORBIDDEN_VOCABULARY');
  if (value.schema_version !== AGT002_RADAR_PREANALYSIS_SCHEMA_VERSION) contractError('schema_version');
  if (value.agent_id !== 'AGT-002') contractError('agent_id must be AGT-002');
  for (const key of ['run_id','policy_version','context_version','tender_id','gate_evaluation_id','summary']) nonempty(value[key], key);
  if (value.policy_version !== AGT002_RADAR_PREANALYSIS_POLICY_VERSION) contractError('policy_version');
  if (value.human_review_required !== true) contractError('human_review_required must be true');
  if (!['completed','abstained'].includes(value.status)) contractError('status');
  if (!['mostrar_en_radar','no_mostrar_en_radar','no_concluyente'].includes(value.visibility_verdict)) contractError('visibility_verdict');
  if ((value.status === 'completed' && !['mostrar_en_radar','no_mostrar_en_radar'].includes(value.visibility_verdict)) || (value.status === 'abstained' && value.visibility_verdict !== 'no_concluyente')) contractError('status/verdict coherence');
  if (!Array.isArray(value.signals) || !Array.isArray(value.evidence) || !Array.isArray(value.data_gaps)) contractError('array fields');
  if (!value.evidence.length) contractError('evidence required');

  const evidenceIds = new Set();
  const expected = new Set(expectedLearningSignalIds);
  for (const item of value.evidence) {
    exactKeys(item, EVIDENCE_KEYS, 'evidence');
    for (const key of EVIDENCE_KEYS) nonempty(item[key], `evidence.${key}`);
    if (!['tender_field','gate_rule','learning_signal'].includes(item.evidence_type)) contractError('evidence_type');
    if (item.policy_version !== value.policy_version || item.context_version !== value.context_version) contractError('evidence version');
    if (evidenceIds.has(item.evidence_id)) contractError('duplicate evidence_id');
    evidenceIds.add(item.evidence_id);
    if (item.evidence_type === 'learning_signal' && !expected.has(item.reference)) contractError('unknown learning signal');
  }
  for (const signal of value.signals) {
    exactKeys(signal, SIGNAL_KEYS, 'signal');
    nonempty(signal.signal_id, 'signal_id'); nonempty(signal.text, 'signal.text');
    if (!Array.isArray(signal.evidence_refs) || !signal.evidence_refs.length || signal.evidence_refs.some(id => !evidenceIds.has(id))) contractError('orphan evidence reference');
  }
  if (value.visibility_verdict === 'no_mostrar_en_radar' && !value.evidence.some(item => item.evidence_type !== 'learning_signal')) contractError('no_mostrar requires own evidence');
  exactKeys(value.usage, USAGE_KEYS, 'usage');
  nonempty(value.usage.provider, 'usage.provider'); nonempty(value.usage.model, 'usage.model');
  for (const key of ['input_tokens','output_tokens']) if (typeof value.usage[key] !== 'number' || !Number.isFinite(value.usage[key]) || value.usage[key] < 0) contractError(`usage.${key}`);
  // `cost_usd` es null cuando el puente no midió costo, o un número finito >= 0 cuando sí lo
  // hizo (incluido el histórico numérico de filas persistidas antes de aceptar null).
  const cost = value.usage.cost_usd;
  if (cost !== null && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)) contractError('usage.cost_usd');
  return value;
}
