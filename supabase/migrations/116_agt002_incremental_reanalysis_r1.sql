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
  -- INITIAL v2 canonical runs have no legacy context_version_id. Null binds that fact
  -- explicitly; the R1 dispatcher creates a new context on the current document snapshot.
  prior_context_version_id uuid references public.psi_agt002_context_versions(id) on delete restrict,
  requested_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
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
  prior_context_version_id uuid references public.psi_agt002_context_versions(id) on delete restrict,
  validates_signal_id uuid references public.psi_agt002_incremental_signals(id) on delete restrict,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint psi_agt002_incremental_signal_trust_shape check (
    (trust_class = 'trusted' and change_set_id is not null)
    or (trust_class = 'pending_validation' and change_set_id is null and validates_signal_id is null)
  ),
  constraint psi_agt002_incremental_signal_actor_shape check (
    (trigger_kind = 'official_document' and actor_profile_id is null and source_batch_id is not null)
    or (trigger_kind <> 'official_document' and actor_profile_id is not null and source_batch_id is null)
  )
);

create unique index psi_agt002_incremental_signal_identity_idx
  on public.psi_agt002_incremental_signals
    (opportunity_id, source_table, source_type, source_id, source_version, content_hash, trust_class,
      coalesce(validates_signal_id, '00000000-0000-0000-0000-000000000000'::uuid));
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

