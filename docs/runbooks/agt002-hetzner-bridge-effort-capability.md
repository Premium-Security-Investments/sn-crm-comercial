# AGT-002 — verificación de capacidad `effort` del bridge Hetzner antes de desplegar

**Contexto:** el fix de reasoning-effort (AGT-002) depende de que dos piezas desplegadas por separado
estén sincronizadas: el bridge Hetzner (`agt002-hetzner-bridge-server.js` + `agt002-preview-codex-client.js`)
y el binario `codex app-server` instalado en el host. Si cualquiera de las dos queda desactualizada,
`turn/start.params.effort` puede dejar de llegar al proveedor sin que nada lo note — el turno simplemente
hereda el default de la cuenta/CLI (`medium`), reintroduciendo el timeout que este fix cierra.

Tres mecanismos independientes cubren ese riesgo:

1. **En caliente, por cada request:** el cliente del bridge (`agt002-hetzner-bridge-client.js`) exige que
   la respuesta incluya `effort_ack` idéntico al `effort` solicitado. Un bridge o codex-client obsoleto
   que nunca aprendió sobre `effort` simplemente no emite ese campo, y el cliente falla cerrado con
   `AGT002_BRIDGE_STALE_EFFORT_ACK` en vez de aceptar el resultado silenciosamente.
2. **Al arrancar el servicio, automáticamente:** la unidad systemd (`agt002-bridge.service`) declara
   `ExecStartPre=/usr/bin/node /opt/agt002-bridge/ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs`.
   Si el binario `codex` instalado en el host no expone `effort`, `ExecStartPre` termina con exit
   distinto de cero y systemd **nunca ejecuta `ExecStart`** — el bridge no llega a escuchar tráfico
   con un binario incompatible, sin depender de que un operador recuerde este runbook.
3. **Antes de desplegar, manualmente (opcional, para verificar antes de reiniciar):** este procedimiento.

## Procedimiento

Después de instalar o actualizar el binario `codex` en el host del bridge Hetzner, y antes de reiniciar
el servicio (o para verificar por adelantado, ya que `ExecStartPre` de todas formas lo exigirá al
arrancar):

```bash
node ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs
```

- El script genera el esquema del protocolo con `codex app-server generate-json-schema --out <DIR>`
  (el binario real escribe el paquete de esquema en un directorio, no en stdout) usando un directorio
  temporal propio bajo el `TMPDIR` del sistema (creado con `mkdtemp`, nunca una ruta fija/compartida),
  inspecciona el paquete generado de forma determinista buscando `effort` en `v2 TurnStartParams`, y
  borra el directorio temporal al terminar — **nunca** un turno real, nunca
  `turn/start`/`thread/start`/`account/login`.
- Salida esperada en un binario compatible:
  `{"event":"agt002_bridge_capability","ok":true,"code":"AGT002_CODEX_EFFORT_CAPABILITY_OK"}`, exit 0.
- Si el binario instalado no expone `effort` en `v2 TurnStartParams` (o el esquema no pudo generarse),
  el script imprime `ok:false` con `AGT002_CODEX_EFFORT_CAPABILITY_MISSING` o
  `AGT002_CODEX_EFFORT_CAPABILITY_CHECK_FAILED` y termina con exit 1. **No continuar el despliegue** en
  ese caso: revertir al binario anterior o actualizar a una versión que exponga `effort` — y tener en
  cuenta que, aunque se omita este paso manual, `systemctl restart agt002-bridge` fallará igual por el
  `ExecStartPre` de la unidad.

## Archivos requeridos en `/opt/agt002-bridge` antes de reiniciar el servicio

`ExecStartPre` (mecanismo 2 arriba) hace que un despliegue incompleto falle **todo** el arranque del
servicio, no solo el gate de `effort`: si a `/opt/agt002-bridge` le falta cualquiera de estos archivos,
`node` no puede resolver el `import` correspondiente y `agt002-bridge.service` nunca llega a escuchar
tráfico. Antes de copiar artefactos y ejecutar `systemctl restart agt002-bridge`, confirmar que estos
archivos están presentes y actualizados en el host (rutas relativas a `/opt/agt002-bridge`):

- `agt002-codex-effort-capability.js` — módulo puro de detección de `effort` (nuevo).
- `ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs` — script que invoca `ExecStartPre` (nuevo).
- `agt002-hetzner-bridge-server.js` — servidor del bridge (modificado: el log de éxito ahora registra el
  `effort` de la solicitud validada, nunca `effort_ack`).
- `agt002-hetzner-bridge-auth.js` — autenticación HMAC de cada request (preexistente; importado
  directamente por `agt002-hetzner-bridge-server.js`).
- `agt002-hetzner-bridge-signing.js` — primitivas de firma/hash HMAC (preexistente; importado
  directamente por `agt002-hetzner-bridge-auth.js`).
- `agt002-hetzner-bridge-nonce-store.js` — ventana de timestamp y almacén de nonces (preexistente;
  importado directamente por `agt002-hetzner-bridge-server.js` y `agt002-hetzner-bridge-auth.js`).
- `agt002-hetzner-bridge-log.js` — sanitizador de logs (allowlist de `effort`).
- `agt002-preview-codex-client.js` — cliente del protocolo real de Codex App Server (emite `effort_ack`
  únicamente para validación del lado del llamador, nunca para logging).
- `agt002-preview-reasoning-effort.js` — módulo puro con la validación/valor por defecto de `effort`
  (nuevo; importado directamente por `agt002-hetzner-bridge-server.js`, `agt002-hetzner-bridge-log.js`
  y `agt002-preview-codex-client.js`).
- `ops/agt002-hetzner-bridge/run-server.mjs` — punto de entrada de `ExecStart`.
- `ops/agt002-hetzner-bridge/agt002-bridge.service` — unidad systemd con el `ExecStartPre` nuevo
  (reinstalar con `systemctl daemon-reload` tras copiarla, antes de `systemctl restart`).

`agt002-hetzner-bridge-client.js` (el cliente HTTP firmado que valida `effort_ack` contra el `effort`
solicitado) corre del lado del llamador (Vercel); no se copia a `/opt/agt002-bridge`.

## Qué nunca se registra

Igual que el resto de la telemetría del bridge (`docs/runbooks/agt002-observability-checklist.md` §4):
ningún prompt, documento, secreto, URL ni encabezado. La línea de telemetría de este script sólo contiene
`event`, `ok` y `code`.
