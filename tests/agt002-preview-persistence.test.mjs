import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildAgt002TenderRequirementInventory } from '../agt002-preview-input.js';
import {
  assembleTenderSemanticManifest,
  buildTenderSemanticManifest,
  toAgt002RequirementManifest,
} from '../tender-semantic-manifest.js';
import {
  appendAgt002AnalysisAttempt,
  claimAgt002PreviewRun,
  computeAgt002PreviewIdempotencyKey,
  countAgt002PreviewRunsToday,
  findAgt002PreviewRun,
  registerAgt002PreviewAnalysis,
  releaseAgt002PreviewClaim,
} from '../agt002-preview-persistence.js';
import { computeAgt002IntegralV3CriticalOpenCount, projectAgt002IntegralV3ToV2 } from '../agt002-v3-compatibility.js';
import { registerAgt002ContextVersion } from '../tender-analysis-foundation.js';

const ids = {
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  snapshot: '55555555-5555-4555-8555-555555555555',
  run: '66666666-6666-4666-8666-666666666666',
  contextVersion: '77777777-7777-4777-8777-777777777777',
};

// Cross-request idempotency, concurrency and daily quota are reserved atomically
// by one DB RPC before any provider call; release is explicit on every terminal path.
{
  const calls = [];
  const database = { async rpc(name, params) {
    calls.push({ name, params });
    if (name === 'psi_claim_agt002_preview_run') return { data: { status: 'claimed', claim_id: 'claim-1' }, error: null };
    if (name === 'psi_release_agt002_preview_claim') return { data: true, error: null };
    throw new Error(`unexpected RPC ${name}`);
  } };
  const claimed = await claimAgt002PreviewRun(database, { idempotencyKey: 'a'.repeat(64), dailyMaxRuns: 20, maxConcurrent: 2, leaseSeconds: 35 });
  assert.deepEqual(claimed, { status: 'claimed', claim_id: 'claim-1' });
  assert.deepEqual(calls[0], { name: 'psi_claim_agt002_preview_run', params: { p_idempotency_key: 'a'.repeat(64), p_daily_max_runs: 20, p_max_concurrent: 2, p_lease_seconds: 35 } });
  await releaseAgt002PreviewClaim(database, { idempotencyKey: 'a'.repeat(64), claimId: 'claim-1' });
  assert.deepEqual(calls[1], { name: 'psi_release_agt002_preview_claim', params: { p_idempotency_key: 'a'.repeat(64), p_claim_id: 'claim-1' } });
}

for (const status of ['existing', 'in_progress', 'quota', 'saturated']) {
  const database = { async rpc(name) { assert.equal(name, 'psi_claim_agt002_preview_run'); return { data: { status }, error: null }; } };
  assert.deepEqual(await claimAgt002PreviewRun(database, { idempotencyKey: 'b'.repeat(64), dailyMaxRuns: 5, maxConcurrent: 1, leaseSeconds: 30 }), { status });
}

function envelope(overrides = {}) {
  return {
    schema_version: '2.0-preview.1',
    agent_id: 'AGT-002',
    producer: 'AGT-002',
    run_id: '77777777-7777-4777-8777-777777777777',
    snapshot_id: ids.snapshot,
    policy_version: 'agt002-preview-policy-v1',
    status: 'completed',
    method: 'agent_ai',
    recommendation: 'pause',
    summary: 'Falta póliza vigente extraída de doc-01 (documento no confiable citado sólo como referencia).',
    strengths: [],
    weaknesses: [{ id: 'f-1', text: 'Falta póliza vigente.', critical: true, evidence_refs: ['document:doc-01'] }],
    blockers: [],
    questions: [
      { id: 'q-1', text: '¿Existe certificado?', critical: true, evidence_refs: [] },
      { id: 'q-2', text: '¿Existe RUP?', critical: false, evidence_refs: [] },
    ],
    unverified: [],
    next_action: 'Solicitar póliza vigente.',
    human_review_required: true,
    evidence_coverage: {
      snapshot_id: ids.snapshot,
      budget: { max_chunks: 2, max_chars: 1000, max_tokens: 300, chunks_used: 1, chars_used: 40, tokens_used: 8, chunks_remaining: 1, chars_remaining: 960, tokens_remaining: 292 },
      coverage_manifest: { total_requirements: 1, covered_requirements: 1, uncovered_requirements: 0, by_requirement: [{ requirement_id: 'req-1', status: 'covered', selected_evidence_refs: ['chunk:1'], omission_reasons: [] }] },
      selected_chunks: [{ chunk_id: 'chunk:1', evidence_ref: 'chunk:1', document_id: 'doc-01', name: 'Pliego', document_type: 'pliego', version: 1, page: 1, section: 'Objeto', precedence: 'base', superseded_by_addendum: false, requirement_ids: ['req-1'] }],
      omitted_chunks: [],
      citation_allowlist: ['chunk:1'],
      material_omissions: false,
      requirement_manifest_version: '1.0',
      requirement_manifest: [{
        requirement_id: 'req-1', front: 'legal', label: 'Póliza de cumplimiento',
        sources: [{ document_id: 'doc-01', document_version_id: 'ver-01', content_hash: 'a'.repeat(64) }],
        unresolved_sources: [],
      }],
    },
    usage: { provider: 'codex_app_server', model: 'synthetic-codex-model', input_tokens: 120, output_tokens: 40, rate_limit: { window: '5h', used_percent: 3 } },
    ...overrides,
  };
}

const LEGAL_CORPUS_VERSION_ID = '10101010-1010-4010-8010-101010101010';

function legalEnvelope(overrides = {}) {
  const citation = {
    citation_id: 'citation:ley-80-1993-art-1:legal-corpus-v1', source_id: 'ley-80-1993-art-1',
    norm_type: 'ley', norm_number: '80', year: 1993, article_or_section: 'Artículo 1',
    issuing_authority: 'Congreso de la República', official_url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?ruta=Leyes/1790106',
    verified_at: '2026-07-30', corpus_version: 'legal-corpus-v1', label: 'Ley 80 de 1993, Artículo 1',
  };
  return envelope({
    legal_evidence: {
      corpus_version: 'legal-corpus-v1', as_of: '2026-07-30',
      query: { process_stage: null, modality: null, topics: ['contratación estatal'], sector: ['sector público'], max_results: null },
      verified_legal_evidence: [],
      human_legal_review_items: [{ source_id: 'ley-80-1993-art-1', topic: ['contratación estatal'], sector: ['sector público'], citation, statement: 'No verificado jurídicamente; requiere revisión humana', reasons: ['validity_uncertain'] }],
      citation_allowlist: [], coverage: { matched_source_ids: ['ley-80-1993-art-1'], considered_count: 1, returned_count: 1 }, omissions: [], abstention_state: 'abstained',
    },
    legal_findings: [{ classification: 'human_legal_review', text: 'No verificado jurídicamente; requiere revisión humana', evidence_refs: [], legal_citation_ids: [citation.citation_id] }],
    legal_corpus_version_id: LEGAL_CORPUS_VERSION_ID,
    ...overrides,
  });
}

function fakeDatabase({ onRpc } = {}) {
  const rpcCalls = [];
  const runs = new Map();
  return {
    rpcCalls,
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      if (onRpc) {
        const overridden = onRpc(name, params);
        if (overridden) return overridden;
      }
      if (!['psi_record_tender_analysis_run', 'psi_record_agt002_canonical_analysis_run'].includes(name)) throw new Error(`unexpected RPC ${name}`);
      const existing = runs.get(params.p_idempotency_key);
      if (existing) {
        const semantic = { ...existing.params };
        assert.deepEqual(params, semantic, 'idempotency replay must be semantically identical, mirroring the real RPC');
        return { data: existing.data, error: null };
      }
      const canonical = name === 'psi_record_agt002_canonical_analysis_run';
      const data = { id: ids.run, snapshot_id: params.p_snapshot_id, producer: params.p_producer || 'AGT-002', method: params.p_method || 'agent_ai', status: params.p_status || 'completed', canonical, critical_open_count: params.p_critical_open_count };
      runs.set(params.p_idempotency_key, { params, data });
      return { data, error: null };
    },
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          if (table !== 'psi_tender_analysis_runs') throw new Error(`unexpected table ${table}`);
          return { data: null, error: null };
        },
      };
    },
  };
}

