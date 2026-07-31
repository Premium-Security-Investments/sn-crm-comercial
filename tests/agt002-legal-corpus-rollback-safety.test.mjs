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

// --- 056 hardens the publication gate on top of 053: same non-destructive rules ---
const migration056 = readFileSync(new URL('../supabase/migrations/056_agt002_legal_corpus_publication_gate.sql', import.meta.url), 'utf8');
const rollback056 = readFileSync(new URL('../supabase/rollbacks/056_agt002_legal_corpus_publication_gate_rollback.sql', import.meta.url), 'utf8');

// --- Static shape checks on the 056 forward migration ------------------------
assert.match(migration056, /add column if not exists content_sha256 text/i);
assert.match(migration056, /add column if not exists superseded_at timestamptz/i);
assert.match(migration056, /add column if not exists superseded_by_version_id uuid/i);
assert.match(migration056, /content_sha256 is null or content_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/i);
assert.match(migration056, /status in \('draft', 'published', 'superseded'\)/i);
assert.match(migration056, /create unique index if not exists psi_agt002_legal_corpus_versions_one_published_idx/i);
assert.match(migration056, /where status = 'published'/i);
assert.match(migration056, /solo un actor humano puede publicar/i);
assert.match(migration056, /verified.*confirmed.*applicable/i);
assert.match(migration056, /grant execute[\s\S]*service_role/i);

// The migration itself must never delete/truncate/drop any pre-existing evidence or corpus data.
assert.doesNotMatch(migration056, /delete\s+from\s+public\.psi_(tender_analysis_runs|agt002_legal_corpus_versions|agt002_legal_sources)/i);
assert.doesNotMatch(migration056, /drop\s+table/i);
assert.doesNotMatch(migration056, /drop\s+column/i);
assert.doesNotMatch(migration056, /\btruncate\b/i);

// --- 056's rollback must be strictly non-destructive too ---------------------
// No DROP TABLE, DELETE, TRUNCATE or DROP COLUMN against any table: every schema
// addition (content_sha256, superseded_at/superseded_by_version_id, the widened
// status/lifecycle checks, the one-published index, the extended guard) survives
// rollback — only the two RPCs it hardened are reverted to their pre-056 form.
assert.doesNotMatch(rollback056, /drop\s+table/i);
assert.doesNotMatch(rollback056, /delete\s+from/i);
assert.doesNotMatch(rollback056, /\btruncate\b/i);
assert.doesNotMatch(rollback056, /drop\s+column/i);
assert.doesNotMatch(rollback056, /drop\s+index/i);
assert.doesNotMatch(rollback056, /drop\s+constraint/i);

// It disables only the human-only/hash-carrying publish RPC signature...
assert.match(rollback056, /drop function if exists public\.psi_publish_agt002_legal_corpus\(uuid, uuid, text\)/i);
assert.match(rollback056, /create function public\.psi_publish_agt002_legal_corpus/i);
assert.match(rollback056, /revoke all on function public\.psi_publish_agt002_legal_corpus\(uuid, uuid\)/i);
assert.match(rollback056, /grant execute on function public\.psi_publish_agt002_legal_corpus\(uuid, uuid\) to service_role/i);
// ...and restores the pre-056 (053) publish RPC, which never required a human actor
// nor a content hash — that hardening only exists once 056 is (re)applied.
assert.doesNotMatch(rollback056, /p_content_sha256/i);
assert.doesNotMatch(rollback056, /coalesce\(p\.identity_type, 'human'\) = 'human'/i);

// ...and restores the canonical-run RPC's pre-056 body: same signature, but no
// longer requiring a referenced corpus version to be 'published'.
assert.match(rollback056, /create or replace function public\.psi_record_agt002_canonical_analysis_run/i);
assert.doesNotMatch(rollback056, /v_legal_corpus_version\.status <> 'published'/i);

console.log('AGT-002 legal corpus rollback safety contract passed');
