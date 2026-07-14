-- Transactional tender tracking RPCs. Prepared only; do not apply from this workspace.
-- The service backend authenticates the caller, while these functions atomically enforce
-- workflow, actor, optimistic-concurrency, and immutable-event invariants.

-- Authenticated clients may read tracked tenders and their immutable history, but every
-- write must pass through these service-role RPCs after backend authentication.
drop policy if exists psi_public_tenders_modify on public.psi_public_tenders;
revoke insert, update, delete on public.psi_public_tenders from authenticated;
grant select on public.psi_public_tenders to authenticated;

drop policy if exists psi_tender_tracking_events_insert on public.psi_tender_tracking_events;
revoke insert, update, delete on public.psi_tender_tracking_events from authenticated;
grant select on public.psi_tender_tracking_events to authenticated;

-- Do not make an ambiguous historical relationship "work" by choosing a row at
-- random.  Operators must repair legacy duplicates before this prepared migration
-- can be applied.
do $$
begin
  if exists (
    select 1
    from public.psi_public_tenders
    where converted_opportunity_id is not null
    group by converted_opportunity_id
    having count(*) > 1
  ) then
    raise exception 'No se puede aplicar 018: existen varias licitaciones vinculadas a la misma oportunidad; repare converted_opportunity_id duplicados primero.';
  end if;

  if exists (
    select 1
    from public.psi_sales_opportunities
    where external_source like 'secop_radar:%'
    group by external_source
    having count(*) > 1
  ) then
    raise exception 'No se puede aplicar 018: existen oportunidades secop_radar duplicadas; repare external_source duplicados primero.';
  end if;
end;
$$;

create unique index if not exists psi_public_tenders_converted_opportunity_id_unique
  on public.psi_public_tenders (converted_opportunity_id)
  where converted_opportunity_id is not null;

