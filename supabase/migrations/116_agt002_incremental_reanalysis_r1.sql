-- AGT-002 R1: event-directed incremental reanalysis.
-- Additive beside INITIAL and the explicit full REANALYSIS introduced by 108.
-- No trigger in this migration can create the first canonical run, decide GO/NO-GO,
-- or perform an external action. All callable surfaces are service_role-only.
begin;

create table public.psi_agt002_incremental_change_sets (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  prior_canonical_run_id uuid not null references public.psi_tender_analysis_runs(id) on delete restrict,
  prior_context_version_id uuid not null references public.psi_agt002_context_versions(id) on delete restrict,
  source_transaction_id text not null check (nullif(btrim(source_transaction_id), '') is not null),
  state text not null check (state in ('ACCUMULATING', 'SEALED', 'DISPATCHED', 'RUNNING', 'COMPLETED', 'FAILED')),
  policy_version text not null default 'agt002.incremental.r1.v1'
    check (policy_version = 'agt002.incremental.r1.v1'),
  manifest jsonb,
  manifest_hash text check (manifest_hash is null or manifest_hash ~ '^[0-9a-f]{64}$'),
  linked_job_id uuid references public.psi_agt002_reanalysis_jobs(id) on delete restrict,
  linked_run_id uuid references public.psi_tender_analysis_runs(id) on delete restrict,
  safe_error text check (safe_error is null or safe_error in (
    'timeout', 'provider_error', 'invalid_output', 'persistence_failure', 'lease_lost', 'capacity_unavailable'
  )),
  created_at timestamptz not null default now(),
  sealed_at timestamptz,
  dispatched_at timestamptz,
  started_at timestamptz,
  closed_at timestamptz,
  constraint psi_agt002_incremental_change_sets_shape check (
    (state = 'ACCUMULATING' and manifest is null and manifest_hash is null and linked_job_id is null and linked_run_id is null and safe_error is null)
    or (state = 'SEALED' and manifest is not null and manifest_hash is not null and linked_job_id is null and linked_run_id is null and safe_error is null)
    or (state in ('DISPATCHED', 'RUNNING') and manifest is not null and manifest_hash is not null and linked_job_id is not null and linked_run_id is null and safe_error is null)
    or (state = 'COMPLETED' and manifest is not null and manifest_hash is not null and linked_job_id is not null and linked_run_id is not null and safe_error is null)
    or (state = 'FAILED' and manifest is not null and manifest_hash is not null and linked_job_id is not null and linked_run_id is null and safe_error is not null)
  )
);

create unique index psi_agt002_incremental_one_accumulating_idx
  on public.psi_agt002_incremental_change_sets (opportunity_id)
  where state = 'ACCUMULATING';
create unique index psi_agt002_incremental_one_active_idx
  on public.psi_agt002_incremental_change_sets (opportunity_id)
  where state in ('SEALED', 'DISPATCHED', 'RUNNING');
create unique index psi_agt002_incremental_one_job_idx
  on public.psi_agt002_incremental_change_sets (linked_job_id)
  where linked_job_id is not null;

create table public.psi_agt002_incremental_signals (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  change_set_id uuid references public.psi_agt002_incremental_change_sets(id) on delete restrict,
  trigger_kind text not null check (trigger_kind in (
    'official_document', 'human_document', 'company_evidence_link', 'human_interaction', 'actionable_review'
  )),
  trust_class text not null check (trust_class in ('trusted', 'pending_validation')),
  actor_profile_id uuid references public.psi_sales_profiles(id) on delete restrict,
  source_table text not null check (nullif(btrim(source_table), '') is not null),
  source_type text not null check (nullif(btrim(source_type), '') is not null),
  source_id text not null check (nullif(btrim(source_id), '') is not null),
  source_version text not null check (nullif(btrim(source_version), '') is not null),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_batch_id uuid,
  source_transaction_id text not null check (nullif(btrim(source_transaction_id), '') is not null),
  prior_canonical_run_id uuid not null references public.psi_tender_analysis_runs(id) on delete restrict,
  prior_context_version_id uuid not null references public.psi_agt002_context_versions(id) on delete restrict,
  validates_signal_id uuid references public.psi_agt002_incremental_signals(id) on delete restrict,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint psi_agt002_incremental_signal_trust_shape check (
    (trust_class = 'trusted' and change_set_id is not null)
    or (trust_class = 'pending_validation' and change_set_id is null)
  ),
  constraint psi_agt002_incremental_signal_actor_shape check (
    (trigger_kind = 'official_document' and actor_profile_id is null and source_batch_id is not null)
    or (trigger_kind <> 'official_document' and actor_profile_id is not null and source_batch_id is null)
  )
);

