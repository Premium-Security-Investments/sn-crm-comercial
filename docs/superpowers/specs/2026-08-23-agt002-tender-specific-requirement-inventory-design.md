# AGT-002: Inventario específico por licitación — diseño

## Problema

La matriz previa de AGT-002 producirá siempre cuatro requisitos de extractores cerrados. Esa lista es una señal suplementaria y no puede representar el expediente ni sustentar cobertura integral. Un resultado histórico que analizó esos cuatro requisitos tampoco puede reinterpretarse como completo.

## Decisión

Se introduce un contrato server-side `tender_requirement_inventory` por snapshot, construido antes de cualquier análisis de requisitos. El constructor segmenta cada documento vigente y cada hueco conocido en `source_units` deterministas. Cada unidad queda exactamente en una de tres disposiciones: `analyzable`, `unresolved_visible` o `excluded_with_reason`. El ledger no admite una unidad sin disposición.

Los requisitos se derivan de unidades documentales: la segmentación produce candidatos por párrafo/documento con su `source_unit_id`; se normalizan y deduplican por texto normalizado, y el servidor genera un `requirement_id` SHA-256 determinista que incluye snapshot, versión del inventario y las citas válidas. Ningún regex cerrado define la frontera; los cuatro extractores históricos sólo se conservan como `supplemental_signals` y jamás cuentan para `expedient_coverage`.

## Contrato y fail-closed

`buildTenderRequirementInventory({ snapshotId, documents, documentGaps })` devuelve:

- `inventory_version`, `snapshot_id`, `snapshot_hash`, `inventory_hash`;
- `source_units` (sin texto crudo), con hash de unidad y disposición explícita;
- `coverage_ledger`, con contadores separados de `expedient_coverage` y `analyzed_coverage`;
- `requirements`, cada uno con citas `{source_unit_id, unit_hash}` verificadas contra la allowlist; `content_hash` conserva la identidad del artefacto persistido y no se confunde con la huella del texto extraído;
- `decision_ready: false`, `recommendation: "pause"`, `human_review_required: true` cuando exista cualquier hueco, unidad no analizable, cita/hash inválido, inventario vacío o análisis pendiente.

Una cobertura sólo será `complete` si todas las unidades son analizables y cada requisito/cita pasa la validación. El constructor inicial no afirma análisis semántico completo: aun con unidades analizables, `analyzed_coverage` queda `incomplete` hasta que un analizador server-side registra disposiciones por requisito. Por ello este hotfix pausa de forma conservadora y es honesto sobre el bloqueo de la etapa semántica/modelo posterior.

La validación rechaza inventarios con IDs duplicados, hashes no SHA-256, citas que no existan o cuyo hash no coincida, unidades sin disposición, totales inconsistentes o métricas de cobertura combinadas.

## Integración

El preview server-side incorpora el inventario en `document_evidence`, lo persiste dentro de `evidence_coverage` y lo vuelve a validar antes de RPC. El key de idempotencia de preview puede enlazar `inventory_version`, `inventory_hash` y hashes de snapshot, por lo que una adenda con nuevo hash no colisiona. Se preservan el contrato `v3_unit_ordering` y los milestones: no se cambia su validador ni se inyectan categorías piloto. No se añaden migraciones, proveedores, gates, decisiones GO/NO-GO, compliance ni efectos de modelo.

La capa UI/API recibe el ledger persistido y debe mostrarlo como cobertura del expediente y cobertura analizada separadas; para este corte, `pause`/revisión humana es el estado visible. La ausencia del inventario o un run histórico de cuatro requisitos se marca `partial`/`incomplete`, nunca integral.

## Alternativas descartadas

1. Ampliar los cuatro regex: sigue siendo catálogo fijo y no cubre requisitos documentales nuevos.
2. Declarar completa la matriz sólo por 4/4: confunde conteo interno con expediente.
3. Dejar unidades sin resolución para recuperarlas después: oculta una omisión material.

## Pruebas

Pruebas de contrato cubren dos expedientes disjuntos con cardinalidad distinta de cuatro, requisito documental sin regex histórica, cita/hash inválido, gap, histórico Bogotá 4/4, adenda/idempotencia, entrada congelada y persistencia. Las pruebas no permiten literales de piloto ni efectos laterales.
