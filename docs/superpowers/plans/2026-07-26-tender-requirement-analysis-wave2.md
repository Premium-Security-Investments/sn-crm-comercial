# Cruce Empresarial/RUP y Matriz Derivada — Wave 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir `crosscheckCompanyProfile` y `buildRequirementAnalysis` a `tender-requirement-extraction.js`, cerrando el corte vertical de Wave 1 con cruce contra ficha/RUP sintética y derivación de fortalezas/debilidades/bloqueadores/preguntas críticas, sin wiring a `buildTenderDocumentAnalysis` (Wave 3) ni taxonomía GO/NO GO nueva.

**Architecture:** Ambas funciones se añaden al mismo módulo puro de Wave 1 (§5 del diseño lista las cinco funciones en un solo archivo). `crosscheckCompanyProfile(requirements, companyProfile)` anota cada requisito con `company_crosscheck` comparando valores numéricos extraídos contra campos declarados de la ficha; nunca acepta similitud textual como equivalencia (§9, principio explícito). `buildRequirementAnalysis(documents, companyProfile)` ejecuta los tres extractores de Wave 1, aplica el cruce, y deriva la matriz de síntesis.

**Tech Stack:** Node.js (ESM), `node:assert/strict`, Node test runner, sin dependencias nuevas.

## Global Constraints

- Cero red, cero `Date.now()`/random.
- No se toca `buildTenderDocumentAnalysis`, `server/index.js`, `api/[...path].js`, ni migraciones (eso es Wave 3).
- No se introduce una taxonomía nueva de GO/NO GO ni un campo `recommendation`/`risk` propio: el diseño exige que esos valores, cuando existan, reutilicen los canónicos ya existentes en `buildTenderGoNoGoVerdict` — algo que solo es posible al integrar en Wave 3. Por eso `buildRequirementAnalysis` de este corte **no produce riesgo ni recomendación preliminar**; se limita a cobertura, fortalezas, debilidades, bloqueadores, preguntas (con `critical` por regla fija de severidad) e información no verificada.
- `crosscheckCompanyProfile` solo compara **valores numéricos explícitos** (dinero, porcentaje) contra campos declarados en `companyProfile`; texto parecido nunca produce `match` (§9, "Textos parecidos no se consideran equivalentes por sí solos").
- El requisito técnico de Wave 1 (`technical-video-surveillance-scope`) no tiene campo numérico comparable en este corte → su cruce siempre es `unavailable`, documentado explícitamente, no una omisión silenciosa.
- Diseño fuente: `docs/superpowers/specs/2026-07-25-tender-deep-requirement-analysis-design.md` (§9-§10).

---

### Task 1: `crosscheckCompanyProfile` — cruce contra ficha/RUP sintética

**Files:**
- Modify: `tender-requirement-extraction.js`
- Create: `tests/tender-requirement-analysis.test.mjs`

**Interfaces:**
- Produces: `crosscheckCompanyProfile(requirements, companyProfile)` → `requirements` anotados con `company_crosscheck: { status: 'match'|'partial'|'gap'|'unavailable', company_evidence: string|null }`.

- [ ] **Step 1: Prueba roja — aserciones de §13.2 del diseño**

