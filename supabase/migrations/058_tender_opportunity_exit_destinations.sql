begin;

update public.psi_public_tenders
set tracking_updated_at = coalesce(reviewed_at, updated_at, created_at, now())
where internal_status in ('convertida_oportunidad', 'en_revision')
  and tracking_updated_at is null;

alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_event_type_check;
alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_event_type_check
check (event_type in (
  'entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','returned_to_tracking','converted','discarded',
  'detected','pipeline_queued','document_discovery_started','document_import_progress','document_import_completed','document_import_partial','document_import_failed',
  'snapshot_published','documents_chunked','analysis_queued','analysis_started','analysis_completed','analysis_failed','analysis_rules_fallback_shown',
  'requirement_pending','information_requested','addendum_reviewed','observation_recorded','internal_meeting','case_note',
  'go_decided','no_go_decided','offer_preparation_started','offer_submitted','awarded','not_awarded','cancelled','deserted',
  'dossier_seeded','dossier_artifact_approved','offer_ready_for_submission'
));

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
    if v_tender.tracking_updated_at is null then
      if p_expected_tracking_updated_at is not null then
        raise exception 'La versión inicial de seguimiento debe ser nula.' using errcode = 'P0001';
      end if;
    elsif p_expected_tracking_updated_at is null or p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
      raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
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
  if v_tender.converted_opportunity_id is not null then
    raise exception 'La licitación conserva una oportunidad vinculada; gestione la salida desde la oportunidad.' using errcode = 'P0001';
  end if;

  if p_internal_status is null or p_internal_status not in ('nueva', 'descartada') then
    raise exception 'Transición de seguimiento inválida.' using errcode = '22023';
  end if;
  if p_converted_opportunity_id is not null then
    raise exception 'La transición de seguimiento no admite una oportunidad convertida.' using errcode = '22023';
  end if;

  -- The source state owns both the allowed targets and whether its token is null.
  -- Persisted NULL lifecycle states must reach the NULL-safe invalid-origin guard.
  if v_tender.internal_status = 'nueva' then
    if p_expected_tracking_updated_at is not null then
      raise exception 'La versión inicial de seguimiento debe ser nula.' using errcode = 'P0001';
    end if;
    if p_internal_status <> 'descartada' then
      raise exception 'Una licitación nueva solo puede descartarse.' using errcode = 'P0001';
    end if;
  elsif v_tender.internal_status = 'convertida_oportunidad' then
    raise exception 'Una licitación convertida debe descartarse con Sacar de oportunidad.' using errcode = 'P0001';
  elsif v_tender.internal_status is distinct from 'en_revision' then
    raise exception 'Estado de origen inválido para transición de seguimiento.' using errcode = 'P0001';
  elsif v_tender.internal_status = 'en_revision' then
    if p_expected_tracking_updated_at is null then
      raise exception 'Debe indicar la versión de seguimiento para evitar conflictos.' using errcode = 'P0001';
    end if;
    if p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
      raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
    end if;
    if not (v_tender.internal_status = 'en_revision' and p_internal_status in ('nueva', 'descartada')) then
      raise exception 'Transición de seguimiento inválida.' using errcode = 'P0001';
    end if;
  else
    raise exception 'Estado de origen inválido para transición de seguimiento.' using errcode = 'P0001';
  end if;

  v_event_type := case p_internal_status when 'nueva' then 'returned_to_radar' when 'descartada' then 'discarded' end;

  update public.psi_public_tenders
  set internal_status = p_internal_status,
      converted_opportunity_id = null,
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
revoke all on function public.psi_update_tender_tracking(uuid, uuid, uuid, text, text, timestamptz, text, text, timestamptz) from anon;
revoke all on function public.psi_update_tender_tracking(uuid, uuid, uuid, text, text, timestamptz, text, text, timestamptz) from authenticated;
grant execute on function public.psi_update_tender_tracking(uuid, uuid, uuid, text, text, timestamptz, text, text, timestamptz) to service_role;

