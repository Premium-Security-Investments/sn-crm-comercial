#!/usr/bin/env bash
# Prepara una release inmutable /opt/psi-comercial/releases/<sha> para los trabajos programados (radar, correo
# semanal, etc.), CON sus dependencias ya enlazadas. Reemplaza el paso manual de "enlazar node_modules a mano".
#
# Uso (como root, desde un checkout del repo):
#   sudo ops/release/build-release.sh <sha>
#
# Qué hace:
#   1. Exige que <sha> esté en origin/main (no se despliega nada sin fusionar).
#   2. Extrae ese commit (git archive) a una carpeta temporal.
#   3. Dependencias compartidas por lockfile: /opt/psi-comercial/node_modules-shared/<hash de package.json +
#      pnpm-lock.yaml>/node_modules. Si ya existe se reutiliza; si no, se instala una vez con
#      `pnpm install --frozen-lockfile`. La release enlaza ahí, no a otra release (borrar una release vieja ya no
#      rompe las demás).
#   4. Prueba de humo: carga @supabase/supabase-js desde la release.
#   5. Deja la release de solo lectura y la mueve a su lugar final. Si ya existía, sólo verifica.
#
# No toca unidades systemd ni drop-ins: eso sigue en el README de cada trabajo.
# RELEASES_ROOT y SHARED_ROOT se pueden cambiar para probar sin root.
set -euo pipefail

RELEASES_ROOT="${RELEASES_ROOT:-/opt/psi-comercial/releases}"
SHARED_ROOT="${SHARED_ROOT:-/opt/psi-comercial/node_modules-shared}"

die() { echo "ERROR: $*" >&2; exit 1; }

[ $# -eq 1 ] || die "uso: $0 <sha>"
REPO="$(git rev-parse --show-toplevel)" || die "ejecutar desde un checkout del repo"
git -C "$REPO" fetch -q origin main
SHA="$(git -C "$REPO" rev-parse --verify "$1^{commit}")" || die "commit desconocido: $1"
git -C "$REPO" merge-base --is-ancestor "$SHA" origin/main || die "$SHA no está en origin/main"

RELEASE="$RELEASES_ROOT/$SHA"

smoke() {
  (cd "$1" && node --input-type=module -e "await import('@supabase/supabase-js')") \
    || die "la release $1 no carga sus dependencias"
}

if [ -e "$RELEASE" ]; then
  echo "La release ya existe: $RELEASE"
  smoke "$RELEASE"
  echo "RELEASE_OK $RELEASE"
  exit 0
fi

mkdir -p "$RELEASES_ROOT" "$SHARED_ROOT"
STAGING="$(mktemp -d "$RELEASES_ROOT/.staging-$SHA.XXXXXX")"
trap 'chmod -R u+w "$STAGING" 2>/dev/null; rm -rf "$STAGING"' EXIT

git -C "$REPO" archive --format=tar "$SHA" | tar -x -C "$STAGING"

LOCK_HASH="$(cat "$STAGING/package.json" "$STAGING/pnpm-lock.yaml" | sha256sum | cut -c1-16)"
SHARED="$SHARED_ROOT/$LOCK_HASH"
if [ ! -d "$SHARED/node_modules" ]; then
  echo "Instalando dependencias nuevas ($LOCK_HASH)…"
  SHARED_STAGING="$(mktemp -d "$SHARED_ROOT/.staging-$LOCK_HASH.XXXXXX")"
  cp "$STAGING/package.json" "$STAGING/pnpm-lock.yaml" "$SHARED_STAGING/"
  (cd "$SHARED_STAGING" && pnpm install --frozen-lockfile) \
    || { rm -rf "$SHARED_STAGING"; die "falló pnpm install"; }
  mv "$SHARED_STAGING" "$SHARED"
  chmod 0755 "$SHARED"
else
  echo "Reutilizando dependencias $LOCK_HASH"
fi
ln -s "$SHARED/node_modules" "$STAGING/node_modules"

smoke "$STAGING"

chmod -R a-w "$STAGING"
chmod 0555 "$STAGING"
mv "$STAGING" "$RELEASE"
trap - EXIT
echo "RELEASE_OK $RELEASE (dependencias $LOCK_HASH)"
