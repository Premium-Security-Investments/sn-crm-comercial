# AGT-002 Phase 9 — Consolidación postproducción

> **Para Hermes:** ejecutar tarea por tarea, con cambios fail-closed, QA mecánico e inspección independiente antes de publicar.

**Objetivo:** dejar AGT-002 organizado, documentado y preparado para incorporar futuras licitaciones sin copiar Manizales ni habilitar procesos automáticamente.

**Arquitectura:** conservar Manizales como único proceso V3 habilitado y extraer únicamente rieles genéricos: paquete por proceso, validador/registry fail-closed, gate de onboarding, contrato JSON V3, observabilidad y política de revisión humana. Toda incorporación futura exige paquete aprobado, flag explícito y revisión humana.

**Base productiva:** `main` `960a96702e869531aad94545c137e1b3fe28c0b0`; migración 067 aplicada; Vercel Ready; flag V3 activo; canonical Manizales `3.0.0` / `agt002-integral-analysis-v3`; suite focal 410/410.

---

## Invariantes

1. Manizales SA-24-2026 sigue siendo el único proceso V3 habilitado.
2. Ningún request ni modelo controla `manifest_scope`.
3. Sin evidencia existe abstención; `compliance` permanece `unknown`.
4. AGT-002 no decide cumplimiento ni GO/NO-GO.
5. Un nuevo proceso requiere paquete validado, aprobación humana y habilitación explícita.
6. No se eliminan worktrees con cambios locales, ramas no fusionadas ni commits detached ambiguos.
7. No se despliega runtime ni se modifica producción en esta fase sin un cambio funcional probado y una autorización específica posterior.

## Tarea 1 — Verdad actual y evidencia productiva

**Modificar:** `CURRENT.md`, `docs/verification/2026-08-15-agt002-manizales-v3-pilot.md`, `docs/runbooks/agt002-integral-v3-canary.md`.

**Crear:** `docs/evidence/2026-08-17-agt002-v3-production-closeout.md`.

- Sustituir el corte autoritativo obsoleto.
- Corregir rollback: merge `960a967`, migración real `067_agt002_integral_v3_persistence.sql`, rollback `supabase/rollbacks/067_agt002_integral_v3_persistence_rollback.sql`.
- Registrar pruebas y distinguir evidencia mecánica de confirmaciones externas.
- Marcar el plan original como histórico/superseded sin reescribir su intención pre-gate.

## Tarea 2 — Aprendizajes y decisiones

**Crear:**
- `docs/architecture/agt002-lessons-learned.md`
- `docs/architecture/agt002-reusable-licitacion-architecture.md`
- `docs/architecture/agt002-human-review-policy.md`

Documentar evidencia-o-abstención, vigencia/aplicabilidad, fuentes/versiones/hashes, autoridad humana, límites de cobertura y compatibilidad V2/V3.

## Tarea 3 — Paquete reusable y registry fail-closed

**Crear/modificar:**
- `agt002-integral-manifest-source.js`
- `agt002-process-package.js`
- `agt002-process-onboarding-gate.js`
- `agt002-manizales-manifest-source.js` como delegador compatible
- `data/agt002/processes/README.md`
- `data/agt002/processes/_template/process.package.template.json`
- pruebas unitarias específicas.

El registry se indexa por `(opportunity_id, proceso)` y retorna `null`/error cerrado salvo paquete aprobado + gate completo + flag explícito. El único registro inicial es Manizales.

## Tarea 4 — Contrato JSON V3

**Crear:** `contracts/agents/AGT-002/v3/` con schemas de envelope, `manifest_scope` y paquete de proceso; agregar prueba JS↔JSON de acuerdo.

No cambiar el contrato runtime; el schema debe reflejarlo.

## Tarea 5 — Runbooks operativos

**Crear:**
- `docs/runbooks/agt002-process-onboarding-gate.md`
- `docs/runbooks/agt002-observability-checklist.md`
- `docs/runbooks/agt002-process-rollback.md`
- `docs/runbooks/agt002-new-tender-analysis.md`

Cubrir desde identificación del proceso hasta canary, revisión humana, promoción canonical y rollback.

## Tarea 6 — Migraciones y rollback

**Crear:** `docs/migrations/agt002-process-governance-ledger.md`.

- Registrar 061/063/064/066/067 y rollback real.
- Crear rollback de 062 sólo si la inversión exacta puede probarse mecánicamente; de lo contrario documentar su ausencia y no inventarla.
- No aplicar migraciones en producción.

## Tarea 7 — Observabilidad runtime

- Probar primero los huecos: prompt budget no activado y worker durable sin diagnóstico post-bridge equivalente.
- Implementar la corrección mínima conservando paridad `server/index.js` / `api/[...path].js`.
- Añadir tests estáticos/integración.
- No registrar payloads ni PII.

## Tarea 8 — Revisión humana y cobertura honesta

- Añadir/usar subconjunto de preguntas críticas sin ocultar preguntas completas.
- Corregir representación de cobertura sólo si un test demuestra que confunde contrato analizado con universo documental.
- Mantener todas las decisiones como humanas.

## Tarea 9 — Inventario y limpieza

**Crear:** `docs/operations/2026-08-17-agt002-branch-worktree-inventory.md`.

- Clasificar cada worktree: actual, candidato seguro, fusionado con cambios, no fusionado, detached.
- Eliminar sólo worktrees fusionados, limpios, no operativos y con commit alcanzable desde `main`.
- Preservar `/root/worktrees/siio-e6-scheduler-fix` (`main`), cualquier dirty, cualquier no fusionado y todo detached ambiguo.
- Borrar una rama sólo después de remover su worktree y volver a confirmar `merge-base --is-ancestor`.

## Tarea 10 — QA y cierre

- `git diff --check`
- TypeScript `--noEmit`
- paridad backend
- tests nuevos
- `node --test --test-concurrency=1 tests/agt002-*.test.mjs`
- build
- escaneo de secretos
- verificación desde estado limpio
- revisión independiente del diff completo

**Criterio de cierre:** documentación consistente con producción; Manizales único proceso habilitado; paquete/gate/schema reutilizables probados; observabilidad sin huecos materiales conocidos; inventario seguro; cero cambios locales sin explicar; commit publicado en `main` sólo tras QA verde.
