-- Endurecimiento operacional de la Mesa AGT-002 (Vig-IA) para producción, Fase A.
-- Migración aditiva sobre 045: no crea ni elimina tablas, no reemplaza RPC humanos ni
-- agente, no toca `psi_tender_dossier_artifact_versions`. Sólo:
--   1) añade el RPC de barrido de leases expirados (crash de worker -> reclamable),
--   2) corrige el cupo diario de `psi_claim_agt002_workbench_job` para contar trabajos
--      DISTINTOS reclamados, no eventos `claimed` repetidos del mismo trabajo,
--   3) añade un índice único parcial que impide un segundo mensaje terminal para el
--      mismo trabajo (defensa en profundidad ante una carrera de dos ejecuciones del
--      RPC terminal, más allá de su propia revalidación de idempotencia).
-- No modifica 045; no reutiliza `psi_agt003_*` ni `psi_tender_processing_jobs`.
begin;

-- 1. Índice único parcial: como máximo un mensaje con `origin_job_id` no nulo por trabajo.
create unique index if not exists psi_agt002_workbench_messages_origin_job_unique
  on public.psi_agt002_workbench_messages(origin_job_id) where origin_job_id is not null;

-- 2. Cupo diario por trabajo distinto. 045 contaba eventos `claimed`: un trabajo cuyo
-- worker se cayó (lease expirado) y que se vuelve a reclamar el mismo día consumía cupo
-- una segunda vez, y si el cupo ya estaba agotado por ESE mismo trabajo, el propio
-- trabajo quedaba imposible de reclamar el resto del día. La corrección selecciona el
-- trabajo candidato primero (mismo orden y `for update skip locked` que 045) y sólo
-- exige cupo cuando ese trabajo concreto NO fue ya contado hoy; reclamar un trabajo que
-- ya consumió su cupo hoy nunca vuelve a cobrarlo. El resto del comportamiento
-- (saturación, orden de selección, forma de la fila devuelta, `search_path`, límites de
-- entrada) es idéntico a 045.
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
  if nullif(btrim(p_worker_id),'') is null or p_daily_max_jobs<=0 or p_max_concurrent<=0 or p_lease_seconds<=0 or p_lease_seconds>600 then
    raise exception 'Los límites de worker AGT-002 no son válidos.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-workbench-claims:v1',0));
  select count(*)::integer into v_active from public.psi_agt002_workbench_job_events e
    where e.event_type='claimed' and e.lease_expires_at>v_now and not exists(
      select 1 from public.psi_agt002_workbench_job_events x where x.job_id=e.job_id and x.created_at>e.created_at and x.event_type in ('released','completed','failed','stale'));
  if v_active>=p_max_concurrent then return jsonb_build_object('status','saturated'); end if;

  select j.* into v_job from public.psi_agt002_workbench_jobs j
    where coalesce((select e.event_type from public.psi_agt002_workbench_job_events e where e.job_id=j.id order by e.created_at desc,e.id desc limit 1),'queued') in ('queued','released')
    order by j.created_at,j.id limit 1 for update skip locked;
  if not found then return jsonb_build_object('status','empty'); end if;

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

  insert into public.psi_agt002_workbench_job_events(job_id,event_type,claim_id,worker_id,lease_expires_at)
  values(v_job.id,'claimed',v_claim,btrim(p_worker_id),v_now+make_interval(secs=>p_lease_seconds));
  return jsonb_build_object('status','claimed','claim_id',v_claim,'job',to_jsonb(v_job));
end;
$$;

-- ACL preservada exactamente como en 045 (create or replace no la altera si la firma
-- coincide, pero se declara explícitamente para dejar la intención auditable).
revoke all on function public.psi_claim_agt002_workbench_job(text,integer,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.psi_claim_agt002_workbench_job(text,integer,integer,integer) to service_role;

-- 3. RPC de barrido de leases expirados: identifica, de forma acotada y atómica, los
-- trabajos cuyo ÚLTIMO evento es `claimed` con lease ya vencido, y les añade un evento
-- `released` para que vuelvan a ser reclamables. No depende de
-- `psi_assert_agt002_workbench_claim` (que por diseño exige lease VIGENTE y fallaría
-- siempre aquí); resuelve "último evento" de forma independiente por trabajo. Serializa
-- con el mismo advisory lock que usa el claim (misma clave), de modo que un barrido y una
-- reclamación nunca se entrelazan; adicionalmente toma `FOR UPDATE SKIP LOCKED` acotado
-- por `p_max` sobre la fila de trabajo (nunca sobre `job_events`, que es append-only e
-- inmutable), para que dos barridos sucesivos o solapados jamás liberen el mismo trabajo
-- dos veces ni excedan el límite acotado por invocación.
create or replace function public.psi_sweep_agt002_workbench_expired_leases(p_max integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_released integer:=0;
  v_ids uuid[]:='{}';
  v_row record;
begin
  if p_max is null or p_max<=0 or p_max>500 then
    raise exception 'p_max fuera de rango para el barrido de leases AGT-002.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-workbench-claims:v1',0));
  for v_row in
    select j.id as job_id, e.claim_id as claim_id, e.lease_expires_at as lease_expires_at
    from public.psi_agt002_workbench_jobs j
    join lateral (
      select event_type, claim_id, lease_expires_at, created_at
      from public.psi_agt002_workbench_job_events le
      where le.job_id = j.id
      order by le.created_at desc, le.id desc
      limit 1
    ) e on true
    where e.event_type='claimed' and e.lease_expires_at<=v_now
    order by e.lease_expires_at, j.id
    limit p_max
    for update of j skip locked
  loop
    insert into public.psi_agt002_workbench_job_events(job_id,event_type,claim_id,event_metadata)
    values(v_row.job_id,'released',v_row.claim_id,jsonb_build_object('reason','lease_expired','lease_expired_at',v_row.lease_expires_at));
    v_released := v_released+1;
    v_ids := v_ids || v_row.job_id;
  end loop;
  return jsonb_build_object('status','swept','released',v_released,'job_ids',to_jsonb(v_ids),'max',p_max,'more',(v_released=p_max));
end;
$$;

revoke all on function public.psi_sweep_agt002_workbench_expired_leases(integer) from public, anon, authenticated, service_role;
grant execute on function public.psi_sweep_agt002_workbench_expired_leases(integer) to service_role;

commit;
