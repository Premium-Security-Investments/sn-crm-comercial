# Diseño — Puente temporal de runtime AGT-002 en Hetzner (fase 1, YAGNI)

**Fecha:** 2026-07-27
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`
**Rama:** `feat/agt002-hetzner-runtime-bridge`
**Aprobado por:** Juan Botero (alcance, restricciones y parámetros de esta especificación)
**Naturaleza de este documento:** diseño únicamente. No contiene código productivo, no cambia configuración real, no instala ni despliega nada, no ejecuta pruebas contra infraestructura real.
**Vigencia máxima del puente descrito:** 30 días naturales desde su activación, con costo incremental cero sobre el servidor Hetzner ya contratado; vencido ese plazo, migración obligatoria a AWS (sección 15).

## 1. Objetivo

Especificar el diseño de un puente HTTP delgado y síncrono, alojado temporalmente en un servidor Hetzner ya existente, que permita que AGT-002 Preview invoque `codex app-server` sin exigir que Vercel sostenga un subproceso local autenticado por OAuth de ChatGPT. Todo lo demás —autorización, minimización, cuota/idempotencia, validación de contrato, persistencia append-only y respaldo determinístico— permanece en Vercel y Supabase exactamente como existe hoy.

## 2. No objetivos

- No implementa código productivo, IaC, scripts de despliegue ni cambios de configuración en Vercel, Supabase o Hetzner.
- No activa el puente en producción ni ejecuta pruebas reales contra Hetzner; ninguna disponibilidad, latencia o resultado de prueba se afirma en este documento.
- No resuelve DNS corporativo ni sustituye `sslip.io` por un dominio propio.
- No introduce mTLS, allowlist de IP saliente ni un gateway Cloudflare (deliberadamente fuera de alcance por YAGNI en esta fase; ver sección 7.5).
- No cambia el productor visible (`AGT-002`), la obligatoriedad de revisión humana, ni el motor determinístico de respaldo (`siio_rules_v1`).
- No habilita el envío de documentos reales sin el gate posterior de confidencialidad y residencia de datos (sección 12, fase 3).
- No decide, aprueba ni automatiza GO/NO GO, firma, envío o presentación ante el cliente.
- No implementa la migración a AWS; solo describe su forma prevista y sus gates (sección 15).

## 3. Estado actual y seam exacto

### 3.1 Lo que ya existe y no cambia

AGT-002 Preview ya está implementado como motor completo dentro de este repositorio:

- `agt002-preview-input.js` construye la entrada minimizada y cerrada (`evidence_id`, extractos) que se envía al modelo.
- `agt002-preview-contract.js` define `AGT002_PREVIEW_SCHEMA_VERSION = '2.0-preview.1'` (línea 1), el `outputSchema` JSON cerrado (`AGT002_PREVIEW_OUTPUT_JSON_SCHEMA`) y `validateAgt002PreviewModelOutput`, que rechaza claves inesperadas, recomendaciones fuera de enum y citas (`evidence_refs`) que no existan en la entrada enviada.
- `agt002-preview-engine.js` (`createAgt002PreviewEngine`) orquesta una ejecución: arma el `previewInput`, invoca al cliente, valida la salida del modelo, construye el envelope con identidad/esquema/política asignados por el propio servidor (nunca confiados del modelo) y valida el resultado final con `validateTenderAnalysisResult` antes de devolverlo.
- `agt002-preview-persistence.js` + `supabase/migrations/028_agt002_preview_claims.sql` (`psi_claim_agt002_preview_run`, `psi_release_agt002_preview_claim`) implementan reserva atómica de concurrencia y cuota diaria en PostgreSQL mediante `pg_advisory_xact_lock`, y `registerAgt002PreviewAnalysis` persiste el resultado de forma append-only en `psi_tender_analysis_runs`, sin guardar nunca el prompt ni el contenido documental.
- `server/index.js:2723-2792` (endpoint `POST /api/tender-documents-analyze-agent-preview`, byte-idéntico en `api/[...path].js` por convención de paridad del repositorio) ya implementa: `requireAction(currentProfile, ACTIONS.AI_ANALYSIS_RUN)`, apertura de snapshot documental gobernado, reserva de cupo (`claimAgt002PreviewRun`), invocación del motor, persistencia y liberación del cupo en un bloque `finally`, y respaldo automático a `siio_rules_v1` (`useRulesFallback`) ante cualquier excepción no capturada explícitamente antes.
- `access-control.js:332` (`case ACTIONS.AI_ANALYSIS_RUN`) exige `canHumanTenderAction(profile) && hasHumanRole(profile, {'admin','gerencia','director'})`. Es un gate por rol, no una lista de nombres codificada. Por tanto, el código por sí solo **no demuestra** que únicamente Katherine y Juan puedan ejecutar la acción. Antes de activar la fase 3 se debe auditar mecánicamente el conjunto de perfiles elegibles y confirmar que contiene exactamente a esas dos personas; si aparece un tercer perfil, la activación permanece bloqueada hasta corregir sus módulos/áreas/rol mediante el modelo RBAC existente, sin hardcodear nombres en `access-control.js`.

Ninguno de estos componentes se modifica en este diseño.

### 3.2 El seam exacto: por qué se necesita un puente

`agt002-preview-runtime.js` (`AGT002_PREVIEW_ENGINE_ID = 'agt002_codex_preview'`, línea 4) construye el cliente así:

```js
// agt002-preview-runtime.js:55-58
const client = createCodexAppServerClient({
  command: environment.AGT002_CODEX_APP_SERVER_BIN,
  args: nonEmpty(environment.AGT002_CODEX_APP_SERVER_ARGS) ? JSON.parse(environment.AGT002_CODEX_APP_SERVER_ARGS) : ['app-server'],
});
```

`createCodexAppServerClient` (`agt002-preview-codex-client.js`) hace `child_process.spawn('codex', ['app-server'], ...)` y habla el protocolo JSON-line real de Codex App Server (`initialize`, `account/read`, `account/rateLimits/read`, `thread/start`, `turn/start`, notificaciones `item/completed` / `thread/tokenUsage/updated` / `turn/completed`) sobre una sesión de ChatGPT ya autenticada por OAuth en el mismo host. Expone exactamente esta firma (línea 54):

```js
run({ model, policy, input, outputSchema, timeoutMs = 30_000, idempotencyKey = randomUUID(), signal, cwd: turnCwd } = {})
```

y resuelve con `{ content, usage: { input_tokens, output_tokens }, rate_limit }`.

Vercel ejecuta funciones serverless efímeras, sin filesystem persistente garantizado ni proceso de fondo de larga duración: no puede sostener una sesión OAuth de ChatGPT ya iniciada ni un subproceso `codex app-server` reutilizable. Por eso `agt002-preview-runtime.js` **no puede** construir este cliente en Vercel de forma operativa hoy, aunque el código ya esté escrito y probado localmente.

El seam de este diseño es exactamente esa línea de construcción del cliente. El puente Hetzner se limita a sustituir `createCodexAppServerClient(...)` por un nuevo cliente HTTP (`createAgt002HetznerBridgeClient(...)`, nombre de diseño) que implementa la **misma firma `run(...)`** y el **mismo tipo de retorno**, hablando por HTTP con un proceso `codex app-server` que sí vive de forma persistente en Hetzner. Ningún otro archivo de la lista de la sección 3.1 necesita cambiar: `agt002-preview-engine.js`, `agt002-preview-contract.js`, `agt002-preview-persistence.js` y el endpoint en `server/index.js` permanecen exactamente como están.

Nota: el propio `agt002-preview-codex-client.js` documenta que no existe idempotencia a nivel de wire en el protocolo oficial de Codex (`// no wire-level idempotency in the official protocol; caller-side dedup only`, línea 60); el puente hereda esa misma limitación y no debe prometer lo contrario (sección 6.4).

