-- Reversa de 070. Restaura public.psi_get_agt002_workbench(uuid,uuid) EXACTAMENTE a la
-- definición de la migración 045 (sin el último evento por trabajo) y reafirma su ACL de
-- sólo service_role. No hay pérdida de evidencia posible: 070 no creó ni modificó dato,
-- tabla, columna, índice, trigger ni permiso alguno — sólo el cuerpo de esta función—, así
-- que la reversa no necesita guarda de evidencia y es segura con la Mesa en producción.
-- Tras aplicarla, la capa JS vuelve a no observar `latest_event_type` y proyecta todo
-- trabajo no completado como `in_progress`, que es el comportamiento previo a 070.
begin;

create or replace function public.psi_get_agt002_workbench(p_opportunity_id uuid,p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_thread_id uuid;
begin
  perform public.psi_assert_agt002_workbench_actor(p_actor_id,false);
  perform public.psi_assert_tender_dossier_go(p_opportunity_id);
  select id into v_thread_id from public.psi_agt002_workbench_threads where opportunity_id=p_opportunity_id and closed_at is null;
  return jsonb_build_object(
    'thread_id',v_thread_id,
    'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from public.psi_agt002_workbench_messages m where m.thread_id=v_thread_id),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by j.created_at,j.id) from public.psi_agt002_workbench_jobs j where j.thread_id=v_thread_id),'[]'::jsonb),
    'required_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.psi_agt002_workbench_required_actions a where a.opportunity_id=p_opportunity_id),'[]'::jsonb),
    'learning_proposals',coalesce((select jsonb_agg(
      to_jsonb(p) || jsonb_build_object(
        'review_status',coalesce((select d.decision from public.psi_agt002_learning_decisions d where d.proposal_id=p.id order by d.created_at desc,d.id desc limit 1),'pendiente'),
        'approved_scope',(select d.approved_scope from public.psi_agt002_learning_decisions d where d.proposal_id=p.id order by d.created_at desc,d.id desc limit 1))
      order by p.created_at,p.id) from public.psi_agt002_learning_proposals p where p.opportunity_id=p_opportunity_id),'[]'::jsonb),
    -- Sólo un aprendizaje con decisión aprobada se proyecta como política activa.
    'active_learning_policies',coalesce((select jsonb_agg(jsonb_build_object(
        'proposal_id',p.id,'scope',d.approved_scope,'proposed_rule',p.proposed_rule,
        'valid_from',p.valid_from,'valid_until',p.valid_until,'decided_at',d.created_at)
      order by d.created_at,p.id)
      from public.psi_agt002_learning_proposals p
      join public.psi_agt002_learning_decisions d on d.proposal_id=p.id
      where p.opportunity_id=p_opportunity_id and d.decision='approved'),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.psi_get_agt002_workbench(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_get_agt002_workbench(uuid,uuid) to service_role;

commit;
