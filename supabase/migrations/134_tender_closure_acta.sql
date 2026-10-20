-- Acta de cierre de licitación.
-- El punto de partida es la nota de cierre que escribe la persona al cerrar la
-- licitación; Vig-IA la profundiza con lo que tiene aprendido del expediente, y
-- la persona corrige y confirma. No hay lista de motivos predefinida: los
-- motivos los propone Vig-IA en el acta y la persona los ajusta.
-- El acta se abre para todos los cierres y nunca bloquea el cierre.
begin;

create table if not exists public.psi_tender_closure_acta (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  status text not null default 'borrador' check (status in ('borrador', 'confirmada')),
  closure_kind text not null check (closure_kind in ('adjudicada', 'no_adjudicada', 'cerrada_no_go', 'archivada')),
  -- Lo que escribió la persona al cerrar, tal cual, y de dónde se tomó.
  closing_note text,
  closing_note_source text check (closing_note_source in ('archive_note', 'status_transition', 'no_go_justification', 'manual')),
  -- Lo que Vig-IA profundiza a partir de esa nota y del expediente.
  decision_summary text,
  decision_quote text,
  requirements_unmet jsonb not null default '[]'::jsonb check (jsonb_typeof(requirements_unmet) = 'array'),
  factors_against jsonb not null default '[]'::jsonb check (jsonb_typeof(factors_against) = 'array'),
  gaps_to_compete jsonb not null default '[]'::jsonb check (jsonb_typeof(gaps_to_compete) = 'array'),
  recommendation text,
  system_lesson text,
  proposed_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  confirmed_by uuid references public.psi_sales_profiles(id) on delete restrict,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint psi_tender_closure_acta_confirmed_pair check ((status = 'confirmada') = (confirmed_by is not null and confirmed_at is not null))
);
create unique index if not exists psi_tender_closure_acta_once_idx on public.psi_tender_closure_acta (opportunity_id, tender_id);
create index if not exists psi_tender_closure_acta_status_idx on public.psi_tender_closure_acta (status, updated_at desc);

alter table public.psi_tender_closure_acta enable row level security;
revoke all on public.psi_tender_closure_acta from public, anon, authenticated, service_role;
grant select on public.psi_tender_closure_acta to service_role;

-- Motivos del cierre, en frases cortas que propone Vig-IA y la persona ajusta.
-- No hay catálogo fijo: el vocabulario se aprende de las actas confirmadas, y
-- el resumen mensual cuenta agrupando por `label`.
create table if not exists public.psi_tender_closure_acta_reason (
  acta_id uuid not null references public.psi_tender_closure_acta(id) on delete cascade,
  label text not null check (nullif(btrim(label), '') is not null and length(btrim(label)) <= 120),
  sort_order int not null default 0,
  primary key (acta_id, label)
);
create index if not exists psi_tender_closure_acta_reason_label_idx on public.psi_tender_closure_acta_reason (label);
alter table public.psi_tender_closure_acta_reason enable row level security;
revoke all on public.psi_tender_closure_acta_reason from public, anon, authenticated, service_role;
grant select on public.psi_tender_closure_acta_reason to service_role;

