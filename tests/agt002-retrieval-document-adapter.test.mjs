import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildAgt002DocumentChunks } from '../agt002-document-chunks.js';
import { adaptAgt002RetrievalDocuments } from '../agt002-retrieval-document-adapter.js';

const opportunityId = '11111111-1111-4111-8111-111111111111';
const snapshotId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';

function apiRecord(overrides = {}) {
  return {
    id: versionId,
    opportunity_id: opportunityId,
    source_document_id: 'official-pliego-01',
    version: 2,
    name: 'Pliego.pdf',
    document_type: 'pliego',
    content_hash: 'a'.repeat(64),
    current: true,
    extracted_text: 'Requiere póliza vigente.',
    storage_path: 'tender-documents/example/pliego.pdf',
    mime_type: 'application/pdf',
    signed_url: 'https://example.invalid/signed',
    ...overrides,
  };
}

test('both production backends wire the adapter into E4 before engine analysis', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api);
  assert.match(server, /adaptAgt002RetrievalDocuments\(currentDocs, \{ opportunityId, snapshotId \}\)/);
  assert.match(server, /documents: analysisDocuments/);
  assert.match(server, /select\('id,opportunity_id,[^']*source_document_id,[^']*version,/);
});

test('projects API records into the exact closed retrieval contract', () => {
  const [document] = adaptAgt002RetrievalDocuments([apiRecord()], { opportunityId, snapshotId });
  assert.deepEqual(Object.keys(document), [
    'document_id', 'document_version_id', 'opportunity_id', 'snapshot_id',
    'document_type', 'name', 'version', 'content_hash', 'current', 'extracted_text',
  ]);
  assert.deepEqual(document, {
    document_id: 'official-pliego-01',
    document_version_id: versionId,
    opportunity_id: opportunityId,
    snapshot_id: snapshotId,
    document_type: 'pliego',
    name: 'Pliego.pdf',
    version: 2,
    content_hash: 'a'.repeat(64),
    current: true,
    extracted_text: 'Requiere póliza vigente.',
  });
});

test('adapted API records satisfy the real chunk builder', () => {
  const documents = adaptAgt002RetrievalDocuments([apiRecord()], { opportunityId, snapshotId });
  const result = buildAgt002DocumentChunks(documents);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].document_id, 'official-pliego-01');
  assert.equal(result.chunks[0].document_version_id, versionId);
  assert.equal(result.chunks[0].snapshot_id, snapshotId);
});

test('fails closed for legacy records without version identity', () => {
  assert.throws(
    () => adaptAgt002RetrievalDocuments([apiRecord({ source_document_id: null })], { opportunityId, snapshotId }),
    /source_document_id/,
  );
  assert.throws(
    () => adaptAgt002RetrievalDocuments([apiRecord({ version: null })], { opportunityId, snapshotId }),
    /version/,
  );
});

test('fails closed when a record belongs to another opportunity', () => {
  assert.throws(
    () => adaptAgt002RetrievalDocuments([apiRecord({ opportunity_id: '44444444-4444-4444-8444-444444444444' })], { opportunityId, snapshotId }),
    /no coincide/,
  );
});
