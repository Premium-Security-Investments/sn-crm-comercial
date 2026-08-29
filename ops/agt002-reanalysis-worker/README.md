# Worker durable de reanálisis AGT-002

Estos archivos son artefactos locales de instalación manual. Este cambio **no instala, habilita ni ejecuta** unidades en Hetzner y no modifica secretos productivos.

## Contrato operativo

- El servicio ejecuta Node directamente dentro del checkout; nunca llama por HTTP a Vercel.
- Cada invocación reclama como máximo un solo job y termina. Un ciclo vacío no llama al modelo.
- El worker no reintenta automáticamente y no produce fallback por reglas.
- Un fallo cierra el job como `unavailable` y conserva el análisis canónico anterior.
- El timer agenda el siguiente ciclo después de finalizar el anterior, por lo que no solapa instancias del mismo servicio.
- Los logs sólo contienen eventos y códigos cerrados; nunca valores del `EnvironmentFile` ni mensajes crudos del proveedor.

## Presupuesto de tiempo por turno

- `AGT002_PREVIEW_TIMEOUT_MS` se lee **donde se encola** el job (el host de la aplicación), no en este `EnvironmentFile`: el worker reconstruye el motor desde la identidad congelada del job y sobrescribe esa variable.
- Una corrida V3 gasta **dos turnos secuenciales** del proveedor bajo un mismo claim, así que el lease requerido es `2 * ceil(timeout_ms / 1000) + 30` y el techo de la reserva es 600 s: el mayor timeout financiable es **285 000 ms**. Un valor mayor no se recorta —recortarlo reclamaría la corrida en pleno vuelo— sino que se rechaza antes de reservar nada.
- Un valor fuera de rango cierra la solicitud como estado de operador (`unavailable` / `not_configured`) con el código `AGT002_RUNTIME_CONFIG_INVALID` en el intento registrado; no es un despliegue sin configurar y no crea corrida.

## Esfuerzo de razonamiento por turno (AGT002_PREVIEW_REASONING_EFFORT)

- Igual que `AGT002_PREVIEW_TIMEOUT_MS`, este valor se congela en la identidad del job donde se encola, no en este `EnvironmentFile`: el worker reconstruye el motor desde `engine_identity.effort` y sobrescribe cualquier valor ambiental de este host.
- Por defecto es `low` — el nivel más rápido operacionalmente validado contra el presupuesto fijo de 285 000 ms por turno. La causa raíz del incidente de producción fue exactamente lo contrario: un turno heredó el esfuerzo de razonamiento por defecto de Codex (`medium`, nunca solicitado explícitamente) y su respuesta estructurada final llegó recién cerca del límite de 285 s, todavía en streaming cuando el turno fue terminado — `AGT002_TRANSPORT_ERROR`/timeout, sin corrida canónica.
- La lista blanca es cerrada: sólo `low` y `medium`. Un valor fuera de esa lista (incluido cualquier valor con mayúsculas distintas) cierra la solicitud como `AGT002_RUNTIME_CONFIG_INVALID`, igual que un `AGT002_PREVIEW_TIMEOUT_MS` fuera de rango.
- Un job encolado antes de que este campo existiera (`engine_identity` sin `effort`) sigue siendo válido: el worker lo reconstruye con el valor por defecto (`low`), nunca lo rechaza y nunca reescribe el registro histórico del job.

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
