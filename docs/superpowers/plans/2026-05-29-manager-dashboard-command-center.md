# Manager Dashboard Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Seguridad Nacional manager dashboard from table-heavy reporting into a visual B+C command-center / CEO dashboard.

**Architecture:** Keep the current single-file React SPA pattern in `src/main.tsx`, adding focused helper computations and visual sections inside `ManagerDashboard`. Replace the Excel-like commercial and monthly tables with scorecards, a true visual funnel, executive insights, and monthly comparison bars. Add CSS in `src/styles.css` using existing class patterns and static tests to prevent regression.

**Tech Stack:** React + TypeScript, Vite, CSS, Node static tests, Vercel deployment.

---

### Task 1: Static regression test

**Files:**
- Create: `/root/psi-comercial/plataforma-ventas/app/tests/manager-command-center-static.test.mjs`

- [ ] Write a Node test that verifies new class markers and no old table titles remain as primary sections.
- [ ] Run the test and expect it to fail before implementation.

### Task 2: React dashboard redesign

**Files:**
- Modify: `/root/psi-comercial/plataforma-ventas/app/src/main.tsx`

- [ ] Add derived values inside `ManagerDashboard`: concentration, risk alerts, monthly owner summary, performance status.
- [ ] Replace the current `Embudo comercial por etapas`, `Tabla ejecutiva por comercial`, and `KPIs mensuales recientes` sections with:
  - `command-center-hero`
  - `visual-funnel`
  - `commercial-scorecards`
  - `manager-action-panel`
  - `monthly-bars`
- [ ] Preserve links to `#/consultant/:id`, COP in millions, and existing data source.

### Task 3: Visual CSS

**Files:**
- Modify: `/root/psi-comercial/plataforma-ventas/app/src/styles.css`

- [ ] Add command-center visual system classes.
- [ ] Ensure responsive layouts collapse cleanly under 1240px and 640px.
- [ ] Keep existing app/sidebar styles unchanged.

### Task 4: Verify and deploy

**Files:**
- Use existing tests and build.

- [ ] Run: `node tests/manager-command-center-static.test.mjs && node tests/feedback-fixes-static.test.mjs && node tests/goals-compliance-static.test.mjs && node tests/consultant-detail-static.test.mjs && npm run build`
- [ ] Deploy: `vercel deploy --prod --yes`
- [ ] Verify production with browser screenshot and console.
