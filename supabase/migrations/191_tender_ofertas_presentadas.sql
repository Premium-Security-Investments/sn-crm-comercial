-- 191 — Registrar ofertas presentadas y su resultado (encargo AGT-002 del 2026-11-07).
--
-- Problema: el CRM tiene 0 ofertas presentadas. Terminal TT-SPO-07-2026 se radicó el 4-nov (RPL 6017126) y sigue «en
-- preparación», porque la compuerta de la 042 sólo deja pasar a «lista para presentar» con el expediente completo. La
-- compuerta tiene sentido antes de radicar; cuando la oferta ya se radicó, el hecho hay que poder registrarlo.
--
-- Qué agrega, sin tocar el camino normal (la compuerta y GO/NO-GO siguen igual):
--   * `psi_tender_offer_submissions`: «presentada» (con radicado o RPL, fecha y hora, enlace o PDF de lo radicado y
--     quién registra) o «no presentada» (con motivo). Si el expediente no estaba completo, queda marcada y se guarda la
--     lista de lo que faltaba, sin aprobar nada.
--   * `psi_tender_offer_results`: ganada, perdida, rechazada o desierta, con su fuente, el puesto y el valor adjudicado.
--   * `psi_tender_offer_goals`: la meta anual de valor concursado, configurable por un administrador.
--   * La transición directa «en preparación → presentada» en la bitácora de estados, sólo por esta función.
-- Todo append-only.
begin;

create table if not exists public.psi_tender_offer_submissions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  kind text not null check (kind in ('presentada', 'no_presentada')),
  filing_reference text check (filing_reference is null or char_length(filing_reference) between 1 and 120),
  submitted_at timestamptz,
  evidence_url text check (evidence_url is null or (evidence_url ~* '^https://' and char_length(evidence_url) <= 2000)),
  reason text check (reason is null or char_length(reason) <= 2000),
  dossier_incomplete boolean not null default false,
  missing_at_submission jsonb not null default '{}'::jsonb check (jsonb_typeof(missing_at_submission) = 'object'),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (kind <> 'presentada' or (filing_reference is not null and submitted_at is not null and evidence_url is not null)),
  check (kind <> 'no_presentada' or nullif(btrim(coalesce(reason, '')), '') is not null)
);
create unique index if not exists psi_tender_offer_submissions_one on public.psi_tender_offer_submissions (opportunity_id);

create table if not exists public.psi_tender_offer_results (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  result text not null check (result in ('ganada', 'perdida', 'rechazada', 'desierta')),
  source_kind text not null check (source_kind in ('informe_evaluacion', 'acto_adjudicacion', 'otro')),
  source_url text check (source_url is null or (source_url ~* '^https://' and char_length(source_url) <= 2000)),
  source_note text check (source_note is null or char_length(source_note) <= 2000),
  rank integer check (rank is null or rank >= 1),
  bidders integer check (bidders is null or bidders >= 1),
  awarded_value numeric check (awarded_value is null or awarded_value > 0),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (source_url is not null or nullif(btrim(coalesce(source_note, '')), '') is not null),
  check (result <> 'ganada' or awarded_value is not null)
);
create unique index if not exists psi_tender_offer_results_one on public.psi_tender_offer_results (opportunity_id);

create table if not exists public.psi_tender_offer_goals (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2024 and 2100),
  target_value numeric not null check (target_value > 0),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists psi_tender_offer_goals_year on public.psi_tender_offer_goals (year, created_at desc);

create or replace function public.psi_tender_offer_records_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'Este registro de ofertas no se edita ni se borra.' using errcode = '42501';
end;
$$;
do $$
declare v_table text;
begin
  foreach v_table in array array['psi_tender_offer_submissions', 'psi_tender_offer_results', 'psi_tender_offer_goals'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_table);
    execute format('grant select on table public.%I to service_role', v_table);
    execute format('drop trigger if exists %I on public.%I', v_table || '_append_only', v_table);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.psi_tender_offer_records_append_only()', v_table || '_append_only', v_table);
  end loop;