// Deterministic idempotency key: stable within one contract, while v3 cannot
// collide with the legacy v2 identity for the same snapshot/policy/model.
{
  const a = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1' });
  const b = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1' });
  const c = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v2', model: 'm1' });
  const d = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm2' });
  const v3a = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', contractVersion: 'agt002-integral-analysis-v3' });
  const v3b = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', contractVersion: 'agt002-integral-analysis-v3' });
  assert.equal(a, b);
  assert.equal(v3a, v3b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.notEqual(a, v3a, 'v3 must not reuse a v2 run with the same snapshot/policy/model identity');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.match(v3a, /^[0-9a-f]{64}$/);
}

// The optional company-evidence identity triple binds the run to WHICH evidence backed it:
// absent entirely, the key must be byte-for-byte the same as before this triple existed
// (exact backward compatibility); present, it must be all-or-nothing and change the key.
{
  const EVIDENCE_HASH_A = createHash('sha256').update('evidence-snapshot-a').digest('hex');
  const EVIDENCE_HASH_B = createHash('sha256').update('evidence-preview-a').digest('hex');
  const EVIDENCE_HASH_A2 = createHash('sha256').update('evidence-snapshot-a2').digest('hex');

  const withoutTriple = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', contractVersion: 'agt002-integral-analysis-v3' });
  const compatWithoutTriple = computeAgt002PreviewIdempotencyKey({
    snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', contractVersion: 'agt002-integral-analysis-v3',
    evidenceSourceSnapshotHash: null, evidencePreviewArtifactHash: null, evidenceSourceManifestVersion: null,
  });
  assert.equal(withoutTriple, compatWithoutTriple, 'explicit nulls must be identical to omitting the triple entirely');

  const withTriple = computeAgt002PreviewIdempotencyKey({
    snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', contractVersion: 'agt002-integral-analysis-v3',
    evidenceSourceSnapshotHash: EVIDENCE_HASH_A, evidencePreviewArtifactHash: EVIDENCE_HASH_B, evidenceSourceManifestVersion: 'v0.3.1-approved-20260829',
  });
  const withTripleAgain = computeAgt002PreviewIdempotencyKey({
    snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', contractVersion: 'agt002-integral-analysis-v3',
    evidenceSourceSnapshotHash: EVIDENCE_HASH_A, evidencePreviewArtifactHash: EVIDENCE_HASH_B, evidenceSourceManifestVersion: 'v0.3.1-approved-20260829',
  });
  const withDifferentEvidenceHash = computeAgt002PreviewIdempotencyKey({
    snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', contractVersion: 'agt002-integral-analysis-v3',
    evidenceSourceSnapshotHash: EVIDENCE_HASH_A2, evidencePreviewArtifactHash: EVIDENCE_HASH_B, evidenceSourceManifestVersion: 'v0.3.1-approved-20260829',
  });
  const withDifferentManifestVersion = computeAgt002PreviewIdempotencyKey({
    snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', contractVersion: 'agt002-integral-analysis-v3',
    evidenceSourceSnapshotHash: EVIDENCE_HASH_A, evidencePreviewArtifactHash: EVIDENCE_HASH_B, evidenceSourceManifestVersion: 'v0.2-provisional-20260801',
  });
  assert.equal(withTriple, withTripleAgain);
  assert.notEqual(withTriple, withoutTriple, 'supplying the evidence identity must change the key');
  assert.notEqual(withTriple, withDifferentEvidenceHash, 'a changed evidence hash must change the key');
  assert.notEqual(withTriple, withDifferentManifestVersion, 'a changed evidence source_manifest_version must change the key');
  assert.match(withTriple, /^[0-9a-f]{64}$/);

  // Atomic: only some of the triple present, or an invalid hash shape, must fail closed.
  assert.throws(() => computeAgt002PreviewIdempotencyKey({
    snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', evidenceSourceSnapshotHash: EVIDENCE_HASH_A,
  }), /evidencia empresarial/i);
  assert.throws(() => computeAgt002PreviewIdempotencyKey({
    snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1',
    evidenceSourceSnapshotHash: EVIDENCE_HASH_A, evidencePreviewArtifactHash: EVIDENCE_HASH_B, evidenceSourceManifestVersion: '',
  }), /evidencia empresarial/i);
  assert.throws(() => computeAgt002PreviewIdempotencyKey({
    snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1',
    evidenceSourceSnapshotHash: 'not-a-hash', evidencePreviewArtifactHash: EVIDENCE_HASH_B, evidenceSourceManifestVersion: 'v0.3.1-approved-20260829',
  }), /hashes sha256/i);
}

// A caller that reserved one identity may never persist an envelope that recomputes to another.
// This is checked before any database RPC, so a mismatched inventory/context cannot consume or
// hijack a different claim.
{
  const database = fakeDatabase();
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity,
    tender_id: ids.tender,
    snapshot_id: ids.snapshot,
    envelope: envelope(),
    expectedIdempotencyKey: 'f'.repeat(64),
  }), /idempotencia|reserva|identidad/i);
  assert.equal(database.rpcCalls.length, 0);
}

// Registration persists a closed content-only result: no identity/usage duplication, no prompt.
{
  const database = fakeDatabase();
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: envelope(),
  });
  assert.equal(registered.run_id, ids.run);
  assert.equal(registered.snapshot_id, ids.snapshot);
  assert.equal(registered.producer, 'AGT-002');
  assert.equal(registered.method, 'agent_ai');
  assert.equal(registered.status, 'completed');
  assert.equal(registered.current, true);
  assert.equal(registered.critical_open_count, 1, 'must count only critical questions');
  assert.deepEqual(Object.keys(registered.result).sort(), ['blockers', 'evidence_coverage', 'human_review_required', 'next_action', 'questions', 'recommendation', 'strengths', 'summary', 'unverified', 'weaknesses'].sort());
  assert.deepEqual(registered.result.evidence_coverage, envelope().evidence_coverage);
  assert.doesNotMatch(JSON.stringify(registered.result.evidence_coverage), /"text"\s*:/, 'coverage metadata must never persist chunk text');

  // The self-contained requirement provenance manifest must survive persistence exactly
  // (id/front/label/sources), never carrying excerpt/chunk text.
  assert.equal(registered.result.evidence_coverage.requirement_manifest_version, '1.0');
  assert.deepEqual(registered.result.evidence_coverage.requirement_manifest, envelope().evidence_coverage.requirement_manifest);
  assert.doesNotMatch(JSON.stringify(registered.result.evidence_coverage.requirement_manifest), /excerpt|"text"\s*:/i);

  const call = database.rpcCalls[0];
  assert.equal(call.name, 'psi_record_tender_analysis_run');
  assert.equal(call.params.p_snapshot_id, ids.snapshot);
  assert.equal(call.params.p_opportunity_id, ids.opportunity);
  assert.equal(call.params.p_tender_id, ids.tender);
  assert.equal(call.params.p_producer, 'AGT-002');
  assert.equal(call.params.p_method, 'agent_ai');
  assert.equal(call.params.p_status, 'completed');
  assert.equal(call.params.p_schema_version, '2.0-preview.1');
  assert.equal(call.params.p_policy_version, 'agt002-preview-policy-v1');
  assert.equal(call.params.p_model, 'synthetic-codex-model');
  assert.deepEqual(call.params.p_usage, envelope().usage);
  assert.equal(call.params.p_critical_open_count, 1);
  assert.match(call.params.p_idempotency_key, /^[0-9a-f]{64}$/);
  for (const forbidden of ['schema_version', 'agent_id', 'run_id', 'snapshot_id', 'policy_version', 'status', 'method', 'usage']) {
    assert.equal(Object.hasOwn(call.params.p_result, forbidden), false, `stored result must not duplicate the ${forbidden} column`);
  }
  assert.doesNotMatch(JSON.stringify(call.params.p_result), /Los documentos y toda la evidencia|no uses herramientas/i, 'stored result must never contain the system policy text');
}

