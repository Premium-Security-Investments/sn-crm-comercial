# SIIO F2 Security and Coherence Implementation Plan

> **For Hermes:** Use `software-development:subagent-driven-development` to execute this plan task by task. Apply TDD RED–GREEN–REFACTOR, preserve `server/index.js` ↔ `api/[...path].js` parity, and stop before push, remote migration or deploy.

**Goal:** Harden the existing read-only SIIO F2 foundation without adding visible product workflows.

**Architecture:** Keep all SIIO data behind authenticated backend routes. Align the module ceiling, route guards and Board report vocabulary; filter payroll before serialization; make foundational schema failures explicit; and add a forward-only privilege migration that preserves direct-client default-deny. The local Express server and Vercel API copy must remain mechanically identical.

**Tech Stack:** Node.js ESM, Express, React/TypeScript, Supabase/PostgreSQL, PGlite, Node test runner, Vite.

**Approved design:** `docs/superpowers/specs/2026-08-04-siio-f2-security-coherence-design.md`

**Current migration allocation:** `057_tender_document_logical_identity.sql` is highest on the approved base; `058` is free. Task 1 must re-check this immediately before creating the migration. If `058` has appeared on the branch, use the newly discovered next free number and update every plan reference in the same commit. Never edit or renumber an applied migration.

---

## Task 1: Add explicit database privilege boundaries

**Objective:** Prove and enforce that direct browser roles cannot access SIIO tables while `service_role` retains only the operations used by the backend.

**Files:**
- Create: `tests/siio-f2-security-coherence-pglite.integration.test.mjs`
- Create after collision check: `supabase/migrations/058_siio_f2_security_coherence.sql`

### Step 1: Reconfirm the migration number

Run:

```bash
python3 - <<'PY'
from pathlib import Path
numbers = sorted(int(path.name.split('_', 1)[0]) for path in Path('supabase/migrations').glob('*.sql') if path.name.split('_', 1)[0].isdigit())
print(numbers[-1], str(numbers[-1] + 1).zfill(3))
PY
```

Expected on the approved base: `57 058`.

If the next free number is no longer `058`, change the migration filename in this task before writing tests. Do not overwrite the colliding file.

### Step 2: Write the failing PGlite privilege test

Create a test that:

1. Creates roles `anon`, `authenticated`, and `service_role`; sets `service_role BYPASSRLS`; and grants it to `current_user`.
2. Creates minimal SIIO tables with the ten canonical names.
3. Applies the new migration.
4. As `authenticated` and `anon`, asserts that `SELECT` from every SIIO table fails with `permission denied`.
5. As `service_role`, asserts:
   - `SELECT` works on all ten tables;
   - `INSERT` and `UPDATE` work only on `siio_gerencial_records`, `siio_sources`, and `siio_decisions_commitments`;
   - `DELETE` fails on all ten tables;
   - writes fail on the seven read-only tables.

Use the canonical table list:

```js
const siioTables = [
  'siio_fronts',
  'siio_sources',
  'siio_gerencial_records',
  'siio_decisions_commitments',
  'siio_monthly_board_reports',
  'siio_board_sections',
  'siio_financial_metrics',
  'siio_commercial_signals',
  'siio_payroll_aggregates',
  'siio_strategic_opportunities',
];
```

Run:

```bash
node --test tests/siio-f2-security-coherence-pglite.integration.test.mjs
```

Expected RED: `ENOENT` for the migration or direct role access succeeds because explicit revokes/grants are absent.

### Step 3: Write the minimal forward-only migration

The migration must be transactional and data-preserving:

