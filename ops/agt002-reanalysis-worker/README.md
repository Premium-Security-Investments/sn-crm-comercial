# Worker durable de reanálisis AGT-002

Estos archivos son artefactos locales de instalación manual. Este cambio **no instala, habilita ni ejecuta** unidades en Hetzner y no modifica secretos productivos.

## Contrato operativo

- El servicio ejecuta Node directamente dentro del checkout; nunca llama por HTTP a Vercel.
- Cada invocación reclama como máximo un solo job y termina. Un ciclo vacío no llama al modelo.
- El worker no reintenta automáticamente y no produce fallback por reglas.
- Un fallo cierra el job como `unavailable` y conserva el análisis canónico anterior.
- El timer agenda el siguiente ciclo después de finalizar el anterior, por lo que no solapa instancias del mismo servicio.
- Los logs sólo contienen eventos y códigos cerrados; nunca valores del `EnvironmentFile` ni mensajes crudos del proveedor.

## Instalación manual en un host autorizado

1. Validar primero migración, código, build y gate humano de producción.
2. Crear el usuario/grupo de sistema sin shell `psi-agt002`.
3. Instalar el checkout validado en `/opt/psi-comercial/app`; el usuario sólo necesita lectura/ejecución.
4. Crear `/etc/psi-agt002-reanalysis/env` desde `env.example`, propietario `root:psi-agt002`, modo `0640`, sin registrar sus valores.
5. Copiar `.service` y `.timer` a `/etc/systemd/system/`.
6. Ejecutar `systemd-analyze verify` sobre ambas unidades.
7. Ejecutar un ciclo controlado con `systemctl start agt002-reanalysis-worker.service` y revisar sólo eventos seguros en `journalctl`.
8. Con autorización separada, habilitar el timer con `systemctl enable --now agt002-reanalysis-worker.timer`.

## Kill switch

1. `systemctl disable --now agt002-reanalysis-worker.timer`.
2. Permitir que un `oneshot` activo termine o detenerlo de forma controlada. Si se interrumpe y vence el lease, el siguiente claim lo cierra como `lease_lost`; nunca lo reencola.
3. No ejecutar el rollback SQL mientras exista cualquier historial de jobs; el rollback falla cerradamente.

La cadencia del timer no es un retry del modelo: sólo consulta la cola. Un resultado terminal nunca vuelve a `queued`.
