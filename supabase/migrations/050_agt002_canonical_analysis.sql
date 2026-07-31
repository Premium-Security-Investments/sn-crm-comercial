begin;

-- Historical rule/HERMES rows remain non-canonical and readable. Only new,
-- explicitly recorded AGT-002 runs may carry canonical=true.
alter table public.psi_tender_analysis_runs
  add column if not exists canonical boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_tender_analysis_runs'::regclass
      and conname = 'psi_tender_analysis_runs_canonical_agt002_check'
  ) then
    alter table public.psi_tender_analysis_runs
      add constraint psi_tender_analysis_runs_canonical_agt002_check
      check (not canonical or (producer = 'AGT-002' and method = 'agent_ai' and status = 'completed'));
  end if;
end $$;

create index if not exists psi_tender_analysis_runs_canonical_current_idx
  on public.psi_tender_analysis_runs (opportunity_id, created_at desc, id desc)
  where canonical and status = 'completed';

alter table public.psi_tender_analysis_runs enable row level security;
revoke all on table public.psi_tender_analysis_runs from public, authenticated, anon, service_role;
grant select on table public.psi_tender_analysis_runs to service_role;

create table if not exists public.psi_agt002_analysis_attempt_events (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.psi_tender_document_snapshots(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  attempt_key text not null check (nullif(btrim(attempt_key), '') is not null),
  event_key text not null unique check (nullif(btrim(event_key), '') is not null),
  producer text not null check (producer = 'AGT-002'),
  state text not null check (state in ('queued', 'running', 'completed', 'retry_wait', 'needs_attention', 'unavailable')),
  error_code text,
  error_message text,
  analysis_run_id uuid references public.psi_tender_analysis_runs(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((state = 'completed' and analysis_run_id is not null and error_code is null and error_message is null)
    or (state <> 'completed' and analysis_run_id is null))
);

create index if not exists psi_agt002_analysis_attempt_events_attempt_idx
  on public.psi_agt002_analysis_attempt_events (attempt_key, created_at desc, id desc);
create index if not exists psi_agt002_analysis_attempt_events_opportunity_idx
  on public.psi_agt002_analysis_attempt_events (opportunity_id, created_at desc, id desc);

create or replace function public.psi_agt002_analysis_attempt_events_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_analysis_attempt_events is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_agt002_analysis_attempt_events_immutable on public.psi_agt002_analysis_attempt_events;
create trigger psi_agt002_analysis_attempt_events_immutable
  before update or delete on public.psi_agt002_analysis_attempt_events
  for each row execute function public.psi_agt002_analysis_attempt_events_prevent_mutation();

alter table public.psi_agt002_analysis_attempt_events enable row level security;
revoke all on table public.psi_agt002_analysis_attempt_events from public, authenticated, service_role;
grant select on table public.psi_agt002_analysis_attempt_events to service_role;

create or replace function public.psi_record_agt002_canonical_analysis_run(
  p_snapshot_id uuid,
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_result jsonb,
  p_critical_open_count integer,
  p_idempotency_key text,
  p_schema_version text,
  p_policy_version text,
  p_model text default null,
  p_usage jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.psi_tender_document_snapshots%rowtype;
  v_run public.psi_tender_analysis_runs%rowtype;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'Un análisis canónico completado requiere resultado estructurado.' using errcode = '22023';
  end if;
  if p_critical_open_count is null or p_critical_open_count < 0 then
    raise exception 'El conteo de preguntas críticas no es válido.' using errcode = '22023';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or nullif(btrim(p_schema_version), '') is null
     or nullif(btrim(p_policy_version), '') is null then
    raise exception 'La clave de idempotencia y las versiones son obligatorias.' using errcode = '22023';
  end if;
  if p_usage is not null and jsonb_typeof(p_usage) <> 'object' then
    raise exception 'El uso del análisis debe ser un objeto estructurado.' using errcode = '22023';
  end if;

  select * into v_snapshot from public.psi_tender_document_snapshots where id = p_snapshot_id for share;
  if not found then raise exception 'El snapshot documental no existe.' using errcode = 'P0002'; end if;
  if v_snapshot.opportunity_id is distinct from p_opportunity_id or v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot no coincide con la oportunidad y licitación indicadas.' using errcode = '22023';
  end if;

  insert into public.psi_tender_analysis_runs (
    snapshot_id, opportunity_id, tender_id, producer, method, status, result, critical_open_count,
    idempotency_key, schema_version, policy_version, model, usage, completed_at, canonical
  ) values (
    p_snapshot_id, p_opportunity_id, p_tender_id, 'AGT-002', 'agent_ai', 'completed', p_result,
    p_critical_open_count, p_idempotency_key, p_schema_version, p_policy_version,
    nullif(btrim(p_model), ''), p_usage, now(), true
  ) on conflict (idempotency_key) do nothing;

  select * into v_run from public.psi_tender_analysis_runs where idempotency_key = p_idempotency_key for share;
  if not found
     or v_run.snapshot_id is distinct from p_snapshot_id
     or v_run.opportunity_id is distinct from p_opportunity_id
     or v_run.tender_id is distinct from p_tender_id
     or v_run.producer is distinct from 'AGT-002'
     or v_run.method is distinct from 'agent_ai'
     or v_run.status is distinct from 'completed'
     or v_run.result is distinct from p_result
     or v_run.critical_open_count is distinct from p_critical_open_count
     or v_run.schema_version is distinct from p_schema_version
     or v_run.policy_version is distinct from p_policy_version
     or v_run.model is distinct from nullif(btrim(p_model), '')
     or v_run.usage is distinct from p_usage
     or v_run.canonical is distinct from true then
    raise exception 'La clave de idempotencia ya pertenece a otro análisis.' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'id', v_run.id, 'snapshot_id', v_run.snapshot_id, 'opportunity_id', v_run.opportunity_id,
    'tender_id', v_run.tender_id, 'producer', v_run.producer, 'method', v_run.method,
    'status', v_run.status, 'canonical', v_run.canonical, 'critical_open_count', v_run.critical_open_count,
    'created_at', v_run.created_at, 'completed_at', v_run.completed_at
  );
end;
$$;

create or replace function public.psi_append_agt002_analysis_attempt(
  p_snapshot_id uuid,
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_attempt_key text,
  p_event_key text,
  p_producer text,
  p_state text,
  p_error_code text default null,
  p_error_message text default null,
  p_analysis_run_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.psi_tender_document_snapshots%rowtype;
  v_existing public.psi_agt002_analysis_attempt_events%rowtype;
  v_previous public.psi_agt002_analysis_attempt_events%rowtype;
  v_event public.psi_agt002_analysis_attempt_events%rowtype;
begin
  if p_producer is distinct from 'AGT-002' then
    raise exception 'El productor canónico debe ser AGT-002.' using errcode = '22023';
  end if;
  if p_state not in ('queued', 'running', 'completed', 'retry_wait', 'needs_attention', 'unavailable') then
    raise exception 'Estado de intento AGT-002 inválido.' using errcode = '22023';
  end if;
  if nullif(btrim(p_attempt_key), '') is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'Las claves del intento y evento son obligatorias.' using errcode = '22023';
  end if;
  if (p_state = 'completed' and p_analysis_run_id is null)
     or (p_state <> 'completed' and p_analysis_run_id is not null) then
    raise exception 'El análisis canónico solo puede vincularse al estado completed.' using errcode = '22023';
  end if;

  select * into v_existing from public.psi_agt002_analysis_attempt_events where event_key = p_event_key for share;
  if found then
    if v_existing.snapshot_id is distinct from p_snapshot_id
       or v_existing.opportunity_id is distinct from p_opportunity_id
       or v_existing.tender_id is distinct from p_tender_id
       or v_existing.attempt_key is distinct from p_attempt_key
       or v_existing.producer is distinct from p_producer
       or v_existing.state is distinct from p_state
       or v_existing.error_code is distinct from nullif(btrim(p_error_code), '')
       or v_existing.error_message is distinct from nullif(btrim(p_error_message), '')
       or v_existing.analysis_run_id is distinct from p_analysis_run_id then
      raise exception 'La clave de evento ya pertenece a otro estado.' using errcode = '23505';
    end if;
    return jsonb_build_object('id', v_existing.id, 'attempt_key', v_existing.attempt_key, 'state', v_existing.state, 'analysis_run_id', v_existing.analysis_run_id, 'created_at', v_existing.created_at);
  end if;

  select * into v_snapshot from public.psi_tender_document_snapshots where id = p_snapshot_id for share;
  if not found then raise exception 'El snapshot documental no existe.' using errcode = 'P0002'; end if;
  if v_snapshot.opportunity_id is distinct from p_opportunity_id or v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot no coincide con el intento AGT-002.' using errcode = '22023';
  end if;
  if p_analysis_run_id is not null and not exists (
    select 1 from public.psi_tender_analysis_runs r
    where r.id = p_analysis_run_id and r.snapshot_id = p_snapshot_id and r.opportunity_id = p_opportunity_id
      and r.tender_id = p_tender_id and r.producer = 'AGT-002' and r.method = 'agent_ai'
      and r.status = 'completed' and r.canonical
  ) then
    raise exception 'El run vinculado no es un análisis canónico AGT-002 completado.' using errcode = '22023';
  end if;

  select * into v_previous from public.psi_agt002_analysis_attempt_events
  where attempt_key = p_attempt_key order by created_at desc, id desc limit 1 for share;
  if not found and p_state <> 'queued' then
    raise exception 'La transición inicial del intento debe ser queued.' using errcode = '22023';
  elsif found then
    if v_previous.state = 'completed' then
      raise exception 'El intento AGT-002 ya está en estado terminal completed.' using errcode = '22023';
    end if;
    if not (
      (v_previous.state = 'queued' and p_state in ('running', 'retry_wait', 'needs_attention', 'unavailable'))
      or (v_previous.state = 'running' and p_state in ('completed', 'retry_wait', 'needs_attention', 'unavailable'))
      or (v_previous.state in ('retry_wait', 'needs_attention', 'unavailable') and p_state = 'queued')
    ) then
      raise exception 'Transición de estado AGT-002 no permitida: % -> %', v_previous.state, p_state using errcode = '22023';
    end if;
  end if;

  insert into public.psi_agt002_analysis_attempt_events (
    snapshot_id, opportunity_id, tender_id, attempt_key, event_key, producer, state,
    error_code, error_message, analysis_run_id
  ) values (
    p_snapshot_id, p_opportunity_id, p_tender_id, p_attempt_key, p_event_key, p_producer, p_state,
    nullif(btrim(p_error_code), ''), nullif(btrim(p_error_message), ''), p_analysis_run_id
  ) returning * into v_event;

  return jsonb_build_object('id', v_event.id, 'attempt_key', v_event.attempt_key, 'state', v_event.state, 'analysis_run_id', v_event.analysis_run_id, 'created_at', v_event.created_at);
end;
$$;

revoke all on function public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb) from public, authenticated, anon, service_role;
grant execute on function public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb) to service_role;
revoke all on function public.psi_append_agt002_analysis_attempt(uuid, uuid, uuid, text, text, text, text, text, text, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_append_agt002_analysis_attempt(uuid, uuid, uuid, text, text, text, text, text, text, uuid) to service_role;

commit;
