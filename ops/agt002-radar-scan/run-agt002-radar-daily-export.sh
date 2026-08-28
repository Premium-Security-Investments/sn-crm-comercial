#!/usr/bin/env bash
# AGT-002 Radar daily wrapper: export -> scan -> worker-kick, strictly serial, fail-closed on the
# first two stages. No secrets are read, sourced, or exported here; every unit's own systemd
# EnvironmentFile carries its credentials. See docs/superpowers/specs/2026-08-28-agt002-daily-scan-queue-design.md §6.3.
set -u -o pipefail

EXPORT_CMD="${AGT002_RADAR_EXPORT_CMD:-/root/.hermes/scripts/secop_psi_radar_export.sh}"

"$EXPORT_CMD"
export_exit=$?
if [ "$export_exit" -ne 0 ]; then
  printf '{"event":"agt002_radar_daily_wrapper","stage":"export","exit_code":%d,"sources_persisted":false}\n' "$export_exit"
  exit 10
fi

systemctl start agt002-radar-scan.service
scan_exit=$?
if [ "$scan_exit" -ne 0 ]; then
  printf '{"event":"agt002_radar_daily_wrapper","stage":"scan","exit_code":%d,"sources_persisted":true,"scan_completed":false}\n' "$scan_exit"
  exit 20
fi

systemctl start agt002-radar-pipeline.service
worker_exit=$?
if [ "$worker_exit" -ne 0 ]; then
  printf '{"event":"agt002_radar_daily_wrapper","stage":"worker_kick","level":"warning","exit_code":%d,"sources_persisted":true,"scan_completed":true,"timer_fallback":true}\n' "$worker_exit"
  exit 0
fi

printf '{"event":"agt002_radar_daily_wrapper","stage":"completed","exit_code":0,"sources_persisted":true,"scan_completed":true,"worker_kick_completed":true}\n'
exit 0
