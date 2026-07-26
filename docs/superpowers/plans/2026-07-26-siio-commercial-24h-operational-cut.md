# SIIO Comercial — Plan TDD ejecutable del corte operativo de 24 horas

> **Ejecución:** GPT/Hermes implementa este plan secuencialmente con TDD. No usar Claude en este corte. Máximo dos frentes con archivos disjuntos al mismo tiempo. No hacer push, merge, migración remota, deploy, cargar secretos ni consumir OpenAI hasta el Gate Productivo de la Tarea 12.

**Objetivo:** desplegar un corte verificable de Oportunidades, análisis profundo de Licitaciones y `AGT-002 Preview` con GPT-5.6 Luna, conservando decisión GO/NO GO exclusivamente humana.

**Diseño aprobado:** `docs/superpowers/specs/2026-07-26-siio-commercial-24h-operational-cut-design.md`

**Base:** `origin/main` en `ea6117bd2a6d75f1c21fb5938a79d1134fe49b24`

**Arquitectura:** el análisis determinístico Wave 1–3 produce la matriz y los extractos de evidencia. Un endpoint separado y explícito envía sólo ese payload acotado y redactado a OpenAI Responses API. La respuesta cerrada se valida contra el contrato AGT-002 y las citas permitidas antes de registrarse append-only. Las reglas siguen disponibles si GPT está apagado o falla.

**Stack:** Node.js ESM, Express, Vercel Functions, React/TypeScript/Vite, Supabase/PostgreSQL, PGlite, OpenAI Responses API mediante `fetch` inyectable.

---

## Restricciones globales

- RED antes de GREEN en cada cambio funcional.
- No introducir una migración nueva salvo bloqueo demostrado y aprobación humana separada.
- Mantener `server/index.js` y `api/[...path].js` en paridad.
- No modificar ni reescribir migraciones 025–027.
- No guardar prompts completos, secretos ni contenido documental completo.
- No usar `HERMES-INTERIM` como productor o alias de AGT-002.
- No permitir herramientas, web, firma, envío, escritura de oportunidad o GO/NO GO desde GPT.
- No permitir fallback automático a otro modelo.
- Una sola revisión completa por lote; repetir sólo por Critical, Important o regresión.
- Cada tarea termina con prueba focal y commit local.

---

## Tarea 0 — Crear rama de ejecución y baseline fresco

**Archivos:** ninguno de producto.

- [ ] **Paso 1: crear rama de implementación desde el commit documental**

```bash
git switch -c feat/siio-commercial-24h-operational-cut
```

Esperado: rama nueva con los documentos aprobados y sin cambios sin registrar.

- [ ] **Paso 2: instalar dependencias reproduciblemente**

```bash
npm install
```

- [ ] **Paso 3: ejecutar baseline focal y completo**

```bash
node tests/auth-context-access.test.mjs
node tests/backend-parity.test.mjs
for test in tests/*pglite*.test.mjs; do node "$test" || exit 1; done
for test in tests/*.test.mjs; do node "$test" || exit 1; done
npx tsc --noEmit
npm run check:backend-parity
npm run build
git diff --check
```

- [ ] **Paso 4: registrar evidencia baseline**

Crear: `docs/evidence/2026-07-26-siio-commercial-24h-baseline.md`

Debe contener commit, comandos, conteos, fallas exactas y clasificación `preexisting` o `new`. No contener secretos ni filas de negocio.

- [ ] **Paso 5: commit**

```bash
git add docs/evidence/2026-07-26-siio-commercial-24h-baseline.md
git commit -m "docs: record SIIO 24h baseline"
```

**Gate:** no continuar con una falla nueva no explicada.

---

## Tarea 1 — Oportunidades: convertir el 500 sin sesión en 401

**Archivos:**

- Crear: `tests/opportunity-auth-errors.integration.test.mjs`
- Modificar: `server/index.js`
- Modificar: `api/[...path].js`

- [ ] **Paso 1: escribir prueba RED**

Usar el patrón de servidor Supabase falso de `tests/auth-context-access.test.mjs`. Arrancar la app Express y solicitar sin Bearer:

- `GET /api/opportunities/<uuid>`;
- `GET /api/opportunity-detail?id=<uuid>`.

Afirmar para ambos:

- status `401`;
- JSON `{ error: <mensaje seguro> }`;
- cero lecturas de tablas CRM después de fallar autenticación;
- ninguna cadena interna del proveedor en la respuesta.

- [ ] **Paso 2: ejecutar RED**

```bash
node tests/opportunity-auth-errors.integration.test.mjs
```

Esperado: la ruta anidada reproduce `500` o un status distinto de `401`.

- [ ] **Paso 3: implementar el cambio mínimo**

En ambos backends, hacer que el catch de `GET /api/opportunities/:id` use el mismo mapeo de autenticación seguro que `/api/opportunity-detail`. No relajar `requireModuleAction`, `ensureOpportunityAccess` ni permisos.

- [ ] **Paso 4: GREEN y paridad**

```bash
node tests/opportunity-auth-errors.integration.test.mjs
node tests/auth-context-access.test.mjs
node tests/vercel-nested-api-routing.test.mjs
npm run check:backend-parity
git diff --check
```

- [ ] **Paso 5: commit**

```bash
git add tests/opportunity-auth-errors.integration.test.mjs server/index.js 'api/[...path].js'
git commit -m "fix(crm): return controlled auth errors for opportunity detail"
```

---

## Tarea 2 — Integrar Waves 1–2 sobre la base vigente

**Archivos:**

- Añadir: `tender-requirement-extraction.js`
- Añadir: `tests/tender-requirement-extraction.test.mjs`
- Añadir: `tests/tender-requirement-analysis.test.mjs`
- Añadir: los dos planes históricos Wave 1–2

- [ ] **Paso 1: portar commits existentes sin reimplementarlos**

```bash
git cherry-pick 623e86b
git cherry-pick 63fd0d2
```

- [ ] **Paso 2: ejecutar pruebas focales**

```bash
node tests/tender-requirement-extraction.test.mjs
node tests/tender-requirement-analysis.test.mjs
```

Esperado: PASS.

- [ ] **Paso 3: resolver sólo conflictos con `origin/main` vigente**

No ampliar catálogo ni cambiar semántica aprobada. Si hubo conflicto, volver a ejecutar las dos pruebas y `git diff --check`.

- [ ] **Paso 4: verificar aislamiento puro**

```bash
node tests/tender-requirement-extraction.test.mjs
node tests/tender-requirement-analysis.test.mjs
git diff --check
```

Los commits cherry-picked sirven como commits de esta tarea; no crear commit vacío.

---

## Tarea 3 — Wave 3: integrar matriz profunda en el análisis SIIO

**Archivos:**

- Crear: `tender-document-analysis.js`
- Crear: `tests/tender-deep-analysis-integration.test.mjs`
- Modificar: `server/index.js`
- Modificar: `api/[...path].js`
- Modificar: `tests/tender-analysis-rules-registration.test.mjs`

**Decisión de diseño:** extraer `buildTenderDocumentAnalysis` de los backends duplicados a un módulo puro compartido. Ambos backends lo importan. Esto reduce riesgo de divergencia sin refactor general.

- [ ] **Paso 1: escribir prueba RED del módulo compartido**

Casos sintéticos:

1. pliego con requisito jurídico, financiero y técnico;
2. perfil empresarial suficiente para un requisito y con brecha para otro;
3. texto parecido sin equivalencia comprobada;
4. documento no extraíble;
5. documentos reordenados producen resultado idéntico.

Afirmar que el resultado contiene:

- `legal`, `financial`, `technical`;
- `coverage`;
- `strengths`, `weaknesses`, `blockers`, `questions`, `unverified`;
- `company_profile_crosscheck`;
- taxonomía canónica de recomendación/riesgo ya existente;
- `human_review_required: true`;
- evidencia con IDs estables.

- [ ] **Paso 2: ejecutar RED**

```bash
node tests/tender-deep-analysis-integration.test.mjs
```

Esperado: módulo o export ausente.

- [ ] **Paso 3: extraer el análisis actual**

Mover la lógica actual de `buildTenderDocumentAnalysis` y sus helpers estrictamente necesarios a `tender-document-analysis.js`. Mantener el contrato actual antes de integrar la matriz.

- [ ] **Paso 4: integrar `buildRequirementAnalysis`**

Componer el resultado profundo con la recomendación canónica existente. No usar similitud textual como cumplimiento. Mantener evidencia del pliego separada de evidencia empresarial.

