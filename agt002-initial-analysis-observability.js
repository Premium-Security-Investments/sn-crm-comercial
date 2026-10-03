const ERROR_CLASSES = Object.freeze({
  AGT002_CODEX_TIMEOUT: 'PROVIDER_TIMEOUT',
  AGT002_CLAUDE_TIMEOUT: 'PROVIDER_TIMEOUT',
  AGT002_CODEX_TRANSPORT_ERROR: 'PROVIDER_UNAVAILABLE',
  AGT002_BRIDGE_INTERNAL: 'PROVIDER_UNAVAILABLE',
  AGT002_ENGINE_MODEL_CALL_FAILED: 'PROVIDER_UNAVAILABLE',
  AGT002_ENGINE_BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  AGT002_ENGINE_MEMBER_HASH_MISMATCH: 'PACKAGE_INVALID',
  AGT002_INITIAL_CHECKPOINT_RESUME_INVALID: 'PERSISTENCE_FAILED',
  AGT002_INITIAL_CHECKPOINT_PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
});

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const EVENT_NAMES = Object.freeze({
  job_claimed: 'agt002_initial_analysis_job_claimed',
  batch_started: 'agt002_initial_analysis_batch_started',
  batch_completed: 'agt002_initial_analysis_batch_completed',
  job_completed: 'agt002_initial_analysis_job_completed',
  job_failed: 'agt002_initial_analysis_job_failed',
  runtime_readback: 'agt002_initial_analysis_runtime_readback',
});
const FIELD_MAP = Object.freeze({
  jobId: 'job_id', runId: 'run_id', opportunityId: 'opportunity_id',
  packageVersionId: 'package_version_id', authorizationId: 'authorization_id',
  errorCode: 'error_code', batchIndex: 'batch_index', phase: 'phase',
  inputTokens: 'input_tokens', outputTokens: 'output_tokens', totalTokens: 'total_tokens',
  costUsd: 'cost_usd', latencyMs: 'latency_ms', runtimeReady: 'runtime_ready',
  admissionEnabled: 'admission_enabled', modelCallsEnabled: 'model_calls_enabled',
  runtimeIdentity: 'runtime_identity',
});

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function readAgt002InitialAnalysisRuntimeConfig(environment = {}) {
  const admissionEnabled = environment.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED === 'true';
  const modelCallsEnabled = environment.AGT002_MODEL_CALLS_ENABLED === 'true';
  const runtimeIdentity = String(environment.AGT002_INITIAL_ANALYSIS_RUNTIME_IDENTITY || '').trim() || null;
  const modelId = String(environment.AGT002_INITIAL_ANALYSIS_MODEL_ID || '').trim() || null;
  const maxTotalTokens = positiveInteger(environment.AGT002_INITIAL_ANALYSIS_MAX_TOTAL_TOKENS);
  const maxCostUsd = positiveNumber(environment.AGT002_INITIAL_ANALYSIS_MAX_COST_USD);
  const timeoutMs = positiveInteger(environment.AGT002_INITIAL_ANALYSIS_TIMEOUT_MS);
  const inputCostPerMillionUsd = positiveNumber(environment.AGT002_INITIAL_ANALYSIS_INPUT_COST_PER_MILLION_USD);
  const outputCostPerMillionUsd = positiveNumber(environment.AGT002_INITIAL_ANALYSIS_OUTPUT_COST_PER_MILLION_USD);
  const effortValue = String(environment.AGT002_INITIAL_ANALYSIS_REASONING_EFFORT || '').trim();
  const reasoningEffort = EFFORTS.has(effortValue) ? effortValue : null;
  const runtimeReady = admissionEnabled && modelCallsEnabled
    && runtimeIdentity === 'agt002-initial-analysis-worker'
    && modelId !== null && maxTotalTokens !== null && maxCostUsd !== null
    && timeoutMs !== null && reasoningEffort !== null
    && inputCostPerMillionUsd !== null && outputCostPerMillionUsd !== null;
  return Object.freeze({
    admissionEnabled, modelCallsEnabled, runtimeReady, runtimeIdentity, modelId,
    maxTotalTokens, maxCostUsd, timeoutMs, reasoningEffort,
    inputCostPerMillionUsd, outputCostPerMillionUsd,
  });
}

export function classifyAgt002InitialAnalysisError(error) {
  return ERROR_CLASSES[error?.code] || 'UNKNOWN_INTERNAL_FAILURE';
}

export function createAgt002InitialAnalysisObserver({ sink = console.log, now = () => new Date().toISOString() } = {}) {
  return Object.freeze({
    emit(kind, metadata = {}) {
      const eventName = EVENT_NAMES[kind];
      if (!eventName) throw new Error('Evento de observabilidad INITIAL no permitido.');
      const event = { event: eventName, at: now() };
      for (const [inputKey, outputKey] of Object.entries(FIELD_MAP)) {
        const value = metadata[inputKey];
        if (value !== undefined && value !== null && ['string', 'number', 'boolean'].includes(typeof value)) {
          event[outputKey] = value;
        }
      }
      sink(Object.freeze(event));
      return event;
    },
  });
}
