-- Immutable, typed evidence foundation for tender-document analysis.
-- This migration stores analysis provenance only; it does not activate any AI transport.
begin;

create table if not exists public.psi_tender_document_snapshots (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  document_manifest jsonb not null check (jsonb_typeof(document_manifest) = 'object'),
  profile_snapshot jsonb not null check (jsonb_typeof(profile_snapshot) = 'object'),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (opportunity_id, document_hash, profile_hash)
);

create table if not exists public.psi_tender_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.psi_tender_document_snapshots(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  producer text not null check (producer in ('siio_rules_v1', 'HERMES-INTERIM', 'AGT-002')),
  method text not null check (method in ('rules', 'agent_ai')),
  status text not null check (status in ('completed', 'failed')),
  result jsonb,
  critical_open_count integer not null default 0 check (critical_open_count >= 0),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  schema_version text not null check (nullif(btrim(schema_version), '') is not null),
  policy_version text not null check (nullif(btrim(policy_version), '') is not null),
  model text,
  usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((producer = 'siio_rules_v1' and method = 'rules') or (producer in ('HERMES-INTERIM', 'AGT-002') and method = 'agent_ai')),
  check ((status = 'completed' and result is not null and jsonb_typeof(result) = 'object') or (status = 'failed' and result is null))
);

create index if not exists psi_tender_document_snapshots_opportunity_created_idx
  on public.psi_tender_document_snapshots (opportunity_id, created_at desc, id desc);
create index if not exists psi_tender_analysis_runs_snapshot_created_idx
  on public.psi_tender_analysis_runs (snapshot_id, created_at desc, id desc);
create index if not exists psi_tender_analysis_runs_opportunity_created_idx
  on public.psi_tender_analysis_runs (opportunity_id, created_at desc, id desc);

create or replace function public.psi_tender_document_snapshots_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_document_snapshots is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_tender_document_snapshots_immutable on public.psi_tender_document_snapshots;
create trigger psi_tender_document_snapshots_immutable
  before update or delete on public.psi_tender_document_snapshots
  for each row execute function public.psi_tender_document_snapshots_prevent_mutation();

create or replace function public.psi_tender_analysis_runs_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_analysis_runs is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_tender_analysis_runs_immutable on public.psi_tender_analysis_runs;
create trigger psi_tender_analysis_runs_immutable
  before update or delete on public.psi_tender_analysis_runs
  for each row execute function public.psi_tender_analysis_runs_prevent_mutation();

alter table public.psi_tender_document_snapshots enable row level security;
alter table public.psi_tender_analysis_runs enable row level security;
revoke all on table public.psi_tender_document_snapshots from public;
revoke all on table public.psi_tender_document_snapshots from authenticated;
revoke all on table public.psi_tender_document_snapshots from service_role;
revoke all on table public.psi_tender_analysis_runs from public;
revoke all on table public.psi_tender_analysis_runs from authenticated;
revoke all on table public.psi_tender_analysis_runs from service_role;
grant select on table public.psi_tender_document_snapshots to service_role;
grant select on table public.psi_tender_analysis_runs to service_role;

create or replace function public.psi_record_tender_document_snapshot(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_document_hash text,
  p_profile_hash text,
  p_document_manifest jsonb,
  p_profile_snapshot jsonb,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.psi_tender_document_snapshots%rowtype;
begin
  if p_document_hash is null or p_document_hash !~ '^[0-9a-f]{64}$'
     or p_profile_hash is null or p_profile_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Los hashes documentales y de perfil deben ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if p_document_manifest is null or jsonb_typeof(p_document_manifest) <> 'object'
     or p_profile_snapshot is null or jsonb_typeof(p_profile_snapshot) <> 'object' then
    raise exception 'El manifiesto documental y el perfil deben ser objetos estructurados.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.psi_sales_opportunities where id = p_opportunity_id) then
    raise exception 'La oportunidad no existe.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.psi_public_tenders
    where id = p_tender_id and converted_opportunity_id = p_opportunity_id
  ) then
    raise exception 'La licitación no está vinculada a la oportunidad indicada.' using errcode = '22023';
  end if;

  insert into public.psi_tender_document_snapshots (
    opportunity_id, tender_id, document_hash, profile_hash, document_manifest, profile_snapshot, actor_id
  ) values (
    p_opportunity_id, p_tender_id, p_document_hash, p_profile_hash, p_document_manifest, p_profile_snapshot, p_actor_id
  ) on conflict (opportunity_id, document_hash, profile_hash) do nothing;

  select * into v_snapshot
  from public.psi_tender_document_snapshots
  where opportunity_id = p_opportunity_id and document_hash = p_document_hash and profile_hash = p_profile_hash
  for share;
  if not found then
    raise exception 'No fue posible recuperar el snapshot documental.' using errcode = 'P0002';
  end if;
  if v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot documental existente pertenece a otra licitación.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', v_snapshot.id, 'opportunity_id', v_snapshot.opportunity_id, 'tender_id', v_snapshot.tender_id,
    'document_hash', v_snapshot.document_hash, 'profile_hash', v_snapshot.profile_hash,
    'created_at', v_snapshot.created_at
  );
