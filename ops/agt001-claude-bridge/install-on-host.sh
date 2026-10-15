#!/bin/sh
# Instala en el servidor de puentes (Hetzner) lo que necesitan las recomendaciones de Vig-IA Gerencia (AGT-001):
#   1. el puente dedicado agt001-bridge (mismo código del puente AGT-003, instancia, usuario y sesión propios);
#   2. el vhost de Caddy agt001.5-78-140-24.sslip.io;
#   3. el timer de los lunes (agt001-recommendations-weekly);
#   4. las variables de Vercel producción: AGT001_BRIDGE_URL, AGT001_BRIDGE_HMAC_SECRET, AGT001_MODEL y
#      AGT001_WEEKLY_SECRET.
# Idempotente: no regenera secretos que ya existen. Nunca imprime secretos.
# Lo ejecuta una persona como root desde la raíz del repositorio:
#   sh ops/agt001-claude-bridge/install-on-host.sh
# El login de Claude (paso humano) queda fuera: ver README.md.
set -eu

REPO=$(cd "$(dirname "$0")/../.." && pwd)
ENV_FILE=/etc/agt001-bridge/agt001-bridge.env
WEEKLY_ENV=/etc/agt001-recommendations-weekly/env
BRIDGE_URL=https://agt001.5-78-140-24.sslip.io/v1/agt003-copilot/run
VERCEL_PROJECT=seguridad-nacional-crm
VERCEL_SCOPE=psi-llc-projects

random_secret() { head -c 48 /dev/urandom | base64 | tr -d '\n/+='; }
env_value() { sed -n "s/^$2=//p" "$1" | head -n 1; }

echo "1/5 Usuario y código del puente"
id agt001-bridge >/dev/null 2>&1 || useradd --system --home-dir /opt/agt001-bridge --shell /usr/sbin/nologin --user-group agt001-bridge
install -d -o root -g root -m 0755 /opt/agt001-bridge /opt/agt001-bridge/ops/agt003-claude-bridge
for file in agt003-claude-bridge-auth.js agt003-claude-bridge-host.js agt003-claude-bridge-log.js agt003-claude-bridge-nonce-store.js \
  agt003-claude-bridge-server.js agt003-claude-bridge-signing.js agt003-claude-client.js; do
  install -o root -g root -m 0644 "$REPO/$file" "/opt/agt001-bridge/$file"
done
install -o root -g root -m 0644 "$REPO/ops/agt003-claude-bridge/run-server.mjs" /opt/agt001-bridge/ops/agt003-claude-bridge/run-server.mjs
install -d -o agt001-bridge -g agt001-bridge -m 0700 /opt/agt001-bridge/.claude /opt/agt001-bridge/var

echo "2/5 Configuración y secreto HMAC del puente"
install -d -o root -g agt001-bridge -m 0750 /etc/agt001-bridge
if [ ! -s "$ENV_FILE" ]; then
  umask 027
  secret=$(random_secret)
  grep -v '^#' "$REPO/ops/agt001-claude-bridge/env.example" | sed "s|^AGT003_BRIDGE_HMAC_SECRET=.*|AGT003_BRIDGE_HMAC_SECRET=$secret|" > "$ENV_FILE"
  unset secret
fi
chown root:agt001-bridge "$ENV_FILE"
chmod 0640 "$ENV_FILE"

echo "3/5 Servicio systemd y vhost de Caddy"
install -o root -g root -m 0644 "$REPO/ops/agt001-claude-bridge/agt001-bridge.service" /etc/systemd/system/agt001-bridge.service
if ! grep -q 'agt001.5-78-140-24.sslip.io' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-agt001-$(date -u +%Y%m%dT%H%M%SZ)"
  { echo; cat "$REPO/ops/agt001-claude-bridge/Caddyfile"; } >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl daemon-reload
systemctl enable --now agt001-bridge
systemctl reload caddy

echo "4/5 Timer de los lunes"
install -d -o root -g root -m 0700 /etc/agt001-recommendations-weekly
if [ ! -s "$WEEKLY_ENV" ]; then
  umask 077
  weekly=$(random_secret)
  printf 'AGT001_WEEKLY_URL=https://seguridad-nacional-crm.vercel.app/api/siio/recommendations/weekly\nAGT001_WEEKLY_SECRET=%s\n' "$weekly" > "$WEEKLY_ENV"
  unset weekly
fi
chmod 0600 "$WEEKLY_ENV"
install -o root -g root -m 0644 "$REPO/ops/agt001-recommendations-weekly/agt001-recommendations-weekly.service" /etc/systemd/system/
install -o root -g root -m 0644 "$REPO/ops/agt001-recommendations-weekly/agt001-recommendations-weekly.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now agt001-recommendations-weekly.timer

echo "5/5 Variables de Vercel producción"
link_dir=$(mktemp -d)
(
  cd "$link_dir"
  vercel link --yes --project "$VERCEL_PROJECT" --scope "$VERCEL_SCOPE" >/dev/null 2>&1
  set_var() {
    vercel env rm "$1" production --yes >/dev/null 2>&1 || true
    printf '%s' "$2" | vercel env add "$1" production >/dev/null 2>&1
    echo "   $1 configurada"
  }
  set_var AGT001_BRIDGE_URL "$BRIDGE_URL"
  set_var AGT001_MODEL sonnet
  set_var AGT001_BRIDGE_HMAC_SECRET "$(env_value "$ENV_FILE" AGT003_BRIDGE_HMAC_SECRET)"
  set_var AGT001_WEEKLY_SECRET "$(env_value "$WEEKLY_ENV" AGT001_WEEKLY_SECRET)"
)
rm -rf "$link_dir"

echo
systemctl is-active agt001-bridge
systemctl list-timers agt001-recommendations-weekly.timer --no-pager | sed -n 2p
echo "Listo. Falta el login de Claude del puente (README.md) y un nuevo despliegue de Vercel para que tome las variables."
