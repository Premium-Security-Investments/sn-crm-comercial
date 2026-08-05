-- Dedicated minimum-privilege permission for maintaining the textual company procurement profile.
begin;

do $$
declare
  v_target_id uuid;
  v_match_count integer;
  v_inserted_count integer;
  v_catalog_inserted_count integer;
  v_before_permissions jsonb;
begin
  select count(*)
  into v_match_count
  from public.psi_sales_profiles profile
  where profile.active = true
    and coalesce(profile.identity_type, 'human') = 'human'
    and lower(regexp_replace(btrim(profile.full_name), '\s+', ' ', 'g')) = lower('Katherine Valencia Buitrago');

  if v_match_count <> 1 then
    raise exception 'Expected exactly one active human profile named Katherine Valencia Buitrago; found %.', v_match_count;
  end if;

  select profile.id
  into v_target_id
  from public.psi_sales_profiles profile
  where profile.active = true
    and coalesce(profile.identity_type, 'human') = 'human'
    and lower(regexp_replace(btrim(profile.full_name), '\s+', ' ', 'g')) = lower('Katherine Valencia Buitrago');

  if not exists (
    select 1
    from public.psi_profile_permissions assignment
    join public.psi_access_permissions permission on permission.code = assignment.permission_code
    where assignment.profile_id = v_target_id
      and assignment.permission_code = 'licitaciones'
      and permission.active = true
  ) then
    raise exception 'Katherine Valencia Buitrago lacks active base permission licitaciones; no changes applied.';
  end if;

  select coalesce(jsonb_agg(assignment.permission_code order by assignment.permission_code), '[]'::jsonb)
  into v_before_permissions
  from public.psi_profile_permissions assignment
  where assignment.profile_id = v_target_id;

  if exists (
    select 1
    from public.psi_access_permissions permission
    where permission.code = 'licitaciones_empresa'
      and permission.active = false
  ) then
    raise exception 'Permission licitaciones_empresa is inactive; refusing to reactivate it.';
  end if;

  insert into public.psi_access_permissions(code, name, description, active)
  values (
    'licitaciones_empresa',
    'Mantenimiento de información empresarial',
    'Permite actualizar la ficha textual de la empresa para Licitaciones. No habilita documentos, custodia, conversión ni GO/NO GO.',
    true
  )
  on conflict (code) do nothing;
  get diagnostics v_catalog_inserted_count = row_count;

  if not exists (
    select 1
    from public.psi_access_permissions permission
    where permission.code = 'licitaciones_empresa'
      and permission.active = true
  ) then
    raise exception 'Permission licitaciones_empresa is not active; refusing to continue.';
  end if;

  insert into public.psi_profile_permissions(profile_id, permission_code, created_by)
  values (v_target_id, 'licitaciones_empresa', null)
  on conflict do nothing;
  get diagnostics v_inserted_count = row_count;

  if v_inserted_count = 1 then
    insert into public.psi_access_audit_log(actor_profile_id, target_profile_id, action, before_state, after_state)
    values (
      null,
      v_target_id,
      'profile.permission.grant.deployment',
      jsonb_build_object('permissions', v_before_permissions),
      jsonb_build_object(
        'permissions', v_before_permissions || jsonb_build_array('licitaciones_empresa'),
        'permission_code', 'licitaciones_empresa',
        'source', 'migration_060',
        'assignment_created', true,
        'catalog_created', v_catalog_inserted_count = 1
      )
    );
  end if;
end
$$;

commit;
