# AGT-002 "Análisis para decidir" — superficie única de decisión — plan de implementación

> **For Hermes Agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar la superficie única "Análisis para decidir" de `docs/superpowers/specs/2026-08-25-agt002-analisis-para-decidir.md` sobre el código `aa0c66c2`: una capa server-owned de materialidad (7 categorías → 5 ejes), una derivación pura por eje sobre el `decision_review` ya existente, selectores y componente React con cuatro estados visibles exactos, una sola CTA primaria, drawer accesible y `TenderGoNoGoDecisionPanel` embebido — todo detrás del flag `AGT002_DECISION_AXIS_SURFACE` apagado por defecto, sin migración, sin deploy y sin que ninguna capa decida GO/NO-GO.

**Architecture:** La materialidad sigue siendo catálogo cerrado en servidor: `agt002-pre-go-analysis.js` exporta su política por requisito y `agt002-decision-axis-policy.js` (nuevo, puro) la mapea a los 5 ejes validando en carga contra las 7 categorías materiales y las 8 ordinarias. `agt002-decision-axis-analysis.js` (nuevo, puro) deriva `deriveAgt002DecisionAnalysis(currentAnalysis, result, questionResponses)` a partir del `decision_review` ya derivado por `presentCurrentTenderAnalysis` (rama curada Manizales primero, genérica después), sin mutarlo: reclasifica ordinarios a `preparation`, agrupa sólo materiales por eje, calcula estado global y estado por eje fail-closed. `presentCurrentTenderAnalysis` adjunta el resultado como `decision_axis_analysis` server-derived (y descarta cualquier valor forjado en `result`), igual que ya hace con `decision_review`. El front no reimplementa clasificación: `src/tenders/tenderDecisionAxisSurface.ts` proyecta esa salida a la vista (etiquetas, precedencia de CTA, unión con `question_responses`) y `TenderDecisionAxisSurface.tsx` la renderiza como superficie única en la sección `#tender-decision`, con `TenderGoNoGoDecisionPanel` como barra final. El flag vive en `agt002-analysis-config.js` y viaja al front como literal del servidor en el payload de `/api/tender-documents`.

**Tech Stack:** Node.js ESM + `node --test`, React 18 + TypeScript + Vite, esbuild + `react-dom/server` para pruebas de componentes (`tests/helpers/bundle-react-component.mjs`), CSS propio por componente, paridad byte a byte `server/index.js` ≡ `api/[...path].js`.

**Autoridad y entradas de lectura obligatoria:**
- `docs/superpowers/specs/2026-08-25-agt002-analisis-para-decidir.md` (spec aprobada; manda sobre este plan).
- Código base `aa0c66c2`: `agt002-generic-decision-review.js`, `agt002-pre-go-analysis.js:86-130`, `tender-analysis-foundation.js:326-375`, `src/tenders/tenderDecisionSurface.ts`, `src/tenders/tenderDecisionBriefModel.ts:62-94`, `src/tenders/tenderIntegralAnalysisPresentation.ts:149-164`, `src/tenders/components/TenderGoNoGoDecisionPanel.tsx`, `src/tenders/components/TenderQuestionResponseCard.tsx`, `src/main.tsx:839-843,1092-1100`.

---

## Restricciones globales (no negociables)

- **G1 — Sin commits.** Ningún corte termina en `git commit`. Cada corte termina en *checkpoint*: suites verdes + `git diff --stat` + `git diff` revisado. Commit, push, PR y merge requieren autorización humana separada.
- **G2 — Sin gates productivos.** Nada de migración, seed, DB remota, deploy, activación de flag en ningún ambiente, corrida con proveedor real ni edición de `CURRENT.md`.
- **G3 — Wire schema del modelo intacto.** Ni `agt002-integral-analysis-v3` ni ningún contrato de entrada acepta materialidad, eje o clasificación. Todo lo nuevo es server-derived y se descarta si llega en el `result` del modelo.
- **G4 — Fail-closed.** Ante duda: `paused` / `No evaluado` / `Por confirmar`. Nunca `Favorable con evidencia`, nunca `ordinary` por omisión, nunca "Sin impedimentos".
- **G5 — `decision_question` ≠ impedimento.** Ningún copy, chip, `aria-label`, CSS class visible ni test llama "impedimento" a una pregunta sin confirmar: "pregunta material pendiente" o "por confirmar".
- **G6 — Paridad backend.** `server/index.js` y `api/[...path].js` quedan byte-idénticos (`npm run check:backend-parity`).
- **G7 — Sin mutación.** `decision_review`, `integral_analysis` y `question_responses` se leen; nunca se mutan ni se persisten desde esta capa.
- **G8 — Flag apagado.** `AGT002_DECISION_AXIS_SURFACE` sólo se activa dentro del proceso de una prueba/QA local; jamás se escribe en `.env.local` compartido ni se exporta a un ambiente.

**Nota de alcance verificada en código (leer antes de B3):** en `aa0c66c2`, `deriveAgt002GenericDecisionReview` ya preserva `requirement_id` (línea 153), ya deja `evidence_refs` como `manifest_requirement` sin transformar (líneas 157-160) y ya mantiene `counts.blockers` en 0 con el bucket `blocker` vacío (líneas 174-184, 210). La corrección de §4 de la spec es, por su propio §4.4, **aguas abajo**: el módulo no cambia de comportamiento y B3 lo bloquea con pruebas de caracterización. Si alguna aserción de B3 falla contra el código real, aplica el GREEN mínimo en el módulo antes de seguir.

---

## Corte A — Política server-owned de materialidad y ejes

