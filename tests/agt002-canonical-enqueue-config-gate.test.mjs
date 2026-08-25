// Regression: production incident on Rama Judicial Bogotá (DSAJBO-SAMC-006-2026).
//
// Pressing "Actualizar con Vig-IA Licitaciones" answered HTTP 400 with the raw runtime string
// "AGT-002 Preview no está configurado." and created no corrida. The route only gated on
// isAgt002PreviewConfigured, so a deployment WITH every AGT-002 variable present but with an
// out-of-range AGT002_PREVIEW_* numeric override reached enqueueAgt002CanonicalReanalysis, whose
// first statement is getAgt002PreviewRuntimeConfig — and that function throws the very same
// "no está configurado" message for a config it CAN see but cannot use. The exception escaped to
// sendError as a client error: no `unavailable` attempt row, no queued job, and an operator-facing
// message that contradicts the deployment's actual state.
//
// The durable worker already had the right pattern (agt002-reanalysis-executor.js): every
// pre-claim configuration failure closes as a fixed code before anything is claimed, and no raw
// message ever leaves it. These tests pin that pattern on the HTTP enqueue side.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AGT002_NOT_CONFIGURED_CODE,
  AGT002_RUNTIME_CONFIG_INVALID_CODE,
  agt002CanonicalEnqueueBlockCode,
} from '../agt002-canonical-enqueue-gate.js';
import { getAgt002PreviewRuntimeConfig, isAgt002PreviewConfigured } from '../agt002-preview-runtime.js';
import { buildAgt002FrozenEngineInput, isAgt002QueueableTimeoutMs } from '../agt002-reanalysis-input.js';

function configuredEnv(overrides = {}) {
  return {
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: 'synthetic-codex-model',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
    ...overrides,
  };
}

test('the runtime message is ambiguous by construction, so no caller may gate on isAgt002PreviewConfigured alone', () => {
  // This is the exact production state: every required variable is present, and the runtime still
  // fails with the string the UI printed. Gating on isAgt002PreviewConfigured lets this case
  // through to code that throws it as if the deployment had no configuration at all.
  const environment = configuredEnv({ AGT002_PREVIEW_TIMEOUT_MS: '300000' });
  assert.equal(isAgt002PreviewConfigured(environment), true, 'nothing is missing in this environment');
  assert.throws(() => getAgt002PreviewRuntimeConfig(environment), /AGT-002 Preview no está configurado/);
});

test('a fully configured host with an unusable numeric override is blocked as invalid config, never as "not configured"', () => {
  // The exact production shape: nothing is missing, the turn timeout is simply larger than the
  // durable claim lease can fund.
  const code = agt002CanonicalEnqueueBlockCode(configuredEnv({ AGT002_PREVIEW_TIMEOUT_MS: '300000' }));
  assert.equal(code, AGT002_RUNTIME_CONFIG_INVALID_CODE);
  assert.notEqual(code, AGT002_NOT_CONFIGURED_CODE, 'the deployment IS configured; saying otherwise sends operators to the wrong remediation');

  // Malformed and non-positive overrides land in the same closed code instead of throwing.
  assert.equal(agt002CanonicalEnqueueBlockCode(configuredEnv({ AGT002_PREVIEW_TIMEOUT_MS: 'not-a-number' })), AGT002_RUNTIME_CONFIG_INVALID_CODE);
  assert.equal(agt002CanonicalEnqueueBlockCode(configuredEnv({ AGT002_PREVIEW_MAX_CONCURRENT: '0' })), AGT002_RUNTIME_CONFIG_INVALID_CODE);
  assert.equal(agt002CanonicalEnqueueBlockCode(configuredEnv({ AGT002_PREVIEW_DAILY_MAX_RUNS: '-1' })), AGT002_RUNTIME_CONFIG_INVALID_CODE);
});

test('an absent configuration keeps its own code, and a usable one does not block the enqueue', () => {
  assert.equal(agt002CanonicalEnqueueBlockCode({}), AGT002_NOT_CONFIGURED_CODE);
  assert.equal(agt002CanonicalEnqueueBlockCode(configuredEnv({ AGT002_PREVIEW_MODEL: '   ' })), AGT002_NOT_CONFIGURED_CODE);
  assert.equal(agt002CanonicalEnqueueBlockCode(configuredEnv()), null);
  assert.equal(agt002CanonicalEnqueueBlockCode(configuredEnv({ AGT002_PREVIEW_TIMEOUT_MS: '165000' })), null);
});

