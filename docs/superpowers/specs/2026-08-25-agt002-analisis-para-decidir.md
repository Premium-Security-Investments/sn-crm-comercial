# AGT-002: "Análisis para decidir" — superficie única de decisión — diseño

**Fecha:** 2026-08-25
**Estado:** diseño, sin implementar. Flag apagado por defecto, sin migración, sin deploy, sin dato real nuevo.
**Producto:** SIIO — Licitaciones / Oportunidades
**Agente visible:** Vig-IA · Copiloto de Licitaciones (AGT-002)
**Depende de:** `agt002-generic-decision-review.js` (`deriveAgt002GenericDecisionReview`, a corregir — §4), `agt002-pre-go-analysis.js` (catálogos `AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES` / `AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES`), contrato `agt002-integral-analysis-v3` (`evidence_refs`), `TenderGoNoGoDecisionPanel` (`src/tenders/components/TenderGoNoGoDecisionPanel.tsx`), `psi_tender_question_responses` (`supabase/migrations/038_tender_question_responses.sql`, tipo `TenderQuestionResponse`), `docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-design.md`, `docs/superpowers/specs/2026-08-23-agt002-tender-specific-requirement-inventory-design.md`.

## 1. Problema

Hoy la persona que debe decidir GO/NO-GO recorre tres superficies distintas (respaldo técnico V3, revisión genérica de decisión, panel de control formal) para responder una sola pregunta: *¿hay algo que pueda impedir participar, ejecutar o hacer viable la oferta, y qué falta para confirmarlo?* Dos problemas concretos lo impiden hoy:

1. `deriveAgt002GenericDecisionReview` sobre-escala: `unitNeedsHumanDecision` empuja a `decision_question` cualquier unidad con `blocking.effect` en `conditional`/`undetermined`, cualquier `human_validation.required`, cualquier `assessment_mode: 'abstained'` o cualquier falta crítica, sin distinguir materialidad. Una póliza por emitir (ordinaria) compite visualmente con una inhabilidad legal (material) porque ambas llegan como `decision_question` sin eje ni jerarquía.
2. Nada distingue "pregunta material sin responder" de "hallazgo confirmado como impedimento": en la práctica todo lo que bloquea humanamente se lee como "impedimento", aunque ninguna persona lo haya confirmado todavía.

## 2. Decisión

Se introduce una única superficie de presentación, **"Análisis para decidir"**, servida por una capa de derivación pura y fail-closed, con dos niveles de estado que nunca se mezclan:

- **Estado global de cobertura/enrutamiento** (uno de tres, §8): `paused`, `ready_for_human_review`, `post_go`. Gobierna qué CTA primaria se muestra y si la superficie es legible.
- **Estado visible por eje** (uno de cuatro, exactamente estos nombres, §9): `Favorable con evidencia`, `Impedimento material`, `Por confirmar`, `No evaluado`. Gobierna cómo se lee cada uno de los cinco ejes de decisión.

La superficie:

1. Reutiliza **sin reimplementar** `deriveAgt002GenericDecisionReview(currentAnalysis, result)` — corregido según §4 — como fuente de los hallazgos por unidad.
2. Reutiliza **sin duplicar** los catálogos cerrados de `agt002-pre-go-analysis.js` para clasificar cada `requirement_id` en materialidad `material` (7 categorías) u `ordinary` (8 categorías).
3. Agrupa exclusivamente los hallazgos materiales en cinco ejes fijos de decisión, cada uno con su propio estado visible.
4. Integra, dentro de la misma barra final, el control formal `TenderGoNoGoDecisionPanel` ya existente (§10) y las respuestas de `psi_tender_question_responses` ya existentes (§11).
5. Nunca decide GO/NO-GO, nunca envía comunicación externa, nunca aprueba, nunca llama "impedimento" a una pregunta sin confirmar: sólo presenta y enruta a una persona.

