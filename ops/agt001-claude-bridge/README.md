# Puente dedicado AGT-001 (Vig-IA Gerencia)

Lo usa la capacidad `agt001.executive-recommendations` (recomendaciones de la Torre de Control, `siio-recommendations.js`).

Es **el mismo código** del puente AGT-003 (`ops/agt003-claude-bridge/run-server.mjs` y sus módulos), corriendo como
una instancia aparte para que Gerencia tenga identidad propia:

| | AGT-003 | AGT-001 |
| --- | --- | --- |
| Usuario del sistema | `agt003-bridge` | `agt001-bridge` |
| Puerto loopback | 8788 | 8789 |
| Vhost | `agt003.5-78-140-24.sslip.io` | `agt001.5-78-140-24.sslip.io` |
| Secreto HMAC | `/etc/agt003-bridge/agt003-bridge.env` | `/etc/agt001-bridge/agt001-bridge.env` |
| Sesión OAuth de Claude | `/opt/agt003-bridge/.claude` | `/opt/agt001-bridge/.claude` |

La ruta (`/v1/agt003-copilot/run`) y las cabeceras firmadas (`X-AGT003-*`) son las del código compartido.

## Instalación

Todo lo que no es humano lo hace `sh ops/agt001-claude-bridge/install-on-host.sh` (root, idempotente, no imprime
secretos): pasos 1, 2, 3, 5 y 6, el timer de los lunes (`ops/agt001-recommendations-weekly/`) y las variables de
Vercel producción `AGT001_BRIDGE_URL`, `AGT001_BRIDGE_HMAC_SECRET`, `AGT001_MODEL` y `AGT001_WEEKLY_SECRET`.
El paso 4 (login) lo hace una persona.

1. `useradd --system --home-dir /opt/agt001-bridge --shell /usr/sbin/nologin --user-group agt001-bridge`
2. Copiar a `/opt/agt001-bridge` (dueño root, sólo lectura): `agt003-claude-bridge-*.js`, `agt003-claude-client.js`
   y `ops/agt003-claude-bridge/run-server.mjs`. Crear `/opt/agt001-bridge/.claude` y `/opt/agt001-bridge/var`
   (dueño `agt001-bridge`, 0700).
3. `/etc/agt001-bridge/agt001-bridge.env` desde `env.example` con un secreto de 48 bytes aleatorios
   (`root:agt001-bridge`, 0640). El mismo secreto va en Vercel como `AGT001_BRIDGE_HMAC_SECRET`; la URL
   `https://agt001.5-78-140-24.sslip.io/v1/agt003-copilot/run` como `AGT001_BRIDGE_URL`.
4. Login OAuth de Claude (humano, una vez; el puente nunca inicia sesión solo):

   ```sh
   sudo -u agt001-bridge HOME=/opt/agt001-bridge CLAUDE_CONFIG_DIR=/opt/agt001-bridge/.claude /usr/bin/claude setup-token
   ```

5. Unidad en `/etc/systemd/system/agt001-bridge.service`, `systemctl enable --now agt001-bridge`.
6. Vhost del `Caddyfile` en `/etc/caddy/Caddyfile` y `systemctl reload caddy`.

Sin sesión, cada turno falla cerrado con `AGT003_CLAUDE_LOGIN_REQUIRED` y la Torre muestra
"La sesión de Claude de Vig-IA Gerencia venció".
