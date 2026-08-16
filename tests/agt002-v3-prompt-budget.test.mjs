import { strict as assert } from 'node:assert';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import {
  estimateAgt002V3RequestTokens,
  measureAgt002V3RequestBytes,
  budgetAgt002V3PromptRequest,
  AGT002_V3_PROMPT_BUDGET_EXCEEDED_CODE,
  AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS,
} from '../agt002-v3-prompt-budget.js';

// AGT-002 · Phase 5 remediation regression gate for the PROVEN context_window_exceeded canary
// failure. The single controlled real-provider canary was rejected at admission because the
// integral-V3 prompt (large output schema + full real context) exceeded the model context window.
// This gate proves the server-owned, deterministic prompt-budgeting that reduces ONLY redundant raw
// document/context payload (selected_chunks[].text) while preserving every governed requirement id,
// the manifest metadata, the 17 evidence classes, the citation/evidence boundaries and the
// abstention semantics — and fails CLOSED before any provider call when still too large.
//
// Two layers: (A) the pure budgeting function on a 20-requirement / 17-class synthetic model input;
// (B) the real engine (runOnceV3 boundary) behind the promptBudget flag, with a fake client that
// captures the exact request the provider would receive — never a real provider, never a DB write.

// ---------------------------------------------------------------------------------------------
// Fixtures (hermetic, no network, no DB): a model-input shaped exactly like what the engine hands
// the client for a manifest-driven V3 run — 20 ordered requirements, governed evidence-state,
// 17 company-evidence classes, a citation allowlist, and several sizable raw document chunks.
// ---------------------------------------------------------------------------------------------
const GOVERNED_EVIDENCE_STATE = Object.freeze({
  presence: 'not_present', review: 'not_reviewed', validity: 'unknown', applicability: 'unknown', compliance: 'unknown',
});

function buildRequirementManifest() {
  return Array.from({ length: 20 }, (_unused, index) => {
    const requirementId = `REQ-${String(index + 1).padStart(2, '0')}`;
    return {
      requirement_id: requirementId,
      terms: [`termino${index + 1}`],
      category: 'technical',
      evidence_state_governed: { ...GOVERNED_EVIDENCE_STATE },
    };
  });
}

function buildSeventeenEvidenceClasses() {
  return {
    manifest_version: 'agt002-company-evidence-classes-v1',
    classes: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort().map((classId) => ({
      class_id: classId,
      presence_status: 'not_verified',
      source: { reference: null },
      applicability_status: 'pending_case_validation',
    })),
  };
}

function buildSelectedChunks(count, charsPerChunk) {
  return Array.from({ length: count }, (_unused, index) => {
    const chunkId = `chunk-${String(index + 1).padStart(2, '0')}`;
    // Deliberately verbose, clearly-synthetic raw excerpt text (no PII): this is the ONLY
    // reducible payload. Vary length slightly so the equal-cap water-fill is exercised.
    const text = `contexto documental sintetico ${chunkId} `.repeat(1).padEnd(charsPerChunk + index, 'x');
    return {
      evidence_ref: `evidence:${chunkId}`,
      chunk_id: chunkId,
      document_id: `doc-${String((index % 3) + 1).padStart(2, '0')}`,
      document_version_id: `ver-${chunkId}`,
      document_type: 'pliego',
      name: 'Pliego',
      version: 1,
      content_hash: 'a'.repeat(64),
      current: true,
      page: 1,
      section: 1,
      chunk_index: index,
      text,
      char_count: text.length,
      chunk_hash: 'b'.repeat(64),
      precedence: 'base',
      superseded_by_addendum: false,
      requirement_ids: [`REQ-${String((index % 20) + 1).padStart(2, '0')}`],
    };
  });
}

