# AGT-002 — Disparadores de reanálisis incremental

**Estado:** Diseño aprobado en conversación por Juan el 2026-10-02. Pendiente de revisión del spec escrito antes de iniciar implementación.

**Tipo de documento:** especificación de diseño. Este documento NO es un plan de implementación ni una lista de tareas.

---

## 1. Resumen

AGT-002 necesita reanalizar automáticamente una oportunidad ya convertida cuando aparece material nuevo o modificado de fuente confiable, sin reenviar documentos sin cambios al proveedor de IA, sin sondeo continuo, y sin invocar nunca una decisión GO/NO-GO ni ninguna acción externa (envío, publicación, firma, comunicación). El disparo debe ser dirigido por eventos, deduplicado, idempotente y auditable, reutilizando la infraestructura durable de jobs y el pipeline canónico ya existentes.

---

## 2. Alcance

- Alcance exclusivo: oportunidades **ya convertidas**. Nunca candidatos de Radar.
- Disparadores automáticos de confianza:
  a. Documentos oficiales nuevos o modificados.
  b. Documentos subidos por una persona humana de Licitaciones autenticada, activa y autorizada.
  c. Evidencia de empresa nueva o modificada, vinculada por esa misma persona.
  d. Comentarios, respuestas, aclaraciones, comentarios/resultados de revisión registrados por esa misma persona.
- La mutación humana en sí misma es la autorización para incluir esa evidencia en el análisis; no se pide una segunda aprobación. Esa autorización **no es** GO/NO-GO, envío, publicación, conversión, firma ni comunicación externa.
- Se excluye únicamente cuando la fuente o la identidad es incierta; ese material se preserva para validación pero no genera ningún trabajo de IA hasta que la procedencia quede validada.
- La reconciliación de plazo/estado/`last_seen`/metadatos crudos permanece determinista, puede notificar, y nunca invoca IA.
- Se analiza solo el material confiable nuevo o modificado más una proyección inmutable de los hallazgos canónicos previos relevantes; no se reenvían ni releen documentos sin cambios en su totalidad. Fragmentos puntuales de documentos sin cambios pueden usarse únicamente como contexto de comparación cuando un hallazgo previo afectado los cita, y ese uso debe quedar registrado.
- Se crea un run canónico sucesor de solo anexado; el run anterior permanece legible. Los hallazgos no afectados se trasladan mecánicamente; solo se reemplazan o añaden los hallazgos afectados. El reanálisis completo es una acción humana explícita y separada, fuera de este alcance.
- Despacho dirigido por eventos; no hay temporizador de 30 segundos ni sondeo continuo. El wrapper externo `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh` —el orquestador diario fuera de proceso que encadena scan y reconciliación— puede realizar, después de que ambos terminan, como máximo un despertar de recuperación condicional cuando existen conjuntos pendientes durables. `createAgt002RadarScan`, el servicio `agt002-radar-scan.service` y la firma del scan permanecen, sin cambios, incapaces de reclamar jobs o invocar al proveedor de IA; ese verbo solo existe en el wrapper.
- Para la sincronización oficial de documentos, el lote de origen tiene identidad propia: se genera un `source_batch_id` estable antes de iniciar el `for...of` de `refreshTenderDocumentBatch`, se propaga a través de `refreshResults`/`refreshSummary` y de cada señal que el lote origine, y el lote se cierra —produciendo como máximo un conjunto/manifiesto por oportunidad, incluso si algún documento individual falla— solo después de que el bucle completo resuelve. El ingreso de señales para documentos oficiales nunca se invoca por cada llamada a `psi_record_tender_document_version`.
- Deduplicación/agrupación: si no hay job activo, todas las señales de una misma mutación humana atómica o de un mismo lote de sincronización oficial (identificado por su `source_batch_id`) para una oportunidad forman un conjunto, sellado al cierre de esa transacción/lote, y se despacha. Si hay un job activo, las señales confiables posteriores se adjuntan de forma idempotente al único conjunto sucesor acumulando, sin sellarse por cada transacción de origen; en la transición terminal del job activo se bloquea la oportunidad, se sella/hashea ese conjunto sucesor exactamente una vez, y se despacha. Misma identidad de fuente, versión y hash de contenido es idempotente en ambos casos.

---

## 3. Estado actual (mecanismos existentes, nombres exactos)

Este diseño se apoya en la infraestructura ya presente en el repositorio (verificada contra `origin/main` en el commit `223a085`):

- **Camino de respuesta humana ya automatizado:** `POST /api/tender-question-responses`, `reanalyzeAgt002AfterHumanAnswer`, `agt002HumanEvidenceFromResponses`, `enqueueAgt002CanonicalReanalysis`, espejados en `server/index.js` y `api/[...path].js`. Ya encolan automáticamente el reanálisis tras una respuesta humana y evitan GO/NO-GO. Este camino hoy **devuelve "busy" cuando hay otro job activo**; el nuevo diseño debe preservar, no descartar, las señales confiables posteriores (ver sección 6, concurrencia). **Este camino, tal como existe hoy, NO satisface el comportamiento delta-only que exige este diseño**: `reanalyzeAgt002AfterHumanAnswer` llama a `getTenderDocumentRecords(..., {includeExtractedText:true})` para obtener `currentDocs` (todos los documentos vigentes de la oportunidad, no el delta), construye `deepAnalysis` vía `buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile)` (que concatena el texto extraído de todos los documentos vigentes), y pasa `analysisDocuments = currentDocs` a `enqueueAgt002CanonicalReanalysis`, de modo que el texto completo de todos los documentos vigentes —no solo el material nuevo o modificado— queda congelado en `frozenEngineInput` y se envía al proveedor en cada reanálisis. El diseño incremental reutiliza únicamente el runner y la persistencia de `enqueueAgt002CanonicalReanalysis` (encolado, fencing, congelado de input, promoción canónica); no reutiliza esta construcción de `analysisDocuments`/`deepAnalysis` basada en `currentDocs` íntegro (ver §4.4).
- **Verificación de autoridad humana actualmente insuficiente para este diseño:** el único chequeo hoy disponible en el camino de respuesta humana es `requireHumanTenderIdentity` (excluye únicamente `identity_type === 'agent'`; no verifica perfil activo ni ninguna autoridad de Licitaciones) combinado con `ensureOpportunityAccess` (acceso CRM puntual a esa oportunidad, no un rol/autoridad de Licitaciones). Ni por separado ni combinados prueban "identidad humana autenticada, con perfil autoritativo activo, y autoridad de Licitaciones vigente", que es lo que este diseño exige para admitir una señal de origen humano (ver §9, predicado `requireAuthorizedLicitacionesAnalysisActor`).
- **Jobs/worker/executor durables:** `agt002-reanalysis-jobs.js`, `agt002-reanalysis-worker.js`, `agt002-reanalysis-executor.js`; migraciones `068_agt002_reanalysis_jobs.sql` y `081_agt002_durable_batched_analysis.sql` proveen jobs con fencing, checkpoints durables y persistencia canónica.
- **Worksets de documentos gobernados:** migración `084_agt002_governed_document_worksets.sql` y `agt002-governed-document-workset-api.js` resuelven worksets de documentos inmutables en el servidor con encolado atómico.
- **Versionado de documentos:** migración `026_tender_document_versions.sql` versiona el contenido de documentos por identidad de fuente estable y hash de contenido, vía la RPC `psi_record_tender_document_version`; migración `027_tender_decision_current_analysis.sql` invalida el estado "current" de documentos obsoletos.
- **Importación oficial, secuencial y sin identidad de lote:** `refreshTenderDocumentsFromOfficialSource` (`server/index.js`) llama a `refreshTenderDocumentBatch` (`tender-document-versioning.js`), que recorre los documentos del lote en un `for...of` secuencial: cada documento se descarga, extrae y versiona con su propia llamada a `psi_record_tender_document_version` (una transacción de Postgres por documento), y los fallos se capturan por documento sin abortar el resto del lote. Hoy no existe ningún identificador que correlacione las N llamadas de un mismo sync; este diseño introduce `source_batch_id` para ese fin (ver §4.1, §4.2, §16).
- **Eventos de revisión accionable:** migración `078_agt002_actionable_review_knowledge.sql` da eventos de revisión de solo anexado, autorizados.
- **Registro de evidencia de empresa:** migración `061_agt002_company_evidence_registry.sql` da evidencia de empresa versionada y restringida, pero intencionalmente **no tiene un escritor de revisión en tiempo de ejecución**. La migración `097` no cambia esto: solo añade un evento de vínculo de solo anexado que referencia una versión ya existente de `061`; no crea ni habilita un escritor de revisión sobre `061`.
- **Promoción canónica:** migración `063_agt002_canonical_promotion.sql` soporta runs canónicos de solo anexado y `supersedes_run_id`.
- **Handoff gobernado:** migración `096_agt002_governed_freeze_processing_handoff.sql` hace atómico el freeze/handoff gobernado de procesamiento.
- **Rutas retiradas, NO revivir:** `/api/tender-documents-analyze-agent-preview`, `/api/tender-analysis-authorize`, `/api/agt002-reanalyze-fixed-snapshot` están retiradas con 410.
- **Brecha actual:** la importación oficial (`refreshTenderDocumentsFromOfficialSource` con `analyze:false`), la subida autenticada (`saveTenderDocumentBuffer` más el camino de snapshot/refresh), la evidencia de empresa y los eventos de revisión accionable **aún no comparten un límite de disparo incremental común**.
- **Temporizador a retirar:** `ops/agt002-reanalysis-worker/agt002-reanalysis-worker.timer` sondea cada 30 segundos y entra en conflicto con este diseño. El worker se conserva; el timer se retira.
- **Última migración existente:** `096_agt002_governed_freeze_processing_handoff.sql`. La siguiente migración aditiva de este diseño es `097`.

