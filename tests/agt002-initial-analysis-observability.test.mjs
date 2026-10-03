import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAgt002InitialAnalysisError,
  createAgt002InitialAnalysisObserver,
  readAgt002InitialAnalysisRuntimeConfig,
} from '../agt002-initial-analysis-observability.js';

test('runtime flags are fail-closed and identity/readback is mandatory', () => {
  assert.deepEqual(readAgt002InitialAnalysisRuntimeConfig({}), {
    admissionEnabled: false,
    modelCallsEnabled: false,
    runtimeReady: false,
    runtimeIdentity: null,
    modelId: null,
    maxTotalTokens: null,
    maxCostUsd: null,
    timeoutMs: null,
    reasoningEffort: null,
    inputCostPerMillionUsd: null,
    outputCostPerMillionUsd: null,
  });
  const ready = readAgt002InitialAnalysisRuntimeConfig({
    AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true',
    AGT002_MODEL_CALLS_ENABLED: 'true',
    AGT002_INITIAL_ANALYSIS_RUNTIME_IDENTITY: 'agt002-initial-analysis-worker',
    AGT002_INITIAL_ANALYSIS_MODEL_ID: 'gpt-5.2',
    AGT002_INITIAL_ANALYSIS_MAX_TOTAL_TOKENS: '12000',
    AGT002_INITIAL_ANALYSIS_MAX_COST_USD: '9.50',
    AGT002_INITIAL_ANALYSIS_TIMEOUT_MS: '30000',
    AGT002_INITIAL_ANALYSIS_REASONING_EFFORT: 'medium',
    AGT002_INITIAL_ANALYSIS_INPUT_COST_PER_MILLION_USD: '2.50',
    AGT002_INITIAL_ANALYSIS_OUTPUT_COST_PER_MILLION_USD: '10',
  });
  assert.equal(ready.runtimeReady, true);
  assert.equal(ready.maxTotalTokens, 12000);
  assert.equal(ready.maxCostUsd, 9.5);
});

test('malformed budget or unknown effort keeps runtime fail-closed', () => {
  const config = readAgt002InitialAnalysisRuntimeConfig({
    AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true',
    AGT002_MODEL_CALLS_ENABLED: 'true',
    AGT002_INITIAL_ANALYSIS_RUNTIME_IDENTITY: 'agt002-initial-analysis-worker',
    AGT002_INITIAL_ANALYSIS_MODEL_ID: 'model',
    AGT002_INITIAL_ANALYSIS_MAX_TOTAL_TOKENS: '-1',
    AGT002_INITIAL_ANALYSIS_MAX_COST_USD: 'x',
    AGT002_INITIAL_ANALYSIS_TIMEOUT_MS: '0',
    AGT002_INITIAL_ANALYSIS_REASONING_EFFORT: 'extreme',
    AGT002_INITIAL_ANALYSIS_INPUT_COST_PER_MILLION_USD: '2.50',
    AGT002_INITIAL_ANALYSIS_OUTPUT_COST_PER_MILLION_USD: '10',
  });
  assert.equal(config.runtimeReady, false);
  assert.equal(config.maxTotalTokens, null);
  assert.equal(config.reasoningEffort, null);
});

test('every unknown error becomes the closed UNKNOWN_INTERNAL_FAILURE class', () => {
  assert.equal(classifyAgt002InitialAnalysisError({ code: 'AGT002_CODEX_TIMEOUT' }), 'PROVIDER_TIMEOUT');
  assert.equal(classifyAgt002InitialAnalysisError({ code: 'AGT002_ENGINE_BUDGET_EXCEEDED' }), 'BUDGET_EXCEEDED');
  assert.equal(classifyAgt002InitialAnalysisError(new Error('raw database secret')), 'UNKNOWN_INTERNAL_FAILURE');
});

test('observer emits allowlisted metadata only and rejects document/prompt/error content', () => {
  const events = [];
  const observer = createAgt002InitialAnalysisObserver({ sink: event => events.push(event), now: () => '2026-10-03T00:00:00.000Z' });
  observer.emit('job_failed', { jobId: 'job-1', errorCode: 'PROVIDER_TIMEOUT', batchIndex: 2, raw_error: 'secret', prompt: 'private' });
  assert.deepEqual(events, [{
    event: 'agt002_initial_analysis_job_failed',
    at: '2026-10-03T00:00:00.000Z',
    job_id: 'job-1',
    error_code: 'PROVIDER_TIMEOUT',
    batch_index: 2,
  }]);
});
