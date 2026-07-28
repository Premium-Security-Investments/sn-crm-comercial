#!/usr/bin/env bash
# Revisar y aplicar manualmente en el host Hetzner existente. No aplicado ni
# ejecutado por este cambio. Ver docs/superpowers/plans para el diseño
# aprobado del scheduler externo del worker de licitaciones.
#
# Dispara exactamente una invocación del endpoint durable
# /api/tender-processing-worker-run vía HTTP. No ejecuta lógica de negocio
# localmente y no depende de ningún artefacto de AGT-002
# (ops/agt002-hetzner-bridge/, agt002-bridge.service, puerto 8787).
set -euo pipefail

: "${TENDER_WORKER_URL:?Falta TENDER_WORKER_URL en /etc/tender-worker-scheduler/env}"
: "${TENDER_WORKER_SECRET:?Falta TENDER_WORKER_SECRET en /etc/tender-worker-scheduler/env}"

# --fail-with-body: cualquier respuesta no-2xx es un fallo (fail-closed) y el
# cuerpo de error queda visible en journald para diagnóstico.
# --max-time 20: nunca deja un proceso colgado más allá del ciclo de un
# minuto del timer, evitando solapamiento con la siguiente ejecución.
exec curl \
  --silent \
  --show-error \
  --fail-with-body \
  --max-time 20 \
  --request POST \
  --header "x-tender-worker-secret: ${TENDER_WORKER_SECRET}" \
  --header 'Content-Length: 0' \
  "${TENDER_WORKER_URL}"
