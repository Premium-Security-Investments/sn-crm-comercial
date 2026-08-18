-- Defense in depth: align materialized SIIO module grants with the current
-- role ceiling. Migration 021 historically granted SIIO to directors, but the
-- runtime authorization policy now reserves this executive module for admin,
-- gerencia and junta. Re-running this migration is safe.
delete from public.psi_profile_permissions as permission
using public.psi_sales_profiles as profile
where permission.profile_id = profile.id
  and permission.permission_code = 'modulo_siio_gerencial'
  and coalesce(profile.role, '') not in ('admin', 'gerencia', 'junta');