### 3.3 Discrepancia con el diseño previo (2026-07-26)

El documento `docs/superpowers/specs/2026-07-26-siio-commercial-24h-operational-cut-design.md` (sección 7) describe un motor distinto, `agt002_openai_preview`, que llama directamente a la API de OpenAI con `OPENAI_API_KEY` — una llamada HTTP sin estado que sí podría ejecutarse desde Vercel sin ningún puente. El código efectivamente implementado en esta rama (`agt002-preview-runtime.js`, `agt002-preview-codex-client.js`) es otro: `agt002_codex_preview`, basado en Codex App Server sobre una sesión ChatGPT autenticada por OAuth. Esta especificación diseña el puente para el motor **realmente implementado** (Codex App Server), no para el motor OpenAI-API descrito el 2026-07-26. Esa diferencia de fondo es precisamente la razón por la que existe la necesidad de un puente: una llamada HTTP sin estado a una API con clave no la habría requerido.

## 4. Alternativas consideradas

| Alternativa | Descripción | Decisión |
|---|---|---|
| **A — Puente HTTP delgado y síncrono (elegida)** | Solo el `spawn` de `codex app-server` vive en Hetzner; Vercel conserva RBAC, minimización, cuota/idempotencia, validación y persistencia. | Elegida: superficie de cambio mínima, ningún dato sensible nuevo persiste fuera de Supabase, reversible en minutos. |
| B — Mover todo el motor a Hetzner (RBAC, cuota, persistencia incluidos) | AGT-002 Preview completo, incluida la llave de servicio de Supabase, correría en Hetzner. | Descartada: duplica el perímetro de confianza, obliga a sacar credenciales de Supabase fuera de Vercel, amplía el radio de impacto de un servidor temporal y complica el decommission a 30 días. |
| C — Cola asíncrona (submit + poll/webhook) | Vercel encola la solicitud; un worker la resuelve y notifica. | Descartada para esta fase: introduce nueva persistencia de estado intermedio y semántica de reintentos que no existen hoy. Queda como plan de contingencia explícito si la verificación de timeout real de Vercel (sección 11, riesgo Crítico 2) muestra que el modelo síncrono no alcanza. |
| D — mTLS o gateway Cloudflare Access | Autenticación mutua por certificado o túnel gestionado. | Descartada por YAGNI en fase 1: agrega aprovisionamiento y rotación de certificados de cliente desproporcionados para un puente de ≤30 días con un único llamador. Revisar solo si el puente debiera extenderse más allá de los 30 días (lo cual en sí mismo sería una falla de este plan, no una prórroga). |
| E — Allowlist de IP de origen en Hetzner | Filtrar por IP de origen de Vercel. | Descartada: Vercel no ofrece IP de egreso fija ni estable para funciones serverless; una allowlist real bloquearía tráfico legítimo o sería tan amplia que no aportaría seguridad real. La autenticación se apoya en posesión del secreto HMAC, que es independiente de la IP de origen. |
| F — Seguir invocando `codex app-server` directamente desde Vercel | Statu quo. | Descartada: es la causa raíz del problema (sección 3.2); Vercel no puede sostener la sesión OAuth ni el subproceso. |

## 5. Arquitectura y componentes