Actualizar versión de reglas sólo si cambia el resultado persistido:

- `RULES_SCHEMA_VERSION = siio-tender-analysis-rules-v2`;
- `RULES_POLICY_VERSION = siio-rules-v2`.

- [ ] **Paso 5: sustituir duplicados por import compartido**

Modificar los dos backends para importar `buildTenderDocumentAnalysis` desde el nuevo módulo.

- [ ] **Paso 6: GREEN**

```bash
node tests/tender-requirement-extraction.test.mjs
node tests/tender-requirement-analysis.test.mjs
node tests/tender-deep-analysis-integration.test.mjs
node tests/tender-analysis-rules-registration.test.mjs
npm run check:backend-parity
git diff --check
```

- [ ] **Paso 7: commit**

```bash
git add tender-document-analysis.js tender-analysis-foundation.js server/index.js 'api/[...path].js' tests/tender-deep-analysis-integration.test.mjs tests/tender-analysis-rules-registration.test.mjs
git commit -m "feat(tenders): integrate deep requirement matrix into SIIO analysis"
```

---

## Tarea 4 — Construir payload mínimo y redactado para GPT

**Archivos:**

- Crear: `agt002-preview-input.js`
- Crear: `tests/agt002-preview-input.test.mjs`

- [ ] **Paso 1: escribir prueba RED**

Probar `buildAgt002PreviewInput({ snapshot, deterministicAnalysis })` con documentos que contengan:

- email;
- teléfono;
- cédula;
- URL firmada con token;
- texto de prompt injection;
- más de 12 documentos;
- más de 3.000 caracteres por documento.

Afirmar:

- máximo 12 representaciones;
- máximo 3.000 caracteres por documento;
- máximo 36.000 caracteres documentales;
- no email, teléfono, identificación, token ni URL firmada;
- prompt injection se conserva como dato citado pero nunca como instrucción de sistema;
- sólo IDs de evidencia permitidos;
- orden determinístico;
- misma entrada produce mismo payload y hash.

- [ ] **Paso 2: ejecutar RED**

```bash
node tests/agt002-preview-input.test.mjs
```

- [ ] **Paso 3: implementar funciones puras**

Implementar:

- `redactSensitiveTenderText`;
- `selectBoundedEvidence`;
- `buildAgt002PreviewInput`;
- `collectAllowedEvidenceRefs`.

No red ni reloj; no mutar el snapshot.

- [ ] **Paso 4: GREEN y commit**

```bash
node tests/agt002-preview-input.test.mjs
git diff --check
git add agt002-preview-input.js tests/agt002-preview-input.test.mjs
git commit -m "feat(agt002): build bounded redacted preview input"
```

---

## Tarea 5 — Adaptador OpenAI para GPT-5.6 Luna

**Archivos:**

- Crear: `openai-agt002-tender-analysis-adapter.js`
- Crear: `tests/openai-agt002-tender-analysis.test.mjs`
- Modificar: `agt002-tender-adapter.js`
- Modificar: `tender-analysis-domain.js`

- [ ] **Paso 1: escribir pruebas RED de transporte y contrato**

Con `fetch` inyectado, afirmar:

- endpoint HTTPS oficial de OpenAI allowlisted;
- `Authorization` sólo en header;
- Responses API;
- `model: gpt-5.6-luna`;
- sin tools;
- sin web search;
- sin session/conversation persistente;
- salida JSON Schema cerrada;
- identidad `AGT-002`;
- `human_review_required: true`;
- política anti-inyección;
- timeout y AbortController;
- un reintento sólo para error de transporte seguro;
- misma idempotency key en reintento;
- errores sanitizados;
- validación de usage;
- rechazo de cita que no está en `allowedEvidenceRefs`;
- rechazo de output truncado, texto adicional, identidad incorrecta o snapshot distinto.

- [ ] **Paso 2: ejecutar RED**

```bash
node tests/openai-agt002-tender-analysis.test.mjs
```

- [ ] **Paso 3: implementar adaptador**

Crear `createOpenAiAgt002TenderAnalysisEngine` con:

- configuración explícita;
- `gpt-5.6-luna` como único modelo aceptado en este corte;
- policy `agt002-preview-policy-v1`;
- schema `2.0-preview.1`;
- preflight de costo;
- salida estructurada;
- validación final mediante `adaptAgt002TenderAnalysis`.

