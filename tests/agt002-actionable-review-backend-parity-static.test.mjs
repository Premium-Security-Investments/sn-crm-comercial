// AGT-002 actionable review — backend parity and no-reanalysis static gate
// (design §12.1, §19.3, §19.7). RED reason: none of the new routes exist yet
// in either `server/index.js` or `api/[...path].js`, so every route-presence
// assertion below fails; the file also encodes the permanent static
// invariant (§19.7) that these routes must never call the legacy reanalysis
// or document-refresh machinery, checked once the routes exist.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..');

const serverBuffer = await readFile(resolve(projectRoot, 'server/index.js'));
const apiBuffer = await readFile(resolve(projectRoot, 'api/[...path].js'));
const server = serverBuffer.toString('utf8');
const api = apiBuffer.toString('utf8');

const NEW_ROUTE_PATHS = [
  '/api/tender-actionable-reviews',
  '/api/tender-actionable-reviews/ensure',
  '/api/tender-actionable-reviews/:itemId/comments',
  '/api/tender-actionable-reviews/:itemId/attachments/upload-url',
  '/api/tender-actionable-reviews/:itemId/attachments/complete',
  '/api/tender-actionable-reviews/:itemId/outcomes',
  '/api/tender-actionable-reviews/:itemId/reopen',
  '/api/tender-actionable-reviews/:itemId/knowledge-candidates/generate',
  '/api/tender-actionable-review-attachments/:attachmentId/download',
  '/api/tender-knowledge-items/:knowledgeItemId',
  '/api/tender-knowledge-items/:knowledgeItemId/versions',
  '/api/tender-knowledge-versions/:knowledgeVersionId/submit',
  '/api/tender-knowledge-versions/:knowledgeVersionId/approve',
  '/api/tender-knowledge-versions/:knowledgeVersionId/reject',
  '/api/tender-knowledge-versions/:knowledgeVersionId/publish',
];

const FORBIDDEN_CALLS = [
  'reanalyzeAgt002AfterHumanAnswer',
  'enqueueAgt002CanonicalReanalysis',
  'psi_begin_tender_document_refresh',
];

// --- §12.1: byte-for-byte deployed backend parity is a merge gate ----------
assert.equal(buffersAreEqual(serverBuffer, apiBuffer), true, 'server/index.js and api/[...path].js must remain byte-for-byte identical');

// --- every new route must exist in BOTH backends ----------------------------
for (const path of NEW_ROUTE_PATHS) {
  assert.ok(server.includes(path), `server/index.js must register ${path}`);
  assert.ok(api.includes(path), `api/[...path].js must register ${path}`);
}

// --- §19.7: the new routes never call reanalysis/document-refresh/GO-NO-GO --
for (const forbidden of FORBIDDEN_CALLS) {
  assert.doesNotMatch(server, new RegExp(`${forbidden}[\\s\\S]{0,4000}tender-actionable-review`, 'i'),
    `server/index.js must not wire ${forbidden} anywhere near the actionable review routes`);
}
assert.doesNotMatch(server, /tender-actionable-reviews[\s\S]{0,4000}(psi_record_tender_go_no_go|go_no_go)/i,
  'server/index.js actionable review routes must never touch the GO/NO-GO RPC');

// --- §16.3: the async selector replaces the sync loader used before AGT
// input is built, with the same filters applied identically in both backends
assert.ok(server.includes('selectVigiaApprovedAssets'), 'server/index.js must call the async selectVigiaApprovedAssets selector');
assert.ok(api.includes('selectVigiaApprovedAssets'), 'api/[...path].js must call the async selectVigiaApprovedAssets selector');

console.log('AGT-002 actionable review backend parity + no-reanalysis static gate passed');