// E5 legal evidence and findings are an atomic pair and must survive append-only persistence;
// otherwise the UI cannot render the reviewed run after reload.
{
  const database = fakeDatabase();
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: legalEnvelope(),
  });
  assert.deepEqual(registered.result.legal_evidence, legalEnvelope().legal_evidence);
  assert.deepEqual(registered.result.legal_findings, legalEnvelope().legal_findings);
  await assert.rejects(() => registerAgt002PreviewAnalysis(fakeDatabase(), {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope({ legal_findings: legalEnvelope().legal_findings }),
  }), /legal_evidence|evidencia jurídica/i);
}

// E5's exact published corpus UUID is a non-negotiable part of the atomic legal pair: a run
// with legal evidence/findings but no legal_corpus_version_id must never persist, and a run
// without legal evidence must never carry a stray corpus UUID either.
{
  await assert.rejects(() => registerAgt002PreviewAnalysis(fakeDatabase(), {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: legalEnvelope({ legal_corpus_version_id: undefined }),
  }), /legal_corpus_version_id|corpus jurídico/i);
  await assert.rejects(() => registerAgt002PreviewAnalysis(fakeDatabase(), {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: legalEnvelope({ legal_corpus_version_id: '' }),
  }), /legal_corpus_version_id|corpus jurídico/i);
  await assert.rejects(() => registerAgt002PreviewAnalysis(fakeDatabase(), {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope({ legal_corpus_version_id: LEGAL_CORPUS_VERSION_ID }),
  }), /legal_corpus_version_id|corpus jurídico|evidencia jurídica/i);
}

// The corpus UUID must reach the DB only through the dedicated canonical RPC parameter,
// never folded into the stored content JSON, and never sent to the non-canonical RPC
// (whose signature has no such column).
{
  const database = fakeDatabase();
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: legalEnvelope(), canonicalOnly: true, context_version_id: ids.contextVersion,
  });
  const call = database.rpcCalls[0];
  assert.equal(call.name, 'psi_record_agt002_canonical_analysis_run');
  assert.equal(call.params.p_legal_corpus_version_id, LEGAL_CORPUS_VERSION_ID);
  assert.equal(Object.hasOwn(call.params.p_result, 'legal_corpus_version_id'), false, 'the corpus UUID must not be duplicated inside the stored content JSON');
  assert.equal(registered.legal_corpus_version_id, LEGAL_CORPUS_VERSION_ID);
}
{
  const database = fakeDatabase();
  await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: legalEnvelope(),
  });
  assert.equal(Object.hasOwn(database.rpcCalls[0].params, 'p_legal_corpus_version_id'), false, 'the non-canonical RPC has no legal_corpus_version_id column');
}

// Idempotency must differ when only the corpus UUID changes: the same snapshot/policy/model
// re-run against a superseded-then-republished corpus is a materially different attribution.
{
  const withoutLegal = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1' });
  const withLegal = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', legalCorpusVersionId: LEGAL_CORPUS_VERSION_ID });
  const withOtherLegal = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1', legalCorpusVersionId: '20202020-2020-4020-8020-202020202020' });
  assert.notEqual(withLegal, withoutLegal);
  assert.notEqual(withLegal, withOtherLegal);
  assert.match(withLegal, /^[0-9a-f]{64}$/);
}

// Coverage metadata is snapshot-bound; persistence rejects cross-snapshot evidence.
{
  const database = fakeDatabase();
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity,
    tender_id: ids.tender,
    snapshot_id: ids.snapshot,
    envelope: envelope({ evidence_coverage: { ...envelope().evidence_coverage, snapshot_id: 'other-snapshot' } }),
  }), /cobertura|snapshot/i);
  assert.deepEqual(database.rpcCalls, []);
}

// Persistence never trusts a requirement_manifest verbatim: it re-validates the closed
// id/front/label/sources shape and rejects a manifest missing entirely, with a leaking
// text/excerpt field, or with zero resolved provenance.
{
  const database = fakeDatabase();
  const { requirement_manifest_version: _v, requirement_manifest: _m, ...coverageWithoutManifest } = envelope().evidence_coverage;
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope({ evidence_coverage: coverageWithoutManifest }),
  }), /cobertura|manifiesto|estructura/i);
  assert.deepEqual(database.rpcCalls, []);
}
{
  const database = fakeDatabase();
  const leakingManifest = [{
    requirement_id: 'req-1', front: 'legal', label: 'Póliza de cumplimiento',
    sources: [{ document_id: 'doc-01', document_version_id: 'ver-01', content_hash: 'a'.repeat(64), text: 'texto filtrado' }],
    unresolved_sources: [],
  }];
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope({ evidence_coverage: { ...envelope().evidence_coverage, requirement_manifest: leakingManifest } }),
  }), /texto/i);
  assert.deepEqual(database.rpcCalls, []);
}
{
  const database = fakeDatabase();
  const zeroProvenanceManifest = [{
    requirement_id: 'req-1', front: 'legal', label: 'Póliza de cumplimiento',
    sources: [],
    unresolved_sources: [{ document_id: 'ver-missing', reason: 'document_identity_not_resolved' }],
  }];
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope({ evidence_coverage: { ...envelope().evidence_coverage, requirement_manifest: zeroProvenanceManifest } }),
  }), /procedencia|resuelt/i);
  assert.deepEqual(database.rpcCalls, []);
}

// ---------------------------------------------------------------------------
// The tender-native semantic manifest is the audit trail BEHIND the persisted
// requirement_manifest, so persistence never trusts it verbatim either: it is
// re-validated against the tender_requirement_inventory the same coverage carries,
// and its projection must equal the persisted requirement_manifest exactly. Without
// that boundary check a forged, stale or foreign manifest could be saved as the
// audit record of a frontier it never produced.
// ---------------------------------------------------------------------------
const semanticHash = value => createHash('sha256').update(value).digest('hex');

const SEMANTIC_TEXT = [
  'REQUISITOS FINANCIEROS',
  'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
].join('\n');
const SEMANTIC_TEXT_CHANGED = [
  SEMANTIC_TEXT,
  'REQUISITOS TÉCNICOS',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
].join('\n');

function semanticFixture({ snapshotId = ids.snapshot, text = SEMANTIC_TEXT, versionId = 'ver-semantic-1' } = {}) {
  const documents = [{
    document_id: 'doc-semantic', document_version_id: versionId, opportunity_id: ids.opportunity, snapshot_id: null,
    document_type: 'pliego', name: 'Pliego.pdf', version: 1, content_hash: semanticHash(text), current: true,
    extracted_text: text,
  }];
  const inventory = buildAgt002TenderRequirementInventory({ snapshotId, documents, documentGaps: [] });
  const manifest = buildTenderSemanticManifest({ inventory, documents });
  return { documents, inventory, manifest, projection: toAgt002RequirementManifest({ semanticManifest: manifest, inventory }) };
}

const semantic = semanticFixture();
const semanticChanged = semanticFixture({ text: SEMANTIC_TEXT_CHANGED, versionId: 'ver-semantic-2' });
const semanticOtherSnapshot = semanticFixture({ snapshotId: '44444444-4444-4444-8444-444444444444' });