create table if not exists public.psi_tender_closure_acta_events (
  id uuid primary key default gen_random_uuid(),
  acta_id uuid not null references public.psi_tender_closure_acta(id) on delete restrict,
  action text not null check (action in ('propuesta', 'editada', 'confirmada', 'reabierta')),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists psi_tender_closure_acta_events_acta_idx on public.psi_tender_closure_acta_events (acta_id, created_at desc, id desc);

create or replace function public.psi_tender_closure_acta_events_prevent_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'El historial del acta de cierre es inmutable.';
end;
$$;
drop trigger if exists psi_tender_closure_acta_events_immutable on public.psi_tender_closure_acta_events;
create trigger psi_tender_closure_acta_events_immutable before update or delete on public.psi_tender_closure_acta_events for each row execute function public.psi_tender_closure_acta_events_prevent_mutation();
alter table public.psi_tender_closure_acta_events enable row level security;
revoke all on public.psi_tender_closure_acta_events from public, anon, authenticated, service_role;
grant select on public.psi_tender_closure_acta_events to service_role;

-- Cómo se cerró la oportunidad, o null si todavía no está cerrada.
create or replace function public.psi_tender_closure_kind(p_opportunity public.psi_sales_opportunities)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_opportunity.archived_at is not null then 'archivada'
    when coalesce(p_opportunity.tender_offer_status, 'pendiente_decision') in ('cerrada_no_go', 'adjudicada', 'no_adjudicada') then p_opportunity.tender_offer_status
    else null
  end;
$$;

-- La nota de cierre que ya escribió la persona, buscada donde queda en cada
-- camino de cierre. Es el punto de partida del acta, no se le pide otra vez.
create or replace function public.psi_tender_closure_note(p_opportunity_id uuid)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_note text;
begin
  select * into v_opportunity from public.psi_sales_opportunities where id = p_opportunity_id;
  if not found then return null; end if;

  v_note := nullif(btrim(coalesce(v_opportunity.archive_note, '')), '');
  if v_note is not null then return jsonb_build_object('note', v_note, 'source', 'archive_note'); end if;

  select nullif(btrim(coalesce(t.note, '')), '') into v_note
  from public.psi_tender_offer_status_transitions t
  where t.opportunity_id = p_opportunity_id and t.to_status in ('adjudicada', 'no_adjudicada') and nullif(btrim(coalesce(t.note, '')), '') is not null
  order by t.changed_at desc, t.id desc limit 1;
  if v_note is not null then return jsonb_build_object('note', v_note, 'source', 'status_transition'); end if;

  select nullif(btrim(coalesce(d.justification, '')), '') into v_note
  from public.psi_tender_go_no_go_decisions d
  where d.opportunity_id = p_opportunity_id and d.decision = 'no_go' and nullif(btrim(coalesce(d.justification, '')), '') is not null
    and not exists (select 1 from public.psi_tender_go_no_go_decisions child where child.supersedes_decision_id = d.id)
  order by d.decided_at desc, d.id desc limit 1;
  if v_note is not null then return jsonb_build_object('note', v_note, 'source', 'no_go_justification'); end if;

  return null;
end;
$$;
revoke all on function public.psi_tender_closure_note(uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_tender_closure_note(uuid) to service_role;

-- Licitaciones ya cerradas, con nota de cierre y sin acta: lo que Vig-IA tiene
-- pendiente por redactar. Sólo lectura; devuelve también el último análisis
-- vigente para que el borrador cite el expediente y no la memoria del modelo.
create or replace function public.psi_list_tender_closure_acta_pending(p_limit int)
returns table (opportunity_id uuid, tender_id uuid, closure_kind text, closing_note text, tender_name text, analysis_result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'El límite debe estar entre 1 y 50.' using errcode = '22023'; end if;
  return query
  select o.id, t.id, public.psi_tender_closure_kind(o), note.note, coalesce(t.title, o.company_name), run.result
  from public.psi_sales_opportunities o
  join public.psi_public_tenders t on t.converted_opportunity_id = o.id
  cross join lateral (select public.psi_tender_closure_note(o.id) as payload) closing
  cross join lateral (select closing.payload ->> 'note' as note) note
  left join lateral (
    select r.result from public.psi_tender_analysis_runs r
    where r.opportunity_id = o.id and r.tender_id = t.id
    order by r.created_at desc, r.id desc limit 1
  ) run on true
  where public.psi_tender_closure_kind(o) is not null
    and note.note is not null
    and not exists (select 1 from public.psi_tender_closure_acta a where a.opportunity_id = o.id)
  order by coalesce(o.archived_at, o.updated_at) desc nulls last, o.id asc
  limit p_limit;
end;
$$;
revoke all on function public.psi_list_tender_closure_acta_pending(int) from public, anon, authenticated, service_role;
grant execute on function public.psi_list_tender_closure_acta_pending(int) to service_role;

create or replace function public.psi_tender_closure_acta_snapshot(p_acta_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'acta', to_jsonb(a),
    'reasons', coalesce((select jsonb_agg(r.label order by r.sort_order, r.label) from public.psi_tender_closure_acta_reason r where r.acta_id = a.id), '[]'::jsonb)
  )
  from public.psi_tender_closure_acta a
  where a.id = p_acta_id;
$$;

create or replace function public.psi_get_tender_closure_acta(p_opportunity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_acta public.psi_tender_closure_acta%rowtype;
begin
  select * into v_acta from public.psi_tender_closure_acta where opportunity_id = p_opportunity_id;
  if not found then return null; end if;
  return public.psi_tender_closure_acta_snapshot(v_acta.id)
    || jsonb_build_object(
      'proposed_by_name', (select p.full_name from public.psi_sales_profiles p where p.id = v_acta.proposed_by),
      'confirmed_by_name', (select p.full_name from public.psi_sales_profiles p where p.id = v_acta.confirmed_by),
      'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actor_name', p.full_name, 'created_at', e.created_at) order by e.created_at desc, e.id desc) from public.psi_tender_closure_acta_events e left join public.psi_sales_profiles p on p.id = e.actor_id where e.acta_id = v_acta.id), '[]'::jsonb)
    );
