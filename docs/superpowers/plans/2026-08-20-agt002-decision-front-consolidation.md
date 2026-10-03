# AGT-002 Decision Front Consolidation — Final Implementation Plan

> **Estado del documento:** FINAL POST-CLAUDE — listo para decisión humana sobre ejecución.
>
> **Gate vigente:** este documento no autoriza implementación, commit, push, merge, migración ni despliegue. La ejecución sólo comienza después de un GO explícito y debe usar `superpowers:subagent-driven-development` o `superpowers:executing-plans`, TDD y un worktree nuevo.

**Goal:** Convertir el expediente AGT-002 en una lectura frontal única, breve y accionable para que la encargada revise condiciones, adjunte soportes y registre una decisión humana con rapidez, conservando el análisis exhaustivo y su trazabilidad en el back.

**Architecture:** `decision_review` continúa siendo la proyección gobernada, fail-closed y específica del análisis técnico. El front tendrá una sola representación completa de las condiciones materiales en **Análisis**. **Decisión** será un brief compacto seguido por el panel formal de registro GO/NO GO que ya existe. V3 permanecerá al final de Análisis como respaldo técnico desplegable, con todos sus conteos dinámicos y campos gobernados, pero sin IDs o localizadores en la primera lectura.

**Tech Stack:** React 18, TypeScript, Vite, Node test runner, esbuild, `react-dom/server`, componentes y CSS existentes del módulo Licitaciones.

---

## 1. Decisiones finales de producto y arquitectura

### 1.1 Principio rector

El back conserva versiones, evidencia, manifiestos, reglas, razonamiento y trazabilidad exhaustiva. El front presenta una sola lectura visible y accionable.

La encargada debe poder responder rápidamente:

1. ¿La oportunidad está vigente?
2. ¿Tiene potencial comercial explícito?
3. ¿Existe algún impedimento confirmado?
4. ¿Qué condiciones siguen pendientes?
5. ¿Qué soporte o acción concreta se requiere?
6. ¿Dónde registra la validación y la decisión humana?

### 1.2 Distribución definitiva

#### Resumen

- Banner con una sola palabra de vigencia: **Vigente** o **Vencida**.
- Puede mostrar la fecha de cierre, pero no una segunda alerta de vencimiento.
- Datos esenciales sin duplicar Fuente oficial, Responsable o Etapa.
- `Ciudad por confirmar` cuando el dato no exista.
- Acciones jerarquizadas: seguimiento principal, editar secundaria, sacar de oportunidad como acción de riesgo con confirmación.

#### Documentos

- Inventario, carga, actualización, vigencia documental y único enlace a la fuente oficial.
- No contiene condiciones materiales, conclusiones, brief ni V3.

#### Análisis

- Única representación completa de condiciones e impedimentos materiales.
- Cada condición pendiente muestra solamente:
  - **Condición**.
  - **Estado**.
  - **Qué falta**.
  - **Acción requerida**.
- Cada impedimento confirmado aparece una sola vez y con lenguaje humano.
- La respuesta, soportes e historial humano se registran en su tarjeta correspondiente.
- Aspectos favorables/capacidad y trámites preparables aparecen resumidos por excepción, nunca como evidencia exhaustiva.
- V3 aparece al final como respaldo técnico desplegable.

#### Decisión

- Brief ejecutivo de máximo tres frases.
- Potencial comercial explícito.
- Conteo/nombre de impedimentos confirmados.
- Conteo/título de condiciones pendientes.
- `Revisar condiciones pendientes` navega a Análisis.
- `Registrar decisión humana` navega al panel GO/NO GO sin preseleccionar una decisión.
- No contiene evidencia, V3, capacidad detallada, trámites, IDs ni trazabilidad técnica.

#### Registro humano