create unique index if not exists psi_sales_opportunities_secop_radar_external_source_unique
  on public.psi_sales_opportunities (external_source)
  where external_source like 'secop_radar:%';

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
      and (p.role in ('admin', 'director', 'gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
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

  if p_tracking_status is null or p_tracking_status not in ('pendiente_revision', 'analizando', 'esperando_informacion', 'listo_para_decision', 'bloqueado') then
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

  if v_tender.internal_status = 'nueva' then
    if p_expected_tracking_updated_at is not null then
      raise exception 'La versión inicial de seguimiento debe ser nula.' using errcode = 'P0001';
    end if;
    v_event_type := 'entered_tracking';
  elsif v_tender.internal_status is distinct from 'en_revision' then
    raise exception 'Solo se puede iniciar seguimiento desde una licitación nueva o actualizar una en revisión.' using errcode = 'P0001';
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
      and (p.role in ('admin', 'director', 'gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
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

  if p_internal_status is null or p_internal_status not in ('nueva', 'descartada', 'convertida_oportunidad') then
    raise exception 'Transición de seguimiento inválida.' using errcode = '22023';
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

  -- The source state owns both the allowed targets and whether its token is null.
  -- Persisted NULL lifecycle states must reach the NULL-safe invalid-origin guard.
  if v_tender.internal_status = 'nueva' then
    if p_expected_tracking_updated_at is not null then
      raise exception 'La versión inicial de seguimiento debe ser nula.' using errcode = 'P0001';
    end if;
    if p_internal_status not in ('descartada', 'convertida_oportunidad') then
      raise exception 'Una licitación nueva solo puede descartarse o convertirse.' using errcode = 'P0001';
    end if;
  elsif v_tender.internal_status is distinct from 'en_revision'
    and v_tender.internal_status is distinct from 'convertida_oportunidad' then
    raise exception 'Estado de origen inválido para transición de seguimiento.' using errcode = 'P0001';
  elsif v_tender.internal_status = 'en_revision' then
    if p_expected_tracking_updated_at is null then
      raise exception 'Debe indicar la versión de seguimiento para evitar conflictos.' using errcode = 'P0001';
    end if;
    if p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
      raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
    end if;
    if not (v_tender.internal_status = 'en_revision' and p_internal_status in ('nueva', 'descartada', 'convertida_oportunidad')) then
      raise exception 'Transición de seguimiento inválida.' using errcode = 'P0001';
    end if;
  elsif v_tender.internal_status = 'convertida_oportunidad' then
    if p_expected_tracking_updated_at is null then
      raise exception 'Debe indicar la versión de seguimiento para evitar conflictos.' using errcode = 'P0001';
    end if;
    if p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
      raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
    end if;
    if p_internal_status = 'convertida_oportunidad' and p_converted_opportunity_id = v_tender.converted_opportunity_id then
      return to_jsonb(v_tender);
    end if;
    if p_internal_status is distinct from 'descartada' then
      raise exception 'Una licitación convertida solo puede descartarse.' using errcode = 'P0001';
    end if;
  else
    raise exception 'Estado de origen inválido para transición de seguimiento.' using errcode = 'P0001';
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

-- Conversion is a single database transaction: no CRM opportunity can survive if
-- its Radar state or immutable converted event cannot be persisted.
create or replace function public.psi_convert_tender_to_opportunity(
  p_tender_id uuid,
  p_actor_id uuid,
  p_external_source text,
  p_company_name text,
  p_owner_id uuid,
  p_stage_code text,
  p_service_type_code text,
  p_offer_value numeric,
  p_expected_close_date date,
  p_quote_city text,
  p_regional_nombre text,
  p_sede text,
  p_economic_sector text,
  p_tipo_producto_original text,
  p_observaciones text,
  p_expected_tracking_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tender public.psi_public_tenders%rowtype;
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_other_tender_id uuid;
  v_actor_allowed boolean;
  v_owner_active boolean;
  v_duplicate boolean := false;
  v_now timestamptz := now();
begin
  select exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id and p.active = true
      and (p.role in ('admin', 'director', 'gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  ) into v_actor_allowed;
  if not v_actor_allowed then
    raise exception 'No tiene permisos para convertir licitaciones.' using errcode = '42501';
  end if;
  if p_owner_id is null or not exists (select 1 from public.psi_sales_profiles where id = p_owner_id and active = true) then
    raise exception 'El responsable de la oportunidad no existe o está inactivo.' using errcode = '22023';
  end if;
  if p_external_source is null or p_external_source !~ '^secop_radar:.+' then
    raise exception 'El origen externo debe iniciar con secop_radar:.' using errcode = '22023';
  end if;

  select * into v_tender from public.psi_public_tenders where id = p_tender_id for update;
  if not found then
    raise exception 'La licitación no existe.' using errcode = 'P0002';
  end if;

  if v_tender.internal_status = 'convertida_oportunidad' then
    if v_tender.converted_opportunity_id is null then
      raise exception 'La licitación convertida no tiene oportunidad vinculada.' using errcode = 'P0001';
    end if;
    select * into v_opportunity from public.psi_sales_opportunities where id = v_tender.converted_opportunity_id;
    if not found or v_opportunity.external_source is distinct from p_external_source then
      raise exception 'La licitación ya está vinculada a otra oportunidad.' using errcode = 'P0001';
    end if;
    return jsonb_build_object('opportunity_id', v_opportunity.id, 'duplicate', true);
  end if;
  if v_tender.internal_status = 'nueva' then
    if p_expected_tracking_updated_at is not null then
      raise exception 'La versión inicial de seguimiento debe ser nula.' using errcode = 'P0001';
    end if;
  elsif v_tender.internal_status = 'en_revision' then
    if p_expected_tracking_updated_at is null or p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
      raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
    end if;
  else
    raise exception 'Solo una licitación nueva o en revisión puede convertirse.' using errcode = 'P0001';
  end if;

  insert into public.psi_sales_opportunities (
    company_name, owner_id, stage_code, service_type_code, offer_value, expected_close_date,
    quote_city, regional_nombre, sede, economic_sector, tipo_producto_original, observaciones, external_source
  ) values (
    p_company_name, p_owner_id, p_stage_code, p_service_type_code, p_offer_value, p_expected_close_date,
    p_quote_city, p_regional_nombre, p_sede, p_economic_sector, p_tipo_producto_original, p_observaciones, p_external_source
  ) on conflict (external_source) where external_source like 'secop_radar:%' do nothing
  returning * into v_opportunity;
  if not found then
    v_duplicate := true;
    select * into v_opportunity from public.psi_sales_opportunities where external_source = p_external_source for update;
  end if;

  select id into v_other_tender_id
  from public.psi_public_tenders
  where converted_opportunity_id = v_opportunity.id and id is distinct from p_tender_id
  for update;
  if found then
    raise exception 'La oportunidad secop_radar ya está vinculada a otra licitación.' using errcode = 'P0001';
  end if;

  update public.psi_public_tenders
  set internal_status = 'convertida_oportunidad', converted_opportunity_id = v_opportunity.id,
      tracking_owner_id = null, tracking_status = null, tracking_next_action = null,
      tracking_due_at = null, tracking_blocker = null, tracking_last_note = 'Convertida a oportunidad desde Radar.',
      tracking_started_at = null, tracking_updated_at = v_now, reviewed_by = p_actor_id, reviewed_at = v_now
  where id = p_tender_id;
  insert into public.psi_tender_tracking_events (
    tender_id, event_type, note, from_status, to_status, assigned_to, next_action, due_at, blocker, created_by
  ) values (
    p_tender_id, 'converted', 'Convertida a oportunidad desde Radar.', v_tender.internal_status,
    'convertida_oportunidad', null, null, null, null, p_actor_id
  );
  return jsonb_build_object('opportunity_id', v_opportunity.id, 'duplicate', v_duplicate);
end;
$$;

revoke all on function public.psi_convert_tender_to_opportunity(uuid, uuid, text, text, uuid, text, text, numeric, date, text, text, text, text, text, text, timestamptz) from public;
revoke all on function public.psi_convert_tender_to_opportunity(uuid, uuid, text, text, uuid, text, text, numeric, date, text, text, text, text, text, text, timestamptz) from authenticated;
grant execute on function public.psi_convert_tender_to_opportunity(uuid, uuid, text, text, uuid, text, text, numeric, date, text, text, text, text, text, text, timestamptz) to service_role;

-- Discarding a tender opportunity is one idempotent, reconciliation-safe transaction:
-- it keeps the opportunity, interaction, Radar state, and immutable event synchronized.
create or replace function public.psi_discard_tender_opportunity(
  p_opportunity_id uuid, p_actor_id uuid, p_note text, p_expected_tracking_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_tender public.psi_public_tenders%rowtype;
  v_updated_tender public.psi_public_tenders%rowtype;
  v_actor_active boolean;
  v_actor_tender_manager boolean;
  v_linked_count integer;
  v_now timestamptz := now();
  v_note text := nullif(btrim(p_note), '');
begin
  select exists (select 1 from public.psi_sales_profiles p where p.id = p_actor_id and p.active = true) into v_actor_active;
  if not v_actor_active then raise exception 'No tiene permisos sobre esta oportunidad.' using errcode = '42501'; end if;
  select * into v_opportunity from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;
  select exists (select 1 from public.psi_sales_profiles p where p.id = p_actor_id and p.active = true and (p.role in ('admin', 'director', 'gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')) into v_actor_tender_manager;
  if not v_actor_tender_manager and v_opportunity.owner_id is distinct from p_actor_id then raise exception 'No tiene permisos sobre esta oportunidad.' using errcode = '42501'; end if;
  if v_opportunity.service_type_code is distinct from 'licitacion_publica' then raise exception 'La revisión documental aplica solo para oportunidades de licitación pública.' using errcode = '22023'; end if;

  select count(*) into v_linked_count from public.psi_public_tenders where converted_opportunity_id = p_opportunity_id;
  if v_linked_count > 1 then raise exception 'Existen varias licitaciones vinculadas a esta oportunidad; repare los datos antes de descartar.' using errcode = 'P0001'; end if;
  if v_linked_count = 1 then select * into v_tender from public.psi_public_tenders where converted_opportunity_id = p_opportunity_id for update; end if;

  if v_linked_count = 0 and v_opportunity.stage_code = 'descartado' then
    return jsonb_build_object('id', p_opportunity_id, 'stage_code', 'descartado', 'internal_status', 'descartada', 'linked_tender_status', 'already_discarded');
  end if;
  if v_linked_count = 1 then
    if v_tender.internal_status is distinct from 'convertida_oportunidad' then
      raise exception 'La licitación vinculada no está convertida a esta oportunidad.' using errcode = 'P0001';
    end if;
    if p_expected_tracking_updated_at is null or p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
      raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
    end if;
  end if;

  if v_opportunity.stage_code is distinct from 'descartado' then
    update public.psi_sales_opportunities set stage_code = 'descartado', loss_notes = coalesce(v_note, 'Descartada después de revisión documental / comercial.'), next_action_at = null where id = p_opportunity_id;
    insert into public.psi_sales_interactions (opportunity_id, interaction_type, created_by, occurred_at, notes)
    values (p_opportunity_id, 'nota', p_actor_id, v_now, format('Sacar de oportunidad / descartada: %s', coalesce(v_note, 'Descartada después de revisión documental / comercial.')));
  end if;
  if v_linked_count = 0 then
    return jsonb_build_object('id', p_opportunity_id, 'stage_code', 'descartado', 'internal_status', 'descartada', 'linked_tender_status', 'not_found');
  end if;

  update public.psi_public_tenders set internal_status = 'descartada', converted_opportunity_id = null,
    tracking_owner_id = null, tracking_status = null, tracking_next_action = null, tracking_due_at = null,
    tracking_blocker = null, tracking_last_note = null, tracking_started_at = null, tracking_updated_at = null,
    reviewed_by = p_actor_id, reviewed_at = v_now where id = v_tender.id returning * into v_updated_tender;
  insert into public.psi_tender_tracking_events (tender_id, event_type, note, from_status, to_status, assigned_to, next_action, due_at, blocker, created_by)
  values (v_tender.id, 'discarded', v_note, v_tender.internal_status, 'descartada', null, null, null, null, p_actor_id);
  return jsonb_build_object('id', p_opportunity_id, 'stage_code', 'descartado', 'internal_status', 'descartada',
    'linked_tender_status', case when v_opportunity.stage_code = 'descartado' then 'reconciled' else 'discarded' end, 'tender', to_jsonb(v_updated_tender));
end;
$$;

revoke all on function public.psi_discard_tender_opportunity(uuid, uuid, text, timestamptz) from public;
revoke all on function public.psi_discard_tender_opportunity(uuid, uuid, text, timestamptz) from authenticated;
grant execute on function public.psi_discard_tender_opportunity(uuid, uuid, text, timestamptz) to service_role;