// The redundant, non-citable omitted-chunk provenance list — the dominant real-world payload
// (measured 78% of the request). Metadata only; the reason distribution is what the summary keeps.
function buildOmittedChunks(count) {
  const reasons = ['budget_exhausted', 'lower_relevance', 'superseded_for_current_requirement', 'gap_unavailable'];
  return Array.from({ length: count }, (_unused, index) => {
    const chunkId = `omitted-${String(index + 1).padStart(4, '0')}`;
    return {
      evidence_ref: `evidence:${chunkId}`,
      chunk_id: chunkId,
      document_id: `doc-${String((index % 17) + 1).padStart(2, '0')}`,
      document_type: 'pliego',
      requirement_id: `REQ-${String((index % 20) + 1).padStart(2, '0')}`,
      reason: reasons[index % reasons.length],
    };
  });
}

function buildModelInput({ chunkCount = 8, charsPerChunk = 1500, omittedCount = 0 } = {}) {
  const selectedChunks = buildSelectedChunks(chunkCount, charsPerChunk);
  return {
    schema_version: '1.0',
    snapshot_id: '55555555-5555-4555-8555-555555555555',
    context_version: 'ctx-1',
    opportunity: { id: 'opp-1', title: 'Vigilancia sintetica' },
    company_dossier: { profile: { legal_name: 'Proveedor Sintetico Ltda.' }, documents: [] },
    commercial_context: {},
    human_evidence: [],
    objective_validations: { extracted_values: [] },
    document_evidence: {
      snapshot_id: '55555555-5555-4555-8555-555555555555',
      budget: { max_chunks: 40, max_chars: 40000, max_tokens: 12000, chunks_used: chunkCount, chars_used: 0, tokens_used: 0 },
      selected_chunks: selectedChunks,
      citation_allowlist: [...new Set(selectedChunks.map((chunk) => chunk.evidence_ref))].sort(),
      coverage_manifest: { by_document: [], by_document_type: [], by_requirement: [] },
      omitted_chunks: buildOmittedChunks(omittedCount),
      material_omissions: omittedCount > 0,
      requirement_manifest_version: 'agt002-deep-analysis-v1',
      requirement_manifest: buildRequirementManifest(),
    },
    company_evidence_classes: buildSeventeenEvidenceClasses(),
  };
}

const MODEL = 'synthetic-budget-model';
const POLICY = 'Politica sintetica de prueba para el presupuesto de prompt V3.';
// A representative closed output schema (opaque to the budgeter, only its size matters here).
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['integral_analysis'],
  properties: {
    integral_analysis: {
      type: 'object',
      additionalProperties: false,
      required: ['analysis_units'],
      properties: { analysis_units: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object' } } },
    },
  },
};

function requestOf(input) {
  return { model: MODEL, policy: POLICY, input, outputSchema: OUTPUT_SCHEMA };
}

