import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { registerAgt002ContextVersion } from '../tender-analysis-foundation.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { registerAgt002PreviewAnalysis } from '../agt002-preview-persistence.js';

// ---------------------------------------------------------------------------
// AGT-002 company evidence identity (F3) — production wiring. Builds on the governed-data
// wiring already proven by tests/agt002-integral-v3-server-wiring.test.mjs: the SAME
// governance load must now also carry the run-binding company evidence identity
// (buildAgt002CompanyEvidenceIdentity, agt002-company-evidence-identity.js), loaded BEFORE
// the context version is registered and BEFORE the idempotency reservation is
// computed/claimed/found in all three real analysis flows (durable canonical enqueue,
// requestAgt002 processing worker, legacy non-canonical preview) — never reloaded within a
// flow. It must then reach the idempotency key (as an atomic triple, alongside the
// preexisting legal/contract/inventory identity), the durable context version registration,
// the frozen governance object, the durable worker's post-bridge orchestrator, and both
// direct registerAgt002PreviewAnalysis registrations. As with the governed-data wiring, no
// unit test can observe server/index.js's inline route handlers directly, so this is a
// source-text contract, verified once per canonical flow.
// ---------------------------------------------------------------------------

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const executor = readFileSync(new URL('../agt002-reanalysis-executor.js', import.meta.url), 'utf8');
const postBridge = readFileSync(new URL('../agt002-post-bridge-observability.js', import.meta.url), 'utf8');

function count(source, token) {
  return source.split(token).length - 1;
}

function slice(source, startToken, endToken, label) {
  const start = source.indexOf(startToken);
  assert.ok(start !== -1, `${label}: start anchor not found`);
  const end = source.indexOf(endToken, start);
  assert.ok(end !== -1 && end > start, `${label}: end anchor not found after start`);
  return source.slice(start, end);
}

// Asserts every token in order appears, strictly increasing in position, within `source`.
function assertOrder(source, tokens, label) {
  let cursor = 0;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor);
    assert.ok(index !== -1, `${label}: missing "${token}" at/after position ${cursor}`);
    cursor = index + token.length;
  }
}

assert.equal(server, api, 'server/index.js y api/[...path].js deben permanecer byte-idénticos');

// The loader re-derives the identity from the SAME registry rows it already loads, via the
// real fail-closed builders — never a hand-rolled shadow of them, and never the wall clock:
// evidenceAsOf is the deterministic instant deriveAgt002CompanyEvidenceAsOf derives from those
// same rows' own updated_at, and buildAgt002CompanyEvidenceIdentity is built with exactly that
// derived instant.
assert.match(server, /import \{ buildAgt002CompanyEvidenceIdentity, deriveAgt002CompanyEvidenceAsOf \} from '\.\.\/agt002-company-evidence-identity\.js';/);
assert.match(server, /evidenceAsOf = deriveAgt002CompanyEvidenceAsOf\(companyEvidenceRegistryEntries\);/);
assert.match(
  server,
  /evidenceIdentity = buildAgt002CompanyEvidenceIdentity\(\{ registryEntries: companyEvidenceRegistryEntries, inventorySnapshot: companyEvidenceInventorySnapshot, asOf: new Date\(evidenceAsOf\) \}\);/,
);
assert.doesNotMatch(server, /evidenceIdentity: buildAgt002CompanyEvidenceIdentity\(\{[^}]*asOf: new Date\(\) *\}\)/, 'production must never derive the company-evidence identity from the wall clock');

// B: a registry that cannot even derive an asOf (table absent, incomplete, malformed) fails
// closed with a safe, non-PII boundary code — never a silently degraded rules_fallback.
assert.match(server, /boundaryError\.runtime_boundary_code = 'AGT002_RUNTIME_COMPANY_EVIDENCE_INVALID';/);
assert.match(server, /error\?\.runtime_boundary_code === 'AGT002_RUNTIME_COMPANY_EVIDENCE_INVALID'/);
assert.match(server, /code: 'AGT002_RUNTIME_COMPANY_EVIDENCE_INVALID' \}\)/);

// A5: both direct server runtime calls forward the SAME frozen evidenceAsOf into engine
// construction alongside the registry rows — never re-derived, never the wall clock.
assert.equal(count(server, 'companyEvidenceAsOf: integralV3Governance.evidenceAsOf,'), 2, 'both direct createAgt002PreviewRuntime call sites must forward evidenceAsOf');