function semanticCoverage(overrides = {}) {
  return {
    ...envelope().evidence_coverage,
    requirement_manifest_version: semantic.projection.requirement_manifest_version,
    requirement_manifest: semantic.projection.requirement_manifest,
    tender_requirement_inventory: semantic.inventory,
    tender_semantic_manifest: semantic.manifest,
    ...overrides,
  };
}
const semanticEnvelope = (coverageOverrides = {}) => envelope({ evidence_coverage: semanticCoverage(coverageOverrides) });
const semanticContext = envelopeValue => ({
  opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: envelopeValue,
});

// An intact manifest whose projection IS the persisted frontier survives verbatim.
{
  const database = fakeDatabase();
  const registered = await registerAgt002PreviewAnalysis(database, semanticContext(semanticEnvelope()));
  assert.deepEqual(registered.result.evidence_coverage.tender_semantic_manifest, semantic.manifest);
  assert.deepEqual(registered.result.evidence_coverage.requirement_manifest, semantic.projection.requirement_manifest);
  assert.equal(database.rpcCalls.length, 1);
}

// Every way the manifest can disagree with the expediente it claims to describe — or with
// the frontier it claims to have produced — must fail closed before any RPC.
{
  const forgedCitation = structuredClone(semantic.manifest);
  forgedCitation.requirements[0].citations[0].unit_hash = semanticHash('forjado');

  const cases = [
    ['forged manifest hash',
      { tender_semantic_manifest: { ...semantic.manifest, semantic_manifest_hash: semanticHash('otro manifiesto') } },
      /manifiesto|hash/i],
    ['forged citation hash', { tender_semantic_manifest: forgedCitation }, /manifiesto|cita|unidad|hash/i],
    ['a manifest belonging to another snapshot',
      { tender_semantic_manifest: semanticOtherSnapshot.manifest },
      /manifiesto|inventario|snapshot|identidad/i],
    ['a changed requirement whose projection no longer matches the persisted frontier',
      { tender_requirement_inventory: semanticChanged.inventory, tender_semantic_manifest: semanticChanged.manifest },
      /manifiesto|requisito|proyección|coincide/i],
    ['a persisted frontier relabeled away from the manifest that produced it',
      { requirement_manifest: semantic.projection.requirement_manifest.map((entry, index) => (index === 0 ? { ...entry, label: 'Capital de trabajo' } : entry)) },
      /manifiesto|requisito|etiqueta|proyección|coincide/i],
  ];
  for (const [label, coverageOverrides, pattern] of cases) {
    const database = fakeDatabase();
    await assert.rejects(
      () => registerAgt002PreviewAnalysis(database, semanticContext(semanticEnvelope(coverageOverrides))),
      pattern,
      `a semantic manifest with ${label} must never persist`,
    );
    assert.deepEqual(database.rpcCalls, [], `${label} must be rejected before any RPC`);
  }
}

// A semantic manifest with no inventory in the same coverage has nothing to be
// re-validated against, so it can never be persisted as an audit record.
{
  const database = fakeDatabase();
  const coverage = semanticCoverage();
  delete coverage.tender_requirement_inventory;
  await assert.rejects(
    () => registerAgt002PreviewAnalysis(database, semanticContext(envelope({ evidence_coverage: coverage }))),
    /manifiesto|inventario/i,
  );
  assert.deepEqual(database.rpcCalls, []);
}

// ---------------------------------------------------------------------------
// A manifest whose origin is a MODEL PROPOSAL carries labels a model wrote. Every id and hash
// beside them was recomputed by the server over exactly those labels, so the manifest is
// self-consistent no matter what the model invented: a self-contained hash check can never tell
// `Capital de trabajo` apart from the `Nivel de apalancamiento` clause it cites. The persisted
// audit record is only worth keeping if the label is literally anchored in the expediente's own
// text, so persistence must be handed the independent source documents and must re-derive that
// anchoring itself — refusing the run when they are missing, when they do not reconstruct this
// inventory, or when the label appears in none of the units it cites.
// ---------------------------------------------------------------------------
{
  const proposed = semantic.manifest.requirements[0];
  const modelProposal = label => assembleTenderSemanticManifest({
    inventory: semantic.inventory,
    documents: semantic.documents,
    origin: 'model_proposal',
    proposalHash: semanticHash(`propuesta-modelo:${label}`),
    requirements: [{
      kind: 'obligation',
      label,
      front: proposed.front,
      front_evidence: { ...proposed.front_evidence },
      citations: proposed.citations.map(citation => ({ ...citation })),
    }],
  });
  const proposalCoverage = manifest => {
    const projection = toAgt002RequirementManifest({ semanticManifest: manifest, inventory: semantic.inventory });
    return semanticCoverage({
      requirement_manifest_version: projection.requirement_manifest_version,
      requirement_manifest: projection.requirement_manifest,
      tender_semantic_manifest: manifest,
    });
  };
  const anchoredProposal = modelProposal('Nivel de apalancamiento');

  // No independent source documents: nothing anchors the proposed labels, so nothing may persist.
  {
    const database = fakeDatabase();
    await assert.rejects(
      () => registerAgt002PreviewAnalysis(database, semanticContext(envelope({ evidence_coverage: proposalCoverage(anchoredProposal) }))),
      /texto|fuente|documento|propuesta|manifiesto/i,
    );
    assert.deepEqual(database.rpcCalls, [], 'a model proposal with no source text must be rejected before any RPC');
  }

  // Documents that do not reconstruct THIS inventory are not this expediente's source text either.
  {
    const database = fakeDatabase();
    await assert.rejects(
      () => registerAgt002PreviewAnalysis(database, {
        ...semanticContext(envelope({ evidence_coverage: proposalCoverage(anchoredProposal) })),
        semanticSourceDocuments: semanticChanged.documents,
      }),
      /texto|fuente|documento|inventario|unidad|manifiesto/i,
    );
    assert.deepEqual(database.rpcCalls, []);
  }

  // An invented label over the very same citations, with the real documents supplied.
  {
    const database = fakeDatabase();
    await assert.rejects(
      async () => registerAgt002PreviewAnalysis(database, {
        ...semanticContext(envelope({ evidence_coverage: proposalCoverage(modelProposal('Capital de trabajo')) })),
        semanticSourceDocuments: semantic.documents,
      }),
      /etiqueta|literal|texto|fuente|cita|propuesta|manifiesto/i,
      'this snapshot never says "Capital de trabajo"; a model that wrote it invented an obligation',
    );
    assert.deepEqual(database.rpcCalls, []);
  }

  // With the exact source documents behind it, an anchored proposal persists verbatim.
  {
    const database = fakeDatabase();
    const registered = await registerAgt002PreviewAnalysis(database, {
      ...semanticContext(envelope({ evidence_coverage: proposalCoverage(anchoredProposal) })),
      semanticSourceDocuments: semantic.documents,
    });
    assert.deepEqual(registered.result.evidence_coverage.tender_semantic_manifest, anchoredProposal);
    assert.equal(registered.result.evidence_coverage.tender_semantic_manifest.origin, 'model_proposal');
    assert.equal(database.rpcCalls.length, 1);
    assert.doesNotMatch(
      JSON.stringify(registered.result.evidence_coverage),
      /"(?:text|extracted_text)"\s*:/,
      'anchoring is verified from the supplied documents; their raw text is never persisted',
    );
  }
}

// Canonical-only registration is fail-closed without an immutable context version.
{
  const database = fakeDatabase();
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: envelope(), canonicalOnly: true,
  }), /context_version_id/i);
  assert.deepEqual(database.rpcCalls, []);
}

// A production-owned canonical registration rejects a legacy envelope with no tender inventory before any RPC.
{
  const database = fakeDatabase();
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity,
    tender_id: ids.tender,
    snapshot_id: ids.snapshot,
    envelope: envelope(),
    canonicalOnly: true,
    context_version_id: ids.contextVersion,
    requireTenderRequirementInventory: true,
  }), /tender_requirement_inventory|inventario/i);
  assert.deepEqual(database.rpcCalls, []);
}

