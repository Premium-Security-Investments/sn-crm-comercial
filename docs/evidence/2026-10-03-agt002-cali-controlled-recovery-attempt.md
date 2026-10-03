# AGT-002 — intento controlado de recuperación individual de Cali

**Estado:** detenido en el primer fallo observado; no reintentar sin una nueva
disposición

**Fecha UTC:** 2026-10-03

**Corte final:** 2026-10-03T10:16:25.281895Z

**Proyecto Supabase:** `noxguard-control` (`tyfzjqzcpgwcjnxozaaf`)

**Host:** `funnelly-agent-1`

## 1. Alcance autorizado

Se autorizó recuperar exclusivamente el job de Cali, con una ventana máxima de
seis horas, timer apagado, reutilización de checkpoints y detención ante el
primer fallo. No se autorizó procesar otras oportunidades, crear otro job,
habilitar el timer ni continuar automáticamente después de un error.

- job: `ad4bb7c8-758d-4df8-b4a2-98d478211a3b`;
- opportunity: `5f65461c-f25a-45da-ba9f-82b59dd5d80d`;
- tender: `1d354467-e84c-4f40-9836-13ff1501535d`;
- workset: `7c48e93d-de1c-46c7-8657-d5035744845c`;
- release del worker: `7e404a137b70d4ed1d741399853df040f2950eb6`;
- release del bridge: `223a085be330f099863a876ed3ccfdb56efe51a9`.

## 2. Preflight

Antes del arranque se confirmó en vivo:

- Cali seguía `running`, `28/101`, `resume_count=0`, lease vencido y sin
  `analysis_run_id`;
- el workset seguía sin publicar y existían cero corridas para la oportunidad;
- persistían 53 checkpoints de descubrimiento, un manifiesto y 28 lotes
  integrales (`0–27`);
- Cali era el trabajo activo más antiguo, seguido por tres jobs `queued` más
  recientes;
- el worker instalado estaba detenido por timeout y sin PID;
- el timer estaba `disabled` e `inactive`;
- el bridge estaba `active/running`;
- el host tenía aproximadamente 12 GB libres y 2,6 GB de memoria disponible.

## 3. Ejecución acotada

El intento inicial de cambiar `TimeoutStartUSec` mediante
`systemctl set-property --runtime` fue rechazado por systemd como una propiedad
no modificable por esa interfaz. El comando terminó con código 1 y el servicio
instalado conservó su configuración; no arrancó ningún proceso.

Después se creó una unidad transitoria de un solo uso:
`agt002-cali-recovery-20261003.service`. La unidad replicó el mismo usuario,
grupo, `EnvironmentFile`, release, directorio de trabajo y restricciones del
worker instalado. Se configuró `TimeoutStartSec=6h`; el timer ordinario
permaneció apagado. `RuntimeMaxSec=6h` también fue solicitado, pero systemd lo
ignoró explícitamente por tratarse de una unidad `Type=oneshot`; el límite
efectivo de seis horas fue `TimeoutStartSec=6h`.

La unidad inició a `2026-10-03T10:05:57Z`. El claim durable seleccionó el job de
Cali, lo movió a un lease nuevo y dejó `resume_count=1`. El readback inmediato
confirmó la identidad exacta de Cali.

## 4. Fallo observado y detención

A `2026-10-03T10:06:00Z`, antes de que apareciera un nuevo checkpoint, el
journal emitió dos advertencias cerradas:

```text
agt002_post_bridge_attempt_write_failed
error_code=AGT002_ATTEMPT_UPDATE_FAILED
```

Conforme a la orden de detenerse ante el primer fallo, se ejecutó
`systemctl stop agt002-cali-recovery-20261003.service`. La unidad terminó por
`SIGTERM`, `status=15`, después de unos segundos de ejecución. Su consumo pico
fue 298,9 MB de memoria y no usó swap.

El readback posterior confirmó:

- proceso detenido, sin `MainPID`;
- timer todavía `disabled` e `inactive`;
- job aún `running`, `28/101`, `resume_count=1`, sin `analysis_run_id`;
- ningún checkpoint adicional: el último lote integral continúa siendo el 27;
- ningún reporte o publicación fue creado.

