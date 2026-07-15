# Licitaciones: separación funcional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar Radar, Seguimiento, Expedientes y Perfiles en flujos operativos reales, preservando y reforzando la importación y análisis automático de documentos al convertir una licitación.

**Architecture:** El frontend se dividirá en componentes bajo `src/tenders/`, con un orquestador liviano y clientes API tipados. Seguimiento persistirá su snapshot en `psi_public_tenders` y su historial en `psi_tender_tracking_events`; Expedientes compondrá un resumen desde oportunidades, documentos, análisis y preparación existentes. El contrato de conversión documental se protegerá primero y seguirá siendo síncrono en `POST /api/tender-convert` para SECOP II y ESU.

**Tech Stack:** React 19, TypeScript, Vite 8, Express, Supabase/PostgreSQL, Node.js `node:assert`, CSS existente.

## Global Constraints

- No aplicar migraciones en Supabase sin autorización de Juan.
- No hacer merge ni deploy sin autorización humana separada.
- Seguir TDD estricto: prueba roja, implementación mínima, prueba verde, refactor.
- Mantener equivalencia funcional entre `api/[...path].js` y `server/index.js`.
- Conservar el flujo oficial Hermes → motor oficial → Supabase → CRM.
- Radar descubre; Seguimiento gestiona; Expedientes produce; Perfiles configura.
- `POST /api/tender-convert` debe importar, extraer texto y analizar documentos automáticamente para SECOP II o ESU con URL oficial antes de responder.
- SECOP I y TVEC deben conservar `document_import_status: 'no_aplica'` mientras no exista importador compatible.
- La carga y análisis manuales son recuperación/complemento, no requisito para el primer análisis.
- La rama de trabajo es `feature/tender-functional-separation` en `/root/psi-comercial/plataforma-ventas/app-tender-functional-separation`.

---

## File map

### Crear

- `src/tenders/types.ts`: tipos mínimos del dominio y contratos de API.
- `src/tenders/api.ts`: cliente tipado del módulo y rutas.
- `src/tenders/TendersModule.tsx`: orquestador por subruta, permisos y navegación.
- `src/tenders/TenderRadarView.tsx`: descubrimiento, sincronización, filtros y transición.
- `src/tenders/TenderTrackingView.tsx`: cola operativa y edición persistente.
- `src/tenders/TenderDossiersView.tsx`: resumen documental y acciones de expediente.
- `src/tenders/TenderProfilesView.tsx`: ficha/RUP y perfiles guardados sin cargar Radar.
- `src/tenders/components/TenderModuleTabs.tsx`: navegación de los cuatro flujos.
- `src/tenders/components/TenderStatusBadge.tsx`: semáforos comunes sin compartir tableros.
- `supabase/migrations/014_tender_tracking_workflow.sql`: snapshot, historial, índices y RLS.
- `tests/tender-auto-analysis-contract.test.mjs`: regresión crítica de conversión.
- `tests/tender-tracking-migration.test.mjs`: contrato de esquema.
- `tests/tender-tracking-api.test.mjs`: endpoints y trazabilidad.
- `tests/tender-dossiers-api.test.mjs`: contrato de resumen documental.
- `tests/tender-functional-views.test.mjs`: separación de renderers y cargas.

### Modificar

- `src/main.tsx`: delegar la ruta de Licitaciones al nuevo orquestador y retirar la vista unificada.
- `src/styles.css`: estilos específicos y responsive de las cuatro vistas.
- `api/[...path].js`: corregir resultado de autoimportación, agregar Seguimiento y resumen de Expedientes.
- `server/index.js`: reflejar los mismos servicios/rutas del backend local.
- `tests/tender-auto-import-and-discard-static.test.mjs`: mantener el contrato histórico y añadir estado real.
- `tests/tender-module-ui.test.mjs`: reemplazar expectativas superficiales por composición real.
- `tests/tender-unified-view-and-dedup.test.mjs`: nueva regresión que rechaza el tablero único y conserva deduplicación.
- `docs/licitaciones-operacion.md`: documentar transiciones, persistencia y recuperación.

---

### Task 1: Blindar conversión → documentos → análisis automático

**Files:**
- Create: `tests/tender-auto-analysis-contract.test.mjs`
- Modify: `api/[...path].js:1616-1698`
- Modify: `server/index.js:1616-1698`
- Modify: `tests/tender-auto-import-and-discard-static.test.mjs`

**Interfaces:**
- Consumes: `importTenderDocumentsFromOfficialSource(database, opportunityId, currentProfile, { analyze })`.
- Produces: resultado `{ records, imported_count, failed_count, analysis_generated }` y respuesta de conversión `{ id, duplicate, document_import_status, document_import_error }`.

