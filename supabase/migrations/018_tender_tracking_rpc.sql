-- Transactional tender tracking RPCs. Prepared only; do not apply from this workspace.
-- The service backend authenticates the caller, while these functions atomically enforce
-- workflow, actor, optimistic-concurrency, and immutable-event invariants.

create or replace function public.psi_update_tender_tracking(
  p_tender_id uuid,
  p_actor_id uuid,
  p_tracking_owner_id uuid,
  p_tracking_status text,
  p_tracking_next_action text,
  p_tracking_due_at timestamptz,
  p_tracking_blocker text,
  p_note text,
  p_expected_tracking_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tender public.psi_public_tenders%rowtype;
  v_updated public.psi_public_tenders%rowtype;
  v_actor_allowed boolean;
  v_owner_active boolean;
  v_event_type text;
  v_now timestamptz := now();
begin
  select exists (
    select 1
    from public.psi_sales_profiles p
    where p.id = p_actor_id
      and p.active = true
      and (p.role in ('admin', 'director', 'gerencia') or p.microsoft_email = 'directora.licitaciones@seguridadnacional.co')
  ) into v_actor_allowed;
  if not v_actor_allowed then
    raise exception 'No tiene permisos para gestionar seguimiento.' using errcode = '42501';
  end if;

  select * into v_tender
  from public.psi_public_tenders
  where id = p_tender_id
  for update;
  if not found then
    raise exception 'La licitación no existe.' using errcode = 'P0002';
  end if;

  if p_tracking_status not in ('pendiente_revision', 'analizando', 'esperando_informacion', 'listo_para_decision', 'bloqueado') then
    raise exception 'Estado de seguimiento inválido.' using errcode = '22023';
  end if;

  if p_tracking_owner_id is null then
    raise exception 'Debe indicar un responsable activo.' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.psi_sales_profiles where id = p_tracking_owner_id and active = true
  ) into v_owner_active;
  if not v_owner_active then
    raise exception 'El responsable de seguimiento no existe o está inactivo.' using errcode = '22023';
  end if;

  if coalesce(v_tender.internal_status, 'nueva') = 'nueva' then
    if p_expected_tracking_updated_at is not null then
      raise exception 'La versión inicial de seguimiento debe ser nula.' using errcode = 'P0001';
    end if;
    v_event_type := 'entered_tracking';
  elsif v_tender.internal_status = 'en_revision' then
    if p_expected_tracking_updated_at is null then
      raise exception 'Debe indicar la versión de seguimiento para evitar conflictos.' using errcode = 'P0001';
    end if;
    if p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
      raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
    end if;
    if p_tracking_owner_id is distinct from v_tender.tracking_owner_id then
      v_event_type := 'assigned';
    elsif p_tracking_status = 'bloqueado' and v_tender.tracking_status is distinct from 'bloqueado' then
      v_event_type := 'blocked';
    elsif v_tender.tracking_status = 'bloqueado' and p_tracking_status is distinct from 'bloqueado' then
      v_event_type := 'unblocked';
    else
      v_event_type := 'tracking_updated';
    end if;
  else
    raise exception 'Solo se puede iniciar seguimiento desde una licitación nueva o actualizar una en revisión.' using errcode = 'P0001';
  end if;

  update public.psi_public_tenders
  set internal_status = 'en_revision',
      tracking_owner_id = p_tracking_owner_id,
      tracking_status = p_tracking_status,
      tracking_next_action = nullif(btrim(p_tracking_next_action), ''),
      tracking_due_at = p_tracking_due_at,
      tracking_blocker = nullif(btrim(p_tracking_blocker), ''),
      tracking_last_note = nullif(btrim(p_note), ''),
      tracking_started_at = coalesce(v_tender.tracking_started_at, v_now),
      tracking_updated_at = v_now,
      reviewed_by = p_actor_id,
      reviewed_at = v_now
  where id = p_tender_id
  returning * into v_updated;

  insert into public.psi_tender_tracking_events (
    tender_id, event_type, note, from_status, to_status, assigned_to, next_action, due_at, blocker, created_by
  ) values (
    p_tender_id, v_event_type, nullif(btrim(p_note), ''), v_tender.tracking_status, p_tracking_status,
    p_tracking_owner_id, nullif(btrim(p_tracking_next_action), ''), p_tracking_due_at,
    nullif(btrim(p_tracking_blocker), ''), p_actor_id
  );

  return to_jsonb(v_updated);