Fixtures sintéticos (requisitos ya producidos por los extractores de Wave 1, `companyProfile` sintético):
- Capital de trabajo confirmado ($500.000.000) + `companyProfile.working_capital = 600000000` → `match`.
- Capital de trabajo confirmado ($500.000.000) + `companyProfile.working_capital = 300000000` → `gap` (diferencia comprobable).
- Capital de trabajo confirmado + `companyProfile` sin `working_capital` → `unavailable` (falta ficha).
- Póliza parcial con porcentaje detectado (15%) pero sin vigencia + `companyProfile.guarantee_capacity_pct = 20` → `partial` (falta precisión/vigencia en el requisito, aunque haya dato en ambos lados).
- Requisito técnico (`indication`) con `companyProfile.notes` mencionando el mismo término (CCTV) → `unavailable`, nunca `match` (texto parecido no es equivalencia comprobable).

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-requirement-analysis.test.mjs`
Expected: FAIL — `crosscheckCompanyProfile is not a function` / export ausente.

- [ ] **Step 3: Implementar `crosscheckCompanyProfile`**

- Tabla de mapeo requisito → campo de ficha comparable (`financial-working-capital` → `working_capital` en dinero; `legal-guarantee-policy` → `guarantee_capacity_pct` en porcentaje). El requisito técnico no tiene entrada en la tabla → siempre `unavailable`.
- Parseo numérico determinista de los `values` ya extraídos (dinero: dígitos; porcentaje: número antes de `%`).
- Reglas: sin campo de ficha o sin valor numérico exigido → `unavailable`; requisito `partial` con datos en ambos lados → `partial`; valor de ficha cumple el umbral → `match`; no lo cumple → `gap`.

- [ ] **Step 4: Verificar y commit parcial (dentro del mismo commit final de Wave 2)**

Run: `node tests/tender-requirement-analysis.test.mjs`
Expected: PASS.

---

### Task 2: `buildRequirementAnalysis` — matriz derivada

**Files:**
- Modify: `tender-requirement-extraction.js`
- Modify: `tests/tender-requirement-analysis.test.mjs`

**Interfaces:**
- Produces: `buildRequirementAnalysis(documents, companyProfile)` → `{ legal, financial, technical, coverage, strengths, weaknesses, blockers, questions, unverified, next_action, unverifiable_documents }`.
- `questions[]`: `{ id, front, question, critical }`, con `critical` fijado por la regla exacta del diseño (§6, "Mapeo obligatorio `severity` → `questions[].critical`"): `true` si y solo si `severity === 'critical'` y (`status === 'pending'` o `status === 'unverifiable'` o `company_crosscheck.status === 'gap'`).

- [ ] **Step 1: Ampliar la prueba roja**

- Documento con póliza parcial + capital de trabajo pendiente (crítico) → `blockers` incluye el capital de trabajo pendiente; `questions` incluye ambos con `critical: true` solo para el pendiente crítico.
- Documento con todo confirmado y ficha que iguala/supera los umbrales → `strengths` no vacío, `blockers` vacío, `next_action` sin bloqueadores ni preguntas críticas.
- `coverage` refleja conteos correctos de `confirmed/partial/indication/pending`.
- Reordenar los mismos documentos produce `assert.deepEqual` (determinismo heredado de Wave 1).
- Ningún campo del resultado contiene las palabras `GO`/`NO GO`/`recomendación` (verificación explícita de que no se inventa taxonomía de decisión).

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-requirement-analysis.test.mjs`
Expected: FAIL — `buildRequirementAnalysis is not a function`.

- [ ] **Step 3: Implementar `buildRequirementAnalysis`**

Ejecuta los tres extractores de Wave 1 sobre `documents`, aplica `crosscheckCompanyProfile` a cada frente, agrega `coverage`, deriva `strengths`/`weaknesses`/`blockers`/`questions`/`unverified`/`next_action` según §10, sin campo de riesgo/recomendación (diferido a Wave 3).

- [ ] **Step 4: Verificar y commit**

Run: `node tests/tender-requirement-analysis.test.mjs`
Expected: PASS.

Verificación de cierre: prueba focal, `node --test` sobre suite de análisis existente (paridad), runner completo `tests/*.test.mjs` (confirmar únicamente las 2 fallas PGlite preexistentes ya registradas en el loop §16.3), `npx tsc --noEmit`, `npm run check:backend-parity`, `npm run build`, `git diff --check`, un commit local.

---

## Backlog explícito (fuera de este plan)

- Wave 3: integración con `buildTenderDocumentAnalysis`, bump de `RULES_POLICY_VERSION`/`RULES_SCHEMA_VERSION`, UI, riesgo/recomendación preliminar reutilizando taxonomía canónica existente.
- Ampliar catálogo de requisitos por frente más allá del representante mínimo de Wave 1 (queda para cuando se decida ampliar cobertura, no bloqueante para Wave 2/3).
