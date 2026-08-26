-- Rollback de 073. Idempotente y sin pérdida de evidencia: 073 sólo añadió un índice,
-- así que deshacerla es soltarlo. Ninguna fila, columna, función, trigger, política ni
-- permiso de public.psi_tender_analysis_runs se toca aquí.
--
-- Tras aplicar este rollback la lectura del análisis vigente vuelve a resolverse con los
-- índices de 025/050/063, es decir con el rango por una sola de las dos igualdades y
-- recheck fila por fila de la otra: correcta, pero con el costo que motivó 073.
begin;

drop index if exists public.psi_tender_analysis_runs_opportunity_snapshot_current_idx;

commit;
