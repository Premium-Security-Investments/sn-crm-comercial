import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of ['server/index.js', 'api/[...path].js']) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const adaptedCalls = source.match(/adaptAgt002RetrievalDocuments\(currentDocs, \{ opportunityId, snapshotId \}\)/g) || [];

  assert.equal(
    adaptedCalls.length,
    2,
    `${file}: el worker durable y el reanálisis humano deben adaptar documentos al contrato cerrado AGT-002`,
  );
}

console.log('AGT-002 durable worker retrieval wiring passed');