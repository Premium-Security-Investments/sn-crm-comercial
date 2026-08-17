import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AGT002_PREVIEW_POLICY, AGT002_INTEGRAL_V3_POLICY, createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, AGT002_PREVIEW_OUTPUT_JSON_SCHEMA } from '../agt002-preview-contract.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { retrieveAgt002LegalEvidence } from '../agt002-legal-retrieval.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS, buildAgt002CompanyEvidenceClasses } from '../agt002-company-evidence-classes.js';
import { AGT002_EVIDENCE_STATE_SAFE_UNKNOWN, buildAgt002EvidenceStateManifest } from '../agt002-evidence-state-manifest.js';
import { deriveAgt002IntegralCategoryManifest } from '../agt002-integral-category-manifest.js';
import { validateAgt002TenderAnalysisEnvelopeV3, adaptAgt002TenderAnalysisV3 } from '../agt002-tender-adapter.js';
import { registerAgt002PreviewAnalysis } from '../agt002-preview-persistence.js';

const context = {
  opportunity: { id: 'opp-1', company_name: 'Entidad de prueba', title: 'Vigilancia' },
  documents: [
    { id: 'doc-01', name: 'Pliego', document_type: 'pliego', extracted_text: 'Requiere póliza vigente.' },
    { id: 'doc-02', name: 'Anexo', document_type: 'anexo_tecnico', extracted_text: 'Requiere CCTV.' },
  ],
  companyProfile: { working_capital: 500 },
  deepAnalysis: {},
  snapshotId: '11111111-1111-4111-8111-111111111111',
};

function validModelOutput(overrides = {}) {
  return {
    recommendation: 'pause',
    summary: 'Falta confirmar la póliza.',
    strengths: [],
    weaknesses: [{ id: 'f-1', text: 'Falta póliza vigente.', critical: true, evidence_refs: ['document:doc-01'] }],
    blockers: [],
    questions: [],
    unverified: [],
    next_action: 'Solicitar póliza vigente.',
    human_review_required: true,
    ...overrides,
  };
}

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

function baseEngineOptions(overrides = {}) {
  return {
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v1',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    ...overrides,
  };
}

for (const text of [
  'datos no confiables', 'GO / NO GO', 'herramientas', 'evidence_id', 'JSON estructurado',
  'existencia o disponibilidad documental', 'vigencia observada', 'aplicabilidad al caso',
  'no preguntes si la licencia existe o está disponible', 'pending_case_validation',
  'alcance territorial', 'modalidades', 'armas', 'medios',
  'impedimentos materiales', 'inhabilidades', 'experiencia mínima', 'capacidad financiera',
  'plazo objetivamente imposible', 'imposibilidad técnica grave', 'inviabilidad económica',
  'preparación post-GO', 'compromiso empresarial de disponer', 'verifica automáticamente',
]) {
  assert.match(AGT002_PREVIEW_POLICY, new RegExp(text, 'i'));
}
assert.doesNotMatch(
  AGT002_PREVIEW_POLICY,
  /limita cualquier pregunta pendiente a vigencia al cierre o aplicabilidad concreta/i,
  'vigencia y aplicabilidad deben verificarse automáticamente; sólo una imposibilidad material concreta puede escalarse',
);
assert.match(
  AGT002_PREVIEW_POLICY,
  /nunca preguntes por disponibilidad ordinaria de personal, armas, medios, recursos, modalidad individual\/consorcio\/UT ni emisión o modificación de garantías\/pólizas/i,
);

// E5 regression: legal corpus v1.1 carries ONLY human_legal_review_items (no verified
// citation_allowlist), yet complete, otherwise-valid AGT-002 outputs were rejected wholesale
// with validation_code legal_classification_misuse — the validator (unchanged, still strict)
// throws that code whenever a fact classification (tender_requirement/company_evidence/
// inference) or legal_obligation carries a legal_citation_id, which is exactly what an
// under-instructed model does with an uncertain source it has no other sanctioned way to
// reference. The fix belongs in the prompt, not the validator: the policy text actually sent
// to the model on every run must unambiguously state that a human_legal_review_items citation
// id may appear ONLY inside a legal_finding with classification human_legal_review — using the
// exact abstention statement, an empty evidence_refs, and every required id — and must never be
// cited by any other classification.
{
  assert.match(AGT002_PREVIEW_POLICY, /human_legal_review_items/,
    'the prompt must name legal_evidence.human_legal_review_items explicitly, not just "revisión jurídica" in the abstract');
  assert.ok(AGT002_PREVIEW_POLICY.includes(AGT002_LEGAL_HUMAN_REVIEW_STATEMENT),
    'the prompt must show the exact abstention text verbatim so the model does not have to guess or paraphrase it');
  assert.match(AGT002_PREVIEW_POLICY, /evidence_refs vac[ií]o/i,
    'the prompt must state that a human_legal_review finding carries an empty evidence_refs');
  assert.match(AGT002_PREVIEW_POLICY, /todas (esas|las) citation ids/i,
    'the prompt must state every required human_legal_review_items citation id must be represented');
  assert.match(
    AGT002_PREVIEW_POLICY,
    /nunca cites esos identificadores en tender_requirement, company_evidence, inference ni legal_obligation/i,
    'the prompt must explicitly forbid citing a human_legal_review_items id from any classification other than human_legal_review',
  );
}

// Happy path: closed envelope, correct identity, usage/rate-limit surfaced.
{
  const client = fakeClient(async () => ({
    content: JSON.stringify(validModelOutput()),
    usage: { input_tokens: 120, output_tokens: 40 },
    rate_limit: { window: '5h', used_percent: 3 },
  }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  const result = await engine.analyze(context);
  assert.equal(result.producer, 'AGT-002');
  assert.equal(result.agent_id, 'AGT-002');
  assert.equal(result.method, 'agent_ai');
  assert.equal(result.schema_version, '2.0-preview.1');
  assert.equal(result.status, 'completed');
  assert.equal(result.human_review_required, true);
  assert.equal(result.snapshot_id, context.snapshotId);
  assert.equal(result.policy_version, 'agt002-preview-policy-v1');
  assert.equal(result.usage.provider, 'codex_app_server');
  assert.equal(result.usage.model, 'synthetic-codex-model');
  assert.equal(result.usage.input_tokens, 120);
  assert.equal(result.usage.output_tokens, 40);
  assert.deepEqual(result.usage.rate_limit, { window: '5h', used_percent: 3 });
  assert.ok(!Object.hasOwn(result, 'decision') && !Object.hasOwn(result, 'go_no_go'), 'AGT-002 Preview must never emit an authoritative GO/NO GO field');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].model, 'synthetic-codex-model');
  assert.equal(client.calls[0].input.snapshot_id, context.snapshotId);
  assert.equal(client.calls[0].outputSchema.type, 'object');
  assert.equal(client.calls[0].outputSchema.additionalProperties, false);
  assert.equal(client.calls[0].outputSchema.properties.human_review_required.const, true);
  for (const field of ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified']) {
    assert.deepEqual(
      client.calls[0].outputSchema.properties[field].items.properties.evidence_refs.items.enum,
      ['document:doc-01', 'document:doc-02'],
      `${field} debe restringir evidence_refs al snapshot enviado`,
    );
  }
  assert.equal(
    Object.hasOwn(AGT002_PREVIEW_OUTPUT_JSON_SCHEMA.properties.strengths.items.properties.evidence_refs.items, 'enum'),
    false,
    'el schema base compartido no debe mutarse al crear el enum dinámico',
  );
}