---

## 4. Arquitectura propuesta

### 4.1 Ingreso de señales confiables (service-role-only)

Un servicio compartido, accesible solo con rol de servicio, se invoca después de cada mutación autorizada o creación de versión oficial (subida de documento, ingesta oficial, vínculo de evidencia de empresa, evento de revisión accionable, respuesta/comentario humano). Para documentos oficiales, este servicio **no se invoca por cada llamada a `psi_record_tender_document_version`**: se invoca **una sola vez por ejecución de `refreshTenderDocumentsFromOfficialSource`**, después de que `refreshTenderDocumentBatch` completa su `for...of` sobre todo el lote, usando el `refreshResults`/`refreshSummary` ya agregados por esa función. Antes de iniciar el bucle, `refreshTenderDocumentsFromOfficialSource` genera un `source_batch_id` estable (UUID) que se propaga a `refreshTenderDocumentBatch`, a cada resultado individual del lote, y a la llamada única de ingreso de señales al final; los fallos por documento dentro del lote no abortan el resto ni impiden el cierre del lote, pero solo los documentos cuya versión se registró con éxito (cambio de hash confirmado) generan una señal dentro de ese `source_batch_id` — los fallidos quedan fuera del lote de señales y son diagnosticables por su `source_batch_id` compartido con los exitosos.

Este servicio verifica, antes de admitir cualquier señal:

- Que la oportunidad esté **convertida** (vinculada a un tender/opportunity ya convertido) y activa/elegible.
- Que el tender/opportunity coincida entre la mutación y la oportunidad objetivo.
- La clase de fuente (oficial, humano, evidencia de empresa, revisión).
- Cuando el origen es humano: `requireAuthorizedLicitacionesAnalysisActor` (ver §9) — identidad humana autenticada, perfil autoritativo activo, acceso a la oportunidad, y permiso `ACTIONS.AI_ANALYSIS_RUN` vigente en el momento del evento.
- La identidad estable de fuente/versión/hash de contenido, para poder deduplicar.
- Para documentos oficiales: el `source_batch_id` del lote que originó la señal.

Si cualquiera de estas verificaciones resulta incierta (identidad no resoluble, autoría no confirmable, fuente ambigua), la señal se escribe en estado de **validación pendiente**, sin crear ningún job ni invocar IA. Queda preservada, inmutable, para validación posterior. Esa validación posterior, si ocurre, no modifica la señal incierta original: crea un nuevo evento de validación (o una nueva señal confiable) que la referencia, nunca una reescritura de la fila existente.

Para evidencia de empresa, el disparador confiable es un **evento de vínculo** (`link event`) de solo anexado, creado por la persona de Licitaciones, que referencia una versión ya existente e inmutable de evidencia en el registro de la migración `061`. Ese evento de vínculo nunca reescribe ni amplía `061` —que permanece restringido— y de él no se infiere `verified`, `applicable` ni `cumplido`. Si en el futuro se requiere un escritor real de revisión/actualización sobre el registro `061`, ese es un camino de escritura separado, gobernado de forma independiente y fuera del alcance de este diseño.

Para eventos de revisión accionable (migración `078`), lo que dispara el análisis es el texto/evidencia del comentario o resultado registrado, nunca la etiqueta o el resultado del flujo de esa revisión (p. ej. aprobado/rechazado/pendiente). Esa etiqueta de flujo no se traduce en GO/NO-GO ni en ninguna decisión de negocio automática; solo el contenido entra como evidencia analítica para el disparo.

### 4.2 Migración `097_agt002_incremental_reanalysis_triggers.sql`

Nueva migración aditiva con:

- **Ledger de señales, inmutable tras inserción** (`agt002_incremental_signals` o nombre equivalente), con campos:
  - `id`, `opportunity_id`/`tender_id`, `trigger_kind` (documento oficial, subida humana, evidencia de empresa, comentario/respuesta/aclaración/revisión), `trust_class` (confiable / incierto-pendiente-validación), fijado en la inserción y nunca reescrito.
  - `actor_user_id` (obligatorio para eventos de origen humano), `source_table`, `source_type`, `source_id`, `source_version`, `content_hash`, `observed_at`.
  - `source_batch_id` (obligatorio para señales de origen oficial; generado antes del `for...of` de `refreshTenderDocumentBatch` en `server/index.js`/`tender-document-versioning.js` y propagado a todas las señales del mismo sync; nulo para señales de origen humano/evidencia/revisión, que se agrupan por transacción atómica en vez de por lote). Permite correlacionar y auditar todas las señales producidas por una misma invocación de `refreshTenderDocumentsFromOfficialSource`, incluso cuando algunas se adjuntan a un conjunto nuevo y otras a uno sucesor acumulando.
  - `prior_canonical_run_id`, `prior_context_version`, `prior_snapshot_ref` (referencia inmutable al estado canónico previo relevante).
  - `change_set_id` (asignado como máximo una vez, en el momento en que la señal se adjunta a un conjunto; nunca reasignado).
  - `validates_signal_id` (nulo salvo que la fila sea un evento de validación posterior que referencia a una señal incierta previa; la señal original referenciada nunca se modifica).