```sql
begin;

revoke all privileges on table
  public.siio_fronts,
  public.siio_sources,
  public.siio_gerencial_records,
  public.siio_decisions_commitments,
  public.siio_monthly_board_reports,
  public.siio_board_sections,
  public.siio_financial_metrics,
  public.siio_commercial_signals,
  public.siio_payroll_aggregates,
  public.siio_strategic_opportunities
from public, anon, authenticated;

revoke all privileges on table
  public.siio_fronts,
  public.siio_sources,
  public.siio_gerencial_records,
  public.siio_decisions_commitments,
  public.siio_monthly_board_reports,
  public.siio_board_sections,
  public.siio_financial_metrics,
  public.siio_commercial_signals,
  public.siio_payroll_aggregates,
  public.siio_strategic_opportunities
from service_role;

grant select on table
  public.siio_fronts,
  public.siio_sources,
  public.siio_gerencial_records,
  public.siio_decisions_commitments,
  public.siio_monthly_board_reports,
  public.siio_board_sections,
  public.siio_financial_metrics,
  public.siio_commercial_signals,
  public.siio_payroll_aggregates,
  public.siio_strategic_opportunities
to service_role;

grant insert, update on table
  public.siio_sources,
  public.siio_gerencial_records,
  public.siio_decisions_commitments
to service_role;

commit;
```

Do not add permissive RLS policies. Do not grant `DELETE`.

### Step 4: Run GREEN and migration dependency regression

Run:

```bash
node --test tests/siio-f2-security-coherence-pglite.integration.test.mjs tests/siio-migration-source-dependencies.test.mjs
```

Expected: both tests pass.

### Step 5: Commit

```bash
git add supabase/migrations/058_siio_f2_security_coherence.sql tests/siio-f2-security-coherence-pglite.integration.test.mjs
git commit -m "security: restrict direct SIIO table access"
```

If Task 1 discovered a different migration number, use that exact path in `git add`.

---

## Task 2: Remove Director eligibility for SIIO

**Objective:** Make module selection, navigation and backend denial agree while preserving Director access to unrelated modules.

**Files:**
- Modify: `module-access.js:25-32`
- Modify: `tests/module-access.test.mjs:28-33`
- Modify: `tests/task-4-review-regressions.test.mjs:15`
- Verify unchanged: `tests/siio-area-scope-blocker.test.mjs:88-112`
- Test unchanged: `tests/siio-manager-navigation-static.test.mjs`

### Step 1: Write failing eligibility assertions

In `tests/module-access.test.mjs`, replace the old Director expectation and add the list assertion:

```js
assert.equal(
  isModulePermissionEligible('director', 'modulo_siio_gerencial'),
  false,
  'director must remain ineligible until SIIO has canonical area scope',
);
assert.equal(
  eligibleModulePermissions('director').includes('modulo_siio_gerencial'),
  false,
  'admin permission UI must not offer SIIO to director',
);
```

In `tests/task-4-review-regressions.test.mjs`, change the historical expectation from `true` to:

```js
assert.equal(
  isModulePermissionEligible('director', 'modulo_siio_gerencial'),
  false,
  'director SIIO eligibility remains fail-closed until canonical area scope exists',
);
```

Keep `tests/siio-area-scope-blocker.test.mjs` unchanged: it already proves direct Director access returns `403` before any SIIO table read. `src/navPermissions.ts` calls `isModulePermissionEligible`, so the module ceiling also removes SIIO from the Director sidebar even when a historical database grant remains.

Run:

```bash
node --test tests/module-access.test.mjs tests/task-4-review-regressions.test.mjs tests/siio-area-scope-blocker.test.mjs
```

Expected RED: both updated eligibility assertions fail because Director remains module-eligible.

### Step 2: Apply the minimal module ceiling change

Change only the Director ceiling in `module-access.js`:

```js
['director', new Set(MODULE_PERMISSION_CODES.filter(code =>
  code !== 'modulo_usuarios' && code !== 'modulo_siio_gerencial'
))],
```

Do not remove the backend `profile?.role === 'director'` fail-closed guard.

No special-case UI logic should be needed because `src/navPermissions.ts` already delegates to `isModulePermissionEligible`.

### Step 3: Run GREEN and unrelated navigation regression

Run:

```bash
node --test tests/module-access.test.mjs tests/task-4-review-regressions.test.mjs tests/siio-manager-navigation-static.test.mjs tests/siio-manager-navigation-selectors.test.mjs tests/siio-area-scope-blocker.test.mjs
npm run check:nav-permissions
```

Expected: all pass; Director retains all previously eligible non-SIIO modules.

### Step 4: Commit

```bash
git add module-access.js tests/module-access.test.mjs tests/task-4-review-regressions.test.mjs
git commit -m "fix: align Director SIIO visibility with backend scope"
```

