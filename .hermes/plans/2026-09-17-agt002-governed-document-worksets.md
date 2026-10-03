# AGT-002: Governed Document Worksets — Implementation Plan

## Goal
A flexible, governed document package for AGT-002 analysis: the server recommends
up to four documents, but an authorized Licitaciones custody user may explicitly
add an existing or newly uploaded document to the package before it is frozen and
analyzed.

## Core decisions
- **Composition**: server-recommended four documents are a default, not a ceiling.
  A custody user with the Licitaciones authorization may explicitly add one or
  more additional documents (existing in custody, or newly uploaded) before
  freezing.
- **Browser payload**: the client submits only per-document `document_version_id`,
  `source_classification` (recommended | user_added), and `inclusion_reason`
  (free text, required for user-added documents). No hashes, extraction data, or
  derived identity are trusted from the client.
- **Server-side resolution**: for each submitted version ID, the server resolves
  the current version, validates it belongs to the expected document/tender
  scope, computes/verifies content hash, resolves canonical typed extraction
  identity, and computes/verifies extraction text hash. Any mismatch or stale
  version rejects the whole package (fail closed, no partial packages).
- **Immutable freeze**: once validated, the package (ordered document list +
  resolved hashes + extraction identities) is frozen into a package/run record.
  Nothing about package membership is mutable after freeze.
- **Exact reproducibility**: the frozen package captures an exact snapshot,
  execution context, and a durable job record so the run can be replayed/audited
  byte-for-byte.
- **Worker isolation**: the worker consumes only the frozen package it was
  enqueued with. It must never re-query "all current documents" for the
  tender/entity — no live re-resolution, no implicit refresh.
- **Change = new package**: any later change to documents (new upload, different
  selection, recommendation change) creates a new package and a new run. Existing
  frozen packages/runs are never edited in place.
- **Single entry point**: one "Run AGT-002 analysis" CTA drives the whole flow.
  No GO/NO-GO gating, no Radar integration, no SECOP integration, and no other
  document-mutation side effects are introduced.

## Scope guardrails
- No changes to production feature flags.
- No GO/NO-GO logic, no Radar hooks, no SECOP hooks.
- No document mutation endpoints beyond what governed package creation strictly
  requires (upload + attach-to-package).

## TDD phases

### Phase 1 — Pure validation logic (no I/O)
- Unit-test and implement pure functions for: package composition rules (4
  recommended + N explicit adds), inclusion reason requirement for user-added
  docs, dedup/ordering rules, and the fail-closed validation contract (hash
  mismatch, stale version, wrong scope, extraction identity mismatch).
- No DB, no network — plain functions over plain data.

### Phase 2 — Additive secure schema / RLS / RPCs
- New tables/columns only (no altering existing document tables): package,
  package_document, package run/job.
- RLS: custody-scoped read/write restricted to Licitaciones-authorized users;
  packages are insert-once/immutable after freeze (no update policy on frozen
  rows).
- RPCs: resolve-and-validate version, freeze package (transactional), enqueue
  run.
- Tests: RLS policy tests (authorized vs unauthorized, cross-tenant), RPC
  contract tests (valid resolve, hash mismatch rejection, stale version
  rejection, double-freeze rejection).

### Phase 3 — Governed API / enqueue / worker identity
- API endpoint accepts only `{document_version_id, source_classification,
  inclusion_reason}[]`; performs server-side resolution from Phase 2 RPCs;
  freezes package; enqueues durable job with exact snapshot + context.
- Worker reads only its enqueued package payload — no live document queries.
- Tests: API contract tests (payload shape, rejection cases), enqueue/job
  durability tests, worker-identity test asserting no "list all current
  documents" call is made.

### Phase 4 — CRM selector / upload flow
- UI: recommended-four view with explicit "add existing" (selector over custody
  documents) and "upload new" actions, each requiring an inclusion reason.
- Single "Run AGT-002 analysis" CTA; no GO/NO-GO, Radar, or SECOP UI elements.
- Component/integration tests for selector, upload, reason requirement, and CTA
  submission payload shape.

### Phase 5 — Serial tests / security / build
- Run full serial test suite, security review of new RLS/RPCs/endpoints, and
  production build, in that order. (Not executed as part of this plan — see
  note below.)

### Phase 6 — PR / merge / deploy-main
- Open PR, merge, deploy to main once Phase 5 gates pass.

### Phase 7 — Validation run
- Execute one real DANE four-document run through the new governed flow.
- Readback the frozen package and job result to confirm snapshot fidelity,
  correct hashes/extraction identities, and correct worker isolation.

## Notes
- Production feature flags remain unchanged throughout all phases.
- No test execution performed as part of authoring this plan.
