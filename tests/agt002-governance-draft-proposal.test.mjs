import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  AGT002_GOVERNANCE_DRAFT_ARTIFACT_TYPE,
  AGT002_GOVERNANCE_DRAFT_STATUS,
  AGT002_GOVERNANCE_DRAFT_AXES,
  buildAgt002GovernanceDraftProposal,
  validateAgt002GovernanceDraftProposal,
  findAgt002GovernanceDraftForbiddenTextKeyPaths,
} from '../agt002-governance-draft-proposal.js';

// ---------------------------------------------------------------------------
// Governed, auditable, NOT-executable draft of categoryOverrides /
// evidenceClassLinkByRequirementId proposals for a real opportunity, pending human
// approval. This is deliberately a *different*, incompatible shape from
// psi_agt002_integral_governance_overrides curated rows (agt002-integral-governance-
// overrides.js): a proposal has no curated_by/curated_at and can never be fed directly
// into buildAgt002IntegralGovernanceOverrides. Every requirement in the real
// requirement_manifest must be explicitly covered — either by a proposal or by a
// documented abstention — on both governed axes; nothing may be silently missing or
// double-covered, and nothing may carry excerpt/raw document text.
// ---------------------------------------------------------------------------

assert.equal(AGT002_GOVERNANCE_DRAFT_ARTIFACT_TYPE, 'agt002_governance_draft_proposal');
assert.equal(AGT002_GOVERNANCE_DRAFT_STATUS, 'DRAFT');
assert.deepEqual([...AGT002_GOVERNANCE_DRAFT_AXES].sort(), ['category_override', 'evidence_class_link']);

function hash(text) { return createHash('sha256').update(text).digest('hex'); }

const OPPORTUNITY_ID = '54190e51-15fb-46af-b0aa-8f13461a3110';
const SNAPSHOT_ID = 'c33159a5-defe-4a6f-8fa4-68c5ceb60e59';
const EVIDENCE_SNAPSHOT_ID_A = '9a4f4df4-1111-4111-8111-111111111111';
const EVIDENCE_SNAPSHOT_ID_B = 'be9d136f-2222-4222-8222-222222222222';
const DOC_VERSION_ID = 'db9752a1-e9ee-49af-b321-883d0c23cf0a';
const DOC_CONTENT_HASH = hash('pliego-definitivo');

const requirementManifest = {
  requirement_manifest_version: '1.0',
  requirement_manifest: [
    {
      requirement_id: 'financial-working-capital',
      front: 'financial',
      label: 'Capital de trabajo',
      sources: [{ document_id: DOC_VERSION_ID, document_version_id: DOC_VERSION_ID, content_hash: DOC_CONTENT_HASH }],
      unresolved_sources: [],
    },
    {
      requirement_id: 'legal-guarantee-policy',
      front: 'legal',
      label: 'Póliza de cumplimiento',
      sources: [{ document_id: DOC_VERSION_ID, document_version_id: DOC_VERSION_ID, content_hash: DOC_CONTENT_HASH }],
      unresolved_sources: [],
    },
    {
      requirement_id: 'technical-video-surveillance-scope',
      front: 'technical',
      label: 'Alcance de videovigilancia/CCTV',
      sources: [{ document_id: DOC_VERSION_ID, document_version_id: DOC_VERSION_ID, content_hash: DOC_CONTENT_HASH }],
      unresolved_sources: [],
    },
  ],
};

