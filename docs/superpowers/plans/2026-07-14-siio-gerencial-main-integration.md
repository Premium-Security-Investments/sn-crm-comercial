# SIIO Gerencial Main Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recuperar el SIIO Gerencial existente en el `main` actual, separar el Dashboard comercial bajo Comercial y compactar el sidebar sin perder las correcciones del PR #13.

**Architecture:** `main` (`937aed5`) es la única base. La rama `feature/siio-main-integration` (`d1f1052`) se usa como fuente de componentes y módulos, nunca como merge completo. Los módulos puros SIIO se portan primero; después API/migraciones; al final se integran ruta, navegación y estilos sobre la UI vigente.

**Tech Stack:** React 19, TypeScript, Vite, Express/Vercel serverless, Supabase, Node `.mjs`, Python 3 + `openpyxl` para extractor ya existente.

## Global Constraints

- Identidad superior: `SIIO` y descriptor `Sistema Integrado de Información Operativa`.
- Gerencia enlaza `#/siio`; Dashboard comercial vive bajo Comercial en `#/dashboard2`.
- No hacer merge ciego de `feature/siio-main-integration`.
- Conservar paginación, deduplicación, responsive, drawer y Escape del PR #13.
- No escribir en Supabase producción ni modificar SharePoint sin gate explícito.
- No exponer datos individuales de nómina, salarios, identificaciones ni deducciones.
- Finanzas y nómina mantienen periodos independientes.
- TDD RED → GREEN para cada cambio funcional.

---

### Task 1: Baseline y contrato de integración

