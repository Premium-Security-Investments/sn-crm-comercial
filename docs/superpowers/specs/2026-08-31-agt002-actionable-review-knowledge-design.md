# AGT-002 — revisión accionable de pendientes y conocimiento reutilizable

**Fecha:** 2026-08-31

**Estado:** diseño aprobado; requiere revisión de la especificación antes del plan de implementación

**Alcance:** colaboración humana sobre pendientes ya emitidos por el análisis canónico, resolución auditable, preparación de fichas de conocimiento y publicación gobernada en la biblioteca corporativa.

**Decisión de producto:** Juan aprobó el flujo descrito en este documento.

## 1. Resumen

La experiencia actual convierte el resultado canónico de AGT-002 en una lectura operativa, pero un pendiente todavía es una tarjeta de consulta. Este diseño añade el CTA **«Revisar pendiente»** y un drawer colaborativo para comentar, adjuntar soportes, resolver, reabrir y proponer conocimiento reutilizable sin modificar el análisis que originó el pendiente.

El flujo separa tres artefactos con autoridades distintas:

1. **Análisis canónico:** evidencia y conclusión inmutables de una corrida de `psi_tender_analysis_runs`.
2. **Revisión humana:** bitácora append-only vinculada a una identidad estable del pendiente dentro de esa corrida.
3. **Conocimiento corporativo:** ficha versionada, saneada y aprobada por una persona autorizada; sólo una versión publicada puede proyectarse como activo aprobado de Vig-IA y su único artefacto documental vive bajo `Comercial/Licitaciones/02 Biblioteca corporativa`.

Comentar, adjuntar, resolver, reabrir, proponer o publicar conocimiento **no** ejecuta AGT-002, no crea una corrida, no actualiza el set documental del proceso y no registra ni cambia GO/NO-GO.

## 2. Estado real del repositorio y contratos que se conservan

Este diseño se apoya en nombres y comportamientos existentes:

- `psi_tender_analysis_runs`, `psi_tender_analysis_snapshots` y `psi_tender_analysis_context_versions` conservan corridas y contexto de análisis.
- `deriveAgt002GenericDecisionReview` proyecta `integral_analysis.analysis_units` a `decision_review`; cada hallazgo genérico usa `generic-review-${unit.unit_id}`.
- `TenderDecisionExperience` es el montaje único de la experiencia; `TenderDecisionAxisSurface` contiene la lectura `Análisis para decidir`; `tenderDecisionSurface.ts` y `tenderIntegralAnalysisPresentation.ts` hacen las proyecciones puras.
- Los anclajes existentes son `#tender-analysis` para **Análisis** y `#tender-decision` para **Decisión**. No se renombran ni duplican.
- `ensureTenderOpportunity` llama a `ensureOpportunityAccess`; éste resuelve el `owner_id` de `psi_sales_opportunities`, consulta `psi_profile_area_assignments` del responsable y evalúa permisos con `requireExistingOpportunityAction`/`crmResource`.
- La respuesta humana histórica usa `psi_tender_question_responses`, `psi_tender_question_response_attachments`, `GET/POST /api/tender-question-responses` y `POST /api/tender-question-response-attachment-upload-url`. El `POST /api/tender-question-responses` llama hoy a `reanalyzeAgt002AfterHumanAnswer`. El nuevo flujo no usa esas tablas ni esos endpoints porque su invariante es no reanalizar el caso actual.
- Los adjuntos históricos permiten hasta 8 archivos de 25 MiB con PDF, PNG, JPEG, DOCX, XLSX o TXT; validan tamaño, SHA-256 y MIME descargando el objeto antes de registrar; las descargas usan URL firmada. Este diseño conserva y endurece ese patrón, pero mantiene los soportes en un namespace distinto.
- `psi_agt002_learning_proposals` y `psi_agt002_learning_decisions` pertenecen a la Mesa Vig-IA de `045_agt002_dossier_workbench.sql`: nacen de mensajes/jobs del workbench y pueden convertirse en políticas activas. No representan fichas corporativas publicadas y no se reutilizan aquí.
- `tender-offer-preparation.js` sólo proyecta hoy `sharepoint_folder.status = 'pendiente_configurar_integracion'`; no existe un adaptador de escritura SharePoint. `vigia-approved-assets.js` sí valida un manifiesto `vigia-approved-assets-v1`, exige URL HTTPS en un host `*.sharepoint.com`, estado `approved`, vigencia y URL sin query ni fragmento. `config/vigia-approved-assets.v1.json` está activo y vacío.
- La migración más alta presente es `077_agt002_canonical_persistence_statement_timeout.sql`. El trabajo separado **«Archivar como aprendizaje»** reserva la migración 078. Esta funcionalidad usa `079_agt002_actionable_review_knowledge.sql` y su rollback homónimo; nunca reclama 078, aunque el despliegue de 078 se retrase.

## 3. Objetivo

Permitir que el equipo autorizado transforme un pendiente estructural de una corrida canónica en una revisión humana trazable y, cuando corresponda, en conocimiento reutilizable gobernado, con estas capacidades:

- identificar sin ambigüedad el pendiente y su corrida de origen;
- comentar y adjuntar evidencia específica sin alterar documentos oficiales;
- distinguir actividad, resolución vigente y reaperturas;
- resumir en **Decisión** cuántos pendientes siguen abiertos y cuántos riesgos están confirmados por revisión humana;
- solicitar reutilización al resolver;
- generar con Vig-IA una ficha candidata sólo desde la resolución y los soportes expresamente aprobados;
- someter, rechazar, publicar y reemplazar versiones de conocimiento;
- publicar un único artefacto versionado bajo la raíz corporativa aprobada;
- habilitar su reutilización futura sin retroactividad sobre el análisis que lo originó.

## 4. No objetivos

Quedan fuera de esta entrega:

- mutar `result`, `decision_review`, snapshots o contexto de una corrida existente;
- llamar `reanalyzeAgt002AfterHumanAnswer`, encolar `psi_agt002_reanalysis_jobs`, refrescar documentos o ejecutar el proveedor AGT-002;
- cambiar, bloquear o automatizar `TenderGoNoGoDecisionPanel`, `psi_tender_decisions` o el estado de oferta;
- convertir soportes de revisión en `psi_tender_document_versions`, anexos oficiales, RUP o evidencia empresarial aprobada;
- sustituir la Mesa Vig-IA, sus `psi_agt002_learning_proposals`, ni el flujo separado **«Archivar como aprendizaje»**;
- mezclar esta entrega con el rediseño visual aprobado el 2026-08-30; ese rediseño conserva su alcance de selectores/UI y esta entrega sólo añade la acción colaborativa sobre sus tarjetas;
- editar en sitio los contratos publicados bajo `contracts/agents/AGT-002/v3`;
- declarar que un archivo está libre de malware cuando el entorno no dispone de un analizador antimalware;
- publicar automáticamente conocimiento generado por un modelo;
- copiar el artefacto publicado a carpetas de expedientes, OneDrive personal u otra biblioteca.