---

## Task 3: Canonicalize Board publication status to `presentado`

**Objective:** Ensure Junta can receive only reports formally marked `presentado`, using the existing Spanish schema vocabulary.

**Files:**
- Modify: `access-control.js:327-331`
- Modify: `server/index.js:155-168,1967-1971`
- Modify: `api/[...path].js` at the matching generated-parity sections
- Modify: `tests/siio-area-scope-blocker.test.mjs`
- Modify: `tests/siio-board-readonly-ui.test.mjs` only if it asserts the old English vocabulary

### Step 1: Rewrite the fake report fixture and expected results first

Replace the old fake rows with all canonical states:

```js
return json(res, 200, [
  { id: 'draft-report', status: 'borrador', summary: 'Borrador' },
  { id: 'review-report', status: 'en_revision', summary: 'En revisión' },
  { id: 'approved-report', status: 'aprobado', summary: 'Aprobado' },
  { id: 'presented-report', status: 'presentado', summary: 'Presentado' },
  { id: 'legacy-english-report', publication_status: 'published', summary: 'No canónico' },
]);
```

Expected Junta response:

```js
assert.deepEqual(
  response.body.map(row => row.id),
  ['presented-report'],
  'junta only receives canonical presented reports',
);
```

Add direct policy assertions:

```js
assert.equal(can(boardProfile, ACTIONS.BOARD_PUBLICATION_VIEW, { status: 'presentado' }), true);
for (const status of ['borrador', 'en_revision', 'aprobado']) {
  assert.equal(can(boardProfile, ACTIONS.BOARD_PUBLICATION_VIEW, { status }), false);
}
assert.equal(can(boardProfile, ACTIONS.BOARD_PUBLICATION_VIEW, { publication_status: 'published' }), false);
```

Run:

```bash
node --test tests/siio-area-scope-blocker.test.mjs tests/siio-board-readonly-ui.test.mjs
```

Expected RED: the policy still requires `publication_status === 'published'`.

### Step 2: Change the policy resource and filter

In `access-control.js`:

```js
case ACTIONS.BOARD_PUBLICATION_VIEW:
  return hasHumanRole(profile, PRIVILEGED_ROLES)
    || (hasHumanRole(profile, BOARD_ROLE)
      && hasOwn(resource, 'status')
      && resource.status === 'presentado');
```

In both backend entrypoints:

```js
const SIIO_PUBLISHED_BOARD_RESOURCE = Object.freeze({ status: 'presentado' });
```

and:

```js
function filterBoardReportsForProfile(profile, rows) {
  if (profile?.role !== 'junta') return rows;
  return rows.filter(row => can(profile, ACTIONS.BOARD_PUBLICATION_VIEW, {
    status: row?.status,
  }));
}
```

Do not add or read `publication_status`.

### Step 3: Run GREEN and parity

Run:

```bash
node --test tests/siio-area-scope-blocker.test.mjs tests/siio-board-readonly-ui.test.mjs
npm run check:backend-parity
```

Expected: all pass and parity reports success.

### Step 4: Commit

```bash
git add access-control.js server/index.js 'api/[...path].js' tests/siio-area-scope-blocker.test.mjs tests/siio-board-readonly-ui.test.mjs
git commit -m "fix: use canonical presented status for SIIO Board"
```

---

## Task 4: Filter payroll visibility before serialization

**Objective:** Prevent `restringido` payroll rows from reaching Admin/Gerencia payloads and preserve Junta’s zero-raw-payroll contract.

**Files:**
- Modify: `server/index.js:1967-1996`
- Modify: `api/[...path].js` matching section
- Modify: `tests/siio-area-scope-blocker.test.mjs`

### Step 1: Extend the fake Supabase fixture for management bootstrap

Add active `admin` and `gerencia` profiles/tokens with SIIO permission. Return payroll rows containing all three visibility levels:

```js
[
  { id: 'payroll-management', visibility_level: 'gerencia', total_people: 2 },
  { id: 'payroll-board', visibility_level: 'junta_agregado', total_people: 3 },
  { id: 'payroll-restricted', visibility_level: 'restringido', total_people: 1 },
]
```