// Canonical-only registration uses the dedicated RPC and cannot supply a competing producer/method/status.
{
  const database = fakeDatabase();
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: envelope(), canonicalOnly: true,
    context_version_id: ids.contextVersion,
  });
  const call = database.rpcCalls[0];
  assert.equal(call.name, 'psi_record_agt002_canonical_analysis_run');
  assert.equal(call.params.p_context_version_id, ids.contextVersion);
  assert.equal(registered.canonical, true);
  assert.equal(Object.hasOwn(call.params, 'p_producer'), false);
  assert.equal(Object.hasOwn(call.params, 'p_method'), false);
  assert.equal(Object.hasOwn(call.params, 'p_status'), false);
}

// An exact idempotency replay may refer to a run that has since been superseded.
// Persistence must preserve the RPC's real canonical state instead of forcing it true.
{
  const database = fakeDatabase({ onRpc(name, params) {
    if (name !== 'psi_record_agt002_canonical_analysis_run') return null;
    return { data: {
      id: ids.run, snapshot_id: params.p_snapshot_id, producer: 'AGT-002', method: 'agent_ai',
      status: 'completed', canonical: false, critical_open_count: params.p_critical_open_count,
    }, error: null };
  } });
  const replayed = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope(), canonicalOnly: true, context_version_id: ids.contextVersion,
  });
  assert.equal(replayed.canonical, false, 'a superseded replay must not be mislabeled canonical');
  assert.equal(replayed.current, false, 'a superseded replay must not be mislabeled current');
}

// Attempt lifecycle events are typed and producer identity is fixed by the persistence layer.
{
  const calls = [];
  const database = { async rpc(name, params) {
    calls.push({ name, params });
    return { data: { id: 'event-id', attempt_key: params.p_attempt_key, state: params.p_state }, error: null };
  } };
  const event = await appendAgt002AnalysisAttempt(database, {
    snapshot_id: ids.snapshot, opportunity_id: ids.opportunity, tender_id: ids.tender,
    attempt_key: 'attempt-1', state: 'queued', event_key: 'event-1',
  });
  assert.equal(event.state, 'queued');
  assert.equal(calls[0].name, 'psi_append_agt002_analysis_attempt');
  assert.equal(calls[0].params.p_producer, 'AGT-002');
  await assert.rejects(() => appendAgt002AnalysisAttempt(database, {
    snapshot_id: ids.snapshot, opportunity_id: ids.opportunity, tender_id: ids.tender,
    attempt_key: 'attempt-1', state: 'fake_state', event_key: 'event-2',
  }), /estado/i);
}

// Two registrations with the same identity reuse the same idempotency key and the same run.
{
  const database = fakeDatabase();
  const first = await registerAgt002PreviewAnalysis(database, { opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: envelope() });
  const second = await registerAgt002PreviewAnalysis(database, { opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: envelope({ run_id: '88888888-8888-4888-8888-888888888888' }) });
  assert.equal(first.run_id, second.run_id);
  assert.equal(database.rpcCalls[0].params.p_idempotency_key, database.rpcCalls[1].params.p_idempotency_key);
}

// A different snapshot must never reuse another snapshot's idempotency key.
{
  const database = fakeDatabase();
  const first = await registerAgt002PreviewAnalysis(database, { opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: envelope() });
  const otherSnapshot = '99999999-9999-4999-8999-999999999999';
  await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity,
    tender_id: ids.tender,
    snapshot_id: otherSnapshot,
    envelope: envelope({ snapshot_id: otherSnapshot, evidence_coverage: { ...envelope().evidence_coverage, snapshot_id: otherSnapshot } }),
  });
  assert.notEqual(database.rpcCalls[0].params.p_idempotency_key, database.rpcCalls[1].params.p_idempotency_key);
  assert.ok(first.run_id, 'sanity: first registration still returns a run id');
}

// RPC failure must fail closed and surface the underlying reason (no silent fallback result).
{
  const failing = { async rpc() { return { data: null, error: { message: 'RPC unavailable' } }; }, from() { throw new Error('unused'); } };
  await assert.rejects(() => registerAgt002PreviewAnalysis(failing, { opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: envelope() }), /RPC unavailable/);
}

// Missing required identity fields must fail closed before any RPC call.
{
  const database = fakeDatabase();
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, { opportunity_id: '', tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: envelope() }), /oportunidad/i);
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, { opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: { ...envelope(), producer: 'HERMES-INTERIM' } }), /AGT-002/i);
  assert.deepEqual(database.rpcCalls, []);
}

// findAgt002PreviewRun: null when absent, mapped row when present, fails closed on db error.
{
  const notFound = fakeDatabase();
  assert.equal(await findAgt002PreviewRun(notFound, 'missing-key'), null);

  const found = {
    from(table) {
      assert.equal(table, 'psi_tender_analysis_runs');
      return {
        select() { return this; },
        eq(column, value) { assert.equal(column, 'idempotency_key'); assert.equal(value, 'present-key'); return this; },
        async maybeSingle() {
          return { data: { id: ids.run, opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, producer: 'AGT-002', method: 'agent_ai', status: 'completed', result: { recommendation: 'pause' }, critical_open_count: 1, created_at: '2026-07-26T00:00:00.000Z', completed_at: '2026-07-26T00:00:01.000Z' }, error: null };
        },
      };
    },
  };
  const row = await findAgt002PreviewRun(found, 'present-key');
  assert.deepEqual(row, { run_id: ids.run, opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, producer: 'AGT-002', method: 'agent_ai', status: 'completed', current: true, result: { recommendation: 'pause' }, critical_open_count: 1, created_at: '2026-07-26T00:00:00.000Z', completed_at: '2026-07-26T00:00:01.000Z' });

  const filters = [];
  const canonicalFound = {
    from() { return {
      select(columns) { assert.match(columns, /canonical/); return this; },
      eq(column, value) { filters.push([column, value]); return this; },
      async maybeSingle() { return { data: { id: ids.run, snapshot_id: ids.snapshot, producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: false, result: {}, critical_open_count: 0 }, error: null }; },
    }; },
  };
  const canonicalRow = await findAgt002PreviewRun(canonicalFound, 'canonical-key', { canonicalOnly: true });
  assert.equal(canonicalRow.canonical, false, 'idempotency lookup must return the exact superseded run state');
  assert.equal(canonicalRow.current, false);
  assert.deepEqual(filters, [['idempotency_key', 'canonical-key']], 'idempotency lookup must not hide a superseded exact-key replay');

  const erroring = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: { message: 'db down' } }; } }; } };
  await assert.rejects(() => findAgt002PreviewRun(erroring, 'x'), /db down/);
}

// Interpretable daily quota probe: counts only AGT-002 rows created since UTC midnight.
{
  function quotaDatabase({ count, error = null, expectedGte }) {
    return {
      from(table) {
        assert.equal(table, 'psi_tender_analysis_runs');
        return {
          select(column, options) {
            assert.equal(column, 'id');
            assert.deepEqual(options, { count: 'exact', head: true });
            return this;
          },
          eq(column, value) { assert.equal(column, 'producer'); assert.equal(value, 'AGT-002'); return this; },
          async gte(column, value) {
            assert.equal(column, 'created_at');
            if (expectedGte) assert.equal(value, expectedGte);
            return { data: null, error, count };
          },
        };
      },
    };
  }
  const count = await countAgt002PreviewRunsToday(quotaDatabase({ count: 3, expectedGte: '2026-07-26T00:00:00.000Z' }), { now: () => new Date('2026-07-26T15:30:00.000Z') });
  assert.equal(count, 3);

  await assert.rejects(() => countAgt002PreviewRunsToday(quotaDatabase({ count: null }), { now: () => new Date('2026-07-26T00:00:00.000Z') }), /cuota/i);
  await assert.rejects(() => countAgt002PreviewRunsToday(quotaDatabase({ count: 1, error: { message: 'db down' } }), { now: () => new Date('2026-07-26T00:00:00.000Z') }), /db down/);
  await assert.rejects(() => countAgt002PreviewRunsToday(quotaDatabase({ count: 1 }), { now: () => new Date('not-a-date') }), /reloj/i);
}

