import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const section = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../agt002-preview-engine.js', import.meta.url), 'utf8');
const executor = readFileSync(new URL('../agt002-reanalysis-executor.js', import.meta.url), 'utf8');
const queueMigration = readFileSync(new URL('../supabase/migrations/068_agt002_reanalysis_jobs.sql', import.meta.url), 'utf8');

function routeBlock(source) {
  const start = source.indexOf("app.post('/api/tender-documents-analyze-agent-preview'");
  const end = source.indexOf("app.post('/api/tender-documents-import'", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

const route = routeBlock(server);
assert.equal(server, vercel, 'production backends must remain byte-identical');
assert.match(route, /requireAction\(currentProfile, ACTIONS\.AI_ANALYSIS_RUN\)/);
assert.match(route, /ensureTenderOpportunity\(database, opportunityId, currentProfile\)/);
assert.match(route, /const canonicalOnly = agt002AnalysisConfig\.AGT002_CANONICAL_ONLY === true/);

const canonicalStart = route.indexOf('if (canonicalOnly) {');
const legacyStart = route.indexOf('// canonicalOnly always returns above', canonicalStart);
assert.ok(canonicalStart >= 0 && legacyStart > canonicalStart);
const canonical = route.slice(canonicalStart, legacyStart);
assert.match(canonical, /enqueueAgt002CanonicalReanalysis\(database,/);
assert.match(canonical, /res\.status\(202\)\.json/);
assert.match(canonical, /human_review_required: true/);
assert.doesNotMatch(canonical, /engine\.analyze|claimAgt002PreviewRun|runAgt002PostBridgeAnalysis|registerAgt002PreviewAnalysis/);
assert.doesNotMatch(canonical, /decision\s*:|go_no_go\s*:/i);

const enqueueStart = server.indexOf('async function enqueueAgt002CanonicalReanalysis');
const enqueueEnd = server.indexOf('\n}\n', enqueueStart);
const enqueue = server.slice(enqueueStart, enqueueEnd);
assert.match(enqueue, /findAgt002PreviewRun\(database, idempotencyKey, \{ canonicalOnly: true \}\)/);
assert.match(enqueue, /buildAgt002FrozenEngineInput/);
assert.match(enqueue, /createAgt002ReanalysisJob/);

assert.ok(executor.indexOf('claimPreviewRun(database') < executor.indexOf('runPostBridgeAnalysis(database'));
assert.equal((executor.match(/await runPostBridgeAnalysis\(/g) || []).length, 1);
assert.match(executor, /findPreviewRun\(database, job\.idempotencyKey, \{ canonicalOnly: true \}\)/);
assert.match(executor, /releasePreviewClaim/);
assert.doesNotMatch(executor, /OPENAI_API_KEY|HERMES_INTERIM_API_KEY|Authorization\s*:|Bearer\s+/i);

assert.match(queueMigration, /pg_advisory_xact_lock/);
assert.doesNotMatch(queueMigration, /idempotency_key text not null unique/i);
assert.match(queueMigration, /create unique index if not exists psi_agt002_reanalysis_jobs_one_active[\s\S]*where status in \(\s*'queued'\s*,\s*'running'\s*\)/i);
assert.match(queueMigration, /check \(status in \(\s*'queued'\s*,\s*'running'\s*,\s*'completed'\s*,\s*'unavailable'\s*\)\)/i);

assert.match(engine, /const outputSchema = outputSchemaForEvidenceIds/);
assert.match(engine, /allowedLegalCitationIds: legalCitationIds\.all/);
assert.match(engine, /evidence_refs\.items\.enum = \[\.\.\.allowedEvidenceIds\]/);

assert.match(ui, /can\(currentProfile, ACTIONS\.AI_ANALYSIS_RUN\)/);
assert.match(ui, /tender-documents-analyze-agent-preview/);
assert.match(ui, /agt002-reanalysis-status\?opportunity_id/);
assert.match(ui, /reanalysisAbortRef\.current\?\.abort\(\)/);
assert.match(ui, /busy=\{busy \|\| Boolean\(activeReanalysisJobId\)\}/);
assert.match(section, /Analizar con \$\{VIGIA_VISIBLE_NAMES\.tenders\}/);
assert.match(section, /Actualizar con \$\{VIGIA_VISIBLE_NAMES\.tenders\}/);
assert.match(section, /Volver a analizar con \$\{VIGIA_VISIBLE_NAMES\.tenders\}/);
assert.doesNotMatch(section, /Generar análisis preliminar|>Actualizar análisis</);
assert.match(section, /No registra ni autoriza GO \/ NO GO/);

console.log('AGT-002 durable Preview endpoint, worker, RBAC and review UI contract passed');
