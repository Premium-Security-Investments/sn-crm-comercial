-- AGT-002 Radar terminal preanalysis ledger plus durable leased queue. Local schema only.
begin;

create table public.psi_agt002_radar_preanalysis_runs (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  gate_evaluation_id uuid not null references public.psi_agt002_radar_gate_evaluations(id) on delete restrict,
  producer text not null default 'AGT-002' check (producer='AGT-002'),
  method text not null default 'agent_ai' check (method='agent_ai'),
  status text not null check (status in ('completed','abstained')),
  visibility_verdict text not null check (visibility_verdict in ('mostrar_en_radar','no_mostrar_en_radar','no_concluyente')),
  result jsonb not null,
  evidence jsonb not null,
  policy_version text not null check (nullif(btrim(policy_version),'') is not null),
  context_version text not null check (nullif(btrim(context_version),'') is not null),
  source_row_hash text not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  learning_signals_version text,
  learning_signals_count integer not null default 0 check (learning_signals_count >= 0),
  model text,
  usage jsonb,
  canonical boolean not null default false,
  supersedes_run_id uuid references public.psi_agt002_radar_preanalysis_runs(id) on delete restrict,
  idempotency_key text not null unique check (nullif(btrim(idempotency_key),'') is not null),
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  constraint psi_agt002_radar_preanalysis_runs_verdict_status_check check (
    (status='completed' and visibility_verdict in ('mostrar_en_radar','no_mostrar_en_radar'))
    or (status='abstained' and visibility_verdict='no_concluyente')
  ),
  constraint psi_agt002_radar_preanalysis_runs_human_review_check check ((result->'human_review_required')='true'::jsonb),
  constraint psi_agt002_radar_preanalysis_runs_evidence_check check (jsonb_typeof(evidence)='array' and jsonb_array_length(evidence)>=1),
  constraint psi_agt002_radar_preanalysis_runs_learning_shape_check check (
    (learning_signals_version is null and learning_signals_count=0)
    or (nullif(btrim(learning_signals_version),'') is not null and learning_signals_count>=1)
  )
);
create unique index psi_agt002_radar_preanalysis_one_canonical_idx on public.psi_agt002_radar_preanalysis_runs(tender_id) where canonical;
create index psi_agt002_radar_preanalysis_runs_tender_idx on public.psi_agt002_radar_preanalysis_runs(tender_id,created_at desc,id desc);

create function public.psi_guard_agt002_radar_preanalysis_run_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.canonical=true and new.canonical=false
    and (to_jsonb(old)-'canonical')=(to_jsonb(new)-'canonical') then return new;
  end if;
  raise exception using errcode='55000', message='AGT-002 Radar preanalysis ledger is append-only';
end;
$$;
create trigger psi_agt002_radar_preanalysis_runs_append_only before update or delete on public.psi_agt002_radar_preanalysis_runs
for each row execute function public.psi_guard_agt002_radar_preanalysis_run_mutation();

create table public.psi_agt002_radar_preanalysis_jobs (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  gate_evaluation_id uuid not null references public.psi_agt002_radar_gate_evaluations(id) on delete restrict,
  source_row_hash text not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  policy_version text not null check (nullif(btrim(policy_version),'') is not null),
  context_version text not null check (nullif(btrim(context_version),'') is not null),
  attempt_key text not null check (nullif(btrim(attempt_key),'') is not null),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key),'') is not null),
  status text not null default 'queued' check (status in ('queued','running','completed','unavailable')),
  lease_id uuid,
  lease_expires_at timestamptz,
  preanalysis_run_id uuid references public.psi_agt002_radar_preanalysis_runs(id) on delete restrict,
  error_code text check (error_code is null or error_code in ('timeout','provider_error','invalid_output','persistence_failure','lease_lost','capacity_unavailable')),
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint psi_agt002_radar_preanalysis_jobs_lease_all_or_none check ((lease_id is null and lease_expires_at is null) or (lease_id is not null and lease_expires_at is not null)),
  constraint psi_agt002_radar_preanalysis_jobs_terminal_shape check (
    (status in ('queued','running') and preanalysis_run_id is null and error_code is null and error_message is null)
    or (status='completed' and preanalysis_run_id is not null and error_code is null and error_message is null)
    or (status='unavailable' and preanalysis_run_id is null and error_code is not null and error_message is not null)
  )
);
create unique index psi_agt002_radar_preanalysis_jobs_one_active on public.psi_agt002_radar_preanalysis_jobs(tender_id) where status in ('queued','running');
create index psi_agt002_radar_preanalysis_jobs_claimable_idx on public.psi_agt002_radar_preanalysis_jobs(status,created_at,id) where status='queued' and lease_id is null;

