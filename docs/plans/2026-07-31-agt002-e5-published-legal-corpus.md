# AGT-002 E5 Published Legal Corpus Implementation Plan

> **For Hermes:** Execute task-by-task with strict RED→GREEN TDD. One implementation pass and one independent review. Do not push, deploy, migrate production, publish corpus, enable flags, or run a paid canary without Juan's explicit gate.

**Goal:** Make E5 consume exactly one human-published, versioned Colombian legal corpus from Supabase, bind every E5 run/idempotency key to its corpus UUID, and keep uncertain sources in explicit human-review abstention.

**Architecture:** Migration 056 hardens the already-applied 053 schema rather than rewriting history. A DB loader reconstructs and validates the active published corpus once per analysis before the claim; the resulting immutable `{legal_corpus_version_id, corpus, content_hash}` is passed into the runtime, engine envelope and persistence. The local JSON remains a curated import/fixture only. Publication requires a human actor, one verified+confirmed+applicable source, a SHA-256 manifest hash, and atomically supersedes any prior published version.

**Tech Stack:** Node.js ESM, Supabase JS/PostgREST, PostgreSQL RPC/RLS, PGlite integration tests, Node test runner.

---

## Non-negotiable invariants

1. `AGT002_LEGAL_CORPUS=false` preserves E4 behavior byte-for-byte where practical.
2. E5 enabled without a published DB corpus fails closed before provider invocation.
3. Runtime never reads `data/agt002/legal-corpus-v1.json` as production evidence.
4. Publish requires `identity_type='human'` and at least one source eligible for verified law; uncertain sources may coexist but remain review-only.
5. Exactly one corpus version may have `status='published'`; publishing supersedes the previous one atomically.
6. Every E5 run has non-null `legal_corpus_version_id`, pointing to a published version.
7. Claim and persisted-run idempotency include the exact corpus UUID.
8. A deterministic SHA-256 over the canonical manifest is stored and verified.
9. No legal output can sign, submit, approve, reject, or decide GO/NO-GO; human review remains mandatory.
10. Existing production data, E4 run and schema remain intact; rollback is non-destructive.

---

### Task 1: Write migration-056 RED tests

**Files:**
- Create: `tests/agt002-legal-corpus-publish-gate-pglite.integration.test.mjs`
- Modify: `tests/agt002-legal-corpus-rollback-safety.test.mjs`
- Modify: `scripts/agt002-program-migrations.mjs`

**RED cases:**
- agent cannot publish;
- all-uncertain corpus cannot publish;
- missing/invalid hash cannot create/publish;
- human can publish corpus with at least one eligible source;
- publishing B supersedes A and leaves exactly one `published`;
- canonical run rejects draft/superseded corpus;
- migration registry recognizes 056 and rollback markers.

**Verify RED:**
`node --test --test-concurrency=1 tests/agt002-legal-corpus-publish-gate-pglite.integration.test.mjs`
Expected: FAIL because migration 056 does not exist.

### Task 2: Implement migration 056 and non-destructive rollback

**Files:**
- Create: `supabase/migrations/056_agt002_legal_corpus_publication_gate.sql`
- Create: `supabase/rollbacks/056_agt002_legal_corpus_publication_gate_rollback.sql`
- Modify: `scripts/agt002-program-migrations.mjs`

**Implementation:**
- add `content_sha256 text` to corpus versions with strict lowercase 64-hex check;
- replace draft creation RPC with signature carrying hash;
- replace publish RPC: human-only, at least one eligible source, supersede previous published version atomically;
- unique partial index enforcing one published version;
- harden canonical-run RPC to accept only `published` corpus when non-null;
- preserve append-only source/topic data and existing rows;
- rollback removes new write surfaces/index/gates but never drops corpus data or run references.

**Verify GREEN:** targeted PGlite + rollback tests.

### Task 3: Add canonical manifest hashing and DB-row reconstruction with TDD

**Files:**
- Create: `agt002-legal-corpus-store.js`
- Create: `tests/agt002-legal-corpus-store.test.mjs`
- Modify: `scripts/validate_agt002_legal_corpus.mjs`

