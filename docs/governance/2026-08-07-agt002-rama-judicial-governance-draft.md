# AGT-002 gobernanza — borrador DRAFT / HUMAN_APPROVAL_REQUIRED — Rama Judicial `54190e51-15fb-46af-b0aa-8f13461a3110`

**Estado: `DRAFT`, versión 2. Requiere aprobación humana antes de convertirse en filas curadas reales.**
**Este documento y el JSON que describe NUNCA deben citarse como base de una decisión de negocio ni cargarse a runtime tal cual.**

- Artefacto: `docs/governance/drafts/agt002-rama-judicial-54190e51-15fb-46af-b0aa-8f13461a3110.v1.json` (`version: 2` dentro del JSON; el nombre de archivo no cambia entre versiones del borrador — el campo `version` es la fuente de verdad).
- Validador: `agt002-governance-draft-proposal.js` (`validateAgt002GovernanceDraftProposal`)
- Generador reproducible (solo lectura): `scripts/agt002-rama-judicial-governance-draft-generate.mjs`
- Tests: `tests/agt002-governance-draft-proposal.test.mjs`, `tests/agt002-governance-draft-proposal-runtime-isolation-static.test.mjs`
- Rama: `feat/agt002-v3-foundations`, HEAD de partida `db257d9`
- Fecha: 2026-08-08 (continuación de la sesión del 2026-08-07 que produjo la versión 1)
- Alcance de esta sesión: **solo lectura** contra Supabase (service role, `select`/`eq`/`order` únicamente); cero escritura remota, cero canary, cero modelo productivo, cero push/PR/merge/deploy.

## 0. Qué cambió de la versión 1 a la versión 2

La versión 1 (sesión del 2026-08-07) solo pudo extraer evidencia de **3 de los 17** documentos vigentes, porque dependía de `psi_tender_document_chunks` como única fuente de texto, y esa tabla solo tenía chunks `current=true` cuyo `content_hash` coincidiera con la versión vigente para 3 documentos (el pipeline de *chunking* de producción nunca se volvió a ejecutar tras las adendas que reemplazaron los otros 14). Esto fue señalado como P1 bloqueante de *canary* (no de presentación del borrador) en la revisión independiente Opus 4.8 registrada al cierre de esa sesión.

La versión 2 (esta sesión) cierra esa brecha de cobertura de documentos: en vez de leer chunks ya persistidos, lee `extracted_text` directamente de las 17 filas vigentes de `psi_tender_document_versions` (la misma columna que usa la fase real `chunkDocuments` de producción, `server/index.js`) y reconstruye los chunks **localmente**, en memoria, con el mismo contrato puro y determinístico (`buildAgt002DocumentChunks`, `agt002-document-chunks.js`) que usa producción — nunca una reimplementación privada. Esa reconstrucción local se reconcilió, por igualdad exacta de `chunk_id`/`content_hash`/`chunk_hash` (nunca por conteo), contra los chunks que sí existen hoy en `psi_tender_document_chunks`: **479/479 coincidieron sin ninguna discrepancia**, lo que confirma que la reconstrucción local es fiel al pipeline real antes de confiar en ella para los 14 documentos restantes.

Resultado: extracción de requisitos y citas de chunk ahora corren sobre **17/17** documentos vigentes (antes 3/17), sin inventar ningún `requirement_id` nuevo y sin usar un modelo/LLM para clasificar — el extractor cerrado sigue siendo exactamente el mismo (`tender-requirement-extraction.js`), con más evidencia disponible para los mismos 3 `requirement_id` que reconocía antes. Ver §7 más abajo para la aclaración explícita de que esto **no** equivale a cobertura semántica total del pliego.

También se corrigieron tres hallazgos P2 de la revisión independiente Opus 4.8 sobre la versión 1 (`agt002-governance-draft-proposal.js`, `tests/agt002-governance-draft-proposal-runtime-isolation-static.test.mjs`, `package.json`) — ver §8.

## 1. Qué es esto y qué NO es

Este es un **borrador** de las dos entradas gobernadas que el motor integral v3 exige como configuración humana explícita (`agt002-integral-governance-overrides.js`, migración `064`, `psi_agt002_integral_governance_overrides`):

