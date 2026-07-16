-- Rollback 021 only. Explicit Licitaciones assignments and profile identity remain untouched.
begin;

delete from public.psi_profile_permissions
where permission_code in (
  'modulo_siio_gerencial',
  'modulo_vig_ia',
  'modulo_dashboard_comercial',
  'modulo_alertas_comerciales',
  'modulo_oportunidades',
  'modulo_metas',
  'modulo_usuarios'
);

delete from public.psi_access_permissions
where code in (
  'modulo_siio_gerencial',
  'modulo_vig_ia',
  'modulo_dashboard_comercial',
  'modulo_alertas_comerciales',
  'modulo_oportunidades',
  'modulo_metas',
  'modulo_usuarios'
);

commit;
