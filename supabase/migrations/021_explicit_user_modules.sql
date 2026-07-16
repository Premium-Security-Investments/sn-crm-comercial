-- Explicit module assignments are a one-time compatibility snapshot, never a runtime role grant.
begin;

-- Materialize the migration-start population once. Every compatibility backfill
-- below must consume this list so profiles inserted while 021 is running cannot
-- inherit a partial set of explicit modules.
create temporary table psi_021_profile_snapshot on commit drop as
select id as profile_id, role
from public.psi_sales_profiles;

insert into public.psi_access_permissions (code, name, description, active) values
  ('modulo_siio_gerencial', 'SIIO Gerencial', 'Acceso al módulo SIIO Gerencial.', true),
  ('modulo_vig_ia', 'Vig-IA', 'Acceso al módulo Vig-IA.', true),
  ('modulo_dashboard_comercial', 'Dashboard Comercial', 'Acceso al Dashboard Comercial.', true),
  ('modulo_alertas_comerciales', 'Alertas Comerciales', 'Acceso al módulo de Alertas Comerciales.', true),
  ('modulo_oportunidades', 'Oportunidades', 'Acceso al módulo de Oportunidades.', true),
  ('modulo_metas', 'Metas y Cumplimiento', 'Acceso al módulo de Metas y Cumplimiento.', true),
  ('licitaciones', 'Licitaciones', 'Acceso al módulo de Licitaciones.', true),
  ('modulo_usuarios', 'Usuarios y Permisos', 'Acceso al módulo de Usuarios y Permisos.', true)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      active = true;

-- Each backfill is intentionally explicit. Later profile INSERTs have no trigger
-- or default grant and cannot enter the materialized migration-start snapshot.
insert into public.psi_profile_permissions (profile_id, permission_code)
select profile_id, 'modulo_siio_gerencial'
from psi_021_profile_snapshot
where role in ('admin', 'gerencia', 'director', 'junta')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select profile_id, 'modulo_vig_ia'
from psi_021_profile_snapshot
where role in ('admin', 'gerencia', 'director')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select profile_id, 'modulo_dashboard_comercial'
from psi_021_profile_snapshot
where role in ('admin', 'gerencia', 'director')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select profile_id, 'modulo_alertas_comerciales'
from psi_021_profile_snapshot
where role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select profile_id, 'modulo_oportunidades'
from psi_021_profile_snapshot
where role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select profile_id, 'modulo_metas'
from psi_021_profile_snapshot
where role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select profile_id, 'modulo_usuarios'
from psi_021_profile_snapshot
where role = 'admin'
on conflict do nothing;

commit;
