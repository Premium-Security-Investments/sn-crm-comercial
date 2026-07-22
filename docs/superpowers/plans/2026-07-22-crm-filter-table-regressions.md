# CRM Filter and Table Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore commercial, period, and customer-type filters and make the accumulated-sales table readable without changing CRM data or authorization rules.

**Architecture:** Keep the bootstrap profile DTO free of PII and access configuration by adding only a derived `is_commercial` boolean. Reuse the existing `DashboardPeriodFilter`, `matchesDashboardPeriod`, and `customerSegmentOptions` primitives in both views. Fix the table with semantic column order, explicit widths, and horizontal overflow rather than squeezing values.

**Tech Stack:** React 19, TypeScript, Express, Node static regression tests, CSS.

## Global Constraints

- Do not change roles, permissions, assignments, records, or database schema.
- Do not expose `microsoft_email`, `role`, `active`, permissions, or area assignments in bootstrap profile summaries.
- Every filter must affect all metrics and rows in its view and be reset by “Limpiar”.
- Preserve responsive behavior and use controlled horizontal scroll for wide tables.

---

### Task 1: Safe commercial profile summary

**Files:**
- Modify: `tests/task-4-review-regressions.test.mjs`
- Modify: `server/index.js`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: profile summaries `{ id, full_name, is_commercial }`.
- Consumes: canonical server-side `role` and `active` fields already present in the bootstrap query.

- [ ] Update the security regression to require `is_commercial` while still rejecting PII/access fields.
- [ ] Run `node tests/task-4-review-regressions.test.mjs` and verify RED.
- [ ] Derive `is_commercial: profile.role === 'comercial' && profile.active !== false` in `filterBootstrapForProfile`.
- [ ] Add `is_commercial?: boolean` to `Profile` and use it in `isCommercialProfile`, retaining the full-profile fallback.
- [ ] Run the test and verify GREEN.

### Task 2: Missing filters

**Files:**
- Create: `tests/crm-filter-table-regressions.test.mjs`
- Modify: `src/main.tsx`

**Interfaces:**
- Oportunidades consumes `DashboardPeriodFilter` and `matchesDashboardPeriod`.
- Dashboard V2 consumes `CustomerSegment`, `customerSegmentOptions`, and `customer_segment`.

- [ ] Add static regressions requiring period state, predicate, selector, dependency, and reset in `OpportunityList`.
- [ ] Add static regressions requiring customer-type state, predicate, selector, dependencies, and reset in `ManagerDashboardV2`.
- [ ] Run `node tests/crm-filter-table-regressions.test.mjs` and verify RED.
- [ ] Add period filtering to Oportunidades and customer-type filtering to Dashboard V2.
- [ ] Run the test and verify GREEN.

### Task 3: Accumulated-sales table readability

**Files:**
- Modify: `tests/crm-filter-table-regressions.test.mjs`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces column order `Ventas acumuladas`, `Presupuesto`, `Cumplimiento individual`.
- Produces explicit widths for all 12 columns and a minimum table width large enough for values.

- [ ] Add assertions for semantic header/cell order and explicit table sizing; verify RED.
- [ ] Reorder the final two body cells to match the headers.
- [ ] Replace the 1080 px squeeze with explicit widths and controlled wrapping/nowrap rules.
- [ ] Run focused tests and build; verify GREEN.

### Task 4: Verification and release

**Files:**
- Modify only if verification exposes a regression.

- [ ] Run all `tests/*.test.mjs`, Python tests, and `npm run build`.
- [ ] Run authenticated desktop/mobile browser QA for both views; assert commercial options, period/customer filters, no header/cell overflow, no console errors, and no API writes.
- [ ] Review the full range diff.
- [ ] Commit, fast-forward `main`, push, deploy to Vercel production, and repeat the authenticated smoke on the official URL.
- [ ] Remove temporary sessions, browser profiles, branch, and worktree after successful production verification.
