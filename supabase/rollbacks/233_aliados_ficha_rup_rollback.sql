-- Rollback de la 233 (Aliados: ficha del RUP). Borra la historia de documentos cargados y los datos de frecuencia y SG-SST.
begin;
drop function if exists public.psi_save_vigilance_capabilities(uuid, text, jsonb);
drop function if exists public.psi_save_vigilance_rup(uuid, text, jsonb);
drop table if exists public.psi_vigilance_company_rup;
alter table public.psi_vigilance_companies
  drop column if exists radio_cities, drop column if exists radio_source,
  drop column if exists sgsst_pct, drop column if exists sgsst_date;
commit;
