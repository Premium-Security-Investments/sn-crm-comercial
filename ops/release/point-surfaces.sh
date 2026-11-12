#!/usr/bin/env bash
# Apunta unidades de systemd del servidor de tareas a una release ya construida, con respaldo y verificación.
#
# El código no corre desde el repositorio: corre desde copias inmutables bajo el raíz de releases, y cada unidad
# apunta a una por su drop-in `10-release.conf`. `build-release.sh` crea la copia; esto es el segundo paso, el que
# la pone en uso. Hasta aquí, fusionar no cambia lo que se ejecuta — el 2026-10-26 los cuatro arreglos de la noche
# estaban en `main` mientras los procesos de fondo seguían con código de semanas antes, cada uno en una release
# distinta (había seis versiones conviviendo).
#
# Uso (como root, desde un checkout del repo):
#   sudo ops/release/point-surfaces.sh <sha> <unidad> [unidad...]
#
# Qué hace, por unidad:
#   1. Exige que la release exista y que el drop-in exista.
#   2. Respalda el drop-in como 10-release.conf.bak-<sha viejo>-<fecha UTC>.
#   3. Reemplaza la ruta de la release vieja por la nueva, y las líneas de sha y versión desplegados si están.
#   4. Al final: daemon-reload y, por unidad, imprime a qué release quedó apuntando.
#
# NO reinicia nada. Un `oneshot` con timer toma el arranque nuevo en su próxima corrida; un servicio permanente
# —el puente— sigue con el código viejo hasta que alguien lo reinicie, y ese reinicio corta turnos en vuelo.
set -euo pipefail

RELEASES_ROOT="${RELEASES_ROOT:-/opt/psi-comercial/releases}"
UNITS_ROOT="${UNITS_ROOT:-/etc/systemd/system}"

die() { echo "ERROR: $*" >&2; exit 1; }

[ $# -ge 2 ] || die "uso: $0 <sha> <unidad> [unidad...]"
SHA="$1"; shift
[ ${#SHA} -eq 40 ] || die "el sha debe ser completo (40 caracteres): $SHA"
RELEASE="$RELEASES_ROOT/$SHA"
[ -d "$RELEASE" ] || die "la release no existe: $RELEASE (construirla primero con build-release.sh)"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
for unit in "$@"; do
  f="$UNITS_ROOT/${unit%.service}.service.d/10-release.conf"
  [ -f "$f" ] || die "sin drop-in de release: $f"
  old="$(grep -o 'releases/[a-f0-9]\{40\}' "$f" | head -1 | cut -d/ -f2)" || true
  [ -n "${old:-}" ] || die "no se pudo leer la release actual de $f"
  if [ "$old" = "$SHA" ]; then echo "${unit}: ya estaba en ${SHA:0:8}"; continue; fi
  cp -p "$f" "$f.bak-${old:0:8}-$STAMP"
  sed -i \
    -e "s|$old|$SHA|g" \
    -e "s|^Environment=AGT002_DEPLOYED_GIT_SHA=.*|Environment=AGT002_DEPLOYED_GIT_SHA=$SHA|" \
    -e "s|^Environment=AGT002_DEPLOYED_VERSION=.*|Environment=AGT002_DEPLOYED_VERSION=f0-${SHA:0:7}|" \
    "$f"
  echo "${unit}: ${old:0:8} -> ${SHA:0:8}  (respaldo $(basename "$f").bak-${old:0:8}-$STAMP)"
done

systemctl daemon-reload
echo "--- a qué release quedó cada unidad ---"
for unit in "$@"; do
  printf '%-44s %s\n' "$unit" "$(systemctl show "${unit%.service}.service" -p ExecStart | grep -o 'releases/[a-f0-9]\{8\}' | head -1)"
done