end;
$$;

-- La bitácora de estados acepta «en preparación → presentada»: sólo la escribe la función de abajo, con evidencia.
alter table public.psi_tender_offer_status_transitions drop constraint if exists psi_tender_offer_status_transitions_valid_edge;
alter table public.psi_tender_offer_status_transitions add constraint psi_tender_offer_status_transitions_valid_edge check (
  (from_status = 'en_preparacion' and to_status in ('lista_para_presentar', 'presentada'))
  or (from_status = 'lista_para_presentar' and to_status = 'presentada')
  or (from_status = 'presentada' and to_status in ('adjudicada', 'no_adjudicada'))
);

-- Persona activa con el permiso de Licitaciones (la regla de la 163: el permiso manda, el rol de consulta no opera).
create or replace function public.psi_assert_tender_offer_record_actor(p_actor_id uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.psi_sales_profiles p
    join public.psi_profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'licitaciones'
    join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active
    where p.id = p_actor_id and p.active and coalesce(p.identity_type, 'human') = 'human'
      and p.role in ('admin', 'gerencia', 'director', 'comercial')
  ) then
    raise exception 'No tiene permisos para registrar la oferta.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.psi_assert_tender_offer_record_actor(uuid) from public, anon, authenticated;
grant execute on function public.psi_assert_tender_offer_record_actor(uuid) to service_role;

