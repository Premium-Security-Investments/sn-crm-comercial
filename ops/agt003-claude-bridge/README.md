# Puente dedicado AGT-003 (Claude Code + OAuth)

Artefactos declarativos del puente dedicado de AGT-003. **Este directorio no
instala, no aplica y no despliega nada por sí solo**: todo se revisa y se
ejecuta a mano en el servidor durante una ventana de operación aprobada.

El puente AGT-002 y sus artefactos no se tocan: AGT-003 corre como un servicio
distinto, con su propio usuario, su propio puerto, su propio vhost, su propio
espacio de nombres de cabeceras y su propia ruta.

## Piezas

| Artefacto | Destino en el servidor |
| --- | --- |
| `agt003-bridge.service` | `/etc/systemd/system/agt003-bridge.service` |
| `env.example` | plantilla de `/etc/agt003-bridge/agt003-bridge.env` (modo 0640) |
| `Caddyfile` | fragmento del vhost `agt003.5-78-140-24.sslip.io` |
| `run-server.mjs` | se ejecuta desde `/opt/agt003-bridge/ops/agt003-claude-bridge/run-server.mjs` |

## Topología

- El proceso escucha **sólo en loopback**, en `127.0.0.1:8788`.
- Caddy publica `https://agt003.5-78-140-24.sslip.io` y hace `reverse_proxy`
  hacia `127.0.0.1:8788`. El TLS es responsabilidad exclusiva de Caddy.
- La única ruta atendida es `POST /v1/agt003-copilot/run`. Cualquier otra ruta
  responde 404 aunque la firma sea válida.
- Cada petición se autentica con HMAC-SHA256 sobre el string canónico
  (`método`, `ruta`, `sha256(cuerpo)`, `timestamp`, `nonce`) y las cabeceras
  `X-AGT003-Timestamp`, `X-AGT003-Nonce`, `X-AGT003-Signature`. Ventana de
  ±30 s y nonce de un solo uso, de al menos 16 bytes.

## Autenticación con el proveedor: OAuth, nunca API key

El subproceso `claude` usa **su propia sesión OAuth de Claude Code**, guardada
en `CLAUDE_CONFIG_DIR=/opt/agt003-bridge/.claude` (fijado por la unidad, porque
`ProtectHome=true` haría ilegible cualquier credencial situada en `$HOME`).

El puente nunca posee, lee, reenvía ni registra credenciales. Al contrario: el
cliente **borra del entorno del subproceso** cualquier clave de API o
conmutador de proveedor alternativo que existiera en el host, de modo que un
turno sólo puede completarse con la sesión OAuth aprobada.

Si la sesión falta o caduca, el turno **falla cerrado** con
`AGT003_CLAUDE_LOGIN_REQUIRED` (HTTP 503). El puente **no inicia sesión
automáticamente**. La renovación es manual y humana:

```sh
sudo -u agt003-bridge \
  CLAUDE_CONFIG_DIR=/opt/agt003-bridge/.claude \
  claude /login
# Alternativa no interactiva equivalente, si la versión instalada la ofrece:
#   claude setup-token
sudo systemctl restart agt003-bridge
```

## Instalación manual (resumen)

1. Crear el usuario y grupo del sistema `agt003-bridge`, sin shell de acceso y
   con el **mismo home que fija la unidad**. Si el alta dejara el home por
   defecto (`/home/...`), `ProtectHome=true` lo volvería ilegible y el turno
   fallaría en el primer `spawn`:

   ```sh
   sudo useradd --system --home-dir /opt/agt003-bridge --shell /usr/sbin/nologin \
     --user-group agt003-bridge
   ```

2. Crear `/opt/agt003-bridge/.claude` y `/opt/agt003-bridge/var`, ambos
   propiedad de `agt003-bridge` (son los únicos `ReadWritePaths` de la unidad).
   La unidad exporta `HOME=/opt/agt003-bridge` porque `claude` y sus
   dependencias escriben en `$HOME` aunque `CLAUDE_CONFIG_DIR` esté fijado.
3. Desplegar el código en `/opt/agt003-bridge` (sólo lectura para el servicio,
   salvo los dos directorios anteriores).
4. Copiar `env.example` a `/etc/agt003-bridge/agt003-bridge.env`, rellenar
   `AGT003_BRIDGE_HMAC_SECRET` con un secreto de al menos 32 bytes y dejarlo en
   `root:agt003-bridge`, modo 0640.
