-- Company procurement profile for tender eligibility analysis.
-- Stores Seguridad Nacional's live company information used to cross-check public tender requirements.

create table if not exists public.psi_company_procurement_profile (
  id uuid primary key default gen_random_uuid(),
  singleton_key text not null unique default 'seguridad_nacional',
  legal_name text,
  nit text,
  rup_status text,
  rup_updated_at date,
  rup_unspsc_codes text,
  authorized_services text,
  supervigilancia_license text,
  financial_capacity text,
  organizational_capacity text,
  experience_summary text,
  certifications text,
  recurring_documents text,
  disqualifications_notes text,
  useful_company_info text,
  updated_by uuid references public.psi_sales_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_psi_company_procurement_profile_singleton on public.psi_company_procurement_profile(singleton_key);

drop trigger if exists trg_psi_company_procurement_profile_updated_at on public.psi_company_procurement_profile;
create trigger trg_psi_company_procurement_profile_updated_at before update on public.psi_company_procurement_profile
for each row execute function public.psi_sales_set_updated_at();

alter table public.psi_company_procurement_profile enable row level security;

drop policy if exists psi_company_procurement_profile_select on public.psi_company_procurement_profile;
create policy psi_company_procurement_profile_select on public.psi_company_procurement_profile for select to authenticated
using (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

drop policy if exists psi_company_procurement_profile_modify on public.psi_company_procurement_profile;
create policy psi_company_procurement_profile_modify on public.psi_company_procurement_profile for all to authenticated
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

grant select, insert, update on public.psi_company_procurement_profile to authenticated;