**Entrada:** catálogos `AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES` (7) y `AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES` (8) de `agt002-pre-go-analysis.js`; `GOVERNED_REQUIREMENT_MATERIAL_POLICY` (4 requisitos hoy).
**Salida:** `agt002-decision-axis-policy.js` + `resolveAgt002RequirementMaterialPolicy` exportado.
**Exit criteria:** el mapa cubre exactamente las 7 materiales, ninguna de las 8 ordinarias, un desalineamiento rompe la carga del módulo y un `requirement_id` desconocido sigue lanzando.

- [ ] **A1 (RED)** — Crear `tests/agt002-decision-axis-policy.test.mjs` que importe de `../agt002-decision-axis-policy.js`: `AGT002_DECISION_AXES`, `AGT002_MATERIAL_CATEGORY_TO_AXIS`, `assertAgt002MaterialCategoryAxisCoverage`; y de `../agt002-pre-go-analysis.js`: `resolveAgt002RequirementMaterialPolicy`. Aserciones: `AGT002_DECISION_AXES` es exactamente `['legal','experiencia_financiera','imposibilidad_tecnica_grave','plazo','viabilidad_economica']` y está congelado; `Object.keys(AGT002_MATERIAL_CATEGORY_TO_AXIS).sort()` es igual a `[...AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES].sort()`; ninguna clave pertenece a las 8 ordinarias; todo valor del mapa pertenece a `AGT002_DECISION_AXES`.
- [ ] **A2 (verificar fallo)** — `node --test tests/agt002-decision-axis-policy.test.mjs` debe fallar por módulo inexistente / export ausente. Registrar el mensaje de fallo en el cuaderno de ejecución.
- [ ] **A3 (GREEN mínimo)** — En `agt002-pre-go-analysis.js`, tras `requirementMaterialPolicy` (línea 120-130), añadir el export delgado sin tocar la función privada ni su uso interno de la línea 311:
  ```js
  /** Única fuente de verdad de materialidad por requisito gobernado (fail-closed: lanza si no está clasificado). */
  export function resolveAgt002RequirementMaterialPolicy(requirementId) {
    return requirementMaterialPolicy(requirementId);
  }
  ```
- [ ] **A4 (GREEN mínimo)** — Crear `agt002-decision-axis-policy.js` (puro, sin I/O) con `AGT002_DECISION_AXES`, `AGT002_MATERIAL_CATEGORY_TO_AXIS` (los 7 pares del §6 de la spec), la función exportada `assertAgt002MaterialCategoryAxisCoverage(materialCategories, ordinaryCategories, map, axes)` que lanza con mensaje explícito ante cobertura incompleta/sobrante/eje desconocido, y su invocación **en el cuerpo del módulo** (carga) con los catálogos reales importados de `./agt002-pre-go-analysis.js`. Verificar: `node --test tests/agt002-decision-axis-policy.test.mjs` verde.
- [ ] **A5 (RED)** — Añadir al mismo test: `assertAgt002MaterialCategoryAxisCoverage(['inhabilidad_incompatibilidad','categoria_nueva'], [...], {inhabilidad_incompatibilidad:'legal'}, AGT002_DECISION_AXES)` lanza con `/categoria_nueva/`; un mapa con clave ordinaria (`garantias_polizas_emitir_modificar`) lanza; un valor de eje inexistente (`'otro_eje'`) lanza. Verificar fallo, luego completar el GREEN en `assertAgt002MaterialCategoryAxisCoverage` hasta verde.
- [ ] **A6 (RED→GREEN)** — Añadir al test: `resolveAgt002RequirementMaterialPolicy('financial-working-capital')` devuelve `{ materiality: 'material', category: 'capacidad_financiera_insuficiente' }`; `'legal-rce-policy'` devuelve `ordinary`/`garantias_polizas_emitir_modificar`; `resolveAgt002RequirementMaterialPolicy('requisito-sha256-inexistente')` lanza con `/fail-closed/`. Verificar fallo antes de A3 si se ejecuta fuera de orden; con A3 aplicado, verde.
- [ ] **A7 (checkpoint)** — `node --test tests/agt002-decision-axis-policy.test.mjs tests/agt002-pre-go-analysis.test.mjs tests/agt002-manizales-exercise-decision-review.test.mjs` verde. Revisar `git diff` (debe tocar sólo `agt002-pre-go-analysis.js`, el módulo nuevo y el test nuevo). **Sin commit.**

---

## Corte B — Corrección/proyección backend y derivación por eje

**Entrada:** `currentAnalysis` tipado + `result` con `integral_analysis` y `evidence_coverage`; `questionResponses` opcional.
**Salida:** `agt002-decision-axis-analysis.js` con `deriveAgt002DecisionAnalysis`; invariantes de `agt002-generic-decision-review.js` bloqueadas; `decision_axis_analysis` adjunto server-derived en `presentCurrentTenderAnalysis`.
**Exit criteria:** sólo material alimenta ejes; ordinary → `preparation`; genérico nunca auto-crea blocker; `evidence_refs` intactos; cobertura `decision_ready:false` o política no clasificable → `paused` con motivo.