```
┌───────────────────────────── Vercel (sin cambios de superficie) ─────────────────────────────┐
│  server/index.js  POST /api/tender-documents-analyze-agent-preview                            │
│    requireAction(AI_ANALYSIS_RUN) → snapshot doc. → claimAgt002PreviewRun (Supabase)           │
│    agt002-preview-engine.js → client.run({model, policy, input, outputSchema, timeoutMs,       │
│                                            idempotencyKey, signal})                             │
│                     │                                                                          │
│                     ▼                                                                          │
│   [NUEVO] agt002-hetzner-bridge-client.js (diseño): mismo run(...), firma HMAC, POST HTTPS      │
└───────────────────────────────────────┬─────────────────────────────────────────────────────────┘
                                         │ TLS 1.2+ · HTTPS
                                         ▼
┌────────────────────── Hetzner (temporal, ≤30 días, costo incremental cero) ────────────────────┐
│  Caddy :443 (certificado público automático, host agt002.5-78-140-24.sslip.io)                 │
│      │ reverse_proxy → 127.0.0.1:<puerto interno>                                              │
│      ▼                                                                                          │
│  Servicio Node aislado (usuario de servicio sin privilegios, systemd, CPU/mem limitados)         │
│      - valida TLS terminado por Caddy, Content-Type estricto, tamaño de body, timestamp,        │
│        nonce (uso único) y firma HMAC-SHA256 (comparación constant-time)                        │
│      - concurrencia dura = 1 (mutex de proceso)                                                 │
│      - spawn `codex app-server` en cwd efímero (nunca persistido, nunca reutilizado)             │
│      - único estado persistente: credencial de sesión OAuth de Codex (permisos 0600)            │
│      - logs sanitizados: correlation-id, código, latencia, uso — nunca contenido                │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Componentes nuevos (diseño, no implementados): el módulo de cliente HTTP en el lado Vercel (drop-in de `createCodexAppServerClient`) y el servicio HTTP en Hetzner (Caddy + proceso Node que envuelve el mismo protocolo JSON-line que ya habla `agt002-preview-codex-client.js`, ahora expuesto detrás de autenticación HMAC en vez de invocado por `child_process.spawn` local).

## 6. Contrato HTTP preciso

### 6.1 Endpoint

```
POST https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run
Content-Type: application/json   (estricto; cualquier otro valor → 415)
```

Es el único endpoint funcional del puente. Cualquier otro método o ruta responde `404`/`405` sin ejecutar lógica de negocio.

### 6.2 Autenticación de cada petición (obligatoria, fail-closed)

Encabezados requeridos:

```
X-AGT002-Timestamp: <segundos unix, entero>
X-AGT002-Nonce: <cadena opaca de un solo uso, ≥16 bytes de entropía>
X-AGT002-Signature: <hex HMAC-SHA256, minúsculas>
Idempotency-Key: <idempotencyKey del llamador, solo para correlación/logs>
```

Cadena canónica firmada (en este orden exacto, separada por `\n`):

```
METHOD\nPATH\nSHA256_HEX(body)\nTIMESTAMP\nNONCE
```

- `METHOD` en mayúsculas (`POST`); `PATH` exactamente `/v1/agt002-preview/run` (sin query string); `SHA256_HEX(body)` el hash del cuerpo crudo tal como fue transmitido, en hexadecimal minúsculas.
- El servidor recalcula la cadena canónica sobre el body efectivamente recibido y compara la firma con comparación en tiempo constante. Cualquier discrepancia de un solo byte invalida la firma completa.
- Ventana de validez: `|now - timestamp| ≤ 30s`. Fuera de ventana → `401`.
- Cada `nonce` se acepta una única vez; el servidor lo recuerda en memoria durante al menos la ventana de validez más margen de reloj (90s) y rechaza cualquier repetición con `401`, incluso si la firma es válida.
- El secreto HMAC (≥32 bytes, generado fuera de banda) es compartido únicamente entre el cliente Vercel y el servicio Hetzner; nunca viaja en la URL, en logs ni en el cuerpo.

### 6.3 Cuerpo de la petición

El cuerpo transporta únicamente los campos del contrato drop-in que tienen sentido sobre HTTP:

```json
{
  "model": "string, no vacío",
  "policy": "string, no vacío (baseInstructions)",
  "input": { "…": "objeto cerrado ya minimizado por Vercel" },
  "outputSchema": { "…": "JSON Schema cerrado, additionalProperties:false" },
  "timeoutMs": "entero positivo",
  "idempotencyKey": "string, solo para correlación/logs del lado Hetzner"
}
```

Notas de diseño explícitas:

- **`signal` no se serializa.** Un `AbortSignal` es una construcción de JavaScript en memoria, no un valor transmisible. La cancelación se expresa a nivel de conexión: el cliente HTTP de Vercel abre la conexión con un timeout de `timeoutMs` (+2s de margen) y, si aborta, cierra la conexión; el servidor Hetzner debe observar el cierre de conexión (`req` abortado) y, si ya inició un turno, emitir `turn/interrupt` y matar el subproceso exactamente como hace hoy `onAbort` en `agt002-preview-codex-client.js:101-107`. Si la propia señal de red no llega a tiempo, el timeout determinístico del servidor (ver 6.5) es quien decide.
- **`cwd` no forma parte del contrato de red.** En el código actual, ningún llamador de `client.run(...)` pasa `cwd` (`agt002-preview-engine.js:53` no lo incluye); el cliente local siempre usa su propio directorio temporal por defecto. El servidor Hetzner debe generar su propio directorio de trabajo efímero por petición y **debe ignorar/rechazar** cualquier intento de que el llamador imponga una ruta, para no abrir una vía de inyección de rutas. Si en el futuro un llamador necesitara pasar `cwd`, eso requeriría una revisión de este contrato, no una aceptación silenciosa.
- El body nunca incluye credenciales, tokens de sesión OAuth, ni contenido fuera de lo que Vercel ya minimizó antes de esta llamada (evidence_id y extractos ya acotados por `agt002-preview-input.js`, sin cambios).

### 6.4 Límites

| Límite | Valor | Justificación |
|---|---|---|
| Tamaño máximo del cuerpo de la petición | 262.144 bytes (256 KiB) | Los topes ya aprobados para AGT-002 Preview acotan la entrada a ≤12 documentos × ≤3.000 caracteres (≤36.000 caracteres documentales) más metadatos y el `outputSchema` fijo; 256 KiB deja margen amplio para overhead de JSON/escape sin permitir cargas arbitrariamente grandes. |
| Tamaño máximo de la respuesta | 262.144 bytes (256 KiB) | La salida del modelo está acotada por un `outputSchema` cerrado; un exceso indica una respuesta corrupta o truncada y debe rechazarse, no aceptarse parcialmente. |
| Ventana de timestamp | ±30 s | Fijada explícitamente por Juan; suficiente para reloj no perfectamente sincronizado, insuficiente para replay útil. |
| Concurrencia en Hetzner | 1 en todo momento | Coincide con `AGT002_PREVIEW_MAX_CONCURRENT=1` del lado Vercel/Supabase; el runtime Hetzner aplica su propio mutex de proceso como segunda barrera independiente (defensa en profundidad), no como sustituto de la reserva atómica ya existente en `psi_claim_agt002_preview_run`. |
| Cuota diaria durable | 5 ejecuciones/día | Contada en Supabase (`countAgt002PreviewRunsToday`, ya existente), no en Hetzner; se configura vía `AGT002_PREVIEW_DAILY_MAX_RUNS=5` del lado Vercel exactamente como hoy soporta el código (`agt002-preview-runtime.js:26`). |
| Timeout de turno | El `timeoutMs` recibido en el body (hoy `AGT002_PREVIEW_TIMEOUT_MS`, por defecto 30.000 ms) | El servidor es la autoridad del timeout; el cliente HTTP solo añade margen de red, nunca decide antes que el servidor. |
| Reintentos de transporte | Ninguno automático ante timeout | Un timeout no se reintenta: el llamador recibe el error y el endpoint de `server/index.js` ya cae al respaldo determinístico existente. |

### 6.5 Respuestas

Éxito (`200`), forma idéntica a la que ya consume `agt002-preview-engine.js`:

```json
{
  "content": "string — el JSON crudo del modelo, sin parsear por el puente",
  "usage": { "input_tokens": 0, "output_tokens": 0 },
  "rate_limit": null
}
```

El puente **nunca** parsea ni reescribe `content`: lo transporta tal cual, exactamente como hace hoy `agt002-preview-codex-client.js` (`lastAgentMessageText`). La validación semántica de esa cadena sigue ocurriendo únicamente en `agt002-preview-engine.js`/`agt002-preview-contract.js`, sin cambios.

Error (cualquier código `4xx`/`5xx`), forma fija y sanitizada:

```json
{ "error": { "code": "AGT002_CODEX_TIMEOUT", "message": "mensaje fijo, sin detalle del proveedor" }, "correlation_id": "uuid" }
```

Mapa de estados y códigos (el puente conserva el mismo vocabulario de `error.code` que ya usa `agt002-preview-codex-client.js`, aunque `agt002-preview-engine.js` hoy colapse cualquier excepción a un mensaje seguro genérico; conservar el código específico solo sirve para observabilidad/diagnóstico, no cambia el comportamiento del motor):

| HTTP | `error.code` | Causa |
|---|---|---|
| 400 | `AGT002_BRIDGE_BAD_REQUEST` | Cuerpo mal formado o campo obligatorio ausente. |
| 401 | `AGT002_BRIDGE_AUTH_INVALID` | Firma HMAC inválida, timestamp fuera de ventana, o nonce repetido/ausente. |
| 405 | `AGT002_BRIDGE_METHOD_NOT_ALLOWED` | Método distinto de `POST`. |
| 409 | `AGT002_BRIDGE_BUSY` | El runtime ya tiene una ejecución en curso (concurrencia=1 agotada). No se encola: se rechaza. |
| 413 | `AGT002_BRIDGE_PAYLOAD_TOO_LARGE` | Cuerpo por encima del límite de 256 KiB. |
| 415 | `AGT002_BRIDGE_UNSUPPORTED_MEDIA_TYPE` | `Content-Type` distinto de `application/json`. |
| 422 | `AGT002_CODEX_INVALID_RESPONSE` | El body es válido pero `outputSchema`/`input` no tienen la forma cerrada exigida. |
| 502 | `AGT002_CODEX_PROVIDER_ERROR` / `AGT002_CODEX_TRANSPORT_ERROR` | El subproceso `codex app-server` falló o terminó sin responder. |
| 503 | `AGT002_CODEX_LOGIN_REQUIRED` / `AGT002_CODEX_ACCOUNT_INVALID` | No hay sesión ChatGPT válida en Hetzner, o no es de tipo `chatgpt`. |
| 504 | `AGT002_CODEX_TIMEOUT` | El turno no completó dentro de `timeoutMs`. |
| 500 | `AGT002_BRIDGE_INTERNAL` | Falla inesperada del propio servicio puente (fail-closed). |

Ningún código de error devuelve el cuerpo de error del proveedor, encabezados de autorización, rutas de archivo ni información de la cuenta OAuth.

## 7. Seguridad y modelo de amenazas

### 7.1 Superficie expuesta

Un único puerto público (443, TLS terminado por Caddy) y una única ruta funcional (`POST /v1/agt002-preview/run`), autenticada en cada petición. Puerto 80 solo para el reto ACME/redirección a HTTPS. Todo lo demás del host permanece cerrado a Internet.

### 7.2 Aislamiento en Hetzner

- Usuario de servicio dedicado, sin privilegios (`no login shell` operativo salvo lo estrictamente necesario), sin `sudo`.
- Unidad `systemd` con límites de CPU y memoria; reinicio automático solo del proceso, nunca reintento automático de una llamada al proveedor.
- Filesystem restringido: el proceso solo puede leer/escribir su propio directorio de aplicación, su directorio de trabajo efímero por petición y el almacén de credencial OAuth de Codex.
- Único estado persistente: la credencial de sesión OAuth que usa `codex app-server` para autenticarse ante ChatGPT, con permisos `0600` y propietario exclusivo del usuario de servicio. El servicio HTTP del puente no expone ningún endpoint que lea o reenvíe esa credencial.
- Los payloads de petición y las respuestas del modelo **nunca** se escriben a disco; viven solo en memoria durante la duración de la petición, igual que hoy en `agt002-preview-codex-client.js` (que ya usa un directorio temporal efímero solo como `cwd` del subproceso, no como almacén de contenido).
- Logs sanitizados: `correlation_id`, código de resultado, latencia y consumo de tokens; nunca el contenido de `input`, `content` ni encabezados de autenticación.

### 7.3 Modelo de amenazas (STRIDE)

| Amenaza | Vector | Mitigación |
|---|---|---|
| Spoofing | Petición dirigida al endpoint sin ser el llamador legítimo | TLS + HMAC-SHA256 con secreto compartido fuera de banda; sin firma válida no hay ejecución. |
| Tampering | Alteración del cuerpo en tránsito o en un replay modificado | La firma cubre `sha256(body)`; cualquier cambio de un byte invalida la firma. |
| Repudiation | Negar que una ejecución específica ocurrió | `correlation_id` por petición + registro append-only ya existente en `psi_tender_analysis_runs` (sin cambios) referencian cada ejecución exitosa desde el lado Vercel. |
| Information disclosure | Filtración de contenido de licitaciones, credencial OAuth o detalle del proveedor | Nunca se persiste payload a disco; logs sin contenido; catálogo cerrado de mensajes de error; credencial OAuth sin endpoint que la exponga. |
| Denial of service | Saturar el único proceso Hetzner o agotar CPU/memoria del host | Concurrencia dura=1, límites de CPU/memoria por `systemd`, sin colas ni reintentos automáticos, cuerpo limitado a 256 KiB. |
| Elevation of privilege | Comprometer el servicio y escalar en el host | Usuario de servicio sin privilegios, sin `sudo`, filesystem restringido, sin egreso adicional habilitado más allá de lo que `codex app-server` necesita hacia ChatGPT. |
| Replay | Reenvío de una petición capturada | Ventana ±30 s + nonce de un solo uso rechazado en repetición, incluso con firma válida. |

### 7.4 Por qué no allowlist de IP

Vercel no ofrece una IP de egreso fija ni estable para funciones serverless; una allowlist real bloquearía tráfico legítimo intermitentemente o tendría que ser tan amplia que no aportaría seguridad real. La autenticación se apoya en posesión del secreto HMAC, que es independiente del origen de red.

### 7.5 Por qué no mTLS/Cloudflare en esta fase

Un puente con vigencia máxima de 30 días y un único llamador conocido no justifica el costo de aprovisionar y rotar certificados de cliente o introducir un gateway gestionado adicional; HMAC + TLS ya cubre autenticación, integridad y confidencialidad en tránsito. Revisar esta decisión solo si el puente debiera extenderse más allá de los 30 días — lo cual, en sí mismo, sería un incumplimiento del plan de esta especificación, no una prórroga aceptable por defecto.

## 8. Flujo de datos extremo a extremo

1. Un usuario autenticado con rol elegible (hoy, Katherine o Juan) solicita el análisis IA desde la interfaz de Licitaciones.
2. `POST /api/tender-documents-analyze-agent-preview` en Vercel; `requireAction(currentProfile, ACTIONS.AI_ANALYSIS_RUN)` valida el rol (sin cambios).
3. Vercel abre el snapshot documental gobernado, calcula `idempotencyKey` (`computeAgt002PreviewIdempotencyKey`) y reserva cupo/concurrencia vía `claimAgt002PreviewRun` contra Supabase (sin cambios).
4. `agt002-preview-input.js` construye el `previewInput` cerrado y minimizado (sin cambios).
5. `agt002-preview-engine.js` invoca `client.run({model, policy, input, outputSchema, timeoutMs, idempotencyKey, signal})`. En esta fase, `client` es el nuevo cliente HTTP del puente en lugar del `spawn` local.
6. El cliente HTTP firma la petición (HMAC sobre método, path, hash del body, timestamp y nonce) y la envía por TLS a `https://agt002.5-78-140-24.sslip.io`.
7. Caddy termina TLS y reenvía a Node en loopback.
8. El proceso Node valida `Content-Type`, tamaño del cuerpo, ventana de timestamp, unicidad de nonce y firma HMAC (comparación en tiempo constante) **antes** de tocar el subproceso; cualquier falla responde `401/413/415` sin ejecutar nada más.
9. El proceso Node confirma sesión ChatGPT activa (`account/read`, tipo `chatgpt`) y ejecuta el protocolo JSON-line contra `codex app-server` en un directorio de trabajo efímero, propio de la petición.
10. El proceso Node responde `{content, usage, rate_limit}` o un error sanitizado con `code` y `correlation_id`.
11. El cliente HTTP en Vercel traduce la respuesta a la misma forma que ya consume `agt002-preview-engine.js`, sin transformarla.
12. Vercel valida la salida del modelo (`validateAgt002PreviewModelOutput`), arma el envelope con identidad/esquema/política asignados por el propio servidor y valida el resultado final (`validateTenderAnalysisResult`), exactamente como hoy.
13. Vercel persiste vía `registerAgt002PreviewAnalysis` (RPC append-only) y libera el cupo (`releaseAgt002PreviewClaim`) en el bloque `finally` ya existente del endpoint.
14. Cualquier falla entre los pasos 6 y 12 (TLS, HMAC, OAuth, timeout, esquema o runtime) se traduce en una excepción segura capturada por el `catch` ya existente en `server/index.js:2782-2784`, que invoca `useRulesFallback('preview_unavailable')` y libera el cupo igualmente.