- `category_override` (por `requirement_id`, hacia una de las 4 categorías cerradas: `discard`, `habilitating`, `technical`, `financial_execution`).
- `evidence_class_link` (por `requirement_id`, hacia una de las 17 clases cerradas de `psi_agt002_company_evidence_registry`).

**No es** una fila curada real. El artefacto JSON tiene una forma deliberadamente **incompatible** con las filas que `buildAgt002IntegralGovernanceOverrides` acepta: no tiene `curated_by` ni `curated_at`. Un test (`agt002-governance-draft-proposal.test.mjs`) prueba mecánicamente que intentar alimentar una propuesta de este borrador directamente a `buildAgt002IntegralGovernanceOverrides` **falla** por falta de `curated_by`. Esa es la barrera estructural, no solo documental, contra su uso accidental.

El estado `status: "DRAFT"` y `human_approval_required: true` son campos **estructuralmente obligatorios** — el validador rechaza cualquier otro valor. La migración `064` no otorga `INSERT`/`UPDATE`/`DELETE` a ningún rol: la única vía legítima para convertir esto en gobernanza real es que un humano con el pliego a la vista revise cada propuesta/abstención de este documento y autorice una migración/curación separada (nunca una escritura en runtime).

## 2. Reconciliación exacta snapshot canónico ↔ documentos ↔ chunks (verificación por ID, no por conteo)

**Verificado, con IDs exactos, mediante lectura real (`scripts/agt002-rama-judicial-governance-draft-generate.mjs`, que hace fallar el script si cualquiera de estos supuestos no se cumple):**

1. `psi_tender_document_state.current_snapshot_id` para la oportunidad `54190e51-15fb-46af-b0aa-8f13461a3110` **es, en efecto**, `c33159a5-defe-4a6f-8fa4-68c5ceb60e59` (`refresh_in_progress = false`).
2. El snapshot `c33159a5` tiene `document_manifest.documents[]` con exactamente 17 entradas, y ese conjunto de 17 `document_id` (= `document_version_id`) es **exactamente igual, como conjunto**, al conjunto de los 17 `id` de `psi_tender_document_versions` con `current = true` para esta oportunidad.
3. `psi_agt002_company_evidence_registry` tiene exactamente 17 filas vigentes (`current = true`), leídas con el select allowlisted real (`AGT002_COMPANY_EVIDENCE_CLASS_SELECT` / `loadAgt002CompanyEvidenceRegistryEntries`).

**Estado real de `psi_tender_document_chunks` (no cambió respecto a la versión 1 — esta sesión no escribió nada; solo se volvió a leer):**

4. `psi_tender_document_chunks` tiene **3439 filas** para esta oportunidad, repartidas en dos lotes, **ambos marcados `current=true`** (el campo `current` de una fila de chunk es una copia congelada en el momento de creación — no un indicador vivo re-sincronizado con la vigencia real de la versión del documento):

   | `snapshot_id` | filas | `current` |
   |---|---|---|
   | `9a4f4df4-3947-450f-ba5a-32cc0c4b297a` (lote 2026-08-01) | 1973 | `true` |
   | `be9d136f-fa26-49fc-acce-23ad0a7d6a32` (lote 2026-07-29) | 1466 | `true` |
   | `c33159a5-defe-4a6f-8fa4-68c5ceb60e59` (canónico actual) | **0** | — |

5. De los 17 documentos vigentes, cruzando por `document_version_id` (nunca por posición ni por `source_document_id`), **solo 3** tienen `chunk_id` que hoy coincide con una fila real y verificada de `psi_tender_document_chunks` cuyo `content_hash` es idéntico al de la versión vigente: el pliego de condiciones definitivo (`830952068`, 435 chunks), el Anexo 11 de Acreditación MiPyme (`830952052`, 28 chunks) y el Anexo 4 de Conformación de integrantes UT (`830952040`, 16 chunks) — suma 479. Los 14 documentos restantes no tienen ningún `chunk_id` coincidente en la base de datos porque el pipeline de *chunking* de producción nunca se volvió a ejecutar contra sus versiones vigentes actuales.

