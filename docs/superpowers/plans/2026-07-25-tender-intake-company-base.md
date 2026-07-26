# Tender Intake and Company Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compactar Radar y reconstruir la Base empresarial como una vista consultiva con edición explícita e inventario documental versionado.

**Architecture:** Radar conserva sus contratos y mueve búsquedas guardadas a controles cerrados accesibles. Una migración aditiva crea el inventario documental empresarial; rutas Vercel-safe y un helper frontend mantienen lectura y mutaciones separadas.

**Tech Stack:** React 19, TypeScript, CSS, Express/Vercel Functions, Supabase/PostgreSQL, PGlite, Node test runner.

## Global Constraints

- No activar AGT-002 ni HERMES-INTERIM.
- No ejecutar proveedores externos ni datos sintéticos en runtime.
- Mantener paridad exacta entre `server/index.js` y `api/[...path].js`.
- Toda mutación de configuración exige `ACTIONS.LICITACIONES_CONFIGURE`.
- La UI abre en modo consulta.
- TDD estricto y commits pequeños.
- Diseño fuente: `docs/superpowers/specs/2026-07-25-tender-decision-workspace-design.md`.

---

### Task 1: Búsquedas guardadas cerradas por defecto

**Files:**
- Modify: `src/tenders/components/TenderSavedSearches.tsx`
- Modify: `src/tenders/TenderRadarView.tsx`
- Modify: `src/styles.css`
- Test: `tests/tender-saved-searches-radar.test.mjs`

**Interfaces:**
- Consumes: `TenderRadarFilters`, `TenderSearchProfile`, `onApply` existentes.
- Produces: botones visibles `Guardar búsqueda` y `Búsquedas guardadas`; dialogs accesibles sin lista expandida inicial.

- [ ] **Step 1: Escribir prueba en rojo**

Agregar aserciones que exijan `aria-haspopup="dialog"`, estado `saveOpen`, estado `libraryOpen`, textos `Guardar búsqueda` y `Búsquedas guardadas`, y que prohíban renderizar `tender-saved-profiles` fuera del bloque condicionado por `libraryOpen`.

```js
assert.match(savedSearches, /const \[saveOpen, setSaveOpen\]/);
assert.match(savedSearches, /const \[libraryOpen, setLibraryOpen\]/);
assert.match(savedSearches, /aria-haspopup="dialog"/);
assert.match(savedSearches, /libraryOpen &&/);
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-saved-searches-radar.test.mjs`
Expected: FAIL por estados/dialogs ausentes.

- [ ] **Step 3: Implementar controles cerrados**

Mantener `buildTenderSearchProfilePayload`, `prependTenderSearchProfile` y `removeTenderSearchProfile`. Añadir dos triggers y dos dialogs/paneles con Escape, foco inicial y retorno de foco. Guardar cierra el dialog sólo en éxito; eliminar conserva confirmación.

- [ ] **Step 4: Compactar la barra del Radar**

Ubicar `<TenderSavedSearches .../>` dentro del bloque de controles, sin panel de ancho completo. En móvil permitir wrap de botones sin desplazar filtros.

- [ ] **Step 5: Verificar**

Run: `node tests/tender-saved-searches-radar.test.mjs && node tests/tender-filter-compact-layout.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tenders/components/TenderSavedSearches.tsx src/tenders/TenderRadarView.tsx src/styles.css tests/tender-saved-searches-radar.test.mjs
git commit -m "feat(tenders): compact saved searches in radar"
```

### Task 2: Migración de documentos empresariales

**Files:**
- Create: `supabase/migrations/026_tender_document_versions.sql`
- Create: `tests/tender-document-versions-migration.test.mjs`
- Create: `tests/tender-document-versions-pglite.integration.test.mjs`

**Interfaces:**
- Produces: tabla `psi_company_procurement_documents` y RPC `psi_record_company_procurement_document`.

- [ ] **Step 1: Escribir contratos estáticos en rojo**

Exigir columnas `document_type`, `display_name`, `issued_at`, `expires_at`, `version`, `content_hash`, `storage_path`, `mime_type`, `size_bytes`, `current`, `uploaded_by`, timestamps; RLS; revoke/grant; RPC sólo para `service_role`.

- [ ] **Step 2: Escribir integración PGlite en rojo**

La prueba crea stubs mínimos de perfiles, aplica 012 y 026, registra dos versiones RUP y comprueba:

```js
assert.equal(rows.length, 2);
assert.equal(rows.filter(row => row.current).length, 1);
assert.equal(rows.find(row => row.current).version, 2);
```

También registra dos categorías distintas y verifica que ambas puedan permanecer vigentes.

- [ ] **Step 3: Ejecutar y comprobar fallo**

Run: `node tests/tender-document-versions-migration.test.mjs && node tests/tender-document-versions-pglite.integration.test.mjs`
Expected: FAIL porque 026 no existe.

- [ ] **Step 4: Implementar SQL aditivo**

La RPC recibe:

```sql
psi_record_company_procurement_document(
  p_document_type text, p_display_name text, p_issued_at date,
  p_expires_at date, p_content_hash text, p_storage_path text,
  p_mime_type text, p_size_bytes bigint, p_uploaded_by uuid,
  p_replace_document_id uuid default null
) returns jsonb
```

