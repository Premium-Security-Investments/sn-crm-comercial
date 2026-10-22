-- AGT-003 Vig-IA Comercial — arranque del aviso de estancamiento: que no lo dispare una escritura masiva vieja.
--
-- Hallazgo al revisar los umbrales con los datos ya sembrados por la migración 145 (2026-10-22):
--   · 329 de las 403 oportunidades tienen `updated_at` en la semana del 2026-09-21. Fue una escritura masiva, no
--     actividad comercial. La fecha sembrada no dice cuándo entró el negocio a su etapa: dice cuándo se tocó la fila.
--   · Con umbral de 14 días eso marcaba 166 de las 206 oportunidades abiertas el primer día; con 30 días marcaba 2
--     hoy y volvía a marcar cientos dos días después, cuando ese lote cruzara el mes. El número que salga depende
--     del lote, no del negocio.
--
-- Decisión: el aviso sólo afirma lo que ESTE sistema midió. Las fechas sembradas se llevan al corte de medición
-- (ahora), así que:
--   · hoy no hay avisos de estancamiento;
--   · una oportunidad que no se mueva empieza a avisar al cumplir el umbral contado desde este corte;
--   · cualquier cambio real de etapa queda medido exacto por el disparador de la 145, desde el momento en que ocurre.
-- El texto en pantalla sigue diciendo "lleva al menos N días", que sigue siendo verdad: la entrada real a la etapa
-- es anterior o igual a este corte.
--
-- `updated_at` no se toca: el dato de cuándo se modificó cada fila sigue donde estaba.
--
-- Y Prospecto pasa a 30 días: un prospecto sin mover dos semanas es normal, un mes ya no.
-- Las demás etapas abiertas quedan en 14, donde un negocio quieto sí es un problema.
--
-- Sólo datos: no cambia estructura, ni permisos, ni el disparador. Idempotente por su propia condición.
begin;

update public.psi_sales_opportunities
   set stage_entered_at = now()
 where stage_entered_at_measured = false
   and stage_entered_at < now();

update public.psi_sales_pipeline_stages
   set staleness_days = 30
 where code = 'prospecto';

commit;
