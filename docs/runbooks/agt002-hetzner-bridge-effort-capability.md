# AGT-002 — verificación de capacidad `effort` del bridge Hetzner antes de desplegar

**Contexto:** el fix de reasoning-effort (AGT-002) depende de que dos piezas desplegadas por separado
estén sincronizadas: el bridge Hetzner (`agt002-hetzner-bridge-server.js` + `agt002-preview-codex-client.js`)
y el binario `codex app-server` instalado en el host. Si cualquiera de las dos queda desactualizada,
la anulación de esfuerzo puede dejar de llegar al proveedor sin que nada lo note — el turno simplemente
hereda el default de la cuenta/CLI (`medium`), reintroduciendo el timeout que este fix cierra.

**Corrección posterior a producción:** un turno cuyo `turn/start.params.effort` llevaba `'low'` fue
trazado internamente por el propio Codex como `codex.turn.reasoning_effort=medium`. Es decir,
`turn/start.params.effort` es aceptado/reflejado por el protocolo, pero **eso no prueba que el
subproceso realmente lo haya aplicado** al turno del modelo. La corrección real fija el esfuerzo de
razonamiento al **arrancar el proceso** de Codex, con la anulación global real de la CLI, antes del
subcomando `app-server`:

```
codex --strict-config -c 'model_reasoning_effort="low"' app-server
```

`--strict-config` hace que una clave de configuración no reconocida falle el arranque del proceso en
vez de ignorarla en silencio. `turn/start.params.effort` se mantiene además, como defensa en
profundidad, y `effort_ack` en la respuesta del cliente Codex reconoce que este cliente configuró
ambos mecanismos (argv del proceso y parámetros del turno) — **no** es una prueba de que el modelo
efectivamente razonó con ese nivel.

Cuatro mecanismos independientes cubren ese riesgo:

1. **En caliente, por cada request:** el cliente del bridge (`agt002-hetzner-bridge-client.js`) exige que
   la respuesta incluya `effort_ack` idéntico al `effort` solicitado. Un bridge o codex-client obsoleto
   que nunca aprendió sobre `effort` simplemente no emite ese campo, y el cliente falla cerrado con
   `AGT002_BRIDGE_STALE_EFFORT_ACK` en vez de aceptar el resultado silenciosamente. Como se explica
   arriba, este ack confirma configuración del lado del cliente, nunca aplicación real del lado del
   modelo.
2. **Al arrancar cada turno:** `agt002-preview-codex-client.js` arranca el subproceso `codex` con la
   anulación global `--strict-config -c 'model_reasoning_effort="<effort>"'` insertada justo antes del
   subcomando `app-server`, derivada únicamente de un `effort` ya validado contra el allowlist
   (`low` | `medium`) — nunca de un shell, siempre como elementos de un arreglo argv, sin superficie de
   inyección.
3. **Al arrancar el servicio, automáticamente:** la unidad systemd (`agt002-bridge.service`) declara
   `ExecStartPre=/usr/bin/node /opt/agt002-bridge/ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs`.
   Si el binario `codex` instalado en el host no expone `effort` en el protocolo, o no reconoce la
   anulación estricta `model_reasoning_effort`, `ExecStartPre` termina con exit distinto de cero y
   systemd **nunca ejecuta `ExecStart`** — el bridge no llega a escuchar tráfico con un binario
   incompatible, sin depender de que un operador recuerde este runbook.
4. **Antes de desplegar, manualmente (opcional, para verificar antes de reiniciar):** este procedimiento.

## Procedimiento

Después de instalar o actualizar el binario `codex` en el host del bridge Hetzner, y antes de reiniciar
el servicio (o para verificar por adelantado, ya que `ExecStartPre` de todas formas lo exigirá al
arrancar):