Para `rup`, marca no vigentes los RUP anteriores. Para otras categorías sólo reemplaza `p_replace_document_id` cuando se suministra. Calcula `version = max(version)+1` por tipo y valida SHA-256, tamaños, fechas, actor y ruta `company-profile/`.

- [ ] **Step 5: Verificar SQL**

Run: `node tests/tender-document-versions-migration.test.mjs && node tests/tender-document-versions-pglite.integration.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/026_tender_document_versions.sql tests/tender-document-versions-*.test.mjs tests/tender-document-versions-pglite.integration.test.mjs
git commit -m "feat(tenders): version company procurement documents"
```

### Task 3: API de inventario empresarial

**Files:**
- Create: `company-procurement-documents.js`
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Modify: `src/tenders/types.ts`
- Modify: `src/tenders/api.ts`
- Modify: `src/tenders/tenderConfigurationActions.ts`
- Test: `tests/tender-company-documents-api.test.mjs`
- Modify: `tests/tender-configuration-permissions.test.mjs`
- Modify: `tests/tender-configuration-http-denials.test.mjs`

**Interfaces:**
- Produces: `GET /api/tender-company-documents`, `POST /api/tender-company-document-upload-url`, `POST /api/tender-company-document-process-upload`.
- Produces type `TenderCompanyDocument` and action `uploadCompanyDocument(file, metadata)`.

- [ ] **Step 1: Escribir pruebas en rojo**

Exigir lectura con `LICITACIONES_VIEW`, mutaciones con `LICITACIONES_CONFIGURE`, límite 50 MB, rutas privadas `company-profile/documents/`, hash real del buffer y llamada a `psi_record_company_procurement_document`.

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-company-documents-api.test.mjs && node tests/tender-configuration-permissions.test.mjs`
Expected: FAIL por rutas/helper ausentes.

- [ ] **Step 3: Implementar helper compartido**

Exportar:

```js
export function companyDocumentState(document, now = new Date())
export async function listCompanyProcurementDocuments(database)
export async function recordCompanyProcurementDocument(database, input)
```

`companyDocumentState` devuelve `vigente`, `vence_pronto`, `vencido` o `sin_vencimiento` usando calendario, sin modificar datos.

- [ ] **Step 4: Implementar rutas gemelas**

La URL firmada no procesa contenido. El endpoint de proceso descarga desde Storage, calcula SHA-256, extrae texto sólo para RUP, llama la RPC y, para RUP, actualiza `psi_company_procurement_profile` con el parser existente. Devuelve `{ profile, documents }`.

- [ ] **Step 5: Implementar tipos/actions**

```ts
export type TenderCompanyDocument = {
  id: string; document_type: string; display_name: string;
  issued_at?: string | null; expires_at?: string | null;
  version: number; current: boolean; state: 'vigente'|'vence_pronto'|'vencido'|'sin_vencimiento';
  source_document_name: string; mime_type?: string | null; size_bytes: number;
  created_at: string; uploaded_by_name?: string | null;
};
```

- [ ] **Step 6: Verificar paridad y permisos**

Run: `node tests/tender-company-documents-api.test.mjs && node tests/tender-configuration-permissions.test.mjs && node tests/tender-configuration-http-denials.test.mjs && npm run check:backend-parity`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add company-procurement-documents.js server/index.js 'api/[...path].js' src/tenders/types.ts src/tenders/api.ts src/tenders/tenderConfigurationActions.ts tests/tender-company-documents-api.test.mjs tests/tender-configuration-*.test.mjs
git commit -m "feat(tenders): expose company document inventory"
```

### Task 4: Base empresarial consultiva

**Files:**
- Modify: `src/tenders/TenderConfigurationView.tsx`
- Create: `src/tenders/components/TenderCompanyDocuments.tsx`
- Modify: `src/styles.css`
- Modify: `tests/tender-company-profile-editable-static.test.mjs`
- Create: `tests/tender-company-base-ui.test.mjs`

**Interfaces:**
- Consumes: `TenderCompanyProfile`, `TenderCompanyDocument[]`, configuration actions.
- Produces: consulta por defecto; `Editar información`, `Actualizar RUP`, `Añadir documento empresarial`.

- [ ] **Step 1: Escribir prueba en rojo**

Exigir título `Base empresarial de licitaciones`, estado `editing`, `Cancel`, resumen de RUP/fecha/versión, inventario y alertas; prohibir `Configuración protegida`.

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-company-base-ui.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implementar modo consulta/edición**

Guardar una copia `persistedCompany`; `Editar información` copia a draft; `Cancelar` restaura; `Guardar cambios` persiste y vuelve a consulta sólo en éxito.

- [ ] **Step 4: Implementar inventario y cargas**

El componente muestra badges legibles, versión y vencimiento. El formulario de documento exige nombre/tipo y acepta fechas opcionales. `Actualizar RUP` usa tipo `rup`; el formulario genérico usa la categoría seleccionada.

- [ ] **Step 5: Implementar responsive/accesibilidad**

Acciones en una barra adaptable, dialogs con foco/Escape, tabla convertida en cards bajo 768 px.

- [ ] **Step 6: Verificar**

Run: `node tests/tender-company-base-ui.test.mjs && node tests/tender-company-profile-editable-static.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tenders/TenderConfigurationView.tsx src/tenders/components/TenderCompanyDocuments.tsx src/styles.css tests/tender-company-base-ui.test.mjs tests/tender-company-profile-editable-static.test.mjs
git commit -m "feat(tenders): redesign company procurement base"
```
