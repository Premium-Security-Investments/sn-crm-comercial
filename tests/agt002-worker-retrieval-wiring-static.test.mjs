import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of ['server/index.js', 'api/[...path].js']) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const durableWorkerCalls = source.match(/adaptAgt002RetrievalDocuments\(currentDocs, \{ opportunityId, snapshotId \}\)/g) || [];
  const canonicalReanalysisCalls = source.match(/adaptAgt002RetrievalDocuments\(isIncremental \? incrementalInput\.analysisDocuments : currentDocs, \{ opportunityId, snapshotId \}\)/g) || [];

  assert.equal(
    durableWorkerCalls.length,
    1,
    `${file}: el worker durable debe adaptar documentos al contrato cerrado AGT-002`,
  );
  assert.equal(
    canonicalReanalysisCalls.length,
    1,
    `${file}: el reanálisis canónico debe adaptar el delta R1 o los documentos humanos al contrato cerrado AGT-002`,
  );
}

console.log('AGT-002 durable worker retrieval wiring passed');
