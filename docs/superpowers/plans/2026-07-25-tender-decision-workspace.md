# Tender Decision Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar Oportunidades y su detalle como un espacio guiado donde documentos y análisis preceden siempre a la decisión GO/NO GO.

**Architecture:** Una capa tipada versiona documentos oficiales y separa actualización de análisis. El detalle compone componentes focales alrededor de anclas y una línea de avance persistente, manteniendo la autoridad humana y los contratos existentes.

**Tech Stack:** React 19, TypeScript, CSS, Express/Vercel Functions, Supabase/PostgreSQL, PGlite, Node test runner.

## Global Constraints

- La ausencia, obsolescencia o fallo del análisis nunca bloquea a una persona autorizada.
- No activar AGT-002 ni HERMES-INTERIM.
- `siio_rules_v1` conserva su identidad real.
- No enviar, firmar, presentar ni crear SharePoint.
- Mantener paridad `server/index.js` / `api/[...path].js`.
- Una sola revisión del lote.
- Diseño fuente: `docs/superpowers/specs/2026-07-25-tender-decision-workspace-design.md`.

---

### Task 1: Versionado de documentos oficiales

**Files:**
- Modify: `supabase/migrations/026_tender_document_versions.sql`
- Modify: `tests/tender-document-versions-migration.test.mjs`
- Modify: `tests/tender-document-versions-pglite.integration.test.mjs`

**Interfaces:**
- Produces: `psi_tender_document_versions` y RPC `psi_record_tender_document_version`.

- [ ] **Step 1: Ampliar pruebas en rojo**

Exigir `tender_id`, identidad `(opportunity_id, source, source_document_id, version)`, `supersedes_version_id`, SHA-256, `current`, actor, URL/ruta, texto extraído y timestamps. La integración registra contenido A dos veces y contenido B una vez: A repetido devuelve `unchanged`; B crea versión 2, enlaza la versión anterior y deja una sola vigente. También prueba dos actualizaciones concurrentes y rechaza escritura directa fuera de la RPC.

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-document-versions-migration.test.mjs && node tests/tender-document-versions-pglite.integration.test.mjs`
Expected: FAIL por tabla/RPC ausente.

- [ ] **Step 3: Implementar tabla/RPC**

Firma:

```sql
psi_record_tender_document_version(
  p_opportunity_id uuid, p_source text, p_source_document_id text,
  p_name text, p_content_hash text, p_storage_path text,
  p_mime_type text, p_size_bytes bigint, p_document_type text,
  p_extracted_text text, p_source_url text, p_actor_id uuid
) returns jsonb
```

La RPC bloquea por oportunidad+fuente+id, compara hash, devuelve `unchanged` sin insertar o marca anterior no vigente e inserta siguiente versión. Sólo `service_role` ejecuta.

- [ ] **Step 4: Verificar y commit**

Run: `node tests/tender-document-versions-migration.test.mjs && node tests/tender-document-versions-pglite.integration.test.mjs`
Expected: PASS.

```bash
git add supabase/migrations/026_tender_document_versions.sql tests/tender-document-versions-*.test.mjs tests/tender-document-versions-pglite.integration.test.mjs
git commit -m "feat(tenders): version official tender documents"
```

### Task 2: Servicio de actualización oficial separado del análisis

**Files:**
- Create: `tender-document-versioning.js`
- Modify: `tender-analysis-foundation.js`
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Modify: `src/tenders/types.ts`
- Test: `tests/tender-official-document-refresh.test.mjs`
- Modify: `tests/tender-auto-analysis-contract.test.mjs`
- Modify: `tests/tender-auto-import-and-discard-static.test.mjs`

**Interfaces:**
- Produces: `refreshTenderDocumentsFromOfficialSource(..., { analyze })` y resultado `new_count`, `updated_count`, `unchanged_count`, `failed_count`, `analysis_generated`.
- `/api/tender-documents-import` usa `{ analyze: false }`.
- Conversión inicial conserva `{ analyze: true }`.

- [ ] **Step 1: Escribir prueba en rojo**

Exigir hash `createHash('sha256').update(buffer).digest('hex')`, consulta previa por identidad, omisión de Storage/RPC para hash igual, ruta con hash para cambio y análisis sólo cuando `analyze === true`.

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-official-document-refresh.test.mjs && node tests/tender-auto-analysis-contract.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implementar helper compartido**

Exportar funciones puras:

```js
export function tenderDocumentContentHash(buffer)
export function tenderDocumentVersionPath({ opportunityId, sourceDocumentId, contentHash, name })
export function summarizeTenderDocumentRefresh(results)
```

- [ ] **Step 4: Modificar importación duplicada**

Antes de subir, consultar `psi_tender_document_versions` por oportunidad/fuente/id vigente. Si hash coincide, devolver `unchanged`. Si cambia/nuevo, extraer, subir a ruta con hash y llamar RPC. Registrar evento `tender_document_refresh` con conteos. No crear run en la ruta manual de actualización.

- [ ] **Step 5: Mantener compatibilidad de lectura**

`getTenderDocumentRecords` combina versiones tipadas vigentes con documentos manuales/históricos no reemplazados. Deduplica por `source_document_id` y prioriza la tabla tipada. El snapshot usa sólo vigentes.

- [ ] **Step 6: Calcular vigencia real del análisis**

Extender `getCurrentTenderAnalysis` para comparar `document_hash` y `profile_hash` del snapshot asociado al run con los hashes reconstruidos desde evidencia y Base empresarial actuales. `canonicalDocument` debe preferir `content_sha256` binario persistido y usar texto extraído sólo como insumo. Un cambio documental, edición de perfil o reemplazo de RUP devuelve `current:false`; el mismo hash permanece vigente. No mutar runs/snapshots históricos.

- [ ] **Step 7: Verificar**

Run: `node tests/tender-official-document-refresh.test.mjs && node tests/tender-auto-analysis-contract.test.mjs && node tests/tender-analysis-rules-registration.test.mjs && npm run check:backend-parity`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tender-document-versioning.js server/index.js 'api/[...path].js' src/tenders/types.ts tests/tender-official-document-refresh.test.mjs tests/tender-auto-analysis-contract.test.mjs tests/tender-auto-import-and-discard-static.test.mjs
git commit -m "feat(tenders): separate document refresh from analysis"
```

