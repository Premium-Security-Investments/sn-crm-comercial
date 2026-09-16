import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// AGT-002 stakeholder-brief preview — production wiring (RED, first slice). The
// requestAgt002 processing-worker flow must build the preview from the SAME
// envelope it just produced via engine.analyze, using ONLY server-owned entries
// (enabled flag from agt002AnalysisConfig, opportunityId, envelope) plus an
// explicit governedInput: null — intentional fail-closed behavior until a real
// governed five-block input source exists. The call must be locally isolated
// (try/catch) so a thrown lineage/contract violation degrades to an unavailable
// preview instead of crashing the whole requestAgt002 flow. No unit test can
// observe server/index.js's inline route handlers directly, so this is a
// source-text contract, verified once per the requestAgt002 flow.
// ---------------------------------------------------------------------------

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../tender-processing-worker.js', import.meta.url), 'utf8');

function count(source, token) {
  return source.split(token).length - 1;
}

function slice(source, startToken, endToken, label) {
  const start = source.indexOf(startToken);
  assert.ok(start !== -1, `${label}: start anchor not found`);
  const end = source.indexOf(endToken, start);
  assert.ok(end !== -1 && end > start, `${label}: end anchor not found after start`);
  return source.slice(start, end);
}

// Asserts every token in order appears, strictly increasing in position, within `source`.
function assertOrder(source, tokens, label) {
  let cursor = 0;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor);
    assert.ok(index !== -1, `${label}: missing "${token}" at/after position ${cursor}`);
    cursor = index + token.length;
  }
}

assert.equal(server, api, 'server/index.js y api/[...path].js deben permanecer byte-idénticos');

assert.equal(
  count(server, "import { buildAgt002StakeholderBriefPreview } from '../agt002-stakeholder-brief-preview.js';"),
  1,
  'server must import buildAgt002StakeholderBriefPreview exactly once',
);

// Bounded slice around the requestAgt002 processing-worker flow (same anchors used by the
// company-evidence-identity server wiring contract for this flow).
const requestAgt002Slice = slice(
  server,
  'requestAgt002: async ({ jobId, tenderId, opportunityId, snapshotId }) => {',
  'export async function buildTenderOpportunitySummary(',
  'requestAgt002Slice',
);

assert.equal(
  count(requestAgt002Slice, 'buildAgt002StakeholderBriefPreview({'),
  1,
  'requestAgt002 must call buildAgt002StakeholderBriefPreview exactly once',
);

assertOrder(requestAgt002Slice, [
  'const envelope = await engine.analyze',
  'let stakeholderBriefPreview;',
  'try {',
  'stakeholderBriefPreview = buildAgt002StakeholderBriefPreview',
  '} catch {',
  "stakeholderBriefPreview = { status: 'unavailable'",
  'renewAgt002PreviewClaim',
  'registerAgt002PreviewAnalysis',
], 'requestAgt002Slice order');

// The build call must be locally isolated: a thrown lineage/contract violation from
// buildAgt002StakeholderBriefPreview (e.g. a non-V3 envelope shape reaching production)
// must degrade to a well-formed unavailable preview, never crash the whole requestAgt002
// flow or skip renewAgt002PreviewClaim/registerAgt002PreviewAnalysis.
assert.match(
  requestAgt002Slice,
  /\} catch \{\s*stakeholderBriefPreview = \{ status: 'unavailable', stakeholder_brief: null, missing_inputs: \[\] \};\s*\}/,
  'buildAgt002StakeholderBriefPreview failures must be caught locally and degrade to an unavailable preview',
);

// Server-owned entries only: enabled from agt002AnalysisConfig, opportunityId, envelope, and
// an explicit governedInput: null (fail-closed first-slice behavior — never a request/client/
// model field, since no governed five-block input source exists yet).
const previewCallSlice = slice(
  requestAgt002Slice,
  'stakeholderBriefPreview = buildAgt002StakeholderBriefPreview({',
  '});',
  'previewCallSlice',
);
assertOrder(previewCallSlice, [
  'enabled: agt002AnalysisConfig.AGT002_STAKEHOLDER_BRIEF_PREVIEW',
  'opportunityId',
  'envelope',
  'governedInput: null',
], 'previewCallSlice fields');
assert.doesNotMatch(previewCallSlice, /req\.|client|model:/i, 'preview call must never draw from request/client/model fields');

// The completed return must surface stakeholderBriefPreview alongside analysisRunId, but
// registerAgt002PreviewAnalysis must NOT be handed it — it stays response-local only.
const completedReturnSlice = slice(
  requestAgt002Slice,
  'const registeredRun = await registerAgt002PreviewAnalysis(database, {',
  "} catch (error) {",
  'completedReturnSlice',
);
assert.match(
  completedReturnSlice,
  /return \{ status: 'completed', analysisRunId: registeredRun\.run_id, stakeholderBriefPreview \};/,
  'completed return must include stakeholderBriefPreview alongside analysisRunId',
);

const registerCallSlice = slice(
  requestAgt002Slice,
  'const registeredRun = await registerAgt002PreviewAnalysis(database, {',
  '});',
  'registerCallSlice',
);
assert.doesNotMatch(registerCallSlice, /stakeholderBriefPreview/, 'registerAgt002PreviewAnalysis must never receive stakeholderBriefPreview');
assert.doesNotMatch(registerCallSlice, /stakeholder_brief/, 'registerAgt002PreviewAnalysis must never receive stakeholder_brief');

// No new stakeholder-brief database table/persist/save/upsert function anywhere in server —
// scoped to the stakeholder-brief-specific naming so unrelated existing Radar/CRM/enqueue
// persistence code is untouched.
assert.doesNotMatch(
  server,
  /(stakeholder_brief|stakeholderBrief)[A-Za-z_]*\s*(table|Table)\b/,
  'no new stakeholder-brief database table reference expected',
);
assert.doesNotMatch(
  server,
  /(persist|save|upsert)[A-Za-z_]*StakeholderBrief/,
  'no new stakeholder-brief persist/save/upsert function expected',
);
assert.doesNotMatch(
  server,
  /StakeholderBrief[A-Za-z_]*(Persist|Save|Upsert)/,
  'no new stakeholder-brief persist/save/upsert function expected',
);

// The processing worker consumes requestAgt002's `completed` result to drive updateJob and
// appendEvent, but must never write/persist/forward stakeholderBriefPreview into either — it
// may simply ignore the extra return field.
assert.doesNotMatch(
  worker,
  /stakeholderBriefPreview/,
  'tender-processing-worker.js must not reference stakeholderBriefPreview at all',
);
{
  const workerResultSlice = slice(
    worker,
    "const result = await requestAgt002({ jobId, tenderId, opportunityId, snapshotId: claim.snapshot_id });",
    "if (result.status === 'quota'",
    'workerResultSlice',
  );
  assert.doesNotMatch(
    workerResultSlice,
    /stakeholder_brief/,
    'the requestAgt002 completed-result handling in tender-processing-worker.js must not forward stakeholder_brief',
  );
}

console.log('AGT-002 stakeholder-brief preview (first slice) server wiring contract (import wired once, ordered call after engine.analyze/before renewAgt002PreviewClaim/registerAgt002PreviewAnalysis, server-owned args with fail-closed governedInput: null, locally isolated via try/catch degrading to an unavailable preview, completed return exposes it response-locally, never persisted/forwarded) passed');
