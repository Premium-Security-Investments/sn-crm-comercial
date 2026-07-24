# Task 1 — SIIO Tender Decision Foundation

## Estado

**DONE_WITH_CONCERNS**

## Alcance entregado

Se congeló AGT-002 v1 mediante una prueba de hash byte-a-byte y se añadió la frontera consumidora sintética de AGT-002 v2-draft. No se modificó ningún archivo de `contracts/agents/AGT-002/v1`, no se llamó ningún proveedor y no se añadieron rutas, migraciones ni despliegues.

## Archivos

- `agt002-tender-adapter.js` — adaptador proveedor-neutral y respondedor sintético.
- `contracts/agents/AGT-002/v2-draft/analysis-run.request.schema.json` — snapshot SIIO de entrada cerrado.
- `contracts/agents/AGT-002/v2-draft/analysis-run.response.schema.json` — envelope de salida cerrado, con revisión humana obligatoria.
- `tests/agt002-tender-analysis-contract.test.mjs` — prueba TDD del pin v1, del envelope, del respondedor y de los esquemas.
- `.superpowers/sdd/task-1-report.md` — este reporte.

## Commit(s)

- `8cb9384ac809902247c5748a09e9b851362e16b5` — `test(agents): define AGT-002 tender analysis boundary`

## Evidencia RED (TDD)

1. Con la prueba de contrato inicial y antes de crear el adaptador:
   - Comando: `node tests/agt002-tender-analysis-contract.test.mjs`
   - Resultado: salida 1 esperada con `ERR_MODULE_NOT_FOUND` para `agt002-tender-adapter.js`.
2. Tras ampliar la prueba para exigir los esquemas y antes de crear `v2-draft`:
   - Comando: `node tests/agt002-tender-analysis-contract.test.mjs`
   - Resultado: salida 1 esperada con `ENOENT` para `analysis-run.request.schema.json`.

## Comandos y resultados GREEN

- `node tests/agt002-tender-analysis-contract.test.mjs`
  - PASS: `AGT-002 tender analysis consumer contract passed`
- `node tests/agent-contracts-p1a.test.mjs`
  - PASS: `P1A SIIO agent contracts OK`
- `npm run build`
  - PASS: `tsc && vite build`, compilación completada.
- `git diff --check`
  - PASS: sin errores de whitespace.

## Auto-revisión

- El pin SHA-256 de `manifest.json`, `analysis.request.schema.json` y `analysis.response.schema.json` de AGT-002 v1 coincide con `b42efca7952e917da93c551400efaa71db7c8fa0c69a8c74b6fb4980782ca82e`.
- El adaptador rechaza productor distinto de `AGT-002`, UUID inválidos, estado/método incompatibles, recomendación fuera de allowlist, objetos extra, uso inválido y revisión humana no obligatoria.
- Cada objeto declarado por los esquemas v2-draft tiene `additionalProperties: false`; todos los items de hallazgos/preguntas exigen `id`, `text`, `critical` y `evidence_refs`.
- El respondedor es sintético (`provider`/`model`: `synthetic`), no realiza I/O de red ni invoca proveedores, y siempre devuelve `human_review_required: true`.
- La revisión del diff confirma que no hubo cambios en `contracts/agents/AGT-002/v1`.

## Preocupaciones

- El build pasó con el warning preexistente de Vite por un chunk JavaScript de más de 500 kB; no está relacionado con esta tarea.
- El brief fija los contenedores `documents` y `company_profile` pero no define su taxonomía interna. Los esquemas v2-draft los mantienen cerrados como objetos vacíos para cumplir la exigencia de cierre estricto. Una futura versión del contrato deberá especificar sus campos antes de aceptar snapshots no vacíos en esos contenedores.

## Fix Review — 2026-07-24

### Hallazgos corregidos

- `analysis-run.request.schema.json` ahora define una taxonomía mínima, cerrada y utilizable: cada documento requiere `document_id`, `name`, `document_type`, `content`, `content_sha256` y `current`; `company_profile` requiere `profile_version` y `fields` cerrados con `key`, `label`, `value` y `source` (`string|null`). Los hashes y UUIDs tienen patrones explícitos equivalentes al validador.
- `validateAgt002TenderAnalysisRequest` se exporta desde el adaptador y valida exactamente las claves, UUIDs, hashes, arrays y objetos anidados requeridos por la request schema.
- El adaptador de producción ya no importa `randomUUID` ni fabrica envelopes. `buildSyntheticAgt002TenderAnalysis` quedó exclusivamente en `tests/fixtures/agt002-synthetic-responder.mjs`, importado sólo por la prueba de contrato.
- El plan de Task 1 ahora describe la taxonomía y deja explícito que el fixture sintético no es runtime ni representa una corrida institucional.

### Evidencia RED/GREEN

- **RED 1:** tras mover la importación de la prueba al fixture que aún no existía, `node tests/agt002-tender-analysis-contract.test.mjs` terminó con `ERR_MODULE_NOT_FOUND` para `tests/fixtures/agt002-synthetic-responder.mjs` (exit 1).
- **RED 2:** tras exigir patrones UUID explícitos en la schema, el mismo comando falló con `actual: undefined` frente al patrón UUID esperado (exit 1).
- **GREEN:** `node tests/agt002-tender-analysis-contract.test.mjs` → `AGT-002 tender analysis consumer contract passed`.
- **GREEN:** `node tests/agent-contracts-p1a.test.mjs` → `P1A SIIO agent contracts OK`.
- **GREEN:** `npm run build` → `tsc && vite build` completado; persiste únicamente el warning preexistente de chunk >500 kB.
- **GREEN:** `git diff --check` sin errores; `git diff 8cb9384 -- contracts/agents/AGT-002/v1` sin salida; la búsqueda de `buildSyntheticAgt002TenderAnalysis` fuera de `tests/**` y `docs/**` no devolvió resultados.

### Commit y auto-revisión

- Fix commit: `76c05e938fe11eb4e89d17be6fb49706a44a4a23` — `fix(agents): validate closed AGT-002 tender snapshots`.
- Auto-revisión: se confirmó que el runtime sólo exporta validadores, que cada nivel nuevo de la request schema usa `additionalProperties: false`, que los rechazos cubren claves extra, hashes en mayúscula, tipos anidados y campos obligatorios vacíos, y que no se modificó AGT-002 v1.
