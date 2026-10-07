-- AGT-003 / CRM comercial — las cinco vistas comerciales dejan de ser legibles con la llave pública (anon/authenticated).
--
-- Hallazgo (verificado en producción, 2026-10-07): estas vistas de public pertenecen a postgres, no tenían
-- security_invoker y concedían ALL (incluido SELECT) a anon y authenticated. Con la llave pública que va dentro de la
-- página web, GET /rest/v1/v_psi_sales_opportunity_enriched devolvía las 399 oportunidades, aunque la tabla base
-- psi_sales_opportunities está protegida por RLS (y devuelve 0). La vista corría con los permisos de su dueño y se
-- saltaba la RLS.
--
-- Quién las lee hoy: sólo el servidor/API (requireDb, service_role) y scripts con service_role. El navegador nunca las
-- consulta (no hay from('v_psi...') en src/). Por eso cerrarlas no cambia ninguna pantalla.
--
-- Qué hace, sólo sobre estas cinco vistas (no toca default privileges: otros sistemas comparten esta base):
--   1. revoke all ... from anon, authenticated, public;
--   2. security_invoker = true: si en el futuro alguien vuelve a conceder SELECT, la vista respeta la RLS de quien
--      consulta en lugar de la del dueño (defensa en profundidad);
--   3. grant select ... to service_role (lo que usa el servidor; service_role ignora la RLS).
--
-- REGLA PARA EL FUTURO: cualquier migración que vuelva a crear una de estas vistas con `create or replace view` DEBE
-- escribir `with (security_invoker = true)` (create or replace view SIN with reinicia las opciones y borra
-- security_invoker; los grants sí se conservan) y NUNCA debe conceder nada a anon, authenticated ni public.
-- scripts/agt002-check-grants-static.mjs (job de CI grants_security) falla si una migración posterior a 112 lo hace.
--
-- Rollback: supabase/rollbacks/112_agt003_commercial_views_no_public_access_rollback.sql (¡reabre la fuga!).

begin;

revoke all on public.v_psi_sales_opportunity_enriched from anon, authenticated, public;
alter view public.v_psi_sales_opportunity_enriched set (security_invoker = true);
grant select on public.v_psi_sales_opportunity_enriched to service_role;

revoke all on public.v_psi_sales_pipeline_summary from anon, authenticated, public;
alter view public.v_psi_sales_pipeline_summary set (security_invoker = true);
grant select on public.v_psi_sales_pipeline_summary to service_role;

revoke all on public.v_psi_sales_kpis_by_commercial_month from anon, authenticated, public;
alter view public.v_psi_sales_kpis_by_commercial_month set (security_invoker = true);
grant select on public.v_psi_sales_kpis_by_commercial_month to service_role;

revoke all on public.v_psi_sales_stalled_sustentacion from anon, authenticated, public;
alter view public.v_psi_sales_stalled_sustentacion set (security_invoker = true);
grant select on public.v_psi_sales_stalled_sustentacion to service_role;

revoke all on public.v_psi_sales_top3_closing from anon, authenticated, public;
alter view public.v_psi_sales_top3_closing set (security_invoker = true);
grant select on public.v_psi_sales_top3_closing to service_role;

commit;