create unique index psi_agt002_incremental_signal_identity_idx
  on public.psi_agt002_incremental_signals
    (opportunity_id, source_table, source_type, source_id, source_version, content_hash);
create index psi_agt002_incremental_signal_set_idx
  on public.psi_agt002_incremental_signals (change_set_id, id);
create index psi_agt002_incremental_pending_validation_idx
  on public.psi_agt002_incremental_signals (opportunity_id, created_at)
  where trust_class = 'pending_validation';

create table public.psi_agt002_incremental_change_set_transitions (
  id uuid primary key default gen_random_uuid(),
  change_set_id uuid not null references public.psi_agt002_incremental_change_sets(id) on delete restrict,
  from_state text,
  to_state text not null check (to_state in ('ACCUMULATING', 'SEALED', 'DISPATCHED', 'RUNNING', 'COMPLETED', 'FAILED')),
  actor_kind text not null check (actor_kind in ('service', 'worker')),
  worker_id text,
  job_id uuid references public.psi_agt002_reanalysis_jobs(id) on delete restrict,
  run_id uuid references public.psi_tender_analysis_runs(id) on delete restrict,
  safe_error text,
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  created_at timestamptz not null default now()
);

create or replace function public.psi_agt002_incremental_append_only_guard()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

create trigger psi_agt002_incremental_signals_append_only
  before update or delete on public.psi_agt002_incremental_signals
  for each row execute function public.psi_agt002_incremental_append_only_guard();
create trigger psi_agt002_incremental_transitions_append_only
  before update or delete on public.psi_agt002_incremental_change_set_transitions
  for each row execute function public.psi_agt002_incremental_append_only_guard();

alter table public.psi_agt002_incremental_change_sets enable row level security;
alter table public.psi_agt002_incremental_signals enable row level security;
alter table public.psi_agt002_incremental_change_set_transitions enable row level security;
revoke all on public.psi_agt002_incremental_change_sets from public, anon, authenticated;
revoke all on public.psi_agt002_incremental_signals from public, anon, authenticated;
revoke all on public.psi_agt002_incremental_change_set_transitions from public, anon, authenticated;
grant select on public.psi_agt002_incremental_change_sets to service_role;
grant select on public.psi_agt002_incremental_signals to service_role;
grant select on public.psi_agt002_incremental_change_set_transitions to service_role;

