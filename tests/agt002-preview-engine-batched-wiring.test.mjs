// AGT-002 durable batched analysis — Task 6A3 (docs/plans/2026-09-03-agt002-durable-batched-analysis.md,
// "Task 6: Engine orchestration"), TDD RED slice, WIRING TEST ONLY.
//
// This file asserts only COMPOSITION — that agt002-preview-engine.js imports the real Task-4/5/6A1
// building blocks and wires them together — never dynamic behaviour. Correctness of the planner/
// projector (Task 4), the batch contract/merge (Task 5) and the generic orchestration loop (Task 6A1)
// is already covered by tests/agt002-integral-analysis-batches.test.mjs,
// tests/agt002-integral-analysis-batch-contract.test.mjs and tests/agt002-batched-v3-orchestration.test.mjs
// respectively; none of that is re-verified here.
//
// The production source is read as plain text and checked with robust regex/substring matches — never
// exact whitespace or a full implementation snapshot — so this test survives reformatting and only
// breaks if the actual wiring (imports/calls/defaults/routed args) regresses.
//
// RED command: node --test tests/agt002-preview-engine-batched-wiring.test.mjs
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENGINE_PATH = fileURLToPath(new URL('../agt002-preview-engine.js', import.meta.url));
const source = readFileSync(ENGINE_PATH, 'utf8');

// Isolates the leading import block (everything up to the first non-import top-level statement) so
// "imports from module X" assertions can't be satisfied by an unrelated later mention of the name.
const importBlockEnd = source.indexOf('\nexport const AGT002_PREVIEW_POLICY');
assert.ok(importBlockEnd > 0, 'test bug: could not locate end of import block');
const importBlock = source.slice(0, importBlockEnd);

