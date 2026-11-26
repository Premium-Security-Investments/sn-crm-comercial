-- Rollback de la 240 (Aliados: página web y lo que Vig-IA leyó de ella).
begin;
drop function if exists public.psi_save_vigilance_website_reading(uuid, text, text, jsonb, text);
drop function if exists public.psi_save_vigilance_website(uuid, text, text);
alter table public.psi_vigilance_companies
  drop column if exists website, drop column if exists website_info,
  drop column if exists website_read_at, drop column if exists website_read_error;
commit;