- [ ] **Step 1: Escribir la prueba roja del estado real**

Crear una prueba que lea ambos backends, extraiga el cuerpo de `convertTenderToOpportunity` y exija que el estado dependa del resultado real, no de una asignación incondicional:

```js
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const files = ['../api/[...path].js', '../server/index.js'].map(path =>
  readFileSync(new URL(path, import.meta.url), 'utf8')
);

for (const source of files) {
  assert.match(source, /await importTenderDocumentsFromOfficialSource\(database, opportunityId, currentProfile, \{ analyze: true \}\)/);
  assert.match(source, /analysis_generated/);
  assert.match(source, /imported_count/);
  assert.match(source, /document_import_status = importResult\.analysis_generated \? 'analisis_generado' : 'fallo_importacion'/);
  assert.doesNotMatch(source, /await importTenderDocumentsFromOfficialSource[\s\S]{0,180}document_import_status = 'analisis_generado'/);
  assert.match(source, /kind: 'tender_document_import_error'/);
}

console.log('tender automatic analysis contract passed');
```

- [ ] **Step 2: Ejecutar y verificar RED**

Run: `node tests/tender-auto-analysis-contract.test.mjs`
Expected: FAIL porque `analysis_generated` e `imported_count` no existen y el estado se asigna incondicionalmente.

- [ ] **Step 3: Hacer que el importador devuelva evidencia real**

En ambos backends, sustituir el retorno final del importador por:

```js
let analysisGenerated = false;
if (analyze) {
  const records = await getTenderDocumentRecords(database, opportunityId);
  const currentDocs = records.documents.filter(d => d.current !== false);
  if (currentDocs.length) {
    const companyProfile = await getTenderCompanyProfile(database);
    const analysis = buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile);
    await must(database.from('psi_sales_interactions').insert({
      opportunity_id: opportunityId,
      interaction_type: 'documento',
      created_by: currentProfile.id,
      occurred_at: new Date().toISOString(),
      notes: JSON.stringify({ ...analysis, auto_import: true, source: sourceLabel })
    }).select('id').single());
    analysisGenerated = true;
  }
}
const records = await getTenderDocumentRecords(database, opportunityId);
return {
  ...records,
  imported_count: uploaded.filter(doc => doc.current !== false).length,
  failed_count: uploaded.filter(doc => doc.current === false).length,
  analysis_generated: analysisGenerated && Boolean(records.analysis)
};
```

En `convertTenderToOpportunity`, capturar el resultado:

```js
const importResult = await importTenderDocumentsFromOfficialSource(
  database,
  opportunityId,
  currentProfile,
  { analyze: true }
);
document_import_status = importResult.analysis_generated ? 'analisis_generado' : 'fallo_importacion';
if (!importResult.analysis_generated) {
  document_import_error = `No se pudo generar análisis: ${importResult.imported_count} documentos vigentes, ${importResult.failed_count} fallidos.`;
  await database.from('psi_sales_interactions').insert({
    opportunity_id: opportunityId,
    interaction_type: 'documento',
    created_by: currentProfile.id,
    occurred_at: new Date().toISOString(),
    notes: JSON.stringify({
      kind: 'tender_document_import_error',
      auto_import: true,
      source: tender.source,
      error: document_import_error
    })
  });
}
```

- [ ] **Step 4: Verificar GREEN y regresión histórica**

Run:

```bash
node tests/tender-auto-analysis-contract.test.mjs
node tests/tender-auto-import-and-discard-static.test.mjs
```

Expected: ambas pruebas PASS.