**Lo nuevo en esta sesión — reconstrucción local, reconciliada:**

6. Se reconstruyeron chunks **localmente** (sin red, sin escritura) para los 17 documentos vigentes, a partir de `psi_tender_document_versions.extracted_text`, con el mismo contrato puro (`buildAgt002DocumentChunks`) y los mismos parámetros de entrada (`document_id = source_document_id`, `document_version_id = id`, `snapshot_id = c33159a5` — el snapshot canónico contra el que se reconstruye hoy) que usa la fase real de producción. Resultado: **1973 chunks locales, 0 documentos sin chunk local** (ningún documento vigente tiene `extracted_text` vacío o ilegible).
7. Esa reconstrucción local se reconcilió, por igualdad exacta de `chunk_id` **y** `content_hash` **y** `chunk_hash` (nunca por conteo aproximado), contra las 3439 filas reales de `psi_tender_document_chunks`: de los `chunk_id` que coinciden entre ambos conjuntos (los 479 de los 3 documentos con chunks reales), **el 100% coincide exactamente** en `content_hash` y `chunk_hash` — cero discrepancias. El script está escrito para fallar (`throw`) si encuentra una sola discrepancia; no la encontró. Esto es la prueba mecánica de que la reconstrucción local es fiel al pipeline real de producción, no una aproximación no verificada.
8. Para los otros 14 documentos, los chunks usados por este borrador **existen solo en esta reconstrucción local**, todavía no en `psi_tender_document_chunks` — el `data_gap` `local_reconstruction_not_yet_persisted_in_db` del JSON lo declara explícitamente, con la lista exacta de `source_document_id` afectados. Esta sesión no escribió ningún chunk a la base de datos.

**Nota aparte, no un defecto (sin cambios respecto a v1):** el campo `content_sha256` embebido en `document_manifest.documents[]` del snapshot no coincide con `psi_tender_document_versions.content_hash` (distinta normalización de entrada por diseño). Este borrador usa exclusivamente `content_hash`/`chunk_hash` como ancla de procedencia, nunca `content_sha256`.

## 3. Extracción determinística ejecutada (versión 2)

Pipeline real, sin invención:

1. `psi_tender_document_versions.extracted_text` (17 filas vigentes) → `buildAgt002DocumentChunks` (`agt002-document-chunks.js`, contrato puro y cerrado, `AGT002_CHUNK_MAX_CHARS=1800`, `AGT002_CHUNK_OVERLAP_CHARS=200`) → 1973 chunks locales, reconciliados contra la base real (§2.6-2.7).
2. `tender-requirement-extraction.js::buildRequirementAnalysis(documents, {})` corre directamente sobre `extracted_text` de los 17 documentos (perfil de empresa vacío deliberadamente — este borrador no fabrica cifras de capacidad de la empresa).
3. `agt002-deep-analysis-matrix.js::buildAgt002RequirementManifest({matrix, documents})` con `document_id`/`document_version_id`/`content_hash` reales de los 17 documentos.
4. Las citas de chunk (`chunk_citations`) buscan los mismos 3 patrones (uno por `requirement_id`) dentro de los 1973 chunks locales, no dentro de texto reconstruido a mano.

Resultado (`coverage`): `total: 3, confirmed: 0, partial: 2, indication: 1` — sin cambios frente a v1: el extractor cerrado sigue exigiendo cuantía y vigencia/operador explícitos antes de confirmar, y esa combinación no aparece completa en el texto disponible, ahora verificado sobre el corpus completo de 17 documentos, no solo 3.

## 4. Los 3 requisitos, sus citas reales (ampliadas a 17/17) y las propuestas

### 4.1 `financial-working-capital` (Capital de trabajo) — `partial`