For both Admin and Gerencia bootstrap responses, assert:

```js
assert.deepEqual(
  response.body.payrollAggregates.map(row => row.id),
  ['payroll-management', 'payroll-board'],
);
assert.equal(JSON.stringify(response.body).includes('payroll-restricted'), false);
```

Keep the existing Junta assertion:

```js
assert.deepEqual(response.body.payrollAggregates, []);
```

Run:

```bash
node --test tests/siio-area-scope-blocker.test.mjs
```

Expected RED: Admin/Gerencia receive the restricted row.

### Step 2: Add one pure server-side filter and use it in bootstrap

Add identically to both entrypoints:

```js
const SIIO_MANAGEMENT_PAYROLL_VISIBILITY = new Set(['gerencia', 'junta_agregado']);

function filterPayrollAggregatesForManagement(rows) {
  return rows.filter(row => SIIO_MANAGEMENT_PAYROLL_VISIBILITY.has(row?.visibility_level));
}
```

After the parallel queries resolve, filter before `res.json`:

```js
const visiblePayrollAggregates = filterPayrollAggregatesForManagement(payrollAggregates);
res.json({
  fronts,
  records,
  sources,
  decisions,
  boardReports,
  boardSections,
  financialMetrics,
  commercialSignals,
  payrollAggregates: visiblePayrollAggregates,
  strategicOpportunities,
  currentProfile: profile,
});
```

Do not expose counts or metadata about excluded rows.

### Step 3: Run GREEN and parity

Run:

```bash
node --test tests/siio-area-scope-blocker.test.mjs
npm run check:backend-parity
```

Expected: tests and parity pass.

### Step 4: Commit

```bash
git add server/index.js 'api/[...path].js' tests/siio-area-scope-blocker.test.mjs
git commit -m "security: filter restricted SIIO payroll rows"
```

---

## Task 5: Fail explicitly when a foundational SIIO table is missing

**Objective:** Stop treating a missing required table as a valid empty dataset while preserving `[]` for a successful empty query.

**Files:**
- Modify: `server/index.js:1890-1900`
- Modify: `api/[...path].js` matching section
- Modify: `tests/siio-area-scope-blocker.test.mjs`

### Step 1: Add red tests for missing-table and empty-table behavior

Extend the fake Supabase server with a test-controlled mode:

```js
let siioFailureMode = null;
```

For one required SIIO path:

- mode `missing`: return a PostgREST-style error containing `relation ... does not exist`;
- mode `empty`: return `[]`.

Assert:

```js
siioFailureMode = 'missing';
response = await requestJson(appPort, '/api/siio/bootstrap', 'admin-token');
assert.equal(response.status, 503);
assert.equal(response.body.error, 'La fundación de datos SIIO no está disponible.');
assert.equal(JSON.stringify(response.body).includes('relation'), false);
assert.equal(JSON.stringify(response.body).includes('schema cache'), false);

siioFailureMode = 'empty';
response = await requestJson(appPort, '/api/siio/bootstrap', 'admin-token');
assert.equal(response.status, 200);
assert.deepEqual(response.body.fronts, []);
```

The public response must not include SQL, schema cache details, service keys or relation internals.

Run:

```bash
node --test tests/siio-area-scope-blocker.test.mjs
```

Expected RED: missing relation is converted to `[]` and returns `200`.

### Step 2: Replace optional semantics for the F2 foundation

Rename the helper. Preserve detection of a missing relation only to sanitize it into an explicit public `503`; never return `[]` for that condition:

```js
function siioFoundationUnavailable(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || message.includes('does not exist')
    || message.includes('schema cache');
}

async function requiredSiioList(database, table, select = '*', order = 'created_at') {
  const query = database.from(table).select(select).limit(1000);
  if (order) query.order(order, { ascending: table === 'siio_board_sections' });
  const { data, error } = await query;
  if (error) {
    if (siioFoundationUnavailable(error)) {
      const unavailable = new Error('La fundación de datos SIIO no está disponible.');
      unavailable.status = 503;
      unavailable.code = 'SIIO_FOUNDATION_UNAVAILABLE';
      throw unavailable;
    }
    throw error;
  }
  return data || [];
}
```