## 9. Manejo de errores y fallback

| Falla | Origen | Comportamiento |
|---|---|---|
| TLS no negociado / certificado inválido | Red/Caddy | El cliente HTTP falla la conexión → excepción segura → `useRulesFallback`. |
| Firma HMAC inválida, timestamp fuera de ventana, nonce repetido | Autenticación del puente | `401` sin ejecutar el subproceso → excepción segura → `useRulesFallback`. |
| Sesión OAuth de ChatGPT ausente o inválida | Hetzner | `503` (`AGT002_CODEX_LOGIN_REQUIRED`/`AGT002_CODEX_ACCOUNT_INVALID`) → excepción segura → `useRulesFallback`. |
| Timeout de turno | Hetzner/proveedor | `504` → excepción segura, **sin reintento automático** → `useRulesFallback`. |
| Esquema/`outputSchema` inválido o citas inexistentes | Validación ya existente en `agt002-preview-contract.js` | Rechazo fail-closed ya implementado, sin cambios → `useRulesFallback`. |
| Error del runtime (subproceso caído, respuesta truncada) | Hetzner | `502` → excepción segura → `useRulesFallback`. |
| Puente apagado (kill switch) | Operación humana | Conexión rechazada o variable de entorno ausente → mismo camino que "no configurado" hoy (`isAgt002PreviewConfigured` devuelve `false`) → botón IA no disponible, reglas siguen operativas. |

