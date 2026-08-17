import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AGT002_OBSERVABILITY_EVENT_FIELDS,
  AGT002_OBSERVABILITY_EVENT_TYPES,
  AGT002_CANONICAL_PREVIEW_STAGES,
  AGT002_OUTPUT_REJECTION_STAGES,
  boundAgt002ErrorCode,
  boundAgt002ErrorMessage,
  boundAgt002ValidationCode,
  createAgt002AnalysisObservability,
  startAgt002StageTimer,
  toBoundedAgt002Error,
} from '../agt002-analysis-observability.js';

const REQUIRED_EVENT_TYPES = [
  'conversion_dispatched',
  'job_created',
  'job_claimed',
  'first_claim_latency',
  'lease_claimed',
  'lease_renewed',
  'lease_released',
  'lease_expired',
  'snapshot_published',
  'document_coverage',
  'model_invocation_started',
  'model_invocation_completed',
  'model_unavailable',
  'canonical_run_recorded',
  'reanalysis_triggered',
  'retry_scheduled',
  'outcome_recorded',
  'stage_duration',
  'output_rejected',
  'canonical_preview_unavailable',
];

test('every structured event category required by the observability program is defined', () => {
  for (const eventType of REQUIRED_EVENT_TYPES) {
    assert.ok(AGT002_OBSERVABILITY_EVENT_TYPES.includes(eventType), `missing event type: ${eventType}`);
    assert.ok(Array.isArray(AGT002_OBSERVABILITY_EVENT_FIELDS[eventType]), `missing field allowlist: ${eventType}`);
  }
});

test('record() rejects unknown event types instead of silently emitting them', () => {
  const emitted = [];
  const observability = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 1000 });
  assert.throws(() => observability.record('document_text_dump', { text: 'contenido del pliego' }), /unknown event type/);
  assert.equal(emitted.length, 0);
});

test('record() only forwards allowlisted fields for the given event type', () => {
  const emitted = [];
  const observability = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 42 });
  observability.record('job_claimed', {
    job_id: 'job-1',
    tender_id: 'tender-1',
    opportunity_id: 'opp-1',
    pipeline_status: 'queued',
    current_step: 'documents',
    attempt_count: 0,
    // Every one of these is a forbidden category the field allowlist for
    // job_claimed simply does not include, so it must never reach emit().
    document_text: 'contenido extraído del pliego...',
    prompt: 'system prompt completo',
    model_response: 'respuesta completa del modelo',
    api_key: 'sk-do-not-leak',
    connection_string: 'postgres://user:pass@host/db',
    authorization: 'Bearer super-secret-token',
  });

  assert.equal(emitted.length, 1);
  const [record] = emitted;
  assert.equal(record.event, 'job_claimed');
  assert.equal(record.job_id, 'job-1');
  assert.equal(record.pipeline_status, 'queued');
  for (const forbiddenKey of ['document_text', 'prompt', 'model_response', 'api_key', 'connection_string', 'authorization']) {
    assert.equal(record[forbiddenKey], undefined, `forbidden field leaked: ${forbiddenKey}`);
  }
});

test('record() drops null/undefined/object/array values instead of forwarding them raw', () => {
  const emitted = [];
  const observability = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 1 });
  observability.record('document_coverage', {
    job_id: 'job-1',
    tender_id: null,
    opportunity_id: undefined,
    snapshot_id: 'snap-1',
    documents_total: 4,
    chunks_total: 12,
    gaps_total: { reason: 'nested object must never pass through' },
  });
  const [record] = emitted;
  assert.equal(record.tender_id, undefined);
  assert.equal(record.opportunity_id, undefined);
  assert.equal(record.gaps_total, undefined);
  assert.equal(record.documents_total, 4);
});

test('record() truncates over-long string fields', () => {
  const emitted = [];
  const observability = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 1 });
  const longStage = 'x'.repeat(500);
  observability.record('stage_duration', { job_id: 'job-1', stage: longStage, outcome: 'completed', duration_ms: 12 });
  assert.ok(emitted[0].stage.length <= 200);
});

test('boundAgt002ErrorMessage keeps only the first line, redacts opaque tokens, and caps length', () => {
  const stackyMessage = `Connection failed with token abcdefghijklmnopqrstuvwxYZ0123456789\n    at Object.<anonymous> (/app/server/index.js:42:10)\n    at Module._compile (node:internal/modules/cjs/loader:1105:14)`;
  const bounded = boundAgt002ErrorMessage(stackyMessage);
  assert.ok(!bounded.includes('\n'));
  assert.ok(!bounded.includes('at Object'));
  assert.ok(!bounded.includes('abcdefghijklmnopqrstuvwxYZ0123456789'));
  assert.ok(bounded.includes('[redactado]'));
  assert.ok(bounded.length <= 160);
});