- **4 citas** (antes 1), una por cada uno de 4 documentos que repiten la misma tabla de índices financieros palabra por palabra: Estudios previos, Estudios del Sector, Proyecto de Pliego de Condiciones y Pliego de Condiciones Definitivo. Las 4 son idénticas en contenido (`ÍNDICE FÓRMULA NIVEL — Capital de Trabajo ... Mayor o igual al 50% del Presupuesto Oficial Estimado`) — la ampliación a 17/17 documentos **corrobora** la cita original, no aporta información nueva.
- **Propuesta `category_override` → `habilitating`.** Sin cambios: cláusula inequívoca dentro del Capítulo II "REQUISITOS HABILITANTES" (§2.2, secciones 408-410).
- **Propuesta `evidence_class_link` → `rup`.** Sin cambios: sección 409 basa explícitamente la evaluación en el RUP.
- Nota técnica (no accionable, sin cambios frente a v1): el patrón `no inferior a|no menor a|minimo|maximo|superior a|igual o mayor a` del extractor no reconoce la redacción real ("**Mayor o igual al** 50%"), por eso el estado quedó `partial` en vez de `confirmed` pese a que la cifra (50%) sí se extrajo. Limitación conocida de `tender-requirement-extraction.js`, no modificada en esta sesión.

### 4.2 `legal-guarantee-policy` (Póliza de cumplimiento) — `partial`

- **48 citas** (antes 16), repartidas en 4 documentos (Estudios previos, Proyecto de Pliego, Anexo 5 — Programa de gestión de contratistas y visitantes, Pliego Definitivo). Leídas todas: la ampliación **corrobora exactamente la misma estructura de dos pólizas** encontrada en v1 (ítem 17 RCE, ítem 18 vida colectiva), ahora idéntica y verbatim en 3 versiones independientes del pliego (Estudios previos → Proyecto → Definitivo). El Anexo 5 aporta una única mención tangencial no relacionada (cobertura de seguridad social de estudiantes en práctica) — ruido esperado del patrón genérico `/polizas?/`, no una tercera clase de póliza real. **Ninguna clase de póliza nueva apareció** con la extracción ampliada.
- **Propuesta `category_override` → `habilitating`**, con el mismo caveat que v1 (la sección 110, cronograma, menciona "garantías de ejecución del contrato" — posteriores a la adjudicación, fuera de esta categoría).
- **Abstención de `evidence_class_link`** (`multiple_distinct_classes_matched_single_requirement`), sin cambios: un único enlace no puede representar honestamente `rce_policy` y `collective_life_policy` a la vez; la extracción ampliada a 17/17 no deshizo esta ambigüedad.

### 4.3 `technical-video-surveillance-scope` (Alcance de videovigilancia/CCTV) — `indication`

- **33 citas** (antes 9), en 7 documentos. Se leyeron las 33 (no una muestra) para clasificarlas honestamente:
  - **27 de 33 son falsos positivos**, verificados leyendo cada una: 24 son coincidencias del patrón `camaras?` contra **"Cámara(s) de Comercio"**/Confecámaras (registro mercantil, representación legal — en 5 de los 7 documentos), 2 usan "monitoreo" en el sentido de seguimiento de indicadores de un programa de gestión de contratistas (Anexo 5 — nada que ver con video), y 1 es una mención de la Superintendencia de Vigilancia sobre infraestructura física en Manizales (autorización de sede, no CCTV).
  - **6 de 33 son señales reales pero no cuantificables**, ahora corroboradas de forma idéntica en tres documentos independientes (Estudios previos, Proyecto de pliego y Pliego definitivo — la misma tabla se repite literalmente): dos turnos de personal llamados "Monitoreo" (24h, sin arma) dentro de la tabla de puestos de vigilancia (la misma señal que v1 ya había encontrado, ahora vista en 3 versiones del documento en vez de 1); una frase narrativa de justificación (Estudios previos, sección 14) que menciona circuitos cerrados de televisión como herramienta de apoyo, sin cifra ni alcance; una definición regulatoria genérica de "medios tecnológicos" en vigilancia privada (Estudios del Sector, sección 133, cita el Decreto 356 de 1994 en términos generales, no específicos de este contrato); y un listado comparativo de procesos de **otras** entidades que sí incluyeron medios tecnológicos (Estudios del Sector, sección 216 — mercado de referencia, no un requisito de este pliego).
  - Ninguna de las 6 señales reales especifica cantidad de cámaras, cobertura o especificación técnica exigida para **este** contrato. La extracción ampliada a 17/17 documentos **confirma y corrobora** la conclusión de v1 (mayor volumen de evidencia, misma calidad insuficiente para una categoría cerrada), no la cambia.
