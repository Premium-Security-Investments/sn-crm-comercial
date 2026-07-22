-- Immutable, service-mediated GO / NO-GO decisions for tender opportunities.
-- This migration is intentionally additive and can be rerun against a partial legacy 022.
begin;

alter table public.psi_sales_opportunities
  add column if not exists tender_offer_status text;

-- Existing profiles default to human; nullable preserves compatibility with pre-identity rows.
alter table public.psi_sales_profiles
  add column if not exists identity_type text default 'human';

-- Create the current shape for fresh databases. Existing legacy tables are altered only below.
create table if not exists public.psi_tender_go_no_go_decisions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null constraint psi_tender_go_no_go_decisions_opportunity_fkey references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null constraint psi_tender_go_no_go_decisions_tender_fkey references public.psi_public_tenders(id) on delete restrict,
  decision text not null constraint psi_tender_go_no_go_decisions_decision_check check (decision in ('go', 'no_go')),
  analysis_interaction_id uuid constraint psi_tender_go_no_go_decisions_analysis_interaction_fkey references public.psi_sales_interactions(id) on delete restrict,
  justification text,
  decided_by uuid not null constraint psi_tender_go_no_go_decisions_decided_by_fkey references public.psi_sales_profiles(id) on delete restrict,
  decided_at timestamptz not null default now(),
  supersedes_decision_id uuid constraint psi_tender_go_no_go_decisions_supersedes_fkey references public.psi_tender_go_no_go_decisions(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.psi_tender_go_no_go_decisions
  add column if not exists analysis_interaction_id uuid,
  add column if not exists justification text,
  add column if not exists decided_by uuid,
  add column if not exists decided_at timestamptz not null default now(),
  add column if not exists supersedes_decision_id uuid,
  add column if not exists created_at timestamptz not null default now();
-- A legacy table can have its primary key but no UUID default; preserve rows and add it.
alter table public.psi_tender_go_no_go_decisions alter column id set default gen_random_uuid();

-- Existing partial tables do not inherit constraints from CREATE TABLE IF NOT EXISTS.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.psi_sales_opportunities'::regclass and conname='psi_sales_opportunities_tender_offer_status_check') then
    alter table public.psi_sales_opportunities add constraint psi_sales_opportunities_tender_offer_status_check
      check (tender_offer_status is null or tender_offer_status in (
        'pendiente_decision', 'en_preparacion', 'lista_para_presentar',
        'presentada', 'adjudicada', 'no_adjudicada', 'cerrada_no_go'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.psi_tender_go_no_go_decisions'::regclass and conname='psi_tender_go_no_go_decisions_decision_check') then
    alter table public.psi_tender_go_no_go_decisions add constraint psi_tender_go_no_go_decisions_decision_check
      check (decision in ('go', 'no_go'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.psi_tender_go_no_go_decisions'::regclass and conname='psi_tender_go_no_go_decisions_opportunity_fkey') then
    alter table public.psi_tender_go_no_go_decisions add constraint psi_tender_go_no_go_decisions_opportunity_fkey
      foreign key (opportunity_id) references public.psi_sales_opportunities(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.psi_tender_go_no_go_decisions'::regclass and conname='psi_tender_go_no_go_decisions_tender_fkey') then
    alter table public.psi_tender_go_no_go_decisions add constraint psi_tender_go_no_go_decisions_tender_fkey
      foreign key (tender_id) references public.psi_public_tenders(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.psi_tender_go_no_go_decisions'::regclass and conname='psi_tender_go_no_go_decisions_analysis_interaction_fkey') then
    alter table public.psi_tender_go_no_go_decisions add constraint psi_tender_go_no_go_decisions_analysis_interaction_fkey
      foreign key (analysis_interaction_id) references public.psi_sales_interactions(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.psi_tender_go_no_go_decisions'::regclass and conname='psi_tender_go_no_go_decisions_decided_by_fkey') then
    alter table public.psi_tender_go_no_go_decisions add constraint psi_tender_go_no_go_decisions_decided_by_fkey
      foreign key (decided_by) references public.psi_sales_profiles(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.psi_tender_go_no_go_decisions'::regclass and conname='psi_tender_go_no_go_decisions_supersedes_fkey') then
    alter table public.psi_tender_go_no_go_decisions add constraint psi_tender_go_no_go_decisions_supersedes_fkey
      foreign key (supersedes_decision_id) references public.psi_tender_go_no_go_decisions(id) on delete restrict;
  end if;
end $$;

create index if not exists psi_tender_go_no_go_decisions_opportunity_decided_idx
  on public.psi_tender_go_no_go_decisions (opportunity_id, decided_at desc, id desc);
create index if not exists psi_tender_go_no_go_decisions_tender_decided_idx
  on public.psi_tender_go_no_go_decisions (tender_id, decided_at desc, id desc);
-- This is the concurrency-safe idempotency boundary for preparation work.
create unique index if not exists psi_sales_interactions_tender_offer_preparation_unique
  on public.psi_sales_interactions (opportunity_id)
  where interaction_type = 'tender_offer_preparation';

create or replace function public.psi_tender_go_no_go_decisions_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_go_no_go_decisions is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_tender_go_no_go_decisions_immutable on public.psi_tender_go_no_go_decisions;
create trigger psi_tender_go_no_go_decisions_immutable
  before update or delete on public.psi_tender_go_no_go_decisions
  for each row execute function public.psi_tender_go_no_go_decisions_prevent_mutation();

alter table public.psi_tender_go_no_go_decisions enable row level security;
revoke all on table public.psi_tender_go_no_go_decisions from public;
revoke all on table public.psi_tender_go_no_go_decisions from authenticated;
-- The SECURITY DEFINER RPC is the only append path; service_role may inspect, never insert directly.
grant select on table public.psi_tender_go_no_go_decisions to service_role;

create or replace function public.psi_record_tender_go_no_go(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_analysis_interaction_id uuid,
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
    where p.id = p_actor_id
      and p.active = true
      and coalesce(p.identity_type, 'human') = 'human'
      and p.role in ('admin', 'gerencia', 'director')
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
  if v_opportunity.tipo_producto_original is distinct from 'Licitación Pública'
     and coalesce(v_opportunity.external_source, '') not like 'secop_radar:%' then
    raise exception 'La oportunidad no tiene origen de licitación pública.' using errcode = '22023';
  end if;
  if p_analysis_interaction_id is not null and not exists (
    select 1 from public.psi_sales_interactions i where i.id = p_analysis_interaction_id and i.opportunity_id = p_opportunity_id
  ) then
    raise exception 'El análisis no pertenece a la oportunidad indicada.' using errcode = '22023';
  end if;

  select id into v_previous_id from public.psi_tender_go_no_go_decisions
    where opportunity_id = p_opportunity_id and tender_id = p_tender_id
    order by decided_at desc, id desc limit 1 for update;

  insert into public.psi_tender_go_no_go_decisions (
    opportunity_id, tender_id, decision, analysis_interaction_id, justification, decided_by, decided_at, supersedes_decision_id
  ) values (
    p_opportunity_id, p_tender_id, p_decision, p_analysis_interaction_id, nullif(btrim(p_justification), ''), p_actor_id, v_now, v_previous_id
  ) returning id into v_decision_id;

  if p_decision = 'go' then
    insert into public.psi_sales_interactions (opportunity_id, interaction_type, created_by, occurred_at, notes)
    values (p_opportunity_id, 'tender_offer_preparation', p_actor_id, v_now,
      coalesce(nullif(p_preparation::text, '{}'), 'Preparación de oferta de licitación iniciada.'))
    on conflict (opportunity_id) where interaction_type = 'tender_offer_preparation' do nothing
    returning id into v_preparation_id;
    v_preparation_created := v_preparation_id is not null;
    v_status := 'en_preparacion';
  else
    v_status := 'cerrada_no_go';
  end if;

  update public.psi_sales_opportunities set tender_offer_status = v_status where id = p_opportunity_id;
  return jsonb_build_object(
    'decision_id', v_decision_id,
    'supersedes_decision_id', v_previous_id,
    'decision', p_decision,
    'preparation_id', v_preparation_id,
    'preparation_created', v_preparation_created,
    'tender_offer_status', v_status
  );
end;
$$;

revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from public;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from authenticated;
grant execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) to service_role;

commit;