- [ ] **Step 5: Confirmar equivalencia entre backends**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const a = fs.readFileSync('api/[...path].js', 'utf8');
const b = fs.readFileSync('server/index.js', 'utf8');
for (const name of ['importTenderDocumentsFromOfficialSource', 'convertTenderToOpportunity']) {
  const rx = new RegExp(`async function ${name}\\([\\s\\S]*?\\n}`);
  if (a.match(rx)?.[0] !== b.match(rx)?.[0]) throw new Error(`${name} diverge`);
}
console.log('backend tender functions equivalent');
NODE
```

Expected: `backend tender functions equivalent`.

- [ ] **Step 6: Commit**

```bash
git add api/[...path].js server/index.js tests/tender-auto-analysis-contract.test.mjs tests/tender-auto-import-and-discard-static.test.mjs
git commit -m "fix: preserve automatic tender document analysis"
```

---

### Task 2: Persistencia de Seguimiento

**Files:**
- Create: `supabase/migrations/014_tender_tracking_workflow.sql`
- Create: `tests/tender-tracking-migration.test.mjs`

**Interfaces:**
- Produces: columnas `tracking_*` en `psi_public_tenders` y tabla `psi_tender_tracking_events`.

- [ ] **Step 1: Escribir prueba roja del esquema**

```js
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
const sql = readFileSync(new URL('../supabase/migrations/014_tender_tracking_workflow.sql', import.meta.url), 'utf8');
for (const column of ['tracking_owner_id', 'tracking_status', 'tracking_next_action', 'tracking_due_at', 'tracking_blocker', 'tracking_last_note', 'tracking_started_at', 'tracking_updated_at']) {
  assert.match(sql, new RegExp(`add column if not exists ${column}`));
}
assert.match(sql, /create table if not exists public\.psi_tender_tracking_events/);
assert.match(sql, /references public\.psi_public_tenders\(id\) on delete cascade/);
assert.match(sql, /enable row level security/);
assert.match(sql, /create index if not exists/);
console.log('tender tracking migration contract passed');
```

- [ ] **Step 2: Ejecutar y verificar RED**

Run: `node tests/tender-tracking-migration.test.mjs`
Expected: ERROR `ENOENT` porque la migración todavía no existe.

- [ ] **Step 3: Crear migración idempotente**

La migración debe usar este núcleo:

```sql
alter table public.psi_public_tenders
  add column if not exists tracking_owner_id uuid references public.psi_sales_profiles(id),
  add column if not exists tracking_status text,
  add column if not exists tracking_next_action text,
  add column if not exists tracking_due_at timestamptz,
  add column if not exists tracking_blocker text,
  add column if not exists tracking_last_note text,
  add column if not exists tracking_started_at timestamptz,
  add column if not exists tracking_updated_at timestamptz;

create table if not exists public.psi_tender_tracking_events (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.psi_public_tenders(id) on delete cascade,
  event_type text not null check (event_type in ('entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded')),
  note text,
  from_status text,
  to_status text,
  assigned_to uuid references public.psi_sales_profiles(id),
  next_action text,
  due_at timestamptz,
  blocker text,
  created_by uuid references public.psi_sales_profiles(id),
  created_at timestamptz not null default now()
);

alter table public.psi_tender_tracking_events enable row level security;
create index if not exists idx_tender_tracking_events_tender_created
  on public.psi_tender_tracking_events(tender_id, created_at desc);
create index if not exists idx_public_tenders_tracking_queue
  on public.psi_public_tenders(internal_status, tracking_due_at, tracking_updated_at desc);