## 5. Principios e invariantes

1. **Análisis inmutable.** La revisión referencia una corrida y un origen; nunca escribe en la corrida ni sustituye su conclusión.
2. **Identidad estructural, no textual.** No se calcula identidad a partir de título, resumen o posición visual.
3. **Append-only.** Comentarios, actividad, resolución, reapertura, archivos, selección de soportes, versiones, aprobaciones y publicaciones se insertan; `UPDATE` y `DELETE` son rechazados por trigger.
4. **Autoría completa.** Cada inserción registra actor, fecha y origen cerrado. Un agente no suplanta a una persona para comentar, resolver, reabrir, aprobar o publicar.
5. **Autoridad humana.** Vig-IA propone; una persona autorizada revisa y publica.
6. **Separación documental.** Un soporte de revisión no es documento oficial ni altera cobertura, snapshot, extracción, manifest o hash documental.
7. **Sin efecto decisorio implícito.** Resolver pendientes no registra GO/NO-GO; la decisión humana formal permanece separada.
8. **Fail-closed.** Si falla autenticación, ámbito, relación con la oportunidad, versión esperada, validación de archivo, saneamiento o publicación, no se registra el paso sensible.
9. **Sin conocimiento retroactivo.** Publicar no reanaliza la oportunidad fuente. Sólo nuevas consultas compatibles pueden considerar una versión vigente.
10. **Una sola publicación lógica.** Cada conocimiento tiene una ruta SharePoint determinista y un `drive_item_id`; una versión nueva actualiza ese ítem y usa el versionado de SharePoint.
11. **No pérdida histórica.** Una nueva corrida crea nuevas identidades de pendiente; las revisiones de una corrida anterior quedan consultables, pero no se trasladan como resolución de la nueva.
12. **Privacidad por defecto.** Datos específicos de entidad, contacto, precio, identificación personal, credenciales y secretos no pasan al resumen reutilizable sin alcance y autorización explícitos.

## 6. Identidad estable del pendiente

### 6.1 Fuentes elegibles

La proyección del servidor construye candidatos en este orden:

1. Cada entrada de `analysis.integral_analysis.analysis_units` cuyo `closure.status` no sea `evidence_satisfied`. Su `source_kind` es `integral_unit` y su `source_id` es `unit.unit_id`.
2. Cada entrada de `analysis.decision_review.blockers` o `analysis.decision_review.decision_questions` que no esté respaldada por una unidad del punto anterior. Su `source_kind` es `decision_review_finding` y su `source_id` es `finding.id`.

La deduplicación sólo ocurre cuando un hallazgo tiene `requirement_id` no vacío e idéntico al de una unidad abierta. En ese caso la unidad es la raíz y el hallazgo se conserva como presentación asociada. No se deduplica por semejanza de texto.

`analysis.decision_review.supported`, `preparation` y `not_applicable` no crean pendientes. Un valor futuro desconocido se muestra en consulta, pero no admite revisión hasta contar con `source_kind` soportado.

### 6.2 Clave y registro

`psi_tender_actionable_review_items` materializa una identidad con unicidad en:

`(analysis_run_id, source_kind, source_id)`.

Campos obligatorios:

- `id uuid`;
- `opportunity_id uuid`;
- `tender_id uuid`;
- `analysis_run_id uuid`;
- `source_kind text` en `integral_unit | decision_review_finding`;
- `source_id text`;
- `requirement_id text null`;
- `source_hash text` SHA-256 de la proyección estructural normalizada;
- `origin text` con valor `canonical_analysis_projection`;
- `created_at timestamptz`.

El servidor deriva tarjetas en lectura sin escribir. En la primera acción, `psi_ensure_tender_actionable_review_item` valida que la corrida pertenece a la oportunidad, vuelve a localizar el origen dentro del resultado canónico y hace `INSERT ... ON CONFLICT` por la clave única. Si la identidad no existe en el payload o el hash no coincide, responde conflicto; nunca registra una raíz basada en texto enviado por el navegador.

Una unidad o hallazgo sin ID estructural se presenta como **«Pendiente sin identidad revisable»**, sin CTA, y aumenta la métrica de contrato inválido. No se fabrica un ID alternativo.

### 6.3 Corridas nuevas

La UI consulta por `analysis_run_id` vigente. Si ya existe actividad para una corrida anterior, muestra un aviso no bloqueante: **«Existe una revisión histórica de un análisis anterior; esta corrida requiere revisión propia.»** El drawer puede abrir la historia anterior en solo lectura. Ningún estado anterior cuenta como cierre del nuevo pendiente.

## 7. Roles y permisos

### 7.1 Acciones de `access-control.js`

La implementación añade estas claves exactas a `ACTIONS` y a la matriz cerrada:

- `LICITACIONES_ACTIONABLE_REVIEW_CONTRIBUTE`
- `LICITACIONES_ACTIONABLE_REVIEW_RESOLVE`
- `LICITACIONES_KNOWLEDGE_PROPOSE`
- `LICITACIONES_KNOWLEDGE_REVIEW`
- `LICITACIONES_KNOWLEDGE_PUBLISH`

Toda operación exige además `CRM_OPPORTUNITY_DETAIL_VIEW` sobre el `crmResource` del responsable y `LICITACIONES_WORKBENCH_USE`. No basta con que el frontend muestre un botón.

### 7.2 Matriz

| Capacidad | Equipo asignado con acceso al ámbito | Dirección de Licitaciones | Gerencia | Admin |
|---|---:|---:|---:|---:|
| Ver tarjetas, timeline y soportes | Sí | Sí | Sí | Sí |
| Comentar y adjuntar | Sí | Sí | Sí | Sí |
| Proponer/generar ficha candidata | Sí | Sí | Sí | Sí |
| Resolver o reabrir | No | Sí | Sí | Sí |
| Someter versión a aprobación | Sí | Sí | Sí | Sí |
| Rechazar o devolver a nueva versión | No | Sí | Sí | Sí |
| Publicar o reemplazar | No | Sí | Sí | Sí |

