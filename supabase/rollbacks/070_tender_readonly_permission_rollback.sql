-- Rollback seguro: retirar únicamente si ningún perfil depende del permiso.
begin;

do $$
begin
  if exists (
    select 1 from public.psi_profile_permissions
    where permission_code = 'licitaciones_lectura'
  ) then
    raise exception 'Hay perfiles con licitaciones_lectura; retire primero esas asignaciones.';
  end if;

  delete from public.psi_access_permissions
  where code = 'licitaciones_lectura';
end
$$;

commit;