En todos los casos, el motor determinístico (`siio_rules_v1`) permanece disponible y la decisión GO/NO GO humana no se ve afectada.

### 9.1 Kill switch

Dos mecanismos independientes, cualquiera de los dos basta para desactivar el puente sin cambios de código:

1. **Lado Vercel:** ausencia o vaciado de la variable que apunta al puente (por ejemplo `AGT002_HETZNER_BRIDGE_URL` o el propio `TENDER_ANALYSIS_ENGINE`) hace que el equivalente de `isAgt002PreviewConfigured` falle cerrado, exactamente como ya ocurre hoy cuando falta cualquier variable requerida.
2. **Lado Hetzner:** detener el servicio (`systemctl stop`) hace que Caddy devuelva error de conexión; el cliente HTTP lo trata como error de transporte y cae al respaldo.

## 10. Observabilidad sin datos

Registrar únicamente:

- `correlation_id` por petición (generado en Hetzner, propagado en la respuesta).
- Código de resultado (`error.code` o éxito).
- Latencia de la llamada.
- Consumo de tokens (`input_tokens`, `output_tokens`) cuando la respuesta es exitosa.

Nunca registrar: contenido de `input`, `content` de la respuesta del modelo, encabezados de autenticación, el secreto HMAC, ni ningún dato de la sesión OAuth. Esto es una continuación directa del patrón ya presente en `agt002-preview-codex-client.js` (`child.stderr?.on?.('data', () => { /* provider detail is never surfaced to the caller */ })`) y en `agt002-preview-persistence.js` (nunca se persiste el prompt).