Replace every F2 route use of `optionalSiioList` with `requiredSiioList` in both backend entrypoints. Do not change non-SIIO helpers. The generic message is safe to pass through the existing `sendAuthError`/`sendError` path.

### Step 3: Run GREEN and full endpoint regression

Run:

```bash
node --test tests/siio-area-scope-blocker.test.mjs tests/siio-main-integration-static.test.mjs
npm run check:backend-parity
```

Expected: missing-table returns controlled `503`; empty table returns `200` with `[]`; parity passes.

### Step 4: Commit

```bash
git add server/index.js 'api/[...path].js' tests/siio-area-scope-blocker.test.mjs tests/siio-main-integration-static.test.mjs
git commit -m "fix: fail closed on missing SIIO foundation tables"
```

---

## Task 6: Run the complete mechanical gate

**Objective:** Prove the block changes no visible workflow and introduces no SIIO, backend parity or build regression.

**Files:**
- Modify only if required by a genuine regression: tests already touched in Tasks 1–5
- Create: `docs/verification/2026-08-04-siio-f2-security-coherence-local.md`

### Step 1: Run focused tests sequentially

```bash
node --test --test-concurrency=1 \
  tests/siio-f2-security-coherence-pglite.integration.test.mjs \
  tests/siio-area-scope-blocker.test.mjs \
  tests/siio-manager-navigation-static.test.mjs \
  tests/siio-manager-navigation-selectors.test.mjs \
  tests/siio-board-readonly-ui.test.mjs \
  tests/siio-main-integration-static.test.mjs \
  tests/siio-migration-source-dependencies.test.mjs
```

Expected: all listed tests pass with zero failures.

### Step 2: Run all SIIO tests and parity

```bash
node --test --test-concurrency=1 tests/siio*.test.mjs
npm run check:backend-parity
```

Expected: zero failures and parity success.

### Step 3: Build

```bash
npm run build
```

Expected: TypeScript and Vite build succeed. The existing bundle-size warning is non-blocking unless it becomes an error or materially worsens.

### Step 4: Inspect the final diff

```bash
git status --short
git diff origin/main...HEAD --check
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- \
  module-access.js access-control.js server/index.js 'api/[...path].js' \
  supabase/migrations tests/siio* docs/verification
```

Verify:

- no AGT-002/AGT-003/Mesa files changed;
- no UI forms, buttons or workflows were added;
- no secret or real record was added;
- only one new migration exists;
- no `published` or `publication_status` remains in the F2 Board contract;
- both backend entrypoints remain equivalent.

### Step 5: Write local verification evidence

Record exact commands, timestamps, exit codes, test counts, build result, migration filename and residual risks in:

`docs/verification/2026-08-04-siio-f2-security-coherence-local.md`

Do not claim production validation, migration application or deploy.

### Step 6: Commit evidence

```bash
git add docs/verification/2026-08-04-siio-f2-security-coherence-local.md
git commit -m "docs: record local SIIO F2 security verification"
```

---

## Task 7: Single independent review and human gate

**Objective:** Obtain one independent review of the complete block, resolve only material findings, and stop before external side effects.

**Files:**
- Review: full diff `origin/main...HEAD`
- Modify only files implicated by Critical or Important findings

### Step 1: Run one independent review

The reviewer must check:

1. privilege migration is least-privilege and data-preserving;
2. Director loses only SIIO eligibility;
3. Junta sees only canonical `presentado` reports;
4. restricted payroll never enters the payload;
5. missing schemas fail explicitly without leaking internals;
6. local and Vercel backends remain in parity;
7. no visible workflow or agent scope was added.

### Step 2: Handle findings once

- Fix Critical or Important findings using a focused red test first.
- Re-run only the impacted focused tests, then Task 6’s full gate.
- Do not start a second general review unless a fix introduces a material regression or Juan requests it.

### Step 3: Present the human gate

Present to Juan:

- commit list;
- diff summary;
- test and build evidence;
- migration SQL summary;
- independent review result;
- residual risks;
- explicit statement that no push, remote migration or deploy has occurred.

Stop and request separate authorization for:

1. push/PR;
2. production migration;
3. production deploy.

Do not combine those gates implicitly.
