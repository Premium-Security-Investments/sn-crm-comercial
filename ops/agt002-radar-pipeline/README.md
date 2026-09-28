# AGT-002 Radar pipeline (`ops/agt002-radar-pipeline/`) — RETIRED

> **[Retirado, issue #247]** El pipeline de preanálisis de IA que vivía en este directorio está
> **RETIRED**. Este README es sólo el tombstone local de esos artefactos. El runbook operacional
> vigente del Radar es `docs/runbooks/agt002-radar-pipeline.md`: el Radar de licitaciones activo hoy
> es el **scan determinístico** (`ops/agt002-radar-scan/`), no lo que documenta este archivo.

## Qué hace hoy `run-agt002-radar-pipeline.mjs`

- Cualquier invocación normal (sin `--control-plane`) imprime exactamente
  `{"status":"retired","code":"AGT002_RADAR_AI_RETIRED"}` y termina. No reclama job de cola, no
  llama al puente ni a ningún modelo, no crea cliente de Supabase y no lee ningún secreto ni
  variable de entorno.
- `--control-plane` es la única bandera soportada: un reporte de identidad (sha/versión) sin efecto
  secundario, gateado antes de cualquier requisito de secreto.

## `.service` / `.timer`: tombstone inerte

`agt002-radar-pipeline.service` y `agt002-radar-pipeline.timer` se conservan como tombstone
inerte, no como unidades desplegables:

- `RefuseManualStart=true` en ambos.
- El `.timer` está gateado por `ConditionPathExists=/run/agt002-radar-ai-retired-do-not-create`
  (una ruta que nunca debe crearse) y no tiene sección `[Install]`: no puede habilitarse al boot.
- Ninguno declara `EnvironmentFile` ni variable de secreto/configuración.

**No instalar, no habilitar y no activar** estas unidades ni ejecutar `systemctl` sobre ellas.

## Qué ya no existe en este árbol

Este entrypoint no acepta flags, no configura ni referencia ningún modelo, no habla con el puente
(`AGT002_HETZNER_BRIDGE_*`) y no crea ningún cliente de Supabase. `env.example` en este directorio
no declara ninguna variable: ver ese archivo.

## Qué se preserva sin cambios

El ledger de gate/preanálisis y las migraciones `071`/`072` son historia y permanecen en el árbol
sin purgar ni reescribir; siguen siendo legibles por la auditoría histórica de sólo lectura descrita
en `docs/runbooks/agt002-radar-pipeline.md`.

## Reactivación

Reactivar cualquier pieza de este pipeline no es un cambio de configuración: requiere un spec y un
plan nuevos con aprobación humana explícita. Este README no autoriza ese camino.
