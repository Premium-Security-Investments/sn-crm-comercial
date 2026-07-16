-- Explicit module assignments are a one-time compatibility snapshot, never a runtime role grant.
begin;

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

-- Snapshot the profiles that exist while this migration runs. Each statement is
-- intentionally explicit: later profile INSERTs have no trigger or default grant.
insert into public.psi_profile_permissions (profile_id, permission_code)
select id, 'modulo_siio_gerencial'
from public.psi_sales_profiles
where role in ('admin', 'gerencia', 'director')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select id, 'modulo_vig_ia'
from public.psi_sales_profiles
where role in ('admin', 'gerencia', 'director')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select id, 'modulo_dashboard_comercial'
from public.psi_sales_profiles
where role in ('admin', 'gerencia', 'director')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select id, 'modulo_alertas_comerciales'
from public.psi_sales_profiles
where role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select id, 'modulo_oportunidades'
from public.psi_sales_profiles
where role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select id, 'modulo_metas'
from public.psi_sales_profiles
where role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador')
on conflict do nothing;

insert into public.psi_profile_permissions (profile_id, permission_code)
select id, 'modulo_usuarios'
from public.psi_sales_profiles
where role = 'admin'
on conflict do nothing;

commit;
