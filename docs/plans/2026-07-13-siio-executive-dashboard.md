# SIIO Executive Dashboard – First Real Board Sources Implementation Plan

> **For Hermes:** Implement task-by-task with TDD. Do not write to production Supabase or modify SharePoint source files.

**Goal:** Convert the April PYG and June administrative payroll examples into privacy-safe structured indicators that the permanent SIIO Executive Dashboard can display at any time.

**Architecture:** A deterministic Python extractor reads local copies of the official SharePoint workbooks and emits a privacy-safe JSON snapshot plus an optional SQL seed. The CRM/SIIO frontend continues consuming the existing authenticated `/api/siio/bootstrap` response and derives an executive view from `siio_financial_metrics`, `siio_payroll_aggregates`, sources, records and decisions. The PowerPoint remains a reference/output format, never the source of truth.

**Tech Stack:** Python 3 + openpyxl for controlled extraction; React/TypeScript; Supabase tables from migration 014; Node/esbuild checkers.

---

## Constraints

- Do not commit or expose names, IDs, individual salaries, individual accruals or deductions.
- Do not modify the three source files in SharePoint.
- Do not apply migrations or seed data to production without Juan's approval.
- Clearly label source period and freshness.
- Financial and payroll periods may differ; never merge them into a false single period.
- The Dashboard is permanent; “Modo Junta” is only a filtered/exportable view.

## Task 1: Define the safe extraction contract

**Files:**
- Create: `scripts/extract_siio_board_sources.py`
- Create: `tests/siio-board-source-extractor.test.py`

**Steps:**
1. Write tests using synthetic workbooks.
2. Verify RED because the extractor module does not exist.
3. Implement extraction of approved PYG concepts from sheet `Comparat`.
4. Implement payroll aggregation by `Area` using only counts and sums.
5. Verify that output contains no identity fields.
6. Verify GREEN.
7. Commit.

**Approved PYG concepts:**

```text
INGRESOS
COSTOS
GASTOS
UTILIDAD OPERACIONAL
MARGEN OPERACIONAL
NO OPERACIONAL
IMPUESTOS
UTILIDAD NETA
MARGEN NETO
```

**Payroll output:**

```text
period_month
area
total_people
total_accrued
total_deductions
net_total
visibility_level = junta_agregado
source_id
```

## Task 2: Generate a redacted snapshot from the real examples

**Files:**
- Create: `data/siio/board_snapshot_financial_2026-04_payroll_2026-06.json`
- Create: `supabase/migrations/016_siio_initial_executive_snapshot_seed.sql`

**Steps:**
1. Run extractor against temporary read-only SharePoint downloads.
2. Validate schema and redaction mechanically.
3. Verify totals against workbook aggregate calculations.
4. Generate idempotent SQL for sources, metrics and payroll aggregates.
5. Do not apply SQL.
6. Commit.

## Task 3: Define executive snapshot derivation

**Files:**
- Create: `src/siioExecutive.ts`
- Create: `scripts/check_siio_executive_snapshot.mjs`
- Modify: `package.json`

**Steps:**
1. Write failing tests for latest financial/payroll periods, KPI lookup, source freshness and privacy-safe labels.
2. Verify RED.
3. Implement pure TypeScript derivation.
4. Verify GREEN.
5. Commit.

## Task 4: Render permanent Executive Dashboard

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Create: `tests/siio-executive-dashboard-static.test.mjs`

**Steps:**
1. Write failing static behavior test.
2. Verify RED.
3. Add period-labelled finance cards and variation information.
4. Add payroll aggregate panel by area.
5. Add source freshness panel.
6. Preserve existing F1-F6 tabs and Modo Junta.
7. Verify GREEN.
8. Run all checkers, CRM tests and build.
9. Commit.

## Task 5: Produce preview and gate report

**Files:**
- Create: `docs/qa/siio-executive-dashboard-loop1.md`

**Steps:**
1. Push branch `feature/siio-main-integration`.
2. Update PR #12.
3. Deploy Vercel preview.
4. Confirm preview/build status.
5. Record that production seed 016 remains unapplied.
6. Ask Juan only for the DB-write gate needed to publish the initial snapshot.
