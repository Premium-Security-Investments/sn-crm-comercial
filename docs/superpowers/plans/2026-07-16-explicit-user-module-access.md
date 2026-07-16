# Explicit User Module Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que el administrador asigne explícitamente a cada usuario los módulos visibles y ejecutables, con denegación por defecto para usuarios nuevos y límites seguros por rol.

**Architecture:** Un catálogo JavaScript compartido define códigos de módulo y compatibilidad por rol. La matriz central consume esas capacidades; el frontend deriva menú y rutas de la misma semántica, mientras el backend protege endpoints y minimiza `/api/bootstrap`. Una migración 021 inserta el catálogo y hace un backfill de compatibilidad solo para perfiles existentes.

**Tech Stack:** React 19, TypeScript, Node.js/Express, Supabase/PostgreSQL, PGlite, pruebas Node `assert`, Vite.

## Global Constraints

- Usuarios nuevos reciben cero módulos hasta que el administrador seleccione alguno.
- El rol limita módulos elegibles, pero nunca concede módulos automáticamente en runtime.
- Áreas/subáreas continúan controlando alcance de datos y no sustituyen módulos.
- `active=false` deniega toda capacidad.
- `microsoft_email` no participa en autorización.
- Auth UID ↔ perfil y correo de perfil permanecen inmutables.
- `licitaciones` conserva su código actual.
- `modulo_usuarios` requiere rol `admin` y permiso explícito.
- Toda modificación de perfil, áreas y permisos continúa siendo transaccional y auditada.
- Mantener paridad byte a byte entre `server/index.js` y `api/[...path].js`.
- No push, migración remota ni deploy sin aprobación explícita.

---

### Task 1: Catálogo compartido y matriz de capacidades de módulos

**Files:**
- Create: `module-access.js`
- Create: `module-access.d.ts`
- Create: `tests/module-access.test.mjs`
- Modify: `access-control.js`
- Modify: `tests/access-control.test.mjs`

**Interfaces:**
- Produces: `MODULE_PERMISSIONS`, `MODULE_PERMISSION_CODES`, `eligibleModulePermissions(role)`, `isModulePermissionEligible(role, code)`.
- Produces: acciones `MODULE_SIIO_VIEW`, `MODULE_VIGIA_VIEW`, `MODULE_DASHBOARD_VIEW`, `MODULE_ALERTS_VIEW`, `MODULE_OPPORTUNITIES_VIEW`, `MODULE_GOALS_VIEW`, `MODULE_USERS_VIEW` en `ACTIONS`.
- Later tasks consume exact module codes from this file.

- [ ] **Step 1: Write failing shared-catalog tests**

Create `tests/module-access.test.mjs` asserting the exact catalog:

```js
import { strict as assert } from 'node:assert';
import {
  MODULE_PERMISSIONS,
  MODULE_PERMISSION_CODES,
  eligibleModulePermissions,
  isModulePermissionEligible,
} from '../module-access.js';

assert.deepEqual(MODULE_PERMISSION_CODES, [
  'modulo_siio_gerencial',
  'modulo_vig_ia',
  'modulo_dashboard_comercial',
  'modulo_alertas_comerciales',
  'modulo_oportunidades',
  'modulo_metas',
  'licitaciones',
  'modulo_usuarios',
]);
assert.equal(new Set(MODULE_PERMISSION_CODES).size, MODULE_PERMISSION_CODES.length);
assert.ok(MODULE_PERMISSIONS.every(item => item.code && item.name && item.description));
assert.deepEqual(eligibleModulePermissions('junta'), []);
assert.equal(isModulePermissionEligible('admin', 'modulo_usuarios'), true);
assert.equal(isModulePermissionEligible('gerencia', 'modulo_usuarios'), false);
assert.equal(isModulePermissionEligible('comercial', 'modulo_siio_gerencial'), false);
assert.equal(isModulePermissionEligible('comercial', 'modulo_oportunidades'), true);
assert.equal(isModulePermissionEligible('colaborador', 'modulo_oportunidades'), true);
assert.equal(isModulePermissionEligible('desconocido', 'modulo_metas'), false);
```

- [ ] **Step 2: Run RED**

