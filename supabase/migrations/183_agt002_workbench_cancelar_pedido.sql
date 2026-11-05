-- F6 (auditoría del piloto Fiscalía, 2026-11-05): no había cómo cancelar un pedido de la Mesa en espera; el 4-nov hubo
-- que insertar a mano en producción un evento `failed` con código AGT002_CANCELLED_BY_OPERATOR (job `6028444b`).
--
-- Cancelar deja ese mismo evento, con quién y por qué. Sólo se cancela lo que espera turno (`queued` o `released`): lo
-- que ya está en manos del worker termina solo. Toma el mismo candado que el reclamo, así que un pedido no puede ser
-- reclamado y cancelado a la vez. Un cancelado no se reintenta (182).
begin;

create or replace function public.psi_cancel_agt002_workbench_job(p_opportunity_id uuid,p_actor_id uuid,p_job_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_latest text; v_id uuid; v_reason text:=btrim(coalesce(p_reason,''));
begin
  perform public.psi_assert_agt002_workbench_actor(p_actor_id,false);
  if length(v_reason)<3 or length(v_reason)>500 then
    raise exception 'Indique el motivo de la cancelación (entre 3 y 500 caracteres).' using errcode='22023';
  end if;
  if not exists(select 1 from public.psi_agt002_workbench_jobs where id=p_job_id and opportunity_id=p_opportunity_id) then
    raise exception 'El trabajo no pertenece al expediente.' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-workbench-claims:v1',0));
  select event_type into v_latest from public.psi_agt002_workbench_job_events
    where job_id=p_job_id order by created_at desc,id desc limit 1;
  if coalesce(v_latest,'queued') not in ('queued','released') then
    raise exception 'Sólo se cancela un pedido que todavía espera turno; éste ya lo está atendiendo Vig-IA o ya terminó.' using errcode='23514';
  end if;
  insert into public.psi_agt002_workbench_job_events(job_id,event_type,event_metadata)
  values(p_job_id,'failed',jsonb_build_object(
    'code','AGT002_CANCELLED_BY_OPERATOR','message',v_reason,'cancelled_by',p_actor_id,'occurred_at',clock_timestamp()))
  returning id into v_id;
  return jsonb_build_object('status','cancelled','event_id',v_id);
end;
$$;

revoke all on function public.psi_cancel_agt002_workbench_job(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.psi_cancel_agt002_workbench_job(uuid,uuid,uuid,text) to service_role;

commit;
