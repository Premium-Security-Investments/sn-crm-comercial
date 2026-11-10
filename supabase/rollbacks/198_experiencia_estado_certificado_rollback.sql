-- Reversa de la 198: quita el estado del certificado. Se pierde lo marcado: respaldar antes con
-- select id, rup_consecutive, certificate_status, certificate_note from public.psi_company_experience.
begin;
alter table public.psi_company_experience
  drop column if exists certificate_status, drop column if exists certificate_note, drop column if exists certificate_updated_at;
commit;
