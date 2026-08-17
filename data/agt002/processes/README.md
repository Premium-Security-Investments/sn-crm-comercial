# AGT-002 process packages

This directory holds the **process packages** that the fail-closed integral-manifest registry
(`agt002-integral-manifest-source.js`) keys off. A process package is a closed, human-authored
descriptor that binds one tender process — identified by `(opportunity_id, proceso)` — to its
checked-in integral manifest, and records the governance facts required to enable it for the
AGT-002 V3 integral contract.

> A package **grants nothing on its own**. It is a descriptor. Whether a process is actually
> enabled is decided by the onboarding gate (`agt002-process-onboarding-gate.js`) over the
> package's fields, and the process must additionally be present in the server-owned explicit
> allowlist wired in code. Enabling a new process is therefore a deliberate, reviewable act — it
> is never achieved by copying Manizales.

## Files

- `_template/process.package.template.json` — the starting point for a new process. It is a
  **valid descriptor but is REJECTED by default**: `human_approval.approved` is `false`,
  `enablement.explicitly_enabled` is `false`, and every onboarding checklist item is `passed:
  false`. Copying it verbatim yields a process that cannot run until a human fills it in.

The Manizales pilot package is defined in code (`AGT002_MANIZALES_PROCESS_PACKAGE` in
`agt002-manizales-manifest-source.js`) alongside its manifest source, and is the **only**
registered process today.

## Schema

The descriptor shape is validated by `validateAgt002ProcessPackage`
(`agt002-process-package.js`) and mirrored by the JSON Schema at
`contracts/agents/AGT-002/v3/process-package.schema.json`. Required top-level keys:

| key | meaning |
|---|---|
| `schema_version` | must equal `agt002-process-package@1` |
| `opportunity_id` | UUID of the opportunity |
| `proceso` | process identifier (e.g. the tender `ref`) |
| `manifest_ref` | `{ artifact_type, contract_version, path }` pointing at the checked-in manifest |
| `human_approval` | `{ required:true, approved, approver, approved_at }` — the explicit human sign-off |
| `onboarding_gate` | `{ checklist: [{ id, passed }] }` — every required id must pass |
| `enablement` | `{ flag, explicitly_enabled }` — the explicit server-owned enablement record |

## Enabling a new process (summary)

1. Produce and validate the integral manifest for the process (its own validator + provenance).
2. Copy `_template/process.package.template.json`, fill in identity, `manifest_ref`, and flip the
   checklist items to `passed: true` only as each is genuinely satisfied.
3. Obtain and record the human approval (`human_approval.approved: true`, approver, timestamp).
4. Set `enablement.explicitly_enabled: true` **and** add the `proceso` to the server-owned
   allowlist in code, then register it in the registry.

Every one of these is required; the gate fails closed if any is missing. See the runbooks under
`docs/runbooks/` for the full onboarding, canary, human-review and rollback procedure.
