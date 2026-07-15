# SIIO Managerial Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the protected SIIO dashboard into four management-task views with URL-owned contextual filters, governed Board-draft action, preserved data/privacy controls, and verified desktop/mobile behavior.

**Architecture:** Keep the CRM shell, route permission gate, and one authenticated `GET /api/siio/bootstrap` request in `src/main.tsx`; move all SIIO presentation, route-query state, and pure derivation logic into `src/siio/`. `SiioDashboard` owns the bootstrap lifecycle and delegates URL parsing/serialization to pure selectors, while each view owns only its contextual filters. The Board surface is a local, read-only dialog over already-loaded data and uses `window.print()` only.

**Tech Stack:** React 19, TypeScript strict mode, Vite, CSS, Node ESM static/behavioral contract tests, existing `esbuild` test compiler, Python `unittest` + `openpyxl` regression suite.

## Global Constraints

- Keep SIIO in the current protected CRM route `#/siio`; keep `canAccessRoute(..., 'siio')` and the defensive `isManagementRole` guard.
- The main SIIO navigation contains exactly: `Resumen ejecutivo`, `Seguimiento gerencial`, `Fuentes e inteligencia`, and `Agentes`.
- `F1`–`F6` are record metadata/secondary labels only; they are never main SIIO navigation labels.
- `Modo Junta` and `AGT-004 Asistente de Junta` are removed as independent navigation/agent concepts; the visible action label is exactly `Preparar informe de Junta`.
- Use one `/api/siio/bootstrap` load per `SiioDashboard` mount. View changes and filters must never fetch again.
- Do not add endpoints, Supabase migrations, production writes, automatic decisions, automatic publishing, deployment, merge, or SharePoint work.
- Never render, type, derive, capture, or test individual payroll names, IDs, salaries, or personal rows. Payroll remains aggregate-only.
- Preserve current responsive CRM drawer, Escape handling, pagination, tender deduplication, and all existing non-SIIO routes.
- Every recommendation must show supporting source(s) and origin period, or display `Pendiente de evidencia` and/or `Periodo pendiente`; never fabricate either value.
- Unknown query parameters are ignored; a missing or invalid `view` resolves to `resumen`; filters not owned by the target view are dropped when changing view.
- Use TDD red → green for every functional task. Run `git diff --check` before every commit.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/siio/types.ts` | SIIO bootstrap presentation types, four view keys, per-view filters, URL state, and shared row/view-model contracts. |
| `src/siio/selectors.ts` | Pure query parsing/serialization, view transitions, tracking-item composition/deduplication/filtering, source/recommendation evidence mapping, and contextual option derivation. |
| `src/apiClient.ts` | Shared authenticated JSON API client and access-token setter used by CRM shell and extracted SIIO modules. |
| `src/siio/SiioUi.tsx` | Small SIIO-local `Panel`, `Badge`, `EmptyState`, currency/date formatters, and accessible labeled-select primitive. |
| `src/siio/SiioDashboard.tsx` | One bootstrap request, defensive role guard, hashchange state synchronization, four-view composition, and Board action state. |
| `src/siio/SiioNavigation.tsx` | Keyboard-accessible four-option SIIO navigation only. |
| `src/siio/SiioExecutiveView.tsx` | Period/area filters, nonduplicated executive metrics, alerts, priorities, decisions, recommendations, and drill-down links. |
| `src/siio/SiioManagementTrackingView.tsx` | Tracking subviews and state/semaphore/owner filters across deduplicated records and decision items. |
| `src/siio/SiioSourcesIntelligenceView.tsx` | Freshness/trust/source-type filters, source traceability, deterministic F5 recommendations, evidence, and pending-state disclosure. |
| `src/siio/SiioAgentsView.tsx` | Governed institutional agent catalog and status/owner filters. |
| `src/siio/SiioBoardDraftAction.tsx` | Accessible read-only Board draft dialog with explicit human-review disclosure and print-only export. |
| `src/siio/siio.css` | SIIO-only layout, filter, dialog, focus, table-scroll, and responsive rules; no CRM-shell rewrites. |
| `src/main.tsx` | Retains global types/utilities and CRM routes; replaces inline SIIO component block with `SiioDashboard`. |
| `src/siioAgents.ts` | Corrected three-agent governed catalog; AGT-001 owns Board-draft capability. |
| `tests/siio-manager-navigation-selectors.test.mjs` | Compiled pure-selector contracts. |
| `tests/siio-manager-navigation-static.test.mjs` | UI module, route, access, no-write, and privacy static contract. |
| `tests/siio-agent-catalog-static.test.mjs` | Corrected catalog UI contract. |
| `tests/siio-executive-dashboard-static.test.mjs` | Updated executive/Board UI contract. |
| `scripts/check_siio_agent_catalog.mjs` | Corrected executable catalog contract. |

---

### Task 1: Define SIIO navigation state and pure selector contracts

**Files:**
- Create: `src/siio/types.ts`
- Create: `tests/siio-manager-navigation-selectors.test.mjs`
- Modify: `src/siioAgents.ts`

**Interfaces:**
- Consumes: exported `SiioFinancialMetric`, `SiioPayrollAggregate`, and `SiioInstitutionalAgent` types.
- Produces: `SiioView`, `SiioRouteFilters`, `SiioRouteState`, `SiioTrackingItem`, `SiioRecommendation`, `SiioCurrentProfile`, and `SiioBootstrapPayload` for every later SIIO module.

- [ ] **Step 1: Write the failing selector-contract test**

Create `tests/siio-manager-navigation-selectors.test.mjs` with this initial import and route assertions:

```js
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const source = readFileSync('src/siio/selectors.ts', 'utf8');
const outDir = mkdtempSync(join(tmpdir(), 'siio-navigation-'));
const outPath = join(outDir, 'selectors.mjs');
writeFileSync(outPath, transformSync(source, { loader: 'ts', format: 'esm', target: 'es2020' }).code);
const mod = await import(`file://${outPath}`);

