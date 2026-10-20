-- AGT-002 — botón "Volver a analizar" (decisión del dueño, 2026-10-20: "no veo un botón para hacer un nuevo análisis
-- manual"). Desde que la ficha muestra el análisis INITIAL (addc26e, 2026-10-06) no había forma de pedir otro: el
-- reanálisis sucesor (migración 108) sólo lo admitía el seguimiento de cambio de fase.
--
-- Igual que "Sincronizar fuentes oficiales" (109): el botón deja aquí la solicitud y el job del host
-- (agt002-auto-initial, cada 2 min) la reclama y admite el reanálisis con quien la pidió como actor autorizante.
-- A lo sumo una solicitud abierta por oportunidad. Sólo service_role.
begin;

create table if not exists public.psi_agt002_manual_reanalysis_requests (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete cascade,
  requested_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'running', 'admitted', 'rejected', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  job_id uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  check ((status = 'pending') = (started_at is null)),
  check ((status in ('admitted', 'rejected', 'failed')) = (finished_at is not null)),
  check ((status = 'admitted') = (job_id is not null))
);

create unique index if not exists psi_agt002_manual_reanalysis_requests_one_open
  on public.psi_agt002_manual_reanalysis_requests (opportunity_id) where status in ('pending', 'running');
create index if not exists psi_agt002_manual_reanalysis_requests_recent
  on public.psi_agt002_manual_reanalysis_requests (opportunity_id, requested_at desc);
create index if not exists psi_agt002_manual_reanalysis_requests_pending
  on public.psi_agt002_manual_reanalysis_requests (requested_at) where status = 'pending';

alter table public.psi_agt002_manual_reanalysis_requests enable row level security;
revoke all on table public.psi_agt002_manual_reanalysis_requests from public, authenticated, anon, service_role;
grant select, insert, update on table public.psi_agt002_manual_reanalysis_requests to service_role;

commit;
