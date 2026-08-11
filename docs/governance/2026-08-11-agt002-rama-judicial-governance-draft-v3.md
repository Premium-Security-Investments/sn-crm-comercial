# AGT-002 gobernanza — borrador DRAFT / HUMAN_APPROVAL_REQUIRED — Rama Judicial `54190e51-15fb-46af-b0aa-8f13461a3110` — versión 3

**Estado: `DRAFT`, versión 3. Requiere aprobación humana final antes de convertirse en filas curadas reales.**
**Este documento y el JSON que describe NUNCA deben citarse como base de una decisión de negocio ni cargarse a runtime tal cual.**

- Artefacto: `docs/governance/drafts/agt002-rama-judicial-54190e51-15fb-46af-b0aa-8f13461a3110.v1.json` (`version: 3` dentro del JSON; el nombre de archivo no cambia entre versiones del borrador — el campo `version` es la fuente de verdad).
- Decisión humana implementada: `docs/governance/2026-08-11-agt002-rama-judicial-human-review.md` (HR-001 a HR-004), estado de la revisión `HUMAN_REVIEW_COMPLETE_PENDING_TECHNICAL_IMPLEMENTATION`.
- Historia previa: `docs/governance/2026-08-07-agt002-rama-judicial-governance-draft.md` (versiones 1 y 2 — reconciliación snapshot↔documentos↔chunks completa, sin cambios en esta sesión).
- Validador: `agt002-governance-draft-proposal.js` (`validateAgt002GovernanceDraftProposal`).
- Generador reproducible (solo lectura): `scripts/agt002-rama-judicial-governance-draft-generate.mjs`.
- Extractor: `tender-requirement-extraction.js` — nuevas funciones `extractLegalRcePolicy`, `extractLegalCollectiveLifePolicy`, `extractGovernedLegalRequirements`, `buildGovernedRequirementAnalysis` (aditivas; `extractLegalRequirements`/`extractLegalGuaranteePolicy`/`buildRequirementAnalysis` — el flujo v2 genérico — quedan sin ningún cambio de comportamiento).
- Tests: `tests/agt002-governed-legal-policy-split-extraction.test.mjs` (extractor, RED→GREEN), `tests/agt002-rama-judicial-governance-draft-generate-static.test.mjs` (tablas curadas del generador, RED→GREEN), `tests/agt002-governance-draft-proposal.test.mjs`, `tests/agt002-governance-draft-proposal-runtime-isolation-static.test.mjs`, `tests/tender-requirement-extraction.test.mjs`, `tests/tender-requirement-analysis.test.mjs` (v2, sin cambios de resultado).
- Rama: `feat/agt002-v3-foundations`.
- Fecha: 2026-08-11.
- Alcance de esta sesión: TDD RED→GREEN sobre el extractor y el generador; regeneración **solo lectura** contra Supabase (service role, `select`/`eq`/`order` únicamente) desde las 17 versiones vigentes reales; cero escritura remota, cero RPC con efecto, cero migración, cero canary, cero modelo productivo, cero commit/push/PR/merge/deploy.

## 0. Qué cambió de la versión 2 a la versión 3

La versión 2 (2026-08-08) cerró la brecha de cobertura de documentos (3/17 → 17/17) pero mantuvo el requisito genérico `legal-guarantee-policy`, vinculado a ambas pólizas (RCE y vida colectiva) mediante el patrón genérico `/polizas?/` y forzado a una **abstención** en el eje `evidence_class_link` porque un único enlace no podía representar honestamente dos clases distintas del catálogo de 17.

La revisión humana registrada el 2026-08-11 (`docs/governance/2026-08-11-agt002-rama-judicial-human-review.md`, decisión HR-003) aprobó explícitamente dividir ese requisito genérico en dos requisitos cerrados y trazables:

- `legal-rce-policy` → `category_override: habilitating` → `evidence_class_link: rce_policy`.
- `legal-collective-life-policy` → `category_override: habilitating` → `evidence_class_link: collective_life_policy`.

Esta versión 3 implementa esa decisión técnicamente, siguiendo TDD estricto RED→GREEN (evidencia en `/tmp/agt002-policy-split-red.log` y `/tmp/agt002-policy-split-green.log` de la sesión de implementación):

