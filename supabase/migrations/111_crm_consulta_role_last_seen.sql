-- CRM comercial — rol "Directivo de solo consulta" y último ingreso al CRM (decisión del dueño, 2026-10-07).
--
-- 1. Rol `consulta`: un asesor externo de junta ve todo lo directivo (Dashboard comercial, oportunidades, SIIO completo,
--    Licitaciones) en sólo lectura. El servidor rechaza cualquier escritura de este rol (getAuthContext) y
--    access-control.js no le concede ninguna acción de escritura. Aquí sólo se habilita el valor del rol:
--      - el CHECK de psi_sales_profiles.role admite 'consulta';
--      - psi_admin_persist_profile_access (última definición: 020; 094 sólo cambió grants) admite el rol, le permite el
--        módulo de lectura `licitaciones` y le prohíbe cualquier permiso de operación (custodia, eliminar
--        oportunidades, pilotos de IA). Además ninguna identidad técnica (agente) se administra como usuario, y guarda
--        (auditado en psi_access_audit_log) "Puede tener oportunidades propias" (can_own_opportunities) para roles no
--        comerciales; nunca para consulta.
--    Las lecturas de SIIO y de Licitaciones del servidor van con service_role sobre tablas: no dependen de listas de
--    roles en SQL, por eso no se toca ninguna función de lectura de AGT-002 ni de SIIO.
-- 2. Último ingreso: psi_profile_last_seen guarda una marca por persona y día de Bogotá, escrita por
--    psi_touch_profile_last_seen al abrir el CRM (GET /api/bootstrap). Sustituye a auth.users.last_sign_in_at, que
--    queda viejo porque las sesiones persisten. Sólo humanos activos; como máximo una escritura por día.
-- 3. Índices para la tabla de comportamiento: seguimientos por autor y decisiones por autor.
-- 4. Luis Fernando López (admin, directorfisica@seguridadnacional.co; id en producción
--    56db0b00-4dab-4f34-a20d-54c22d76c942) queda habilitado para tener oportunidades propias (Vista Comercial), con el
--    mismo patrón protegido de 086: exactamente un perfil humano activo admin, sin tocar a nadie más.

begin;

