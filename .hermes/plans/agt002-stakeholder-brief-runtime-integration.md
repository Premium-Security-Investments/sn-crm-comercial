# AGT-002 — integración de runtime del stakeholder brief (primer corte)

**Baseline:** `main@87ad3bf47f6ec2f9b95da0eff20b65f07380239f` (SHA exacto de partida; toda esta rama se apoya sobre ese commit, nunca sobre un estado posterior no auditado).

**Contrato existente (sin cambios de forma en este corte):** `agt002-stakeholder-brief.js` (`validateAgt002StakeholderBrief` / `buildAgt002StakeholderBrief`).
**Config existente:** `agt002-analysis-config.js` (`buildAgt002AnalysisConfig`, `ANALYSIS_FLAG_NAMES`).
**Pruebas existentes que este corte extiende o respeta:** `tests/agt002-analysis-config.test.mjs`, `tests/agt002-stakeholder-brief.test.mjs`, `tests/agt002-integral-v3-server-wiring.test.mjs`.

## Alcance autorizado

Conectar el stakeholder brief como una **proyección de sólo lectura, local a la respuesta HTTP**, del envelope V3 canónico ya producido por `engine.analyze`. Toda la superficie nueva vive detrás de una bandera estricta y apagada por defecto: `AGT002_STAKEHOLDER_BRIEF_PREVIEW`.

Invariantes duras de este corte (no negociables):

- Sin escritura a base de datos para este artefacto: ninguna tabla nueva, ninguna columna nueva, ningún `INSERT`/`UPDATE`.
- Sin Radar, sin CRM: cero lectura y cero escritura hacia esas superficies desde el nuevo código.
- Sin `enqueue`/encolado y sin llamada a proveedor (Codex/bridge) adicional: el artefacto se deriva puramente del envelope que `engine.analyze` ya devolvió, nunca dispara un segundo análisis.
- Sin acción externa automática de ningún tipo (firma, envío, notificación, publicación).
- Sin mutación de GO/NO-GO: el brief nunca toca `go_no_go`, `recommendation`, `human_validation`/aprobación de ninguna otra superficie.
- Sin activación de ninguna otra feature: la bandera nueva sólo habilita esta proyección; no cambia el comportamiento de V3, Radar, CRM ni ninguna superficie existente.

## Tareas

### Tarea 1 — bandera estricta dependiente de V3

**Cambiar (fuera de este corte de RED; sólo se documenta aquí, la implementación va en un commit GREEN posterior):**
- `agt002-analysis-config.js`: agregar `AGT002_STAKEHOLDER_BRIEF_PREVIEW` a `ANALYSIS_FLAG_NAMES`, parseo con el mismo literal estricto exacto `'true'` que ya usa `AGT002_DECISION_AXIS_SURFACE` (nunca `'1'`, nunca sin distinción de mayúsculas, nunca con espacios), y una dependencia dura: `AGT002_STAKEHOLDER_BRIEF_PREVIEW` sólo puede encenderse si `AGT002_INTEGRAL_CONTRACT_V3` ya está encendida (que a su vez ya exige `AGT002_CANONICAL_ONLY` + `AGT002_CONTEXT_V2` + `AGT002_DOCUMENT_RETRIEVAL`). Encenderla sin V3 debe fallar cerrado (`throw`) en `buildAgt002AnalysisConfig`, igual que las dependencias ya existentes.

**RED (este corte):** ver `tests/agt002-analysis-config.test.mjs` §"AGT002_STAKEHOLDER_BRIEF_PREVIEW".

### Tarea 2 — adaptador puro nuevo

**Crear (implementación GREEN, fuera de este corte):**
- `agt002-stakeholder-brief-preview.js`: exporta `buildAgt002StakeholderBriefPreview({ enabled, canonicalEnvelope, governedInput })`, función pura y síncrona (sin I/O, sin reloj, sin aleatoriedad).
  - `enabled=false` ⇒ `{ status: 'disabled', stakeholder_brief: null, missing_inputs: [] }` sin inspeccionar `canonicalEnvelope` ni `governedInput` (corto-circuito total).
  - `enabled=true` sin `governedInput` completo ⇒ `{ status: 'unavailable', stakeholder_brief: null, missing_inputs: [...] }`, fail-closed, nunca lanza.
  - `enabled=true` con `governedInput` y `canonicalEnvelope` completos ⇒ deriva `integralAnalysisUnits`/`allowlist` (por `source_type`) a partir de `canonicalEnvelope.analysis_units`, arma los cinco bloques (`process_summary`, `timeline`, `questionnaire_cross_check`, `requirements_checklist`, `treatment_plan`) y los pasa por el validador ya existente `validateAgt002StakeholderBrief` antes de devolverlos. `human_review_required` siempre `true`; toda acción del plan de tratamiento siempre `external_side_effect: false`.
  - Envelope no-V3/no-canónico, opportunity id mixto (`governedInput.opportunityId` vs `governedInput.opportunity.id`), `source_unit_id` de la checklist que no exista entre las unidades del envelope, o citación que no pertenezca a las propias `evidence_refs` de su unidad ⇒ falla cerrado (`throw`), reusando exactamente las mismas invariantes que `agt002-stakeholder-brief.js` ya impone.
  - Nunca reimplementa las reglas de `agt002-stakeholder-brief.js`: sólo arma y valida contra ellas.

