# AGT-002 — bridge Hetzner: proveedor Claude Sonnet y verificación de `effort`

**Contexto:** el proceso Hetzner de AGT-002 dejó de invocar el App Server de Codex. Tras el corte,
`ops/agt002-hetzner-bridge/run-server.mjs` (el `ExecStart` de la unidad systemd) construye su cliente
del proveedor con `createAgt002ClaudeClient` (`agt002-claude-client.js`): un turno efímero y no
interactivo de Claude Code en modo impresión (`claude -p`), autenticado con la sesión OAuth propia del
servicio. El proceso Hetzner que hay que operar hoy es **Claude Sonnet**, no un App Server de Codex.

La unidad (`ops/agt002-hetzner-bridge/agt002-bridge.service`) ya no declara `ExecStartPre`: no hay
ningún gate de arranque automático que valide el binario del proveedor antes de `ExecStart`. Los
mecanismos vigentes son:

1. **En caliente, por cada request:** el cliente del bridge (`agt002-hetzner-bridge-client.js`) exige
   que la respuesta incluya `effort_ack` idéntico al `effort` solicitado. Si `effort` fue enviado y el
   bridge (o el cliente que hay detrás) nunca lo reconoce, el cliente falla cerrado con
   `AGT002_BRIDGE_STALE_EFFORT_ACK` en vez de aceptar el resultado silenciosamente.
2. **Al arrancar cada turno:** `agt002-hetzner-bridge-server.js` sigue validando `effort` contra el
   allowlist de `agt002-preview-reasoning-effort.js` (`low` | `medium`) antes de invocar al cliente del
   proveedor, y `agt002-claude-client.js` echoa `effort_ack` igual al `effort` recibido — **pero el CLI
   `claude -p` no tiene un parámetro de esfuerzo de razonamiento equivalente al de Codex y lo ignora
   `effort` por completo**: `effort_ack` confirma únicamente que el wire fue validado y reconocido, para
   que `agt002-hetzner-bridge-client.js` no lo rechace como obsoleto; no prueba, ni puede probar, que el
   modelo razonó con ese nivel. No hay override real que aplicar a `claude -p` en este proveedor.
3. **Antes de reiniciar el servicio, manualmente:** este procedimiento.

## Procedimiento — antes de reiniciar el servicio

Después de instalar o actualizar artefactos en `/opt/agt002-bridge`, y antes de
`systemctl restart agt002-bridge`, confirmar el contexto real en el que arrancará la unidad:

```bash
sudo -u agt002-bridge env HOME=/opt/agt002-bridge CLAUDE_CONFIG_DIR=/opt/agt002-bridge/.claude \
  ${AGT002_CLAUDE_CLI_BIN:+AGT002_CLAUDE_CLI_BIN="$AGT002_CLAUDE_CLI_BIN"} \
  "${AGT002_CLAUDE_CLI_BIN:-claude}" --version
```

Esto reproduce a propósito el contexto real de la unidad:

- `User=agt002-bridge` (y `Group=agt002-bridge`): el comando corre como el mismo usuario del servicio,
  nunca como el operador o root.
- `Environment=CLAUDE_CONFIG_DIR=/opt/agt002-bridge/.claude`: la sesión OAuth que `claude` va a leer es
  la misma que leerá el servicio, no la del operador.
- `Environment=HOME=/opt/agt002-bridge`: mismo `HOME` que la unidad declara (necesario porque `claude`
  también escribe bajo `$HOME` aunque `CLAUDE_CONFIG_DIR` esté fijado).
- El binario que se ejecuta es el mismo que resuelve `run-server.mjs` en producción: por `PATH` del
  servicio, o el que apunte `AGT002_CLAUDE_CLI_BIN` si la unidad lo fija (ver `env.example`).

Confirmar además, leyendo la unidad instalada (no una copia local):

- **No hay `ExecStartPre`** declarado — no hay ningún paso previo a `ExecStart` que la unidad ejecute
  automáticamente; el chequeo manual de arriba es, hoy, la única verificación previa a un reinicio.
- `ExecStart=/usr/bin/node /opt/agt002-bridge/ops/agt002-hetzner-bridge/run-server.mjs` importa
  `agt002-claude-client.js`, no un cliente de Codex.

Si el comando falla (binario ausente, `PATH`/`AGT002_CLAUDE_CLI_BIN` mal resuelto, o la sesión OAuth de
`/opt/agt002-bridge/.claude` faltante o caducada), **no reiniciar el servicio todavía**: resolver la
instalación del CLI o volver a autenticar la sesión OAuth de `agt002-bridge` primero. Ningún paso de
este procedimiento requiere ni imprime un secreto.

## Archivos requeridos en `/opt/agt002-bridge` antes de reiniciar el servicio

Sin `ExecStartPre`, un despliegue incompleto no falla en un gate dedicado: falla directamente en
`ExecStart`, porque `node` no puede resolver el `import` correspondiente y `agt002-bridge.service` nunca
llega a escuchar tráfico. Antes de copiar artefactos y ejecutar `systemctl restart agt002-bridge`,
confirmar que estos archivos están presentes y actualizados en el host (rutas relativas a
`/opt/agt002-bridge`):

- `ops/agt002-hetzner-bridge/run-server.mjs` — punto de entrada de `ExecStart`; importa directamente
  `agt002-bridge-host.js`, `agt002-hetzner-bridge-server.js` y `agt002-claude-client.js`.
- `agt002-bridge-host.js` — host/URL canónico del bridge.
- `agt002-hetzner-bridge-server.js` — servidor HTTP del bridge; valida el `effort` de la solicitud
  contra el allowlist antes de invocar al cliente del proveedor.
- `agt002-claude-client.js` — cliente propio de AGT-002 para Claude Code en modo impresión
  (`claude -p`); lee su sesión OAuth desde `CLAUDE_CONFIG_DIR` y echoa `effort_ack`.
- `agt002-hetzner-bridge-auth.js` — autenticación HMAC de cada request; importado directamente por
  `agt002-hetzner-bridge-server.js`.
- `agt002-hetzner-bridge-signing.js` — primitivas de firma/hash HMAC; importado directamente por
  `agt002-hetzner-bridge-auth.js`.
- `agt002-hetzner-bridge-nonce-store.js` — ventana de timestamp y almacén de nonces; importado
  directamente por `agt002-hetzner-bridge-server.js` y `agt002-hetzner-bridge-auth.js`.
- `agt002-hetzner-bridge-log.js` — sanitizador de logs (allowlist de `effort`).
- `agt002-preview-reasoning-effort.js` — módulo puro con la validación/valor por defecto de `effort`;
  importado directamente por `agt002-hetzner-bridge-server.js` y `agt002-hetzner-bridge-log.js`.
- `ops/agt002-hetzner-bridge/agt002-bridge.service` — unidad systemd (reinstalar con
  `systemctl daemon-reload` tras copiarla, antes de `systemctl restart`).

`agt002-hetzner-bridge-client.js` (el cliente HTTP firmado que valida `effort_ack` contra el `effort`
solicitado) corre del lado del llamador (Vercel); no se copia a `/opt/agt002-bridge`.

## Qué nunca se registra

Igual que el resto de la telemetría del bridge (`docs/runbooks/agt002-observability-checklist.md` §4):
ningún prompt, documento, secreto, URL ni encabezado. El log de éxito registra el `effort` de la
solicitud ya validada, nunca `effort_ack`.
