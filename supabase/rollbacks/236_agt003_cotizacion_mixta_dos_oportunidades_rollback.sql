-- Rollback de la 236 (cotización mixta en dos oportunidades). Las oportunidades creadas se quedan: sólo se pierde el enlace.
begin;
drop index if exists public.psi_quotes_paired_opportunity_idx;
alter table public.psi_quotes drop column if exists paired_opportunity_id, drop column if exists tech_delivery_terms;
commit;