end;
$$;

create or replace function public.psi_record_tender_analysis_run(
  p_snapshot_id uuid,
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_producer text,
  p_method text,
  p_status text,
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
  if p_producer not in ('siio_rules_v1', 'HERMES-INTERIM', 'AGT-002') then
    raise exception 'Productor de análisis no autorizado.' using errcode = '22023';
  end if;
  if (p_producer = 'siio_rules_v1' and p_method is distinct from 'rules')
     or (p_producer in ('HERMES-INTERIM', 'AGT-002') and p_method is distinct from 'agent_ai') then
    raise exception 'El método no está autorizado para el productor de análisis.' using errcode = '22023';
  end if;
  if p_status not in ('completed', 'failed') then
    raise exception 'El estado del análisis no es válido.' using errcode = '22023';
  end if;
  if p_status = 'completed' and (p_result is null or jsonb_typeof(p_result) <> 'object') then
    raise exception 'Un análisis completado requiere resultado estructurado.' using errcode = '22023';
  end if;
  if p_status = 'failed' and p_result is not null then
    raise exception 'Un análisis fallido no puede almacenar resultado.' using errcode = '22023';
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
  if not found then
    raise exception 'El snapshot documental no existe.' using errcode = 'P0002';
  end if;
  if v_snapshot.opportunity_id is distinct from p_opportunity_id or v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot no coincide con la oportunidad y licitación indicadas.' using errcode = '22023';
  end if;

  insert into public.psi_tender_analysis_runs (
    snapshot_id, opportunity_id, tender_id, producer, method, status, result, critical_open_count,
    idempotency_key, schema_version, policy_version, model, usage, completed_at
  ) values (
    p_snapshot_id, p_opportunity_id, p_tender_id, p_producer, p_method, p_status, p_result, p_critical_open_count,
    p_idempotency_key, p_schema_version, p_policy_version, nullif(btrim(p_model), ''), p_usage,
    case when p_status = 'completed' then now() else null end
  ) on conflict (idempotency_key) do nothing;

  select * into v_run
  from public.psi_tender_analysis_runs
  where idempotency_key = p_idempotency_key
  for share;
  if not found then
    raise exception 'La clave de idempotencia ya pertenece a otro análisis.' using errcode = '23505';
  end if;
  if v_run.snapshot_id is distinct from p_snapshot_id
     or v_run.opportunity_id is distinct from p_opportunity_id
     or v_run.tender_id is distinct from p_tender_id
     or v_run.producer is distinct from p_producer
     or v_run.method is distinct from p_method
     or v_run.status is distinct from p_status
     or v_run.result is distinct from p_result
     or v_run.critical_open_count is distinct from p_critical_open_count
     or v_run.schema_version is distinct from p_schema_version
     or v_run.policy_version is distinct from p_policy_version
     or v_run.model is distinct from nullif(btrim(p_model), '')
     or v_run.usage is distinct from p_usage then
    raise exception 'La clave de idempotencia ya pertenece a otro análisis.' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'id', v_run.id, 'snapshot_id', v_run.snapshot_id, 'opportunity_id', v_run.opportunity_id,
    'tender_id', v_run.tender_id, 'producer', v_run.producer, 'method', v_run.method,
    'status', v_run.status, 'critical_open_count', v_run.critical_open_count,
    'created_at', v_run.created_at, 'completed_at', v_run.completed_at
  );
end;
$$;

revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from public;
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from authenticated;
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from service_role;
grant execute on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) to service_role;
revoke all on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) from public;
revoke all on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) from authenticated;
revoke all on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) from service_role;
grant execute on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) to service_role;

-- 022 stored the timeline interaction for compatibility.  New decisions bind the
-- authoritative typed run while legacy rows retain their historical link.
alter table public.psi_tender_go_no_go_decisions
  add column if not exists analysis_run_id uuid references public.psi_tender_analysis_runs(id) on delete restrict;

-- PostgreSQL identifies functions by their argument types, not argument names.
-- 022 used p_analysis_interaction_id in this same position, so it must be
-- removed before the typed p_analysis_run_id replacement can be defined.
drop function if exists public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb);