- Permanece dentro de la sección **Decisión**, inmediatamente después del brief, mediante `TenderGoNoGoDecisionPanel`.
- No se crea una pestaña adicional.
- El panel presenta la decisión humana vigente, autor, fecha, justificación e historial.
- GO y NO GO sólo se eligen y confirman dentro del panel.
- HOLD permanece representado por ausencia de decisión y validaciones pendientes; ampliar el contrato persistido para un tercer valor queda fuera de este pase.

### 1.3 Correcciones incorporadas tras la revisión independiente

1. No generar textos V3 con `humanConclusion()`, `humanEvidenceSummary()` o `humanCommercialImpact()`.
2. Renderizar directamente campos gobernados ya existentes: `unit.title`, `unit.conclusion.summary`, `unit.commercial_impact.summary`, `unit.missing_evidence[].reason` y `unit.actions[].summary`.
3. Traducir enums sólo mediante diccionarios cerrados; un valor desconocido se presenta como `Por revisar` y el valor crudo queda en trazabilidad.
4. El estado de una condición se deriva de la respuesta humana más reciente; no queda congelado en `Pendiente de validación`.
5. Ninguna condición o impedimento desaparece cuando falta `presentation`; se muestra un fallback honesto y no el `rationale`.
6. Capacidad favorable y trámites preparables viven en Análisis.
7. Los conteos de V3 se calculan desde los arrays reales y se prueban con un segundo fixture de tamaño diferente.
8. La vigencia sólo aparece en el banner, sin “alerta crítica” duplicada.
9. Las pruebas nuevas verifican selectores y HTML renderizado; las inspecciones estáticas quedan sólo como guardas complementarias.
10. La relación V3 → condición principal usa exclusivamente igualdad explícita de `requirement_id`; nunca coincidencias de texto.

---

## 2. Restricciones no negociables

- No modificar el análisis canónico, `integral_analysis`, `manifest_scope`, `manifest_unresolved_entries` ni su evidencia almacenada.
- No eliminar trazabilidad del back.
- No mostrar en la lectura principal slugs, IDs, hashes, `evidence:chunk`, `objective_validation`, nombres de tablas, offsets ni rutas internas.
- No inferir cumplimiento, potencial, impedimentos o relación entre registros por ausencia de evidencia o coincidencias textuales.
- No duplicar una condición entre Documentos, Análisis, Decisión y V3.
- AGT-002 informa; una persona autorizada valida y decide.
- No enviar correos ni contactos externos desde AGT-002. Los soportes se solicitan y adjuntan dentro de SIIO.
- Mantener la estructura visual, colores y shell general; mejorar jerarquía, densidad, lenguaje y navegación, no rediseñar el CRM.
- Implementar sólo en un worktree nuevo creado desde `fix/agt002-decision-brief-contract` después del GO de ejecución.
- No mezclar con `feat/agt002-hermes-qa-readonly` ni con el permiso `licitaciones_lectura`.
- Producción contiene `7ad7b91`; `main` conserva un revert posterior. Nunca desplegar `main` a ciegas.
- No efectuar commit, push, merge, migración o despliegue sin la autorización correspondiente.

---

## 3. Contratos finales

### 3.1 Presentación gobernada de `decision_review`

Añadir una presentación humana opcional al tipo TypeScript para compatibilidad con ejecuciones antiguas, pero obligatoria en el fixture gobernado para cualquier entrada que se renderice en el front.

```ts
export type TenderDecisionFindingPresentation = {
  title: string;
  summary?: string;
  missing?: string;
  action_required?: string;
};

export type TenderDecisionReviewFinding = {
  // campos canónicos existentes, intactos
  presentation?: TenderDecisionFindingPresentation;
};
```

Matriz de validación del builder:

| `reviewed_status` | Campos requeridos de `presentation` | Uso frontal |
|---|---|---|
| `decision_question` | `title`, `missing`, `action_required` | Tarjeta completa y respuesta humana |
| `blocker` | `title`, `summary`, `action_required` | Impedimento confirmado |
| `supported` | `title`, `summary` | Resumen favorable/capacidad |
| `preparation` | `title`, `action_required` | Lista breve de trámites/acciones |
| `not_applicable` | Ninguno en este pase | No se renderiza en primera lectura |