test('boundAgt002ErrorMessage handles non-string input safely', () => {
  assert.equal(boundAgt002ErrorMessage(undefined), '');
  assert.equal(boundAgt002ErrorMessage(null), '');
  assert.equal(boundAgt002ErrorMessage({ message: 'nested object is not a string' }), '');
});

test('boundAgt002ErrorCode only allows short uppercase/underscore codes', () => {
  assert.equal(boundAgt002ErrorCode('AGT002_QUOTA_MAX_ATTEMPTS'), 'AGT002_QUOTA_MAX_ATTEMPTS');
  assert.equal(boundAgt002ErrorCode('some free-form message with spaces'), 'UNKNOWN_ERROR');
  assert.equal(boundAgt002ErrorCode(undefined), 'UNKNOWN_ERROR');
  assert.equal(boundAgt002ErrorCode('A'.repeat(200)).length, 64);
});

test('toBoundedAgt002Error converts a raw Error into a safe, bounded pair', () => {
  const rawError = new Error('ECONNRESET while calling https://internal.example.com/secret?token=abcdefghijklmnopqrstuvwx123456');
  rawError.code = 'econnreset';
  const bounded = toBoundedAgt002Error(rawError);
  assert.equal(bounded.error_code, 'UNKNOWN_ERROR');
  assert.ok(bounded.error_message.length <= 160);
  assert.ok(!bounded.error_message.includes('abcdefghijklmnopqrstuvwx123456'));
});

test('default emit uses console.warn (matching the codebase structured-log convention)', () => {
  const originalWarn = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  try {
    const observability = createAgt002AnalysisObservability({ now: () => 7 });
    observability.record('lease_claimed', { job_id: 'job-9', tender_id: 'tender-9' });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'lease_claimed');
  assert.equal(calls[0][1].job_id, 'job-9');
});

test('startAgt002StageTimer measures non-negative elapsed time using an injected clock', () => {
  let current = 1000;
  const timer = startAgt002StageTimer(() => current);
  current += 250;
  assert.equal(timer.elapsedMs(), 250);
});

test('record() stamps every event with its own emission time from the injected clock', () => {
  const emitted = [];
  const observability = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 555 });
  observability.record('lease_released', { job_id: 'job-1', tender_id: 'tender-1' });
  assert.equal(emitted[0].at, 555);
});

// output_rejected (E5): the AGT-002 Preview engine's single diagnostic event for a rejected
// model output. Closed field allowlist — no error_code/error_message/raw-content-shaped field
// is ever part of it, so the classification stays purely structural/diagnostic.
test('output_rejected declares its closed field allowlist and stage enum', () => {
  assert.deepEqual(
    [...AGT002_OBSERVABILITY_EVENT_FIELDS.output_rejected].sort(),
    ['content_bytes', 'content_sha256', 'input_tokens', 'output_tokens', 'snapshot_id', 'stage', 'validation_code'].sort(),
  );
  assert.deepEqual(Object.values(AGT002_OUTPUT_REJECTION_STAGES).sort(), ['content_extraction', 'envelope', 'json_parse', 'semantic_validation', 'usage'].sort());
});

test('output_rejected only forwards the allowlisted fields and drops anything raw-content-shaped', () => {
  const emitted = [];
  const observability = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 10 });
  observability.record('output_rejected', {
    stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION,
    validation_code: 'unknown_evidence_id',
    content_sha256: 'a'.repeat(64),
    content_bytes: 512,
    snapshot_id: 'snap-1',
    input_tokens: 120,
    output_tokens: 40,
    // Forbidden: raw content / prompt / validator message must never survive, even if a
    // future call site accidentally tries to attach one of these.
    content: 'contenido crudo del modelo',
    raw_content: 'contenido crudo del modelo',
    prompt: 'system prompt completo',
    error_message: 'mensaje del validador con detalle sensible',
  });
  assert.equal(emitted.length, 1);
  const [record] = emitted;
  assert.equal(record.event, 'output_rejected');
  assert.equal(record.stage, 'semantic_validation');
  assert.equal(record.validation_code, 'unknown_evidence_id');
  assert.equal(record.content_sha256, 'a'.repeat(64));
  assert.equal(record.content_bytes, 512);
  assert.equal(record.snapshot_id, 'snap-1');
  assert.equal(record.input_tokens, 120);
  assert.equal(record.output_tokens, 40);
  for (const forbiddenKey of ['content', 'raw_content', 'prompt', 'error_message']) {
    assert.equal(record[forbiddenKey], undefined, `forbidden field leaked: ${forbiddenKey}`);
  }
});