test('the enqueue gate stops exactly at the timeout the worker can fund, so no doomed corrida is reserved', () => {
  // The worker rejects an unfundable two-turn lease before claiming (2*t+30 > 600), so anything
  // above 285_000ms would be queued and then die on its first cycle without reaching the provider.
  assert.equal(isAgt002QueueableTimeoutMs(285_000), true);
  assert.equal(isAgt002QueueableTimeoutMs(285_001), false);
  assert.equal(isAgt002QueueableTimeoutMs(480_000), false);
  assert.equal(agt002CanonicalEnqueueBlockCode(configuredEnv({ AGT002_PREVIEW_TIMEOUT_MS: '285000' })), null);
  assert.equal(agt002CanonicalEnqueueBlockCode(configuredEnv({ AGT002_PREVIEW_TIMEOUT_MS: '285001' })), AGT002_RUNTIME_CONFIG_INVALID_CODE);
});

test('the frozen queue contract refuses what the worker refuses', () => {
  const source = {
    runtimeConfig: { model: 'm', policyVersion: 'p', timeoutMs: 285_000, dailyMaxRuns: 20, maxConcurrent: 2 },
    analysisConfig: { AGT002_CANONICAL_ONLY: true, AGT002_CONTEXT_V2: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: false },
    analysisContext: { opportunity: { id: 'opp' }, documents: [], snapshotId: 'snap', canonicalOnly: true },
    idempotencyKey: 'key',
  };
  assert.doesNotThrow(() => buildAgt002FrozenEngineInput(source));
  assert.throws(() => buildAgt002FrozenEngineInput({ ...source, runtimeConfig: { ...source.runtimeConfig, timeoutMs: 285_001 } }));
  assert.throws(() => buildAgt002FrozenEngineInput({ ...source, runtimeConfig: { ...source.runtimeConfig, timeoutMs: 480_000 } }));
});

const backends = [
  ['server/index.js', readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')],
  ['api/[...path].js', readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8')],
];

function canonicalBranch(source) {
  const routeStart = source.indexOf("app.post('/api/tender-documents-analyze-agent-preview'");
  const branchStart = source.indexOf('if (canonicalOnly) {', routeStart);
  const branchEnd = source.indexOf('// canonicalOnly always returns above', branchStart);
  assert.ok(routeStart >= 0 && branchStart > routeStart && branchEnd > branchStart, 'canonical branch must exist');
  return source.slice(branchStart, branchEnd);
}

function humanAnswerHelper(source) {
  const start = source.indexOf('async function reanalyzeAgt002AfterHumanAnswer');
  const end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, 'human-answer reanalysis helper must exist');
  return source.slice(start, end);
}

test('both production backends classify the configuration before reserving, and never leak the runtime message', () => {
  for (const [label, source] of backends) {
    const canonical = canonicalBranch(source);
    const gateIndex = canonical.indexOf('agt002CanonicalEnqueueBlockCode(process.env)');
    const enqueueIndex = canonical.indexOf('enqueueAgt002CanonicalReanalysis(database,');
    assert.ok(gateIndex >= 0, `${label}: the canonical branch must classify the configuration through the shared gate`);
    assert.ok(enqueueIndex > gateIndex, `${label}: nothing may be reserved before the configuration is classified`);
    assert.match(canonical, /error_code: configBlockCode/, `${label}: the closed code must reach the unavailable attempt row`);
    assert.match(canonical, /sendCanonicalState\(503, 'unavailable', 'not_configured'\)/, `${label}: an unusable configuration is an operator state, not a client error`);
    assert.doesNotMatch(canonical, /error\.message|error\.stack|getAgt002PreviewRuntimeConfig/, `${label}: no runtime message or raw config resolution may live in this branch`);

    const helper = humanAnswerHelper(source);
    const helperGate = helper.indexOf('agt002CanonicalEnqueueBlockCode(process.env)');
    assert.ok(helperGate >= 0, `${label}: the human-answer reanalysis must use the same gate`);
    assert.ok(helper.indexOf('enqueueAgt002CanonicalReanalysis(database,') > helperGate, `${label}: a recorded human answer must never fail on an unusable configuration`);
  }
});
