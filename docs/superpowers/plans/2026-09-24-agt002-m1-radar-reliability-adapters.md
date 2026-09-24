# AGT-002 M1 Radar Reliability Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Follow each checkbox in order.

**Goal:** Map one explicit synthetic legacy Radar envelope into the existing M1 reliability bundle and make a fail-closed promotion decision without production integration.

**Architecture:** A pure adapter performs a literal closed mapping and delegates complete bundles to the existing M1 evaluator. Missing legacy fields reject before bundle construction; no IDs, hashes, timestamps, counts, evidence, pagination or freshness values are inferred.

**Tech Stack:** Node.js ESM, node:test, JSON fixtures.

## Global constraints

- Base HEAD: `29cd8a55243c0e3a33ccd1f8fe33da5282d1df57`; do not fetch, rebase, merge or reconcile main.
- Local/offline synthetic fixtures only; do not touch runtime, server/API/UI, SQL/migrations, scheduler, network, DB, CRM or real data.
- One final independent Sonnet review only after mechanical GREEN.
- Local commit only after GREEN; no push, PR, merge or rebase.

## Task 1 — RED

**Files:** create `tests/agt002-m1-radar-reliability-adapter.test.mjs`, `contracts/agt002-radar-reliability/v1/adapter-fixtures/expectations.json`, and exactly eight fixtures: `complete-promotable.json`, `partial-run.json`, `expired-run.json`, `incomplete-coverage.json`, `missing-evidence.json`, `invalid-source-persistence-lineage.json`, `persistence-presentation-mismatch.json`, `missing-required-source-hash.json`.

- [ ] Import `adaptLegacyRadarResultToM1` from the absent adapter module and assert exact inventory, synthetic-only data, literal happy-path mapping, verdict, promotable flag, reasons and missing paths.
- [ ] Freeze required legacy paths under `run`, `source`, `persistence`, `presentation`, `evidence[]` and `freshness`.
- [ ] Run `node --test --test-concurrency=1 tests/agt002-m1-radar-reliability-adapter.test.mjs`; expect non-zero exit caused by the missing adapter module.

## Task 2 — GREEN

**Files:** create `agt002-m1-radar-reliability-adapter.js` only.

- [ ] Export `adaptLegacyRadarResultToM1(legacy)`.
- [ ] Use fixed required leaf paths and own-property traversal; never default, coalesce, hash, timestamp or infer counts.
- [ ] Missing paths return `REJECTED`, `bundle:null`, `INVALID`, `promotable:false`, reason `adapter.legacy.missing_required_field`, empty checked terms and exact `missing_fields`.
- [ ] Complete input maps literal legacy values into the existing M1 bundle; the only supplied constant is `schema_version:'agt002-m1-radar-reliability-v1'`.
- [ ] Delegate the complete bundle to `validateAgt002M1RadarReliabilityBundle` without overriding verdict or reasons.
- [ ] Rerun the focal test; expect exit 0.

## Task 3 — Fixture validator

**Files:** create `scripts/agt002-m1-radar-reliability-validate-adapter-fixtures.mjs`.

- [ ] Inventory disk and expectations bidirectionally, evaluate all eight fixtures, compare exact outcome fields, emit deterministic JSON, and exit non-zero on any mismatch.
- [ ] Run adapter focal, existing M1 contract/fixture tests, the new validator and `scripts/agt002-m1-radar-reliability-validate-fixtures.mjs`; expect zero failures.

## Task 4 — Closure

- [ ] Run `git diff --check` and the established full serial repository regression; record exact counts and hashes.
- [ ] Run exactly one read-only final Claude Sonnet review over the full adapter diff and verify its execution envelope/model provenance.
- [ ] Mechanically validate any finding; fix blockers with focused RED→GREEN and rerun all checks without a second full review.
- [ ] Stage only the adapter, adapter test, eight fixtures, expectations, validator and this plan; commit locally as `feat(agt002): add M1 radar legacy adapters`.
- [ ] Update CURRENT and roadmap with mechanical evidence; stop at `AGT002_M1_ADAPTERS_READY_FOR_PUBLICATION_DECISION` and emit only `ADAPTERS_GREEN_LOCAL` or `BLOCKED`.

Do not write or edit any other file.
