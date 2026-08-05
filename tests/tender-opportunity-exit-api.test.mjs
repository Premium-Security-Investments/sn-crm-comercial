import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const serverBuffer = readFileSync(new URL('../server/index.js', import.meta.url));
const apiBuffer = readFileSync(new URL('../api/[...path].js', import.meta.url));
assert.equal(buffersAreEqual(serverBuffer, apiBuffer), true, 'Node and Vercel backends must remain byte-identical');

for (const path of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');

  assert.match(
    source,
    /import \{ callCreateTenderProcessingJob, callTenderOpportunityConversion, callTenderOpportunityDiscard, callTenderOpportunityExit, callTenderTrackingTransition, callTenderTrackingUpdate \} from '\.\.\/tender-tracking-rpc\.js';/,
    `${path} must import the destination-aware exit wrapper`,
  );

  const helper = source.match(/async function exitTenderOpportunity\([\s\S]*?\n}\n\nasync function resolveTenderPipelineSourceContext/);
  assert.ok(helper, `${path} must define one exitTenderOpportunity helper`);
  assert.match(helper[0], /ensureTenderOpportunity\(database, opportunityId, currentProfile\)/, 'access and tender service type must be checked before the exit');
  assert.match(helper[0], /\.from\('psi_public_tenders'\)[\s\S]*?\.select\('id,internal_status,tracking_updated_at'\)[\s\S]*?\.eq\('converted_opportunity_id', opportunityId\)[\s\S]*?\.maybeSingle\(\)/, 'the linked tender and opaque token must be read once');
  assert.match(helper[0], /callTenderOpportunityExit\(database, opportunityId, \{[\s\S]*?destination: input\?\.destination,[\s\S]*?note: input\?\.reason,[\s\S]*?expected_tracking_updated_at: tender\.tracking_updated_at,[\s\S]*?}, currentProfile\)/, 'the exact persisted token must be forwarded to the RPC wrapper');
  assert.doesNotMatch(helper[0], /event_type/, 'client event types must not reach the exit wrapper');
  assert.doesNotMatch(helper[0], /\.from\('psi_sales_opportunities'\)\.update|\.from\('psi_sales_interactions'\)\.insert|\.from\('psi_public_tenders'\)\.update/, 'the backend must delegate all writes to the atomic RPC');

  const route = source.match(/app\.post\('\/api\/tender-opportunity-exit'[\s\S]*?\n}\);/);
  assert.ok(route, `${path} must expose POST /api/tender-opportunity-exit`);
  assert.match(route[0], /getAuthContext\(req\)/, 'the route must require authentication');
  assert.match(route[0], /exitTenderOpportunity\(database, opportunityId, currentProfile, req\.body \|\| \{}\)/, 'the route must call the validated helper');
  assert.match(route[0], /\/desactualizado\/i\.test\(error\?\.message \|\| ''\) \? 409 : error\?\.status \|\| 400/, 'stale tracking conflicts must map to HTTP 409');

  assert.match(source, /app\.post\('\/api\/tender-opportunity-discard'/, 'the legacy discard route must remain during compatibility rollout');
}

console.log('tender opportunity exit API contract passed');