**Equipo asignado** usa el modelo existente: persona humana activa cuyo ámbito, evaluado con `psi_profile_area_assignments`, `crmResource` y `requireExistingOpportunityAction`, le concede acceso a la oportunidad del `owner_id`. No se crea una segunda tabla de asignaciones.

**Dirección de Licitaciones** significa rol `director` con asignación activa `area_code = 'comercial'` y `subarea_code = 'licitaciones'`. `gerente` y `admin` conservan alcance global según la matriz actual. `coordinador` puede contribuir cuando su ámbito coincide, pero no resolver ni publicar.

Las identidades con `identity_type = 'agent'` sólo pueden ejecutar el generador acotado de candidato bajo una solicitud humana registrada; no pueden crear eventos humanos ni usar endpoints de resolución, reapertura, revisión o publicación.

## 8. Experiencia de usuario

### 8.1 Ubicación y jerarquía

- Las tarjetas permanecen en `TenderDecisionAxisSurface`, dentro de `#tender-decision`, porque la especificación visual vigente ubica la lectura única en **Análisis para decidir**.
- `#tender-analysis` conserva controles/estado de la corrida y no duplica las tarjetas.
- `#tender-decision` añade un resumen compacto antes del panel formal: **«N pendientes abiertos · M riesgos confirmados»**.
- Ese resumen es informativo. No habilita, deshabilita ni registra la decisión formal.

### 8.2 Tarjeta compacta

Cada tarjeta conserva el contenido semántico aprobado y añade:

- badge de estado visible: `Pendiente`, `En revisión`, `Resuelto` o `Reabierto`;
- `N comentarios`;
- `N archivos` contando versiones visibles, con `N soportes vigentes` en el drawer;
- resultado vigente cuando está resuelta;
- botón **«Revisar pendiente»**; en usuarios de consulta, **«Ver revisión»**.

No muestra `unit_id`, `requirement_id`, hashes, rutas de storage, eTags, enums crudos ni trazas del proveedor.

### 8.3 Drawer

El drawer `TenderActionableReviewDrawer` contiene, en este orden:

1. encabezado con requisito, estado y botón Cerrar;
2. resumen original en bloque **«Conclusión del análisis»**, visualmente inmutable;
3. timeline cronológico de actividad, comentarios, archivos, resoluciones, reaperturas y candidatura;
4. formulario **«Añadir comentario»**;
5. carga **«Adjuntar soporte de revisión»**;
6. bloque directivo **«Registrar resultado»** cuando existe permiso;
7. bloque **«Conocimiento reutilizable»** cuando hay resolución cerrada y `reusable_requested = true`.

La resolución pide un resultado cerrado y una nota obligatoria. La reapertura muestra el resultado anterior, exige una nota y no lo sobrescribe.

### 8.4 Etiquetas de resultado

| Valor persistido | Etiqueta visible | Estado proyectado |
|---|---|---|
| `aclarado_con_soporte` | Aclarado con soporte | Resuelto |
| `riesgo_confirmado` | Riesgo confirmado | Resuelto |
| `no_aplica` | No aplica | Resuelto |
| `informacion_insuficiente` | Información insuficiente | En revisión o Reabierto; permanece abierto |

### 8.5 Estados vacíos, carga y errores

- Sin actividad: **«Aún no hay revisión registrada.»**
- Sin permiso de escritura: timeline disponible y controles ausentes, no deshabilitados sin explicación.
- Error de carga inicial: bloque `role="alert"` con Reintentar; no se reemplaza por cero comentarios.
- Conflicto 409: **«La revisión cambió mientras trabajaba. Se recargó la actividad; revise antes de volver a enviar.»** El borrador local se conserva.
- Archivo rechazado: se informa nombre y causa; los demás archivos válidos no se registran hasta que la persona confirme el lote corregido.
- Publicación SharePoint fallida: la versión permanece `pendiente_aprobacion`; se muestra código saneado y Reintentar a usuarios autorizados. No se crea una publicación ficticia.

### 8.6 Accesibilidad y responsive

- El CTA declara `aria-haspopup="dialog"`, `aria-controls` y `aria-expanded`.
- El drawer usa `aside role="dialog" aria-modal="true"`, `aria-labelledby` y `aria-describedby`.
- Al abrir, el foco va al título; Tab/Shift+Tab quedan atrapados; Escape cierra salvo durante una confirmación no cancelable; al cerrar, el foco vuelve al CTA exacto.
- El timeline es `ol`; cada entrada tiene tipo, actor y fecha en texto, no sólo color/icono.
- Mensajes asíncronos usan `role="status"` y errores `role="alert"` sin mover el foco salvo fallo de submit.
- Badges alcanzan contraste AA y siempre contienen texto.
- En móvil el drawer ocupa el viewport útil, tiene encabezado/footer pegajosos, una sola columna, `overflow-wrap:anywhere` y ningún scroll horizontal.
- Los controles de archivo exponen formatos y límite antes de elegir; el progreso incluye texto porcentual.

## 9. Modelo de datos append-only

La migración de implementación es `supabase/migrations/079_agt002_actionable_review_knowledge.sql`; el rollback estructural pre-producción es `supabase/rollbacks/079_agt002_actionable_review_knowledge_rollback.sql`.

Todas las tablas habilitan RLS, revocan `public`, `anon` y `authenticated`, revocan escritura directa a `service_role`, conceden a `service_role` únicamente las lecturas necesarias y exponen escrituras por funciones `SECURITY DEFINER` con `search_path = public, pg_temp`. Cada tabla tiene trigger `BEFORE UPDATE OR DELETE` que rechaza mutación.

### 9.1 `psi_tender_actionable_review_items`

Registro estable descrito en §6. No contiene estado mutable. Índices por `(opportunity_id, analysis_run_id)` y por `(analysis_run_id, source_kind, source_id)`.

### 9.2 `psi_tender_actionable_review_events`

Bitácora única de colaboración y ciclo de vida:

- `id uuid`;
- `review_item_id uuid`;
- `sequence bigint` positivo, único por item;
- `event_type text` en `review_started | comment_added | outcome_recorded | reopened | knowledge_requested`;
- `outcome text null` limitado a los cuatro valores de §8.4;
- `note text null`;
- `reusable_requested boolean null`;
- `actor_id uuid` a `psi_sales_profiles`;
- `origin text` con valor `human_ui`;
- `idempotency_key uuid`;
- `created_at timestamptz`;
- unicidad `(actor_id, idempotency_key)`.

Validaciones:

- comentario: 1–10.000 caracteres;
- `outcome_recorded`: outcome y nota de 1–10.000 obligatorios;
- `reopened`: nota de 1–10.000 obligatoria y sólo desde Resuelto;
- `knowledge_requested`: sólo después de resultado cerrado con reutilización marcada;
- `reusable_requested = true` sólo en `outcome_recorded` que cierre el pendiente.

