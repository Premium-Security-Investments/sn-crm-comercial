-- AGT-003 — Qué pasó con el mensaje sugerido del análisis profundo (Juan, 2026-10-08): "Ya lo usé" o "Descartar".
-- Un evento por análisis, de solo inserción; el análisis (psi_agt003_lead_analyses) sigue inmutable.
begin;

create table if not exists public.psi_agt003_lead_analysis_message_events (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null unique references public.psi_agt003_lead_analyses(id),
  actor_id uuid not null references public.psi_sales_profiles(id),
  action text not null check (action in ('used', 'dismissed')),
  interaction_id uuid,
  created_at timestamptz not null default now()
);

alter table public.psi_agt003_lead_analysis_message_events enable row level security;
revoke all on table public.psi_agt003_lead_analysis_message_events from public, anon, authenticated;
grant select, insert on table public.psi_agt003_lead_analysis_message_events to service_role;

create or replace function public.psi_agt003_lead_analysis_message_events_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'psi_agt003_lead_analysis_message_events es de solo inserción' using errcode = '42501';
end;
$$;

drop trigger if exists psi_agt003_lead_analysis_message_events_guard on public.psi_agt003_lead_analysis_message_events;
create trigger psi_agt003_lead_analysis_message_events_guard
  before update or delete on public.psi_agt003_lead_analysis_message_events
  for each row execute function public.psi_agt003_lead_analysis_message_events_guard();

commit;