test('imports the Task-4 durable batch planner/projector from agt002-integral-analysis-batches.js', () => {
  const importMatch = importBlock.match(
    /from\s+['"]\.\/agt002-integral-analysis-batches\.js['"]/,
  );
  assert.ok(importMatch, 'expected an import from ./agt002-integral-analysis-batches.js');

  // Find the import statement (single- or multi-line) that resolves to this specifier and check its
  // named bindings, rather than assuming a fixed line count.
  const statementStart = importBlock.lastIndexOf('import', importMatch.index);
  const statementText = importBlock.slice(statementStart, importMatch.index + importMatch[0].length);
  assert.match(statementText, /\bplanAgt002IntegralAnalysisBatches\b/,
    'expected planAgt002IntegralAnalysisBatches to be imported from agt002-integral-analysis-batches.js');
  assert.match(statementText, /\bprojectAgt002IntegralAnalysisBatch\b/,
    'expected projectAgt002IntegralAnalysisBatch to be imported from agt002-integral-analysis-batches.js');
});

test('imports the Task-5 batch contract (schema/validate/merge) from agt002-preview-contract.js', () => {
  const importMatch = importBlock.match(
    /from\s+['"]\.\/agt002-preview-contract\.js['"]/,
  );
  assert.ok(importMatch, 'expected an import from ./agt002-preview-contract.js');
  const statementStart = importBlock.lastIndexOf('import', importMatch.index);
  const statementText = importBlock.slice(statementStart, importMatch.index + importMatch[0].length);

  for (const name of [
    'buildAgt002IntegralAnalysisV3BatchOutputJsonSchema',
    'validateAgt002PreviewModelOutputV3Batch',
    'mergeAgt002IntegralAnalysisV3Batches',
  ]) {
    assert.match(statementText, new RegExp(`\\b${name}\\b`), `expected ${name} to be imported from agt002-preview-contract.js`);
  }
});

test('defines and exports runAgt002BatchedV3Analysis, invoking the generic orchestrator', () => {
  const exportMatch = source.match(
    /export\s+(?:async\s+function\s+runAgt002BatchedV3Analysis\s*\(|const\s+runAgt002BatchedV3Analysis\s*=)/,
  );
  assert.ok(exportMatch, 'expected an exported runAgt002BatchedV3Analysis (function or const) in agt002-preview-engine.js');

  // Scope the search to this function's own source region: from its declaration up to the next
  // top-level `export` after it (or EOF), so the orchestrator-call assertion below cannot be
  // satisfied by an unrelated call elsewhere in the file (e.g. inside runAgt002BatchedV3Orchestration
  // itself, which never calls itself).
  const bodyStart = exportMatch.index + exportMatch[0].length;
  const nextExportOffset = source.slice(bodyStart).search(/\nexport\s/);
  const bodyEnd = nextExportOffset === -1 ? source.length : bodyStart + nextExportOffset;
  const body = source.slice(bodyStart, bodyEnd);

  assert.match(body, /\brunAgt002BatchedV3Orchestration\s*\(/,
    'expected runAgt002BatchedV3Analysis to invoke runAgt002BatchedV3Orchestration');

  // The final envelope is only assembled from the MERGED result (never per-batch), and only after
  // merge — the standard completed-V3 fields (schema/policy/snapshot/coverage/v2 projection/usage)
  // must all appear somewhere in this function's own source.
  assert.match(body, /AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION/, 'expected the standard V3 schema version in the final envelope');
  assert.match(body, /policy_version/, 'expected policy_version in the final envelope');
  assert.match(body, /snapshot_id/, 'expected snapshot_id in the final envelope');
  assert.match(body, /evidence_coverage/, 'expected evidence_coverage in the final envelope');
  assert.match(body, /projectAgt002IntegralV3ToV2\s*\(/, 'expected the v2 projection to be built in the final envelope');
  assert.match(body, /usage\s*:/, 'expected a usage block in the final envelope');

  // No persistence/database call belongs inside the engine's own batched-analysis wiring.
  assert.doesNotMatch(body, /\b(?:INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|\.query\(|require\(['"]pg['"]\)|from\s+['"][^'"]*\/db[^'"]*['"])/i,
    'runAgt002BatchedV3Analysis must never issue persistence/database calls directly');
});

test('createAgt002PreviewEngine defaults batchedV3Orchestrator to runAgt002BatchedV3Analysis', () => {
  assert.match(
    source,
    /batchedV3Orchestrator\s*=\s*runAgt002BatchedV3Analysis\b/,
    'expected the constructor default for batchedV3Orchestrator to be runAgt002BatchedV3Analysis, not null',
  );
});

test('routes to batchedV3Orchestrator only when usesSemanticDiscovery && analysisCheckpointHooks, forwarding client and the existing routed args', () => {
  const gateMatch = source.match(/if\s*\(\s*usesSemanticDiscovery\s*&&\s*analysisCheckpointHooks\s*\)\s*\{/);
  assert.ok(gateMatch, 'expected the batching route to be gated on `usesSemanticDiscovery && analysisCheckpointHooks`');

  const callMatch = source.slice(gateMatch.index).match(/batchedV3Orchestrator\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  assert.ok(callMatch, 'expected a batchedV3Orchestrator({ ... }) call following the routing gate');
  const args = callMatch[1];

  // client must be forwarded (the batched path takes its own provider turns and cannot reach the
  // provider without it), alongside the args this call site already routes today.
  for (const name of [
    'client', 'previewInput', 'validationContext', 'priorUsage', 'model', 'timeoutMs',
    'signal', 'effort', 'checkpointHooks', 'beforeProviderCall', 'idempotencyKey',
  ]) {
    assert.match(args, new RegExp(`\\b${name}\\b`), `expected batchedV3Orchestrator({ ... }) to forward ${name}`);
  }
});

test('the one-turn runOnceV3 still exists and is still used for the no-hooks / fixed-manifest paths', () => {
  assert.match(source, /(?:async\s+)?function\s+runOnceV3\s*\(/, 'expected runOnceV3 to still be defined');

  const callSites = [...source.matchAll(/\brunOnceV3\s*\(/g)];
  // One for the function's own declaration match above plus at least two real call sites (the
  // Manizales/fixed-manifest path and the discovered-frontier-without-hooks path).
  assert.ok(callSites.length >= 3, `expected runOnceV3 to still be invoked at multiple call sites, found ${callSites.length} occurrences`);
});