### 9.3 `psi_tender_actionable_review_attachments`

Una fila por versión inmutable:

- `id`, `review_item_id`, `logical_attachment_id`, `version`, `supersedes_attachment_id`;
- `name`, `extension`, `declared_mime_type`, `detected_mime_type`;
- `content_hash`, `size_bytes`, `storage_path`;
- `validation_status` con valor `content_validated`;
- `uploaded_by`, `origin = 'human_ui'`, `uploaded_at`;
- unicidad `(logical_attachment_id, version)`, `storage_path` y `(review_item_id, content_hash)`.

Una sustitución crea versión `n+1`; la anterior permanece visible como histórica. El soporte vigente es la versión mayor del mismo `logical_attachment_id` que pasó validación. Un archivo rechazado se elimina del storage y deja código/contador operativo, pero no una fila que pudiera confundirse con soporte registrado.

### 9.4 `psi_tender_actionable_review_resolution_supports`

Selección inmutable de soportes aprobados para una resolución:

- `resolution_event_id` referencia un `outcome_recorded` cerrado;
- `attachment_id` referencia una versión validada del mismo item;
- `selected_by`, `origin = 'human_ui'`, `selected_at`;
- PK `(resolution_event_id, attachment_id)`.

No significa que el archivo sea oficial. Sólo autoriza usar esa versión como fuente de una ficha candidata.

### 9.5 `psi_tender_knowledge_items`

Identidad del concepto:

- `id uuid`;
- `source_review_item_id`;
- `source_resolution_event_id`;
- `scope_type` en `general | regional | cliente | tipo_servicio`;
- `scope_value text null`;
- `created_by`, `origin` en `human_ui | vigia_candidate`, `created_at`.

`scope_type` es inmutable. `general` exige `scope_value null`; `regional` usa `regional_nombre`; `cliente` usa `company_name`; `tipo_servicio` usa `service_type_code` de la oportunidad fuente.

### 9.6 `psi_tender_knowledge_versions`

Contenido inmutable de una versión:

- `id`, `knowledge_item_id`, `version`, `supersedes_version_id`;
- `reusable_summary` de 1–4.000 caracteres;
- `valid_from date`, `valid_until date null`, `review_on date`;
- `tags text[]` con máximo 20 valores normalizados de 1–64 caracteres;
- `confidentiality text` en `interno | restringido`;
- `agent_reuse_allowed boolean`, falso por defecto;
- `responsible_profile_id` humano activo;
- `sanitization_attestation text` de 20–2.000 caracteres;
- `content_hash`, `created_by`, `origin` en `human_ui | vigia_candidate`, `created_at`;
- unicidad `(knowledge_item_id, version)`.

`valid_until`, si existe, es posterior a `valid_from`; `review_on` está entre ambas o después de `valid_from` cuando no hay vencimiento. Una versión `restringido` nunca puede tener `agent_reuse_allowed = true`. El resumen no admite HTML.

### 9.7 `psi_tender_knowledge_version_sources`

Fuentes cerradas de la versión:

- `knowledge_version_id`;
- `source_type` en `resolution_event | approved_attachment`;
- `source_id uuid`;
- `added_by`, `origin`, `added_at`;
- PK `(knowledge_version_id, source_type, source_id)`.

Toda versión exige exactamente una resolución fuente y sólo adjuntos listados en `psi_tender_actionable_review_resolution_supports` para esa resolución.

### 9.8 `psi_tender_knowledge_events`

Eventos de estado por versión:

- `id`, `knowledge_version_id`, `sequence`;
- `event_type` en `draft_created | submitted | approved | rejected | published | replaced`;
- `note text null`;
- `actor_id` humano;
- `origin` en `human_ui | sharepoint_publication`;
- `idempotency_key`, `created_at`;
- unicidad por secuencia y por `(actor_id, idempotency_key)`.

`approved` es una aprobación humana append-only y conserva la versión en `pendiente_aprobacion` mientras espera publicación. `published` sólo se inserta después de confirmar la escritura SharePoint y registra al actor humano que ordenó publicar, aunque su origen técnico sea `sharepoint_publication`. No existe aprobación silenciosa del modelo.

### 9.9 `psi_tender_knowledge_publications`

Prueba append-only de publicación externa:

- `id`, `knowledge_version_id`, `knowledge_item_id`;
- `library_root` con valor exacto `Comercial/Licitaciones/02 Biblioteca corporativa`;
- `relative_path`, `site_id`, `drive_id`, `drive_item_id`;
- `web_url` HTTPS SharePoint sin query/fragmento;
- `e_tag`, `sharepoint_version`, `content_hash`;
- `published_by`, `origin = 'sharepoint_publication'`, `published_at`;
- unicidad `knowledge_version_id` y `(drive_id, drive_item_id, sharepoint_version)`.

No persiste tokens, URLs firmadas, secretos Graph ni contenido binario.

## 10. Máquinas de estado

### 10.1 Revisión

Estado inicial derivado: `pendiente`.

- `pendiente -> en_revision`: primer `review_started`. Si la primera operación es comentario, adjunto o resolución, el RPC inserta `review_started` y la operación en la misma transacción.
- `en_revision -> resuelto`: `outcome_recorded` con `aclarado_con_soporte`, `riesgo_confirmado` o `no_aplica`.
- `en_revision -> en_revision`: `outcome_recorded` con `informacion_insuficiente`.
- `resuelto -> reabierto`: `reopened` con nota obligatoria.
- `reabierto -> resuelto`: resultado cerrado posterior.
- `reabierto -> reabierto`: `informacion_insuficiente` posterior.

Comentarios y adjuntos no cambian `resuelto` a `reabierto`; se requiere la acción explícita. La resolución vigente es el último resultado cerrado no invalidado por una reapertura posterior.

**Abierto** significa `pendiente`, `en_revision` o `reabierto`. **Riesgo confirmado vigente** exige estado `resuelto` y resultado vigente `riesgo_confirmado`. Un riesgo reabierto deja de contar como confirmado vigente, aunque permanece en la historia.

### 10.2 Conocimiento por versión

- sin evento: inválido;
- `draft_created -> borrador`;
- `borrador -> pendiente_aprobacion` mediante `submitted`;
- `pendiente_aprobacion -> pendiente_aprobacion` mediante `approved`; la aprobación habilita publicación, pero no afirma que SharePoint ya la recibió;
- `pendiente_aprobacion -> rechazado` mediante `rejected`, con nota obligatoria;
- `pendiente_aprobacion aprobada -> publicado` mediante `published`, sólo con publicación SharePoint confirmada;
- `publicado -> reemplazado` mediante `replaced`, sólo cuando una versión sucesora del mismo item ya está publicada.