create function public.psi_guard_agt002_radar_preanalysis_job_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.tender_id<>old.tender_id or new.gate_evaluation_id<>old.gate_evaluation_id or new.source_row_hash<>old.source_row_hash
    or new.policy_version<>old.policy_version or new.context_version<>old.context_version or new.attempt_key<>old.attempt_key
    or new.idempotency_key<>old.idempotency_key or new.created_at<>old.created_at then
    raise exception using errcode='55000', message='AGT-002 Radar preanalysis job identity is immutable';
  end if;
  new.updated_at=now(); return new;
end;
$$;
create trigger psi_agt002_radar_preanalysis_jobs_immutable before update on public.psi_agt002_radar_preanalysis_jobs
for each row execute function public.psi_guard_agt002_radar_preanalysis_job_mutation();

create table public.psi_agt002_radar_preanalysis_attempt_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (nullif(btrim(event_key),'') is not null),
  job_id uuid not null references public.psi_agt002_radar_preanalysis_jobs(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  attempt_key text not null,
  status text not null check (status in ('queued','running','completed','retry_wait','needs_attention','unavailable')),
  preanalysis_run_id uuid references public.psi_agt002_radar_preanalysis_runs(id) on delete restrict,
  error_code text,
  created_at timestamptz not null default now(),
  constraint psi_agt002_radar_attempt_run_shape check ((status='completed' and preanalysis_run_id is not null) or (status<>'completed' and preanalysis_run_id is null))
);
create index psi_agt002_radar_attempt_job_idx on public.psi_agt002_radar_preanalysis_attempt_events(job_id,created_at,id);

create function public.psi_guard_agt002_radar_attempt_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$ begin raise exception using errcode='55000',message='AGT-002 Radar attempt ledger is append-only'; end; $$;
create trigger psi_agt002_radar_attempt_append_only before update or delete on public.psi_agt002_radar_preanalysis_attempt_events
for each row execute function public.psi_guard_agt002_radar_attempt_mutation();