## 11. Configuración y secretos

Variables nuevas propuestas (nombres de diseño; su valor real y su carga en Vercel/Hetzner quedan fuera de este documento):

```text
# Lado Vercel
AGT002_HETZNER_BRIDGE_URL=https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run
AGT002_HETZNER_BRIDGE_HMAC_SECRET=[secreto, ≥32 bytes, fuera de banda]

# Lado Hetzner
AGT002_BRIDGE_HMAC_SECRET=[el mismo secreto compartido]
AGT002_BRIDGE_LISTEN_PORT=<puerto interno loopback>
AGT002_CODEX_APP_SERVER_BIN=codex
AGT002_CODEX_APP_SERVER_ARGS=["app-server"]
```

Variables ya existentes que se conservan sin cambio de significado, solo reconfiguradas para esta fase (`AGT002_PREVIEW_MAX_CONCURRENT=1`, `AGT002_PREVIEW_DAILY_MAX_RUNS=5`, `AGT002_PREVIEW_TIMEOUT_MS` sujeto a la verificación de la sección 16 riesgo Crítico 2, `TENDER_ANALYSIS_ENGINE=agt002_codex_preview`, `AGT002_PREVIEW_MODEL`, `AGT002_PREVIEW_POLICY_VERSION`).

Reglas de secretos:

- El secreto HMAC nunca se escribe en código fuente, fixtures, logs, evidencias ni se envía por canales de mensajería.
- La credencial de sesión OAuth de Codex vive únicamente en Hetzner, con permisos `0600`; nunca se copia a Vercel ni a control de versiones.
- Ambos entornos cargan sus variables mediante el mecanismo de configuración server-side ya usado por el resto del sistema (Vercel: variables de entorno de proyecto; Hetzner: archivo de entorno leído por `systemd`, no expuesto por HTTP).

## 12. Rollout por fases y gates humanos

| Fase | Contenido | Gate de salida (humano) |
|---|---|---|
| **0 — Congelamiento de contrato** | Resolver la discrepancia de `schema_version` (sección 16, riesgo Crítico 3) y confirmar el contrato HTTP de esta sección 6 como definitivo. | Juan aprueba el contrato congelado antes de que exista una sola línea de implementación. |
| **1 — Aprovisionamiento Hetzner** | Caddy con certificado público sobre `agt002.5-78-140-24.sslip.io`; usuario de servicio aislado; login humano de ChatGPT vía el flujo ya existente y separado (`requestAgt002CodexDeviceCodeLogin`, `agt002-preview-codex-client.js:251-337`, deliberadamente no invocado desde ningún camino automatizado). | Verificación manual de que `GET`/health del servicio responde y que la sesión OAuth quedó activa, sin exponer la credencial en ningún log. |
| **2 — Cliente HTTP en Vercel, apagado por defecto** | Se implementa `createAgt002HetznerBridgeClient` como drop-in; el kill switch permanece apagado; solo pruebas con el fixture sintético (sección 13) corren en CI. | Ningún request real sale hacia Hetzner todavía; revisión de código antes de encender el flag. |
| **3 — Activación controlada, solo datos sintéticos o extractos explícitamente minimizados** | Se enciende el puente en producción solo después de una auditoría mecánica que demuestre que el conjunto de perfiles elegibles para `AI_ANALYSIS_RUN` contiene exactamente a Katherine y Juan; toda ejecución usa datos sintéticos o extractos ya minimizados, nunca expedientes reales completos. | La auditoría RBAC no muestra terceros elegibles y cada ejecución se revisa manualmente contra los criterios de aceptación (sección 19) antes de considerar la fase cerrada. |
| **4 — Documentos reales (bloqueada por defecto)** | Extender el uso a documentos reales de licitaciones. | Requiere un gate posterior explícito de confidencialidad y residencia de datos, no descrito ni pre-aprobado por este documento; permanece bloqueada hasta que ese gate exista y se apruebe por separado. |

En ninguna fase el sistema toma ni sugiere una decisión GO/NO GO automática, ni firma, envía o presenta nada; la revisión humana obligatoria (`human_review_required: true`) se conserva sin excepción.

## 13. Pruebas requeridas

Ninguna de las siguientes pruebas se ha ejecutado; se listan como requisito de la implementación futura, no como resultado ya obtenido:

