-- Rollback de 178: quita el módulo de Estudios de Seguridad.
--
-- PIERDE DATOS: se borran los estudios con sus zonas, riesgos y acciones. Antes de ejecutarlo, exportar lo que
-- haya. El permiso queda inactivo y se retira de los perfiles, para que nadie conserve una pestaña sin tablas.
begin;

drop table if exists public.psi_security_study_actions;
drop table if exists public.psi_security_study_risks;
drop table if exists public.psi_security_study_zones;
drop table if exists public.psi_security_studies;
drop sequence if exists public.psi_security_study_number_seq;

delete from public.psi_profile_permissions where permission_code = 'estudios_seguridad';
update public.psi_access_permissions set active = false where code = 'estudios_seguridad';

commit;
