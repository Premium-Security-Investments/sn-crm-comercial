// RED (TDD): AGT-002 post-bridge observability does not exist yet. This file specifies the
// DESIRED closed classification contract for the boundary right after a bridge call resolves
// (the equivalent of the real `bridge_success` event: correlation_id a23833ff-3672-4ca5-9c5d-
// 084627b430e7, code OK, latency_ms 62336, non-empty response — followed by an `unavailable`
// result and analysis_run_id null). This module classifies FRONTIERS only: it does not, and
// cannot, reproduce that historical incident mechanically. No real payload, provider, network,
// Supabase, or secret is used anywhere below — every fixture is synthetic.
//
// Expected to fail at import time with "Cannot find module '../agt002-post-bridge-observability.js'"
// until that module is implemented. That import failure IS the RED signal for this file: it is
// absence of functionality, not a syntax defect in this test.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  AGT002_POST_BRIDGE_STAGES,
  AGT002_POST_BRIDGE_ERROR_CODES,
  classifyAgt002PostBridgeFailure,
} from '../agt002-post-bridge-observability.js';

// Requirement 1: closed catalog of stages. Every literal below must exist, and nothing else
// may leak through classifyAgt002PostBridgeFailure's output (checked further down).
const REQUIRED_STAGES = [
  'transport', 'response_received', 'content_extraction', 'json_parse',
  'model_output_validation', 'envelope_build', 'integral_v3_validation',
  'persistence', 'attempt_update', 'response_serialization', 'unexpected',
];

test('AGT002_POST_BRIDGE_STAGES is a closed catalog containing exactly the required stages', () => {
  assert.ok(AGT002_POST_BRIDGE_STAGES && typeof AGT002_POST_BRIDGE_STAGES === 'object');
  assert.ok(Object.isFrozen(AGT002_POST_BRIDGE_STAGES), 'the stage catalog must be closed (frozen)');
  const values = Object.values(AGT002_POST_BRIDGE_STAGES).sort();
  assert.deepEqual(values, [...REQUIRED_STAGES].sort(), 'the stage catalog must contain exactly the required stages, no more, no less');
});

test('AGT002_POST_BRIDGE_ERROR_CODES is a closed catalog of AGT002_-prefixed sanitary codes', () => {
  assert.ok(AGT002_POST_BRIDGE_ERROR_CODES && typeof AGT002_POST_BRIDGE_ERROR_CODES === 'object');
  assert.ok(Object.isFrozen(AGT002_POST_BRIDGE_ERROR_CODES), 'the error-code catalog must be closed (frozen)');
  const values = Object.values(AGT002_POST_BRIDGE_ERROR_CODES);
  assert.ok(values.length >= 10, 'every stage needs at least one dedicated closed code');
  for (const code of values) assert.match(code, /^AGT002_[A-Z0-9_]+$/, `${code} must be a closed sanitary code`);
  assert.equal(new Set(values).size, values.length, 'error codes must be unique');
  // The unexpected/unknown fallback must itself be a member of the closed catalog, never a
  // free-form string built from the error's own message or code.
  assert.ok(values.includes('AGT002_UNEXPECTED_ERROR'));
});

// Requirement 2: bridge_success/response_received must never be confused with a transport or
// provider-side failure — those never even reached response_received.
test('a transport failure (bridge call itself throws) classifies as transport, never response_received', () => {
  const error = new Error('El servicio de AGT-002 Preview no está disponible.');
  error.code = 'AGT002_CODEX_TRANSPORT_ERROR';
  const result = classifyAgt002PostBridgeFailure({ phase: 'transport', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.TRANSPORT);
  assert.notEqual(result.stage, AGT002_POST_BRIDGE_STAGES.RESPONSE_RECEIVED);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.TRANSPORT_ERROR);
});

