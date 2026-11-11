-- Reversa de la 207: quita las propuestas de experiencia y los códigos UNSPSC por experiencia.
begin;
drop table if exists public.psi_tender_experience_plans;
alter table public.psi_company_experience drop column if exists unspsc_codes;
commit;