create or replace function public.psi_record_agt002_incremental_signals(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_source_batch_id uuid,
  p_source_transaction_id text,
  p_signals jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tender public.psi_public_tenders%rowtype;
  v_prior public.psi_tender_analysis_runs%rowtype;
  v_set public.psi_agt002_incremental_change_sets%rowtype;
  v_signal jsonb;
  v_signal_id uuid;
  v_signal_ids jsonb := '[]'::jsonb;
  v_members jsonb;
  v_trust_class text;
  v_has_active boolean;
begin
  if p_opportunity_id is null or p_tender_id is null
     or nullif(btrim(coalesce(p_source_transaction_id, '')), '') is null
     or jsonb_typeof(p_signals) <> 'array' or jsonb_array_length(p_signals) = 0 then
    raise exception 'El ingreso incremental requiere oportunidad, licitación, transacción y señales.' using errcode = '22023';
  end if;

  select * into v_tender from public.psi_public_tenders where id = p_tender_id for share;
  if not found or v_tender.converted_opportunity_id is distinct from p_opportunity_id then
    raise exception 'R1 sólo admite licitaciones ya convertidas y ligadas a la oportunidad.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-incremental:' || p_opportunity_id::text, 18374300397482569));

  select * into v_prior
  from public.psi_tender_analysis_runs
  where opportunity_id = p_opportunity_id and tender_id = p_tender_id
    and producer = 'AGT-002' and status = 'completed' and canonical = true
  for share;
  if not found or v_prior.context_version_id is null then
    raise exception 'R1 nunca crea la primera corrida: falta un análisis canónico con contexto.' using errcode = '55000';
  end if;

  select value ->> 'trust_class' into v_trust_class from jsonb_array_elements(p_signals) limit 1;
  if v_trust_class not in ('trusted', 'pending_validation')
     or exists (select 1 from jsonb_array_elements(p_signals) item where item ->> 'trust_class' is distinct from v_trust_class) then
    raise exception 'Un ingreso incremental debe tener una sola clase de confianza válida.' using errcode = '22023';
  end if;

  if v_trust_class = 'trusted' then
    select * into v_set from public.psi_agt002_incremental_change_sets
    where opportunity_id = p_opportunity_id and state = 'ACCUMULATING'
    for update;
    if not found then
      insert into public.psi_agt002_incremental_change_sets (
        opportunity_id, tender_id, prior_canonical_run_id, prior_context_version_id,
        source_transaction_id, state
      ) values (
        p_opportunity_id, p_tender_id, v_prior.id, v_prior.context_version_id,
        p_source_transaction_id, 'ACCUMULATING'
      ) returning * into v_set;
      insert into public.psi_agt002_incremental_change_set_transitions
        (change_set_id, from_state, to_state, actor_kind, idempotency_key)
      values (v_set.id, null, 'ACCUMULATING', 'service', 'r1:accumulating:' || v_set.id::text);
    elsif v_set.tender_id is distinct from p_tender_id
       or v_set.prior_canonical_run_id is distinct from v_prior.id then
      raise exception 'El conjunto acumulando ya no coincide con la corrida canónica vigente.' using errcode = '55000';
    end if;
  end if;

  for v_signal in select value from jsonb_array_elements(p_signals)
  loop
    v_signal_id := null;
    if (v_signal ->> 'trigger_kind') not in ('official_document', 'human_document', 'company_evidence_link', 'human_interaction', 'actionable_review')
       or nullif(btrim(coalesce(v_signal ->> 'source_table', '')), '') is null
       or nullif(btrim(coalesce(v_signal ->> 'source_type', '')), '') is null
       or nullif(btrim(coalesce(v_signal ->> 'source_id', '')), '') is null
       or nullif(btrim(coalesce(v_signal ->> 'source_version', '')), '') is null
       or coalesce(v_signal ->> 'content_hash', '') !~ '^[0-9a-f]{64}$'
       or nullif(btrim(coalesce(v_signal ->> 'observed_at', '')), '') is null then
      raise exception 'Una señal incremental no tiene la forma cerrada requerida.' using errcode = '22023';
    end if;
    if ((v_signal ->> 'trigger_kind') = 'official_document') is distinct from (p_source_batch_id is not null)
       or ((v_signal ->> 'trigger_kind') = 'official_document' and nullif(v_signal ->> 'actor_profile_id', '') is not null)
       or ((v_signal ->> 'trigger_kind') <> 'official_document' and nullif(v_signal ->> 'actor_profile_id', '') is null) then
      raise exception 'La identidad de actor/lote no coincide con el tipo de señal.' using errcode = '22023';
    end if;

    insert into public.psi_agt002_incremental_signals (
      opportunity_id, tender_id, change_set_id, trigger_kind, trust_class, actor_profile_id,
      source_table, source_type, source_id, source_version, content_hash, source_batch_id,
      source_transaction_id, prior_canonical_run_id, prior_context_version_id,
      validates_signal_id, observed_at
    ) values (
      p_opportunity_id, p_tender_id, case when v_trust_class = 'trusted' then v_set.id else null end,
      v_signal ->> 'trigger_kind', v_trust_class, nullif(v_signal ->> 'actor_profile_id', '')::uuid,
      v_signal ->> 'source_table', v_signal ->> 'source_type', v_signal ->> 'source_id',
      v_signal ->> 'source_version', v_signal ->> 'content_hash', p_source_batch_id,
      p_source_transaction_id, v_prior.id, v_prior.context_version_id,
      nullif(v_signal ->> 'validates_signal_id', '')::uuid, (v_signal ->> 'observed_at')::timestamptz
    ) on conflict (opportunity_id, source_table, source_type, source_id, source_version, content_hash)
      do nothing returning id into v_signal_id;
    if v_signal_id is null then
      select id into v_signal_id from public.psi_agt002_incremental_signals
      where opportunity_id = p_opportunity_id
        and source_table = v_signal ->> 'source_table' and source_type = v_signal ->> 'source_type'
        and source_id = v_signal ->> 'source_id' and source_version = v_signal ->> 'source_version'
        and content_hash = v_signal ->> 'content_hash';
    end if;
    v_signal_ids := v_signal_ids || jsonb_build_array(v_signal_id);
  end loop;

  if v_trust_class = 'pending_validation' then
    return jsonb_build_object('status', 'pending_validation', 'signal_ids', v_signal_ids);
  end if;

  select exists (
    select 1 from public.psi_agt002_reanalysis_jobs
    where opportunity_id = p_opportunity_id and status in ('queued', 'running')
  ) or exists (
    select 1 from public.psi_agt002_incremental_change_sets
    where opportunity_id = p_opportunity_id and state in ('SEALED', 'DISPATCHED', 'RUNNING')
  ) into v_has_active;

  select jsonb_agg(jsonb_build_object(
    'signal_id', id::text, 'trigger_kind', trigger_kind, 'source_table', source_table,
    'source_type', source_type, 'source_id', source_id, 'source_version', source_version,
    'content_hash', content_hash, 'observed_at', to_char(observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'actor_profile_id', actor_profile_id::text, 'source_batch_id', source_batch_id::text
  ) order by id) into v_members
  from public.psi_agt002_incremental_signals where change_set_id = v_set.id;

  return jsonb_build_object(
    'status', case when v_has_active then 'accumulating' else 'ready_to_seal' end,
    'change_set_id', v_set.id, 'prior_canonical_run_id', v_set.prior_canonical_run_id,
    'prior_context_version_id', v_set.prior_context_version_id, 'policy_version', v_set.policy_version,
    'members', coalesce(v_members, '[]'::jsonb), 'signal_ids', v_signal_ids
  );
end;
$$;

create or replace function public.psi_seal_agt002_incremental_change_set(
  p_change_set_id uuid,
  p_manifest jsonb,
  p_manifest_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_set public.psi_agt002_incremental_change_sets%rowtype;
  v_members jsonb;
begin
  if p_manifest_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_manifest) <> 'object'
     or p_manifest ->> 'manifest_hash' is distinct from p_manifest_hash
     or p_manifest ->> 'schema_version' is distinct from 'incremental_delta_manifest_v1' then
    raise exception 'El manifiesto incremental o su hash no son válidos.' using errcode = '22023';
  end if;
  select * into v_set from public.psi_agt002_incremental_change_sets where id = p_change_set_id;
  if not found then raise exception 'El conjunto incremental no existe.' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-incremental:' || v_set.opportunity_id::text, 18374300397482569));
  select * into v_set from public.psi_agt002_incremental_change_sets where id = p_change_set_id for update;
  if v_set.state = 'SEALED' then
    if v_set.manifest is distinct from p_manifest or v_set.manifest_hash is distinct from p_manifest_hash then
      raise exception 'El conjunto ya fue sellado con otro manifiesto.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'change_set_id', v_set.id, 'manifest_hash', v_set.manifest_hash);
  end if;
  if v_set.state <> 'ACCUMULATING' then raise exception 'El conjunto no está acumulando.' using errcode = '55000'; end if;
  if exists (select 1 from public.psi_agt002_reanalysis_jobs where opportunity_id = v_set.opportunity_id and status in ('queued', 'running'))
     or exists (select 1 from public.psi_agt002_incremental_change_sets where opportunity_id = v_set.opportunity_id and id <> v_set.id and state in ('SEALED', 'DISPATCHED', 'RUNNING')) then
    raise exception 'Existe otro trabajo incremental activo; el sucesor aún no puede sellarse.' using errcode = '55000';
  end if;
  select jsonb_agg(jsonb_build_object(
    'signal_id', id::text, 'trigger_kind', trigger_kind, 'source_table', source_table,
    'source_type', source_type, 'source_id', source_id, 'source_version', source_version,
    'content_hash', content_hash, 'observed_at', to_char(observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'actor_profile_id', actor_profile_id::text, 'source_batch_id', source_batch_id::text
  ) order by id) into v_members from public.psi_agt002_incremental_signals where change_set_id = v_set.id;
  if p_manifest ->> 'change_set_id' is distinct from v_set.id::text
     or p_manifest ->> 'opportunity_id' is distinct from v_set.opportunity_id::text
     or p_manifest ->> 'tender_id' is distinct from v_set.tender_id::text
     or p_manifest ->> 'prior_canonical_run_id' is distinct from v_set.prior_canonical_run_id::text
     or p_manifest ->> 'prior_context_version_id' is distinct from v_set.prior_context_version_id::text
     or p_manifest ->> 'policy_version' is distinct from v_set.policy_version
     or p_manifest -> 'members' is distinct from coalesce(v_members, '[]'::jsonb) then
    raise exception 'El manifiesto no coincide con la membresía server-side.' using errcode = '55000';
  end if;
  update public.psi_agt002_incremental_change_sets
  set state = 'SEALED', manifest = p_manifest, manifest_hash = p_manifest_hash, sealed_at = now()
  where id = v_set.id;
  insert into public.psi_agt002_incremental_change_set_transitions
    (change_set_id, from_state, to_state, actor_kind, idempotency_key)
  values (v_set.id, 'ACCUMULATING', 'SEALED', 'service', 'r1:sealed:' || v_set.id::text);
  return jsonb_build_object('status', 'sealed', 'change_set_id', v_set.id, 'manifest_hash', p_manifest_hash);
end;
$$;

create or replace function public.psi_dispatch_agt002_incremental_change_set(
  p_change_set_id uuid,
  p_job_id uuid,
  p_manifest_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_set public.psi_agt002_incremental_change_sets%rowtype;
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
begin
  select * into v_set from public.psi_agt002_incremental_change_sets where id = p_change_set_id;
  if not found then raise exception 'El conjunto incremental no existe.' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-incremental:' || v_set.opportunity_id::text, 18374300397482569));
  select * into v_set from public.psi_agt002_incremental_change_sets where id = p_change_set_id for update;
  select * into v_job from public.psi_agt002_reanalysis_jobs where id = p_job_id for share;
  if not found or v_job.opportunity_id is distinct from v_set.opportunity_id
     or v_job.tender_id is distinct from v_set.tender_id or v_job.status <> 'queued'
     or v_job.frozen_engine_input #>> '{incremental_delta_manifest,manifest_hash}' is distinct from p_manifest_hash then
    raise exception 'El job no corresponde al manifiesto incremental sellado.' using errcode = '55000';
  end if;
  if v_set.state = 'DISPATCHED' then
    if v_set.linked_job_id is distinct from p_job_id then raise exception 'El conjunto ya fue despachado a otro job.' using errcode = '23505'; end if;
    return jsonb_build_object('status', 'existing', 'change_set_id', v_set.id, 'job_id', p_job_id);
  end if;
  if v_set.state <> 'SEALED' or v_set.manifest_hash is distinct from p_manifest_hash then
    raise exception 'El conjunto no está sellado con el manifiesto indicado.' using errcode = '55000';
  end if;
  update public.psi_agt002_incremental_change_sets
  set state = 'DISPATCHED', linked_job_id = p_job_id, dispatched_at = now()
  where id = v_set.id;
  insert into public.psi_agt002_incremental_change_set_transitions
    (change_set_id, from_state, to_state, actor_kind, job_id, idempotency_key)
  values (v_set.id, 'SEALED', 'DISPATCHED', 'service', p_job_id, 'r1:dispatched:' || v_set.id::text);
  return jsonb_build_object('status', 'dispatched', 'change_set_id', v_set.id, 'job_id', p_job_id);
end;
$$;

create or replace function public.psi_close_agt002_incremental_change_set(
  p_job_id uuid,
  p_outcome text,
  p_analysis_run_id uuid,
  p_safe_error text,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_set public.psi_agt002_incremental_change_sets%rowtype;
  v_next uuid;
  v_to text;
begin
  select * into v_set from public.psi_agt002_incremental_change_sets where linked_job_id = p_job_id;
  if not found then return jsonb_build_object('status', 'not_incremental'); end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-incremental:' || v_set.opportunity_id::text, 18374300397482569));
  select * into v_set from public.psi_agt002_incremental_change_sets where id = v_set.id for update;
  if p_outcome = 'completed' and p_analysis_run_id is not null and p_safe_error is null then v_to := 'COMPLETED';
  elsif p_outcome = 'failed' and p_analysis_run_id is null and p_safe_error in ('timeout', 'provider_error', 'invalid_output', 'persistence_failure', 'lease_lost', 'capacity_unavailable') then v_to := 'FAILED';
  else raise exception 'El cierre incremental no tiene una forma permitida.' using errcode = '22023'; end if;
  if v_set.state in ('COMPLETED', 'FAILED') then
    return jsonb_build_object('status', 'existing', 'change_set_id', v_set.id, 'outcome', lower(v_set.state));
  end if;
  if v_set.state not in ('DISPATCHED', 'RUNNING') then raise exception 'El conjunto incremental no está activo.' using errcode = '55000'; end if;
  update public.psi_agt002_incremental_change_sets
  set state = v_to, linked_run_id = p_analysis_run_id, safe_error = p_safe_error, closed_at = now()
  where id = v_set.id;
  insert into public.psi_agt002_incremental_change_set_transitions
    (change_set_id, from_state, to_state, actor_kind, worker_id, job_id, run_id, safe_error, idempotency_key)
  values (v_set.id, v_set.state, v_to, 'worker', nullif(btrim(p_worker_id), ''), p_job_id,
    p_analysis_run_id, p_safe_error, 'r1:closed:' || v_set.id::text);
  select id into v_next from public.psi_agt002_incremental_change_sets
    where opportunity_id = v_set.opportunity_id and state = 'ACCUMULATING' for update;
  return jsonb_build_object('status', lower(v_to), 'change_set_id', v_set.id,
    'successor_ready_to_seal', v_next is not null, 'successor_change_set_id', v_next);
end;
$$;

create or replace function public.psi_has_pending_agt002_incremental_change_sets()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.psi_agt002_incremental_change_sets
    where state in ('ACCUMULATING', 'SEALED', 'DISPATCHED', 'RUNNING')
  );
$$;

revoke all on function public.psi_record_agt002_incremental_signals(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.psi_seal_agt002_incremental_change_set(uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.psi_dispatch_agt002_incremental_change_set(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.psi_close_agt002_incremental_change_set(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.psi_has_pending_agt002_incremental_change_sets() from public, anon, authenticated, service_role;
grant execute on function public.psi_record_agt002_incremental_signals(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.psi_seal_agt002_incremental_change_set(uuid, jsonb, text) to service_role;
grant execute on function public.psi_dispatch_agt002_incremental_change_set(uuid, uuid, text) to service_role;
grant execute on function public.psi_close_agt002_incremental_change_set(uuid, text, uuid, text, text) to service_role;
grant execute on function public.psi_has_pending_agt002_incremental_change_sets() to service_role;

commit;