Una versión rechazada no se edita ni se reenvía: se crea una versión superior en `borrador`. La publicación de una sucesora registra `published` en la nueva y `replaced` en la anterior dentro de la misma transacción local después de reconciliar SharePoint.

## 11. RPC y transacciones

Nombres exactos de la migración:

- `psi_ensure_tender_actionable_review_item`
- `psi_record_tender_actionable_review_comment`
- `psi_record_tender_actionable_review_attachment`
- `psi_record_tender_actionable_review_outcome`
- `psi_reopen_tender_actionable_review`
- `psi_create_tender_knowledge_candidate`
- `psi_add_tender_knowledge_version`
- `psi_submit_tender_knowledge_version`
- `psi_approve_tender_knowledge_version`
- `psi_reject_tender_knowledge_version`
- `psi_record_tender_knowledge_publication`

Cada RPC sensible recibe `p_actor_id`, `p_idempotency_key` y `p_expected_sequence`. Bloquea el item o versión con `FOR UPDATE`, calcula la secuencia vigente y devuelve 409 semántico si no coincide. La misma idempotency key con el mismo payload devuelve el resultado previo; con payload diferente falla. El servidor nunca acepta `actor_id`, `origin`, `source_hash`, permisos ni estado calculado desde el navegador.

`psi_record_tender_actionable_review_outcome` inserta de forma atómica el inicio implícito cuando corresponda, el resultado, las filas de soportes seleccionados y `knowledge_requested` cuando aplica. `psi_approve_tender_knowledge_version` verifica saneamiento, fuentes, actor y estado antes de insertar la aprobación. `psi_record_tender_knowledge_publication` exige una aprobación vigente, registra publicación/eventos y reemplazo de la versión previa en una sola transacción.

## 12. API HTTP y tipos

Los handlers se implementan con paridad byte-semántica en `server/index.js` y `api/[...path].js`; la comprobación `scripts/check_backend_parity.mjs` es gate de merge.

### 12.1 Endpoints

- `GET /api/tender-actionable-reviews?opportunity_id=<uuid>&analysis_run_id=<uuid>`
- `POST /api/tender-actionable-reviews/:itemId/comments`
- `POST /api/tender-actionable-reviews/:itemId/attachments/upload-url`
- `POST /api/tender-actionable-reviews/:itemId/attachments/complete`
- `POST /api/tender-actionable-reviews/:itemId/outcomes`
- `POST /api/tender-actionable-reviews/:itemId/reopen`
- `POST /api/tender-actionable-reviews/:itemId/knowledge-candidates/generate`
- `GET /api/tender-knowledge-items/:knowledgeItemId`
- `POST /api/tender-knowledge-items/:knowledgeItemId/versions`
- `POST /api/tender-knowledge-versions/:knowledgeVersionId/submit`
- `POST /api/tender-knowledge-versions/:knowledgeVersionId/approve`
- `POST /api/tender-knowledge-versions/:knowledgeVersionId/reject`
- `POST /api/tender-knowledge-versions/:knowledgeVersionId/publish`

Todos autentican primero, autorizan la oportunidad antes de revelar si item/archivo/version existe y devuelven `Cache-Control: private, no-store` para timeline, URLs de descarga y conocimiento restringido.

### 12.2 Respuesta de lectura

`GET /api/tender-actionable-reviews` devuelve:

- `analysis_run_id` y estado de vigencia;
- `items[]` con identidad pública UUID, presentación humana, estado proyectado, resultado vigente, conteos, `sequence`, timeline paginado y capacidades booleanas calculadas en servidor;
- `summary.open_count` y `summary.confirmed_risk_count`;
- `history_available` para corridas anteriores.

No devuelve rutas de storage, hashes, contenido de archivos, IDs técnicos de unidad/hallazgo ni secretos. Las descargas se resuelven con `GET /api/tender-actionable-review-attachments/:attachmentId/download?opportunity_id=<uuid>`: autorización previa, URL firmada de 120 segundos en `Location`, 302 sin cuerpo y `private, no-store`.

### 12.3 Cliente y componentes

Nombres fijados para implementación:

- tipos en `src/tenders/types.ts`: `TenderActionableReviewItem`, `TenderActionableReviewEvent`, `TenderActionableReviewAttachment`, `TenderActionableReviewOutcome`, `TenderKnowledgeItem`, `TenderKnowledgeVersion`;
- cliente en `src/tenders/tenderActionableReviewActions.ts`;
- proyección pura en `src/tenders/tenderActionableReviewProjection.ts`;
- drawer en `src/tenders/components/TenderActionableReviewDrawer.tsx`;
- formulario de conocimiento en `src/tenders/components/TenderKnowledgeCandidatePanel.tsx`.

`TenderDecisionAxisSurface` recibe el resumen y abre el drawer; no contiene llamadas fetch ni lógica de permisos. `TenderDecisionExperience` sigue siendo el único montaje.

## 13. Archivos de soporte

### 13.1 Allowlist y límites

Máximo 8 archivos por operación y 25 MiB por archivo. Extensión y MIME deben coincidir:

- `.pdf` — `application/pdf`;
- `.png` — `image/png`;
- `.jpg`/`.jpeg` — `image/jpeg`;
- `.docx` — `application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
- `.xlsx` — `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
- `.txt` — `text/plain`.

El nombre limpio tiene máximo 140 caracteres. Se rechazan doble extensión ejecutable, traversal, barra invertida, archivos vacíos, MIME genérico, discrepancia de tamaño/hash/MIME, ZIP no compatible con DOCX/XLSX y contenedores con rutas peligrosas o expansión excesiva.

### 13.2 Secuencia de carga

1. El endpoint de upload valida actor, oportunidad, item, índice, nombre, extensión, MIME y tamaño.
2. Emite ticket ligado a actor/oportunidad/item/lógica/versión y URL firmada de carga privada.
3. El navegador carga directamente al bucket existente `tender-documents` bajo:
   `actionable-reviews/<opportunity_id>/<review_item_id>/<logical_attachment_id>/v<version>/<hash>-<name>`.
4. `complete` descarga desde storage en servidor, verifica bytes, SHA-256, MIME detectado y contenedor; limpia el objeto si falla.
5. Sólo entonces el RPC registra archivo y actividad.

