# CRM Comercial SN — Visual Recovery Implementation Plan

> **For Hermes:** Use this as the controlling implementation plan before changing additional UI. Scope is frontend visual realignment only. Do **not** touch backend, tender cron, Supabase persistence, API routes, Hermes scripts, or Discord reporting unless Juan explicitly approves a separate backend task.

**Goal:** Realign the entire CRM Comercial SN platform to the external designer's visual system using the five delivered PNGs as the canonical reference, and extrapolate that system carefully to screens that did not receive PNGs.

**Architecture:** Keep the existing React/Vite single-file application structure for now (`src/main.tsx` + `src/styles.css`) but introduce/standardize reusable visual primitives before refactoring screens. Apply changes in small, screen-scoped commits so each stage can be QA'd and rolled back independently.

**Tech Stack:** React + TypeScript, Vite, Supabase-backed data, Vercel deployment.

**Current verification command:** `package.json` has no `npm test` script, so run static tests with `for f in tests/*.mjs; do node "$f" || exit 1; done` followed by `npm run build`.

---

## Canonical Design Sources

Designer PNGs available locally at `/tmp/sn_design_pngs/screens/`:

1. `01 Dashboard gerencial.png`
2. `02 Oportunidades.png`
3. `03 Licitaciones.png`
4. `04 Vig-IA.png`
5. `05 Usuarios y permisos.png`

Backup ZIP: `/root/.hermes/cache/documents/doc_877046f4e76c_Seguridad_Nacional_2.zip`.

Screens without designer PNGs, requiring disciplined extrapolation:

- Alertas comerciales
- Metas y cumplimiento
- Crear oportunidad
- Detalle de oportunidad / detalle por consultor if touched
- Empty/loading/error states

---

## Non-Negotiable Constraints

1. **No backend changes** in this visual recovery pass.
   - Do not edit `api/[...path].js`.
   - Do not edit `server/index.js`.
   - Do not edit tender sync scripts, cron jobs, Supabase schema, or Discord reporting.
2. **No invented sections** unless clearly derived from a PNG pattern and useful to existing CRM data.
3. **No white cards on dark backgrounds** unless a PNG explicitly shows a light surface for that exact component. Current system must remain dark-mode coherent.
4. **No duplicated page titles** inside heroes. Topbar owns the page title; hero title should express the business/job-to-be-done.
5. **Hero pattern is compact:** left narrative + right KPI grid, usually 2×2.
6. **Filters sit below hero** and must be compact.
7. **Dropdown labels:** external label names the filter; selected options must be short. Example: label `Prioridad`, option `Todas`, not `Prioridad: Todas`.
8. **Keep real data and real permissions.** Do not hardcode demo values from PNGs.
9. **Commits separated by screen/pattern** for QA and rollback.
10. **Deploy via remote Vercel:** `vercel deploy --prod --yes`, not local `--prebuilt`, unless explicitly needed.

---

## Extracted Visual System From the 5 PNGs

### 1. Shell / Navigation

Canonical pattern across all PNGs:

- Fixed left sidebar, dark navy/black background.
- Brand block: shield/mark + `SEGURIDAD NACIONAL` + `CRM Comercial`.
- Sidebar search with shortcut hint (`⌘K`) appears in designer system.
- Navigation grouped by labels:
  - `COMERCIAL`: Dashboard, Oportunidades, Licitaciones
  - `INTELIGENCIA`: Vig-IA
  - `ADMINISTRACIÓN`: Usuarios y permisos
- Badges are small rounded pills.
- Active item uses dark-blue elevated background + white text.
- User profile card at bottom with initials, name, role.

Current app deviations:

- Sidebar includes `Alertas`, `Crear oportunidad`, and `Metas y cumplimiento` as primary nav items. These may remain if business-critical, but must visually align and should not overcrowd the canonical groups.
- Search shortcut is not implemented in the current sidebar.
- Session controls (`Actualizar datos`, `Cerrar sesión`) are utility actions but currently compete visually with the nav/footer.

Recommended handling:

- Preserve functional nav items for now to avoid hiding key modules.
- Group extrapolated screens under appropriate sections:
  - Alertas under Comercial.
  - Crear oportunidad under Comercial or as CTA only, not necessarily permanent nav if it clutters.
  - Metas under Inteligencia/Gestión, depending current IA.
