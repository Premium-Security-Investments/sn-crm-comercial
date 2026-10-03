# AGT-002 Cali — numeric retrieval assembly failure and isolated fix

## Identity

- Date: 2026-10-03 UTC
- Production worker release: `cea62cad637cc97851d9f187eb550c804d6ffff3` (`f0-cea62ca`)
- Controlled unit: `agt002-cali-recovery-20261003b.service`
- Job: `ad4bb7c8-758d-4df8-b4a2-98d478211a3b`
- Opportunity: `5f65461c-f25a-45da-ba9f-82b59dd5d80d`
- Workset: `7c48e93d-de1c-46c7-8657-d5035744845c`
- Fix branch: `fix/agt002-cali-numeric-retrieval-terms`
- Fix baseline: `cea62cad637cc97851d9f187eb550c804d6ffff3`

## Controlled recovery result

The production preflight passed with the global worker timer disabled, no live worker process,
Cali first in queue, an expired Cali lease, an unpublished workset, no canonical analysis run and
the existing immutable checkpoint counts `53 semantic_discovery_batch + 1 semantic_manifest + 28
integral_analysis_batch`.

The one authorized recovery invocation reclaimed only Cali and recorded the expected resumed ledger
sequence:

```text
running -> retry_wait (AGT002_LEASE_LOST) -> queued -> running
```

It then stopped after approximately seven seconds at the local envelope boundary with:

```text
validation_code: v4_discovered_input_assembly_failed
error_code: AGT002_ENVELOPE_INVALID
bridge_invocation_started: false
bridge_response_received: false
persistence_attempts: 0
```

The worker therefore obeyed the stop-on-first-failure gate. It made no provider call and attempted
no canonical persistence.

## Production postcondition

- Cali is terminal `unavailable` with queue error `invalid_output` and `resume_count = 2`.
- `analysis_run_id` remains null and the canonical AGT-002 run count remains zero.
- The workset remains unpublished with `published_analysis_run_id = null`.
- All prior checkpoints remain unchanged and append-only.
- The other three jobs remain queued and unclaimed.
- The global worker timer remains disabled/inactive and no worker process remains live.

## Root cause

A read-only reproduction on the immutable release loaded the same frozen job, governed documents,
governed context version and semantic-manifest checkpoint without invoking a provider. Assembly
failed on exactly one of the manifest's 1,212 requirements:

```text
requirement_id: sreq:0a08724f00a982f21a87f30e22478264
label: °C a 35 °C (50 °F a 95 °F
```

The semantic-manifest contract accepted the source-anchored label, but retrieval terms required
every alphanumeric token to contain at least three characters. The label's meaningful anchors are
the two-digit values `35`, `50` and `95`; the remaining fragments are short articles or unit
symbols. Consequently the manifest was valid while its downstream retrieval projection was not.

A complete scan proved this was the only empty-term label in the 1,212-requirement manifest. A
two-or-more-digit numeric rule recovers that one label and leaves zero unresolved retrieval-term
projections.

## Isolated correction

- Preserve the existing minimum of three characters for alphabetic/alphanumeric terms.
- Additionally accept numeric tokens of at least two digits.
- Apply the same rule to the semantic-manifest and legacy Preview retrieval normalizers.
- Add a full structural-manifest regression using the exact Cali label.
- Replace embedded NUL bytes in `tender-semantic-manifest.js` with equivalent JavaScript `\x00`
  escapes and mark that source as text for auditable diffs; runtime separators are unchanged.

This does not rewrite a manifest, checkpoint, requirement identity or production row. It only makes
the already-valid, already-source-anchored numeric range retrievable.

## Verification

Focused suites passed:

```text
node --test \
  tests/agt002-preview-input.test.mjs \
  tests/agt002-document-retrieval.test.mjs \
  tests/agt002-tender-native-semantic-manifest-integration.test.mjs \
  tests/tender-semantic-manifest.test.mjs
```

Result: 4/4 test files passed. `git diff --check` also passed.

The broad repository run completed 732 test files: 632 passed and 100 failed for environment or
baseline reasons visible in the run (`listen EPERM`, missing optional `undici`/`jsdom`, denied child
processes and unrelated extraction/drift checks). The focused affected surface and the broader
semantic discovery, Preview engine, batched V3, checkpoint and persistence suites passed.

## Gate status

State reached: `verified_isolated`.

No retry, queue mutation, provider call, deployment or service restart is authorized by this
receipt. Because Cali is now terminal `unavailable`, a later production recovery requires all of:

1. review and integration of the correction;
2. exact Vercel and worker release identity readback;
3. read-only validation of the applicable governed recovery slot for this terminal failure;
4. a separately authorized single-job recovery with the timer still disabled and the same
   stop-on-first-failure rule.
