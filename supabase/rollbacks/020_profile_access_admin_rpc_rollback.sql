begin;

-- El cierre de acceso directo a Licitaciones y psi_profile_has_tender_permission
-- se conservan: los RPC 018 convergidos dependen del helper y el rollback nunca
-- debe restaurar autorización runtime por email.

drop function if exists public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid);
drop function if exists public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid);
drop function if exists public.psi_admin_release_profile_lock(uuid,uuid);
drop function if exists public.psi_admin_bind_profile_auth(uuid,text,uuid);
drop function if exists public.psi_admin_acquire_profile_lock(uuid);
drop table if exists public.psi_profile_admin_lock;
drop table if exists public.psi_profile_auth_subject_claims;
drop index if exists public.psi_sales_profiles_auth_user_id_key;
alter table public.psi_sales_profiles drop column if exists auth_user_id;

commit;