**RED cases:**
- canonical hash stable under object-key ordering but sensitive to legal content;
- loader returns exactly one published version with sources/topics reconstructed to the closed manifest contract;
- no published version, multiple published versions, hash mismatch, malformed row, or unapproved status fail closed;
- loader never reads filesystem/network.

**Implementation:**
- deterministic recursive key-sort JSON canonicalization;
- SHA-256 hash;
- Supabase reads through service-role DB client;
- validate reconstructed manifest using existing closed contracts;
- return immutable `{ legal_corpus_version_id, corpus_version, content_sha256, corpus }`.

### Task 4: Bind runtime, engine and persistence to corpus UUID with TDD

**Files:**
- Modify: `agt002-preview-runtime.js`
- Modify: `agt002-preview-engine.js`
- Modify: `agt002-preview-persistence.js`
- Modify: `tests/agt002-preview-runtime.test.mjs`
- Modify: `tests/agt002-preview-engine.test.mjs`
- Modify: `tests/agt002-preview-persistence.test.mjs`

**RED cases:**
- E5 runtime requires explicit loaded corpus context and does not call `readFileSync`;
- envelope carries `legal_corpus_version_id` and corpus hash only when E5 is on;
- persistence requires UUID when legal evidence/findings are present;
- persistence rejects UUID without legal evidence/findings;
- idempotency differs when only corpus UUID changes;
- RPC receives `p_legal_corpus_version_id`.

**Implementation:**
- inject loaded corpus context into runtime;
- build deterministic legal retrieval from that context;
- propagate ID/hash through validated envelope metadata;
- compute claim/persistence key with `legalCorpusVersionId`;
- persist exact UUID.

### Task 5: Wire all server analysis paths before reservation

**Files:**
- Modify: `server/index.js`
- Modify/add focused server tests under `tests/`.

**RED cases:**
- when E5 off, no legal corpus query and existing key/path unchanged;
- when E5 on, active published corpus loads before `computeAgt002PreviewIdempotencyKey` and before claim;
- same context/model/snapshot with different corpus UUID yields different claim and run;
- loader failure produces controlled `unavailable/needs_attention`, never rules fallback presented as legal analysis.

**Implementation:**
- one helper used by every current analysis/reanalysis route;
- pass loaded context consistently into key, runtime and persistence;
- avoid duplicated DB loads within one analysis.

### Task 6: Repair the offline manifest and record live-link evidence

**Files:**
- Modify: `data/agt002/legal-corpus-v1.json`
- Create: `docs/verification/2026-07-31-agt002-e5-source-checks.json`
- Modify: `tests/agt002-legal-corpus-manifest.test.mjs`

**Rules:**
- replace blocked SUIN/Función Pública links with reachable official ANCP-CCE/Supervigilancia URLs already checked via TLS strict;
- do not elevate `validity_status`, `verification_status`, `applicability_status`, modification resolution or effective dates without substantive official evidence;
- keep unresolved items explicitly uncertain/review-only;
- store timestamp, HTTP status, effective URL, content type and SHA-256 of fetched official payload/page artifact, but no secrets;
- manifest must contain at least one genuinely eligible verified source before it may pass `--publishable`; if legal verification is not supportable from evidence, keep gate RED and do not publish.

### Task 7: Full QA and independent review

**Commands:**
- targeted E5 suite, sequential;
- `node --test --test-concurrency=1 tests/*.test.mjs`;
- migration matrix/rollback checks;
- `git diff --check` and `git status`;
- independent Claude Opus review once, only re-review for Critical/Important regression.

**Required result:** no Critical/Important findings, all tests green, flag still off, no production writes.

### Task 8: Human-gated release (not authorized by this plan alone)

1. Present exact source statuses and publishable hash to Juan.
2. On approval, apply migration 056 with backup/rollback evidence.
3. Create draft/import sources via RPC; human identity publishes.
4. Verify one published version and zero pre-existing E5 runs.
5. Deploy code with all E5 flags off.
6. Temporarily enable only `AGT002_LEGAL_CORPUS` for one authorized canary with E4 prerequisites still on.
7. Verify exact corpus UUID/hash, citations/abstentions, no invented law, no GO/NO-GO.
8. Restore safe flags and rotate temporary secrets.
