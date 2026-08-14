import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

// Static/source-level proof that the temporary AGT-002 fixed-canary secret
// (AGT002_FIXED_CANARY_SECRET / x-agt002-fixed-canary-secret) is wired ONLY as an
// additional OR-branch on the existing scheduler authorizer for the fixed-snapshot
// route, without touching the durable worker's or the Workbench worker's own
// authorizers, without reviving the reserved /api/internal prefix, and without any
// hardcoded opportunity/bypass shortcut.

const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const serverBuffer = readFileSync(new URL('../server/index.js', import.meta.url));
const apiBuffer = readFileSync(new URL('../api/[...path].js', import.meta.url));

const UUID_LITERAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function functionBlock(source, functionSignature) {
  const start = source.indexOf(functionSignature);
  assert.ok(start >= 0, `marker not found: ${functionSignature}`);
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(end > start + 1, `closing brace not found for: ${functionSignature}`);
  return source.slice(start, end);
}

function assertBackend(source, label) {
  assert.ok(!source.includes('/api/internal'), `${label}: must not use the reserved /api/internal prefix`);
  assert.ok(
    source.includes("app.post('/api/agt002-reanalyze-fixed-snapshot', runAgt002FixedSnapshotOperator);"),
    `${label}: the existing fixed-snapshot route registration must stay unchanged`,
  );

  // The new authorizer function: constant-time, dedicated env var + header.
  const authorizerBlock = functionBlock(source, 'function isAgt002FixedCanarySecretAuthorized');
  assert.ok(authorizerBlock.includes('secretMatches('), `${label}: must reuse the existing constant-time secretMatches helper`);
  assert.ok(authorizerBlock.includes('process.env.AGT002_FIXED_CANARY_SECRET'), `${label}: must read AGT002_FIXED_CANARY_SECRET`);
  assert.ok(authorizerBlock.includes("req.headers['x-agt002-fixed-canary-secret']"), `${label}: must read the x-agt002-fixed-canary-secret header`);
  assert.ok(!authorizerBlock.includes('console'), `${label}: must never log the secret or header value`);
  assert.ok(!UUID_LITERAL.test(authorizerBlock), `${label}: must not hardcode any opportunity/entity id as a bypass`);

  // The fixed-snapshot operator must OR the new authorizer onto the existing
  // scheduler authorizer, not replace it.
  assert.match(
    source,
    /authorize: \(\) => isTenderWorkerSchedulerAuthorized\(req\) \|\| isAgt002FixedCanarySecretAuthorized\(req\)/,
    `${label}: fixed-snapshot operator must accept either the existing scheduler secret or the new canary secret`,
  );
  assert.ok(source.includes('sanitizeAgt002FixedSnapshotError(error)'), `${label}: must keep sanitized error output`);

  // The durable tender worker's own authorizer must stay untouched by the new secret.
  const schedulerBlock = functionBlock(source, 'function isTenderWorkerSchedulerAuthorized');
  assert.ok(!schedulerBlock.includes('AGT002_FIXED_CANARY_SECRET'), `${label}: the durable worker scheduler authorizer must not accept the temporary canary secret`);
  assert.ok(schedulerBlock.includes('TENDER_WORKER_SCHEDULER_SECRET'), `${label}: must preserve the existing scheduler secret`);
  assert.ok(schedulerBlock.includes('CRON_SECRET'), `${label}: must preserve the existing Vercel Cron secret`);

  // The Workbench worker's own authorizer must also stay untouched by the new secret.
  const workbenchBlock = functionBlock(source, 'function isAgt002WorkbenchWorkerAuthorized');
  assert.ok(!workbenchBlock.includes('AGT002_FIXED_CANARY_SECRET'), `${label}: the Workbench worker authorizer must not accept the temporary canary secret`);
  assert.ok(workbenchBlock.includes('AGT002_WORKBENCH_WORKER_SECRET'), `${label}: must preserve the existing Workbench worker secret`);
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js and api/[...path].js must be byte-identical');
  console.log('agt002-fixed-canary-secret-static passed');
}
run();
