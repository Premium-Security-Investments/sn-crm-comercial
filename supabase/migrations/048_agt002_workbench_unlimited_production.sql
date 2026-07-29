-- Producción continua de Vig-IA: 0 significa sin cuota diaria y sin tope artificial de concurrencia.
-- Los valores positivos siguen disponibles como caps operativos opcionales. Negativos son inválidos.
begin;

create or replace function public.psi_claim_agt002_workbench_job(
  p_worker_id text,p_daily_max_jobs integer,p_max_concurrent integer,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_job public.psi_agt002_workbench_jobs%rowtype;
  v_claim uuid:=gen_random_uuid();
  v_active integer;
  v_daily integer;
  v_already_counted_today boolean;
begin
  if nullif(btrim(p_worker_id),'') is null or p_daily_max_jobs<0 or p_max_concurrent<0 or p_lease_seconds<=0 or p_lease_seconds>600 then
    raise exception 'Los parámetros del worker AGT-002 no son válidos.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-workbench-claims:v1',0));

  if p_max_concurrent>0 then
    select count(*)::integer into v_active from public.psi_agt002_workbench_job_events e
      where e.event_type='claimed' and e.lease_expires_at>v_now and not exists(
        select 1 from public.psi_agt002_workbench_job_events x where x.job_id=e.job_id and x.created_at>e.created_at and x.event_type in ('released','completed','failed','stale'));
    if v_active>=p_max_concurrent then return jsonb_build_object('status','saturated'); end if;
  end if;

  select j.* into v_job from public.psi_agt002_workbench_jobs j
    where coalesce((select e.event_type from public.psi_agt002_workbench_job_events e where e.job_id=j.id order by e.created_at desc,e.id desc limit 1),'queued') in ('queued','released')
    order by j.created_at,j.id limit 1 for update skip locked;
  if not found then return jsonb_build_object('status','empty'); end if;

  if p_daily_max_jobs>0 then
    select exists(
      select 1 from public.psi_agt002_workbench_job_events
      where job_id=v_job.id and event_type='claimed'
        and created_at>=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC'
    ) into v_already_counted_today;
    if not v_already_counted_today then
      select count(distinct job_id)::integer into v_daily from public.psi_agt002_workbench_job_events
        where event_type='claimed' and created_at>=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
      if v_daily>=p_daily_max_jobs then return jsonb_build_object('status','quota'); end if;
    end if;
  end if;

  insert into public.psi_agt002_workbench_job_events(job_id,event_type,claim_id,worker_id,lease_expires_at)
  values(v_job.id,'claimed',v_claim,btrim(p_worker_id),v_now+make_interval(secs=>p_lease_seconds));
  return jsonb_build_object('status','claimed','claim_id',v_claim,'job',to_jsonb(v_job));
end;
$$;

revoke all on function public.psi_claim_agt002_workbench_job(text,integer,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.psi_claim_agt002_workbench_job(text,integer,integer,integer) to service_role;

commit;
