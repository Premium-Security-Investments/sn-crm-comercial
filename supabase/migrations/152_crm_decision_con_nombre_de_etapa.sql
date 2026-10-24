-- AGT-003 Vig-IA Comercial — la nota de una decisión dice el nombre de la etapa, no su código (Juan, 2026-10-23).
--
-- Al mover una etapa, `psi_record_opportunity_decision` deja un seguimiento en el historial de la ficha. El texto lo
-- armaba con el CÓDIGO: "Avanza a negociacion: …" —sin tilde— y en las pérdidas "Descartada (competencia): …" con el
-- código del motivo. El defecto venía del botón "Decidir" de la ficha desde siempre; estaba escondido porque casi no
-- se usaba para avanzar: en todo el historial sólo hay DOS notas así (una del 2026-10-15 y la del 2026-10-23, de la
-- primera prueba del chat). Ahora que el chat mueve la etapa con una frase, esto va a salir seguido, y el día que
-- alguien avance a Envío de Oferta el historial diría "Avanza a envio_oferta".
--
-- Cambia SÓLO el texto de ese seguimiento: se resuelven el nombre de la etapa y el nombre del motivo, y se usan en la
-- nota. Ninguna regla de la decisión se toca —ni el orden de las etapas, ni la ventana de la próxima gestión, ni la
-- validación del motivo, ni lo que se escribe en la oportunidad y en la auditoría—. La validación del motivo pasa de
-- `exists` a leer su nombre, que comprueba lo mismo (existe y está activo) y además sirve para el texto.
--
-- Al final se corrigen las dos notas viejas: se reemplaza únicamente el arranque que escribió el sistema y se
-- conserva intacta la frase del comercial.
begin;

create or replace function public.psi_record_opportunity_decision(
  p_opportunity_id uuid,
  p_actor_profile_id uuid,
  p_decision text,
  p_notes text,
  p_interaction_type text default null::text,
  p_next_action_at timestamp with time zone default null::timestamp with time zone,
  p_stage_code text default null::text,
  p_offer_value numeric default null::numeric,
  p_freeze_days integer default null::integer,
  p_loss_reason_code text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.psi_sales_opportunities%rowtype;
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_notes text := btrim(coalesce(p_notes, ''));
  v_current_order integer;
  v_target_order integer;
  v_target_terminal boolean;
  -- Nombres para el texto del seguimiento: lo que lee una persona en la ficha.
  v_target_name text;
  v_reason_name text;
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
    select stage_order, is_terminal, name into v_target_order, v_target_terminal, v_target_name
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
    -- Mismo control que antes (el motivo existe y está activo), leyendo además su nombre para el texto.
    select name into v_reason_name
      from public.psi_sales_loss_reasons where code = p_loss_reason_code and active;
    if p_loss_reason_code is null or v_reason_name is null then
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
      -- Nombre de la etapa, no su código: "Avanza a Negociación", no "Avanza a negociacion".
      when 'advance' then 'Avanza a ' || v_target_name || ': ' || v_notes
      when 'freeze' then 'Congelada hasta ' || to_char(v_frozen_until, 'DD/MM/YYYY') || ': ' || v_notes
      when 'discard' then 'Descartada (' || v_reason_name || '): ' || v_notes
      when 'request_delete' then 'Solicitud de eliminación: ' || v_notes
      else 'Perdida (' || v_reason_name || '): ' || v_notes
    end,
    now()
  ) returning id into v_interaction_id;

  insert into public.psi_sales_opportunity_audit_logs (opportunity_id, changed_by, field_name, old_value, new_value, notes)
  values (p_opportunity_id, p_actor_profile_id, 'decision', v_row.stage_code, p_decision, 'Decisión registrada desde el CRM comercial');

  return jsonb_build_object('opportunity_id', p_opportunity_id, 'decision', p_decision, 'interaction_id', v_interaction_id, 'frozen_until', v_frozen_until);
end;
$function$;

-- Las notas viejas: se cambia SÓLO el arranque que escribió el sistema y se conserva la frase del comercial. Al
-- 2026-10-23 son dos filas ("Avanza a aprobado" del 15 de octubre y "Avanza a negociacion" del 23). La condición
-- exige que el texto empiece por el código, así que una nota ya corregida no se vuelve a tocar.
update public.psi_sales_interactions i
set notes = 'Avanza a ' || s.name || substring(i.notes from length('Avanza a ' || s.code) + 1)
from public.psi_sales_pipeline_stages s
where i.interaction_type = 'cambio_estado'
  and i.notes like 'Avanza a ' || s.code || ': %';

update public.psi_sales_interactions i
set notes = 'Descartada (' || r.name || ')' || substring(i.notes from length('Descartada (' || r.code || ')') + 1)
from public.psi_sales_loss_reasons r
where i.interaction_type = 'cambio_estado'
  and i.notes like 'Descartada (' || r.code || '):%';

update public.psi_sales_interactions i
set notes = 'Perdida (' || r.name || ')' || substring(i.notes from length('Perdida (' || r.code || ')') + 1)
from public.psi_sales_loss_reasons r
where i.interaction_type = 'cambio_estado'
  and i.notes like 'Perdida (' || r.code || '):%';

commit;