```bash
sudo -u agt002-bridge env CODEX_HOME=/opt/agt002-bridge/.codex \
  AGT002_CODEX_APP_SERVER_BIN=/opt/agt002-bridge/.local/node_modules/.bin/codex \
  /usr/bin/node /opt/agt002-bridge/ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs
```

Ese comando reproduce a propósito el contexto real del servicio: el usuario `agt002-bridge`
(`User=` de la unidad), el `CODEX_HOME=/opt/agt002-bridge/.codex` que la unidad declara con
`Environment=`, el binario de Codex realmente instalado para ese usuario y la ruta desplegada del
script. Ejecutarlo como el operador (o como root) con el `CODEX_HOME` propio verifica otra
instalación de Codex y otra sesión: puede pasar mientras `systemctl restart agt002-bridge` sigue
fallando por `ExecStartPre`, o al revés. No requiere ningún secreto. `ExecStartPre` sigue siendo la
verificación autoritativa — systemd le entrega además el `EnvironmentFile` de la unidad, que este
comando manual no necesita.

El script ejecuta dos verificaciones separadas, no facturables, y solo continúa si AMBAS pasan:

- **Verificación A — esquema del protocolo, sin `--strict-config`:**
  `codex app-server generate-json-schema --out <DIR>` (el binario real escribe el paquete de esquema en
  un directorio, no en stdout) usando un directorio temporal propio bajo el `TMPDIR` del sistema (creado
  con `mkdtemp`, nunca una ruta fija/compartida). El paquete generado se inspecciona de forma
  determinista para confirmar que el binario instalado expone `effort` en `v2 TurnStartParams`. El
  directorio temporal se borra al terminar. **Importante:** esta llamada NUNCA lleva `--strict-config` —
  el binario real de `codex` rechaza `--strict-config` de forma incondicional para
  `generate-json-schema` (`--strict-config is not supported for codex app-server generate-json-schema`,
  exit 1), sin importar si la clave de configuración en sí es válida, así que esta subcomando nunca
  puede usarse para validar la anulación `model_reasoning_effort`.
- **Verificación B — el proceso `app-server` real, con `--strict-config`:** arranca el proceso real y de
  larga duración `codex --strict-config -c 'model_reasoning_effort="low"' app-server` — la MISMA
  anulación global que arranca cada turno real (mecanismo 2 arriba) — y le envía ÚNICAMENTE la solicitud
  `initialize` del protocolo de App Server por stdin, exigiendo una respuesta JSON-RPC de `initialize`
  válida antes de terminar y limpiar el subproceso. Nunca envía `thread/start` ni `turn/start`, nunca
  genera nada del proveedor. Si el binario instalado no reconoce la anulación estricta
  `model_reasoning_effort`, el proceso falla al arrancar (o nunca responde a `initialize`) y esta
  verificación falla cerrado — igual que ante un error de spawn, una respuesta `initialize` mal formada
  o ausente, una salida que solo escribió en stderr, o un timeout acotado (5s). El subproceso se termina
  y se limpia siempre, sin dejar procesos ni listeners colgados.
- Ninguna de las dos verificaciones habla nunca el protocolo de turno en vivo:
  `turn/start`/`thread/start`/`account/login`/`item/completed`.
- Salida esperada en un binario compatible:
  `{"event":"agt002_bridge_capability","ok":true,"code":"AGT002_CODEX_EFFORT_CAPABILITY_OK"}`, exit 0.
- Si el binario instalado no expone `effort` en `v2 TurnStartParams`, no reconoce la anulación estricta
  `model_reasoning_effort` (verificación B), o el esquema no pudo generarse por cualquier otra razón, el
  script imprime `ok:false` con `AGT002_CODEX_EFFORT_CAPABILITY_MISSING` o
  `AGT002_CODEX_EFFORT_CAPABILITY_CHECK_FAILED` y termina con exit 1. **No continuar el despliegue** en
  ese caso: revertir al binario anterior o actualizar a una versión compatible — y tener en cuenta que,
  aunque se omita este paso manual, `systemctl restart agt002-bridge` fallará igual por el
  `ExecStartPre` de la unidad.

