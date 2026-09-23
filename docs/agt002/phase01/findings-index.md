# AGT002 Phase 01 — Findings Index

Every normative fact and gap produced by the Phase 01 live-schema sweep,
each listed exactly once with a durable locator. Facts are drawn from
`contracts/agt002-phase01/v1/binding-registry.json`; gaps are drawn from
that same registry plus `contracts/agt002-phase01/v1/fixtures/contexts.json`.
See [binding-inventory.md](./binding-inventory.md) for the narrative
write-up and [gate-catalog.md](./gate-catalog.md) for how gates consume
these findings.

## Facts

- **AGT002-P1-FACT-0001** — `psi_public_tenders.converted_opportunity_id`
  is a live column that references `psi_sales_opportunities(id)` with
  `on delete set null`.
  Locator: `migration://supabase/migrations/005_public_tenders_radar.sql:27`.

- **AGT002-P1-FACT-0002** — A partial unique index,
  `psi_public_tenders_converted_opportunity_id_unique`, enforces at most
  one tender per converted opportunity.
  Locator: `migration://supabase/migrations/018_tender_tracking_rpc.sql:42-44`.

- **AGT002-P1-FACT-0003** — `psi_public_tenders.internal_status` is
  constrained to `('nueva','en_revision','descartada','convertida_oportunidad')`,
  the tender-side lifecycle state machine.
  Locator: `migration://supabase/migrations/005_public_tenders_radar.sql:26`.

- **AGT002-P1-FACT-0004** — The go/no-go workflow constrains its outcome
  column to `('presentada','adjudicada','no_adjudicada','cerrada_no_go')`.
  Locator: `migration://supabase/migrations/022_tender_go_no_go_workflow.sql:42-48`.

- **AGT002-P1-FACT-0005** — The tender tracking RPC filters on
  `stage_code = 'descartado'` as a discard stage.
  Locator: `migration://supabase/migrations/018_tender_tracking_rpc.sql:427`.

- **AGT002-P1-FACT-0006** — The opportunity primary-stage filter treats
  `('cerrada_no_go','adjudicada','no_adjudicada')` as closed stages.
  Locator: `migration://supabase/migrations/088_tender_opportunity_primary_stage_filters.sql:48`.

- **AGT002-P1-FACT-0007** — The go/no-go workflow's identity column is
  constrained to `identity_type is null or identity_type in ('human','agent')`,
  with no third `entity_l` identity kind live.
  Locator: `migration://supabase/migrations/022_tender_go_no_go_workflow.sql:38-41`.

- **AGT002-P1-FACT-0008** — The profile/area permissions table enumerates
  roles as `('admin','gerencia','director','comercial','colaborador','junta')`.
  Locator: `migration://supabase/migrations/019_profile_area_permissions.sql:23`.

- **AGT002-P1-FACT-0009** — The profile/area permissions grant table keys
  on `primary key (profile_id, permission_code)`.
  Locator: `migration://supabase/migrations/019_profile_area_permissions.sql:144-150`.

- **AGT002-P1-FACT-0010** — The permission-code catalog table keys on
  `code text primary key`.
  Locator: `migration://supabase/migrations/019_profile_area_permissions.sql:119-125`.

- **AGT002-P1-FACT-0011** — The table `psi_agt002_radar_gate_evaluations`
  exists live as the AGT002 radar gate's own evaluation-evidence store.
  Locator: `migration://supabase/migrations/071_agt002_radar_gate.sql:4`.

## Gaps

- **AGT002-P1-GAP-0001** — No live column, table, or view instantiates a
  first-class `entity_l` identity (logical term A); the binding is
  `absent_live` with `table`/`column`/`unique_constraint`/`live_endpoint`
  all null.
  Locator: `contracts/agt002-phase01/v1/binding-registry.json#/bindings/1`
  (`binding_id: BIND-ENTITY-L`).

- **AGT002-P1-GAP-0002** — No live forward foreign key column exists on
  `psi_sales_opportunities.tender_id` (logical term B, forward direction);
  only the inverse column covered by FACT-0001/0002 exists live.
  Locator: `contracts/agt002-phase01/v1/binding-registry.json#/bindings/2`
  (`binding_id: BIND-OPPORTUNITY-TENDER-ID-FORWARD`).

- **AGT002-P1-GAP-0003** — No live gate consumption ledger store: the
  `gate-consumed-no-ledger` fixture context declares a `CONSUMED` gate
  scenario with no `consumption_ledger` array to reconcile receipts
  against.
  Locator: `contracts/agt002-phase01/v1/fixtures/contexts.json#/gate-consumed-no-ledger`.

- **AGT002-P1-GAP-0004** — No live authority registry schema: the
  `authority-registry-schema-absent` fixture context omits
  `authority_registry_schema_ref`, whereas every registry-dependent context
  must point it at
  `contracts/agt002-phase01/v1/authority-registry.schema.json`; the
  resulting absence is effective, so `AUTHORITY_DELEGATION` grants cannot
  be resolved against a live store in that scenario and evaluation yields
  `UNVERIFIED`.
  Locator: `contracts/agt002-phase01/v1/fixtures/contexts.json#/authority-registry-schema-absent`.
