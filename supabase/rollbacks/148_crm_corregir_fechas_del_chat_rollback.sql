-- Rollback de 148: devuelve las tres fechas a medianoche UTC, es decir al día corrido que se veía en pantalla.
-- Sólo tiene sentido para reproducir el defecto; no para operar.
begin;

update public.psi_sales_opportunities
   set next_action_at = timestamptz '2026-10-26 00:00:00+00'
 where id = '670a4f03-7179-45f8-9a02-89bc8166a69d'
   and next_action_at = timestamptz '2026-10-26 17:00:00+00';

update public.psi_sales_interactions
   set occurred_at = timestamptz '2026-10-22 00:00:00+00'
 where id in ('b70f4620-b84a-4489-8b30-0af2331e478b', '3fffcf45-4f33-4123-acc6-9489a2a2b5d3')
   and occurred_at = timestamptz '2026-10-22 17:00:00+00';

update public.psi_sales_opportunities
   set last_interaction_at = timestamptz '2026-10-22 00:00:00+00'
 where id = '670a4f03-7179-45f8-9a02-89bc8166a69d'
   and last_interaction_at = timestamptz '2026-10-22 17:00:00+00';

commit;
