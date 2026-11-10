-- Reversa de la 200: quita las condiciones diferenciales. Respaldar antes con
-- select * from public.psi_company_differential_conditions.
begin;
drop table if exists public.psi_company_differential_conditions;
commit;
