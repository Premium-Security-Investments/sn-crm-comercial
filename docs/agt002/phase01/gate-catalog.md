# AGT002 Phase 01 — Gate Catalog

This catalog documents every `type` enum value declared in
`contracts/agt002-phase01/v1/gate.schema.json`. Each section below is
normative for that gate type and declares which skill-contract clause(s)
of `/root/.hermes/skills/playbooks/agt002-licitaciones/SKILL.md` (lines
105-111) govern its minimum acceptance bar. The skill file itself is not
modified by this documentation.

Two skill-contract ids are referenced across this catalog:

- `skill-contract:section-6.contract-minimum` — maps to the first of the
  two existing clauses at SKILL.md lines 105-111: every gate must carry a
  populated `objective`, at least one `preconditions` entry with a
  `verdict`, at least one `evidence` entry, and a `consumption_policy`
  with `max_consumptions=1` and `receipt_required=true` before it can be
  treated as consumable.
- `skill-contract:section-6.mechanical-link-proof` — maps to the second
  of the two existing clauses at SKILL.md lines 105-111: gates that
  assert a tender-to-opportunity link must additionally carry mechanical,
  non-narrative proof (an authoritative, exhaustive, single-row query
  observation) before the link can be treated as valid.

## PHASE_AUDIT

Issued when a phase-scoped audit (such as this Phase 01 sweep) needs a
consumable authorization record proving the audit ran under a real grant
rather than an implicit assumption of permission.

skill-contract:section-6.contract-minimum

## LINK_VERIFICATION

Issued when the tender→opportunity binding (`BIND-TENDER-OPPORTUNITY-INVERSE`,
see [binding-inventory.md](./binding-inventory.md)) is being asserted as a
valid mechanical link for a specific `(source_id, target_id)` pair. Because
this gate type underwrites a vínculo/conversión claim, it carries the
mechanical-link-proof clause in addition to the baseline contract minimum:
the observation backing it must be authoritative, exhaustive
(`query.truncated=false`), and resolve to exactly one row before the claim
can be treated as valid.

skill-contract:section-6.contract-minimum
skill-contract:section-6.mechanical-link-proof

## AUTHORITY_DELEGATION

Issued when a principal delegates a grant to another principal. The gate's
`authority.delegation` block must resolve against a live authority
registry (see GAP-0004 in [findings-index.md](./findings-index.md) for the
case where that registry's schema is unavailable at evaluation time).

skill-contract:section-6.contract-minimum

## STORAGE_DESIGN_REVIEW

Issued when a proposed storage change (a new table, column, or constraint)
needs sign-off before it is applied to the live schema documented in
[binding-inventory.md](./binding-inventory.md).

skill-contract:section-6.contract-minimum

## PRODUCTION_ACTION

Issued when an action executes against the `production` environment
rather than `isolated_fixture`. It is the highest-risk gate type and is
therefore held to the same non-negotiable contract minimum as every other
gate type, with no relaxation for urgency.

skill-contract:section-6.contract-minimum
