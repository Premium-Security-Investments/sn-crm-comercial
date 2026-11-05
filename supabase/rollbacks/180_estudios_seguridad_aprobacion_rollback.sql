-- Rollback de 180: quita la revisión y aprobación de los estudios de seguridad.
--
-- PIERDE DATOS: se borran la bitácora de revisión y las versiones aprobadas (con su foto JSON). Los estudios quedan
-- en el estado en que estén; uno "aprobado" sigue sin poder editarse hasta que se cambie su estado a mano.
begin;

drop function if exists public.psi_security_study_transition(uuid, text, uuid, text, jsonb, text);
drop table if exists public.psi_security_study_versions;
drop table if exists public.psi_security_study_events;
delete from public.psi_profile_permissions where permission_code in ('estudios_seguridad_revisar', 'estudios_seguridad_aprobar');
update public.psi_access_permissions set active = false where code in ('estudios_seguridad_revisar', 'estudios_seguridad_aprobar');

commit;