- **Conjuntos de cambios durables** (`agt002_incremental_change_sets`), que agrupan señales por oportunidad/grupo de cambio: un conjunto "activo-acumulando" por oportunidad como máximo, y un job activo/despachado como máximo por oportunidad. El conjunto mantiene su propio estado de ciclo de vida (activo-acumulando, sellado, despachado, en-proceso, cerrado, cerrado-con-error), además de `manifest_hash`, `linked_job_id`/`linked_run_id`, y `safe_error` cuando el cierre es por fallo. A diferencia de las señales, esta fila sí transiciona de estado — pero únicamente mediante RPCs fenced con rol de servicio.
- **Ledger de transiciones de conjunto, de solo anexado** (`agt002_incremental_change_set_transitions` o nombre equivalente): cada transición de estado de un conjunto (sellado, despacho, inicio de procesamiento, cierre, cierre con error) se registra aquí como un evento inmutable, con el proceso de servicio que la ejecutó y el timestamp. El estado visible en el conjunto es una proyección de este ledger, no una reescritura libre.
- **Primitivo de bloqueo común, compartido por ambas RPCs fenced** ("adjuntar señal" y "sellar en transición terminal"): un advisory lock de PostgreSQL con alcance de transacción (`pg_advisory_xact_lock`), con clave derivada de un espacio de nombres fijo de AGT-002 incremental más `opportunity_id` — por ejemplo `pg_advisory_xact_lock(hashtextextended(opportunity_id::text, 18374300397482569))`, donde `18374300397482569` (`41475430303249` en hex, `'AGT002I'` en ASCII) es una semilla fija documentada e inmutable, definida una sola vez como constante nombrada en la migración `097` y reutilizada literalmente por ambas RPCs — nunca un valor a decidir más adelante. El lock se adquiere **antes** de leer, crear o actualizar cualquier conjunto abierto/sucesor de esa oportunidad, de modo que "¿hay job activo?", "¿a qué conjunto adjunto esta señal?" y "sellar y calcular `manifest_hash`" son secciones mutuamente excluyentes entre las dos RPCs para la misma oportunidad. Adicionalmente, dentro de esa misma transacción, la fila del conjunto seleccionado (`agt002_incremental_change_sets`) se bloquea con `SELECT ... FOR UPDATE`. Dos índices únicos parciales hacen cumplir a nivel de esquema que exista como máximo un job activo/despachado por oportunidad y como máximo un conjunto "activo-acumulando" por oportunidad. La lectura de membresía, el cálculo de `manifest_hash` y la transición a `sellado` ocurren de forma atómica dentro de la misma transacción de la RPC — nunca en pasos separados que puedan intercalarse con otra transacción.
- **RPCs solo con rol de servicio** y **RLS** que impiden lectura/escritura directa desde clientes o desde roles autenticados normales.
- **Inmutabilidad de señales y de membresía**: las filas de señales y la asociación señal↔conjunto son inmutables tras su inserción. Una señal en validación pendiente nunca se reescribe al validarse: la validación posterior crea una nueva señal/evento de validación que la referencia vía `validates_signal_id`, sin mutar la original. Un conjunto **sellado** o en estado terminal tiene su membresía y su manifiesto/`manifest_hash` congelados: ninguna RPC puede añadir o quitar señales, ni recalcular el manifiesto, de un conjunto ya sellado.

Se incluye también el rollback aditivo correspondiente (`supabase/rollbacks/097_agt002_incremental_reanalysis_triggers_rollback.sql`); ver condiciones de uso en la sección 11.

### 4.3 Contrato `incremental_delta_manifest_v1`

Manifiesto determinista que describe exactamente lo que debe analizarse, nunca "todos los documentos actuales":

- Lista exacta de identidades y hashes de los miembros cambiados (documentos, evidencia, eventos de revisión, respuestas), con contenido en lista blanca de campos permitidos.
- `source_batch_id` del lote de sincronización oficial que originó las señales incluidas, cuando aplica (nulo para manifiestos originados por mutación humana atómica).
- Referencia al run canónico previo y proyección de los hallazgos afectados relevantes.
- Excerpts de comparación grabados opcionalmente, solo cuando un hallazgo previo afectado los cita explícitamente.
- Procedencia del disparo: tipo de disparador, actor (cuando aplica), timestamps.
- Versión de política/esquema del manifiesto.
- `manifest_hash` determinista calculado sobre el contenido anterior, usado para deduplicación e idempotencia.

El manifiesto **nunca acepta una lista de "todos los documentos actuales" provista por el cliente**; se construye server-side a partir de las señales ya validadas y de los worksets gobernados existentes.

### 4.4 Reutilización, no duplicación

- Se reutiliza la resolución de worksets de documentos gobernados (`agt002-governed-document-workset-api.js`).
- Se reutiliza el constructor de evidencia de respuestas humanas (`agt002HumanEvidenceFromResponses`).
- Se reutilizan las proyecciones restringidas de evidencia de empresa ya existentes.
- Se reutiliza el versionado de contexto existente.
- **Se introduce `buildAgt002IncrementalAnalysisInput` (nueva función), que reemplaza, para el camino incremental, la construcción de `analysisDocuments`/`deepAnalysis` basada en `currentDocs` íntegro descrita en §3.** Esta función construye `analysisDocuments`, `deepAnalysis` y el contenido que se congela en `frozenEngineInput` únicamente a partir de: el manifiesto `incremental_delta_manifest_v1`, el contenido confiable cambiado que referencia, la proyección de hallazgos previos relevantes, y los excerpts de comparación grabados explícitamente — nunca a partir de `currentDocs` completo. De `enqueueAgt002CanonicalReanalysis` **se reutilizan el runner y la persistencia** (encolado con fencing, congelado de `frozenEngineInput`, invocación del proveedor, promoción canónica vía `063`); **se modifica su integración** para que, en el camino incremental, reciba el resultado de `buildAgt002IncrementalAnalysisInput` en vez de construir `analysisDocuments`/`deepAnalysis` desde `currentDocs` como hace hoy el camino de respuesta humana. El camino de respuesta humana existente no cambia su comportamiento actual salvo por esta nueva vía de entrada paralela explícita.
- **No se añade un segundo runner de IA.** El executor existente (`agt002-reanalysis-executor.js`) se extiende para consumir el nuevo contrato de delta vía `buildAgt002IncrementalAnalysisInput`; no se crea un pipeline paralelo.

### 4.5 Despacho

- Tras el sellado del conjunto de cambios (al cierre de la transacción/lote de origen cuando no hay job activo, o en la transición terminal del job activo —tras adquirir el advisory lock de la oportunidad descrito en §4.2 y bloquear `FOR UPDATE` la fila del conjunto— cuando sí lo hay), una llamada de despacho interna autenticada despierta al worker oneshot de Hetzner existente para un drenado acotado.
- Si el despertar falla, los datos permanecen durables en la migración `097` y serán recogidos en el siguiente despertar (evento posterior o recuperación condicional).
- La transición terminal del worker expone/sella atómicamente (bajo el mismo advisory lock) el conjunto sucesor y, si corresponde, continúa o redespacha de forma acotada (sin bucle infinito).
- El wrapper externo `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh` realiza, después de completar el scan y la reconciliación diaria, **como máximo un** despertar de recuperación condicional, solo cuando existe estado pendiente durable; no hay sondeo vacío. Esta llamada vive fuera de la firma de `createAgt002RadarScan` y del servicio `agt002-radar-scan.service`: ninguno de los dos adquiere la capacidad de reclamar jobs ni de invocar al proveedor de IA.

### 4.6 Worker/executor

El worker y el executor existentes se extienden (no se reemplazan) para:

- Consumir el contrato de delta `incremental_delta_manifest_v1` vía `buildAgt002IncrementalAnalysisInput` (ver §4.4).
- Validar la procedencia y la identidad del run canónico previo antes de analizar.
- Analizar solo el delta y su impacto sobre los hallazgos previos relevantes.
- Persistir el nuevo run canónico sucesor por el camino de persistencia canónica existente (migración `063_agt002_canonical_promotion.sql`, `supersedes_run_id`).
- **Nunca** invocar la acción gobernada `ACTIONS.LICITACIONES_GO_NO_GO_APPROVE` ni ningún otro verbo de decisión de negocio. El campo interno `go_no_go` que `buildTenderDocumentAnalysis`/`buildTenderGoNoGoVerdict` calculan hoy es una etiqueta advisoria de reglas determinísticas, sin relación con esa acción gobernada; `buildAgt002IncrementalAnalysisInput` solo la incluye en `deepAnalysis` cuando el delta efectivamente la afecta, y nunca la hereda como campo obligatorio del camino completo (ver §4.7, §12). El run anterior permanece íntegro y legible.

