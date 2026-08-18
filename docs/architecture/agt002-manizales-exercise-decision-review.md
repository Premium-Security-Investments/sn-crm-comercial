# AGT-002 Manizales · capa de revisión de decisión de EJERCICIO (no canónica)

**Estado:** nueva, opt-in, no wireada al motor de producción (`agt002-preview-engine.js`). No
hay migración, deploy ni cambio de contrato canónico asociado a este documento.

## Qué resuelve

La proyección v2 canónica (`agt002-v3-compatibility.js`, diseño
`docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-design.md` §9-10) trata **toda**
unidad `abstained`/`human_validation_required` como `question` visible — correcto para v2. En
una corrida gobernada del piloto Manizales SA-24-2026, las 20 unidades analizables abstienen
siempre (evidence-or-abstention: `evidence_state.compliance` nunca sale de `unknown`), así que
`v2_projection.questions` es siempre 20/20 — ruido, no una decisión empresarial.

Este comportamiento v2 **no cambia** (`isQuestionUnit` en `agt002-v3-compatibility.js:49-55`
sigue intacto; ver `tests/agt002-v3-critical-questions-subset.test.mjs` que lo fija como GREEN
esperado). En su lugar se añade una **capa nueva, separada y genérica**.

## Qué es

- `agt002-manizales-exercise-decision-review.js` (raíz del repo): librería pura, sin I/O.
  Exporta `validateAgt002ManizalesExerciseDecisionReviewFixture` (validador fail-closed,
  integridad referencial contra el `integral_analysis` canónico real, las entradas
  `unresolved_visible` reales del manifiesto y el índice real obligatorio de citas del registro
  contractual; además exige cobertura explícita de cada unidad canónica) y
  `deriveAgt002ManizalesExerciseDecisionReview` (agregador genérico:
  ninguna rama de código conoce un `requirement_id` de Manizales en particular).
- `tests/fixtures/agt002-manizales-exercise-decision-review.v1.json`: el fixture versionado y
  validado — clasificación humana curada de las 20 unidades canónicas + las 5 entradas
  `unresolved_visible` del manifiesto (`financial-working-capital`, `legal-rce-policy`,
  `legal-collective-life-policy`, `technical-video-surveillance-scope`,
  `lifecycle:cierre-prorroga`) + 2 requisitos nuevos (`registry_supplement`) con cita real al
  registro contractual (`docs/governance/registro/manizales-sa-24-2026.registry.json`,
  ítem `2.1`, `sub_item_id` `SA-24-2026#2.1#i11` y `#i12`).
- `tests/agt002-manizales-exercise-decision-review.test.mjs`: TDD — RED (módulo ausente) →
  GREEN, corre la capa sobre un `integral_analysis` REAL (`runAgt002ManizalesV3LocalRun`, motor
  V3 real + respondedor sintético en proceso, sin red/DB) y prueba fail-closed contra intentos de
  fabricar evidencia.

## Por qué las 2 decision_questions son exactamente esas

`SA-24-2026#2.1#i11` ("Sede Principal, Sucursal o Agencia en Manizales") y `#i12` ("Licencia de
Comunicaciones y Medios Tecnológicos", MinTIC) son sub-ítems reales del ítem `2.1 CAPACIDAD
JURÍDICA` del registro contractual, hoy sin `governed_requirement_id` ni clase de evidencia
enlazada. La lección Pereira ya registrada
(`docs/governance/analisis/manizales-sa-24-2026.pre-go-analysis.json`,
`pereira_pattern.buckets.variables_por_proceso`, "Territorialidad de la licencia de
funcionamiento") documenta que la territorialidad cambia por proceso y no puede heredarse de una
licencia histórica — exactamente el tipo de hecho cuya resolución puede confirmar o descartar un
impedimento habilitante esencial (`licencia_habilitante_esencial_imposible`, catálogo cerrado
`AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES` de `agt002-pre-go-analysis.js`, reutilizado sin
reimplementar). Todo lo demás — reglas de agregación/subsanabilidad, criterios de puntaje
diferencial, documentos preparables (pólizas, anexos, certificados) — nunca es una pregunta:
queda en `not_applicable` o `preparation`.

## exercise_mode

`AGT-002 Manizales` se evalúa aquí como **EJERCICIO pre-cierre**: la compuerta temporal de ciclo
de vida (`lifecycle:cierre-prorroga`, §1.8) se marca `exercise_bypassed: true` y no cuenta contra
`recommendation`, pero permanece siempre visible en `not_applicable` — nunca se borra ni se
oculta (`review.exercise_mode.bypassed_requirement_ids`).

## Resultado verificable (fixture v1, corrida real)

`decision_status: "pending_human_decision"`, `decision_ready: false`,
`human_approval_required: true`, `blockers: []` (0) y `decision_questions` (2):
`legal-territorial-agency-manizales`, `legal-communications-mintic-license`. El resto de las 27
entradas del fixture queda `supported` (3), `preparation` (9) o `not_applicable` (13, incluida la
compuerta de ciclo de vida).

`recommendation: "advance_conditionally"` sólo significa continuar el **flujo probatorio**; no
es GO, GO condicionado ni una decisión empresarial. La capa nunca asigna GO/NO-GO: esa decisión
permanece pendiente del humano. `decision_ready` pasa a `true` únicamente cuando ya no existen
`decision_questions`; un bloqueador confirmado puede dejar el expediente listo para una decisión
humana desfavorable, por lo que la condición no depende de que `blockers` esté vacío.

La única acción de enrutamiento es `routing_action: "flag_for_responsible_person"`. La salida fija
`external_communications_allowed: false` y `evidence_requests_allowed: false`: AGT-002 deja la
observación trazable y la encargada decide si continúa, descarta o gestiona soportes. La capa no
envía correos, no solicita documentos y no realiza gestiones externas.

La revisión probatoria del 18-ago-2026 cerró la lectura documental pero no las dos preguntas:

- Agencia Manizales: hay evidencia operativa 2026, pero falta acto territorial de
  SuperVigilancia y certificado mercantil local.
- Comunicaciones: Resolución MinTIC 01535 vigente por diez años desde el 1-ene-2026, pero el CCTR
  29062 no incluye Manizales y faltan el pago abril-junio 2026 o la acreditación completa de la
  ruta alternativa con operador celular.

## Compatibilidad

No se tocó `agt002-preview-engine.js`, `agt002-v3-compatibility.js`, `agt002-pre-go-analysis.js`
ni ningún consumidor existente — cero diff en archivos preexistentes. `integral_analysis` y
`v2_projection` quedan bit-idénticos antes/después de invocar esta capa (pinneado en la prueba,
sección 7). Esta capa no está wireada a ningún endpoint ni a la persistencia; es una librería
standalone para consumo explícito (script/test) hasta que un consumidor real la solicite,
momento en el cual debe integrarse detrás de un flag opt-in por defecto OFF, siguiendo el patrón
ya usado en el motor (p.ej. `promptBudget`).
