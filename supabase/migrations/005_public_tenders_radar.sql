-- Public tenders radar persistence for Seguridad Nacional CRM.
-- Keeps SECOP radar history, human review status, duplicate prevention, and conversion tracking.

create table if not exists public.psi_public_tenders (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null unique,
  source text not null,
  section text not null check (section in ('hacer','revisar','descartar')),
  entity text not null,
  dept text,
  city text,
  ref text,
  process_id text,
  title text not null,
  description text,
  value numeric default 0,
  status text,
  category text,
  published_at timestamptz,
  deadline_at timestamptz,
  score numeric default 0,
  reasons text[] default '{}',
  risks text[] default '{}',
  url text,
  raw jsonb,
  internal_status text not null default 'nueva' check (internal_status in ('nueva','en_revision','descartada','convertida_oportunidad')),
  converted_opportunity_id uuid references public.psi_sales_opportunities(id) on delete set null,
  reviewed_by uuid references public.psi_sales_profiles(id) on delete set null,
  reviewed_at timestamptz,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_psi_public_tenders_section on public.psi_public_tenders(section);
create index if not exists idx_psi_public_tenders_internal_status on public.psi_public_tenders(internal_status);
create index if not exists idx_psi_public_tenders_last_seen on public.psi_public_tenders(last_seen_at desc);
create index if not exists idx_psi_public_tenders_deadline on public.psi_public_tenders(deadline_at);
create index if not exists idx_psi_public_tenders_converted on public.psi_public_tenders(converted_opportunity_id);

create table if not exists public.psi_tender_radar_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  triggered_by uuid references public.psi_sales_profiles(id) on delete set null,
  mode text not null default 'manual',
  count_total int not null default 0,
  count_hacer int not null default 0,
  count_revisar int not null default 0,
  count_descartar int not null default 0,
  summary text,
  errors jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_psi_tender_radar_runs_run_at on public.psi_tender_radar_runs(run_at desc);

drop trigger if exists trg_psi_public_tenders_updated_at on public.psi_public_tenders;
create trigger trg_psi_public_tenders_updated_at before update on public.psi_public_tenders
for each row execute function public.psi_sales_set_updated_at();

alter table public.psi_public_tenders enable row level security;
alter table public.psi_tender_radar_runs enable row level security;

drop policy if exists psi_public_tenders_select on public.psi_public_tenders;
create policy psi_public_tenders_select on public.psi_public_tenders for select to authenticated
using (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

drop policy if exists psi_public_tenders_modify on public.psi_public_tenders;
create policy psi_public_tenders_modify on public.psi_public_tenders for all to authenticated
using (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
)
with check (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

drop policy if exists psi_tender_radar_runs_select on public.psi_tender_radar_runs;
create policy psi_tender_radar_runs_select on public.psi_tender_radar_runs for select to authenticated
using (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

drop policy if exists psi_tender_radar_runs_insert on public.psi_tender_radar_runs;
create policy psi_tender_radar_runs_insert on public.psi_tender_radar_runs for insert to authenticated
with check (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

grant select, insert, update on public.psi_public_tenders, public.psi_tender_radar_runs to authenticated;