Esta superficie **sustituye la lectura humana** de la revisión de decisión existente y, con el flag activo, sustituye el brief de decisión, el análisis paralelo y la vista de decisión paralela como pestañas competidoras (§10). No sustituye el contrato v3, no sustituye el control formal GO/NO-GO en sí (lo incorpora), no sustituye la Mesa de ayuda.

## 3. Alcance

- Corrección de `agt002-generic-decision-review.js` para que deje de sobre-escalar y preserve materialidad/eje/evidencia (§4), sin tocar el contrato de entrada v3 ni aceptar clasificación enviada por el modelo.
- Nueva capa de presentación read-only sobre `analysis.decision_review` ya derivado (Manizales curada o genérica) y sobre `question_responses` ya existente.
- Nuevo manifiesto server-owned de clasificación materialidad/categoría por `requirement_id`, reutilizando los catálogos existentes de 7+8 categorías.
- Nuevo componente React de la superficie única: cabecera, cinco ejes con su estado visible, panel de detalle, drawers, barra final con `TenderGoNoGoDecisionPanel` embebido, una CTA primaria.
- Enrutamiento post-GO hacia la Mesa de ayuda ya existente (`TenderDossierVigiaWorkbench`), sin crear una superficie nueva de preparación.

## 4. Corrección de `agt002-generic-decision-review.js` (dentro de alcance)

Esta corrección está **dentro** de alcance; lo que permanece fuera de alcance es distinto y se detalla en §5 — no hay contradicción entre ambas.

`unitNeedsHumanDecision` hoy escala a `decision_question` sin distinguir materialidad ni preservar a qué eje pertenece un hallazgo, y eso hace que preguntas ordinarias y materiales se muestren con igual peso. La corrección:

1. `reviewedStatusForUnit` sigue siendo la única fuente de `reviewed_status`, sigue siendo server-derived y nunca acepta materialidad/eje del modelo. Sigue marcando `blocking.effect: 'conditional'`/`'undetermined'`, `human_validation.required` o falta crítica como `decision_question` (fail-closed: nunca los oculta), pero cada `finding` conserva `requirement_id` intacto para que `resolveAgt002RequirementMaterialPolicy` (§6) lo clasifique después. La corrección es de **propagación y agrupación** aguas abajo, no de qué se marca como pregunta.
2. `blocking.effect === 'blocker'` explícito del análisis v3 sigue siendo la única vía hacia el bucket `blocker`; la función **nunca auto-crea** un blocker a partir de `conditional`/`undetermined`/`abstained` — eso permanece `decision_question` hasta que una persona lo confirme, igual que hoy.
3. `evidence_refs` de cada `finding` se preserva sin transformar (ya es el contrato hoy); la corrección no cambia su forma ni su origen.
4. El objetivo medible del fix: con el mismo run de análisis, esta superficie debe poder mostrar "Legal: Por confirmar" y "Plazo: No evaluado" en vez de que ambos ejes reciban la misma etiqueta genérica de pregunta — el fix no cambia qué unidades se marcan `decision_question`, cambia que la información para agruparlas por eje llegue intacta.

## 5. Fuera de alcance

- Relajar el wire schema o el contrato `agt002-integral-analysis-v3` para que el modelo envíe materialidad, eje o clasificación de decisión: esos campos no existen en la entrada; `decision_review` sigue siendo 100 % server-derived, nunca aceptado tal cual del modelo.
- Cambiar `agt002-manizales-exercise-decision-review.js`: la rama curada Manizales no se toca.
- Cualquier automatismo GO/NO-GO, envío externo, firma o asignación nominal.
- Migración, tabla nueva, seed, deploy, activación de flag en ningún ambiente. `psi_tender_question_responses` ya existe y se reutiliza sin cambios de esquema.
- Clasificar materialidad por texto libre, por resumen del modelo o por heurística: sólo catálogo gobernado.
- Procesar expedientes reales o reemplazar el inventario de requisitos (`tender_requirement_inventory`) en curso.

## 6. Contrato: manifiesto de materialidad (server-owned)

Nuevo módulo puro `agt002-decision-axis-policy.js` (sin I/O), que exporta:

```js
export const AGT002_DECISION_AXES = Object.freeze([
  'legal', 'experiencia_financiera', 'imposibilidad_tecnica_grave', 'plazo', 'viabilidad_economica',
]);

// 7 categorías materiales -> 5 ejes fijos. Reutiliza el catálogo cerrado existente; no inventa uno nuevo.
export const AGT002_MATERIAL_CATEGORY_TO_AXIS = Object.freeze({
  inhabilidad_incompatibilidad: 'legal',
  licencia_habilitante_esencial_imposible: 'legal',
  experiencia_minima_insuficiente: 'experiencia_financiera',
  capacidad_financiera_insuficiente: 'experiencia_financiera',
  imposibilidad_tecnica_grave: 'imposibilidad_tecnica_grave',
  plazo_objetivamente_imposible: 'plazo',
  inviabilidad_economica_critica: 'viabilidad_economica',
});
```

`agt002-pre-go-analysis.js` exporta `AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES` (7) y `AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES` (8); este módulo los importa y valida en construcción que `AGT002_MATERIAL_CATEGORY_TO_AXIS` cubre exactamente las 7 y ninguna de las 8 — un desalineamiento futuro (categoría añadida sin eje) rompe la carga del módulo, nunca el runtime de una decisión real.

`requirementMaterialPolicy(requirementId)` (hoy privada en `agt002-pre-go-analysis.js`, junto con `GOVERNED_REQUIREMENT_MATERIAL_POLICY`) se exporta como `resolveAgt002RequirementMaterialPolicy` para tener una única fuente de verdad de materialidad por requisito. Un `requirement_id` sin entrada sigue lanzando (fail-closed); esta superficie captura esa excepción y trata el run entero como **no clasificable** (estado global `paused`, §8), nunca asume `ordinary` por omisión.

## 7. Derivación de la superficie

`deriveAgt002DecisionAnalysis(currentAnalysis, result, questionResponses)`:

1. Llama a `deriveAgt002GenericDecisionReview(currentAnalysis, result)` (o recibe el `decision_review` ya resuelto por `presentCurrentTenderAnalysis`, incluida la rama curada Manizales). Si es `null`, estado global = `paused`, motivo `no_decision_review`.
2. Para cada hallazgo en `blockers`, `decision_questions` y `supported`, intenta `resolveAgt002RequirementMaterialPolicy(finding.requirement_id)`.
   - Si lanza para **cualquier** hallazgo material-candidato del run: estado global = `paused`, motivo `material_policy_unclassified` — nunca oculta el hallazgo sin explicarlo ni lo clasifica a ciegas.
   - Si la política es `ordinary`: el hallazgo se **reclasifica** a `preparation` sólo en esta superficie (nunca en el `decision_review` genérico subyacente, que no se muta) y no participa de ningún eje.
   - Si la política es `material`: el hallazgo conserva su `reviewed_status` original (`blocker`, `decision_question` o `supported`), se le agrega `material_impediment_category` (ya tipado en `TenderDecisionReviewFinding`) y se agrupa bajo `AGT002_MATERIAL_CATEGORY_TO_AXIS[category]`.
3. Construye `axes`: un objeto con las 5 claves fijas de `AGT002_DECISION_AXES`, cada una siempre presente, con su bucket de hallazgos materiales y su estado visible calculado por §9 (nunca `undefined` ni clave ausente).
4. Anexa a cada hallazgo material de tipo `decision_question`/`blocker` sus `question_responses` correspondientes (por `question_id`, §11), sin que una respuesta `resolved` cambie por sí sola el `reviewed_status` ni el estado del eje.
5. Nunca fabrica evidencia: cada finding conserva su `evidence_refs` original (`manifest_requirement`, `registry_citation` o `review_finding`); esta capa no añade ni transforma referencias.

## 8. Estado global: cobertura y enrutamiento

Tres estados, mutuamente excluyentes, evaluados en este orden:

| Estado global | Condición | CTA primaria |
|---|---|---|
| `paused` | sin `decision_review` elegible, o materialidad no clasificable, o `decision_ready: false` en cobertura (§12) | ninguna CTA decisoria; sólo la acción de cobertura si existe (enlace a trazabilidad técnica V3), nunca "sin impedimentos" |
| `ready_for_human_review` | cobertura lista y materialidad clasificable | si algún eje está `Por confirmar`: **"Resolver la pregunta prioritaria"** (abre el drawer de la pregunta material de mayor prioridad, §11); si ningún eje está `Por confirmar` (todos `Favorable con evidencia`, `No evaluado` o `Impedimento material` ya confirmado): **"Registrar decisión"** (abre `TenderGoNoGoDecisionPanel`, §10) |
| `post_go` | ya existe un GO humano registrado para el `run_id` vigente | **"Abrir Mesa de ayuda"** (enlaza a `TenderDossierVigiaWorkbench`) |

En todo momento existe **una única** CTA primaria — nunca dos botones con igual jerarquía visual compitiendo. Un NO-GO registrado deja la superficie en `ready_for_human_review` de sólo lectura (el histórico de decisión es visible dentro del panel embebido, §10); no hay Mesa de ayuda ni preparación posterior que enrutar para un NO-GO.

## 9. Estado visible por eje

Exactamente estas cuatro etiquetas, nunca otras, evaluadas en este orden de precedencia (la peor gana) sobre los hallazgos materiales agrupados bajo el eje (§7):

1. **`No evaluado`** — si el estado global es `paused`, o si el eje no tiene ningún hallazgo material agrupado (bucket vacío). Un bucket vacío **no** es `Favorable con evidencia`: la ausencia de pregunta no es evidencia de cumplimiento, es ausencia de lectura.
2. **`Impedimento material`** — si el eje tiene al menos un hallazgo `blocker` (material, confirmado o curado por una persona). La vía genérica nunca auto-crea blockers (§4.2); esta etiqueta sólo aparece cuando una confirmación humana existe aguas arriba (p. ej. rama curada Manizales).
3. **`Por confirmar`** — si el eje no tiene `blocker` pero tiene al menos un hallazgo `decision_question` material. Este hallazgo **nunca** se rotula "impedimento" en chips, wireframes ni copy — siempre "pregunta material pendiente" o "por confirmar".
4. **`Favorable con evidencia`** — únicamente si, con cobertura lista, todos los hallazgos materiales del eje son `supported` con `evidence_refs` no vacío y ninguno cae en los tres casos anteriores.

Estas reglas son fail-closed: ante duda o dato incompleto, el eje cae hacia `No evaluado` o `Por confirmar`, nunca hacia `Favorable con evidencia`.

## 10. Integración de `TenderGoNoGoDecisionPanel` en la barra final

Con el flag activo, el `TenderGoNoGoDecisionPanel` existente deja de vivir en una pestaña de "Decisión" separada: la barra final de esta misma superficie es su único punto de entrada.

- La CTA "Registrar decisión" (§8) abre el mismo componente `TenderGoNoGoDecisionPanel` ya implementado, sin reimplementarlo: mismo `loadTenderGoNoGoDecision`/`recordTenderGoNoGoDecision`, mismo `canApproveTenderGoNoGo`, mismos avisos (`decisionBlockers`, `pendingConditions`), misma trampa de foco y confirmación. GO y NO GO siguen siendo opciones dentro de ese control/modal, nunca dos CTAs primarias simultáneas en la barra.
- Con el flag activo, el brief de decisión (`TenderDecisionBrief`), el "análisis paralelo" y la vista de "decisión" paralela **desaparecen** como pestañas o vistas competidoras de la misma información: esta superficie es la única lectura, y el panel de decisión formal es su barra final, no una ruta alterna.
- Con el flag apagado, nada cambia: las pestañas actuales y `TenderGoNoGoDecisionPanel` en su ubicación de hoy siguen intactas (§14).

## 11. Integración de `question_responses`

