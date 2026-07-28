# Especificación — Flujo durable de licitaciones públicas y AGT-002

**Fecha:** 2026-07-27  
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`  
**Worktree inspeccionado:** `/root/worktrees/siio-commercial-24h-operational-cut`  
**Aprobado funcionalmente por:** Juan Botero  
**Naturaleza:** diseño y especificación técnica. Este documento no implementa código, no modifica datos ni configuración, no ejecuta migraciones y no despliega producción.

> **Convención de evidencia:** **[EXISTE]** significa verificado en el código o DDL del worktree; **[REPORTADO-POR-REVALIDAR]** significa observado en auditorías productivas de esta sesión cuya salida completa debe recapturarse antes de actuar; **[PROPUESTO]** significa diseño aún no implementado.

## 1. Propósito

Corregir de extremo a extremo el tratamiento de licitaciones públicas convertidas en oportunidades para que:

1. la oportunidad se cree inmediatamente y de forma idempotente;
2. la importación documental continúe durablemente aunque el navegador cierre o una función termine;
3. el usuario vea progreso, errores y reintentos reales;
4. AGT-002 se ejecute automáticamente solo después de publicar un snapshot documental vigente;
5. SIIO distinga inequívocamente un análisis IA de un preanálisis por reglas;
6. el historial del proceso sea único antes y después de la conversión;
7. Resumen y Seguimiento usen semántica de contratación pública, no del CRM privado;
8. toda decisión GO/NO GO, envío y presentación permanezca bajo autoridad humana.

## 2. Decisiones funcionales aprobadas

- Flujo automático por etapas: **convertir → importar → publicar snapshot → analizar con AGT-002 → revisión humana**.
- Una sola historia continua de la licitación desde el Radar hasta su resultado final.
- La vista general `Licitaciones > Seguimiento` será una cola resumida; la pestaña `Seguimiento` del expediente mostrará el historial completo. Ambas leerán la misma fuente de eventos.
- Los errores serán visibles y recuperables; un fallback por reglas no se presentará como análisis IA.
- El Resumen público eliminará campos privados como tipo de cliente, decisor, teléfono, correo, comisión y cierre comercial estimado.
- La cuota diaria de pruebas de AGT-002 será 20, manteniendo concurrencia 1 salvo aprobación posterior.

## 3. Estado actual verificado

### 3.1 Importación documental

**[EXISTE]** `POST /api/tender-convert`, implementado en `api/[...path].js` y su backend par en `server/index.js`, crea la oportunidad y luego invoca `refreshTenderDocumentsFromOfficialSource` dentro de la misma petición HTTP. La ruta procesa hasta 40 documentos de manera secuencial: descarga, extracción, creación/verificación de bucket, subida y persistencia. El frontend espera esa respuesta antes de confirmar la conversión.

Consecuencia: una oportunidad puede quedar creada aunque la petición termine por timeout; el usuario recibe un error ambiguo y el expediente puede quedar parcial o vacío.

### 3.2 Persistencia documental y análisis ya disponible

Se deben reutilizar:

- `psi_tender_document_versions`: versiones tipadas, append-only por identidad externa, con hash, storage privado y texto extraído.
- `psi_tender_document_state`: snapshot vigente y exclusión de refresh gobernado.
- `psi_tender_document_snapshots`: manifiesto documental y perfil inmutables.
- `psi_tender_analysis_runs`: productor, método, resultado, modelo, uso y procedencia tipados.
- `psi_agt002_preview_claims`: cuota, concurrencia e idempotencia temporal de AGT-002.
- `psi_tender_tracking_events`: eventos previos a conversión, actualmente con vocabulario limitado.
- `psi_tender_go_no_go_decisions`: decisión humana vinculable a un run autoritativo.

No se debe crear un segundo registro documental que compita con estas tablas.

### 3.3 AGT-002

El código distingue:

- `siio_rules_v1 / rules`: preanálisis determinístico;
- `HERMES-INTERIM / agent_ai`: productor histórico transitorio;
- `AGT-002 / agent_ai`: productor IA actual.

**[REPORTADO-POR-REVALIDAR]** La auditoría productiva realizada el 2026-07-27 reportó cero runs exitosos de `AGT-002`. Para Aerocivil reportó únicamente un run `siio_rules_v1 / rules`, sin modelo y con cero tokens. Estos conteos no autorizan acciones hasta recapturarse con identificadores, timestamps y salida preservada.

**[EXISTE]** El Caddyfile versionado publica `agt002.5-78-140-24.sslip.io` —con guiones—, mientras el host productivo observado durante la auditoría fue `agt002.5.78.140.24.sslip.io` —con puntos—. Esta discrepancia de vhost/certificado explica el fallo TLS antes de HMAC y del modelo, pero debe verificarse contra la configuración efectiva del servidor porque no hubo acceso SSH autorizado.

### 3.4 Aerocivil

**[REPORTADO-POR-REVALIDAR]** La auditoría previa reportó:

- 40 documentos legados con `extracted_text` disponible;
- 0 versiones tipadas vigentes en `psi_tender_document_versions`;
- tres eventos recientes que reutilizaron el mismo preanálisis por reglas;
- ausencia de un análisis IA de AGT-002.

La recuperación exige volver a comprobar estos cuatro puntos por UUID antes del dry-run.

### 3.5 Interfaz heredada

Resumen muestra servicio, tipo de cliente, área comercial, fecha de creación, cierre estimado, próxima gestión, decisor, correo y teléfono.

Seguimiento muestra:

- `Datos comerciales`, con referencia mal mapeada como sede;
- un párrafo `Observaciones` que concatena metadatos y URL;
- un formulario genérico de seguimiento privado;
- una `Línea de seguimientos` vacía que no incorpora eventos previos a conversión.

## 4. No objetivos

- AGT-002 no decide GO/NO GO.
- Ningún agente firma, envía, carga o presenta una oferta.
- No se automatizan comunicaciones externas.
- No se amplía el acceso a documentos ni análisis.
- No se sustituye el registro tipado de documentos, snapshots, runs o decisiones.
- No se migra toda la plataforma a Hetzner.
- No se cambia la autoridad de Dirección de Licitaciones.
- No se promete que la reparación TLS pueda ejecutarse sin acceso autorizado a Hetzner.
- No se borra el historial legado; se conserva y se enlaza mediante backfill auditable.

## 5. Arquitectura objetivo

```text
Usuario autorizado
  │
  ├─ POST /api/tender-convert
  │    ├─ vincula/crea oportunidad idempotentemente
  │    ├─ crea job durable de pipeline
  │    ├─ inserta evento converted/pipeline_queued
  │    └─ responde inmediatamente con opportunity_id + job_id
  │
  └─ consulta Resumen / Seguimiento / Documentos
             │
             ▼