### Task 3: Etiquetas humanas y tarjetas de Oportunidades

**Files:**
- Create: `src/tenders/statusLabels.ts`
- Modify: `src/tenders/TenderOpportunitiesView.tsx`
- Modify: `src/tenders/TenderRadarView.tsx`
- Modify: `src/tenders/TenderTrackingView.tsx`
- Modify: `tests/tender-navigation-opportunities.test.mjs`
- Create: `tests/tender-status-labels.test.mjs`

**Interfaces:**
- Produces: `tenderDocumentStatusLabel`, `tenderOfferStatusLabel`, `tenderDecisionLabel`, `tenderStatusTone`.

- [ ] **Step 1: Escribir pruebas en rojo**

```js
assert.equal(tenderOfferStatusLabel('pendiente_decision'), 'Decisión pendiente');
assert.equal(tenderOfferStatusLabel('cerrada_no_go'), 'Cerrada por NO GO');
assert.equal(tenderStatusTone('cerrada_no_go'), 'danger');
assert.equal(tenderDocumentStatusLabel('documentos_cargados'), 'Documentos cargados');
```

Exigir `Abrir fuente oficial`, `Actualizar documentos` y `Reintentar actualización` condicionado por fallo.

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-status-labels.test.mjs && node tests/tender-navigation-opportunities.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implementar mapeos exactos**

Usar maps exhaustivos y comparar NO GO antes de GO; no usar regex positiva genérica.

- [ ] **Step 4: Actualizar tarjetas**

La tarjeta usa URL pública del resumen. Si el backend no la expone, añadir `source_url` al resumen desde el tender. Mostrar resultado de actualización con conteos.

- [ ] **Step 5: Verificar y commit**

Run: `node tests/tender-status-labels.test.mjs && node tests/tender-navigation-opportunities.test.mjs && npm run build`
Expected: PASS.

