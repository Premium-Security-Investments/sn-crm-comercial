# AGT-002 — arquitectura reusable para futuras licitaciones

**Fecha:** 2026-08-17 · **Estado:** diseño documental (fase 9, tareas 1/2/5/6 del plan de consolidación). **No implementado en código todavía** — las tareas 3 (paquete reusable + registry fail-closed) y 4 (contrato JSON V3 versionado) del plan `docs/plans/2026-08-17-agt002-phase9-consolidation.md` siguen abiertas y no fueron ejecutadas en esta sesión. Este documento describe el objetivo de esa extracción futura y, por separado, exactamente qué existe hoy en código para Manizales, sin confundir ambas cosas.

## 1. Objetivo

Permitir que una segunda licitación use el contrato V3 sin copiar el código de Manizales y sin habilitar nada automáticamente. Manizales sigue siendo, hasta que exista y se apruebe un paquete nuevo, **el único proceso V3 habilitado**.

## 2. Qué existe hoy (verificado en código en esta sesión) — específico a Manizales, no genérico

- `agt002-manizales-manifest-source.js` — `selectAgt002ManizalesManifestSource({ integralContractV3, opportunityId, process })`: devuelve `null` si el flag no está activo; si está activo pero `opportunityId`/`process` no coinciden exactamente con las constantes `AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID`/`AGT002_INTEGRAL_MANIFEST_PROCESO` (importadas de `agt002-manizales-integral-manifest.js`, hardcodeadas al piloto), lanza `AGT002_MANIZALES_PILOT_SCOPE_MISMATCH` antes de tocar el proveedor.
- `agt002-manizales-integral-manifest.js` + `data/agt002/manizales-sa-24-2026.integral-manifest.v1.json` — el manifiesto gobernado específico de Manizales: 25 entradas, citas verificadas contra excerpts, catálogo cerrado de clases de evidencia.
- `agt002-manizales-manifest-corrections.js` — pase de correcciones determinista, sólo degradación/abstención, específico al manifiesto de Manizales.
- `agt002-integral-category-manifest.js` / `agt002-evidence-state-manifest.js` — el mecanismo *genérico* que consume el manifiesto: mapea `front → categoría` por identidad honesta o anulación gobernada explícita, y deriva los cinco ejes desde un enlace curado `evidenceClassLinkByRequirementId`. Este mecanismo ya es reusable en el sentido de que no está hardcodeado a Manizales — pero hoy sólo tiene datos de gobernanza curados (migraciones `064`/`066`) para la oportunidad Manizales.
- `agt002-integral-analysis-v3.js` — el validador puro cerrado, versión-agnóstico al proceso: no conoce "Manizales" en su lógica, sólo el `validationContext.evidenceStateManifest` que cada proceso debe proveer con cobertura 1:1.

**Conclusión honesta:** la capa de validación (`agt002-integral-analysis-v3.js`, `agt002-evidence-state-manifest.js`, `agt002-integral-category-manifest.js`) ya es proceso-agnóstica por diseño. La capa de origen del manifiesto (`agt002-manizales-manifest-source.js`) es, a propósito, un candado de un solo proceso — es el mecanismo fail-closed que impide que un segundo proceso "aparezca" sin paquete aprobado.

## 3. Diseño objetivo (no implementado): paquete por proceso

La tarea 3 del plan de fase 9 propone extraer, sin tocar el validador ni el contrato:

- **`agt002-integral-manifest-source.js`** — un despachador genérico indexado por `(opportunity_id, proceso)`, del que `agt002-manizales-manifest-source.js` pasaría a ser un **delegador compatible** (no se elimina; se conserva el nombre y comportamiento externo, delegando internamente al registry genérico).
- **`agt002-process-package.js`** — la forma de un paquete de proceso: manifiesto gobernado, catálogo de clases de evidencia aplicable, enlaces `evidenceClassLinkByRequirementId`, `categoryOverrides`, metadatos de curación (`rationale`, `source_reference`, `curated_by`, `curated_at`, `version` — el mismo patrón de procedencia ya exigido por la migración `066` para Manizales).
- **`agt002-process-onboarding-gate.js`** — el gate fail-closed: un paquete nuevo sólo se acepta si pasa validación estructural, tiene curación humana trazable y el flag de habilitación es explícito por proceso (no un flag global que active "cualquier proceso con manifiesto presente").
- **`data/agt002/processes/README.md`** + **`data/agt002/processes/_template/process.package.template.json`** — convención de carpeta: un directorio por proceso bajo `data/agt002/processes/<slug>/`, análogo a como Manizales vive hoy en `data/agt002/manizales-sa-24-2026.integral-manifest.v1.json`.

**Índice del registry:** por `(opportunity_id, proceso)`, igual que hace hoy el candado de Manizales — nunca por nombre de archivo ni por orden de registro. Retorna `null`/error cerrado salvo que existan simultáneamente: paquete aprobado + gate de onboarding completo + flag explícito para ese proceso puntual. El único registro inicial, el día que esto se implemente, debe seguir siendo Manizales — migrado como delegador, no reescrito.

## 4. Lo que este diseño explícitamente no resuelve todavía

- No define el schema JSON versionado del paquete (tarea 4 del plan) — eso incluye el envelope, `manifest_scope` y el paquete de proceso en `contracts/agents/AGT-002/v3/`.
- No implementa ningún código nuevo; `agt002-manizales-manifest-source.js` sigue siendo, hoy, el único punto de entrada real.
- No cambia el contrato de runtime V3 ya desplegado — cualquier paquete futuro debe producir un `evidenceStateManifest` con cobertura 1:1 igual de estricta que la que exige `agt002-integral-analysis-v3.js` hoy para Manizales; el validador no se relaja para procesos nuevos.

## 5. Invariante que sobrevive a la extracción

Sea cual sea la implementación futura de las tareas 3/4, debe preservar exactamente la propiedad que hoy prueba `agt002-manizales-manifest-source.js`: **ausencia de paquete aprobado + gate + flag para un `(opportunity_id, proceso)` dado implica `null`/excepción, nunca un manifiesto sintético o heredado de otro proceso.** Ver `docs/runbooks/agt002-process-onboarding-gate.md` para el procedimiento operativo que un humano debe seguir antes de que ese gate pueda pasar para un proceso nuevo, y `docs/architecture/agt002-human-review-policy.md` para la autoridad humana que sigue siendo obligatoria después de que el gate pase.
