# AGT-002: recuperación por nueva generación de workset

## Problema observado

Un job durable puede conservar checkpoints append-only válidamente persistidos y, después de un cambio de contrato del motor, dejar de poder reutilizar uno de esos outputs. Reencolar el mismo job no es seguro: el motor recalcula desde el primer checkpoint rechazado, pero `psi_record_agt002_analysis_checkpoint` impide tanto sobrescribir el checkpoint histórico como retroceder el progreso ya persistido.

La recuperación no modifica el job, workset ni checkpoints fuente. Tampoco convierte REANALYSIS en un fallback para producir un primer análisis canónico: esta vía sólo acepta una identidad documental gobernada ya congelada y un fallo durable exacto de persistencia en `integral_analysis`.

## Decisión

La migración 097 crea una única generación nueva por source job:

- conserva toda la evidencia fuente inmutable;
- exige al dueño de la base atestar el checkpoint rechazado por ID, request hash y output hash, junto con los conteos exactos y el commit reparador;
- deriva una nueva `idempotency_key` SHA-256 mediante el contrato `agt002-checkpoint-generation-recovery-v1`;
- clona el input congelado, cambia sólo `engine_identity.idempotency_key` y agrega la extensión cerrada `checkpoint_generation_recovery`;
- crea un job durable nuevo, con progreso `0/0`, que obtendrá naturalmente un workset nuevo;
- registra la relación source→recovery en una tabla append-only con RLS forzado.

La autorización es una función `SECURITY DEFINER` sin `EXECUTE` para `service_role`, `authenticated`, `anon` ni `public`. Sólo una acción administrativa directa puede crear la generación.

## Aislamiento de cola

El claim FIFO normal excluye cualquier job presente como `recovery_job_id` en la auditoría. La recuperación sólo puede reclamarse mediante `psi_claim_agt002_reanalysis_job_by_id(uuid, integer)`, que además rechaza IDs no auditados.

El runner lee opcionalmente `AGT002_REANALYSIS_TARGET_JOB_ID`. Vacío conserva el comportamiento normal. Presente exige un UUID válido y usa exclusivamente el claim por ID; nunca cae silenciosamente al FIFO.

## Secuencia operativa futura

Esta rama y su PR no ejecutan ninguno de estos pasos en producción.

1. Aprobar y desplegar código + migración mediante las compuertas ordinarias.
2. Verificar nuevamente, en lectura, el job/workset/checkpoint fuente y los hashes exactos.
3. Con autorización humana separada, invocar una sola vez la función administrativa de generación.
4. Confirmar que el source permanece `unavailable`, que sus checkpoints no cambiaron y que el nuevo job está `queued` con progreso `0/0`.
5. Ejecutar un único servicio transitorio con `AGT002_REANALYSIS_TARGET_JOB_ID=<recovery_job_id>` y el timer normal deshabilitado.
6. Verificar corrida canónica, publicación del workset nuevo, cierre del job nuevo y ausencia de cambios en los demás jobs.

## Rollback

El rollback 097 sólo procede si nunca se autorizó una recuperación. Si existe cualquier fila de auditoría, falla cerradamente y no elimina ni modifica evidencia. Antes del primer uso restaura el claim FIFO de 081 y retira únicamente las superficies introducidas por 097.