Reglas:

- El builder fail-closed rechaza campos requeridos ausentes o vacíos.
- El fixture de runtime y el fixture de pruebas permanecen byte-idénticos.
- `rationale`, `evidence_refs` y campos canónicos no se cambian.
- El front nunca usa `rationale` como fallback.

### 3.2 Estado dinámico de una condición

Usar la respuesta humana más reciente por `responded_at`, no asumir que el array ya viene ordenado.

```ts
export type TenderDecisionConditionState =
  | 'Pendiente de validación'
  | 'Validación registrada'
  | 'No aplica';

export function latestQuestionResponse(
  responses: TenderQuestionResponse[],
  questionId: string,
): TenderQuestionResponse | null {
  return [...responses]
    .filter(item => item.question_id === questionId)
    .sort((a, b) => Date.parse(b.responded_at) - Date.parse(a.responded_at))[0] ?? null;
}

export function conditionState(response: TenderQuestionResponse | null): TenderDecisionConditionState {
  if (response?.status === 'resolved') return 'Validación registrada';
  if (response?.status === 'not_applicable') return 'No aplica';
  return 'Pendiente de validación';
}
```

`Validación registrada` no implica que el requisito cumpla; sólo informa que existe una conclusión humana guardada. El texto de la respuesta conserva el resultado real.

### 3.3 Fallback sin omisión silenciosa

`tenderDecisionConditions()` y `tenderDecisionBlockers()` deben conservar todas las entradas gobernadas.

Si una ejecución antigua no tiene `presentation`:

```ts
{
  title: 'Clasificación ejecutiva no disponible',
  state: 'Pendiente de validación',
  missing: 'Revisar el respaldo técnico gobernado de esta condición.',
  actionRequired: 'Completar la presentación humana antes de cerrar la validación.',
}
```

El ID interno puede conservarse como `key`/navegación, pero no se imprime. Queda prohibido:

- `flatMap(... finding.presentation ? [...] : [])`.
- Mostrar `rationale` crudo.
- Reducir el conteo porque falte copia humana.

### 3.4 Conteos dinámicos de V3

Para cada oportunidad:

```ts
const totalUnits = analysisUnits.length;
const byConclusion = countBy(analysisUnits, unit => unit.conclusion.status);
const classifiedTotal = Object.values(byConclusion).reduce((sum, count) => sum + count, 0);
```

Invariante obligatoria:

```ts
classifiedTotal === totalUnits
```

Los indicadores de evidencia son no excluyentes y se rotulan como tales:

- Con referencias citadas: `unit.evidence_refs.length > 0`.
- Con evidencia pendiente: `unit.missing_evidence.length > 0`.

Los conteos del manifiesto se mantienen separados y con etiquetas explícitas:

- Entradas atomizadas.
- Requisitos analizables.
- Unidades técnicas analizadas.
- Entradas no resueltas visibles.
- Condiciones materiales de decisión.

Los valores 25, 20, 5 y 2 son datos del piloto, nunca constantes de UI ni expectativas generales.

### 3.5 Presentación V3 sin heurísticas

Primera capa de cada unidad:

- `Requisito`: `unit.title`.
- `Estado`: traducción cerrada de `unit.conclusion.status`.
- `Conclusión`: `unit.conclusion.summary`.
- `Soporte`: conteo y tipos de fuente traducidos desde `unit.evidence_refs`.
- `Qué falta`: `unit.missing_evidence[].reason`, cuando exista.
- `Impacto comercial`: nivel traducido y `unit.commercial_impact.summary`.
- `Acción`: `unit.actions[0]?.summary`, cuando exista.

Segunda capa `Ver trazabilidad técnica`:

- `unit_id`, `requirement_id`.
- Referencias y propósitos.
- Localizadores disponibles.
- Estado de cinco ejes.
- Condición de cierre y demás metadatos técnicos.

El eje técnico `evidence_state.validity` describe la validez del soporte de una unidad; no representa la vigencia temporal de la oportunidad. Se mantiene únicamente dentro de la trazabilidad para no competir con `Vigente`/`Vencida` del banner.

La relación `Ver condición principal` sólo aparece cuando:

```ts
unit.requirement_id !== null
  && decisionFinding.requirement_id === unit.requirement_id
```

No se añade un enlace cuando no existe esa coincidencia gobernada.

---

## 4. Mapa de archivos

### Contrato y proyección

- Modify: `agt002-manizales-exercise-decision-review.js`
- Modify: `data/agt002/manizales-sa-24-2026.exercise-decision-review.v1.json`
- Modify: `tests/fixtures/agt002-manizales-exercise-decision-review.v1.json`
- Modify: `src/tenders/types.ts`
- Create: `src/tenders/tenderDecisionSurface.ts`
- Create: `src/tenders/tenderIntegralAnalysisPresentation.ts`
- Test: `tests/agt002-manizales-exercise-decision-review.test.mjs`
- Create: `tests/agt002-manizales-decision-review-presentation.test.mjs`
- Create: `tests/tender-decision-surface.test.mjs`
- Create: `tests/tender-integral-analysis-presentation.test.mjs`

### Componentes y navegación

- Modify: `src/tenders/components/TenderAnalysisSection.tsx`
- Modify: `src/tenders/components/TenderQuestionResponseCard.tsx`
- Modify: `src/tenders/components/TenderDecisionBrief.tsx`
- Modify: `src/tenders/components/TenderGoNoGoDecisionPanel.tsx`
- Create: `src/tenders/components/TenderGoNoGoDecisionSummary.tsx`
- Modify: `src/tenders/components/TenderIntegralAnalysisV3View.tsx`
- Modify: `src/tenders/components/tender-integral-analysis-v3.css`
- Modify: `src/tenders/components/TenderDocumentSection.tsx`
- Modify: `src/tenders/components/TenderDetailNavigation.tsx`
- Modify: `src/tenders/detailNavigationState.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

### Pruebas de render y regresión

- Create: `tests/helpers/bundle-react-component.mjs`
- Create: `tests/tender-decision-front-render.test.mjs`
- Create: `tests/fixtures/tender-integral-analysis-dynamic.v3.json`
- Modify: `tests/agt002-manizales-decision-review-ui.test.mjs`
- Modify: `tests/tender-decision-brief-v2.test.mjs`
- Modify: `tests/tender-decision-brief-ui.test.mjs`
- Modify: `tests/agt002-v3-real-analysis-view.test.mjs`
- Modify: `tests/tender-question-responses.test.mjs`
- Modify: `tests/tender-detail-navigation.test.mjs`
- Modify: `tests/tender-module-ui.test.mjs`
- Verify unchanged unless una expectativa legítima cambie: `tests/agt002-evidence-coverage-ui.test.mjs`
- Verify unchanged unless una expectativa legítima cambie: `tests/agt002-legal-findings-ui.test.mjs`
- Verify unchanged: `tests/tender-go-no-go-report-static.test.mjs`

---

## 5. Plan de implementación TDD

### Task 0: Preparar ejecución aislada después del GO

**Prerequisite:** autorización explícita de implementación.

- [ ] Confirmar que `fix/agt002-decision-brief-contract` sigue siendo la base aprobada.
- [ ] Comprobar `git status`, ramas y worktrees.
- [ ] Crear un worktree nuevo; no reutilizar el worktree de planificación.
- [ ] Registrar commit base y diferencia frente a producción `7ad7b91` y frente a `main`.
- [ ] No modificar producción, migraciones ni configuración remota.

### Task 1: Añadir presentación gobernada a `decision_review`

**Files:** contrato, ambos fixtures, tipos y pruebas de builder.

- [ ] Escribir pruebas RED para la matriz de `presentation` por `reviewed_status`.
- [ ] Probar rechazo de objeto ausente, campos vacíos, campos no permitidos y copia con nomenclatura técnica.
- [ ] Extender `TenderDecisionReviewFinding` sin tocar campos canónicos.
- [ ] Implementar validación fail-closed en `validateEntry()`.
- [ ] Copiar `presentation` en `toFinding()` con `Object.freeze`.
- [ ] Añadir copia humana al fixture gobernado y replicarla byte-idéntica en tests.
- [ ] Incluir copia para condiciones, impedimentos, aspectos favorables/capacidad y preparación.
- [ ] Ejecutar:

```bash
node --test \
  tests/agt002-manizales-exercise-decision-review.test.mjs \
  tests/agt002-manizales-decision-review-presentation.test.mjs