// Reusable mapper: exactly one definition, reused (never duplicated) at all three
// idempotency-key call sites below.
assert.equal(count(server, 'function agt002EvidenceIdentityKeyParams(evidenceIdentity)'), 1);
assert.equal(count(server, 'agt002EvidenceIdentityKeyParams(integralV3Governance?.evidenceIdentity)'), 3, 'las tres compute keys deben usar el mismo mapper reusable');

// Exactly one governance load per real flow (mirrors the governed-data wiring contract),
// and exactly two direct registerAgt002PreviewAnalysis registrations carry evidenceIdentity.
assert.equal(count(server, 'await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)'), 3);
assert.equal(count(server, 'company_evidence_identity: integralV3Governance?.evidenceIdentity ?? null,'), 2, 'las dos flujos con context version deben incluir sólo company_evidence_identity');
assert.equal(count(server, 'evidenceIdentity: integralV3Governance?.evidenceIdentity ?? null'), 2, 'los dos registros directos deben pasar evidenceIdentity');

// Flow 1 — durable canonical enqueue: governance load precedes the context version
// registration, which precedes the idempotency key computation and the durable find.
const flow1 = slice(
  server,
  'async function enqueueAgt002CanonicalReanalysis(database, {',
  'function sendError(res, error, status = 500) {',
  'flow1 (enqueueAgt002CanonicalReanalysis)',
);
assertOrder(flow1, [
  'await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)',
  'await registerAgt002ContextVersion(database, {',
  'company_evidence_identity: integralV3Governance?.evidenceIdentity ?? null,',
  'computeAgt002PreviewIdempotencyKey({',
  'agt002EvidenceIdentityKeyParams(integralV3Governance?.evidenceIdentity)',
  'await findAgt002PreviewRun(database, idempotencyKey, { canonicalOnly: true });',
], 'flow1');
assert.equal(count(flow1, 'await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)'), 1, 'flow1: exactamente una carga, sin releer');

// Flow 2 — requestAgt002 processing worker: same ordering, plus forwarding into the frozen
// runtime construction and the direct registration.
const flow2 = slice(
  server,
  'requestAgt002: async ({ jobId, tenderId, opportunityId, snapshotId }) => {',
  'export async function buildTenderOpportunitySummary(',
  'flow2 (requestAgt002)',
);
assertOrder(flow2, [
  'await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)',
  'await registerAgt002ContextVersion(database, {',
  'company_evidence_identity: integralV3Governance?.evidenceIdentity ?? null,',
  'idempotencyKey = computeAgt002PreviewIdempotencyKey({',
  'agt002EvidenceIdentityKeyParams(integralV3Governance?.evidenceIdentity)',
  'await claimAgt002PreviewRun(database,',
  'evidenceIdentity: integralV3Governance?.evidenceIdentity ?? null });',
], 'flow2');
assert.equal(count(flow2, 'await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)'), 1, 'flow2: exactamente una carga, sin releer');

// Flow 3 — legacy non-canonical preview: no context version exists here at all, but
// governance must still precede the idempotency key computation and the claim/find.
const flow3 = slice(
  server,
  "app.post('/api/tender-documents-analyze-agent-preview', async (req, res) => {",
  "app.get('/api/agt002-reanalysis-status'",
  'flow3 (legacy preview)',
);
assert.doesNotMatch(flow3, /await registerAgt002ContextVersion\(/, 'flow3 nunca registra una versión de contexto');
assertOrder(flow3, [
  'await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)',
  'idempotencyKey = computeAgt002PreviewIdempotencyKey({',
  'agt002EvidenceIdentityKeyParams(integralV3Governance?.evidenceIdentity)',
  'await claimAgt002PreviewRun(database,',
  'evidenceIdentity: integralV3Governance?.evidenceIdentity ?? null });',
], 'flow3');
assert.equal(count(flow3, 'await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)'), 1, 'flow3: exactamente una carga, sin releer');

// The frozen governance object handed to the durable job (flow 1) is the SAME object the
// loader returned — it is never rebuilt, so evidenceIdentity necessarily survives freezing.
assert.match(server, /integralV3Governance,\s*\n\s*manizalesManifestSource,\s*\n\s*idempotencyKey,\s*\n\s*\}\);/);

// The durable worker (agt002-reanalysis-executor.js) forwards the frozen identity, verbatim,
// into the post-bridge orchestrator — never re-deriving it.
assert.match(executor, /evidenceIdentity: governance\?\.evidenceIdentity \?\? null,/);
// A5: it also forwards the SAME frozen evidenceAsOf into runtime construction alongside the
// registry rows — never re-derived, never the wall clock.
assert.match(executor, /companyEvidenceAsOf: governance\.evidenceAsOf,/);