assert.deepEqual(mod.parseSiioRouteState('#/siio?view=seguimiento&kind=riesgos&status=pendiente&area=finanzas'), {
  view: 'seguimiento',
  filters: { kind: 'riesgos', status: 'pendiente', semaphore: '', owner: '' },
});
assert.deepEqual(mod.parseSiioRouteState('#/siio?view=invalida&period=2026-06-01'), {
  view: 'resumen',
  filters: { period: '2026-06-01', area: '' },
});
assert.equal(
  mod.toSiioHash({ view: 'inteligencia', filters: { freshness: 'vencida', trust: 'restringida', sourceType: 'archivo' } }),
  '#/siio?view=inteligencia&freshness=vencida&trust=restringida&sourceType=archivo',
);
assert.equal(
  mod.toSiioHash({ view: 'agentes', filters: { status: 'piloto', owner: 'Gerencia General' } }),
  '#/siio?view=agentes&status=piloto&owner=Gerencia+General',
);
console.log('SIIO managerial navigation selector contracts OK');
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node tests/siio-manager-navigation-selectors.test.mjs`

Expected: FAIL with `ENOENT` for `src/siio/selectors.ts`.

- [ ] **Step 3: Create the complete shared type boundary**

Create `src/siio/types.ts` with these exported contracts, preserving the nullable fields required by the existing bootstrap response:

```ts
import type { SiioFinancialMetric, SiioPayrollAggregate, SiioManagementInsight } from '../siioExecutive';

export const SIIO_VIEWS = ['resumen', 'seguimiento', 'inteligencia', 'agentes'] as const;
export type SiioView = typeof SIIO_VIEWS[number];
export type SiioTrackingKind = 'todos' | 'decisiones' | 'bloqueos' | 'riesgos' | 'compromisos';
export type SiioRouteFiltersByView = {
  resumen: { period: string; area: string };
  seguimiento: { kind: SiioTrackingKind; status: string; semaphore: string; owner: string };
  inteligencia: { freshness: string; trust: string; sourceType: string };
  agentes: { status: string; owner: string };
};
export type SiioRouteFilters = SiioRouteFiltersByView[SiioView];
export type SiioRouteState = { [View in SiioView]: { view: View; filters: SiioRouteFiltersByView[View] } }[SiioView];

export type SiioFront = { id: string; name: string; description?: string; status?: string; owner_role?: string | null };
export type SiioRecord = { id: string; front_id: string; title: string; record_type?: string; owner?: string | null; decision_owner?: string | null; status?: string; priority?: string; semaforo?: string; next_action?: string | null; blockers?: string | null; risks?: string | null; decision_required?: string | null; source_ids?: string[] };
export type SiioDecision = { id: string; item_type: string; description: string; owner?: string | null; due_date?: string | null; status?: string; impact?: string | null; related_record_id?: string | null };
export type SiioSource = { id: string; name: string; source_type?: string; trust_level?: string; status?: string; restrictions?: string | null; related_fronts?: string[]; url?: string | null; last_reviewed_at?: string | null; next_review_at?: string | null; update_frequency?: string | null };
export type SiioBoardReport = { id: string; period_month: string; status: string; summary?: string; generated_at?: string; source_ids?: string[] };
export type SiioBoardSection = { id?: string; name: string; section_order?: number; human_review_required?: boolean };
export type SiioRecommendation = SiioManagementInsight & { sourceIds: string[]; period: string | null };
export type SiioTrackingItem = { id: string; kind: Exclude<SiioTrackingKind, 'todos'>; title: string; owner: string | null; status: string; semaphore: string; nextAction: string | null; frontId: string | null; sourceIds: string[]; dueDate: string | null };
export type SiioCurrentProfile = { role: string; full_name?: string | null };
export type SiioBootstrapPayload = { fronts: SiioFront[]; records: SiioRecord[]; sources: SiioSource[]; decisions: SiioDecision[]; boardReports: SiioBoardReport[]; boardSections: SiioBoardSection[]; financialMetrics: SiioFinancialMetric[]; payrollAggregates: SiioPayrollAggregate[]; currentProfile: SiioCurrentProfile };
```

- [ ] **Step 4: Add the pure route implementation**

Create `src/siio/selectors.ts` with a complete `parseSiioRouteState`, `toSiioHash`, `emptyFiltersForView`, and `navigateSiioView` implementation. The parser must use `new URLSearchParams(hash.split('?')[1] || '')`, accept only `SIIO_VIEWS`, and select exactly these keys per view:

```ts
export function emptyFiltersForView<View extends SiioView>(view: View): SiioRouteFiltersByView[View] {
  if (view === 'resumen') return { period: '', area: '' } as SiioRouteFiltersByView[View];
  if (view === 'seguimiento') return { kind: 'todos', status: '', semaphore: '', owner: '' } as SiioRouteFiltersByView[View];
  if (view === 'inteligencia') return { freshness: '', trust: '', sourceType: '' } as SiioRouteFiltersByView[View];
  return { status: '', owner: '' } as SiioRouteFiltersByView[View];
}

export function navigateSiioView<View extends SiioView>(view: View, filters: Partial<SiioRouteFiltersByView[View]> = {}): Extract<SiioRouteState, { view: View }> {
  return { view, filters: { ...emptyFiltersForView(view), ...filters } } as Extract<SiioRouteState, { view: View }>;
}
```

`toSiioHash` must add `view` first and append only nonempty keys owned by the selected view. It must return `#/siio?view=resumen` for the default state, so copied links have one stable canonical form.

- [ ] **Step 5: Run the route test to verify GREEN**

Run: `node tests/siio-manager-navigation-selectors.test.mjs`

Expected: `SIIO managerial navigation selector contracts OK`.

- [ ] **Step 6: Commit the state boundary**