alter table public.psi_sales_profiles drop constraint if exists psi_sales_profiles_role_check;
alter table public.psi_sales_profiles
  add constraint psi_sales_profiles_role_check
  check (role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta', 'consulta'));

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
  v_can_own boolean;
  v_before_can_own boolean := false;
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
  if v_role not in ('admin','gerencia','director','comercial','colaborador','junta','consulta') then
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
  -- 111: "Puede tener oportunidades propias (vista comercial)" para roles no comerciales. Si no viene, se conserva.
  begin
    v_can_own := case when p_profile ? 'can_own_opportunities' then (p_profile->>'can_own_opportunities')::boolean else null end;
  exception when others then
    raise exception 'Valor de oportunidades propias inválido.' using errcode = '22023';
  end;
  if v_role = 'consulta' and coalesce(v_can_own, false) then
    raise exception 'El perfil de solo consulta no puede tener oportunidades propias.' using errcode = '22023';
  end if;

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
  -- 111: el directivo de solo consulta puede VER Licitaciones (permiso de módulo `licitaciones`), pero ningún permiso de
  -- operación: ni custodia/empresa de Licitaciones ni eliminar oportunidades ni pilotos de IA. Sólo módulos de lectura.
  if p_permissions ? 'licitaciones' and v_role not in ('admin','gerencia','director','comercial','consulta') then
    raise exception 'El permiso de Licitaciones no aplica para este rol.' using errcode = '22023';
  end if;
  if v_role = 'consulta' and exists (
    select 1 from jsonb_array_elements_text(p_permissions) requested(code)
    where requested.code not in ('modulo_siio_gerencial','modulo_dashboard_comercial','modulo_alertas_comerciales','modulo_oportunidades','licitaciones')
  ) then
    raise exception 'El perfil de solo consulta no admite permisos de operación.' using errcode = '22023';
  end if;

  if p_target_id is null then
    if p_mode <> 'post' or (p_expected_profile is not null and p_expected_profile <> 'null'::jsonb) then
      raise exception 'Creación de perfil inválida.' using errcode = '22023';
    end if;
    insert into public.psi_sales_profiles (
      full_name, microsoft_email, role, active, commercial_area, can_edit_customer_segment, can_own_opportunities
    ) values (
      btrim(p_profile->>'full_name'), lower(btrim(p_profile->>'microsoft_email')), v_role, v_active,
      nullif(p_profile->>'commercial_area', ''), coalesce((p_profile->>'can_edit_customer_segment')::boolean, false),
      v_role <> 'consulta' and coalesce(v_can_own, false)
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
    -- 111: las identidades técnicas (agentes, p. ej. AGT-002) no se administran como usuarios.
    if coalesce(v_target.identity_type, 'human') <> 'human' then
      raise exception 'Identidad técnica no editable' using errcode = '42501';
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
    v_before_can_own := coalesce(v_target.can_own_opportunities, false);

    update public.psi_sales_profiles set
      full_name = btrim(p_profile->>'full_name'),
      microsoft_email = lower(btrim(p_profile->>'microsoft_email')),
      role = v_role,
      active = v_active,
      commercial_area = nullif(p_profile->>'commercial_area', ''),
      can_edit_customer_segment = coalesce((p_profile->>'can_edit_customer_segment')::boolean, false),
      can_own_opportunities = v_role <> 'consulta' and coalesce(v_can_own, v_target.can_own_opportunities, false)
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
    jsonb_build_object('areas', v_before_areas, 'permissions', v_before_permissions, 'can_own_opportunities', v_before_can_own),
    jsonb_build_object('areas', p_areas, 'permissions', p_permissions, 'can_own_opportunities', v_target.can_own_opportunities)
  );

  return jsonb_build_object(
    'id', v_target.id,
    'full_name', v_target.full_name,
    'microsoft_email', v_target.microsoft_email,
    'role', v_target.role,
    'active', v_target.active,
    'commercial_area', v_target.commercial_area,
    'can_edit_customer_segment', v_target.can_edit_customer_segment,
    'can_own_opportunities', v_target.can_own_opportunities,
    'created_at', v_target.created_at
  );
end;
$$;

revoke all on function public.psi_admin_persist_profile_access(text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.psi_admin_persist_profile_access(text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid) to service_role;

create table if not exists public.psi_profile_last_seen (
  profile_id uuid primary key references public.psi_sales_profiles(id) on delete cascade,
  last_seen_day date not null,
  last_seen_at timestamptz not null default now()
);
alter table public.psi_profile_last_seen enable row level security;
revoke all on public.psi_profile_last_seen from public, anon, authenticated;
grant select, insert, update, delete on public.psi_profile_last_seen to service_role;

-- Marca el ingreso del día (Bogotá). Devuelve true sólo cuando escribió: primera visita del día de un humano activo.
create or replace function public.psi_touch_profile_last_seen(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_written integer;
begin
  if p_profile_id is null or not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_profile_id and p.active = true and coalesce(p.identity_type, 'human') = 'human'
  ) then
    return false;
  end if;
  insert into public.psi_profile_last_seen as seen (profile_id, last_seen_day, last_seen_at)
  values (p_profile_id, v_today, now())
  on conflict (profile_id) do update
    set last_seen_day = excluded.last_seen_day, last_seen_at = excluded.last_seen_at
    where seen.last_seen_day < excluded.last_seen_day;
  get diagnostics v_written = row_count;
  return v_written = 1;
end;
$$;
revoke all on function public.psi_touch_profile_last_seen(uuid) from public, anon, authenticated;
grant execute on function public.psi_touch_profile_last_seen(uuid) to service_role;

create index if not exists idx_psi_sales_interactions_created_by_created_at
  on public.psi_sales_interactions (created_by, created_at desc);
create index if not exists idx_psi_sales_opportunity_audit_logs_decision_actor
  on public.psi_sales_opportunity_audit_logs (changed_by, created_at desc)
  where field_name = 'decision';

do $$
declare
  v_profile_id uuid;
  v_match_count integer;
  v_unrelated_enabled_before bigint;
  v_unrelated_enabled_after bigint;
begin
  select count(*), min(profile.id::text)::uuid
    into v_match_count, v_profile_id
  from public.psi_sales_profiles profile
  where lower(btrim(profile.microsoft_email)) = 'directorfisica@seguridadnacional.co'
    and profile.active = true
    and profile.role = 'admin'
    and coalesce(profile.identity_type, 'human') = 'human';

  if v_match_count <> 1 or v_profile_id is null then
    raise exception 'La vista comercial de Luis Fernando López debe resolver exactamente un perfil humano activo admin; encontrados %.', v_match_count;
  end if;

  select count(*) into v_unrelated_enabled_before
  from public.psi_sales_profiles profile
  where profile.id <> v_profile_id and profile.can_own_opportunities = true;

  update public.psi_sales_profiles set can_own_opportunities = true where id = v_profile_id;

  select count(*) into v_unrelated_enabled_after
  from public.psi_sales_profiles profile
  where profile.id <> v_profile_id and profile.can_own_opportunities = true;

  if v_unrelated_enabled_after <> v_unrelated_enabled_before then
    raise exception 'La migración alteró la capacidad comercial de perfiles no relacionados.';
  end if;
end
$$;

commit;
