-- Reversa de 127: retira sedes y experiencia estructuradas. La ficha y el registro de soportes no se tocan.
begin;
drop table if exists public.psi_company_experience;
drop table if exists public.psi_company_sites;
commit;