```bash
git add src/siio/types.ts src/siio/selectors.ts tests/siio-manager-navigation-selectors.test.mjs
git diff --check
git commit -m "feat: define SIIO managerial navigation state"
```

---

### Task 2: Build pure tracking, evidence, and contextual-filter derivations

**Files:**
- Modify: `src/siio/selectors.ts`
- Modify: `tests/siio-manager-navigation-selectors.test.mjs`

**Interfaces:**
- Consumes: `SiioRecord[]`, `SiioDecision[]`, `SiioSource[]`, and `deriveSiioExecutiveSnapshot` results.
- Produces: `deriveTrackingItems(records, decisions)`, `filterTrackingItems(items, filters)`, `deriveRecommendations(snapshot)`, `filterSources(sources, filters)`, and `uniqueOptions(values)`.

- [ ] **Step 1: Extend the selector test with composition and evidence RED cases**

Append these assertions to `tests/siio-manager-navigation-selectors.test.mjs`:

```js
const rows = mod.deriveTrackingItems([
  { id: 'REC-1', front_id: 'F2', title: 'Cierre de margen', owner: 'Finanzas', status: 'pendiente', semaforo: 'rojo', next_action: 'Validar costos', decision_required: 'Aprobar plan', source_ids: ['SRC-011'] },
  { id: 'REC-2', front_id: 'F3', title: 'Cobertura', owner: 'Operaciones', status: 'abierto', semaforo: 'amarillo', next_action: 'Revisar turnos', blockers: 'Vacantes', source_ids: ['SRC-012'] },
], [
  { id: 'DEC-1', item_type: 'decision', description: 'Aprobar plan', owner: 'Finanzas', status: 'pendiente', related_record_id: 'REC-1' },
  { id: 'RISK-1', item_type: 'riesgo', description: 'Proveedor vencido', owner: 'Compras', status: 'abierto' },
]);
assert.deepEqual(rows.map(row => row.id), ['REC-1:decision', 'REC-2:bloqueos', 'RISK-1']);
assert.equal(rows[0].title, 'Aprobar plan');
assert.deepEqual(
  mod.filterTrackingItems(rows, { kind: 'bloqueos', status: '', semaphore: '', owner: '' }).map(row => row.id),
  ['REC-2:bloqueos'],
);
const recommendations = mod.deriveRecommendations({
  managementInsights: [{ id: 'i-1', front: 'F5', tone: 'amber', priority: 'alta', title: 'Validar cifras', finding: 'Falta validación', evidence: 'Métrica sin validador', action: 'Solicitar validación' }],
  financialPeriod: '2026-06-01', payrollPeriod: null,
});
assert.deepEqual(recommendations[0].sourceIds, ['Pendiente de evidencia']);
assert.equal(recommendations[0].period, '2026-06-01');
```

- [ ] **Step 2: Run the expanded test to verify RED**

Run: `node tests/siio-manager-navigation-selectors.test.mjs`

Expected: FAIL because `deriveTrackingItems` is not exported.

- [ ] **Step 3: Implement deterministic, nonduplicating tracking rows**

Implement `deriveTrackingItems` so each record emits at most one row with precedence `blockers` → `risks` → `decision_required` → `record_type`; decisions linked to a record are skipped when their normalized `description` equals that record’s emitted title. Implement normalization as:

```ts
function normalizedSubject(value: string | null | undefined): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
```

Map `decision`, `compromiso`, `bloqueo`/`bloqueado`, and `riesgo`/`riesgos` into `SiioTrackingKind`; map unknown values to `decisiones`. Preserve `owner`, `status`, available `due_date`, record `front_id`, source IDs, and `next_action`; use `Pendiente` only for missing display status, not invented business information.

- [ ] **Step 4: Implement evidence and source filtering**

Implement `deriveRecommendations` so every deterministic F5 insight becomes a `SiioRecommendation` with `sourceIds: ['SRC-011']` when its `evidence` mentions `financier`, `sourceIds: ['SRC-012']` when it mentions `nómina`, and `['Pendiente de evidencia']` otherwise. Its period is `financialPeriod` for financial evidence, `payrollPeriod` for payroll evidence, otherwise the first non-null of the two periods. Implement `filterSources` freshness buckets as `vigente`, `próxima_a_vencer`, `vencida`, and `sin_fecha` by comparing `next_review_at` to the start of today.

- [ ] **Step 5: Run the expanded test to verify GREEN**

Run: `node tests/siio-manager-navigation-selectors.test.mjs`

Expected: `SIIO managerial navigation selector contracts OK` with all route, composition, deduplication, and pending-evidence assertions passing.

- [ ] **Step 6: Commit selector behavior**

```bash
git add src/siio/selectors.ts tests/siio-manager-navigation-selectors.test.mjs
git diff --check
git commit -m "feat: derive SIIO tracking and evidence views"
```

---

### Task 3: Correct the governed agent catalog and executable catalog check

**Files:**
- Modify: `src/siioAgents.ts`
- Modify: `scripts/check_siio_agent_catalog.mjs`
- Modify: `tests/siio-agent-catalog-static.test.mjs`

**Interfaces:**
- Produces: exactly `AGT-001`, `AGT-002`, and `AGT-003`; `AGT-001.permitted_actions` includes `Preparar borrador de Junta`.
- Consumes later: `SiioAgentsView` renders `SIIO_AGENT_CATALOG` without a Board-only agent.

- [ ] **Step 1: Write the failing corrected catalog assertions**

Replace the catalog cardinality and IDs in `scripts/check_siio_agent_catalog.mjs` with:

```js
assert.equal(SIIO_AGENT_CATALOG.length, 3);
assert.deepEqual(SIIO_AGENT_CATALOG.map(agent => agent.id), ['AGT-001', 'AGT-002', 'AGT-003']);
assert.equal(SIIO_AGENT_CATALOG.some(agent => agent.id === 'AGT-004'), false);
const manager = SIIO_AGENT_CATALOG.find(agent => agent.id === 'AGT-001');
assert.ok(manager.permitted_actions.includes('Preparar borrador de Junta'));
assert.ok(manager.forbidden_actions.includes('Publicar informes'));
assert.ok(manager.forbidden_actions.includes('Aprobar cifras financieras'));
assert.ok(manager.forbidden_actions.includes('Ocultar alertas o restricciones'));
assert.ok(manager.forbidden_actions.includes('Ejecutar decisiones gerenciales'));
```

Also update `tests/siio-agent-catalog-static.test.mjs` to require `Preparar borrador de Junta`, reject `AGT-004`, and keep checks for purpose, owner, status, authorized sources, permitted/prohibited actions, audit rule, next gate, human review, and no production writes.

- [ ] **Step 2: Verify RED**

Run: `npm run check:siio-agents && node tests/siio-agent-catalog-static.test.mjs`

Expected: FAIL because the current catalog has four agents and `AGT-001` lacks the Board capability.

- [ ] **Step 3: Make the catalog correction**

Delete the full `AGT-004` object from `SIIO_AGENT_CATALOG`. Replace AGT-001’s permitted and prohibited actions exactly with:

```ts
permitted_actions: ['Leer métricas agregadas', 'Aplicar reglas F5', 'Resumir evidencia', 'Proponer acciones gerenciales', 'Preparar borrador de Junta'],
forbidden_actions: ['Publicar informes', 'Aprobar cifras financieras', 'Ocultar alertas o restricciones', 'Exponer nómina individual o datos personales', 'Modificar archivos de origen', 'Ejecutar decisiones gerenciales'],
```

Keep `human_review_required: true`, `can_write_production: false`, the existing source restrictions, and `validateSiioAgentCatalog` unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `npm run check:siio-agents && node tests/siio-agent-catalog-static.test.mjs`

Expected: both commands PASS and report three governed agents.

- [ ] **Step 5: Commit the catalog correction**

```bash
git add src/siioAgents.ts scripts/check_siio_agent_catalog.mjs tests/siio-agent-catalog-static.test.mjs
git diff --check
git commit -m "fix: govern Board drafting under SIIO manager"
```

---

### Task 4: Extract dashboard shell, query navigation, and one-load lifecycle

**Files:**
- Create: `src/siio/SiioDashboard.tsx`
- Create: `src/siio/SiioNavigation.tsx`
- Create: `src/apiClient.ts`
- Create: `src/siio/SiioUi.tsx`
- Modify: `src/main.tsx`
- Create: `tests/siio-manager-navigation-static.test.mjs`

**Interfaces:**
- Consumes: `api<T>` from `src/apiClient.ts`, `isManagementRole` from `src/navPermissions.ts`, `SiioCurrentProfile`, `SiioBootstrapPayload`, `parseSiioRouteState`, and `toSiioHash`.
- Produces: `SiioDashboard({ currentProfile }: { currentProfile: SiioCurrentProfile }): JSX.Element` and `SiioNavigation({ activeView, onSelect })`.

- [ ] **Step 1: Write a RED shell/static contract**

Create `tests/siio-manager-navigation-static.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const main = readFileSync('src/main.tsx', 'utf8');
const dashboard = readFileSync('src/siio/SiioDashboard.tsx', 'utf8');
const navigation = readFileSync('src/siio/SiioNavigation.tsx', 'utf8');
for (const label of ['Resumen ejecutivo', 'Seguimiento gerencial', 'Fuentes e inteligencia', 'Agentes']) assert.match(navigation, new RegExp(label));
assert.doesNotMatch(navigation, /F1-F6|Registro F2|Archivo F4|Razonamiento F5|Modo Junta/);
assert.match(dashboard, /api<SiioBootstrapPayload>\('\/api\/siio\/bootstrap'\)/);
assert.match(dashboard, /window\.addEventListener\('hashchange'/);
assert.match(dashboard, /isManagementRole\(currentProfile\.role\)/);
assert.match(main, /import \{ SiioDashboard \} from '\.\/siio\/SiioDashboard';/);
assert.match(main, /if \(route\.page === 'siio'\) return <SiioDashboard currentProfile=\{data\.currentProfile\} \/>/);
assert.doesNotMatch(main, /function SiioDashboard\(/);
console.log('SIIO managerial navigation shell contract OK');
```

- [ ] **Step 2: Verify RED**

Run: `node tests/siio-manager-navigation-static.test.mjs`

Expected: FAIL because SIIO modules do not exist and the old inline `SiioDashboard` remains in `src/main.tsx`.

- [ ] **Step 3: Implement the accessible four-option navigation**

Create `src/siio/SiioNavigation.tsx` with buttons generated from this immutable array:

```tsx
const items: Array<{ view: SiioView; label: string }> = [
  { view: 'resumen', label: 'Resumen ejecutivo' },
  { view: 'seguimiento', label: 'Seguimiento gerencial' },
  { view: 'inteligencia', label: 'Fuentes e inteligencia' },
  { view: 'agentes', label: 'Agentes' },
];
```

Render `<nav className="siio-navigation" aria-label="Navegación SIIO">`; each item is a `type="button"` button with `aria-current={activeView === view ? 'page' : undefined}`, active class, and `onClick={() => onSelect(view)}`. Do not render a global filter control or Board action here.

- [ ] **Step 4: Implement dashboard lifecycle and extraction**

Create `src/apiClient.ts` with the existing token behavior moved verbatim:

```ts
let currentAccessToken: string | null = null;
export function setApiAccessToken(token: string | null) { currentAccessToken = token; }
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = { 'Content-Type': 'application/json', ...(currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : {}), ...(options?.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Error ${res.status}`); }
  return res.json() as Promise<T>;
}
```

Create `src/siio/SiioUi.tsx` with no imports from `src/main.tsx`:

```tsx
import type { ReactNode } from 'react';
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const dates = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
export function fmtSiioMoney(value: number | null | undefined) { return money.format(Number(value || 0)); }
export function fmtSiioDate(value?: string | null) { return value ? dates.format(new Date(value)) : 'Pendiente'; }
export function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="panel"><h2>{title}</h2>{children}</section>; }
export function Badge({ tone = 'blue', children }: { tone?: 'blue' | 'green' | 'amber' | 'danger' | 'purple'; children: ReactNode }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><div>✓</div><strong>{title}</strong><p>{text}</p></div>; }
```

Create `SiioDashboard` with `payload`, `status`, and `routeState` state. Initialize route state with `parseSiioRouteState(window.location.hash)` and register/unregister `hashchange` in an unconditional effect. Use this guarded one-load effect so an unauthorized role never calls bootstrap while hook order remains valid:

```tsx
useEffect(() => {
  if (!isManagementRole(currentProfile.role)) return;
  void load();
}, [currentProfile.role]);
```

`load` calls `/api/siio/bootstrap` exactly once for the same authorized mount and never depends on route/filter state. `selectView` must set `window.location.hash = toSiioHash(navigateSiioView(view))`. After hooks, return the protected notice when `!isManagementRole(currentProfile.role)`. In this task, render `<SiioNavigation activeView={routeState.view} onSelect={selectView} />` followed by `<div className="notice">Cargando vista gerencial…</div>` when the bootstrap has not returned and `<div className="notice">La vista seleccionada se compondrá con los módulos SIIO extraídos.</div>` when it has returned; Tasks 5–7 replace this exact content area with the completed four views and Board action.

In `src/main.tsx`:

1. add `import { api, setApiAccessToken } from './apiClient';` and `import { SiioDashboard } from './siio/SiioDashboard';`;
2. delete local `currentAccessToken`, local `setApiAccessToken`, and local `api<T>` definitions; keep every current caller using the imported names unchanged;
3. delete `SiioTab`, `SiioBootstrap`, `SiioFront`, `SiioRecord`, `SiioSource`, `SiioDecision`, `SiioBoardReport`, and inline SIIO view functions from `formatSiioPeriod` through `SiioBoardView`;
4. retain CRM-only `money`, `dateFmt`, `fmtDate`, `Badge`, `Kpi`, `Panel`, `EmptyState`, permission helpers, route parsing, global drawer, and `RouterView`;
5. retain `if (route.page === 'siio') return <SiioDashboard currentProfile={data.currentProfile} />;`.

- [ ] **Step 5: Run shell contract and build GREEN**

Run:

```bash
node tests/siio-manager-navigation-static.test.mjs
npm run build
```

Expected: shell contract prints PASS; TypeScript/Vite builds without an inline SIIO duplicate, missing import, or unresolved component reference.

- [ ] **Step 6: Commit extraction shell**

```bash
git add src/main.tsx src/apiClient.ts src/siio/SiioDashboard.tsx src/siio/SiioNavigation.tsx src/siio/SiioUi.tsx tests/siio-manager-navigation-static.test.mjs
git diff --check
git commit -m "refactor: extract SIIO dashboard navigation shell"
```

---

### Task 5: Implement executive and management-tracking views with URL drill-down

**Files:**
- Create: `src/siio/SiioExecutiveView.tsx`
- Create: `src/siio/SiioManagementTrackingView.tsx`
- Modify: `src/siio/SiioDashboard.tsx`
- Modify: `tests/siio-manager-navigation-static.test.mjs`

**Interfaces:**
- Consumes: bootstrap payload, `deriveSiioExecutiveSnapshot`, `deriveTrackingItems`, `filterTrackingItems`, contextual filter values, and `onNavigate(state: SiioRouteState): void`.
- Produces: `SiioExecutiveView({ payload, routeState, onNavigate })` and `SiioManagementTrackingView({ payload, routeState, onNavigate })`.

- [ ] **Step 1: Add RED assertions for exclusive filters and no duplicated navigation**

Append to `tests/siio-manager-navigation-static.test.mjs`:

```js
const executive = readFileSync('src/siio/SiioExecutiveView.tsx', 'utf8');
const tracking = readFileSync('src/siio/SiioManagementTrackingView.tsx', 'utf8');
assert.match(executive, /period/);
assert.match(executive, /area/);
assert.match(tracking, /kind/);
assert.match(tracking, /semaphore/);
assert.match(tracking, /owner/);
assert.match(tracking, /Todos.*Decisiones.*Bloqueos.*Riesgos.*Compromisos/s);
assert.match(executive, /view: 'seguimiento'/);
assert.match(executive, /view: 'inteligencia'/);
assert.doesNotMatch(dashboard, /global.*filter/i);
```

- [ ] **Step 2: Verify RED**

Run: `node tests/siio-manager-navigation-static.test.mjs`

Expected: FAIL because executive and tracking files do not exist.

- [ ] **Step 3: Implement the executive view**

`SiioExecutiveView` must call `deriveSiioExecutiveSnapshot` once with payload financial metrics, payroll aggregates, and sources. It renders only `period` and `area` selects, filtering payroll aggregate rows by `area` and limiting financial rows to the selected period. It renders each financial KPI once, aggregate payroll once, validation/period labels, executive alert/priority counts, pending decisions, and the first recommendations from `deriveRecommendations(snapshot)`.

Use real navigation buttons only for actionable counts. Implement these destinations exactly:

```ts
const trackingLink = (kind: SiioTrackingKind) => onNavigate(navigateSiioView('seguimiento', { kind }));
const intelligenceLink = () => onNavigate(navigateSiioView('inteligencia'));
```

- alert, pending-decision, risk, and commitment buttons call `trackingLink` with the matching `kind`;
- recommendation and source-freshness buttons call `intelligenceLink()`;
- static metrics use `<div>` rather than buttons/anchors.

The payroll table must contain only area, people count, aggregate accrued/deductions/net total, and control state. It must not include identifiers, employee labels, individual rows, or salary fields.

- [ ] **Step 4: Implement management tracking**

`SiioManagementTrackingView` derives once:

```ts
const items = useMemo(() => deriveTrackingItems(payload.records, payload.decisions), [payload.records, payload.decisions]);
const visible = useMemo(() => filterTrackingItems(items, routeState.filters), [items, routeState.filters]);
```

Render the five internal `kind` buttons (`Todos`, `Decisiones`, `Bloqueos`, `Riesgos`, `Compromisos`) and the three exclusive select labels `Estado`, `Semáforo`, and `Responsable`. Each control updates only `navigateSiioView('seguimiento', { ...routeState.filters, changedKey })`. Render a horizontally scrollable table with type, title, F1–F6 front metadata, owner, status, semaphore, next action, and available due date. Do not make the front a primary tab.

- [ ] **Step 5: Wire both views and verify GREEN**

In `SiioDashboard`, import both modules and render by `routeState.view`; pass `onNavigate={state => { window.location.hash = toSiioHash(state); }}`. Run:

```bash
node tests/siio-manager-navigation-static.test.mjs
npm run check:siio-executive
npm run build
```

Expected: all three commands PASS.

- [ ] **Step 6: Commit executive and tracking views**

```bash
git add src/siio/SiioExecutiveView.tsx src/siio/SiioManagementTrackingView.tsx src/siio/SiioDashboard.tsx tests/siio-manager-navigation-static.test.mjs
git diff --check
git commit -m "feat: add SIIO executive and tracking views"
```

---

### Task 6: Implement intelligence and agents views with governed disclosures

**Files:**
- Create: `src/siio/SiioSourcesIntelligenceView.tsx`
- Create: `src/siio/SiioAgentsView.tsx`
- Modify: `src/siio/SiioDashboard.tsx`
- Modify: `tests/siio-manager-navigation-static.test.mjs`
- Modify: `tests/siio-agent-catalog-static.test.mjs`

**Interfaces:**
- Consumes: `filterSources`, `deriveRecommendations`, `SIIO_AGENT_CATALOG`, and the URL route state.
- Produces: intelligence filters `freshness`, `trust`, `sourceType`; agent filters `status`, `owner`; all governed agent fields visible in the UI.

- [ ] **Step 1: Add RED static contracts**

Append:

```js
const intelligence = readFileSync('src/siio/SiioSourcesIntelligenceView.tsx', 'utf8');
const agents = readFileSync('src/siio/SiioAgentsView.tsx', 'utf8');
for (const marker of ['Vigencia', 'Confianza', 'Tipo de fuente', 'Pendiente de evidencia', 'Periodo pendiente', 'Evidencia', 'Acción recomendada']) assert.match(intelligence, new RegExp(marker));
for (const marker of ['Propósito', 'Responsable institucional', 'Estado', 'Fuentes autorizadas', 'Acciones permitidas', 'Acciones prohibidas', 'Revisión humana obligatoria', 'Regla de auditoría', 'Siguiente gate']) assert.match(agents, new RegExp(marker));
assert.doesNotMatch(agents, /AGT-004|Asistente de Junta/);
```

- [ ] **Step 2: Verify RED**

Run: `node tests/siio-manager-navigation-static.test.mjs`

Expected: FAIL because intelligence and agents modules are absent.

- [ ] **Step 3: Implement sources and intelligence**

Render only three labeled selects: `Vigencia`, `Confianza`, and `Tipo de fuente`. Source rows show name, type, trust, last/next review dates, restrictions, related F1–F6 metadata, and external URL only when supplied by the source.

Render a recommendation article for every `deriveRecommendations(snapshot)` result. Include headings `Evidencia`, `Fuentes`, `Periodo de origen`, and `Acción recomendada`. Join known source IDs to source names; when no source is available render literal text `Pendiente de evidencia`. When period is null render literal text `Periodo pendiente`. Do not add click handlers that mutate records, sources, or decisions.

- [ ] **Step 4: Implement agent catalog view**

Import `SIIO_AGENT_CATALOG`. Filter only by `status` and `owner_role`; render visibly labelled controls `Estado` and `Responsable institucional`. Each card renders purpose, responsible institutional role, status, authorized fronts and sources, permitted actions, forbidden actions, `Revisión humana obligatoria`, audit rule, next gate, and `Sin escritura automática en producción`. Do not include a Board agent or any write button.

- [ ] **Step 5: Wire, test, and build GREEN**

Run:

```bash
node tests/siio-manager-navigation-static.test.mjs
node tests/siio-agent-catalog-static.test.mjs
npm run check:siio-agents
npm run build
```

Expected: all commands PASS; AGT-004 is absent from source contracts and executable catalog.

- [ ] **Step 6: Commit intelligence and agents views**

```bash
git add src/siio/SiioSourcesIntelligenceView.tsx src/siio/SiioAgentsView.tsx src/siio/SiioDashboard.tsx tests/siio-manager-navigation-static.test.mjs tests/siio-agent-catalog-static.test.mjs
git diff --check
git commit -m "feat: add SIIO intelligence and governed agents views"
```

---

### Task 7: Replace the Board tab with an accessible read-only Board-draft action

**Files:**
- Create: `src/siio/SiioBoardDraftAction.tsx`
- Modify: `src/siio/SiioDashboard.tsx`
- Modify: `tests/siio-executive-dashboard-static.test.mjs`
- Modify: `tests/siio-manager-navigation-static.test.mjs`

**Interfaces:**
- Consumes: `boardReports`, `boardSections`, financial snapshot, tracking items, sources, and recommendations already in the loaded payload.
- Produces: `SiioBoardDraftAction({ open, onClose, payload, snapshot, trackingItems, recommendations })` and a header trigger labelled `Preparar informe de Junta`.

- [ ] **Step 1: Write RED Board-action contracts**

Replace obsolete Modo Junta assertions in `tests/siio-executive-dashboard-static.test.mjs` with:

```js
assert.match(dashboard, /Preparar informe de Junta/, 'SIIO header must expose the governed Board action');
assert.doesNotMatch(navigation, /Modo Junta/, 'Board must not be a navigation tab');
assert.match(board, /Borrador sujeto a revisión humana/, 'Board output must disclose the human gate');
assert.match(board, /window\.print\(\)/, 'Board action must only print/export the local draft');
assert.doesNotMatch(board, /api\(|fetch\(|method:\s*['"]POST|method:\s*['"]PUT|method:\s*['"]PATCH|method:\s*['"]DELETE/, 'Board action must not call a persistent endpoint');
assert.match(board, /role="dialog"/, 'Board surface must be a dialog');
assert.match(board, /aria-modal="true"/, 'Board dialog must be modal');
assert.match(board, /onKeyDown/, 'Board dialog must close on Escape');
```

Read `dashboard`, `navigation`, and `board` from their exact module paths at the start of the test.

- [ ] **Step 2: Verify RED**

Run: `node tests/siio-executive-dashboard-static.test.mjs`

Expected: FAIL because Board is still an inline tab or the module does not yet exist.

- [ ] **Step 3: Implement the controlled dialog**

Render the trigger in the dashboard header only after the defensive management-role check. In `SiioBoardDraftAction`, return `null` when `open` is false. When open, use:

```tsx
<div className="siio-board-backdrop" onMouseDown={onClose}>
  <section className="siio-board-dialog" role="dialog" aria-modal="true" aria-labelledby="siio-board-title" onMouseDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') onClose(); }} tabIndex={-1}>
```

Focus the dialog on open with a `useRef<HTMLElement>` and `useEffect`. Provide a visible close button with `aria-label="Cerrar borrador de Junta"`. Render only: loaded Board reports/sections, selected financial/payroll periods and validation state, source freshness/restrictions, derived tracking items, and recommendations. Every section with data uses loaded values; empty data uses the existing empty-state component. Render the persistent caution `Borrador sujeto a revisión humana` and an `Imprimir / exportar borrador` button calling `window.print()`.

- [ ] **Step 4: Remove obsolete Board navigation**

Ensure neither `src/main.tsx` nor any `src/siio/*.tsx` declares `SiioTab`, `activeTab`, `Modo Junta`, `SiioBoardView`, or a `junta` view key. The only permitted Board UI text is the action heading and draft content labels.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
node tests/siio-executive-dashboard-static.test.mjs
node tests/siio-manager-navigation-static.test.mjs
npm run build
```

Expected: all commands PASS, with no write endpoint marker in the Board module.

- [ ] **Step 6: Commit Board action**

```bash
git add src/siio/SiioBoardDraftAction.tsx src/siio/SiioDashboard.tsx tests/siio-executive-dashboard-static.test.mjs tests/siio-manager-navigation-static.test.mjs
git diff --check
git commit -m "feat: add governed SIIO Board draft action"
```

---

### Task 8: Add SIIO-scoped responsive and accessibility styles

**Files:**
- Create: `src/siio/siio.css`
- Modify: `src/siio/SiioDashboard.tsx`
- Modify: `tests/siio-manager-navigation-static.test.mjs`

**Interfaces:**
- Consumes: semantic classes from all SIIO modules and existing global CRM table/drawer styles.
- Produces: `.siio-navigation`, `.siio-view-filters`, `.siio-table-wrap`, `.siio-board-dialog`, focus-visible styles, and narrow/mobile layout behavior.

- [ ] **Step 1: Add RED CSS contract assertions**

Append:

```js
const css = readFileSync('src/siio/siio.css', 'utf8');
for (const selector of ['.siio-navigation', '.siio-navigation button:focus-visible', '.siio-view-filters', '.siio-table-wrap', '.siio-board-dialog', '.siio-board-backdrop', '@media(max-width:760px)']) assert.ok(css.includes(selector), `missing SIIO CSS selector: ${selector}`);
assert.match(css, /overflow-x:auto/, 'SIIO wide tables must retain horizontal scroll');
assert.match(css, /max-height:calc\(100vh - 32px\)/, 'Board dialog must fit mobile viewport');
```

- [ ] **Step 2: Verify RED**

Run: `node tests/siio-manager-navigation-static.test.mjs`

Expected: FAIL because `src/siio/siio.css` does not exist.

- [ ] **Step 3: Add scoped stylesheet and import it once**

Create `src/siio/siio.css` and import it only from `SiioDashboard.tsx`. Include exact behavior:

```css
.siio-navigation{display:flex;gap:8px;overflow-x:auto;padding:2px 0 8px;scrollbar-width:thin}
.siio-navigation button{flex:0 0 auto;background:#eef4ff;color:#27456f;box-shadow:none;border:1px solid #d5e2f5}
.siio-navigation button.active{background:#174ea6;color:#fff;border-color:#174ea6}
.siio-navigation button:focus-visible,.siio-board-dialog button:focus-visible,.siio-view-filters select:focus-visible{outline:3px solid #60a5fa;outline-offset:3px}
.siio-view-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:end;padding:14px;border:1px solid #dbe7f5;border-radius:18px;background:#f8fbff}
.siio-view-filters label{display:grid;gap:6px;min-width:170px;color:#40516b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.05em}
.siio-table-wrap{overflow-x:auto;max-width:100%;border:1px solid #e2eaf5;border-radius:16px}
.siio-table-wrap table{min-width:900px}
.siio-board-backdrop{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:16px;background:rgba(8,15,28,.58)}
.siio-board-dialog{width:min(980px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:22px;border-radius:22px;background:#fff;box-shadow:0 30px 70px rgba(8,15,28,.34)}
@media(max-width:760px){.siio-view-filters{display:grid;grid-template-columns:1fr}.siio-view-filters label{min-width:0}.siio-board-backdrop{align-items:end;padding:0}.siio-board-dialog{width:100%;max-height:calc(100vh - 16px);border-radius:22px 22px 0 0}.siio-navigation{margin-inline:-2px}}
```

Do not edit `.sidebar`, `.topbar-menu-toggle`, CRM pagination, tender table, or existing global mobile drawer CSS.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node tests/siio-manager-navigation-static.test.mjs
npm run build
```

Expected: PASS; stylesheet is imported through SIIO dashboard and does not overwrite CRM shell selectors.

- [ ] **Step 5: Commit SIIO styles**

```bash
git add src/siio/siio.css src/siio/SiioDashboard.tsx tests/siio-manager-navigation-static.test.mjs
git diff --check
git commit -m "style: add responsive accessible SIIO navigation"
```

---

### Task 9: Execute full regression, preview, and authenticated visual QA gates

**Files:**
- Create: `docs/qa/siio-manager-navigation-verification.md`

**Interfaces:**
- Consumes: completed code, test suites, local Vite preview, existing protected authentication, and a human-authorized preview environment.
- Produces: factual verification report with commands/results, screenshots, QA findings, and explicit no-production-change confirmation.

- [ ] **Step 1: Run the complete automated regression suite**

Run:

```bash
for test in tests/*.test.mjs; do node "$test"; done
python3 -m unittest tests/siio-board-source-extractor.test.py
npm run check:siio-integration
npm run check:siio-executive
npm run check:siio-agents
npm run check:nav-permissions
npm run build
git diff --check
```

Expected: every Node checker prints its success line, Python reports `OK`, build exits 0, and `git diff --check` prints nothing.

- [ ] **Step 2: Start a local preview and verify it responds**

Run in one terminal:

```bash
npm run preview -- --port 4173
```

Run in another terminal:

```bash
curl -I http://127.0.0.1:4173/
```

Expected: preview stays running and curl returns `HTTP/1.1 200 OK`.

- [ ] **Step 3: Perform authenticated route and permission QA**

Using a non-production preview and authorized test accounts, verify:

1. admin, gerencia, and director see SIIO in the CRM sidebar and can load `#/siio?view=resumen`;
2. commercial does not see SIIO and direct `#/siio?view=resumen` receives the existing denial UI without a SIIO bootstrap request;
3. invalid `#/siio?view=wrong&period=2026-06-01` lands in `Resumen ejecutivo` with period retained;
4. change every SIIO view and filter, use browser Back/Forward, and confirm only view-owned query keys remain;
5. use executive alert/decision/risk/commitment controls and confirm they land in `Seguimiento gerencial` with matching `kind`;
6. use recommendation/source controls and confirm they land in `Fuentes e inteligencia`;
7. open/close Board action with click and Escape, inspect that it has only loaded information, displays human-review state, and print opens browser print UI without network writes.

- [ ] **Step 4: Capture required visual evidence**

Capture authenticated screenshots at desktop `1440x900` and mobile `390x844` for each exact state:

```text
resumen-desktop.png
resumen-mobile.png
seguimiento-desktop.png
seguimiento-mobile.png
inteligencia-desktop.png
inteligencia-mobile.png
agentes-desktop.png
agentes-mobile.png
junta-borrador-desktop.png
junta-borrador-mobile.png
```

For each mobile capture, include the CRM drawer closed and one separate capture with it open. Check no horizontal document overflow, visible keyboard focus, readable filters, horizontally scrollable wide tables, pagination where the underlying list requires it, and the existing drawer/Escape behavior.

- [ ] **Step 5: Run privacy and no-write inspection**

Run:

```bash
! rg -n -i 'cedula|cédula|salario individual|nombre empleado|employee_name|board-reports/generate|generate-draft' src/siio tests/siio-* scripts/check_siio_agent_catalog.mjs
! rg -n "api\(|fetch\(|method:\s*['\"](POST|PUT|PATCH|DELETE)" src/siio/SiioBoardDraftAction.tsx
```

Expected: both commands exit 0 with no matching output. If a legitimate source type or test fixture triggers a privacy string, replace it with aggregate-safe test data and rerun; do not waive the check.

- [ ] **Step 6: Record concrete verification evidence**

Create `docs/qa/siio-manager-navigation-verification.md` containing: exact commit SHA tested; actual command output summaries; route/role matrix; screenshot paths; desktop/mobile findings; no-write inspection output; known empty-data states; preview URL only if a preview was actually created; and the statement `No se aplicaron migraciones, no se modificó Supabase productivo, no hubo merge y no se desplegó producción.`

- [ ] **Step 7: Commit verification evidence without pushing or deploying**

```bash
git add docs/qa/siio-manager-navigation-verification.md
git diff --check
git commit -m "docs: verify SIIO managerial navigation"
```

Expected: local commit only. Do not run `git push`, Vercel deployment, merge, or production migration commands.

---

## Final Implementation Acceptance Checklist

- [ ] Exactly four primary SIIO views are visible and each has its required label.
- [ ] F1–F6 and Board are absent from primary navigation; F1–F6 remain secondary metadata where records expose them.
- [ ] URL route parsing, canonical serialization, invalid-view fallback, contextual-filter ownership, and browser history all work.
- [ ] Executive drill-down opens the correct destination/filter without duplicate KPI presentations.
- [ ] Tracking combines records and decisions without duplicate subjects and preserves owner/status/semaphore/next-action metadata.
- [ ] Intelligence shows traceable recommendation sources/periods or explicit pending disclosures.
- [ ] Agent catalog contains AGT-001 through AGT-003 only, with Board drafting governed under AGT-001.
- [ ] Board action is read-only, human-review labelled, keyboard-dismissible, printable, and has no persistent endpoint or mutation.
- [ ] Commercial role cannot navigate to SIIO or see SIIO content; aggregate payroll privacy remains intact.
- [ ] Existing CRM drawer, responsiveness, pagination, deduplication, and non-SIIO checks remain green.
- [ ] Automated checks, build, visual QA, and preview verification have real recorded evidence; no production action occurred.
