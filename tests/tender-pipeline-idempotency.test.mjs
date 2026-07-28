import { strict as assert } from 'node:assert';
import { jobIdempotencyKey, documentIdentity, singularEventKey } from '../tender-pipeline-idempotency.js';

const tenderId = '33333333-3333-4333-8333-333333333333';
const opportunityId = '55555555-5555-4555-8555-555555555555';

// jobIdempotencyKey: igualdad exacta de la cadena para entradas fijas.
assert.equal(
  jobIdempotencyKey({ tenderId, opportunityId, pipelineVersion: 'v1' }),
  `tender:${tenderId}:conversion:${opportunityId}:pipeline:v1`,
);

// Determinismo: dos llamadas iguales producen la misma clave.
assert.equal(
  jobIdempotencyKey({ tenderId, opportunityId, pipelineVersion: 'v1' }),
  jobIdempotencyKey({ tenderId, opportunityId, pipelineVersion: 'v1' }),
);

// documentIdentity distinta al cambiar sourceDocumentId.
const idA = documentIdentity({ opportunityId, source: 'SECOP II', sourceDocumentId: 'doc-1' });
const idB = documentIdentity({ opportunityId, source: 'SECOP II', sourceDocumentId: 'doc-2' });
assert.notEqual(idA, idB);
assert.equal(idA, documentIdentity({ opportunityId, source: 'SECOP II', sourceDocumentId: 'doc-1' }));

// documentIdentity distinta al cambiar source (misma sourceDocumentId).
assert.notEqual(
  documentIdentity({ opportunityId, source: 'SECOP II', sourceDocumentId: 'doc-1' }),
  documentIdentity({ opportunityId, source: 'ESU', sourceDocumentId: 'doc-1' }),
);

// singularEventKey: determinista y distinta al cambiar cualquier campo.
const snapId = '66666666-6666-4666-8666-666666666666';
const keyA = singularEventKey({ eventType: 'snapshot_published', sourceRefType: 'snapshot', sourceRefId: snapId });
const keyB = singularEventKey({ eventType: 'snapshot_published', sourceRefType: 'snapshot', sourceRefId: snapId });
assert.equal(keyA, keyB);
assert.notEqual(
  keyA,
  singularEventKey({ eventType: 'analysis_queued', sourceRefType: 'snapshot', sourceRefId: snapId }),
);

console.log('tender-pipeline-idempotency contract passed');
