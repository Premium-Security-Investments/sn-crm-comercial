-- Source-local checkpoint/run ledger for the ESU Contratación direct-refresh cadence.
-- Deliberately separate from psi_tender_radar_runs: that table's most-recent row drives the
-- "latest full sync" freshness cutoff shown on the tender radar page, and an unrelated,
-- automated, frequent (default 6h) ESU-only refresh writing into it would silently narrow
-- what the sales team sees between manual full-radar syncs. This table only backs the ESU
-- direct-refresh cadence check and never affects the general radar's persisted read path.

create table if not exists public.psi_esu_direct_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  status text not null check (status in ('success', 'success_empty', 'unavailable')),
  count_fetched int not null default 0,
  count_upserted int not null default 0,
  summary text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_psi_esu_direct_refresh_runs_run_at on public.psi_esu_direct_refresh_runs(run_at desc);
create index if not exists idx_psi_esu_direct_refresh_runs_status_run_at on public.psi_esu_direct_refresh_runs(status, run_at desc);

alter table public.psi_esu_direct_refresh_runs enable row level security;

drop policy if exists psi_esu_direct_refresh_runs_select on public.psi_esu_direct_refresh_runs;
create policy psi_esu_direct_refresh_runs_select on public.psi_esu_direct_refresh_runs for select to authenticated
using (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

grant select on public.psi_esu_direct_refresh_runs to authenticated;
grant select, insert on public.psi_esu_direct_refresh_runs to service_role;