end;
$$;

create or replace function public.psi_transition_tender_tracking(
  p_tender_id uuid,
  p_actor_id uuid,
  p_internal_status text,
  p_converted_opportunity_id uuid,
  p_note text,
  p_expected_tracking_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tender public.psi_public_tenders%rowtype;
  v_updated public.psi_public_tenders%rowtype;
  v_actor_allowed boolean;
  v_opportunity_exists boolean;
  v_event_type text;
  v_now timestamptz := now();
begin
  select exists (
    select 1
    from public.psi_sales_profiles p
    where p.id = p_actor_id
      and p.active = true
      and (p.role in ('admin', 'director', 'gerencia') or p.microsoft_email = 'directora.licitaciones@seguridadnacional.co')
  ) into v_actor_allowed;
  if not v_actor_allowed then
    raise exception 'No tiene permisos para gestionar seguimiento.' using errcode = '42501';
  end if;

  select * into v_tender
  from public.psi_public_tenders
  where id = p_tender_id
  for update;
  if not found then
    raise exception 'La licitación no existe.' using errcode = 'P0002';
  end if;

  if v_tender.internal_status <> 'en_revision' then
    raise exception 'Solo las licitaciones en seguimiento pueden cambiar de estado.' using errcode = 'P0001';
  end if;
  if p_internal_status not in ('nueva', 'descartada', 'convertida_oportunidad') then
    raise exception 'Transición de seguimiento inválida.' using errcode = '22023';
  end if;
  if p_expected_tracking_updated_at is null then
    raise exception 'Debe indicar la versión de seguimiento para evitar conflictos.' using errcode = 'P0001';
  end if;
  if p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
    raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
  end if;

  if p_internal_status = 'convertida_oportunidad' then
    if p_converted_opportunity_id is null then
      raise exception 'Debe indicar la oportunidad convertida.' using errcode = '22023';
    end if;
    select exists (
      select 1 from public.psi_sales_opportunities where id = p_converted_opportunity_id
    ) into v_opportunity_exists;
    if not v_opportunity_exists then
      raise exception 'La oportunidad convertida no existe.' using errcode = '22023';
    end if;
  elsif p_converted_opportunity_id is not null then
    raise exception 'Solo una conversión puede indicar oportunidad.' using errcode = '22023';
  end if;

  v_event_type := case p_internal_status when 'nueva' then 'returned_to_radar' when 'descartada' then 'discarded' when 'convertida_oportunidad' then 'converted' end;

  update public.psi_public_tenders
  set internal_status = p_internal_status,
      converted_opportunity_id = case when p_internal_status = 'convertida_oportunidad' then p_converted_opportunity_id else null end,
      tracking_owner_id = null,
      tracking_status = null,
      tracking_next_action = null,
      tracking_due_at = null,
      tracking_blocker = null,
      tracking_last_note = nullif(btrim(p_note), ''),
      tracking_started_at = null,
      tracking_updated_at = v_now,
      reviewed_by = p_actor_id,
      reviewed_at = v_now
  where id = p_tender_id
  returning * into v_updated;

  insert into public.psi_tender_tracking_events (
    tender_id, event_type, note, from_status, to_status, assigned_to, next_action, due_at, blocker, created_by
  ) values (
    p_tender_id, v_event_type, nullif(btrim(p_note), ''), v_tender.internal_status, p_internal_status,
    null, null, null, null, p_actor_id
  );

  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.psi_update_tender_tracking(uuid, uuid, uuid, text, text, timestamptz, text, text, timestamptz) from public;
revoke all on function public.psi_update_tender_tracking(uuid, uuid, uuid, text, text, timestamptz, text, text, timestamptz) from authenticated;
grant execute on function public.psi_update_tender_tracking(uuid, uuid, uuid, text, text, timestamptz, text, text, timestamptz) to service_role;

revoke all on function public.psi_transition_tender_tracking(uuid, uuid, text, uuid, text, timestamptz) from public;
revoke all on function public.psi_transition_tender_tracking(uuid, uuid, text, uuid, text, timestamptz) from authenticated;
grant execute on function public.psi_transition_tender_tracking(uuid, uuid, text, uuid, text, timestamptz) to service_role;