- Defer sidebar IA reduction until after screen-level recovery unless Juan approves navigation simplification.

### 2. Topbar

Canonical pattern:

- Breadcrumb: `CRM · Seguridad Nacional`.
- H1 page title.
- Sync/status chip: green dot + `Actualizado hace 3 min` style.
- Utility icon buttons: notifications, dark mode.
- Primary CTA: `+ Nueva oportunidad`.

Current app deviations:

- Topbar is close but simpler.
- Current status text is generic `Actualizado`, not timestamped.
- Utility icons are missing.

Recommended handling:

- Keep topbar functional and consistent; do not invent notifications if they do not exist.
- Do not block visual recovery on utility icons.
- If timestamp is unavailable, keep `Actualizado` but style like the PNG.

### 3. Hero Pattern

Canonical pattern across Dashboard, Oportunidades, Licitaciones, Vig-IA, Usuarios:

```text
┌────────────────────────────────────┬──────────────────────────────┐
│ Eyebrow / module label             │ KPI 1        KPI 2           │
│ Contextual hero title              │ KPI 3        KPI 4           │
│ Short business description         │                              │
└────────────────────────────────────┴──────────────────────────────┘
```

Rules:

- Hero background: dark elevated surface (`#0E1426` / `#111827` family), subtle border.
- Left column ~55–65%; right KPI grid ~35–45%.
- KPI grid generally 2×2.
- KPI cells use uppercase labels, colored dots, large values, small subtitles.
- Hero title is contextual, not duplicate page title.

Current deviations:

- Dashboard currently has a large command hero plus a separate manager action panel, creating visual weight beyond the PNG.
- Licitaciones currently duplicates `Licitaciones` inside hero and has a separate KPI grid below hero.
- Licitaciones hero contains low-value technical data (`Fuente: Supabase`) in premium space.
- Some extrapolated screens have 3 KPI cells or separate cards below hero instead of integrated 2×2.

Required correction:

- Standardize `executive-hero` / new `ModuleHero` pattern.
- Move top KPIs into hero where designer uses that pattern.
- Remove duplicate hero titles.
- Move operational/technical notes into compact secondary panels/details.

### 4. KPI / Metrics

Canonical pattern:

- Dot + uppercase label.
- Large numeric value.
- Short supporting subtitle.
- Semantic colors: blue, green, amber, red, purple.
- Financial numbers should feel deliberate and compact.

Rules:

- KPI count should be 4 in hero where possible.
- More than 4 KPIs belongs below hero as secondary dashboard content.
- KPI cards can be buttons only if interaction is clear and styling shows active state.

Current deviations:

- Dashboard has several downstream metric/ranking sections that compete with the hero.
- `Ranking por salud comercial` was invented and visually problematic.
- There are duplicate ranking concepts: `Ranking por salud comercial` and `Ranking comercial ejecutivo`.

Required correction:

- Keep only metrics that support the screen's job.
- Remove or demote invented ranking blocks.
- If commercial ranking remains, keep one coherent section and use dark cards.

### 5. Filters

Canonical pattern:

- Search input first.
- Compact select controls.
- Time/quick filters as pill buttons where relevant.
- External labels for filter groups.
- Options are short; filter name is not repeated inside each option.

Example for Licitaciones:

```text
Label: Prioridad
Options: Todas, Hacer hoy, Revisar, Descartar / validar, Nuevas, Urgentes, Alto valor, Alto encaje
```

Not:

```text
Prioridad / filtro: Todas
Prioridad: Nuevas
```

Current status:

- Licitaciones filter dropdown text has been corrected in code to use short options.
- Need visual QA to confirm browser rendering and all other filters follow the same rule.

Required correction:

- Review every `Select` usage.
- For every select: external label names the filter; option labels stay short.
- Avoid placeholder options that repeat labels.

### 6. Tables / Lists / Cards

Canonical pattern:

- Dark surfaces, subtle borders, small uppercase headers.
- Cards/list rows must preserve data density.
- Badges are compact and semantic.
- Actions are visible but not visually louder than primary task.

Current deviations:

- Some sections still inherit generic table/panel styling.
- Alertas was already corrected from cream/light table styling, but requires final integration under the global system.

Required correction:

- Create consistent dark panel/table/card primitives.
- Avoid screen-specific one-off CSS unless needed.

---

## Screen Audit and Recovery Direction

### A. Dashboard gerencial — PNG exists

Reference: `01 Dashboard gerencial.png`.

Current issues identified:

- `Ranking por salud comercial` was not present in the PNG and appears as an invented primary section.
- White/light commercial scorecards on dark background break the design system.
- Two ranking sections create duplication: health ranking and executive ranking.
- Hero currently includes an extra `manager-action-panel` that may be useful but deviates from the compact 2-column hero if too prominent.
- Too many sections appear before the user reaches the core executive overview.

Recovery direction:

1. Keep the dashboard as an executive control room.
2. Use hero left text + 2×2 KPI grid.
3. Move `Acción gerencial sugerida` into the left hero narrative or a compact secondary strip only if it fits the PNG logic.
4. Keep `Prioridad gerencial de hoy` because it derives from dashboard alert patterns.
5. Keep `Semáforos ejecutivos` if visually dark and compact.
6. Remove or demote `Ranking por salud comercial`.
7. If a ranking remains, keep a single dark `Ranking comercial ejecutivo` section below the primary dashboard content.

Acceptance criteria:

- No white scorecards.
- No duplicate ranking blocks.
- Hero visually resembles designer dashboard.
- First viewport communicates control room, pipeline, risk, and priority without clutter.

### B. Licitaciones — PNG exists

Reference: `03 Licitaciones.png`.

Current issues identified:

- Hero title duplicates page title (`Licitaciones`).
- Hero contains technical data (`Fuente: Supabase`) rather than business KPIs.
- KPIs sit below hero as separate 4-card grid instead of integrated 2×2 hero grid.
- Filters are functionally good but visually heavy and can feel buried after separate hero + KPI row.
- Help/diagnostics are useful but should not occupy premium visual space.

Recovery direction:

1. Hero eyebrow: `RADAR DE LICITACIONES PÚBLICAS`.
2. Hero title: `Procesos priorizados`.
3. Hero description: short business explanation.
4. Right hero KPIs 2×2:
   - Hacer hoy
   - Alto valor
   - Convertidas
   - En revisión
5. Move generated date/source/diagnostics into a compact details panel or toolbar note below filters.
6. Keep quick filters and dropdowns, with corrected short option labels.
7. Keep unified card board, but style it as designer-system dark cards.

Acceptance criteria:

- Hero structure matches designer concept.
- No `Fuente: Supabase` in hero.
- Filter dropdown options remain short.
- SECOP I, SECOP II, TVEC, ESU Contratación remain visible in source filter when applicable.

### C. Oportunidades — PNG exists

Reference: `02 Oportunidades.png`.

Likely current risks:

- Needs QA against PNG for hero, filters, table/list density.
- Must preserve existing opportunity data/actions.

Recovery direction:

1. Hero: `BANDEJA COMERCIAL` + `Oportunidades en gestión`.
2. Right KPIs 2×2:
   - Activas
   - Sin acción
   - Aprobadas
   - Valor promedio
3. Filters: search + etapa + riesgo + export/secondary action.
4. List/table: dark rows, compact badges, row action menu or existing detail click.

Acceptance criteria:

- Matches PNG hierarchy.
- Filtering is compact.
- No extra non-reference dashboard blocks above list.

### D. Vig-IA — PNG exists

Reference: `04 Vig-IA.png`.

Current risks:

- Vig-IA may be more functional/chat-like than PNG's report-template system.
- Need avoid inventing AI modules that do not exist.

Recovery direction:

1. Hero: `VIG-IA · REPORTES GERENCIALES` + `Reportes predefinidos`.
2. Right KPIs 2×2:
   - Reportes
   - Última corrida
   - Formato
   - Audiencia
3. Below: `Plantillas disponibles` card grid.
4. Keep current query/report logic if functional, but present it inside the template-card concept.

Acceptance criteria:

- Screen reads as report center.
- Cards are dark, 3-column where space allows.
- No unsupported AI promises.

### E. Usuarios y permisos — PNG exists

Reference: `05 Usuarios y permisos.png`.

Current risks:

- User admin functionality was recently fixed; do not break it.
- Forms/tables may still use generic styling.

Recovery direction:

1. Hero: `ADMINISTRACIÓN` + `Usuarios y permisos`.
2. Right KPIs 2×2:
   - Activos
   - Roles
   - Última edición
   - Soporte
3. Roles/permissions cards: dark cards, four-role grid where data supports it.
4. User table section with `+ Crear usuario` action.
5. Preserve `email_confirm: true` backend behavior; frontend only for this pass.

Acceptance criteria:

- User create/edit still works.
- Role cards and table match PNG system.
- No permission scope regressions.

### F. Alertas comerciales — no PNG

Derived from: Dashboard + Oportunidades.

Current status:

- Already corrected to dark board and KPI cards clickable.
- Needs final alignment to global hero/KPI/filter system.

Recovery direction:

1. Hero: `ESTADO DE GESTIÓN` or `PRIORIDAD OPERATIVA`.
2. Title should be contextual, e.g. `Prioridad operativa del día`, not duplicate `Alertas comerciales`.
3. Right KPIs 2×2:
   - Acciones críticas
   - Sin próxima acción
   - Vencidas
   - Bajo cumplimiento or Sustentación estancada
4. Secondary quick cards can remain if not duplicating hero KPIs.
5. Filters below hero.
6. Main table/list under filters.

Acceptance criteria:

- Derived design can be justified from Dashboard/Oportunidades.
- KPI cards remain actionable.
- No light/cream table styling.

### G. Metas y cumplimiento — no PNG

Derived from: Dashboard + Usuarios.

Current status:

- Dark mode was improved, but layout still requires system-level alignment.

Recovery direction:

1. Hero: `GESTIÓN COMERCIAL` + `Avance contra meta del mes`.
2. Right KPIs 2×2:
   - Cumplimiento promedio
   - Comerciales bajo meta
   - Ventas aprobadas
   - Brecha contra meta
3. Main section: goal-vs-actual table/dashboard.
4. Admin form belongs below or in a clearly separated panel, not above executive read.

Acceptance criteria:

- Feels like executive control, not a raw admin table.
- Goal admin remains functional.

### H. Crear oportunidad — no PNG

Derived from: Oportunidades + Usuarios.

Current status:

- Form exists in `OpportunityForm` inside a generic `Panel`.

Recovery direction:

1. Header stays `Crear oportunidad`.
2. Use a compact intro panel/hero: `NUEVA GESTIÓN COMERCIAL` + `Registrar oportunidad`.
3. Form grouped into clear dark sections:
   - Cliente y ubicación
   - Servicio / etapa / responsable
   - Valor y probabilidad
   - Próxima acción
   - Notas
4. Primary action at bottom/right.
5. Keep edit mode title distinct.

Acceptance criteria:

- Form looks native to the designer system.
- No field behavior regression.
- Save/edit flows unchanged.

---

## Rollback Strategy — Must Stay Documented

Current known safe functional baseline before this recovery plan:

```bash
7e72085 Make alerts KPIs actionable and darken goals
cc6c807 Fix alerts board visual QA
2cdb72a QA polish CRM visual consistency
30deb0d Expose Supabase env in Vite bundle
a5acebc Apply CRM visual v2 system
0a31f90 Add ESU datos.gov tender fallback
06e55bb Fix CRM user access emails
0f59198 Remove tender filter placeholder options
```

### Rollback Principle

Rollback should be **visual-only whenever possible**. Do not revert commits that contain backend, Supabase, user auth, ESU, or cron fixes unless explicitly approved.

### Rollback Levels

#### Level 0 — CSS-only revert

Use when a screen is functionally correct but visually broken.

Steps:

```bash
git diff
# identify only src/styles.css changes from the faulty commit
# restore individual CSS hunks or use git checkout for the file from previous commit if safe
git checkout <previous-good-commit> -- src/styles.css
for f in tests/*.mjs; do node "$f" || exit 1; done
npm run build
git commit -m "revert: restore visual styles before [screen] recovery"
vercel deploy --prod --yes
```

Use only if no component markup changes are involved.

#### Level 1 — Screen commit revert

Use when a screen-specific visual commit breaks layout or interaction.

Steps:

```bash
git log --oneline -10
# choose the exact screen-scoped commit
git revert <bad_commit_sha>
for f in tests/*.mjs; do node "$f" || exit 1; done
npm run build
vercel deploy --prod --yes
```