const source = readFileSync(new URL('../agt002-preview-persistence.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /OPENAI_API_KEY|HERMES_INTERIM_API_KEY|console\.log/i, 'persistence must never log or reference provider secrets');

// ---------------------------------------------------------------------------
// Task 7: v3 persists integral_analysis + its deterministic v2 projection atomically,
// while v2's own CONTENT_KEYS behavior stays byte-for-byte unchanged (already proven
// above). v3 is canonical-only by construction (the flag requires AGT002_CANONICAL_ONLY).
// ---------------------------------------------------------------------------

function v3IntegralAnalysis() {
  return {
    contract_version: 'agt002-integral-analysis-v3',
    coverage: {
      manifest_version: 'agt002-deep-analysis-v1', expected_requirement_ids: ['req-1'], analyzed_requirement_ids: ['req-1'],
      material_omissions: false, omission_reasons: [], company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
      company_evidence_class_ids: [], legal_corpus_version_id: null,
    },
    analysis_units: [{
      unit_id: 'UNIT-1', unit_kind: 'tender_requirement', requirement_id: 'req-1', category: 'habilitating', sequence: 1,
      title: 'Póliza vigente', assessment_mode: 'assessed',
      conclusion: { status: 'supported_with_evidence', summary: 'Evidencia sustenta la póliza.', confidence: 'high' },
      blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
      evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
      evidence_refs: [{ ref: 'chunk:1', source_type: 'tender_document', purpose: 'requirement_basis' }],
      missing_evidence: [], commercial_impact: { level: 'low', summary: 'Sin impacto.', dimension: 'eligibility' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
      actions: [], milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
      closure: { status: 'human_confirmation_required', condition: 'Persona confirma.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar.' },
    }],
  };
}

function v3Envelope(overrides = {}) {
  const integral_analysis = v3IntegralAnalysis();
  return {
    schema_version: '3.0.0',
    agent_id: 'AGT-002',
    run_id: '77777777-7777-4777-8777-777777777777',
    policy_version: 'agt002-integral-v3-policy-1',
    snapshot_id: ids.snapshot,
    context_version_id: ids.contextVersion,
    status: 'completed',
    method: 'agent_ai',
    integral_analysis,
    evidence_coverage: envelope().evidence_coverage,
    legal_corpus_version_id: null,
    human_review_required: true,
    // Never hand-typed: persistence now recomputes this from integral_analysis and
    // rejects the run if it disagrees, so the fixture must carry the real deterministic
    // projection, exactly like the actual engine output would.
    v2_projection: projectAgt002IntegralV3ToV2(integral_analysis),
    usage: { provider: 'codex_app_server', model: 'synthetic-codex-model', input_tokens: 5, output_tokens: 5, rate_limit: null },
    ...overrides,
  };
}

// A variant whose single unit is an unresolved, curable blocker: exercises
// critical_open_count derivation (isCriticalOpenUnit via isUnresolvedBlocker) independent
// of the happy-path fixture above.
function v3IntegralAnalysisWithCriticalUnit() {
  const analysis = v3IntegralAnalysis();
  const unit = analysis.analysis_units[0];
  unit.blocking = { effect: 'blocker', curability: 'curable', reason: 'Pendiente de confirmación crítica.' };
  unit.actions = [{
    action_id: 'ACT-1', action_type: 'remediate_gap', summary: 'Subsanar antes del cierre.',
    basis_unit_id: 'UNIT-1', suggested_role: 'financial', priority: 'high', external_side_effect: false,
  }];
  return analysis;
}

// v3 registration persists the deterministic v2 projection (v2 readers keep working) plus
// the full validated integral_analysis, atomically, with critical_open_count derived from it.
{
  const database = fakeDatabase();
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: v3Envelope(), canonicalOnly: true,
    context_version_id: ids.contextVersion,
  });
  assert.equal(registered.run_id, ids.run);
  assert.equal(registered.status, 'completed');
  assert.deepEqual(registered.result.integral_analysis, v3Envelope().integral_analysis);
  assert.equal(registered.result.recommendation, 'advance');
  assert.deepEqual(registered.result.strengths, v3Envelope().v2_projection.strengths);
  assert.equal(registered.result.human_review_required, true);
  assert.deepEqual(registered.result.evidence_coverage, v3Envelope().evidence_coverage);
  assert.equal(registered.critical_open_count, 0);

  const call = database.rpcCalls[0];
  assert.equal(call.name, 'psi_record_agt002_canonical_analysis_run');
  assert.equal(call.params.p_schema_version, '3.0.0');
  assert.equal(call.params.p_policy_version, 'agt002-integral-v3-policy-1');
  for (const forbidden of ['schema_version', 'agent_id', 'run_id', 'snapshot_id', 'policy_version', 'status', 'method', 'usage', 'v2_projection']) {
    assert.equal(Object.hasOwn(call.params.p_result, forbidden), false, `stored v3 result must not duplicate the ${forbidden} column or carry the raw wrapper key`);
  }
}

// v3 with a genuinely critical unit (unresolved curable blocker): critical_open_count
// must equal the count independently derived from integral_analysis itself (design
// section 10) — not a value merely copied from the caller-supplied projection.
{
  const database = fakeDatabase();
  const criticalAnalysis = v3IntegralAnalysisWithCriticalUnit();
  const withCritical = v3Envelope({
    integral_analysis: criticalAnalysis,
    v2_projection: projectAgt002IntegralV3ToV2(criticalAnalysis),
  });
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: withCritical, canonicalOnly: true,
    context_version_id: ids.contextVersion,
  });
  assert.equal(registered.critical_open_count, 1);
}

// Defense in depth (design section 9.9/11.9): a caller-supplied v2_projection that
// disagrees with the deterministic projection recomputed from integral_analysis must be
// rejected before any RPC — never silently persisted as given.
{
  const database = fakeDatabase();
  const tampered = v3Envelope({
    v2_projection: { ...v3Envelope().v2_projection, recommendation: 'do_not_advance' },
  });
  await assert.rejects(
    () => registerAgt002PreviewAnalysis(database, {
      opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: tampered, canonicalOnly: true,
      context_version_id: ids.contextVersion,
    }),
    /no coincide con la proyección determinística/i,
  );
  assert.equal(database.rpcCalls.length, 0, 'a v2_projection mismatch must never call the RPC');
}

// v3 requires canonical registration: the flag can only ever be enabled alongside
// AGT002_CANONICAL_ONLY, so a non-canonical v3 registration attempt must fail closed.
await assert.rejects(() => registerAgt002PreviewAnalysis(fakeDatabase(), {
  opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: v3Envelope(), canonicalOnly: false,
  context_version_id: ids.contextVersion,
}), /canóni/i);

// v3 validation failure (malformed/missing integral_analysis, or a missing v2 projection)
// must make zero RPC calls — never a partial persist.
for (const bad of [v3Envelope({ integral_analysis: { contract_version: 'wrong' } }), v3Envelope({ v2_projection: null })]) {
  const database = fakeDatabase();
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: bad, canonicalOnly: true,
    context_version_id: ids.contextVersion,
  }));
  assert.equal(database.rpcCalls.length, 0, 'a validation failure must never call the RPC');
}

// legal_corpus_version_id is stored directly for v3 (no legal_findings atomic-pair
// requirement — that pairing is a v2-only concept; v3 grounds legal findings per-unit).
{
  const database = fakeDatabase();
  const withCorpus = v3Envelope({ legal_corpus_version_id: LEGAL_CORPUS_VERSION_ID });
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: withCorpus, canonicalOnly: true,
    context_version_id: ids.contextVersion,
  });
  assert.equal(registered.result.legal_corpus_version_id, LEGAL_CORPUS_VERSION_ID);
}