Supabase (estado autoritativo)
  ├─ public tender + opportunity
  ├─ processing jobs + import items (nuevos)
  ├─ typed document versions + document state (existentes)
  ├─ immutable snapshots + analysis runs (existentes)
  └─ unified tracking events (tabla existente extendida)
             ▲
             │ lease atómico, lotes acotados, reintentos
             │
Worker SIIO/Vercel autenticado
  ├─ descubre documentos
  ├─ procesa un lote pequeño
  ├─ publica snapshot
  └─ solicita AGT-002 al puente
             │
             ▼
Puente Hetzner AGT-002
  └─ exclusivamente ejecución del modelo; sin autoridad de negocio
```

### 5.1 División de responsabilidades

**Supabase:** estado durable, leases, idempotencia, historial, versiones, snapshots, runs y decisiones.  
**Vercel/SIIO:** autorización del usuario, API, orquestación, importación por lotes, validación y UI.  
**Hetzner:** transporte HMAC y ejecución de `codex app-server`; no persiste expedientes ni toma decisiones.

## 6. Modelo de datos propuesto

Los nombres son normativos para el plan; la implementación deberá validar que no colisionen con migraciones posteriores.

### 6.1 `psi_tender_processing_jobs` — nueva

Un job representa una generación completa del pipeline documental y analítico.

Campos mínimos:

- `id uuid primary key`;
- `tender_id uuid not null`;
- `opportunity_id uuid not null`;
- `pipeline_version text not null`;
- `idempotency_key text not null unique`;
- `status text not null`;
- `current_step text not null`;
- `requested_by uuid not null` — humano que convirtió o solicitó reintento;
- `analysis_authorized_by uuid null` — debe ser exactamente Katherine Valencia Buitrago o Juan Botero;
- `analysis_authorized_at timestamptz null`;
- `lease_id uuid null`, `lease_expires_at timestamptz null`;
- `attempt_count integer not null default 0`;
- `next_attempt_at timestamptz null`;
- `documents_discovered integer not null default 0`;
- `documents_processed integer not null default 0`;
- `documents_imported integer not null default 0`;
- `documents_unchanged integer not null default 0`;
- `documents_failed integer not null default 0`;
- `snapshot_id uuid null`;
- `analysis_run_id uuid null`;
- `last_error_code text null`;
- `last_error_message text null` — mensaje seguro, sin credenciales ni contenido documental;
- `created_at`, `started_at`, `updated_at`, `completed_at`.

Restricciones:

- relación consistente tender/oportunidad;
- un único job activo por oportunidad mediante índice parcial;
- lease completo o nulo, nunca parcialmente poblado;
- contadores no negativos;
- referencias a snapshot/run deben corresponder al mismo tender y oportunidad, validadas por RPC.

### 6.2 `psi_tender_document_import_items` — nueva

Un registro por identidad documental descubierta dentro del job.

Campos mínimos:

- `id`, `job_id`, `tender_id`, `opportunity_id`;
- `source`, `source_document_id`, `source_url`, `name`;
- `status`: `pending | processing | imported | unchanged | failed_retryable | failed_terminal`;
- `attempt_count`, `next_attempt_at`;
- `lease_id`, `lease_expires_at`;
- `document_version_id` cuando termine;
- `last_error_code`, `last_error_message` seguro;
- timestamps;
- unique `(job_id, source, source_document_id)`.

No almacena binarios ni duplica `extracted_text`; esos pertenecen a storage privado y `psi_tender_document_versions`.

### 6.3 Extensión de `psi_tender_tracking_events`

La tabla existente seguirá siendo la única fuente de historial licitatorio. Se ampliará, preservando filas existentes, con:

- nuevos `event_type` públicos;
- `actor_kind`: `human | agent | system`;
- `source_ref_type` y `source_ref_id` para enlazar job, documento, snapshot, run o decisión;
- `metadata jsonb` cerrado/minimizado para contadores y etiquetas de UI;
- `visibility` inicialmente fija en `internal`;
- índice por `(tender_id, created_at desc, id desc)`.

Eventos mínimos:

- `detected`, `entered_tracking`, `assigned`, `tracking_updated`, `blocked`, `unblocked`;
- `converted`, `pipeline_queued`;
- `document_discovery_started`, `document_import_progress`, `document_import_completed`, `document_import_partial`, `document_import_failed`;
- `snapshot_published`;
- `analysis_queued`, `analysis_started`, `analysis_completed`, `analysis_failed`, `analysis_rules_fallback_shown`;
- `requirement_pending`, `information_requested`, `addendum_reviewed`, `observation_recorded`, `internal_meeting`, `case_note`;
- `go_decided`, `no_go_decided`, `offer_preparation_started`, `offer_submitted`, `awarded`, `not_awarded`, `cancelled`, `deserted`.

Reglas:

- append-only: no UPDATE/DELETE de eventos;
- eventos humanos exigen `created_by` humano activo;
- eventos automáticos usan `actor_kind=system|agent`, `created_by` nulo o identidad agente explícita según contrato, y se insertan solo por RPC service-role;
- no guardar textos completos de documentos, prompts, secretos ni respuestas crudas del proveedor en `metadata`.

### 6.4 Estado derivado

`psi_public_tenders.tracking_*` se mantiene como proyección de cola para consultas rápidas. Las RPC que insertan eventos humanos relevantes actualizan evento y proyección en una sola transacción. Los eventos técnicos no sobrescriben arbitrariamente responsable, próxima acción o bloqueo.

## 7. Máquina de estados del pipeline

Estados internos del job:

```text
queued
  → discovering_documents
  → importing_documents
      → retry_wait → importing_documents
      → needs_attention
  → ready_for_snapshot
  → snapshot_ready
  → awaiting_analysis_authorization
  → waiting_agent_capacity
  → analyzing
      → retry_wait → waiting_agent_capacity
      → needs_attention
  → completed
