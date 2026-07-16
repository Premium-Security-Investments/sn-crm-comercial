# CRM / SIIO Access Control Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Implementar los perfiles, áreas, subáreas, permisos adicionales y alcances por acción definidos para el CRM/SIIO, sin alterar usuarios reales ni producción hasta completar preview y QA por perfil.

**Architecture:** La autorización se resolverá en servidor mediante una función pura compartida y un contexto enriquecido de usuario. Supabase almacenará perfiles, asignaciones y permisos; las respuestas de API se filtrarán por alcance antes de llegar al navegador. La navegación reflejará las capacidades calculadas, pero nunca reemplazará los guards de servidor.

**Tech Stack:** React 19, TypeScript, Express ESM, Supabase/PostgreSQL, Node.js, PGlite, Vite.

---

## Restricciones de ejecución

1. Trabajar en rama aislada; no usar `main` directamente.
2. No ejecutar migraciones contra Supabase de producción sin autorización explícita.
3. No reasignar usuarios reales durante desarrollo.
4. Usar cuentas/perfiles sintéticos en pruebas.
5. Mantener `server/index.js` y `api/[...path].js` byte a byte iguales mientras sigan duplicados.
6. No desplegar hasta aprobar build, pruebas de autorización y QA visual.
7. El primer despliegue será preview/piloto; producción requiere autorización independiente.
8. Cada guard nuevo necesita al menos una prueba positiva y una negativa.
9. Ningún rechazo de autorización puede depender solo del frontend.
10. Las acciones IA, exportaciones y publicaciones deben dejar auditoría.

## Alcance por fases

### Fase A — Fundación de acceso

- catálogos de perfiles, áreas, subáreas y permisos;
- asignación múltiple a usuarios;
- motor compartido de autorización;
- administración de usuarios;
- navegación por capacidad;
- compatibilidad con usuarios actuales.

### Fase B — Aplicación a módulos existentes

- pipeline comercial con resumen de equipo y detalle propio;
- metas y alertas;
- Licitaciones por acción;
- SIIO filtrado por área;
- bandeja de asignaciones.

#### Corrección de política SIIO (Task 4A)

El catálogo y el backfill explícito preservan SIIO para `admin`, `gerencia`, `director` y `junta`; cada perfil sigue requiriendo `modulo_siio_gerencial`. Admin/gerencia gestionan. Director opera únicamente sobre recursos con alcance canónico derivado en servidor. Junta sólo consume lectura ejecutiva publicada y no recibe módulos comerciales ni de administración. Comercial y colaborador no son elegibles.

La composición de rutas SIIO con acciones y recursos canónicos se implementa en la fase de aplicación: no se adelanta con email, body ni texto libre.

### Fase C — Gobernanza nueva

- solicitud y validación de cierre;
- fuentes en borrador/validación;
- publicaciones inmutables de Junta;
- identidad técnica y ejecuciones de IA;
- auditoría y exportaciones.

No iniciar Fase B hasta aprobar la Fundación en preview. No iniciar Fase C hasta que las fuentes y responsables reales de la primera área piloto estén confirmados.

---

### Task 1: Congelar la línea base y verificar paridad de backends

**Objective:** Crear una prueba repetible que impida divergencias entre el backend local y el serverless.

**Files:**
- Create: `scripts/check_backend_parity.mjs`
- Modify: `package.json`
- Test: `tests/backend-parity.test.mjs`

**Step 1: Write failing test**

Crear `tests/backend-parity.test.mjs` para leer `server/index.js` y `api/[...path].js`, comparar bytes y fallar mostrando el primer desplazamiento diferente.

**Step 2: Run test to verify failure**

Renombrar temporalmente una copia dentro del test o probar primero la ausencia del script.

Run: `node tests/backend-parity.test.mjs`

Expected: FAIL porque `scripts/check_backend_parity.mjs` aún no existe.

**Step 3: Implement minimal check**

