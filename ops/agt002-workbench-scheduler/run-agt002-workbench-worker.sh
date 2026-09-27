#!/usr/bin/env bash
# Revisar y aplicar manualmente en el host Hetzner existente. No aplicado ni ejecutado por este cambio.
# Ver docs/superpowers/plans para el diseño
# aprobado del scheduler externo de la Mesa Vig-IA (AGT-002 workbench).
#
# Dispara exactamente una invocación del endpoint acotado y protegido por
# secreto /api/tender-dossier-workbench/worker/run vía HTTP. No ejecuta lógica
# de negocio localmente, no depende de ningún artefacto del puente Hetzner de
# AGT-002 (ops/agt002-hetzner-bridge/, agt002-bridge.service, puerto 8787) y
# es independiente de ops/tender-worker-scheduler/ (secreto y endpoint propios).
set -euo pipefail

# --control-plane: reporte de identidad sin efectos secundarios, resuelto antes de exigir
# cualquier secreto o de tocar la red. Nunca confía en ninguna variable de entorno inyectada por
# el desplegador ni en ninguna otra afirmación de configuración: el único sha/version que puede
# reportar es el que se desprende de resolver (con realpath, siguiendo cualquier symlink) la
# ruta real de ESTE script, exigiendo que caiga -- byte a byte, nunca por prefijo/substring --
# dentro del árbol inmutable releases/<sha-hex-40>/. Ver agt002-control-plane-runtime-evidence.js
# para la misma regla aplicada a radar_pipeline/reanalysis_worker. Cualquier cosa que no calce
# (checkout de desarrollo, symlink que escapa del árbol, sha/version ausentes o mal formados)
# colapsa a null/"unobserved" en vez de intentar inferir o escapar nada.
if [ "${1:-}" = "--control-plane" ]; then
  releases_root='/opt/psi-comercial/releases'
  relative_path='ops/agt002-workbench-scheduler/run-agt002-workbench-worker.sh'
  sha_pattern='^[0-9a-f]{40}$'
  version_pattern='^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  observed_at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"

  sha=""
  version_json='null'

  script_realpath="$(realpath -- "$0" 2>/dev/null || true)"
  prefix="${releases_root}/"
  if [ -n "$script_realpath" ] && [ "${script_realpath#"$prefix"}" != "$script_realpath" ]; then
    rest="${script_realpath#"$prefix"}"
    candidate_sha="${rest%%/*}"
    if [[ "$candidate_sha" =~ $sha_pattern ]] && [ "$rest" = "${candidate_sha}/${relative_path}" ]; then
      sha="$candidate_sha"

      version_path="${releases_root}/${sha}/RELEASE_VERSION"
      version_realpath="$(realpath -- "$version_path" 2>/dev/null || true)"
      version_prefix="${releases_root}/${sha}/"
      if [ -n "$version_realpath" ] && [ -f "$version_realpath" ] \
        && [ "${version_realpath#"$version_prefix"}" != "$version_realpath" ]; then
        candidate_version="$(cat -- "$version_realpath" 2>/dev/null || true)"
        candidate_version="$(printf '%s' "$candidate_version" | tr -d '\n')"
        if [[ "$candidate_version" =~ $version_pattern ]]; then
          version_json="\"${candidate_version}\""
        fi
      fi
    fi
  fi

  if [ -n "$sha" ]; then
    printf '{"surface":"workbench_scheduler","sha":"%s","version":%s,"source":"workbench_scheduler_checkout_sha","observed_at_utc":"%s"}\n' \
      "$sha" "$version_json" "$observed_at"
  else
    printf '{"surface":"workbench_scheduler","sha":null,"version":null,"source":"unobserved","observed_at_utc":"%s"}\n' "$observed_at"
  fi
  exit 0
fi

: "${AGT002_WORKBENCH_WORKER_URL:?Falta AGT002_WORKBENCH_WORKER_URL en /etc/agt002-workbench-scheduler/env}"
: "${AGT002_WORKBENCH_WORKER_SECRET:?Falta AGT002_WORKBENCH_WORKER_SECRET en /etc/agt002-workbench-scheduler/env}"

# --fail-with-body: cualquier respuesta no-2xx es un fallo (fail-closed) y el
# cuerpo de error queda visible en journald para diagnóstico.
# --max-time 60: el endpoint hace como mucho un ciclo de barrido + una sola
# reclamación + una sola llamada al modelo; 60s acota generosamente ese trabajo
# sin dejar una petición indefinida. El timer usa OnUnitInactiveSec, por lo que
# no solapa una segunda ejecución mientras este servicio oneshot sigue activo.
exec curl \
  --silent \
  --show-error \
  --fail-with-body \
  --max-time 60 \
  --request POST \
  --header "x-agt002-workbench-secret: ${AGT002_WORKBENCH_WORKER_SECRET}" \
  --header 'Content-Length: 0' \
  "${AGT002_WORKBENCH_WORKER_URL}"