- [ ] **B1 (LOCK, sin cambio de comportamiento)** — Crear `tests/agt002-generic-decision-review-materiality.test.mjs` importando `deriveAgt002GenericDecisionReview` de `../agt002-generic-decision-review.js`, con el fixture de `tests/agt002-generic-decision-review-presentation.test.mjs:6-93` (unidad `legal-collective-life-policy`, `blocking.effect:'undetermined'`, falta crítica). Aserciones §4: (a) el finding conserva `requirement_id` verbatim; (b) `evidence_refs` es exactamente `[{type:'manifest_requirement', requirement_id}]` y está congelado; (c) con una unidad cuyo `blocking.effect==='blocker'`, `blockers` sigue vacío y `counts.blockers === 0` (la vía genérica nunca confirma un impedimento); (d) una unidad con `material_impediment_category`/`axis` inyectados por el modelo produce un finding **sin** esas claves. Ejecutar `node --test tests/agt002-generic-decision-review-materiality.test.mjs`: si alguna falla, aplicar el GREEN mínimo en el módulo; si pasan, añadir en `agt002-generic-decision-review.js` (encabezado, líneas 1-6) el bloque de comentario que declara estos cuatro invariantes y remite a §4 de la spec.
- [ ] **B2 (RED)** — Crear `tests/agt002-decision-axis-analysis.test.mjs` con tres fixtures derivados del anterior: `MATERIAL_UNIT` (`requirement_id:'financial-working-capital'`, `decision_question`), `ORDINARY_UNIT` (`legal-collective-life-policy`), `UNKNOWN_UNIT` (`requirement_id:'req-sin-politica'`), más `COVERAGE_READY` y `COVERAGE_PAUSED` copiados de la forma real de `tests/agt002-bogota-ui-regressions.test.mjs:54-72`. Importar `deriveAgt002DecisionAnalysis` de `../agt002-decision-axis-analysis.js` y asertar:
  1. las 5 claves de `axes` existen siempre, cada una con `state` ∈ los cuatro rótulos exactos;
  2. `MATERIAL_UNIT` cae en `axes.experiencia_financiera` con `material_impediment_category:'capacidad_financiera_insuficiente'`, `state:'Por confirmar'`, y los otros 4 ejes en `'No evaluado'`;
  3. `ORDINARY_UNIT` no aparece en ningún eje, aparece en `preparation`, y el `decision_review` de entrada queda intacto (`assert.deepEqual` contra una copia previa);
  4. `UNKNOWN_UNIT` ⇒ `global_state:'paused'`, `paused_reason:'material_policy_unclassified'`, los 5 ejes en `'No evaluado'`;
  5. `COVERAGE_PAUSED` ⇒ `global_state:'paused'`, `paused_reason:'coverage_not_decision_ready'`, 5 ejes `'No evaluado'`, evaluado **antes** que la materialidad;
  6. sin `decision_review` elegible (`currentAnalysis` no canónico) ⇒ `paused` / `no_decision_review`;
  7. un finding `supported` material con `evidence_refs` no vacío y cobertura lista ⇒ `'Favorable con evidencia'`; el mismo con `evidence_refs: []` ⇒ `'Por confirmar'`;
  8. un eje con bucket vacío y cobertura lista ⇒ `'No evaluado'` (nunca favorable);
  9. `evidence_refs` de cada finding proyectado es idéntico (`assert.deepEqual`) al del `decision_review` de origen;
  10. una `questionResponse` `status:'resolved'` sobre un `decision_question` material se adjunta en `finding.question_responses` y el eje sigue en `'Por confirmar'`.
- [ ] **B3 (verificar fallo)** — `node --test tests/agt002-decision-axis-analysis.test.mjs` falla por módulo inexistente. Registrar el fallo.
- [ ] **B4 (GREEN mínimo)** — Crear `agt002-decision-axis-analysis.js` (puro, sin I/O), importando `deriveAgt002GenericDecisionReview`, la política de A3/A4 y nada más. Contrato de salida congelado:
  ```js
  export const AGT002_DECISION_ANALYSIS_CONTRACT_VERSION = 'agt002-decision-axis-analysis@1';
  // { contract_version, global_state:'paused'|'ready_for_human_review', paused_reason:string|null,
  //   coverage:{ decision_ready, total_source_units, dispositioned_source_units, unresolved_source_units },
  //   axes:{ [axis]: { axis, state, findings:[...], counts:{blocker,decision_question,supported} } },
  //   preparation:[...], counts:{ material_findings, ordinary_reclassified } }
  ```
  Orden de evaluación obligatorio: `decision_review` ausente → `no_decision_review`; cobertura no lista → `coverage_not_decision_ready`; `resolveAgt002RequirementMaterialPolicy` lanza para cualquier hallazgo de `blockers`/`decision_questions`/`supported` → `material_policy_unclassified` (try/catch alrededor de la resolución, nunca por defecto `ordinary`); sólo entonces agrupar. Estado por eje con la precedencia §9 (peor gana). Cobertura leída de `result.evidence_coverage`: si existe `tender_semantic_manifest` manda él (`decision_ready===true` + `recommendation:'ready_for_human_review'` + coberturas completas), si no manda `tender_requirement_inventory.decision_ready===true`; ausencia o forma no gobernada ⇒ `false`. Verificar `node --test tests/agt002-decision-axis-analysis.test.mjs` verde.
