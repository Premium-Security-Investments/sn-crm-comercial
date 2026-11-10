-- Reversa de la 199: quita el PDF y la revisión del certificado (los archivos quedan en el storage). Respaldar antes con
-- select id, certificate_storage_path, certificate_review from public.psi_company_experience.
begin;
drop index if exists public.psi_company_experience_certificate_pending_text;
alter table public.psi_company_experience
  drop column if exists certificate_storage_path, drop column if exists certificate_file_name,
  drop column if exists certificate_uploaded_at, drop column if exists certificate_text,
  drop column if exists certificate_text_source, drop column if exists certificate_review,
  drop column if exists certificate_reviewed_at;
commit;
