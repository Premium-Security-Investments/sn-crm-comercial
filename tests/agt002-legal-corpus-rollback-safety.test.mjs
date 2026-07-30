import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/053_agt002_legal_corpus.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/053_agt002_legal_corpus_rollback.sql', import.meta.url), 'utf8');

// --- Static shape checks on the forward migration ---------------------------
assert.match(migration, /create table if not exists public\.psi_agt002_legal_corpus_versions/i);
assert.match(migration, /create table if not exists public\.psi_agt002_legal_sources/i);
assert.match(migration, /create table if not exists public\.psi_agt002_legal_topics/i);
assert.match(migration, /status text not null default 'draft' check \(status in \('draft', 'published'\)\)/i);
assert.match(migration, /append-only/i);
assert.match(migration, /es inmutable/i);
assert.match(migration, /verification_status in \('verified', 'unverified'\)/i);
assert.match(migration, /validity_status in \('confirmed', 'uncertain'\)/i);
assert.match(migration, /applicability_status in \('applicable', 'uncertain', 'not_applicable'\)/i);
assert.match(migration, /unique \(corpus_version_id, source_id\)/i);
// The allowlist hosts appear inside a POSIX regex literal in the SQL, so the
// dots are escaped as a literal backslash + dot (two characters), not a
// single "." — match that literal text rather than a JS-regex-escaped dot.
assert.ok(migration.includes('funcionpublica\\.gov\\.co'), 'missing funcionpublica.gov.co in official host allowlist');
assert.ok(migration.includes('suin-juriscol\\.gov\\.co'), 'missing suin-juriscol.gov.co in official host allowlist');
assert.ok(migration.includes('colombiacompra\\.gov\\.co'), 'missing colombiacompra.gov.co in official host allowlist');
assert.ok(migration.includes('supervigilancia\\.gov\\.co'), 'missing supervigilancia.gov.co in official host allowlist');
assert.match(migration, /https:\/\//);
assert.match(migration, /add column if not exists legal_corpus_version_id uuid references public\.psi_agt002_legal_corpus_versions/i);
assert.match(migration, /grant execute[\s\S]*service_role/i);
assert.match(migration, /revoke all on table public\.psi_agt002_legal_corpus_versions/i);
assert.match(migration, /revoke all on table public\.psi_agt002_legal_sources/i);
assert.match(migration, /revoke all on table public\.psi_agt002_legal_topics/i);

// The migration itself must never delete/truncate/drop any pre-existing evidence.
assert.doesNotMatch(migration, /delete\s+from\s+public\.psi_tender_analysis_runs|truncate\s+.*psi_tender_analysis_runs/i);
assert.doesNotMatch(migration, /drop\s+table.*psi_tender_analysis_runs\b/i);

// --- Rollback must be strictly non-destructive -------------------------------
// No DROP TABLE, DELETE or TRUNCATE against ANY table, and no DROP COLUMN at all:
// the corpus tables, the runs table and the new FK column all survive rollback.
assert.doesNotMatch(rollback, /drop\s+table/i);
assert.doesNotMatch(rollback, /delete\s+from/i);
assert.doesNotMatch(rollback, /truncate/i);
assert.doesNotMatch(rollback, /drop\s+column/i);

// It disables the three new write RPCs...
assert.match(rollback, /revoke all on function public\.psi_create_agt002_legal_corpus_draft/i);
assert.match(rollback, /drop function if exists public\.psi_create_agt002_legal_corpus_draft/i);
assert.match(rollback, /revoke all on function public\.psi_add_agt002_legal_source/i);
assert.match(rollback, /drop function if exists public\.psi_add_agt002_legal_source/i);
assert.match(rollback, /revoke all on function public\.psi_publish_agt002_legal_corpus/i);
assert.match(rollback, /drop function if exists public\.psi_publish_agt002_legal_corpus/i);

// ...and restores 051's canonical-run RPC signature verbatim so 051's own
// rollback stays valid if it is ever applied after this one.
assert.match(rollback, /drop function if exists public\.psi_record_agt002_canonical_analysis_run\(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid\)/i);
assert.match(rollback, /create function public\.psi_record_agt002_canonical_analysis_run/i);
assert.doesNotMatch(rollback, /p_legal_corpus_version_id/i);

console.log('AGT-002 legal corpus rollback safety contract passed');