Run: `node tests/module-access.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `module-access.js`.

- [ ] **Step 3: Implement minimal shared catalog**

Create `module-access.js` with frozen module records, the exact role-to-module ceiling from the approved spec, and pure functions that return copies rather than mutable internal sets. Create matching declarations in `module-access.d.ts`:

```ts
export type ModulePermission = Readonly<{ code: string; name: string; description: string }>;
export const MODULE_PERMISSIONS: readonly ModulePermission[];
export const MODULE_PERMISSION_CODES: readonly string[];
export function eligibleModulePermissions(role: string): string[];
export function isModulePermissionEligible(role: string, code: string): boolean;
```

- [ ] **Step 4: Verify catalog GREEN**

Run: `node tests/module-access.test.mjs`
Expected: exit 0.

- [ ] **Step 5: Write failing access-control matrix cases**

Extend `tests/access-control.test.mjs` with active profiles carrying explicit permissions. For every new module action assert:

```js
{ profile: human('admin', { permissions: [] }), action: ACTIONS.MODULE_USERS_VIEW, expected: false }
{ profile: human('admin', { permissions: ['modulo_usuarios'] }), action: ACTIONS.MODULE_USERS_VIEW, expected: true }
{ profile: human('comercial', { permissions: ['modulo_oportunidades'] }), action: ACTIONS.MODULE_OPPORTUNITIES_VIEW, expected: true }
{ profile: human('comercial', { permissions: ['modulo_siio_gerencial'] }), action: ACTIONS.MODULE_SIIO_VIEW, expected: false }
{ profile: human('junta', { permissions: ['modulo_dashboard_comercial'] }), action: ACTIONS.MODULE_DASHBOARD_VIEW, expected: false }
{ profile: human('admin', { active: false, permissions: MODULE_PERMISSION_CODES }), action: ACTIONS.MODULE_DASHBOARD_VIEW, expected: false }
```

Keep existing resource actions (`USERS_MANAGE`, CRM, SIIO and tender actions) semantically unchanged in this task. Task 4 composes the new module-entry action with the existing role/resource action at each backend route, so every intermediate commit remains backward-compatible and independently testable.

- [ ] **Step 6: Run matrix RED**

Run: `node tests/access-control.test.mjs`
Expected: FAIL because the new module actions are unknown.

- [ ] **Step 7: Implement module actions in central matrix**

Import `isModulePermissionEligible` in `access-control.js`. Add helper:

```js
function hasEligibleModule(profile, permissionCode) {
  return isHuman(profile)
    && isModulePermissionEligible(profile.role, permissionCode)
    && hasPermission(profile, permissionCode);
}
```

Implement each module action through this helper. Preserve resource-level role, ownership and area constraints as additional conditions; never replace them with module membership alone.

- [ ] **Step 8: Verify matrix GREEN and regressions**

Run:

```bash
node tests/module-access.test.mjs
node tests/access-control.test.mjs
node tests/auth-context-access.test.mjs
```

Expected: all exit 0.

- [ ] **Step 9: Commit Task 1**

```bash
git add module-access.js module-access.d.ts access-control.js tests/module-access.test.mjs tests/access-control.test.mjs
git commit -m "feat(access): add explicit module capability catalog"
```

---

### Task 2: Migración 021 y validación administrativa

**Files:**
- Create: `supabase/migrations/021_explicit_user_modules.sql`
- Create: `supabase/rollbacks/021_explicit_user_modules_rollback.sql`
- Create: `tests/module-permissions-migration-pglite.test.mjs`
- Modify: `tests/profile-admin-permissions.test.mjs`
- Modify: `tests/profile-admin-transaction-pglite.test.mjs`
- Modify: `server/index.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: `MODULE_PERMISSIONS`, `MODULE_PERMISSION_CODES`, `isModulePermissionEligible`.
- Produces: catálogo SQL con los ocho códigos y backfill de compatibilidad para filas existentes.
- Produces: `assertNoAdminSelfLockout` que también protege `modulo_usuarios`.

- [ ] **Step 1: Write failing migration contract**

Create a PGlite test that builds the minimal 019 schema and profiles for `admin`, `gerencia`, `director`, `comercial`, `colaborador`, `junta`; applies 021; and asserts:

- all codes from `MODULE_PERMISSION_CODES` exist and are active;
- existing admin receives every eligible module including `modulo_usuarios`;
- existing gerencia/director/comercial/colaborador receive only modules matching current pre-021 visibility and role ceiling;
- existing `licitaciones` assignment is preserved, never created from email;
- junta receives no operational module;
- a profile inserted after 021 receives zero permissions;
- no trigger/default grants modules automatically;
- authenticated has no direct DML privilege on permission tables.