### 4.7 Proyección de salida / UI

La proyección de resultados muestra:

- Qué cambió (resumen del delta).
- Hallazgos afectados y conteo de hallazgos no afectados (trasladados sin cambio).
- Acciones recomendadas y citas.
- Disparador, actor y momento del evento.
- Comparación entre el análisis actual y el previo.

No se introduce una segunda etiqueta pública de compatibilidad; se usa la proyección y terminología ya existentes para runs canónicos.

Si el `deepAnalysis` heredado incluye el campo interno `go_no_go` (ver §4.6), la UI lo etiqueta explícitamente como **recomendación advisoria interna**, nunca como una decisión automática, y en ningún punto lo presenta con terminología que lo confunda con la acción gobernada `ACTIONS.LICITACIONES_GO_NO_GO_APPROVE`.

---

## 5. Matriz de disparadores

| Categoría | Ejemplo | ¿Dispara IA? | Notas |
|---|---|---|---|
| Automático oficial | Documento oficial nuevo o con contenido modificado (hash distinto) | Sí | Requiere identidad/versión/hash estables y oportunidad convertida; todas las señales de un mismo sync comparten `source_batch_id` y producen un único manifiesto/job por oportunidad, aun con fallos parciales por documento dentro del lote |
| Automático humano — subida | Documento subido por persona de Licitaciones autenticada/activa/autorizada | Sí | La mutación es la autorización; no se pide segunda aprobación |
| Automático humano — evidencia de empresa | Evento de vínculo a una versión existente de evidencia de empresa (migración `061`), registrado por esa persona | Sí | Vía evento de vínculo de solo anexado; nunca infiere `verified`/`applicable`/`cumplido`; no escribe en `061` |
| Automático humano — interacción | Comentario, respuesta, aclaración, comentario/resultado de revisión registrado por esa persona | Sí | Reutiliza `agt002HumanEvidenceFromResponses`; dispara por texto/evidencia, nunca por la etiqueta de resultado del flujo de revisión |
| Determinista, sin IA | Reconciliación de plazo, estado, `last_seen`, metadatos crudos | No | Puede notificar; nunca invoca IA ni crea manifiesto |
| Excluido — identidad incierta | Fuente o identidad de autor no resoluble con certeza | No (por ahora) | Se preserva en estado de validación pendiente; no se crea job hasta validar procedencia |
| No-disparador — mismo hash | Mismo contenido, misma identidad de fuente, mismo hash ya visto | No | Idempotente, deduplicado explícitamente |
| No-disparador — reordenado | JSON crudo reordenado sin cambio de contenido semántico | No | No cambia el hash de contenido relevante |
| No-disparador — solo `last_seen` | Actualización de `last_seen` sin cambio de contenido | No | Cubierto por la reconciliación determinista |
| No-disparador — metadato cosmético | Cambios de metadatos cosméticos sin relevancia de contenido | No | Filtrado por la lista blanca de campos del manifiesto |

---

## 6. Flujo de estado y datos

1. Ocurre una mutación autorizada: una mutación humana atómica (subida, vínculo de evidencia, evento de revisión, respuesta humana) dentro de una transacción, o un lote de sincronización oficial completo (una invocación de `refreshTenderDocumentsFromOfficialSource`, identificado por un `source_batch_id` generado antes de su `for...of` interno).
2. El ingreso de señales compartido valida alcance, identidad, actor y clase de confianza. Para mutación humana, se invoca una vez por transacción. Para sincronización oficial, se invoca **una sola vez al completar el lote entero** (después de que `refreshTenderDocumentBatch` resuelve, usando `refreshResults`/`refreshSummary`), con la lista agregada de documentos cuya versión cambió exitosamente dentro de ese `source_batch_id` — nunca una vez por cada `psi_record_tender_document_version`.
3. Señal(es) válida(s) y confiable(s) de esa transacción/lote, bajo el advisory lock de oportunidad descrito en §4.2:
   - Si no hay job activo ni despachado para la oportunidad: todas las señales de esa misma transacción/lote se adjuntan a un conjunto de cambios nuevo, o al conjunto "activo-acumulando" ya abierto para la oportunidad (se crea si no existe).
   - Si ya hay un job activo/despachado para la oportunidad: la(s) señal(es) se adjunta(n) de forma idempotente al único conjunto sucesor "activo-acumulando" de esa oportunidad (se crea si no existe); ese conjunto puede recibir señales de múltiples transacciones/lotes sucesivos mientras el job siga activo, sin sellarse en cada una.
4. Señal incierta → se persiste, inmutable, en estado de validación pendiente; no se crea ni modifica ningún conjunto de cambios; no hay job. Su validación posterior, si ocurre, crea una nueva señal/evento que la referencia, sin mutarla.
5. Sellado y despacho:
   - Si no hay job activo: al cerrar la transacción/lote que originó el conjunto (la transacción humana, o la única invocación de ingreso de señales posterior al lote oficial completo identificado por `source_batch_id`), la misma RPC fenced que adquirió el advisory lock de la oportunidad calcula el `manifest_hash`, sella el conjunto, y se intenta el despacho de inmediato (llamada de despertar al worker) — todo dentro de la misma transacción.
   - Si hay un job activo: el conjunto sucesor permanece abierto y sin sellar mientras el job activo no llega a su transición terminal. En esa transición terminal, una RPC fenced adquiere el advisory lock de la oportunidad (§4.2), bloquea `FOR UPDATE` la fila del conjunto, lee la membresía, sella/hashea el conjunto sucesor exactamente una vez, y lo despacha — todo en la misma transacción atómica.
6. El worker/executor consume el manifiesto, valida procedencia e identidad del run previo, analiza el delta, persiste el nuevo run canónico con `supersedes_run_id`, y transiciona el conjunto a cerrado (procesado).
7. En caso de fallo: el conjunto transiciona a estado cerrado-con-error con `safe_error`, registrado en el conjunto/ledger de transiciones (nunca reescribiendo las señales), preservando toda la evidencia inmutable para reintento o diagnóstico.

---

## 7. Concurrencia e idempotencia

- Un job activo o despachado como máximo por oportunidad, forzado por un índice único parcial sobre `agt002_incremental_change_sets` (migración `097`).
- Un conjunto sucesor "activo-acumulando" como máximo por oportunidad mientras el job activo no termina, forzado por un segundo índice único parcial; ese conjunto puede acumular señales de múltiples transacciones/lotes sucesivos y permanece sin sellar hasta entonces.
- Ambas RPCs fenced ("adjuntar señal" y "sellar en transición terminal") serializan contra la misma oportunidad mediante `pg_advisory_xact_lock` con la semilla fija documentada en §4.2, adquirido antes de leer o escribir cualquier conjunto de esa oportunidad, más `SELECT ... FOR UPDATE` sobre la fila del conjunto seleccionado. La lectura de membresía, el cálculo de `manifest_hash` y la transición a `sellado` son atómicos dentro de la misma transacción de la RPC.
- Sin job activo, todas las señales de una misma mutación humana atómica, o de un mismo lote de sincronización oficial identificado por su `source_batch_id` (p. ej. N documentos oficiales cambiados en un solo sync, o N archivos subidos en una sola operación), se agrupan en un solo conjunto, sellado al cierre de esa transacción/lote —para el lote oficial, al completar el `for...of` entero, no por cada documento—, con **un solo manifiesto/job** resultante, incluso si alguno de los N documentos individuales falló durante el lote (el manifiesto incluye únicamente las versiones cambiadas con éxito).
- Con job activo, las señales confiables se adjuntan de forma idempotente al conjunto sucesor sin sellarlo por cada transacción de origen; el sellado ocurre una sola vez, mediante la RPC fenced que adquiere el advisory lock de la oportunidad, en el momento de la transición terminal del job activo.
- Misma identidad de fuente + misma versión + mismo hash de contenido → idempotente; no genera una segunda señal efectiva ni una segunda membresía en el conjunto.
- El camino de respuesta humana existente, que hoy devuelve "busy" cuando hay un job activo, se adapta para que ese evento posterior no se pierda: se adjunta al conjunto sucesor acumulando en lugar de descartarse.
- Reintentos del worker sobre el mismo manifiesto son idempotentes (mismo `manifest_hash` → mismo resultado, sin duplicar el run canónico).

