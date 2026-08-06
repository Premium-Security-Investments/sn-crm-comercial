# AGT-002 v3 Synthetic UI Preview Implementation Plan

> **For Hermes:** Execute directly with strict RED → GREEN → REFACTOR and one review for the completed block.

**Goal:** Build and deploy an isolated, read-only AGT-002 v3 synthetic preview at `#/tenders?preview=agt002-v3`.

**Architecture:** `TendersModule` recognizes the explicit preview query and renders one self-contained React component. The component owns a closed synthetic fixture and local selection state. A dedicated stylesheet prevents changes to existing tender screens.

**Tech Stack:** React 19, TypeScript, CSS, Node test runner, Vite, Playwright, Vercel CLI.

---

### Task 1: Lock the preview contract with a failing static test

**Files:**
- Create: `tests/agt002-v3-synthetic-preview-ui.test.mjs`

Write assertions for the hidden route hook, required safety labels, ordered phases, five axes, commercial/legal panels, local selection, and absence of network/write controls. Run the focused test and confirm it fails because the component does not exist.

### Task 2: Add the synthetic preview component

**Files:**
- Create: `src/tenders/components/TenderAnalysisV3Preview.tsx`
- Create: `src/tenders/components/tender-analysis-v3-preview.css`
- Modify: `src/tenders/TendersModule.tsx`

Implement the smallest read-only component that satisfies Task 1. Use semantic buttons only for local requirement selection; no decision buttons, forms, inputs, API clients, or fetch calls. Run the focused test until green.

### Task 3: Verify integration and regressions

Run:

```bash
node --test tests/agt002-v3-synthetic-preview-ui.test.mjs
npm run build
node --test --test-concurrency=1 tests/agt002-*.test.mjs tests/tender-*.test.mjs
npm run check:backend-parity
npm audit --omit=dev
git diff --check
```

Expected: focused test, build, relevant regressions, parity, audit, and diff check pass. Any known baseline failure must be reproduced against `origin/main` before being classified as baseline.

### Task 4: Browser QA

Run the Vite preview locally. Open the hidden route with Playwright at desktop and mobile widths. Verify visual hierarchy, selection behavior, overflow, safety labels, no console errors, and no preview-specific network writes. Capture a screenshot.

### Task 5: Commit and deploy isolated preview

Commit only the preview documents, test, component, CSS, and route hook. Deploy the current branch directory to Vercel as a preview of the existing `seguridad-nacional-crm` project, never with `--prod`. Verify the public URL returns HTTP 200 and the hidden route loads after authentication. Do not apply migration 063 and do not alter production aliases.