// Valid JSON wrapped in peripheral whitespace (trailing newline, etc.) must still be
// accepted: JSON.parse tolerates it and the bridge legitimately returns it that way.
{
  const client = fakeClient(async () => ({
    content: `\n  ${JSON.stringify(validModelOutput())}\n`,
    usage: { input_tokens: 120, output_tokens: 40 },
  }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  const result = await engine.analyze(context);
  assert.equal(result.status, 'completed');
  assert.equal(result.human_review_required, true);
}

// Citation discipline enforced end-to-end: a hallucinated evidence_id is rejected safely.
{
  const client = fakeClient(async () => ({
    content: JSON.stringify(validModelOutput({ weaknesses: [{ id: 'f-1', text: 'x', critical: true, evidence_refs: ['document:doc-99'] }] })),
    usage: { input_tokens: 10, output_tokens: 5 },
  }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), /no produjo una respuesta válida/i);
}

// Prompt-injection-shaped output (extra key trying to smuggle an authoritative decision) is rejected.
{
  const client = fakeClient(async () => ({
    content: JSON.stringify({ ...validModelOutput(), go_no_go: 'go' }),
    usage: { input_tokens: 10, output_tokens: 5 },
  }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), /no produjo una respuesta válida/i);
}

// Non-JSON / truncated content is rejected safely, not thrown as a raw parse error.
{
  const client = fakeClient(async () => ({ content: '```json\n{}\n```', usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), /no produjo una respuesta válida/i);
}

// Invalid usage (non-integer tokens) is rejected safely.
{
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 'many', output_tokens: 5 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), /no produjo una respuesta válida/i);
}

// Transport failure (timeout/crash from the client) surfaces a safe, non-provider-leaking message.
{
  const client = fakeClient(async () => { const error = new Error('provider internals leaked here'); error.code = 'AGT002_CODEX_TIMEOUT'; throw error; });
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), error => !/provider internals/i.test(error.message) && /no está disponible/i.test(error.message));
}

// Bounded concurrency: a second distinct request while one is in flight is rejected
// without ever reaching the client, and later requests succeed once a slot frees up.
{
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = fakeClient(async () => { await gate; return { content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }; });
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions({ maxConcurrent: 1 }) });
  const first = engine.analyze(context, { idempotencyKey: 'key-a' });
  await new Promise(resolve => setTimeout(resolve, 10));
  await assert.rejects(
    () => engine.analyze({ ...context, snapshotId: '22222222-2222-4222-8222-222222222222' }, { idempotencyKey: 'key-b' }),
    /saturad/i,
  );
  assert.equal(client.calls.length, 1, 'the concurrent second request must never reach the client');
  release();
  await first;
}

// Concurrency reservation is synchronous: even while the first quota probe is
// awaiting, a distinct request cannot race through the same maxConcurrent slot.
{
  let releaseQuota;
  const quotaGate = new Promise(resolve => { releaseQuota = resolve; });
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions({ maxConcurrent: 1, countDailyRuns: async () => { await quotaGate; return 0; } }) });
  const first = engine.analyze(context, { idempotencyKey: 'quota-race-a' });
  const second = engine.analyze({ ...context, snapshotId: '33333333-3333-4333-8333-333333333333' }, { idempotencyKey: 'quota-race-b' });
  await new Promise(resolve => setTimeout(resolve, 0));
  releaseQuota();
  await first;
  await assert.rejects(second, /saturad/i);
  assert.equal(client.calls.length, 1, 'quota await must not allow another request to steal the reserved slot');
}

// In-process idempotency: two concurrent calls with the same key collapse into one
// underlying client invocation and resolve to the exact same run.
{
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions({ maxConcurrent: 2 }) });
  const [a, b] = await Promise.all([
    engine.analyze(context, { idempotencyKey: 'same-key' }),
    engine.analyze(context, { idempotencyKey: 'same-key' }),
  ]);
  assert.equal(client.calls.length, 1, 'identical concurrent requests must not double-spend quota');
  assert.deepEqual(a, b);
  assert.equal(a.run_id, b.run_id);
}

// Interpretable daily quota: exceeding the injected daily run count blocks before transport.
{
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions({ dailyMaxRuns: 3, countDailyRuns: async () => 3 }) });
  await assert.rejects(() => engine.analyze(context), /cuota/i);
  assert.equal(client.calls.length, 0);
}

// Fail-closed on an untrustworthy quota probe (never assume zero usage silently).
{
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions({ countDailyRuns: async () => -1 }) });
  await assert.rejects(() => engine.analyze(context), /no está disponible/i);
  assert.equal(client.calls.length, 0);
}

