# Handoff AGT-002 R1 incremental — supersedido y detenido

## Identidad

```text
AGENTE: AGT-002 / Vig-IA Licitaciones
PROYECTO: R1 — reanálisis incremental
FECHA_CORTE_UTC: 2026-10-09T20:43:01Z
OBJETIVO: cerrar con evidencia el candidato incremental después de una decisión posterior del dueño
REPOSITORIO: Premium-Security-Investments/sn-crm-comercial
RAMA: feat/agt002-r1-implementation-20261008
COMMIT_SHA: 42407c4b1a924adfc187aeaf935c2e463be72f22
PR: #333 — CLOSED, no fusionado
ESTADO_DEL_TRABAJO: superseded; rama preservada; C8 cancelado; producción incremental no autorizada
```

Baseline original del candidato: `origin/main@1fe2c334de92028aacda17af634e5e51a0968891`.
`origin/main` observado después del cierre: `1ee527a2ee9f60169a552862319103975dc079c3`.

## Cambios realizados

La rama preserva código aislado para ledger append-only, manifiesto delta-only, ingreso gobernado de
señales, cola durable, cierre terminal, despacho HMAC por evento, recuperación acotada y proyección
R1. También contiene la corrección de aislamiento del dispatcher R1 del puerto dedicado AGT-003:
R1 usa `8789`; AGT-003 conserva `8788`.

Módulos y artefactos principales:

- `agt002-incremental-*.js` y adaptaciones de executor/input/persistence;
- `server/index.js` y `api/[...path].js` en paridad;
- `supabase/migrations/116_agt002_incremental_reanalysis_r1.sql` y su rollback;
- `ops/agt002-reanalysis-worker/` y `ops/agt002-radar-scan/`;
- proyección UI en `src/tenders/`;
- pruebas `tests/agt002-incremental-*.test.mjs` y contratos relacionados;
- recibo histórico `docs/evidence/2026-10-08-agt002-r1-c7-local-verification.md`.

## Pruebas y resultados

- Build local (`corepack pnpm run build`): `passed`, exit 0.
- Sintaxis de ambos backends, paridad byte-exacta y `git diff --check`: `passed`.
- Conjunto enfocado R1 de 18 archivos, incluida migración 116 en PGlite: `passed`, 18/18.
- Contratos de aislamiento AGT-002/AGT-003 después de mover R1 a 8789: `passed`, 2/2.
- Contratos R1 de systemd/dispatch/wrapper después de mover el puerto: `passed`, 3/3.
- CI del PR #333 para SHA `42407c4...`:
  - `production_build`, `backend_parity`, `migration_static`, `grants_security`, `f0_suite`,
    `agt003_boundary` y Vercel preview: `passed`;
  - `agt002_suite`: `failed` en run `37841656350`, job `113532244246`;
  - causa exacta del fallo remoto: `por confirmar` porque el log del job no estuvo disponible en el
    readback posterior;
  - `release_receipt` y `drift_alert`: `skipped` por el fallo de la suite.
- El preview Vercel del PR #333 quedó `READY` para el SHA del PR. No hubo readback de los flags R1;
  su estado efectivo en ese preview queda `por confirmar`.

## Decisión posterior y reemplazo

El PR #333 fue cerrado sin merge. El comentario de cierre del dueño, registrado el
`2026-10-09T00:45:03Z`, establece que el análisis incremental queda descartado por ahora y que cada
tanda nueva de documentos dispara reanálisis completo mediante PR #332.

PR #332 fue fusionado el `2026-10-08T21:06:14Z` con merge commit
`13b33730ecd3286ad8165f70c420709e2a52c5db`; todos sus checks reportados terminaron en `SUCCESS`.
Su estado de despliegue u operación en producción es `por confirmar`: merge y CI no lo demuestran.

La rama R1 no es mergeable mecánicamente contra el `main` actual. Además del cambio de producto,
hay una colisión nominal de migración: esta rama usa el número `116` para R1 incremental, mientras
`main` ya contiene `116_agt002_retire_republished_tender_documents.sql` proveniente de #332.

## Ambiente, artefactos, riesgos y límites

- Ambiente modificado por esta rama: repositorio Git y preview efímero de Vercel del PR #333.
- No se aplicó la migración incremental a producción.
- No se desplegó el worker/dispatcher incremental al host.
- No se habilitaron flags R1, timer, cola masiva ni canario incremental.
- No se emitió `AGT002_INCREMENTAL_E2E_ACCEPTED`.
- No se abrió Plataforma Agentes Fase 2 ni P3.2.
- No borrar ni rebasar la rama: conserva evidencia técnica, pero no es una fuente operativa vigente.

## Pendientes y siguiente paso

No queda trabajo autorizado sobre R1 incremental. Cualquier reactivación futura requiere una nueva
decisión del dueño, reconciliación completa contra `main`, nuevo número de migración, contrato
actualizado y gates técnicos nuevos. Mientras tanto, la fuente vigente es #332/main y su operación
real debe verificarse por separado antes de afirmarla.
