# AGT-002 F4-min — bounded synthetic versioning slice

`agt002-f4-min-synthetic-versioning.js` is an isolated, in-memory, pure module. It has no
production/runtime integration and performs no external action of any kind. It is not wired into
any pipeline, worker, or route, and it makes no filesystem, network, or database calls (enforced by
the static-isolation test in `tests/agt002-f4-min-synthetic-versioning.test.mjs`).

This document describes what the module does and does not claim. It does not assert that this
scope, or any phase associated with it, is accepted, complete, or ready for a decision beyond the
bounded surface described below — that determination belongs to a separate, explicit review, not to
this file.

## Scope

- A fixed, pure, deterministic **manifest** of exactly 33 generated synthetic legacy rows
  (`AGT002_F4MIN_ROW_COUNT`), each classified into exactly one of three closed values
  (`AGT002_F4MIN_CLASSIFICATIONS`): `backfillable_with_source`, `legacy_metadata_only`,
  `requires_human_resolution`. The catalog splits evenly, 11 rows per classification.
- A **hash chain** over the manifest: every row carries its own `row_hash`, and the manifest as a
  whole carries a `manifest_hash`. Both are pure functions of the manifest's own fields — no
  randomness, no wall-clock read, nothing external.
- A **reconstruction path** (`reconstructVersion`) that can only ever produce a "v1" version record
  for a row classified `backfillable_with_source`, and only when every one of the following holds:
  - the caller's declared `source_hash` matches the sha256 of the `source_bytes` actually supplied
    (self-verifiable), **and**
  - that same hash matches the row's own pinned `expected_content_sha256` (tied to the specific
    row, not any internally-consistent content), **and**
  - a `mapping` binds the exact `row_id`/`source_id` pair, is marked `approved: true`, and is
    approved by a validated human identity (`principal_kind: 'person'`, not one of the closed
    role ids, with a `fixture://`-isolated `durable_ref.locator`), **and**
  - the accompanying `provenance` carries non-empty `source`/`issuer`/`locator`/`captured_at_utc`
    fields, with `locator` under `fixture://` and `captured_at_utc` a valid RFC 3339 UTC instant.
  A row classified `legacy_metadata_only` or `requires_human_resolution` is never eligible for a
  v1 version, regardless of how well-formed the rest of the request is.
- A **teardown** primitive that clears only an instance's working version records; the audit
  log (the compliance ledger) survives teardown untouched.

## Concept map

| Concept | Existing repository contract? | Notes |
|---|---|---|
| Legacy row catalog | New isolated in-memory synthetic concept | `buildAgt002F4MinManifest()` generates exactly 33 rows, deterministically, from a fixed rule (`index`, `classification`) — no external fixture file, no database table, no randomness. |
| Row classification | New isolated in-memory synthetic concept | The closed `AGT002_F4MIN_CLASSIFICATIONS` catalog is local to this module; it is not a shared taxonomy table and does not claim to model any real legacy-data-quality taxonomy beyond this bounded slice. |
| Source bytes / hash / provenance | New isolated in-memory synthetic concept | `computeAgt002F4MinCanonicalSourceBytes(rowId)` is the pure fixture generator behind each `backfillable_with_source` row's pinned `expected_content_sha256`. A caller reconstructing a row must supply exactly that content (or, in the general case, a real source with a hash pinned the same way) — an internally self-consistent but different byte stream is refused with `source.hash_mismatch_row_expectation`. |
| Manifest hash chain | New isolated in-memory synthetic concept | `recomputeAgt002F4MinRowHash` / `recomputeAgt002F4MinManifestHash` / `verifyAgt002F4MinManifestIntegrity` are pure functions that reconstruct and verify the chain from a manifest snapshot alone — no external store is read, and tampering at either the row or manifest level is detected. |
| Human-bound mapping | New isolated in-memory synthetic concept | `mapping` must name the exact `row_id`/`source_id` pair being reconstructed and be `approved: true` by a validated human identity; the identity check follows the same closed-catalog convention used elsewhere in AGT-002 (role ids are never treated as a person), reimplemented locally — no shared function or table is called. |
| Fabricated v1 refusal | New isolated in-memory synthetic concept | `reconstructVersion` fails closed on every way a v1 can be requested without being verifiable: missing bytes, a malformed hash, a hash that does not match the supplied bytes, or bytes that do not match the row's own pinned expectation. |
| Reconstruction sentinel | New isolated in-memory synthetic concept | `AGT002_F4MIN_RECONSTRUCTION_SENTINEL` is a fixed exported string local to this module; every reconstruction call must present it exactly, or the call is denied with `reconstruction.sentinel_invalid`. |
| Teardown / reconstruction | New isolated in-memory synthetic concept | `teardown` clears only an instance's working version records; the audit log survives untouched. The manifest itself is a pure, stateless concept and is unaffected by any instance's teardown. |

No claim is made anywhere in this document, the module, or its tests that this slice is wired into
any production route, worker, or database object, or that it models any real legacy-data-recovery
pipeline. All ids are synthetic-prefixed, all locators are `fixture://`, and the static-isolation
test asserts the module imports nothing beyond `node:crypto`.

## Out of scope

This slice does not touch, extend, or make any claim about anything outside the bounded surface
above. In particular, it performs no external action of any kind, and it is not evidence toward
accepting any broader phase, pipeline, or system this repository may separately describe.