// ---------------------------------------------------------------------------
// Task 8 (characterization coverage — Task 6/7's engine and this persistence layer
// already satisfy this; nothing here forces a production change): a deterministic
// MERGE of two batches / two distinct governed requirement units, in institutional
// sequence, must still persist as ONE complete integral_analysis through the exact same
// single canonical RPC call — no workset/checkpoint/job/progress/finalizer surface
// growing its params — and the full V2 projection / critical_open_count must visibly
// depend on the SECOND batch's unit (the first alone is noncritical/advance-compatible),
// never merely on the first batch.
// ---------------------------------------------------------------------------
function v3MergedIntegralAnalysis() {
  const firstBatchUnit = v3IntegralAnalysis().analysis_units[0]; // req-1: noncritical/advance-compatible.
  const secondBatchUnit = {
    unit_id: 'UNIT-2', unit_kind: 'tender_requirement', requirement_id: 'req-2', category: 'habilitating', sequence: 2,
    title: 'Certificado RUP', assessment_mode: 'assessed',
    conclusion: { status: 'gap_evidenced', summary: 'Falta certificado RUP vigente.', confidence: 'medium' },
    blocking: { effect: 'blocker', curability: 'curable', reason: 'Pendiente de aportar certificado RUP.' },
    evidence_state: { presence: 'absent', review: 'partially_reviewed', validity: 'not_applicable', applicability: 'applicable', compliance: 'gap_evidenced_pending_human_review' },
    evidence_refs: [{ ref: 'chunk:1', source_type: 'tender_document', purpose: 'gap_basis' }],
    missing_evidence: [], commercial_impact: { level: 'high', summary: 'Riesgo de rechazo por falta de RUP.', dimension: 'eligibility' },
    legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
    actions: [{
      action_id: 'ACT-2', action_type: 'remediate_gap', summary: 'Aportar certificado RUP vigente antes del cierre.',
      basis_unit_id: 'UNIT-2', suggested_role: 'financial', priority: 'high', external_side_effect: false,
    }],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
    escalation: { required: false, level: 'none', reason: 'Sin condición crítica adicional.' },
    // Genuinely critical AND unresolved: an open (not evidence_satisfied) blocker, so
    // isUnresolvedBlocker/isCriticalOpenUnit both hold for this second-batch unit alone.
    closure: { status: 'open', condition: 'Persona aporta RUP.', evidence_required: ['tender_document'] },
    human_validation: { required: true, status: 'pending', reason: 'Confirmar RUP.' },
  };
  return {
    contract_version: 'agt002-integral-analysis-v3',
    coverage: {
      manifest_version: 'agt002-deep-analysis-v1',
      // Merge of two batches / two governed requirement units, each exactly once, in
      // institutional sequence, with no omissions.
      expected_requirement_ids: ['req-1', 'req-2'], analyzed_requirement_ids: ['req-1', 'req-2'],
      material_omissions: false, omission_reasons: [], company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
      company_evidence_class_ids: [], legal_corpus_version_id: null,
    },
    analysis_units: [firstBatchUnit, secondBatchUnit],
  };
}

function v3MergedEnvelope(overrides = {}) {
  const integral_analysis = v3MergedIntegralAnalysis();
  return {
    schema_version: '3.0.0',
    agent_id: 'AGT-002',
    run_id: '77777777-7777-4777-8777-777777777777',
    policy_version: 'agt002-integral-v3-policy-1',
    snapshot_id: ids.snapshot,
    context_version_id: ids.contextVersion,
    status: 'completed',
    method: 'agent_ai',
    integral_analysis,
    evidence_coverage: envelope().evidence_coverage,
    legal_corpus_version_id: null,
    human_review_required: true,
    // Computed from the COMPLETE merged analysis, never hand-typed — exactly what a real
    // engine would hand registerAgt002PreviewAnalysis after merging both batches.
    v2_projection: projectAgt002IntegralV3ToV2(integral_analysis),
    usage: { provider: 'codex_app_server', model: 'synthetic-codex-model', input_tokens: 5, output_tokens: 5, rate_limit: null },
    ...overrides,
  };
}

{
  const database = fakeDatabase();
  const mergedEnvelope = v3MergedEnvelope();
  const merged = mergedEnvelope.integral_analysis;
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: mergedEnvelope, canonicalOnly: true,
    context_version_id: ids.contextVersion,
  });

  // Exactly one RPC call, to the exact existing canonical RPC name.
  assert.equal(database.rpcCalls.length, 1, 'a multi-batch-merged v3 registration must still be a single atomic RPC call');
  const call = database.rpcCalls[0];
  assert.equal(call.name, 'psi_record_agt002_canonical_analysis_run');

  // No workset/checkpoint/job/progress/finalizer surface was added to the canonical RPC's
  // signature/params — merging batches is a pure input concern, never an orchestration one.
  const forbiddenParamPattern = /workset|checkpoint|job|progress|finaliz/i;
  for (const key of Object.keys(call.params)) {
    assert.doesNotMatch(key, forbiddenParamPattern, `canonical RPC params must not grow a batching-orchestration key: ${key}`);
  }
  assert.doesNotMatch(JSON.stringify(call.params.p_result), forbiddenParamPattern, 'the stored result must not carry batching-orchestration state either');

  // Both complete governed units are stored once each, in order, with no omissions.
  assert.deepEqual(call.params.p_result.integral_analysis.coverage.expected_requirement_ids, ['req-1', 'req-2']);
  assert.deepEqual(call.params.p_result.integral_analysis.coverage.analyzed_requirement_ids, ['req-1', 'req-2']);
  assert.deepEqual(
    call.params.p_result.integral_analysis.analysis_units.map(unit => unit.requirement_id),
    ['req-1', 'req-2'],
  );
  assert.deepEqual(call.params.p_result.integral_analysis, merged);

  // The stored V2-shaped fields visibly carry the SECOND batch's blocker/question: the
  // deterministic recommendation is 'pause' only because of it, never the first unit alone
  // (whose own single-unit projection is 'advance', per the pre-existing happy-path fixture).
  assert.equal(call.params.p_result.recommendation, 'pause');
  assert.ok(call.params.p_result.blockers.some(finding => finding.id === 'UNIT-2::blocker'), 'the second-batch blocker must survive into the stored V2 projection');
  assert.ok(
    call.params.p_result.questions.some(finding => finding.id === 'UNIT-2::question' && finding.critical === true),
    'the second-batch critical question must survive into the stored V2 projection',
  );

  // critical_open_count is the deterministic count over the FULL merge (1), never the
  // first batch alone (0).
  assert.equal(call.params.p_critical_open_count, 1);
  assert.equal(computeAgt002IntegralV3CriticalOpenCount(merged), 1);
  assert.equal(
    computeAgt002IntegralV3CriticalOpenCount({ ...merged, analysis_units: [merged.analysis_units[0]] }),
    0,
    'sanity: the first batch alone is noncritical/advance-compatible',
  );

  // The returned registered result matches these complete merged semantics exactly.
  assert.equal(registered.critical_open_count, 1);
  assert.deepEqual(registered.result.integral_analysis, merged);
  assert.equal(registered.result.recommendation, 'pause');
  assert.ok(registered.result.blockers.some(finding => finding.id === 'UNIT-2::blocker'));
  assert.ok(registered.result.questions.some(finding => finding.id === 'UNIT-2::question' && finding.critical === true));
}

// ---------------------------------------------------------------------------
// P2-1: governance_provenance (the engine's already-bound category/evidence-class
// override provenance) must survive to the persisted run — re-validated, never trusted
// verbatim, exactly like evidence_coverage above — so a curated link's class, rationale
// and version are auditable from the persisted run.
// ---------------------------------------------------------------------------
function governanceProvenanceFixture() {
  return {
    'evidence_class_link:req-1': {
      requirement_id: 'req-1', override_kind: 'evidence_class_link', evidence_class_id: 'rup',
      rationale: 'El RUP acredita la habilitación exigida por el pliego.', source_reference: 'pliego:anexo-1',
      curated_by: '10101010-1010-4010-8010-101010101010', curated_at: '2026-08-07T00:00:00.000Z', version: 2,
    },
  };
}

