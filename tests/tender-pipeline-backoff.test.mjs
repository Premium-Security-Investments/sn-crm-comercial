import { strict as assert } from 'node:assert';
import { classifyPipelineError, computeBackoffMs, MAX_ATTEMPTS } from '../tender-pipeline-backoff.js';

// Clasificación de errores (spec §8.4).
assert.equal(classifyPipelineError({ code: 'AGT002_CODEX_TIMEOUT' }), 'retryable');
assert.equal(classifyPipelineError({ code: 'AGT002_CODEX_TRANSPORT_ERROR' }), 'retryable');
assert.equal(classifyPipelineError({ code: 'AGT002_QUOTA' }), 'retryable');
assert.equal(classifyPipelineError({ code: 'AGT002_BUSY' }), 'retryable');
assert.equal(classifyPipelineError({ code: 'TENDER_DOC_HTTP_429' }), 'retryable');
assert.equal(classifyPipelineError({ code: 'TENDER_DOC_HTTP_5XX' }), 'retryable');
assert.equal(classifyPipelineError({ code: 'TENDER_DOC_SOURCE_UNAVAILABLE' }), 'retryable');
assert.equal(classifyPipelineError({ status: 503 }), 'retryable');
assert.equal(classifyPipelineError({ status: 429 }), 'retryable');

assert.equal(classifyPipelineError({ code: 'AGT002_CODEX_LOGIN_REQUIRED' }), 'operational');
assert.equal(classifyPipelineError({ code: 'TENDER_DOC_TLS_ERROR' }), 'operational');

assert.equal(classifyPipelineError({ code: 'TENDER_DOC_EMPTY_TEXT' }), 'terminal');
assert.equal(classifyPipelineError({ code: 'TENDER_DOC_INVALID_URL' }), 'terminal');
assert.equal(classifyPipelineError({ code: 'TENDER_DOC_PRIVATE_URL' }), 'terminal');
assert.equal(classifyPipelineError({ code: 'TENDER_DOC_TYPE_NOT_ALLOWED' }), 'terminal');
assert.equal(classifyPipelineError({ code: 'AGT002_PROVIDER_CONTRACT_INVALID' }), 'terminal');

// Código desconocido no se asume retryable indefinido ni se descarta como terminal silencioso.
assert.equal(classifyPipelineError({ code: 'ALGO_NUNCA_VISTO' }), 'operational');

// Backoff exponencial acotado + jitter inyectable, determinista.
const b1 = computeBackoffMs({ attempt: 1, jitter: () => 0 });
const b5 = computeBackoffMs({ attempt: 5, jitter: () => 0 });
assert.ok(b1 < b5);
assert.ok(b1 <= 300000 && b5 <= 300000);

const withJitter = computeBackoffMs({ attempt: 1, baseMs: 2000, jitter: () => 1 });
const withoutJitter = computeBackoffMs({ attempt: 1, baseMs: 2000, jitter: () => 0 });
assert.equal(withJitter - withoutJitter, 2000);

// Backoff acotado por maxMs incluso con attempt grande.
const capped = computeBackoffMs({ attempt: 20, baseMs: 2000, maxMs: 300000, jitter: () => 0 });
assert.equal(capped, 300000);

// No hay reintentos ilimitados.
assert.ok(Number.isFinite(MAX_ATTEMPTS));
assert.ok(MAX_ATTEMPTS > 0 && MAX_ATTEMPTS < 20);

console.log('tender-pipeline-backoff contract passed');
