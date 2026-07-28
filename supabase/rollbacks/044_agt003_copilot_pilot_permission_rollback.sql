begin;

delete from public.psi_profile_permissions
where permission_code = 'vigia_copilot_pilot';

delete from public.psi_access_permissions
where code = 'vigia_copilot_pilot';

commit;