function emptiedChunkText(input) {
  return {
    ...input,
    document_evidence: {
      ...input.document_evidence,
      selected_chunks: input.document_evidence.selected_chunks.map((chunk) => ({ ...chunk, text: '' })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// (A0) Conservative estimator: monotonic in serialized bytes and never below the byte-derived
// floor, so it can never underestimate the real admission-time token count it stands in for.
// ---------------------------------------------------------------------------------------------
{
  const small = requestOf(buildModelInput({ chunkCount: 2, charsPerChunk: 100 }));
  const large = requestOf(buildModelInput({ chunkCount: 8, charsPerChunk: 3000 }));
  const smallBytes = measureAgt002V3RequestBytes(small);
  const largeBytes = measureAgt002V3RequestBytes(large);
  assert.ok(largeBytes > smallBytes, 'more raw payload must serialize to more bytes');
  assert.ok(estimateAgt002V3RequestTokens(large) > estimateAgt002V3RequestTokens(small), 'token estimate must be monotonic in payload');
  // Conservative: the byte-derived estimate must be >= bytes / 4 (a real BPE tokenizer averages
  // >= ~4 bytes/token for this JSON), i.e. our estimate never sits below the real token count.
  assert.ok(estimateAgt002V3RequestTokens(large) >= Math.ceil(largeBytes / 4), 'estimate must not underestimate real tokens');
  assert.equal(typeof AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS, 'number');
  assert.ok(Number.isInteger(AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS) && AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS > 0);
}

// Real-canary calibration: the accepted request measured 128,214 serialized bytes and the
// provider reported 46,796 input tokens. The admission guard must never estimate below that
// observed count; otherwise its claimed fail-closed safety is false for the actual provider.
{
  const observedBytes = 128_214;
  const observedProviderTokens = 46_796;
  const shell = { calibration: '' };
  const shellBytes = measureAgt002V3RequestBytes(shell);
  const calibrated = { calibration: 'x'.repeat(observedBytes - shellBytes) };
  assert.equal(measureAgt002V3RequestBytes(calibrated), observedBytes);
  assert.ok(
    estimateAgt002V3RequestTokens(calibrated) >= observedProviderTokens,
    'estimator must not undercount the real provider token count observed by the controlled canary',
  );
}

// ---------------------------------------------------------------------------------------------
// (A1) Determinism: identical inputs → deep-equal budgeted output and identical report.
// ---------------------------------------------------------------------------------------------
{
  const input = buildModelInput({ chunkCount: 8, charsPerChunk: 1500 });
  const full = estimateAgt002V3RequestTokens(requestOf(input));
  const skeleton = estimateAgt002V3RequestTokens(requestOf(emptiedChunkText(input)));
  const trimBudget = Math.floor((skeleton + full) / 2);

  const a = budgetAgt002V3PromptRequest({ ...requestOf(buildModelInput({ chunkCount: 8, charsPerChunk: 1500 })), maxInputTokens: trimBudget });
  const b = budgetAgt002V3PromptRequest({ ...requestOf(buildModelInput({ chunkCount: 8, charsPerChunk: 1500 })), maxInputTokens: trimBudget });
  assert.equal(a.applied, true, 'a mid budget between skeleton and full must trigger trimming');
  assert.deepEqual(a.input, b.input, 'budgeting must be deterministic (identical trimmed input)');
  assert.deepEqual(a.report, b.report, 'budgeting must be deterministic (identical report)');
}

// ---------------------------------------------------------------------------------------------
// (A2) Under-budget no-op byte-equivalence: a budget at/above the current size returns the SAME
// input reference, unchanged and byte-identical.
// ---------------------------------------------------------------------------------------------
{
  const input = buildModelInput({ chunkCount: 6, charsPerChunk: 800 });
  const before = estimateAgt002V3RequestTokens(requestOf(input));
  const out = budgetAgt002V3PromptRequest({ ...requestOf(input), maxInputTokens: before });
  assert.equal(out.applied, false, 'a budget >= current size must be a no-op');
  assert.equal(out.input, input, 'no-op must return the same input reference (byte-identical)');
  assert.equal(
    measureAgt002V3RequestBytes(requestOf(out.input)),
    measureAgt002V3RequestBytes(requestOf(input)),
    'no-op must not change a single byte',
  );
  assert.equal(out.report.estimated_input_tokens_after, out.report.estimated_input_tokens_before);
}

// ---------------------------------------------------------------------------------------------
// (A3) Bounded size + (A4) 1:1 requirement coverage + (A5) retained evidence refs/provenance +
// (A7) no fabrication — all on one trimmed run.
// ---------------------------------------------------------------------------------------------
{
  const input = buildModelInput({ chunkCount: 8, charsPerChunk: 2000 });
  const original = buildModelInput({ chunkCount: 8, charsPerChunk: 2000 });
  const full = estimateAgt002V3RequestTokens(requestOf(input));
  const skeleton = estimateAgt002V3RequestTokens(requestOf(emptiedChunkText(input)));
  const trimBudget = Math.floor((skeleton + full) / 2);

  const out = budgetAgt002V3PromptRequest({ ...requestOf(input), maxInputTokens: trimBudget });
  assert.equal(out.applied, true);

  // (A3) bounded: the budgeted request never exceeds the closed budget.
  assert.ok(
    estimateAgt002V3RequestTokens(requestOf(out.input)) <= trimBudget,
    'budgeted request must fit within the closed budget',
  );
  assert.ok(
    measureAgt002V3RequestBytes(requestOf(out.input)) < measureAgt002V3RequestBytes(requestOf(original)),
    'budgeting must actually reduce serialized size',
  );

  // (A4) 1:1 requirement coverage preserved — all 20 ordered ids, governed fields byte-identical.
  assert.deepEqual(
    out.input.document_evidence.requirement_manifest,
    original.document_evidence.requirement_manifest,
    'the 20 governed requirement entries (id + category + evidence_state_governed) must be untouched',
  );
  assert.deepEqual(
    out.input.document_evidence.requirement_manifest.map((entry) => entry.requirement_id),
    original.document_evidence.requirement_manifest.map((entry) => entry.requirement_id),
  );
  // manifest metadata + 17 evidence classes + citation/evidence boundaries preserved.
  assert.equal(out.input.document_evidence.requirement_manifest_version, 'agt002-deep-analysis-v1');
  assert.deepEqual(out.input.company_evidence_classes, original.company_evidence_classes, 'the 17 evidence classes must be untouched');
  assert.equal(out.input.company_evidence_classes.classes.length, 17);
  assert.deepEqual(out.input.document_evidence.citation_allowlist, original.document_evidence.citation_allowlist, 'the citation allowlist must be untouched');

  // (A5) every selected chunk is retained (never dropped) with its evidence ref/id/requirement
  // links, and any trimmed chunk carries honest provenance; char_count stays == len(text).
  assert.equal(out.input.document_evidence.selected_chunks.length, original.document_evidence.selected_chunks.length, 'no evidence chunk may be dropped');
  let truncated = 0;
  for (let i = 0; i < out.input.document_evidence.selected_chunks.length; i += 1) {
    const outChunk = out.input.document_evidence.selected_chunks[i];
    const srcChunk = original.document_evidence.selected_chunks[i];
    assert.equal(outChunk.evidence_ref, srcChunk.evidence_ref, 'evidence_ref must be retained');
    assert.equal(outChunk.chunk_id, srcChunk.chunk_id, 'chunk_id must be retained');
    assert.deepEqual(outChunk.requirement_ids, srcChunk.requirement_ids, 'requirement links must be retained');
    assert.equal(outChunk.char_count, outChunk.text.length, 'char_count must equal len(text)');
    // (A7) no fabrication: whatever text remains is a prefix of the original chunk text.
    assert.ok(srcChunk.text.startsWith(outChunk.text), 'budgeted chunk text must be a prefix of the source (no fabrication)');
    if (outChunk.text.length < srcChunk.text.length) {
      truncated += 1;
      assert.equal(outChunk.text_budgeted, true, 'a trimmed chunk must be flagged text_budgeted');
      assert.equal(outChunk.source_char_count, srcChunk.text.length, 'a trimmed chunk must record its source length');
      assert.equal(outChunk.text_omitted_char_count, srcChunk.text.length - outChunk.text.length, 'a trimmed chunk must record omitted chars');
      assert.equal(outChunk.text_budget_reason, 'v3_prompt_budget');
    }
  }
  assert.ok(truncated > 0, 'at least one chunk must have been trimmed');
  assert.equal(out.report.truncated_chunk_count, truncated);
  assert.equal(out.report.requirement_manifest_count, 20);
  assert.equal(out.report.company_evidence_class_count, 17);
  assert.ok(out.report.chunk_chars_after < out.report.chunk_chars_before);
}

// ---------------------------------------------------------------------------------------------
// (A6) Fail-closed BEFORE any provider call when still too large: a budget below the governed
// skeleton (even with all chunk text emptied) is refused with the closed code + a metadata report.
// ---------------------------------------------------------------------------------------------
{
  const input = buildModelInput({ chunkCount: 8, charsPerChunk: 2000 });
  const skeleton = estimateAgt002V3RequestTokens(requestOf(emptiedChunkText(input)));
  const impossible = Math.max(1, skeleton - 1);
  assert.throws(
    () => budgetAgt002V3PromptRequest({ ...requestOf(input), maxInputTokens: impossible }),
    (error) => {
      assert.equal(error.code, AGT002_V3_PROMPT_BUDGET_EXCEEDED_CODE, 'fail-closed must carry the closed budget code');
      assert.ok(error.report && typeof error.report === 'object', 'fail-closed must carry a metadata report');
      assert.equal(error.report.requirement_manifest_count, 20, 'the report must confirm the 20 governed requirements were never omitted');
      return true;
    },
    'a budget below the governed skeleton must fail closed, not silently omit governed content',
  );
}

// ---------------------------------------------------------------------------------------------
// (A9) omitted_chunks is the primary, redundant lever: reducing it ALONE brings the request under
// budget while every selected-chunk excerpt is preserved verbatim, with an honest provenance record
// (total count + by-reason distribution) and the governed material_omissions flag untouched.
// ---------------------------------------------------------------------------------------------
{
  const input = buildModelInput({ chunkCount: 6, charsPerChunk: 900, omittedCount: 1500 });
  const original = buildModelInput({ chunkCount: 6, charsPerChunk: 900, omittedCount: 1500 });
  const full = estimateAgt002V3RequestTokens(requestOf(input));
  const withoutOmitted = { ...input, document_evidence: { ...input.document_evidence, omitted_chunks: [] } };
  const summarizedFloor = estimateAgt002V3RequestTokens(requestOf(withoutOmitted));
  const budget = Math.floor((summarizedFloor + full) / 2); // above the summary, below the full list.

  const a = budgetAgt002V3PromptRequest({ ...requestOf(input), maxInputTokens: budget });
  const b = budgetAgt002V3PromptRequest({ ...requestOf(buildModelInput({ chunkCount: 6, charsPerChunk: 900, omittedCount: 1500 })), maxInputTokens: budget });
  assert.equal(a.applied, true);
  assert.deepEqual(a.input, b.input, 'omitted-chunks reduction must be deterministic');
  assert.deepEqual(a.report, b.report, 'omitted-chunks report must be deterministic');

  // Bounded, and reduced by shedding the redundant list.
  assert.ok(estimateAgt002V3RequestTokens(requestOf(a.input)) <= budget, 'summarizing omitted_chunks must bring the request under budget');
  assert.equal(a.report.omitted_chunks_summarized, true);
  assert.equal(a.input.document_evidence.omitted_chunks.length, 0, 'the redundant omitted list is shed from the model input');
  assert.equal(a.input.document_evidence.omitted_chunks_reduction.source_count, 1500, 'the provenance record keeps the true total');
  assert.equal(a.input.document_evidence.omitted_chunks_reduction.retained_count, 0);
  assert.equal(a.input.document_evidence.omitted_chunks_reduction.reason, 'v3_prompt_budget');
  const reasonTotal = Object.values(a.input.document_evidence.omitted_chunks_reduction.by_reason_counts).reduce((s, n) => s + n, 0);
  assert.equal(reasonTotal, 1500, 'the by-reason distribution accounts for every omitted chunk');

  // Every selected-chunk excerpt is preserved verbatim — omitted reduction alone sufficed.
  assert.deepEqual(a.input.document_evidence.selected_chunks, original.document_evidence.selected_chunks, 'selected chunk excerpts are untouched when omitted reduction suffices');
  assert.equal(a.report.truncated_chunk_count, 0);
  // Governed content preserved; the governed omission signal (material_omissions) is untouched.
  assert.deepEqual(a.input.document_evidence.requirement_manifest, original.document_evidence.requirement_manifest);
  assert.deepEqual(a.input.company_evidence_classes, original.company_evidence_classes);
  assert.deepEqual(a.input.document_evidence.citation_allowlist, original.document_evidence.citation_allowlist);
  assert.equal(a.input.document_evidence.material_omissions, true, 'the governed material_omissions flag is preserved');
}

// ---------------------------------------------------------------------------------------------
// (A10) Both levers, in order: when summarizing omitted_chunks alone is not enough, the excerpt
// text is water-fill truncated on top — still bounded, governed content intact.
// ---------------------------------------------------------------------------------------------
{
  const input = buildModelInput({ chunkCount: 8, charsPerChunk: 2000, omittedCount: 1200 });
  const original = buildModelInput({ chunkCount: 8, charsPerChunk: 2000, omittedCount: 1200 });
  const withoutOmitted = { ...input, document_evidence: { ...input.document_evidence, omitted_chunks: [] } };
  const summarizedFull = estimateAgt002V3RequestTokens(requestOf(withoutOmitted));
  const summarizedEmptyText = estimateAgt002V3RequestTokens(requestOf({
    ...withoutOmitted,
    document_evidence: { ...withoutOmitted.document_evidence, selected_chunks: withoutOmitted.document_evidence.selected_chunks.map((c) => ({ ...c, text: '' })) },
  }));
  const budget = Math.floor((summarizedEmptyText + summarizedFull) / 2); // forces text trimming after summary.

  const out = budgetAgt002V3PromptRequest({ ...requestOf(input), maxInputTokens: budget });
  assert.equal(out.applied, true);
  assert.ok(estimateAgt002V3RequestTokens(requestOf(out.input)) <= budget, 'both levers together must fit the budget');
  assert.equal(out.report.omitted_chunks_summarized, true);
  assert.equal(out.input.document_evidence.omitted_chunks.length, 0);
  assert.ok(out.report.truncated_chunk_count > 0, 'excerpt text must be truncated when the summary alone is insufficient');
  // No selected chunk dropped; trimmed text is a prefix with provenance; governed content intact.
  assert.equal(out.input.document_evidence.selected_chunks.length, original.document_evidence.selected_chunks.length);
  for (let i = 0; i < out.input.document_evidence.selected_chunks.length; i += 1) {
    assert.ok(original.document_evidence.selected_chunks[i].text.startsWith(out.input.document_evidence.selected_chunks[i].text), 'trimmed text is a prefix (no fabrication)');
  }
  assert.deepEqual(out.input.document_evidence.requirement_manifest, original.document_evidence.requirement_manifest);
  assert.deepEqual(out.input.company_evidence_classes, original.company_evidence_classes);
}

// ---------------------------------------------------------------------------------------------
// (A8) Invalid budget config is rejected.
// ---------------------------------------------------------------------------------------------
{
  const input = buildModelInput();
  assert.throws(() => budgetAgt002V3PromptRequest({ ...requestOf(input), maxInputTokens: 0 }));
  assert.throws(() => budgetAgt002V3PromptRequest({ ...requestOf(input), maxInputTokens: -5 }));
  assert.throws(() => budgetAgt002V3PromptRequest({ ...requestOf(input), maxInputTokens: 12.5 }));
}

// =============================================================================================
// (B) Engine boundary: the real runOnceV3 path, promptBudget flag, fake client capturing the
// exact request that would be sent to the provider. No real provider, no DB.
// =============================================================================================
function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    run: async (options) => {
      calls.push(options);
      return handler(options, calls.length);
    },
  };
}

function v3EngineContext() {
  const contextV2Sections = {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', updated_at: '2026-08-01T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-08-01T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Sintetica Ltda.', updated_at: '2026-08-01T10:00:00.000Z' },
      documents: [],
    }),
  };
  // One large, clearly-synthetic pliego whose single big section yields several sizable chunks,
  // each carrying the requirement terms so the retrieval selects them.
  const bigText = ('sistema cctv vigente supervision continua sintetica ').repeat(220);
  const documents = [{
    document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: 'opp-1', snapshot_id: null,
    document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64), current: true,
    extracted_text: bigText,
  }];
  const deepAnalysis = {
    matrix: {
      technical: [{
        id: 'req-cctv', front: 'technical', label: 'Sistema CCTV vigente',
        evidence: [{ document_id: 'ver-01', document_name: 'Pliego', document_type: 'pliego', excerpt: 'sistema cctv vigente' }],
      }],
      legal: [], financial: [],
    },
  };
  return {
    documents, deepAnalysis,
    snapshotId: '55555555-5555-4555-8555-555555555555', contextV2Sections,
  };
}

