-- Rollback de 146: devuelve el umbral de Prospecto a 14 días y las fechas sembradas a `updated_at`.
-- Lo segundo reabre el problema que la 146 resolvió: cientos de avisos que vienen de una escritura masiva del
-- 2026-09-21, no de actividad comercial. Sólo tiene sentido si se decide volver a ese criterio.
begin;

update public.psi_sales_opportunities
   set stage_entered_at = coalesce(updated_at, created_at)
 where stage_entered_at_measured = false;

update public.psi_sales_pipeline_stages
   set staleness_days = 14
 where code = 'prospecto';

commit;
