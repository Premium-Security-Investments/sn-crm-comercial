// AGT-002 fenced lease heartbeat — direct (non-orchestrated) server flows (RED, no production change).
//
// tests/agt002-preview-claim-lease-heartbeat.test.mjs pins the adapter and
// tests/agt002-preview-lease-heartbeat-runtime.test.mjs pins the runtime/engine/post-bridge halves.
// Both leave a hole: the TWO flows in server/index.js that still drive `engine.analyze` and
// `registerAgt002PreviewAnalysis` directly (never through runAgt002PostBridgeAnalysis) hold a preview
// claim from `claimAgt002PreviewRun` and then:
//
//   - build the runtime WITHOUT `database`/`previewClaim`, so the engine can never receive the
//     stage-boundary hook the runtime test already specifies, and
//   - persist WITHOUT renewing, so a V7 run whose N provider turns outlive the two-turn lease writes
//     under a reservation another worker may already own.
//
// The two flows are the processing-job step `requestAgt002` and the legacy (non-canonical) branch of
// POST /api/tender-documents-analyze-agent-preview.
//
// This is a STATIC test: it reads the shipped source, slices exactly those two flows, and asserts the
// ordered wiring. Nothing is imported, executed, mocked or networked — the file only asserts the
// shape of code that already exists, which is why it can fail for the absence of the wiring and for
// nothing else. Positions are asserted as ordered semantic tokens, never as line numbers or
// whitespace.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

const RENEW = 'renewAgt002PreviewClaim(';
const CLAIM = 'claimAgt002PreviewRun(';
const RELEASE = 'releaseAgt002PreviewClaim(';
const ANALYZE = 'engine.analyze(';
const PERSIST = 'registerAgt002PreviewAnalysis(';
const RUNTIME = 'createAgt002PreviewRuntime({';

/** The two flows that persist directly, i.e. without runAgt002PostBridgeAnalysis owning the frontier. */
const DIRECT_FLOWS = [
  {
    label: 'processing job step requestAgt002',
    from: '    requestAgt002: async ({',
    to: '\nexport async function buildTenderOpportunitySummary',
  },
  {
    label: 'legacy branch of POST /api/tender-documents-analyze-agent-preview',
    from: '// canonicalOnly always returns above',
    to: "\napp.get('/api/agt002-reanalysis-status'",
  },
];

function sliceFlow(source, { label, from, to }) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `${label}: flow start marker not found`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `${label}: flow end marker not found`);
  return source.slice(start, end);
}

/** The `{ ... }` literal that follows `key:` (or `(database,`), brace-matched — null when absent. */
function braceLiteralAfter(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return null;
}

const lineStartAt = (text, index) => text.lastIndexOf('\n', index) + 1;
const lineEndAt = (text, index) => {
  const end = text.indexOf('\n', index);
  return end < 0 ? text.length : end;
};
const count = (text, needle) => text.split(needle).length - 1;

test('server/index.js and api/[...path].js stay byte-identical', () => {
  assert.equal(server, api, 'the two production backends must remain byte-identical mirrors');
});

test('the preview persistence module is imported with the renewal adapter', () => {
  const importLine = server
    .split('\n')
    .find(line => line.startsWith('import ') && line.includes('agt002-preview-persistence.js'));
  assert.ok(importLine, 'server/index.js must import agt002-preview-persistence.js');
  assert.match(
    importLine,
    /\brenewAgt002PreviewClaim\b/,
    'the stage-boundary renewal must come from the existing preview persistence module — never be reimplemented inline or re-exported through another module',
  );
});

test('exactly the two direct flows renew, and only after a claim exists', () => {
  assert.equal(
    count(server, RENEW), DIRECT_FLOWS.length,
    'exactly two direct-persistence flows may renew: no duplicated heartbeat, no third call site, no unconditional renewal outside a claimed flow',
  );
  assert.equal(
    count(server, `await ${RENEW}`), DIRECT_FLOWS.length,
    'every renewal must be awaited; a floating promise would let persistence proceed under an unrenewed lease',
  );
});