function buildV3ModelOutput(options) {
  const requirementEntry = options.input.document_evidence.requirement_manifest[0];
  const allowedRef = options.input.document_evidence.citation_allowlist[0];
  return {
    integral_analysis: {
      analysis_units: [{
        unit_id: 'UNIT-1', unit_kind: 'tender_requirement', requirement_id: requirementEntry.requirement_id,
        category: null, sequence: 1, title: 'Requisito tecnico', assessment_mode: 'assessed',
        conclusion: { status: 'human_validation_required', summary: 'Evidencia disponible; sin determinacion gobernada.', confidence: 'medium' },
        blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
        evidence_state: null,
        evidence_refs: [{ ref: allowedRef, source_type: 'tender_document', purpose: 'requirement_basis' }],
        missing_evidence: [],
        commercial_impact: { level: 'low', summary: 'Sin impacto.', dimension: 'eligibility' },
        legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
        actions: [],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
        escalation: { required: false, level: 'none', reason: 'Sin condicion critica.' },
        closure: { status: 'human_confirmation_required', condition: 'Persona confirma.', evidence_required: ['tender_document'] },
        human_validation: { required: true, status: 'pending', reason: 'Confirmar.' },
      }],
    },
  };
}

function baseV3EngineOptions(overrides = {}) {
  return {
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-integral-v3-policy-1',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    ...overrides,
  };
}