Cada hallazgo material `decision_question`/`blocker` puede tener respuestas ya registradas en `psi_tender_question_responses` (`TenderQuestionResponse`: `status: 'pending' | 'resolved' | 'not_applicable'`, `response`, `evidence_notes`, `attachments`). Esta superficie las muestra dentro del drawer de detalle (§13) reutilizando el componente y las acciones ya existentes (`TenderQuestionResponseCard`, `tenderQuestionResponseActions.ts`, RPC `psi_record_tender_question_response`) — sin nueva migración, sin nuevo esquema.

Regla central: **una respuesta `resolved` no mueve el eje a `Favorable con evidencia` ni a `Impedimento material` por sí sola.** El texto humano es contexto, no evidencia server-derived. El eje permanece `Por confirmar` hasta que un análisis posterior (nueva corrida v3, re-análisis) mueva el `finding` subyacente a `supported` (con `evidence_refs`) o a `blocker` confirmado — recién ahí, en la siguiente lectura de `deriveAgt002DecisionAnalysis`, el eje cambia de estado. Adjuntar evidencia, guardar notas o marcar `not_applicable` es una acción contextual disponible desde el drawer; nunca reclasifica el hallazgo del lado de esta superficie.

## 12. Cobertura: nunca certeza a partir de un análisis pausado

La superficie exige que `evidence_coverage`/`tender_requirement_inventory`/`tender_semantic_manifest` reporten `decision_ready: true` antes de tratar los cinco ejes como lectura completa. Con `decision_ready: false`, el estado global es `paused` (§8) con copy explícito de pausa/cobertura/parcialidad y todos los ejes en `No evaluado` — nunca `ready_for_human_review`, aunque los ejes visibles hasta ese punto estén vacíos.

**Ejemplo Bogotá** (expediente no-Manizales, histórico, usado ya en `tests/agt002-bogota-ui-regressions.test.mjs` como caso de cobertura pausada): de 11.345 unidades fuente del inventario, **8** son analizables/resueltas y 11.337 quedan `unresolved_visible`. `decision_ready: false`. La superficie debe mostrar "Análisis pausado — cobertura parcial (8 de 11.345 resueltas; 11.337 sin resolver)" con los cinco ejes en `No evaluado`, nunca "Sin impedimentos encontrados" ni ningún eje en `Favorable con evidencia`: la ausencia de `decision_question` en una cobertura del 0,07 % es ausencia de lectura, no ausencia de impedimento. Ningún gate existente se relaja para mostrar un estado más favorable con cobertura incompleta.

## 13. Wireframe — escritorio (≥1120px)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Análisis para decidir · <Oportunidad>            [Cobertura: PAUSADA]     │
│ Vig-IA analiza y agrupa; la decisión GO/NO-GO permanece humana.            │
├───────────────────────────────────────────────────────────────────────────┤
│ [Legal: Por confirmar (2)] [Exp.+Fin.: Favorable (1)] [Téc. grave: No     │
│ evaluado] [Plazo: No evaluado] [Económica: Favorable (1)]                  │ ← 5 chips, siempre los 5
├───────────────────────────────────────────────────────────────────────────┤
│ Eje seleccionado: Legal — Por confirmar (2 preguntas materiales)           │
│ ┌───────────────┬───────────────┬──────────┬────────────┬───────────────┐ │
│ │ Exigencia      │ Evidencia     │ Cruce    │ Efecto     │ Acción        │ │
│ ├───────────────┼───────────────┼──────────┼────────────┼───────────────┤ │
│ │ Sede/Agencia   │ evidencia op. │ missing  │ pregunta   │ [Ver detalle /│ │
│ │ Manizales      │ 2026 (parcial)│          │ material   │  Responder]   │ │
│ │                │               │          │ pendiente  │               │ │
│ ├───────────────┼───────────────┼──────────┼────────────┼───────────────┤ │
│ │ Licencia MinTIC│ Res. 01535    │ stale    │ pregunta   │ [Ver detalle /│ │
│ │                │ (CCTR 29062)  │          │ material   │  Responder]   │ │
│ │                │               │          │ pendiente  │               │ │
│ └───────────────┴───────────────┴──────────┴────────────┴───────────────┘ │
├───────────────────────────────────────────────────────────────────────────┤
│ ▮ Barra final: "Vig-IA recomienda; usted decide." · Mesa de ayuda ⤴       │
│ [ Resolver la pregunta prioritaria ]  ← única CTA (precedencia §8)        │
└───────────────────────────────────────────────────────────────────────────┘
```

Al hacer clic en "Ver detalle / Responder" se abre un **drawer** lateral (no un modal bloqueante de confirmación como el de GO/NO-GO): título, resumen, `missing`, `action_required`, la lista completa de `evidence_refs` con su `type`/locator (reutilizando `resolveFindingEvidence` de `tenderDecisionBriefModel.ts`), y el historial de `question_responses` con la acción contextual de responder/adjuntar (§11). El drawer nunca oculta contenido detrás de una segunda navegación; cierra con Escape o botón "Cerrar", sin perder el foco del chip de eje que lo abrió.

Cuando la CTA primaria es "Registrar decisión" (ningún eje `Por confirmar`), el mismo espacio de la barra final abre `TenderGoNoGoDecisionPanel` (§10) en su modal ya existente, no una vista nueva.

## 14. Wireframe — móvil (≤640px)

```
Análisis para decidir     [Cobertura: PAUSADA]
Vig-IA recomienda; usted decide.
──────────────────────────────
Legal — Por confirmar (2)  ▾ abierto
  ┌─────────────────────────┐
  │ Sede/Agencia Manizales  │
  │ Evidencia: parcial 2026 │
  │ Cruce: missing          │
  │ Efecto: pregunta        │
  │  material pendiente     │
  │ [Ver detalle/Responder] │
  └─────────────────────────┘