Actualizar el envelope `agt002-tender-adapter.js` para aceptar exactamente `2.0-preview.1`. No relajar identidad ni enum.

- [ ] **Paso 4: GREEN y regresión Hermes**

```bash
node tests/openai-agt002-tender-analysis.test.mjs
node tests/hermes-interim-tender-analysis.test.mjs
git diff --check
```

- [ ] **Paso 5: commit**

```bash
git add openai-agt002-tender-analysis-adapter.js agt002-tender-adapter.js tender-analysis-domain.js tests/openai-agt002-tender-analysis.test.mjs
git commit -m "feat(agt002): add governed OpenAI preview adapter"
```

---

## Tarea 6 — Persistencia, presupuesto diario e idempotencia

**Archivos:**

- Modificar: `tender-analysis-foundation.js`
- Crear: `tests/agt002-analysis-registration.test.mjs`
- Modificar: `tests/tender-analysis-foundation-pglite.integration.test.mjs`

- [ ] **Paso 1: escribir prueba RED de registro**

Probar `registerAgt002Analysis` con base falsa:

- exige snapshot existente y vigente;
- productor `AGT-002` y método `agent_ai`;
- modelo `gpt-5.6-luna`;
- política y schema fijados;
- idempotency key determinística por snapshot/model/policy;
- usage y costo persistidos;
- segundo registro idéntico devuelve el mismo run;
- resultado diferente bajo la misma key se rechaza;
- snapshot diferente no puede usar el run anterior.

- [ ] **Paso 2: escribir prueba RED de presupuesto diario**

Probar `getAgt002DailySpend` y `assertAgt002Budget`:

- suma `usage.cost_usd` de runs AGT-002 del día UTC;
- ignora reglas/Hermes;
- falla cerrado ante usage inválido o consulta truncada;
- bloquea antes del transporte en USD 5 diarios;
- bloquea una ejecución estimada mayor a USD 0,25.

- [ ] **Paso 3: ejecutar RED**

```bash
node tests/agt002-analysis-registration.test.mjs
```

- [ ] **Paso 4: implementar sin migración**

Reutilizar `psi_record_tender_analysis_run`. Añadir sólo helpers JS. Extender el select de `getCurrentTenderAnalysis` para presentar `model` y `usage` sin permitir que `result` los falsifique.

- [ ] **Paso 5: GREEN y PGlite**

```bash
node tests/agt002-analysis-registration.test.mjs
node tests/tender-analysis-foundation-pglite.integration.test.mjs
node tests/tender-analysis-rules-registration.test.mjs
git diff --check
```

- [ ] **Paso 6: commit**

```bash
git add tender-analysis-foundation.js tests/agt002-analysis-registration.test.mjs tests/tender-analysis-foundation-pglite.integration.test.mjs
git commit -m "feat(agt002): persist preview runs with budget and idempotency"
```

---

## Tarea 7 — Runtime y endpoint gobernado de AGT-002

**Archivos:**

- Crear: `agt002-preview-runtime.js`
- Crear: `tests/agt002-preview-api.integration.test.mjs`
- Modificar: `server/index.js`
- Modificar: `api/[...path].js`
- Modificar: `access-control.js` sólo si no existe una acción adecuada; preferir `LICITACIONES_GO_NO_GO_APPROVE` para el corte.
- Modificar: `tests/tender-analysis-foundation-safety.test.mjs`

**Ruta:** `POST /api/tender-documents-analyze-ai`

- [ ] **Paso 1: escribir prueba RED de API**

Casos:

1. sin Bearer → `401`, cero DB/model calls;
2. usuario de sólo lectura → `403`, cero model calls;
3. feature flag ausente → `503` seguro;
4. documentos ausentes → `400`;
5. snapshot no vigente → `409`;
6. presupuesto agotado → `429` o `403` de política, cero model calls;
7. ejecución válida → `200`, una llamada al modelo y un run persistido;
8. repetición → mismo run, sin segundo cobro;
9. proveedor falla → error seguro, análisis por reglas continúa disponible;
10. documentos cambian durante ejecución → no publicar como vigente.

- [ ] **Paso 2: ejecutar RED**

```bash
node tests/agt002-preview-api.integration.test.mjs
```