test('a cancelled bridge call also classifies as transport, not response_received', () => {
  const error = new Error('La ejecución de AGT-002 Preview fue cancelada.');
  error.code = 'AGT002_CODEX_CANCELLED';
  const result = classifyAgt002PostBridgeFailure({ phase: 'transport', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.TRANSPORT);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.TRANSPORT_ERROR);
});

test('a provider-side error payload (bridge answered, but reports its own failure) classifies as transport/provider, not response_received', () => {
  const error = new Error('El servicio de AGT-002 Preview devolvió un error.');
  error.code = 'AGT002_BRIDGE_INTERNAL';
  const result = classifyAgt002PostBridgeFailure({ phase: 'transport', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.TRANSPORT);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.PROVIDER_ERROR);
  assert.notEqual(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.TRANSPORT_ERROR, 'provider-reported failure must be distinguishable from a pure transport failure');
});

// Requirement 3: non-JSON bridge content must classify as json_parse, never as any transport/
// bridge-success stage.
test('non-JSON content after a successful bridge response classifies as json_parse, never a bridge/transport stage', () => {
  const error = new SyntaxError('Unexpected token in JSON');
  const result = classifyAgt002PostBridgeFailure({ phase: 'json_parse', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.JSON_PARSE);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.JSON_PARSE_FAILED);
  assert.notEqual(result.stage, AGT002_POST_BRIDGE_STAGES.TRANSPORT);
  assert.notEqual(result.stage, AGT002_POST_BRIDGE_STAGES.RESPONSE_RECEIVED);
});

// A missing/empty content field (never even reaches JSON.parse) is a distinct failure mode from
// malformed JSON, and today's engine collapses both into the same catch — this pins the gap.
test('a missing/empty bridge content field classifies as content_extraction, distinct from json_parse', () => {
  const error = new Error('shape');
  const result = classifyAgt002PostBridgeFailure({ phase: 'content_extraction', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.CONTENT_EXTRACTION);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.CONTENT_EXTRACTION_FAILED);
  assert.notEqual(result.stage, AGT002_POST_BRIDGE_STAGES.JSON_PARSE);
});

// Requirement 4: JSON well-formed but the V3 schema/invariants reject it => model_output_validation
// (v2) or integral_v3_validation (v3) — never persistence.
test('valid JSON but invalid model output classifies as model_output_validation for the v2 contract', () => {
  const error = new Error('AGT-002 Preview no produjo una respuesta válida.');
  const result = classifyAgt002PostBridgeFailure({ phase: 'model_output_validation', error, integralContractV3: false });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.MODEL_OUTPUT_VALIDATION);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.MODEL_OUTPUT_INVALID);
  assert.notEqual(result.stage, AGT002_POST_BRIDGE_STAGES.PERSISTENCE);
});

test('valid JSON but invalid V3 invariants classifies as integral_v3_validation, never persistence', () => {
  const error = new Error('AGT-002 Preview no produjo una respuesta válida.');
  const result = classifyAgt002PostBridgeFailure({ phase: 'model_output_validation', error, integralContractV3: true });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.INTEGRAL_V3_VALIDATION);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.INTEGRAL_V3_INVALID);
  assert.notEqual(result.stage, AGT002_POST_BRIDGE_STAGES.PERSISTENCE);
  assert.notEqual(result.stage, AGT002_POST_BRIDGE_STAGES.MODEL_OUTPUT_VALIDATION, 'v3 must not be reported under the v2 stage label');
});

// Requirement 5: schema-valid output but an invalid envelope => envelope_build.
test('a schema-valid output that fails envelope assembly classifies as envelope_build', () => {
  const error = new Error('envelope inválido');
  const result = classifyAgt002PostBridgeFailure({ phase: 'envelope_build', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.ENVELOPE_BUILD);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.ENVELOPE_INVALID);
});

// Requirement 6: a valid envelope rejected by persistence => persistence, never a model/bridge stage.
test('a valid envelope rejected by persistence classifies as persistence', () => {
  const error = new Error('constraint violation');
  const result = classifyAgt002PostBridgeFailure({ phase: 'persistence', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.PERSISTENCE);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.PERSISTENCE_FAILED);
});