- [ ] **Step 2: Run migration RED**

Run: `node tests/module-permissions-migration-pglite.test.mjs`
Expected: FAIL because migration 021 does not exist.

- [ ] **Step 3: Implement migration and rollback**

Migration 021 must:

1. `begin` transaction;
2. insert/upsert module catalog rows;
3. snapshot only profiles that exist at migration time through explicit `insert ... select` statements;
4. use `on conflict do nothing`;
5. never inspect `microsoft_email`;
6. preserve service-role-only writes already established by 019/020;
7. `commit`.

Rollback removes only the seven new `modulo_*` catalog/assignment rows. It must not delete `licitaciones`, change identity links, or restore implicit runtime role grants.

- [ ] **Step 4: Verify migration GREEN**

Run: `node tests/module-permissions-migration-pglite.test.mjs`
Expected: exit 0.

- [ ] **Step 5: Write failing profile-validation cases**

Extend `tests/profile-admin-permissions.test.mjs`:

```js
assert.deepEqual(
  normalizeProfileAccessRequest({ areas: [], permissions: [] }, catalog, 'comercial'),
  { areas: [], permissions: [] },
);
assert.throws(
  () => normalizeProfileAccessRequest({ areas: [], permissions: ['modulo_usuarios'] }, catalog, 'comercial'),
  /rol|módulo/i,
);
assert.throws(
  () => assertNoAdminSelfLockout(admin, {
    profileId: admin.id,
    microsoftEmail: admin.microsoft_email,
    role: 'admin',
    active: true,
    permissions: [],
  }),
  /propio|administrador/i,
);
```

Update the test catalog to include every module record from `MODULE_PERMISSIONS`.

- [ ] **Step 6: Run validation RED**

Run: `node tests/profile-admin-permissions.test.mjs`
Expected: FAIL because only `licitaciones` compatibility and admin role/status are currently validated.

- [ ] **Step 7: Implement shared server validation**

In both backend entrypoints:

- import shared module catalog helpers;
- reject any assigned module incompatible with target role;
- keep unknown-code rejection from the active DB catalog;
- require `permissions` explicitly on create/update;
- extend self-lockout checks so current admin cannot remove `modulo_usuarios`;
- preserve atomic RPC write and immutable email/Auth subject.

Synchronize both backend files by copying the verified canonical file and run parity.

- [ ] **Step 8: Verify Task 2 GREEN**

Run:

```bash
node tests/profile-admin-permissions.test.mjs
node tests/profile-admin-transaction-pglite.test.mjs
node tests/module-permissions-migration-pglite.test.mjs
npm run check:backend-parity
```

Expected: all exit 0.

- [ ] **Step 9: Commit Task 2**

```bash
git add supabase/migrations/021_explicit_user_modules.sql supabase/rollbacks/021_explicit_user_modules_rollback.sql tests/module-permissions-migration-pglite.test.mjs tests/profile-admin-permissions.test.mjs tests/profile-admin-transaction-pglite.test.mjs server/index.js 'api/[...path].js'
git commit -m "feat(access): persist explicit user module assignments"
```

---

### Task 3: Panel administrativo, navegación y URL directa

**Files:**
- Modify: `src/navPermissions.ts`
- Modify: `src/main.tsx`
- Modify: `scripts/check_nav_permissions.mjs`
- Create: `tests/user-module-admin-static.test.mjs`
- Modify: `tests/user-admin-edit-reset-static.test.mjs`

**Interfaces:**
- Consumes: shared module codes and central role ceiling.
- Produces: `moduleActionForPage(page)`, `canAccessRoute(profile, page)`, `getVisibleNavGroups(profile)` driven by explicit permissions.
- Produces: user form with modules initially empty for creation and loaded exactly for editing.

- [ ] **Step 1: Write navigation RED cases**

Update `scripts/check_nav_permissions.mjs` so every profile includes a stable `id`, `active` and explicit permissions. Assert:

- admin without modules sees no module groups and cannot access `/users`;
- admin with only `modulo_usuarios` sees only Administración → Usuarios y permisos;
- comercial with only `modulo_oportunidades` sees only Comercial → Oportunidades;
- comercial with Alertas + Metas sees exactly those two entries;
- manager role without SIIO permission cannot see/open SIIO;
- direct route `detail/new/edit` requires `modulo_oportunidades`;
- email historical without `licitaciones` remains denied;
- groups with zero visible items do not exist.