-- Byte-for-byte counterpart of the server's sorted-key JSON hash. Seal recomputes
-- the manifest hash under the opportunity advisory lock; it never trusts the caller's hash.
create or replace function public.psi_agt002_incremental_stable_json_text(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_type text := jsonb_typeof(p_value);
  v_text text;
begin
  if v_type = 'object' then
    select '{' || coalesce(string_agg(to_jsonb(item.key)::text || ':' ||
      public.psi_agt002_incremental_stable_json_text(item.value), ',' order by item.key), '') || '}'
    into v_text from jsonb_each(p_value) item;
    return v_text;
  elsif v_type = 'array' then
    select '[' || coalesce(string_agg(public.psi_agt002_incremental_stable_json_text(item.value), ',' order by item.ordinal), '') || ']'
    into v_text from jsonb_array_elements(p_value) with ordinality item(value, ordinal);
    return v_text;
  end if;
  return p_value::text;
end;
$$;
revoke all on function public.psi_agt002_incremental_stable_json_text(jsonb) from public, anon, authenticated;

create or replace function public.psi_agt002_incremental_affected_finding_refs(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(ref) order by ref), '[]'::jsonb)
  from (
    select distinct coalesce(
      nullif(item ->> 'finding_ref', ''),
      nullif(item ->> 'id', ''),
      nullif(item ->> 'finding_id', ''),
      nullif(item ->> 'claim_id', ''),
      nullif(item ->> 'unit_id', ''),
      nullif(item ->> 'requirement_id', ''),
      'prior-finding-' || ordinal::text
    ) as ref
    from public.psi_tender_analysis_runs run
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(run.result -> 'findings') = 'array' then run.result -> 'findings'
        when jsonb_typeof(run.result #> '{integral_analysis,findings}') = 'array'
          then run.result #> '{integral_analysis,findings}'
        when jsonb_typeof(run.result #> '{integral_analysis,analysis_units}') = 'array'
          then run.result #> '{integral_analysis,analysis_units}'
        else '[]'::jsonb
      end
    ) with ordinality as finding(item, ordinal)
    where run.id = p_run_id
  ) refs;
$$;
revoke all on function public.psi_agt002_incremental_affected_finding_refs(uuid) from public, anon, authenticated;
grant execute on function public.psi_agt002_incremental_affected_finding_refs(uuid) to service_role;

create or replace function public.psi_record_agt002_incremental_signals(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_source_batch_id uuid,
  p_source_transaction_id text,
  p_requested_by uuid,
  p_signals jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tender public.psi_public_tenders%rowtype;
  v_requester public.psi_sales_profiles%rowtype;
  v_prior public.psi_tender_analysis_runs%rowtype;
  v_set public.psi_agt002_incremental_change_sets%rowtype;
  v_signal jsonb;
  v_signal_id uuid;
  v_signal_ids jsonb := '[]'::jsonb;
  v_members jsonb;
  v_affected_finding_refs jsonb;
  v_trust_class text;
  v_has_active boolean;
  v_validates_signal_id uuid;
  v_pending public.psi_agt002_incremental_signals%rowtype;
  v_source_batch_ids jsonb;
  v_manifest_core jsonb;
  v_manifest jsonb;
  v_manifest_hash text;
begin
  if p_opportunity_id is null or p_tender_id is null or p_requested_by is null
     or nullif(btrim(coalesce(p_source_transaction_id, '')), '') is null
     or jsonb_typeof(p_signals) <> 'array' or jsonb_array_length(p_signals) = 0 then
    raise exception 'El ingreso incremental requiere oportunidad, licitación, transacción y señales.' using errcode = '22023';
  end if;

  select * into v_tender from public.psi_public_tenders where id = p_tender_id for share;
  if not found or v_tender.converted_opportunity_id is distinct from p_opportunity_id then
    raise exception 'R1 sólo admite licitaciones ya convertidas y ligadas a la oportunidad.' using errcode = '42501';
  end if;

  select * into v_requester from public.psi_sales_profiles where id = p_requested_by for share;
  if not found or v_requester.active is not true then
    raise exception 'El solicitante incremental no corresponde a un perfil activo.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-incremental:' || p_opportunity_id::text, 18374300397482569));

  select * into v_prior
  from public.psi_tender_analysis_runs
  where opportunity_id = p_opportunity_id and tender_id = p_tender_id
    and producer = 'AGT-002' and status = 'completed' and canonical = true
  for share;
  if not found then
    raise exception 'R1 nunca crea la primera corrida: falta un análisis canónico.' using errcode = '55000';
  end if;

  select value ->> 'trust_class' into v_trust_class from jsonb_array_elements(p_signals) limit 1;
  if v_trust_class not in ('trusted', 'pending_validation')
     or exists (select 1 from jsonb_array_elements(p_signals) item where item ->> 'trust_class' is distinct from v_trust_class) then
    raise exception 'Un ingreso incremental debe tener una sola clase de confianza válida.' using errcode = '22023';
  end if;

  -- Validate every source and any pending->trusted reference before creating a set.
  -- Validation is append-only: the uncertain row is never promoted or updated.
  for v_signal in select value from jsonb_array_elements(p_signals)
  loop
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
       or ((v_signal ->> 'trigger_kind') <> 'official_document' and nullif(v_signal ->> 'actor_profile_id', '') is null)
       or ((v_signal ->> 'trigger_kind') <> 'official_document'
         and nullif(v_signal ->> 'actor_profile_id', '')::uuid is distinct from p_requested_by) then
      raise exception 'La identidad de actor/lote no coincide con el tipo de señal.' using errcode = '22023';
    end if;
    v_validates_signal_id := nullif(v_signal ->> 'validates_signal_id', '')::uuid;
    if v_trust_class = 'pending_validation' and v_validates_signal_id is not null then
      raise exception 'Una señal pendiente no puede validar otra señal.' using errcode = '22023';
    end if;
    if v_trust_class = 'trusted' and v_validates_signal_id is not null then
      select * into v_pending from public.psi_agt002_incremental_signals
      where id = v_validates_signal_id for share;
      if not found or v_pending.trust_class <> 'pending_validation'
         or v_pending.opportunity_id is distinct from p_opportunity_id
         or v_pending.tender_id is distinct from p_tender_id
         or v_pending.source_table is distinct from v_signal ->> 'source_table'
         or v_pending.source_type is distinct from v_signal ->> 'source_type'
         or v_pending.source_id is distinct from v_signal ->> 'source_id'
         or v_pending.source_version is distinct from v_signal ->> 'source_version' then
        raise exception 'La referencia de validación no corresponde a la señal pendiente.' using errcode = '22023';
      end if;
    elsif v_trust_class = 'trusted' and exists (
      select 1 from public.psi_agt002_incremental_signals pending
      where pending.opportunity_id = p_opportunity_id and pending.tender_id = p_tender_id
        and pending.trust_class = 'pending_validation'
        and pending.source_table = v_signal ->> 'source_table'
        and pending.source_type = v_signal ->> 'source_type'
        and pending.source_id = v_signal ->> 'source_id'
        and pending.source_version = v_signal ->> 'source_version'
    ) then
      raise exception 'La validación confiable debe referenciar explícitamente la señal pendiente.' using errcode = '22023';
    end if;
  end loop;

  -- A replay made entirely of already-ledgered trusted signals is a no-op. In
  -- particular it must not leave behind an empty ACCUMULATING change set.
  if v_trust_class = 'trusted' and not exists (
    select 1
    from jsonb_array_elements(p_signals) input(value)
    where not exists (
      select 1 from public.psi_agt002_incremental_signals existing
      where existing.opportunity_id = p_opportunity_id
        and existing.source_table = input.value ->> 'source_table'
        and existing.source_type = input.value ->> 'source_type'
        and existing.source_id = input.value ->> 'source_id'
        and existing.source_version = input.value ->> 'source_version'
        and existing.content_hash = input.value ->> 'content_hash'
        and existing.trust_class = 'trusted'
        and existing.validates_signal_id is not distinct from nullif(input.value ->> 'validates_signal_id', '')::uuid
    )
  ) then
    select jsonb_agg(to_jsonb(existing.id) order by existing.id) into v_signal_ids
    from public.psi_agt002_incremental_signals existing
    join jsonb_array_elements(p_signals) input(value)
      on existing.opportunity_id = p_opportunity_id
      and existing.source_table = input.value ->> 'source_table'
      and existing.source_type = input.value ->> 'source_type'
      and existing.source_id = input.value ->> 'source_id'
      and existing.source_version = input.value ->> 'source_version'
      and existing.content_hash = input.value ->> 'content_hash'
      and existing.trust_class = 'trusted'
      and existing.validates_signal_id is not distinct from nullif(input.value ->> 'validates_signal_id', '')::uuid;
    select change_set.* into v_set
    from public.psi_agt002_incremental_change_sets change_set
    join public.psi_agt002_incremental_signals existing on existing.change_set_id = change_set.id
    join jsonb_array_elements(p_signals) input(value)
      on existing.source_table = input.value ->> 'source_table'
      and existing.source_type = input.value ->> 'source_type'
      and existing.source_id = input.value ->> 'source_id'
      and existing.source_version = input.value ->> 'source_version'
      and existing.content_hash = input.value ->> 'content_hash'
      and existing.validates_signal_id is not distinct from nullif(input.value ->> 'validates_signal_id', '')::uuid
    where existing.opportunity_id = p_opportunity_id and existing.trust_class = 'trusted'
    order by change_set.created_at desc limit 1;
    select jsonb_agg(jsonb_build_object(
      'signal_id', id::text, 'trigger_kind', trigger_kind, 'source_table', source_table,
      'source_type', source_type, 'source_id', source_id, 'source_version', source_version,
      'content_hash', content_hash, 'observed_at', to_char(observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'actor_profile_id', actor_profile_id::text, 'source_batch_id', source_batch_id::text
    ) order by id) into v_members
    from public.psi_agt002_incremental_signals where change_set_id = v_set.id;
    v_affected_finding_refs := case when v_set.manifest is null
      then public.psi_agt002_incremental_affected_finding_refs(v_set.prior_canonical_run_id)
      else v_set.manifest -> 'affected_finding_refs' end;
    return jsonb_build_object(
      'status', case when v_set.state = 'ACCUMULATING' then 'accumulating' else 'existing' end,
      'change_set_id', v_set.id, 'prior_canonical_run_id', v_set.prior_canonical_run_id,
      'prior_context_version_id', v_set.prior_context_version_id, 'policy_version', v_set.policy_version,
      'members', coalesce(v_members, '[]'::jsonb),
      'affected_finding_refs', coalesce(v_affected_finding_refs, '[]'::jsonb),
      'comparison_excerpts', coalesce(v_set.manifest -> 'comparison_excerpts', '[]'::jsonb),
      'manifest_hash', v_set.manifest_hash, 'signal_ids', coalesce(v_signal_ids, '[]'::jsonb)
    );
  end if;

  if v_trust_class = 'trusted' then
    select * into v_set from public.psi_agt002_incremental_change_sets
    where opportunity_id = p_opportunity_id and state = 'ACCUMULATING'
    for update;
    if not found then
      insert into public.psi_agt002_incremental_change_sets (
        opportunity_id, tender_id, prior_canonical_run_id, prior_context_version_id,
        requested_by, source_transaction_id, state
      ) values (
        p_opportunity_id, p_tender_id, v_prior.id, v_prior.context_version_id,
        p_requested_by, p_source_transaction_id, 'ACCUMULATING'
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
    ) on conflict do nothing returning id into v_signal_id;
    if v_signal_id is null then
      select id into v_signal_id from public.psi_agt002_incremental_signals
      where opportunity_id = p_opportunity_id
        and source_table = v_signal ->> 'source_table' and source_type = v_signal ->> 'source_type'
        and source_id = v_signal ->> 'source_id' and source_version = v_signal ->> 'source_version'
        and content_hash = v_signal ->> 'content_hash' and trust_class = v_trust_class
        and validates_signal_id is not distinct from nullif(v_signal ->> 'validates_signal_id', '')::uuid;
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
  v_affected_finding_refs := public.psi_agt002_incremental_affected_finding_refs(v_set.prior_canonical_run_id);

  if not v_has_active then
    select coalesce(jsonb_agg(to_jsonb(batch_id) order by batch_id), '[]'::jsonb)
    into v_source_batch_ids
    from (
      select distinct source_batch_id::text as batch_id
      from public.psi_agt002_incremental_signals
      where change_set_id = v_set.id and source_batch_id is not null
    ) batches;
    v_manifest_core := jsonb_build_object(
      'schema_version', 'incremental_delta_manifest_v1',
      'opportunity_id', v_set.opportunity_id::text,
      'tender_id', v_set.tender_id::text,
      'change_set_id', v_set.id::text,
      'source_batch_ids', v_source_batch_ids,
      'prior_canonical_run_id', v_set.prior_canonical_run_id::text,
      'prior_context_version_id', to_jsonb(v_set.prior_context_version_id::text),
      'policy_version', v_set.policy_version,
      'members', coalesce(v_members, '[]'::jsonb),
      'affected_finding_refs', v_affected_finding_refs,
      'comparison_excerpts', '[]'::jsonb
    );
    v_manifest_hash := encode(extensions.digest(convert_to(
      public.psi_agt002_incremental_stable_json_text(v_manifest_core), 'UTF8'
    ), 'sha256'), 'hex');
    v_manifest := v_manifest_core || jsonb_build_object('manifest_hash', v_manifest_hash);
    update public.psi_agt002_incremental_change_sets
    set state = 'SEALED', manifest = v_manifest, manifest_hash = v_manifest_hash, sealed_at = now()
    where id = v_set.id;
    insert into public.psi_agt002_incremental_change_set_transitions
      (change_set_id, from_state, to_state, actor_kind, idempotency_key)
    values (v_set.id, 'ACCUMULATING', 'SEALED', 'service', 'r1:sealed:' || v_set.id::text);
  end if;

  return jsonb_build_object(
    'status', case when v_has_active then 'accumulating' else 'sealed' end,
    'change_set_id', v_set.id, 'prior_canonical_run_id', v_set.prior_canonical_run_id,
    'prior_context_version_id', v_set.prior_context_version_id, 'policy_version', v_set.policy_version,
    'members', coalesce(v_members, '[]'::jsonb),
    'affected_finding_refs', v_affected_finding_refs, 'comparison_excerpts', '[]'::jsonb,
    'manifest_hash', v_manifest_hash,
    'signal_ids', v_signal_ids
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
  v_affected_finding_refs jsonb;
  v_recomputed_hash text;
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
  v_affected_finding_refs := public.psi_agt002_incremental_affected_finding_refs(v_set.prior_canonical_run_id);
  v_recomputed_hash := encode(extensions.digest(convert_to(
    public.psi_agt002_incremental_stable_json_text(p_manifest - 'manifest_hash'), 'UTF8'
  ), 'sha256'), 'hex');
  if p_manifest ->> 'change_set_id' is distinct from v_set.id::text
     or p_manifest ->> 'opportunity_id' is distinct from v_set.opportunity_id::text
     or p_manifest ->> 'tender_id' is distinct from v_set.tender_id::text
     or p_manifest ->> 'prior_canonical_run_id' is distinct from v_set.prior_canonical_run_id::text
     or p_manifest ->> 'prior_context_version_id' is distinct from v_set.prior_context_version_id::text
     or p_manifest ->> 'policy_version' is distinct from v_set.policy_version
     or p_manifest -> 'members' is distinct from coalesce(v_members, '[]'::jsonb)
     or p_manifest -> 'affected_finding_refs' is distinct from v_affected_finding_refs
     or p_manifest -> 'comparison_excerpts' is distinct from '[]'::jsonb
     or p_manifest_hash is distinct from v_recomputed_hash then
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

create or replace function public.psi_start_agt002_incremental_change_set(
  p_job_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_set public.psi_agt002_incremental_change_sets%rowtype;
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
begin
  if p_job_id is null or nullif(btrim(coalesce(p_worker_id, '')), '') is null then
    raise exception 'El inicio incremental requiere job y worker.' using errcode = '22023';
  end if;
  select * into v_set from public.psi_agt002_incremental_change_sets where linked_job_id = p_job_id;
  if not found then return jsonb_build_object('status', 'not_incremental'); end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-incremental:' || v_set.opportunity_id::text, 18374300397482569));
  select * into v_set from public.psi_agt002_incremental_change_sets where id = v_set.id for update;
  if v_set.state = 'RUNNING' then
    return jsonb_build_object('status', 'existing', 'change_set_id', v_set.id, 'job_id', p_job_id);
  end if;
  select * into v_job from public.psi_agt002_reanalysis_jobs where id = p_job_id for share;
  if v_set.state <> 'DISPATCHED' or not found or v_job.status <> 'running' then
    raise exception 'El conjunto incremental no puede iniciar sin su job reclamado.' using errcode = '55000';
  end if;
  update public.psi_agt002_incremental_change_sets
  set state = 'RUNNING', started_at = now()
  where id = v_set.id;
  insert into public.psi_agt002_incremental_change_set_transitions
    (change_set_id, from_state, to_state, actor_kind, worker_id, job_id, idempotency_key)
  values (v_set.id, 'DISPATCHED', 'RUNNING', 'worker', btrim(p_worker_id), p_job_id,
    'r1:running:' || v_set.id::text);
  return jsonb_build_object('status', 'running', 'change_set_id', v_set.id, 'job_id', p_job_id);
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
  v_successor public.psi_agt002_incremental_change_sets%rowtype;
  v_job public.psi_agt002_reanalysis_jobs%rowtype;
  v_run public.psi_tender_analysis_runs%rowtype;
  v_next uuid;
  v_to text;
  v_members jsonb;
  v_affected_finding_refs jsonb;
  v_source_batch_ids jsonb;
  v_manifest_core jsonb;
  v_manifest jsonb;
  v_manifest_hash text;
begin
  select * into v_set from public.psi_agt002_incremental_change_sets where linked_job_id = p_job_id;
  if not found then return jsonb_build_object('status', 'not_incremental'); end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-incremental:' || v_set.opportunity_id::text, 18374300397482569));
  select * into v_set from public.psi_agt002_incremental_change_sets where id = v_set.id for update;
  if p_outcome = 'completed' and p_analysis_run_id is not null and p_safe_error is null then v_to := 'COMPLETED';
  elsif p_outcome = 'failed' and p_analysis_run_id is null and p_safe_error in ('timeout', 'provider_error', 'invalid_output', 'persistence_failure', 'lease_lost', 'capacity_unavailable') then v_to := 'FAILED';
  else raise exception 'El cierre incremental no tiene una forma permitida.' using errcode = '22023'; end if;
  select * into v_job from public.psi_agt002_reanalysis_jobs where id = p_job_id for share;
  if not found or v_job.status not in ('completed', 'unavailable')
     or (v_to = 'COMPLETED' and (v_job.status <> 'completed' or v_job.analysis_run_id is distinct from p_analysis_run_id))
     or (v_to = 'FAILED' and (v_job.status <> 'unavailable' or v_job.error_code is distinct from p_safe_error)) then
    raise exception 'El cierre incremental no coincide con el estado terminal del job.' using errcode = '55000';
  end if;
  if v_to = 'COMPLETED' then
    select * into v_run from public.psi_tender_analysis_runs where id = p_analysis_run_id for share;
    if not found or v_run.opportunity_id is distinct from v_set.opportunity_id
       or v_run.tender_id is distinct from v_set.tender_id or v_run.producer <> 'AGT-002'
       or v_run.status <> 'completed' or v_run.canonical is not true
       or v_run.supersedes_run_id is distinct from v_set.prior_canonical_run_id then
      raise exception 'La corrida sucesora incremental no conserva la línea canónica esperada.' using errcode = '55000';
    end if;
  end if;
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
  if v_next is not null and v_to = 'COMPLETED' then
    update public.psi_agt002_incremental_change_sets successor
    set prior_canonical_run_id = p_analysis_run_id,
        prior_context_version_id = (
          select context_version_id from public.psi_tender_analysis_runs where id = p_analysis_run_id
        )
    where successor.id = v_next;
  end if;
  if v_next is not null then
    select * into v_successor from public.psi_agt002_incremental_change_sets where id = v_next for update;
    select jsonb_agg(jsonb_build_object(
      'signal_id', id::text, 'trigger_kind', trigger_kind, 'source_table', source_table,
      'source_type', source_type, 'source_id', source_id, 'source_version', source_version,
      'content_hash', content_hash, 'observed_at', to_char(observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'actor_profile_id', actor_profile_id::text, 'source_batch_id', source_batch_id::text
    ) order by id) into v_members
    from public.psi_agt002_incremental_signals where change_set_id = v_successor.id;
    select coalesce(jsonb_agg(to_jsonb(batch_id) order by batch_id), '[]'::jsonb)
    into v_source_batch_ids
    from (
      select distinct source_batch_id::text as batch_id
      from public.psi_agt002_incremental_signals
      where change_set_id = v_successor.id and source_batch_id is not null
    ) batches;
    v_affected_finding_refs := public.psi_agt002_incremental_affected_finding_refs(v_successor.prior_canonical_run_id);
    v_manifest_core := jsonb_build_object(
      'schema_version', 'incremental_delta_manifest_v1',
      'opportunity_id', v_successor.opportunity_id::text,
      'tender_id', v_successor.tender_id::text,
      'change_set_id', v_successor.id::text,
      'source_batch_ids', v_source_batch_ids,
      'prior_canonical_run_id', v_successor.prior_canonical_run_id::text,
      'prior_context_version_id', to_jsonb(v_successor.prior_context_version_id::text),
      'policy_version', v_successor.policy_version,
      'members', coalesce(v_members, '[]'::jsonb),
      'affected_finding_refs', v_affected_finding_refs,
      'comparison_excerpts', '[]'::jsonb
    );
    v_manifest_hash := encode(extensions.digest(convert_to(
      public.psi_agt002_incremental_stable_json_text(v_manifest_core), 'UTF8'
    ), 'sha256'), 'hex');
    v_manifest := v_manifest_core || jsonb_build_object('manifest_hash', v_manifest_hash);
    update public.psi_agt002_incremental_change_sets
    set state = 'SEALED', manifest = v_manifest, manifest_hash = v_manifest_hash, sealed_at = now()
    where id = v_successor.id;
    insert into public.psi_agt002_incremental_change_set_transitions
      (change_set_id, from_state, to_state, actor_kind, worker_id, idempotency_key)
    values (v_successor.id, 'ACCUMULATING', 'SEALED', 'worker', nullif(btrim(p_worker_id), ''),
      'r1:sealed:' || v_successor.id::text);
  end if;
  return jsonb_build_object('status', lower(v_to), 'change_set_id', v_set.id,
    'successor_ready_to_seal', false, 'successor_ready_to_dispatch', v_next is not null,
    'successor_change_set_id', v_next, 'successor_manifest_hash', v_manifest_hash);
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

revoke all on function public.psi_record_agt002_incremental_signals(uuid, uuid, uuid, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.psi_seal_agt002_incremental_change_set(uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.psi_dispatch_agt002_incremental_change_set(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.psi_start_agt002_incremental_change_set(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.psi_close_agt002_incremental_change_set(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.psi_has_pending_agt002_incremental_change_sets() from public, anon, authenticated, service_role;
grant execute on function public.psi_record_agt002_incremental_signals(uuid, uuid, uuid, text, uuid, jsonb) to service_role;
grant execute on function public.psi_seal_agt002_incremental_change_set(uuid, jsonb, text) to service_role;
grant execute on function public.psi_dispatch_agt002_incremental_change_set(uuid, uuid, text) to service_role;
grant execute on function public.psi_start_agt002_incremental_change_set(uuid, text) to service_role;
grant execute on function public.psi_close_agt002_incremental_change_set(uuid, text, uuid, text, text) to service_role;
grant execute on function public.psi_has_pending_agt002_incremental_change_sets() to service_role;

commit;
