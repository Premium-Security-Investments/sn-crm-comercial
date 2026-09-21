import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// AGT-002 durable Preview endpoint, worker, RBAC and review UI contract. The intended
// architecture retired POST /api/tender-documents-analyze-agent-preview and POST
// /api/agt002-reanalyze-fixed-snapshot (both now 410 governed_workset_required — see
// tests/agt002-governed-route-retirement.test.mjs): the only client-reachable entry point into
// an AGT-002 run is now POST /api/tender-agt002-governed-document-worksets, which resolves,
// validates, freezes and enqueues a governed document workset through
// freezeAgt002GovernedDocumentWorkset — never runs the engine inline.
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const section = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const governedWorkset = readFileSync(new URL('../src/tenders/components/TenderGovernedDocumentWorkset.tsx', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../agt002-preview-engine.js', import.meta.url), 'utf8');
const executor = readFileSync(new URL('../agt002-reanalysis-executor.js', import.meta.url), 'utf8');
const queueMigration = readFileSync(new URL('../supabase/migrations/068_agt002_reanalysis_jobs.sql', import.meta.url), 'utf8');

function routeBlock(source) {
  const start = source.indexOf("app.post('/api/tender-agt002-governed-document-worksets'");
  const end = source.indexOf("app.post('/api/tender-documents-import'", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

const route = routeBlock(server);
assert.equal(server, vercel, 'production backends must remain byte-identical');

// The retired routes must reject every request directly to the governed-retirement helper —
// no requireAction/ensureTenderOpportunity/DB call is ever reached through them.
assert.match(
  server,
  /app\.post\(\s*['"]\/api\/tender-documents-analyze-agent-preview['"]\s*,\s*rejectUngovernedAgt002Route\s*\)/,
  'the legacy preview-analyze route must be retired directly to the governed-retirement helper',
);
assert.match(
  server,
  /app\.post\(\s*['"]\/api\/agt002-reanalyze-fixed-snapshot['"]\s*,\s*rejectUngovernedAgt002Route\s*\)/,
  'the fixed-snapshot reanalyze route must be retired directly to the governed-retirement helper',
);
assert.doesNotMatch(
  server,
  /app\.post\(\s*['"]\/api\/tender-documents-analyze-agent-preview['"]\s*,\s*async \(req, res\)/,
  'the retired preview-analyze route must never keep an inline handler alongside the retirement wiring',
);

assert.match(route, /requireAction\(currentProfile, ACTIONS\.AI_ANALYSIS_RUN\)/);
assert.match(route, /ensureTenderOpportunity\(database, opportunityId, currentProfile\)/);
assert.match(route, /validateAgt002GovernedWorksetFreezeRequest\(req\.body\)/);
assert.match(route, /freezeAgt002GovernedDocumentWorkset\(database,/);
assert.match(route, /res\.status\(result\.status === 'created' \? 202 : 200\)\.json\(projectAgt002GovernedWorksetFreezeResult\(result\)\)/);
assert.doesNotMatch(route, /engine\.analyze|claimAgt002PreviewRun|runAgt002PostBridgeAnalysis|registerAgt002PreviewAnalysis/, 'the governed workset route enqueues only; it never runs the engine inline');
assert.doesNotMatch(route, /decision\s*:|go_no_go\s*:/i);

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
assert.match(ui, /tender-agt002-governed-document-worksets/);
assert.match(ui, /agt002-reanalysis-status\?opportunity_id/);
assert.match(ui, /reanalysisAbortRef\.current\?\.abort\(\)/);
assert.match(ui, /busy=\{busy \|\| Boolean\(activeReanalysisJobId\)\}/);
assert.doesNotMatch(ui, /tender-documents-analyze-agent-preview/, 'the UI must never call the retired preview-analyze route');
assert.doesNotMatch(ui, /agt002-reanalyze-fixed-snapshot/, 'the UI must never call the retired fixed-snapshot route');

assert.match(section, /No registra ni autoriza GO \/ NO GO/);
assert.doesNotMatch(section, /Generar análisis preliminar|>Actualizar análisis</);
assert.match(governedWorkset, /Congelar paquete y ejecutar AGT-002/);
assert.match(governedWorkset, /No registra ni autoriza GO \/ NO GO/);

console.log('AGT-002 governed document workset endpoint, worker, RBAC and review UI contract passed (legacy preview-analyze and fixed-snapshot routes retired)');
