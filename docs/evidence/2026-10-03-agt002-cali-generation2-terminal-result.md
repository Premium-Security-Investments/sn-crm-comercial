# AGT-002 — resultado terminal de la recuperación generación 2 de Cali

**Fecha:** 2026-10-03

**Estado:** intento único finalizado; no se autoriza otro reintento

**Clasificación:** `UNAVAILABLE` + `INVALID_OUTPUT`

## Alcance autorizado

La ejecución se limitó al nuevo job de recuperación generación 2 de Cali, con el timer general
deshabilitado y sin permitir que el worker reclamara otras oportunidades:

- job: `5e432760-5bce-4936-95f3-920e66c5a00f`;
- auditoría de recuperación: `4a4cc975-60ca-4f31-add6-b90f820e96f7`;
- workset: `dc279bb8-22f2-48dc-b25e-ae0547071818`;
- unidad transitoria: `agt002-reanalysis-cali-gen2-5e432760.service`;
- baseline desplegado: `356143900cb367eb1c17a050a9fe5d750654da7a`.

La recuperación utilizó la migración aditiva
`098_agt002_checkpoint_generation_2_recovery.sql` y el worker inmutable del mismo baseline. No se
habilitó el timer ni se abrió la cola general.

## Resultado observado

La ejecución comenzó a las `2026-10-03T19:15:11Z` y terminó a las
`2026-10-03T19:53:02Z`. El readback terminal mostró:

- `status=unavailable`;
- `error_code=invalid_output`;
- `completed_batch_count=54` de `total_batch_count=54`;
- `discovery_checkpoint_count=53`;
- `manifest_checkpoint_count=1`;
- cero checkpoints de plan y de análisis integral;
- `analysis_run_id=null`;
- `resume_count=0` para el job generación 2.

El journal registró el rechazo en `stage=envelope` con
`validation_code=v4_discovered_input_assembly_failed`. El contenido rechazado tenía cero bytes y
el digest SHA-256 del contenido vacío. El cierre reportó
`error_code=AGT002_ENVELOPE_INVALID`, respuesta recibida del bridge y
`persistence_attempts=0`.

La unidad terminó limpiamente desde la perspectiva de systemd (`Result=success`, exit code `0`),
pero eso sólo significa que el worker persistió su resultado terminal; funcionalmente el análisis
quedó `unavailable`. No existe corrida canónica publicada ni reporte de Cali.

## Disposición

El gate de intento único se cumplió y obliga a detenerse. No se realiza otro retry, no se habilita
el timer y no se procesa otra oportunidad por inferencia.

Una recuperación posterior requiere un cambio independiente que:

1. reproduzca y corrija el ensamblaje `v4_discovered_input` cuando el manifiesto final queda vacío;
2. agregue una regresión con la forma exacta observada en Cali;
3. pase los gates focalizados y transversales;
4. obtenga una nueva autorización explícita para un único job después de otro readback productivo.

Este resultado cierra el intento autorizado, no el incidente funcional de Cali.
