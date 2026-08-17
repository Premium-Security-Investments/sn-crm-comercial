# AGT-002 — política de revisión humana

**Fecha:** 2026-08-17 · **Alcance:** documental. No cambia runtime, contratos ni migraciones; describe y referencia mecanismos ya existentes en código.

## 1. Principio

AGT-002/Vig-IA puede analizar, organizar evidencia, señalar brechas y proponer acciones. **Nunca** decide cumplimiento, GO/NO-GO, no aprueba requisitos ni evidencias, no asigna compromisos humanos silenciosamente, y no firma, envía ni presenta ofertas. Esto no es una aspiración de diseño: es una propiedad estructural del contrato V3, verificada en código.

## 2. Dónde vive esta propiedad en código (evidencia mecánica, esta sesión)

- **`compliance` nunca sale de `"unknown"`.** `agt002-evidence-state-manifest.js` deriva los cinco ejes de cada requisito desde un enlace curado; no existe hoy una vía de escritura real que promueva `compliance` a otro valor. Esto no es una validación adicional — es la ausencia deliberada de un camino de código que pudiera hacerlo.
- **`human_validation.required: true` en cada unidad.** El contrato V3 marca cada unidad de análisis como pendiente de validación humana; el runbook de canary (`docs/runbooks/agt002-integral-v3-canary.md`) exige verificar esto antes de tratar cualquier corrida como válida, y advierte explícitamente contra "tratar una validación de contrato exitosa como sustituto de revisión humana".
- **`v2_projection.human_review_required === true`** en la proyección de compatibilidad V2, sin que ningún campo declare un estado definitivo `compliant`/`sufficient`/`approved` — estructuralmente imposible según el contrato, no sólo por convención de UI.
- **Catálogo cerrado de acciones.** El diseño rechaza explícitamente acciones `go`, `no_go`, `approve`, `sign`, `send`, `submit` como salida del modelo. `external_side_effect` es siempre falso.
- **Curación de gobernanza es un acto humano fuera de runtime.** La migración `064_agt002_integral_governance_overrides.sql` no otorga ningún rol `INSERT`/`UPDATE`/`DELETE` en `psi_agt002_integral_governance_overrides`; poblarla para una oportunidad real es, por diseño, un acto humano separado, trazable por `rationale`/`source_reference`/`curated_by`/`curated_at`/`version` (exigido y verificado por la migración `066` para Manizales).

## 3. Preguntas críticas y cobertura honesta

`docs/verification/2026-08-15-agt002-manizales-v3-pilot.md` documenta que `TenderIntegralAnalysisV3View.tsx` mide cobertura como una fracción del *envelope del contrato* (`analyzed_requirement_ids.length / expected_requirement_ids.length`), no del universo documental completo del expediente (68 secciones del registro, 15+20 ledgers cerrados en el borrador de gobernanza). Un cociente perfecto en esa fracción no debe leerse ni presentarse como "expediente completamente analizado".

**Política:** cualquier subconjunto de preguntas críticas que se muestre a un humano debe filtrar por excepción material (abstención, vencimiento, brecha), nunca ocultar el universo completo de preguntas generadas. Reducir el ruido no es lo mismo que ocultar cobertura — cuando exista una vista filtrada, debe declarar explícitamente cuántas preguntas quedan fuera del filtro y por qué criterio.

## 4. Autoridad humana por caso

- El GO/NO-GO, la firma, el envío, la presentación y el compromiso de garantías o recursos permanecen exclusivamente en manos humanas, en sus propios componentes existentes, sin duplicarse en la vista V3.
- La curación de `categoryOverrides`/`evidenceClassLinkByRequirementId` para un proceso nuevo es un acto humano separado del código; ver `docs/runbooks/agt002-process-onboarding-gate.md`.
- QA visual autenticado con etiquetas reales, realizado por un humano contra el entorno objetivo, es un gate de release explícito antes de exponer la UI V3 a cualquier usuario — no una formalidad posterior al despliegue.

## 5. Límite de esta política

Esta política describe la autoridad y los mecanismos que ya la hacen cumplir en código para Manizales. No introduce mecanismos nuevos ni cambia ninguno existente. Cualquier proceso futuro que use el paquete reusable descrito en `docs/architecture/agt002-reusable-licitacion-architecture.md` hereda esta misma política sin excepción — el gate de onboarding no puede aprobar un paquete cuya gobernanza otorgue a AGT-002 una conclusión de cumplimiento automática.
