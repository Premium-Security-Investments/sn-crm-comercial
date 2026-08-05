begin;

do $$
declare
  v_target_id uuid;
  v_match_count integer;
  v_deleted_count integer;
  v_before_permissions jsonb;
  v_latest_action text;
  v_latest_source text;
  v_grant_created_at timestamptz;
  v_assignment_created_at timestamptz;
  v_assignment_owned boolean := false;
  v_catalog_owned boolean := false;
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

  select
    audit.action,
    audit.after_state ->> 'source',
    audit.created_at,
    case
      when audit.after_state ? 'assignment_created'
        then audit.after_state -> 'assignment_created' = 'true'::jsonb
      when audit.action = 'profile.permission.grant.deployment'
        and audit.after_state ->> 'source' in ('migration_060', 'deployment_060')
        then true
      else false
    end,
    coalesce(audit.after_state -> 'catalog_created' = 'true'::jsonb, false)
  into v_latest_action, v_latest_source, v_grant_created_at, v_assignment_owned, v_catalog_owned
  from public.psi_access_audit_log audit
  where audit.target_profile_id = v_target_id
    and (
      (
        audit.action = 'profile.permission.grant.deployment'
        and audit.after_state ->> 'permission_code' = 'licitaciones_empresa'
      )
      or (
        audit.action = 'profile.permission.revoke.rollback'
        and audit.before_state ->> 'permission_code' = 'licitaciones_empresa'
      )
    )
  order by audit.created_at desc, audit.id desc
  limit 1;

  select assignment.created_at
  into v_assignment_created_at
  from public.psi_profile_permissions assignment
  where assignment.profile_id = v_target_id
    and assignment.permission_code = 'licitaciones_empresa';

  if v_latest_action is distinct from 'profile.permission.grant.deployment'
    or v_latest_source not in ('migration_060', 'deployment_060')
    or v_assignment_owned is not true
    or v_assignment_created_at is null
    or v_assignment_created_at > v_grant_created_at
  then
    return;
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
        'permission_code', 'licitaciones_empresa',
        'source', 'rollback_060'
      )
    );
  end if;

  if v_catalog_owned then
    delete from public.psi_access_permissions permission
    where permission.code = 'licitaciones_empresa'
      and not exists (
        select 1 from public.psi_profile_permissions assignment
        where assignment.permission_code = permission.code
      );
  end if;
end
$$;

commit;