---

## 8. Errores y recuperación

- Toda señal es inmutable tras su inserción; toda transición de un conjunto de cambios (sellado, despacho, cierre, cierre con error) queda registrada en el ledger de transiciones de solo anexado. Un fallo de procesamiento no destruye evidencia: se refleja como una transición adicional hacia estado cerrado-con-error, sin reescribir la señal ni la membresía ya sellada.
- Los errores se registran como `safe_error` en el conjunto/ledger de transiciones: mensajes seguros, sin volcar contenido sensible ni secretos.
- Si el despertar del worker falla tras el sellado, el estado pendiente durable permite recuperación posterior: el despertar de recuperación condicional del wrapper `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh` (como máximo uno, tras scan y reconciliación) recoge conjuntos pendientes sin necesidad de sondeo continuo.
- Un fallo parcial de un documento individual dentro de un lote de sincronización oficial (`source_batch_id`) no aborta el resto del lote ni impide el cierre del conjunto/manifiesto único de ese lote: el documento fallido simplemente no genera una señal, y queda diagnosticable mediante el `source_batch_id` compartido con los documentos que sí se versionaron con éxito.
- Un job que falla deja su conjunto en estado cerrado-con-error; un reintento (manual o por el siguiente despertar) reprocesa el mismo manifiesto de forma idempotente.

---

## 9. Autorización y privacidad

- Todo el ingreso de señales y las RPC de la migración `097` son accesibles **solo con rol de servicio**; RLS bloquea acceso directo de clientes.
- Los predicados hoy existentes (`requireHumanTenderIdentity` y `ensureOpportunityAccess`, ver §3) **no prueban** por sí solos una autoridad de Licitaciones activa y vigente: el primero solo excluye identidades de tipo `agent`, y el segundo solo verifica acceso CRM puntual a la oportunidad. Este diseño define un **nuevo predicado compartido, `requireAuthorizedLicitacionesAnalysisActor`**, que exige conjuntamente: (1) identidad humana autenticada (reutilizando `requireHumanTenderIdentity`), (2) perfil autoritativo del actor en estado activo, (3) acceso a la oportunidad objetivo (reutilizando `ensureOpportunityAccess`), y (4) el permiso `ACTIONS.AI_ANALYSIS_RUN` vigente para ese actor en el momento del evento. Este predicado nuevo se ejecuta **antes** de la creación de cualquier señal vinculada a mutación en ambos backends espejados (`server/index.js` y `api/[...path].js`), como parte del servicio de ingreso de señales (§4.1), y no sustituye ni debilita los permisos de mutación ya existentes para las rutas que producen la mutación en sí (p. ej. guardar una respuesta, subir un documento): esos permisos de mutación se mantienen sin cambios; `requireAuthorizedLicitacionesAnalysisActor` es un chequeo adicional, específico para admitir la señal de reanálisis, no un reemplazo del chequeo de autorización de la mutación.
- Los eventos de origen humano exigen actor autenticado, activo, con autoridad de Licitaciones vigente en el momento del evento, verificado mediante `requireAuthorizedLicitacionesAnalysisActor`; esto se valida en el ingreso, no se re-valida como una segunda aprobación.
- La autorización de la mutación humana es exactamente eso: autorización para incluir esa evidencia en el análisis. No constituye ni sustituye GO/NO-GO, envío, publicación, conversión, firma, ni comunicación externa.
- El manifiesto de delta no admite listas de documentos provistas por el cliente; se resuelve server-side para evitar que un cliente fuerce la inclusión de material no autorizado.
- Los `safe_error` y los registros de observabilidad no contienen secretos ni contenido de documentos sensible fuera de lo ya permitido por los mecanismos de gobierno existentes.

---

## 10. Observabilidad

- Cada señal, conjunto de cambios, manifiesto y job queda trazable: disparador, actor, fuente, identidad/versión/hash, momento, y resultado.
- Se reutilizan los mecanismos de observabilidad existentes (p. ej. `agt002-analysis-observability.js`) para registrar despachos, despertares del worker, y cierres de conjuntos.
- La proyección de UI expone disparador/actor/momento como parte del resultado (sección 4.7), apoyada en los mismos datos de observabilidad.

---

## 11. Rollout y rollback

- La migración `097` es aditiva; no modifica columnas ni tablas de migraciones previas. Incluye su rollback aditivo correspondiente.
- El ingreso de señales y el ledger pueden desplegarse en modo "solo escritura, sin despacho" inicialmente si se desea una activación gradual, pero el diseño no depende de un flag permanente: una vez habilitado el despacho, el comportamiento es el descrito en este documento.
- Retiro del `agt002-reanalysis-worker.timer`: se elimina el temporizador de 30 segundos; el worker (el binario/proceso) se conserva y pasa a ser despertado solo por despacho explícito o por el despertar de recuperación condicional del wrapper `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh`. Este wrapper hoy contiene la invocación retirada del worker del pipeline de Radar (`agt002-radar-pipeline`); la implementación de este diseño **reemplaza esa llamada residual** por el despertar condicional de reanálisis incremental descrito en §4.5/§8 — no se revive el pipeline de Radar bajo ningún punto de este cambio.
- **Reversión operativa (sin pérdida de evidencia):** deshabilitar el ingreso de señales nuevas y el despacho detiene la creación de conjuntos nuevos y el despertar del worker, sin afectar runs canónicos ya promovidos (que permanecen legibles) ni las señales/conjuntos de cambios ya escritos por la migración `097`, que se preservan intactos como evidencia. Esta es la vía por defecto para revertir comportamiento.
- **Rollback SQL de la migración `097`** (elimina el ledger de señales, los conjuntos de cambios, el ledger de transiciones y las RPCs nuevas): es destructivo y **falla cerrado por defecto**. El propio script de rollback incluye un **guard de preflight nombrado**, ejecutado dentro de la misma transacción de rollback, que cuenta las filas de **cada una de las tablas nuevas que introduce la migración `097`** — el ledger de señales (cuya columna `change_set_id` materializa la membresía señal→conjunto, sin una tabla de unión separada), los conjuntos de cambios, y el ledger de transiciones de solo anexado — y ejecuta `raise exception` si **cualquiera** de esos conteos es mayor que cero, abortando el rollback antes de ejecutar cualquier `DROP`. El rollback destructivo solo completa sin abortar cuando todas esas tablas están vacías (equivalente a: nunca hubo activación en producción). Si existe evidencia de producción (al menos una fila en cualquiera de las tablas nuevas de `097`), el guard de preflight aborta el `DROP` incondicionalmente: en ese caso la única reversión permitida es la **reversión operativa** descrita arriba (deshabilitar ingreso/despacho), y el esquema junto con toda la evidencia permanecen intactos. No existe una vía para ejecutar el `DROP` sobre tablas con filas aunque se haya exportado evidencia previamente: exportar no es, por sí solo, una condición habilitante para el rollback SQL destructivo.

