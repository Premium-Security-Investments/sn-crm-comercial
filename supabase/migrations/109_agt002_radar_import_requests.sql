-- AGT-002 Radar — manual requests for the full daily import (owner decision 2026-10-06). The "Sincronizar fuentes
-- oficiales" button must run the SAME full import as the daily one, which takes ~5 minutes and does not fit a Vercel
-- request. The button records a request here; the host job claims pending requests and runs the import.
-- At most one request is pending or running at a time. service_role only.
begin;

create table if not exists public.psi_agt002_radar_import_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references public.psi_sales_profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  error text check (error is null or char_length(error) <= 500),
  check ((status = 'pending') = (started_at is null)),
  check ((status in ('done', 'failed')) = (finished_at is not null))
);

create unique index if not exists psi_agt002_radar_import_requests_one_open
  on public.psi_agt002_radar_import_requests ((true)) where status in ('pending', 'running');
create index if not exists psi_agt002_radar_import_requests_recent
  on public.psi_agt002_radar_import_requests (requested_at desc);

alter table public.psi_agt002_radar_import_requests enable row level security;
revoke all on table public.psi_agt002_radar_import_requests from public, authenticated, anon, service_role;
grant select, insert, update on table public.psi_agt002_radar_import_requests to service_role;

commit;