function baseInput(overrides = {}) {
  return {
    opportunityId: OPPORTUNITY_ID,
    snapshotId: SNAPSHOT_ID,
    evidenceChunkSnapshotIds: [EVIDENCE_SNAPSHOT_ID_A, EVIDENCE_SNAPSHOT_ID_B],
    generatedAt: '2026-08-07T00:00:00.000Z',
    version: 1,
    requirementManifest,
    chunkCitations: {
      'financial-working-capital': [{
        document_version_id: DOC_VERSION_ID, document_name: 'Pliego', document_type: 'pliego',
        page: 1, section: 410, chunk_index: 0, chunk_id: `chunk:${DOC_VERSION_ID}:p1:s410:c0`, chunk_hash: hash('chunk-410'),
      }],
      'legal-guarantee-policy': [],
      'technical-video-surveillance-scope': [],
    },
    categoryOverrideProposals: [
      {
        requirement_id: 'financial-working-capital', category_value: 'habilitating',
        rationale: 'El pliego evalúa el índice de capital de trabajo como requisito habilitante financiero (2.2 Capacidad Financiera).',
        source_reference: 'pliego 9. Definitivo SA-24-2026, Capítulo II §2.2 (secciones 408-410)',
        caveat: null,
      },
      {
        requirement_id: 'legal-guarantee-policy', category_value: 'habilitating',
        rationale: 'Las pólizas citadas (RCE, vida colectiva) están numeradas dentro del capítulo de requisitos habilitantes.',
        source_reference: 'pliego 9. Definitivo SA-24-2026, Capítulo II (secciones 227, 289, 350, 356)',
        caveat: 'Una cita (sección 110, cronograma) menciona garantías de ejecución del contrato, fuera de esta categoría; requiere confirmación humana si el requisito se subdivide.',
      },
    ],
    evidenceClassLinkProposals: [
      {
        requirement_id: 'financial-working-capital', evidence_class_id: 'rup',
        rationale: 'El pliego basa expresamente la evaluación financiera en el Registro Único de Proponentes.',
        source_reference: 'pliego 9. Definitivo SA-24-2026, sección 409',
      },
    ],
    abstentions: [
      {
        requirement_id: 'legal-guarantee-policy', axis: 'evidence_class_link',
        reason: 'multiple_distinct_classes_matched_single_requirement',
        detail: 'El requisito agrupa al menos dos pólizas distintas (rce_policy, collective_life_policy); un único enlace no representaría honestamente ambas.',
      },
      {
        requirement_id: 'technical-video-surveillance-scope', axis: 'category_override',
        reason: 'evidence_quality_insufficient_false_positive_dominated',
        detail: 'La mayoría de las citas automáticas corresponden a coincidencias falsas de "Cámara de Comercio", no a videovigilancia real.',
      },
      {
        requirement_id: 'technical-video-surveillance-scope', axis: 'evidence_class_link',
        reason: 'no_catalog_class_conceptually_corresponds',
        detail: 'El catálogo cerrado de 17 clases de evidencia empresarial no contempla alcance técnico de videovigilancia del pliego.',
      },
    ],
    dataGaps: [
      {
        gap_id: 'chunks_missing_for_current_versions',
        description: '14 de los 17 documentos vigentes de la oportunidad no tienen chunks vigentes asociados en psi_tender_document_chunks; no se extrajo evidencia de ellos.',
        affected_document_ids: ['834442625', '834442626'],
      },
    ],
    ...overrides,
  };
}

// --- Happy path: the exact real-shaped draft builds and validates. ---
{
  const draft = buildAgt002GovernanceDraftProposal(baseInput());
  assert.equal(draft.artifact_type, 'agt002_governance_draft_proposal');
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.human_approval_required, true);
  assert.equal(draft.version, 1);
  assert.equal(draft.opportunity_id, OPPORTUNITY_ID);
  assert.equal(draft.snapshot_id, SNAPSHOT_ID);
  assert.deepEqual(draft.evidence_chunk_snapshot_ids, [EVIDENCE_SNAPSHOT_ID_A, EVIDENCE_SNAPSHOT_ID_B].sort());
  assert.equal(draft.category_override_proposals.length, 2);
  assert.equal(draft.evidence_class_link_proposals.length, 1);
  assert.equal(draft.abstentions.length, 3);
  assert.deepEqual(validateAgt002GovernanceDraftProposal(draft), draft);
}

// --- Runtime block: status must always be DRAFT; human_approval_required always true. ---
{
  const draft = buildAgt002GovernanceDraftProposal(baseInput());
  assert.throws(() => validateAgt002GovernanceDraftProposal({ ...draft, status: 'published' }), /status/i);
  assert.throws(() => validateAgt002GovernanceDraftProposal({ ...draft, human_approval_required: false }), /human_approval_required/i);
}

