const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRODUCER_METHOD = new Map([
  ['siio_rules_v1', 'rules'],
  ['HERMES-INTERIM', 'agent_ai'],
  ['AGT-002', 'agent_ai'],
]);
const RESULT_ARRAYS = ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified'];

export function validateTenderAnalysisResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || PRODUCER_METHOD.get(value.producer) !== value.method) {
    throw new Error('Productor o método de análisis inválido.');
  }
  if (value.producer === 'AGT-002' && value.agent_id !== 'AGT-002') {
    throw new Error('La identidad del productor AGT-002 no es válida.');
  }
  if (value.producer === 'HERMES-INTERIM' && value.agent_id != null) {
    throw new Error('La identidad del productor HERMES-INTERIM no es válida.');
  }
  if (value.human_review_required !== true) throw new Error('La revisión humana es obligatoria.');
  if (!UUID.test(String(value.run_id || '')) || !UUID.test(String(value.snapshot_id || ''))) {
    throw new Error('Identidad de análisis inválida.');
  }
  for (const key of RESULT_ARRAYS) {
    if (!Array.isArray(value[key])) throw new Error(`${key} debe ser arreglo.`);
  }
  return value;
}

export function createTenderAnalysisEngine({ mode, rulesEngine, hermesEngine, agt002Engine } = {}) {
  const engines = { rules: rulesEngine, hermes_interim: hermesEngine, agt002: agt002Engine };
  if (!Object.hasOwn(engines, mode)) throw new Error(`Motor de análisis ${mode || 'no especificado'} desconocido o no configurado.`);
  const selected = engines[mode];
  if (!selected || typeof selected.analyze !== 'function') {
    return {
      analyze() {
        throw new Error(`Motor de análisis ${mode || 'no especificado'} no configurado.`);
      },
    };
  }
  return {
    async analyze(snapshot, options) {
      return validateTenderAnalysisResult(await selected.analyze(snapshot, options));
    },
  };
}
