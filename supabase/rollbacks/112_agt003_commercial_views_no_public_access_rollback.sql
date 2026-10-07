-- Rollback de 112 — ¡ATENCIÓN! ESTE ROLLBACK REABRE LA FUGA DE DATOS.
--
-- !!! Después de ejecutarlo, cualquiera con la llave pública de la página (anon) vuelve a poder leer TODAS las
-- !!! oportunidades comerciales vía /rest/v1/v_psi_sales_opportunity_enriched (y las otras cuatro vistas).
-- !!! Úselo sólo si 112 rompió algo crítico y por el menor tiempo posible; vuelva a aplicar 112 en cuanto se pueda.
--
-- Restaura exactamente el estado anterior a 112 en las cinco vistas:
--   - ALL a anon y authenticated (como estaba);
--   - sin la opción security_invoker (la vista vuelve a correr con los permisos de su dueño, postgres).
-- No se toca service_role: ya tenía acceso antes de 112 y lo sigue necesitando el servidor.

begin;

grant all on public.v_psi_sales_opportunity_enriched to anon, authenticated;
alter view public.v_psi_sales_opportunity_enriched reset (security_invoker);

grant all on public.v_psi_sales_pipeline_summary to anon, authenticated;
alter view public.v_psi_sales_pipeline_summary reset (security_invoker);

grant all on public.v_psi_sales_kpis_by_commercial_month to anon, authenticated;
alter view public.v_psi_sales_kpis_by_commercial_month reset (security_invoker);

grant all on public.v_psi_sales_stalled_sustentacion to anon, authenticated;
alter view public.v_psi_sales_stalled_sustentacion reset (security_invoker);

grant all on public.v_psi_sales_top3_closing to anon, authenticated;
alter view public.v_psi_sales_top3_closing reset (security_invoker);

commit;
