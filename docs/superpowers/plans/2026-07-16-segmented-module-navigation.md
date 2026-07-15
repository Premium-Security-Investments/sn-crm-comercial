# Segmented Module Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stacked internal navigation in SIIO and Licitaciones with a full-width four-segment control, preserving the sidebar and placing Licitaciones navigation below each contextual header.

**Architecture:** Both navigation components retain their semantic classes and add `module-segmented-nav` for one shared visual contract. `TendersModule` creates the navigation element and passes it to the active view, which renders it immediately after its header; SIIO keeps its existing banner → navigation order.

**Tech Stack:** React 19, TypeScript, CSS, Node static contract tests, Playwright authenticated QA.

## Global Constraints

- Do not modify sidebar labels, routes, permissions or order.
- Keep four internal views in each module.
- Desktop and mobile use one row with four equal columns.
- No document-level horizontal overflow.
- Preserve `aria-current="page"` and visible keyboard focus.
- Do not add dependencies or API calls.

---

### Task 1: Segmented navigation contract and implementation

**Files:**
- Create: `tests/segmented-module-navigation.test.mjs`
- Modify: `src/siio/SiioNavigation.tsx`
- Modify: `src/siio/siio.css`
- Modify: `src/tenders/components/TenderModuleTabs.tsx`
- Modify: `src/tenders/TendersModule.tsx`
- Modify: `src/tenders/TenderRadarView.tsx`
- Modify: `src/tenders/TenderTrackingView.tsx`
- Modify: `src/tenders/TenderDossiersView.tsx`
- Modify: `src/tenders/TenderProfilesView.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: existing `SiioView`, `TenderModuleView`, route callbacks and `aria-current` behavior.
- Produces: shared CSS class `module-segmented-nav`; view prop `moduleNavigation: ReactNode` used only for layout composition.

- [ ] **Step 1: Write the failing static contract test**

Create a Node test that reads the files above and asserts:

```js
assert.match(siioNavigation, /className="siio-navigation module-segmented-nav"/);
assert.match(tenderTabs, /className="tender-module-tabs module-segmented-nav"/);
assert.match(styles, /\.module-segmented-nav\{[^}]*display:grid[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/s);
assert.doesNotMatch(tendersModule, /<TenderModuleTabs[^>]*\/>\s*\{props\.view/);
for (const source of tenderViews) {
  assert.match(source, /<header[\s\S]*?<\/header>\s*\{moduleNavigation\}/);
}
```

Also assert each navigation component still defines four items and retains `aria-current`.

- [ ] **Step 2: Run RED**

Run: `node tests/segmented-module-navigation.test.mjs`

Expected: FAIL because `module-segmented-nav` and `moduleNavigation` do not exist.

- [ ] **Step 3: Implement semantic composition**

Add the shared class to both `<nav>` elements. In `TendersModule`, construct:

```tsx
const moduleNavigation = <TenderModuleTabs active={props.view} navigate={props.navigate} />;
```

Pass it to the active tender view. Extend each tender view's local props with:

```tsx
type TenderViewProps = TendersModuleProps & { moduleNavigation: ReactNode };
```

Render `{moduleNavigation}` immediately after the view's `<header>`.

- [ ] **Step 4: Implement the shared visual contract**

Add to `src/styles.css`:

```css
.module-segmented-nav{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  width:100%;
  gap:4px;
  padding:4px;
  border:1px solid #d5e2f5;
  border-radius:14px;
  background:#eef4fb;
  box-sizing:border-box;
}
.module-segmented-nav button{
  width:100%;
  min-width:0;
  min-height:42px;
  padding:9px 8px;
  border:1px solid transparent;
  border-radius:10px;
  background:transparent;
  color:#27456f;
  box-shadow:none;
  white-space:normal;
  line-height:1.2;
}
.module-segmented-nav button.active{
  border-color:#174ea6;
  background:#174ea6;
  color:#fff;
}
.module-segmented-nav button:focus-visible{
  outline:3px solid #60a5fa;
  outline-offset:2px;
}
@media(max-width:640px){
  .module-segmented-nav button{min-height:52px;padding:7px 4px;font-size:11px}
}
```

Remove SIIO declarations that conflict with the shared grid, while retaining its hover and focus behavior where compatible.

- [ ] **Step 5: Run GREEN and focused regressions**

Run:

```bash
node tests/segmented-module-navigation.test.mjs
node tests/tender-functional-views.test.mjs
node tests/siio-main-integration-static.test.mjs
npm run check:nav-permissions
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/segmented-module-navigation.test.mjs src/siio/SiioNavigation.tsx src/siio/siio.css src/tenders src/styles.css
git commit -m "style: compact module navigation into segments"
```

---

### Task 2: Authenticated visual and regression QA

**Files:**
- Create: `docs/qa/segmented-module-navigation/verification.md`
- Create: `docs/qa/segmented-module-navigation/siio-desktop.png`
- Create: `docs/qa/segmented-module-navigation/siio-mobile.png`
- Create: `docs/qa/segmented-module-navigation/tenders-desktop.png`
- Create: `docs/qa/segmented-module-navigation/tenders-mobile.png`

**Interfaces:**
- Consumes: authenticated manager and commercial QA sessions.
- Produces: visual evidence and a reproducible verification summary.

- [ ] **Step 1: Run the complete automated suite**

Run all `tests/*.test.mjs`, the three Python source-extractor tests, SIIO checkers, API/server parity and `npm run build`.

Expected: zero failures and a clean build.

- [ ] **Step 2: Run authenticated Playwright QA**

At 1440×900 and 390×844 verify:

```text
SIIO: banner precedes one-row four-segment navigation; active state follows route.
Licitaciones: contextual header precedes one-row four-segment navigation in all four views.
Sidebar: labels and available links match the pre-change baseline.
Responsive: scrollWidth <= clientWidth + 1.
Accessibility: Tab produces visible focus; aria-current identifies one active segment.
Network: no failed local API responses; navigation produces no writes.
```

Capture the four screenshots listed above.

- [ ] **Step 3: Review screenshots**

Reject and revise if buttons stack, labels clip, active state is ambiguous, the control dominates the banner, or mobile overflows.

- [ ] **Step 4: Write verification report and commit evidence**

```bash
git add docs/qa/segmented-module-navigation
git commit -m "test: verify segmented module navigation"
```

---

### Task 3: Integrate and deploy

**Files:** No new production files expected.

**Interfaces:**
- Consumes: verified feature branch.
- Produces: merged `main`, Vercel production deployment and authenticated smoke evidence.

- [ ] **Step 1: Merge the feature branch into `main`**

Use `--no-ff`, resolve only if necessary, then rerun the complete suite on the merge commit.

- [ ] **Step 2: Push and deploy the existing Vercel project**

Push `main`, link only to `jmb-maxs-projects/seguridad-nacional-crm`, and deploy with `vercel deploy --prod --yes`.

- [ ] **Step 3: Run production smoke**

Verify SIIO and all four Licitaciones routes for manager, commercial denial for SIIO, desktop/mobile layout, active segment, unchanged sidebar, zero API failures and zero navigation writes.

- [ ] **Step 4: Cleanup and handoff**

Destroy QA sessions and temporary credentials, stop previews, confirm clean Git tree, and report commit, deployment ID, URL, tests and evidence paths.
