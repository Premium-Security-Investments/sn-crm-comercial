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
