# Licitaciones: Oportunidades, Configuración y GO/NO GO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir Radar → Seguimiento y reorganizar Licitaciones en Radar, Seguimiento y Oportunidades, con búsquedas dentro del Radar, Configuración protegida y decisión humana GO/NO GO que inicia preparación automáticamente.

**Architecture:** La primera fase reutiliza el adaptador backend existente `setTenderStatus` para resolver `stable_key` antes de invocar el RPC UUID y separa configuración/búsquedas sin cambiar el modelo de datos. La segunda fase añade una migración `022` y un servicio compartido para persistir decisiones humanas inmutables y estado de oferta; ambos backends seguirán byte-a-byte idénticos y la UI consumirá un resumen enriquecido de Oportunidades.

**Tech Stack:** React 19, TypeScript, Vite, Express, Supabase/PostgreSQL, PGlite, Node.js `assert`, esbuild.

## Global Constraints

- Navegación primaria exacta: `Radar | Seguimiento | Oportunidades`.
- `GO autorizado` es filtro dentro de Oportunidades, no pestaña independiente.
- Recomendación automática y decisión humana deben permanecer separadas.
- Solo Admin, Gerencia y Dirección de Licitaciones con permiso `licitaciones` pueden editar Configuración o autorizar GO/NO GO.
- La justificación GO/NO GO es opcional; actor y fecha son obligatorios.
- Autorizar GO inicia preparación de oferta de forma atómica e idempotente.
- Una licitación vencida muestra advertencia calculada con `America/Bogota`, pero mantiene acciones.
- No duplicar licitaciones, oportunidades, decisiones vigentes ni paquetes de preparación.
- `server/index.js` y `api/[...path].js` deben quedar byte-a-byte idénticos.
- No aplicar migraciones, mergear ni desplegar sin los gates humanos definidos.
- TDD obligatorio: cada cambio de producción debe estar precedido por una prueba roja observada.

---

## Mapa de archivos y responsabilidades

### Archivos nuevos

- `src/tenders/TenderOpportunitiesView.tsx`: bandeja renombrada, filtros de ciclo y acceso al expediente.
- `src/tenders/TenderConfigurationView.tsx`: Base habilitante SN y carga de RUP; no contiene búsquedas guardadas.
- `src/tenders/components/TenderSavedSearches.tsx`: guardar, listar, aplicar y eliminar búsquedas desde Radar.
- `src/tenders/components/TenderGoNoGoDecisionPanel.tsx`: recomendación, decisión humana y confirmación.
- `src/tenders/permissions.ts`: permisos de presentación de Configuración/GO; el backend sigue siendo autoritativo.
- `tender-go-no-go-rpc.js`: validación y llamada compartida al RPC de decisión/estado de oferta.
- `supabase/migrations/022_tender_go_no_go_workflow.sql`: tabla de decisiones, estado de oferta, RPC atómico, índices, RLS y grants.
- `tests/tender-radar-enter-tracking.test.mjs`: regresión `stable_key` → UUID.
- `tests/tender-navigation-opportunities.test.mjs`: navegación, aliases y nombres.
- `tests/tender-saved-searches-radar.test.mjs`: búsquedas dentro del Radar.
- `tests/tender-configuration-permissions.test.mjs`: Configuración y autorización fina.
- `tests/tender-expired-warning.test.mjs`: fecha Bogotá y acciones no bloqueadas.
- `tests/tender-go-no-go-migration.test.mjs`: contrato estático de migración.
- `tests/tender-go-no-go-pglite.integration.test.mjs`: atomicidad, historial e idempotencia.
- `tests/tender-go-no-go-api.test.mjs`: servicio y rutas backend.
- `tests/tender-opportunities-filters.test.mjs`: resumen y filtros formales.

### Archivos modificados

- `src/tenders/TenderRadarView.tsx`: usa entrada por clave estable, advertencia vencida y búsquedas guardadas.
- `src/tenders/radarUtils.ts`: helper Bogotá testeable.
- `src/tenders/TendersModule.tsx`: tres tabs, vista Oportunidades y Configuración secundaria.
- `src/tenders/components/TenderModuleTabs.tsx`: etiquetas/rutas nuevas y botón Configuración.
- `src/tenders/types.ts`: vistas, decisiones, estados de oferta y resumen de Oportunidades.
- `src/tenders/api.ts`: adaptadores `enterTrackingFromRadar`, búsquedas, configuración, oportunidades y GO/NO GO.
- `src/tenders/viewUtils.ts`: normalización de aliases antiguos y filtros de Oportunidades.
- `src/main.tsx`: normalización de hash y uso del panel formal GO/NO GO en detalle.
- `src/styles.css`: controles nuevos y respuesta móvil.
- `access-control.js`: acción `LICITACIONES_CONFIGURE`.
- `tests/access-control.test.mjs`: contrato pasa de 34 a 35 acciones y matriz Configuración.
- `server/index.js`: permisos de Configuración, rutas/servicios GO/NO GO y resumen enriquecido.
- `api/[...path].js`: copia exacta de `server/index.js` después de cada cambio backend.
- Pruebas existentes de Licitaciones: actualización de contratos visibles sin reducir cobertura.

