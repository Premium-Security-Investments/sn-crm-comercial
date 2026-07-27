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
  assert.match(route, /useRulesFallback\('not_configured'\)/, 'unconfigured preview must fall back safely');
  assert.match(route, /useRulesFallback\('preview_unavailable'\)/, 'runtime failure must fall back safely');
  assert.match(route, /human_review_required: true/g, 'every response path must require human review');
  assert.doesNotMatch(route, /decision\s*:|go_no_go\s*:/i, 'preview endpoint must not create an authoritative GO/NO GO field');
}

assert.match(claimsMigration, /pg_advisory_xact_lock/, 'capacity decisions must be serialized in PostgreSQL');
assert.match(claimsMigration, /psi_agt002_preview_claims/, 'cross-request reservations require a durable lease table');
assert.match(claimsMigration, /not exists[\s\S]*psi_tender_analysis_runs/, 'daily quota must include in-flight claims without double-counting completed runs');

assert.match(engine, /outputSchema: AGT002_PREVIEW_OUTPUT_JSON_SCHEMA/, 'engine must hand the closed schema to Codex turn/start');
assert.match(ui, /can\(currentProfile, ACTIONS\.AI_ANALYSIS_RUN\)/, 'UI button must be capability-gated');
assert.match(ui, /tender-documents-analyze-agent-preview/, 'UI must call the dedicated preview endpoint');
assert.match(section, /Ejecutar AGT-002 Preview/, 'UI must expose a separate preview action');
assert.match(section, /Revisión humana obligatoria/, 'UI must display the human-review requirement');
assert.match(section, /Fallback seguro aplicado/, 'UI must disclose deterministic fallback');
assert.match(section, /Citas de evidencia/, 'UI must expose evidence references');

for (const source of [serverRoute, vercelRoute, engine]) {
  assert.doesNotMatch(source, /OPENAI_API_KEY|HERMES_INTERIM_API_KEY|Authorization\s*:|Bearer\s+/i, 'preview path must not manage API keys or bearer tokens');
}

console.log('AGT-002 Preview endpoint, RBAC and review UI contract passed');