This is why each screen must have its own commit.

#### Level 2 — Visual recovery branch reset

Use if multiple visual recovery commits make the platform worse.

Before starting implementation, create a rollback anchor:

```bash
git status --short
git tag visual-recovery-preflight-2026-06-11 7e72085
# optional once stable: git push origin visual-recovery-preflight-2026-06-11
```

If full visual recovery must be abandoned:

```bash
git checkout main
git reset --hard visual-recovery-preflight-2026-06-11
git push --force-with-lease origin main
vercel deploy --prod --yes
```

**Warning:** Level 2 rewrites `main`; use only with Juan's explicit approval.

#### Level 3 — Production deployment rollback

Use if code is correct locally but production deploy is bad.

Preferred:

```bash
vercel ls
vercel rollback <deployment-url-or-id> --yes
```

If Vercel rollback is not available, deploy the last good commit:

```bash
git checkout visual-recovery-preflight-2026-06-11
vercel deploy --prod --yes
```

Then return to `main` and repair via normal commits.

### Rollback Decision Matrix

| Failure | Rollback action |
|---|---|
| One component spacing/color wrong | Patch CSS, no rollback |
| One screen visually worse but functional | Revert that screen commit |
| Interaction/filter broken by screen refactor | Revert screen commit, re-implement smaller |
| Build/test failure after visual refactor | Fix immediately if obvious; otherwise revert screen commit |
| Multiple screens inconsistent after shared primitive change | Revert shared primitive commit |
| Production unusable | Vercel rollback first, then code rollback |
| Backend/auth/tender data affected | Stop; do not continue visual work; investigate separately |

### Rollback Checklist Before Every Deploy

Before deployment:

```bash
git status --short
for f in tests/*.mjs; do node "$f" || exit 1; done
npm run build
git log --oneline -5
```

After deployment:

```bash
vercel deploy --prod --yes
# verify production bundle changed
curl -s https://seguridad-nacional-crm.vercel.app/ | grep -o 'assets/[^" ]*' | sort -u
```

If production looks wrong:

1. Capture screenshot / evidence.
2. Identify last deployed commit.
3. Choose Level 0, 1, 2, or 3 rollback.
4. Execute rollback.
5. Verify production again.
6. Report clearly: what was rolled back, what remains, next attempt plan.

---

## Implementation Sequence

### Phase 1 — Design Audit and Safety Setup

**Objective:** Freeze the reference system and create rollback anchor before UI code changes.

**Files:**
- Create/modify: `docs/visual-recovery-plan-2026-06-11.md`
- Optional git tag: `visual-recovery-preflight-2026-06-11`

**Steps:**

1. Verify PNG files exist.
2. Document extracted visual system.
3. Document rollback protocol.
4. Create rollback anchor tag at current functional baseline.
5. Commit the plan.

**Verification:**

```bash
git status --short
for f in tests/*.mjs; do node "$f" || exit 1; done
npm run build
```

Expected: tests and build pass; only docs/design artifacts uncommitted if intentionally left out.

### Phase 2 — Shared Visual Primitives

**Objective:** Standardize reusable hero, KPI, filter, panel, and table patterns without changing business logic.

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Add/modify static tests as needed under `tests/`

**Tasks:**

1. Introduce/reuse a single hero structure for module pages.
2. Add utility classes for 2×2 hero KPI grid.
3. Add compact filter field styles.
4. Add dark card/table primitives.
5. Add static tests for no legacy white scorecards and no repeated dropdown labels.

**Commit:**

```bash
git commit -m "refactor: standardize CRM visual primitives"
```

### Phase 3 — Licitaciones Pilot

**Objective:** Correct Licitaciones first because its PNG and deviations are clearest.

**Files:**
- Modify: `src/main.tsx` around `TendersRadar`
- Modify: `src/styles.css`
- Modify: `tests/tenders-static.test.mjs`

**Tasks:**

1. Change hero title from `Licitaciones` to `Procesos priorizados`.
2. Move KPI buttons into hero 2×2 grid.
3. Move source/generated diagnostics out of hero.
4. Keep quick filters and refined filters below hero.
5. Verify dropdown options remain short.
6. Build and QA.

**Commit:**

