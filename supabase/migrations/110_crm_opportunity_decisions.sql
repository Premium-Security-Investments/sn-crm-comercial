-- CRM comercial — toda oportunidad abierta tiene una decisión vigente (decisión del dueño, 2026-10-07).
--
-- Una oportunidad comercial activa queda "pendiente de decisión" cuando su próxima gestión se vence o no existe.
-- El comercial la resuelve con una de cinco decisiones, registradas de forma atómica (oportunidad + seguimiento +
-- auditoría):
--   continue  sigue viva: próxima gestión (hoy .. +90 días) y qué pasó.
--   advance   avanza de etapa (o se gana): nueva etapa y, si sigue abierta, próxima gestión.
--   freeze    se congela 30, 60 o 90 días con motivo: sale del pipeline y vuelve sola al vencer.
--   discard   se descarta con motivo.
--   lose      se pierde con motivo.
--   request_delete  pide eliminarla (duplicada, creada por error…). Queda marcada, fuera de las cifras, hasta que el
--                   director comercial confirme la eliminación o la rechace. Confirmar exige el permiso
--                   crm_eliminar_oportunidades, que por decisión del dueño tiene sólo Luis Fernando López.
-- Una eliminación confirmada es lógica: la fila queda con deleted_at y desaparece de la vista que usan todas las
-- pantallas; el historial (seguimientos y auditoría) se conserva.
-- Las licitaciones públicas (dominio AGT-002) no pasan por esta regla.

begin;

alter table public.psi_sales_opportunities
  add column if not exists frozen_until date,
  add column if not exists frozen_reason text,
  add column if not exists frozen_at timestamptz,
  add column if not exists frozen_by uuid references public.psi_sales_profiles(id),
  add column if not exists delete_requested_at timestamptz,
  add column if not exists delete_requested_by uuid references public.psi_sales_profiles(id),
  add column if not exists delete_request_reason text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.psi_sales_profiles(id);

alter table public.psi_sales_opportunities
  drop constraint if exists psi_sales_opportunities_frozen_reason_check;
alter table public.psi_sales_opportunities
  add constraint psi_sales_opportunities_frozen_reason_check
  check (frozen_until is null or length(btrim(coalesce(frozen_reason, ''))) >= 3);