- **Abstención de `category_override`** (`evidence_quality_insufficient_false_positive_dominated`), con el detalle numérico anterior (27/33 falsos positivos, 6/33 señales reales no cuantificables).
- **Abstención de `evidence_class_link`** (`no_catalog_class_conceptually_corresponds`), sin cambios: el catálogo de 17 clases describe documentos de calificación empresarial, no alcance técnico de servicio.

## 5. Cobertura de este borrador

Los 3 requisitos del `requirement_manifest` están cubiertos **exactamente una vez** en cada uno de los dos ejes gobernados (propuesta o abstención, nunca ambas, nunca ninguna) — verificado por `validateAgt002GovernanceDraftProposal`. Sin cambios en las decisiones frente a v1 — la extracción ampliada corroboró, no revirtió, ninguna conclusión:

| `requirement_id` | `category_override` | `evidence_class_link` |
|---|---|---|
| `financial-working-capital` | propuesta: `habilitating` | propuesta: `rup` |
| `legal-guarantee-policy` | propuesta: `habilitating` (con caveat) | **abstención** |
| `technical-video-surveillance-scope` | **abstención** | **abstención** |

## 6. Campo `evidence_chunk_snapshot_ids` (nuevo, corrige P2 de la revisión Opus)

El JSON ahora declara, además de `snapshot_id` (el puntero canónico de la oportunidad, `c33159a5…`), un campo separado y obligatorio `evidence_chunk_snapshot_ids` — el conjunto real de snapshots de los que proviene la evidencia de chunk citada:

```json
"evidence_chunk_snapshot_ids": [
  "9a4f4df4-3947-450f-ba5a-32cc0c4b297a",
  "c33159a5-defe-4a6f-8fa4-68c5ceb60e59"
]
```

- `9a4f4df4…` es el snapshot real, observado en `psi_tender_document_chunks`, de las citas cuyo `chunk_id` coincide con un chunk ya persistido (los 3 documentos de siempre).
- `c33159a5…` (el canónico) marca las citas cuya evidencia existe **solo** en la reconstrucción local de esta sesión (los 14 documentos restantes), todavía no persistida.

Esto resuelve el hallazgo P2 de la revisión independiente Claude Opus 4.8 sobre la versión 1: `snapshot_id` por sí solo podía leerse como "toda la evidencia proviene de este snapshot", cuando en realidad 0 chunks persistidos pertenecían a él. Ahora el borrador declara, sin ambigüedad, el origen real de cada porción de la evidencia.

## 7. Alcance del extractor — no es cobertura semántica total del pliego

`tender-requirement-extraction.js` es un clasificador **cerrado**: reconoce exactamente tres `requirement_id` fijos (`legal-guarantee-policy`, `financial-working-capital`, `technical-video-surveillance-scope`) sin importar cuántos documentos se le entreguen — no es, y nunca fue, un extractor semántico exhaustivo del pliego. Pasar de 3/17 a 17/17 documentos **amplía la evidencia disponible** para esos tres requisitos (más citas, propuestas/abstenciones mejor fundamentadas, corroboración cruzada entre versiones del pliego) pero **no descubre nuevos `requirement_id`** ni constituye cobertura semántica total: el pliego real de esta licitación (`9. Pliego de Condiciones Definitivo SA-24-2026.pdf`) puede contener requisitos habilitantes, técnicos o financieros adicionales que este extractor cerrado simplemente no está diseñado para reconocer (no busca, por ejemplo, experiencia acreditada, RUT, certificados de multas y sanciones, listado de armas autorizadas, ni ninguna de las otras 14 clases de evidencia empresarial del catálogo de 17). El `data_gap` `extractor_scope_is_not_full_pliego_coverage` del JSON declara esto explícitamente. Una extracción exhaustiva del pliego real requeriría una revisión humana adicional, fuera del alcance de este script.

## 8. Correcciones P2 de la revisión independiente Claude Opus 4.8 sobre la versión 1