{
  const database = fakeDatabase();
  const withProvenance = v3Envelope({ governance_provenance: governanceProvenanceFixture() });
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: withProvenance, canonicalOnly: true,
    context_version_id: ids.contextVersion,
  });
  assert.deepEqual(registered.result.governance_provenance, governanceProvenanceFixture());
  assert.equal(registered.result.governance_provenance['evidence_class_link:req-1'].evidence_class_id, 'rup');
  assert.equal(
    registered.result.governance_provenance['evidence_class_link:req-1'].rationale,
    governanceProvenanceFixture()['evidence_class_link:req-1'].rationale,
  );
  assert.equal(registered.result.governance_provenance['evidence_class_link:req-1'].version, 2);
}

// A malformed governance_provenance (key/content mismatch, or a missing required field)
// must be rejected before any RPC — never a partial/tampered persist.
for (const bad of [
  { 'evidence_class_link:req-1': { ...governanceProvenanceFixture()['evidence_class_link:req-1'], requirement_id: 'req-2' } },
  { 'evidence_class_link:req-1': { ...governanceProvenanceFixture()['evidence_class_link:req-1'], rationale: '' } },
]) {
  const database = fakeDatabase();
  const tampered = v3Envelope({ governance_provenance: bad });
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: tampered, canonicalOnly: true,
    context_version_id: ids.contextVersion,
  }));
  assert.equal(database.rpcCalls.length, 0, 'a governance_provenance validation failure must never call the RPC');
}

// ---------------------------------------------------------------------------
// context.evidenceIdentity: an optional, atomic company-evidence identity that
// registerAgt002PreviewAnalysis must fold into the recomputed idempotency key AND
// (D) persist, re-validated, as a server-owned `company_evidence_identity` block inside
// p_result — the same shape tender-analysis-foundation.js's registerAgt002ContextVersion
// already persists alongside the context version. A mismatch against a reserved
// expectedIdempotencyKey must fail before any RPC call.
// ---------------------------------------------------------------------------
function evidenceIdentityFixture(overrides = {}) {
  return {
    source_snapshot_hash: createHash('sha256').update('evidence-snapshot-fixture').digest('hex'),
    preview_artifact_hash: createHash('sha256').update('evidence-preview-fixture').digest('hex'),
    source_manifest_version: 'v0.3.1-approved-20260829',
    ...overrides,
  };
}

{
  const database = fakeDatabase();
  const evidenceIdentity = evidenceIdentityFixture();
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope(), evidenceIdentity,
  });
  const expectedKey = computeAgt002PreviewIdempotencyKey({
    snapshotId: ids.snapshot, policyVersion: 'agt002-preview-policy-v1', model: 'synthetic-codex-model',
    evidenceSourceSnapshotHash: evidenceIdentity.source_snapshot_hash,
    evidencePreviewArtifactHash: evidenceIdentity.preview_artifact_hash,
    evidenceSourceManifestVersion: evidenceIdentity.source_manifest_version,
  });
  assert.equal(database.rpcCalls[0].params.p_idempotency_key, expectedKey, 'registration must fold context.evidenceIdentity into the recomputed key');
  assert.equal(registered.run_id, ids.run);
  // D: present, it is persisted as a server-owned block, under its own canonical key name —
  // never the caller's own `evidenceIdentity`/`evidence_identity` spelling.
  assert.deepEqual(database.rpcCalls[0].params.p_result.company_evidence_identity, evidenceIdentity);
  assert.equal(Object.hasOwn(database.rpcCalls[0].params.p_result, 'evidenceIdentity'), false, 'the caller-supplied key name must never leak into the persisted content verbatim');
  assert.equal(Object.hasOwn(database.rpcCalls[0].params.p_result, 'evidence_identity'), false, 'the persisted key must be exactly company_evidence_identity');

  // An evidence-bound reservation (the caller pre-computed the SAME evidence-aware key)
  // must be accepted, not just an absent expectedIdempotencyKey.
  const otherDatabase = fakeDatabase();
  const matched = await registerAgt002PreviewAnalysis(otherDatabase, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope(), evidenceIdentity, expectedIdempotencyKey: expectedKey,
  });
  assert.equal(otherDatabase.rpcCalls[0].params.p_idempotency_key, expectedKey, 'a matching evidence-bound expectedIdempotencyKey must be accepted');
  assert.equal(matched.run_id, ids.run);
}

// Changing any single field of the identity must change both the persisted
// company_evidence_identity block and the recomputed idempotency key — it is atomically
// bound, not decorative.
{
  const base = evidenceIdentityFixture();
  const baseDatabase = fakeDatabase();
  await registerAgt002PreviewAnalysis(baseDatabase, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope(), evidenceIdentity: base,
  });
  for (const field of Object.keys(base)) {
    const changedValue = field === 'source_manifest_version' ? 'v0.3.2-other-manifest' : createHash('sha256').update(`changed:${field}`).digest('hex');
    const changed = { ...base, [field]: changedValue };
    const changedDatabase = fakeDatabase();
    await registerAgt002PreviewAnalysis(changedDatabase, {
      opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
      envelope: envelope(), evidenceIdentity: changed,
    });
    assert.deepEqual(changedDatabase.rpcCalls[0].params.p_result.company_evidence_identity, changed, `${field}: the persisted block must reflect the changed value`);
    assert.notEqual(changedDatabase.rpcCalls[0].params.p_idempotency_key, baseDatabase.rpcCalls[0].params.p_idempotency_key, `${field}: changing it must change the idempotency key`);
  }
}

// A reservation made WITHOUT the evidence identity can never be silently consumed by a
// registration that supplies one (a materially different, evidence-bound identity) — and
// the reverse must also fail — both before any RPC call.
{
  const database = fakeDatabase();
  const unboundKey = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'agt002-preview-policy-v1', model: 'synthetic-codex-model' });
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope(), evidenceIdentity: evidenceIdentityFixture(), expectedIdempotencyKey: unboundKey,
  }), /idempotencia|reserva|identidad/i);
  assert.equal(database.rpcCalls.length, 0);

  const evidenceIdentity = evidenceIdentityFixture();
  const boundKey = computeAgt002PreviewIdempotencyKey({
    snapshotId: ids.snapshot, policyVersion: 'agt002-preview-policy-v1', model: 'synthetic-codex-model',
    evidenceSourceSnapshotHash: evidenceIdentity.source_snapshot_hash,
    evidencePreviewArtifactHash: evidenceIdentity.preview_artifact_hash,
    evidenceSourceManifestVersion: evidenceIdentity.source_manifest_version,
  });
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope(), expectedIdempotencyKey: boundKey,
  }), /idempotencia|reserva|identidad/i);
  assert.equal(database.rpcCalls.length, 0);
}

// The shape must be exact and atomic: a partial/extra-key evidenceIdentity, or an invalid
// hash inside it, must be rejected before any RPC call.
for (const bad of [
  { source_snapshot_hash: evidenceIdentityFixture().source_snapshot_hash },
  { ...evidenceIdentityFixture(), extra_field: 'unexpected' },
  { ...evidenceIdentityFixture(), source_snapshot_hash: 'not-a-real-hash' },
  { ...evidenceIdentityFixture(), source_manifest_version: '' },
]) {
  const database = fakeDatabase();
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot,
    envelope: envelope(), evidenceIdentity: bad,
  }), /evidencia empresarial/i);
  assert.equal(database.rpcCalls.length, 0, 'a malformed evidenceIdentity must never call the RPC');
}

console.log('AGT-002 Preview persistence (audit, idempotency, no secrets) passed');
