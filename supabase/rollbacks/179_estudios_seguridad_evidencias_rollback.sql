-- Rollback de 179: quita las evidencias de los estudios de seguridad.
--
-- PIERDE DATOS: se borra el registro de las fotos y documentos. Los archivos del depósito `security-study-evidence`
-- NO se borran desde SQL (Supabase Storage no lo permite): hay que vaciar el depósito desde el panel o la API antes
-- de eliminarlo, y exportar lo que se quiera conservar.
begin;

drop table if exists public.psi_security_study_evidence;

commit;