El journal del bridge no registró eventos durante la ventana
`10:05:50Z–10:07:00Z`. Junto con la ausencia de un checkpoint nuevo, esto indica
que no existe evidencia positiva de una llamada nueva al proveedor antes de la
detención; no se eleva esa ausencia de log a una garantía absoluta.

## 5. Diagnóstico del fallo

La causa probable tiene confianza alta y está respaldada por estado durable y
por la función viva:

1. `runAgt002PostBridgeAnalysis` intenta registrar siempre los eventos iniciales
   `queued` y `running` con la misma `attempt_key` del job.
2. El ledger de ese mismo intento ya tenía como último estado `running` desde la
   ejecución terminada por timeout el 2026-10-02.
3. `psi_append_agt002_analysis_attempt` no permite la transición
   `running -> queued` ni `running -> running`.
4. Por tanto, ambas escrituras best-effort fueron rechazadas y produjeron
   `AGT002_ATTEMPT_UPDATE_FAILED`.

El ledger histórico confirma tres aperturas con la misma identidad: dos
ciclos anteriores llegaron a `unavailable`, mientras el tercero quedó
`queued -> running` sin evento terminal por el timeout. La función viva confirmó
además que no contiene una transición `running -> queued`.

Este fallo pertenece al ledger de observabilidad y el código lo trata como
best-effort; no demuestra por sí mismo un fallo del proveedor o de los
checkpoints. Sin embargo, bajo el gate explícito de esta recuperación sí obliga
a detenerse y corregir o gobernar la semántica de reanudación antes de otro
intento.

Las pruebas focalizadas existentes de observabilidad post-bridge y del executor
se ejecutaron después del incidente: `2/2` archivos aprobados, exit 0. Verifican
el comportamiento implementado, pero no cubren la reapertura de un mismo
`attempt_key` cuyo último evento durable quedó `running`; por eso no contradicen
la brecha observada en producción.

## 6. Disposición

Estado de disposición: `RECOVERABLE_PAUSED` con una nueva brecha de
observabilidad de reanudación.

En el corte final, el lease ya estaba vencido, el job seguía `running` sin
proceso propietario, `resume_count=1` y progreso `28/101`. La clasificación
vuelve a ser `ORPHANED_RUNNING + TIMED_OUT_CHECKPOINTED`; no es una ejecución
activa ni un canario aprobado. Permanecían cero corridas, el workset seguía sin
publicar y ambos servicios de worker estaban sin PID. El timer seguía
`disabled` e `inactive`.

No reintentar automáticamente. Antes de otra ejecución se requiere:

1. definir y probar una transición durable de reanudación para el ledger de
   intentos, o autorizar explícitamente que estas advertencias best-effort no
   constituyan el gate de parada;
2. conservar el mismo job y checkpoints;
3. volver a verificar lease vencido, prioridad de Cali, ausencia de proceso,
   workset sin publicar y cero corridas;
4. mantener el timer apagado y un límite efectivo de seis horas;
5. emitir una nueva autorización de ejecución después de revisar la corrección
   o excepción propuesta.

## 7. Evidencia

- job preflight: Composio log `log_bm_FUp4HHQYX`;
- workset preflight: `log_fxa3BKVlLkJq`;
- checkpoints preflight: `log_yrVZueGTfCW1`;
- cero corridas: `log_6zNVcsCepsIg`;
- cola activa y orden de claim: `log_EPYdTaVxLoDk`;
- claim de Cali: `log_oufdsKe2wGzA`;
- readback después de detener: `log_AWycj87ITPKs`;
- checkpoints después de detener: `log_TjvvM61QTjHV`;
- ledger histórico del intento: `log_GQr2Y8TJbPdI`;
- definición viva de la función: `log_I-ht3YzhEOzI`;
- corte final del job con lease vencido: `log_ClqzTGdYSmtp`;
- corte final de corrida/publicación: `log_liLd_WfQ2ubg`;
- `systemctl show/cat`, `systemd-run` y journal del host.

No se aplicó migración, no se desplegó código, no se habilitó timer, no se creó
otro job y no se procesó ninguna otra oportunidad.