create function public.psi_record_agt002_radar_preanalysis_run(
  p_tender_id uuid,p_gate_evaluation_id uuid,p_visibility_verdict text,p_status text,p_result jsonb,p_evidence jsonb,
  p_policy_version text,p_context_version text,p_learning_signals_version text,p_learning_signals_count integer,
  p_model text,p_usage jsonb,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.psi_agt002_radar_preanalysis_runs%rowtype; v_previous public.psi_agt002_radar_preanalysis_runs%rowtype;
declare v_gate public.psi_agt002_radar_gate_evaluations%rowtype; v_new public.psi_agt002_radar_preanalysis_runs%rowtype;
begin
  if p_tender_id is null or p_gate_evaluation_id is null or jsonb_typeof(p_result)<>'object'
    or (p_result->'human_review_required')<>'true'::jsonb or jsonb_typeof(p_evidence)<>'array' or jsonb_array_length(p_evidence)<1
    or nullif(btrim(p_policy_version),'') is null or nullif(btrim(p_context_version),'') is null
    or p_learning_signals_count is null or p_learning_signals_count<0 or nullif(btrim(p_idempotency_key),'') is null
    or not ((p_status='completed' and p_visibility_verdict in ('mostrar_en_radar','no_mostrar_en_radar')) or (p_status='abstained' and p_visibility_verdict='no_concluyente'))
    or not ((p_learning_signals_version is null and p_learning_signals_count=0) or (nullif(btrim(p_learning_signals_version),'') is not null and p_learning_signals_count>=1)) then
    raise exception using errcode='22023',message='invalid AGT-002 Radar preanalysis run';
  end if;
  select * into v_existing from public.psi_agt002_radar_preanalysis_runs where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.tender_id=p_tender_id and v_existing.gate_evaluation_id=p_gate_evaluation_id
      and v_existing.visibility_verdict=p_visibility_verdict and v_existing.status=p_status and v_existing.result=p_result and v_existing.evidence=p_evidence
      and v_existing.policy_version=p_policy_version and v_existing.context_version=p_context_version
      and v_existing.learning_signals_version is not distinct from p_learning_signals_version and v_existing.learning_signals_count=p_learning_signals_count
      and v_existing.model is not distinct from p_model and v_existing.usage is not distinct from p_usage then return to_jsonb(v_existing);
    end if;
    raise exception using errcode='23505',message='AGT-002 Radar preanalysis idempotency conflict';
  end if;
  perform 1 from public.psi_public_tenders where id=p_tender_id for update;
  if not found then raise exception using errcode='P0002',message='AGT-002 Radar tender not found'; end if;
  select * into v_gate from public.psi_agt002_radar_gate_evaluations where id=p_gate_evaluation_id;
  if not found or v_gate.tender_id<>p_tender_id or v_gate.verdict<>'sobreviviente'
    or v_gate.policy_version<>p_policy_version or v_gate.context_version<>p_context_version then
    raise exception using errcode='22023',message='AGT-002 Radar gate is not a matching survivor';
  end if;
  select * into v_previous from public.psi_agt002_radar_preanalysis_runs where tender_id=p_tender_id and canonical for update;
  if found then update public.psi_agt002_radar_preanalysis_runs set canonical=false where id=v_previous.id; end if;
  insert into public.psi_agt002_radar_preanalysis_runs(
    tender_id,gate_evaluation_id,status,visibility_verdict,result,evidence,policy_version,context_version,source_row_hash,
    learning_signals_version,learning_signals_count,model,usage,canonical,supersedes_run_id,idempotency_key
  ) values (
    p_tender_id,p_gate_evaluation_id,p_status,p_visibility_verdict,p_result,p_evidence,p_policy_version,p_context_version,v_gate.source_row_hash,
    p_learning_signals_version,p_learning_signals_count,p_model,p_usage,true,v_previous.id,p_idempotency_key
  ) returning * into v_new;
  return to_jsonb(v_new);
end;
$$;

create function public.psi_append_agt002_radar_preanalysis_attempt(
  p_event_key text,p_job_id uuid,p_tender_id uuid,p_attempt_key text,p_status text,p_preanalysis_run_id uuid,p_error_code text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.psi_agt002_radar_preanalysis_attempt_events%rowtype; v_new public.psi_agt002_radar_preanalysis_attempt_events%rowtype;
begin
  if nullif(btrim(p_event_key),'') is null or p_job_id is null or p_tender_id is null or nullif(btrim(p_attempt_key),'') is null
    or p_status not in ('queued','running','completed','retry_wait','needs_attention','unavailable')
    or (p_status='completed')<>(p_preanalysis_run_id is not null) then raise exception using errcode='22023',message='invalid AGT-002 Radar attempt event'; end if;
  select * into v_existing from public.psi_agt002_radar_preanalysis_attempt_events where event_key=p_event_key;
  if found then
    if v_existing.job_id=p_job_id and v_existing.tender_id=p_tender_id and v_existing.attempt_key=p_attempt_key and v_existing.status=p_status
      and v_existing.preanalysis_run_id is not distinct from p_preanalysis_run_id and v_existing.error_code is not distinct from p_error_code then return to_jsonb(v_existing); end if;
    raise exception using errcode='23505',message='AGT-002 Radar attempt idempotency conflict';
  end if;
  insert into public.psi_agt002_radar_preanalysis_attempt_events(event_key,job_id,tender_id,attempt_key,status,preanalysis_run_id,error_code)
  values(p_event_key,p_job_id,p_tender_id,p_attempt_key,p_status,p_preanalysis_run_id,p_error_code) returning * into v_new;
  return to_jsonb(v_new);
end;
$$;

create function public.psi_enqueue_agt002_radar_preanalysis_job(
  p_tender_id uuid,p_gate_evaluation_id uuid,p_attempt_key text,p_idempotency_key text,p_policy_version text,p_context_version text,p_source_row_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_gate public.psi_agt002_radar_gate_evaluations%rowtype; v_job public.psi_agt002_radar_preanalysis_jobs%rowtype;
begin
  if p_tender_id is null or p_gate_evaluation_id is null or nullif(btrim(p_attempt_key),'') is null or nullif(btrim(p_idempotency_key),'') is null
    or nullif(btrim(p_policy_version),'') is null or nullif(btrim(p_context_version),'') is null or p_source_row_hash!~'^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid AGT-002 Radar queue identity';
  end if;
  select * into v_gate from public.psi_agt002_radar_gate_evaluations where id=p_gate_evaluation_id;
  if not found or v_gate.tender_id<>p_tender_id or v_gate.verdict<>'sobreviviente' or v_gate.source_row_hash<>p_source_row_hash
    or v_gate.policy_version<>p_policy_version or v_gate.context_version<>p_context_version then
    raise exception using errcode='22023',message='AGT-002 Radar queue requires a matching survivor';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_tender_id::text));
  if exists(select 1 from public.psi_agt002_radar_preanalysis_runs where tender_id=p_tender_id and canonical
    and source_row_hash=p_source_row_hash and policy_version=p_policy_version and context_version=p_context_version) then
    return jsonb_build_object('status','satisfied');
  end if;
  select * into v_job from public.psi_agt002_radar_preanalysis_jobs where idempotency_key=p_idempotency_key;
  if found then
    if v_job.tender_id=p_tender_id and v_job.gate_evaluation_id=p_gate_evaluation_id and v_job.attempt_key=p_attempt_key
      and v_job.policy_version=p_policy_version and v_job.context_version=p_context_version and v_job.source_row_hash=p_source_row_hash then
      return jsonb_build_object('status','existing','job_id',v_job.id);
    end if;
    raise exception using errcode='23505',message='AGT-002 Radar queue idempotency conflict';
  end if;
  select * into v_job from public.psi_agt002_radar_preanalysis_jobs where tender_id=p_tender_id and status in ('queued','running') for update;
  if found then
    if v_job.gate_evaluation_id=p_gate_evaluation_id and v_job.attempt_key=p_attempt_key and v_job.idempotency_key=p_idempotency_key
      and v_job.policy_version=p_policy_version and v_job.context_version=p_context_version and v_job.source_row_hash=p_source_row_hash then
      return jsonb_build_object('status','existing','job_id',v_job.id);
    end if;
    raise exception using errcode='55000',message='AGT-002 Radar tender already has a different active job';
  end if;
  insert into public.psi_agt002_radar_preanalysis_jobs(tender_id,gate_evaluation_id,source_row_hash,policy_version,context_version,attempt_key,idempotency_key)
  values(p_tender_id,p_gate_evaluation_id,p_source_row_hash,p_policy_version,p_context_version,p_attempt_key,p_idempotency_key) returning * into v_job;
  insert into public.psi_agt002_radar_preanalysis_attempt_events(event_key,job_id,tender_id,attempt_key,status)
  values(p_attempt_key||':queued',v_job.id,p_tender_id,p_attempt_key,'queued');
  return jsonb_build_object('status','created','job_id',v_job.id);
end;
$$;

create function public.psi_claim_agt002_radar_preanalysis_job(p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.psi_agt002_radar_preanalysis_jobs%rowtype; v_expired public.psi_agt002_radar_preanalysis_jobs%rowtype; v_seconds integer;
begin
  v_seconds=greatest(1,least(coalesce(p_lease_seconds,60),600));
  for v_expired in update public.psi_agt002_radar_preanalysis_jobs set status='unavailable',lease_id=null,lease_expires_at=null,
    error_code='lease_lost',error_message='Worker lease expired',completed_at=now()
    where status='running' and lease_expires_at<=now() returning * loop
    insert into public.psi_agt002_radar_preanalysis_attempt_events(event_key,job_id,tender_id,attempt_key,status,error_code)
    values(v_expired.attempt_key||':lease_lost',v_expired.id,v_expired.tender_id,v_expired.attempt_key,'unavailable','lease_lost') on conflict(event_key) do nothing;
  end loop;
  select * into v_job from public.psi_agt002_radar_preanalysis_jobs where status='queued' and lease_id is null order by created_at,id for update skip locked limit 1;
  if not found then return jsonb_build_object('status','empty'); end if;
  update public.psi_agt002_radar_preanalysis_jobs set status='running',lease_id=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>v_seconds),started_at=coalesce(started_at,now()) where id=v_job.id returning * into v_job;
  insert into public.psi_agt002_radar_preanalysis_attempt_events(event_key,job_id,tender_id,attempt_key,status)
  values(v_job.attempt_key||':running',v_job.id,v_job.tender_id,v_job.attempt_key,'running') on conflict(event_key) do nothing;
  return jsonb_build_object('status','claimed','job_id',v_job.id,'lease_id',v_job.lease_id,'lease_expires_at',v_job.lease_expires_at,
    'tender_id',v_job.tender_id,'gate_evaluation_id',v_job.gate_evaluation_id,'attempt_key',v_job.attempt_key,
    'source_row_hash',v_job.source_row_hash,'policy_version',v_job.policy_version,'context_version',v_job.context_version);
end;
$$;

create function public.psi_complete_agt002_radar_preanalysis_job(p_job_id uuid,p_lease_id uuid,p_preanalysis_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.psi_agt002_radar_preanalysis_jobs%rowtype; v_run public.psi_agt002_radar_preanalysis_runs%rowtype;
begin
  select * into v_job from public.psi_agt002_radar_preanalysis_jobs where id=p_job_id for update;
  if not found then raise exception using errcode='P0002',message='AGT-002 Radar job not found'; end if;
  if v_job.status='completed' then
    if v_job.preanalysis_run_id=p_preanalysis_run_id then return jsonb_build_object('status','existing','job_id',v_job.id); end if;
    raise exception using errcode='23505',message='AGT-002 Radar job already completed with another run';
  end if;
  if v_job.status<>'running' or v_job.lease_id<>p_lease_id or v_job.lease_expires_at<=now() then raise exception using errcode='55000',message='AGT-002 Radar job lease invalid'; end if;
  select * into v_run from public.psi_agt002_radar_preanalysis_runs where id=p_preanalysis_run_id;
  if not found or not v_run.canonical or v_run.tender_id<>v_job.tender_id or v_run.gate_evaluation_id<>v_job.gate_evaluation_id then
    raise exception using errcode='22023',message='AGT-002 Radar canonical run does not match job';
  end if;
  update public.psi_agt002_radar_preanalysis_jobs set status='completed',lease_id=null,lease_expires_at=null,preanalysis_run_id=p_preanalysis_run_id,completed_at=now() where id=v_job.id;
  insert into public.psi_agt002_radar_preanalysis_attempt_events(event_key,job_id,tender_id,attempt_key,status,preanalysis_run_id)
  values(v_job.attempt_key||':completed',v_job.id,v_job.tender_id,v_job.attempt_key,'completed',p_preanalysis_run_id) on conflict(event_key) do nothing;
  return jsonb_build_object('status','completed','job_id',v_job.id,'preanalysis_run_id',p_preanalysis_run_id);
end;
$$;

create function public.psi_fail_agt002_radar_preanalysis_job(p_job_id uuid,p_lease_id uuid,p_error_code text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.psi_agt002_radar_preanalysis_jobs%rowtype; v_message text;
begin
  v_message=case p_error_code when 'timeout' then 'Provider timeout' when 'provider_error' then 'Provider unavailable'
    when 'invalid_output' then 'Provider output rejected' when 'persistence_failure' then 'Persistence failed'
    when 'lease_lost' then 'Worker lease expired' when 'capacity_unavailable' then 'Provider capacity unavailable' else null end;
  if v_message is null then raise exception using errcode='22023',message='invalid AGT-002 Radar error code'; end if;
  select * into v_job from public.psi_agt002_radar_preanalysis_jobs where id=p_job_id for update;
  if not found then raise exception using errcode='P0002',message='AGT-002 Radar job not found'; end if;
  if v_job.status='unavailable' and v_job.error_code=p_error_code then return jsonb_build_object('status','existing','job_id',v_job.id); end if;
  if v_job.status<>'running' or v_job.lease_id<>p_lease_id or v_job.lease_expires_at<=now() then raise exception using errcode='55000',message='AGT-002 Radar job lease invalid'; end if;
  update public.psi_agt002_radar_preanalysis_jobs set status='unavailable',lease_id=null,lease_expires_at=null,error_code=p_error_code,error_message=v_message,completed_at=now() where id=v_job.id;
  insert into public.psi_agt002_radar_preanalysis_attempt_events(event_key,job_id,tender_id,attempt_key,status,error_code)
  values(v_job.attempt_key||':unavailable',v_job.id,v_job.tender_id,v_job.attempt_key,'unavailable',p_error_code) on conflict(event_key) do nothing;
  return jsonb_build_object('status','unavailable','job_id',v_job.id,'error_code',p_error_code);
end;
$$;

alter table public.psi_agt002_radar_preanalysis_runs enable row level security;
alter table public.psi_agt002_radar_preanalysis_jobs enable row level security;
alter table public.psi_agt002_radar_preanalysis_attempt_events enable row level security;
revoke all on table public.psi_agt002_radar_preanalysis_runs,public.psi_agt002_radar_preanalysis_jobs,public.psi_agt002_radar_preanalysis_attempt_events from public,anon,authenticated,service_role;
grant select on table public.psi_agt002_radar_preanalysis_runs,public.psi_agt002_radar_preanalysis_jobs,public.psi_agt002_radar_preanalysis_attempt_events to service_role;
revoke all on function public.psi_record_agt002_radar_preanalysis_run(uuid,uuid,text,text,jsonb,jsonb,text,text,text,integer,text,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.psi_append_agt002_radar_preanalysis_attempt(text,uuid,uuid,text,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.psi_enqueue_agt002_radar_preanalysis_job(uuid,uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.psi_claim_agt002_radar_preanalysis_job(integer) from public,anon,authenticated,service_role;
revoke all on function public.psi_complete_agt002_radar_preanalysis_job(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.psi_fail_agt002_radar_preanalysis_job(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.psi_record_agt002_radar_preanalysis_run(uuid,uuid,text,text,jsonb,jsonb,text,text,text,integer,text,jsonb,text) to service_role;
grant execute on function public.psi_append_agt002_radar_preanalysis_attempt(text,uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.psi_enqueue_agt002_radar_preanalysis_job(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.psi_claim_agt002_radar_preanalysis_job(integer) to service_role;
grant execute on function public.psi_complete_agt002_radar_preanalysis_job(uuid,uuid,uuid) to service_role;
grant execute on function public.psi_fail_agt002_radar_preanalysis_job(uuid,uuid,text) to service_role;
revoke all on function public.psi_guard_agt002_radar_preanalysis_run_mutation(),public.psi_guard_agt002_radar_preanalysis_job_mutation(),public.psi_guard_agt002_radar_attempt_mutation() from public,anon,authenticated,service_role;

commit;