test('output_rejected content_sha256 must be a 64-hex digest or it is dropped, never forwarded as free text', () => {
  const emitted = [];
  const observability = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 1 });
  observability.record('output_rejected', {
    stage: AGT002_OUTPUT_REJECTION_STAGES.JSON_PARSE,
    validation_code: 'invalid_json',
    content_sha256: 'not-a-real-hash-this-looks-like-leaked-content',
    content_bytes: 10,
    snapshot_id: 'snap-1',
  });
  assert.equal(emitted[0].content_sha256, undefined);
});

test('output_rejected input_tokens/output_tokens/content_bytes only accept non-negative integers', () => {
  const emitted = [];
  const observability = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 1 });
  observability.record('output_rejected', {
    stage: AGT002_OUTPUT_REJECTION_STAGES.USAGE,
    validation_code: 'invalid_usage',
    content_sha256: 'b'.repeat(64),
    content_bytes: -1,
    snapshot_id: 'snap-1',
    input_tokens: 'many',
    output_tokens: 3.5,
  });
  const [record] = emitted;
  assert.equal(record.content_bytes, undefined);
  assert.equal(record.input_tokens, undefined);
  assert.equal(record.output_tokens, undefined);
});

test('boundAgt002ValidationCode only allows short lowercase/underscore codes', () => {
  assert.equal(boundAgt002ValidationCode('unknown_evidence_id'), 'unknown_evidence_id');
  assert.equal(boundAgt002ValidationCode('Some Free Form Message'), 'unknown_validation_code');
  assert.equal(boundAgt002ValidationCode(undefined), 'unknown_validation_code');
});

test('canonical_preview_unavailable has a closed stage enum and never emits sensitive fields', () => {
  assert.deepEqual(Object.values(AGT002_CANONICAL_PREVIEW_STAGES), [
    'runtime_config',
    'legal_corpus',
    'context_version',
    'claim',
    'governance',
    'runtime_creation',
    'engine_analysis',
    'persistence',
  ]);
  assert.deepEqual(
    [...AGT002_OBSERVABILITY_EVENT_FIELDS.canonical_preview_unavailable].sort(),
    ['bridge_invocation_started', 'correlation_id', 'duration_ms', 'error_code', 'opportunity_id', 'snapshot_id', 'stage', 'tender_id'].sort(),
  );

  const emitted = [];
  const observability = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 99 });
  observability.record('canonical_preview_unavailable', {
    correlation_id: '2f9580cf-d2cf-49ea-b411-f6f86cf499cb',
    stage: AGT002_CANONICAL_PREVIEW_STAGES.GOVERNANCE,
    error_code: 'PGRST205',
    bridge_invocation_started: false,
    duration_ms: 379,
    opportunity_id: 'opp-1',
    tender_id: 'tender-1',
    snapshot_id: 'snap-1',
    error_message: 'document text and secret token abcdefghijklmnopqrstuvwxyz123456',
    stack: 'sensitive stack',
    payload: { document: 'full tender' },
    prompt: 'system prompt',
    policy: 'private policy',
    authorization: 'Bearer secret',
  });

  assert.deepEqual(emitted, [{
    event: 'canonical_preview_unavailable',
    at: 99,
    correlation_id: '2f9580cf-d2cf-49ea-b411-f6f86cf499cb',
    stage: 'governance',
    error_code: 'PGRST205',
    bridge_invocation_started: false,
    duration_ms: 379,
    opportunity_id: 'opp-1',
    tender_id: 'tender-1',
    snapshot_id: 'snap-1',
  }]);
});

test('durable reanalysis worker prefers the safe runtime boundary code and keeps Express/Vercel parity', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../agt002-reanalysis-worker.js', import.meta.url), 'utf8');
  assert.equal(server, api);
  assert.match(worker, /error\?\.runtime_boundary_code \|\| error\?\.code/);
  assert.doesNotMatch(worker, /error_message\s*:/);
});

test('canonical_preview_unavailable drops a stage outside its closed enum', () => {
  const emitted = [];
  const observability = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 100 });
  observability.record('canonical_preview_unavailable', {
    correlation_id: '2f9580cf-d2cf-49ea-b411-f6f86cf499cb',
    stage: 'document=texto-confidencial-prompt-secreto',
    error_code: 'PGRST205',
  });

  assert.deepEqual(emitted, [{
    event: 'canonical_preview_unavailable',
    at: 100,
    correlation_id: '2f9580cf-d2cf-49ea-b411-f6f86cf499cb',
    error_code: 'PGRST205',
  }]);
});
