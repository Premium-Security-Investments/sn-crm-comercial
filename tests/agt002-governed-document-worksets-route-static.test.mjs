// Static route contract for the Phase 3 governed-workset freeze/enqueue endpoint
// (.hermes/plans/2026-09-17-agt002-governed-document-worksets.md), mirroring the convention in
// tests/agt002-reanalysis-status.test.mjs: slice the route's own source out of both backends and
// assert on it directly, rather than only exercising it through a live HTTP request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const root = path.resolve(import.meta.dirname, '..');

const serverSource = fs.readFileSync(path.join(root, 'server/index.js'));
const apiSource = fs.readFileSync(path.join(root, 'api/[...path].js'));
assert.ok(buffersAreEqual(serverSource, apiSource), 'server/index.js and api/[...path].js must stay byte-identical');

for (const relative of ['server/index.js', 'api/[...path].js']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');

  assert.match(source, /'POST \/api\/tender-agt002-governed-document-worksets': \['tenders', ACTIONS\.AI_ANALYSIS_RUN\]/, `${relative} declares the route in the auditable HTTP_ACTION_MATRIX`);

  const start = source.indexOf("app.post('/api/tender-agt002-governed-document-worksets'");
  assert.ok(start >= 0, `${relative} must expose the governed workset freeze route`);
  const end = source.indexOf("\napp.", start + 10);
  const route = source.slice(start, end < 0 ? source.length : end);

  // Fail-closed auth/permission ordering: authenticate, then require the exact same
  // Licitaciones/AI-analysis permission AGT-002 already uses, before any body validation or DB call.
  assert.match(route, /getAuthContext\(req\)/);
  const authIndex = route.indexOf('getAuthContext');
  const requireActionIndex = route.indexOf('requireAction(currentProfile, ACTIONS.AI_ANALYSIS_RUN)');
  assert.ok(requireActionIndex > authIndex, `${relative} must require AI_ANALYSIS_RUN authorization immediately after authenticating`);
  const validateIndex = route.indexOf('validateAgt002GovernedWorksetFreezeRequest(req.body)');
  assert.ok(validateIndex > requireActionIndex, `${relative} must validate the closed request body only after authorization succeeds`);

  // The request body is validated through the closed {opportunity_id, documents[]} parser —
  // never spread/passed through raw. tender_id is never read off the client body at all.
  assert.match(route, /validateAgt002GovernedWorksetFreezeRequest\(req\.body\)/);
  assert.doesNotMatch(route, /req\.body\.snapshot_id|req\.body\.content_hash|req\.body\.extraction_id|req\.body\.frozen_engine_input|req\.body\.tender_id/);

  // Server derives the tender id itself — it is never accepted from the client.
  assert.match(route, /getTenderIdForOpportunity\(database, opportunityId\)/);

  // Freeze/enqueue happens through the single orchestration entry point (one call, no ad hoc RPCs here).
  assert.match(route, /freezeAgt002GovernedDocumentWorkset\(database, \{/);
  assert.doesNotMatch(route, /database\.rpc\(/, `${relative}'s route itself must never call an RPC directly — only through freezeAgt002GovernedDocumentWorkset`);

  // Response is the sanitized public projection only.
  assert.match(route, /projectAgt002GovernedWorksetFreezeResult\(result\)/);
  assert.doesNotMatch(route, /frozen_engine_input|extracted_text|storage_path|signed_url/);
  assert.match(route, /Cache-Control.*private, no-store|no-store.*Cache-Control/s);
}

console.log('AGT-002 governed document worksets route static contract passed');
