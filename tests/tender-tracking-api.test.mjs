import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const shared = readFileSync(new URL('../tender-tracking-rpc.js', import.meta.url), 'utf8');
assert.match(shared, /export async function callTenderTrackingUpdate/);
assert.match(shared, /export async function callTenderTrackingTransition/);
assert.match(shared, /rpc\(database, 'psi_update_tender_tracking'/);
assert.match(shared, /rpc\(database, 'psi_transition_tender_tracking'/);
assert.doesNotMatch(shared, /psi_tender_tracking_events/);
assert.doesNotMatch(shared, /trackingRollbackPatch/);

for (const path of ['../api/[...path].js', '../server/index.js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /import \{ callTenderTrackingTransition, callTenderTrackingUpdate \} from '\.\.\/tender-tracking-rpc\.js';/);
  assert.match(source, /app\.get\('\/api\/tender-tracking'/);
  assert.match(source, /app\.get\('\/api\/tender-tracking-events'/);
  assert.match(source, /app\.post\('\/api\/tender-tracking-update'/);
  assert.match(source, /app\.post\('\/api\/tender-tracking-transition'/);
  assert.match(source, /callTenderTrackingUpdate\(requireDb\(\), tenderId, req\.body \|\| \{\}, currentProfile\)/);
  assert.match(source, /callTenderTrackingTransition\(requireDb\(\), tenderId, req\.body \|\| \{\}, currentProfile\)/);
  assert.doesNotMatch(source, /trackingRollbackPatch/);
  assert.doesNotMatch(source, /\.from\('psi_tender_tracking_events'\)\.insert/);

  const statusHandler = source.match(/async function setTenderStatus\([\s\S]*?\n}\n\nconst tenderTrackingIdPattern/);
  assert.ok(statusHandler, 'setTenderStatus must be present');
  assert.match(statusHandler[0], /callTenderTrackingUpdate\(database, tender\.id,/);
  assert.match(statusHandler[0], /callTenderTrackingTransition\(database, tender\.id,/);
  assert.doesNotMatch(statusHandler[0], /\.from\('psi_public_tenders'\)\.update/);
  assert.match(statusHandler[0], /convertida_oportunidad.*conversión/i);

  const conversionHandler = source.match(/async function markTenderConverted\([\s\S]*?\n}\nasync function setTenderStatus/);
  assert.ok(conversionHandler, 'markTenderConverted must be present');
  assert.match(conversionHandler[0], /callTenderTrackingTransition\(database, tenderRecord\.id,/);
  assert.doesNotMatch(conversionHandler[0], /\.from\('psi_public_tenders'\)\.update/);

  const discardStart = source.indexOf('async function markTenderOpportunityDiscarded');
  const discardEnd = source.indexOf("app.get('/api/tender-offer-preparation'", discardStart);
  const discardHandler = discardStart >= 0 && discardEnd > discardStart ? source.slice(discardStart, discardEnd) : null;
  assert.ok(discardHandler, 'markTenderOpportunityDiscarded must be present');
  assert.match(discardHandler, /callTenderTrackingTransition\(database, tender\.id,/);
  assert.doesNotMatch(discardHandler, /\.from\('psi_public_tenders'\)\.update/);
}

console.log('tender tracking API RPC contract passed');