// Cancellation/timeout signal propagates through to the transport layer.
{
  let capturedSignal;
  const client = fakeClient(async (options) => {
    capturedSignal = options.signal;
    return { content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  const controller = new AbortController();
  await engine.analyze(context, { signal: controller.signal });
  assert.equal(capturedSignal, controller.signal);
}

// Configuration failures must fail closed rather than silently no-op.
assert.throws(() => createAgt002PreviewEngine({}), /no está configurado/i);
assert.throws(() => createAgt002PreviewEngine({ client: { run: async () => {} }, model: '', policyVersion: 'v1' }), /no está configurado/i);
assert.throws(
  () => createAgt002PreviewEngine({ client: { run: async () => {} }, ...baseEngineOptions(), contextV2: true, legalCorpus: true }),
  /evidencia jurídica|legal/i,
  'legalCorpus must fail closed unless a deterministic evidence provider is wired',
);

// legalCorpus must also fail closed without the exact corpus UUID and content hash that the
// evidence was retrieved from: the engine is the single place that binds every legal citation
// to the DB-published corpus version it came from, so it must never silently omit that binding.
assert.throws(
  () => createAgt002PreviewEngine({
    client: { run: async () => {} }, ...baseEngineOptions(), contextV2: true, legalCorpus: true,
    legalEvidenceProvider: () => ({}),
  }),
  /evidencia jurídica|legal/i,
  'legalCorpus must fail closed without a legalCorpusVersionId and legalCorpusContentSha256',
);
assert.throws(
  () => createAgt002PreviewEngine({
    client: { run: async () => {} }, ...baseEngineOptions(), contextV2: true, legalCorpus: true,
    legalEvidenceProvider: () => ({}), legalCorpusVersionId: '10101010-1010-4010-8010-101010101010',
  }),
  /evidencia jurídica|legal/i,
  'legalCorpus must fail closed without legalCorpusContentSha256 even when legalCorpusVersionId is present',
);

// AGT002_DOCUMENT_RETRIEVAL is engine-level configuration too, mirroring contextV2 above:
// the flag always wins over anything a caller's context object carries, in both directions.
{
  const contextV2Sections = {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', updated_at: '2026-07-29T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-07-29T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-29T10:00:00.000Z' },
      documents: [],
    }),
  };
  const retrievalDocuments = [
    { document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64), current: true, extracted_text: 'Requiere póliza vigente de cumplimiento.' },
  ];
  const retrievalDeepAnalysis = {
    matrix: {
      legal: [{
        id: 'req-poliza', front: 'legal', label: 'Póliza vigente',
        evidence: [{ document_id: 'ver-01', document_name: 'Pliego', document_type: 'pliego', excerpt: 'Requiere póliza vigente de cumplimiento.' }],
      }],
      financial: [],
      technical: [],
    },
  };

  // Engine built with documentRetrieval:true must apply retrieval even when the caller's
  // context tries to disable it.
  {
    const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput({ weaknesses: [] })), usage: { input_tokens: 1, output_tokens: 1 } }));
    const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true });
    const result = await engine.analyze({
      documents: retrievalDocuments,
      deepAnalysis: retrievalDeepAnalysis,
      snapshotId: '11111111-1111-4111-8111-111111111111',
      contextV2Sections,
      documentRetrieval: false, // caller attempt to disable must be ignored
    });
    assert.ok(client.calls[0].input.document_evidence, 'engine must enforce documentRetrieval regardless of a caller override attempt');
    assert.equal(result.snapshot_id, '11111111-1111-4111-8111-111111111111');
    assert.ok(result.evidence_coverage, 'completed analysis must expose persistable coverage metadata for the UI');
    assert.equal(result.evidence_coverage.snapshot_id, result.snapshot_id);
    assert.equal(result.evidence_coverage.material_omissions, client.calls[0].input.document_evidence.material_omissions);
    assert.deepEqual(result.evidence_coverage.citation_allowlist, client.calls[0].input.document_evidence.citation_allowlist);
    assert.ok(result.evidence_coverage.selected_chunks.every(chunk => !Object.hasOwn(chunk, 'text')), 'persisted coverage metadata must not duplicate or retain chunk text');

    // The self-contained requirement provenance manifest (id/front/label/sources) must be
    // carried inline on both the model input's document_evidence and the persisted
    // evidence_coverage, with no chunk/excerpt text ever leaking through.
    assert.equal(client.calls[0].input.document_evidence.requirement_manifest_version, '1.0');
    assert.deepEqual(client.calls[0].input.document_evidence.requirement_manifest, [{
      requirement_id: 'req-poliza', front: 'legal', label: 'Póliza vigente',
      sources: [{ document_id: 'doc-01', document_version_id: 'ver-01', content_hash: 'a'.repeat(64) }],
      unresolved_sources: [],
    }]);
    assert.equal(result.evidence_coverage.requirement_manifest_version, '1.0');
    assert.deepEqual(result.evidence_coverage.requirement_manifest, client.calls[0].input.document_evidence.requirement_manifest);
    assert.doesNotMatch(JSON.stringify(result.evidence_coverage.requirement_manifest), /excerpt|Requiere póliza vigente/i);
  }

  // Engine built without documentRetrieval (default false) must ignore a caller trying to
  // enable it: no document_evidence is attached and the legacy contextV2 documents shape
  // (which does not require chunk-ready fields) is used instead.
  {
    const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
    const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions(), contextV2: true });
    const result = await engine.analyze({
      documents: context.documents,
      deepAnalysis: {},
      snapshotId: '11111111-1111-4111-8111-111111111111',
      contextV2Sections,
      documentRetrieval: true, // caller attempt to enable must be ignored
    });
    assert.equal(Object.hasOwn(client.calls[0].input, 'document_evidence'), false, 'engine must not enable documentRetrieval from caller-supplied context');
    assert.equal(result.status, 'completed');
  }
}

