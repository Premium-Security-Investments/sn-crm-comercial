#!/usr/bin/env bash
# Red de seguridad semanal del acta de cierre (AGT-002). Igual que el scheduler de la
# Mesa: NO ejecuta lógica de negocio aquí ni conoce la configuración del modelo. Sólo
# dispara una invocación del endpoint protegido por secreto
# /api/tender-closure-acta/worker/run, y es el proceso web quien redacta.
#
# Lo normal es que el acta ya se haya escrito en el momento del cierre. Esto recoge
# sólo las que fallaron o se cerraron con la Mesa apagada.
set -euo pipefail

: "${AGT002_CLOSURE_ACTA_WORKER_URL:?Falta AGT002_CLOSURE_ACTA_WORKER_URL en el archivo de entorno}"
: "${AGT002_WORKBENCH_WORKER_SECRET:?Falta AGT002_WORKBENCH_WORKER_SECRET en el archivo de entorno}"

# --fail-with-body: cualquier respuesta no-2xx es un fallo y su cuerpo queda en journald.
# --max-time 300: el barrido puede redactar varias actas, cada una con su llamada al modelo.
exec curl \
  --silent \
  --show-error \
  --fail-with-body \
  --max-time 300 \
  --request POST \
  --header "x-agt002-workbench-secret: ${AGT002_WORKBENCH_WORKER_SECRET}" \
  --header 'Content-Length: 0' \
  "${AGT002_CLOSURE_ACTA_WORKER_URL}"