- [ ] **Paso 3: implementar runtime fail-closed**

`agt002-preview-runtime.js` debe:

- validar variables;
- exigir `TENDER_ANALYSIS_ENGINE=agt002_openai_preview`;
- aceptar sólo `OPENAI_MODEL=gpt-5.6-luna`;
- construir presupuesto con USD 0,25/5 por defecto aprobado, sin permitir valores negativos;
- crear engine con `fetch` inyectable;
- no imprimir secretos.

El endpoint debe:

- autenticar primero;
- exigir permiso humano de aprobación de Licitaciones;
- cargar documentos vigentes sin signed URLs;
- cargar la matriz determinística y snapshot vigente;
- comprobar presupuesto;
- construir payload redactado;
- ejecutar GPT;
- volver a comprobar vigencia;
- persistir y devolver el payload documental actualizado.

- [ ] **Paso 4: mantener paridad**

Aplicar la misma ruta y imports en ambos backends.

- [ ] **Paso 5: GREEN**

```bash
node tests/agt002-preview-api.integration.test.mjs
node tests/tender-analysis-foundation-safety.test.mjs
node tests/backend-parity.test.mjs
npm run check:backend-parity
git diff --check
```

- [ ] **Paso 6: commit**

```bash
git add agt002-preview-runtime.js server/index.js 'api/[...path].js' access-control.js tests/agt002-preview-api.integration.test.mjs tests/tender-analysis-foundation-safety.test.mjs
git commit -m "feat(agt002): expose governed preview analysis endpoint"
```

---

## Tarea 8 — UI de matriz, AGT-002 y separación de autoridad

**Archivos:**

- Modificar: `src/tenders/types.ts`
- Modificar: `src/tenders/components/TenderAnalysisSection.tsx`
- Crear: `src/tenders/components/TenderRequirementMatrix.tsx`
- Modificar: `src/main.tsx`
- Modificar: `src/styles.css`
- Crear: `tests/agt002-preview-ui.test.mjs`
- Modificar: `tests/tender-guided-workspace-ui.test.mjs`
- Modificar: `tests/tender-go-no-go-ui.test.mjs`

- [ ] **Paso 1: escribir prueba RED de UI**

Afirmar estáticamente y con esbuild:

- tres capas rotuladas: reglas SIIO, AGT-002 Preview y decisión humana;
- matriz legal/financial/technical;
- productor, modelo, fecha, vigencia y costo;
- botón “Generar borrador con AGT-002” sólo bajo `can(...)` de la acción autorizada;
- botón llama `/api/tender-documents-analyze-ai`;
- estados loading/error/obsolete/budget;
- texto “Revisión humana obligatoria”;
- no hay copy que diga que AGT-002 decidió GO/NO GO;
- GO y NO GO siguen disponibles aun si análisis es null o IA falla.

- [ ] **Paso 2: ejecutar RED**

```bash
node tests/agt002-preview-ui.test.mjs
```

- [ ] **Paso 3: extender tipos**

Añadir tipos cerrados para:

- matriz de requisitos;
- `usage`;
- `model`;
- estados y productores;
- análisis separados dentro de `analyses`.

- [ ] **Paso 4: implementar componentes**

`TenderRequirementMatrix` renderiza cada frente con estado, severidad, evidencia de pliego, evidencia empresarial y pregunta. `TenderAnalysisSection` recibe `analysis`, `analyses`, autorización y callback AGT-002.

En `TenderDocumentReviewPanel`, añadir `analyzeWithAgt002`; no reutilizar el botón de reglas. Mantener la acción de reglas disponible.

- [ ] **Paso 5: responsive y accesibilidad**

Añadir CSS sin cambiar navegación global. Usar headings, `aria-live` para estado, botones con disabled real y tablas/cards adaptables a 390px.

- [ ] **Paso 6: GREEN**

