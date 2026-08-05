begin;

do $$
declare
  v_target_id uuid;
  v_match_count integer;
  v_deleted_count integer;
  v_before_permissions jsonb;
begin
  select count(*), min(profile.id)
  into v_match_count, v_target_id
  from public.psi_sales_profiles profile
  where profile.active = true
    and coalesce(profile.identity_type, 'human') = 'human'
    and lower(regexp_replace(btrim(profile.full_name), '\s+', ' ', 'g')) = lower('Katherine Valencia Buitrago');

  if v_match_count <> 1 then
    raise exception 'Expected exactly one active human profile named Katherine Valencia Buitrago; found %.', v_match_count;
  end if;

  select coalesce(jsonb_agg(assignment.permission_code order by assignment.permission_code), '[]'::jsonb)
  into v_before_permissions
  from public.psi_profile_permissions assignment
  where assignment.profile_id = v_target_id;

  delete from public.psi_profile_permissions
  where profile_id = v_target_id
    and permission_code = 'licitaciones_empresa';
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count = 1 then
    insert into public.psi_access_audit_log(actor_profile_id, target_profile_id, action, before_state, after_state)
    values (
      null,
      v_target_id,
      'profile.permission.revoke.rollback',
      jsonb_build_object('permissions', v_before_permissions, 'permission_code', 'licitaciones_empresa'),
      jsonb_build_object(
        'permissions', coalesce((select jsonb_agg(assignment.permission_code order by assignment.permission_code) from public.psi_profile_permissions assignment where assignment.profile_id = v_target_id), '[]'::jsonb),
        'source', 'rollback_060'
      )
    );
  end if;

  delete from public.psi_access_permissions permission
  where permission.code = 'licitaciones_empresa'
    and not exists (
      select 1 from public.psi_profile_permissions assignment
      where assignment.permission_code = permission.code
    );
end
$$;

commit;