1. **Extractor (`tender-requirement-extraction.js`).** Dos nuevas funciones de extracción, `extractLegalRcePolicy`/`extractLegalCollectiveLifePolicy`, clasifican por **contexto textual real** — la frase `"responsabilidad civil extracontractual"` y el patrón `vida colectiv[oa]` respectivamente — nunca por el patrón genérico `/polizas?/` ni por un modelo/LLM. Ninguna de las dos funciones nuevas toca `extractLegalGuaranteePolicy`/`extractLegalRequirements`/`buildRequirementAnalysis`: ese camino (usado por el flujo v2 de preanálisis por reglas, `tender-deep-analysis.js` → `server/index.js`/`api/[...path].js`, para *cualquier* oportunidad del producto, no solo esta) queda exactamente igual — verificado con los mismos tests `tests/tender-requirement-extraction.test.mjs`/`tests/tender-requirement-analysis.test.mjs` de siempre, sin ninguna modificación, ejecutándose en verde. Esa es la compatibilidad v2 explícita que pedía la tarea: en vez de una proyección sintética hacia `legal-guarantee-policy` (que habría tenido que fusionar honestamente dos clases de evidencia distintas bajo un solo id, contradiciendo la propia decisión HR-003), se optó por dejar el camino v2 **intacto y no invocado** por el flujo gobernado, que ahora usa un punto de entrada dedicado (`buildGovernedRequirementAnalysis`, aditivo). No existe hoy ningún consumidor real (no de prueba, no histórico) que dependa de recibir `legal-guarantee-policy` desde el flujo gobernado; si alguno apareciera, el manifiesto/borrador rechazarían (fail-closed) cualquier intento de mezclar ids incompatibles, porque `validateAgt002RequirementManifest`/`validateAgt002GovernanceDraftProposal` exigen cobertura exacta 1:1 por eje contra los ids realmente presentes en el manifiesto — nunca aceptan un id no declarado ni lo sintetizan.
2. **Exclusión de garantías posteriores de ejecución del contrato (HR-002/HR-003).** Ambas funciones nuevas descartan, dentro de una ventana de contexto local alrededor de cada coincidencia (100 caracteres a cada lado — mismo patrón de diseño que `hasOperatorNear`/`findValuesNear` ya usados por el extractor), cualquier mención que aparezca junto a lenguaje de "ejecución del contrato" o "posterior(es) a la adjudicación" (el estilo de la sección 110, cronograma, del pliego). Esto es estructural (código, cubierto por test unitario con fixture sintético que mezcla una mención habilitante válida y una de post-adjudicación en el mismo documento — `tests/agt002-governed-legal-policy-split-extraction.test.mjs`), no solo una advertencia documental como en las versiones 1-2. En los datos reales de esta oportunidad, la sección 110 (`chunk:db9752a1...s110`) no aparece en ninguna de las citas de `legal-rce-policy`/`legal-collective-life-policy` de esta versión 3 — verificado por `section === 110` sobre el JSON regenerado.
3. **Generador (`scripts/agt002-rama-judicial-governance-draft-generate.mjs`).** Ahora llama a `buildGovernedRequirementAnalysis` (no a `buildRequirementAnalysis`) e importa los patrones de citación (`AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS`) directamente del extractor en vez de mantener una copia privada duplicada. Las tablas curadas (`CATEGORY_OVERRIDE_PROPOSALS`, `EVIDENCE_CLASS_LINK_PROPOSALS`, `ABSTENTIONS`) se actualizaron para reflejar HR-001/HR-003/HR-004 exactamente — verificado por `tests/agt002-rama-judicial-governance-draft-generate-static.test.mjs` (RED contra la versión anterior del script, GREEN después del cambio).
4. **Manifiesto/matriz (`agt002-deep-analysis-matrix.js`) y validador de contrato v3 (`agt002-integral-analysis-v3.js`).** Sin cambios — ambos son agnósticos al `requirement_id` concreto (operan sobre lo que el manifiesto gobernado declare), así que el manifiesto de 4 requisitos de esta versión 3 pasa por ellos sin modificación de código.

## 1. Regeneración real ejecutada en esta sesión

Mismo pipeline determinístico de la versión 2 (reconstrucción local de chunks desde `psi_tender_document_versions.extracted_text`, reconciliada contra `psi_tender_document_chunks`; ver `docs/governance/2026-08-07-agt002-rama-judicial-governance-draft.md` §2-3 para el detalle completo de esa reconciliación, sin cambios en esta sesión), con la única diferencia de que el paso de extracción de requisitos ahora usa `buildGovernedRequirementAnalysis` en vez de `buildRequirementAnalysis`.

