import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';
import { runAgt002ManizalesV3LocalRun } from '../scripts/agt002-manizales-v3-local-run.mjs';
import {
  verifyAgt002ManizalesCanaryEnvelope,
  buildAgt002ManizalesCanarySanitizedSummary,
  runAgt002ManizalesV3CanaryWithEngine,
  loadAgt002CanaryPrerequisitesInProcess,
  claimAgt002CanaryExecuteMarker,
} from '../scripts/agt002-manizales-v3-canary-run.mjs';

// Phase 5 (Work item 3): TDD gate for the CONTROLLED real-provider canary driver's correctness-
// critical logic — envelope verification, sanitization, and the exactly-once/no-retry contract —
// exercised entirely with fakes (no real provider, no DB). The real read-only assembly is validated
// separately by the driver's no-provider-call preflight against live data. A real, valid governed v3
// envelope (20 abstained units, server-owned manifest_scope, human_review_required) is sourced from
// the local synthetic driver and used as the good fixture; mutated clones drive the failure cases.

const local = await runAgt002ManizalesV3LocalRun();
const goodEnvelope = local.envelope;
const expectedAnalyzableIds = local.expectedAnalyzableIdsInManifestOrder;
const clone = () => JSON.parse(JSON.stringify(goodEnvelope));

// ---------------------------------------------------------------------------------------------
// 1. verify passes a good governed envelope and reports each individual check.
// ---------------------------------------------------------------------------------------------
{
  const v = verifyAgt002ManizalesCanaryEnvelope(goodEnvelope, { expectedAnalyzableIds });
  assert.equal(v.ok, true, `good envelope must pass: ${JSON.stringify(v.failures)}`);
  assert.deepEqual(v.failures, []);
  for (const key of ['contract_version', 'schema_version', 'coverage_ordered_1to1', 'evidence_or_abstention', 'human_review_required', 'manifest_scope']) {
    assert.equal(v.checks[key], true, `check ${key} must be present and true`);
  }
}

// ---------------------------------------------------------------------------------------------
// 2. verify FAILS on each brief-item-3 violation (load-bearing, not tautological).
// ---------------------------------------------------------------------------------------------
{
  let e = clone(); e.integral_analysis.contract_version = 'not-the-contract';
  assert.equal(verifyAgt002ManizalesCanaryEnvelope(e, { expectedAnalyzableIds }).ok, false, 'wrong inner contract_version');

  e = clone(); e.schema_version = '2.0-preview.1';
  assert.equal(verifyAgt002ManizalesCanaryEnvelope(e, { expectedAnalyzableIds }).ok, false, 'wrong envelope schema_version');

  e = clone();
  e.integral_analysis.analysis_units.pop();
  e.integral_analysis.coverage.analyzed_requirement_ids.pop();
  assert.equal(verifyAgt002ManizalesCanaryEnvelope(e, { expectedAnalyzableIds }).ok, false, 'coverage not 1:1 (missing id)');

  e = clone();
  const u = e.integral_analysis.analysis_units;
  [u[0], u[1]] = [u[1], u[0]];
  assert.equal(verifyAgt002ManizalesCanaryEnvelope(e, { expectedAnalyzableIds }).ok, false, 'units out of manifest order');

  e = clone();
  e.integral_analysis.analysis_units[0].assessment_mode = 'assessed';
  e.integral_analysis.analysis_units[0].conclusion.status = 'supported_with_evidence';
  e.integral_analysis.analysis_units[0].evidence_refs = [];
  assert.equal(verifyAgt002ManizalesCanaryEnvelope(e, { expectedAnalyzableIds }).ok, false, 'a unit is neither supported-by-evidence nor abstained');

  e = clone(); e.v2_projection.human_review_required = false;
  assert.equal(verifyAgt002ManizalesCanaryEnvelope(e, { expectedAnalyzableIds }).ok, false, 'human_review_required must be true');

  e = clone(); delete e.manifest_scope;
  assert.equal(verifyAgt002ManizalesCanaryEnvelope(e, { expectedAnalyzableIds }).ok, false, 'missing server-owned manifest_scope');

  e = clone(); e.manifest_scope.analyzable_requirement_ids = e.manifest_scope.analyzable_requirement_ids.slice(0, 19);
  assert.equal(verifyAgt002ManizalesCanaryEnvelope(e, { expectedAnalyzableIds }).ok, false, 'manifest_scope analyzable ids must match the 20');
}

// ---------------------------------------------------------------------------------------------
// 3. Sanitized summary: no open PII, no raw-content / model-prose keys.
// ---------------------------------------------------------------------------------------------
{
  const v = verifyAgt002ManizalesCanaryEnvelope(goodEnvelope, { expectedAnalyzableIds });
  const summary = buildAgt002ManizalesCanarySanitizedSummary(goodEnvelope, v, { mode: 'preflight', providerCallCount: 0 });
  assertNoOpenPii(summary);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(
    serialized,
    /"(quote|excerpt|text|source_text_by_document_id|content|extracted_text|summary|title|reason)"\s*:/,
    'sanitized summary must carry no raw-content / model-prose keys',
  );
  assert.equal(summary.verification.ok, true);
  assert.equal(summary.analyzable_requirement_count, 20);
  assert.equal(summary.every_unit_abstained, true);
}