// E5 production path: flag -> deterministic retrieval -> legal input/schema -> validation -> envelope.
{
  const corpus = JSON.parse(readFileSync(new URL('../data/agt002/legal-corpus-v1.1.json', import.meta.url), 'utf8'));
  const legalEvidencePackage = retrieveAgt002LegalEvidence({
    corpus,
    corpus_version: corpus.corpus_version,
    as_of: '2026-07-30',
    topics: [...new Set(corpus.sources.flatMap(source => source.topic))],
    sector: [...new Set(corpus.sources.flatMap(source => source.sector))],
  });
  assert.equal(legalEvidencePackage.verified_legal_evidence.length, 0, 'corpus v1 must abstain until legal validity is auditable');
  assert.equal(legalEvidencePackage.human_legal_review_items.length, corpus.sources.length);
  const reviewCitationIds = legalEvidencePackage.human_legal_review_items.map(item => item.citation.citation_id).sort();
  const contextV2Sections = {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', updated_at: '2026-07-30T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-07-30T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-30T10:00:00.000Z' },
      documents: [],
    }),
  };
  const legalContext = { documents: context.documents, deepAnalysis: {}, snapshotId: '11111111-1111-4111-8111-111111111111', contextV2Sections };
  const legalOutput = validModelOutput({
    weaknesses: [],
    legal_findings: [{ classification: 'human_legal_review', text: AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, evidence_refs: [], legal_citation_ids: reviewCitationIds }],
  });
  const legalCorpusVersionId = '10101010-1010-4010-8010-101010101010';
  const legalCorpusContentSha256 = 'b'.repeat(64);
  const client = fakeClient(async () => ({ content: JSON.stringify(legalOutput), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({
    client, ...baseEngineOptions(), contextV2: true, legalCorpus: true, legalEvidenceProvider: () => legalEvidencePackage,
    legalCorpusVersionId, legalCorpusContentSha256,
  });
  const result = await engine.analyze(legalContext);
  assert.equal(client.calls[0].input.legal_evidence.corpus_version, 'legal-corpus-v1.1');
  assert.ok(client.calls[0].outputSchema.required.includes('legal_findings'));
  assert.deepEqual(client.calls[0].outputSchema.properties.legal_findings.items.properties.legal_citation_ids.items.enum, reviewCitationIds);
  assert.deepEqual(result.legal_evidence, client.calls[0].input.legal_evidence);
  assert.deepEqual(result.legal_findings, legalOutput.legal_findings);
  assert.equal(result.legal_corpus_version_id, legalCorpusVersionId, 'the envelope must bind the exact published corpus UUID the legal evidence was retrieved from');
  assert.equal(result.legal_corpus_content_sha256, legalCorpusContentSha256, 'the envelope must carry the exact corpus content hash for audit');

  const omittingClient = fakeClient(async () => ({ content: JSON.stringify(validModelOutput({ weaknesses: [], legal_findings: [] })), usage: { input_tokens: 1, output_tokens: 1 } }));
  const omittingEngine = createAgt002PreviewEngine({
    client: omittingClient, ...baseEngineOptions(), contextV2: true, legalCorpus: true, legalEvidenceProvider: () => legalEvidencePackage,
    legalCorpusVersionId, legalCorpusContentSha256,
  });
  const omittingResult = await omittingEngine.analyze(legalContext);
  assert.deepEqual(omittingResult.legal_findings, [{
    classification: 'human_legal_review',
    text: AGT002_LEGAL_HUMAN_REVIEW_STATEMENT,
    evidence_refs: [],
    legal_citation_ids: reviewCitationIds,
  }], 'a missing abstention is completed only from the deterministic legal-evidence package');
}

// legal_corpus_version_id / legal_corpus_content_sha256 must never appear on the envelope
// when legalCorpus is off: E4 output must remain byte-for-byte unchanged.
{
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  const result = await engine.analyze(context);
  assert.equal(Object.hasOwn(result, 'legal_corpus_version_id'), false);
  assert.equal(Object.hasOwn(result, 'legal_corpus_content_sha256'), false);
}

// --- output_rejected observability (E5): every rejection point emits exactly one structured,
// diagnosable event, raw content/prompt/validator text never appears anywhere (event or public
// error), and SAFE_INVALID stays the sole public error message. ---

function spyObservability() {
  const records = [];
  return { records, record: (eventType, fields) => { records.push({ eventType, fields }); return { event: eventType, ...fields }; } };
}

async function rejectsWith(promiseFn) {
  try {
    await promiseFn();
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

function assertNoRawContentLeak(records, rawContent) {
  const serialized = JSON.stringify(records);
  if (rawContent) assert.ok(!serialized.includes(rawContent), 'raw model content must never appear in an emitted observability record');
}

// Stage: json_parse — malformed/non-JSON content.
{
  const observability = spyObservability();
  const rawContent = '```json\n{not valid json\n```';
  const client = fakeClient(async () => ({ content: rawContent, usage: { input_tokens: 7, output_tokens: 3 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions(), observability });
  const error = await rejectsWith(() => engine.analyze(context));
  assert.equal(error.message, 'AGT-002 Preview no produjo una respuesta válida.', 'the public error must stay exactly SAFE_INVALID');
  assert.equal(observability.records.length, 1);
  const [{ eventType, fields }] = observability.records;
  assert.equal(eventType, 'output_rejected');
  assert.equal(fields.stage, 'json_parse');
  assert.equal(fields.validation_code, 'invalid_json');
  assert.equal(fields.snapshot_id, context.snapshotId);
  assert.equal(fields.content_bytes, Buffer.byteLength(rawContent, 'utf8'));
  assert.equal(fields.content_sha256, createHash('sha256').update(rawContent, 'utf8').digest('hex'));
  assert.equal(fields.input_tokens, 7);
  assert.equal(fields.output_tokens, 3);
  assertNoRawContentLeak(observability.records, rawContent);
  assert.ok(!error.message.includes(rawContent));
}

// Stage: semantic_validation — a hallucinated evidence_id (non-legal path).
{
  const observability = spyObservability();
  const rawOutput = validModelOutput({ weaknesses: [{ id: 'f-1', text: 'x', critical: true, evidence_refs: ['document:doc-99'] }] });
  const rawContent = JSON.stringify(rawOutput);
  const client = fakeClient(async () => ({ content: rawContent, usage: { input_tokens: 11, output_tokens: 4 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions(), observability });
  const error = await rejectsWith(() => engine.analyze(context));
  assert.equal(error.message, 'AGT-002 Preview no produjo una respuesta válida.');
  assert.equal(observability.records.length, 1);
  const [{ fields }] = observability.records;
  assert.equal(fields.stage, 'semantic_validation');
  assert.equal(fields.validation_code, 'unknown_evidence_id');
  assert.equal(fields.content_bytes, Buffer.byteLength(rawContent, 'utf8'));
  assert.equal(fields.content_sha256, createHash('sha256').update(rawContent, 'utf8').digest('hex'));
  assert.equal(fields.input_tokens, 11);
  assert.equal(fields.output_tokens, 4);
  assertNoRawContentLeak(observability.records, 'document:doc-99');
  assert.ok(!error.message.includes('document:doc-99'));
}

// Stage: usage — non-integer token counts.
{
  const observability = spyObservability();
  const rawContent = JSON.stringify(validModelOutput());
  const client = fakeClient(async () => ({ content: rawContent, usage: { input_tokens: 'many', output_tokens: 5 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions(), observability });
  const error = await rejectsWith(() => engine.analyze(context));
  assert.equal(error.message, 'AGT-002 Preview no produjo una respuesta válida.');
  assert.equal(observability.records.length, 1);
  const [{ fields }] = observability.records;
  assert.equal(fields.stage, 'usage');
  assert.equal(fields.validation_code, 'invalid_usage');
  assert.equal(fields.content_sha256, createHash('sha256').update(rawContent, 'utf8').digest('hex'));
  // input_tokens was the malformed 'many' string: the sanitizer must drop it rather than
  // forward a non-integer value, even though the underlying rejection reason IS usage-shaped.
  assert.equal(fields.input_tokens, undefined);
  assert.equal(fields.output_tokens, 5);
  assertNoRawContentLeak(observability.records, rawContent);
}

// Stage: envelope — everything upstream validates, but the envelope itself is structurally
// invalid (non-UUID snapshot_id fails validateTenderAnalysisResult's identity check).
{
  const observability = spyObservability();
  const rawContent = JSON.stringify(validModelOutput());
  const client = fakeClient(async () => ({ content: rawContent, usage: { input_tokens: 2, output_tokens: 6 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions(), observability });
  const badContext = { ...context, snapshotId: 'not-a-uuid-snapshot' };
  const error = await rejectsWith(() => engine.analyze(badContext));
  assert.match(error.message, /no produjo una respuesta válida/i);
  assert.equal(error.message, 'AGT-002 Preview no produjo una respuesta válida.');
  assert.equal(observability.records.length, 1);
  const [{ fields }] = observability.records;
  assert.equal(fields.stage, 'envelope');
  assert.equal(fields.validation_code, 'invalid_envelope');
  assert.equal(fields.snapshot_id, 'not-a-uuid-snapshot');
  assert.equal(fields.content_sha256, createHash('sha256').update(rawContent, 'utf8').digest('hex'));
  assert.equal(fields.input_tokens, 2);
  assert.equal(fields.output_tokens, 6);
  assertNoRawContentLeak(observability.records, rawContent);
}

// Default engine (no injected observability) must still wire a safe recorder: build one with
// the default and confirm it never throws while constructing/using it on a rejection path.
{
  const client = fakeClient(async () => ({ content: 'not json', usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), /no produjo una respuesta válida/i);
}

// A malformed custom observability object must fail closed at construction time, exactly like
// any other missing/invalid engine configuration.
assert.throws(
  () => createAgt002PreviewEngine({ client: { run: async () => {} }, ...baseEngineOptions(), observability: { record: 'not-a-function' } }),
  /no está configurado/i,
);

// --- Legal classify() coverage (E5): abstention / uncertain sources / classification misuse,
// each producing a distinct, id-free validation_code. Reuses the real (always-abstaining)
// legal-corpus-v1.1 fixture so every scenario is a single mutated legal_findings array. ---
{
  const corpus = JSON.parse(readFileSync(new URL('../data/agt002/legal-corpus-v1.1.json', import.meta.url), 'utf8'));
  const legalEvidencePackage = retrieveAgt002LegalEvidence({
    corpus,
    corpus_version: corpus.corpus_version,
    as_of: '2026-07-30',
    topics: [...new Set(corpus.sources.flatMap(source => source.topic))],
    sector: [...new Set(corpus.sources.flatMap(source => source.sector))],
  });
  const reviewCitationIds = legalEvidencePackage.human_legal_review_items.map(item => item.citation.citation_id).sort();
  assert.ok(reviewCitationIds.length >= 2, 'fixture must carry more than one human-review-only citation for the omission scenario');
  const contextV2Sections = {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', updated_at: '2026-07-30T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-07-30T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-30T10:00:00.000Z' },
      documents: [],
    }),
  };
  const legalContext = { documents: context.documents, deepAnalysis: {}, snapshotId: '11111111-1111-4111-8111-111111111111', contextV2Sections };
  const legalCorpusVersionId = '10101010-1010-4010-8010-101010101010';
  const legalCorpusContentSha256 = 'b'.repeat(64);

  async function runLegalScenario(legalFindings) {
    const observability = spyObservability();
    const rawOutput = validModelOutput({ weaknesses: [], legal_findings: legalFindings });
    const client = fakeClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 1, output_tokens: 1 } }));
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, legalCorpus: true, legalEvidenceProvider: () => legalEvidencePackage,
      legalCorpusVersionId, legalCorpusContentSha256, observability,
    });
    await assert.rejects(() => engine.analyze(legalContext), /no produjo una respuesta válida/i);
    assert.equal(observability.records.length, 1);
    return observability.records[0].fields;
  }

  // Missing or partial deterministic abstention coverage is completed before the final
  // validation and is exercised in the production-path scenario above; it no longer emits
  // output_rejected. The scenarios below remain genuine model errors and must fail closed.

  // A fact classification citing a legal citation id (never renamed as law).
  {
    const fields = await runLegalScenario([
      { classification: 'tender_requirement', text: 'x', evidence_refs: ['document:doc-01'], legal_citation_ids: [reviewCitationIds[0]] },
    ]);
    assert.equal(fields.validation_code, 'legal_classification_misuse');
  }

  // A fact classification asserted without any evidence_ref.
  {
    const fields = await runLegalScenario([
      { classification: 'tender_requirement', text: 'x', evidence_refs: [], legal_citation_ids: [] },
    ]);
    assert.equal(fields.validation_code, 'legal_evidence_missing');
  }

  // legal_obligation with no legal_citation_ids at all.
  {
    const fields = await runLegalScenario([
      { classification: 'legal_obligation', text: 'x', evidence_refs: [], legal_citation_ids: [] },
    ]);
    assert.equal(fields.validation_code, 'legal_citation_missing');
  }

  // legal_obligation citing a real-but-unverified (human-review-only) citation id.
  {
    const fields = await runLegalScenario([
      { classification: 'legal_obligation', text: 'x', evidence_refs: [], legal_citation_ids: [reviewCitationIds[0]] },
    ]);
    assert.equal(fields.validation_code, 'legal_citation_not_verified');
  }

  // human_legal_review citing a totally unknown/invented citation id.
  {
    const fields = await runLegalScenario([
      { classification: 'human_legal_review', text: AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, evidence_refs: [], legal_citation_ids: ['citation:invented:legal-corpus-v1.1'] },
    ]);
    assert.equal(fields.validation_code, 'legal_citation_unknown');
  }

  // human_legal_review with the wrong (non-exact) abstention text.
  {
    const fields = await runLegalScenario([
      { classification: 'human_legal_review', text: 'Podría no estar vigente.', evidence_refs: [], legal_citation_ids: reviewCitationIds },
    ]);
    assert.equal(fields.validation_code, 'legal_abstention_text_mismatch');
  }
}

// ---------------------------------------------------------------------------
// Task 6: engine assembles the governed v3 envelope behind AGT002_INTEGRAL_CONTRACT_V3.
// ---------------------------------------------------------------------------
assert.match(AGT002_INTEGRAL_V3_POLICY, /tender_requirement[^.]*category[^.]*null[^.]*evidence_state[^.]*null/i);
assert.match(AGT002_INTEGRAL_V3_POLICY, /evidence_state_governed[^.]*conclusi[oó]n/i);
assert.match(AGT002_INTEGRAL_V3_POLICY, /strategic_consideration[^.]*strategic[^.]*evidence_state/i);
{
  const v3ContextV2Sections = {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', updated_at: '2026-08-01T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-08-01T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-08-01T10:00:00.000Z' },
      documents: [],
    }),
  };
  const v3RetrievalDocuments = [{
    document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: 'opp-1', snapshot_id: null,
    document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64), current: true,
    extracted_text: 'Requiere póliza vigente de cumplimiento.',
  }];
  const v3RetrievalDeepAnalysis = {
    matrix: {
      legal: [{
        id: 'req-poliza', front: 'legal', label: 'Póliza vigente',
        evidence: [{ document_id: 'ver-01', document_name: 'Pliego', document_type: 'pliego', excerpt: 'Requiere póliza vigente de cumplimiento.' }],
      }],
      financial: [], technical: [],
    },
  };
  const v3Context = {
    documents: v3RetrievalDocuments, deepAnalysis: v3RetrievalDeepAnalysis,
    snapshotId: '55555555-5555-4555-8555-555555555555', contextV2Sections: v3ContextV2Sections,
  };

  // Task (governed metadata fix): the model turn now carries ONLY analysis_units.
  // contract_version and the full coverage block are server-owned — assembled by the
  // engine from validationContext, never transcribed by the model — because a model
  // asked to copy coverage verbatim (manifest versions, sorted 17-class ids, etc.) is
  // exactly the failure mode that produced the production
  // v3_coverage_company_evidence_manifest_version_mismatch rejection.
  function buildV3ModelOutput(options, evidenceState = AGT002_EVIDENCE_STATE_SAFE_UNKNOWN) {
    const requirementEntry = options.input.document_evidence.requirement_manifest[0];
    const allowedRef = options.input.document_evidence.citation_allowlist[0];
    return {
      integral_analysis: {
        analysis_units: [{
          unit_id: 'UNIT-1', unit_kind: 'tender_requirement', requirement_id: requirementEntry.requirement_id,
          category: null, sequence: 1, title: 'Póliza vigente', assessment_mode: 'assessed',
          // Every evidenceState this helper is called with here carries compliance
          // "unknown" (the real evidence-state-manifest never writes a governed compliance
          // determination yet), so the only honest conclusion is "human_validation_required"
          // (P0: a material conclusion can never coexist with compliance "unknown") with
          // confidence "medium" (P1: human_validation_required never uses "high").
          conclusion: { status: 'human_validation_required', summary: 'Evidencia disponible; sin determinación de cumplimiento gobernada.', confidence: 'medium' },
          blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
          // Governed-unit contract: category and the five evidence-state axes are assembled
          // by the server from the requirement/evidence-state manifests. The model wire
          // must leave both slots null even when this fixture supplies a governed state to
          // the engine context.
          evidence_state: null,
          evidence_refs: [{ ref: allowedRef, source_type: 'tender_document', purpose: 'requirement_basis' }],
          missing_evidence: [],
          commercial_impact: { level: 'low', summary: 'Sin impacto.', dimension: 'eligibility' },
          legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
          actions: [],
          milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
          escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
          closure: { status: 'human_confirmation_required', condition: 'Persona confirma.', evidence_required: ['tender_document'] },
          human_validation: { required: true, status: 'pending', reason: 'Confirmar.' },
        }],
      },
    };
  }

  // Flag off: the v2 provider-facing schema/prompt/envelope is exactly unchanged (no v3
  // option ever touches the v2 path).
  {
    const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
    const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
    const result = await engine.analyze(context);
    assert.equal(result.schema_version, '2.0-preview.1');
    assert.equal(Object.hasOwn(client.calls[0], 'v3'), false);
  }

  // Flag on, well-formed model output: the engine assembles the governed v3 envelope,
  // never trusting run identity/coverage/usage from the model, and derives the v2
  // projection after validation.
  {
    const client = fakeClient(async (options) => ({ content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 3, output_tokens: 3 } }));
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      governanceProvenance: governanceProvenanceFixture(),
      companyEvidenceClassesProvider: () => [],
    });
    const result = await engine.analyze(v3Context);

    assert.equal(client.calls[0].outputSchema.required.length, 1);
    assert.deepEqual(client.calls[0].outputSchema.required, ['integral_analysis']);
    // The model-facing wire schema exposes ONLY analysis_units under integral_analysis —
    // contract_version and coverage are never offered as a slot the model could fill in.
    assert.deepEqual(client.calls[0].outputSchema.properties.integral_analysis.required, ['analysis_units']);
    assert.deepEqual(Object.keys(client.calls[0].outputSchema.properties.integral_analysis.properties), ['analysis_units']);

    assert.equal(result.schema_version, '3.0.0');
    assert.equal(result.agent_id, 'AGT-002');
    assert.equal(result.snapshot_id, v3Context.snapshotId);
    assert.equal(result.status, 'completed');
    assert.equal(result.method, 'agent_ai');
    assert.equal(result.human_review_required, true);
    assert.equal(result.integral_analysis.analysis_units[0].category, 'habilitating');
    assert.ok(result.evidence_coverage);
    assert.equal(result.legal_corpus_version_id, null, 'legalCorpus is off for this engine so the corpus binding stays null');

    // The engine — never the model — constructs contract_version and the entire
    // coverage block, exactly from validationContext (governed manifest/catalog/corpus
    // facts), regardless of what (if anything) the model said about them.
    assert.equal(result.integral_analysis.contract_version, 'agt002-integral-analysis-v3');
    assert.deepEqual(result.integral_analysis.coverage, {
      manifest_version: result.evidence_coverage.requirement_manifest_version,
      expected_requirement_ids: ['req-poliza'],
      analyzed_requirement_ids: ['req-poliza'],
      material_omissions: result.evidence_coverage.material_omissions === true,
      omission_reasons: [],
      company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
      company_evidence_class_ids: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
      legal_corpus_version_id: null,
    });
    assert.ok(
      result.integral_analysis.analysis_units.every(unit => ['not_applicable', 'not_verified'].includes(unit.legal_assessment.status)),
      'without a published legal corpus every legal assessment must abstain from a substantive legal conclusion',
    );
    assert.ok(
      result.integral_analysis.analysis_units.every(unit => unit.legal_assessment.basis_refs.length === 0
        && unit.evidence_refs.every(ref => ref.source_type !== 'legal_corpus')),
      'without a published legal corpus no legal basis reference may be emitted',
    );
    assert.ok(
      result.integral_analysis.analysis_units.flatMap(unit => unit.actions)
        .every(action => action.external_side_effect === false && !['go', 'no_go', 'approve', 'sign', 'send', 'submit'].includes(action.action_type)),
      'the envelope contains no autonomous GO/NO-GO, approval, signature, send or submission action',
    );
    assert.equal(result.v2_projection.human_review_required, true);
    // No governed evidence-class link is curated for 'req-poliza' here, so evidence_state
    // is the safe-unknown abstention state, and the deterministic v2 projection correctly
    // downgrades to advance_conditionally rather than a plain (unearned) advance.
    assert.equal(result.v2_projection.recommendation, 'advance_conditionally');
    assert.ok(Array.isArray(result.v2_projection.strengths));
  }

  // With no legal_corpus_version_id, the provider cannot smuggle a substantive legal
  // conclusion into an otherwise valid unit: the server conservatively degrades it to
  // not_verified and forces human legal review plus escalation.
  {
    const client = fakeClient(async (options) => {
      const output = buildV3ModelOutput(options);
      output.integral_analysis.analysis_units[0].legal_assessment = {
        status: 'supported', basis_refs: [], summary: 'Afirmación jurídica sin corpus.', human_legal_review_required: true,
      };
      return { content: JSON.stringify(output), usage: { input_tokens: 1, output_tokens: 1 } };
    });
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      governanceProvenance: governanceProvenanceFixture(),
      companyEvidenceClassesProvider: () => [],
    });
    const result = await engine.analyze(v3Context);
    const normalizedUnit = result.integral_analysis.analysis_units[0];
    assert.equal(normalizedUnit.legal_assessment.status, 'not_verified');
    assert.equal(normalizedUnit.legal_assessment.human_legal_review_required, true);
    assert.equal(normalizedUnit.escalation.required, true);
    assert.notEqual(normalizedUnit.escalation.level, 'none');
  }

  // Design test 27 / audit P1-1: the REAL envelope emitted by runOnceV3 — not a
  // hand-approximated fixture — must be accepted by the same-version consumer
  // (validateAgt002TenderAnalysisEnvelopeV3 / adaptAgt002TenderAnalysisV3). The
  // validationContext below is independently reconstructed from the same governed
  // building blocks the engine itself uses (deriveAgt002IntegralCategoryManifest,
  // buildAgt002EvidenceStateManifest, buildAgt002CompanyEvidenceClasses), exactly as a
  // real second caller of the same version would have to — never read off the engine's
  // internals.
  {
    const client = fakeClient(async (options) => ({ content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 3, output_tokens: 3 } }));
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      governanceProvenance: governanceProvenanceFixture(),
      companyEvidenceClassesProvider: () => [],
    });
    const result = await engine.analyze(v3Context);

    const rawRequirementManifest = result.evidence_coverage.requirement_manifest;
    const requirementManifest = deriveAgt002IntegralCategoryManifest(rawRequirementManifest, { 'req-poliza': 'habilitating' });
    const companyEvidenceClasses = buildAgt002CompanyEvidenceClasses({ registryEntries: [] });
    const evidenceStateManifest = buildAgt002EvidenceStateManifest(rawRequirementManifest, {
      evidenceClasses: companyEvidenceClasses.classes, evidenceClassLinkByRequirementId: {},
    });
    const validationContext = {
      requirementManifestVersion: result.evidence_coverage.requirement_manifest_version,
      requirementManifest,
      companyEvidenceManifestVersion: 'agt002-company-evidence-classes-v1',
      companyEvidenceClassIds: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
      legalCorpusVersionId: null,
      allowlist: {
        tender_document: [...result.evidence_coverage.citation_allowlist],
        company_evidence: [],
        legal_corpus: [],
        human_evidence: [],
        objective_validation: [],
      },
      materialOmissionsObserved: result.evidence_coverage.material_omissions === true,
      evidenceStateManifest,
    };

    const validated = validateAgt002TenderAnalysisEnvelopeV3(result, validationContext);
    assert.equal(validated, result, 'the real producer envelope must pass its own-version consumer unmodified');

    const adapted = adaptAgt002TenderAnalysisV3(result, validationContext);
    assert.equal(adapted.producer, 'AGT-002');
    assert.equal(adapted.run_id, result.run_id);
    assert.equal(adapted.recommendation, result.v2_projection.recommendation);
    assert.equal(adapted.human_review_required, true);

    // P2-1 regression: drive the same real engine envelope through the real persistence
    // boundary in one run. The DB is the only fake; contract assembly, governed safe-unknown
    // evidence state, projection validation/recomputation, and registration are production code.
    const rpcCalls = [];
    const database = { async rpc(name, params) {
      rpcCalls.push({ name, params });
      assert.equal(name, 'psi_record_agt002_canonical_analysis_run');
      return { data: {
        id: '99999999-9999-4999-8999-999999999999', snapshot_id: params.p_snapshot_id,
        producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: true,
        critical_open_count: params.p_critical_open_count, context_version_id: params.p_context_version_id,
      }, error: null };
    } };
    const registered = await registerAgt002PreviewAnalysis(database, {
      opportunity_id: '11111111-1111-4111-8111-111111111111',
      tender_id: '22222222-2222-4222-8222-222222222222',
      snapshot_id: v3Context.snapshotId,
      envelope: result,
      canonicalOnly: true,
      context_version_id: '33333333-3333-4333-8333-333333333333',
    });
    assert.equal(rpcCalls.length, 1);
    assert.equal(registered.result.integral_analysis.analysis_units[0].evidence_state.compliance, 'unknown');
    assert.equal(registered.result.integral_analysis.analysis_units[0].conclusion.status, 'human_validation_required');
    assert.equal(registered.result.recommendation, result.v2_projection.recommendation);
  }

  // The model attempting to forge governed fields (run identity, usage, legacy v2 keys)
  // on its turn must be rejected — the engine, not the provider, owns those.
  {
    const client = fakeClient(async (options) => ({
      content: JSON.stringify({ ...buildV3ModelOutput(options), run_id: '11111111-1111-4111-8111-111111111111' }),
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      governanceProvenance: governanceProvenanceFixture(),
      companyEvidenceClassesProvider: () => [],
    });
    await assert.rejects(() => engine.analyze(v3Context), /no produjo una respuesta válida/i);
  }

  // Fail-closed category derivation: a real 'legal' front requirement with NO governed
  // override must reject the whole v3 run rather than fabricate a category.
  {
    const client = fakeClient(async (options) => ({ content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 1, output_tokens: 1 } }));
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      companyEvidenceClassesProvider: () => [],
      // no categoryOverrides supplied
    });
    await assert.rejects(() => engine.analyze(v3Context), /no está disponible|no produjo una respuesta válida/i);
  }

  // ---------------------------------------------------------------------------
  // Governed origin of the five axes (audit P0 "cumplimiento inferido por presencia"):
  // the engine builds evidence_state fail-closed from a real, curated
  // evidenceClassLinkByRequirementId + the real 17-class catalog — never trusting the
  // model's own claim — and rejects any model output whose evidence_state does not match.
  // ---------------------------------------------------------------------------

  const verifiedRupRegistryRow = {
    entry_id: 'rup', document_class: 'RUP', existence_status: 'verified', human_review_status: 'approved',
    applicability_status: 'applicable', integration_active: true, expiry: '2099-01-01', updated_at: '2026-01-01T00:00:00.000Z',
  };
  const derivedRupEvidenceState = { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'unknown' };

  // A real governed link (requirement -> 'rup') plus an observed, verified class: the
  // model output that reproduces exactly the derived evidence_state is accepted.
  {
    const client = fakeClient(async (options) => ({
      content: JSON.stringify(buildV3ModelOutput(options, derivedRupEvidenceState)), usage: { input_tokens: 3, output_tokens: 3 },
    }));
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      evidenceClassLinkByRequirementId: { 'req-poliza': 'rup' },
      governanceProvenance: governanceProvenanceFixture(),
      companyEvidenceClassesProvider: () => [verifiedRupRegistryRow],
    });

    // Provider-input integration: the model receives the governed axes up front, so it
    // has a real chance to reproduce them (not just a post-hoc rejection surface).
    const result = await engine.analyze(v3Context);
    assert.deepEqual(
      client.calls[0].input.document_evidence.requirement_manifest[0].evidence_state_governed,
      derivedRupEvidenceState,
    );
    assert.deepEqual(result.integral_analysis.analysis_units[0].evidence_state, derivedRupEvidenceState);
  }

  // ---------------------------------------------------------------------------
  // P2-1: the persisted run must preserve the binding/versioning/provenance behind
  // categoryOverrides and evidenceClassLinkByRequirementId — a curated link's class,
  // rationale and version must survive to the envelope, not just its derived effect.
  // ---------------------------------------------------------------------------
  function governanceProvenanceFixture() {
    return {
      'category_override:req-poliza': {
        requirement_id: 'req-poliza', override_kind: 'category_override', category_value: 'habilitating',
        rationale: 'El pliego exige tratar la póliza como habilitante, no como técnico.', source_reference: 'pliego:seccion-2:habilitantes',
        curated_by: '10101010-1010-4010-8010-101010101010', curated_at: '2026-08-07T00:00:00.000Z', version: 1,
      },
      'evidence_class_link:req-poliza': {
        requirement_id: 'req-poliza', override_kind: 'evidence_class_link', evidence_class_id: 'rup',
        rationale: 'El RUP acredita la póliza exigida por el requisito.', source_reference: 'pliego:anexo-1:requisitos-habilitantes',
        curated_by: '10101010-1010-4010-8010-101010101010', curated_at: '2026-08-07T00:00:00.000Z', version: 2,
      },
    };
  }

  // A governed binding backed by real curated provenance: the persisted envelope must
  // carry exactly that provenance, citing evidence class, rationale and version.
  {
    const client = fakeClient(async (options) => ({
      content: JSON.stringify(buildV3ModelOutput(options, derivedRupEvidenceState)), usage: { input_tokens: 3, output_tokens: 3 },
    }));
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      evidenceClassLinkByRequirementId: { 'req-poliza': 'rup' },
      governanceProvenance: governanceProvenanceFixture(),
      companyEvidenceClassesProvider: () => [verifiedRupRegistryRow],
    });
    const result = await engine.analyze(v3Context);
    assert.deepEqual(Object.keys(result.governance_provenance).sort(), ['category_override:req-poliza', 'evidence_class_link:req-poliza']);
    assert.equal(result.governance_provenance['evidence_class_link:req-poliza'].evidence_class_id, 'rup');
    assert.equal(
      result.governance_provenance['evidence_class_link:req-poliza'].rationale,
      governanceProvenanceFixture()['evidence_class_link:req-poliza'].rationale,
    );
    assert.equal(result.governance_provenance['evidence_class_link:req-poliza'].version, 2);
    assert.equal(result.governance_provenance['category_override:req-poliza'].category_value, 'habilitating');
    assert.equal(result.governance_provenance['category_override:req-poliza'].version, 1);
  }

  // A governed map without the exact provenance that authorizes its binding must fail
  // closed. Applying the override and merely omitting governance_provenance would make
  // the persisted run impossible to reconstruct and audit.
  {
    const client = fakeClient(async (options) => ({
      content: JSON.stringify(buildV3ModelOutput(options, derivedRupEvidenceState)), usage: { input_tokens: 3, output_tokens: 3 },
    }));
    assert.throws(() => createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      evidenceClassLinkByRequirementId: { 'req-poliza': 'rup' },
      companyEvidenceClassesProvider: () => [verifiedRupRegistryRow],
    }), /provenance gobernada faltante o inconsistente/i);
  }

  // A provenance record whose bound value does not match what was actually applied (e.g.
  // stale/mismatched curation data) must fail closed, not merely be omitted from the run.
  {
    const client = fakeClient(async (options) => ({
      content: JSON.stringify(buildV3ModelOutput(options, derivedRupEvidenceState)), usage: { input_tokens: 3, output_tokens: 3 },
    }));
    const mismatchedProvenance = governanceProvenanceFixture();
    mismatchedProvenance['evidence_class_link:req-poliza'] = {
      ...mismatchedProvenance['evidence_class_link:req-poliza'], evidence_class_id: 'rut',
    };
    assert.throws(() => createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      evidenceClassLinkByRequirementId: { 'req-poliza': 'rup' },
      governanceProvenance: mismatchedProvenance,
      companyEvidenceClassesProvider: () => [verifiedRupRegistryRow],
    }), /provenance gobernada faltante o inconsistente/i);
  }

  // A model can no longer assert a different evidence_state at all: the wire carries
  // null and the engine deterministically assembles the governed state. Verify that a
  // caller-supplied stale state cannot influence the result.
  {
    const staleCallerState = { ...derivedRupEvidenceState, review: 'partially_reviewed' };
    const client = fakeClient(async (options) => ({
      content: JSON.stringify(buildV3ModelOutput(options, staleCallerState)), usage: { input_tokens: 3, output_tokens: 3 },
    }));
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      evidenceClassLinkByRequirementId: { 'req-poliza': 'rup' },
      governanceProvenance: governanceProvenanceFixture(),
      companyEvidenceClassesProvider: () => [verifiedRupRegistryRow],
    });
    const result = await engine.analyze(v3Context);
    assert.deepEqual(result.integral_analysis.analysis_units[0].evidence_state, derivedRupEvidenceState);
    assert.notDeepEqual(result.integral_analysis.analysis_units[0].evidence_state, staleCallerState);
  }

  // A governed link pointing at a class outside the real 17-class catalog is a
  // configuration/governance error, not absence of signal: the engine fails closed at
  // construction-adjacent validationContext assembly time, never fabricating a state.
  {
    const client = fakeClient(async (options) => ({ content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 1, output_tokens: 1 } }));
    const invalidClassProvenance = governanceProvenanceFixture();
    invalidClassProvenance['evidence_class_link:req-poliza'] = {
      ...invalidClassProvenance['evidence_class_link:req-poliza'], evidence_class_id: 'not-a-real-class',
    };
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      evidenceClassLinkByRequirementId: { 'req-poliza': 'not-a-real-class' },
      governanceProvenance: invalidClassProvenance,
      companyEvidenceClassesProvider: () => [],
    });
    await assert.rejects(() => engine.analyze(v3Context), /no está disponible/i);
  }

  // output_rejected (v3 closed invariant subcodes): validateAgt002PreviewModelOutputV3's
  // rejection is classified into a closed validation_code exactly like the v2 path already
  // is (classifyOutputValidationFailure) — but never by pattern-matching message text, since
  // most v3 fail() messages embed the model's own unit_id/requirement_id. Only the handful of
  // coverage/top-level invariants whose message is always fully static (never carries a
  // model-supplied id) get their own closed error.code, and only those may surface as a
  // specific subcode; everything else keeps the generic v3_invariant_violation fallback.
  {
    // Governed metadata fix regression: contract_version and coverage are server-owned
    // and are never offered as a slot the model could fill in (see buildV3ModelOutput
    // above). A model turn that smuggles either key onto integral_analysis anyway must
    // be rejected outright by the closed schema — never merged, never trusted — with its
    // own fully-static closed subcode (the message never embeds a model-supplied id).
    const observability = spyObservability();
    const client = fakeClient(async (options) => {
      const output = buildV3ModelOutput(options);
      output.integral_analysis.contract_version = 'agt002-integral-analysis-v3';
      output.integral_analysis.coverage = {
        manifest_version: options.input.document_evidence.requirement_manifest_version,
        expected_requirement_ids: [options.input.document_evidence.requirement_manifest[0].requirement_id],
        analyzed_requirement_ids: [options.input.document_evidence.requirement_manifest[0].requirement_id],
        material_omissions: false,
        omission_reasons: [],
        company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
        company_evidence_class_ids: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
        legal_corpus_version_id: null,
      };
      return { content: JSON.stringify(output), usage: { input_tokens: 1, output_tokens: 1 } };
    });
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      governanceProvenance: governanceProvenanceFixture(),
      companyEvidenceClassesProvider: () => [],
      observability,
    });
    await assert.rejects(() => engine.analyze(v3Context), /no produjo una respuesta válida/i);
    assert.equal(observability.records.length, 1);
    const [{ fields }] = observability.records;
    assert.equal(fields.stage, 'semantic_validation');
    assert.equal(
      fields.validation_code, 'v3_model_output_shape_mismatch',
      'a model attempting to supply server-owned contract_version/coverage must surface its own closed subcode, not the generic fallback',
    );
  }

  {
    // Per-unit smuggling attempt: a tender unit supplying model-owned evidence_state is
    // rejected with the same closed shape subcode; values/messages never enter telemetry.
    const observability = spyObservability();
    const mismatchedEvidenceState = { ...derivedRupEvidenceState, review: 'partially_reviewed' };
    const client = fakeClient(async (options) => {
      const output = buildV3ModelOutput(options);
      output.integral_analysis.analysis_units[0].evidence_state = mismatchedEvidenceState;
      return { content: JSON.stringify(output), usage: { input_tokens: 3, output_tokens: 3 } };
    });
    const engine = createAgt002PreviewEngine({
      client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
      categoryOverrides: { 'req-poliza': 'habilitating' },
      evidenceClassLinkByRequirementId: { 'req-poliza': 'rup' },
      governanceProvenance: governanceProvenanceFixture(),
      companyEvidenceClassesProvider: () => [verifiedRupRegistryRow],
      observability,
    });
    await assert.rejects(() => engine.analyze(v3Context), /no produjo una respuesta válida/i);
    assert.equal(observability.records.length, 1);
    const [{ fields }] = observability.records;
    assert.equal(fields.stage, 'semantic_validation');
    assert.equal(fields.validation_code, 'v3_model_output_shape_mismatch');
  }

  // integralContractV3 requires contextV2 + documentRetrieval + a company evidence
  // classes provider at construction time; it must fail closed like the other
  // configuration checks, never silently no-op.
  assert.throws(
    () => createAgt002PreviewEngine({ client: { run: async () => {} }, ...baseEngineOptions(), integralContractV3: true }),
    /no está configurado/i,
  );
  assert.throws(
    () => createAgt002PreviewEngine({
      client: { run: async () => {} }, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
    }),
    /no está configurado/i,
    'integralContractV3 must fail closed without companyEvidenceClassesProvider',
  );
}

console.log('AGT-002 Preview engine orchestration passed');