end;
$$;
revoke all on function public.psi_get_tender_closure_acta(uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_get_tender_closure_acta(uuid) to service_role;

-- Crea o actualiza el borrador. Al crearlo toma la nota de cierre ya escrita por
-- la persona; Vig-IA ('agent') la profundiza y una persona autorizada corrige.
-- Un acta confirmada no se cambia sin reabrirla antes.
create or replace function public.psi_upsert_tender_closure_acta(p_opportunity_id uuid, p_actor_id uuid, p_payload jsonb, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_tender_id uuid;
  v_closure_kind text;
  v_acta public.psi_tender_closure_acta%rowtype;
  v_actor public.psi_sales_profiles%rowtype;
  v_reasons jsonb;
  v_closing jsonb;
  v_now timestamptz := now();
  v_action text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'El acta no trae contenido.' using errcode = '22023'; end if;

  select * into v_actor from public.psi_sales_profiles where id = p_actor_id and active = true;
  if not found then raise exception 'El autor del acta no es un perfil activo.' using errcode = '42501'; end if;
  if coalesce(v_actor.identity_type, 'human') = 'human' and v_actor.role not in ('admin', 'gerencia', 'director') then
    raise exception 'No tiene permisos para redactar el acta de cierre.' using errcode = '42501';
  end if;

  select * into v_opportunity from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;

  v_closure_kind := public.psi_tender_closure_kind(v_opportunity);
  if v_closure_kind is null then raise exception 'El acta de cierre sólo se abre cuando la licitación está cerrada.' using errcode = '23514'; end if;

  select t.id into v_tender_id from public.psi_public_tenders t where t.converted_opportunity_id = p_opportunity_id limit 1;
  if v_tender_id is null then raise exception 'No existe una licitación vinculada.' using errcode = 'P0002'; end if;

  v_reasons := coalesce(nullif(p_payload -> 'reasons', 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(v_reasons) <> 'array' then raise exception 'Los motivos deben venir en una lista.' using errcode = '22023'; end if;

  select * into v_acta from public.psi_tender_closure_acta where opportunity_id = p_opportunity_id for update;
  if found then
    if v_acta.status = 'confirmada' then raise exception 'El acta ya está confirmada; debe reabrirla para cambiarla.' using errcode = '23505'; end if;
    if p_expected_updated_at is null or v_acta.updated_at is distinct from p_expected_updated_at then raise exception 'El acta cambió mientras la editaba; recárguela.' using errcode = '40001'; end if;
    v_action := 'editada';
    update public.psi_tender_closure_acta set
      closure_kind = v_closure_kind,
      closing_note = coalesce(nullif(btrim(coalesce(p_payload ->> 'closing_note', '')), ''), v_acta.closing_note),
      closing_note_source = case when nullif(btrim(coalesce(p_payload ->> 'closing_note', '')), '') is null then v_acta.closing_note_source
        when nullif(btrim(coalesce(p_payload ->> 'closing_note', '')), '') is distinct from v_acta.closing_note then 'manual'
        else v_acta.closing_note_source end,
      decision_summary = nullif(btrim(coalesce(p_payload ->> 'decision_summary', '')), ''),
      decision_quote = nullif(btrim(coalesce(p_payload ->> 'decision_quote', '')), ''),
      requirements_unmet = coalesce(nullif(p_payload -> 'requirements_unmet', 'null'::jsonb), '[]'::jsonb),
      factors_against = coalesce(nullif(p_payload -> 'factors_against', 'null'::jsonb), '[]'::jsonb),
      gaps_to_compete = coalesce(nullif(p_payload -> 'gaps_to_compete', 'null'::jsonb), '[]'::jsonb),
      recommendation = nullif(btrim(coalesce(p_payload ->> 'recommendation', '')), ''),
      system_lesson = nullif(btrim(coalesce(p_payload ->> 'system_lesson', '')), ''),
      updated_at = v_now
    where id = v_acta.id;
  else
    if p_expected_updated_at is not null then raise exception 'El acta no existe todavía.' using errcode = '40001'; end if;
    v_closing := public.psi_tender_closure_note(p_opportunity_id);
    v_action := 'propuesta';
    insert into public.psi_tender_closure_acta (
      opportunity_id, tender_id, closure_kind, closing_note, closing_note_source,
      decision_summary, decision_quote, requirements_unmet, factors_against, gaps_to_compete,
      recommendation, system_lesson, proposed_by, proposed_at, updated_at
    ) values (
      p_opportunity_id, v_tender_id, v_closure_kind,
      coalesce(nullif(btrim(coalesce(p_payload ->> 'closing_note', '')), ''), v_closing ->> 'note'),
      case when nullif(btrim(coalesce(p_payload ->> 'closing_note', '')), '') is not null then 'manual' else v_closing ->> 'source' end,
      nullif(btrim(coalesce(p_payload ->> 'decision_summary', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'decision_quote', '')), ''),
      coalesce(nullif(p_payload -> 'requirements_unmet', 'null'::jsonb), '[]'::jsonb),
      coalesce(nullif(p_payload -> 'factors_against', 'null'::jsonb), '[]'::jsonb),
      coalesce(nullif(p_payload -> 'gaps_to_compete', 'null'::jsonb), '[]'::jsonb),
      nullif(btrim(coalesce(p_payload ->> 'recommendation', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'system_lesson', '')), ''),
      p_actor_id, v_now, v_now
    ) returning * into v_acta;
  end if;

  delete from public.psi_tender_closure_acta_reason where acta_id = v_acta.id;
  insert into public.psi_tender_closure_acta_reason (acta_id, label, sort_order)
  select v_acta.id, btrim(entry.label), entry.ord
  from jsonb_array_elements_text(v_reasons) with ordinality as entry(label, ord)
  where nullif(btrim(entry.label), '') is not null
  on conflict (acta_id, label) do nothing;

  insert into public.psi_tender_closure_acta_events (acta_id, action, actor_id, snapshot, created_at)
  values (v_acta.id, v_action, p_actor_id, public.psi_tender_closure_acta_snapshot(v_acta.id), v_now);

  return public.psi_get_tender_closure_acta(p_opportunity_id);
end;
$$;
revoke all on function public.psi_upsert_tender_closure_acta(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.psi_upsert_tender_closure_acta(uuid, uuid, jsonb, timestamptz) to service_role;

-- Confirmar el acta es un acto humano: Vig-IA no puede confirmar la suya.
create or replace function public.psi_confirm_tender_closure_acta(p_opportunity_id uuid, p_actor_id uuid, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_acta public.psi_tender_closure_acta%rowtype;
  v_now timestamptz := now();
begin
  if not exists (select 1 from public.psi_sales_profiles p where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') = 'human' and p.role in ('admin', 'gerencia', 'director')) then
    raise exception 'Sólo una persona autorizada puede confirmar el acta de cierre.' using errcode = '42501';
  end if;
  select * into v_acta from public.psi_tender_closure_acta where opportunity_id = p_opportunity_id for update;
  if not found then raise exception 'El acta de cierre no existe.' using errcode = 'P0002'; end if;
  if v_acta.status = 'confirmada' then raise exception 'El acta ya está confirmada.' using errcode = '23505'; end if;
  if p_expected_updated_at is null or v_acta.updated_at is distinct from p_expected_updated_at then raise exception 'El acta cambió mientras la revisaba; recárguela.' using errcode = '40001'; end if;
  if nullif(btrim(coalesce(v_acta.decision_summary, '')), '') is null then raise exception 'El acta necesita la decisión y su razón principal.' using errcode = '23514'; end if;
  if not exists (select 1 from public.psi_tender_closure_acta_reason r where r.acta_id = v_acta.id) then raise exception 'El acta necesita al menos un motivo para el conteo.' using errcode = '23514'; end if;

  update public.psi_tender_closure_acta set status = 'confirmada', confirmed_by = p_actor_id, confirmed_at = v_now, updated_at = v_now where id = v_acta.id;
  insert into public.psi_tender_closure_acta_events (acta_id, action, actor_id, snapshot, created_at)
  values (v_acta.id, 'confirmada', p_actor_id, public.psi_tender_closure_acta_snapshot(v_acta.id), v_now);
  return public.psi_get_tender_closure_acta(p_opportunity_id);
end;
$$;
revoke all on function public.psi_confirm_tender_closure_acta(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.psi_confirm_tender_closure_acta(uuid, uuid, timestamptz) to service_role;

-- Reabrir deja el acta editable otra vez. El historial conserva la versión confirmada.
create or replace function public.psi_reopen_tender_closure_acta(p_opportunity_id uuid, p_actor_id uuid, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_acta public.psi_tender_closure_acta%rowtype;
  v_now timestamptz := now();
begin
  if not exists (select 1 from public.psi_sales_profiles p where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') = 'human' and p.role in ('admin', 'gerencia', 'director')) then
    raise exception 'Sólo una persona autorizada puede reabrir el acta de cierre.' using errcode = '42501';
  end if;
  select * into v_acta from public.psi_tender_closure_acta where opportunity_id = p_opportunity_id for update;
  if not found then raise exception 'El acta de cierre no existe.' using errcode = 'P0002'; end if;
  if v_acta.status <> 'confirmada' then raise exception 'El acta ya está en borrador.' using errcode = '23505'; end if;
  if p_expected_updated_at is null or v_acta.updated_at is distinct from p_expected_updated_at then raise exception 'El acta cambió mientras la revisaba; recárguela.' using errcode = '40001'; end if;

  update public.psi_tender_closure_acta set status = 'borrador', confirmed_by = null, confirmed_at = null, updated_at = v_now where id = v_acta.id;
  insert into public.psi_tender_closure_acta_events (acta_id, action, actor_id, snapshot, created_at)
  values (v_acta.id, 'reabierta', p_actor_id, public.psi_tender_closure_acta_snapshot(v_acta.id), v_now);
  return public.psi_get_tender_closure_acta(p_opportunity_id);
end;
$$;
revoke all on function public.psi_reopen_tender_closure_acta(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.psi_reopen_tender_closure_acta(uuid, uuid, timestamptz) to service_role;

commit;
