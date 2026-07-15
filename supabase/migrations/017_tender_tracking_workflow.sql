-- Persistent tender-tracking workflow for the Licitaciones module.
-- Version 017 is used because 014_siio_f2_foundation.sql already owns version 014.

alter table public.psi_public_tenders
  add column if not exists tracking_owner_id uuid references public.psi_sales_profiles(id) on delete set null,
  add column if not exists tracking_status text,
  add column if not exists tracking_next_action text,
  add column if not exists tracking_due_at timestamptz,
  add column if not exists tracking_blocker text,
  add column if not exists tracking_last_note text,
  add column if not exists tracking_started_at timestamptz,
  add column if not exists tracking_updated_at timestamptz;

create table if not exists public.psi_tender_tracking_events (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.psi_public_tenders(id) on delete cascade,
  event_type text not null check (event_type in ('entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded')),
  note text,
  from_status text,
  to_status text,
  assigned_to uuid references public.psi_sales_profiles(id) on delete set null,
  next_action text,
  due_at timestamptz,
  blocker text,
  created_by uuid references public.psi_sales_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.psi_tender_tracking_events enable row level security;

create index if not exists idx_tender_tracking_events_tender_created
  on public.psi_tender_tracking_events(tender_id, created_at desc);

create index if not exists idx_public_tenders_tracking_queue
  on public.psi_public_tenders(internal_status, tracking_due_at, tracking_updated_at desc);

drop policy if exists psi_tender_tracking_events_select on public.psi_tender_tracking_events;
create policy psi_tender_tracking_events_select on public.psi_tender_tracking_events for select to authenticated
using (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

drop policy if exists psi_tender_tracking_events_modify on public.psi_tender_tracking_events;
drop policy if exists psi_tender_tracking_events_insert on public.psi_tender_tracking_events;
create policy psi_tender_tracking_events_insert on public.psi_tender_tracking_events for insert to authenticated
with check (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
      and created_by is not null
      and created_by = p.id
  )
);

grant select, insert on public.psi_tender_tracking_events to authenticated;
revoke update, delete on public.psi_tender_tracking_events from authenticated;
