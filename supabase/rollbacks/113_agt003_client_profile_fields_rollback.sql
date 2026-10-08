-- Reversa de 113: elimina las columnas del perfil del cliente (se pierden los datos capturados en ellas).
begin;
alter table public.psi_sales_opportunities
  drop column if exists company_website,
  drop column if exists company_nit,
  drop column if exists decision_maker_title,
  drop column if exists decision_maker_linkedin,
  drop column if exists current_security_provider,
  drop column if exists current_security_provider_none,
  drop column if exists current_contract_end_date;
commit;
