# AGT002 Phase 01 — Binding Inventory

Normative source: `contracts/agt002-phase01/v1/binding-registry.json`
(`schema_version: agt002-phase01-binding-registry/1.0.0`,
`registry_version: 1`), validated against
`contracts/agt002-phase01/v1/binding-registry.schema.json`.

## Cutoff

All three bindings in the registry share a single, consistent cutoff:

- `cutoff_utc`: `2026-09-23T00:00:00Z`
- `verified_at_utc`: `2026-09-23T09:00:00Z` (within 24h of cutoff, as required)

Every fact below was swept against the live `supabase/migrations` tree as
it stood at that cutoff. Any schema change landing after
`2026-09-23T00:00:00Z` is out of scope for this inventory and requires a
fresh sweep.

## BIND-TENDER-OPPORTUNITY-INVERSE — confirmed_durable

The only live, durable binding between the tender and opportunity tables
runs in the inverse direction:

- Table/column: `psi_public_tenders.converted_opportunity_id`
- References: `psi_sales_opportunities.id`
- `on_delete`: `set_null`
- Unique constraint: `psi_public_tenders_converted_opportunity_id_unique`
  (a partial unique index enforcing at most one tender per opportunity)
- Live endpoint: `/rest/v1/psi_public_tenders`

Evidence: `AGT002-P1-FACT-0001`
(`migration://supabase/migrations/005_public_tenders_radar.sql:27`) for the
column/FK/`on_delete`, and `AGT002-P1-FACT-0002`
(`migration://supabase/migrations/018_tender_tracking_rpc.sql:42-44`) for
the unique constraint.

## BIND-ENTITY-L — absent_live — AGT002-P1-GAP-0001

No column, table, or view instantiating a first-class `entity_l` identity
distinct from the existing profile/role/permission surface exists live.
`table`, `column`, `unique_constraint`, `on_delete` and `live_endpoint` are
all `null` for this binding, and `gap_id` is populated with
`AGT002-P1-GAP-0001`. The evidence attached to this gap documents the
identity/permission surface that was actually inspected during the sweep
(`AGT002-P1-FACT-0007` through `AGT002-P1-FACT-0010`), not a live
`entity_l` implementation — it does not invent one.

## BIND-OPPORTUNITY-TENDER-ID-FORWARD — absent_live — AGT002-P1-GAP-0002

No forward foreign key column exists on `psi_sales_opportunities.tender_id`
live; only the inverse column documented above exists. `table`, `column`,
`unique_constraint`, `on_delete` and `live_endpoint` are all `null`, and
`gap_id` is populated with `AGT002-P1-GAP-0002`. The evidence attached
(`AGT002-P1-FACT-0003` through `AGT002-P1-FACT-0006`, and
`AGT002-P1-FACT-0011`) documents the tender lifecycle state machine and the
radar gate surface that was actually inspected, not a live forward column.

## Gate consumption ledger store — absent (AGT002-P1-GAP-0003)

The fixture context `gate-consumed-no-ledger`
(`contracts/agt002-phase01/v1/fixtures/contexts.json`) declares a `CONSUMED`
gate scenario with no `consumption_ledger` array at all. There is no live
store this Phase 01 sweep could query to reconcile a gate's `consumption`
block against a durable ledger of past receipts; the sweep can only assert
that the gate's own embedded `consumption` object is internally
consistent.

## Authority registry store — absent (AGT002-P1-GAP-0004)

The fixture context `authority-registry-schema-absent`
(`contracts/agt002-phase01/v1/fixtures/contexts.json`) omits
`authority_registry_schema_ref`, while every context that depends on the
registry must point it at
`contracts/agt002-phase01/v1/authority-registry.schema.json`. That absence
is effective: there is no live authority registry schema this sweep could
resolve `AUTHORITY_DELEGATION` grants against in that scenario; evaluation
must fall back to an `UNVERIFIED` verdict rather than inventing a grant.

## `psi_agt002_radar_gate_evaluations` — evidence, not a ledger

`AGT002-P1-FACT-0011`
(`migration://supabase/migrations/071_agt002_radar_gate.sql:4`) confirms the
table `psi_agt002_radar_gate_evaluations` exists live. This table is
specific evidence for the AGT002 radar gate workflow only — it stores
radar-gate evaluation rows for that one workflow. It is not a generic,
reusable consumption ledger for the `consumption_ledger` concept used
throughout `contracts/agt002-phase01/v1/gate.schema.json`; treating it as
one would conflate a single workflow's evaluation log with the
cross-gate-type ledger described in GAP-0003 above, and this inventory
does not make that substitution.