create or replace function public.psi_record_tender_go_no_go(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_analysis_run_id uuid,
  p_justification text,
  p_preparation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_tender public.psi_public_tenders%rowtype;
  v_analysis public.psi_tender_analysis_runs%rowtype;
  v_previous_id uuid;
  v_decision_id uuid;
  v_preparation_id uuid;
  v_preparation_created boolean := false;
  v_status text;
  v_now timestamptz := now();
begin
  if p_decision is null or p_decision not in ('go', 'no_go') then
    raise exception 'La decisión debe ser go o no_go.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles p
    join public.psi_profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'licitaciones'
    join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active = true
    where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') = 'human' and p.role in ('admin', 'gerencia', 'director')
  ) then
    raise exception 'No tiene permisos para registrar una decisión de licitación.' using errcode = '42501';
  end if;

  select * into v_opportunity from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;
  select * into v_tender from public.psi_public_tenders where id = p_tender_id for update;
  if not found then raise exception 'La licitación no existe.' using errcode = 'P0002'; end if;
  if v_tender.converted_opportunity_id is distinct from p_opportunity_id then
    raise exception 'La licitación no está vinculada a la oportunidad indicada.' using errcode = '22023';
  end if;
  if v_opportunity.tipo_producto_original is distinct from 'Licitación Pública' and coalesce(v_opportunity.external_source, '') not like 'secop_radar:%' then
    raise exception 'La oportunidad no tiene origen de licitación pública.' using errcode = '22023';
  end if;

  if p_analysis_run_id is not null then
    select r.* into v_analysis
    from public.psi_tender_analysis_runs r
    where r.id = p_analysis_run_id and r.opportunity_id = p_opportunity_id and r.tender_id = p_tender_id
    for share;
    if not found then
      raise exception 'El análisis indicado no pertenece a esta oportunidad y licitación.' using errcode = '22023';
    end if;
  end if;

  select d.id into v_previous_id
    from public.psi_tender_go_no_go_decisions d
    where d.opportunity_id = p_opportunity_id
      and d.tender_id = p_tender_id
      and not exists (
        select 1 from public.psi_tender_go_no_go_decisions child
        where child.supersedes_decision_id = d.id
      )
    order by d.decided_at desc, d.id desc
    limit 1;
  insert into public.psi_tender_go_no_go_decisions (
    opportunity_id, tender_id, decision, analysis_interaction_id, analysis_run_id,
    justification, decided_by, decided_at, supersedes_decision_id
  ) values (
    p_opportunity_id, p_tender_id, p_decision, null, p_analysis_run_id,
    nullif(btrim(p_justification), ''), p_actor_id, v_now, v_previous_id
  ) returning id into v_decision_id;

  if p_decision = 'go' then
    select i.id into v_preparation_id
      from public.psi_sales_interactions i
      where i.opportunity_id = p_opportunity_id and i.interaction_type = 'documento'
        and public.psi_safe_jsonb(i.notes)->>'kind' = 'tender_offer_preparation'
      order by i.occurred_at desc, i.id desc limit 1;
    if v_preparation_id is null then
      if p_preparation is null or jsonb_typeof(p_preparation) <> 'object' or p_preparation->>'kind' is distinct from 'tender_offer_preparation' then
        raise exception 'GO requiere una preparación de oferta JSON con kind tender_offer_preparation.' using errcode = '22023';
      end if;
      insert into public.psi_sales_interactions (opportunity_id, interaction_type, created_by, occurred_at, notes)
      values (p_opportunity_id, 'documento', p_actor_id, v_now, p_preparation::text)
      returning id into v_preparation_id;
      v_preparation_created := true;
    end if;
    v_status := 'en_preparacion';
  else
    v_status := 'cerrada_no_go';
  end if;

  update public.psi_sales_opportunities set tender_offer_status = v_status where id = p_opportunity_id;
  return jsonb_build_object('decision_id', v_decision_id, 'supersedes_decision_id', v_previous_id, 'decision', p_decision, 'preparation_id', v_preparation_id, 'preparation_created', v_preparation_created, 'tender_offer_status', v_status);
end;
$$;

revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from public;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from authenticated;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from service_role;
grant execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) to service_role;

-- Side-effect-free runtime readiness probe.  It verifies the exact 025
-- relations and RPC overloads without invoking either mutating function.
create or replace function public.psi_tender_analysis_foundation_ready()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    to_regclass('public.psi_tender_document_snapshots') is not null
    and to_regclass('public.psi_tender_analysis_runs') is not null
    and to_regprocedure('public.psi_record_tender_document_snapshot(uuid,uuid,text,text,jsonb,jsonb,uuid)') is not null
    and to_regprocedure('public.psi_record_tender_analysis_run(uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,text,text,jsonb)') is not null
    and to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb)') is not null
    and has_function_privilege('service_role', 'public.psi_record_tender_document_snapshot(uuid,uuid,text,text,jsonb,jsonb,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.psi_record_tender_analysis_run(uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,text,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb)', 'EXECUTE');
$$;

revoke all on function public.psi_tender_analysis_foundation_ready() from public;
revoke all on function public.psi_tender_analysis_foundation_ready() from authenticated;
revoke all on function public.psi_tender_analysis_foundation_ready() from service_role;
grant execute on function public.psi_tender_analysis_foundation_ready() to service_role;

commit;
