-- Reversa de la 235: borra las tablas del cotizador de modelos (con sus datos) y retira el permiso.
begin;
delete from public.psi_profile_permissions where permission_code = 'siio_cotizador_modelos';
update public.psi_access_permissions set active = false where code = 'siio_cotizador_modelos';
drop table if exists public.psi_service_model_scenarios;
drop table if exists public.psi_service_model_stores;
commit;
