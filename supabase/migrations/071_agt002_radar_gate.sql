-- AGT-002 Radar deterministic-gate append-only ledger. Local schema only until separately authorized.
begin;

create table public.psi_agt002_radar_gate_evaluations (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  stable_key text not null check (nullif(btrim(stable_key), '') is not null),
  verdict text not null check (verdict in ('eliminada', 'sobreviviente')),
  rule_ids text[] not null default '{}',
  reasons jsonb not null,
  data_gaps jsonb not null default '[]'::jsonb,
  policy_version text not null check (nullif(btrim(policy_version), '') is not null),
  context_version text not null check (nullif(btrim(context_version), '') is not null),
  source_row_hash text not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint psi_agt002_radar_gate_evaluations_verdict_rules_check check (
    (verdict = 'eliminada' and coalesce(array_length(rule_ids, 1), 0) >= 1 and jsonb_array_length(reasons) >= 1)
    or (verdict = 'sobreviviente' and coalesce(array_length(rule_ids, 1), 0) = 0 and jsonb_array_length(reasons) = 0)
  ),
  constraint psi_agt002_radar_gate_evaluations_reasons_shape_check check (jsonb_typeof(reasons) = 'array'),
  constraint psi_agt002_radar_gate_evaluations_gaps_shape_check check (jsonb_typeof(data_gaps) = 'array')
);

create index psi_agt002_radar_gate_evaluations_tender_idx on public.psi_agt002_radar_gate_evaluations(tender_id, evaluated_at desc, id desc);
create index psi_agt002_radar_gate_evaluations_verdict_idx on public.psi_agt002_radar_gate_evaluations(verdict, evaluated_at desc);

create function public.psi_block_agt002_radar_gate_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception using errcode='55000', message='AGT-002 Radar gate ledger is append-only';
end;
$$;
create trigger psi_agt002_radar_gate_append_only before update or delete on public.psi_agt002_radar_gate_evaluations
for each row execute function public.psi_block_agt002_radar_gate_mutation();

alter table public.psi_agt002_radar_gate_evaluations enable row level security;
revoke all on table public.psi_agt002_radar_gate_evaluations from public, anon, authenticated, service_role;
grant select on table public.psi_agt002_radar_gate_evaluations to service_role;

create function public.psi_record_agt002_radar_gate_evaluation(
  p_tender_id uuid, p_stable_key text, p_verdict text, p_rule_ids text[], p_reasons jsonb,
  p_data_gaps jsonb, p_policy_version text, p_context_version text, p_source_row_hash text,
  p_idempotency_key text, p_evaluated_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_existing public.psi_agt002_radar_gate_evaluations%rowtype;
  v_created public.psi_agt002_radar_gate_evaluations%rowtype;
  v_reason jsonb;
begin
  if p_tender_id is null or nullif(btrim(p_stable_key),'') is null
    or p_verdict not in ('eliminada','sobreviviente')
    or p_rule_ids is null or jsonb_typeof(p_reasons) <> 'array' or jsonb_typeof(p_data_gaps) <> 'array'
    or nullif(btrim(p_policy_version),'') is null or nullif(btrim(p_context_version),'') is null
    or p_source_row_hash !~ '^[0-9a-f]{64}$' or nullif(btrim(p_idempotency_key),'') is null
    or p_evaluated_at is null then
    raise exception using errcode='22023', message='invalid AGT-002 Radar gate evaluation';
  end if;
  if (p_verdict='eliminada' and (coalesce(array_length(p_rule_ids,1),0)=0 or jsonb_array_length(p_reasons)=0))
    or (p_verdict='sobreviviente' and (coalesce(array_length(p_rule_ids,1),0)<>0 or jsonb_array_length(p_reasons)<>0)) then
    raise exception using errcode='22023', message='invalid AGT-002 Radar gate verdict evidence';
  end if;
  for v_reason in select value from jsonb_array_elements(p_reasons) loop
    if jsonb_typeof(v_reason) <> 'object'
      or not (v_reason ?& array['rule_id','field','observed_value','source','policy_version','context_version'])
      or (select count(*) from jsonb_object_keys(v_reason)) <> 6
      or not ((v_reason->>'rule_id') = any(p_rule_ids))
      or nullif(btrim(v_reason->>'field'),'') is null
      or nullif(btrim(v_reason->>'observed_value'),'') is null
      or nullif(btrim(v_reason->>'source'),'') is null
      or v_reason->>'policy_version' <> p_policy_version
      or v_reason->>'context_version' <> p_context_version then
      raise exception using errcode='22023', message='invalid AGT-002 Radar gate reason';
    end if;
  end loop;
  if not exists(select 1 from public.psi_public_tenders t where t.id=p_tender_id and t.stable_key=p_stable_key) then
    raise exception using errcode='22023', message='invalid AGT-002 Radar tender identity';
  end if;

  -- Corto circuito de idempotencia. La comparacion cubre exactamente el payload semantico
  -- inmutable: la misma clave con evidencia distinta sigue siendo 23505. `evaluated_at` queda
  -- deliberadamente fuera porque es cuando se observo la fila, no que se concluyo de ella: cada
  -- disparo del temporizador trae un reloj nuevo sobre una fila sin cambios, y exigirlo aqui
  -- convertia toda segunda corrida en un 23505 permanente. Gana la primera observacion.
  select * into v_existing from public.psi_agt002_radar_gate_evaluations where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.tender_id=p_tender_id and v_existing.stable_key=p_stable_key and v_existing.verdict=p_verdict
      and v_existing.rule_ids=p_rule_ids and v_existing.reasons=p_reasons and v_existing.data_gaps=p_data_gaps
      and v_existing.policy_version=p_policy_version and v_existing.context_version=p_context_version
      and v_existing.source_row_hash=p_source_row_hash then
      return jsonb_build_object('status','existing','id',v_existing.id);
    end if;
    raise exception using errcode='23505', message='AGT-002 Radar gate idempotency conflict';
  end if;

  insert into public.psi_agt002_radar_gate_evaluations(
    tender_id,stable_key,verdict,rule_ids,reasons,data_gaps,policy_version,context_version,source_row_hash,idempotency_key,evaluated_at
  ) values (
    p_tender_id,p_stable_key,p_verdict,p_rule_ids,p_reasons,p_data_gaps,p_policy_version,p_context_version,p_source_row_hash,p_idempotency_key,p_evaluated_at
  ) returning * into v_created;
  return jsonb_build_object('status','created','id',v_created.id);
end;
$$;

revoke all on function public.psi_record_agt002_radar_gate_evaluation(uuid,text,text,text[],jsonb,jsonb,text,text,text,text,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.psi_record_agt002_radar_gate_evaluation(uuid,text,text,text[],jsonb,jsonb,text,text,text,text,timestamptz) to service_role;
revoke all on function public.psi_block_agt002_radar_gate_mutation() from public, anon, authenticated, service_role;

commit;