create or replace function public.psi_record_opportunity_decision(
  p_opportunity_id uuid,
  p_actor_profile_id uuid,
  p_decision text,
  p_notes text,
  p_interaction_type text default null,
  p_next_action_at timestamptz default null,
  p_stage_code text default null,
  p_offer_value numeric default null,
  p_freeze_days integer default null,
  p_loss_reason_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.psi_sales_opportunities%rowtype;
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_notes text := btrim(coalesce(p_notes, ''));
  v_current_order integer;
  v_target_order integer;
  v_target_terminal boolean;
  v_interaction_type text;
  v_frozen_until date;
  v_interaction_id uuid;
begin
  if p_decision not in ('continue', 'advance', 'freeze', 'discard', 'lose', 'request_delete') then
    raise exception 'Decisión no reconocida.' using errcode = '22023';
  end if;
  if length(v_notes) < 5 then
    raise exception 'Escriba en una frase qué pasó o por qué decide esto.' using errcode = '22023';
  end if;

  select * into v_row from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found or v_row.deleted_at is not null then
    raise exception 'Oportunidad no encontrada.' using errcode = 'P0002';
  end if;
  if v_row.delete_requested_at is not null then
    raise exception 'La oportunidad tiene una solicitud de eliminación pendiente del director comercial.' using errcode = '22023';
  end if;
  if v_row.service_type_code = 'licitacion_publica' then
    raise exception 'Las licitaciones públicas se deciden en Licitaciones.' using errcode = '22023';
  end if;
  if v_row.stage_code in ('aprobado', 'descartado', 'perdido') then
    raise exception 'La oportunidad ya está cerrada.' using errcode = '22023';
  end if;
  if p_offer_value is not null and p_offer_value < 0 then
    raise exception 'El valor no puede ser negativo.' using errcode = '22023';
  end if;

  if p_decision = 'continue' then
    if p_next_action_at is null
      or (p_next_action_at at time zone 'America/Bogota')::date < v_today
      or (p_next_action_at at time zone 'America/Bogota')::date > v_today + 90 then
      raise exception 'La próxima gestión debe quedar entre hoy y los próximos 90 días.' using errcode = '22023';
    end if;
    v_interaction_type := coalesce(nullif(p_interaction_type, ''), 'nota');
    if v_interaction_type not in ('llamada', 'correo', 'reunion', 'whatsapp', 'nota') then
      raise exception 'Tipo de seguimiento no válido.' using errcode = '22023';
    end if;
    update public.psi_sales_opportunities set
      next_action_at = p_next_action_at,
      last_interaction_at = now(),
      offer_value = coalesce(p_offer_value, offer_value),
      frozen_until = null, frozen_reason = null, frozen_at = null, frozen_by = null
    where id = p_opportunity_id;

  elsif p_decision = 'advance' then
    select stage_order into v_current_order from public.psi_sales_pipeline_stages where code = v_row.stage_code;
    select stage_order, is_terminal into v_target_order, v_target_terminal
      from public.psi_sales_pipeline_stages where code = p_stage_code;
    if v_target_order is null or p_stage_code in ('descartado', 'perdido') or v_target_order <= coalesce(v_current_order, 0) then
      raise exception 'Escoja una etapa más avanzada que la actual.' using errcode = '22023';
    end if;
    if not v_target_terminal and (p_next_action_at is null
      or (p_next_action_at at time zone 'America/Bogota')::date < v_today
      or (p_next_action_at at time zone 'America/Bogota')::date > v_today + 90) then
      raise exception 'La próxima gestión debe quedar entre hoy y los próximos 90 días.' using errcode = '22023';
    end if;
    v_interaction_type := 'cambio_estado';
    update public.psi_sales_opportunities set
      stage_code = p_stage_code,
      next_action_at = case when v_target_terminal then null else p_next_action_at end,
      approved_at = case when p_stage_code = 'aprobado' then now() else approved_at end,
      last_interaction_at = now(),
      offer_value = coalesce(p_offer_value, offer_value),
      frozen_until = null, frozen_reason = null, frozen_at = null, frozen_by = null
    where id = p_opportunity_id;

  elsif p_decision = 'freeze' then
    if p_freeze_days not in (30, 60, 90) then
      raise exception 'Se puede congelar 30, 60 o 90 días.' using errcode = '22023';
    end if;
    v_frozen_until := v_today + p_freeze_days;
    v_interaction_type := 'cambio_estado';
    -- Al vencer el congelamiento la próxima gestión queda vencida y la oportunidad vuelve a pedir decisión.
    update public.psi_sales_opportunities set
      frozen_until = v_frozen_until,
      frozen_reason = v_notes,
      frozen_at = now(),
      frozen_by = p_actor_profile_id,
      next_action_at = (v_frozen_until::timestamp + time '08:00') at time zone 'America/Bogota',
      last_interaction_at = now()
    where id = p_opportunity_id;

  elsif p_decision = 'request_delete' then
    v_interaction_type := 'nota';
    update public.psi_sales_opportunities set
      delete_requested_at = now(),
      delete_requested_by = p_actor_profile_id,
      delete_request_reason = v_notes
    where id = p_opportunity_id;

  else
    if p_loss_reason_code is null or not exists (
      select 1 from public.psi_sales_loss_reasons where code = p_loss_reason_code and active
    ) then
      raise exception 'Escoja el motivo.' using errcode = '22023';
    end if;
    v_interaction_type := 'cambio_estado';
    update public.psi_sales_opportunities set
      stage_code = case when p_decision = 'discard' then 'descartado' else 'perdido' end,
      loss_reason_code = p_loss_reason_code,
      loss_notes = v_notes,
      discarded_at = case when p_decision = 'discard' then now() else discarded_at end,
      lost_at = case when p_decision = 'lose' then now() else lost_at end,
      next_action_at = null,
      last_interaction_at = now(),
      frozen_until = null, frozen_reason = null, frozen_at = null, frozen_by = null
    where id = p_opportunity_id;
  end if;

  insert into public.psi_sales_interactions (opportunity_id, created_by, interaction_type, notes, occurred_at)
  values (
    p_opportunity_id,
    p_actor_profile_id,
    v_interaction_type,
    case p_decision
      when 'continue' then v_notes
      when 'advance' then 'Avanza a ' || p_stage_code || ': ' || v_notes
      when 'freeze' then 'Congelada hasta ' || to_char(v_frozen_until, 'DD/MM/YYYY') || ': ' || v_notes
      when 'discard' then 'Descartada (' || p_loss_reason_code || '): ' || v_notes
      when 'request_delete' then 'Solicitud de eliminación: ' || v_notes
      else 'Perdida (' || p_loss_reason_code || '): ' || v_notes
    end,
    now()
  ) returning id into v_interaction_id;

  insert into public.psi_sales_opportunity_audit_logs (opportunity_id, changed_by, field_name, old_value, new_value, notes)
  values (p_opportunity_id, p_actor_profile_id, 'decision', v_row.stage_code, p_decision, 'Decisión registrada desde el CRM comercial');

  return jsonb_build_object('opportunity_id', p_opportunity_id, 'decision', p_decision, 'interaction_id', v_interaction_id, 'frozen_until', v_frozen_until);
end;
$$;

revoke all on function public.psi_record_opportunity_decision(uuid, uuid, text, text, text, timestamptz, text, numeric, integer, text) from public, anon, authenticated;
grant execute on function public.psi_record_opportunity_decision(uuid, uuid, text, text, text, timestamptz, text, numeric, integer, text) to service_role;

-- Resolución de una solicitud de eliminación. La autorización (director comercial / admin) la exige el servidor.
create or replace function public.psi_resolve_opportunity_delete_request(
  p_opportunity_id uuid,
  p_actor_profile_id uuid,
  p_approve boolean,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.psi_sales_opportunities%rowtype;
  v_notes text := btrim(coalesce(p_notes, ''));
begin
  select * into v_row from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found or v_row.deleted_at is not null then
    raise exception 'Oportunidad no encontrada.' using errcode = 'P0002';
  end if;
  if v_row.delete_requested_at is null then
    raise exception 'La oportunidad no tiene una solicitud de eliminación pendiente.' using errcode = '22023';
  end if;
  if not p_approve and length(v_notes) < 5 then
    raise exception 'Escriba por qué no se elimina, para que el comercial sepa qué hacer.' using errcode = '22023';
  end if;

  if p_approve then
    update public.psi_sales_opportunities set deleted_at = now(), deleted_by = p_actor_profile_id where id = p_opportunity_id;
  else
    update public.psi_sales_opportunities set delete_requested_at = null, delete_requested_by = null, delete_request_reason = null
    where id = p_opportunity_id;
  end if;

  insert into public.psi_sales_interactions (opportunity_id, created_by, interaction_type, notes, occurred_at)
  values (p_opportunity_id, p_actor_profile_id, 'nota',
    case when p_approve then 'Eliminación confirmada por el director comercial' || coalesce(nullif(': ' || v_notes, ': '), '')
         else 'Eliminación rechazada por el director comercial: ' || v_notes end,
    now());
  insert into public.psi_sales_opportunity_audit_logs (opportunity_id, changed_by, field_name, old_value, new_value, notes)
  values (p_opportunity_id, p_actor_profile_id, 'deleted_at', null, case when p_approve then 'eliminada' else 'rechazada' end,
    coalesce(nullif(v_notes, ''), v_row.delete_request_reason));

  return jsonb_build_object('opportunity_id', p_opportunity_id, 'deleted', p_approve);
end;
$$;

revoke all on function public.psi_resolve_opportunity_delete_request(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.psi_resolve_opportunity_delete_request(uuid, uuid, boolean, text) to service_role;

-- Permiso de capacidad: confirmar o rechazar eliminaciones. Por decisión del dueño (2026-10-07) sólo Luis Fernando
-- López (director comercial). Se administra luego desde Usuarios y permisos.
insert into public.psi_access_permissions (code, name, description, active)
values ('crm_eliminar_oportunidades', 'Eliminar oportunidades',
  'Autoridad para confirmar o rechazar las solicitudes de eliminación de oportunidades comerciales.', true)
on conflict (code) do update set name = excluded.name, description = excluded.description, active = true;

do $$
declare
  v_profile_id uuid;
  v_match_count integer;
begin
  select count(*), min(id::text)::uuid into v_match_count, v_profile_id
  from public.psi_sales_profiles
  where lower(btrim(microsoft_email)) = 'directorfisica@seguridadnacional.co'
    and active = true
    and coalesce(identity_type, 'human') = 'human';
  if v_match_count <> 1 or v_profile_id is null then
    raise exception 'El permiso de eliminar oportunidades debe resolver exactamente a Luis Fernando López (activo y humano).';
  end if;
  insert into public.psi_profile_permissions (profile_id, permission_code, created_by)
  values (v_profile_id, 'crm_eliminar_oportunidades', v_profile_id)
  on conflict (profile_id, permission_code) do nothing;
  if (select count(*) from public.psi_profile_permissions where permission_code = 'crm_eliminar_oportunidades') <> 1 then
    raise exception 'El permiso de eliminar oportunidades no quedó limitado a una sola persona.';
  end if;
end
$$;

-- La vista que usan todas las pantallas deja de mostrar oportunidades eliminadas y expone el estado de decisión.
-- Mismas columnas y en el mismo orden que la definición vigente; las nuevas van al final.
create or replace view public.v_psi_sales_opportunity_enriched as
 SELECT o.id,
    o.owner_id,
    o.company_name,
    o.economic_sector,
    o.decision_maker_name,
    o.decision_maker_email,
    o.decision_maker_phone,
    o.quote_city,
    o.quote_date,
    o.offer_value,
    o.service_type_code,
    o.stage_code,
    o.loss_reason_code,
    o.loss_notes,
    o.last_interaction_at,
    o.next_action_at,
    o.expected_close_date,
    o.commission_rate,
    o.approved_at,
    o.discarded_at,
    o.lost_at,
    o.created_at,
    o.updated_at,
    o.legacy_excel_id,
    o.excel_hoja_origen,
    o.tipo_oportunidad,
    o.item_origen,
    o.cliente_clave_normalizada,
    o.sede,
    o.mes_origen,
    o.anio_origen,
    o.regional_nombre,
    o.estado_pipeline_original,
    o.tipo_producto_original,
    o.unidad,
    o.valor_servicio,
    o.valor_proyecto,
    o.tipo_seguimiento_migrado,
    o.fecha_cierre_estimada_original,
    o.fecha_estimada_es_aproximada,
    o.observaciones,
    o.external_source,
    o.requiere_revision,
    p.full_name AS owner_name,
    p.microsoft_email AS owner_email,
    st.name AS stage_name,
    st.stage_order,
    st.close_probability,
    st.is_terminal,
    st.counts_as_sale,
    sv.name AS service_type_name,
    lr.name AS loss_reason_name,
    (o.offer_value * st.close_probability)::numeric(14,2) AS weighted_pipeline_value,
        CASE
            WHEN o.stage_code = 'aprobado'::text THEN (o.offer_value * o.commission_rate)::numeric(14,2)
            ELSE 0::numeric(14,2)
        END AS earned_commission,
        CASE
            WHEN st.is_terminal = false THEN (o.offer_value * st.close_probability * o.commission_rate)::numeric(14,2)
            ELSE 0::numeric(14,2)
        END AS projected_commission,
    COALESCE(o.last_interaction_at, o.updated_at, o.created_at) AS prioritization_date,
    o.frozen_until,
    o.frozen_reason,
    o.delete_requested_at,
    o.delete_request_reason,
    o.delete_requested_by
   FROM psi_sales_opportunities o
     LEFT JOIN psi_sales_profiles p ON p.id = o.owner_id
     LEFT JOIN psi_sales_pipeline_stages st ON st.code = o.stage_code
     LEFT JOIN psi_sales_service_types sv ON sv.code = o.service_type_code
     LEFT JOIN psi_sales_loss_reasons lr ON lr.code = o.loss_reason_code
  WHERE o.deleted_at IS NULL;

commit;