Exp.+Financiera — Favorable (1) ▸
Téc. grave — No evaluado        ▸
Plazo — No evaluado             ▸
Económica — Favorable (1)       ▸
──────────────────────────────
▮ Mesa de ayuda ⤴
[ Resolver la pregunta prioritaria ]  ← fijo, sticky bottom
```

Cada eje es un `<details>` (patrón ya usado en `TenderIntegralAnalysisV3View`); sólo el eje `Por confirmar`/`Impedimento material` de mayor prioridad abre por defecto (mismo criterio que `autoOpenPendingPhases`, siempre pasado explícito por el llamador). Cada tarjeta reemplaza la tabla de 5 columnas por una lista `dl` de una sola columna reutilizando las salvaguardas ya probadas en `tender-integral-analysis-v3.css` (`grid-template-columns` propio, `min-width:0`, `overflow-wrap:anywhere`).

## 15. Accesibilidad

- Los 5 chips de eje son `<button aria-pressed>` con el nombre del estado y el conteo en texto, nunca sólo color; un eje `No evaluado` se anuncia igual ("Plazo, no evaluado"), no se atenúa hasta ilegibilidad ni se confunde con "favorable".
- El drawer usa `role="dialog"`, `aria-modal="true"`, `aria-labelledby` en el título, trampa de foco y restauración de foco al cerrar — mismo patrón ya implementado en `TenderGoNoGoDecisionPanel` (`initialFocusRef`, `previouslyFocusedRef`, manejo de `Tab`/`Escape`), reutilizado también cuando ese panel se abre desde la barra final (§10).
- El banner de estado global (`paused`/`ready_for_human_review`/`post_go`) es una región `aria-live="polite"` que anuncia el cambio de estado sin mover el foco.
- La barra final y su CTA primaria son siempre el último elemento del orden de tabulación de la sección, nunca el primero, para no interceptar la lectura de los ejes.
- La tabla de escritorio expone `<caption>`/encabezados `<th scope="col">` para exigencia/evidencia/cruce/efecto/acción; la vista móvil en `dl` conserva las mismas etiquetas como `<dt>`, nunca las omite por espacio.

## 16. Datos y persistencia

Sin migración ni tabla nueva. `agt002-decision-axis-policy.js` es un módulo de código versionado (igual patrón que `GOVERNED_REQUIREMENT_MATERIAL_POLICY`), no una fila de base de datos. La superficie es puramente derivada en el momento de presentar (`presentCurrentTenderAnalysis`): no se persiste `axes`, el estado global ni el estado por eje; se recalculan en cada lectura a partir del `decision_review` ya persistido/derivado, el manifiesto de materialidad versionado y `psi_tender_question_responses` ya existente (leído, nunca mutado por esta capa). Un requisito documental nuevo del inventario (`tender_requirement_inventory`, IDs SHA-256) sin fila en `GOVERNED_REQUIREMENT_MATERIAL_POLICY` fuerza `paused`, nunca una fila fabricada.

## 17. Rollout y rollback

Flag nuevo `AGT002_DECISION_AXIS_SURFACE`, apagado por defecto, siguiendo el patrón fail-closed de `AGT002_INTEGRAL_CONTRACT_V3` (`docs/runbooks/agt002-integral-v3-canary.md`): sólo el literal `true` lo activa; cualquier otro valor deja la superficie vieja (tabs actuales de brief/análisis/decisión) intacta. Precondiciones antes de activarlo en cualquier ambiente:

1. `AGT002_MATERIAL_CATEGORY_TO_AXIS` valida en carga contra las 7 categorías materiales del catálogo existente (falla el build, no el runtime, si diverge).
2. QA visual con etiquetas reales de los cinco estados por eje, del drawer y del `TenderGoNoGoDecisionPanel` embebido, igual exigencia que §12 del diseño v3 (no activar para usuarios sin esa QA).
3. Activación inicial acotada por `opportunity_id` (mismo mecanismo de scoping que `agt002-manizales-manifest-source.js`), nunca global de entrada.
4. Rollback: apagar el flag. Al ser presentación pura sin persistencia propia, no hay dato que revertir ni migración que deshacer; la superficie desaparece, las pestañas de brief/análisis/decisión reaparecen y el flujo cae al `decision_review` genérico/curado ya existente sin cambio de estado.

## 18. Autorrevisión

- **No-Manizales:** cualquier oportunidad sin fixture curada usa exclusivamente `deriveAgt002GenericDecisionReview` (corregido, §4) + este manifiesto de materialidad; la rama `deriveManizalesDecisionReviewIfEligible` sigue evaluándose primero (orden `??` ya existente en `presentCurrentTenderAnalysis`) y esta superficie nunca fuerza esa rama para un `opportunity_id`/`run_id` distinto de los dos pineados.
- **Bogotá:** con la fixture de `tests/agt002-bogota-ui-regressions.test.mjs` (**8** unidades resueltas de 11.345, cobertura `PAUSED_INVENTORY_COVERAGE`, `decision_ready: false`), el estado global cae en `paused` por cobertura antes de evaluar materialidad, con los cinco ejes en `No evaluado` y el copy de pausa de §12 — nunca `ready_for_human_review` ni un eje leído como `Favorable con evidencia` por ausencia de preguntas.
- Ningún gate de elegibilidad de `deriveAgt002GenericDecisionReview` (`eligibleCurrentAnalysis`, `structurallyEligibleIntegralAnalysis`) se relaja, reimplementa ni se bypasea desde esta superficie.

## 19. Criterios de aceptación

1. La superficie nunca renderiza sin pasar primero por `deriveAgt002GenericDecisionReview` (o su override curado): no hay ruta que fabrique `decision_review` propio.
2. El fix de `agt002-generic-decision-review.js` (§4) preserva `requirement_id`/`evidence_refs` de cada finding sin cambiar qué unidades se marcan `decision_question`/`blocker`/`supported`; no acepta materialidad, eje ni clasificación del modelo.
3. Los cinco ejes (`legal`, `experiencia_financiera`, `imposibilidad_tecnica_grave`, `plazo`, `viabilidad_economica`) están siempre presentes en la salida, cada uno con exactamente uno de los cuatro estados de §9.
4. Sólo un hallazgo material (una de las 7 categorías) puede aparecer bajo un eje; ninguna de las 8 categorías ordinarias produce entrada de eje.
5. Un hallazgo con categoría ordinaria se reclasifica a `preparation` sólo en esta superficie, sin mutar el `decision_review` subyacente.
6. Un `requirement_id` sin clasificación en `resolveAgt002RequirementMaterialPolicy` fuerza el estado global a `paused` con motivo explícito, nunca asume `ordinary`.
7. Con `decision_ready: false` en cualquier bloque de cobertura reconocido, el estado global es `paused` y los cinco ejes son `No evaluado`, nunca `ready_for_human_review`.
8. Un eje sin hallazgos materiales agrupados (bucket vacío) es `No evaluado`, nunca `Favorable con evidencia`.
9. `Impedimento material` sólo aparece cuando el eje tiene un `blocker` confirmado/curado; la vía genérica nunca auto-crea uno.
10. Ningún wireframe, chip o copy llama "impedimento" a un `decision_question` sin confirmar: se usa "pregunta material pendiente" o "por confirmar".
11. El caso Bogotá (8/11.345 resueltas, 11.337 `unresolved_visible`) renderiza el copy de pausa/cobertura/parcialidad exacto de §12, con los cinco ejes en `No evaluado`.
12. Existe exactamente una CTA primaria en todo momento, resuelta por la precedencia de §8: `paused` → sin CTA decisoria (o acción de cobertura si existe); eje `Por confirmar` pendiente → resolver la pregunta prioritaria; `ready_for_human_review` sin ejes `Por confirmar` → "Registrar decisión"; `post_go` → "Abrir Mesa de ayuda".
13. GO y NO GO son opciones dentro del `TenderGoNoGoDecisionPanel` embebido, nunca dos CTAs primarias simultáneas en la barra final.
14. Con el flag activo, el brief de decisión, el análisis paralelo y la vista de decisión paralela dejan de renderizarse como pestañas competidoras; `TenderGoNoGoDecisionPanel` sólo se abre desde la barra final de esta superficie, con su misma API, permisos y confirmación.
15. Una `question_response` con `status: 'resolved'` no cambia el estado de ningún eje por sí sola; el eje sólo cambia cuando un análisis server-derived posterior mueve el `finding` a `supported` o `blocker`. Adjuntar/guardar respuesta no crea ni requiere una nueva migración.
16. Tras un GO humano registrado, la CTA primaria enlaza a la Mesa de ayuda existente (`TenderDossierVigiaWorkbench`), sin crear una segunda superficie de preparación.
17. El drawer de detalle reutiliza `evidence_refs` y `question_responses` originales sin transformarlos ni fabricar referencias nuevas.
18. El drawer y el `TenderGoNoGoDecisionPanel` embebido implementan trampa de foco, `Escape` para cerrar y restauración del foco previo.
19. Los chips de eje comunican estado y conteo por texto, no sólo color, y un eje `No evaluado` sigue siendo perceptible y distinguible de `Favorable con evidencia`.
20. La vista móvil usa `dl` de una sola columna con `grid-template-columns` propio, sin heredar la plantilla global de dos columnas.
21. Ningún componente de esta superficie decide, aprueba, firma, envía o asigna: toda copy reafirma autoridad humana.
22. El flag `AGT002_DECISION_AXIS_SURFACE` está apagado por defecto y sólo el literal `true` lo activa; apagado, las pestañas actuales y la ubicación actual de `TenderGoNoGoDecisionPanel` permanecen intactas.
23. `AGT002_MATERIAL_CATEGORY_TO_AXIS` valida en carga que cubre exactamente las 7 categorías materiales existentes; una categoría material sin eje asignado rompe la carga del módulo.
24. Ninguna oportunidad distinta a las dos rutas pineadas (Manizales curada, genérica) puede activar la rama curada por accidente.
25. No existe migración, tabla, seed, deploy ni activación de flag en ningún ambiente como parte de este diseño; `psi_tender_question_responses` se reutiliza sin cambios de esquema.
26. La superficie es puramente derivada en lectura: no persiste `axes`, el estado global ni el estado por eje en ningún artefacto nuevo.