## Archivos requeridos en `/opt/agt002-bridge` antes de reiniciar el servicio

`ExecStartPre` (mecanismo 3 arriba) hace que un despliegue incompleto falle **todo** el arranque del
servicio, no solo el gate de `effort`: si a `/opt/agt002-bridge` le falta cualquiera de estos archivos,
`node` no puede resolver el `import` correspondiente y `agt002-bridge.service` nunca llega a escuchar
tráfico. Antes de copiar artefactos y ejecutar `systemctl restart agt002-bridge`, confirmar que estos
archivos están presentes y actualizados en el host (rutas relativas a `/opt/agt002-bridge`):

- `agt002-codex-effort-capability.js` — módulo puro de detección de `effort` en el protocolo.
- `ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs` — script que invoca `ExecStartPre`
  (modificado: ahora también valida que el binario reconozca la anulación estricta
  `model_reasoning_effort`; importa directamente `agt002-preview-reasoning-effort.js`).
- `agt002-hetzner-bridge-server.js` — servidor del bridge (el log de éxito registra el
  `effort` de la solicitud validada, nunca `effort_ack`).
- `agt002-hetzner-bridge-auth.js` — autenticación HMAC de cada request (preexistente; importado
  directamente por `agt002-hetzner-bridge-server.js`).
- `agt002-hetzner-bridge-signing.js` — primitivas de firma/hash HMAC (preexistente; importado
  directamente por `agt002-hetzner-bridge-auth.js`).
- `agt002-hetzner-bridge-nonce-store.js` — ventana de timestamp y almacén de nonces (preexistente;
  importado directamente por `agt002-hetzner-bridge-server.js` y `agt002-hetzner-bridge-auth.js`).
- `agt002-hetzner-bridge-log.js` — sanitizador de logs (allowlist de `effort`).
- `agt002-preview-codex-client.js` — cliente del protocolo real de Codex App Server (modificado: ahora
  también arranca cada subproceso `codex` con `--strict-config -c 'model_reasoning_effort="<effort>"'`
  antes del subcomando `app-server`; `effort_ack` en la respuesta reconoce esa configuración del lado
  del cliente, no que el modelo la haya aplicado).
- `agt002-preview-reasoning-effort.js` — módulo puro con la validación/valor por defecto de `effort`
  (importado directamente por `agt002-hetzner-bridge-server.js`, `agt002-hetzner-bridge-log.js`,
  `agt002-preview-codex-client.js` y `ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs`).
- `agt002-bridge-host.js` — host/URL canónico del bridge (preexistente; importado directamente por
  `ops/agt002-hetzner-bridge/run-server.mjs`, el punto de entrada de `ExecStart`: si falta, `node`
  no resuelve el import y el servicio no arranca aunque `ExecStartPre` haya pasado).
- `ops/agt002-hetzner-bridge/run-server.mjs` — punto de entrada de `ExecStart` (importa
  `agt002-bridge-host.js`, `agt002-hetzner-bridge-server.js` y `agt002-preview-codex-client.js`).
- `ops/agt002-hetzner-bridge/agt002-bridge.service` — unidad systemd con el `ExecStartPre` nuevo
  (reinstalar con `systemctl daemon-reload` tras copiarla, antes de `systemctl restart`).

`agt002-hetzner-bridge-client.js` (el cliente HTTP firmado que valida `effort_ack` contra el `effort`
solicitado) corre del lado del llamador (Vercel); no se copia a `/opt/agt002-bridge`.

## Qué nunca se registra

Igual que el resto de la telemetría del bridge (`docs/runbooks/agt002-observability-checklist.md` §4):
ningún prompt, documento, secreto, URL ni encabezado. La línea de telemetría de este script sólo contiene
`event`, `ok` y `code`.
