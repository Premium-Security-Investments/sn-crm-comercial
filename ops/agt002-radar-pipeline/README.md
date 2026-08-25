# AGT-002 Radar pipeline

One-shot, durable Radar preanalysis producer. The checked-in environment keeps `AGT002_RADAR_GATE=false`; in that state the runner returns a disabled result without database queries, queue changes, or provider calls.

The unit and timer are deployment artifacts only. Installing or enabling the timer requires an **autorización separada** after migrations 071/072, dry-run evidence, budget review, and rollback rehearsal have been accepted.

## Operational contract

- One invocation evaluates one bounded tender page and claims at most one job.
- Learning is read-only, candidate-specific, and bounded.
- Terminal outcomes are persisted through security-definer RPCs.
- There are no internal retries or continuous loops.
- `AGT002_RADAR_VISIBILITY` must remain false until ledger coverage is explicitly approved.

Copy `env.example` to the protected environment-file location and populate secrets outside version control. Do not store service credentials in this directory.
