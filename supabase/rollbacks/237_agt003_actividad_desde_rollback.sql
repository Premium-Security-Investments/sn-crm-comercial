-- Rollback de la 237: quita la fecha desde la que cuenta la actividad de un perfil reasignado.
begin;
alter table public.psi_sales_profiles drop column if exists activity_since;
commit;
