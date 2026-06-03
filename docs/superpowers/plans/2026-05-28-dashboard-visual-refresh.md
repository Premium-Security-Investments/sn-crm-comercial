# Dashboard Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the Seguridad Nacional commercial dashboard so it reads as a polished executive dashboard while preserving the current CRM functionality and data model.

**Architecture:** Keep the existing React/Vite single-page app and Express/Vercel API. Make focused UI changes in `src/main.tsx` and `src/styles.css`: visual hierarchy, semantic KPI styling, clearer pipeline rows, better empty states, and table readability.

**Tech Stack:** React, TypeScript, Vite, CSS, Vercel.

---

### Task 1: Improve dashboard content hierarchy

**Files:**
- Modify: `src/main.tsx`

- [ ] Add KPI metadata: icon, semantic tone, and clearer descriptions for active opportunities, total pipeline, weighted pipeline, approved revenue, and stalled sustentation.
- [ ] Add a compact `ExecutiveSummary` block above the main dashboard sections with data freshness and focus for gerencia.
- [ ] Update `Kpi` component signature to accept `icon`, `tone`, and optional `meta` text.
- [ ] Preserve all current API data fields and routes.

Verification:
```bash
npm run build
```
Expected: TypeScript and Vite build pass.

### Task 2: Improve visual styling system

**Files:**
- Modify: `src/styles.css`

- [ ] Add executive dashboard background gradients and section spacing.
- [ ] Add KPI card accent colors by tone: blue, purple, green, amber.
- [ ] Add stronger typography scale and tabular numeric alignment.
- [ ] Add better empty-state card styling.
- [ ] Add responsive behavior for desktop, tablet, and mobile.

Verification:
```bash
npm run build
```
Expected: CSS bundles successfully and layout remains responsive.

### Task 3: Improve pipeline and tables readability

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

- [ ] Add stage tone classes to badges and pipeline rows.
- [ ] Add percentage-of-pipeline context to stage bars.
- [ ] Improve mini tables with value alignment and readable row separation.
- [ ] Replace empty alert text with a positive state when no stalled opportunities exist.

Verification:
```bash
npm run build
```
Expected: Build passes and browser visually shows improved readability.

### Task 4: Deploy and verify production

**Files:**
- No source change unless verification finds visual issues.

- [ ] Deploy with `vercel deploy --prod --yes`.
- [ ] Verify `https://seguridad-nacional-crm.vercel.app` in browser.
- [ ] Confirm sidebar brand remains `Seguridad Nacional Ltda / Dashboard Comercial`.
- [ ] Confirm KPIs, pipeline, top opportunities, and alert empty state are readable.

Verification:
```bash
npm run build
vercel deploy --prod --yes
```
Expected: Production alias updates successfully and dashboard renders without console errors.
