-- Auditable post-GO tender offer status transitions.
-- Additive: GO / NO-GO decisions remain governed exclusively by migration 022.
begin;

create table if not exists public.psi_tender_offer_status_transitions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  from_status text not null check (from_status in ('en_preparacion', 'lista_para_presentar', 'presentada')),
  to_status text not null check (to_status in ('lista_para_presentar', 'presentada', 'adjudicada', 'no_adjudicada')),
  note text,
  changed_at timestamptz not null default now(),
  constraint psi_tender_offer_status_transitions_valid_edge check (
    (from_status = 'en_preparacion' and to_status = 'lista_para_presentar')
    or (from_status = 'lista_para_presentar' and to_status = 'presentada')
    or (from_status = 'presentada' and to_status in ('adjudicada', 'no_adjudicada'))
  )
);

create index if not exists psi_tender_offer_status_transitions_opportunity_changed_idx
  on public.psi_tender_offer_status_transitions (opportunity_id, changed_at desc, id desc);

create or replace function public.psi_tender_offer_status_transitions_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_offer_status_transitions is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_tender_offer_status_transitions_immutable on public.psi_tender_offer_status_transitions;
create trigger psi_tender_offer_status_transitions_immutable
  before update or delete on public.psi_tender_offer_status_transitions
  for each row execute function public.psi_tender_offer_status_transitions_prevent_mutation();

alter table public.psi_tender_offer_status_transitions enable row level security;
revoke all on table public.psi_tender_offer_status_transitions from public;
revoke all on table public.psi_tender_offer_status_transitions from authenticated;
revoke all on table public.psi_tender_offer_status_transitions from service_role;
grant select on table public.psi_tender_offer_status_transitions to service_role;

create or replace function public.psi_transition_tender_offer_status(
  p_opportunity_id uuid,
  p_actor_id uuid,
  p_to_status text,
  p_expected_current_status text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_tender public.psi_public_tenders%rowtype;
  v_current_status text;
  v_event public.psi_tender_offer_status_transitions%rowtype;
  v_latest_decision text;
begin
  if p_to_status is null or p_to_status not in ('lista_para_presentar', 'presentada', 'adjudicada', 'no_adjudicada') then
    raise exception 'El estado destino no es válido.' using errcode = '22023';
  end if;
  if p_expected_current_status is null or p_expected_current_status not in ('en_preparacion', 'lista_para_presentar', 'presentada') then
    raise exception 'Debe indicar el estado actual esperado.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.psi_sales_profiles p
    join public.psi_profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'licitaciones'
    join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active = true
    where p.id = p_actor_id
      and p.active = true
      and coalesce(p.identity_type, 'human') = 'human'
      and p.role in ('admin', 'gerencia', 'director')
  ) then
    raise exception 'No tiene permisos para cambiar el estado de oferta.' using errcode = '42501';
  end if;

  select * into v_opportunity
    from public.psi_sales_opportunities
    where id = p_opportunity_id
    for update;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;

  select * into v_tender
    from public.psi_public_tenders
    where converted_opportunity_id = p_opportunity_id
    order by id
    limit 1
    for update;
  if not found then raise exception 'No existe una licitación vinculada a la oportunidad.' using errcode = 'P0002'; end if;

  select d.decision into v_latest_decision
    from public.psi_tender_go_no_go_decisions d
    where d.opportunity_id = p_opportunity_id and d.tender_id = v_tender.id
    order by d.decided_at desc, d.id desc
    limit 1;
  if v_latest_decision is distinct from 'go' then
    raise exception 'La transición de oferta requiere una decisión GO formal vigente.' using errcode = '23514';
  end if;

  v_current_status := coalesce(v_opportunity.tender_offer_status, 'pendiente_decision');
  if v_current_status is distinct from p_expected_current_status then
    raise exception 'Conflicto de estado: la oferta ya cambió.' using errcode = '40001';
  end if;
  if not (
    (v_current_status = 'en_preparacion' and p_to_status = 'lista_para_presentar')
    or (v_current_status = 'lista_para_presentar' and p_to_status = 'presentada')
    or (v_current_status = 'presentada' and p_to_status in ('adjudicada', 'no_adjudicada'))
  ) then
    raise exception 'Transición de estado no permitida.' using errcode = '23514';
  end if;

  update public.psi_sales_opportunities
    set tender_offer_status = p_to_status
    where id = p_opportunity_id;
  insert into public.psi_tender_offer_status_transitions (
    opportunity_id, tender_id, actor_id, from_status, to_status, note
  ) values (
    p_opportunity_id, v_tender.id, p_actor_id, v_current_status, p_to_status, nullif(btrim(p_note), '')
  ) returning * into v_event;

  return jsonb_build_object(
    'status', p_to_status,
    'event', jsonb_build_object(
      'id', v_event.id, 'opportunity_id', v_event.opportunity_id, 'tender_id', v_event.tender_id,
      'actor_id', v_event.actor_id, 'from_status', v_event.from_status, 'to_status', v_event.to_status,
      'note', v_event.note, 'changed_at', v_event.changed_at
    )
  );
end;
$$;

revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from public;
revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from authenticated;
revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from service_role;
grant execute on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) to service_role;

commit;