- [ ] **Step 2: Run navigation RED**

Run: `npm run check:nav-permissions`
Expected: FAIL because current navigation grants by role and unconditionally shows commercial/admin groups.

- [ ] **Step 3: Implement capability-driven navigation**

Refactor `src/navPermissions.ts` to a declarative item list where each page maps to one module code. `getVisibleNavGroups` filters individual items and then filters empty groups. `canAccessRoute` must use the identical mapping.

Refactor `Nav` in `src/main.tsx` to render `getVisibleNavGroups(currentProfile)` instead of duplicating role checks. Keep active-link behavior and existing labels/hrefs.

- [ ] **Step 4: Verify navigation GREEN**

Run:

```bash
npm run check:nav-permissions
npm run build
```

Expected: exit 0.

- [ ] **Step 5: Write admin-form RED contract**

Create `tests/user-module-admin-static.test.mjs` asserting source-level integration:

- imports `MODULE_PERMISSIONS` or consumes catalog permissions without hardcoded email/role grants;
- `emptyUserForm.permissions` is `[]`;
- renders a section labelled `Módulos y pestañas`;
- checkboxes are based on eligible catalog records;
- changing role removes incompatible codes;
- editing loads `user.permissions` exactly;
- summary exposes selected modules and areas;
- no template auto-selects modules.

- [ ] **Step 6: Run form RED**

Run: `node tests/user-module-admin-static.test.mjs`
Expected: FAIL because the dedicated modules section and compatibility filtering do not exist.

- [ ] **Step 7: Implement minimal panel UI**

In `UsersAdmin`:

- classify catalog permissions as modules using `MODULE_PERMISSION_CODES`;
- render eligible module checkboxes under `Módulos y pestañas`;
- show incompatible entries disabled or omit them consistently;
- implement `changeRole` using `isModulePermissionEligible` for every selected code;
- preserve empty selection on new user;
- display a compact pre-save summary;
- keep area selector and invite/reset controls unchanged.

- [ ] **Step 8: Verify Task 3 GREEN**

Run:

```bash
node tests/user-module-admin-static.test.mjs
node tests/user-admin-edit-reset-static.test.mjs
npm run check:nav-permissions
npm run build
```