Resultado real (`coverage`): `total: 4, confirmed: 0, partial: 3, indication: 1` (antes: `total: 3, confirmed: 0, partial: 2, indication: 1`). `financial-working-capital` y `technical-video-surveillance-scope` no cambiaron de estado (`partial` e `indication` respectivamente, misma limitación conocida del patrón financiero y misma calidad de evidencia CCTV documentadas en la versión 2). Los dos requisitos nuevos:

| `requirement_id` | estado | confianza | citas de chunk |
|---|---|---|---|
| `legal-rce-policy` | `partial` | `medium` | 9 |
| `legal-collective-life-policy` | `partial` | `medium` | 27 |

Ambos quedan `partial` (se encontró la mención de la póliza, pero no la combinación explícita de cuantía/porcentaje **y** vigencia dentro de la ventana de materialidad del extractor para ninguna coincidencia individual) — la misma disciplina que ya aplicaba `legal-guarantee-policy` en las versiones 1-2; la subdivisión no relaja ni inventa esa exigencia.

## 2. Cobertura de este borrador (versión 3)

Los 4 requisitos del `requirement_manifest` están cubiertos **exactamente una vez** en cada uno de los dos ejes gobernados (propuesta o abstención, nunca ambas, nunca ninguna) — verificado por `validateAgt002GovernanceDraftProposal`:

| `requirement_id` | `category_override` | `evidence_class_link` |
|---|---|---|
| `financial-working-capital` | propuesta: `habilitating` | propuesta: `rup` |
| `legal-rce-policy` | propuesta: `habilitating` | propuesta: `rce_policy` |
| `legal-collective-life-policy` | propuesta: `habilitating` | propuesta: `collective_life_policy` |
| `technical-video-surveillance-scope` | **abstención** | **abstención** |

La abstención que existía en la versión 2 (`legal-guarantee-policy` / `evidence_class_link` / `multiple_distinct_classes_matched_single_requirement`) desaparece: la ambigüedad que la motivaba queda resuelta por la propia subdivisión del requisito, no por una reinterpretación de la evidencia. Las dos abstenciones de `technical-video-surveillance-scope` (HR-004) permanecen exactamente iguales, sin cambios de texto ni de fundamento.

## 3. Qué NO cambia

- El estado `status: "DRAFT"` y `human_approval_required: true` — estructuralmente obligatorios, sin excepción.
- La barrera estructural contra uso accidental (`buildAgt002IntegralGovernanceOverrides` rechaza esta forma por falta de `curated_by`/`curated_at`).
- El aislamiento runtime del generador (`tests/agt002-governance-draft-proposal-runtime-isolation-static.test.mjs`) — el script sigue sin estar importado desde ningún camino de producción.
- La migración `064` — sigue sin otorgar `INSERT`/`UPDATE`/`DELETE` a ningún rol.
- El alcance del extractor: `tender-requirement-extraction.js` sigue sin ser un extractor semántico exhaustivo del pliego (`extractor_scope_is_not_full_pliego_coverage`, actualizado en esta versión para nombrar los 4 ids vigentes). Una revisión humana exhaustiva del registro completo del pliego (más allá de estos 4 requisitos) es un *gate* separado, explícitamente fuera del alcance de esta sesión.

## 4. Qué debe hacer un humano con esto

1. Confirmar que la clasificación por contexto real (RCE vs. vida colectiva) y la exclusión de garantías posteriores de ejecución del contrato reflejan correctamente su lectura del pliego (HR-002/HR-003), releyendo las 9 + 27 citas de chunk de esta versión si lo considera necesario.
2. Confirmar que ninguna cita de `legal-rce-policy`/`legal-collective-life-policy` corresponde en realidad a una garantía posterior a la adjudicación que el extractor no haya detectado (falso negativo de la exclusión) — la exclusión es un patrón de contexto acotado (100 caracteres), no una lectura semántica completa de la cláusula.
3. Si aprueba, autorizar una migración/curación real (nunca RPC en runtime) que inserte 4 filas en `psi_agt002_integral_governance_overrides` con `curated_by`/`curated_at`/`rationale`/`source_reference`/`version` reales, replicando (o corrigiendo) el contenido de esta versión 3.
4. Autorizar, por separado, si procede, una revisión humana exhaustiva del registro completo del pliego (más allá de los 4 requisitos que este extractor cerrado reconoce) — explícitamente no cubierta ni por esta versión ni por las anteriores.
5. Este documento y el JSON asociado deben conservarse como evidencia de auditoría de esa decisión, independientemente de si se aprueba tal cual, se corrige o se rechaza.
