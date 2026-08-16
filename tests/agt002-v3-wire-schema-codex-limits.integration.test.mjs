import { strict as assert } from 'node:assert';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { selectAgt002ManizalesManifestSource } from '../agt002-manizales-manifest-source.js';
import {
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
} from '../agt002-manizales-integral-manifest.js';

// Phase 5 remediation (v3_model_output_shape_mismatch) — Work item 4 (output-ceiling / schema
// complexity inspection), encoded as an executable invariant.
//
// Root-cause inspection finding (offline, no provider): the corrected canary emitted an
// integral_analysis carrying server-owned keys DESPITE a correctly-closed wire schema. Two
// mechanical hypotheses were checked and ruled out:
//   (a) an OUTPUT-token ceiling truncating/deranging the turn — there is NO output-token cap
//       anywhere in this codebase (the only token budgets bound the INPUT retrieval packet in
//       agt002-preview-input.js / agt002-v3-prompt-budget.js), and the corrected turn returned
//       parseable JSON, not a truncated body; and
//   (b) the wire schema being too COMPLEX for the provider to enforce in strict mode and silently
//       degrading to best-effort decoding (which would let server-owned keys slip in).
// This test pins (b): the REAL, checked-in 20-requirement Manizales schema the engine actually
// sends must stay within Codex Structured Outputs strict-mode limits (<=5 object levels, <=100
// total properties — the same limits asserted for a minimal schema in
// tests/agt002-preview-codex-client.test.mjs) AND be recursively closed, so our schema stays inside
// the window where the provider CAN enforce the closed shape in strict mode rather than being forced
// to fall back to best-effort decoding. Whether strict mode actually engages is provider behavior we
// cannot observe offline; what this gate guarantees is that WE never push the schema past the
// documented limits. If a future manifest growth did (which would force best-effort decoding and
// could reopen the exact full-envelope failure mode), this gate fails offline first.
//
// Depth convention: maxObjectDepth counts OBJECT nesting levels only (nodes with type:'object'),
// matching Codex's "object levels" limit and the depth metric in the codex-client wire test; array
// and anyOf levels do not add an object level. The real schema measures depth=4 that way.

// Codex Structured Outputs strict-mode limits (mirrors tests/agt002-preview-codex-client.test.mjs).
const CODEX_MAX_OBJECT_DEPTH = 5;
const CODEX_MAX_TOTAL_PROPERTIES = 100;
// The bridge rejects a request body over 1 MiB (AGT002_BRIDGE_MAX_BODY_BYTES); the schema is only
// part of that body, so it must be comfortably small on its own.
const SCHEMA_BYTES_CEILING = 131_072; // 128 KiB — a generous guard; the real schema is ~10 KiB.

function build17ClassRegistry() {
  return [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort().map((classId) => ({
    entry_id: classId, document_class: classId, existence_status: 'reported',
    human_review_status: 'pending_human_review', applicability_status: 'pending_case_validation',
    integration_active: true, expiry: null, updated_at: '2026-01-01T00:00:00.000Z',
  }));
}

// A capturing client that records the exact outputSchema the engine assembles for the real
// manifest, then abstains every unit (the governed run always abstains) so analyze() completes.
function capturingClient(capture) {
  return {
    async run(options) {
      capture.outputSchema = options.outputSchema;
      const manifest = options.input.document_evidence.requirement_manifest;
      const units = manifest.map((entry, index) => ({
        unit_id: `UNIT-${index + 1}`, unit_kind: 'tender_requirement', requirement_id: entry.requirement_id,
        category: null, sequence: index + 1, title: `Requisito ${index + 1}`, assessment_mode: 'abstained',
        conclusion: { status: 'human_validation_required', summary: 'Pendiente de validación humana.', confidence: 'unavailable' },
        blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'Sin determinación automática.' },
        evidence_state: null, evidence_refs: [], missing_evidence: [],
        commercial_impact: { level: 'unknown', summary: 'Impacto no determinado.', dimension: 'unknown' },
        legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
        actions: [], milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
        closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida.', evidence_required: [] },
        human_validation: { required: true, status: 'pending', reason: 'Validación humana pendiente.' },
      }));
      return { content: JSON.stringify({ integral_analysis: { analysis_units: units } }), usage: { input_tokens: 11, output_tokens: 11 } };
    },
  };
}

