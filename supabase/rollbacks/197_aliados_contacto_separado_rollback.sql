-- Reversa de la 197: quita el contacto en cuatro campos. Se pierde lo escrito en esos campos: respaldar antes con
-- select nit, contact_name, contact_title, contact_phone, contact_email from public.psi_vigilance_companies.
begin;
drop function if exists public.psi_save_vigilance_company(uuid, text, text, jsonb, text);
alter table public.psi_vigilance_companies
  drop column if exists contact_name, drop column if exists contact_title,
  drop column if exists contact_phone, drop column if exists contact_email;
commit;