Expected: all exit 0.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/navPermissions.ts src/main.tsx scripts/check_nav_permissions.mjs tests/user-module-admin-static.test.mjs tests/user-admin-edit-reset-static.test.mjs
git commit -m "feat(access): let admins choose visible user modules"
```

---

### Task 4: Guardas backend y minimización de bootstrap

**Files:**
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Modify: `tests/auth-context-access.test.mjs`
- Create: `tests/backend-module-guards.test.mjs`
- Modify: `scripts/check_backend_permission_guards.mjs`

**Interfaces:**
- Consumes: new `ACTIONS.MODULE_*` and existing resource actions.
- Produces: `bootstrapCapabilities(profile)` and `filterBootstrapForProfile(payload, profile)` that omit unauthorized datasets.
- Produces: route entry guards using `requireAction`.

- [ ] **Step 1: Write backend route RED tests**

Create `tests/backend-module-guards.test.mjs` with authenticated contexts for:

- active commercial without modules;
- commercial with Oportunidades only;
- commercial with Metas only;
- manager with Dashboard only;
- manager with SIIO only;
- admin with/without Usuarios.

Assert HTTP 403 on unauthorized module entry routes and success/no guard failure for authorized contexts. At minimum cover:

- `/api/opportunities/:id`, POST/PATCH opportunities and interactions → Oportunidades;
- GET/POST goals → Metas;
- `/api/siio/*` → SIIO;
- `/api/users` and `/api/access-catalog` → Usuarios + admin;
- `/api/tenders*` → existing `licitaciones`.

- [ ] **Step 2: Run route RED**

Run: `node tests/backend-module-guards.test.mjs`
Expected: FAIL because several endpoints still rely only on role/resource guards.

- [ ] **Step 3: Add module entry guards**

Use `requireAction(currentProfile, ACTIONS.MODULE_..., {})` before database reads or request-body processing. Preserve the existing resource-level `ensureOpportunityAccess`, tender actions, SIIO action checks and role constraints after the module gate.

Do not trust module codes from query/body.

- [ ] **Step 4: Write bootstrap RED tests**

Extend `tests/auth-context-access.test.mjs` or the new backend test to call exported `filterBootstrapForProfile` and assert:

- no commercial modules → empty opportunity, summary, stalled, closing, KPI and goals arrays/totals;
- Oportunidades → scoped opportunities and support catalogs, but no goals-only data;
- Metas → goals/KPI data needed by Metas, but no opportunity records;
- Dashboard/Alertas/Vig-IA → only datasets their existing components consume;
- currentProfile is always returned;
- profiles are omitted unless a permitted module needs their labels;
- service/stage/loss-reason catalogs are omitted unless a permitted commercial module needs them.

- [ ] **Step 5: Run bootstrap RED**

Run: `node tests/auth-context-access.test.mjs`
Expected: FAIL because current bootstrap returns commercial datasets based mainly on role.

- [ ] **Step 6: Implement capability-aware bootstrap filtering**

Export a pure `bootstrapCapabilities(profile)` and update `filterBootstrapForProfile`. Filter response fields before `res.json`; do not expose unauthorized datasets. Keep current ownership/manager scoping as an additional filter when a module is allowed.

The implementation may continue querying shared views in this task, but the HTTP response must not contain unauthorized records. Query splitting is deferred unless profiling shows a performance need.

- [ ] **Step 7: Strengthen CI guard script**

Update `scripts/check_backend_permission_guards.mjs` to require central module guards on route families and reject runtime authorization by `microsoft_email`. Keep `findTenderOwner` explicitly exempt only as owner assignment.

- [ ] **Step 8: Synchronize and verify Task 4 GREEN**

Copy canonical backend to serverless twin, then run:

```bash
node tests/backend-module-guards.test.mjs
node tests/auth-context-access.test.mjs
node scripts/check_backend_permission_guards.mjs
npm run check:backend-parity
node --check server/index.js
node --check 'api/[...path].js'
```

Expected: all exit 0 and backend hashes identical.

- [ ] **Step 9: Commit Task 4**

```bash
git add server/index.js 'api/[...path].js' tests/backend-module-guards.test.mjs tests/auth-context-access.test.mjs scripts/check_backend_permission_guards.mjs
git commit -m "fix(access): enforce module permissions on backend routes"
```

---

### Task 5: Integración, revisión y preview local

**Files:**
- Modify only if a failing regression exposes a Task 7 defect.
- No production configuration changes.

**Interfaces:**
- Consumes all previous task outputs.
- Produces verified Task 7 candidate ready for independent review and visual preview.

- [ ] **Step 1: Run all 61+ test files**

Run each `tests/*.test.mjs`, count total and failures, and require `FAILED_COUNT=0`.

- [ ] **Step 2: Run official quality gates**

```bash
npm run check:siio-integration
npm run check:siio-executive
npm run check:siio-agents
npm run check:nav-permissions
node scripts/check_backend_permission_guards.mjs
npm run check:backend-parity
npm run build
node --check server/index.js
node --check 'api/[...path].js'
git diff --check
sha256sum server/index.js 'api/[...path].js'
```

Expected: every command exits 0; backend hashes match. The existing Vite chunk-size warning is non-blocking unless a new error appears.

- [ ] **Step 3: Run migration chain in PGlite**

Apply 019 → 020 → 021 in the isolated migration tests. Verify rollback behavior does not restore implicit access or break Auth UID links.

- [ ] **Step 4: Perform local visual QA**

Start the local app and verify with representative fixtures:

1. admin with only Usuarios;
2. commercial with only Oportunidades;
3. commercial with Oportunidades + Metas;
4. director with Dashboard + Alertas;
5. user with Licitaciones;
6. inactive user.

For each, capture evidence that menu visibility and direct-route denial match the panel assignments. Do not use production users or credentials.

- [ ] **Step 5: Independent review**

Dispatch a read-only reviewer for:

- spec compliance;
- role ceiling correctness;
- frontend/backend parity;
- bootstrap data minimization;
- migration/backfill safety;
- no email authorization;
- no Auth identity regression;
- rollback safety.

A `REQUEST_CHANGES` verdict blocks completion.

- [ ] **Step 6: Commit any review-approved fixes through RED–GREEN cycles**

Every defect requires a failing regression test before implementation. Re-run Steps 1–3 after the final fix.

- [ ] **Step 7: Mark Task 7 complete and prepare preview report**

Report commits, exact test count, build result, migration status, screenshots/preview route and remaining deployment gates. Do not push or deploy.
