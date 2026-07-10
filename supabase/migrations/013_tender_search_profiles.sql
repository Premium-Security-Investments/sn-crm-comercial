-- Saved search profiles for the Licitaciones module.
-- Lets Seguridad Nacional persist regional/source/value filters for repeatable tender discovery.

create table if not exists public.psi_tender_search_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  region_key text not null default 'todas',
  source_filter text not null default 'todas',
  section_filter text not null default 'todas',
  internal_status_filter text not null default 'todas',
  deadline_filter text not null default 'todas',
  value_filter text not null default 'todas',
  score_filter text not null default 'todas',
  query_text text,
  is_default boolean not null default false,
  created_by uuid references public.psi_sales_profiles(id) on delete set null,
  updated_by uuid references public.psi_sales_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create index if not exists idx_psi_tender_search_profiles_region on public.psi_tender_search_profiles(region_key);
create index if not exists idx_psi_tender_search_profiles_default on public.psi_tender_search_profiles(is_default) where is_default = true;

drop trigger if exists trg_psi_tender_search_profiles_updated_at on public.psi_tender_search_profiles;
create trigger trg_psi_tender_search_profiles_updated_at before update on public.psi_tender_search_profiles
for each row execute function public.psi_sales_set_updated_at();

alter table public.psi_tender_search_profiles enable row level security;

drop policy if exists psi_tender_search_profiles_select on public.psi_tender_search_profiles;
create policy psi_tender_search_profiles_select on public.psi_tender_search_profiles for select to authenticated
using (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

drop policy if exists psi_tender_search_profiles_modify on public.psi_tender_search_profiles;
create policy psi_tender_search_profiles_modify on public.psi_tender_search_profiles for all to authenticated
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

grant select, insert, update, delete on public.psi_tender_search_profiles to authenticated;

insert into public.psi_tender_search_profiles (name, description, region_key, source_filter, section_filter, value_filter, score_filter, is_default)
values
  ('Vigilancia física Bogotá/Cundinamarca', 'Procesos prioritarios de vigilancia física en la plaza principal de SN.', 'bog_cundinamarca', 'todas', 'hacer', 'todas', 'medio', true),
  ('Seguridad electrónica Medellín/Antioquia', 'CCTV, monitoreo y seguridad electrónica en Antioquia.', 'med_antioquia', 'todas', 'todas', 'todas', 'medio', false),
  ('ESU Antioquia', 'Procesos ESU en Antioquia para seguimiento recurrente.', 'med_antioquia', 'ESU Contratación', 'todas', 'todas', 'todas', false),
  ('Grandes cuantías con cobertura confirmada', 'Procesos de $500M+ en regiones donde SN tiene presencia.', 'todas', 'todas', 'todas', '500m_plus', 'medio', false)
on conflict (name) do nothing;
