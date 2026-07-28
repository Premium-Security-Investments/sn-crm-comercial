-- Siembra idempotente del expediente al GO desde la preparación de oferta vigente.
-- Reejecutable como backfill NO destructivo. Sin LLM, 100% determinístico.
begin;

-- Artefactos obligatorios (deben tener versión humana aprobada para el gate).
-- Todos los pendientes humanos sembrados son requeridos. La salida excepcional es no_aplica justificado y aprobado.
create or replace function public.psi_seed_tender_dossier(p_opportunity_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tender_id uuid;
  v_prep jsonb;
  v_item jsonb;
  v_seeded boolean := false;
  v_required_artifacts text[] := array['carta_presentacion','declaracion_no_inhabilidades','matriz_cumplimiento','propuesta_tecnica_base'];
  v_new_item_id uuid;
  v_new_artifact_id uuid;
begin
  -- No exige rol manager: se invoca desde el wrapper de GO (ya autorizado) y como backfill de servicio.
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  v_tender_id := public.psi_assert_tender_dossier_go(p_opportunity_id);

  select public.psi_safe_jsonb(i.notes) into v_prep
    from public.psi_sales_interactions i
    where i.opportunity_id = p_opportunity_id and i.interaction_type = 'documento'
      and public.psi_safe_jsonb(i.notes)->>'kind' = 'tender_offer_preparation'
    order by i.occurred_at desc, i.id desc limit 1;
  if v_prep is null then
    return jsonb_build_object('seeded', false, 'reason', 'sin_preparacion');
  end if;

  -- Ítems: pendientes humanos.
  for v_item in select * from jsonb_array_elements(coalesce(v_prep->'human_required_items', '[]'::jsonb)) loop
    if nullif(btrim(v_item->>'key'), '') is null then continue; end if;
    insert into public.psi_tender_dossier_items (opportunity_id, tender_id, item_key, title, item_type, required, origin, created_by)
    values (p_opportunity_id, v_tender_id, v_item->>'key', coalesce(nullif(btrim(v_item->>'title'), ''), v_item->>'key'),
            'pendiente_humano', true, 'seed_go', p_actor_id)
    on conflict (opportunity_id, item_key) do nothing
    returning id into v_new_item_id;
    if v_new_item_id is not null then
      insert into public.psi_tender_dossier_item_actions (item_id, opportunity_id, action_type, to_status, applicability, actor_id)
      values (v_new_item_id, p_opportunity_id, 'created', 'pendiente', 'requerido', p_actor_id);
      v_seeded := true;
    end if;
  end loop;

  -- Ítems: documentos planificados (como ítem informativo) + artefactos (identidad).
  for v_item in select * from jsonb_array_elements(coalesce(v_prep->'planned_documents', '[]'::jsonb)) loop
    if nullif(btrim(v_item->>'key'), '') is null then continue; end if;
    insert into public.psi_tender_dossier_items (opportunity_id, tender_id, item_key, title, item_type, required, origin, created_by)
    values (p_opportunity_id, v_tender_id, 'doc_' || (v_item->>'key'),
            coalesce(nullif(btrim(v_item->>'name'), ''), v_item->>'key'), 'documento', false, 'seed_go', p_actor_id)
    on conflict (opportunity_id, item_key) do nothing
    returning id into v_new_item_id;
    if v_new_item_id is not null then
      insert into public.psi_tender_dossier_item_actions (item_id, opportunity_id, action_type, to_status, applicability, actor_id)
      values (v_new_item_id, p_opportunity_id, 'created', 'pendiente', 'requerido', p_actor_id);
      v_seeded := true;
    end if;

    insert into public.psi_tender_dossier_artifacts (opportunity_id, tender_id, artifact_key, title, required, origin, created_by)
    values (p_opportunity_id, v_tender_id, v_item->>'key', coalesce(nullif(btrim(v_item->>'name'), ''), v_item->>'key'),
            (v_item->>'key') = any(v_required_artifacts), 'seed_go', p_actor_id)
    on conflict (opportunity_id, artifact_key) do nothing
    returning id into v_new_artifact_id;
    if v_new_artifact_id is not null then v_seeded := true; end if;
  end loop;

  -- Guard de existencia: en producción psi_append_tender_tracking_event siempre existe (migración 035);
  -- en pruebas PGlite aisladas de 041 (sin 035 aplicada) la siembra debe seguir siendo segura y reejecutable.
  if v_seeded and to_regprocedure(
    'public.psi_append_tender_tracking_event(uuid,text,text,uuid,text,uuid,jsonb,text,boolean)'
  ) is not null then
    perform public.psi_append_tender_tracking_event(
      v_tender_id, 'dossier_seeded', 'human', p_actor_id, 'dossier', p_opportunity_id,
      jsonb_build_object('opportunity_id', p_opportunity_id), 'Expediente operativo sembrado desde la preparación.', true);
  end if;
  return jsonb_build_object('seeded', v_seeded);
end;
$$;

revoke all on function public.psi_seed_tender_dossier(uuid,uuid) from public;
revoke all on function public.psi_seed_tender_dossier(uuid,uuid) from anon;
revoke all on function public.psi_seed_tender_dossier(uuid,uuid) from authenticated;
grant execute on function public.psi_seed_tender_dossier(uuid,uuid) to service_role;

-- Wrapper de GO (rename-to-core, patrón migración 039).
do $$
begin
  if to_regprocedure('public.psi_record_tender_go_no_go_core_041(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is null then
    if to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is null then
      raise exception 'Migration 041 requires the eight-argument psi_record_tender_go_no_go RPC.';
    end if;
    execute 'alter function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) rename to psi_record_tender_go_no_go_core_041';
  end if;
end;
$$;

revoke all on function public.psi_record_tender_go_no_go_core_041(uuid, uuid, uuid, text, uuid, text, jsonb, text) from public;
revoke all on function public.psi_record_tender_go_no_go_core_041(uuid, uuid, uuid, text, uuid, text, jsonb, text) from anon;
revoke all on function public.psi_record_tender_go_no_go_core_041(uuid, uuid, uuid, text, uuid, text, jsonb, text) from authenticated;
revoke all on function public.psi_record_tender_go_no_go_core_041(uuid, uuid, uuid, text, uuid, text, jsonb, text) from service_role;

create or replace function public.psi_record_tender_go_no_go(
  p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text,
  p_analysis_run_id uuid, p_justification text, p_preparation jsonb, p_document_hash text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  v_result := public.psi_record_tender_go_no_go_core_041(
    p_opportunity_id, p_tender_id, p_actor_id, p_decision, p_analysis_run_id, p_justification, p_preparation, p_document_hash);
  if p_decision = 'go' then
    perform public.psi_seed_tender_dossier(p_opportunity_id, p_actor_id);
  end if;
  return v_result;
end;
$$;

revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from public;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from anon;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from authenticated;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from service_role;
grant execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) to service_role;

commit;
