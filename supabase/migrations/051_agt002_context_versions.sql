begin;

-- Append-only versions of the AGT-002 / Vig-IA context v2 payload. Every new
-- analysis run must reference the exact, immutable context version it consumed
-- (including the human answers effective at that moment) so past analyses stay
-- reproducible even after new answers or evidence arrive later.
create table if not exists public.psi_agt002_context_versions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  snapshot_id uuid not null references public.psi_tender_document_snapshots(id) on delete restrict,
  context_version integer not null check (context_version = 2),
  context jsonb not null check (jsonb_typeof(context) = 'object'),
  context_hash text not null check (nullif(btrim(context_hash), '') is not null),
  human_evidence_count integer not null default 0 check (human_evidence_count >= 0),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists psi_agt002_context_versions_opportunity_idx
  on public.psi_agt002_context_versions (opportunity_id, created_at desc, id desc);
create index if not exists psi_agt002_context_versions_snapshot_idx
  on public.psi_agt002_context_versions (snapshot_id, created_at desc, id desc);

create or replace function public.psi_agt002_context_versions_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_agt002_context_versions is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_agt002_context_versions_immutable on public.psi_agt002_context_versions;
create trigger psi_agt002_context_versions_immutable
  before update or delete on public.psi_agt002_context_versions
  for each row execute function public.psi_agt002_context_versions_prevent_mutation();

alter table public.psi_agt002_context_versions enable row level security;
revoke all on table public.psi_agt002_context_versions from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_context_versions to service_role;

-- Each analysis run may reference the exact context version it consumed. Historical
-- rule/HERMES runs and pre-existing AGT-002 runs keep this column null; nothing about
-- past rows changes.
alter table public.psi_tender_analysis_runs
  add column if not exists context_version_id uuid references public.psi_agt002_context_versions(id) on delete restrict;

create index if not exists psi_tender_analysis_runs_context_version_idx
  on public.psi_tender_analysis_runs (context_version_id)
  where context_version_id is not null;

create or replace function public.psi_record_agt002_context_version(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_snapshot_id uuid,
  p_context_version integer,
  p_context jsonb,
  p_context_hash text,
  p_human_evidence_count integer,
  p_idempotency_key text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.psi_tender_document_snapshots%rowtype;
  v_version public.psi_agt002_context_versions%rowtype;
begin
  if p_context_version is distinct from 2 then
    raise exception 'La versión de contexto AGT-002 no es válida.' using errcode = '22023';
  end if;
  if p_context is null or jsonb_typeof(p_context) <> 'object' then
    raise exception 'El contexto debe ser un objeto estructurado.' using errcode = '22023';
  end if;
  if nullif(btrim(p_context_hash), '') is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'El hash y la clave de idempotencia del contexto son obligatorios.' using errcode = '22023';
  end if;
  if p_human_evidence_count is null or p_human_evidence_count < 0 then
    raise exception 'El conteo de evidencia humana no es válido.' using errcode = '22023';
  end if;

  select * into v_snapshot from public.psi_tender_document_snapshots where id = p_snapshot_id for share;
  if not found then raise exception 'El snapshot documental no existe.' using errcode = 'P0002'; end if;
  if v_snapshot.opportunity_id is distinct from p_opportunity_id or v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot no coincide con la oportunidad y licitación indicadas.' using errcode = '22023';
  end if;

  insert into public.psi_agt002_context_versions (
    opportunity_id, tender_id, snapshot_id, context_version, context, context_hash,
    human_evidence_count, idempotency_key, created_by
  ) values (
    p_opportunity_id, p_tender_id, p_snapshot_id, p_context_version, p_context, p_context_hash,
    p_human_evidence_count, p_idempotency_key, p_actor_id
  ) on conflict (idempotency_key) do nothing;

  select * into v_version from public.psi_agt002_context_versions where idempotency_key = p_idempotency_key for share;
  if not found
     or v_version.opportunity_id is distinct from p_opportunity_id
     or v_version.tender_id is distinct from p_tender_id
     or v_version.snapshot_id is distinct from p_snapshot_id
     or v_version.context_hash is distinct from p_context_hash
     or v_version.human_evidence_count is distinct from p_human_evidence_count then
    raise exception 'La clave de idempotencia ya pertenece a otra versión de contexto.' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'id', v_version.id, 'opportunity_id', v_version.opportunity_id, 'tender_id', v_version.tender_id,
    'snapshot_id', v_version.snapshot_id, 'context_version', v_version.context_version,
    'context', v_version.context, 'context_hash', v_version.context_hash,
    'human_evidence_count', v_version.human_evidence_count, 'created_at', v_version.created_at
  );
end;
$$;

revoke all on function public.psi_record_agt002_context_version(uuid, uuid, uuid, integer, jsonb, text, integer, text, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_record_agt002_context_version(uuid, uuid, uuid, integer, jsonb, text, integer, text, uuid) to service_role;

-- Supersede 050's canonical-run RPC with one additional optional parameter so a
-- canonical AGT-002 run can be linked to the exact context version it consumed.
-- The original 10-parameter overload is dropped (not left dangling) so callers
-- cannot silently keep recording canonical runs without an attributable context
-- version once this migration is applied.
drop function if exists public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb);

create function public.psi_record_agt002_canonical_analysis_run(
  p_snapshot_id uuid,
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_result jsonb,
  p_critical_open_count integer,
  p_idempotency_key text,
  p_schema_version text,
  p_policy_version text,
  p_model text default null,
  p_usage jsonb default null,
  p_context_version_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.psi_tender_document_snapshots%rowtype;
  v_run public.psi_tender_analysis_runs%rowtype;
  v_context_version public.psi_agt002_context_versions%rowtype;
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

  if p_context_version_id is not null then
    select * into v_context_version from public.psi_agt002_context_versions where id = p_context_version_id for share;
    if not found then raise exception 'La versión de contexto AGT-002 no existe.' using errcode = 'P0002'; end if;
    if v_context_version.opportunity_id is distinct from p_opportunity_id
       or v_context_version.tender_id is distinct from p_tender_id
       or v_context_version.snapshot_id is distinct from p_snapshot_id then
      raise exception 'La versión de contexto no coincide con la oportunidad, licitación y snapshot indicados.' using errcode = '22023';
    end if;
  end if;

  insert into public.psi_tender_analysis_runs (
    snapshot_id, opportunity_id, tender_id, producer, method, status, result, critical_open_count,
    idempotency_key, schema_version, policy_version, model, usage, completed_at, canonical, context_version_id
  ) values (
    p_snapshot_id, p_opportunity_id, p_tender_id, 'AGT-002', 'agent_ai', 'completed', p_result,
    p_critical_open_count, p_idempotency_key, p_schema_version, p_policy_version,
    nullif(btrim(p_model), ''), p_usage, now(), true, p_context_version_id
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
     or v_run.canonical is distinct from true
     or v_run.context_version_id is distinct from p_context_version_id then
    raise exception 'La clave de idempotencia ya pertenece a otro análisis.' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'id', v_run.id, 'snapshot_id', v_run.snapshot_id, 'opportunity_id', v_run.opportunity_id,
    'tender_id', v_run.tender_id, 'producer', v_run.producer, 'method', v_run.method,
    'status', v_run.status, 'canonical', v_run.canonical, 'critical_open_count', v_run.critical_open_count,
    'context_version_id', v_run.context_version_id, 'created_at', v_run.created_at, 'completed_at', v_run.completed_at
  );
end;
$$;

revoke all on function public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_record_agt002_canonical_analysis_run(uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid) to service_role;

commit;