revoke all on function public.psi_transition_tender_tracking(uuid, uuid, text, uuid, text, timestamptz) from public;
revoke all on function public.psi_transition_tender_tracking(uuid, uuid, text, uuid, text, timestamptz) from anon;
revoke all on function public.psi_transition_tender_tracking(uuid, uuid, text, uuid, text, timestamptz) from authenticated;
grant execute on function public.psi_transition_tender_tracking(uuid, uuid, text, uuid, text, timestamptz) to service_role;

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
  v_opportunity_found boolean := false;
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

  -- Lock order: psi_sales_opportunities before psi_public_tenders, matching psi_exit_tender_opportunity.
  -- A reconversion (this function) and an exit (psi_exit_tender_opportunity) can target the same
  -- tender/opportunity pair concurrently. Locking in opposite orders in the two functions would let
  -- one call hold the tender row while waiting on the opportunity row, and the other hold the
  -- opportunity row while waiting on the tender row: a classic AB-BA deadlock. Locking the opportunity
  -- first here, even though this function is keyed by p_tender_id, keeps both functions consistent.
  select * into v_opportunity
  from public.psi_sales_opportunities
  where external_source = p_external_source
  for update;
  v_opportunity_found := found;

  select * into v_tender from public.psi_public_tenders where id = p_tender_id for update;
  if not found then
    raise exception 'La licitación no existe.' using errcode = 'P0002';
  end if;

  if v_tender.internal_status = 'convertida_oportunidad' then
    if v_tender.converted_opportunity_id is null then
      raise exception 'La licitación convertida no tiene oportunidad vinculada.' using errcode = 'P0001';
    end if;
    if not v_opportunity_found or v_opportunity.id is distinct from v_tender.converted_opportunity_id then
      raise exception 'La licitación ya está vinculada a otra oportunidad.' using errcode = 'P0001';
    end if;
    return jsonb_build_object('opportunity_id', v_opportunity.id, 'duplicate', true);
  end if;
  if v_tender.internal_status = 'nueva' then
    if v_tender.tracking_updated_at is null then
      if p_expected_tracking_updated_at is not null then
        raise exception 'La versión inicial de seguimiento debe ser nula.' using errcode = 'P0001';
      end if;
    elsif p_expected_tracking_updated_at is null or p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
      raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
    end if;
  elsif v_tender.internal_status = 'en_revision' then
    if p_expected_tracking_updated_at is null or p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
      raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
    end if;
  else
    raise exception 'Solo una licitación nueva o en revisión puede convertirse.' using errcode = 'P0001';
  end if;

  if v_opportunity_found then
    -- Already locked above (opportunity-before-tender order): reuse it instead of re-querying,
    -- which would otherwise reacquire the lock out of order.
    v_duplicate := true;
  else
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
  end if;

  select id into v_other_tender_id
  from public.psi_public_tenders
  where converted_opportunity_id = v_opportunity.id and id is distinct from p_tender_id
  for update;
  if found then
    raise exception 'La oportunidad secop_radar ya está vinculada a otra licitación.' using errcode = 'P0001';
  end if;

  if v_duplicate then
    update public.psi_sales_opportunities
    set company_name = p_company_name, owner_id = p_owner_id, stage_code = p_stage_code,
        service_type_code = p_service_type_code, offer_value = p_offer_value,
        expected_close_date = p_expected_close_date, quote_city = p_quote_city,
        regional_nombre = p_regional_nombre, sede = p_sede, economic_sector = p_economic_sector,
        tipo_producto_original = p_tipo_producto_original, observaciones = p_observaciones,
        loss_notes = null, next_action_at = null
    where id = v_opportunity.id returning * into v_opportunity;
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
revoke all on function public.psi_convert_tender_to_opportunity(uuid, uuid, text, text, uuid, text, text, numeric, date, text, text, text, text, text, text, timestamptz) from anon;
revoke all on function public.psi_convert_tender_to_opportunity(uuid, uuid, text, text, uuid, text, text, numeric, date, text, text, text, text, text, text, timestamptz) from authenticated;
grant execute on function public.psi_convert_tender_to_opportunity(uuid, uuid, text, text, uuid, text, text, numeric, date, text, text, text, text, text, text, timestamptz) to service_role;

