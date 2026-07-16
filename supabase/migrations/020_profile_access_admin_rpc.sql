-- Atomic profile, organizational scope, permission and audit administration.
-- Supabase Auth remains external; database authorization state changes as one PostgreSQL transaction.
begin;

alter table public.psi_sales_profiles
  add column if not exists auth_user_id uuid;

create unique index if not exists psi_sales_profiles_auth_user_id_key
  on public.psi_sales_profiles(auth_user_id)
  where auth_user_id is not null;

revoke insert, update, delete on table public.psi_sales_profiles from public;
revoke insert, update, delete on table public.psi_sales_profiles from authenticated;
grant select, insert, update, delete on table public.psi_sales_profiles to service_role;

-- Bind existing profiles to their immutable Supabase Auth subject before runtime authorization switches to UUID.
update public.psi_sales_profiles profile
set auth_user_id = auth_user.id
from auth.users auth_user
where profile.auth_user_id is null
  and lower(btrim(profile.microsoft_email)) = lower(btrim(auth_user.email));

create table if not exists public.psi_profile_auth_subject_claims (
  auth_user_id uuid primary key,
  profile_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  claimed_at timestamptz not null default now()
);
create unique index if not exists psi_profile_auth_subject_claims_profile_id_key
  on public.psi_profile_auth_subject_claims(profile_id);
insert into public.psi_profile_auth_subject_claims(auth_user_id, profile_id)
select auth_user_id, id
from public.psi_sales_profiles
where auth_user_id is not null
on conflict (auth_user_id) do nothing;
revoke all on table public.psi_profile_auth_subject_claims from public;
revoke all on table public.psi_profile_auth_subject_claims from authenticated;
revoke all on table public.psi_profile_auth_subject_claims from service_role;

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

create or replace function public.psi_admin_bind_profile_auth(p_profile_id uuid, p_expected_email text, p_auth_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated_count integer;
begin
  if p_profile_id is null or p_auth_user_id is null or nullif(btrim(p_expected_email), '') is null then
    return false;
  end if;
  if not exists (
    select 1 from auth.users auth_user
    where auth_user.id = p_auth_user_id
      and lower(btrim(auth_user.email)) = lower(btrim(p_expected_email))
  ) then
    return false;
  end if;
  perform 1
  from public.psi_sales_profiles
  where id = p_profile_id
    and active = true
    and lower(btrim(microsoft_email)) = lower(btrim(p_expected_email))
    and (auth_user_id is null or auth_user_id = p_auth_user_id)
  for update;
  if not found then
    return false;
  end if;

  insert into public.psi_profile_auth_subject_claims(auth_user_id, profile_id)
  values (p_auth_user_id, p_profile_id)
  on conflict do nothing;
  if not exists (
    select 1 from public.psi_profile_auth_subject_claims claim
    where claim.auth_user_id = p_auth_user_id and claim.profile_id = p_profile_id
  ) then
    return false;
  end if;

  update public.psi_sales_profiles
  set auth_user_id = p_auth_user_id
  where id = p_profile_id;
  get diagnostics v_updated_count = row_count;
  return v_updated_count = 1;
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
    if lower(btrim(v_target.microsoft_email)) <> lower(btrim(p_profile->>'microsoft_email')) then
      raise exception 'El correo del perfil es inmutable; cree un perfil nuevo para otra identidad.' using errcode = '22023';
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
revoke all on function public.psi_admin_release_profile_lock(uuid,uuid) from public;
revoke all on function public.psi_admin_release_profile_lock(uuid,uuid) from authenticated;
grant execute on function public.psi_admin_release_profile_lock(uuid,uuid) to service_role;
revoke all on function public.psi_admin_bind_profile_auth(uuid,text,uuid) from public;
revoke all on function public.psi_admin_bind_profile_auth(uuid,text,uuid) from authenticated;
grant execute on function public.psi_admin_bind_profile_auth(uuid,text,uuid) to service_role;
revoke all on function public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid) from public;
revoke all on function public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid) from authenticated;
grant execute on function public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid) to service_role;