const promptBearing = (options) => JSON.stringify({
  model: options.model, policy: options.policy, input: options.input, outputSchema: options.outputSchema,
});

// (B1) Flag-off byte-equivalence: promptBudget off vs on-with-a-high-budget produce a byte-identical
// request to the provider. The budget path, when it does not need to trim, changes nothing.
{
  const ctx = v3EngineContext();
  const offClient = fakeClient(async (options) => ({ content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 3, output_tokens: 3 } }));
  const offEngine = createAgt002PreviewEngine({ client: offClient, ...baseV3EngineOptions() });
  await offEngine.analyze(ctx);

  const onClient = fakeClient(async (options) => ({ content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 3, output_tokens: 3 } }));
  const onEngine = createAgt002PreviewEngine({
    client: onClient, ...baseV3EngineOptions(), promptBudget: true, promptMaxInputTokens: 100_000_000,
  });
  await onEngine.analyze(ctx);

  assert.equal(offClient.calls.length, 1);
  assert.equal(onClient.calls.length, 1);
  assert.equal(
    promptBearing(onClient.calls[0]), promptBearing(offClient.calls[0]),
    'promptBudget on with a high budget must be byte-identical to promptBudget off',
  );
}

// (B2) Flag-on trimming at the engine boundary: with a budget between the skeleton and the full
// request, the client receives a strictly smaller, bounded input, and every governed field is
// preserved (requirement manifest, 17 classes, citation allowlist).
{
  const ctx = v3EngineContext();
  // First, measure the untrimmed request the engine would send (high budget → no-op).
  const probeClient = fakeClient(async (options) => ({ content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 3, output_tokens: 3 } }));
  const probeEngine = createAgt002PreviewEngine({
    client: probeClient, ...baseV3EngineOptions(), companyEvidenceClassesProvider: () => AGT002_COMPANY_EVIDENCE_CLASS_IDS.map((id) => ({
      entry_id: id, document_class: id, existence_status: 'reported', human_review_status: 'pending_human_review',
      applicability_status: 'pending_case_validation', integration_active: true, expiry: null, updated_at: '2026-01-01T00:00:00.000Z',
    })), promptBudget: true, promptMaxInputTokens: 100_000_000,
  });
  await probeEngine.analyze(ctx);
  const untrimmed = probeClient.calls[0];
  const fullTokens = estimateAgt002V3RequestTokens({ model: untrimmed.model, policy: untrimmed.policy, input: untrimmed.input, outputSchema: untrimmed.outputSchema });
  const emptiedTokens = estimateAgt002V3RequestTokens({
    model: untrimmed.model, policy: untrimmed.policy, outputSchema: untrimmed.outputSchema,
    input: { ...untrimmed.input, document_evidence: { ...untrimmed.input.document_evidence, selected_chunks: untrimmed.input.document_evidence.selected_chunks.map((c) => ({ ...c, text: '' })) } },
  });
  assert.ok(untrimmed.input.document_evidence.selected_chunks.length >= 2, 'the crafted context must select multiple chunks to trim');
  const trimBudget = Math.floor((emptiedTokens + fullTokens) / 2);

  const reports = [];
  const trimClient = fakeClient(async (options) => ({ content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 3, output_tokens: 3 } }));
  const trimEngine = createAgt002PreviewEngine({
    client: trimClient, ...baseV3EngineOptions(), companyEvidenceClassesProvider: () => AGT002_COMPANY_EVIDENCE_CLASS_IDS.map((id) => ({
      entry_id: id, document_class: id, existence_status: 'reported', human_review_status: 'pending_human_review',
      applicability_status: 'pending_case_validation', integration_active: true, expiry: null, updated_at: '2026-01-01T00:00:00.000Z',
    })), promptBudget: true, promptMaxInputTokens: trimBudget, onPromptBudget: (report) => reports.push(report),
  });
  const result = await trimEngine.analyze(ctx);

  const sent = trimClient.calls[0];
  const sentTokens = estimateAgt002V3RequestTokens({ model: sent.model, policy: sent.policy, input: sent.input, outputSchema: sent.outputSchema });
  assert.ok(sentTokens <= trimBudget, 'the request actually sent to the provider must fit the budget');
  assert.ok(sentTokens < fullTokens, 'the sent request must be smaller than the untrimmed request');
  // Governed content preserved through the engine boundary.
  assert.deepEqual(
    sent.input.document_evidence.requirement_manifest.map((e) => e.requirement_id),
    untrimmed.input.document_evidence.requirement_manifest.map((e) => e.requirement_id),
    'the governed requirement ids sent to the provider are unchanged by trimming',
  );
  assert.deepEqual(sent.input.company_evidence_classes, untrimmed.input.company_evidence_classes, 'the 17 evidence classes are unchanged by trimming');
  assert.deepEqual(sent.input.document_evidence.citation_allowlist, untrimmed.input.document_evidence.citation_allowlist, 'the citation allowlist is unchanged by trimming');
  assert.equal(sent.input.document_evidence.selected_chunks.length, untrimmed.input.document_evidence.selected_chunks.length, 'no evidence chunk dropped at the engine boundary');
  // Envelope coverage (built from the ORIGINAL, un-budgeted input) is unaffected.
  assert.equal(result.schema_version, '3.0.0');
  assert.equal(result.human_review_required, true);
  assert.ok(result.evidence_coverage, 'the envelope still carries evidence_coverage from the original input');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].applied, true);
}

// (B3) Fail-closed BEFORE the provider call at the engine boundary: an impossibly small budget
// makes analyze reject WITHOUT ever calling the client (zero provider calls).
{
  const ctx = v3EngineContext();
  const reports = [];
  const client = fakeClient(async () => { throw new Error('the provider must never be called when the budget fails closed'); });
  const engine = createAgt002PreviewEngine({
    client, ...baseV3EngineOptions(), promptBudget: true, promptMaxInputTokens: 1, onPromptBudget: (report) => reports.push(report),
  });
  await assert.rejects(
    () => engine.analyze(ctx),
    (error) => {
      assert.equal(error.code, AGT002_V3_PROMPT_BUDGET_EXCEEDED_CODE, 'the engine must surface the closed budget code');
      return true;
    },
    'an impossibly small budget must fail closed before the provider call',
  );
  assert.equal(client.calls.length, 0, 'ZERO provider calls when the prompt budget fails closed');
  assert.equal(reports.length, 1, 'the fail-closed path still reports metadata');
  assert.equal(reports[0].requirement_manifest_count, 1);
}

console.log('agt002-v3-prompt-budget: OK');