### Archivos retirados o renombrados

- `src/tenders/TenderDossiersView.tsx` → `src/tenders/TenderOpportunitiesView.tsx`.
- `src/tenders/TenderProfilesView.tsx` se retira después de extraer Configuración y búsquedas.

---

## Fase 1 — Corrección urgente y navegación coherente

### Task 1: Corregir Radar → Seguimiento con resolución de clave estable

**Files:**
- Create: `tests/tender-radar-enter-tracking.test.mjs`
- Modify: `src/tenders/api.ts`
- Modify: `src/tenders/TenderRadarView.tsx`
- Modify: `tests/tender-tracking-api.test.mjs`
- Modify: `server/index.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Produces: `enterTrackingFromRadar<T>(request: TenderRequest, stableKey: string): Promise<T>`.
- Consumes: `PATCH /api/tender-status?id=<stable_key>` y `setTenderStatus(database, stableKey, 'en_revision', currentProfile)`.
- Invariant: `callTenderTrackingUpdate` sigue recibiendo únicamente UUID.

- [ ] **Step 1: Escribir la prueba roja de frontend**

Crear una prueba que bundlee `src/tenders/api.ts`, inyecte un `request` espía y exija el contrato estable:

```js
const calls = [];
await enterTrackingFromRadar(async (path, options) => {
  calls.push({ path, options });
  return { internal_status: 'en_revision' };
}, 'abc123stablekey');
assert.equal(calls[0].path, '/api/tender-status?id=abc123stablekey');
assert.equal(calls[0].options.method, 'PATCH');
assert.deepEqual(JSON.parse(calls[0].options.body), { internal_status: 'en_revision' });
```

Añadir contrato estático:

```js
assert.match(radar, /enterTrackingFromRadar\(request, tender\.stable_key \|\| tender\.id\)/);
assert.doesNotMatch(radar, /updateTracking[^;]*tender\.id/);
```

- [ ] **Step 2: Ejecutar y observar RED**

Run:

```bash
node tests/tender-radar-enter-tracking.test.mjs
```

Expected: FAIL porque `enterTrackingFromRadar` no está exportado y Radar aún llama `/api/tender-tracking-update` con `tender.id`.

- [ ] **Step 3: Implementar el adaptador mínimo**

En `src/tenders/api.ts`:

```ts
export async function enterTrackingFromRadar<T>(request: TenderRequest, stableKey: string): Promise<T> {
  const id = String(stableKey || '').trim();
  if (!id) throw new Error('Debe indicar la licitación.');
  return request<T>(`/api/tender-status?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ internal_status: 'en_revision' }),
  });
}
```

En `TenderRadarView.tsx`, reemplazar la llamada UUID por:

```ts
await enterTrackingFromRadar(request, tender.stable_key || tender.id);
```

Mantener `setTenderStatus` como frontera backend: `getPersistedTenderByStableKey` resuelve la fila y `callTenderTrackingUpdate(database, tender.id, ...)` valida UUID.

- [ ] **Step 4: Fortalecer contrato backend**

En `tests/tender-tracking-api.test.mjs`, exigir dentro de `setTenderStatus`:

```js
assert.match(statusHandler[0], /getPersistedTenderByStableKey\(database, stableKey\)/);
assert.match(statusHandler[0], /callTenderTrackingUpdate\(database, tender\.id,/);
assert.match(statusHandler[0], /tracking_status: 'pendiente_revision'/);
```

Exportar `setTenderStatus` desde ambos backends solo si la prueba dinámica lo requiere; no relajar `requireTenderTrackingId` ni `requireUuid`.

- [ ] **Step 5: Ejecutar GREEN y regresión**

Run:

```bash
node tests/tender-radar-enter-tracking.test.mjs
node tests/tender-tracking-api.test.mjs
node tests/tender-tracking-rpc-contract.test.mjs
node tests/tender-tracking-pglite.integration.test.mjs
npm run check:backend-parity
```

Expected: todos PASS y `backend parity OK`.

- [ ] **Step 6: Commit**

```bash
git add src/tenders/api.ts src/tenders/TenderRadarView.tsx server/index.js 'api/[...path].js' tests/tender-radar-enter-tracking.test.mjs tests/tender-tracking-api.test.mjs
git commit -m "fix: resolve radar tender before tracking"
```

### Task 2: Renombrar Expedientes a Oportunidades y conservar aliases

**Files:**
- Create: `tests/tender-navigation-opportunities.test.mjs`
- Rename: `src/tenders/TenderDossiersView.tsx` → `src/tenders/TenderOpportunitiesView.tsx`
- Modify: `src/tenders/TendersModule.tsx`
- Modify: `src/tenders/components/TenderModuleTabs.tsx`
- Modify: `src/tenders/types.ts`
- Modify: `src/tenders/viewUtils.ts`
- Modify: `src/main.tsx`
- Modify: `tests/tender-functional-views.test.mjs`
- Modify: `tests/tender-module-ui.test.mjs`
- Modify: `tests/tender-route-state-static.test.mjs`

**Interfaces:**
- Produces: `TenderModuleView = 'radar' | 'seguimiento' | 'oportunidades' | 'configuracion'`.
- Produces: `normalizeTenderModuleView(value: string): TenderModuleView`.
- Compatibility: `expedientes → oportunidades`, `perfiles → configuracion`.

- [ ] **Step 1: Escribir prueba roja de navegación**

La prueba debe exigir:

```js
assert.deepEqual(primaryViews, ['radar', 'seguimiento', 'oportunidades']);
assert.equal(normalizeTenderModuleView('expedientes'), 'oportunidades');
assert.equal(normalizeTenderModuleView('perfiles'), 'configuracion');
assert.equal(normalizeTenderModuleView('desconocida'), 'radar');
for (const label of ['Radar', 'Seguimiento', 'Oportunidades']) assert.match(tabs, new RegExp(label));
assert.doesNotMatch(tabs, />Expedientes</);
assert.doesNotMatch(tabs, />Perfiles de búsqueda</);
```

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-navigation-opportunities.test.mjs
```

Expected: FAIL porque la unión y tabs aún contienen `expedientes` y `perfiles`.

- [ ] **Step 3: Implementar tipos y normalización**

En `viewUtils.ts`:

```ts
export function normalizeTenderModuleView(value: string): TenderModuleView {
  if (value === 'expedientes') return 'oportunidades';
  if (value === 'perfiles') return 'configuracion';
  return value === 'seguimiento' || value === 'oportunidades' || value === 'configuracion' ? value : 'radar';
}
```

Usar este helper desde `main.tsx` en vez de la lista hardcodeada.

- [ ] **Step 4: Renombrar componente y copy**

Renombrar `TenderDossiersView` a `TenderOpportunitiesView`, manteniendo `Abrir expediente` y cambiando:

```tsx
<span className="eyebrow">Bandeja de oportunidades</span>
<h2>Oportunidades</h2>
<p>Gestione oportunidades convertidas, su expediente, decisión y preparación.</p>
```

`TenderModuleTabs` solo renderiza tres vistas primarias. `TendersModule` monta Configuración fuera del array de tabs.

- [ ] **Step 5: Actualizar y ejecutar pruebas**

```bash
node tests/tender-navigation-opportunities.test.mjs
node tests/tender-functional-views.test.mjs
node tests/tender-module-ui.test.mjs
node tests/tender-route-state-static.test.mjs
npm run build
```

Expected: PASS y build sin errores TypeScript.

- [ ] **Step 6: Commit**

```bash
git add src/tenders src/main.tsx tests/tender-navigation-opportunities.test.mjs tests/tender-functional-views.test.mjs tests/tender-module-ui.test.mjs tests/tender-route-state-static.test.mjs
git commit -m "feat: rename tender dossiers to opportunities"
```

### Task 3: Mover búsquedas guardadas al Radar

**Files:**
- Create: `src/tenders/components/TenderSavedSearches.tsx`
- Create: `tests/tender-saved-searches-radar.test.mjs`
- Modify: `src/tenders/TenderRadarView.tsx`
- Modify: `src/tenders/api.ts`
- Modify: `src/tenders/types.ts`
- Modify: `tests/tender-search-profiles.test.mjs`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/tender-search-profiles` existentes.
- Produces: `TenderSavedSearches` con props `filters`, `profiles`, `onProfilesChange`, `onApply`.
- Copy visible exacto: `Guardar búsqueda` y `Búsquedas guardadas`.

- [ ] **Step 1: Escribir prueba roja**

Exigir que Radar monte el componente y que este no cargue la ficha corporativa:

```js
assert.match(radar, /<TenderSavedSearches/);
assert.match(savedSearches, />Guardar búsqueda</);
assert.match(savedSearches, />Búsquedas guardadas</);
assert.match(savedSearches, /\/api\/tender-search-profiles/);
assert.doesNotMatch(savedSearches, /tender-company-profile|RUP|Información empresa/);
assert.doesNotMatch(moduleSource, /TenderProfilesView/);
```

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-saved-searches-radar.test.mjs
```

Expected: FAIL porque el componente no existe y la lógica sigue en `TenderProfilesView`.

- [ ] **Step 3: Extraer el componente**

Reutilizar `TenderSearchProfile` y mapear filtros de Radar:

```ts
const payload = {
  name: name.trim(),
  region_key: filters.region,
  source_filter: filters.source,
  section_filter: filters.section,
  internal_status_filter: filters.internalStatus,
  deadline_filter: filters.deadline,
  value_filter: filters.value,
  score_filter: filters.score,
  query_text: filters.query,
};
```

El panel debe aplicar una búsqueda mediante el callback existente, no navegar a otra vista. Eliminar conserva `window.confirm`.

- [ ] **Step 4: Integrar en Radar**

Cargar `loadProfiles` junto a Radar; mostrar los dos botones después del bloque de filtros; mantener compatibilidad con `profile=<uuid>` para enlaces históricos.

- [ ] **Step 5: Ejecutar GREEN**

```bash
node tests/tender-saved-searches-radar.test.mjs
node tests/tender-search-profiles.test.mjs
node tests/tender-filter-compact-layout.test.mjs
npm run build
```

Expected: PASS; el panel compacto conserva sus dos filas en escritorio.

- [ ] **Step 6: Commit**

```bash
git add src/tenders tests/tender-saved-searches-radar.test.mjs tests/tender-search-profiles.test.mjs
git commit -m "feat: manage saved searches from radar"
```

### Task 4: Crear Configuración protegida y retirar la vista mezclada

**Files:**
- Create: `src/tenders/TenderConfigurationView.tsx`
- Create: `src/tenders/permissions.ts`
- Create: `tests/tender-configuration-permissions.test.mjs`
- Modify: `src/tenders/TendersModule.tsx`
- Modify: `src/tenders/components/TenderModuleTabs.tsx`
- Modify: `src/tenders/types.ts`
- Modify: `access-control.js`
- Modify: `tests/access-control.test.mjs`
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Delete: `src/tenders/TenderProfilesView.tsx`

**Interfaces:**
- Produces action: `ACTIONS.LICITACIONES_CONFIGURE = 'licitaciones.configure'`.
- Produces UI helper: `canConfigureTenders(profile): boolean`.
- Backend authorization: `requireAction(currentProfile, ACTIONS.LICITACIONES_CONFIGURE)`.

- [ ] **Step 1: Escribir RED de matriz de permisos**

Actualizar el contrato a 35 acciones y añadir:

```js
{ name: 'admin con permiso configura', profile: tenderUser('admin'), expected: true },
{ name: 'gerencia con permiso configura', profile: tenderUser('gerencia'), expected: true },
{ name: 'director con permiso configura', profile: tenderUser('director'), expected: true },
{ name: 'comercial con permiso no configura', profile: tenderUser('comercial'), expected: false },
{ name: 'director sin permiso no configura', profile: human('director'), expected: false },
```

Añadir contrato frontend/backend:

```js
assert.match(tabs, />Configuración</);
assert.match(configuration, /Base habilitante SN/);
assert.match(configuration, /Cargar RUP/);
assert.doesNotMatch(configuration, /Guardar búsqueda|Búsquedas guardadas/);
for (const source of backends) assert.match(source, /ACTIONS\.LICITACIONES_CONFIGURE/);
```

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/access-control.test.mjs
node tests/tender-configuration-permissions.test.mjs
```

Expected: FAIL porque la acción y la vista no existen.

- [ ] **Step 3: Implementar acción fina**

En `access-control.js`, añadir la acción y resolverla así:

```js
case ACTIONS.LICITACIONES_CONFIGURE:
  return canHumanTenderAction(profile)
    && hasHumanRole(profile, new Set(['admin', 'gerencia', 'director']));
```

Reemplazar `canViewTenders` por `requireAction(...LICITACIONES_CONFIGURE)` en los endpoints de escritura:

- `PUT /api/tender-company-profile`;
- `POST /api/tender-company-profile-upload-url`;
- `POST /api/tender-company-profile-process-upload`;
- `POST /api/tender-company-profile-upload`.

La lectura `GET /api/tender-company-profile` conserva `LICITACIONES_VIEW`.

- [ ] **Step 4: Extraer Configuración y botón**

Mover exclusivamente la ficha/RUP desde `TenderProfilesView` a `TenderConfigurationView`. Mostrar el botón Configuración si `canConfigureTenders(data.currentProfile)` y montar la vista secundaria cuando `view === 'configuracion'`.

- [ ] **Step 5: Ejecutar GREEN y paridad**

```bash
node tests/access-control.test.mjs
node tests/tender-configuration-permissions.test.mjs
node tests/tender-company-profile-editable-static.test.mjs
npm run check:backend-parity
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add access-control.js server/index.js 'api/[...path].js' src/tenders tests/access-control.test.mjs tests/tender-configuration-permissions.test.mjs
git commit -m "feat: protect tender configuration"
```

### Task 5: Advertir vencidas con fecha Bogotá sin bloquear acciones

**Files:**
- Create: `tests/tender-expired-warning.test.mjs`
- Modify: `src/tenders/radarUtils.ts`
- Modify: `src/tenders/TenderRadarView.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `isTenderExpired(deadline: string | null | undefined, now?: Date): boolean`.
- Timezone fija: `America/Bogota`.

- [ ] **Step 1: Escribir prueba roja determinística**

```js
const now = new Date('2026-07-22T17:00:00.000Z'); // 12:00 Bogotá
assert.equal(isTenderExpired('2026-07-21', now), true);
assert.equal(isTenderExpired('2026-07-22', now), false);
assert.equal(isTenderExpired('2026-07-23', now), false);
assert.equal(isTenderExpired(null, now), false);
assert.match(radar, /Vencida · valide adendas o nueva fecha en la fuente oficial/);
assert.match(radar, /Pasar a seguimiento/);
assert.match(radar, /Convertir en oportunidad/);
```

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-expired-warning.test.mjs
```

Expected: FAIL porque no existe el helper ni la advertencia.

- [ ] **Step 3: Implementar helper y badge**

```ts
export function isTenderExpired(deadline: string | null | undefined, now = new Date()): boolean {
  if (!deadline) return false;
  const date = String(deadline).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const bogotaToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return date < bogotaToday;
}
```

Renderizar la advertencia sin envolver ni deshabilitar las acciones.

- [ ] **Step 4: Ejecutar GREEN**

```bash
node tests/tender-expired-warning.test.mjs
node tests/tender-search-profiles.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tenders/radarUtils.ts src/tenders/TenderRadarView.tsx src/styles.css tests/tender-expired-warning.test.mjs
git commit -m "feat: warn about expired tenders"
```

---

## Fase 2 — Decisión humana GO/NO GO y ciclo de Oportunidades

### Task 6: Crear migración de decisiones y estado de oferta

**Files:**
- Create: `supabase/migrations/022_tender_go_no_go_workflow.sql`
- Create: `tests/tender-go-no-go-migration.test.mjs`
- Create: `tests/tender-go-no-go-pglite.integration.test.mjs`

**Interfaces:**
- Table: `psi_tender_go_no_go_decisions`.
- Column: `psi_sales_opportunities.tender_offer_status` nullable with allowed states.
- RPC: `psi_record_tender_go_no_go(p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text, p_analysis_interaction_id uuid, p_justification text, p_preparation jsonb) returns jsonb`.

- [ ] **Step 1: Escribir prueba estática roja**

Exigir tabla, FKs, índices, RLS, grants, check constraints, bloqueo `FOR UPDATE`, cadena de supersesión y RPC `security definer`.

```js
assert.match(sql, /create table if not exists public\.psi_tender_go_no_go_decisions/);
assert.match(sql, /decision text not null check \(decision in \('go','no_go'\)\)/);
assert.match(sql, /supersedes_decision_id uuid references public\.psi_tender_go_no_go_decisions/);
assert.match(sql, /tender_offer_status text/);
assert.match(sql, /create or replace function public\.psi_record_tender_go_no_go/);
assert.match(sql, /for update/);
assert.match(sql, /security definer/);
```

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-go-no-go-migration.test.mjs
```

Expected: FAIL porque `022` no existe.

- [ ] **Step 3: Escribir migración mínima**

Estados permitidos:

```sql
check (tender_offer_status is null or tender_offer_status in (
  'pendiente_decision','en_preparacion','lista_para_presentar',
  'presentada','adjudicada','no_adjudicada','cerrada_no_go'
))
```

La tabla incluye `opportunity_id`, `tender_id`, `decision`, `analysis_interaction_id`, `justification`, `decided_by`, `decided_at`, `supersedes_decision_id`, `created_at`.

El RPC debe:

1. validar actor activo, rol `admin|gerencia|director` y permiso `licitaciones`;
2. bloquear oportunidad y licitación;
3. validar `tipo_producto_original = 'Licitación Pública'` o `external_source like 'secop_radar:%'`;
4. leer la última decisión y asignarla como `supersedes_decision_id`;
5. insertar decisión;
6. para GO, insertar preparación únicamente si no existe una interacción `kind=tender_offer_preparation`;
7. actualizar `tender_offer_status` a `en_preparacion` para GO o `cerrada_no_go` para NO GO;
8. devolver `decision`, `preparation_created` y `tender_offer_status`.

- [ ] **Step 4: Escribir integración PGlite roja/verde**

Preparar tablas mínimas y ejecutar la migración. Casos obligatorios:

```js
assert.equal(firstGo.preparation_created, true);
assert.equal(secondGo.preparation_created, false);
assert.equal(await countPreparations(opportunityId), 1);
assert.equal(await countDecisions(opportunityId), 2);
assert.equal(secondGo.supersedes_decision_id, firstGo.decision_id);
assert.equal(noGo.tender_offer_status, 'cerrada_no_go');
await assert.rejects(() => decideAs('comercial'), /permisos/i);
await assert.rejects(() => decideWithoutTenderPermission('director'), /permisos/i);
```

- [ ] **Step 5: Ejecutar GREEN e idempotencia**

```bash
node tests/tender-go-no-go-migration.test.mjs
node tests/tender-go-no-go-pglite.integration.test.mjs
node tests/tender-go-no-go-pglite.integration.test.mjs
```

Expected: PASS en ambas ejecuciones.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/022_tender_go_no_go_workflow.sql tests/tender-go-no-go-migration.test.mjs tests/tender-go-no-go-pglite.integration.test.mjs
git commit -m "feat: add tender go no go workflow"
```

### Task 7: Crear servicio y API formal GO/NO GO

**Files:**
- Create: `tender-go-no-go-rpc.js`
- Create: `tests/tender-go-no-go-api.test.mjs`
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Modify: `tests/tender-offer-preparation-static.test.mjs`

**Interfaces:**
- Produces: `callTenderGoNoGoDecision(database, input, currentProfile)`.
- Routes: `GET /api/tender-go-no-go-decision?id=<opportunity_uuid>` y `POST /api/tender-go-no-go-decision`.
- POST body: `{ opportunity_id, decision: 'go'|'no_go', analysis_interaction_id?: string|null, justification?: string|null }`.

- [ ] **Step 1: Escribir prueba roja de servicio**

```js
await callTenderGoNoGoDecision(database, {
  opportunity_id: OPPORTUNITY_ID,
  decision: 'go',
  analysis_interaction_id: ANALYSIS_ID,
  justification: '',
}, directorProfile);
assert.equal(observedRpc.name, 'psi_record_tender_go_no_go');
assert.equal(observedRpc.args.p_decision, 'go');
assert.equal(observedRpc.args.p_justification, null);
assert.equal(observedRpc.args.p_preparation.kind, 'tender_offer_preparation');
```

Exigir rechazo de IDs inválidos, decisión desconocida, agente y usuario sin `LICITACIONES_GO_NO_GO_APPROVE`.

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-go-no-go-api.test.mjs
```

Expected: FAIL porque el módulo y rutas no existen.

- [ ] **Step 3: Implementar servicio compartido**

El servicio debe:

1. validar UUID y decisión;
2. ejecutar `requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE)` antes de escribir;
3. resolver oportunidad y licitación vinculada;
4. obtener documentos/análisis actuales;
5. construir `buildTenderOfferPreparation(...)` solo para GO;
6. llamar una vez al RPC;
7. devolver la decisión vigente y preparación.

No insertar directamente en `psi_tender_go_no_go_decisions` ni en `psi_sales_interactions` desde Express.

- [ ] **Step 4: Reemplazar aprobación antigua**

Eliminar el botón/ruta como autoridad independiente. Mantener temporalmente `POST /api/tender-offer-preparation-approve` como alias controlado que responde `410` con:

```json
{ "error": "Use Autorizar GO para iniciar la preparación de oferta." }
```

Actualizar la prueba antigua para exigir que no exista una segunda vía de aprobación.

- [ ] **Step 5: Ejecutar GREEN y paridad**

```bash
node tests/tender-go-no-go-api.test.mjs
node tests/tender-offer-preparation-static.test.mjs
node tests/access-control.test.mjs
npm run check:backend-parity
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tender-go-no-go-rpc.js server/index.js 'api/[...path].js' tests/tender-go-no-go-api.test.mjs tests/tender-offer-preparation-static.test.mjs
git commit -m "feat: authorize tender go no go decisions"
```

### Task 8: Enriquecer Oportunidades y sus filtros formales

**Files:**
- Create: `tests/tender-opportunities-filters.test.mjs`
- Modify: `src/tenders/TenderOpportunitiesView.tsx`
- Modify: `src/tenders/api.ts`
- Modify: `src/tenders/types.ts`
- Modify: `src/tenders/viewUtils.ts`
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Modify: `tests/tender-dossiers-api.test.mjs`

**Interfaces:**
- Produces route: `GET /api/tender-opportunities?filter=<all|pending_decision|go_authorized|in_preparation|submitted|closed>&limit=&offset=`.
- Legacy alias: `GET /api/tender-dossiers` delega al mismo servicio.
- Produces: `TenderOpportunitySummary` con `recommendation`, `decision`, `decided_by_name`, `decided_at`, `tender_offer_status`.

- [ ] **Step 1: Escribir RED de filtros puros**

En `viewUtils.ts`, definir y probar:

```ts
export type TenderOpportunityFilter = 'all' | 'pending_decision' | 'go_authorized' | 'in_preparation' | 'submitted' | 'closed';
```

Casos:

```js
assert.deepEqual(filterOpportunitySummaries(rows, 'pending_decision').map(x => x.id), ['pending']);
assert.deepEqual(filterOpportunitySummaries(rows, 'go_authorized').map(x => x.id), ['go-active', 'go-presented']);
assert.deepEqual(filterOpportunitySummaries(rows, 'in_preparation').map(x => x.id), ['go-active']);
assert.deepEqual(filterOpportunitySummaries(rows, 'submitted').map(x => x.id), ['go-presented']);
assert.deepEqual(filterOpportunitySummaries(rows, 'closed').map(x => x.id), ['no-go', 'awarded', 'lost']);
```

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-opportunities-filters.test.mjs
```

Expected: FAIL porque no existen el tipo ni el helper.

- [ ] **Step 3: Enriquecer resumen backend**

`buildTenderDossierSummary` pasa a `buildTenderOpportunitySummary` y devuelve ambos conceptos separados:

```js
{
  recommendation: analysis?.go_no_go?.decision || analysis?.recommendation || 'Pendiente',
  decision: latestDecision?.decision || null,
  decided_by_name: latestDecision?.psi_sales_profiles?.full_name || null,
  decided_at: latestDecision?.decided_at || null,
  tender_offer_status: opportunity?.tender_offer_status || 'pendiente_decision',
}
```

No usar `recommendation` para poblar `decision`.

- [ ] **Step 4: Implementar endpoint y alias**

Extraer servicio `listTenderOpportunities(database, query)`. Tanto `/api/tender-opportunities` como `/api/tender-dossiers` llaman ese servicio. Aplicar paginación acotada y filtros backend sin introducir N+1 adicional; si la agregación existente no permite un join único, mantener aislamiento por fila y documentar límite 50.

- [ ] **Step 5: Implementar filtros UI**

Mostrar exactamente:

```text
Todas | Pendiente de decisión | GO autorizado | En preparación | Presentadas | Cerradas
```

Cada tarjeta muestra:

- `Recomendación del sistema`;
- `Decisión humana`;
- estado de oferta;
- actor/fecha si existe;
- `Abrir expediente`.

- [ ] **Step 6: Ejecutar GREEN**

```bash
node tests/tender-opportunities-filters.test.mjs
node tests/tender-dossiers-api.test.mjs
node tests/tender-functional-views.test.mjs
npm run check:backend-parity
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tenders server/index.js 'api/[...path].js' tests/tender-opportunities-filters.test.mjs tests/tender-dossiers-api.test.mjs tests/tender-functional-views.test.mjs
git commit -m "feat: filter tender opportunities by lifecycle"
```

### Task 9: Integrar decisión formal en el detalle de la oportunidad

**Files:**
- Create: `src/tenders/components/TenderGoNoGoDecisionPanel.tsx`
- Create: `tests/tender-go-no-go-ui.test.mjs`
- Modify: `src/tenders/api.ts`
- Modify: `src/tenders/types.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `tests/tender-go-no-go-report-static.test.mjs`
- Modify: `tests/tender-offer-preparation-static.test.mjs`

**Interfaces:**
- Consumes: `loadTenderGoNoGoDecision` y `recordTenderGoNoGoDecision`.
- Props: `{ opportunityId, analysis, currentProfile, request, onChanged }`.
- UI decisions: `go`, `no_go`; justificación opcional.

- [ ] **Step 1: Escribir prueba roja UI**

```js
assert.match(panel, /Recomendación del sistema/);
assert.match(panel, /Decisión humana/);
assert.match(panel, /Autorizar GO/);
assert.match(panel, /Registrar NO GO/);
assert.match(panel, /Justificación opcional/);
assert.match(panel, /recordTenderGoNoGoDecision/);
assert.doesNotMatch(main, />Aprobar preparación de oferta</);
```

Exigir que usuario sin permiso no vea botones de escritura, pero sí la decisión vigente.

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-go-no-go-ui.test.mjs
```

Expected: FAIL porque el panel no existe y sigue el botón antiguo.

- [ ] **Step 3: Implementar API frontend**

```ts
export async function recordTenderGoNoGoDecision(
  request: TenderRequest,
  input: TenderGoNoGoDecisionInput,
): Promise<TenderGoNoGoPayload> {
  return request('/api/tender-go-no-go-decision', {
    method: 'POST', body: JSON.stringify(input),
  });
}
```

- [ ] **Step 4: Implementar panel y confirmación**

La confirmación debe mostrar nombre, recomendación, riesgos, decisión y textarea opcional. Después de GO exitoso, recargar decisión y preparación; después de NO GO, conservar expediente en solo lectura y actualizar estado.

No ocultar el dictamen automático ni renombrarlo como decisión.

- [ ] **Step 5: Ejecutar GREEN y build**

```bash
node tests/tender-go-no-go-ui.test.mjs
node tests/tender-go-no-go-report-static.test.mjs
node tests/tender-offer-preparation-static.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tenders/components/TenderGoNoGoDecisionPanel.tsx src/tenders/api.ts src/tenders/types.ts src/main.tsx src/styles.css tests/tender-go-no-go-ui.test.mjs tests/tender-go-no-go-report-static.test.mjs tests/tender-offer-preparation-static.test.mjs
git commit -m "feat: add formal tender go no go decision UI"
```

### Task 10: Verificación integral, documentación y gate de migración

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-tender-opportunities-navigation-design.md`
- Create: `docs/verification/tender-opportunities-2026-07-22.md`
- Modify: pruebas si la verificación descubre defectos, siempre con un nuevo ciclo RED/GREEN.

**Interfaces:**
- No produce API nueva.
- Produce evidencia fresca y lista de gates pendientes.

- [ ] **Step 1: Ejecutar suite completa de Licitaciones**

```bash
set -euo pipefail
for test in tests/tender*.test.mjs; do node "$test"; done
```

Expected: todos los archivos terminan con su mensaje `passed` y exit 0.

- [ ] **Step 2: Ejecutar controles generales**

```bash
node tests/access-control.test.mjs
npm run check:nav-permissions
npm run check:backend-parity
npm run build
```

Expected: PASS, `backend parity OK`, build Vite exitoso.

- [ ] **Step 3: Inspeccionar diff y secretos**

```bash
git diff --check
git status --short
git diff --stat
```

Buscar credenciales accidentales con el mecanismo aprobado del repositorio; ningún `.env`, token, URL firmada ni archivo RUP debe estar staged.

- [ ] **Step 4: QA autenticada local sin aplicar migración productiva**

Verificar en escritorio y 390 px:

1. tabs `Radar | Seguimiento | Oportunidades`;
2. Radar guarda/aplica búsquedas;
3. vencida muestra advertencia y conserva acciones;
4. `Pasar a seguimiento` funciona con una tarjeta real o fixture no UUID;
5. Configuración solo aparece a roles autorizados;
6. Oportunidades muestra recomendación y decisión separadas;
7. filtros cambian resultados;
8. GO crea una sola preparación;
9. consola sin errores.

- [ ] **Step 5: Documentar evidencia**

Registrar comandos, exit codes, capturas/rutas, limitaciones y los gates pendientes:

```text
MIGRACIÓN 022: NO APLICADA
MERGE: NO AUTORIZADO
DEPLOY: NO AUTORIZADO
RECONCILIACIÓN HISTÓRICA: NO EJECUTADA
```

Actualizar el estado de la especificación a `implementado en rama; pendiente gates productivos` solo si toda la evidencia está verde.

- [ ] **Step 6: Revisión independiente**

Aplicar `superpowers:requesting-code-review` sobre el diff completo. Corregir hallazgos críticos/importantes mediante TDD y repetir pasos 1–3.

- [ ] **Step 7: Commit final de evidencia**

```bash
git add docs/superpowers/specs/2026-07-22-tender-opportunities-navigation-design.md docs/verification/tender-opportunities-2026-07-22.md
git commit -m "docs: record tender opportunities verification"
```

---

## Orden de entrega y gates

### Incremento 1 — Puede revisarse sin migración

Incluye Tasks 1–5:

- error Radar → Seguimiento corregido;
- navegación nueva;
- Oportunidades renombrada;
- búsquedas en Radar;
- Configuración protegida;
- advertencia vencida.

Gate: revisión funcional. No requiere aplicar `022`.

### Incremento 2 — Requiere gate de migración

Incluye Tasks 6–10:

- decisión formal GO/NO GO;
- preparación automática;
- estado de oferta;
- filtros formales;
- UI de autorización.

Gate obligatorio antes de QA con datos reales: autorización para aplicar `022_tender_go_no_go_workflow.sql` en el entorno correspondiente.

## Definición de terminado

La implementación está terminada en rama cuando:

- Tasks 1–10 están marcadas;
- la prueba de regresión reproduce y previene el error original;
- todas las pruebas `tender*.test.mjs` pasan;
- `tests/access-control.test.mjs` pasa;
- backend parity pasa;
- TypeScript/Vite build pasa;
- QA autenticada desktop/móvil no registra errores;
- revisión independiente no tiene hallazgos críticos o importantes abiertos;
- no se ha aplicado migración, mergeado ni desplegado sin autorización explícita.
