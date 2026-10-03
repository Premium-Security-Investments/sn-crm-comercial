-- AGT-002: capability de consulta estrictamente separada de toda acción operativa.
begin;

do $$
begin
  if exists (
    select 1 from public.psi_access_permissions
    where code = 'licitaciones_lectura' and active = false
  ) then
    raise exception 'licitaciones_lectura está inactivo; se rehúsa reactivarlo automáticamente.';
  end if;

  insert into public.psi_access_permissions(code, name, description, active)
  values (
    'licitaciones_lectura',
    'Licitaciones — solo lectura',
    'Consulta de Radar, seguimiento, oportunidades y análisis de Licitaciones sin autoridad para ejecutar, editar o decidir.',
    true
  )
  on conflict (code) do update
  set name = excluded.name,
      description = excluded.description;

  if not exists (
    select 1 from public.psi_access_permissions
    where code = 'licitaciones_lectura' and active = true
  ) then
    raise exception 'No fue posible dejar activo licitaciones_lectura.';
  end if;
end
$$;

commit;