- [ ] **B5 (RED→GREEN, paridad de cobertura)** — Añadir en el mismo test un bloque que bundlee `src/tenders/tenderIntegralAnalysisPresentation.ts` con `bundleReactModule` (helper `tests/helpers/bundle-react-component.mjs`) y asegure que, para las 5 formas de cobertura del fixture (`READY_INVENTORY`, `PAUSED_INVENTORY`, `READY_MANIFEST`, manifiesto pausado, cobertura ausente), la lectura JS de B4 y `tenderAnalysisCoverageReady` devuelven el mismo booleano. Verificar fallo si difieren y ajustar el módulo JS (nunca el gate TS existente) hasta verde.
- [ ] **B6 (RED)** — Añadir a `tests/agt002-generic-decision-review-presentation.test.mjs`: `presentCurrentTenderAnalysis(bogotaCurrentAnalysis())` expone `decision_axis_analysis` con `contract_version` y 5 ejes; un `result.decision_axis_analysis` forjado por el modelo es descartado y sustituido por la derivación server-owned; `presented.integral_analysis` sigue siendo la misma referencia (sin mutación). Verificar fallo.
- [ ] **B7 (GREEN mínimo)** — En `tender-analysis-foundation.js`: importar `deriveAgt002DecisionAnalysis`; añadir `decision_axis_analysis: _forgedDecisionAxisAnalysis` al destructuring de descarte de la línea 353; tras calcular `decisionReview` (línea 358), derivar `const decisionAxisAnalysis = deriveAgt002DecisionAnalysis(currentAnalysis, result, [])` pasando el `decisionReview` ya resuelto como override, y adjuntarlo con el mismo patrón condicional de la línea 373. La derivación nunca lanza hacia afuera: envolver en `try/catch` que registre `agt002_decision_axis_analysis_failed` y omita la clave (fail-closed, igual que el gate curado de las líneas 338-341). Verificar `node --test tests/agt002-generic-decision-review-presentation.test.mjs tests/agt002-manizales-decision-review-presentation.test.mjs` verde.
- [ ] **B8 (checkpoint)** — `node --test tests/agt002-decision-axis-analysis.test.mjs tests/agt002-generic-decision-review-materiality.test.mjs tests/agt002-generic-decision-review-presentation.test.mjs tests/agt002-manizales-decision-review-presentation.test.mjs tests/tender-decision-surface.test.mjs` verde. `git diff` revisado. **Sin commit.**

---

## Corte C — Tipos y selectores frontend puros

**Entrada:** `analysis.decision_axis_analysis`, `analysis.decision_review`, `questionResponses`, decisión GO/NO GO vigente.
**Salida:** tipos en `src/tenders/types.ts` + `src/tenders/tenderDecisionAxisSurface.ts`.
**Exit criteria:** 5 ejes, 4 estados exactos, precedencia de estado global y de CTA única, `question_responses` como contexto y nunca como evidencia.

- [ ] **C1 (RED)** — Crear `tests/agt002-decision-axis-surface-selectors.test.mjs` (patrón `bundleReactModule('src/tenders/tenderDecisionAxisSurface.ts')` de `tests/tender-decision-front-render.test.mjs:665`) y asertar sobre `tenderDecisionAxisViews`, `tenderDecisionSurfaceState`, `tenderDecisionPrimaryCta`, `tenderDecisionCoverageCopy` y `AGT002_DECISION_AXIS_LABELS`:
  1. `tenderDecisionAxisViews` devuelve siempre 5 vistas, en el orden de `AGT002_DECISION_AXES`, con `label` humano y `state` ∈ `['Favorable con evidencia','Impedimento material','Por confirmar','No evaluado']`;
  2. sin `decision_axis_analysis` (corrida histórica) ⇒ 5 ejes `'No evaluado'` y estado global `'paused'`;
  3. `tenderDecisionSurfaceState` devuelve `'post_go'` sólo con `decision.decision==='go'` y `decision.analysis_run_id === analysis.run_id`; un `no_go` registrado devuelve `'ready_for_human_review'` de sólo lectura (`readOnly: true`);
  4. `tenderDecisionPrimaryCta` devuelve exactamente una CTA: `paused` ⇒ `{ id:'coverage', href:'#tender-technical-analysis' }` sin acción decisoria; algún eje `'Por confirmar'` ⇒ `{ id:'resolve_question', findingId }` con el hallazgo material de mayor prioridad (orden: eje de `AGT002_DECISION_AXES`, luego orden del bucket); sin ejes por confirmar ⇒ `{ id:'record_decision' }`; `post_go` ⇒ `{ id:'open_help_desk', sectionId:'tender-preparation' }`;
  5. `tenderDecisionCoverageCopy({total_source_units:11345, dispositioned_source_units:8})` devuelve exactamente `'Análisis pausado — cobertura parcial (8 de 11.345 resueltas; 11.337 sin resolver)'` (formato `Intl.NumberFormat('es-CO')`);
  6. una `question_response` `resolved` sobre un hallazgo material no cambia `state` ni el conteo del eje, y su texto no aparece como `evidence`: la vista expone `responses` y `evidence` como campos separados y `evidence` proviene sólo de `resolveFindingEvidence`;
  7. ninguna cadena exportada por el módulo contiene `'impedimento'` asociada a `decision_question`: el rótulo de esos hallazgos es `'pregunta material pendiente'`.