// --- Versioning: version must be a positive integer. ---
{
  const draft = buildAgt002GovernanceDraftProposal(baseInput());
  assert.throws(() => validateAgt002GovernanceDraftProposal({ ...draft, version: 0 }), /version/i);
  assert.throws(() => validateAgt002GovernanceDraftProposal({ ...draft, version: '1' }), /version/i);
}

// --- Trazabilidad: every proposal/abstention/citation requirement_id must exist in the
// real requirement_manifest; an orphan reference is rejected, not silently kept. ---
{
  assert.throws(() => buildAgt002GovernanceDraftProposal({
    ...baseInput(),
    categoryOverrideProposals: [
      ...baseInput().categoryOverrideProposals,
      { requirement_id: 'ghost-requirement', category_value: 'technical', rationale: 'x', source_reference: 'y', caveat: null },
    ],
  }), /ghost-requirement/);

  assert.throws(() => buildAgt002GovernanceDraftProposal({
    ...baseInput(),
    chunkCitations: { ...baseInput().chunkCitations, 'ghost-requirement': [] },
  }), /ghost-requirement/);
}

// --- Cobertura: every manifest requirement must be covered exactly once per axis
// (proposal XOR abstention) — missing coverage fails closed. ---
{
  const input = baseInput();
  input.abstentions = input.abstentions.filter(entry => !(entry.requirement_id === 'technical-video-surveillance-scope' && entry.axis === 'category_override'));
  assert.throws(() => buildAgt002GovernanceDraftProposal(input), /technical-video-surveillance-scope/);
}

// --- Consistencia: no requirement may be double-covered (proposal AND abstention for the
// same axis at once). ---
{
  const input = baseInput();
  input.abstentions = [
    ...input.abstentions,
    { requirement_id: 'financial-working-capital', axis: 'category_override', reason: 'duplicate_test', detail: 'x' },
  ];
  assert.throws(() => buildAgt002GovernanceDraftProposal(input), /financial-working-capital/);
}

// --- Consistencia con extracción: category_value/evidence_class_id must belong to the
// real closed catalogs; the embedded requirement_manifest must independently pass its own
// validator (reuses agt002-deep-analysis-matrix.js, never a private re-implementation). ---
{
  const input = baseInput();
  input.categoryOverrideProposals[0].category_value = 'not-a-real-category';
  assert.throws(() => buildAgt002GovernanceDraftProposal(input), /category_value/i);
}
{
  const input = baseInput();
  input.evidenceClassLinkProposals[0].evidence_class_id = 'not-a-real-class';
  assert.throws(() => buildAgt002GovernanceDraftProposal(input), /evidence_class_id/i);
}
{
  const input = baseInput();
  input.requirementManifest = { requirement_manifest_version: '1.0', requirement_manifest: [] };
  assert.throws(() => buildAgt002GovernanceDraftProposal(input), () => true);
}

// --- evidence_chunk_snapshot_ids: the real snapshot_id(s) actually backing the chunk
// evidence (which the append-only chunking pipeline may have run against a snapshot
// other than the draft's canonical `snapshot_id` — see P2 finding on snapshot_id
// semantics). This is a required, closed field: a plain array of unique UUIDs, sorted. ---
{
  const draft = buildAgt002GovernanceDraftProposal(baseInput());
  assert.deepEqual(draft.evidence_chunk_snapshot_ids, [EVIDENCE_SNAPSHOT_ID_A, EVIDENCE_SNAPSHOT_ID_B].sort());
}
{
  // missing entirely
  const input = baseInput();
  delete input.evidenceChunkSnapshotIds;
  assert.throws(() => buildAgt002GovernanceDraftProposal(input), /evidence_chunk_snapshot_ids/);
}
{
  // not an array
  assert.throws(() => buildAgt002GovernanceDraftProposal({ ...baseInput(), evidenceChunkSnapshotIds: EVIDENCE_SNAPSHOT_ID_A }), /evidence_chunk_snapshot_ids/);
}
{
  // contains a non-UUID entry
  assert.throws(() => buildAgt002GovernanceDraftProposal({ ...baseInput(), evidenceChunkSnapshotIds: ['not-a-uuid'] }), /evidence_chunk_snapshot_ids/);
}
{
  // duplicate entries rejected — must be exactly the distinct set of snapshots involved
  assert.throws(() => buildAgt002GovernanceDraftProposal({
    ...baseInput(),
    evidenceChunkSnapshotIds: [EVIDENCE_SNAPSHOT_ID_A, EVIDENCE_SNAPSHOT_ID_A],
  }), /evidence_chunk_snapshot_ids/);
}
{
  // empty array is a legitimate closed state (no chunk evidence at all) — must not throw
  const input = baseInput();
  input.chunkCitations = { 'financial-working-capital': [], 'legal-guarantee-policy': [], 'technical-video-surveillance-scope': [] };
  input.evidenceChunkSnapshotIds = [];
  const draft = buildAgt002GovernanceDraftProposal(input);
  assert.deepEqual(draft.evidence_chunk_snapshot_ids, []);
}