```bash
git add src/tenders/statusLabels.ts src/tenders/TenderOpportunitiesView.tsx src/tenders/TenderRadarView.tsx src/tenders/TenderTrackingView.tsx tests/tender-status-labels.test.mjs tests/tender-navigation-opportunities.test.mjs
git commit -m "feat(tenders): clarify lifecycle labels and opportunity actions"
```

### Task 4: Shell navegable del expediente

**Files:**
- Create: `src/tenders/components/TenderDetailNavigation.tsx`
- Modify: `src/main.tsx`
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Modify: `src/tenders/types.ts`
- Modify: `src/styles.css`
- Create: `tests/tender-detail-navigation.test.mjs`

**Interfaces:**
- Consumes: entidad, source URL y `go`.
- Produces: tabs, breadcrumb, volver, abrir fuente y anclas internas.

- [ ] **Step 1: Escribir prueba en rojo**

Exigir IDs `tender-summary`, `tender-document-review`, `tender-analysis`, `tender-decision`, `tender-preparation`, `tender-follow-up`; labels de línea de avance; `Volver a Oportunidades`; `Abrir fuente oficial`.

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-detail-navigation.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implementar componente**

Usar links hash/anclas o botones que llamen `scrollIntoView({ block: 'start' })`, `aria-current` para Oportunidades y scroll horizontal en móvil. Enriquecer `GET /api/opportunity-detail` con la licitación vinculada por `converted_opportunity_id` y consumir su URL estructurada; no inferirla desde Observaciones. Mantener paridad backend.

- [ ] **Step 4: Verificar y commit**

Run: `node tests/tender-detail-navigation.test.mjs && npm run build`
Expected: PASS.

```bash
git add src/tenders/components/TenderDetailNavigation.tsx src/main.tsx src/styles.css tests/tender-detail-navigation.test.mjs
git commit -m "feat(tenders): preserve navigation inside tender detail"
```

### Task 5: Separar Documentos y Análisis

**Files:**
- Create: `src/tenders/components/TenderDocumentSection.tsx`
- Create: `src/tenders/components/TenderAnalysisSection.tsx`
- Modify: `src/main.tsx`
- Modify: `src/tenders/types.ts`
- Modify: `src/styles.css`
- Modify: `tests/tender-decision-brief-ui.test.mjs`
- Create: `tests/tender-guided-workspace-ui.test.mjs`

**Interfaces:**
- `TenderDocumentSection` recibe payload/actions y muestra actualización, carga y listado.
- `TenderAnalysisSection` recibe `analysis`, `documents`, `busy`, `onAnalyze`; siempre retorna una sección visible.

- [ ] **Step 1: Escribir pruebas en rojo**

Exigir que `TenderAnalysisSection` se renderice sin condición `analysis &&`; estados `Análisis pendiente`, `Análisis desactualizado`, `Análisis fallido`, `Sin documentos`; CTA `Generar análisis preliminar`/`Actualizar análisis`; y orden Documentos→Análisis→GO/NO GO.

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-guided-workspace-ui.test.mjs && node tests/tender-decision-brief-ui.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Extraer sección documental**

Barra compacta de cuatro acciones. Uploader bajo `details`/dialog. Lista dentro de `details` cerrada inicialmente, con búsqueda, filtro y agrupación por `document_type`. Mostrar conteos de la última actualización.

- [ ] **Step 4: Implementar sección de análisis siempre visible**

Con análisis vigente, conservar fortalezas, debilidades, preguntas, no verificado y siguiente acción. Con run obsoleto, mostrar el contenido histórico con advertencia. Con ausencia, mostrar acción concreta. Mostrar productor real mediante `tenderAnalysisMethodLabel`.

- [ ] **Step 5: Conectar estado**

`TenderDocumentReviewPanel` pasa a coordinador de carga y delega UI. Actualizar documentos no llama análisis; analizar actualiza el callback usado por GO/NO GO.

- [ ] **Step 6: Verificar y commit**

Run: `node tests/tender-guided-workspace-ui.test.mjs && node tests/tender-decision-brief-ui.test.mjs && node tests/tender-go-no-go-ui.test.mjs && npm run build`
Expected: PASS.

