-- AGT-002 · Post-GO: el expediente se arma con los requisitos del análisis (Juan, 2026-10-13).
-- El traspaso anterior (082/083) solo leía el formato integral V3 (`analysis_units`); con el análisis
-- inicial v2 (`requirements[]`) nunca sembraba nada y cada GO quedaba con la plantilla fija. Esta función
-- recibe los ítems ya construidos en Node a partir del reporte inicial canónico (agt002-requirements-model.js)
-- y los agrega al expediente. Solo agrega: es idempotente por item_key y no toca ítems existentes.
create or replace function public.psi_seed_tender_dossier_requirements(
  p_opportunity_id uuid,
  p_actor_id uuid,
  p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tender_id uuid;
  v_item jsonb;
  v_id uuid;
  v_inserted integer := 0;
  v_target date;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  v_tender_id := public.psi_assert_tender_dossier_go(p_opportunity_id);
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Los requisitos deben ser una lista.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 80 then
    raise exception 'Demasiados requisitos para un expediente.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'item_key', '') !~ '^agt002_req:' or length(v_item->>'item_key') > 200
       or nullif(btrim(coalesce(v_item->>'title', '')), '') is null or length(v_item->>'title') > 400 then
      raise exception 'Requisito inválido.' using errcode = '22023';
    end if;
    v_target := nullif(v_item->>'target_date', '')::date;
    v_id := null;
    insert into public.psi_tender_dossier_items (opportunity_id, tender_id, item_key, title, item_type, required, origin, created_by)
    values (p_opportunity_id, v_tender_id, v_item->>'item_key', btrim(v_item->>'title'), 'pendiente_humano',
            coalesce((v_item->>'required')::boolean, true), 'seed_agt002_post_go', p_actor_id)
    on conflict (opportunity_id, item_key) do nothing
    returning id into v_id;
    if v_id is not null then
      insert into public.psi_tender_dossier_item_actions (item_id, opportunity_id, action_type, to_status, applicability, target_date, note, actor_id)
      values (v_id, p_opportunity_id, 'created', 'pendiente', 'requerido', v_target, left(v_item->>'instruction', 4000), p_actor_id);
      v_inserted := v_inserted + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted);
end;
$$;

revoke all on function public.psi_seed_tender_dossier_requirements(uuid, uuid, jsonb) from public;
revoke all on function public.psi_seed_tender_dossier_requirements(uuid, uuid, jsonb) from anon;
revoke all on function public.psi_seed_tender_dossier_requirements(uuid, uuid, jsonb) from authenticated;
grant execute on function public.psi_seed_tender_dossier_requirements(uuid, uuid, jsonb) to service_role;