// ---------------------------------------------------------------------------------------------
// 4. Exactly-once / no-retry contract.
// ---------------------------------------------------------------------------------------------
{
  let okCalls = 0;
  const okEngine = { manifestScope: goodEnvelope.manifest_scope, analyze: async () => { okCalls += 1; return goodEnvelope; } };
  const r = await runAgt002ManizalesV3CanaryWithEngine(okEngine, { snapshotId: 's' }, { expectedAnalyzableIds, mode: 'preflight' });
  assert.equal(okCalls, 1, 'exactly one engine.analyze call on success');
  assert.equal(r.ok, true);
  assert.equal(r.providerCallCount, 0, 'preflight uses the synthetic client and must report zero real-provider calls');
  assert.equal(r.verification.ok, true);
  assertNoOpenPii(r.sanitizedSummary);

  // Failure path: analyze throws once → surfaced as a sanitized blocker, NEVER retried.
  let failCalls = 0;
  const badEngine = {
    manifestScope: null,
    analyze: async () => { failCalls += 1; throw new Error('AGT002_CODEX_TRANSPORT_ERROR: upstream https://secret.example unreachable'); },
  };
  const rf = await runAgt002ManizalesV3CanaryWithEngine(badEngine, { snapshotId: 's' }, { expectedAnalyzableIds, mode: 'execute' });
  assert.equal(failCalls, 1, 'no retry on failure — analyze is invoked at most once');
  assert.equal(rf.ok, false);
  assert.equal(rf.providerCallCount, 1);
  assert.ok(typeof rf.blocker === 'string' && rf.blocker.length > 0, 'a sanitized blocker string is surfaced');
  assert.doesNotMatch(rf.blocker, /https?:\/\//, 'the blocker must not leak a URL');
  assertNoOpenPii({ blocker: rf.blocker, summary: rf.sanitizedSummary });
}

// ---------------------------------------------------------------------------------------------
// 5. Prerequisite precedence regression (NO secrets): explicit non-empty process-env PROVIDER
//    settings win over redacted provider-file placeholders; the read-only Supabase FILE stays
//    authoritative even over an explicit env value. All values here are dummy, non-secret.
// ---------------------------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'agt002-canary-prereq-'));
  const providerFile = join(dir, 'provider.env');
  const supabaseFile = join(dir, 'supabase.env');
  try {
    writeFileSync(providerFile, [
      'TENDER_ANALYSIS_ENGINE=placeholder_',
      'AGT002_PREVIEW_MODEL=placeholder_',
      'AGT002_HETZNER_BRIDGE_URL=placeholder_',
      'AGT002_HETZNER_BRIDGE_HMAC_SECRET=placeholder_',
      'NEXT_PUBLIC_SUPABASE_URL=provider_placeholder',
      'SUPABASE_SERVICE_ROLE_KEY=provider_placeholder',
    ].join('\n'), 'utf8');
    writeFileSync(supabaseFile, [
      'NEXT_PUBLIC_SUPABASE_URL=https://readonly.example.test',
      `SUPABASE_SERVICE_ROLE_KEY=${'r'.repeat(48)}`,
    ].join('\n'), 'utf8');

    const env = {
      // Explicit provider settings (dummy, non-secret, non-empty; HMAC >= 32 to be realistic).
      TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
      AGT002_PREVIEW_MODEL: 'dummy-model-x',
      AGT002_HETZNER_BRIDGE_URL: 'http://127.0.0.1:8787/v1/agt002-preview/run',
      AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'D'.repeat(40),
      // Explicit Supabase URL that MUST be overridden by the read-only file.
      NEXT_PUBLIC_SUPABASE_URL: 'http://should-be-overridden.example',
    };
    const out = loadAgt002CanaryPrerequisitesInProcess({ providerFile, supabaseReadOnlyFile: supabaseFile, environment: env });

    // Explicit provider settings survive the redacted placeholder file.
    assert.equal(env.TENDER_ANALYSIS_ENGINE, 'agt002_codex_preview');
    assert.equal(env.AGT002_PREVIEW_MODEL, 'dummy-model-x');
    assert.equal(env.AGT002_HETZNER_BRIDGE_URL, 'http://127.0.0.1:8787/v1/agt002-preview/run');
    assert.equal(env.AGT002_HETZNER_BRIDGE_HMAC_SECRET, 'D'.repeat(40));
    // The read-only Supabase file remains authoritative (overrides even an explicit env value).
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'https://readonly.example.test');
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, 'r'.repeat(48));
    // Presence booleans reflect the explicit provider + file Supabase; the loader surfaces only
    // key names / booleans, never values.
    assert.equal(out.requiredPresent.bridge_hmac_secret, true);
    assert.equal(out.requiredPresent.bridge_url, true);
    assert.equal(out.requiredPresent.provider_model, true);
    assert.equal(out.requiredPresent.supabase_service_key, true);
    assert.ok(Array.isArray(out.keyNamesSeen) && out.keyNamesSeen.length >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// 6. The one-shot fuse is an atomic filesystem claim, not exists-then-write. The first claimant
//    wins; every later claimant is refused without modifying the marker.
// ---------------------------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'agt002-canary-marker-'));
  const marker = join(dir, 'canary.marker');
  try {
    claimAgt002CanaryExecuteMarker(marker);
    assert.equal(existsSync(marker), true);
    const firstContent = readFileSync(marker, 'utf8');
    assert.match(firstContent, /execute attempted/);
    assert.throws(
      () => claimAgt002CanaryExecuteMarker(marker),
      (error) => error?.code === 'AGT002_CANARY_ALREADY_ATTEMPTED',
      'a second claimant must fail closed through the stable one-shot code',
    );
    assert.equal(readFileSync(marker, 'utf8'), firstContent, 'a refused claimant must not rewrite the marker');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('agt002-manizales-v3-canary-run integration: OK');