- [ ] **C2 (verificar fallo)** — `node --test tests/agt002-decision-axis-surface-selectors.test.mjs` falla por módulo/tipos inexistentes.
- [ ] **C3 (GREEN mínimo — tipos)** — En `src/tenders/types.ts`: añadir `TenderDecisionAxisId`, `TenderDecisionAxisState` (unión literal de los 4 rótulos), `TenderDecisionAxisFinding` (extiende `TenderDecisionReviewFinding` con `material_impediment_category: string` y `question_responses: TenderQuestionResponse[]`), `TenderDecisionAxisBucket`, `TenderDecisionAxisAnalysis`; añadir `decision_axis_analysis?: TenderDecisionAxisAnalysis | null;` a `TenderDocumentAnalysis` (junto a `decision_review`, línea 531) y `decision_axis_surface_enabled?: boolean;` a `TenderDocumentsPayload` (línea 572-578).
- [ ] **C4 (GREEN mínimo — selectores)** — Crear `src/tenders/tenderDecisionAxisSurface.ts` puro: reutiliza `latestQuestionResponse` de `./tenderDecisionSurface`, `resolveFindingEvidence` de `./tenderDecisionBriefModel` y `tenderAnalysisCoverageReady` de `./tenderIntegralAnalysisPresentation` (segundo cinturón de cobertura en el front); nunca reimplementa materialidad ni ejes. Etiquetas: `legal:'Legal'`, `experiencia_financiera:'Experiencia y capacidad financiera'`, `imposibilidad_tecnica_grave:'Imposibilidad técnica grave'`, `plazo:'Plazo'`, `viabilidad_economica:'Viabilidad económica'`. Verificar test verde.
- [ ] **C5 (checkpoint)** — `node --test tests/agt002-decision-axis-surface-selectors.test.mjs tests/tender-decision-front-render.test.mjs` + `npx tsc --noEmit` verdes. `git diff` revisado. **Sin commit.**

---

## Corte D — Superficie React única, CSS responsive/a11y y drawer

**Entrada:** props `analysis`, `questionResponses`, `decisionState`, handlers de guardado y decisión.
**Salida:** `src/tenders/components/TenderDecisionAxisSurface.tsx` + `src/tenders/components/tender-decision-axis-surface.css`.
**Exit criteria:** 5 chips accesibles, tabla de escritorio y `dl` móvil, drawer con trampa de foco, `TenderGoNoGoDecisionPanel` embebido y **una** CTA primaria.

- [ ] **D1 (RED)** — Crear `tests/agt002-decision-axis-surface-ui.test.mjs` con `loadReactComponent('src/tenders/components/TenderDecisionAxisSurface.tsx','TenderDecisionAxisSurface')` + `renderReactComponent`, sobre el fixture pausado (Bogotá) y el fixture listo (1 eje `Por confirmar`, 1 eje `Favorable con evidencia`). Aserciones sobre el HTML real:
  1. aparecen los 5 chips como `<button ... aria-pressed=` con el nombre del eje, el rótulo del estado y el conteo **en texto**;
  2. un eje `No evaluado` se anuncia con su texto completo y no comparte clase de estado con `Favorable con evidencia`;
  3. existe exactamente un elemento con `class="tender-decision-axis-cta"` (una sola CTA primaria) y su rótulo corresponde a la precedencia de C1.4;
  4. la tabla de escritorio trae `<caption>` y `<th scope="col">` para Exigencia/Evidencia/Cruce/Efecto/Acción; la lista móvil trae `<dl>` con los mismos `<dt>`;
  5. el banner de estado global es `aria-live="polite"`;
  6. en el fixture pausado aparece el copy exacto de cobertura de C1.5 y **no** aparece `Sin impedimentos`, ni ningún eje favorable;
  7. la cadena `impediment`/`impedimento` no aparece en la fila de un `decision_question` (usa "pregunta material pendiente");
  8. la barra final contiene el enlace a Mesa de ayuda y el punto de entrada al panel formal, nunca dos botones primarios.
- [ ] **D2 (verificar fallo)** — `node --test tests/agt002-decision-axis-surface-ui.test.mjs` falla por componente inexistente.
- [ ] **D3 (GREEN mínimo — superficie)** — Crear `TenderDecisionAxisSurface.tsx` con `import './tender-decision-axis-surface.css';` y props:
  ```tsx
  type TenderDecisionAxisSurfaceProps = {
    opportunityId: string; opportunityName: string;
    analysis: TenderDocumentAnalysis | null;
    questionResponses: TenderQuestionResponse[];
    currentProfile: TenderCurrentProfile | null | undefined;
    request: TenderRequest;
    canAnswerQuestions: boolean;
    onSaveQuestionResponse?: (input: TenderQuestionResponseInput, files: File[]) => Promise<void>;
    onDecisionChanged: () => Promise<void> | void;
    onDecisionNavigationStateChanged?: (state: TenderPanelState<TenderGoNoGoDecision | null>) => void;
    decisionState: TenderPanelState<TenderGoNoGoDecision | null>;
    onOpenHelpDesk: () => void;
  };
  ```
  Render: cabecera con título "Análisis para decidir", subtítulo "Vig-IA analiza y agrupa; la decisión GO/NO-GO permanece humana." y badge de cobertura; banner `aria-live="polite"`; fila de 5 chips `<button type="button" aria-pressed>`; detalle del eje seleccionado (tabla de escritorio + lista `dl` móvil, ambas en el DOM y alternadas por CSS); barra final con enlace a Mesa de ayuda (`onOpenHelpDesk`), `TenderGoNoGoDecisionPanel` embebido y la única CTA primaria como **último** elemento tabulable de la sección. Toda la lógica de estado/CTA viene de C4; el componente no calcula estados.
