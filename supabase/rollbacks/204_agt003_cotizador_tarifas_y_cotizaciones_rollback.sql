-- Rollback de 204: borra las tablas del cotizador. Se pierden las cotizaciones guardadas y las tarifas cargadas.
begin;

drop table if exists public.psi_quote_tech_lines;
drop table if exists public.psi_quote_guard_posts;
drop table if exists public.psi_quotes;
drop table if exists public.psi_quote_rates;

commit;
