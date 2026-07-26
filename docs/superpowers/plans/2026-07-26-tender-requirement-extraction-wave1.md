# Extracción de Requisitos por Frente — Wave 1 (corte vertical mínimo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el primer corte vertical del módulo puro de extracción de requisitos (`tender-requirement-extraction.js`) que especifica `docs/superpowers/specs/2026-07-25-tender-deep-requirement-analysis-design.md`, con un requisito representativo por frente (jurídico, financiero, técnico) y el contrato completo de evidencia/estado/pregunta, sin tocar la integración con `buildTenderDocumentAnalysis` ni la taxonomía GO/NO GO existente.

**Architecture:** Módulo puro sin dependencias externas, sin red, sin `Date.now()`/random. Recibe documentos ya extraídos a texto (mismo shape que consume `buildTenderSnapshotInput`) y produce, por extractor, `{ requirements, unverifiable_documents }`. La detección de palabras clave usa una normalización local (minúsculas + NFD sin diacríticos) que preserva la longitud de cadena, por lo que los índices de coincidencia son válidos tanto en el texto normalizado como en el original — así la evidencia se recorta del texto original, no del normalizado.

**Tech Stack:** Node.js (ESM), `node:assert/strict`, Node test runner (`node tests/*.test.mjs`), sin dependencias nuevas.

## Global Constraints

- Cero red, cero SDK de proveedor, cero `Date.now()`/random sin semilla — determinismo estricto.
- No se toca `buildTenderDocumentAnalysis`, `server/index.js`, `api/[...path].js`, ni ninguna migración.
- No se renombra ni se toca `commercial_fit`, `go_no_go`, `executive_semaphore`, `habilitating_requirements`, `committee_summary`.
- No se introduce una taxonomía nueva de GO/NO GO; este módulo no decide, solo estructura evidencia para revisión humana.
- `company_crosscheck` (cruce contra ficha/RUP, §9 del diseño) se difiere explícitamente a Wave 2 (`crosscheckCompanyProfile`); los requisitos de este corte no incluyen ese campo todavía.
- Catálogo de requisitos deliberadamente mínimo: un requisito por frente (no el catálogo completo de §7.1–7.3), para validar la forma del contrato antes de ampliar cobertura.
- Diseño fuente: `docs/superpowers/specs/2026-07-25-tender-deep-requirement-analysis-design.md`.

---

### Task 1: Extractores puros por frente con evidencia estructurada

**Files:**
- Create: `tender-requirement-extraction.js`
- Create: `tests/tender-requirement-extraction.test.mjs`

**Interfaces:**
- Produces: `extractLegalRequirements(documents)`, `extractFinancialRequirements(documents)`, `extractTechnicalRequirements(documents)` — cada una retorna `{ requirements: RequirementRecord[], unverifiable_documents: { document_id, name }[] }`.
- `RequirementRecord`: `{ id, front, label, status, severity, values: Value[], evidence: Evidence[], confidence, rationale, question }` (§6 del diseño; `company_crosscheck` diferido a Wave 2).
- `Value`: `{ kind: 'money'|'percentage'|'duration'|'quantity', raw, normalized }`.
- `Evidence`: `{ document_id, document_name, document_type, excerpt }`.

- [ ] **Step 1: Escribir la prueba roja con las 7 aserciones de §13.1 del diseño**

Fixtures sintéticos (sin datos reales):
- `legal-guarantee-complete`: menciona póliza de cumplimiento con porcentaje y vigencia explícitos → `extractLegalRequirements` debe confirmar (`status: 'confirmed'`).
- `legal-guarantee-partial`: menciona póliza sin cuantía ni vigencia → `status: 'partial'`.
- `financial-working-capital-complete`: capital de trabajo con operador ("no inferior a") y valor → `status: 'confirmed'`.
- `financial-working-capital-partial`: capital de trabajo mencionado sin operador/valor → `status: 'partial'`.
- `technical-cctv-indication`: mención contextual de CCTV/videovigilancia sin condición cuantificable → `status: 'indication'`, nunca `'confirmed'`.
- Documento con contenido repetido en dos fragmentos del mismo texto → la evidencia deduplicada debe quedar en una sola entrada.
- Mismos documentos en dos órdenes distintos → `extractLegalRequirements`/`extractFinancialRequirements`/`extractTechnicalRequirements` deben producir resultados `assert.deepEqual`.
- Documento con `content: ''` → aparece en `unverifiable_documents` de los tres extractores.
- Documento con texto largo alrededor de la coincidencia → el `excerpt` de la evidencia queda acotado (longitud máxima fija, con elipsis si se recorta).

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-requirement-extraction.test.mjs`
Expected: FAIL — `Cannot find module '../tender-requirement-extraction.js'`.

- [ ] **Step 3: Implementar el módulo mínimo**

- Normalización de documento: identidad estable (`id`/`document_id` obligatorio, sin generación de hash — eso ya existe en `tender-analysis-foundation.js` y no se duplica aquí), contenido con saltos de línea normalizados.
- Orden determinista: documentos ordenados por `document_id` antes de procesar, independientemente del orden de entrada.
- Detección de palabra clave sobre texto normalizado (minúsculas + NFD sin diacríticos, longitud preservada) para que el índice de coincidencia sea válido también sobre el contenido original.
- Ventana de materialidad alrededor de cada coincidencia para detectar valores (`porcentaje`, `dinero`, `vigencia`/duración, cantidad).
- Reglas de estado: jurídico y financiero solo `confirmed` con evidencia material completa (valor + condición), `partial` con mención aislada, `pending` sin mención; técnico solo `indication` o `pending` en este corte (nunca `confirmed`, catálogo de condiciones cuantificables técnicas queda para Wave 2).
- Deduplicación de evidencia por `(document_id, excerpt)`.
- Recorte de fragmento con radio fijo y longitud máxima, con elipsis en los bordes recortados.
- `unverifiable_documents`: documentos cuyo contenido normalizado queda vacío.

- [ ] **Step 4: Verificar y commit**

Run: `node tests/tender-requirement-extraction.test.mjs`
Expected: PASS.

Run adicional (no debe romperse): `node --test tests/tender-analysis-rules-registration.test.mjs tests/tender-analysis-foundation-safety.test.mjs tests/hermes-interim-tender-analysis.test.mjs tests/agt002-tender-analysis-contract.test.mjs`
Expected: 4/4 PASS (el módulo nuevo no está wired a ningún archivo existente, por lo que esta suite no debería verse afectada; se corre solo para confirmar ausencia de regresión accidental).

Verificación de cierre: `npx tsc --noEmit`, `npm run build`, `git diff --check`, revisión de diff, un commit local.

---

## Backlog explícito (fuera de este plan)

- Wave 2: `crosscheckCompanyProfile`, `buildRequirementAnalysis`, ampliar catálogo de requisitos por frente.
- Wave 3: integración con `buildTenderDocumentAnalysis`, bump de `RULES_POLICY_VERSION`/`RULES_SCHEMA_VERSION`, UI.
