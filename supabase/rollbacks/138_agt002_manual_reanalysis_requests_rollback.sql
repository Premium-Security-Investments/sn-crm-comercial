-- Rollback de 138: quita la cola del botón "Volver a analizar". Los reanálisis ya admitidos viven en
-- psi_agt002_initial_analysis_jobs y no se tocan. Sin la tabla, el botón responde que la función no está disponible.
begin;
drop table if exists public.psi_agt002_manual_reanalysis_requests;
commit;
