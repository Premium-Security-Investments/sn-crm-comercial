-- Gate humano determinístico para lista_para_presentar. Envuelve la transición existente
-- sin cambiar su autorización (rename-to-core, patrón 039). No permite lista_para_presentar
-- hasta que: ítems requeridos listos/no_aplica, artefactos obligatorios aprobados, sin bloqueantes.
begin;

-- Definición COMPLETA de readiness (reemplaza el stub de 040 vía create or replace).
create or replace function public.psi_evaluate_tender_dossier_readiness(p_opportunity_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with proj as (
    select i.id, i.item_key, i.title, i.required, public.psi_project_tender_dossier_item(i.id) as p
    from public.psi_tender_dossier_items i where i.opportunity_id = p_opportunity_id),
  items as (
    select id, item_key, title, required, p->>'status' as status, p->>'applicability' as applicability from proj),
  pending_required as (
    select item_key, title from items
    where required and not (status = 'listo' or applicability = 'no_aplica')),
  blockers as (
    select item_key, title from items where status = 'bloqueado'),
  art as (
    select a.artifact_key, a.title, public.psi_project_tender_dossier_artifact(a.id)->>'has_approved_version' as approved
    from public.psi_tender_dossier_artifacts a where a.opportunity_id = p_opportunity_id and a.required),
  unapproved as (select artifact_key, title from art where approved is distinct from 'true')
  select jsonb_build_object(
    'ready', not exists (select 1 from pending_required)
         and not exists (select 1 from blockers)
         and not exists (select 1 from unapproved),
    'pending_required_items', coalesce((select jsonb_agg(jsonb_build_object('item_key', item_key, 'title', title)) from pending_required), '[]'::jsonb),
    'blocking_items', coalesce((select jsonb_agg(jsonb_build_object('item_key', item_key, 'title', title)) from blockers), '[]'::jsonb),
    'active_blockers', coalesce((select jsonb_agg(jsonb_build_object('item_key', item_key, 'title', title)) from blockers), '[]'::jsonb),
    'unapproved_artifacts', coalesce((select jsonb_agg(jsonb_build_object('artifact_key', artifact_key, 'title', title)) from unapproved), '[]'::jsonb)
  );
$$;

revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from public;
revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from anon;
revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from authenticated;
grant execute on function public.psi_evaluate_tender_dossier_readiness(uuid) to service_role;

-- Wrapper de transición (rename-to-core).
do $$
begin
  if to_regprocedure('public.psi_transition_tender_offer_status_core_042(uuid,uuid,text,text,text)') is null then
    if to_regprocedure('public.psi_transition_tender_offer_status(uuid,uuid,text,text,text)') is null then
      raise exception 'Migration 042 requires psi_transition_tender_offer_status.';
    end if;
    execute 'alter function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) rename to psi_transition_tender_offer_status_core_042';
  end if;
end;
$$;

revoke all on function public.psi_transition_tender_offer_status_core_042(uuid, uuid, text, text, text) from public;
revoke all on function public.psi_transition_tender_offer_status_core_042(uuid, uuid, text, text, text) from anon;
revoke all on function public.psi_transition_tender_offer_status_core_042(uuid, uuid, text, text, text) from authenticated;
revoke all on function public.psi_transition_tender_offer_status_core_042(uuid, uuid, text, text, text) from service_role;

create or replace function public.psi_transition_tender_offer_status(
  p_opportunity_id uuid, p_actor_id uuid, p_to_status text, p_expected_current_status text, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_readiness jsonb; v_result jsonb; v_tender_id uuid;
begin
  -- Gate SOLO al pasar a lista_para_presentar. El core sigue autorizando (rol admin/gerencia/director).
  if p_to_status = 'lista_para_presentar' then
    v_readiness := public.psi_evaluate_tender_dossier_readiness(p_opportunity_id);
    if coalesce((v_readiness->>'ready')::boolean, false) is not true then
      raise exception 'El expediente no está listo para presentar: %',
        v_readiness using errcode = '23514';
    end if;
  end if;

  v_result := public.psi_transition_tender_offer_status_core_042(
    p_opportunity_id, p_actor_id, p_to_status, p_expected_current_status, p_note);

  -- Guard de existencia: en producción psi_append_tender_tracking_event siempre existe
  -- (migración 035); en pruebas PGlite aisladas de 042 debe seguir siendo reejecutable y segura.
  if p_to_status = 'lista_para_presentar' and to_regprocedure(
    'public.psi_append_tender_tracking_event(uuid,text,text,uuid,text,uuid,jsonb,text,boolean)'
  ) is not null then
    select t.id into v_tender_id from public.psi_public_tenders t where t.converted_opportunity_id = p_opportunity_id order by t.id limit 1;
    if v_tender_id is not null then
      perform public.psi_append_tender_tracking_event(
        v_tender_id, 'offer_ready_for_submission', 'human', p_actor_id, 'offer_status', p_opportunity_id,
        jsonb_build_object('opportunity_id', p_opportunity_id), 'La oferta quedó lista para presentar.', true);
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from public;
revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from anon;
revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from authenticated;
revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from service_role;
grant execute on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) to service_role;

commit;