-- La licitación con GO vigente, bloqueada para el registro. Devuelve el id de la licitación.
create or replace function public.psi_lock_tender_offer_with_go(p_opportunity_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tender_id uuid; v_decision text;
begin
  perform 1 from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;
  select id into v_tender_id from public.psi_public_tenders where converted_opportunity_id = p_opportunity_id order by id limit 1 for update;
  if v_tender_id is null then raise exception 'No existe una licitación vinculada a la oportunidad.' using errcode = 'P0002'; end if;
  select d.decision into v_decision from public.psi_tender_go_no_go_decisions d
  where d.opportunity_id = p_opportunity_id and d.tender_id = v_tender_id
    and not exists (select 1 from public.psi_tender_go_no_go_decisions c where c.supersedes_decision_id = d.id)
  order by d.decided_at desc, d.id desc limit 1;
  if v_decision is distinct from 'go' then
    raise exception 'Registrar la oferta requiere una decisión GO vigente.' using errcode = '23514';
  end if;
  return v_tender_id;
end;
$$;
revoke all on function public.psi_lock_tender_offer_with_go(uuid) from public, anon, authenticated;
grant execute on function public.psi_lock_tender_offer_with_go(uuid) to service_role;

-- Presentada (con evidencia) o no presentada (con motivo). Una sola vez por licitación.
create or replace function public.psi_register_tender_offer_submission(p_opportunity_id uuid, p_actor_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tender_id uuid; v_status text; v_kind text; v_readiness jsonb := '{}'::jsonb; v_incomplete boolean := false;
  v_row public.psi_tender_offer_submissions%rowtype; v_ref text; v_url text; v_at timestamptz; v_reason text;
begin
  perform public.psi_assert_tender_offer_record_actor(p_actor_id);
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Faltan los datos del registro.' using errcode = '22023'; end if;
  v_kind := p_payload ->> 'kind';
  if v_kind not in ('presentada', 'no_presentada') then raise exception 'Indique si la oferta se presentó o no.' using errcode = '22023'; end if;
  v_ref := nullif(btrim(coalesce(p_payload ->> 'filing_reference', '')), '');
  v_url := nullif(btrim(coalesce(p_payload ->> 'evidence_url', '')), '');
  v_reason := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  begin v_at := nullif(p_payload ->> 'submitted_at', '')::timestamptz;
  exception when others then raise exception 'La fecha y hora de radicación no es válida.' using errcode = '22023'; end;
  if v_kind = 'presentada' then
    if v_ref is null then raise exception 'Falta el número de radicado o RPL.' using errcode = '22023'; end if;
    if v_at is null then raise exception 'Falta la fecha y hora de radicación.' using errcode = '22023'; end if;
    if v_at > now() + interval '1 hour' then raise exception 'La fecha de radicación no puede ser futura.' using errcode = '22023'; end if;
    if v_url is null or v_url !~* '^https://' then raise exception 'Falta el enlace (https) al PDF o a lo radicado.' using errcode = '22023'; end if;
  elsif v_reason is null then
    raise exception 'Diga por qué no se presentó.' using errcode = '22023';
  end if;

  v_tender_id := public.psi_lock_tender_offer_with_go(p_opportunity_id);
  if exists (select 1 from public.psi_tender_offer_submissions where opportunity_id = p_opportunity_id) then
    raise exception 'Esta licitación ya tiene registrado si se presentó.' using errcode = '23505';
  end if;
  select coalesce(tender_offer_status, 'pendiente_decision') into v_status from public.psi_sales_opportunities where id = p_opportunity_id;
  if v_status not in ('en_preparacion', 'lista_para_presentar') then
    raise exception 'La oferta está %, no se puede registrar como presentada.', v_status using errcode = '23514';
  end if;

  -- Lo que faltaba en el expediente, tal como lo dice la compuerta: se guarda, no se aprueba nada.
  if v_kind = 'presentada' and v_status = 'en_preparacion'
     and to_regprocedure('public.psi_evaluate_tender_dossier_readiness(uuid)') is not null then
    v_readiness := coalesce(public.psi_evaluate_tender_dossier_readiness(p_opportunity_id), '{}'::jsonb);
    v_incomplete := coalesce((v_readiness ->> 'ready')::boolean, false) is not true;
  end if;

  insert into public.psi_tender_offer_submissions (opportunity_id, tender_id, kind, filing_reference, submitted_at, evidence_url,
    reason, dossier_incomplete, missing_at_submission, actor_id)
  values (p_opportunity_id, v_tender_id, v_kind, v_ref, v_at, v_url, v_reason, v_incomplete,
    case when v_incomplete then v_readiness else '{}'::jsonb end, p_actor_id)
  returning * into v_row;

  if v_kind = 'presentada' then
    update public.psi_sales_opportunities set tender_offer_status = 'presentada' where id = p_opportunity_id;
    insert into public.psi_tender_offer_status_transitions (opportunity_id, tender_id, actor_id, from_status, to_status, note)
    values (p_opportunity_id, v_tender_id, p_actor_id, v_status, 'presentada',
      left('Radicada: ' || v_ref || case when v_incomplete then ' (expediente incompleto en el CRM)' else '' end, 2000));
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_register_tender_offer_submission(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.psi_register_tender_offer_submission(uuid, uuid, jsonb) to service_role;

-- Resultado de una oferta presentada. Ganada → adjudicada; perdida, rechazada o desierta → no adjudicada.
create or replace function public.psi_register_tender_offer_result(p_opportunity_id uuid, p_actor_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tender_id uuid; v_status text; v_result text; v_to text; v_row public.psi_tender_offer_results%rowtype;
  v_url text; v_note text; v_value numeric; v_rank integer; v_bidders integer;
begin
  perform public.psi_assert_tender_offer_record_actor(p_actor_id);
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Faltan los datos del resultado.' using errcode = '22023'; end if;
  v_result := p_payload ->> 'result';
  if v_result not in ('ganada', 'perdida', 'rechazada', 'desierta') then raise exception 'El resultado no es válido.' using errcode = '22023'; end if;
  if coalesce(p_payload ->> 'source_kind', '') not in ('informe_evaluacion', 'acto_adjudicacion', 'otro') then
    raise exception 'Diga de dónde sale el resultado (informe de evaluación, acto de adjudicación u otro).' using errcode = '22023';
  end if;
  v_url := nullif(btrim(coalesce(p_payload ->> 'source_url', '')), '');
  v_note := nullif(btrim(coalesce(p_payload ->> 'source_note', '')), '');
  if v_url is not null and v_url !~* '^https://' then raise exception 'El enlace de la fuente debe empezar por https://.' using errcode = '22023'; end if;
  if v_url is null and v_note is null then raise exception 'Falta el enlace o la referencia de la fuente.' using errcode = '22023'; end if;
  begin
    v_value := nullif(p_payload ->> 'awarded_value', '')::numeric;
    v_rank := nullif(p_payload ->> 'rank', '')::integer;
    v_bidders := nullif(p_payload ->> 'bidders', '')::integer;
  exception when others then raise exception 'El valor, el puesto o el número de oferentes no es un número.' using errcode = '22023'; end;
  if v_result = 'ganada' and v_value is null then raise exception 'Falta el valor adjudicado.' using errcode = '22023'; end if;

  v_tender_id := public.psi_lock_tender_offer_with_go(p_opportunity_id);
  select coalesce(tender_offer_status, 'pendiente_decision') into v_status from public.psi_sales_opportunities where id = p_opportunity_id;
  if v_status <> 'presentada' then raise exception 'Sólo se registra el resultado de una oferta presentada.' using errcode = '23514'; end if;
  if exists (select 1 from public.psi_tender_offer_results where opportunity_id = p_opportunity_id) then
    raise exception 'Esta oferta ya tiene resultado registrado.' using errcode = '23505';
  end if;

  insert into public.psi_tender_offer_results (opportunity_id, tender_id, result, source_kind, source_url, source_note, rank,
    bidders, awarded_value, actor_id)
  values (p_opportunity_id, v_tender_id, v_result, p_payload ->> 'source_kind', v_url, v_note, v_rank, v_bidders,
    case when v_result = 'ganada' then v_value end, p_actor_id)
  returning * into v_row;

  v_to := case when v_result = 'ganada' then 'adjudicada' else 'no_adjudicada' end;
  update public.psi_sales_opportunities set tender_offer_status = v_to where id = p_opportunity_id;
  insert into public.psi_tender_offer_status_transitions (opportunity_id, tender_id, actor_id, from_status, to_status, note)
  values (p_opportunity_id, v_tender_id, p_actor_id, 'presentada', v_to, left('Resultado: ' || v_result || coalesce(' · puesto ' || v_rank, ''), 2000));
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_register_tender_offer_result(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.psi_register_tender_offer_result(uuid, uuid, jsonb) to service_role;

-- Meta anual de valor concursado: la fija un administrador; vale la más reciente de cada año.
create or replace function public.psi_set_tender_offer_goal(p_actor_id uuid, p_year integer, p_target_value numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.psi_tender_offer_goals%rowtype;
begin
  if not exists (select 1 from public.psi_sales_profiles p where p.id = p_actor_id and p.active
                 and coalesce(p.identity_type, 'human') = 'human' and p.role = 'admin') then
    raise exception 'Sólo un administrador fija la meta anual.' using errcode = '42501';
  end if;
  insert into public.psi_tender_offer_goals (year, target_value, actor_id) values (p_year, p_target_value, p_actor_id) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_set_tender_offer_goal(uuid, integer, numeric) from public, anon, authenticated;
grant execute on function public.psi_set_tender_offer_goal(uuid, integer, numeric) to service_role;

-- La meta que Juan fijó para 2027: más de $150.000 M en valor de procesos donde se presenta oferta (encargo del 7-nov).
insert into public.psi_tender_offer_goals (year, target_value, actor_id)
select 2027, 150000000000, p.id from public.psi_sales_profiles p
where (p.id, p.full_name) = ('60b26173-1226-476b-a958-cf2917661432'::uuid, 'Juan Botero')
  and not exists (select 1 from public.psi_tender_offer_goals where year = 2027);

commit;
