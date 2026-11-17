-- Rollback de 228: se pierde la fecha original de los estudios incorporados (su vigencia vuelve a contarse desde la aprobación).
begin;
alter table public.psi_security_studies drop column if exists original_study_date;
commit;
