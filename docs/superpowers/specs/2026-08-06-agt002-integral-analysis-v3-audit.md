# Auditoría — contrato AGT‑002 v2 y límites para análisis integral v3

**Fecha:** 2026-08-06
**Rama auditada:** `feat/agt002-v3-foundations`
**Base funcional:** commit local `5be18d7`
**Estado:** auditoría de código cerrada; sin cambios de runtime, UI, base de datos ni producción

## 1. Propósito

Determinar cómo introducir un contrato integral v3 sin reescribir runs v2, sin crear dos fuentes de verdad, sin ampliar la autoridad de Vig‑IA y sin degradar los controles de evidencia construidos en E1–E5 y F1/F2.

## 2. Verdad de código

### 2.1 Contratos que coexisten hoy

1. `agt002-preview-contract.js` es el contrato runtime real del Preview (`2.0-preview.1`). Es cerrado, valida citas contra allowlists y exige revisión humana.
2. `contracts/agents/AGT-002/v2-draft/analysis-run.*.schema.json` es un draft histórico separado. No tiene `manifest.json`; su request todavía contiene texto documental bruto y no representa la minimización/retrieval vigente.
3. `agt002-tender-adapter.js` mantiene otro validador cerrado del envelope base y sólo acepta `2.0-preview.1`.
4. `tender-analysis-domain.js` valida la forma compartida mínima y tolera extensiones.
5. `agt002-preview-persistence.js` persiste únicamente una allowlist de campos v2 mediante `CONTENT_KEYS`.
6. `presentCurrentTenderAnalysis()` expande `result` y añade autoridad tipada del run, por lo que hoy los consumidores leen campos v2 al nivel superior.

**Conclusión:** v3 debe evolucionar el runtime Preview real. El directorio `v2-draft` se conserva como artefacto histórico/consumer draft; no puede ser la base normativa de v3.

### 2.2 Forma v2 actual

El resultado canónico usa:

- `recommendation`, `summary`, `next_action`;
- cinco listas genéricas: `strengths`, `weaknesses`, `blockers`, `questions`, `unverified`;
- `legal_evidence` + `legal_findings`;
- `requirement_evidence` y `evidence_coverage` como extensiones del runtime Preview;
- `human_review_required: true`.

La unidad `finding` sólo contiene `id`, `text`, `critical` y `evidence_refs`. No puede expresar de forma inequívoca, por requisito:

- clase y orden institucional;
- efecto bloqueante;
- subsanabilidad;
- presencia, revisión, vigencia, aplicabilidad y cumplimiento por separado;
- impacto comercial unido al análisis jurídico;
- evidencia faltante;
- acción, rol, hito, escalamiento y condición de cierre;
- abstención;
- estado de validación humana.

### 2.3 Evidencia y cobertura existentes que v3 debe reutilizar

- `agt002-deep-analysis-matrix.js`: manifiesto cerrado de requisitos y procedencia.
- `agt002-requirement-evidence.js`: cruce de requisito contra evidencia empresarial, sin autoridad GO/NO-GO.
- `agt002-company-evidence-classes.js`: catálogo cerrado de 17 clases y cinco ejes independientes.
- `agt002-preview-contract.js`: validación de referencias documentales, jurídicas, corporativas y humanas contra allowlists.
- `agt002-preview-input.js`: retrieval acotado, omisiones materiales, chunks sin persistir texto en cobertura.
- `agt002-preview-persistence.js`: contexto/corpus/versiones y run canónico append-only.
- migración 063: un único run canónico completado por oportunidad y promoción transaccional.

### 2.4 Consumidores que condicionan compatibilidad

- `src/tenders/types.ts` modela directamente la forma v2.
- componentes de análisis y `TenderGoNoGoDecisionPanel.tsx` leen `recommendation`, `questions`, `critical_open_count`, `current` y autoridad del run.
- `tenderDecisionGate` mantiene GO/NO-GO humano y no debe depender de una conclusión v3.
- continuidad hacia Mesa usa preguntas v2 y referencias tipadas.
- pruebas de contrato fijan versiones, claves exactas y rechazo de propiedades desconocidas.

## 3. Riesgos prioritarios

### P0 — dos fuentes de verdad

Si el proveedor entrega simultáneamente la matriz v3 y las listas v2, ambas pueden contradecirse. **Decisión:** la matriz v3 es la única salida analítica canónica; la proyección v2 se calcula determinísticamente en backend y nunca la suministra el modelo.

### P0 — falsa integralidad

Un arreglo parcial de requisitos puede presentarse como análisis completo. **Decisión:** todo `requirement_id` del manifiesto gobernado aparece exactamente una vez. Omisiones de evidencia obligan abstención y se declaran en cobertura.

### P0 — autoridad indebida

Campos como `decision`, `approved`, `go`, `no_go`, `send`, `submit`, `sign` o equivalentes no pertenecen al contrato v3. La recomendación v2 seguirá siendo apoyo derivado; no bloquea ni ejecuta la decisión humana.

### P0 — cumplimiento inferido por presencia

La sola existencia de un documento no demuestra revisión, vigencia, aplicabilidad ni cumplimiento. V3 debe transportar los cinco ejes como enums separados y validar combinaciones imposibles.

### P1 — migración destructiva o lectura ambigua

No se modifica JSON histórico ni se relabelan runs. Los readers despachan por versión. Los runs v2 siguen visibles; los runs v3 añaden una extensión y una proyección v2 derivada.

### P1 — citas y fundamento jurídico débiles

Toda afirmación material debe usar referencias permitidas. Una norma presente pero sin vigencia/aplicabilidad verificable produce abstención o revisión jurídica humana, no conclusión definitiva.

### P1 — hitos y roles inventados