- [ ] **D4 (GREEN mínimo — drawer)** — En el mismo archivo, `TenderDecisionAxisDrawer`: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `initialFocusRef`/`previouslyFocusedRef`, manejo de `Tab` y `Escape`, restauración de foco al chip que lo abrió — mismo patrón que `TenderGoNoGoDecisionPanel.tsx:39-40,101-140,254-255`. Contenido: título, resumen, `missing`, `action_required`, lista completa de evidencias vía `resolveFindingEvidence(finding, analysis.decision_review?.review_findings ?? [])`, e historial/acción de respuesta reutilizando `QuestionResponseCard` de `./TenderQuestionResponseCard` (props `question`, `analysisRunId`, `responses`, `canAnswer`, `disabled`, `onSave`), construyendo `NormalizedQuestion` con `decisionCopy` a partir de la vista del hallazgo. Sin nueva migración ni nueva RPC.
- [ ] **D5 (GREEN mínimo — CSS)** — Crear `tender-decision-axis-surface.css`: `grid-template-columns` propio para los `dl` de la superficie (no heredar `dl{grid-template-columns:150px minmax(0,1fr)}` de `src/styles.css`), `min-width:0` y `overflow-wrap:anywhere` en celdas, `.tender-decision-axis-table{display:none}` con `@media (min-width:1120px){...display:table}` y `.tender-decision-axis-cards{display:grid}` con `@media (min-width:1120px){...display:none}`, CTA sticky inferior en `@media (max-width:640px)`, foco visible en chips y drawer, estados diferenciados por texto + forma (no sólo color) y contraste legible para `No evaluado`.
- [ ] **D6 (RED→GREEN — a11y del drawer)** — Añadir a `tests/agt002-decision-axis-surface-ui.test.mjs` aserciones estáticas sobre el fuente del componente (patrón `tests/agt002-historical-technical-backup.test.mjs`): existe `role="dialog"`, `aria-modal="true"`, manejo de `event.key === 'Escape'`, y restauración de foco con `previouslyFocusedRef`; y sobre el CSS: existe `grid-template-columns` propio dentro de una regla de la superficie y no hay `display:none` acompañado de `aria-hidden` en el contenido alternativo. Verificar fallo y completar.
- [ ] **D7 (checkpoint)** — `node --test tests/agt002-decision-axis-surface-ui.test.mjs tests/agt002-decision-axis-surface-selectors.test.mjs` + `npx tsc --noEmit` verdes. `git diff` revisado. **Sin commit.**

---

## Corte E — Integración, navegación y flag `AGT002_DECISION_AXIS_SURFACE`

**Entrada:** flag de entorno; payload de `/api/tender-documents`.
**Salida:** flag en `agt002-analysis-config.js`, literal en el payload (ambos backends byte-idénticos), montaje en `src/main.tsx`, supresión de vistas competidoras.
**Exit criteria:** flag apagado ⇒ front idéntico a hoy; flag encendido ⇒ la superficie es la única lectura de decisión y `TenderGoNoGoDecisionPanel` sólo se abre desde su barra final.

- [ ] **E1 (RED)** — Añadir a `tests/agt002-analysis-config.test.mjs`: `buildAgt002AnalysisConfig({})` ⇒ `AGT002_DECISION_AXIS_SURFACE:false`; `{'AGT002_DECISION_AXIS_SURFACE':'true'}` ⇒ `true`; `'1'`, `'TRUE'`, `' true '`, `'yes'`, `undefined` ⇒ `false` (sólo el literal exacto activa, §17/AC22); el flag **no** exige otras banderas (es presentación pura, no altera el motor). Verificar fallo.
- [ ] **E2 (GREEN mínimo)** — En `agt002-analysis-config.js`: añadir `'AGT002_DECISION_AXIS_SURFACE'` a `ANALYSIS_FLAG_NAMES` y un `parseStrictTrueLiteral(rawValue) { return rawValue === 'true'; }` aplicado sólo a esta bandera dentro del bucle, con comentario que explique por qué es más estricta que `TRUE_LITERALS`. Verificar `node --test tests/agt002-analysis-config.test.mjs tests/agt002-analysis-config-wiring.test.mjs` verde.
- [ ] **E3 (RED→GREEN — proyección al front)** — En `tests/tender-dossier-api.test.mjs` (o un test nuevo `tests/agt002-decision-axis-surface-integration.test.mjs` si resulta más limpio) asertar por fuente que ambos backends proyectan `decision_axis_surface_enabled: agt002AnalysisConfig.AGT002_DECISION_AXIS_SURFACE === true` en el objeto de retorno del payload documental (`api/[...path].js:2767-2774` y su gemelo `server/index.js`), y que el valor jamás proviene del cliente ni de la BD. Verificar fallo; aplicar el mismo cambio literal en los dos archivos; `npm run check:backend-parity` verde.
- [ ] **E4 (RED)** — Crear/extender `tests/agt002-decision-axis-surface-integration.test.mjs` con aserciones estáticas sobre `src/main.tsx`, `src/tenders/components/TenderAnalysisSection.tsx` y `src/tenders/components/TenderDecisionAxisSurface.tsx`:
  1. `#tender-decision` renderiza `TenderDecisionAxisSurface` **sólo** cuando el flag está activo, y `TenderDecisionBrief` + `TenderGoNoGoDecisionPanel` en su ubicación actual cuando no lo está;
  2. con el flag activo, `TenderGoNoGoDecisionPanel` aparece exactamente una vez en el árbol y su único punto de montaje es la superficie;
  3. `TenderAnalysisSection` recibe `decisionSurfaceElsewhere` y, cuando es `true`, no renderiza condiciones/impedimentos/preguntas/aspectos/preparación (pero sí conserva los controles de corrida, el estado de procesamiento y el respaldo técnico V3);
  4. `TenderDocumentReviewPanel` propaga el literal del payload hacia arriba (`onDecisionSurfaceFlagChanged`) y el saver de respuestas (`onQuestionResponseSaverReady`) sin duplicar `createTenderQuestionResponseActions`;
  5. con el flag apagado, ninguna de las cadenas nuevas de la superficie aparece en el render (compatibilidad histórica).