Si el despliegue dispone de un servicio antimalware aprobado, `complete` exige resultado limpio antes del RPC y registra el identificador opaco del escaneo en observabilidad, no en UI. Sin ese servicio se ejecutan las validaciones locales anteriores y la interfaz dice **«Contenido validado»**, nunca **«Libre de malware»**.

### 13.3 Separación del expediente

El prefijo no coincide con `<opportunity_id>/<documento>` ni con `question-responses`; `getTenderDocumentRecords`, snapshots, extracción, canonicalización, cobertura y refresh no lo enumeran. Subir o versionar soporte no llama `psi_begin_tender_document_refresh`, `registerTenderDocumentSnapshot` ni endpoints `tender-documents-*`.

## 14. Ficha candidata de Vig-IA

### 14.1 Entrada permitida

El generador recibe exclusivamente:

- resultado y nota de la resolución cerrada vigente;
- texto extraído de soportes seleccionados en `psi_tender_actionable_review_resolution_supports` que hayan pasado validación;
- alcance elegido por la persona;
- fecha de referencia;
- instrucción de retirar datos específicos y abstenerse cuando no pueda generalizar.

No recibe el payload completo de la licitación, documentos oficiales no seleccionados, conversaciones, credenciales, GO/NO-GO ni otros pendientes.

### 14.2 Salida cerrada

La salida debe contener exactamente:

- `reusable_summary`;
- `scope_type` y `scope_value`;
- `valid_from`, `valid_until`, `review_on`;
- `source_attachment_ids`;
- `tags`;
- `confidentiality`;
- `responsible_profile_id` sugerido;
- `sanitization_findings`;
- `abstained` y `abstention_reason`.

Si `abstained = true`, no se crea versión. La UI explica la razón y permite crear un borrador manual. Si hay salida, `psi_create_tender_knowledge_candidate` crea item, versión 1 y `draft_created`; la persona revisa cada campo antes de someter.

El job del generador es una capacidad distinta de la corrida canónica. No escribe `psi_tender_analysis_runs`, no crea contexto/snapshot, no promueve análisis y no llama el endpoint histórico de preguntas.

## 15. Saneamiento, confidencialidad y privacidad

Antes de `submitted`, el servidor aplica validación determinista y la persona confirma una atestación legible. Se bloquean:

- correos, teléfonos, números de identificación y nombres de contacto no necesarios;
- credenciales, tokens, secretos, URLs firmadas y rutas internas;
- precios o condiciones exclusivas cuando el alcance no sea `cliente`;
- nombre de entidad/cliente en alcance `general`, `regional` o `tipo_servicio`;
- texto no respaldado por resolución o soportes seleccionados;
- instrucciones provenientes de documentos que intenten cambiar reglas del sistema.

`confidentiality = restringido` permite publicación en la biblioteca con control de acceso corporativo, pero fuerza `agent_reuse_allowed = false`. Sólo versiones `interno`, vigentes, publicadas, no reemplazadas y con `agent_reuse_allowed = true` se proyectan a capacidades de Vig-IA.

La telemetría registra IDs, conteos, tamaños, estados, latencias y códigos cerrados; no registra comentarios, resúmenes, nombres de archivo, contenido extraído, prompts ni respuestas del modelo.

## 16. SharePoint y biblioteca corporativa

### 16.1 Raíz y ruta única

La raíz configurada y validada en servidor es exactamente:

`Comercial/Licitaciones/02 Biblioteca corporativa`

Ruta relativa determinista:

`<scope_type>/<knowledge_item_id>.md`

El título humano nunca forma la ruta. El primer publish crea el ítem con conflicto `fail`; versiones posteriores actualizan el mismo `drive_item_id` con control `If-Match` sobre el eTag conocido. SharePoint conserva su versión nativa; SIIO registra la correspondencia con `psi_tender_knowledge_publications`.

No se crea sidecar, copia por versión ni duplicado en la carpeta del expediente. Si SharePoint confirma escritura y la transacción local falla, el reintento busca la ruta determinista, compara `content_hash` y reconcilia el mismo ítem antes de registrar; no crea otro.

### 16.2 Contenido publicado

El Markdown curado incluye encabezado, alcance, vigencia, fecha de revisión, resumen reutilizable, etiquetas, confidencialidad, responsable y referencias opacas de SIIO. No incluye archivos soporte ni enlaces firmados. Los soportes permanecen en storage privado y sólo la bitácora autorizada puede descargarlos.

### 16.3 Proyección como activo aprobado

Una publicación elegible se proyecta, sin escribir el archivo JSON del repositorio, al contrato que valida `vigia-approved-assets.js`:

- `asset_id = tender-knowledge:<knowledge_item_id>:v<version>`;
- `title` desde el encabezado curado;
- `asset_type = tender_knowledge`;
- `url = web_url` SharePoint sin query ni fragmento;
- `status = approved`;
- `valid_until` desde la versión;
- `tags` normalizados.

El loader de runtime combina de forma determinista el manifiesto estático `config/vigia-approved-assets.v1.json` con la proyección de base publicada, rechaza IDs duplicados y aplica la misma validación. Esto habilita reutilización en futuras capacidades que ya consumen activos aprobados. No cambia en sitio el contrato canónico AGT-002 V3 ni introduce el conocimiento en la corrida fuente.

### 16.4 Fallos y vigencia

- SharePoint no configurado: publish responde 503 cerrado; la versión sigue pendiente.
- 401/403 Graph: código `sharepoint_authorization_failed`, sin detalles de token.
- eTag conflictivo: 409, reconciliación y nueva confirmación humana si el contenido remoto no coincide.
- vencida o alcanzó `review_on`: se excluye de proyección a Vig-IA; el documento y auditoría permanecen.
- nueva versión publicada: la previa queda `reemplazado` y se excluye de proyección.

## 17. Concurrencia e idempotencia

- Cada submit genera UUID de idempotencia y envía `expected_sequence`.
- Los botones permanecen bloqueados sólo durante su petición; un timeout permite reintentar con la misma key.
- Dos comentarios concurrentes con secuencia igual pueden serializarse: el segundo recibe conflicto y se reenvía sólo tras refresco explícito, evitando atribuir un orden no visto.
- Dos resoluciones concurrentes no pueden quedar vigentes: bloqueo por item y secuencia garantizan una sola; la otra falla 409.
- Dos publicaciones concurrentes se serializan por versión local y eTag remoto.
- La firma de upload no autoriza completar: el ticket se liga a actor, item, logical ID, versión y expiración.
- Un objeto huérfano por carga abandonada se limpia mediante tarea de retención por prefijo y edad; nunca se convierte en fila por inferencia.