create or replace function public.psi_exit_tender_opportunity(
  p_opportunity_id uuid,
  p_actor_id uuid,
  p_destination text,
  p_note text,
  p_expected_tracking_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_tender public.psi_public_tenders%rowtype;
  v_updated_tender public.psi_public_tenders%rowtype;
  v_actor_active boolean;
  v_actor_tender_manager boolean;
  v_target_status text;
  v_event_type text;
  v_destination_label text;
  v_now timestamptz := now();
  v_note text := nullif(btrim(p_note), '');
begin
  if p_destination is null or p_destination not in ('radar', 'seguimiento') then
    raise exception 'Destino de salida inválido.' using errcode = '22023';
  end if;
  v_target_status := case p_destination when 'radar' then 'nueva' when 'seguimiento' then 'en_revision' end;
  v_event_type := case p_destination when 'radar' then 'returned_to_radar' when 'seguimiento' then 'returned_to_tracking' end;
  v_destination_label := case p_destination when 'radar' then 'Radar' when 'seguimiento' then 'Seguimiento' end;

  select exists (
    select 1 from public.psi_sales_profiles p where p.id = p_actor_id and p.active = true
  ) into v_actor_active;
  if not v_actor_active then
    raise exception 'No tiene permisos sobre esta oportunidad.' using errcode = '42501';
  end if;

  -- Lock order: psi_sales_opportunities before psi_public_tenders (see the matching note in
  -- psi_convert_tender_to_opportunity). Keep this order if this function is ever refactored.
  select * into v_opportunity
  from public.psi_sales_opportunities
  where id = p_opportunity_id
  for update;
  if not found then
    raise exception 'La oportunidad no existe.' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id and p.active = true
      and (p.role in ('admin', 'director', 'gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  ) into v_actor_tender_manager;
  if not v_actor_tender_manager and v_opportunity.owner_id is distinct from p_actor_id then
    raise exception 'No tiene permisos sobre esta oportunidad.' using errcode = '42501';
  end if;
  if v_opportunity.service_type_code is distinct from 'licitacion_publica' then
    raise exception 'La salida aplica solo para oportunidades de licitación pública.' using errcode = '22023';
  end if;

  select * into v_tender
  from public.psi_public_tenders
  where converted_opportunity_id = p_opportunity_id
  for update;
  if not found then
    raise exception 'La oportunidad no tiene una licitación vinculada.' using errcode = 'P0002';
  end if;

  if v_tender.internal_status = v_target_status then
    if v_opportunity.stage_code is distinct from 'descartado' then
      raise exception 'La salida ya ocurrió, pero la oportunidad no está conciliada.' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'id', p_opportunity_id,
      'stage_code', v_opportunity.stage_code,
      'internal_status', v_tender.internal_status,
      'linked_tender_status', 'already_' || p_destination,
      'destination', p_destination,
      'tender', to_jsonb(v_tender)
    );
  end if;

  if v_tender.internal_status is distinct from 'convertida_oportunidad' then
    raise exception 'La licitación ya salió de Oportunidades hacia otro destino.' using errcode = 'P0001';
  end if;
  if p_expected_tracking_updated_at is null
     or p_expected_tracking_updated_at is distinct from v_tender.tracking_updated_at then
    raise exception 'Seguimiento desactualizado.' using errcode = 'P0001';
  end if;

  update public.psi_sales_opportunities
  set stage_code = 'descartado',
      loss_notes = format('Salida de oportunidad hacia %s: %s', v_destination_label, coalesce(v_note, 'Sin nota adicional.')),
      next_action_at = null
  where id = p_opportunity_id
  returning * into v_opportunity;

  insert into public.psi_sales_interactions (
    opportunity_id, interaction_type, created_by, occurred_at, notes
  ) values (
    p_opportunity_id, 'nota', p_actor_id, v_now,
    format('Salida de oportunidad hacia %s: %s', v_destination_label, coalesce(v_note, 'Sin nota adicional.'))
  );

  update public.psi_public_tenders
  set internal_status = v_target_status,
      converted_opportunity_id = v_opportunity.id,
      tracking_owner_id = case when p_destination = 'seguimiento' then p_actor_id else null end,
      tracking_status = case when p_destination = 'seguimiento' then 'pendiente_revision' else null end,
      tracking_next_action = null,
      tracking_due_at = null,
      tracking_blocker = null,
      tracking_last_note = v_note,
      tracking_started_at = case when p_destination = 'seguimiento' then v_now else null end,
      tracking_updated_at = v_now,
      reviewed_by = p_actor_id,
      reviewed_at = v_now
  where id = v_tender.id
  returning * into v_updated_tender;

  insert into public.psi_tender_tracking_events (
    tender_id, event_type, note, from_status, to_status, assigned_to, next_action, due_at, blocker, created_by
  ) values (
    v_tender.id, v_event_type, v_note, v_tender.internal_status, v_target_status,
    case when p_destination = 'seguimiento' then p_actor_id else null end,
    null, null, null, p_actor_id
  );

  return jsonb_build_object(
    'id', p_opportunity_id,
    'stage_code', v_opportunity.stage_code,
    'internal_status', v_updated_tender.internal_status,
    'linked_tender_status', v_event_type,
    'destination', p_destination,
    'tender', to_jsonb(v_updated_tender)
  );
end;
$$;

revoke all on function public.psi_exit_tender_opportunity(uuid, uuid, text, text, timestamptz) from public;
revoke all on function public.psi_exit_tender_opportunity(uuid, uuid, text, text, timestamptz) from anon;
revoke all on function public.psi_exit_tender_opportunity(uuid, uuid, text, text, timestamptz) from authenticated;
grant execute on function public.psi_exit_tender_opportunity(uuid, uuid, text, text, timestamptz) to service_role;

create or replace function public.psi_list_tender_opportunity_page(p_filter text, p_limit int, p_offset int)
returns table (tender jsonb, opportunity jsonb, latest_decision jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_filter is null or p_filter not in ('all', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed') then
    raise exception 'El filtro de oportunidades no es válido.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'El límite debe estar entre 1 y 50.' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'El desplazamiento debe estar entre 0 y 10000.' using errcode = '22023';
  end if;

  return query
  select
    to_jsonb(t) as tender,
    to_jsonb(o) as opportunity,
    case when d.id is null then null else jsonb_build_object(
      'id', d.id,
      'opportunity_id', d.opportunity_id,
      'tender_id', d.tender_id,
      'decision', d.decision,
      'decided_at', d.decided_at,
      'psi_sales_profiles', case when actor.id is null then null else jsonb_build_object('full_name', actor.full_name) end
    ) end as latest_decision
  from public.psi_public_tenders t
  join public.psi_sales_opportunities o on o.id = t.converted_opportunity_id
  left join lateral (
    select d.*
    from public.psi_tender_go_no_go_decisions d
    where d.opportunity_id = o.id and d.tender_id = t.id
      and not exists (
        select 1 from public.psi_tender_go_no_go_decisions child
        where child.supersedes_decision_id = d.id
      )
    order by d.decided_at desc, d.id desc
    limit 1
  ) d on true
  left join public.psi_sales_profiles actor on actor.id = d.decided_by
  where t.internal_status = 'convertida_oportunidad'
    and (
    p_filter = 'all'
    or (p_filter = 'pending_decision' and coalesce(o.tender_offer_status, 'pendiente_decision') = 'pendiente_decision' and d.id is null)
    or (p_filter = 'go_authorized' and d.decision = 'go' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('en_preparacion', 'lista_para_presentar', 'presentada'))
    or (p_filter = 'in_preparation' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('en_preparacion', 'lista_para_presentar'))
    or (p_filter = 'submitted' and coalesce(o.tender_offer_status, 'pendiente_decision') = 'presentada')
    or (p_filter = 'closed' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('cerrada_no_go', 'adjudicada', 'no_adjudicada'))
    )
  order by t.tracking_updated_at desc nulls last, t.id asc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.psi_list_tender_opportunity_page(text, int, int) from public;
revoke all on function public.psi_list_tender_opportunity_page(text, int, int) from anon;
revoke all on function public.psi_list_tender_opportunity_page(text, int, int) from authenticated;
revoke all on function public.psi_list_tender_opportunity_page(text, int, int) from service_role;
grant execute on function public.psi_list_tender_opportunity_page(text, int, int) to service_role;

drop function if exists public.psi_discard_tender_opportunity(uuid, uuid, text, timestamptz);

commit;
