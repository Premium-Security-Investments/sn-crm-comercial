begin;

alter table public.psi_sales_opportunities
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.psi_sales_profiles(id),
  add column if not exists archive_note text;

create table if not exists public.psi_tender_opportunity_archive_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  tender_offer_status text not null check (tender_offer_status in ('en_preparacion', 'lista_para_presentar')),
  note text not null check (nullif(btrim(note), '') is not null),
  archived_at timestamptz not null default now()
);
create unique index if not exists psi_tender_opportunity_archive_events_once_idx on public.psi_tender_opportunity_archive_events (opportunity_id, tender_id);
create index if not exists psi_tender_opportunity_archive_events_archived_idx on public.psi_tender_opportunity_archive_events (archived_at desc, id desc);

create or replace function public.psi_tender_opportunity_archive_events_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'El historial de archivo es inmutable.';
end;
$$;
drop trigger if exists psi_tender_opportunity_archive_events_immutable on public.psi_tender_opportunity_archive_events;
create trigger psi_tender_opportunity_archive_events_immutable before update or delete on public.psi_tender_opportunity_archive_events for each row execute function public.psi_tender_opportunity_archive_events_prevent_mutation();
alter table public.psi_tender_opportunity_archive_events enable row level security;
revoke all on public.psi_tender_opportunity_archive_events from public, anon, authenticated, service_role;
grant select on public.psi_tender_opportunity_archive_events to service_role;

create or replace function public.psi_archive_tender_opportunity(p_opportunity_id uuid, p_actor_id uuid, p_note text, p_expected_tender_offer_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_tender_id uuid;
  v_note text := nullif(btrim(p_note), '');
  v_now timestamptz := now();
begin
  if v_note is null then raise exception 'Debe indicar por qué no nos presentamos.' using errcode = '22023'; end if;
  if p_expected_tender_offer_status not in ('en_preparacion', 'lista_para_presentar') then raise exception 'Sólo se puede archivar antes de presentar la oferta.' using errcode = '22023'; end if;
  if not exists (select 1 from public.psi_sales_profiles p where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') = 'human' and p.role in ('admin', 'gerencia', 'director')) then raise exception 'No tiene permisos para archivar oportunidades.' using errcode = '42501'; end if;
  select * into v_opportunity from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;
  if v_opportunity.archived_at is not null then raise exception 'La oportunidad ya está archivada.' using errcode = '23505'; end if;
  if v_opportunity.tender_offer_status is distinct from p_expected_tender_offer_status then raise exception 'La oferta cambió de estado; recargue la oportunidad.' using errcode = '40001'; end if;
  select t.id into v_tender_id from public.psi_public_tenders t where t.converted_opportunity_id = p_opportunity_id limit 1;
  if v_tender_id is null then raise exception 'No existe una licitación vinculada.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.psi_tender_go_no_go_decisions d where d.opportunity_id = p_opportunity_id and d.tender_id = v_tender_id and d.decision = 'go' and not exists (select 1 from public.psi_tender_go_no_go_decisions child where child.supersedes_decision_id = d.id)) then raise exception 'Archivar requiere un GO vigente.' using errcode = '23514'; end if;
  update public.psi_sales_opportunities set archived_at = v_now, archived_by = p_actor_id, archive_note = v_note where id = p_opportunity_id;
  insert into public.psi_tender_opportunity_archive_events (opportunity_id, tender_id, actor_id, tender_offer_status, note, archived_at) values (p_opportunity_id, v_tender_id, p_actor_id, p_expected_tender_offer_status, v_note, v_now);
  return jsonb_build_object('archived_at', v_now, 'archived_by', p_actor_id, 'archive_note', v_note);
end;
$$;
revoke all on function public.psi_archive_tender_opportunity(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.psi_archive_tender_opportunity(uuid, uuid, text, text) to service_role;

create or replace function public.psi_list_tender_opportunity_page(p_filter text, p_limit int, p_offset int)
returns table (tender jsonb, opportunity jsonb, latest_decision jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_filter is null or p_filter not in ('all', 'por_decidir', 'en_curso', 'cerradas', 'archivadas', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed') then raise exception 'El filtro de oportunidades no es válido.' using errcode = '22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'El límite debe estar entre 1 y 50.' using errcode = '22023'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then raise exception 'El desplazamiento debe estar entre 0 y 10000.' using errcode = '22023'; end if;
  return query
  select to_jsonb(t), to_jsonb(o), case when d.id is null then null else jsonb_build_object('id', d.id, 'opportunity_id', d.opportunity_id, 'tender_id', d.tender_id, 'decision', d.decision, 'decided_at', d.decided_at, 'psi_sales_profiles', case when actor.id is null then null else jsonb_build_object('full_name', actor.full_name) end) end
  from public.psi_public_tenders t
  join public.psi_sales_opportunities o on o.id = t.converted_opportunity_id
  left join lateral (select d.* from public.psi_tender_go_no_go_decisions d where d.opportunity_id = o.id and d.tender_id = t.id and not exists (select 1 from public.psi_tender_go_no_go_decisions child where child.supersedes_decision_id = d.id) order by d.decided_at desc, d.id desc limit 1) d on true
  left join public.psi_sales_profiles actor on actor.id = d.decided_by
  left join lateral (select case when coalesce(d.decision, '') = 'no_go' or coalesce(o.tender_offer_status, 'pendiente_decision') in ('cerrada_no_go', 'adjudicada', 'no_adjudicada') then 'cerradas' when coalesce(d.decision, '') <> 'go' then 'por_decidir' else 'en_curso' end as stage) st on true
  where t.internal_status = 'convertida_oportunidad'
    and ((p_filter = 'archivadas' and o.archived_at is not null) or (p_filter <> 'archivadas' and o.archived_at is null and (p_filter = 'all' or p_filter = st.stage or (p_filter = 'pending_decision' and coalesce(o.tender_offer_status, 'pendiente_decision') = 'pendiente_decision' and d.id is null) or (p_filter = 'go_authorized' and d.decision = 'go' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('en_preparacion', 'lista_para_presentar', 'presentada')) or (p_filter = 'in_preparation' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('en_preparacion', 'lista_para_presentar')) or (p_filter = 'submitted' and coalesce(o.tender_offer_status, 'pendiente_decision') = 'presentada') or (p_filter = 'closed' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('cerrada_no_go', 'adjudicada', 'no_adjudicada')))))
  order by o.expected_close_date asc nulls last, t.id asc
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.psi_list_tender_opportunity_page(text, int, int) from public, anon, authenticated, service_role;
grant execute on function public.psi_list_tender_opportunity_page(text, int, int) to service_role;
commit;
