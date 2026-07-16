begin;

drop function if exists public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid);
drop function if exists public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid);
drop function if exists public.psi_admin_release_profile_lock(uuid,uuid);
drop function if exists public.psi_admin_acquire_profile_lock(uuid);
drop table if exists public.psi_profile_admin_lock;

commit;