// The post-bridge orchestrator forwards it, verbatim, into the durable registration call. The
// safe retry wiring builds `persistenceParams` exactly once — carrying evidenceIdentity — and
// reuses that SAME object on every in-memory persistence retry, rather than rebuilding it per
// attempt.
assert.match(
  postBridge,
  /evidenceIdentity = null,[\s\S]*?\} = context;/,
  'postBridge context destructuring must default evidenceIdentity to null',
);
assert.match(
  postBridge,
  /leaseSeconds = null,[\s\S]*?\} = context;/,
  'postBridge context destructuring must default leaseSeconds to null (heartbeat frontier)',
);
assert.match(
  postBridge,
  /const persistenceParams = \{[\s\S]*?semanticSourceDocuments: analysisContext\?\.documents \?\? null,\s*\n\s*evidenceIdentity,\s*\n\s*\};/,
  'persistenceParams must be built once, carrying evidenceIdentity',
);
assert.match(
  postBridge,
  /registerAgt002PreviewAnalysis\(trackedDatabase, persistenceParams\)/,
  'the registration call must reuse the SAME persistenceParams object on every retry',
);

// B: the legacy non-canonical preview flow (flow3) must check the fail-closed boundary code
// BEFORE ever falling back to rules_fallback — a degraded evidence registry must never
// silently produce a rules-based analysis.
{
  const catchStart = flow3.indexOf('} catch (error) {');
  assert.ok(catchStart !== -1, 'legacy preview catch: start anchor not found');
  const catchEnd = flow3.indexOf('} finally {', catchStart);
  assert.ok(catchEnd !== -1 && catchEnd > catchStart, 'legacy preview catch: end anchor not found after start');
  const legacyPreviewCatch = flow3.slice(catchStart, catchEnd);
  assertOrder(legacyPreviewCatch, [
    "error?.runtime_boundary_code === 'AGT002_RUNTIME_COMPANY_EVIDENCE_INVALID'",
    'return sendError(res, error);',
    "return useRulesFallback('preview_unavailable');",
  ], 'legacyPreviewCatch');
}

// ---------------------------------------------------------------------------
// Real consumption, not just plumbing: the defect this fixes had server/api pass
// company_evidence_identity as an inert sibling that registerAgt002ContextVersion silently
// ignored (it only ever read context?.context). Drive the real function against a fake
// database that captures its RPC params to prove the sibling is genuinely folded into the
// persisted/hashed context — never merely written by the server and dropped.
// ---------------------------------------------------------------------------

function fakeDatabase() {
  const calls = [];
  return {
    calls,
    rpc: async (name, params) => {
      calls.push({ name, params });
      return {
        data: { id: 'context-version-1', context_version: params.p_context_version, context: params.p_context, context_hash: params.p_context_hash, human_evidence_count: params.p_human_evidence_count },
        error: null,
      };
    },
  };
}

const O = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function evidenceContextSections() {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', owner_id: 'owner-1', owner_name: 'Ana', updated_at: '2026-07-29T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', source: 'SECOP II', updated_at: '2026-07-29T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-29T10:00:00.000Z' },
      documents: [],
    }),
  };
}

function baseCallArgs(extra = {}) {
  return {
    opportunity_id: O, tender_id: T, snapshot_id: S, actor_id: P,
    context: { snapshot_id: S, ...evidenceContextSections(), human_evidence: [] },
    ...extra,
  };
}

const evidenceIdentity = Object.freeze({
  source_snapshot_hash: 'a'.repeat(64),
  preview_artifact_hash: 'b'.repeat(64),
  source_manifest_version: 'v0.3.1-approved-20260829',
});

// Absence: p_context must never gain the key, and must stay exactly what buildAgt002ContextV2
// alone produces — a Worker that believes an absent sibling is a no-op must be right.
const dbAbsent = fakeDatabase();
await registerAgt002ContextVersion(dbAbsent, baseCallArgs());
assert.equal(Object.hasOwn(dbAbsent.calls[0].params.p_context, 'company_evidence_identity'), false, 'sin sibling, p_context nunca debe ganar la clave');