---

## 12. No-objetivos explícitos

- No se añade un segundo runner o pipeline de IA paralelo al executor existente.
- No se revive ninguna de las rutas retiradas con 410 (`/api/tender-documents-analyze-agent-preview`, `/api/tender-analysis-authorize`, `/api/agt002-reanalyze-fixed-snapshot`).
- No se implementa el reanálisis completo bajo este disparador incremental; el reanálisis completo sigue siendo una acción humana explícita y separada.
- No se incluyen candidatos de Radar en ningún punto de este flujo.
- No se introduce sondeo continuo ni temporizador recurrente de corta duración.
- No se implementa aquí ningún mecanismo de GO/NO-GO, envío, publicación, conversión, firma, ni comunicación externa: el reanálisis incremental es estrictamente analítico. Esto incluye no invocar nunca la acción gobernada `ACTIONS.LICITACIONES_GO_NO_GO_APPROVE`; la etiqueta interna `go_no_go` de `buildTenderDocumentAnalysis` (ver §4.6) es una advertencia de reglas determinísticas no gobernada, y no se confunde ni se fusiona con esa acción.
- No se añade una segunda etiqueta pública de compatibilidad en la UI.
- No se añade un escritor de revisión en tiempo de ejecución al registro de evidencia de empresa (migración `061`); solo se añade un evento de vínculo de solo anexado que referencia una versión existente. Cualquier escritor real de revisión/actualización sobre `061` es un camino de escritura separado y gobernado de forma independiente, fuera de este diseño.
- La etiqueta o el resultado del flujo de una revisión accionable (migración `078`) nunca se convierte en GO/NO-GO ni en una decisión de negocio automática; solo su texto/evidencia puede disparar el análisis de impacto incremental.

---

## 13. Criterios de aceptación

1. Solo las oportunidades convertidas pueden generar un disparo; una identidad o fuente bloqueada/incierta nunca invoca al proveedor de IA.
2. Misma identidad de fuente, misma versión, mismo hash → deduplicado; N documentos oficiales cambiados dentro de un mismo `source_batch_id`, o N archivos provenientes de una sola mutación humana atómica, generan **un único manifiesto/job** por oportunidad — incluyendo el caso en que alguno de los N documentos oficiales falle individualmente durante el lote: el manifiesto único resultante incluye solo las versiones cambiadas con éxito, y el ingreso de señales para el lote se invoca una sola vez, después de que el lote completo resuelve, nunca por cada `psi_record_tender_document_version`.
3. Un evento confiable que llega mientras hay un job activo se preserva (no se descarta): se adjunta sin sellar al conjunto sucesor acumulando, y en la transición terminal de ese job la RPC fenced adquiere el advisory lock de oportunidad (§4.2/§7), bloquea `FOR UPDATE` la fila del conjunto, sella/hashea ese conjunto y lo despacha, exactamente una vez, de forma atómica dentro de la misma transacción. Una señal humana que llega exactamente cuando esa RPC de sellado terminal está en curso para la misma oportunidad queda serializada por el mismo lock: o se adjunta antes de que el lock se libere y queda reflejada en el manifiesto, o espera a que el sellado termine y se adjunta al siguiente conjunto — nunca se pierde ni queda en un estado ambiguo entre "sellado" y "no reflejada".
4. El input del análisis excluye documentos completos sin cambios: `buildAgt002IncrementalAnalysisInput` (§4.4) construye `analysisDocuments`, `deepAnalysis` y el `frozenEngineInput` únicamente a partir del manifiesto `incremental_delta_manifest_v1`, el contenido confiable cambiado, la proyección de hallazgos previos relevantes, y los excerpts de comparación grabados — nunca a partir de `currentDocs` íntegro como hace hoy el camino de respuesta humana (§3); los cambios puramente de metadatos producen cero llamadas al proveedor de IA.
5. El run canónico anterior permanece legible; el nuevo run referencia `supersedes_run_id`; en ningún punto del flujo se decide GO/NO-GO ni se invoca `ACTIONS.LICITACIONES_GO_NO_GO_APPROVE` ni se ejecuta ninguna otra acción externa.
6. Los documentos oficiales reutilizan las verificaciones de hash/extracción gobernadas ya existentes en el servidor, sin duplicarlas.
7. Toda evidencia de origen humano es atribuible a una persona de Licitaciones autenticada, con perfil autoritativo activo, con acceso a la oportunidad, y con el permiso `ACTIONS.AI_ANALYSIS_RUN` vigente en el momento del evento, verificado por `requireAuthorizedLicitacionesAnalysisActor` (§9) antes de crear la señal; los permisos de mutación existentes de la ruta de origen no se debilitan.
8. Los fallos preservan la evidencia inmutable de las señales; el conjunto de cambios transiciona a cerrado-con-error de forma auditable, registrado en el ledger de transiciones, con un error seguro (`safe_error`); los reintentos son idempotentes.
9. Las señales y la membresía de un conjunto sellado nunca se reescriben; toda transición de un conjunto de cambios ocurre solo vía RPC fenced con rol de servicio, serializada por el advisory lock de oportunidad descrito en §4.2/§7, y queda registrada en el ledger de transiciones de solo anexado; una señal incierta se valida mediante una nueva señal/evento que la referencia, nunca mutándola.
10. La reversión operativa (deshabilitar ingreso/despacho) nunca borra señales ni conjuntos de cambios existentes. Un rollback SQL que elimine las estructuras de la migración `097` falla cerrado por defecto: el guard de preflight del propio script aborta con `raise exception` si cualquiera de las tablas nuevas de `097` tiene una o más filas, de modo que el `DROP` solo se ejecuta cuando todas están vacías (nunca hubo activación en producción). Si existe evidencia de producción, la única reversión permitida es la operativa — nunca se elimina evidencia poblada únicamente por haberla exportado, ni porque los runs canónicos sobrevivan de forma independiente.
11. Los eventos de vínculo de evidencia de empresa nunca infieren ni escriben `verified`, `applicable` ni `cumplido` en el registro `061`, y no se implementa un escritor de revisión en tiempo de ejecución para esa migración.
12. La etiqueta/resultado de flujo de un evento de revisión accionable nunca se traduce en GO/NO-GO ni en una decisión de negocio automática; solo su texto/evidencia puede disparar el análisis de impacto. El campo advisorio interno `go_no_go` heredado de `buildTenderDocumentAnalysis` (§4.6), cuando está presente, se proyecta en la UI explícitamente como recomendación, nunca como decisión automática, y nunca se confunde con `ACTIONS.LICITACIONES_GO_NO_GO_APPROVE`.
13. El temporizador del worker queda eliminado y no hay sondeo vacío; el único despertar de recuperación condicional lo realiza el wrapper `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh` después del scan y la reconciliación diaria, solo cuando existe estado pendiente durable; `createAgt002RadarScan` y `agt002-radar-scan.service` permanecen sin capacidad de reclamar jobs ni invocar al proveedor de IA.
14. Paridad de backend entre `server/index.js` y `api/[...path].js` para todo el camino nuevo, incluyendo `requireAuthorizedLicitacionesAnalysisActor` y la generación/propagación de `source_batch_id`.
15. Cobertura de pruebas enfocadas: PGlite (migración `097`, RPCs, índices únicos parciales), HTTP (ingreso de señales y despacho), unitarias (construcción y hash del manifiesto, `buildAgt002IncrementalAnalysisInput`), systemd/estáticas (retiro del `.timer`, presencia del worker), de regresión (no se reviven las rutas 410, el camino de respuesta humana no pierde eventos durante "busy"), de concurrencia (una señal humana tardía que corre contra el sellado terminal de un job activo para la misma oportunidad nunca se pierde ni duplica el sellado, ver AC3), de importación oficial (N documentos oficiales cambiados en un mismo sync producen un único manifiesto/job, incluyendo el caso con fallos parciales por documento donde solo las versiones exitosas quedan incluidas), de autorización (`requireAuthorizedLicitacionesAnalysisActor` rechaza actor sin perfil activo o sin `ACTIONS.AI_ANALYSIS_RUN`), y de extremo a extremo tipo canario (disparo → manifiesto → job → run canónico sucesor visible).