```

Agregar las políticas y el grant completos:

```sql
drop policy if exists psi_tender_tracking_events_select on public.psi_tender_tracking_events;
create policy psi_tender_tracking_events_select on public.psi_tender_tracking_events for select to authenticated
using (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

drop policy if exists psi_tender_tracking_events_modify on public.psi_tender_tracking_events;
create policy psi_tender_tracking_events_modify on public.psi_tender_tracking_events for all to authenticated
using (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
)
with check (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

grant select, insert, update, delete on public.psi_tender_tracking_events to authenticated;
```

- [ ] **Step 4: Verificar GREEN y sintaxis estática**

Run:

```bash
node tests/tender-tracking-migration.test.mjs
node tests/tender-search-profiles.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/014_tender_tracking_workflow.sql tests/tender-tracking-migration.test.mjs
git commit -m "feat: add tender tracking persistence"
```

---

### Task 3: Servicios y endpoints de Seguimiento

**Files:**
- Create: `tests/tender-tracking-api.test.mjs`
- Modify: `api/[...path].js`
- Modify: `server/index.js`

**Interfaces:**
- Produces:
  - `GET /api/tender-tracking`
  - `GET /api/tender-tracking-events?id=<tender_id>`
  - `POST /api/tender-tracking-update`
  - `POST /api/tender-tracking-transition`

- [ ] **Step 1: Escribir prueba roja de rutas y trazabilidad**

```js
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
for (const path of ['../api/[...path].js', '../server/index.js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/api\/tender-tracking'/);
  assert.match(source, /app\.get\('\/api\/tender-tracking-events'/);
  assert.match(source, /app\.post\('\/api\/tender-tracking-update'/);
  assert.match(source, /app\.post\('\/api\/tender-tracking-transition'/);
  assert.match(source, /psi_tender_tracking_events/);
  assert.match(source, /tracking_updated_at: now/);
  assert.match(source, /internal_status: 'en_revision'/);
}
console.log('tender tracking API contract passed');
```

- [ ] **Step 2: Ejecutar y verificar RED**

Run: `node tests/tender-tracking-api.test.mjs`
Expected: FAIL al no existir las rutas.

- [ ] **Step 3: Implementar validación y actualización atómica lógica**

Crear helpers equivalentes en ambos backends:

```js
const tenderTrackingStatuses = new Set(['pendiente_revision','analizando','esperando_informacion','listo_para_decision','bloqueado']);
function cleanTrackingText(value, max = 1200) {
  return String(value || '').trim().slice(0, max) || null;
}
async function updateTenderTracking(database, tenderId, input, currentProfile) {
  const now = new Date().toISOString();
  const trackingStatus = String(input.tracking_status || 'pendiente_revision');
  if (!tenderTrackingStatuses.has(trackingStatus)) throw new Error('Estado de seguimiento inválido.');
  const patch = {
    internal_status: 'en_revision',
    tracking_owner_id: input.tracking_owner_id || currentProfile.id,
    tracking_status: trackingStatus,
    tracking_next_action: cleanTrackingText(input.tracking_next_action, 500),
    tracking_due_at: input.tracking_due_at || null,
    tracking_blocker: cleanTrackingText(input.tracking_blocker),
    tracking_last_note: cleanTrackingText(input.note),
    tracking_started_at: input.tracking_started_at || now,
    tracking_updated_at: now,
    reviewed_by: currentProfile.id,
    reviewed_at: now
  };
  const tender = await must(database.from('psi_public_tenders').update(patch).eq('id', tenderId).select('*').single());
  await must(database.from('psi_tender_tracking_events').insert({
    tender_id: tenderId,
    event_type: input.event_type || 'tracking_updated',
    note: patch.tracking_last_note,
    to_status: trackingStatus,
    assigned_to: patch.tracking_owner_id,
    next_action: patch.tracking_next_action,
    due_at: patch.tracking_due_at,
    blocker: patch.tracking_blocker,
    created_by: currentProfile.id
  }).select('id').single());
  return tender;
}
```

La transición a `nueva`, `descartada` o `convertida_oportunidad` debe insertar evento y limpiar únicamente campos que ya no representen trabajo activo; no borrar historial.

- [ ] **Step 4: Implementar las cuatro rutas con `getAuthContext` y `canViewTenders`**

Cada ruta debe validar `id`, usar `requireDb()`, aplicar el helper compartido y responder 400/403 mediante `sendError`.

- [ ] **Step 5: Verificar GREEN y equivalencia**

Run:

```bash
node tests/tender-tracking-api.test.mjs
node tests/tenders-static.test.mjs
node tests/tender-auto-analysis-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/[...path].js server/index.js tests/tender-tracking-api.test.mjs
git commit -m "feat: add tender tracking API"
```

---

### Task 4: Tipos, cliente y orquestador aislado

**Files:**
- Create: `src/tenders/types.ts`
- Create: `src/tenders/api.ts`
- Create: `src/tenders/TendersModule.tsx`
- Create: `src/tenders/TenderRadarView.tsx`
- Create: `src/tenders/TenderTrackingView.tsx`
- Create: `src/tenders/TenderDossiersView.tsx`
- Create: `src/tenders/TenderProfilesView.tsx`
- Create: `src/tenders/components/TenderModuleTabs.tsx`
- Create: `tests/tender-functional-views.test.mjs`
- Modify: `src/main.tsx`

**Interfaces:**
- `TendersModuleProps = { view; data; refresh; request; navigate }`.
- `TenderRequest = <T>(path: string, options?: RequestInit) => Promise<T>`.
- Produce cuatro componentes distintos por subruta.

- [ ] **Step 1: Escribir prueba roja de composición**

```js
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
const moduleSource = readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
assert.match(moduleSource, /<TenderRadarView/);
assert.match(moduleSource, /<TenderTrackingView/);
assert.match(moduleSource, /<TenderDossiersView/);
assert.match(moduleSource, /<TenderProfilesView/);
assert.match(main, /<TendersModule/);
assert.doesNotMatch(moduleSource, /TenderUnifiedBoard/);
console.log('tender functional composition passed');
```

- [ ] **Step 2: Ejecutar y verificar RED**

Run: `node tests/tender-functional-views.test.mjs`
Expected: ERROR `ENOENT`.

- [ ] **Step 3: Crear tipos y cliente**

Definir al menos:

```ts
export type TenderModuleView = 'radar' | 'seguimiento' | 'expedientes' | 'perfiles';
export type TenderRequest = <T>(path: string, options?: RequestInit) => Promise<T>;
export type TenderModuleData = {
  currentProfile: { id: string; full_name: string; role: string; microsoft_email?: string | null };
  profiles: Array<{ id: string; full_name: string; role: string }>;
};
export type TendersModuleProps = {
  view: TenderModuleView;
  data: TenderModuleData;
  refresh: () => Promise<void>;
  request: TenderRequest;
  navigate: (hash: string) => void;
};
```

`src/tenders/api.ts` expondrá funciones explícitas como `loadRadar`, `loadTracking`, `loadDossiers`, `loadProfiles`, sin una carga global implícita.

- [ ] **Step 4: Crear orquestador sin carga de datos**

```tsx
export function TendersModule(props: TendersModuleProps) {
  return <section className="stack tenders-page">
    <TenderModuleTabs active={props.view} />
    {props.view === 'radar' && <TenderRadarView {...props} />}
    {props.view === 'seguimiento' && <TenderTrackingView {...props} />}
    {props.view === 'expedientes' && <TenderDossiersView {...props} />}
    {props.view === 'perfiles' && <TenderProfilesView {...props} />}
  </section>;
}
```

Crear además shells compilables y distinguibles para que el orquestador tenga dependencias reales desde este commit:

```tsx
// TenderRadarView.tsx
export function TenderRadarView(_props: TendersModuleProps) {
  return <section className="tender-radar-view"><h2>Radar de oportunidades</h2></section>;
}
// TenderTrackingView.tsx
export function TenderTrackingView(_props: TendersModuleProps) {
  return <section className="tender-tracking-view"><h2>Seguimiento</h2></section>;
}
// TenderDossiersView.tsx
export function TenderDossiersView(_props: TendersModuleProps) {
  return <section className="tender-dossiers-view"><h2>Expedientes</h2></section>;
}
// TenderProfilesView.tsx
export function TenderProfilesView(_props: TendersModuleProps) {
  return <section className="tender-profiles-view"><h2>Perfiles de búsqueda</h2></section>;
}
```

- [ ] **Step 5: Delegar desde `src/main.tsx`**

Sustituir `return <TendersRadar ... />` de la ruta por `TendersModule`, pasando `api` y `go`. No borrar todavía helpers requeridos por las vistas hasta que cada tarea los haya migrado.

- [ ] **Step 6: Verificar GREEN y build**

Run:

```bash
node tests/tender-functional-views.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main.tsx src/tenders tests/tender-functional-views.test.mjs
git commit -m "refactor: add tender module boundaries"
```

---

### Task 5: Radar independiente

**Files:**
- Modify: `src/tenders/TenderRadarView.tsx`
- Modify: `src/tenders/types.ts`
- Modify: `src/tenders/api.ts`
- Modify: `tests/tender-module-ui.test.mjs`
- Create: `tests/tender-unified-view-and-dedup.test.mjs`

**Interfaces:**
- Consumes: `GET /api/tenders`, `POST /api/tender-refresh`, status/transición y `POST /api/tender-convert`.
- Produces: navegación a oportunidad y transición a Seguimiento.

- [ ] **Step 1: Cambiar la prueba antigua para exigir Radar propio**

La prueba debe verificar:

```js
assert.match(radar, /Sincronizar fuentes oficiales/);
assert.match(radar, /Pasar a seguimiento/);
assert.match(radar, /Convertir en oportunidad/);
assert.doesNotMatch(radar, /Abrir expediente/);
assert.doesNotMatch(radar, /TenderUnifiedBoard/);
assert.match(radar, /deduplicateTenders/);
```

Y debe eliminar la expectativa `Vista unificada de licitaciones`.

- [ ] **Step 2: Ejecutar y verificar RED**

Run:

```bash
node tests/tender-module-ui.test.mjs
node tests/tender-unified-view-and-dedup.test.mjs
```

Expected: FAIL porque Radar todavía vive en `main.tsx` y usa el tablero común.

- [ ] **Step 3: Migrar carga, deduplicación, filtros y cards a `TenderRadarView`**

Conservar `canonicalTenderKey`, `deduplicateTenders`, regiones, ordenamiento, paginación, diagnóstico de fuentes y prevención de duplicados. El botón de seguimiento llamará:

```ts
await request('/api/tender-tracking-update', {
  method: 'POST',
  body: JSON.stringify({
    id: tender.id,
    event_type: 'entered_tracking',
    tracking_status: 'pendiente_revision',
    tracking_owner_id: data.currentProfile.id,
    note: 'Proceso seleccionado desde Radar.'
  })
});
```

La conversión debe leer `{ id, document_import_status, document_import_error }`, conservar navegación al detalle y mostrar el estado real antes de navegar o mediante `sessionStorage` para el aviso del detalle.

- [ ] **Step 4: Retirar `TenderUnifiedBoard` y el filtro por vista**

Eliminar la lógica que usa `tenderView` para filtrar `en_revision` o `convertida_oportunidad` dentro del Radar. El Radar debe excluir convertidas y mostrar Seguimiento solo cuando corresponda a su contexto de transición.

- [ ] **Step 5: Verificar GREEN y regresión documental**

Run:

```bash
node tests/tender-module-ui.test.mjs
node tests/tender-unified-view-and-dedup.test.mjs
node tests/tender-auto-analysis-contract.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tenders/TenderRadarView.tsx src/tenders/types.ts src/tenders/api.ts src/main.tsx tests/tender-module-ui.test.mjs tests/tender-unified-view-and-dedup.test.mjs
git commit -m "feat: separate tender radar workflow"
```

---

### Task 6: Seguimiento operativo

**Files:**
- Modify: `src/tenders/TenderTrackingView.tsx`
- Modify: `src/tenders/types.ts`
- Modify: `src/tenders/api.ts`
- Modify: `tests/tender-functional-views.test.mjs`

**Interfaces:**
- Consumes endpoints de Task 3.
- Produces bandeja con responsable, última revisión, próxima acción, vencimiento, inactividad, bloqueo, nota e historial.

- [ ] **Step 1: Escribir expectativas rojas específicas**

```js
const tracking = readFileSync(new URL('../src/tenders/TenderTrackingView.tsx', import.meta.url), 'utf8');
for (const label of ['Responsable','Última revisión','Próxima acción','Fecha compromiso','Días sin gestión','Bloqueo','Historial']) {
  assert.ok(tracking.includes(label), `Seguimiento debe mostrar ${label}`);
}
assert.ok(tracking.includes('/api/tender-tracking'));
assert.ok(tracking.includes('/api/tender-tracking-update'));
assert.ok(tracking.includes('/api/tender-tracking-events'));
assert.ok(!tracking.includes('Sincronizar fuentes oficiales'));
assert.ok(!tracking.includes('TenderCard'));
```

- [ ] **Step 2: Ejecutar y verificar RED**

Run: `node tests/tender-functional-views.test.mjs`
Expected: FAIL por contenido ausente.

- [ ] **Step 3: Implementar bandeja, filtros y panel de edición**

Crear estados `loading`, `error`, `rows`, `editingId`, `form`, `events`. Calcular días sin gestión con:

```ts
export function daysSince(value?: string | null) {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
}
```

El formulario debe persistir responsable, estado, acción, fecha, bloqueo y nota. La conversión reutilizará el mismo `POST /api/tender-convert`; no duplicará lógica documental en el navegador.

- [ ] **Step 4: Implementar estados vacíos y errores**

- Sin filas: “No hay procesos en seguimiento. Selecciónelos desde Radar.”
- Error de guardado: conservar formulario y mostrar mensaje.
- Carga de historial: solo al expandir una fila.

- [ ] **Step 5: Verificar GREEN y build**

Run:

```bash
node tests/tender-functional-views.test.mjs
node tests/tender-tracking-api.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tenders/TenderTrackingView.tsx src/tenders/types.ts src/tenders/api.ts tests/tender-functional-views.test.mjs
git commit -m "feat: add operational tender tracking queue"
```

---

### Task 7: Resumen API de Expedientes

**Files:**
- Create: `tests/tender-dossiers-api.test.mjs`
- Modify: `api/[...path].js`
- Modify: `server/index.js`

**Interfaces:**
- Produces: `GET /api/tender-dossiers` con resumen por licitación convertida.

- [ ] **Step 1: Escribir prueba roja del contrato**

Exigir ruta y campos:

```js
for (const source of backends) {
  assert.match(source, /app\.get\('\/api\/tender-dossiers'/);
  for (const field of ['document_count','missing_document_count','document_import_status','go_no_go','risk','checklist_progress','preparation_status','human_pending_count','sharepoint_status']) {
    assert.ok(source.includes(field), `Falta ${field}`);
  }
  assert.match(source, /converted_opportunity_id/);
  assert.match(source, /getTenderDocumentRecords/);
  assert.match(source, /getTenderOfferPreparationRecords/);
}
```

- [ ] **Step 2: Ejecutar y verificar RED**

Run: `node tests/tender-dossiers-api.test.mjs`
Expected: FAIL por ruta ausente.

- [ ] **Step 3: Implementar agregador tolerante por expediente**

Consultar licitaciones convertidas con oportunidad y, para cada fila, componer:

```js
async function buildTenderDossierSummary(database, tender, currentProfile) {
  try {
    const documents = await getTenderDocumentRecords(database, tender.converted_opportunity_id);
    const preparation = await getTenderOfferPreparationRecords(database, tender.converted_opportunity_id);
    const currentDocs = documents.documents.filter(doc => doc.current !== false);
    const analysis = documents.analysis;
    const currentPreparation = preparation.preparation;
    return {
      ...dbTenderToPublic(tender),
      opportunity_id: tender.converted_opportunity_id,
      document_count: currentDocs.length,
      missing_document_count: (analysis?.checklist || []).filter(item => /pendiente|falta/i.test(item)).length,
      document_import_status: analysis ? 'analisis_generado' : currentDocs.length ? 'documentos_cargados' : 'pendiente_documentos',
      go_no_go: analysis?.go_no_go?.decision || analysis?.recommendation || 'Pendiente',
      risk: analysis?.go_no_go?.risk || analysis?.risk || 'Pendiente',
      checklist_progress: currentPreparation?.checklist_summary || null,
      preparation_status: currentPreparation?.status || 'pendiente',
      human_pending_count: currentPreparation?.human_required_items?.length || 0,
      sharepoint_status: currentPreparation?.sharepoint_folder?.status || 'pendiente',
      sharepoint_url: currentPreparation?.sharepoint_folder?.url || null,
      dossier_error: null
    };
  } catch (error) {
    return { ...dbTenderToPublic(tender), opportunity_id: tender.converted_opportunity_id, dossier_error: error?.message || String(error) };
  }
}
```

Limitar concurrencia o procesar secuencialmente para evitar saturar Supabase. Un expediente fallido no debe impedir devolver los demás.

- [ ] **Step 4: Verificar GREEN y equivalencia**

Run:

```bash
node tests/tender-dossiers-api.test.mjs
node tests/tender-offer-preparation-static.test.mjs
node tests/tender-auto-analysis-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/[...path].js server/index.js tests/tender-dossiers-api.test.mjs
git commit -m "feat: add tender dossier summaries"
```

---

### Task 8: Expedientes y Perfiles independientes

**Files:**
- Modify: `src/tenders/TenderDossiersView.tsx`
- Modify: `src/tenders/TenderProfilesView.tsx`
- Create: `src/tenders/components/TenderStatusBadge.tsx`
- Modify: `src/tenders/types.ts`
- Modify: `src/tenders/api.ts`
- Modify: `tests/tender-functional-views.test.mjs`
- Modify: `tests/tender-search-profiles.test.mjs`

**Interfaces:**
- Expedientes consume `GET /api/tender-dossiers` y acciones documentales existentes.
- Perfiles consume ficha corporativa y `/api/tender-search-profiles`, nunca `/api/tenders`.

- [ ] **Step 1: Añadir pruebas rojas de contenido y aislamiento**

```js
for (const label of ['Abrir expediente','GO / NO GO','Documentos','Checklist','Pendientes humanos','SharePoint / OneDrive']) {
  assert.ok(dossiers.includes(label), `Expedientes debe mostrar ${label}`);
}
assert.ok(!dossiers.includes('Sincronizar fuentes oficiales'));
assert.ok(!dossiers.includes('TenderCard'));
assert.ok(profiles.includes('/api/tender-search-profiles'));
assert.ok(!profiles.includes("request('/api/tenders"));
assert.ok(profiles.includes('Aplicar en Radar'));
```

- [ ] **Step 2: Ejecutar y verificar RED**

Run:

```bash
node tests/tender-functional-views.test.mjs
node tests/tender-search-profiles.test.mjs
```

Expected: FAIL por componentes ausentes/incompletos.

- [ ] **Step 3: Implementar `TenderDossiersView`**

Cargar una sola vez `/api/tender-dossiers`, mostrar semáforos, conteos y acción principal. “Abrir expediente” navegará a `#/detail/<opportunity_id>` con foco documental. Reintentar importación llamará `/api/tender-documents-import` y recargará solo la bandeja de Expedientes.

- [ ] **Step 4: Implementar `TenderProfilesView`**

Migrar `TenderCompanyProfilePanel` y `TenderSearchProfilesPanel`. Aplicar perfil debe serializar filtros en query/hash y llamar:

```ts
navigate(`#/tenders?view=radar&profile=${encodeURIComponent(profile.id)}`);
```

El `useEffect` de esta vista llamará únicamente ficha corporativa y perfiles guardados.

- [ ] **Step 5: Eliminar componentes obsoletos de `main.tsx`**

Retirar `TendersRadar`, `TenderUnifiedBoard`, `TenderSectionPanel` y paneles de perfiles ya migrados cuando no tengan referencias. Mantener `TenderDocumentReviewPanel` y `TenderOfferPreparationPanel` en detalle hasta una extracción posterior; su reintento documental es parte del contrato protegido.

- [ ] **Step 6: Verificar GREEN y build**

Run:

```bash
node tests/tender-functional-views.test.mjs
node tests/tender-search-profiles.test.mjs
node tests/tender-auto-analysis-contract.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main.tsx src/tenders tests/tender-functional-views.test.mjs tests/tender-search-profiles.test.mjs
git commit -m "feat: separate tender dossiers and profiles"
```

---

### Task 9: Estilos, documentación y verificación integral

**Files:**
- Modify: `src/styles.css`
- Modify: `docs/licitaciones-operacion.md`
- Modify: `docs/superpowers/specs/2026-07-14-licitaciones-separacion-funcional-design.md` solo si la implementación exige aclaraciones verificadas.

**Interfaces:**
- Produce experiencia responsive y evidencia final, sin tocar producción.

- [ ] **Step 1: Añadir estilos por responsabilidad**

Crear namespaces:

```css
.tender-radar-view {}
.tender-tracking-view {}
.tender-dossiers-view {}
.tender-profiles-view {}
.tender-tracking-row {}
.tender-dossier-row {}
```

En móvil, cada fila debe transformarse en bloque legible; no permitir overflow horizontal de acciones ni textos truncados sin acceso al contenido.

- [ ] **Step 2: Documentar operación y recuperación**

Actualizar `docs/licitaciones-operacion.md` con:

- estados y transiciones;
- campos de Seguimiento;
- endpoint de Expedientes;
- contrato automático SECOP II/ESU;
- semántica `analisis_generado`, `fallo_importacion`, `no_aplica`;
- reintento manual;
- migración pendiente de gate.

- [ ] **Step 3: Ejecutar suite completa**

Run:

```bash
set -e
count=0
for f in tests/*.test.mjs; do
  node "$f"
  count=$((count+1))
done
echo "JS_TEST_FILES_PASS=$count"
npm run build
git diff --check
```

Expected: todos los archivos de pruebas PASS, build exit 0, `git diff --check` sin salida.

- [ ] **Step 4: Ejecutar comprobación explícita del contrato documental**

Run:

```bash
node tests/tender-auto-analysis-contract.test.mjs
node tests/tender-auto-import-and-discard-static.test.mjs
```

Expected: PASS en ambas.

- [ ] **Step 5: QA autenticado local**

Iniciar `npm run dev` en proceso controlado y validar con navegador:

- `#/tenders?view=radar`: filtros, sincronización, transición y conversión;
- `#/tenders?view=seguimiento`: edición, historial y conversión;
- `#/tenders?view=expedientes`: documentos, GO/NO GO, preparación y reintento;
- `#/tenders?view=perfiles`: no hay llamada a `/api/tenders` en Network;
- desktop y móvil;
- consola sin errores.

No convertir una licitación real ni aplicar migración contra producción durante esta QA. Usar entorno local/fixtures o una oportunidad de prueba autorizada.

- [ ] **Step 6: Auditoría independiente del diff**

Solicitar revisión enfocada en:

- pérdida de capacidades previas;
- divergencia `api/[...path].js` vs `server/index.js`;
- importación/análisis automático;
- permisos/RLS;
- duplicados;
- aislamiento real de vistas;
- errores responsive.

Corregir cada hallazgo mediante un nuevo ciclo RED → GREEN antes del commit final.

- [ ] **Step 7: Commit**

```bash
git add src/styles.css docs/licitaciones-operacion.md docs/superpowers/specs/2026-07-14-licitaciones-separacion-funcional-design.md
git commit -m "docs: finalize tender workflow separation"
```

- [ ] **Step 8: Entregar gate humano**

Presentar:

- commits y diff;
- conteo exacto de pruebas;
- salida de build;
- capturas desktop/móvil;
- resultado del contrato documental;
- migración propuesta y rollback;
- riesgos pendientes.

Solicitar autorización separada para aplicar migración, merge y deploy. No ejecutar ninguna de esas tres acciones en este paso.
