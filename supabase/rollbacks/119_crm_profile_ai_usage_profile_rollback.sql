-- Reversa de 119: quita el "Perfil de uso de IA" de las personas (se pierde la asignación; el historial de cambios
-- queda en psi_access_audit_log). Sin la columna, el servidor aplica sólo el cupo del equipo.
begin;
drop function if exists public.psi_admin_set_profile_ai_usage_profile(uuid, text, uuid);
alter table public.psi_sales_profiles drop constraint if exists psi_sales_profiles_ai_usage_profile_format;
alter table public.psi_sales_profiles drop column if exists ai_usage_profile;
commit;
