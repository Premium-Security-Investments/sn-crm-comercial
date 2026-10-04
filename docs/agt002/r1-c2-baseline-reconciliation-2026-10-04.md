# AGT-002 R1 — C2 baseline reconciliation

**Cut:** 2026-10-04  
**Code baseline:** `origin/main@7cabe31dbb9454b1424c2c6533458da1a4e5a99e`  
**Status:** `C2_BASELINE_RECONCILED_TRANSPORT_PENDING`  
**Boundary:** read-only/local reconciliation; no R1 implementation, migration, deployment, provider
call or job retry

## 1. Sources reconciled

1. Design commit `2d5ca058f0bd86c710e7a62ebc86a640b6abb610`, whose only change is
   `docs/superpowers/specs/2026-10-02-agt002-incremental-reanalysis-triggers-design.md`.
2. V3/V4 recovery baseline `7e404a137b70d4ed1d741399853df040f2950eb6`, including parent
   `681add7` for conservative legal-abstention normalization and `7e404a1` for tokenless semantic
   retrieval.
3. Integrated INITIAL and Cali recovery baseline in current `origin/main`, including PRs #281 and
   #282.
4. Terminal Cali generation-2 evidence and the isolated assembly regression receipt.

The design commit is documentation only and was never merged into the current repository lineage.
The V3/V4 commits live in their recovery worktree lineage rather than as ancestors of current main,
so reconciliation is based on exact file behavior and subsequent integrated fixes, not on commit
ancestry alone.

## 2. Code reconciliation result

| Surface | V3/V4 source | Current main disposition |
| --- | --- | --- |
| Durable reanalysis worker | `agt002-reanalysis-worker.js` at `7e404a1` | Byte-identical; SHA-256 `9bc3a37a9321f631f5148ef16073a301a5b75bc631f80f18820d2e505cde9b6a` |
| Legal batch normalization | `681add7` | Superseded by integrated `05f0001`, which applies the conservative legal normalization before shared validation and preserves fail-closed basis checks |
| Tokenless semantic retrieval | `7e404a1` whole-label fallback | Subsumed by integrated `9a4777c` numeric anchors plus `520f6bf` normalized whole-label fallback and NBSP-safe retrieval |
| Resumed-attempt ledger | not closed in `7e404a1` | Integrated `cea62ca` reconciles resumed attempt lifecycle |
| Checkpoint generations | older generation behavior | Integrated `641dd4d`, migration `097`, reserved migration `098` and `05f0001` preserve generation isolation and generation-2 legal parity |
| Preview/executor/input | V3/V4 recovery versions | Current files intentionally differ because they include the later recovery, classification and INITIAL-safe changes; none reverts the V3/V4 invariants above |

The correct code baseline for R1 is therefore current `origin/main`, not a checkout or merge of
`7e404a1`. Cherry-picking that recovery branch would regress later integrated behavior.

## 3. Design reconciliation result

The functional core of `2d5ca05` remains the C3 starting point:

- converted opportunities only;
- trusted, attributable events only;
- uncertain source/identity becomes durable pending state with zero AI work;
- one durable change set per opportunity/source transaction or official source batch;
- events arriving during an active job form the next set without parallel execution or loss;
- delta-only provider input with immutable references to affected prior findings;
- append-only successor run, atomic canonical promotion and readable predecessor;
- no GO/NO-GO, signature, sending, publication or external commercial action;
- event-directed dispatch and no continuously polling timer.

The following parts are stale and must not be copied into implementation:

1. `097_agt002_incremental_reanalysis_triggers.sql` is no longer available. Migrations `097` and
   `098` are Cali recovery slots and `099`–`104` belong to INITIAL. The next additive R1 migration is
   `105` unless another migration is integrated first.
2. The design baseline `223a085` predates checkpoint recovery, INITIAL and the C1A release controls.
   R1 must bind to the accepted INITIAL canonical identity and may never manufacture the first run.
3. The old response-human path that freezes all `currentDocs` is not an acceptable R1 input path;
   only its durable job/fencing/promotion mechanisms may be reused.
4. The existing reanalysis timer remains off. Any recovery wake must be conditional, bounded and
   separately evidenced; no 30-second polling is restored.
5. The exact affected-finding closure and precedence between a human full-reanalysis request and an
   event-driven delta still belong to the C3 contract freeze. The safe working default is that a
   full reanalysis is a separate explicit human operation and never silently absorbs or discards a
   durable delta event.

## 4. Transport/provider disposition

The original `AGT002_PROVIDER_ERROR` was traced to the dedicated bridge OAuth session and was
followed by a successful synthetic probe. Cali generation 2 subsequently completed all 54 semantic
discovery units, which proves that its provider/transport path did execute after that recovery. Its
terminal failure was later, at discovered-input assembly, with zero canonical persistence.

The generalized tokenless/whitespace assembly defect is now fixed and integrated. This does not
establish current provider health: the 2026-10-04 environment cannot resolve the production
Supabase/control-plane hosts, so neither a fresh synthetic transport probe nor the exact production
manifest readback has succeeded. No retry is permitted on the strength of historical health alone.

## 5. C2 gate

The single code baseline and required design corrections are reconciled. C2 remains open only on its
transport/readback leg. It may close when, after C1A deployment preconditions are met:

1. current worker, bridge and application release identities are read back;
2. a bounded synthetic/no-business-data probe proves the approved provider path;
3. the exact Cali manifest/checkpoint is readable or the new correction's production behavior is
   otherwise demonstrated before consuming the one authorized retry;
4. timer and broad queue processing remain off.

Until then this document emits no `AGT002_INCREMENTAL_DESIGN_RECONCILED` and authorizes no C4 code.