for (const flow of DIRECT_FLOWS) {
  test(`${flow.label}: the runtime is built with the database and this run's own fenced claim`, () => {
    const text = sliceFlow(server, flow);
    const runtimeAt = text.indexOf(RUNTIME);
    const analyzeAt = text.indexOf(ANALYZE);
    assert.ok(runtimeAt >= 0 && analyzeAt > runtimeAt, `${flow.label}: the runtime must be constructed before it analyzes`);
    const options = text.slice(runtimeAt, analyzeAt);

    assert.match(
      options, /(^|[\s{,])database\s*[,}]/,
      'the runtime cannot renew anything without the database handle the flow already holds',
    );

    const previewClaim = braceLiteralAfter(options, 'previewClaim:');
    assert.ok(
      previewClaim,
      'the runtime must receive an explicit previewClaim literal { idempotencyKey, claimId, leaseSeconds } — otherwise the engine hook specified in tests/agt002-preview-lease-heartbeat-runtime.test.mjs can never be built',
    );
    assert.match(previewClaim, /(^|[\s{,])idempotencyKey\s*[,:}]/, 'previewClaim must carry the reservation key this flow claimed under');
    assert.match(previewClaim, /(^|[\s{,])claimId\s*[,:}]/, 'previewClaim must carry the fencing token returned by claimAgt002PreviewRun');
    assert.match(previewClaim, /leaseSeconds\s*:\s*config\.leaseSeconds/, 'the renewal window must be the configured lease, not a literal or an ad-hoc number');
    assert.doesNotMatch(
      previewClaim, /computeAgt002PreviewIdempotencyKey|randomUUID|Math\.random|crypto/,
      'the claim handed to the runtime must be the token this run already holds — never recomputed and never freshly generated',
    );
  });

  test(`${flow.label}: the lease is renewed between the provider turn and persistence`, () => {
    const text = sliceFlow(server, flow);
    const claimAt = text.indexOf(CLAIM);
    const analyzeAt = text.indexOf(ANALYZE);
    const renewAt = text.indexOf(RENEW);
    const persistAt = text.indexOf(PERSIST);
    assert.ok(claimAt >= 0 && analyzeAt > claimAt && persistAt > analyzeAt, `${flow.label}: expected claim → analyze → persist`);
    assert.ok(
      renewAt > analyzeAt && renewAt < persistAt,
      'the flow must renew AFTER engine.analyze and BEFORE registerAgt002PreviewAnalysis: that boundary is where a long V7 run has already outlived its two-turn lease',
    );
    assert.equal(count(text, RENEW), 1, 'the persistence frontier is one stage boundary: exactly one renewal, never a timer or a retry loop');
    assert.ok(
      renewAt > text.indexOf('claim.claim_id'),
      'no renewal may be emitted before the fencing token exists',
    );

    const args = braceLiteralAfter(text.slice(renewAt), 'renewAgt002PreviewClaim(database,');
    assert.ok(args, 'the renewal must be fenced explicitly: renewAgt002PreviewClaim(database, { idempotencyKey, claimId, leaseSeconds })');
    assert.match(args, /(^|[\s{,])idempotencyKey\s*[,:}]/, 'the renewal must reuse this run\'s idempotency key');
    assert.match(args, /(^|[\s{,])claimId\s*[,:}]/, 'the renewal must be fenced by the claim_id this run holds');
    assert.match(args, /leaseSeconds\s*:\s*config\.leaseSeconds/, 'the renewal must extend by the configured lease window');

    // "Immediately": nothing else is awaited between the provider turn and the renewal, nor between
    // the renewal and the persistence call.
    const betweenAnalyzeAndRenew = text.slice(lineEndAt(text, analyzeAt), lineStartAt(text, renewAt));
    assert.doesNotMatch(
      betweenAnalyzeAndRenew, /\bawait\b|registerAgt002PreviewAnalysis|appendAttempt\(/,
      'the renewal must be the first thing that happens after the provider turn — no other awaited work may widen the window in which the lease can be lost',
    );
    const betweenRenewAndPersist = text.slice(lineEndAt(text, renewAt), lineStartAt(text, persistAt));
    assert.doesNotMatch(
      betweenRenewAndPersist, /\bawait\b/,
      'nothing may be awaited between the renewal and persistence, or the freshly renewed lease is stale again by the time the write happens',
    );
  });

  test(`${flow.label}: a lost lease reaches the catch, and the fenced release still runs last`, () => {
    const text = sliceFlow(server, flow);
    const renewAt = text.indexOf(RENEW);
    const catchAt = text.indexOf('} catch (', renewAt);
    const finallyAt = text.indexOf('} finally {', catchAt);
    assert.ok(catchAt > renewAt, 'the renewal must sit inside the guarded try block, so a lost lease is caught instead of crashing the flow');
    assert.ok(
      finallyAt > catchAt,
      'the existing release must stay in a finally that follows the catch — a lost lease must not skip it',
    );
    assert.ok(
      text.indexOf(PERSIST) < catchAt,
      'persistence must remain inside the same guarded block, after the renewal, so a lost lease short-circuits it',
    );

    const release = braceLiteralAfter(text.slice(finallyAt), RELEASE);
    assert.ok(release, `${flow.label}: the finally must still release the claim`);
    assert.match(release, /(^|[\s{,])idempotencyKey\s*[,:}]/);
    assert.match(release, /(^|[\s{,])claimId\s*[,:}]/, 'the release must stay fenced by the same idempotencyKey + claimId the renewal used');
    assert.equal(count(text, RELEASE), 1, 'the claim is still released exactly once');
  });
}
