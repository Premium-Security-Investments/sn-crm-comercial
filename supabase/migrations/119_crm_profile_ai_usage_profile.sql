-- Usuarios y permisos → "Perfil de uso de IA" (puerta única de modelos, Paso 2 parte 3; Juan Botero, 2026-10-09).
--
-- Cada persona del SIIO puede tener un perfil de uso de IA (slug de `platform.ai_usage_profile` de la Plataforma de
-- Agentes, otra base). Con él, la configuración aprobada de cada agente decide su cupo por persona. Null = sin perfil
-- (sólo aplica el cupo del equipo). La existencia y el estado (no archivado) del perfil los valida el servidor contra
-- la plataforma al guardar: aquí sólo se exige el formato.
--
-- La escritura va por psi_admin_set_profile_ai_usage_profile (sólo service_role), que bloquea la fila, rechaza
-- identidades de agentes y deja el cambio en psi_access_audit_log.
begin;

alter table public.psi_sales_profiles add column if not exists ai_usage_profile text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.psi_sales_profiles'::regclass and conname = 'psi_sales_profiles_ai_usage_profile_format') then
    alter table public.psi_sales_profiles add constraint psi_sales_profiles_ai_usage_profile_format
      check (ai_usage_profile is null or ai_usage_profile ~ '^[a-z][a-z0-9_]{1,40}$');
  end if;
end;
$$;

create or replace function public.psi_admin_set_profile_ai_usage_profile(
  p_profile_id uuid,
  p_ai_usage_profile text,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before text;
  v_identity text;
begin
  if p_profile_id is null or p_actor_profile_id is null then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  if p_ai_usage_profile is not null and p_ai_usage_profile !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'Perfil de uso de IA inválido' using errcode = '22023';
  end if;
  select ai_usage_profile, coalesce(identity_type, 'human') into v_before, v_identity
    from public.psi_sales_profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Perfil no encontrado' using errcode = 'P0002';
  end if;
  if v_identity <> 'human' then
    raise exception 'Las identidades de agentes no tienen perfil de uso de IA' using errcode = '42501';
  end if;
  if v_before is distinct from p_ai_usage_profile then
    update public.psi_sales_profiles set ai_usage_profile = p_ai_usage_profile where id = p_profile_id;
    insert into public.psi_access_audit_log(actor_profile_id, target_profile_id, action, before_state, after_state)
    values (p_actor_profile_id, p_profile_id, 'profile.ai_usage_profile.set',
            jsonb_build_object('ai_usage_profile', v_before), jsonb_build_object('ai_usage_profile', p_ai_usage_profile));
  end if;
  return jsonb_build_object('id', p_profile_id, 'ai_usage_profile', p_ai_usage_profile);
end;
$$;

revoke all on function public.psi_admin_set_profile_ai_usage_profile(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.psi_admin_set_profile_ai_usage_profile(uuid, text, uuid) to service_role;

commit;