## 18. Validaciones y códigos de error

| HTTP | Código | Uso |
|---:|---|---|
| 400 | `invalid_review_input` | enum, nota, longitud, scope o fecha inválidos |
| 401 | `authentication_required` | sesión ausente/inválida |
| 403 | `review_action_forbidden` | identidad, permiso o ámbito insuficiente |
| 404 | `review_item_not_found` | recurso inexistente o no revelable |
| 409 | `review_version_conflict` | secuencia/hash/corrida cambió |
| 409 | `knowledge_state_conflict` | transición inválida o versión reemplazada |
| 413 | `attachment_too_large` | supera 25 MiB |
| 415 | `attachment_type_not_allowed` | extensión/MIME/contenido no permitido |
| 422 | `knowledge_sanitization_failed` | contenido no apto para someter/publicar |
| 503 | `knowledge_generator_unavailable` | candidato Vig-IA no disponible |
| 503 | `sharepoint_publication_unavailable` | integración no configurada o temporalmente indisponible |

Los mensajes para usuario son saneados. Los detalles internos se correlacionan con un request ID, no se exponen.

## 19. TDD: secuencia RED → GREEN

Cada bloque inicia con una prueba que falla por la conducta ausente; después se implementa el mínimo y se refactoriza sin cambiar el contrato. El historial del PR debe permitir observar el estado rojo antes del verde; la rama nunca se despliega con pruebas rojas.

### 19.1 Persistencia PGlite

Archivos:

- `tests/agt002-actionable-review-pglite.integration.test.mjs`
- `tests/agt002-actionable-review-attachments-pglite.integration.test.mjs`
- `tests/agt002-knowledge-lifecycle-pglite.integration.test.mjs`

Cobertura: identidad/dedupe, append-only, FK corrida/oportunidad, estados, resultado insuficiente abierto, reapertura con nota, soportes seleccionados, permisos de función, secuencias, idempotencia, reemplazo, RLS/grants y rollback exacto pre-datos.

### 19.2 Autorización

`tests/agt002-actionable-review-permissions.test.mjs` cubre owner/ámbitos, coordinador contribuyente sin resolución, director de Licitaciones, gerente, admin, director de otra subárea, usuario fuera de ámbito, perfil inactivo y agente. Se prueba autorización en handler y RPC; no sólo capacidades UI.

### 19.3 HTTP y paridad

- `tests/agt002-actionable-review-http.test.mjs`
- `tests/agt002-actionable-review-attachments-http.test.mjs`
- `tests/agt002-knowledge-http.test.mjs`
- `tests/agt002-actionable-review-backend-parity-static.test.mjs`

Cobertura: auth-before-lookup, no-store, 409, misma idempotency key, URL firmada sin cuerpo, limpieza de huérfanos, ningún llamado a reanálisis, ningún documento/snapshot nuevo y mismas rutas en `server/index.js`/`api/[...path].js`.

### 19.4 Archivos

Fixtures válidos y adversariales para todos los formatos: doble extensión, MIME falso, hash/tamaño diferente, ZIP bomb, traversal interno, archivo vacío, más de 8, más de 25 MiB, ticket ajeno/expirado y versión concurrente. Se afirma que `getTenderDocumentRecords` y la cobertura oficial no enumeran el soporte.

### 19.5 Generador y conocimiento

`tests/agt002-knowledge-candidate.test.mjs` prueba input mínimo, soportes sólo aprobados, abstención, schema cerrado, saneamiento, `restringido` sin reúso por agente, responsable activo y ausencia de llamadas a AGT-002 canónico.

`tests/agt002-knowledge-sharepoint.test.mjs` usa adaptador falso para create/update, eTag, éxito remoto + fallo local, reconciliación, duplicado, reemplazo, raíz exacta, host no SharePoint, URL firmada rechazada y proyección `vigia-approved-assets-v1`.

### 19.6 Frontend, accesibilidad y visual

- tests puros de `tenderActionableReviewProjection.ts` para conteos y estados;
- SSR para tarjeta/drawer/roles/copy;
- Chromium desktop y móvil para foco, Escape, focus trap, retorno al CTA, scroll y overflow;
- axe o comprobaciones equivalentes de nombre accesible, jerarquía, contraste y estados vivos;
- fixture con actividad extensa, nombres largos, 8 archivos y conflicto concurrente.

### 19.7 Gates finales

- suite focal completa;
- `npm run check:backend-parity`;
- `npm run check:siio-integration`;
- `npm run build`;
- comprobación estática de que rutas nuevas no importan ni llaman `reanalyzeAgt002AfterHumanAnswer`, `enqueueAgt002CanonicalReanalysis`, `psi_begin_tender_document_refresh` o RPC de GO/NO-GO.

## 20. Rollout y QA

### Fase 1 — persistencia y lectura oscura

Feature flag de servidor `TENDER_ACTIONABLE_REVIEW_ENABLED=false`. Desplegar 079, verificar tablas/grants/triggers y endpoint deshabilitado sin montar UI. Backfill no es necesario: la identidad se registra en primera acción.

### Fase 2 — colaboración

Activar para Admin y Gerencia interna. Validar comentario, archivo, resultado insuficiente, cierre, reapertura y conteo. Expandir a Dirección de Licitaciones y luego al equipo por ámbito.

### Fase 3 — candidato

`TENDER_KNOWLEDGE_ENABLED=false` hasta completar pruebas de saneamiento y abstención. Activar generación para un grupo interno; publicación aún deshabilitada.

### Fase 4 — SharePoint

`TENDER_KNOWLEDGE_SHAREPOINT_PUBLISH_ENABLED=false` hasta validar credencial server-side de mínimo privilegio, site/drive/root exactos, versionado, eTag y reconciliación en entorno no productivo. Activar publicación primero para Admin y una versión controlada; verificar una sola ruta y una sola publicación lógica.

### Fase 5 — activos aprobados

Habilitar mezcla dinámica sólo tras comprobar que versiones vencidas, restringidas, reemplazadas o sin `agent_reuse_allowed` no aparecen. Validar una capacidad futura de Vig-IA con un activo sintético, sin reanalizar la oportunidad fuente.

### QA obligatorio

- datos y archivos sintéticos; cero PII real;
- cero ejecución/reintento de AGT-002;
- cero GO/NO-GO y cero cambios de estado de oferta;
- cero uploads al bucket oficial fuera del prefijo nuevo;
- cero publicación productiva durante QA visual;
- captura desktop/móvil y navegación completa por teclado;
- prueba de dos sesiones concurrentes;
- comprobación directa de append-only, RLS y ausencia de grants de escritura.

