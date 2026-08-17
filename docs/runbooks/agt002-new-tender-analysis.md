# AGT-002 — runbook operativo de una licitación nueva

**Fecha:** 2026-08-17 · **Alcance:** documental. Orquesta los runbooks y documentos ya creados en este bloque; no introduce mecanismos nuevos.

Este es el runbook de punta a punta: desde que el encargado de Licitaciones convierte un caso del Radar en oportunidad, hasta la promoción canonical de un análisis y, si hace falta, su rollback. No decide nada por sí mismo — cada paso delega en el documento o mecanismo que ya lo gobierna.

## Paso 0 — conversión de oportunidad (humano, fuera de AGT-002)

El encargado de Licitaciones selecciona manualmente un caso del Radar y lo convierte en Oportunidad. AGT-002 no participa en este paso y no puede iniciarlo — ver `docs/architecture/agt002-human-review-policy.md` §1.

## Paso 1 — ¿el proceso ya tiene paquete V3 aprobado?

- **Si el proceso es Manizales SA-24-2026** (`opportunity_id 54190e51-15fb-46af-b0aa-8f13461a3110`, proceso `SA-24-2026`): el paquete gobernado ya existe y el flag `AGT002_INTEGRAL_CONTRACT_V3` ya está activo en producción (confirmación externa registrada en `docs/evidence/2026-08-17-agt002-v3-production-closeout.md`). Continuar en el Paso 3.
- **Si es cualquier otro proceso:** no existe hoy paquete, gobernanza curada ni flag propio. `agt002-manizales-manifest-source.js` lo rechaza mecánicamente (`AGT002_MANIZALES_PILOT_SCOPE_MISMATCH`) antes de tocar el proveedor. Ir al Paso 2.

## Paso 2 — onboarding de un proceso nuevo (si aplica)

Seguir `docs/runbooks/agt002-process-onboarding-gate.md` completo: identificación, paquete de proceso, gate fail-closed, canary controlado, revisión humana y QA visual, promoción a canonical. Este paso requiere que las tareas 3/4 del plan de fase 9 (paquete reusable, registry, contrato JSON versionado) estén implementadas — hoy no lo están. Hasta entonces, un proceso nuevo se analiza únicamente con el camino V2 histórico, nunca forzando V3 con datos ad hoc.

## Paso 3 — preflight read-only antes de cualquier corrida

Confirmar, en orden, antes de invocar el motor:

- oportunidad, snapshot y documentos con identidades y hashes coincidentes;
- gobernanza curada completa y sin drift (filas `current=true` exactas, versión esperada);
- corpus jurídico publicado con hash válido, o ausencia explícita que fuerce abstención jurídica (nunca una afirmación de "supported" sin corpus);
- actor humano activo;
- cero claims activos y cero runs V3 previos no reconciliados para la oportunidad;
- bridge `active/running`, módulos desplegados byte-idénticos al commit productivo.

Este es el mismo preflight que cada corte de `CURRENT.md` ha exigido para Manizales; generalízalo al proceso objetivo sin omitir ningún punto.

## Paso 4 — canary único, sin retry ni fallback

Seguir `docs/runbooks/agt002-integral-v3-canary.md` §"Controlled single-run canary procedure" (o, para un proceso nuevo, la variante generalizada en `docs/runbooks/agt002-process-onboarding-gate.md` §4). Exactamente una invocación real; verificar `schema_version`, cobertura 1:1, citas de evidencia, abstención jurídica coherente y `human_review_required === true` antes de tratar la corrida como válida.

## Paso 5 — revisión humana

- Preguntas críticas presentadas sin ocultar el universo completo (`docs/architecture/agt002-human-review-policy.md` §3).
- Ninguna conclusión de cumplimiento automática — `compliance` permanece `unknown` salvo que exista una vía de escritura real que hoy no existe.
- QA visual autenticado con etiquetas reales antes de exponer la UI a cualquier usuario para ese proceso.

## Paso 6 — promoción canonical

Persistir con `canonicalOnly: true`; confirmar exactamente un canónico completado por oportunidad y que el canónico previo (si existía) quedó demovido, no eliminado. Este comportamiento está probado por la migración `067` (ver `docs/migrations/agt002-process-governance-ledger.md`).

## Paso 7 — decisión humana (GO/NO-GO)

Fuera de AGT-002 por completo. La existencia de un análisis completado o una recomendación condicionada no equivale a GO ni autoriza preparar o presentar una oferta — invariante transversal de todo el sistema, no específica de V3.

## Paso 8 — si algo falla: observabilidad y rollback

- Clasificar el fallo con los mecanismos de `docs/runbooks/agt002-observability-checklist.md` antes de reintentar — nunca reintentar a ciegas ante un `unavailable` o error de proveedor sin causa demostrada (patrón histórico: `CURRENT.md`, corte 2026-08-14, "no se reintentó ni se reconstruyó retrospectivamente ese motivo").
- Si la causa requiere revertir código, flag, migración o gobernanza curada, seguir `docs/runbooks/agt002-process-rollback.md` en el nivel mínimo suficiente — kill switch de flag antes que rollback de migración.

## Resumen de referencias

| Necesitas... | Ver |
|---|---|
| Qué existe hoy vs. qué falta construir | `docs/architecture/agt002-reusable-licitacion-architecture.md` |
| Aprendizajes de Manizales aplicables a cualquier proceso | `docs/architecture/agt002-lessons-learned.md` |
| Límites de autoridad de AGT-002 | `docs/architecture/agt002-human-review-policy.md` |
| Incorporar un proceso nuevo | `docs/runbooks/agt002-process-onboarding-gate.md` |
| Estado de observabilidad y huecos conocidos | `docs/runbooks/agt002-observability-checklist.md` |
| Revertir flag, código, migración o gobernanza | `docs/runbooks/agt002-process-rollback.md` |
| Estado y valores del flag/migraciones en producción | `docs/evidence/2026-08-17-agt002-v3-production-closeout.md` |
| Ledger completo de migraciones 061–067 | `docs/migrations/agt002-process-governance-ledger.md` |
