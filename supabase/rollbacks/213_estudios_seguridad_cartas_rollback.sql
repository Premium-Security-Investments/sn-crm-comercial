-- Rollback de 213: se pierde el registro de las cartas de recomendación (los PDF que ya están en SharePoint no se borran).
begin;

drop table if exists public.psi_security_study_letters;

commit;
