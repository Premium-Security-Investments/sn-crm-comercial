import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  buildAgt002RequirementManifest,
  resolveAgt002DeepAnalysisMatrix,
  validateAgt002RequirementManifest,
  AGT002_REQUIREMENT_MANIFEST_UNRESOLVED_REASON,
} from '../agt002-deep-analysis-matrix.js';

function hash(text) { return createHash('sha256').update(text).digest('hex'); }

// --- resolveAgt002DeepAnalysisMatrix: buildTenderDocumentAnalysis returns a legacy visual
// array at .matrix and the real deterministic v1.0 matrix nested at .deep_analysis.matrix.
// The resolver must prefer the nested shape and fall back to a flat object only when it is
// not an array, so legacy/unit-test fixtures that pass the inner shape directly still work. ---

{
  const production = {
    matrix: [{ category: 'Jurídico', status: 'Cumplimiento por validar', detail: 'x' }],
    deep_analysis: { version: '1.0', matrix: { legal: [{ id: 'a', front: 'legal', label: 'A' }], financial: [], technical: [] } },
  };
  assert.deepEqual(resolveAgt002DeepAnalysisMatrix(production), production.deep_analysis.matrix, 'must prefer the nested deterministic matrix over the legacy visual array');
}
{
  const flat = { matrix: { legal: [{ id: 'b', front: 'legal', label: 'B' }], financial: [], technical: [] } };
  assert.deepEqual(resolveAgt002DeepAnalysisMatrix(flat), flat.matrix, 'must fall back to a flat matrix object when no nested shape exists');
}
for (const invalid of [{}, { matrix: [] }, { deep_analysis: {} }, { deep_analysis: { matrix: [] } }, null, undefined]) {
  assert.deepEqual(resolveAgt002DeepAnalysisMatrix(invalid), {}, `must resolve to an empty object for invalid input: ${JSON.stringify(invalid)}`);
}

// --- buildAgt002RequirementManifest ---

const documents = [
  { document_id: 'doc-01', document_version_id: 'ver-01', content_hash: hash('doc-01') },
  { document_id: 'doc-02', document_version_id: 'ver-02', content_hash: hash('doc-02') },
];

{
  // Full resolution: every evidence document_id resolves to a version+hash; id/label/front
  // survive, sources are deduped/sorted deterministically.
  const matrix = {
    legal: [{
      id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento', status: 'confirmed',
      evidence: [
        { document_id: 'ver-02', document_name: 'Doc 2', document_type: 'pliego', excerpt: 'a' },
        { document_id: 'ver-01', document_name: 'Doc 1', document_type: 'pliego', excerpt: 'b' },
        { document_id: 'ver-01', document_name: 'Doc 1', document_type: 'pliego', excerpt: 'c' },
      ],
    }],
    financial: [],
    technical: [],
  };
  const manifest = buildAgt002RequirementManifest({ matrix, documents });
  assert.equal(manifest.requirement_manifest_version, '1.0');
  assert.equal(manifest.requirement_manifest.length, 1);
  const [entry] = manifest.requirement_manifest;
  assert.equal(entry.requirement_id, 'legal-guarantee-policy');
  assert.equal(entry.front, 'legal');
  assert.equal(entry.label, 'Póliza de cumplimiento');
  assert.deepEqual(entry.sources, [
    { document_id: 'doc-01', document_version_id: 'ver-01', content_hash: hash('doc-01') },
    { document_id: 'doc-02', document_version_id: 'ver-02', content_hash: hash('doc-02') },
  ]);
  assert.deepEqual(entry.unresolved_sources, []);
  assert.ok(!Object.hasOwn(entry, 'status'), 'manifest entry keys must be closed to requirement_id/front/label/sources/unresolved_sources');
  assert.doesNotMatch(JSON.stringify(manifest), /excerpt|Póliza de cumplimiento exige/i, 'manifest must never carry evidence excerpt/chunk text');
}