- [ ] **E5 (verificar fallo)** — `node --test tests/agt002-decision-axis-surface-integration.test.mjs` falla.
- [ ] **E6 (GREEN mínimo)** — Implementar el cableado: estado `decisionAxisSurfaceEnabled` y `questionResponseSaver` en el contenedor de detalle de `src/main.tsx` (junto a `tenderQuestionResponses`, líneas ~839-843); montaje condicional en `#tender-decision`; `onOpenHelpDesk={() => focusTenderDetailSection(document.getElementById('tender-preparation'))}` reutilizando el helper exportado de `TenderDetailNavigation.tsx:90`; nuevos props opcionales en `TenderDocumentReviewPanel` y `TenderAnalysisSection` (`decisionSurfaceElsewhere`, por defecto `false`, de modo que el comportamiento con flag apagado sea idéntico). Verificar test verde.
- [ ] **E7 (checkpoint)** — `node --test tests/agt002-decision-axis-surface-integration.test.mjs tests/tender-decision-front-render.test.mjs tests/tender-question-responses.test.mjs tests/agt002-tender-specific-inventory-integration.test.mjs` + `npm run check:backend-parity` verdes. `git diff` revisado. **Sin commit.**

---

## Corte F — Verificación, regresiones y QA visual

**Exit criteria:** suites unitarias y de backend verdes, typecheck/build verdes, Bogotá y Manizales sin regresión, evidencia visual capturada y revisada por un agente independiente.

- [ ] **F1 (suites del bloque)** — `node --test tests/agt002-decision-axis-policy.test.mjs tests/agt002-decision-axis-analysis.test.mjs tests/agt002-generic-decision-review-materiality.test.mjs tests/agt002-decision-axis-surface-selectors.test.mjs tests/agt002-decision-axis-surface-ui.test.mjs tests/agt002-decision-axis-surface-integration.test.mjs`. Todas verdes; pegar la salida en `docs/verification/2026-08-25-agt002-decision-axis-surface.md` (crear).
- [ ] **F2 (regresión Bogotá)** — `node --test tests/agt002-bogota-ui-regressions.test.mjs tests/agt002-historical-technical-backup.test.mjs`. Además, añadir en `tests/agt002-decision-axis-analysis.test.mjs` el caso Bogotá literal de §12/AC11 (`analyzed_coverage.total_source_units: 11345`, `dispositioned_source_units: 8`, `decision_ready:false`) y asertar: `global_state:'paused'`, 5 ejes `'No evaluado'`, copy exacto `'Análisis pausado — cobertura parcial (8 de 11.345 resueltas; 11.337 sin resolver)'`, y ausencia total de `Favorable con evidencia`. RED antes que GREEN si el copy aún no existe.
- [ ] **F3 (regresión Manizales)** — `node --test tests/agt002-manizales-decision-review-presentation.test.mjs tests/agt002-manizales-exercise-decision-review.test.mjs tests/agt002-manizales-unresolved-visibility.test.mjs tests/agt002-manizales-v3-local-run.integration.test.mjs`. Verificar que la rama curada sigue evaluándose primero y que ninguna otra oportunidad puede activarla (AC24).
- [ ] **F4 (typecheck/build/paridad)** — `npx tsc --noEmit`, `npm run check:backend-parity`, `npm run build` (incluye `check:deployment-safety` + `tsc` + `vite build`) y `npm run check:siio-integration`. Todos verdes.
- [ ] **F5 (QA visual determinista)** — Crear `scripts/agt002-decision-axis-visual-qa.mjs` siguiendo `scripts/agt002-manifest-scope-visual-qa.mjs`: transpila el componente real con esbuild, renderiza con `react-dom/server` los tres escenarios (pausado Bogotá, `ready_for_human_review` con un eje `Por confirmar`, `post_go`), inlinea el CSS real, escribe HTML+PNG en `docs/verification/screenshots/agt002-decision-axis-*.{html,png}` y falla con código ≠ 0 si falta cualquiera de los cuatro rótulos, si hay más de una CTA primaria o si aparece "Sin impedimentos". Ejecutar `node scripts/agt002-decision-axis-visual-qa.mjs`.
- [ ] **F6 (QA local autenticada)** — En una terminal `npm run server` y en otra `npm run dev` con `.env.local` local y `AGT002_DECISION_AXIS_SURFACE=true` **sólo en el entorno del proceso local** (nunca escrito en un archivo compartido). Autenticarse con una cuenta local con permiso `LICITACIONES_GO_NO_GO_APPROVE`, abrir un expediente de licitación, y capturar evidencia visual de: cabecera + 5 chips, eje `Por confirmar` con su tabla, drawer abierto con evidencias y `QuestionResponseCard`, barra final con el panel GO/NO GO, y la vista móvil (≤640px). Guardar en `docs/verification/screenshots/`. Repetir el recorrido con el flag apagado y verificar que la UI es idéntica a hoy.
- [ ] **F7 (revisión independiente)** — Un agente de QA sin contexto previo revisa capturas y diff contra esta lista: (a) ningún `decision_question` rotulado "impedimento"; (b) bucket vacío nunca favorable; (c) una sola CTA primaria por estado; (d) Bogotá muestra 8/11.345 y cinco ejes `No evaluado`; (e) ningún eje derivado de texto libre o del modelo; (f) copy que reafirma autoridad humana; (g) foco y `Escape` funcionan en el drawer. Registrar veredicto pass/fail con evidencia en `docs/verification/2026-08-25-agt002-decision-axis-surface.md`.
- [ ] **F8 (checkpoint final)** — `git status` + `git diff --stat` revisados: sólo los archivos previstos en A–F. Reportar al humano el estado, la evidencia y los gates pendientes. **Sin commit, sin push, sin activación de flag.**