---

## 14. Decisiones cerradas

- Alcance limitado exclusivamente a oportunidades ya convertidas; Radar queda fuera por completo.
- La mutación humana autorizada es, en sí misma, la autorización para el análisis; no existe una segunda aprobación ni una pantalla de confirmación adicional.
- La autorización de inclusión en análisis nunca se interpreta como GO/NO-GO, envío, publicación, conversión, firma o comunicación externa.
- El material con fuente o identidad incierta se excluye del análisis y se preserva en estado de validación pendiente; no se crea trabajo de IA hasta validar la procedencia.
- La reconciliación de plazo/estado/`last_seen`/metadatos crudos permanece determinista, puede notificar, y nunca invoca IA.
- El análisis incremental usa únicamente material confiable nuevo/modificado más la proyección inmutable de hallazgos canónicos previos relevantes; nunca reenvía documentos completos sin cambios. Los excerpts de comparación de material sin cambios solo se permiten cuando un hallazgo previo afectado los cita, y quedan registrados.
- El run canónico sucesor es de solo anexado; el run anterior permanece legible; los hallazgos no afectados se trasladan mecánicamente.
- El reanálisis completo queda fuera de este alcance y sigue siendo una acción humana explícita separada.
- El despacho es dirigido por eventos; se elimina el `.timer` de 30 segundos; el wrapper `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh` realiza como máximo un despertar de recuperación condicionado a estado pendiente durable, después del scan y la reconciliación diaria; `createAgt002RadarScan`/`agt002-radar-scan.service` permanecen sin capacidad de reclamar jobs ni invocar al proveedor.
- La deduplicación es por conjunto de cambios por oportunidad/grupo de cambio, con idempotencia por identidad/versión/hash de fuente; un job activo retiene los eventos nuevos en un único conjunto sucesor acumulando (sin sellar por transacción), sellado y despachado una sola vez en la transición terminal del job, tras adquirir el advisory lock de oportunidad.
- Para sincronización oficial, la unidad de agrupación es el `source_batch_id` del lote completo (una invocación de `refreshTenderDocumentsFromOfficialSource`), no cada llamada individual a `psi_record_tender_document_version`; el ingreso de señales para documentos oficiales se invoca una sola vez por lote, al completarse.
- El primitivo de serialización común a ambas RPCs fenced es un `pg_advisory_xact_lock` con clave `(namespace fijo de AGT-002 incremental, opportunity_id)`, definido con una semilla inmutable única en la migración `097`, más `SELECT ... FOR UPDATE` sobre la fila del conjunto; la lectura de membresía, el cálculo de `manifest_hash` y el sellado son atómicos en la misma transacción.
- El input de análisis incremental se construye con una nueva función, `buildAgt002IncrementalAnalysisInput`, que reemplaza —solo para este camino— la construcción basada en `currentDocs` íntegro que usa hoy el camino de respuesta humana; se reutilizan el runner y la persistencia de `enqueueAgt002CanonicalReanalysis`, no su construcción actual de `analysisDocuments`/`deepAnalysis`.
- Se introduce un nuevo predicado compartido, `requireAuthorizedLicitacionesAnalysisActor`, exigido antes de crear cualquier señal vinculada a mutación humana, porque los predicados existentes (`requireHumanTenderIdentity`, `ensureOpportunityAccess`) no prueban por sí solos autoridad de Licitaciones activa y vigente; no reemplaza ni debilita los permisos de mutación existentes de las rutas de origen.
- El rollback SQL destructivo de la migración `097` falla cerrado por defecto: solo se ejecuta cuando un guard de preflight transaccional confirma que las tablas nuevas de `097` tienen cero filas; con evidencia de producción, la única reversión válida es la operativa.
- La migración nueva es `097`, aditiva sobre el estado verificado en `origin/main` commit `223a085` (última migración existente: `096`), con su rollback correspondiente.
- No se crea un segundo runner de IA; se reutiliza el executor existente extendido para el nuevo contrato de delta.
- No se reviven las rutas retiradas con 410.
- El campo advisorio `go_no_go` interno de `buildTenderDocumentAnalysis` se distingue por nombre y por proyección de UI de la acción gobernada `ACTIONS.LICITACIONES_GO_NO_GO_APPROVE`; el camino incremental nunca invoca esta última.

---

## 15. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Un cliente malicioso o un bug intenta forzar la inclusión de documentos sin cambios en el manifiesto | El manifiesto se construye exclusivamente server-side a partir de señales ya validadas; nunca se acepta una lista de documentos provista por el cliente |
| Pérdida de un evento confiable llegado durante un job activo (regresión del comportamiento "busy" actual) | Los eventos durante un job activo se adjuntan, sin sellar, a un conjunto sucesor durable explícito; en la transición terminal del job la RPC fenced adquiere el advisory lock de oportunidad y ese conjunto se sella/despacha exactamente una vez, en vez de descartarse |
| Explosión de jobs por ráfagas de mutaciones (p. ej. subida masiva de documentos, o un sync oficial con N documentos cambiados) | Sin job activo, todas las señales de una misma transacción humana, o de un mismo lote oficial identificado por `source_batch_id`, se agrupan en un único conjunto sellado al completar esa transacción/lote entero (nunca por cada documento individual), antes del despacho; con job activo, se agrupan en el único conjunto sucesor acumulando; deduplicación por identidad/versión/hash en ambos casos |
| Un rollback SQL destructivo de la migración `097` borra evidencia de producción solo porque los runs canónicos sobreviven de forma independiente, o porque se exportó evidencia previamente | El rollback SQL que elimina las estructuras de `097` falla cerrado por defecto: un guard de preflight transaccional aborta con `raise exception` si cualquiera de las tablas nuevas de `097` tiene filas; con evidencia de producción, la única reversión permitida es la operativa (deshabilitar ingreso/despacho), que no borra nada |
| Un vínculo de evidencia de empresa se interpreta erróneamente como verificación/cumplimiento del registro `061` | La migración `097` solo añade un evento de vínculo de solo anexado que referencia una versión existente de `061`; nunca infiere ni escribe `verified`/`applicable`/`cumplido`, y no incorpora un escritor de revisión sobre `061` |
| La etiqueta/resultado de flujo de una revisión accionable se confunde con una decisión de negocio | Solo el texto/evidencia de la revisión dispara el análisis de impacto; su etiqueta de flujo nunca se traduce en GO/NO-GO ni en una decisión automática |
| El campo advisorio interno `go_no_go` de `buildTenderDocumentAnalysis`/`deepAnalysis` se confunde con la acción gobernada `ACTIONS.LICITACIONES_GO_NO_GO_APPROVE` | Ambos se distinguen por nombre en §4.6/§4.7/§12; el camino incremental nunca invoca la acción gobernada; la UI etiqueta el campo heredado explícitamente como recomendación, nunca como decisión automática |
| Confundir el ciclo de vida del conjunto de cambios con una reescritura de señales inmutables, o una condición de carrera (TOCTOU) entre "adjuntar señal" y "sellar en transición terminal" para la misma oportunidad | Ambas RPCs fenced serializan mediante el mismo `pg_advisory_xact_lock` con semilla fija (§4.2/§7), adquirido antes de leer/escribir cualquier conjunto de la oportunidad, más `FOR UPDATE` sobre la fila del conjunto; lectura de membresía, `manifest_hash` y sellado son atómicos en la misma transacción; las señales y la membresía ya sellada nunca se reescriben; transiciones quedan en un ledger de solo anexado |
| Reintroducción accidental de sondeo continuo al extender el worker, o reactivación del pipeline de Radar retirado al reutilizar el wrapper diario | El worker solo se despierta por despacho explícito tras commit o por el único despertar de recuperación condicional del wrapper `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh`, que reemplaza ahí la llamada residual al worker retirado del pipeline de Radar sin revivirlo; se retira el `.timer` de 30 segundos; `createAgt002RadarScan`/`agt002-radar-scan.service` permanecen sin capacidad de reclamar jobs ni invocar al proveedor |
| Señales de origen humano atribuidas a un actor que perdió autorización entre el evento y el procesamiento, o admitidas pese a no tener autoridad de Licitaciones vigente | `requireAuthorizedLicitacionesAnalysisActor` (identidad autenticada, perfil activo, acceso a la oportunidad, `ACTIONS.AI_ANALYSIS_RUN`) se evalúa en el ingreso, en el momento del evento, antes de crear la señal; el estado del actor queda congelado en la señal inmutable para auditoría |
| Ambigüedad de identidad de fuente (hash/versión no resolubles) genera trabajo de IA indebido | Toda señal con identidad incierta se desvía a estado de validación pendiente sin crear job ni manifiesto; solo se procesa tras validación explícita de procedencia |
| Divergencia entre `server/index.js` y `api/[...path].js` en el nuevo camino | Los criterios de aceptación exigen paridad explícita de backend y pruebas de regresión dedicadas sobre ambos archivos espejados |
| El nuevo run canónico sucesor introduce inconsistencias con hallazgos previos no afectados | Los hallazgos no afectados se trasladan mecánicamente (copia referenciada, no reinterpretada) desde el run previo citado por `supersedes_run_id`, sin pasar por el modelo de IA |
| Fallo del despertar del worker tras el sellado deja trabajo sin procesar indefinidamente | El estado del conjunto de cambios es durable; el despertar de recuperación condicional del wrapper diario actúa como respaldo cuando existe estado pendiente |
| El camino de análisis incremental hereda accidentalmente la construcción de input completo (`currentDocs`) del camino de respuesta humana existente | `buildAgt002IncrementalAnalysisInput` es una función nueva y explícita que reemplaza esa construcción solo para el camino incremental; el camino de respuesta humana existente no cambia su comportamiento salvo por esta vía de entrada paralela |

