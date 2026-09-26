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
# cualquier secreto o de tocar la red. Nunca infiere el sha leyendo el checkout en disco: sólo
# usa AGT002_DEPLOYED_GIT_SHA/AGT002_DEPLOYED_VERSION si el desplegador los inyectó
# explícitamente por entorno; si no, la superficie queda honestamente "unobserved".
#
# Validación conservadora contra inyección de JSON: sólo un valor que calce por completo con
# [A-Za-z0-9._-]{1,100} llega al literal JSON. Cualquier otra cosa (vacío, comillas, backslash,
# saltos de línea, control chars) colapsa a null/"unobserved" en vez de intentar escaparse.
if [ "${1:-}" = "--control-plane" ]; then
  safe_token='^[A-Za-z0-9._-]{1,100}$'
  observed_at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  sha="${AGT002_DEPLOYED_GIT_SHA:-}"
  version="${AGT002_DEPLOYED_VERSION:-}"
  if [[ "$sha" =~ $safe_token ]]; then
    if [[ "$version" =~ $safe_token ]]; then
      version_json="\"${version}\""
    else
      version_json='null'
    fi
    printf '{"surface":"workbench_scheduler","sha":"%s","version":%s,"source":"workbench_scheduler_deployed_git_sha","observed_at_utc":"%s"}\n' \
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
