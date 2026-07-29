# Scheduler externo de la Mesa Vig-IA (AGT-002)

Scheduler productivo continuo del Workbench. Ejecuta ciclos independientes cada minuto; systemd evita solapamiento del propio timer, mientras cada ciclo reclama y procesa el trabajo disponible. El kill switch de Vercel y `systemctl stop` se conservan exclusivamente para incidentes o mantenimiento.

## Archivos

- `run-agt002-workbench-worker.sh`: `POST` fail-closed, timeout 60 s y secreto dedicado.
- `agt002-workbench-scheduler.service`: unidad `oneshot` endurecida, sin solapamiento.
- `agt002-workbench-scheduler.timer`: siguiente ejecución 60 s después de finalizar la anterior; no recupera ejecuciones perdidas.
- `env.example`: nombres requeridos, sin valores reales.

## Instalación manual en el host autorizado

1. Crear usuario de sistema sin shell: `agt002-workbench-scheduler`.
2. Copiar el script a `/opt/agt002-workbench-scheduler/` con propietario `root:root`, modo `0755`.
3. Crear `/etc/agt002-workbench-scheduler/env` desde `env.example`, propietario `root:agt002-workbench-scheduler`, modo `0640`.
4. Copiar `.service` y `.timer` a `/etc/systemd/system/`.
5. Ejecutar `systemd-analyze verify` sobre ambas unidades.
6. Validar el servicio con `systemctl start agt002-workbench-scheduler.service` y revisar `journalctl -u agt002-workbench-scheduler.service`.
7. Activar producción continua: `systemctl enable --now agt002-workbench-scheduler.timer`.

## Kill switch y rollback operativo

1. Detener el timer: `systemctl disable --now agt002-workbench-scheduler.timer`.
2. En Vercel, establecer `AGT002_WORKBENCH_DRAIN_ENABLED=false` y redeploy. La ruta devuelve 404 y no toca DB/bridge.
3. Si es necesario cerrar también las rutas humanas, retirar `AGT002_WORKBENCH_RUNTIME` y redeploy.
4. No ejecutar el rollback SQL 046 si existen datos que dependan del índice/RPC; usar su guard fail-closed y verificar primero.

Nunca registrar ni pegar secretos en Git, PR, logs o documentación.