- **Contrato drop-in:** prueba que instancie el nuevo cliente HTTP y verifique que expone exactamente `run({model, policy, input, outputSchema, timeoutMs, idempotencyKey, signal, cwd})` y resuelve/rechaza con la misma forma que `createCodexAppServerClient`, de modo que `agt002-preview-engine.js` no requiera ningún cambio (equivalente en propósito a `tests/agt002-preview-codex-client.test.mjs` y a los fixtures ya existentes `tests/fixtures/agt002-codex-app-server-synthetic.mjs` y `tests/fixtures/agt002-synthetic-responder.mjs`, adaptados a un transporte HTTP en vez de `child_process`).
- **Autenticación HMAC:** casos de firma válida, firma inválida, cuerpo alterado tras firmar, timestamp fuera de ventana (`+31s`, `-31s`), nonce repetido, y ausencia de cada encabezado requerido — todos deben resultar en `401` sin invocar el subproceso.
- **Límites:** cuerpo mayor a 256 KiB → `413`; `Content-Type` distinto de `application/json` → `415`; método distinto de `POST` → `405`.
- **Concurrencia:** una segunda petición mientras la primera está en curso → `409` (`AGT002_BRIDGE_BUSY`), sin cola ni reintento.
- **Timeout y cancelación:** el servidor debe responder `504` exactamente cuando expira `timeoutMs`; el cierre de la conexión por el cliente debe disparar `turn/interrupt` y la terminación del subproceso, sin dejar procesos huérfanos.
- **Fail-closed de sesión OAuth:** simular ausencia de cuenta o cuenta de tipo distinto de `chatgpt` → `503`, sin exponer detalle de la cuenta.
- **No persistencia a disco:** verificar mediante instrumentación de pruebas (no en producción) que ningún payload ni respuesta se escribe fuera de memoria/proceso.
- **Paridad end-to-end en Vercel:** con el cliente HTTP apuntando a un servidor de pruebas sintético (no a Hetzner real), repetir los casos ya cubiertos por `tests/agt002-preview-engine.test.mjs`, `tests/agt002-preview-surface.test.mjs` y `tests/agt002-preview-claims-pglite.integration.test.mjs` para confirmar que el endpoint de `server/index.js` se comporta igual que hoy (incluido el respaldo a reglas).
- **Paridad de backends:** `scripts/check_backend_parity.mjs` debe seguir pasando sin cambios, dado que ni `server/index.js` ni `api/[...path].js` se modifican en este diseño.
- **Smoke manual gatillado por humano** (fuera de CI): una única ejecución real contra Hetzner con datos sintéticos, revisada por Juan o Katherine antes de cerrar la fase 3.

## 14. Rollback

- **Rollback automático por petición:** ya existe y no cambia — cualquier falla del puente cae al motor determinístico (`useRulesFallback`) sin intervención humana.
- **Rollback operativo del puente:** apagar el kill switch (sección 9.1) revierte instantáneamente a "no configurado", sin necesidad de revertir ningún despliegue de Vercel.
- **Rollback de infraestructura:** detener el servicio `systemd` en Hetzner; el servidor deja de responder y el puente queda inerte sin borrar la credencial OAuth (para permitir reactivación si fue un apagado temporal) ni el histórico ya persistido en Supabase (que nunca vivió en Hetzner).
- No existe estado en Supabase que dependa de Hetzner para ser consistente: las reservas de cupo (`psi_agt002_preview_claims`) tienen expiración propia (`lease_expires_at`) y se limpian solas si Hetzner desaparece a mitad de una ejecución.

## 15. Migración a AWS y decommission de Hetzner

- Mismo contrato HTTP y mismo contenedor/servicio que en Hetzner; solo cambia el destino de red.
- Nueva sesión OAuth de ChatGPT provisionada en AWS; **no se copia** la sesión de Hetzner (una credencial de sesión no debe migrar entre hosts).
- Cambiar `AGT002_HETZNER_BRIDGE_URL` (o su equivalente renombrado) al nuevo endpoint en AWS.
- Repetir el smoke manual gatillado por humano (sección 13) contra el nuevo destino antes de considerar la migración completa.
- Revocar explícitamente la sesión OAuth en Hetzner (no solo detener el servicio).
- Destruir el servicio temporal en Hetzner (detener y desaprovisionar), sin dejar el bridge corriendo en paralelo una vez confirmado el corte a AWS.
- Este plan de migración es obligatorio, no opcional, al cumplirse el límite de 30 días desde la activación del puente, independientemente de si hubo o no incidentes.

## 16. Riesgos

### Críticos

1. **Licenciamiento/ToS de la cuenta de ChatGPT y validación de cuenta no confirmados.** El uso de Codex/ChatGPT vía OAuth para este flujo institucional requiere validar cuenta, licenciamiento y términos de servicio, y completar un login humano real. Este documento no afirma que ya esté operativo. *Gate:* completar esa validación y el login humano antes de cualquier ejecución real (fase 1 de la sección 12).
2. **Timeout real de Vercel no verificado.** El repositorio no declara ningún `functions.maxDuration` en `vercel.json`; el límite efectivo depende del plan de Vercel en uso y no se ha confirmado en este diseño. Si el límite real es menor que el tiempo que puede tomar una llamada completa (red + cola en Hetzner + turno del modelo), la función de Vercel puede terminar la petición antes de que el puente responda, dejando un cupo reservado sin resultado hasta que expire su `lease_expires_at`. *Gate:* verificar el timeout real del plan de Vercel antes de activar. Si no alcanza, **no improvisar reintentos**: adoptar el patrón asíncrono (alternativa C, sección 4) o adelantar la migración a AWS, no ambas cosas a la vez sin decisión explícita.
3. **Discrepancia de `schema_version` sin resolver.** `agt002-tender-adapter.js:91` exige `value.schema_version !== '2.0-draft'` mientras que `agt002-preview-contract.js:1` y `agt002-preview-engine.js:78` producen `'2.0-preview.1'`. El propio plan `docs/superpowers/plans/2026-07-26-siio-commercial-24h-operational-cut.md:359` ya identificó que el adaptador debe actualizarse para aceptar exactamente `2.0-preview.1`, sin relajar identidad ni enum. *Gate:* esta reconciliación debe completarse antes de congelar el contrato de esta especificación como definitivo (fase 0, sección 12); mientras no se resuelva, cualquier consumidor que dependa de `agt002-tender-adapter.js` para validar un envelope AGT-002 puede rechazar el que hoy produce el motor implementado, o aceptar una versión que ya no es la vigente.
4. **El "temporal" no debe volverse permanente en silencio.** Un puente de un único host, sin alta disponibilidad, con vigencia de 30 días. El riesgo no es la falta de HA (mitigada por el respaldo determinístico automático de negocio), sino que el límite de 30 días se corra sin una decisión explícita. *Gate:* la fecha de vencimiento se trata como un hard stop, no como una fecha orientativa.

### Importantes

