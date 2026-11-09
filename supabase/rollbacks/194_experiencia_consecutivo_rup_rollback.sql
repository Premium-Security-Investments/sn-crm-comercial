-- Reversa de la 194: quita el consecutivo del RUP de las experiencias.
begin;
alter table public.psi_company_experience drop column if exists rup_consecutive;
commit;