```bash
git commit -m "fix: align Licitaciones with designer hero system"
```

### Phase 4 — Dashboard

**Objective:** Remove invented/duplicated visual sections and align control-room layout.

**Files:**
- Modify: `src/main.tsx` around `ManagerDashboard`
- Modify: `src/styles.css`
- Add/modify dashboard static tests

**Tasks:**

1. Normalize hero left + KPI 2×2.
2. Integrate/de-emphasize action panel.
3. Remove or demote `Ranking por salud comercial`.
4. Ensure remaining cards are dark.
5. Keep executive signals and priorities if aligned.

**Commit:**

```bash
git commit -m "fix: align dashboard with designer control-room layout"
```

### Phase 5 — Oportunidades

**Objective:** Align opportunity list to the designer's `Bandeja comercial` pattern.

**Files:**
- Modify: `src/main.tsx` around `OpportunityList`
- Modify: `src/styles.css`
- Add/modify opportunity static tests

**Commit:**

```bash
git commit -m "fix: align opportunities with designer list system"
```

### Phase 6 — Vig-IA

**Objective:** Align Vig-IA to the report-template center shown in the PNG.

**Files:**
- Modify: `src/main.tsx` around `CentinelAssistant`
- Modify: `src/styles.css`
- Add/modify static tests

**Commit:**

```bash
git commit -m "fix: align Vig-IA with report center design"
```

### Phase 7 — Usuarios y permisos

**Objective:** Align admin screen while preserving user create/edit/access flows.

**Files:**
- Modify: `src/main.tsx` around `UsersAdmin`
- Modify: `src/styles.css`
- Existing user tests must remain green.

**Commit:**

```bash
git commit -m "fix: align users admin with designer permissions layout"
```

### Phase 8 — Screens Without PNGs

**Objective:** Apply derived system to Alertas, Metas, and Crear oportunidad.

**Files:**
- Modify: `src/main.tsx` around `CommercialAlerts`, `GoalsCompliance`, `OpportunityForm`
- Modify: `src/styles.css`
- Existing tests must remain green.

**Commits:**

```bash
git commit -m "fix: align alerts with derived operational design"
git commit -m "fix: align goals with derived executive design"
git commit -m "fix: align opportunity form with derived form design"
```

### Phase 9 — Production QA and Deploy

**Objective:** Verify and deploy only after local tests/build pass.

**Commands:**

```bash
for f in tests/*.mjs; do node "$f" || exit 1; done
npm run build
vercel deploy --prod --yes
curl -s https://seguridad-nacional-crm.vercel.app/ | grep -o 'assets/[^" ]*' | sort -u
```

Authenticated QA remains blocked unless valid credentials/session are available.

---

## Static Test Ideas to Add During Implementation

1. `tests/visual-system-static.test.mjs`
   - Assert no `Ranking por salud comercial` primary block remains unless explicitly demoted/renamed.
   - Assert `Procesos priorizados` is used in Licitaciones hero.
   - Assert no `Fuente: Supabase` inside Licitaciones hero markup.
   - Assert no dropdown options contain `Prioridad:` / `Estado interno:` / `Cierre:` / `Valor:` / `Encaje:`.
   - Assert CSS for commercial scorecards uses dark backgrounds, not `#fff`, `white`, `#f8`, etc.

2. `tests/tenders-static.test.mjs`
   - Keep current assert that `placeholderOption` is gone.
   - Add assert for short filter labels.
   - Add assert for official source list.

3. `tests/users-static.test.mjs`
   - Preserve auth/user regression checks.

---

## QA Evidence Required Per Screen

For each screen commit:

1. Before/after screenshot or browser visual inspection.
2. Static tests pass.
3. `npm run build` passes.
4. Manual interaction sanity:
   - filters change rows,
   - CTA opens correct route,
   - clickable cards navigate/filter correctly,
   - empty states remain legible.
5. Production bundle verified after deploy.

---

## Immediate Next Step

1. Commit this plan and create rollback anchor.
2. Start Phase 2 shared primitives.
3. Implement Phase 3 Licitaciones as the pilot screen.

If Phase 3 produces a clean result, proceed sequentially. If Phase 3 still feels visually off, stop and either revise primitives or activate Level 1 rollback for the Licitaciones commit before touching more screens.