-- Licitaciones is backend-only. Remove legacy direct authenticated access and
-- every RLS policy that derived runtime authorization from JWT email.
drop policy if exists psi_public_tenders_select on public.psi_public_tenders;
drop policy if exists psi_public_tenders_modify on public.psi_public_tenders;
drop policy if exists psi_tender_radar_runs_select on public.psi_tender_radar_runs;
drop policy if exists psi_tender_radar_runs_insert on public.psi_tender_radar_runs;
drop policy if exists psi_company_procurement_profile_select on public.psi_company_procurement_profile;
drop policy if exists psi_company_procurement_profile_modify on public.psi_company_procurement_profile;
drop policy if exists psi_tender_search_profiles_select on public.psi_tender_search_profiles;
drop policy if exists psi_tender_search_profiles_modify on public.psi_tender_search_profiles;
drop policy if exists psi_tender_tracking_events_select on public.psi_tender_tracking_events;
drop policy if exists psi_tender_tracking_events_modify on public.psi_tender_tracking_events;
drop policy if exists psi_tender_tracking_events_insert on public.psi_tender_tracking_events;

revoke all on public.psi_public_tenders, public.psi_tender_radar_runs,
  public.psi_company_procurement_profile, public.psi_tender_search_profiles,
  public.psi_tender_tracking_events from authenticated;
revoke all on public.psi_public_tenders, public.psi_tender_radar_runs,
  public.psi_company_procurement_profile, public.psi_tender_search_profiles,
  public.psi_tender_tracking_events from public;
grant select, insert, update, delete on public.psi_public_tenders, public.psi_tender_radar_runs,
  public.psi_company_procurement_profile, public.psi_tender_search_profiles,
  public.psi_tender_tracking_events to service_role;

-- Defense in depth for service-role-only tender RPCs. Identity is the immutable
-- profile UUID and authorization is the explicit permission assignment.
create or replace function public.psi_profile_has_tender_permission(
  p_profile_id uuid,
  p_manager_only boolean default false
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.psi_sales_profiles p
    join public.psi_profile_permissions pp
      on pp.profile_id = p.id
     and pp.permission_code = 'licitaciones'
    where p.id = p_profile_id
      and p.active = true
      and p.role in ('admin', 'gerencia', 'director', 'comercial')
      and (not p_manager_only or p.role in ('admin', 'gerencia', 'director'))
  );
$$;

revoke all on function public.psi_profile_has_tender_permission(uuid,boolean) from public;
revoke all on function public.psi_profile_has_tender_permission(uuid,boolean) from authenticated;
grant execute on function public.psi_profile_has_tender_permission(uuid,boolean) to service_role;

-- 018 may already be installed in existing environments. Converge those RPC
-- bodies in place without requiring destructive recreation of their signatures.
do $$
declare
  v_signature text;
  v_proc regprocedure;
  v_definition text;
  v_legacy_predicate text := '(p.role in (''admin'', ''director'', ''gerencia'') or lower(p.microsoft_email) = ''directora.licitaciones@seguridadnacional.co'')';
begin
  foreach v_signature in array array[
    'public.psi_update_tender_tracking(uuid,uuid,uuid,text,text,timestamptz,text,text,timestamptz)',
    'public.psi_transition_tender_tracking(uuid,uuid,text,uuid,text,timestamptz)',
    'public.psi_convert_tender_to_opportunity(uuid,uuid,text,text,uuid,text,text,numeric,date,text,text,text,text,text,text,timestamptz)',
    'public.psi_discard_tender_opportunity(uuid,uuid,text,timestamptz)'
  ] loop
    v_proc := to_regprocedure(v_signature);
    if v_proc is null then
      continue;
    end if;
    v_definition := pg_get_functiondef(v_proc);
    v_definition := replace(
      v_definition,
      v_legacy_predicate,
      'public.psi_profile_has_tender_permission(p.id, true)'
    );
    if position('microsoft_email' in lower(v_definition)) > 0 then
      raise exception 'No se pudo retirar autorización legacy por email de %', v_signature;
    end if;
    execute v_definition;
    execute format('revoke all on function %s from public', v_proc);
    execute format('revoke all on function %s from authenticated', v_proc);
    execute format('grant execute on function %s to service_role', v_proc);
  end loop;
end;
$$;

commit;
