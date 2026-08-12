import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildBackfillPlan,
  executeBackfill,
  parseArgs,
  validateManifest,
} from '../scripts/agt002-backfill-document-extractions.mjs';

const opportunityId = '11111111-1111-4111-8111-111111111111';
const tenderId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const buffer = Buffer.from('original verificable');
const tempDirectory = mkdtempSync(join(tmpdir(), 'agt002-backfill-'));
const localPath = join(tempDirectory, 'pliego.pdf');
writeFileSync(localPath, buffer);
const contentHash = createHash('sha256').update(buffer).digest('hex');
const text = 'texto extraído completo';
const textHash = createHash('sha256').update(text).digest('hex');
const manifest = {
  opportunity_id: opportunityId,
  documents: [{
    id: versionId, source_document_id: 'source-1', name: 'pliego.pdf', mime_type: 'application/pdf',
    content_hash: contentHash, sha256: contentHash, local_path: localPath,
  }],
};

assert.equal(parseArgs(['--manifest', '/tmp/manifest.json']).commit, false, 'dry-run debe ser el modo por defecto');
assert.equal(parseArgs(['--manifest', '/tmp/manifest.json', '--commit']).commit, true, '--commit debe ser explícito');
assert.throws(() => validateManifest(manifest, 17), /Se esperaban 17 documentos/, 'el cardinal debe quedar fijado');

const extractionRows = [];
const rpcCalls = [];
const client = {
  async get(path) {
    if (path.startsWith('psi_tender_document_versions?')) return [{ id: versionId, opportunity_id: opportunityId, tender_id: tenderId, content_hash: contentHash, current: true }];
    if (path.startsWith('psi_tender_document_snapshots?')) return [{ id: '55555555-5555-4555-8555-555555555555', actor_id: actorId, tender_id: tenderId, opportunity_id: opportunityId }];
    if (path.startsWith('psi_sales_profiles?')) return [{ id: actorId, identity_type: 'human', active: true }];
    if (path.startsWith('psi_tender_document_extractions?')) return extractionRows;
    throw new Error(`GET inesperado: ${path}`);
  },
  async rpc(name, payload) {
    assert.equal(name, 'psi_record_tender_document_extraction');
    rpcCalls.push(payload);
    extractionRows.push({
      id: '66666666-6666-4666-8666-666666666666', document_version_id: payload.p_document_version_id,
      extractor_version: payload.p_extractor_version, status: payload.p_status, text_hash: payload.p_text_hash,
      char_count: payload.p_char_count,
    });
    return { id: extractionRows.at(-1).id, status: 'created' };
  },
};
const extractImpl = async () => ({
  status: 'ok', text, parser: 'pdf-parse', extractor_version: 'tender-document-text-extraction@2',
  char_count: text.length, text_hash: textHash, metadata: { pages: 1 },
});
const plan = await buildBackfillPlan({
  manifest, expectedCount: 1, client, extractImpl, readFileImpl: () => buffer,
});
assert.equal(plan.items.length, 1);
assert.equal(plan.items[0].action, 'insert');
assert.equal(plan.items[0].rpcParams.p_document_version_id, versionId);
assert.equal(plan.items[0].rpcParams.p_actor_id, actorId);
assert.equal(plan.migrationReady, true);

const committed = await executeBackfill({ client, plan });
assert.deepEqual(committed, { verifiedCount: 1 });
assert.equal(rpcCalls.length, 1);

const idempotentPlan = await buildBackfillPlan({
  manifest, expectedCount: 1, client, extractImpl, readFileImpl: () => buffer,
});
assert.equal(idempotentPlan.items[0].action, 'verify_existing', 'una reejecución debe detectar la extracción ya persistida');

await assert.rejects(
  () => buildBackfillPlan({
    manifest, expectedCount: 1, client,
    extractImpl: async () => ({ status: 'gap', parser: 'pdf-parse', extractor_version: 'tender-document-text-extraction@2', gap_reason: 'empty_extraction', metadata: {} }),
    readFileImpl: () => buffer,
  }),
  /Extracción no verificable/,
  'el backfill debe abortar completo ante un gap',
);

const nonHumanClient = {
  ...client,
  async get(path) {
    if (path.startsWith('psi_sales_profiles?')) return [{ id: actorId, identity_type: 'agent', active: true }];
    return client.get(path);
  },
};
await assert.rejects(
  () => buildBackfillPlan({ manifest, expectedCount: 1, client: nonHumanClient, extractImpl, readFileImpl: () => buffer }),
  /no es un perfil humano activo/,
);

console.log('AGT-002 extraction backfill operator contract passed');