```bash
node tests/agt002-preview-ui.test.mjs
node tests/tender-guided-workspace-ui.test.mjs
node tests/tender-go-no-go-ui.test.mjs
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] **Paso 7: commit**

```bash
git add src/tenders/types.ts src/tenders/components/TenderAnalysisSection.tsx src/tenders/components/TenderRequirementMatrix.tsx src/main.tsx src/styles.css tests/agt002-preview-ui.test.mjs tests/tender-guided-workspace-ui.test.mjs tests/tender-go-no-go-ui.test.mjs
git commit -m "feat(tenders): present deep matrix and AGT-002 preview"
```

---

## Tarea 9 — Cerrar PGlite y regresiones integrales

**Archivos:** los tests o fixtures exactos que falle el baseline; no tocar migraciones productivas para acomodar PGlite sin causa real.

- [ ] **Paso 1: ejecutar sólo PGlite**

```bash
for test in tests/*pglite*.test.mjs; do node "$test" || exit 1; done
```

- [ ] **Paso 2: diagnosticar cada falla**

Clasificar:

- incompatibilidad legítima PGlite;
- fixture incompleto;
- regresión SQL real;
- expectativa obsoleta.

No saltar pruebas ni convertir assert en no-op.

- [ ] **Paso 3: escribir o ajustar prueba que demuestre causa**

La corrección debe pasar en aislamiento y conservar el contrato de seguridad 025–027.

- [ ] **Paso 4: ejecutar matriz de migraciones**

```bash
node tests/tender-analysis-foundation-pglite.integration.test.mjs
node tests/tender-analysis-go-gate-pglite.integration.test.mjs
node tests/tender-document-versions-pglite.integration.test.mjs
node tests/tender-document-state-migrations-pglite.integration.test.mjs
node tests/tender-go-no-go-pglite.integration.test.mjs
```

- [ ] **Paso 5: commit**

```bash
git add tests
git commit -m "test(tenders): close PGlite coverage for operational cut"
```

Si el fix requiere SQL productivo, detenerse y abrir gate de migración separado.

---

## Tarea 10 — Suite completa, revisión única y evidencia predeploy

**Archivos:**

- Crear: `docs/evidence/2026-07-27-siio-commercial-24h-predeploy.md`

- [ ] **Paso 1: pruebas focales críticas**

```bash
node tests/opportunity-auth-errors.integration.test.mjs
node tests/tender-deep-analysis-integration.test.mjs
node tests/agt002-preview-input.test.mjs
node tests/openai-agt002-tender-analysis.test.mjs
node tests/agt002-analysis-registration.test.mjs
node tests/agt002-preview-api.integration.test.mjs
node tests/agt002-preview-ui.test.mjs
```

- [ ] **Paso 2: suite completa una vez**

```bash
for test in tests/*.test.mjs; do node "$test" || exit 1; done
npx tsc --noEmit
npm run check:siio-integration
npm run check:siio-executive
npm run check:siio-agents
npm run check:nav-permissions
npm run check:backend-parity
npm run build
git diff --check
```

- [ ] **Paso 3: revisión técnica independiente única con GPT**

Revisar diff completo contra `origin/main` con foco en:

- secretos;
- PII;
- prompt injection;
- autoridad humana;
- permisos;
- idempotencia;
- costo;
- concurrencia;
- paridad;
- regresiones de Oportunidades.

Corregir sólo Critical/Important o regresiones. Registrar cada corrección y volver a correr sólo pruebas afectadas; repetir suite completa sólo si la corrección puede tener alcance transversal.

- [ ] **Paso 4: escribir evidencia predeploy**

Incluir:

- commits;
- conteos;
- modelo fijado;
- costos máximos;
- variables requeridas por nombre;
- zero real provider calls hasta este punto;
- rollback;
- riesgos residuales;
- decisión técnica `GO` o `NO_GO`.

- [ ] **Paso 5: commit**

```bash
git add docs/evidence/2026-07-27-siio-commercial-24h-predeploy.md
git commit -m "docs: record SIIO commercial predeploy evidence"
```

---

## Tarea 11 — QA local de UI desktop/móvil

**Archivos:** evidencia únicamente, salvo bug reproducido con prueba.

- [ ] Iniciar servidor local en background.
- [ ] Verificar readiness antes de navegar.
- [ ] Ejecutar Playwright en 1440×900 y 390×844.
- [ ] Validar Oportunidades, detalle, Back, “Limpiar contexto”, expediente, matriz y estados AGT-002.
- [ ] Revisar consola y requests fallidos.
- [ ] Confirmar que navegación read-only no produjo POST/PUT.
- [ ] Guardar screenshots sin datos sensibles.
- [ ] Detener servidor.

Crear: `docs/evidence/2026-07-27-siio-commercial-24h-ui-qa.md`

Commit:

```bash
git add docs/evidence/2026-07-27-siio-commercial-24h-ui-qa.md
git commit -m "docs: record SIIO operational UI QA"
```

---

## Tarea 12 — GATE PRODUCTIVO: detener y solicitar autorización

**No ejecutar automáticamente.** Presentar a Juan:

1. evidencia predeploy;
2. QA local;
3. lista de commits;
4. resultado de revisión;
5. modelo `gpt-5.6-luna`;
6. límites USD 0,25 por ejecución y USD 5 diarios;
7. nombres de secrets requeridos;
8. expediente propuesto para un solo smoke real;
9. rollback exacto;
10. confirmación de cero consumo OpenAI hasta el momento.

Solicitar autorización separada para:

- push/PR/merge;
- carga de secreto en Vercel;
- deploy;
- una ejecución GPT con extractos reales autorizados;
- smoke autenticado por roles;
- cualquier escritura productiva de prueba.

Si no se autoriza, terminar en estado `LOCAL_PASS`, sin efectos externos.

---

## Tarea 13 — Despliegue y smoke productivo, sólo tras Gate 12

**Prerequisito:** autorización explícita registrada.

- [ ] Verificar identidad y scope Vercel `psi-llc-projects` sin imprimir tokens.
- [ ] Cargar `OPENAI_API_KEY` directamente como secret productivo.
- [ ] Cargar configuración fijada:

```text
TENDER_ANALYSIS_ENGINE=agt002_openai_preview
OPENAI_MODEL=gpt-5.6-luna
AGT002_POLICY_VERSION=agt002-preview-policy-v1
AGT002_MAX_COST_USD=0.25
AGT002_DAILY_MAX_COST_USD=5
AGT002_INPUT_USD_PER_1K=0.001
AGT002_OUTPUT_USD_PER_1K=0.006
AGT002_PRICING_VERSION=openai-2026-07-26
```

- [ ] Push, PR y merge por la ruta autorizada.
- [ ] Desplegar desde `main` integrado, no desde un árbol local sin push.
- [ ] Verificar deployment status y URL canónica.
- [ ] Smoke sin sesión: `401`, no `500`.
- [ ] Smoke autenticado read-only por Admin, Gerencia y Comercial.
- [ ] Ejecutar análisis por reglas sobre expediente controlado si corresponde.
- [ ] Ejecutar exactamente una generación AGT-002 real.
- [ ] Verificar productor, snapshot, citas, modelo, tokens, costo, idempotencia y revisión humana pendiente.
- [ ] Confirmar que no existe decisión GO/NO GO generada por el agente.

Crear evidencia: `docs/evidence/2026-07-27-siio-commercial-24h-production-closeout.md`.

**No guardar:** prompt, contenido documental, secret, token o respuesta cruda del proveedor.

---

## Tarea 14 — Rollback y hypercare

- [ ] Si falla sólo GPT, cambiar `TENDER_ANALYSIS_ENGINE=rules` y desplegar configuración segura.
- [ ] Si falla el CRM, restaurar el deployment Vercel anterior.
- [ ] No borrar runs ni snapshots append-only.
- [ ] Verificar Oportunidades, expediente, análisis por reglas y GO/NO GO humano.
- [ ] Observar logs sanitizados durante la ventana restante.
- [ ] Publicar estado final `PASS`, `PARTIAL`, `LOCAL_PASS` o `ROLLBACK`.

---

## Definition of Done

El corte sólo es `PASS` si:

1. sin sesión devuelve `401`;
2. permisos por rol pasan;
3. Oportunidades y Prioridades navegan correctamente;
4. PGlite está verde;
5. matriz profunda aparece en expediente;
6. snapshots e invalidación pasan;
7. AGT-002 usa sólo `gpt-5.6-luna`;
8. input está acotado y redactado;
9. citas se validan contra evidencia permitida;
10. presupuesto e idempotencia pasan;
11. productor/modelo/tokens/costo quedan auditados;
12. IA falla cerrado;
13. reglas siguen funcionando sin IA;
14. GO/NO GO continúa exclusivamente humano;
15. suite, TypeScript, paridad, build y diff pasan;
16. QA desktop/móvil pasa;
17. un smoke real controlado pasa después de autorización;
18. rollback está verificado.