```bash
git add src/tenders/components/TenderDocumentSection.tsx src/tenders/components/TenderAnalysisSection.tsx src/main.tsx src/tenders/types.ts src/styles.css tests/tender-guided-workspace-ui.test.mjs tests/tender-decision-brief-ui.test.mjs
git commit -m "feat(tenders): restore analysis before human decision"
```

### Task 6: Resumen, decisión y preparación compacta

**Files:**
- Create: `src/tenders/components/TenderDecisionSummary.tsx`
- Modify: `src/tenders/components/TenderGoNoGoDecisionPanel.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `tests/tender-go-no-go-ui.test.mjs`
- Modify: `tests/tender-offer-preparation-static.test.mjs`

**Interfaces:**
- Produces resumen de documentos/análisis/decisión.
- Mantiene `tenderDecisionGate` y modal actual sin ampliar gates.

- [ ] **Step 1: Escribir pruebas en rojo**

Exigir resumen antes de documentos, `id="tender-decision"`, contexto de riesgo/preguntas en decisión y tarjeta compacta `Preparación no iniciada` cuando no hay GO.

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-go-no-go-ui.test.mjs && node tests/tender-offer-preparation-static.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implementar resumen y contexto**

El resumen no inventa datos: usa estados reales o `Pendiente`. GO/NO GO conserva botones habilitados según permiso, no según análisis.

- [ ] **Step 4: Compactar preparación pre-GO**

Antes de GO retorna una tarjeta pequeña. Después de GO conserva contenido actual dentro de secciones colapsables y no habilita SharePoint.

- [ ] **Step 5: Verificar y commit**

Run: `node tests/tender-go-no-go-ui.test.mjs && node tests/tender-offer-preparation-static.test.mjs && npm run build`
Expected: PASS.

```bash
git add src/tenders/components/TenderDecisionSummary.tsx src/tenders/components/TenderGoNoGoDecisionPanel.tsx src/main.tsx src/styles.css tests/tender-go-no-go-ui.test.mjs tests/tender-offer-preparation-static.test.mjs
git commit -m "feat(tenders): guide decision and preparation flow"
```

### Task 7: Contexto comercial y seguimiento final

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Create: `tests/tender-follow-up-context-ui.test.mjs`

**Interfaces:**
- Produce `Ver información de origen`, formulario compacto y timeline sin URL cruda en Observaciones.

- [ ] **Step 1: Escribir prueba en rojo**

Exigir `details`, label `Ver información de origen`, ancla `tender-follow-up`, y helper que extrae/retira URL del texto visible.

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-follow-up-context-ui.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Mostrar sector/ciudad/sede y observación limpia; mover ID legacy/hoja/estado original a details. La fuente se muestra como enlace separado. Reducir el grid a una columna bajo 1024 px.

- [ ] **Step 4: Verificar y commit**

Run: `node tests/tender-follow-up-context-ui.test.mjs && npm run build`
Expected: PASS.

```bash
git add src/main.tsx src/styles.css tests/tender-follow-up-context-ui.test.mjs
git commit -m "feat(tenders): compact commercial context and follow-up"
```

### Task 8: Verificación integral

**Files:**
- Modify only if a failure exposes a defect covered by the approved design.

- [ ] **Step 1: Ejecutar tests focalizados**

```bash
for f in tests/tender*.test.mjs tests/agt002-tender-analysis-contract.test.mjs tests/hermes-interim-tender-analysis.test.mjs; do node "$f"; done
```

Expected: PASS.

- [ ] **Step 2: Ejecutar suite completa y build**

```bash
for f in tests/*.test.mjs; do node "$f"; done
npm run check:backend-parity
npm run build
```

Expected: PASS; sólo se admite el warning histórico de chunk >500 kB.

- [ ] **Step 3: QA visual autenticada**

Probar 1440, 1024, 768 y 390 px; flujo Radar→Oportunidades→detalle; foco/teclado; fuente oficial; estados análisis ausente/vigente/obsoleto; GO/NO GO sin escritura real.

- [ ] **Step 4: Revisión única del lote**

Revisar seguridad, migración, paridad, responsive y gobernanza. Corregir hallazgos y no pedir segunda revisión salvo riesgo crítico.

- [ ] **Step 5: Commit de correcciones verificadas**

```bash
git add -A
git commit -m "fix(tenders): address decision workspace review"
```
