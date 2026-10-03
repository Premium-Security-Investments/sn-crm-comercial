# AGT-002 — diagnóstico read-only y disposición de recuperación de Cali

**Estado:** diagnóstico confirmado; recuperación definida, no ejecutada

**Clasificación:** `ORPHANED_RUNNING` + `TIMED_OUT_CHECKPOINTED`

**Corte de base de datos:** 2026-10-03T02:27:10.120422Z

**Corte del host:** 2026-10-03T02:33:39.704Z

**Proyecto Supabase:** `noxguard-control` (`tyfzjqzcpgwcjnxozaaf`)

**Host:** `funnelly-agent-1`

## 1. Identidad

- job: `ad4bb7c8-758d-4df8-b4a2-98d478211a3b`;
- opportunity: `5f65461c-f25a-45da-ba9f-82b59dd5d80d`;
- tender: `1d354467-e84c-4f40-9836-13ff1501535d`;
- workset: `7c48e93d-de1c-46c7-8657-d5035744845c`;
- snapshot: `b2f680d2-26f2-40ca-9549-f4545980ca51`;
- worker release: `7e404a137b70d4ed1d741399853df040f2950eb6`;
- bridge release: `223a085be330f099863a876ed3ccfdb56efe51a9`.

La inspección fue read-only. No se reclamó, reencoló, renovó, pausó, falló o
completó ningún job; no se reinició un servicio y no se habilitó el timer.

## 2. Estado durable confirmado

La lectura viva de Supabase confirmó:

- `status=running`;
- `execution_mode=durable_batched_v1`;
- `phase=integral_analysis`;
- progreso `28/101`;
- `resume_count=0`;
- último update `2026-10-02T21:53:56.500689Z`;
- lease `73fab38f-3289-4402-b31e-817a6b8896d4`, vencido desde
  `2026-10-02T22:03:56.500689Z`;
- `analysis_run_id=null`, `completed_at=null`, `error_code=null`;
- workset `published=false`, `published_analysis_run_id=null`;
- cero filas en `psi_tender_analysis_runs` para la oportunidad.

Checkpoints conservados:

| Etapa | Cantidad | Índices | Último checkpoint |
| --- | ---: | --- | --- |
| `semantic_discovery_batch` | 53 | 0–52 | 2026-10-01T13:25:59.027704Z |
| `semantic_manifest` | 1 | 0 | 2026-10-01T13:26:03.203076Z |
| `integral_analysis_batch` | 28 | 0–27 | 2026-10-02T21:53:54.058398Z |

Los 54 artefactos de descubrimiento reportados corresponden a 53 lotes más un
manifiesto. Los 28 checkpoints integrales tienen 28 índices, request hashes y
provider idempotency keys distintos; no se observó duplicación durable.

## 3. Estado del host confirmado

El servicio `agt002-reanalysis-worker.service` está `failed/timeout`, sin
`MainPID` ni `ControlPID`. Inició a `20:40:30Z` y systemd lo terminó con
`SIGTERM` exactamente a `21:55:30Z`.

La unidad efectiva tiene:

```ini
Type=oneshot
TimeoutStartSec=4500
```

El timer permanece `disabled` e `inactive`. El bridge continúa activo.

El journal registra avance hasta el lote 27 menos de dos minutos antes de la
terminación. No registra una excepción del proveedor ni una pérdida de lease
previa. La causa inmediata de terminación fue la política de systemd.

## 4. Rendimiento observado

Los 28 lotes integrales frescos registraron:

- duración acumulada de proveedor: 4.286.508 ms;
- promedio: 153.089,57 ms por lote;
- mínimo: 89.255 ms;
- máximo: 445.782 ms;
- tokens de salida acumulados: 496.506;
- checkpoints reutilizados durante esa invocación: 0.

La ventana completa fue de 4.500.000 ms. Con el promedio observado, los 101
lotes requieren aproximadamente 4 horas y 18 minutos sólo de tiempo de
proveedor, más preparación, merge y persistencia. La estimación de extremo a
extremo de aproximadamente 4 horas y 25 minutos es consistente con la evidencia.

## 5. Código desplegado y garantías verificadas

Los hashes SHA-256 del worker, job adapter, checkpoint adapter, executor,
planner integral y descubrimiento semántico del release coinciden byte a byte
con el código local revisado en `223a085`.

El código y las funciones vivas de base demuestran:

- checkpoint único por `(workset_id, stage, batch_index)`;
- comparación exacta de request hash, contrato, salida, hash, usage e
  idempotency key antes de aceptar un replay;
- revalidación del checkpoint contra el contrato actual antes de reutilizarlo;
- renovación del lease antes de cada frontera de proveedor y persistencia;
- fencing de renew, checkpoint y finalización por `job_id + lease_id` y lease
  no vencido;
- finalización atómica de corrida, publicación y cierre del job;
- recuperación de un `durable_batched_v1` vencido mediante
  `running -> queued`, incremento acotado de `resume_count` y conservación de
  checkpoints;
- límite de cinco reanudaciones.

Se ejecutaron frescamente seis archivos de pruebas focalizadas de checkpoints,
reanálisis, heartbeat, PGlite y orquestación batched: `6/6` aprobados, exit 0.

## 6. Brechas y drift

### Sin cierre ante SIGTERM

El runner desplegado no instala manejadores `SIGTERM`/`SIGINT`. La terminación
externa evita que el `try/catch` ordinario cierre el job. El claim posterior sí
puede recuperar el lease vencido, pero hasta entonces la fila permanece
huérfana en `running`.

### Timeout divergente e insuficiente

La unidad efectiva usa 4.500 segundos. El artefacto actualmente versionado en
el repositorio usa 660 segundos. Ambos valores son insuficientes para la carga
observada y deben reconciliarse antes de otra ejecución.

### Claim global, no dirigido por ID

`psi_claim_agt002_reanalysis_job` recupera jobs expirados y elige el job
`queued` más antiguo de toda la cola. La lectura actual muestra cuatro jobs
activos: Cali y tres oportunidades posteriores en `queued`. Cali es el más
antiguo y sería seleccionado en el estado observado, pero el contrato no
garantiza por ID que una invocación futura procese exclusivamente Cali.

### Semántica histórica frente al diseño objetivo

La oportunidad no tiene corrida canónica previa. Por tanto, este runtime legado
está produciendo de facto una primera corrida aunque se denomine reanalysis.
Esto no satisface la frontera objetivo: `INITIAL` crea la primera corrida y
`REANALYSIS` sólo crea sucesoras. Recuperar Cali puede cerrar el experimento
operativo, pero no convierte esta ruta en la implementación definitiva de
INITIAL.

## 7. Disposición recomendada

Estado de disposición: `RECOVERABLE_PAUSED`.

Conservar el job, workset y checkpoints sin mutarlos. No marcarlo exitoso ni
terminal. Preparar una única reanudación dirigida con estas precondiciones:

1. reconciliar la unidad efectiva y fijar una ventana máxima de seis horas;
2. mantener el timer deshabilitado;
3. verificar inmediatamente antes del start que Cali conserva la misma
   identidad, 28/101, workset sin publicar, cero runs y lease vencido;
4. garantizar que el claim de la invocación está dirigido al job de Cali o,
   como mínimo, aborta antes del proveedor si el job reclamado no coincide;
5. verificar que los checkpoints 0–27 son hits válidos antes de aceptar una
   nueva llamada para el lote 28;
6. observar lease, progreso, duración y uso sin exponer payloads;
7. detenerse ante el primer fallo; no habilitar el timer ni continuar con otra
   oportunidad;
8. exigir como éxito: job terminal, `analysis_run_id`, corrida completada,
   publicación del workset y reporte legible.

Una ampliación aislada del timeout no se considera corrección completa. El
hardening posterior debe añadir cierre cooperativo ante `SIGTERM`, estado
recuperable explícito o reconciliador de leases vencidos, y claim dirigido para
operaciones individuales.

## 8. Acción no ejecutada

No se reanudó Cali. Esa ejecución volvería a enviar material real del proceso al
proveedor externo. Permanece excluida por la prohibición vigente sobre acciones
externas con datos reales, aunque el procedimiento técnico ya quedó definido.

## 9. Evidencia y comandos

- Composio Supabase read-only, log IDs `log_6FNH3lQVLj7W` y
  `log__ZQx5BsmI9Vm`;
- `systemctl show/cat` y journal read-only del host;
- reporter del worker:
  `7e404a137b70d4ed1d741399853df040f2950eb6` / `f0-7e404a1`;
- suite focalizada:
  `node --test tests/agt002-analysis-checkpoints.test.mjs ...` — 6 archivos,
  6 aprobados, 0 fallos;
- no hubo migración, despliegue, restart, claim, llamada de proveedor ni write
  productivo durante el diagnóstico.
