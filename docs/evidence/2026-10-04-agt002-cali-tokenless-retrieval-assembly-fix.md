# AGT-002 Cali — tokenless semantic retrieval assembly fix

**Date:** 2026-10-04  
**Branch:** `feat/agt002-c1a-r1-program-20261004`  
**Baseline:** `origin/main@c06786d7f551b352694fc1f3e501b5603fa8c47d`  
**Environment:** isolated local worktree; no production write, provider call, deployment, service
restart or job retry  
**Verdict:** `VERIFIED_ISOLATED`; production deployment and exact Cali confirmation remain pending

## Observed boundary

The Cali generation-2 job ended fail-closed with
`validation_code=v4_discovered_input_assembly_failed` after persisting 53 semantic-discovery
checkpoints and one final manifest, but before creating any plan, integral checkpoint or canonical
analysis run. The available environment could not read the live checkpoint payload because its
production network path was unavailable, so this receipt does not claim that the exact Cali label
has been recovered.

Local diagnosis reproduced the same assembly failure class: a valid source-grounded semantic label
can contain no alphanumeric token of at least three characters and no two-digit number. The previous
projection returned an empty retrieval-term list for that accepted requirement. The downstream
Preview input then had no retrievable frontier and could reject the run after discovery.

## Change

- `tenderSemanticRetrievalTerms` still prefers its bounded alphanumeric terms.
- When an accepted non-empty label has no such term, it now preserves the complete normalized source
  phrase as one fallback term. It does not invent keywords and does not fall back to the historical
  requirement catalog.
- Retrieval normalization now collapses Unicode whitespace, including NBSP, to ordinary spaces so
  the exact phrase remains searchable across PDF text variants.
- The regression uses only synthetic content. A `°C`/`°F` label with NBSP must produce one term,
  retrieve its source chunk, assemble a complete Preview packet and reach the analysis provider
  without emitting `v4_discovered_input_assembly_failed`.

## TDD and verification

The new regression was first observed RED with expected `['°c a °f']` and actual `[]`. After the
change:

- tokenless semantic regression: PASS;
- eight focused retrieval, manifest, discovery, Preview-input and Preview-engine suites: PASS;
- broader related selection: 42 PASS; three process/socket tests were blocked by this sandbox's
  `spawn`/`listen EPERM` policy;
- backend parity: PASS;
- direct TypeScript check and Vite production build: PASS (150 modules transformed);
- whole-repository suite: 719 PASS / 48 FAIL / 767 total. No failing test exercises either changed
  production module or the new regression; observed failures are outside this change and include
  sandbox socket/process restrictions plus inherited structural-state checks.
- `git diff --check`: PASS.

The composite `npm run build` reached the repository's pre-build deployment-safety test and was
blocked when that test attempted a forbidden child process. Running its compile and bundle stages
directly succeeded.

## Operational disposition

This closes the generalized local defect consistent with the terminal Cali evidence, not the exact
production diagnosis. Before the single authorized Cali recovery can run, the reviewed commit must
be deployed, its worker and control-plane SHA/configuration read back with timer and flags off, and
the live case must be rechecked. If the exact production manifest shows a different cause, the
program stops before retry and returns to diagnosis.

