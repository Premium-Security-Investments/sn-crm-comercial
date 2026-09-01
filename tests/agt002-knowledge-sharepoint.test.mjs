// AGT-002 knowledge — SharePoint publication + Vig-IA approved-asset selector
// (design §16). RED reason: `agt002-knowledge-sharepoint.js` does not exist
// (publication path/reconciliation), and `vigia-approved-assets.js` does not
// yet export the async `selectVigiaApprovedAssets` selector required by
// §16.3 — both imports fail before any scenario runs.
import assert from 'node:assert/strict';
import { publishTenderKnowledgeVersion } from '../agt002-knowledge-sharepoint.js';
import { selectVigiaApprovedAssets } from '../vigia-approved-assets.js';

const LIBRARY_ROOT = 'Comercial/Licitaciones/02 Biblioteca corporativa';
const KNOWLEDGE_ITEM_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';

function fakeAdapter(overrides = {}) {
  const state = { items: new Map(), calls: [] };
  return {
    state,
    async createOrUpdate({ relativePath, content, expectedETag }) {
      state.calls.push({ op: 'createOrUpdate', relativePath, expectedETag });
      if (overrides.fail) throw overrides.fail;
      const existing = state.items.get(relativePath);
      if (existing && expectedETag && existing.eTag !== expectedETag) {
        const conflict = new Error('etag conflict');
        conflict.code = 'etag_conflict';
        throw conflict;
      }
      const record = {
        relativePath, content, eTag: `etag-${(existing?.version || 0) + 1}`,
        sharepointVersion: String((existing?.version || 0) + 1), driveItemId: existing?.driveItemId || `drive-item-${state.items.size + 1}`,
        webUrl: `https://contoso.sharepoint.com/sites/comercial/${relativePath}`,
      };
      state.items.set(relativePath, { ...record, version: (existing?.version || 0) + 1 });
      return record;
    },
    async get({ relativePath }) { return state.items.get(relativePath) || null; },
  };
}

function versionInput(overrides = {}) {
  return {
    knowledgeItemId: KNOWLEDGE_ITEM_ID, knowledgeVersionId: VERSION_ID, scopeType: 'general',
    title: 'Exigir póliza vigente en procesos con riesgo jurídico', reusableSummary: 'Resumen curado.',
    validFrom: '2026-09-01', validUntil: null, reviewOn: '2027-09-01', tags: ['polizas'],
    confidentiality: 'interno', responsibleProfileName: 'Ana Revisora',
    contentHash: 'a'.repeat(64), actorId: '33333333-3333-4333-8333-333333333333',
    ...overrides,
  };
}

