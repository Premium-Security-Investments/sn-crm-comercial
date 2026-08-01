import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const section = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../agt002-preview-engine.js', import.meta.url), 'utf8');
const claimsMigration = readFileSync(new URL('../supabase/migrations/028_agt002_preview_claims.sql', import.meta.url), 'utf8');

function routeBlock(source) {
  const start = source.indexOf("app.post('/api/tender-documents-analyze-agent-preview'");
  const end = source.indexOf("app.post('/api/tender-documents-import'", start);
  assert.ok(start >= 0 && end > start, 'AGT-002 Preview endpoint must exist before document import');
  return source.slice(start, end);
}

const serverRoute = routeBlock(server);
const vercelRoute = routeBlock(vercel);
assert.equal(serverRoute, vercelRoute, 'canonical and Vercel endpoint implementations must stay identical');

for (const route of [serverRoute, vercelRoute]) {
  assert.match(route, /requireAction\(currentProfile, ACTIONS\.AI_ANALYSIS_RUN\)/, 'endpoint must enforce AI run RBAC');
  assert.match(route, /ensureTenderOpportunity\(database, opportunityId, currentProfile\)/, 'endpoint must preserve tender scope authorization');
  assert.ok(route.indexOf('claimAgt002PreviewRun') < route.indexOf('engine.analyze'), 'atomic DB reservation must happen before provider invocation');
  assert.match(route, /releaseAgt002PreviewClaim/, 'every terminal path must release or expire its provider lease');
  assert.match(route, /analysis: presentCurrentTenderAnalysis\(existingRun\)/, 'idempotent response must present the exact AGT-002 run it reused');
  assert.match(route, /countAgt002PreviewRunsToday/, 'endpoint must enforce the DB-backed daily limit');
  assert.match(route, /const canonicalOnly = agt002AnalysisConfig\.AGT002_CANONICAL_ONLY === true/, 'endpoint must derive canonical-only behavior from the fail-closed flag');
  assert.match(route, /if \(!canonicalOnly\) return useRulesFallback\('not_configured'\)/, 'legacy rollback mode may fall back only when canonical-only is disabled');
  assert.match(route, /if \(!canonicalOnly\) \{[\s\S]*return useRulesFallback\('preview_unavailable'\)/, 'runtime fallback must be explicitly guarded by disabled canonical-only mode');
  assert.match(route, /if \(!canonicalOnly\) return useRulesFallback\(claim\.status\)/, 'quota fallback must be explicitly guarded by disabled canonical-only mode');
  assert.match(route, /appendAttempt\(idempotencyKey, 'running'\)/, 'canonical attempts must persist running state before provider invocation');
  assert.match(route, /appendAttempt\(idempotencyKey, 'completed', \{ analysis_run_id: registeredRun\.run_id \}\)/, 'canonical attempts must persist completion tied to the run');
  assert.match(route, /registerAgt002PreviewAnalysis\([\s\S]*canonicalOnly, context_version_id: contextVersion\?\.id \}\)/, 'run persistence must receive canonical-only plus the exact immutable context version');
  assert.match(route, /findAgt002PreviewRun\(database, idempotencyKey, \{ canonicalOnly \}\)/, 'idempotent reuse must filter canonical runs when enabled');
  assert.match(route, /used: null, fallback: false, state/, 'unavailable canonical responses must not present a substitute producer');
  assert.match(route, /human_review_required: true/g, 'every response path must require human review');
  assert.doesNotMatch(route, /decision\s*:|go_no_go\s*:/i, 'preview endpoint must not create an authoritative GO/NO GO field');
}

assert.match(claimsMigration, /pg_advisory_xact_lock/, 'capacity decisions must be serialized in PostgreSQL');
assert.match(claimsMigration, /psi_agt002_preview_claims/, 'cross-request reservations require a durable lease table');
assert.match(claimsMigration, /not exists[\s\S]*psi_tender_analysis_runs/, 'daily quota must include in-flight claims without double-counting completed runs');

assert.match(engine, /const outputSchema = outputSchemaForEvidenceIds\(allowedEvidenceIds, \{[\s\S]*?legalCorpus,[\s\S]*?legalCitationIds,[\s\S]*?\}\);/, 'engine must derive a closed schema from documentary and legal ids present in the snapshot');
assert.match(engine, /allowedLegalCitationIds: legalCitationIds\.all/, 'derived legal schema must close legal citations to the exact versioned packet allowlist');
assert.match(engine, /evidence_refs\.items\.enum = \[\.\.\.allowedEvidenceIds\]/, 'derived schema must close evidence references to the allowed ids');
assert.match(engine, /client\.run\(\{ model, policy: policyText, input: previewInput, outputSchema,/, 'engine must hand the evidence-closed schema to Codex turn/start');
assert.match(ui, /can\(currentProfile, ACTIONS\.AI_ANALYSIS_RUN\)/, 'UI button must be capability-gated');
assert.match(ui, /tender-documents-analyze-agent-preview/, 'UI must call the dedicated preview endpoint');
assert.match(section, /Analizar con Vig-IA/, 'UI must expose the canonical Vig-IA action');
assert.match(section, /Actualizar con Vig-IA/, 'UI must label refreshes as Vig-IA updates');
assert.match(section, /Volver a analizar con Vig-IA/, 'UI must label stale or failed retries explicitly');
assert.doesNotMatch(section, /Generar análisis preliminar|>Actualizar análisis</, 'deterministic analysis labels may not remain postconversion');
assert.doesNotMatch(section, /onAnalyze:\s*\(\)\s*=>\s*void|onClick=\{onAnalyze\}/, 'deterministic analysis callback may not remain');
assert.doesNotMatch(ui, /const analyzeDocuments = async/, 'opportunity UI may not retain a deterministic analysis handler');
assert.match(section, /Revisión humana obligatoria/, 'UI must display the human-review requirement');
assert.match(section, /Fallback seguro aplicado/, 'UI must disclose deterministic fallback while rollback mode remains available');
assert.match(section, /Citas de evidencia/, 'UI must expose evidence references');

for (const source of [serverRoute, vercelRoute, engine]) {
  assert.doesNotMatch(source, /OPENAI_API_KEY|HERMES_INTERIM_API_KEY|Authorization\s*:|Bearer\s+/i, 'preview path must not manage API keys or bearer tokens');
}

console.log('AGT-002 Preview endpoint, RBAC and review UI contract passed');