## 21. Métricas y observabilidad

Métricas sin contenido:

- pendientes por estado y resultado;
- mediana/p95 desde primera vista a inicio, cierre y reapertura;
- comentarios y soportes por item;
- tasa de `informacion_insuficiente` y de reapertura;
- riesgos confirmados vigentes;
- resoluciones marcadas reutilizables;
- candidatos generados, abstenciones, sometidos, rechazados, publicados y reemplazados;
- tiempo de resolución a publicación;
- conflictos 409 e idempotency replay;
- archivos rechazados por categoría;
- fallos/reconciliaciones SharePoint y detecciones de duplicado;
- autorizaciones denegadas por acción, sin identidad personal en etiquetas de métrica;
- pendientes sin identidad estructural.

Eventos de auditoría incluyen IDs, actor, origen y timestamp en tablas. Logs operativos usan códigos cerrados y correlation ID. Alertas: aumento de publicación duplicada, error SharePoint sostenido, bypass de scope, intento de mutación append-only o aparición de un soporte en el set documental oficial.

## 22. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Confundir revisión con cambio de análisis | bloques visuales separados, tablas nuevas y prueba de cero escritura/reanálisis |
| Doble identidad o pérdida al cambiar texto | unicidad por corrida/tipo/ID estructural; sin hash textual como fallback |
| Respuesta concurrente sobrescrita | eventos append-only, secuencia esperada y bloqueo transaccional |
| Soporte tratado como documento oficial | prefijo, tablas, endpoints y consultas separados; test de no enumeración |
| Carga maliciosa | allowlist doble, límites, hash, MIME detectado, inspección de contenedor, ticket ligado y análisis antimalware sólo donde esté aprobado |
| Publicación de información específica | scope, saneamiento determinista, atestación, revisión directiva y `agent_reuse_allowed` falso por defecto |
| Vig-IA alucina una regla corporativa | salida candidata cerrada, fuentes limitadas, abstención y publicación exclusivamente humana |
| Duplicados SharePoint por retry | ruta UUID determinista, conflict fail, eTag, hash y reconciliación |
| SharePoint éxito / DB fallo | reintento reconciliador antes de insertar publicación |
| Conocimiento vencido sigue usándose | filtros por estado, reemplazo, vigencia y revisión en cada carga |
| Privilegios de service role en navegador | toda credencial y DB privilegiada server-side; navegador sólo endpoints autorizados |
| Scope creep con «Archivar como aprendizaje» | migración, tablas, acciones y UI separadas; no reutilizar 078 ni propuestas del workbench |
| Regresión visual del rediseño 2026-08-30 | conservar selectores/tarjetas y añadir CTA/drawer con fixtures de ambos modos |

## 23. Rollback operativo

1. Desactivar primero `TENDER_KNOWLEDGE_SHAREPOINT_PUBLISH_ENABLED`, luego `TENDER_KNOWLEDGE_ENABLED` y finalmente `TENDER_ACTIONABLE_REVIEW_ENABLED`.
2. Ocultar CTA y rechazar escrituras nuevas; mantener lectura autorizada de historia.
3. Revocar execute de RPC comprometido y aplicar corrección forward. Después de existir datos reales no se borran tablas ni eventos.
4. Una publicación SharePoint ya aprobada no se elimina por rollback de aplicación. Permanece como documento corporativo; se reemplaza mediante el flujo gobernado si su contenido debe corregirse.
5. El rollback SQL 079 sólo es válido antes de uso productivo y verifica ausencia de filas. Si hay filas, falla cerrado.
6. Desactivar la proyección dinámica retira los activos de nuevas consultas de Vig-IA sin cambiar análisis pasados ni borrar SharePoint.

## 24. Criterios de aceptación

1. Cada unidad/hallazgo elegible de la corrida vigente tiene una identidad estable o un estado explícito no revisable; nunca una identidad textual inventada.
2. Tarjeta compacta muestra estado, conteos y **«Revisar pendiente»**; drawer accesible contiene análisis inmutable y timeline.
3. Equipo autorizado comenta, adjunta y propone; sólo Dirección de Licitaciones, Gerencia o Admin resuelven/reabren y aprueban/publican.
4. Toda acción es append-only con actor, fecha, origen, secuencia e idempotencia.
5. Los cuatro resultados respetan la máquina; `informacion_insuficiente` permanece abierto y reapertura exige nota.
6. **Decisión** resume abiertos y riesgos confirmados vigentes sin ejecutar ni bloquear GO/NO-GO.
7. Un soporte no aparece en documentos oficiales, snapshots, cobertura, extracción o análisis; descarga sólo tras auth con capacidad efímera.
8. Marcar reutilizable no publica: crea derecho a generar una ficha candidata desde resolución y soportes seleccionados.
9. Vig-IA puede abstenerse; ninguna salida se publica sin revisión humana.
10. La ficha contiene resumen, alcance, vigencia/revisión, fuentes, etiquetas, confidencialidad y responsable, con saneamiento obligatorio.
11. Estados de versión son `borrador`, `pendiente_aprobacion`, `publicado`, `rechazado` y `reemplazado` según eventos.
12. Toda publicación reside únicamente bajo `Comercial/Licitaciones/02 Biblioteca corporativa`, actualiza un ítem determinista versionado y deja referencia/hashes auditables.
13. Sólo conocimiento publicado, vigente, no reemplazado, interno y autorizado para agente se proyecta como activo aprobado.
14. Publicar no reanaliza la oportunidad actual ni muta su corrida.
15. Migración 078 queda intacta; esta funcionalidad usa 079.
16. Pruebas demuestran RED antes de GREEN, paridad backend, seguridad, concurrencia, build, accesibilidad y QA visual sin ejecuciones reales de AGT-002 ni publicaciones productivas.

## 25. Decisiones cerradas para el plan

- El flujo vive sobre pendientes de la corrida, no sobre respuestas históricas.
- La identidad se registra al primer write tras revalidar el payload canónico.
- Eventos y versiones son append-only; el estado siempre se proyecta.
- El resultado insuficiente no cierra.
- El archivo de revisión es soporte privado y versionado, no documento oficial.
- La selección de soportes se fija por resolución.
- El conocimiento usa tablas nuevas, no políticas del workbench.
- La ruta SharePoint depende de UUID y scope inmutable, no de título.
- La publicación remota y local se reconcilia por hash/eTag.
- El consumo de activos aprobados nunca es retroactivo sobre la corrida fuente.
- La implementación depende del orden 078 → 079 y no comparte migración con **«Archivar como aprendizaje»**.