// --- §16.1: root is the exact literal, path is scope/knowledge_item_id.md --
await (async function firstPublishCreatesDeterministicPathUnderExactRoot() {
  const adapter = fakeAdapter();
  const result = await publishTenderKnowledgeVersion({ adapter, ...versionInput() });
  assert.equal(result.library_root, LIBRARY_ROOT);
  assert.equal(result.relative_path, `general/${KNOWLEDGE_ITEM_ID}.md`);
  assert.doesNotMatch(result.relative_path, /Exigir|póliza/i, 'the path must never be derived from the human title');
  assert.match(result.web_url, /^https:\/\/[a-z0-9-]+\.sharepoint\.com\//i);
})();

// --- a second version updates the SAME drive item via If-Match, never a new one
await (async function secondVersionUpdatesSameItemWithIfMatch() {
  const adapter = fakeAdapter();
  const first = await publishTenderKnowledgeVersion({ adapter, ...versionInput() });
  const second = await publishTenderKnowledgeVersion({ adapter, ...versionInput({ knowledgeVersionId: '44444444-4444-4444-8444-444444444444', contentHash: 'b'.repeat(64) }), previousETag: first.e_tag });
  assert.equal(second.drive_item_id, first.drive_item_id, 'a new version must update the same drive_item_id, never create a duplicate');
  assert.notEqual(second.sharepoint_version, first.sharepoint_version);
})();

// --- eTag conflict triggers reconciliation, not a silent overwrite ----------
await (async function etagConflictReconciles() {
  const adapter = fakeAdapter();
  await publishTenderKnowledgeVersion({ adapter, ...versionInput() });
  await assert.rejects(
    publishTenderKnowledgeVersion({ adapter, ...versionInput({ knowledgeVersionId: '55555555-5555-4555-8555-555555555555' }), previousETag: 'stale-etag' }),
    /etag|reconcil/i,
  );
})();

// --- remote success + local persistence failure reconciles by path/hash on
// retry instead of creating a second publication ------------------------------
await (async function remoteSuccessLocalFailureReconcilesOnRetry() {
  const adapter = fakeAdapter();
  const first = await publishTenderKnowledgeVersion({ adapter, ...versionInput(), simulateLocalFailureAfterRemoteSuccess: true }).catch(error => error);
  assert.ok(first instanceof Error, 'a simulated local failure after remote success must surface as an error, not silently succeed');
  const retried = await publishTenderKnowledgeVersion({ adapter, ...versionInput() });
  assert.equal(adapter.state.items.size, 1, 'retry must reconcile the existing remote item by deterministic path, never create a duplicate');
  assert.ok(retried.drive_item_id);
})();

// --- a non-SharePoint host or a signed/query-bearing URL is rejected --------
await (async function rejectsNonSharePointHostAndSignedUrls() {
  const adapter = fakeAdapter();
  adapter.state.items.set(`general/${KNOWLEDGE_ITEM_ID}.md`, {
    relativePath: `general/${KNOWLEDGE_ITEM_ID}.md`, eTag: 'etag-1', version: 1,
    driveItemId: 'drive-item-1', webUrl: 'https://evil.example.com/general/x.md', sharepointVersion: '1',
  });
  await assert.rejects(publishTenderKnowledgeVersion({ adapter, ...versionInput() }), /sharepoint|host/i);
})();

// --- §16.4: SharePoint not configured is a closed 503, never a fabricated publication
await (async function unconfiguredAdapterFailsClosed() {
  await assert.rejects(publishTenderKnowledgeVersion({ adapter: null, ...versionInput() }), /sharepoint_publication_unavailable|no configurad/i);
})();

// ============================================================================
// §16.3: selectVigiaApprovedAssets — async, server-side, DB + JSON, filtered
// ============================================================================

function fakeDb(rows) {
  return { async queryEligiblePublishedKnowledgeAssets() { return rows; } };
}

await (async function selectorCombinesDbAndJsonDeterministically() {
  const asOf = '2026-09-01T00:00:00.000Z';
  const db = fakeDb([
    { asset_id: 'tender-knowledge:aaa:v1', title: 'Póliza vigente', asset_type: 'tender_knowledge', url: 'https://contoso.sharepoint.com/x.md', status: 'approved', valid_until: null, tags: ['polizas'] },
  ]);
  const assets = await selectVigiaApprovedAssets({ db, asOf, jsonPath: new URL('../config/vigia-approved-assets.v1.json', import.meta.url).pathname });
  assert.ok(Array.isArray(assets));
  const ids = assets.map(a => a.asset_id);
  assert.deepEqual(ids, [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), 'assets must be ordered by asset_id bytewise');
})();

await (async function selectorRejectsDuplicateAssetIdsAcrossSources() {
  const asOf = '2026-09-01T00:00:00.000Z';
  const db = fakeDb([{ asset_id: 'duplicate-id', title: 'X', asset_type: 'tender_knowledge', url: 'https://contoso.sharepoint.com/x.md', status: 'approved', valid_until: null, tags: [] }]);
  await assert.rejects(
    selectVigiaApprovedAssets({ db, asOf, staticAssets: [{ asset_id: 'duplicate-id', title: 'Y', asset_type: 'other', url: 'https://contoso.sharepoint.com/y.md', status: 'approved', valid_until: null, tags: [] }] }),
    /duplicad|duplicate/i,
  );
})();

await (async function selectorFailsClosedOnDbError() {
  const db = { async queryEligiblePublishedKnowledgeAssets() { throw new Error('db unavailable'); } };
  await assert.rejects(selectVigiaApprovedAssets({ db, asOf: '2026-09-01T00:00:00.000Z' }), /db unavailable/);
})();

await (async function selectorExcludesIneligibleRowsBeforeAdaptation() {
  const asOf = '2026-09-01T00:00:00.000Z';
  const excludedShapes = [
    { asset_id: 'draft-1', status: 'draft' },
    { asset_id: 'rejected-1', status: 'rechazado' },
    { asset_id: 'replaced-1', status: 'reemplazado' },
    { asset_id: 'restricted-1', confidentiality: 'restringido' },
    { asset_id: 'no-agent-reuse-1', agent_reuse_allowed: false },
    { asset_id: 'expired-1', valid_until: '2020-01-01' },
    { asset_id: 'review-passed-1', review_on: '2020-01-01' },
  ];
  for (const shape of excludedShapes) {
    const db = fakeDb([{
      asset_id: shape.asset_id, title: 'X', asset_type: 'tender_knowledge', url: 'https://contoso.sharepoint.com/x.md',
      status: 'approved', valid_until: shape.valid_until ?? null, tags: [], ...shape,
    }]);
    const assets = await selectVigiaApprovedAssets({ db, asOf });
    assert.equal(assets.some(a => a.asset_id === shape.asset_id), false, `must exclude ${shape.asset_id} before adapting to the manifest`);
  }
})();

console.log('AGT-002 knowledge SharePoint + approved-assets selector contract (RED — modules missing) passed');
