import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  appendAgt002AnalysisAttempt,
  claimAgt002PreviewRun,
  computeAgt002PreviewIdempotencyKey,
  countAgt002PreviewRunsToday,
  findAgt002PreviewRun,
  registerAgt002PreviewAnalysis,
  releaseAgt002PreviewClaim,
} from '../agt002-preview-persistence.js';

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

// Deterministic idempotency key: stable for identical (snapshot, policy, model); differs otherwise.
{
  const a = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1' });
  const b = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm1' });
  const c = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v2', model: 'm1' });
  const d = computeAgt002PreviewIdempotencyKey({ snapshotId: ids.snapshot, policyVersion: 'v1', model: 'm2' });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.match(a, /^[0-9a-f]{64}$/);
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

// Canonical-only registration is fail-closed without an immutable context version.
{
  const database = fakeDatabase();
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: envelope(), canonicalOnly: true,
  }), /context_version_id/i);
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
          return { data: { id: ids.run, snapshot_id: ids.snapshot, producer: 'AGT-002', method: 'agent_ai', status: 'completed', result: { recommendation: 'pause' }, critical_open_count: 1, created_at: '2026-07-26T00:00:00.000Z', completed_at: '2026-07-26T00:00:01.000Z' }, error: null };
        },
      };
    },
  };
  const row = await findAgt002PreviewRun(found, 'present-key');
  assert.deepEqual(row, { run_id: ids.run, snapshot_id: ids.snapshot, producer: 'AGT-002', method: 'agent_ai', status: 'completed', current: true, result: { recommendation: 'pause' }, critical_open_count: 1, created_at: '2026-07-26T00:00:00.000Z', completed_at: '2026-07-26T00:00:01.000Z' });

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
    v2_projection: {
      recommendation: 'advance', summary: 'Resumen determinístico.', strengths: [{ id: 'UNIT-1::strength', text: 'Evidencia sustenta la póliza.', critical: false, evidence_refs: ['chunk:1'] }],
      weaknesses: [], blockers: [], questions: [], unverified: [], next_action: 'Revisión humana final requerida antes de continuar con la oportunidad.',
      human_review_required: true,
    },
    usage: { provider: 'codex_app_server', model: 'synthetic-codex-model', input_tokens: 5, output_tokens: 5, rate_limit: null },
    ...overrides,
  };
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

// v3 with a critical question in its projection: critical_open_count must equal the
// projected critical question count exactly (not re-derived independently).
{
  const database = fakeDatabase();
  const withCritical = v3Envelope({
    v2_projection: {
      ...v3Envelope().v2_projection,
      questions: [{ id: 'UNIT-1::question', text: 'x', critical: true, evidence_refs: [] }],
    },
  });
  const registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: withCritical, canonicalOnly: true,
    context_version_id: ids.contextVersion,
  });
  assert.equal(registered.critical_open_count, 1);
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

console.log('AGT-002 Preview persistence (audit, idempotency, no secrets) passed');