5. Completar el login OAuth descrito arriba.
6. Instalar la unidad, `systemctl daemon-reload`, `enable --now agt003-bridge`.
7. Añadir el vhost del `Caddyfile` y recargar Caddy.

## Activación desde Vercel

El lado de Vercel ya soporta este puente. Para dirigir el tráfico hacia él:

```
AGT003_COPILOT_WIRE_PROTOCOL=agt003
AGT003_COPILOT_BRIDGE_URL=https://agt003.5-78-140-24.sslip.io/v1/agt003-copilot/run
AGT003_COPILOT_HMAC_SECRET=<el mismo secreto de AGT003_BRIDGE_HMAC_SECRET>
AGT003_COPILOT_MODEL=<modelo aprobado>
```

El secreto HMAC debe coincidir exactamente en ambos extremos; si no, todas las
peticiones se rechazan con 401 `AGT003_BRIDGE_AUTH_INVALID`.

## Techos operativos

Los tres se fijan en el `EnvironmentFile`, nunca en el código y nunca desde la
petición. Si falta la variable rige el valor por defecto; si está presente y es
inválida, el servicio **no arranca**.

| Variable | Por defecto | Efecto |
| --- | --- | --- |
| `AGT003_BRIDGE_MAX_CONCURRENCY` | `1` | Turnos del proveedor en vuelo a la vez. El que sobra recibe `429 AGT003_BRIDGE_BUSY` y **no** lanza ningún proceso. |
| `AGT003_BRIDGE_MAX_TIMEOUT_MS` | `120000` | Techo del `timeoutMs` de la petición. Por encima se rechaza con `400`, no se recorta en silencio. |
| `AGT003_BRIDGE_ALLOWED_MODELS` | `sonnet` | Lista separada por comas, de coincidencia exacta. Un modelo fuera de ella se rechaza con `400` antes de tocar el argv del proveedor. |

A estos se suman los techos de socket, que acotan lo que un cliente puede
retener del proceso **antes** de que exista un turno, para que nadie agote los
descriptores del puente abriendo conexiones ociosas. Se leen con el mismo parser
fail-closed: presentes pero inválidos, el servicio **no arranca**.

| Variable | Por defecto | Efecto |
| --- | --- | --- |
| `AGT003_BRIDGE_MAX_CONNECTIONS` | `16` | Conexiones simultáneas admitidas (`server.maxConnections`). |
| `AGT003_BRIDGE_HEADERS_TIMEOUT_MS` | `10000` | Plazo para recibir las cabeceras completas (`server.headersTimeout`). |
| `AGT003_BRIDGE_REQUEST_TIMEOUT_MS` | `15000` | Plazo para recibir la petición completa (`server.requestTimeout`). |

El slot de concurrencia se toma **después** de validar la firma y el cuerpo, de
modo que una petición no autenticada nunca pueda negarle el turno a un llamador
legítimo, y se devuelve cuando el turno termina, incluida la cancelación por
desconexión del cliente.

## Límites y registros

- Cuerpo entrante máximo: 1 MiB (`413 AGT003_BRIDGE_PAYLOAD_TOO_LARGE`). El
  vhost de Caddy corta el exceso en el borde con `request_body max_size 1MiB`,
  antes del `reverse_proxy`, para no transferir por el loopback un cuerpo que el
  puente rechazaría igualmente.
- `outputSchema` serializado máximo: 64 KiB
  (`413 AGT003_CLAUDE_SCHEMA_TOO_LARGE`). Se verifica **antes** del `spawn`,
  porque `--json-schema` viaja como un solo argumento y el kernel limita cada
  argumento de `execve` a 128 KiB (`E2BIG`).
- Salida máxima del proveedor: 256 KiB (`502 AGT003_CLAUDE_OUTPUT_TOO_LARGE`).
- Timeout por turno: lo fija la petición dentro del techo; al vencer se termina
  el subproceso.
- Todo rechazo emite exactamente un evento `agt003_bridge_error` con sólo
  `event`, `code` y `correlation_id`, el mismo que devuelve la respuesta.
- Los registros son JSON con lista blanca de campos: `correlation_id`, `code`,
  `latency_ms`, `input_tokens`, `output_tokens`, `received_bytes` y, cuando es
  un átomo seguro, `provider_error_code`. Ni la política, ni la entrada del
  CRM, ni la respuesta del modelo, ni el `stderr` del proveedor, ni el secreto
  HMAC llegan nunca a los registros ni al cuerpo de error devuelto al llamador.