```

Estado terminal adicional: `cancelled`, solo por operación humana autorizada y con evento auditable; cancelar no elimina documentos ni runs ya registrados.

### 7.1 Reglas de transición

- La conversión termina al crear o recuperar `queued`; no espera documentos.
- La conversión/importación puede ser realizada por otro humano con permiso, pero el paso IA solo avanza si `analysis_authorized_by` corresponde exactamente a Katherine Valencia Buitrago o Juan Botero. Si quien convierte es uno de ellos, la autorización queda registrada en la misma transacción; en caso contrario, el job espera en `awaiting_analysis_authorization`.
- `document_import_partial` puede avanzar a snapshot solo si existe un conjunto mínimo utilizable y los fallos terminales están visibles. El criterio exacto es: al menos un documento actual con texto no vacío y ningún fallo marcado `critical=true`; si no, `needs_attention`.
- El snapshot se publica mediante el refresh token gobernado ya existente en `psi_tender_document_state`.
- AGT-002 solo consume `current_snapshot_id`.
- Antes de importar y antes de analizar, el worker vuelve a comprobar el estado oficial. Procesos cancelados, revocados o declarados desiertos pasan a `cancelled`, generan evento y no se analizan ni se reactivan como oportunidad activa.
- `quota`, `saturated` o `busy` no producen reglas como sustituto: llevan a `waiting_agent_capacity`.
- Errores de transporte/modelo son reintentables hasta el límite; luego `needs_attention`.
- Un run válido `AGT-002 / agent_ai` completa el pipeline.
- Un preanálisis `siio_rules_v1 / rules` puede mostrarse como orientación separada, pero nunca completa el paso AGT-002.

## 8. Leasing, idempotencia y reintentos

### 8.1 Claim del worker

Una RPC `psi_claim_tender_processing_job` deberá:

1. tomar advisory lock transaccional;
2. liberar leases expirados;
3. seleccionar un job elegible con `FOR UPDATE SKIP LOCKED`;
4. asignar `lease_id` y expiración;
5. devolver solo un job por claim.

Cada actualización exige el mismo `lease_id`. Un worker tardío no puede sobrescribir el progreso de otro.

### 8.2 Tamaño del lote

Cada invocación procesa un lote pequeño y respeta un presupuesto de tiempo menor que el timeout de la función. Valores iniciales de implementación, configurables y probados:

- máximo 2–3 documentos por invocación;
- presupuesto interno de 90–120 segundos;
- timeout por descarga/extracción individual;
- reanudación desde los ítems pendientes.

El scheduler durable es la garantía de recuperación. Una invocación inmediata después de convertir es solo una optimización y no sustituye al scheduler.

### 8.3 Idempotencia

- Conversión: stable key del tender + oportunidad vinculada.
- Job inicial: `tender:{tender_id}:conversion:{opportunity_id}:pipeline:{version}`.
- Documento: identidad `(opportunity, source, source_document_id)` + `content_hash`; la RPC existente devuelve `unchanged` ante repetición.
- Snapshot: hashes documentales y de perfil existentes.
- AGT-002: idempotency key derivada de snapshot, productor, schema y policy version.
- Evento automático: unique lógico `(event_type, source_ref_type, source_ref_id)` cuando el evento sea singular.

### 8.4 Backoff

Reintentos automáticos con backoff acotado y jitter. Clasificación:

- reintentable: timeout, 429, 5xx, DNS/transporte temporal, busy, cuota/concurrencia;
- terminal: URL inválida/privada, tipo o tamaño no permitido, contenido vacío después de extracción, contrato del proveedor inválido repetido;
- operativo: TLS/credencial/sesión no disponible; pasa a `needs_attention` tras intentos limitados y genera alerta segura.

No se aplican reintentos ilimitados.

## 9. Contratos API

### 9.1 `POST /api/tender-convert` — modificado

Conserva autorización humana y deduplicación. Respuesta inmediata:

```json
{
  "id": "opportunity_uuid",
  "tender_id": "tender_uuid",
  "duplicate": false,
  "processing": {
    "job_id": "job_uuid",
    "status": "queued",
    "current_step": "documents",
    "automatic_analysis": true
  }
}
```

Una repetición recupera oportunidad y job activo/existente; no crea duplicados.

### 9.2 `GET /api/tender-processing-status?opportunity_id=...` — nuevo

Devuelve estado seguro, contadores, timestamps, error recuperable y referencias de snapshot/run; nunca devuelve secretos, prompts o cuerpo crudo del proveedor.

### 9.3 `POST /api/tender-processing-retry` — nuevo

Acción humana autorizada para reactivar fallos retryable/needs_attention. Requiere `opportunity_id`, paso o ítems fallidos y clave de idempotencia. Inserta evento de reintento.

### 9.4 `POST /api/tender-analysis-authorize` — nuevo

Registra la autorización humana que permite el disparo automático posterior. Solo Katherine Valencia Buitrago o Juan Botero; requiere snapshot vigente o deja una autorización acotada al job/pipeline actual. No autoriza GO/NO GO, envío ni presentación.

### 9.5 Worker interno — nuevo

`POST /api/internal/tender-processing-worker` o equivalente server-only. Protegido por secreto de scheduler, sin sesión de navegador, body mínimo y service role. Reclama trabajo en DB; no acepta un expediente arbitrario proporcionado por el cliente.

La frecuencia exacta del scheduler depende del plan Vercel disponible y se valida antes de implementación. Debe existir ejecución periódica suficiente para recuperar jobs abandonados.

### 9.6 Historial

- `GET /api/tender-tracking-events?tender_id=...` se amplía para incluir todos los eventos del proceso, paginados por cursor estable.
- La escritura humana usa una RPC/endpoint específico de actuación pública; no reutiliza libremente `psi_sales_interactions` con tipos comerciales.
- Un backfill idempotente copia una sola vez las interacciones legadas licitatorias relevantes —documentos, análisis y notas públicas del expediente— a `psi_tender_tracking_events`, con `source_ref_type='legacy_sales_interaction'` y `source_ref_id`. Excluye llamadas, correos, WhatsApp, decisor, teléfono, correo del decisor, comisión y cualquier dato privado. Después del corte, todos los eventos nuevos se escriben directamente en la fuente unificada.

### 9.7 Compatibilidad

Los endpoints actuales de documentos y análisis pueden conservarse durante transición como:

- `Actualizar documentos`: crea/reutiliza job de refresh, no ejecuta 40 archivos sincrónicamente.
- `Reintentar AGT-002`: pone el job en `waiting_agent_capacity` para el snapshot vigente.
- `Generar preanálisis por reglas`: opcional y etiquetado explícitamente; no es el CTA principal.

## 10. AGT-002: reparación y verdad de producto

### 10.1 Gate operativo previo

Antes de habilitar análisis automático real:

1. obtener acceso autorizado o intervención del administrador de Hetzner;
2. corregir TLS/Caddy/ACME del host configurado;
3. verificar que el servicio Node está activo y escucha solo detrás de Caddy;
4. verificar autenticación HMAC, sesión ChatGPT/Codex y modelo configurado;
5. ejecutar smoke sintético autorizado;
6. comprobar un run persistido con productor, método, modelo, uso, duración y citas válidas;
7. ajustar `AGT002_PREVIEW_DAILY_MAX_RUNS=20` y verificar el valor efectivo tras deploy.

Concurrencia permanece en 1.

### 10.2 Sin fallback silencioso

El endpoint automático no responde “análisis completado” si AGT-002 falla y solo existen reglas. Debe persistir/mostrar:

- solicitado: AGT-002;
- usado: AGT-002 o reglas;
- fallback: sí/no;
- razón segura;
- siguiente acción.

Etiquetas UI obligatorias:

- `Análisis con IA · AGT-002`;
- `Preanálisis por reglas · SIIO`;
- `AGT-002 no disponible`; o
- `Esperando capacidad/cuota de AGT-002`.

### 10.3 Calidad mínima del análisis

Un run AGT-002 completado debe:

- estar anclado al snapshot actual;
- usar contrato validado y versión de política;
- identificar productor/método/modelo;
- citar únicamente `evidence_refs` enviadas;
- separar fortalezas, debilidades, bloqueos, preguntas y no verificado;
- cruzar el perfil corporativo sin inventar aptitud;
- devolver recomendación asistida, nunca decisión formal.

## 11. Diseño de interfaz

### 11.1 Resumen del expediente

Reemplazar tarjetas privadas por cuatro grupos:

**Proceso oficial:** entidad, referencia, objeto, fuente, modalidad, estado oficial, ubicación.  
**Cronograma y cuantía:** publicación, cierre oficial con hora/zona, días restantes, cuantía, actualización y adendas.  
**Gestión interna:** responsable, estado, prioridad/score, próxima acción, compromiso y bloqueo.  
**Expediente y análisis:** documentos descubiertos/importados/fallidos, snapshot, productor, recomendación, preguntas críticas y decisión humana.

Las fechas deben indicar su significado; “fecha de creación” no sustituye “fecha de publicación” y “cierre estimado” no sustituye el límite oficial.

### 11.2 Seguimiento del expediente

La pantalla aprobada tendrá:

1. **Datos del proceso:** campos estructurados; no blob de Observaciones ni Sede mal mapeada.
2. **Registrar actuación o novedad:** tipo público, descripción, próxima acción, responsable y fecha compromiso opcionales. Actor actual automático.
3. **Historial del proceso:** línea completa, paginada y más reciente primero, con actor/sistema, fecha, tipo, descripción y enlace al recurso relacionado.

Los eventos técnicos se agrupan para evitar ruido. Por ejemplo, el usuario ve un evento de importación `38 importados · 2 fallidos`, no 40 logs internos; puede desplegar el detalle documental.

### 11.3 Vista general `Licitaciones > Seguimiento`

Una fila por proceso con entidad/referencia, estado actual, responsable, próxima acción, compromiso, cierre oficial, días restantes, bloqueo, estado documental y estado del análisis. Al abrir, navega al expediente y su historial.

No almacena un segundo historial.

### 11.4 Documentos

`TenderDocumentSection` mostrará:

- progreso de job;
- conteos por estado;
- fallos con causa segura;
- reintento de fallidos;
- versiones vigentes/históricas;
- estado de extracción;
- fuente oficial.

### 11.5 Análisis

`TenderAnalysisSection` elimina ambigüedad entre los dos botones. CTA principal según estado:

- `Esperando documentos`;
- `Análisis AGT-002 en cola`;
- `Analizando con AGT-002`;
- `Reintentar AGT-002`;
- `Ver análisis AGT-002`.

El preanálisis por reglas queda como recurso secundario claramente etiquetado.

## 12. Recuperación controlada de Aerocivil

Backfill operacional separado de la migración estructural y con dry-run obligatorio:

1. localizar la licitación y oportunidad por UUID, no solo por nombre;
2. leer el evento legado `tender_document_upload`;
3. validar cada una de las 40 entradas: storage/path, tamaño, MIME, hash, texto y fuente;
4. derivar `source_document_id` estable; si no existe identidad oficial, usar una identidad `legacy:<hash-or-id>` documentada;
5. registrar versiones mediante `psi_record_tender_document_version`; no insertar directamente;
6. verificar 40 entradas esperadas o explicar cada exclusión/fallo;
7. abrir refresh gobernado y publicar snapshot actual;
8. insertar eventos de backfill/importación sin falsear sus fechas históricas; conservar el original;
9. reparar AGT-002 y ejecutar una sola corrida real autorizada;
10. verificar evidencia, productor, modelo, uso y vigencia;
11. mostrar el run por reglas como histórico, no como IA;
12. no registrar GO/NO GO automáticamente.

Rollback del backfill: no borrar versiones append-only; retirar el snapshot como actual mediante mecanismo gobernado y marcar el job como revertido/needs_attention. La estrategia exacta debe diseñarse antes de ejecutar porque las tablas inmutables prohíben borrado destructivo.

## 13. Seguridad y autoridad

- Todas las APIs pasan por autorización backend; no se confía en campos de rol del navegador.
- Documentos y texto extraído permanecen privados; las URLs firmadas expiran.
- El worker usa service role solo en servidor.
- URLs externas mantienen protección SSRF, HTTPS, tamaño, MIME y timeout.
- El puente conserva TLS, HMAC-SHA256 canónico, timestamp dentro de ventana, nonce de un solo uso, protección anti-replay, comparación en tiempo constante, límites de cuerpo, rate limiting y timeout. Una petición que falle estos controles no invoca el modelo.
- El kill switch `agt002_codex_preview` permanece operativo y fail-closed; apagarlo impide nuevas ejecuciones IA sin borrar jobs, documentos, snapshots ni runs.
- OAuth y `codex app-server` permanecen aislados en `/opt/agt002-bridge` en Hetzner. No se alojan ni mantienen en Vercel ni en Supabase Edge Functions.
- Logs no contienen documentos, prompts, HMAC, OAuth, tokens, cookies, claves, connection strings ni respuestas crudas; cualquier representación documental usa `[REDACTED]` cuando corresponda.
- El modelo recibe solo el input minimizado y las referencias permitidas del snapshot público. Datos privados heredados del CRM —llamadas, correos, WhatsApp, decisor, teléfono, comisión u observaciones privadas— no se incorporan automáticamente al análisis licitatorio.
- El actor humano de conversión queda como `requested_by`; el worker no suplanta acciones humanas.
- Solo Katherine Valencia Buitrago y Juan Botero pueden autorizar `AI_ANALYSIS_RUN`. El worker ejecuta la autorización ya registrada; no amplía elegibilidad por rol ni por identidad de servicio.
- La cuota temporal de pruebas es 20 consultas por día y la concurrencia máxima es 1. Ambas se verifican mecánicamente después de configurar y antes de ejecutar Aerocivil.
- GO/NO GO conserva el gate existente y vincula el run vigente cuando corresponda.
- Si el análisis está ausente, fallido u obsoleto, la UI lo advierte; nunca atribuye autoridad a AGT-002.
- Envío, firma, carga en plataforma oficial y presentación permanecen fuera del agente.

## 14. Observabilidad

Métricas mínimas:

- jobs por estado y antigüedad;
- tiempo conversión→primer documento y conversión→snapshot;
- documentos descubiertos/importados/unchanged/fallidos;
- reintentos y causas por código;
- jobs con lease expirado;
- tiempo snapshot→inicio/fin AGT-002;
- runs AGT-002 diarios, cuota restante, busy/saturated/quota;
- errores TLS/HMAC/sesión/modelo;
- proporción AGT-002 vs reglas mostrada;
- expedientes cuyo análisis no corresponde al snapshot actual.

Alertas:

- job sin progreso por encima del umbral;
- fallo terminal o `needs_attention`;
- puente TLS no saludable;
- cero runs AGT-002 durante pruebas esperadas;
- fallback por reglas en flujo automático;
- documento crítico fallido;
- decisión vinculada a análisis obsoleto.

## 15. Rollout y rollback

### Fase 0 — restauración operativa

- acceso/gate Hetzner;
- reparación TLS y smoke sintético;
- verificación de RBAC elegible para ejecutar/reintentar;
- cuota 20 en entorno de pruebas productivo autorizado;
- UI de productor/fallback explícito.

### Fase 1 — persistencia durable oscura

- migraciones de jobs/items/eventos y RPCs;
- worker desactivado por feature flag;
- pruebas SQL/PGlite y seguridad;
- ningún cambio de comportamiento productivo.

### Fase 2 — worker y estado visible

- activar para un proceso sintético/no sensible;
- importar por lotes, reanudar y publicar snapshot;
- probar cierres de navegador, timeout y lease expirado;
- validar paridad de `api/[...path].js` y `server/index.js`.

### Fase 3 — interfaz pública

- Resumen especializado;
- Seguimiento/historial unificado;
- Documentos y Análisis con estados reales;
- eliminar CTA y campos privados para licitaciones sin afectar oportunidades privadas.

### Fase 4 — Aerocivil

- dry-run de backfill;
- gate humano;
- backfill, snapshot y análisis real único;
- validación funcional por Juan/Katherine.

### Rollback

- feature flags separadas para pipeline automático, UI pública y análisis automático;
- detener scheduler no elimina jobs ni datos;
- volver temporalmente a importación manual sin reactivar importación sincrónica de 40 documentos;
- migraciones aditivas con rollback que retire funciones/índices nuevos solo si no destruye historial;
- no borrar snapshots, runs, decisiones ni versiones append-only.

## 16. Pruebas requeridas

### 16.1 Unitarias

- máquina de estados y transiciones inválidas;
- clasificación de errores y backoff;
- claves de idempotencia;
- agregación de progreso;
- etiquetas productor/método/fallback;
- mapeo de datos públicos en Resumen;
- tipos de actuación permitidos.

### 16.2 Integración DB/PGlite

- claim concurrente de jobs;
- lease expirado y reanudación;
- un job activo por oportunidad;
- deduplicación de import items;
- publicación de snapshot con token vigente;
- evento y proyección atómicos;
- append-only del historial;
- separación de permisos humano/agente/sistema;
- cuota AGT-002 de 20 y concurrencia 1;
- decisión anclada al snapshot actual.

### 16.3 Backend

- conversión responde sin esperar importación;
- repetición devuelve la misma oportunidad/job;
- worker procesa lote acotado;
- cierre/timeout deja trabajo recuperable;
- no fallback silencioso;
- API no expone secretos ni texto completo en estados/errores;
- backend parity.

### 16.4 Frontend

- progreso sobrevive recarga;
- Resumen no muestra campos privados para licitación;
- oportunidades privadas conservan su UI;
- Seguimiento muestra eventos pre y post conversión;
- actor actual no es seleccionable libremente;
- productor real visible;
- estados vacíos, errores y reintentos accesibles;
- navegación por teclado y lectores de pantalla.

### 16.5 End-to-end

1. detectar tender sintético;
2. iniciar seguimiento;
3. convertir y cerrar navegador;
4. comprobar creación inmediata;
5. comprobar importación en segundo plano;
6. forzar un fallo y verificar reintento;
7. publicar snapshot;
8. simular quota/busy sin reglas engañosas;
9. ejecutar AGT-002 sintético;
10. comprobar citas y productor;
11. comprobar historia completa;
12. registrar GO/NO GO únicamente como humano autorizado.

## 17. Criterios de aceptación

- `POST /api/tender-convert` no espera el procesamiento de documentos.
- El pipeline continúa sin navegador y sobrevive a funciones terminadas.
- Cada documento posee estado e identidad verificables.
- Repeticiones no duplican oportunidad, job, versión, snapshot, run ni evento singular.
- Los fallos parciales se muestran y pueden reintentarse.
- AGT-002 solo analiza el snapshot vigente y utilizable.
- Busy/cuota dejan el análisis en espera; no lo sustituyen silenciosamente por reglas.
- La cuota efectiva comprobada es 20 y la concurrencia efectiva es 1.
- Todo resultado muestra productor, método y vigencia.
- Resumen público contiene información del proceso y no campos privados.
- Seguimiento utiliza actuaciones licitatorias.
- El bloque inferior del expediente muestra historia previa y posterior a conversión.
- La cola general deriva del mismo estado/historial.
- Aerocivil tiene documentos tipados recuperados y un análisis AGT-002 real con referencias, después de gate humano.
- GO/NO GO, envío y presentación siguen siendo humanos.
- Tests, build y verificación productiva pasan antes de declarar implementación completada.

## 18. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| TLS Hetzner continúa roto | Bloquear activación AGT-002, acceso autorizado, smoke sintético y health alert. |
| Vercel Cron no tiene frecuencia suficiente | Confirmar plan; usar scheduler autenticado equivalente sin mover autoridad de datos. |
| Documento individual excede presupuesto | Timeout individual, ítem retryable/terminal y procesamiento independiente. |
| Doble worker | Claim/lease atómico y validación de lease en cada escritura. |
| Cuota 20 se consume automáticamente | Concurrencia 1, idempotencia por snapshot y no reanalizar snapshot idéntico. |
| Historial demasiado ruidoso | Agrupar progreso técnico y permitir detalle desplegable. |
| Backfill Aerocivil duplica documentos | Dry-run, hash + identidad estable y RPC idempotente. |
| UI pública afecta CRM privado | Render condicional por tipo/origen y pruebas de regresión privada. |
| Reglas se confunden con IA | Etiquetas normativas y contratos de respuesta explícitos. |
| Análisis obsoleto se usa para decidir | Comparar run.snapshot_id con current_snapshot_id y advertir/bloquear vínculo autoritativo. |

## 19. Preguntas operativas abiertas antes de implementar

No bloquean esta especificación, pero deben resolverse en el plan o fase correspondiente:

1. ¿Quién administra Caddy/Hetzner y cómo se otorgará acceso temporal auditado?
2. ¿Qué scheduler y frecuencia admite el plan Vercel actual?
3. ¿Los UUID y correos productivos de Katherine Valencia Buitrago y Juan Botero corresponden exactamente a los dos únicos perfiles elegibles para `AI_ANALYSIS_RUN`? Debe comprobarse mecánicamente antes de activar.
4. ¿Qué documentos se consideran críticos para impedir snapshot utilizable por fuente SECOP/ESU?
5. ¿Cuál es la zona horaria normativa para cierres y compromisos en UI?
6. ¿Katherine o Dirección de Licitaciones validará el backfill y el análisis de Aerocivil junto con Juan?

## 20. Gate de implementación

Esta especificación no autoriza por sí sola migraciones, cambios en Hetzner, variables de entorno, ejecución real sobre Aerocivil, push ni deploy. Tras aprobación documental se elaborará un plan TDD por tareas y se solicitarán los gates humanos correspondientes antes de cada acción con efectos externos.
