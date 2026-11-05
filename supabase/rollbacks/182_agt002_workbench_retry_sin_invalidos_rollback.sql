-- Reversa de la 182: vuelve al reintento de la 045, que acepta reintentar cualquier fallido.
begin;

create or replace function public.psi_retry_agt002_workbench_job(p_opportunity_id uuid,p_actor_id uuid,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_latest text; v_id uuid;
begin
  perform public.psi_assert_agt002_workbench_actor(p_actor_id,false);
  if not exists(select 1 from public.psi_agt002_workbench_jobs where id=p_job_id and opportunity_id=p_opportunity_id) then
    raise exception 'El trabajo no pertenece al expediente.' using errcode='23514';
  end if;
  select event_type into v_latest from public.psi_agt002_workbench_job_events
    where job_id=p_job_id order by created_at desc,id desc limit 1;
  if v_latest<>'failed' then raise exception 'Sólo un trabajo fallido puede reintentarse.' using errcode='23514'; end if;
  insert into public.psi_agt002_workbench_job_events(job_id,event_type,event_metadata)
  values(p_job_id,'released',jsonb_build_object('requested_by',p_actor_id)) returning id into v_id;
  return jsonb_build_object('status','released','event_id',v_id);
end;
$$;

revoke all on function public.psi_retry_agt002_workbench_job(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_retry_agt002_workbench_job(uuid,uuid,uuid) to service_role;

commit;
