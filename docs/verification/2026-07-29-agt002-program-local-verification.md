# AGT-002 Vig-IA analysis improvement program — full local verification

**Verification date (UTC):** 2026-07-30  
**Branch:** `plan/agt002-vigia-analysis-improvements`  
**Program baseline commit:** `5121149` (`docs(agt002): record analysis improvement baseline`)  
**Implementation commit verified:** `97af199e1e41f52dc55f31883577a7a6c81789ea` (`feat(agt002): add safe analysis observability`)  
**Execution discipline:** all checks ran sequentially; every Node test command used `--test-concurrency=1`; no Vite server, Claude worker, TypeScript process, build, or test command overlapped.

## Mechanical gate summary

| Gate | UTC start → end | Exit | Result |
|---|---|---:|---|
| B0 and E1–E6 focused suites | 17:15:00 → 17:15:02 | 0 | 45/45 pass |
| Migration 049–053 apply/rollback coverage | 17:15:02 → 17:16:01 | 0 | 10/10 pass |
| Legal corpus manifest validation | 17:16:01 → 17:16:01 | 0 | 1/1 pass |
| Human-only authority | 17:16:01 → 17:16:01 | 0 | 2/2 pass |
| Lifecycle and reanalysis | 17:16:01 → 17:16:16 | 0 | 3/3 pass |
| Backend parity | 17:16:16 → 17:16:16 | 0 | `backend parity OK` |
| TypeScript | 17:16:16 → 17:16:22 | 0 | clean (`npx tsc --noEmit`) |
| Production build | 17:16:22 → 17:16:29 | 0 | Vite built successfully; existing chunk-size warning only |
| `git diff --check` | 17:16:29 → 17:16:29 | 0 | clean |
| Full regression | 17:16:29 → 17:22:22 | 1 | 294 total; 293 pass; 1 classified baseline failure |
| Diff stat / commits / Git status capture | 17:22:22 → 17:22:23 | 0 each | captured successfully |

All timestamps above are on `2026-07-30` UTC. The cgroup memory guard was checked before every command; no command began above 5 GiB.

## Exact commands

### Focused B0 and E1–E6 suites

```bash
node --test --test-concurrency=1 \
  tests/agt002-analysis-config-wiring.test.mjs \
  tests/agt002-analysis-config.test.mjs \
  tests/agt002-analysis-observability.test.mjs \
  tests/agt002-company-dossier.test.mjs \
  tests/agt002-context-v2.test.mjs \
  tests/agt002-document-chunks.test.mjs \
  tests/agt002-document-retrieval.test.mjs \
  tests/agt002-evidence-coverage-ui.test.mjs \
  tests/agt002-legal-corpus.test.mjs \
  tests/agt002-legal-findings-ui.test.mjs \
  tests/agt002-legal-retrieval.test.mjs \
  tests/agt002-objective-validations.test.mjs \
  tests/agt002-opportunity-context-v2.test.mjs \
  tests/agt002-preview-contract.test.mjs \
  tests/agt002-preview-engine.test.mjs \
  tests/agt002-preview-input.test.mjs \
  tests/agt002-preview-persistence.test.mjs \
  tests/agt002-preview-runtime.test.mjs \
  tests/agt002-preview-surface.test.mjs \
  tests/agt002-requirement-evidence.test.mjs \
  tests/agt002-tender-adapter.test.mjs \
  tests/agt002-workbench-context.test.mjs \
  tests/tender-analysis-rules-registration.test.mjs \
  tests/tender-guided-workspace-ui.test.mjs \
  tests/tender-processing-chunking-wiring-static.test.mjs \
  tests/tender-processing-chunking.integration.test.mjs \
  tests/tender-processing-dispatch.test.mjs \
  tests/tender-processing-drain.test.mjs \
  tests/tender-processing-e1-wiring.test.mjs \
  tests/tender-processing-ui-status.test.mjs \
  tests/tender-processing-worker-rpc.test.mjs \
  tests/tender-processing-worker.test.mjs \
  tests/tender-vigia-language.test.mjs \
  tests/tenders-static.test.mjs
```