function measureSchema(node, objectDepth, acc) {
  if (!node || typeof node !== 'object') return acc;
  if (Object.hasOwn(node, 'const')) acc.constCount += 1;
  if (Array.isArray(node.enum)) acc.totalEnumValues += node.enum.length;
  if (node.type === 'object') {
    const depth = objectDepth + 1;
    acc.maxObjectDepth = Math.max(acc.maxObjectDepth, depth);
    if (node.additionalProperties !== false) acc.openObjectCount += 1;
    if (node.properties) {
      acc.totalProperties += Object.keys(node.properties).length;
      for (const child of Object.values(node.properties)) measureSchema(child, depth, acc);
    }
  }
  if (node.type === 'array' && node.items) measureSchema(node.items, objectDepth, acc);
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(node[keyword])) for (const child of node[keyword]) measureSchema(child, objectDepth, acc);
  }
  return acc;
}

const source = selectAgt002ManizalesManifestSource({
  integralContractV3: true,
  opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  process: AGT002_INTEGRAL_MANIFEST_PROCESO,
});
const analyzableCount = source.entries.filter((entry) => entry.analyzable === true).length;
assert.equal(analyzableCount, 20, 'the checked-in Manizales manifest has 20 analyzable requirements');

const capture = { outputSchema: null };
const engine = createAgt002PreviewEngine({
  client: capturingClient(capture), model: 'wire-schema-guard-model', policyVersion: 'agt002-integral-v3-policy-guard',
  timeoutMs: 2000, maxConcurrent: 1, dailyMaxRuns: 1, countDailyRuns: async () => 0,
  idGenerator: () => '99999999-9999-4999-8999-999999999999',
  contextV2: true, documentRetrieval: true, integralContractV3: true,
  companyEvidenceClassesProvider: () => build17ClassRegistry(),
  manizalesManifestSource: source,
});

await engine.analyze({
  documents: [{
    document_id: 'doc-guard-01', document_version_id: 'ver-guard-01', opportunity_id: 'opp-manizales-guard',
    snapshot_id: null, document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64),
    current: true, extracted_text: 'Documento de contexto sintético.',
  }],
  deepAnalysis: { matrix: { legal: [], financial: [], technical: [] } },
  snapshotId: '55555555-5555-4555-8555-555555555555',
  contextV2Sections: {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-manizales-guard', updated_at: '2026-08-01T10:00:00.000Z' },
      tender: { id: 'tender-manizales-guard', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-08-01T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({ profile: { legal_name: 'Proveedor Sintético Ltda.', updated_at: '2026-08-01T10:00:00.000Z' }, documents: [] }),
  },
});

const schema = capture.outputSchema;
assert.ok(schema, 'the engine must have assembled and sent an outputSchema for the real manifest');

// The closed shape that forbids server-owned keys is present in the real schema.
assert.equal(schema.additionalProperties, false);
assert.deepEqual(schema.required, ['integral_analysis']);
assert.equal(schema.properties.integral_analysis.additionalProperties, false);
assert.deepEqual(schema.properties.integral_analysis.required, ['analysis_units']);
assert.deepEqual(Object.keys(schema.properties.integral_analysis.properties), ['analysis_units']);

const metrics = measureSchema(schema, 0, { maxObjectDepth: 0, totalProperties: 0, totalEnumValues: 0, constCount: 0, openObjectCount: 0 });
const serializedBytes = Buffer.byteLength(JSON.stringify(schema), 'utf8');

// The real 20-requirement schema stays within Codex strict-mode limits, so nothing on OUR side
// forces the provider off strict decoding of the closed shape (see the depth-convention note above).
assert.ok(metrics.maxObjectDepth <= CODEX_MAX_OBJECT_DEPTH, `real schema object depth ${metrics.maxObjectDepth} must be <= ${CODEX_MAX_OBJECT_DEPTH}`);
assert.ok(metrics.totalProperties <= CODEX_MAX_TOTAL_PROPERTIES, `real schema total properties ${metrics.totalProperties} must be <= ${CODEX_MAX_TOTAL_PROPERTIES}`);
assert.equal(metrics.openObjectCount, 0, 'every object level of the real schema must be closed (additionalProperties:false)');
assert.ok(serializedBytes <= SCHEMA_BYTES_CEILING, `real schema serialized bytes ${serializedBytes} must be <= ${SCHEMA_BYTES_CEILING}`);

// The property count is manifest-size-independent (analysis_units is one shared item schema), so
// this reflects the real structural budget, not just this fixture. Recorded for the Phase 5 report:
//   depth=4  totalProperties=71  totalEnumValues=174  const=5  bytes~=10217
assert.ok(metrics.totalEnumValues > 0 && metrics.constCount > 0, 'sanity: the schema carries enums and const markers');

console.log(`agt002-v3-wire-schema-codex-limits.integration.test.mjs OK (depth=${metrics.maxObjectDepth} props=${metrics.totalProperties} enums=${metrics.totalEnumValues} bytes=${serializedBytes})`);