El script debe:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const local = readFileSync('server/index.js');
const vercel = readFileSync('api/[...path].js');
assert.deepEqual(vercel, local, 'Los backends local y Vercel deben ser idénticos');
console.log('backend parity OK');
```

Agregar `"check:backend-parity": "node scripts/check_backend_parity.mjs"` a `package.json`.

**Step 4: Verify**

Run: `npm run check:backend-parity`

Expected: `backend parity OK`.

**Step 5: Commit**

```bash
git add package.json scripts/check_backend_parity.mjs tests/backend-parity.test.mjs
git commit -m "test: enforce backend parity"
```

---

### Task 2: Crear el esquema de perfiles, áreas y permisos

**Objective:** Añadir el modelo relacional sin modificar las asignaciones funcionales de usuarios existentes.

**Files:**
- Create: `supabase/migrations/019_profile_area_permissions.sql`
- Create: `supabase/rollbacks/019_profile_area_permissions_rollback.sql`
- Test: `tests/profile-area-permissions-migration.test.mjs`

**Step 1: Write failing PGlite test**

El test debe crear una versión mínima de `psi_sales_profiles`, ejecutar la migración y comprobar:

- roles `admin`, `gerencia`, `director`, `comercial`, `colaborador`, `junta`;
- seis áreas iniciales;
- subáreas aprobadas;
- múltiples áreas por perfil;
- permiso `licitaciones` separado del rol;
- unicidad de asignaciones;
- auditoría de cambios;
- eliminación en cascada de asignaciones al borrar un perfil sintético.

Run: `node tests/profile-area-permissions-migration.test.mjs`

Expected: FAIL porque la migración no existe.

**Step 2: Create migration**

La migración debe crear:

```text
psi_org_areas
psi_org_subareas
psi_access_permissions
psi_profile_area_assignments
psi_profile_permissions
psi_access_audit_log
```

Columnas mínimas:

```text
psi_org_areas(code PK, name, active, created_at, updated_at)
psi_org_subareas(code PK, area_code FK, name, active, created_at, updated_at)
psi_access_permissions(code PK, name, description, active)
psi_profile_area_assignments(profile_id FK, area_code FK, subarea_code FK nullable, created_at, created_by)
psi_profile_permissions(profile_id FK, permission_code FK, created_at, created_by)
psi_access_audit_log(id, actor_profile_id, target_profile_id, action, before_state jsonb, after_state jsonb, created_at)
```

Reglas:

- `subarea_code IS NULL` representa alcance completo sobre el área.
- una subárea debe pertenecer al área indicada;
- no guardar agencias como subáreas;
- sembrar solo `licitaciones` como permiso adicional inicial;
- ampliar el check de rol mediante inspección segura de constraints que referencien `role`;
- no cambiar roles existentes.

**Step 3: Seed initial catalog**

Sembrar las seis áreas y las subáreas de `siio-profile-area-model.md` con `ON CONFLICT DO UPDATE` idempotente.

**Step 4: Verify migration and rollback**

Run:

```bash
node tests/profile-area-permissions-migration.test.mjs
```

Expected: PASS, incluyendo segunda ejecución idempotente y rollback sobre una base sintética.

**Step 5: Commit**

```bash
git add supabase/migrations/019_profile_area_permissions.sql supabase/rollbacks/019_profile_area_permissions_rollback.sql tests/profile-area-permissions-migration.test.mjs
git commit -m "feat: add profile area and permission schema"
```

---

### Task 3: Migrar compatibilidad comercial sin excepciones por correo

**Objective:** Convertir `commercial_area` y la excepción histórica de Licitaciones a asignaciones explícitas, sin quitar todavía la columna legado.

**Files:**
- Modify: `supabase/migrations/019_profile_area_permissions.sql`
- Test: `tests/profile-access-backfill.test.mjs`

**Step 1: Write failing tests**

Probar que:

- `seguridad_fisica` crea asignación Comercial/Seguridad Física;
- `tecnologia` crea Comercial/Tecnología;
- `licitacion_publica` crea Comercial/Licitaciones y permiso `licitaciones`;
- la cuenta histórica de Licitaciones recibe el permiso por migración de datos, no por lógica en código;
- ejecutar el backfill dos veces no duplica filas.

**Step 2: Run failing test**

Run: `node tests/profile-access-backfill.test.mjs`

Expected: FAIL hasta agregar el backfill.

**Step 3: Implement idempotent backfill**

No eliminar `commercial_area` en esta fase. Marcarla como compatibilidad temporal en comentarios SQL.

**Step 4: Verify**

Run: `node tests/profile-access-backfill.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add supabase/migrations/019_profile_area_permissions.sql tests/profile-access-backfill.test.mjs
git commit -m "feat: backfill legacy commercial access"
```

---

### Task 4: Implementar el motor puro de autorización

**Objective:** Centralizar decisiones de autorización en una función reutilizable y testeable.

**Files:**
- Create: `access-control.js`
- Test: `tests/access-control.test.mjs`

**Step 1: Write table-driven failing tests**

Definir perfiles sintéticos con:

```js
{
  id,
  role,
  active: true,
  areas: [{ area_code, subarea_code }],
  permissions: ['licitaciones']
}
```

Probar todas las reglas críticas de la matriz:

- solo ADM administra usuarios;
- DIR ve/escribe únicamente su área;
- COM consulta resumen del equipo pero solo edita oportunidades propias;
- Licitaciones requiere permiso adicional para todos los roles;
- COM + Licitaciones propone descarte pero no aprueba GO/NO GO;
- COL solo actualiza asignaciones propias;
- JUN solo lee publicaciones aprobadas;
- IA no cierra, publica ni aprueba.

**Step 2: Run test to verify failure**

Run: `node tests/access-control.test.mjs`

Expected: FAIL porque `access-control.js` no existe.

**Step 3: Implement minimal API**

Exportar:

```js
export const ACTIONS = Object.freeze({ /* códigos de acción */ });
export function hasPermission(profile, permissionCode) {}
export function hasAreaScope(profile, areaCode, subareaCode = null) {}
export function can(profile, action, resource = {}) {}
export function requireAction(profile, action, resource = {}) {}
```

`requireAction` debe lanzar error con `status = 403` y un mensaje sin datos sensibles.

**Step 4: Verify**

Run: `node tests/access-control.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add access-control.js tests/access-control.test.mjs
git commit -m "feat: add centralized access control engine"
```

---

### Task 5: Enriquecer el contexto autenticado

**Objective:** Cargar áreas y permisos junto al perfil una sola vez por solicitud.

**Files:**
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Test: `tests/auth-context-access.test.mjs`

**Step 1: Write failing API tests**

Con base de datos simulada, comprobar:

- usuario inactivo recibe `403`;
- perfil devuelve `areas` y `permissions`;
- usuario sin asignaciones recibe arrays vacíos;
- error de carga no concede acceso;
- contexto no depende del correo.

**Step 2: Run failing test**

Run: `node tests/auth-context-access.test.mjs`

Expected: FAIL.

**Step 3: Modify `getAuthContext`**

Consultar `psi_profile_area_assignments` y `psi_profile_permissions` después de validar el perfil activo. No aceptar áreas o permisos enviados por el navegador.

Importar `can` y `requireAction` desde `../access-control.js`.

**Step 4: Mirror backend**

Después de modificar `server/index.js`:

```bash
cp server/index.js 'api/[...path].js'
npm run check:backend-parity
```

**Step 5: Verify**

Run:

```bash
node tests/auth-context-access.test.mjs
npm run check:backend-parity
```

Expected: PASS.

**Step 6: Commit**

```bash
git add server/index.js 'api/[...path].js' tests/auth-context-access.test.mjs
git commit -m "feat: enrich authenticated access context"
```

---

### Task 6: Ampliar Administración de usuarios

**Objective:** Permitir que Administrador gestione perfil, múltiples áreas y Licitaciones en una sola operación funcional.

**Files:**
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `src/main.tsx`
- Create: `src/accessTypes.ts`
- Test: `tests/user-access-admin-api.test.mjs`
- Test: `tests/user-access-admin-ui.test.mjs`

**Step 1: Write failing API tests**

Probar GET/POST/PATCH `/api/users`:

- GET incluye `areas` y `permissions`;
- solo ADM puede operar;
- roles `colaborador` y `junta` son válidos;
- asignación de subárea incorrecta se rechaza;
- guardar reemplaza el conjunto completo de asignaciones explícitas;
- el audit log contiene estado anterior y nuevo;
- un fallo de asignación no se reporta como éxito.

**Step 2: Write failing UI tests**

Comprobar presencia de:

- selector de perfil;
- multiselección de áreas/subáreas;
- checkbox Licitaciones;
- explicación “perfil ≠ área ≠ permiso adicional”;
- edición de usuarios existentes;
- ausencia de asignación de agencia como subárea.

**Step 3: Implement API and UI**

Crear tipos:

```ts
export type UserRole = 'admin' | 'gerencia' | 'director' | 'comercial' | 'colaborador' | 'junta';
export interface AreaAssignment { area_code: string; subarea_code: string | null }
export interface AccessProfile { role: UserRole; areas: AreaAssignment[]; permissions: string[] }
```

El servidor vuelve a validar todos los códigos contra catálogos activos.

**Step 4: Verify**

Run:

```bash
node tests/user-access-admin-api.test.mjs
node tests/user-access-admin-ui.test.mjs
npm run build
npm run check:backend-parity
```

Expected: PASS.

**Step 5: Commit**

```bash
git add server/index.js 'api/[...path].js' src/main.tsx src/accessTypes.ts tests/user-access-admin-*.test.mjs
git commit -m "feat: manage user profiles areas and permissions"
```

---

### Task 7: Reemplazar navegación por correo/rol con capacidades

**Objective:** Mostrar módulos según perfil, áreas y permisos, manteniendo el servidor como autoridad.

**Files:**
- Modify: `src/navPermissions.ts`
- Modify: `scripts/check_nav_permissions.mjs`
- Modify: `tests/auth-roles-static.test.mjs`
- Test: `tests/nav-capabilities.test.mjs`

**Step 1: Write failing matrix test**

Cubrir:

- ADM sin permiso Licitaciones no ve Licitaciones;
- GER con permiso sí;
- DIR Comercial ve CRM; DIR Financiera no;
- COM ve CRM;
- COL ve solo Mis asignaciones;
- JUN ve Resumen aprobado y Junta;
- ninguna prueba usa correos especiales.

**Step 2: Implement**

`getVisibleNavGroups` y `canAccessRoute` deben consumir el perfil enriquecido. Eliminar `TENDER_ACCESS_EMAILS` y cualquier excepción nominal.

**Step 3: Verify**

Run:

```bash
node tests/nav-capabilities.test.mjs
npm run check:nav-permissions
node tests/auth-roles-static.test.mjs
npm run build
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/navPermissions.ts scripts/check_nav_permissions.mjs tests/auth-roles-static.test.mjs tests/nav-capabilities.test.mjs
git commit -m "feat: drive navigation from capabilities"
```

---

### Task 8: Habilitar resumen de pipeline del equipo sin exponer detalle sensible

**Objective:** Cumplir “pipeline completo” para Comercial sin permitir lectura o escritura de detalles ajenos.

**Files:**
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `src/main.tsx`
- Test: `tests/commercial-pipeline-scope.test.mjs`

**Step 1: Write failing API tests**

Comprobar que COM recibe para oportunidades ajenas solo:

```text
id, company_name, stage_code, offer_value, owner_id/owner_name,
next_action_at, expected_close_date, service_type_code, regional_nombre
```

Y no recibe:

```text
decision_maker_email, decision_maker_phone, observaciones,
interacciones, documentos ni notas internas
```

Probar además:

- COM abre detalle propio;
- COM recibe `403` al abrir o editar detalle ajeno;
- DIR Comercial recibe detalle de su alcance;
- otros Directores no reciben pipeline.

**Step 2: Implement separate summary projection**

No enviar objetos completos y ocultar columnas en React. Proyectar campos permitidos en servidor.

**Step 3: Verify**

Run:

```bash
node tests/commercial-pipeline-scope.test.mjs
npm run build
npm run check:backend-parity
```

Expected: PASS.

**Step 4: Commit**

```bash
git add server/index.js 'api/[...path].js' src/main.tsx tests/commercial-pipeline-scope.test.mjs
git commit -m "feat: add safe team pipeline visibility"
```

---

### Task 9: Aplicar permisos por acción a metas y alertas

**Objective:** Limitar gestión de metas al alcance Comercial correspondiente.

**Files:**
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `src/main.tsx`
- Test: `tests/commercial-goals-alerts-permissions.test.mjs`

**Step 1: Write failing tests**

Cubrir GER/ADM, DIR Comercial, otros DIR y COM según la matriz.

**Step 2: Replace `isManager` guards**

Usar acciones explícitas: `commercial.goal.read_team`, `commercial.goal.write`, `commercial.alert.read_team`, `commercial.alert.resolve_own`.

**Step 3: Verify**

Run:

```bash
node tests/commercial-goals-alerts-permissions.test.mjs
node tests/goals-compliance-static.test.mjs
npm run build
npm run check:backend-parity
```

Expected: PASS.

**Step 4: Commit**

```bash
git add server/index.js 'api/[...path].js' src/main.tsx tests/commercial-goals-alerts-permissions.test.mjs tests/goals-compliance-static.test.mjs
git commit -m "feat: scope commercial goals and alerts"
```

---

### Task 10: Separar acciones de Licitaciones

**Objective:** Reemplazar el guard único de Licitaciones por permisos de lectura, propuesta, aprobación y exportación.

**Files:**
- Modify: `access-control.js`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `tender-tracking-rpc.js`
- Create: `supabase/migrations/020_tender_action_authorization.sql`
- Create: `supabase/rollbacks/020_tender_action_authorization_rollback.sql`
- Test: `tests/tender-action-permissions.test.mjs`
- Modify: `tests/tender-tracking-pglite.integration.test.mjs`

**Step 1: Write failing table tests**

Cubrir Radar, sincronización, perfiles, ficha/RUP, seguimiento, conversión, documentos, GO/NO GO, expediente, descarte y exportación para ADM/GER/DIR/COM con y sin permiso.

**Step 2: Remove nominal exception**

Eliminar todas las comparaciones con `directora.licitaciones@seguridadnacional.co` del frontend, Node y funciones SQL. La continuidad de esa usuaria depende del backfill de Task 3.

**Step 3: Harden RPCs**

Las funciones SQL deben recibir actor y validar el permiso persistido o ser invocables únicamente por el backend de servicio con guard previo. No confiar en un rol enviado por el cliente.

**Step 4: Verify**

Run:

```bash
node tests/tender-action-permissions.test.mjs
node tests/tender-tracking-pglite.integration.test.mjs
npm run check:backend-parity
npm run build
```

Expected: PASS y cero coincidencias de la excepción por correo.

**Step 5: Commit**

```bash
git add access-control.js server/index.js 'api/[...path].js' tender-tracking-rpc.js supabase/migrations/020_tender_action_authorization.sql supabase/rollbacks/020_tender_action_authorization_rollback.sql tests/tender-action-permissions.test.mjs tests/tender-tracking-pglite.integration.test.mjs
git commit -m "feat: authorize tender actions explicitly"
```

---

### Task 11: Clasificar SIIO por área y crear bandeja de asignaciones

**Objective:** Filtrar SIIO para Directores y habilitar participación limitada de responsables.

**Files:**
- Create: `supabase/migrations/021_siio_area_assignments.sql`
- Create: `supabase/rollbacks/021_siio_area_assignments_rollback.sql`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `src/siio/SiioDashboard.tsx`
- Create: `src/siio/MyAssignmentsView.tsx`
- Test: `tests/siio-area-assignments-migration.test.mjs`
- Test: `tests/siio-area-permissions.test.mjs`

**Step 1: Write migration and API failing tests**

La migración debe añadir clasificación y asignación nominal sin destruir `front_id` existente. Probar:

- DIR recibe solo áreas asignadas;
- COL recibe solo compromisos asignados;
- COM sin asignación no recibe SIIO;
- ADM/GER reciben alcance institucional;
- nómina individual nunca se incluye.

**Step 2: Add minimum schema**

Crear `siio_record_assignments` y añadir `area_code`/`subarea_code` donde corresponda. Mantener F1–F6 como metadatos; no convertirlos en áreas.

**Step 3: Implement filtered endpoints**

Separar respuestas de Resumen, Seguimiento y Mis asignaciones. Evitar enviar el bootstrap SIIO completo a Directores o Colaboradores.

**Step 4: Verify**

Run:

```bash
node tests/siio-area-assignments-migration.test.mjs
node tests/siio-area-permissions.test.mjs
npm run check:siio-integration
npm run build
npm run check:backend-parity
```

Expected: PASS.

**Step 5: Commit**

```bash
git add supabase/migrations/021_siio_area_assignments.sql supabase/rollbacks/021_siio_area_assignments_rollback.sql server/index.js 'api/[...path].js' src/siio tests/siio-area-*.test.mjs
git commit -m "feat: scope SIIO by area and assignment"
```

---

### Task 12: Separar terminación, solicitud de cierre y cierre definitivo

**Objective:** Implantar el flujo de control gerencial sin permitir autocierre institucional.

**Files:**
- Create: `supabase/migrations/022_siio_closure_workflow.sql`
- Create: `supabase/rollbacks/022_siio_closure_workflow_rollback.sql`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `src/siio/SiioDashboard.tsx`
- Modify: `src/siio/MyAssignmentsView.tsx`
- Test: `tests/siio-closure-workflow.test.mjs`

**Step 1: Write failing state-machine tests**

Estados mínimos:

```text
borrador → abierto → en_ejecucion → terminado → cierre_solicitado → cerrado
```

Probar transiciones inválidas, evidencia requerida, reapertura y que solo GER/ADM cierren definitivamente.

**Step 2: Implement state transition helper/RPC**

Toda transición debe ser atómica y auditable.

**Step 3: Verify**

Run:

```bash
node tests/siio-closure-workflow.test.mjs
npm run build
npm run check:backend-parity
```

Expected: PASS.

**Step 4: Commit**

```bash
git add supabase/migrations/022_siio_closure_workflow.sql supabase/rollbacks/022_siio_closure_workflow_rollback.sql server/index.js 'api/[...path].js' src/siio tests/siio-closure-workflow.test.mjs
git commit -m "feat: add governed SIIO closure workflow"
```

---

### Task 13: Crear publicación inmutable para Junta

**Objective:** Impedir que Junta consulte datos vivos y entregar solo versiones aprobadas.

**Files:**
- Create: `supabase/migrations/023_siio_board_publications.sql`
- Create: `supabase/rollbacks/023_siio_board_publications_rollback.sql`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Create: `src/siio/BoardPublishedView.tsx`
- Modify: `src/navPermissions.ts`
- Test: `tests/siio-board-publication.test.mjs`

**Step 1: Write failing tests**

Probar:

- JUN recibe `403` en `/api/siio/bootstrap` vivo;
- JUN puede consultar publicación aprobada;
- borradores no son visibles;
- publicación es inmutable;
- corrección crea nueva versión;
- descarga registra auditoría.

**Step 2: Implement snapshot storage**

Crear `siio_board_publications` con `report_id`, `version`, `status`, `snapshot jsonb`, `approved_by`, `published_by`, timestamps y unicidad por reporte/versión.

**Step 3: Verify**

Run:

```bash
node tests/siio-board-publication.test.mjs
node tests/siio-board-draft-behavior.test.mjs
npm run build
npm run check:backend-parity
```

Expected: PASS.

**Step 4: Commit**

```bash
git add supabase/migrations/023_siio_board_publications.sql supabase/rollbacks/023_siio_board_publications_rollback.sql server/index.js 'api/[...path].js' src/siio src/navPermissions.ts tests/siio-board-publication.test.mjs
git commit -m "feat: publish immutable board snapshots"
```

---

### Task 14: Registrar identidad y ejecuciones de agentes IA

**Objective:** Usar una identidad técnica compartida manteniendo trazabilidad por agente y solicitante.

**Files:**
- Create: `supabase/migrations/024_siio_agent_runs.sql`
- Create: `supabase/rollbacks/024_siio_agent_runs_rollback.sql`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `src/siio/SiioDashboard.tsx`
- Test: `tests/siio-agent-run-permissions.test.mjs`

**Step 1: Write failing tests**

Probar obligatoriedad de:

- `technical_identity`;
- `agent_id`;
- versión de instrucciones;
- fuentes;
- solicitante/disparador;
- estado;
- costo estimado/real cuando aplique;
- resultado y aprobación humana.

Probar que IA no aprueba, publica, cierra ni contacta externamente sin autorización registrada.

**Step 2: Implement append-oriented run log**

Los runs terminados no se sobrescriben; correcciones se registran como nuevos eventos o revisiones.

**Step 3: Verify**

Run:

```bash
node tests/siio-agent-run-permissions.test.mjs
npm run check:siio-agents
npm run build
npm run check:backend-parity
```

Expected: PASS.

**Step 4: Commit**

```bash
git add supabase/migrations/024_siio_agent_runs.sql supabase/rollbacks/024_siio_agent_runs_rollback.sql server/index.js 'api/[...path].js' src/siio tests/siio-agent-run-permissions.test.mjs
git commit -m "feat: audit shared AI agent identity"
```

---

### Task 15: Ejecutar suite completa y auditoría negativa

**Objective:** Demostrar que cada perfil recibe acceso permitido y `403` para acciones prohibidas.

**Files:**
- Create: `tests/access-control-e2e.test.mjs`
- Create: `scripts/run_all_checks.mjs`
- Modify: `package.json`
- Create: `docs/qa/siio-access-control-qa.md`

**Step 1: Create test personas**

Perfiles sintéticos:

```text
ADM
GER
DIR Comercial
DIR Operaciones
DIR Financiera
COM
COM + Licitaciones
COL Operaciones
JUN
IA
```

**Step 2: Exercise positive and negative paths**

Para cada persona probar navegación, endpoint de lectura, endpoint de escritura y una acción explícitamente prohibida.

**Step 3: Run complete checks**

Run:

```bash
node scripts/run_all_checks.mjs
npm run check:backend-parity
npm run build
```

Expected:

```text
all access-control checks passed
backend parity OK
vite build completed
```

**Step 4: Security checks**

Buscar y exigir cero resultados para:

```text
directora.licitaciones@seguridadnacional.co
TENDER_ACCESS_EMAILS
role === 'director' como autorización suficiente
isManager(currentProfile) en endpoints migrados
```

**Step 5: Commit**

```bash
git add tests/access-control-e2e.test.mjs scripts/run_all_checks.mjs package.json docs/qa/siio-access-control-qa.md
git commit -m "test: verify access control end to end"
```

---

### Task 16: Preparar preview y QA gradual

**Objective:** Validar la experiencia sin tocar usuarios ni datos de producción.

**Files:**
- Modify: `docs/qa/siio-access-control-qa.md`
- Create: `docs/qa/siio-access-control-rollout.md`

**Step 1: Create preview data set**

Usar cuentas y registros sintéticos. No copiar salarios, contactos reales ni documentos confidenciales.

**Step 2: Deploy preview only**

Desplegar rama de implementación a un entorno preview aislado. Registrar URL y build id en la evidencia de QA, no en memoria persistente.

**Step 3: Smoke per persona**

Verificar visualmente:

- sidebar;
- acceso directo por URL;
- lectura permitida;
- botones visibles;
- intentos prohibidos;
- cierre de sesión;
- responsive desktop/móvil.

**Step 4: External QA**

Compartir evidencia en el canal de QA visual acordado y recoger aprobación. No confundir rama, preview y producción.

**Step 5: Rollout proposal**

Proponer piloto en este orden:

1. Administrador sintético.
2. Gerencia sintética.
3. Director de una sola área piloto.
4. Colaborador con una asignación.
5. Comercial y Comercial + Licitaciones.
6. Junta con una publicación aprobada.
7. Identidad técnica IA.

**Step 6: Stop gate**

No ejecutar migraciones ni despliegue de producción hasta recibir autorización explícita.

**Step 7: Commit**

```bash
git add docs/qa/siio-access-control-qa.md docs/qa/siio-access-control-rollout.md
git commit -m "docs: define access control QA and rollout"
```

---

## Orden de implementación recomendado

```text
Fase A: Tasks 1–7
→ preview técnico
→ QA de Administración y navegación
→ aprobación

Fase B: Tasks 8–11
→ preview funcional
→ QA Comercial, Licitaciones y SIIO por área
→ aprobación

Fase C: Tasks 12–14
→ piloto con una fuente y un área real
→ QA de cierre, Junta y agentes
→ aprobación

Cierre: Tasks 15–16
→ auditoría integral
→ autorización explícita
→ producción
```

## Criterios de aceptación global

- Ninguna autorización depende de correo electrónico.
- Perfil, área y permiso adicional son independientes.
- Un Director no ve ni escribe fuera de sus áreas.
- Un Comercial ve resumen del pipeline del equipo y detalle solo de sus oportunidades.
- Licitaciones requiere permiso adicional.
- Un Colaborador solo opera asignaciones propias.
- Junta solo ve publicaciones aprobadas.
- IA no adquiere autoridad humana.
- Local y Vercel mantienen paridad.
- Cada acción prohibida devuelve `403` desde servidor.
- Toda acción sensible genera trazabilidad.
- Build y suite completa pasan antes de preview.
- Producción requiere autorización explícita.