Exit `0`; TAP: 45 tests, 45 pass, 0 fail.

### Migrations 049–053 and rollbacks

```bash
node --test --test-concurrency=1 \
  tests/tender-processing-rpc-pglite.integration.test.mjs \
  tests/agt002-canonical-analysis-pglite.integration.test.mjs \
  tests/agt002-canonical-analysis-protection.test.mjs \
  tests/agt002-canonical-analysis-rollback-safety.test.mjs \
  tests/agt002-context-versions-pglite.integration.test.mjs \
  tests/agt002-context-versions-rollback-safety.test.mjs \
  tests/tender-document-chunks-pglite.integration.test.mjs \
  tests/tender-document-chunks-rollback-safety.test.mjs \
  tests/agt002-legal-corpus-pglite.integration.test.mjs \
  tests/agt002-legal-corpus-rollback-safety.test.mjs
```

Exit `0`; TAP: 10 tests, 10 pass, 0 fail. This covers local PGlite apply behavior and rollback safety for migrations 049, 050, 051, 052, and 053.

### Legal manifest

```bash
node --test --test-concurrency=1 tests/agt002-legal-corpus-manifest.test.mjs
```

Exit `0`; TAP: 1 test, 1 pass. The test invokes `validateAgt002LegalManifest`, validates the real manifest end to end, enforces official-host allowlisting and unique/version-consistent sources, and confirms uncertain sources require human legal review/abstention.

### Human authority

```bash
node --test --test-concurrency=1 tests/agt002-human-authority-static.test.mjs tests/agt002-human-authority-dynamic.test.mjs
```

Exit `0`; TAP: 2 tests, 2 pass. No AI path decides GO/NO-GO, approves, signs, sends, or submits.

### Lifecycle and reanalysis

```bash
node --test --test-concurrency=1 tests/agt002-vigia-lifecycle-pglite.integration.test.mjs tests/agt002-human-evidence-reanalysis.test.mjs tests/agt002-human-answer-reanalysis-static.test.mjs
```

Exit `0`; TAP: 3 tests, 3 pass. Canonical lifecycle, versioned human evidence, append-only reanalysis, and server/mirror wiring are covered.

### Cross-cutting checks

```bash
npm run check:backend-parity
npx tsc --noEmit
npm run build
git diff --check
```

All four commands exited `0`. Backend result was exactly `backend parity OK`. Build transformed 117 modules and completed successfully; the only warning was the pre-existing advisory that one generated chunk exceeds 500 kB.

### Full regression

```bash
node --test --test-concurrency=1 tests/*.test.mjs
```

Exit `1`; TAP: 294 tests, 293 pass, 1 fail. The only failure is:

- `tests/tender-radar-relevance.test.mjs`
- `ReferenceError: tenderContextualPhysicalSecurityReason is not defined`

## Baseline comparison

The initial baseline at `5121149` recorded 246 tests, 245 pass, and the same single failure in `tests/tender-radar-relevance.test.mjs`. The final regression adds 48 tests while preserving the exact failure identity and error. No program commit from `5121149..97af199` changes `tests/tender-radar-relevance.test.mjs` or a `*tender*relevance*` source file. Therefore the final result has **no new regression** and the one failure remains classified as baseline/out of scope under the explicit Task 40 rule.

## Git evidence

Commands:

```bash
git diff --stat 5121149..HEAD
git log --oneline 5121149..HEAD
git status --short --branch
```

All exited `0`. At verification capture, HEAD was `97af199e1e41f52dc55f31883577a7a6c81789ea`; the branch was 37 commits ahead of `origin/main`; the working tree was clean.

## Gate conclusion

The local mechanical gate is clean relative to the accepted baseline: all focused, migration/rollback, legal, authority, lifecycle, backend parity, TypeScript, build, and whitespace checks pass; the full regression contains only the explicitly allowed unchanged baseline failure. No remote operation, production migration, flag activation, push, PR, merge, deploy, or Task 42 work was performed.