---

## 16. Inventario de archivos de implementación (referencia, no desglose de tareas)

- `server/index.js` y `api/[...path].js` — extensión espejada de los puntos de mutación existentes para invocar el nuevo ingreso de señales; generación del `source_batch_id` en `refreshTenderDocumentsFromOfficialSource` antes de invocar `refreshTenderDocumentBatch`, e invocación única del ingreso de señales después de que el lote completo resuelve (usando `refreshResults`/`refreshSummary`); integración de `requireAuthorizedLicitacionesAnalysisActor` antes de crear señales vinculadas a mutación humana.
- `tender-document-versioning.js` — `refreshTenderDocumentBatch` propaga el `source_batch_id` recibido a cada resultado individual del lote (incluidos los fallidos, para diagnóstico) sin alterar su recorrido secuencial por documento ni su manejo de fallos parciales existente.
- `agt002-incremental-reanalysis-triggers.js` (nuevo) — servicio compartido de ingreso de señales, validación de alcance/identidad/actor (vía `requireAuthorizedLicitacionesAnalysisActor` para origen humano), construcción del manifiesto `incremental_delta_manifest_v1` (incluido `source_batch_id` cuando aplica), y del evento de vínculo de evidencia de empresa que referencia `061` sin reescribirlo; invocado una sola vez por lote oficial o por transacción humana, nunca por documento individual.
- `agt002-incremental-analysis-input.js` (nuevo) — define `buildAgt002IncrementalAnalysisInput`, que construye `analysisDocuments`/`deepAnalysis` delta-only a partir del manifiesto, el contenido confiable cambiado, la proyección de hallazgos previos y los excerpts registrados, para integrarse con `enqueueAgt002CanonicalReanalysis` sin pasar por `currentDocs` íntegro.
- `supabase/migrations/097_agt002_incremental_reanalysis_triggers.sql` (nueva) — ledger de señales inmutable (con `source_batch_id`), conjuntos de cambios, ledger de transiciones de conjunto de solo anexado, índices únicos parciales (un job activo/despachado y un conjunto "activo-acumulando" como máximo por oportunidad), la constante nombrada de la semilla fija del advisory lock namespace de AGT-002 incremental, RPCs fenced service-role-only que adquieren `pg_advisory_xact_lock`/`FOR UPDATE` antes de leer o escribir membresía, y RLS.
- `supabase/rollbacks/097_agt002_incremental_reanalysis_triggers_rollback.sql` (nuevo) — rollback aditivo con guard de preflight transaccional nombrado que cuenta filas de cada tabla nueva de `097` y aborta con `raise exception` si alguna es mayor que cero, sujeto a las condiciones de uso de la sección 11.
- `agt002-reanalysis-jobs.js` — adaptadores para aceptar el nuevo manifiesto como origen de job, para acumular el conjunto sucesor durante un job activo, y para sellarlo exactamente una vez mediante la RPC fenced con advisory lock en la transición terminal.
- `agt002-reanalysis-worker.js` y `agt002-reanalysis-executor.js` — extensión mínima para consumir el contrato de delta vía `buildAgt002IncrementalAnalysisInput`, validar procedencia, evitar propagar `go_no_go` salvo que el delta lo afecte, y persistir vía el camino canónico existente.
- `agt002-governed-document-workset-api.js` — reutilización de la resolución de worksets gobernados para los documentos involucrados en el delta.
- Predicado de autorización compartido `requireAuthorizedLicitacionesAnalysisActor` (nuevo, ubicado junto a `requireHumanTenderIdentity`/`ensureOpportunityAccess` en `server/index.js`, espejado en `api/[...path].js`) — identidad humana autenticada + perfil activo + acceso a la oportunidad + `ACTIONS.AI_ANALYSIS_RUN`.
- `ops/agt002-reanalysis-worker/` — retiro de `agt002-reanalysis-worker.timer`; ajuste de artefactos/documentación systemd para el modelo de despertar por despacho y recuperación condicional.
- `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh` — reemplazo de la llamada residual al worker retirado del pipeline de Radar por el despertar condicional de reanálisis incremental, ejecutado después del scan y la reconciliación; sin tocar `createAgt002RadarScan` ni `agt002-radar-scan.service`.
- `tests/` — pruebas PGlite para la migración `097` (ledger de señales con `source_batch_id`, índices únicos parciales, RPCs fenced con advisory lock); pruebas HTTP para el ingreso de señales y el despacho; pruebas unitarias para la construcción y el hash del manifiesto y para `buildAgt002IncrementalAnalysisInput`; pruebas systemd/estáticas para el retiro del `.timer`; pruebas de regresión para las rutas 410 y para la preservación de eventos durante "busy"; prueba de concurrencia para una señal humana tardía que corre contra el sellado terminal de un job activo en la misma oportunidad; prueba de importación oficial con N documentos cambiados en un mismo `source_batch_id` produciendo un único manifiesto/job, incluyendo fallos parciales por documento; prueba de `requireAuthorizedLicitacionesAnalysisActor` rechazando actor sin perfil activo o sin `ACTIONS.AI_ANALYSIS_RUN`; prueba de extremo a extremo tipo canario para el flujo completo disparo → manifiesto → job → run canónico sucesor.