```

**Expected:** PASS; runtime y fixture de test continúan idénticos.

### Task 2: Crear selectores puros y estados dinámicos

**Files:** `tenderDecisionSurface.ts`, `tenderIntegralAnalysisPresentation.ts` y pruebas.

- [ ] Escribir RED para `latestQuestionResponse()` con respuestas desordenadas.
- [ ] Escribir RED para los tres estados visibles: pendiente, validación registrada y no aplica.
- [ ] Escribir RED que demuestre que una condición sin `presentation` sigue apareciendo.
- [ ] Escribir RED para blockers, aspectos favorables y acciones de preparación.
- [ ] Escribir RED que prohíba `rationale`, IDs y tokens técnicos en la proyección frontal.
- [ ] Implementar selectores sin mutar entradas.
- [ ] Implementar diccionarios cerrados para V3 y fallback `Por revisar`.
- [ ] Probar la invariante `classifiedTotal === totalUnits`.
- [ ] Probar el fixture del piloto y un segundo fixture con un número distinto de unidades.
- [ ] Probar que 25/20/5/2 no aparecen como constantes del selector.
- [ ] Ejecutar:

```bash
node --test \
  tests/tender-decision-surface.test.mjs \
  tests/tender-integral-analysis-presentation.test.mjs
```

**Expected:** PASS.

### Task 3: Consolidar Análisis como superficie completa

**Files:** `TenderAnalysisSection`, `TenderQuestionResponseCard`, `main.tsx`, estilos y pruebas.

- [ ] Escribir RED sobre HTML renderizado para exigir una tarjeta por cada condición y cada impedimento.
- [ ] Probar que una condición sin presentación usa fallback y no desaparece.
- [ ] Probar que cambiar la última respuesta de `pending` a `resolved` cambia el badge a `Validación registrada`.
- [ ] Extender `NormalizedQuestion` con `decisionCopy`, sin reemplazar `question.id` ni `question.text` usados al persistir.
- [ ] Mostrar sólo Condición, Estado, Qué falta y Acción requerida antes del formulario.
- [ ] Conservar respuesta vigente, adjuntos, autor, fecha e historial.
- [ ] Renombrar acciones a `Registrar validación` / `Actualizar validación`.
- [ ] Retirar `TenderFindingEvidence`, `rationale`, `Alerta material` y la frase redundante “Aún no hay respuesta humana” de la tarjeta operativa.
- [ ] Añadir bloques compactos dentro de Análisis:
  - `Aspectos favorables y capacidad` desde `review.supported[].presentation`.
  - `Acciones de preparación` desde `review.preparation[].presentation`.
- [ ] Si falta presentación en esos bloques, mostrar `Clasificación ejecutiva no disponible`; nunca `rationale`.
- [ ] Separar físicamente `#tender-document-review` y `#tender-analysis` como hermanos.
- [ ] Retirar el ID duplicado interno de `TenderAnalysisSection`.
- [ ] Ejecutar:

```bash
node --test \
  tests/agt002-manizales-decision-review-ui.test.mjs \
  tests/tender-question-responses.test.mjs \
  tests/tender-decision-front-render.test.mjs
npx tsc --noEmit
```

**Expected:** PASS.

### Task 4: Reestructurar V3 como respaldo legible y completo

**Files:** componente V3, helper de presentación, CSS, fixture dinámico y pruebas.

- [ ] Escribir RED para resumen dinámico, fases, unidades y trazabilidad de segundo nivel.
- [ ] Renderizar V3 dentro de:

```tsx
<details id="tender-technical-analysis" className="tender-integral-analysis-trace">
  <summary>Ver respaldo técnico del análisis</summary>
  <TenderIntegralAnalysisV3View analysis={analysis} />
</details>
```

- [ ] Mostrar conteos por estado de conclusión cuya suma sea igual a `analysis_units.length`.
- [ ] Mostrar indicadores no excluyentes de evidencia con rótulo explícito.
- [ ] Agrupar dinámicamente por las cinco categorías institucionales.
- [ ] Mantener visibles todas las unidades; las fases con pendientes pueden abrir inicialmente.
- [ ] Sustituir el rail con `unit_id` visible por títulos y estados humanos.
- [ ] Renderizar directamente los campos gobernados definidos en §3.5.
- [ ] Mover IDs, referencias y localizadores a `Ver trazabilidad técnica`.
- [ ] Presentar `manifest_unresolved_entries` por `label` y fase; mover `requirement_id` a trazabilidad.
- [ ] Implementar `Ver condición principal` sólo por igualdad no nula de `requirement_id`.
- [ ] No enlazar V3 desde Decisión.
- [ ] Probar con el fixture del piloto y con `tender-integral-analysis-dynamic.v3.json`.
- [ ] Probar que la primera capa no contiene `unit-`, `requirement_id`, `evidence:chunk`, `objective_validation`, `char_start` ni nombres de tablas.
- [ ] Ejecutar:

```bash
node --test \
  tests/agt002-v3-real-analysis-view.test.mjs \
  tests/tender-integral-analysis-presentation.test.mjs \
  tests/tender-decision-front-render.test.mjs
npx tsc --noEmit
```

**Expected:** PASS.

### Task 5: Reducir Decisión y fijar el Registro humano

**Files:** `TenderDecisionBrief`, `TenderGoNoGoDecisionPanel`, modelos, estilos y pruebas.

- [ ] Escribir RED sobre HTML renderizado para exigir brief compacto y ausencia de evidencia/V3/capacidad/trámites.
- [ ] Conservar potencial comercial, impedimentos y condiciones pendientes.
- [ ] Limitar la introducción a máximo tres frases en el fixture gobernado.
- [ ] Mostrar condiciones pendientes como título/conteo, no como tarjetas completas.
- [ ] Sustituir los tres atajos actuales por:

```tsx
{pendingConditions.length > 0 && (
  <button type="button" className="secondary" onClick={() => openAnchor('tender-analysis')}>
    Revisar {pendingConditions.length} condiciones pendientes
  </button>
)}
<button type="button" onClick={() => openAnchor('tender-go-no-go-actions')}>
  Registrar decisión humana
</button>
```

- [ ] No enfocar ni preseleccionar `Registrar GO` o `Registrar NO GO` desde el brief.
- [ ] Mantener `TenderGoNoGoDecisionPanel` inmediatamente debajo del brief dentro de `#tender-decision`.
- [ ] Extraer el resumen de decisión vigente a `TenderGoNoGoDecisionSummary`, componente puro que recibe `loading` y `current`; el panel conserva carga, persistencia y reconciliación.
- [ ] Mantener decisión vigente, autor, fecha, justificación, confirmación modal e historial.
- [ ] Sustituir la lista duplicada de alertas del panel por un único puntero compacto a Análisis cuando existan pendientes.
- [ ] Mantener el estado post-registro y la reconciliación idempotente existentes.
- [ ] Ejecutar:

```bash
node --test \
  tests/tender-decision-brief-v2.test.mjs \
  tests/tender-decision-brief-ui.test.mjs \
  tests/agt002-manizales-decision-review-ui.test.mjs \
  tests/tender-decision-front-render.test.mjs
npx tsc --noEmit
```

**Expected:** PASS.

### Task 6: Depurar Resumen, Documentos y navegación

**Files:** `main.tsx`, navegación, Documentos, estilos y pruebas.

- [ ] Escribir RED para una única aparición de `Vigente`/`Vencida` en el banner.
- [ ] Probar que no existe “alerta crítica” de vigencia ni repetición en Análisis/Decisión.
- [ ] Eliminar duplicados de Fuente oficial, Responsable y Etapa.
- [ ] Usar `Ciudad por confirmar` para valor ausente.
- [ ] Jerarquizar acciones de oportunidad y Documentos.
- [ ] Garantizar un único enlace de Fuente oficial en el shell.
- [ ] Observar contenedores hermanos con `IntersectionObserver`.
- [ ] Sincronizar ancla inicial, foco y `aria-current` con la sección visible.
- [ ] Ejecutar:

```bash
node --test \
  tests/tender-detail-navigation.test.mjs \
  tests/tender-module-ui.test.mjs \
  tests/tender-decision-front-render.test.mjs
npx tsc --noEmit
```

**Expected:** PASS.

### Task 7: Pruebas de render, regresión y QA visual

#### 7.1 Helper de render

Crear `tests/helpers/bundle-react-component.mjs` usando esbuild y `react-dom/server` para cargar TSX real y producir HTML estático. Las pruebas deben afirmar sobre ese HTML, no sólo buscar cadenas en el código fuente.

Casos mínimos:

1. Condición sin respuesta.
2. Condición con respuesta `pending`.
3. Condición con respuesta `resolved`.
4. Condición `not_applicable`.
5. Condición sin `presentation`.
6. Impedimento confirmado.
7. Decisión humana aún no registrada en `TenderGoNoGoDecisionSummary`.
8. GO registrado en `TenderGoNoGoDecisionSummary`.
9. NO GO registrado en `TenderGoNoGoDecisionSummary`.
10. V3 con cantidad del piloto.
11. V3 con cantidad diferente.
12. Fases vacías y fases con pendientes.

Las pruebas estáticas existentes pueden conservarse para proteger wiring, imports y anchors, pero no cuentan como evidencia principal de UX.

#### 7.2 Suite focalizada

```bash
node --test \
  tests/agt002-manizales-exercise-decision-review.test.mjs \
  tests/agt002-manizales-decision-review-presentation.test.mjs \
  tests/agt002-manizales-decision-review-ui.test.mjs \
  tests/tender-decision-surface.test.mjs \
  tests/tender-integral-analysis-presentation.test.mjs \
  tests/tender-decision-front-render.test.mjs \
  tests/tender-decision-brief-v2.test.mjs \
  tests/tender-decision-brief-ui.test.mjs \
  tests/tender-question-responses.test.mjs \
  tests/agt002-v3-real-analysis-view.test.mjs \
  tests/agt002-evidence-coverage-ui.test.mjs \
  tests/agt002-legal-findings-ui.test.mjs \
  tests/tender-go-no-go-report-static.test.mjs \
  tests/tender-detail-navigation.test.mjs \
  tests/tender-module-ui.test.mjs
```

**Expected:** todos PASS.

#### 7.3 Tipos, build y paridad

```bash
npx tsc --noEmit
npx vite build
npm run check:backend-parity
```

**Expected:** exit 0. Se usa `npx vite build` durante revisión local para no ejecutar `postbuild`.

#### 7.4 QA visual autenticada local

Capturar y revisar escritorio y móvil:

1. Resumen.
2. Documentos.
3. Análisis con condiciones pendientes.
4. Condición con validación registrada.
5. Aspectos favorables/capacidad y preparación.
6. V3 cerrado.
7. V3 abierto con todas las fases y unidades legibles.
8. Trazabilidad técnica de una unidad.
9. Decisión.
10. Registro humano pendiente.
11. Registro con decisión vigente e historial.

Verificar teclado y accesibilidad:

- Orden de tabulación lógico.
- Foco visible.
- `aria-current` correcto.
- `details/summary` operables con teclado.
- Modal GO/NO GO conserva trampa de foco, Escape y restauración de foco.
- Botones describen exactamente su efecto.
- Lectura móvil sin solapamientos ni rail inaccesible.

#### 7.5 Evidencia

Crear después de la ejecución:

- `docs/verification/2026-08-20-agt002-decision-front-consolidation.md`
- `docs/verification/screenshots/agt002-decision-front-desktop.png`
- `docs/verification/screenshots/agt002-decision-front-mobile.png`

Registrar comandos, exit codes, cantidad real de pruebas, navegador, viewport y rutas de screenshots. No declarar aprobación sin evidencia reciente.

---

## 6. Matriz final de aceptación

| Pregunta | Resultado esperado |
|---|---|
| ¿Está vigente? | Una sola palabra, `Vigente` o `Vencida`, en el banner; fecha opcional |
| ¿Hay potencial? | Razones comerciales explícitas o `Sin razones priorizadas` |
| ¿Hay impedimentos? | Conteo y nombre desde `review.blockers`; nunca inferidos |
| ¿Qué falta? | Una tarjeta por condición en Análisis |
| ¿Qué hago? | Acción requerida concreta y gobernada |
| ¿Dónde valido? | `Registrar validación` dentro de la tarjeta en Análisis |
| ¿Cambió la validación? | El estado visible se deriva de la respuesta humana más reciente |
| ¿Dónde están capacidad y trámites? | Resumen por excepción dentro de Análisis |
| ¿Dónde decido? | Panel formal GO/NO GO dentro de Decisión |
| ¿Dónde está el detalle técnico? | V3 desplegable dentro de Análisis |
| ¿V3 sigue siendo útil con N unidades? | Todas las unidades agrupadas por fase, conteos dinámicos y primera capa legible |
| ¿Dónde están IDs/evidencia cruda? | Sólo en `Ver trazabilidad técnica` y back/auditoría |
| ¿Puede desaparecer una condición sin copia humana? | No; se muestra fallback honesto |
| ¿Se repite una condición? | No |
| ¿Los conteos concilian? | La suma de estados V3 equivale al total de unidades; manifiesto y decisión se rotulan por separado |
| ¿Los botones registran lo que prometen? | Sí; navegación y persistencia no se confunden |

---

## 7. Fuera de alcance

- Reescribir o volver a ejecutar el motor AGT-002.
- Cambiar contratos canónicos de V3 o eliminar evidencia.
- Añadir un estado persistido HOLD.
- Crear nuevas inferencias comerciales o jurídicas en el front.
- Implementar `licitaciones_lectura` o crear `qahermes@seguridadnacional.co`.
- Cambiar el diseño general, branding, colores o shell completo del CRM.
- Enviar correos o comunicaciones externas.
- Migrar, fusionar, desplegar o modificar producción durante planificación o QA local.

---

## 8. Gates de cierre

1. **Gate de ejecución:** GO explícito del usuario para iniciar trabajo local.
2. **Gate de commit:** autorización que incluya commits locales.
3. **Gate de revisión:** suite, build, paridad, screenshots y revisión independiente completos.
4. **Gate de integración:** autorización explícita para merge/push.
5. **Gate de producción:** autorización explícita y estrategia que preserve `7ad7b91` y resuelva conscientemente el desfase con `main`.

Hasta superar el Gate 1, la única modificación permitida es este documento de planificación.
