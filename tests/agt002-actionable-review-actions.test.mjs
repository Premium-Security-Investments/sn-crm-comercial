// AGT-002 actionable review — frontend API client RED (design
// docs/superpowers/specs/2026-08-31-agt002-actionable-review-knowledge-design.md §§4-5, 12.1,
// 12.3). `src/tenders/tenderActionableReviewActions.ts` does not exist yet, so `esbuild.buildSync`
// throws before any scenario runs: there is no client covering list/comment/upload-ticket/
// complete/download/outcome/reopen, no same-origin wiring through the existing api client, and no
// static proof it avoids the official tender-document upload path and the reanalysis endpoint.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const modulePath = new URL('../src/tenders/tenderActionableReviewActions.ts', import.meta.url).pathname;
const bundled = buildSync({ entryPoints: [modulePath], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const { createTenderActionableReviewActions } = await import(moduleUrl);

const UUID = '11111111-1111-4111-8111-111111111111';

function fakeRequest(responses) {
  const calls = [];
  const fn = async (path, options = {}) => {
    calls.push({ path, options });
    const key = `${options.method || 'GET'} ${path.split('?')[0]}`;
    const entry = responses[key];
    if (!entry) throw new Error(`unexpected call ${key}`);
    return entry;
  };
  fn.calls = calls;
  return fn;
}

function fakeApiDownload(blob = new Blob(['x'])) {
  const calls = [];
  const fn = async (url) => { calls.push(url); return blob; };
  fn.calls = calls;
  return fn;
}

// --- Contract 5: list reviews, same-origin, exact query. -------------------------------------
await (async function listReviewsCallsExactSameOriginPath() {
  const request = fakeRequest({ 'GET /api/tender-actionable-reviews': { items: [], summary: { open_count: 0, confirmed_risk_count: 0 } } });
  const actions = createTenderActionableReviewActions({ request, apiDownload: fakeApiDownload() });
  await actions.listReviews('opp-1', 'run-1');
  assert.equal(request.calls.length, 1);
  assert.equal(request.calls[0].path, '/api/tender-actionable-reviews?opportunity_id=opp-1&analysis_run_id=run-1');
})();

// --- Contract 5: add comment. ------------------------------------------------------------------
await (async function addCommentPostsCommentAndIdempotencyKey() {
  const request = fakeRequest({ 'POST /api/tender-actionable-reviews/item-1/comments': { id: 'event-1' } });
  const actions = createTenderActionableReviewActions({ request, apiDownload: fakeApiDownload() });
  await actions.addComment('item-1', 'Comentario de prueba', UUID);
  const call = request.calls[0];
  assert.equal(call.path, '/api/tender-actionable-reviews/item-1/comments');
  assert.equal(call.options.method, 'POST');
  const body = JSON.parse(call.options.body);
  assert.equal(body.comment, 'Comentario de prueba');
  assert.equal(body.idempotency_key, UUID);
})();

// --- Contract 5: issue an upload ticket with the exact backend field names. --------------------
await (async function requestUploadTicketPostsExactFields() {
  const request = fakeRequest({
    'POST /api/tender-actionable-reviews/item-1/attachments/upload-url': { ticket_id: 'ticket-1', nonce: 'nonce-1', storage_path: 'x', upload_token: 't', expires_at: '2026-09-01T00:00:00.000Z' },
  });
  const actions = createTenderActionableReviewActions({ request, apiDownload: fakeApiDownload() });
  await actions.requestUploadTicket('item-1', {
    name: 'soporte.pdf', mimeType: 'application/pdf', sizeBytes: 1024, sha256: 'a'.repeat(64), logicalAttachmentId: 'logical-1',
  });
  const body = JSON.parse(request.calls[0].options.body);
  assert.deepEqual(Object.keys(body).sort(), ['logical_attachment_id', 'mime_type', 'name', 'sha256', 'size_bytes'].sort());
  assert.equal(body.logical_attachment_id, 'logical-1');
})();

// --- Contract 5: complete the upload with ticket id + nonce only (never storage metadata the
// browser asserted). ------------------------------------------------------------------------------
await (async function completeUploadPostsTicketAndNonceOnly() {
  const request = fakeRequest({ 'POST /api/tender-actionable-reviews/item-1/attachments/complete': { id: 'attachment-1' } });
  const actions = createTenderActionableReviewActions({ request, apiDownload: fakeApiDownload() });
  await actions.completeUpload('item-1', 'ticket-1', 'nonce-1');
  const body = JSON.parse(request.calls[0].options.body);
  assert.deepEqual(body, { ticket_id: 'ticket-1', nonce: 'nonce-1' });
})();

// --- Contract 5: authenticated download goes through the shared same-origin apiDownload, never
// a bare fetch to a signed URL from the client. -------------------------------------------------
await (async function downloadAttachmentUsesSharedApiDownload() {
  const apiDownload = fakeApiDownload();
  const actions = createTenderActionableReviewActions({ request: fakeRequest({}), apiDownload });
  await actions.downloadAttachment('attachment-1', 'opp-1');
  assert.equal(apiDownload.calls.length, 1);
  assert.equal(apiDownload.calls[0], '/api/tender-actionable-review-attachments/attachment-1/download?opportunity_id=opp-1');
})();

// --- Contract 5: record outcome — exactly the four closed outcomes, note and reusable flag. ---
await (async function recordOutcomePostsClosedOutcome() {
  const request = fakeRequest({ 'POST /api/tender-actionable-reviews/item-1/outcomes': { id: 'event-1' } });
  const actions = createTenderActionableReviewActions({ request, apiDownload: fakeApiDownload() });
  await actions.recordOutcome('item-1', 'riesgo_confirmado', 'Nota de resolución', true, UUID);
  const body = JSON.parse(request.calls[0].options.body);
  assert.equal(body.outcome, 'riesgo_confirmado');
  assert.equal(body.note, 'Nota de resolución');
  assert.equal(body.reusable_requested, true);
  assert.equal(body.idempotency_key, UUID);
  await assert.rejects(() => actions.recordOutcome('item-1', 'valor_inventado', 'Nota', false, UUID), /resultado/i);
})();

// --- Contract 5: reopen requires a mandatory note. ----------------------------------------------
await (async function reopenPostsMandatoryNote() {
  const request = fakeRequest({ 'POST /api/tender-actionable-reviews/item-1/reopen': { id: 'event-1' } });
  const actions = createTenderActionableReviewActions({ request, apiDownload: fakeApiDownload() });
  await actions.reopen('item-1', 'Nota de reapertura', UUID);
  const body = JSON.parse(request.calls[0].options.body);
  assert.equal(body.note, 'Nota de reapertura');
  await assert.rejects(() => actions.reopen('item-1', '', UUID), /nota/i);
})();

// --- Contract 5D: ensure bridge posts exactly the closed body and returns the public item id,
// never a browser-supplied source_hash, canonical payload or tender_id. --------------------------
await (async function ensureReviewPostsClosedBodyOnly() {
  const request = fakeRequest({
    'POST /api/tender-actionable-reviews/ensure': { id: 'review-item-1', status: 'pendiente', requirement_id: 'req-dyn-poliza' },
  });
  const actions = createTenderActionableReviewActions({ request, apiDownload: fakeApiDownload() });
  const result = await actions.ensureReview('opp-1', 'run-1', 'unit-dyn-01');
  assert.equal(request.calls.length, 1);
  const call = request.calls[0];
  assert.equal(call.path, '/api/tender-actionable-reviews/ensure');
  assert.equal(call.options.method, 'POST');
  const body = JSON.parse(call.options.body);
  assert.deepEqual(body, { opportunity_id: 'opp-1', analysis_run_id: 'run-1', source_kind: 'integral_unit', source_id: 'unit-dyn-01' });
  assert.equal(result.id, 'review-item-1');
})();

// --- No official tender-document upload path and no reanalysis endpoint, statically. -----------
await (async function moduleNeverReferencesOfficialDocumentsOrReanalysis() {
  const source = readFileSync(modulePath, 'utf8');
  for (const forbidden of ['tender-documents', 'question-response', 'reanalyzeAgt002AfterHumanAnswer', 'tender-reanalysis', 'go-no-go', 'source_hash', 'tender_id']) {
    assert.equal(source.includes(forbidden), false, `el cliente no debe referenciar ${forbidden}`);
  }
})();

console.log('AGT-002 actionable review frontend API client contract (RED — module missing) passed');