{
  // Unresolved evidence: a document_id absent from `documents` must never invent a source; it
  // becomes an explicit, deterministic unresolved_sources entry instead.
  const matrix = {
    legal: [{
      id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento',
      evidence: [
        { document_id: 'ver-01', document_name: 'Doc 1', document_type: 'pliego', excerpt: 'a' },
        { document_id: 'ver-missing', document_name: 'Doc perdido', document_type: 'pliego', excerpt: 'b' },
      ],
    }],
    financial: [],
    technical: [],
  };
  const manifest = buildAgt002RequirementManifest({ matrix, documents });
  const [entry] = manifest.requirement_manifest;
  assert.deepEqual(entry.sources, [{ document_id: 'doc-01', document_version_id: 'ver-01', content_hash: hash('doc-01') }]);
  assert.deepEqual(entry.unresolved_sources, [{ document_id: 'ver-missing', reason: AGT002_REQUIREMENT_MANIFEST_UNRESOLVED_REASON }]);
}

{
  // adaptAgt002RetrievalDocuments produces {document_id: source_document_id, document_version_id: id}.
  // tender-requirement-extraction's documentIdentity picks document.id ?? document.document_id on
  // whatever `documents` the caller passed to buildTenderDeepAnalysis, so an evidence.document_id
  // may legitimately carry either alias depending on which shape fed that computation. Both the
  // stable source document_id and the version id must resolve to the exact same provenance tuple.
  const matrix = {
    legal: [{
      id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento',
      evidence: [
        { document_id: 'doc-01', document_name: 'Doc 1', document_type: 'pliego', excerpt: 'by stable source id' },
        { document_id: 'ver-02', document_name: 'Doc 2', document_type: 'pliego', excerpt: 'by version id' },
      ],
    }],
    financial: [],
    technical: [],
  };
  const manifest = buildAgt002RequirementManifest({ matrix, documents });
  const [entry] = manifest.requirement_manifest;
  assert.deepEqual(entry.sources, [
    { document_id: 'doc-01', document_version_id: 'ver-01', content_hash: hash('doc-01') },
    { document_id: 'doc-02', document_version_id: 'ver-02', content_hash: hash('doc-02') },
  ]);
  assert.deepEqual(entry.unresolved_sources, [], 'both the source document_id alias and the document_version_id alias must resolve, never left unresolved');
}