// --- Never persists document excerpt/raw text anywhere in the artifact. ---
{
  const draft = buildAgt002GovernanceDraftProposal(baseInput());
  assert.doesNotMatch(JSON.stringify(draft), /text_content|"excerpt"/);
  assert.throws(() => validateAgt002GovernanceDraftProposal({
    ...draft,
    chunk_citations: { ...draft.chunk_citations, 'financial-working-capital': [{ ...draft.chunk_citations['financial-working-capital'][0], text_content: 'hidden text' }] },
  }), /texto|text/i);
}

// --- Anti-leak scan is symmetric and recursive over the WHOLE document, not asymmetric
// (Opus P2 #4): today's check only ran on a handful of shallow, named locations plus a
// substring regex over the serialized JSON. The regex is also imprecise: it false-positives
// on legitimate prose that merely mentions the word "text_content", and it never checks the
// full FORBIDDEN_TEXT_KEYS vocabulary against the top-level object or requirement_manifest
// specifically as a structural (key-based) scan. ---
{
  // A rationale that legitimately discusses the word "text_content" as prose must NOT be
  // rejected — this is not a key-based leak, only a value that happens to contain the word.
  const input = baseInput();
  input.categoryOverrideProposals[0].rationale += ' (nota: no confundir con el campo text_content, que aquí no se usa).';
  const draft = buildAgt002GovernanceDraftProposal(input);
  assert.equal(draft.category_override_proposals[0].requirement_id, 'financial-working-capital');
}
{
  // The standalone recursive finder must locate a forbidden key at arbitrary depth, inside
  // both plain objects and arrays, independent of the draft's own specific schema.
  const nested = { a: { b: [{ c: { excerpt: 'leaked' } }] }, d: [[{ raw_text: 'also leaked' }]] };
  const paths = findAgt002GovernanceDraftForbiddenTextKeyPaths(nested);
  assert.equal(paths.length, 2);
  assert.ok(paths.some(p => p.includes('excerpt')));
  assert.ok(paths.some(p => p.includes('raw_text')));
  assert.deepEqual(findAgt002GovernanceDraftForbiddenTextKeyPaths({ a: 1, b: 'text_content mentioned as prose, not a key' }), []);
}

// --- The draft's own shape is structurally incompatible with the real governed loader:
// a proposal has no curated_by/curated_at/version-as-required-by-064, so feeding it
// straight into buildAgt002IntegralGovernanceOverrides (agt002-integral-governance-
// overrides.js) must fail — this is the mechanical proof that the artifact cannot reach
// runtime without a human adding real curation fields first. ---
{
  const { buildAgt002IntegralGovernanceOverrides } = await import('../agt002-integral-governance-overrides.js');
  const draft = buildAgt002GovernanceDraftProposal(baseInput());
  const asOverrideRows = draft.category_override_proposals.map(proposal => ({
    requirement_id: proposal.requirement_id,
    override_kind: 'category_override',
    category_value: proposal.category_value,
    rationale: proposal.rationale,
    source_reference: proposal.source_reference,
  }));
  assert.throws(() => buildAgt002IntegralGovernanceOverrides({ overrideEntries: asOverrideRows }), /curated_by/);
}

console.log('agt002-governance-draft-proposal.test.mjs OK');
