-- Atomic profile, organizational scope, permission and audit administration.
-- Supabase Auth remains external; database authorization state changes as one PostgreSQL transaction.
begin;

create table if not exists public.psi_profile_admin_lock (
  lock_name text primary key,
  operation_id uuid not null unique,
  actor_profile_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint psi_profile_admin_lock_global_check check (lock_name = 'global')
);

revoke all on table public.psi_profile_admin_lock from public;
revoke all on table public.psi_profile_admin_lock from authenticated;
revoke all on table public.psi_profile_admin_lock from service_role;

create or replace function public.psi_admin_acquire_profile_lock(p_actor_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation_id uuid := gen_random_uuid();
begin
  if not exists (
    select 1 from public.psi_sales_profiles actor
    where actor.id = p_actor_profile_id and actor.active = true and actor.role = 'admin'
  ) then
    raise exception 'Actor no autorizado para administrar perfiles.' using errcode = '42501';
  end if;

  delete from public.psi_profile_admin_lock where lock_name = 'global' and expires_at <= now();
  begin
    insert into public.psi_profile_admin_lock(lock_name, operation_id, actor_profile_id, expires_at)
    values ('global', v_operation_id, p_actor_profile_id, now() + interval '5 minutes');
  exception when unique_violation then
    raise exception 'Otra administración de perfiles está en curso.' using errcode = '55P03';
  end;
  return v_operation_id;
end;
$$;

create or replace function public.psi_admin_profile_lock_owned(p_operation_id uuid, p_actor_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.psi_profile_admin_lock
    where lock_name = 'global' and operation_id = p_operation_id
      and actor_profile_id = p_actor_profile_id and expires_at > now()
  );
$$;

create or replace function public.psi_admin_release_profile_lock(p_operation_id uuid, p_actor_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_count integer;
begin
  delete from public.psi_profile_admin_lock
  where lock_name = 'global' and operation_id = p_operation_id and actor_profile_id = p_actor_profile_id;
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

-- Remove the pre-lock overload when converging an earlier technical preview of 020.
drop function if exists public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid);

create or replace function public.psi_admin_persist_profile_access(
  p_mode text,
  p_target_id uuid,
  p_expected_profile jsonb,
  p_profile jsonb,
  p_areas jsonb,
  p_permissions jsonb,
  p_actor_profile_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.psi_sales_profiles%rowtype;
  v_current_snapshot jsonb;
  v_before_areas jsonb;
  v_before_permissions jsonb;
  v_role text := p_profile->>'role';
  v_active boolean;
begin
  if not exists (
    select 1 from public.psi_sales_profiles actor
    where actor.id = p_actor_profile_id and actor.active = true and actor.role = 'admin'
  ) then
    raise exception 'Actor no autorizado para administrar perfiles.' using errcode = '42501';
  end if;

  perform 1 from public.psi_profile_admin_lock
  where lock_name = 'global' and operation_id = p_operation_id
    and actor_profile_id = p_actor_profile_id and expires_at > now()
  for update;
  if not found then
    raise exception 'El lock de administración no pertenece a esta operación o expiró.' using errcode = '55P03';
  end if;

  if p_mode not in ('post', 'patch') or p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Solicitud de administración de perfil inválida.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_areas) <> 'array' or jsonb_typeof(p_permissions) <> 'array' then
    raise exception 'Áreas y permisos deben ser arreglos.' using errcode = '22023';
  end if;
  if v_role not in ('admin','gerencia','director','comercial','colaborador','junta') then
    raise exception 'Rol no válido.' using errcode = '22023';
  end if;
  if nullif(btrim(p_profile->>'full_name'), '') is null
     or nullif(btrim(p_profile->>'microsoft_email'), '') is null then
    raise exception 'Nombre y correo son obligatorios.' using errcode = '22023';
  end if;
  begin
    v_active := (p_profile->>'active')::boolean;
  exception when others then
    raise exception 'Estado activo inválido.' using errcode = '22023';
  end;

  if exists (
    select 1
    from jsonb_array_elements(p_areas) item
    left join public.psi_org_areas area
      on area.code = item->>'area_code' and area.active = true
    left join public.psi_org_subareas subarea
      on subarea.code = item->>'subarea_code'
     and subarea.area_code = item->>'area_code'
     and subarea.active = true
    where jsonb_typeof(item) <> 'object'
       or area.code is null
       or ((item ? 'subarea_code') and item->'subarea_code' <> 'null'::jsonb and subarea.code is null)
  ) then
    raise exception 'Área o subárea no válida.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_areas) whole
    join jsonb_array_elements(p_areas) specific
      on whole->>'area_code' = specific->>'area_code'
    where (not (whole ? 'subarea_code') or whole->'subarea_code' = 'null'::jsonb)
      and specific ? 'subarea_code' and specific->'subarea_code' <> 'null'::jsonb
  ) then
    raise exception 'Alcance ambiguo: área completa y subárea.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(p_permissions) requested(code)
    left join public.psi_access_permissions permission
      on permission.code = requested.code and permission.active = true
    where permission.code is null
  ) then
    raise exception 'Permiso no válido.' using errcode = '22023';
  end if;
  if p_permissions ? 'licitaciones' and v_role not in ('admin','gerencia','director','comercial') then
    raise exception 'El permiso de Licitaciones no aplica para este rol.' using errcode = '22023';
  end if;

  if p_target_id is null then
    if p_mode <> 'post' or (p_expected_profile is not null and p_expected_profile <> 'null'::jsonb) then
      raise exception 'Creación de perfil inválida.' using errcode = '22023';
    end if;
    insert into public.psi_sales_profiles (
      full_name, microsoft_email, role, active, commercial_area, can_edit_customer_segment
    ) values (
      btrim(p_profile->>'full_name'), lower(btrim(p_profile->>'microsoft_email')), v_role, v_active,
      nullif(p_profile->>'commercial_area', ''), coalesce((p_profile->>'can_edit_customer_segment')::boolean, false)
    ) returning * into v_target;
    v_before_areas := '[]'::jsonb;
    v_before_permissions := '[]'::jsonb;
  else
    select * into v_target
    from public.psi_sales_profiles
    where id = p_target_id
    for update;
    if not found then
      raise exception 'Perfil no encontrado.' using errcode = 'P0002';
    end if;

    select jsonb_build_object(
      'id', v_target.id,
      'full_name', v_target.full_name,
      'microsoft_email', v_target.microsoft_email,
      'role', v_target.role,
      'active', v_target.active,
      'commercial_area', v_target.commercial_area,
      'can_edit_customer_segment', v_target.can_edit_customer_segment
    ) into v_current_snapshot;
    if p_expected_profile is null or v_current_snapshot is distinct from p_expected_profile then
      raise exception 'El perfil cambió de forma concurrente; el snapshot está obsoleto.' using errcode = '40001';
    end if;
    if v_target.id = p_actor_profile_id and (v_role <> 'admin' or not v_active) then
      raise exception 'No puede desactivar ni cambiar su propio rol de administrador.' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('area_code', area_code, 'subarea_code', subarea_code) order by area_code, subarea_code nulls first), '[]'::jsonb)
      into v_before_areas
      from public.psi_profile_area_assignments where profile_id = p_target_id;
    select coalesce(jsonb_agg(permission_code order by permission_code), '[]'::jsonb)
      into v_before_permissions
      from public.psi_profile_permissions where profile_id = p_target_id;

    update public.psi_sales_profiles set
      full_name = btrim(p_profile->>'full_name'),
      microsoft_email = lower(btrim(p_profile->>'microsoft_email')),
      role = v_role,
      active = v_active,
      commercial_area = nullif(p_profile->>'commercial_area', ''),
      can_edit_customer_segment = coalesce((p_profile->>'can_edit_customer_segment')::boolean, false)
    where id = p_target_id
    returning * into v_target;
  end if;

  delete from public.psi_profile_area_assignments where profile_id = v_target.id;
  delete from public.psi_profile_permissions where profile_id = v_target.id;

  insert into public.psi_profile_area_assignments(profile_id, area_code, subarea_code, created_by)
  select v_target.id, item->>'area_code', case when item->'subarea_code' = 'null'::jsonb or not (item ? 'subarea_code') then null else item->>'subarea_code' end, p_actor_profile_id
  from jsonb_array_elements(p_areas) item;

  insert into public.psi_profile_permissions(profile_id, permission_code, created_by)
  select v_target.id, permission_code, p_actor_profile_id
  from jsonb_array_elements_text(p_permissions) permission_code;

  insert into public.psi_access_audit_log(actor_profile_id, target_profile_id, action, before_state, after_state)
  values (
    p_actor_profile_id,
    v_target.id,
    'profile.access.replace',
    jsonb_build_object('areas', v_before_areas, 'permissions', v_before_permissions),
    jsonb_build_object('areas', p_areas, 'permissions', p_permissions)
  );

  return jsonb_build_object(
    'id', v_target.id,
    'full_name', v_target.full_name,
    'microsoft_email', v_target.microsoft_email,
    'role', v_target.role,
    'active', v_target.active,
    'commercial_area', v_target.commercial_area,
    'can_edit_customer_segment', v_target.can_edit_customer_segment,
    'created_at', v_target.created_at
  );
end;
$$;

revoke all on function public.psi_admin_acquire_profile_lock(uuid) from public;
revoke all on function public.psi_admin_acquire_profile_lock(uuid) from authenticated;
grant execute on function public.psi_admin_acquire_profile_lock(uuid) to service_role;
revoke all on function public.psi_admin_profile_lock_owned(uuid,uuid) from public;
revoke all on function public.psi_admin_profile_lock_owned(uuid,uuid) from authenticated;
grant execute on function public.psi_admin_profile_lock_owned(uuid,uuid) to service_role;
revoke all on function public.psi_admin_release_profile_lock(uuid,uuid) from public;
revoke all on function public.psi_admin_release_profile_lock(uuid,uuid) from authenticated;
grant execute on function public.psi_admin_release_profile_lock(uuid,uuid) to service_role;
revoke all on function public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid) from public;
revoke all on function public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid) from authenticated;
grant execute on function public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid) to service_role;

commit;