// Presence: the identity must land inside p_context (the thing that gets hashed and
// persisted), not be dropped, and it must change p_context_hash relative to its absence.
const dbPresent = fakeDatabase();
await registerAgt002ContextVersion(dbPresent, baseCallArgs({ company_evidence_identity: evidenceIdentity }));
assert.deepEqual(dbPresent.calls[0].params.p_context.company_evidence_identity, evidenceIdentity, 'con sibling, debe aparecer dentro de p_context, no ser ignorado');
assert.notEqual(dbPresent.calls[0].params.p_context_hash, dbAbsent.calls[0].params.p_context_hash, 'la presencia del sibling debe cambiar p_context_hash');
assert.notEqual(dbPresent.calls[0].params.p_idempotency_key, dbAbsent.calls[0].params.p_idempotency_key, 'la presencia del sibling debe cambiar la idempotency key');

// Changing any one of the three fields must change p_context_hash (and therefore the
// idempotency key derived from it) — the identity is atomically bound, not decorative.
for (const field of Object.keys(evidenceIdentity)) {
  const changedValue = field === 'source_manifest_version' ? 'v0.3.2-other-manifest' : 'c'.repeat(64);
  const dbChanged = fakeDatabase();
  await registerAgt002ContextVersion(dbChanged, baseCallArgs({ company_evidence_identity: { ...evidenceIdentity, [field]: changedValue } }));
  assert.notEqual(dbChanged.calls[0].params.p_context_hash, dbPresent.calls[0].params.p_context_hash, `cambiar ${field} debe cambiar p_context_hash`);
  assert.notEqual(dbChanged.calls[0].params.p_idempotency_key, dbPresent.calls[0].params.p_idempotency_key, `cambiar ${field} debe cambiar la idempotency key`);
}

// Fail-closed: an invalid or extra-keyed identity must throw before the RPC is ever called.
const dbInvalidHash = fakeDatabase();
await assert.rejects(
  () => registerAgt002ContextVersion(dbInvalidHash, baseCallArgs({ company_evidence_identity: { ...evidenceIdentity, source_snapshot_hash: 'not-a-hash' } })),
);
assert.equal(dbInvalidHash.calls.length, 0, 'una identidad inválida nunca debe llegar a la RPC');

const dbExtraKey = fakeDatabase();
await assert.rejects(
  () => registerAgt002ContextVersion(dbExtraKey, baseCallArgs({ company_evidence_identity: { ...evidenceIdentity, extra: 'no-permitido' } })),
);
assert.equal(dbExtraKey.calls.length, 0, 'una identidad con claves extra nunca debe llegar a la RPC');

// No sensitive material anywhere in what actually reached the RPC.
assert.doesNotMatch(JSON.stringify(dbPresent.calls[0].params), /CONFIDENCIAL|c[eé]dula|human_gate|source_reference/i);

// ---------------------------------------------------------------------------
// D: the context version already persists company_evidence_identity inside p_context; the
// analysis run persistence (registerAgt002PreviewAnalysis) must persist the exact SAME block
// inside p_result for the SAME input identity — never a divergent re-derivation.
// ---------------------------------------------------------------------------
function fakePreviewDatabase() {
  const rpcCalls = [];
  return {
    rpcCalls,
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      return { data: { id: 'run-1', snapshot_id: params.p_snapshot_id, producer: 'AGT-002', method: 'agent_ai', status: 'completed', critical_open_count: params.p_critical_open_count }, error: null };
    },
  };
}
function v2EnvelopeFixture() {
  return {
    schema_version: '2.0-preview.1', agent_id: 'AGT-002', producer: 'AGT-002', method: 'agent_ai',
    policy_version: 'agt002-preview-policy-v1',
    recommendation: 'advance', summary: 'Resumen sintético.', strengths: [], weaknesses: [], blockers: [],
    questions: [], unverified: [], next_action: 'Continuar.', human_review_required: true,
    usage: { model: 'synthetic-codex-model' },
  };
}

const dbContext = fakeDatabase();
await registerAgt002ContextVersion(dbContext, baseCallArgs({ company_evidence_identity: evidenceIdentity }));
const dbPreview = fakePreviewDatabase();
await registerAgt002PreviewAnalysis(dbPreview, {
  opportunity_id: O, tender_id: T, snapshot_id: S, envelope: v2EnvelopeFixture(), evidenceIdentity,
});
assert.deepEqual(
  dbPreview.rpcCalls[0].params.p_result.company_evidence_identity,
  dbContext.calls[0].params.p_context.company_evidence_identity,
  'the context version and the analysis run must persist the exact same company_evidence_identity block for the same input',
);

console.log('AGT-002 company evidence identity (F3) server wiring contract (governance-before-context-version-before-idempotency, atomic key triple, frozen/registered/durable propagation, sibling genuinely consumed by registerAgt002ContextVersion, no PII) passed');