**Files:**
- Create: `tests/siio-main-integration-static.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `src/main.tsx`, `src/styles.css`, scripts de tests existentes.
- Produces: checker `npm run check:siio-integration` que protege rutas, etiquetas y preservación de PR #13.

- [ ] **Step 1: Ejecutar baseline completo**

Run:
```bash
for f in tests/*.test.mjs; do node "$f"; done
npm run build
git diff --check
```
Expected: todos los tests existentes y build PASS antes de portar SIIO.

- [ ] **Step 2: Escribir checker RED**

Create `tests/siio-main-integration-static.test.mjs`:
```js
import fs from 'node:fs';
import assert from 'node:assert/strict';
const main = fs.readFileSync('src/main.tsx', 'utf8');
const css = fs.readFileSync('src/styles.css', 'utf8');
for (const marker of [
  "| 'siio'", "href=\"#/siio\"", 'SIIO Gerencial',
  'Sistema Integrado de Información Operativa',
  "href=\"#/dashboard2\">Dashboard comercial",
  "route.page === 'siio'", '<SiioDashboard',
  'OPPORTUNITIES_PAGE_SIZE = 25', 'TENDER_PAGE_SIZE = 24',
  'deduplicateTenders', 'event.key === \'Escape\''
]) assert.ok(main.includes(marker), `missing main marker: ${marker}`);
for (const marker of [
  '.sidebar-nav-scroll', 'overflow-y:auto',
  'grid-template-columns:232px minmax(0,1fr)',
  '.sidebar-footer-compact'
]) assert.ok(css.includes(marker), `missing css marker: ${marker}`);
console.log('siio main integration static checks passed');
```

- [ ] **Step 3: Verificar RED**

Run: `node tests/siio-main-integration-static.test.mjs`
Expected: FAIL en el primer marcador SIIO ausente; confirma que el test detecta la integración faltante.

- [ ] **Step 4: Registrar script**

Add to `package.json` scripts:
```json
"check:siio-integration": "node tests/siio-main-integration-static.test.mjs"
```

- [ ] **Step 5: Commit RED**

```bash
git add tests/siio-main-integration-static.test.mjs package.json
git commit -m "test: definir contrato de integración SIIO"
```

---

### Task 2: Portar módulos puros y permisos SIIO

**Files:**
- Create: `src/navPermissions.ts`
- Create: `src/siioExecutive.ts`
- Create: `src/siioAgents.ts`
- Create: `tests/siio-executive-dashboard-static.test.mjs`
- Create: `tests/siio-agent-catalog-static.test.mjs`
- Create: `scripts/check_siio_executive_snapshot.mjs`
- Create: `scripts/check_siio_agent_catalog.mjs`
- Create: `scripts/check_nav_permissions.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `canAccessSiio(profile)`, `canAccessRoute(profile,page)`, `getVisibleNavGroups(profile)`, `deriveSiioExecutiveSnapshot(input)`, catálogo gobernado F6.
- Consumes later: frontend route guard, `SiioDashboard`, API/UI checkers.

- [ ] **Step 1: Copiar pruebas/checkers desde la fuente antes del código**

```bash
git show feature/siio-main-integration:tests/siio-executive-dashboard-static.test.mjs > tests/siio-executive-dashboard-static.test.mjs
git show feature/siio-main-integration:tests/siio-agent-catalog-static.test.mjs > tests/siio-agent-catalog-static.test.mjs
git show feature/siio-main-integration:scripts/check_siio_executive_snapshot.mjs > scripts/check_siio_executive_snapshot.mjs
git show feature/siio-main-integration:scripts/check_siio_agent_catalog.mjs > scripts/check_siio_agent_catalog.mjs
git show feature/siio-main-integration:scripts/check_nav_permissions.mjs > scripts/check_nav_permissions.mjs
```

- [ ] **Step 2: Verificar RED**

Run:
```bash
node scripts/check_siio_executive_snapshot.mjs
node scripts/check_siio_agent_catalog.mjs
node scripts/check_nav_permissions.mjs
```
Expected: FAIL por módulos `src/siioExecutive.ts`, `src/siioAgents.ts` y `src/navPermissions.ts` ausentes.

- [ ] **Step 3: Portar módulos exactos desde `d1f1052`**

```bash
git show d1f1052:src/siioExecutive.ts > src/siioExecutive.ts
git show d1f1052:src/siioAgents.ts > src/siioAgents.ts
git show d1f1052:src/navPermissions.ts > src/navPermissions.ts
```

Adjust `getVisibleNavGroups` so its exact grouping is:
```ts
Gerencia: SIIO Gerencial, Vig-IA
Comercial: Dashboard comercial, Alertas comerciales, Oportunidades
Licitaciones: Radar, Seguimiento, Expedientes, Perfiles
Administración: Metas y cumplimiento, Usuarios y permisos
```

- [ ] **Step 4: Agregar scripts package**

Add:
```json
"check:siio-executive": "node scripts/check_siio_executive_snapshot.mjs",
"check:siio-agents": "node scripts/check_siio_agent_catalog.mjs",
"check:nav-permissions": "node scripts/check_nav_permissions.mjs"
```

- [ ] **Step 5: Verificar GREEN**

Run the three commands from Step 2.
Expected: PASS para snapshot, agentes y navegación.

- [ ] **Step 6: Commit**

```bash
git add src/navPermissions.ts src/siioExecutive.ts src/siioAgents.ts tests/siio-* scripts/check_siio_* scripts/check_nav_permissions.mjs package.json
git commit -m "feat: recuperar núcleo y permisos SIIO"
```

---

### Task 3: Recuperar esquema y API autenticada sin escribir producción

**Files:**
- Create: `supabase/migrations/014_siio_f2_foundation.sql`
- Create: `supabase/migrations/015_siio_official_fronts_seed.sql`
- Create: `supabase/migrations/016_siio_initial_executive_snapshot_seed.sql`
- Modify: `api/[...path].js`
- Modify: `server/index.js`
- Create: `scripts/check_backend_permission_guards.mjs`
- Create: `tests/siio-board-source-extractor.test.py`
- Create: `scripts/extract_siio_board_sources.py`

**Interfaces:**
- Produces: authenticated `GET /api/siio/bootstrap` and guarded SIIO write routes.
- Consumes: Supabase tables from migrations 014–016; current bearer/session helpers.

- [ ] **Step 1: Portar checker y prueba antes de implementación**

```bash
git show d1f1052:scripts/check_backend_permission_guards.mjs > scripts/check_backend_permission_guards.mjs
git show d1f1052:tests/siio-board-source-extractor.test.py > tests/siio-board-source-extractor.test.py
```

- [ ] **Step 2: Verificar RED**

Run:
```bash
node scripts/check_backend_permission_guards.mjs
python3 -m unittest tests/siio-board-source-extractor.test.py
```
Expected: backend guard checker y extractor test FAIL por implementación ausente.

- [ ] **Step 3: Portar migraciones y extractor sin aplicarlos**

```bash
for f in 014_siio_f2_foundation.sql 015_siio_official_fronts_seed.sql 016_siio_initial_executive_snapshot_seed.sql; do
  git show "d1f1052:supabase/migrations/$f" > "supabase/migrations/$f"
done
git show d1f1052:scripts/extract_siio_board_sources.py > scripts/extract_siio_board_sources.py
```

- [ ] **Step 4: Integrar API por diff controlado**

Use:
```bash
git diff main..d1f1052 -- api/[...path].js server/index.js
```
Port only `/api/siio/*`, SIIO helpers and permission guards into current files. Preserve every tender/profile/alert endpoint from `main`. All SIIO writes must call the same management-role authorization used by the branch.

- [ ] **Step 5: Verificar GREEN y ausencia de PII**

Run:
```bash
node scripts/check_backend_permission_guards.mjs
python3 -m unittest tests/siio-board-source-extractor.test.py
python3 - <<'PY'
from pathlib import Path
for path in [Path('data/siio'), Path('supabase/migrations/016_siio_initial_executive_snapshot_seed.sql')]:
    files = path.rglob('*') if path.is_dir() else [path]
    for file in files:
        if file.is_file():
            text = file.read_text(errors='ignore').lower()
            forbidden = [key for key in ('documento', 'cedula', 'salario', 'nombre_empleado') if key in text]
            if forbidden:
                raise SystemExit(f'PII marker in {file}: {forbidden}')
print('privacy marker scan passed')
PY
```
Expected: checkers PASS; privacy scan PASS sin identity fields en snapshot/seed.

- [ ] **Step 6: Verificar estado remoto de migraciones sin escribir**

Query Supabase migration metadata/schema read-only. Record whether tables `siio_fronts`, `siio_records`, `siio_decisions`, `siio_sources`, `siio_financial_metrics`, and `siio_payroll_aggregates` exist. Do not apply SQL in this task.

- [ ] **Step 7: Commit**

```bash
git add api/[...path].js server/index.js supabase/migrations/014_siio_f2_foundation.sql supabase/migrations/015_siio_official_fronts_seed.sql supabase/migrations/016_siio_initial_executive_snapshot_seed.sql scripts/check_backend_permission_guards.mjs scripts/extract_siio_board_sources.py tests/siio-board-source-extractor.test.py
git commit -m "feat: recuperar API y esquema SIIO"
```

---

### Task 4: Integrar ruta y UI SIIO sobre `main`

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `tests/siio-main-integration-static.test.mjs`
- Modify: `tests/siio-executive-dashboard-static.test.mjs`

**Interfaces:**
- Consumes: `deriveSiioExecutiveSnapshot`, `SIIO_AGENTS`, permission helpers, `/api/siio/bootstrap`.
- Produces: `#/siio`, `SiioDashboard`, `SiioExecutiveHome`, tabs F1–F6 y Modo Junta.

- [ ] **Step 1: Ampliar RED con comportamiento de UI**

Assert exact markers:
```js
"type SiioTab = 'inicio' | 'frentes' | 'registros' | 'decisiones' | 'fuentes' | 'junta'"
'function SiioDashboard'
'function SiioExecutiveHome'
"if (route.page === 'siio') return <SiioDashboard"
"canAccessRoute(data.currentProfile, route.page)"
```
Run `node tests/siio-main-integration-static.test.mjs`; expected FAIL.

- [ ] **Step 2: Portar tipos/imports y componentes por bloques**

Use `git show d1f1052:src/main.tsx` as source. Port only:
- SIIO imports and types;
- `'siio'` in `Route` and `parseRoute`;
- `SiioDashboard`, `SiioExecutiveHome`, fronts, records, decisions, sources, board and agent views;
- route title/document title/login copy for SIIO;
- render branch for `route.page === 'siio'`.

Do not replace the full current `src/main.tsx`.

- [ ] **Step 3: Integrar permisos directos**

Before rendering a protected route, evaluate `canAccessRoute(currentProfile, route.page)`. For unauthorized `#/siio`, render a notice with link to an allowed route; never call `/api/siio/bootstrap`.

- [ ] **Step 4: Portar estilos SIIO específicos**

Diff:
```bash
git diff main..d1f1052 -- src/styles.css
```
Port selectors prefixed `.siio-` and their responsive rules. Do not replace current rules for `.dashboard-v2`, `.tender-*`, `.sidebar` or alert cards.

- [ ] **Step 5: Verificar GREEN**

Run:
```bash
npm run check:siio-integration
npm run check:siio-executive
npm run check:siio-agents
npm run check:nav-permissions
npm run build
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.tsx src/styles.css tests/siio-main-integration-static.test.mjs tests/siio-executive-dashboard-static.test.mjs
git commit -m "feat: integrar SIIO Gerencial en main"
```

---

### Task 5: Separar navegación y compactar sidebar

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `tests/siio-main-integration-static.test.mjs`

**Interfaces:**
- Consumes: `getVisibleNavGroups`, drawer actual.
- Produces: sidebar SIIO compacto con navegación scrollable y footer reducido.

- [ ] **Step 1: Escribir/ajustar RED de estructura**

Require:
```tsx
<div className="brand"><small>Seguridad Nacional Ltda</small><em>SIIO</em><span>Sistema Integrado de Información Operativa</span></div>
<div className="sidebar-nav-scroll"><Nav ... /></div>
<div className="sidebar-footer-compact">...</div>
```
Also assert Gerencia excludes Dashboard comercial and Comercial includes it. Run checker; expected FAIL.

- [ ] **Step 2: Implementar estructura mínima**

Wrap only the navigation in `.sidebar-nav-scroll`. Keep brand and footer outside. Render nav groups from permissions without moving SIIO under Comercial.

- [ ] **Step 3: Implementar CSS compacto**

Desktop contract:
```css
.app{grid-template-columns:232px minmax(0,1fr)}
.sidebar{padding:16px;gap:12px;overflow:hidden}
.sidebar-nav-scroll{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.sidebar-footer-compact{display:grid;gap:8px}
```
Reduce brand, nav link, section gap, session card and action-button heights. Preserve mobile drawer rules and ensure `.sidebar` itself can scroll as fallback at short heights.

- [ ] **Step 4: Verificar GREEN**

Run:
```bash
npm run check:siio-integration
node tests/qa-postdeploy-fixes-static.test.mjs
npm run build
```
Expected: PASS; PR #13 markers remain present.

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx src/styles.css tests/siio-main-integration-static.test.mjs
git commit -m "fix: separar dashboards y compactar navegación SIIO"
```

---

### Task 6: Verificación integral, preview y gate

**Files:**
- Create: `docs/qa/siio-main-integration-verification.md`

**Interfaces:**
- Consumes: aplicación integrada completa.
- Produces: evidencia mecánica y visual para PR/preview; no producción.

- [ ] **Step 1: Ejecutar suite completa fresca**

```bash
for f in tests/*.test.mjs; do node "$f"; done
python3 -m unittest tests/siio-board-source-extractor.test.py
npm run build
git diff --check
```
Expected: cero fallos.

- [ ] **Step 2: Ejecutar API y frontend local**

Start API and Vite on isolated ports. Create one admin QA temporal and one commercial QA temporal. Do not use personal credentials.

- [ ] **Step 3: QA autenticado de permisos/rutas**

Admin/gerencia:
- sees Gerencia → SIIO Gerencial;
- sees Comercial → Dashboard comercial;
- opens `#/siio` and receives real executive data.

Commercial:
- does not see SIIO;
- direct `#/siio` is denied;
- Dashboard comercial behavior follows the approved permission matrix.

- [ ] **Step 4: QA visual sidebar**

Viewport desktop 1366×768 and 1440×900:
- `document.documentElement.scrollWidth === clientWidth`;
- sidebar navigation scroll height is bounded;
- session/actions remain accessible;
- brand shows SIIO.

Viewport mobile 390×844:
- drawer closed/open/scroll/Escape;
- no horizontal overflow.

- [ ] **Step 5: QA de regresión**

Verify:
- Oportunidades 25/page;
- Radar 24/page and deduplicated;
- Perfiles isolated;
- alerts/cards and users routes load;
- console/errors empty.

- [ ] **Step 6: Documentar evidencia**

Write `docs/qa/siio-main-integration-verification.md` with commands, counts, routes, screenshots, migration read-only findings and unresolved warnings.

- [ ] **Step 7: Commit y abrir PR/preview**

```bash
git add docs/qa/siio-main-integration-verification.md
git commit -m "docs: verificar integración SIIO Gerencial"
git push -u origin feature/integrate-siio-gerencial
gh pr create --base main --head feature/integrate-siio-gerencial --title "feat: recuperar SIIO Gerencial" --body-file /tmp/siio-pr.md
```
Deploy Vercel preview only. Do not merge or deploy production without Juan's explicit authorization.
