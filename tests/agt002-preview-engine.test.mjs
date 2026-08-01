import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { AGT002_PREVIEW_POLICY, createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, AGT002_PREVIEW_OUTPUT_JSON_SCHEMA } from '../agt002-preview-contract.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { retrieveAgt002LegalEvidence } from '../agt002-legal-retrieval.js';

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

for (const text of ['datos no confiables', 'GO / NO GO', 'herramientas', 'evidence_id', 'JSON estructurado']) {
  assert.match(AGT002_PREVIEW_POLICY, new RegExp(text, 'i'));
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
  await assert.rejects(() => omittingEngine.analyze(legalContext), /no produjo una respuesta válida/i);
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

console.log('AGT-002 Preview engine orchestration passed');