// Attempt-lifecycle bookkeeping and response shaping are also closed, distinct stages.
test('a durable attempt-event write failure classifies as attempt_update', () => {
  const error = new Error('append-only write failed');
  const result = classifyAgt002PostBridgeFailure({ phase: 'attempt_update', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.ATTEMPT_UPDATE);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.ATTEMPT_UPDATE_FAILED);
});

test('a response-shaping failure after a successful persist classifies as response_serialization', () => {
  const error = new Error('cannot present analysis');
  const result = classifyAgt002PostBridgeFailure({ phase: 'response_serialization', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.RESPONSE_SERIALIZATION);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.RESPONSE_SERIALIZATION_FAILED);
});

// Requirement 8: closed codes only — an uncoded/unexpected error, or an error carrying an
// arbitrary/injected code string, must NEVER surface as anything other than a catalog member.
test('an unexpected error with no code at all still classifies to a closed stage/code, never a raw string', () => {
  const error = new Error('something nobody anticipated blew up');
  const result = classifyAgt002PostBridgeFailure({ phase: 'unexpected', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.UNEXPECTED);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR);
});

test('an unrecognized/unknown call-site phase always classifies as unexpected, regardless of the error content', () => {
  const error = new Error('unclassified failure from a site the classifier does not recognize');
  const result = classifyAgt002PostBridgeFailure({ phase: 'some_new_unregistered_phase', error });
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.UNEXPECTED);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR);
});

test('an injected/arbitrary error.code string never leaks through as error_code — only catalog members are ever returned', () => {
  const error = new Error('boom');
  error.code = 'sk-live-arbitrary-secret-like-string-injected-by-a-hostile-dependency';
  const result = classifyAgt002PostBridgeFailure({ phase: 'unexpected', error });
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR);
  assert.ok(Object.values(AGT002_POST_BRIDGE_ERROR_CODES).includes(result.error_code));
  assert.ok(!result.error_code.includes('sk-live'));
});

test('every classification, across every phase fixture above, always resolves to a member of the closed catalogs', () => {
  const phases = ['transport', 'content_extraction', 'json_parse', 'model_output_validation', 'envelope_build', 'persistence', 'attempt_update', 'response_serialization', 'unexpected', 'literally_anything_else'];
  const stageValues = new Set(Object.values(AGT002_POST_BRIDGE_STAGES));
  const codeValues = new Set(Object.values(AGT002_POST_BRIDGE_ERROR_CODES));
  for (const phase of phases) {
    for (const codeFixture of [undefined, 'RANDOM_CODE', 'AGT002_CODEX_TRANSPORT_ERROR']) {
      const error = new Error('synthetic');
      if (codeFixture) error.code = codeFixture;
      const result = classifyAgt002PostBridgeFailure({ phase, error });
      assert.ok(stageValues.has(result.stage), `stage "${result.stage}" for phase "${phase}" must be a catalog member`);
      assert.ok(codeValues.has(result.error_code), `error_code "${result.error_code}" for phase "${phase}" must be a catalog member`);
    }
  }
});

// Requirement 12 (classifier slice): the classifier only ever receives/returns structural
// metadata — it must never be handed, and must never echo back, prompt/content/document shaped
// fields. This pins the function's shape so an implementation cannot silently grow an unsafe
// parameter.
test('classifyAgt002PostBridgeFailure output never contains raw error message text or extra fields beyond stage/error_code', () => {
  const error = new Error('this message must never leak: evidence_id document:doc-99 secret-token-abcdefghijklmnopqrstuvwx');
  const result = classifyAgt002PostBridgeFailure({ phase: 'unexpected', error });
  assert.deepEqual(Object.keys(result).sort(), ['error_code', 'stage']);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('evidence_id'));
  assert.ok(!serialized.includes('secret-token'));
  assert.ok(!serialized.includes('this message must never leak'));
});