5. **Dependencia de `sslip.io`.** Es un servicio DNS de terceros temporal, no corporativo. Se documenta como riesgo aceptado explícitamente para esta fase; se resuelve al migrar a AWS con DNS propio (sección 15).
6. **Almacén de nonces en memoria.** Un reinicio del proceso Hetzner limpia el registro de nonces usados. El riesgo real es bajo porque cada petición también requiere una firma HMAC válida con un secreto que no se ve afectado por el reinicio; se documenta como riesgo aceptado, no como pendiente de mitigación adicional en esta fase.
7. **Confidencialidad y residencia de datos reales no resueltas.** Bloquea exclusivamente el uso de documentos reales (fase 4 de la sección 12); no bloquea la activación del puente con datos sintéticos o extractos ya minimizados.
8. **Sin allowlist de IP ni mTLS.** Riesgo aceptado explícitamente para esta fase (secciones 4 y 7.4–7.5); el disparador para revisarlo es una extensión del puente más allá de los 30 días.
9. **Concurrencia=1 sin cola.** Una segunda solicitud simultánea de un segundo usuario autorizado recibirá `409`/rechazo en vez de esperar en cola. Es una consecuencia directa y aceptada de la decisión de 1 concurrencia; debe comunicarse como expectativa de UX a Katherine y Juan, no tratarse como una falla del sistema.

## 17. Decisiones resueltas

- Enfoque A (puente delgado y síncrono) sobre las alternativas B–F de la sección 4.
- Endpoint temporal: `https://agt002.5-78-140-24.sslip.io`, con Caddy terminando TLS con certificado público.
- Autenticación por TLS + HMAC-SHA256 canónico (método, path, hash del body, timestamp, nonce), ventana ±30 s, nonce de un solo uso, comparación en tiempo constante, `Content-Type` estricto y cuerpo limitado.
- Sin allowlist de IP (Vercel no tiene egreso fijo) ni mTLS/Cloudflare en esta fase (YAGNI).
- Aislamiento operativo en Hetzner: Caddy público en 443, Node en loopback, usuario de servicio sin privilegios, límites de CPU/memoria, filesystem restringido, único estado persistente la credencial OAuth, payloads y respuestas nunca a disco, logs sanitizados.
- Concurrencia = 1; cuota diaria durable = 5 en Supabase; el runtime rechaza con `409` en vez de encolar; sin reintento automático de fetch ante timeout; `idempotencyKey` solo para correlación y rechazo de replay, sin prometer idempotencia de wire de Codex.
- Cualquier falla de TLS/HMAC/OAuth/timeout/esquema/runtime produce una excepción segura y respaldo automático al motor determinístico ya existente; kill switch por variable de entorno y por parada del servicio Hetzner, cualquiera de los dos suficiente.
- El piloto debe quedar limitado operativamente a Katherine y Juan mediante el RBAC existente, pero esa condición requiere auditoría mecánica previa porque `AI_ANALYSIS_RUN` es un gate por rol y no una allowlist nominal; nunca GO/NO GO automático, firma, envío o presentación automática.
- Fase 1 de activación: solo datos sintéticos o extractos ya minimizados; documentos reales requieren un gate posterior de confidencialidad/residencia no cubierto por este documento.
- Migración a AWS: mismo contrato/contenedor, nueva sesión OAuth (sin copiar la de Hetzner), cambio de URL, smoke manual, revocación de la sesión OAuth de Hetzner y destrucción del servicio temporal.

## 18. Decisiones pendientes (bloquean fases específicas, no todo el documento)

| Pendiente | Bloquea | Referencia |
|---|---|---|
| Reconciliar `schema_version` (`2.0-preview.1` vs `2.0-draft`) | Congelamiento del contrato (fase 0) | Sección 16, riesgo Crítico 3 |
| Verificar el timeout real del plan de Vercel en uso | Activación (fase 3) | Sección 16, riesgo Crítico 2 |
| Validar cuenta, licenciamiento/ToS de ChatGPT y completar login humano OAuth | Aprovisionamiento (fase 1) | Sección 16, riesgo Crítico 1 |
| Auditar perfiles elegibles para `AI_ANALYSIS_RUN` y confirmar que son exactamente Katherine y Juan | Activación (fase 3) | Sección 3.1 y sección 12, fase 3 |
| Definir y aprobar el gate de confidencialidad/residencia para documentos reales | Uso con documentos reales (fase 4) | Sección 12, fase 4 |

## 19. Criterios de aceptación verificables

Para este documento de diseño (verificable ahora, por inspección):

- El archivo existe en `docs/superpowers/specs/2026-07-27-agt002-hetzner-runtime-bridge-design.md`.
- No contiene código productivo, cambios de configuración real, comandos de despliegue ni credenciales.
- El seam descrito (sección 3.2) coincide exactamente con `agt002-preview-runtime.js:55-58` y con la firma real de `run(...)` en `agt002-preview-codex-client.js:54`.
- La discrepancia de `schema_version` está documentada con referencias de archivo y línea verificables (sección 3.3, sección 16 riesgo 3).
- Ningún riesgo Crítico queda sin gate explícito de resolución (sección 16, sección 18).
- El documento no afirma disponibilidad, despliegue, ejecución de pruebas reales ni resultados de pruebas no ejecutadas.

Para declarar cada fase de la sección 12 completa (verificable en su momento, no hoy):

- **Fase 0** cerrada cuando la reconciliación de `schema_version` está implementada y revisada, y el contrato de la sección 6 no tuvo cambios posteriores no aprobados por Juan.
- **Fase 1** cerrada cuando el servicio Hetzner responde correctamente a una verificación de salud autenticada y la sesión OAuth quedó activa, sin que ninguna credencial haya aparecido en un log.
- **Fase 2** cerrada cuando todas las pruebas de la sección 13 pasan contra un servidor sintético, con el kill switch de producción todavía apagado.
- **Fase 3** cerrada cuando una auditoría mecánica confirma que únicamente Katherine y Juan son elegibles para `AI_ANALYSIS_RUN`, al menos una ejecución real con datos sintéticos fue revisada manualmente por una de esas dos personas y el resultado se persistió correctamente como `AGT-002`/`agent_ai` en `psi_tender_analysis_runs`, con GO/NO GO permaneciendo una decisión humana separada.
- **Migración a AWS (sección 15)** cerrada cuando el smoke contra AWS pasó, la sesión OAuth de Hetzner fue revocada y el servicio temporal fue destruido, dentro de los 30 días de vigencia del puente.