**RED (este corte):** `tests/agt002-stakeholder-brief-preview.test.mjs`.

### Tarea 3 — wiring local a la respuesta, después de `engine.analyze`

**Cambiar (implementación GREEN, fuera de este corte):**
- `server/index.js` y `api/[...path].js` (deben seguir siendo byte-idénticos): dentro de `requestAgt002`, inmediatamente después de `const envelope = await engine.analyze(...)` y antes de `await registerAgt002PreviewAnalysis(...)`, invocar `buildAgt002StakeholderBriefPreview({ enabled: agt002AnalysisConfig.AGT002_STAKEHOLDER_BRIEF_PREVIEW, canonicalEnvelope: envelope, governedInput: ... })`.
- El resultado se usa **sólo** para observabilidad/telemetría local a esa invocación (p. ej. incluido en el valor de retorno de `requestAgt002` o en un log), **nunca** se agrega al payload que recibe `registerAgt002PreviewAnalysis`, nunca se persiste, nunca dispara Radar/CRM/enqueue.
- Único flujo tocado en este primer corte: `requestAgt002` (el flujo canónico durable). La ruta HTTP legacy `/api/tender-documents-analyze-agent-preview` queda fuera de alcance.

**RED (este corte):** `tests/agt002-stakeholder-brief-server-wiring.test.mjs`.

### Tarea 4 — pruebas, revisión y PR

- Extender `tests/agt002-analysis-config.test.mjs` (bandera nueva).
- Crear `tests/agt002-stakeholder-brief-preview.test.mjs` (contrato del adaptador nuevo).
- Crear `tests/agt002-stakeholder-brief-server-wiring.test.mjs` (contrato estático del wiring en ambos backends).
- Tras la implementación GREEN correspondiente: `node --test tests/agt002-analysis-config.test.mjs tests/agt002-stakeholder-brief.test.mjs tests/agt002-stakeholder-brief-preview.test.mjs tests/agt002-stakeholder-brief-server-wiring.test.mjs tests/agt002-integral-v3-server-wiring.test.mjs`, revisión independiente por bloque, PR pequeño con la bandera apagada por defecto.

## Explícitamente fuera de alcance de este corte

- **Flags-on**: no se activa `AGT002_STAKEHOLDER_BRIEF_PREVIEW` en ningún ambiente; sigue apagada por defecto en todos lados.
- **Recuperación de producción 5/5/5**: ningún caso real de Rama Manizales ni de ningún otro piloto se ejecuta ni se valida contra este corte.
- **Exposición en UI**: ninguna pantalla, componente ni endpoint de lectura para humanos consume este artefacto todavía.
- **Persistencia**: no hay tabla, columna, migración ni almacenamiento de ningún tipo para el stakeholder brief.
- **Radar/CRM**: cero integración, cero lectura, cero escritura, cero sincronización con esas superficies.

## RED de este corte (sin cambios de producción)

1. `tests/agt002-analysis-config.test.mjs`: `AGT002_STAKEHOLDER_BRIEF_PREVIEW` apagada por defecto/con valores mal formados (incluyendo `'1'`, `'TRUE'`, espacios, booleano `true`), sólo el literal exacto `'true'` la habilita, encenderla sin `AGT002_INTEGRAL_CONTRACT_V3` falla cerrado, y encenderla junto con `AGT002_CANONICAL_ONLY`+`AGT002_CONTEXT_V2`+`AGT002_DOCUMENT_RETRIEVAL`+`AGT002_INTEGRAL_CONTRACT_V3` funciona.
2. `tests/agt002-stakeholder-brief-preview.test.mjs`: contrato completo de `buildAgt002StakeholderBriefPreview` (deshabilitado, sin input gobernado, éxito con fixture sintético compacto, rechazo de envelope no-V3, id de oportunidad mixto, `source_unit_id` colgante, citación no propia de la unidad; determinismo y pureza).
3. `tests/agt002-stakeholder-brief-server-wiring.test.mjs`: contrato estático (texto fuente) de que `server/index.js` y `api/[...path].js` importan el adaptador, `requestAgt002` lo invoca exactamente entre `engine.analyze` y `registerAgt002PreviewAnalysis`, recibe la bandera y el envelope correctos, y su resultado nunca entra al payload de `registerAgt002PreviewAnalysis` ni aparece junto a ningún patrón de persistencia/Radar/CRM/enqueue.