{
  // A duplicate alias pointing to two conflicting provenance tuples must fail closed explicitly
  // rather than silently resolving to whichever document happened to be indexed last.
  const conflictingDocuments = [
    { document_id: 'doc-01', document_version_id: 'ver-01', content_hash: hash('doc-01') },
    { document_id: 'ver-01', document_version_id: 'doc-99', content_hash: hash('doc-99') },
  ];
  const matrix = {
    legal: [{ id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento', evidence: [{ document_id: 'ver-01' }] }],
    financial: [],
    technical: [],
  };
  assert.throws(() => buildAgt002RequirementManifest({ matrix, documents: conflictingDocuments }), /ambigu|conflicto/i);
}

{
  // A requirement with no evidence at all carries no provenance claim: it is dropped, not
  // persisted with empty sources.
  const matrix = {
    legal: [
      { id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento', evidence: [{ document_id: 'ver-01' }] },
      { id: 'legal-empty', front: 'legal', label: 'Sin evidencia', evidence: [] },
    ],
    financial: [],
    technical: [],
  };
  const manifest = buildAgt002RequirementManifest({ matrix, documents });
  assert.deepEqual(manifest.requirement_manifest.map(r => r.requirement_id), ['legal-guarantee-policy']);
}

{
  // Fail-closed: if nothing anywhere resolves to a version+hash, never persist a manifest
  // with zero real provenance.
  const matrix = {
    legal: [{ id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento', evidence: [{ document_id: 'ver-missing' }] }],
    financial: [],
    technical: [],
  };
  assert.throws(() => buildAgt002RequirementManifest({ matrix, documents }), /procedencia|resuelt/i);
}

{
  // Fail-closed: an entirely empty matrix (no requirements anywhere) must also throw, never
  // silently return an empty/absent manifest.
  assert.throws(
    () => buildAgt002RequirementManifest({ matrix: { legal: [], financial: [], technical: [] }, documents }),
    /procedencia|resuelt/i,
  );
}

{
  // Multiple fronts, deterministic ordering by requirement_id regardless of front iteration order.
  const matrix = {
    legal: [{ id: 'z-legal', front: 'legal', label: 'Z', evidence: [{ document_id: 'ver-01' }] }],
    financial: [{ id: 'a-financial', front: 'financial', label: 'A', evidence: [{ document_id: 'ver-02' }] }],
    technical: [],
  };
  const manifest = buildAgt002RequirementManifest({ matrix, documents });
  assert.deepEqual(manifest.requirement_manifest.map(r => r.requirement_id), ['a-financial', 'z-legal']);
}

{
  // Duplicate requirement_id across fronts is a structural integrity error, not silently merged.
  const matrix = {
    legal: [{ id: 'dup', front: 'legal', label: 'A', evidence: [{ document_id: 'ver-01' }] }],
    financial: [{ id: 'dup', front: 'financial', label: 'B', evidence: [{ document_id: 'ver-02' }] }],
    technical: [],
  };
  assert.throws(() => buildAgt002RequirementManifest({ matrix, documents }), /duplicad/i);
}

{
  // Deterministic regardless of document/evidence input order.
  const matrix = {
    legal: [{
      id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento',
      evidence: [{ document_id: 'ver-02' }, { document_id: 'ver-01' }],
    }],
    financial: [],
    technical: [],
  };
  const forward = buildAgt002RequirementManifest({ matrix, documents });
  const reversed = buildAgt002RequirementManifest({ matrix, documents: [...documents].reverse() });
  assert.deepEqual(forward, reversed);
}

// --- validateAgt002RequirementManifest: defensive re-check for untrusted envelope input ---

const validManifest = buildAgt002RequirementManifest({
  matrix: { legal: [{ id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza', evidence: [{ document_id: 'ver-01' }] }], financial: [], technical: [] },
  documents,
});

assert.deepEqual(validateAgt002RequirementManifest(validManifest), validManifest);

assert.throws(() => validateAgt002RequirementManifest({ requirement_manifest_version: '2.0', requirement_manifest: [] }), /versión/i);
assert.throws(() => validateAgt002RequirementManifest({ requirement_manifest_version: '1.0', requirement_manifest: [], extra: 1 }), /clave/i);
assert.throws(() => validateAgt002RequirementManifest({ requirement_manifest_version: '1.0', requirement_manifest: [] }), /al menos un requisito/i);
assert.throws(
  () => validateAgt002RequirementManifest({
    requirement_manifest_version: '1.0',
    requirement_manifest: [{ requirement_id: 'r', front: 'legal', label: 'L', sources: [{ document_id: 'd', document_version_id: 'v', content_hash: hash('x'), text: 'leak' }], unresolved_sources: [] }],
  }),
  /texto/i,
  'a source must never be allowed to carry text',
);
assert.throws(
  () => validateAgt002RequirementManifest({
    requirement_manifest_version: '1.0',
    requirement_manifest: [{ requirement_id: 'r', front: 'unknown-front', label: 'L', sources: [{ document_id: 'd', document_version_id: 'v', content_hash: hash('x') }], unresolved_sources: [] }],
  }),
  /front/i,
);
assert.throws(
  () => validateAgt002RequirementManifest({
    requirement_manifest_version: '1.0',
    requirement_manifest: [
      { requirement_id: 'r', front: 'legal', label: 'L', sources: [{ document_id: 'd', document_version_id: 'v', content_hash: hash('x') }], unresolved_sources: [] },
      { requirement_id: 'r', front: 'legal', label: 'L', sources: [{ document_id: 'd', document_version_id: 'v', content_hash: hash('x') }], unresolved_sources: [] },
    ],
  }),
  /duplicad/i,
);
assert.throws(
  () => validateAgt002RequirementManifest({
    requirement_manifest_version: '1.0',
    requirement_manifest: [{ requirement_id: 'r', front: 'legal', label: 'L', sources: [], unresolved_sources: [{ document_id: 'd', reason: 'made_up_reason' }] }],
  }),
  /reason|resuelt/i,
);

console.log('AGT-002 deep analysis matrix resolver and requirement manifest passed');
