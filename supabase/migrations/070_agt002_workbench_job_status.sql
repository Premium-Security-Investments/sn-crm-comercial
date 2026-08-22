-- Estado observable del trabajo de la Mesa AGT-002 (Vig-IA) en la lectura gobernada.
--
-- Aditiva y reversible. NO crea, altera ni elimina tablas, columnas, índices, triggers,
-- políticas ni permisos, y NO toca ningún otro RPC: reemplaza exactamente UNA función,
-- public.psi_get_agt002_workbench(uuid,uuid), conservando su firma, todos sus campos
-- previos, su carácter `stable`, `security definer`, su `search_path=public,pg_temp` y su
-- ejecución exclusiva por service_role (reafirmada al final, explícita y auditable).
--
-- Único cambio: cada trabajo proyectado pasa a llevar su último evento del log
-- append-only public.psi_agt002_workbench_job_events, resuelto con `order by created_at
-- desc, id desc limit 1` — exactamente el mismo desempate que ya usan la reclamación
-- (045/046), el barrido de leases (046) y el reintento (045), de modo que la superficie
-- humana observe el MISMO estado que gobierna al worker. Antes de esta migración la
-- lectura no exponía el log y la capa JS sólo podía distinguir "completado" (por el
-- mensaje agente terminal) de "en curso": un trabajo fallido era indistinguible de uno
-- vivo y jamás ofrecía reintentar. El mapeo evento -> estado vive en JS
-- (`projectJobStatus`), no aquí: esta migración sólo expone el hecho observado.
--
-- El índice psi_agt002_workbench_job_events_cursor_idx (job_id, created_at desc, id desc)
-- creado en 045 es exactamente el que sirve este lateral; no se añade ninguno.
begin;

create or replace function public.psi_get_agt002_workbench(p_opportunity_id uuid,p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_thread_id uuid;
begin
  -- migration-marker: agt002_workbench_job_status_v1
  perform public.psi_assert_agt002_workbench_actor(p_actor_id,false);
  perform public.psi_assert_tender_dossier_go(p_opportunity_id);
  select id into v_thread_id from public.psi_agt002_workbench_threads where opportunity_id=p_opportunity_id and closed_at is null;
  return jsonb_build_object(
    'thread_id',v_thread_id,
    'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from public.psi_agt002_workbench_messages m where m.thread_id=v_thread_id),'[]'::jsonb),
    -- Cada trabajo conserva íntegras todas sus columnas y añade su último evento. El join
    -- es LEFT: un trabajo sin evento alguno (anomalía: 045 inserta `queued` en la misma
    -- transacción que el trabajo) proyecta latest_event_type nulo, que la capa JS trata
    -- conservadoramente y nunca como completado.
    'jobs',coalesce((select jsonb_agg(to_jsonb(j) || jsonb_build_object(
        'latest_event_type',e.event_type,
        'latest_event_at',e.created_at)
      order by j.created_at,j.id)
      from public.psi_agt002_workbench_jobs j
      left join lateral (
        select ev.event_type, ev.created_at
        from public.psi_agt002_workbench_job_events ev
        where ev.job_id=j.id
        order by ev.created_at desc, ev.id desc
        limit 1
      ) e on true
      where j.thread_id=v_thread_id),'[]'::jsonb),
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

-- ACL idéntica a 045: sólo service_role ejecuta. `create or replace` conserva la ACL
-- existente cuando la firma coincide; se declara igualmente para dejarla auditable y para
-- que la migración sea correcta también si la función se hubiera recreado sin ella.
revoke all on function public.psi_get_agt002_workbench(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_get_agt002_workbench(uuid,uuid) to service_role;

commit;