---

## Matriz AC → prueba

| AC (spec §19) | Prueba / tarea |
|---|---|
| 1 Nunca renderiza sin `deriveAgt002GenericDecisionReview` o el override curado | `agt002-decision-axis-analysis.test.mjs` B2.6 · B4 |
| 2 El fix preserva `requirement_id`/`evidence_refs` y no acepta clasificación del modelo | `agt002-generic-decision-review-materiality.test.mjs` B1(a)(b)(d) |
| 3 Los 5 ejes siempre presentes con uno de los 4 estados | B2.1 · C1.1 · D1.1 |
| 4 Sólo material alimenta ejes; ninguna ordinaria produce eje | B2.2 · B2.3 · A1 |
| 5 Ordinaria → `preparation` sin mutar el `decision_review` | B2.3 |
| 6 `requirement_id` sin política ⇒ `paused` con motivo | B2.4 · A6 |
| 7 `decision_ready:false` ⇒ `paused` y 5 ejes `No evaluado` | B2.5 · B5 · F2 |
| 8 Bucket vacío ⇒ `No evaluado`, nunca favorable | B2.8 · D1.6 |
| 9 `Impedimento material` sólo con blocker confirmado/curado | B1(c) · B2.1 |
| 10 Ningún copy llama "impedimento" a un `decision_question` | C1.7 · D1.7 · F7(a) |
| 11 Bogotá 8/11.345 con copy exacto y 5 ejes `No evaluado` | F2 · C1.5 · D1.6 |
| 12 Exactamente una CTA primaria por precedencia | C1.4 · D1.3 |
| 13 GO y NO GO viven dentro del panel embebido | D1.8 · E4.2 |
| 14 Con flag activo desaparecen brief/análisis/decisión paralelos | E4.1 · E4.2 · E4.3 |
| 15 `resolved` no mueve el eje; sin migración nueva | B2.10 · C1.6 · D4 |
| 16 Tras GO, CTA enlaza a Mesa de ayuda existente | C1.3 · C1.4 · E6 |
| 17 El drawer reutiliza `evidence_refs`/`question_responses` sin transformarlos | B2.9 · C1.6 · D4 |
| 18 Trampa de foco, `Escape` y restauración en drawer y panel | D6 · F7(g) |
| 19 Chips comunican estado y conteo por texto | D1.1 · D1.2 |
| 20 Móvil `dl` de una columna con `grid-template-columns` propio | D1.4 · D6 |
| 21 Ningún componente decide, aprueba, firma, envía o asigna | D3 (copy) · F7(f) |
| 22 Flag apagado por defecto; sólo el literal `true` activa | E1 · E2 |
| 23 El mapa valida en carga las 7 categorías materiales | A1 · A5 |
| 24 Ninguna oportunidad ajena activa la rama curada | F3 |
| 25 Sin migración, tabla, seed, deploy ni activación de flag | G2 · F8 |
| 26 Superficie puramente derivada, sin persistir ejes ni estados | B4 (contrato sin escritura) · B7 · F8 |

---

## Gates NO autorizados por este plan

Ninguna tarea de A–F autoriza, y ningún agente ejecutor puede realizar sin una autorización humana explícita y separada:

1. `git commit`, `git push`, apertura de PR o merge.
2. Deploy o promoción a cualquier ambiente (Vercel u otro).
3. Migración, rollback, seed, RPC nueva o cualquier escritura en base de datos (local o remota).
4. Activación del flag `AGT002_DECISION_AXIS_SURFACE` fuera del proceso local de prueba/QA — en particular su escritura en `.env.local` compartido o en variables de entorno de un ambiente.
5. Activación acotada por `opportunity_id` (§17.3) y corrida productiva o canary con proveedor real.
6. Edición de `CURRENT.md`, de runbooks de producción o de cualquier artefacto de cierre.
7. Cambios al contrato `agt002-integral-analysis-v3`, al wire schema del modelo o a `agt002-manizales-exercise-decision-review.js`.
8. Cualquier acción externa: envío de comunicaciones, firma, asignación nominal o registro automático de GO/NO-GO.

## Autorrevisión contra la spec

- **`decision_question` ≠ impedimento:** G5, C1.7, D1.7 y F7(a) lo bloquean en selectores, HTML y revisión humana; el rótulo visible es "pregunta material pendiente".
- **Blocker sólo confirmado:** B1(c) fija que la vía genérica nunca llena el bucket `blocker`; `Impedimento material` sólo puede venir de la rama curada (F3).
- **Bucket vacío no favorable:** B2.8 y D1.6; `Favorable con evidencia` exige cobertura lista + todos los materiales `supported` con `evidence_refs` no vacío (B2.7).
- **Bogotá 8/11.345:** F2 fija el copy exacto y los cinco ejes en `No evaluado`, con la pausa evaluada antes que la materialidad (B2.5).
- **Sin ejes por texto ni por el modelo:** los ejes salen sólo de `AGT002_MATERIAL_CATEGORY_TO_AXIS` sobre `resolveAgt002RequirementMaterialPolicy` (A) y cualquier `decision_axis_analysis` forjado se descarta en `presentCurrentTenderAnalysis` (B6/B7).
- **Riesgo conocido a reportar, no a ocultar:** hoy `GOVERNED_REQUIREMENT_MATERIAL_POLICY` clasifica 4 requisitos; cualquier expediente con requisitos fuera de ese catálogo cae en `paused`/`material_policy_unclassified`. Es el comportamiento fail-closed exigido por §16/AC6 y debe presentarse como tal en F7, no compensarse con una clasificación por defecto.
