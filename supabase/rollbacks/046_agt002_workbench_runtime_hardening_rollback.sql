-- Rollback de la migración 046 (endurecimiento operacional de la Mesa AGT-002, Fase A).
-- Restaura `psi_claim_agt002_workbench_job` a la definición EXACTA de la migración 045
-- (cupo diario por EVENTOS `claimed`, no por trabajos distintos) y retira únicamente las
-- adiciones de 046: el RPC de barrido de leases expirados y el índice único parcial de
-- mensaje terminal por trabajo. No toca ninguna tabla, fila, grant ni comportamiento de
-- 045 fuera de esa función; no toca AGT-003 (migración 044).
--
-- FALLA CERRADO POR DEPENDENCIAS: ningún DROP de este archivo usa CASCADE. `DROP
-- FUNCTION`/`DROP INDEX` sin CASCADE son RESTRICT por defecto en PostgreSQL: si algún
-- otro objeto llegara a depender del RPC de barrido o del índice (ninguno de 046 lo
-- prevé, pero el futuro no está escrito), la sentencia falla y toda la transacción se
-- revierte antes de tocar nada más, incluida la restauración del cupo de 045.
begin;

-- 0. Serializa con cualquier claim/barrido en vuelo antes de tocar el cupo o el RPC.
select pg_advisory_xact_lock(hashtextextended('agt002-workbench-claims:v1',0));

-- 1. RPC de barrido: se retira por completo (RESTRICT implícito).
drop function if exists public.psi_sweep_agt002_workbench_expired_leases(integer);

-- 2. Índice único parcial de mensaje terminal por trabajo (RESTRICT implícito).
drop index if exists public.psi_agt002_workbench_messages_origin_job_unique;

-- 3. Restaura `psi_claim_agt002_workbench_job` EXACTAMENTE como en 045: cupo diario por
-- eventos `claimed` (no por trabajos distintos), selección de trabajo tras el cupo.
-- `create or replace` conserva OID y dependencias existentes.
create or replace function public.psi_claim_agt002_workbench_job(
  p_worker_id text,p_daily_max_jobs integer,p_max_concurrent integer,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); v_job public.psi_agt002_workbench_jobs%rowtype; v_claim uuid:=gen_random_uuid(); v_active integer; v_daily integer;
begin
  if nullif(btrim(p_worker_id),'') is null or p_daily_max_jobs<=0 or p_max_concurrent<=0 or p_lease_seconds<=0 or p_lease_seconds>600 then
    raise exception 'Los límites de worker AGT-002 no son válidos.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-workbench-claims:v1',0));
  select count(*)::integer into v_active from public.psi_agt002_workbench_job_events e
    where e.event_type='claimed' and e.lease_expires_at>v_now and not exists(
      select 1 from public.psi_agt002_workbench_job_events x where x.job_id=e.job_id and x.created_at>e.created_at and x.event_type in ('released','completed','failed','stale'));
  if v_active>=p_max_concurrent then return jsonb_build_object('status','saturated'); end if;
  select count(*)::integer into v_daily from public.psi_agt002_workbench_job_events where event_type='claimed' and created_at>=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
  if v_daily>=p_daily_max_jobs then return jsonb_build_object('status','quota'); end if;
  select j.* into v_job from public.psi_agt002_workbench_jobs j
    where coalesce((select e.event_type from public.psi_agt002_workbench_job_events e where e.job_id=j.id order by e.created_at desc,e.id desc limit 1),'queued') in ('queued','released')
    order by j.created_at,j.id limit 1 for update skip locked;
  if not found then return jsonb_build_object('status','empty'); end if;
  insert into public.psi_agt002_workbench_job_events(job_id,event_type,claim_id,worker_id,lease_expires_at)
  values(v_job.id,'claimed',v_claim,btrim(p_worker_id),v_now+make_interval(secs=>p_lease_seconds));
  return jsonb_build_object('status','claimed','claim_id',v_claim,'job',to_jsonb(v_job));
end;
$$;

-- 4. Grants: preserva exactamente el ACL de 045 (service_role únicamente).
revoke all on function public.psi_claim_agt002_workbench_job(text,integer,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.psi_claim_agt002_workbench_job(text,integer,integer,integer) to service_role;

commit;
