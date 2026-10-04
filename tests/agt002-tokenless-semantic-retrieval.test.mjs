// Regression for the post-discovery assembly frontier observed after the Cali generation-2 run.
// A source-anchored semantic label may be meaningful even when it contains no alphanumeric token
// of three characters and no two-digit number. Such a valid requirement must still yield one
// honest retrieval term and a complete Preview packet; it must never collapse into
// v4_discovered_input_assembly_failed after the semantic-manifest checkpoint was accepted.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildAgt002PreviewInput,
  buildAgt002TenderRequirementInventory,
} from '../agt002-preview-input.js';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import {
  buildTenderSemanticManifest,
  tenderSemanticRetrievalTerms,
  toAgt002RetrievalRequirements,
} from '../tender-semantic-manifest.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const NBSP = '\u00a0';
const label = `°C${NBSP}a °F`;
const text = [
  'REQUISITOS TÉCNICOS',
  `${label}: el equipo deberá operar entre las unidades indicadas por la ficha técnica.`,
].join('\n');
const snapshotId = '45454545-4545-4454-8454-454545454545';
const opportunityId = '56565656-5656-4565-8565-565656565656';
const documents = [{
  document_id: 'cali-tokenless-doc',
  document_version_id: 'cali-tokenless-doc-v1',
  opportunity_id: opportunityId,
  snapshot_id: null,
  document_type: 'anexo_tecnico',
  name: 'Anexo técnico sintético.pdf',
  version: 1,
  content_hash: sha256(text),
  current: true,
  extracted_text: text,
}];

const inventory = buildAgt002TenderRequirementInventory({ snapshotId, documents, documentGaps: [] });
const semanticManifest = buildTenderSemanticManifest({ inventory, documents });

assert.equal(semanticManifest.requirements.length, 1, 'the source-grounded symbolic clause must remain one requirement');
assert.equal(
  semanticManifest.requirements[0].label,
  '°C a °F',
  'the inventory canonicalizes NBSP to ordinary space before the server derives the label',
);
assert.deepEqual(
  tenderSemanticRetrievalTerms(semanticManifest.requirements[0].label),
  ['°c a °f'],
  'a valid label with no ordinary tokens must fall back to its normalized whole phrase',
);
assert.equal(
  toAgt002RetrievalRequirements(semanticManifest).length,
  1,
  'the accepted semantic manifest must never project to an empty retrieval frontier',
);

const contextV2Sections = {
  ...buildAgt002OpportunityContextV2({
    opportunity: {
      id: opportunityId,
      owner_id: 'owner-synthetic',
      owner_name: 'Persona sintética',
      updated_at: '2026-10-04T00:00:00.000Z',
    },
    tender: {
      id: 'tender-synthetic',
      title: 'Proceso sintético de regresión',
      entity: 'Entidad sintética',
      source: 'SECOP II',
      updated_at: '2026-10-04T00:00:00.000Z',
    },
  }),
  company_dossier: buildAgt002CompanyDossier({
    profile: { legal_name: 'Compañía sintética', updated_at: '2026-10-04T00:00:00.000Z' },
    documents: [],
  }),
};

const previewInput = buildAgt002PreviewInput({
  snapshotId,
  documents,
  documentGaps: [],
  deepAnalysis: {},
  contextV2: true,
  contextV2Sections,
  documentRetrieval: true,
  integralContractV3: true,
  semanticManifest,
});
const evidence = previewInput.document_evidence;
assert.equal(evidence.requirement_manifest.length, 1, 'discovered-input assembly must preserve the requirement');
assert.equal(evidence.selected_chunks.length, 1, 'the normalized whole phrase must retrieve its source chunk');
assert.equal(evidence.coverage_manifest.by_requirement.length, 1);
assert.equal(evidence.coverage_manifest.by_requirement[0].status, 'covered');
assert.deepEqual(evidence.tender_semantic_manifest, semanticManifest, 'the accepted manifest remains the persisted frontier');

const outputRejections = [];
let analysisCalls = 0;
const engine = createAgt002PreviewEngine({
  client: {
    run: async options => {
      analysisCalls += 1;
      assert.equal(options.input.document_evidence.requirement_manifest.length, 1);
      return { content: 'not-json', usage: { input_tokens: 3, output_tokens: 2 } };
    },
  },
  model: 'synthetic-codex-model',
  policyVersion: 'agt002-tokenless-regression-policy',
  policyText: 'POLÍTICA SINTÉTICA',
  timeoutMs: 2000,
  maxConcurrent: 1,
  dailyMaxRuns: 1,
  countDailyRuns: async () => 0,
  contextV2: true,
  documentRetrieval: true,
  integralContractV3: true,
  companyEvidenceClassesProvider: () => [],
  semanticDiscoveryProvider: async () => ({
    semanticManifest,
    categoryOverrides: { [semanticManifest.requirements[0].requirement_id]: 'technical' },
    usage: { input_tokens: 4, output_tokens: 2 },
  }),
  observability: {
    record(event, fields) {
      if (event === 'output_rejected') outputRejections.push(fields);
      return { event, ...fields };
    },
  },
});

await assert.rejects(
  () => engine.analyze({
    snapshotId,
    documents,
    documentGaps: [],
    deepAnalysis: {},
    contextV2Sections,
  }),
  /no produjo una respuesta válida/i,
  'the deliberately invalid analysis response is rejected after assembly, not during assembly',
);
assert.equal(analysisCalls, 1, 'the engine must reach the analysis provider after discovered-input assembly');
assert.equal(
  outputRejections.some(event => event.validation_code === 'v4_discovered_input_assembly_failed'),
  false,
  'the exact post-discovery assembly code observed in Cali must not recur',
);

console.log('AGT-002 tokenless semantic retrieval regression passed');