Fechas sólo se emiten con referencia fuente; de lo contrario quedan `unknown`. Los roles son enums institucionales, nunca nombres de personas ni asignaciones automáticas.

### P1 — validación humana falsificada

El run de IA sólo puede emitir `human_validation.status = pending`. Aceptación/rechazo humana posterior vive en artefactos append-only separados y nunca muta el run.

### P1 — divergencia productor/consumidor v2 confirmada por revisión independiente

`createAgt002PreviewEngine()` ensambla hoy un envelope con `producer` y `usage.rate_limit`, mientras `validateAgt002TenderAnalysisEnvelope()` en `agt002-tender-adapter.js` los rechaza y exige `usage.cost_usd`, que el engine no emite. Una prueba directa de la revisión produjo `El envelope AGT-002 debe ser cerrado.`. El flujo principal persiste sin ese adaptador, pero v3 no puede heredar esta ambigüedad: el plan exige dispatch explícito por versión y una prueba de paridad en la que todo envelope emitido por el engine sea aceptado por su consumidor contractual correspondiente.

### P1 — F2 todavía es fundación, no runtime

El catálogo de 17 clases y sus cinco ejes sólo se usa en pruebas. V3 debe conectarlo al input, validador, engine y persistencia detrás del flag; no se afirmará que F2 está operativo antes de ese wiring y su gate.

### P1 — superficie humana diferida pero obligatoria

La UI actual muestra recomendación y conteos, no trazabilidad por requisito, abstención ni cinco ejes. La UI queda fuera de la implementación contractual inicial, pero será un gate separado obligatorio antes de cualquier rollout: no se activará v3 a usuarios si la persona decisora no puede inspeccionar evidencia, abstenciones y validaciones pendientes.

## 4. Estrategia aprobada de versionado

### 4.1 Payload del modelo y envelope v3

- el modelo devuelve sólo `integral_analysis` en forma cerrada;
- el engine ensambla la nueva versión `3.0.0` con metadatos gobernados del run, contexto, coverage, corpus, revisión humana obligatoria y usage;
- el modelo no puede suministrar identidad, versiones, coverage, usage ni listas v2;
- usa validadores específicos por versión, no un `exactKeys` compartido ambiguo.

### 4.2 Resultado persistido y presentación

Al validar un envelope v3, backend:

1. valida cobertura completa, orden, enums y citas;
2. calcula una proyección v2 determinística;
3. persiste `integral_analysis` junto con los campos v2 proyectados en el mismo run canónico;
4. calcula `critical_open_count` desde la fuente v3;
5. presenta a consumidores actuales exactamente los campos v2 esperados y, opcionalmente, la extensión v3.

El proveedor no puede suministrar ni sobrescribir la proyección.

### 4.3 Coexistencia

- v2 histórico: permanece intacto y se presenta como hoy;
- v3 nuevo: se presenta con compatibilidad v2 derivada y extensión integral;
- sin backfill obligatorio;
- sin mutación de decisiones humanas;
- idempotency key y policy/schema version deben cambiar de forma coordinada para evitar colisión con runs previos del mismo snapshot/contexto.

## 5. Modelo conceptual v3

La fuente de verdad será `analysis_units`, no cinco listas genéricas.

- `unit_kind = tender_requirement`: exactamente una unidad por requisito del manifiesto.
- `unit_kind = strategic_consideration`: unidad opcional sustentada por contexto comercial autorizado, siempre posterior a requisitos formales.
- categorías y orden cerrado: `discard`, `habilitating`, `technical`, `financial_execution`, `strategic`.
- cada unidad combina lectura comercial y jurídica, pero conserva evidencias y fundamentos tipados por separado.

Los detalles normativos, enums, invariantes y reglas de proyección se fijan en la especificación v3 asociada.

## 6. Límites de implementación

La primera implementación v3 incluirá contrato, validadores, proyección v2, persistencia allowlisted y fixtures sintéticos. Quedan fuera:

- UI nueva;
- expediente real;
- asignación automática de personas;
- acciones externas;
- activación en producción;
- migración remota;
- backfill de runs;
- cambios al gate humano GO/NO-GO.

## 7. Gates previos a implementación

1. especificación v3 cerrada y revisada;
2. pruebas RED de forma, cobertura, citas, abstención y autoridad;
3. prueba de compatibilidad v2 y no mutación histórica;
4. prueba de proyección determinística sin contradicción;
5. prueba de persistencia y lectura por versión;
6. suite AGT‑002, paridad backend, build y baseline general;
7. una revisión independiente del bloque completo;
8. sin push, PR, migración ni deploy sin gate humano posterior.

## 8. Revisión independiente de esta propuesta

- El intento de revisión Opus no produjo contenido: Claude Code respondió `429 session limit`; no se contabiliza como review.
- Se ejecutó fallback independiente con GPT en modo read-only sobre el commit `5be18d7`.
- Evidencia del reviewer: 10 suites relevantes, **10 passed, 0 failed**; ningún archivo modificado.
- P0 confirmados del estado actual: ausencia de orden/cobertura runtime y cruce débil requisito–empresa.
- P1 confirmados: divergencia engine/adaptador v2, enum `front` insuficiente, F2 aislado, UI sin trazabilidad y `summary/next_action` libres.
- Correcciones incorporadas al diseño/plan:
  - cobertura uno-a-uno y orden institucional;
  - comercial + jurídico obligatorios por unidad;
  - ningún cumplimiento definitivo producido por IA;
  - cinco ejes y abstención cerrados;
  - paridad productor–consumidor por versión;
  - summary/next action derivados y trazables por `unit_id`;
  - wiring explícito de F2;
  - UI humana como gate obligatorio previo a activación.

**Dictamen posterior a corrección:** propuesta apta para pasar a implementación TDD local detrás de flag; no apta todavía para activación, datos reales ni producción.