1. **`evidence_chunk_snapshot_ids`** (§6 arriba) — campo cerrado, obligatorio, validado (arreglo de UUIDs únicos, ordenado ascendentemente), con tests RED→GREEN en `agt002-governance-draft-proposal.test.mjs`.
2. **Defensa anti-fuga recursiva sobre todo el documento.** El chequeo de que el artefacto nunca persiste texto crudo de documento (`text`/`excerpt`/`text_content`/`raw_text`/`content`) dejó de ser una regex sobre `JSON.stringify` (imprecisa: producía falsos positivos si una `rationale` legítima mencionaba la palabra "text_content" como prosa) más un puñado de chequeos superficiales por ubicación. Ahora es un escaneo recursivo por clave (`findAgt002GovernanceDraftForbiddenTextKeyPaths`, exportado y probado directamente con fixtures anidados arbitrariamente) que corre sobre **todo** el objeto — incluido `requirement_manifest` — antes que cualquier otra validación.
3. **Test de aislamiento runtime recursivo y robusto.** `tests/agt002-governance-draft-proposal-runtime-isolation-static.test.mjs` ya no se limita a los `.js` de la raíz y los dos entrypoints nombrados: recorre recursivamente **todo** el repositorio (163 archivos `.js`/`.mjs`/`.ts`/`.tsx`, excluyendo `node_modules`, `tests/`, `scripts/`, `docs/`, `dist/`, `.git`), de modo que sigue probando aislamiento aunque código runtime se mueva algún día a un subdirectorio (`server/`, `api/`, `src/`, ...). Se verificó mecánicamente (RED→GREEN) que la versión anterior del test *no* detectaba una importación real inyectada en un subdirectorio, y que la nueva versión sí la detecta.
4. **Enganchado al runner AGT-002.** Ambos tests de gobernanza (`agt002-governance-draft-proposal.test.mjs` y su isolation test) se agregaron explícitamente a la lista de archivos de `npm run test:agt002-runtime` en `package.json` (antes solo cubría los tests del Workbench).

## 9. Qué debe hacer un humano con esto

1. Leer el pliego de condiciones definitivo (`830952068`, hash `e3715f6d…4803cdf`) directamente y confirmar o corregir cada propuesta/abstención de la sección 4 — ahora con evidencia de 17/17 documentos, no solo 3.
2. Decidir si `legal-guarantee-policy` debe subdividirse en requisitos más finos (p. ej. `legal-rce-policy`, `legal-life-policy`) antes de curar un `evidence_class_link`.
3. Decidir si conviene priorizar la re-ejecución del pipeline real de *chunking* de producción sobre los 14 documentos sin chunks persistidos (§2.8) antes de dar por completa la extracción en la base de datos — la reconstrucción local de esta sesión es fiel y reconciliada, pero no sustituye la persistencia real.
4. Entender que el extractor cerrado (`tender-requirement-extraction.js`) solo reconoce 3 `requirement_id`; una revisión humana exhaustiva del pliego (§7) es un paso aparte, no cubierto por este borrador.
5. Si aprueba, autorizar una migración/curación real (nunca RPC en runtime) que inserte filas en `psi_agt002_integral_governance_overrides` con `curated_by`/`curated_at`/`rationale`/`source_reference`/`version` reales, replicando (o corrigiendo) el contenido de este borrador.
6. Este documento y el JSON asociado deben conservarse como evidencia de auditoría de esa decisión, independientemente de si se aprueba tal cual, se corrige o se rechaza.

## 10. Relación con el gap documentado previamente

`docs/verification/2026-08-07-agt002-rama-judicial-governance-gap.md` documentó, en orden: (a) la sesión original sin credenciales reales, expediente vacío por diseño; (b) una sesión posterior con credenciales de solo lectura reales que produjo la versión 1 de este borrador (3/17 documentos); (c) esta sesión, que produce la versión 2 (17/17 documentos, reconciliada, con las correcciones P2 de la revisión independiente). El gate 4 (inserción de filas curadas reales en `psi_agt002_integral_governance_overrides`) permanece abierto en las tres: sigue sin otorgarse ningún privilegio de escritura a ningún rol en la migración `064`, y ninguna sesión lo ejerció.
