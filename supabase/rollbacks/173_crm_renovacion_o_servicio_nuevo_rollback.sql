-- Rollback de 173: se pierde la clasificación renovación / servicio nuevo de las oportunidades que la tengan.
begin;

alter table public.psi_sales_opportunities
  drop constraint if exists psi_sales_opportunities_client_deal_type_check;
alter table public.psi_sales_opportunities
  drop column if exists client_deal_type;

commit;
