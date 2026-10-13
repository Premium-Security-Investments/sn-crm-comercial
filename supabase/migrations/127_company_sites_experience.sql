-- AGT-002 · Empresa fase 1 (Juan, 2026-10-13): sedes por departamento y experiencia en tabla.
-- Solo el servidor (service_role) lee y escribe; la app aplica permisos (ver/configurar licitaciones).
-- Siembra únicamente datos comprobados en el RUP del 17-jun-2026 (informe en la ficha): la sede principal
-- y 8 contratos. seed_key evita duplicados si la migración se vuelve a ejecutar.
begin;

create table if not exists public.psi_company_sites (
  id uuid primary key default gen_random_uuid(),
  seed_key text unique,
  department text not null check (nullif(btrim(department), '') is not null),
  city text,
  address text,
  is_main boolean not null default false,
  supervigilancia_authorization text,
  support_document_id uuid references public.psi_company_procurement_documents(id) on delete set null,
  notes text,
  source text,
  created_by uuid references public.psi_sales_profiles(id) on delete set null,
  updated_by uuid references public.psi_sales_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.psi_company_experience (
  id uuid primary key default gen_random_uuid(),
  seed_key text unique,
  rup_number integer check (rup_number is null or rup_number > 0),
  contracting_party text not null check (nullif(btrim(contracting_party), '') is not null),
  contract_object text,
  value_smmlv numeric(14,2) check (value_smmlv is null or value_smmlv >= 0),
  value_cop numeric(18,0) check (value_cop is null or value_cop >= 0),
  contract_year integer check (contract_year is null or contract_year between 1950 and 2100),
  source text not null check (nullif(btrim(source), '') is not null),
  notes text,
  created_by uuid references public.psi_sales_profiles(id) on delete set null,
  updated_by uuid references public.psi_sales_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_psi_company_sites_department on public.psi_company_sites(department);
create index if not exists idx_psi_company_experience_rup_number on public.psi_company_experience(rup_number);

drop trigger if exists trg_psi_company_sites_updated_at on public.psi_company_sites;
create trigger trg_psi_company_sites_updated_at before update on public.psi_company_sites
for each row execute function public.psi_sales_set_updated_at();
drop trigger if exists trg_psi_company_experience_updated_at on public.psi_company_experience;
create trigger trg_psi_company_experience_updated_at before update on public.psi_company_experience
for each row execute function public.psi_sales_set_updated_at();

alter table public.psi_company_sites enable row level security;
alter table public.psi_company_experience enable row level security;
revoke all on table public.psi_company_sites from public, anon, authenticated, service_role;
revoke all on table public.psi_company_experience from public, anon, authenticated, service_role;
grant select, insert, update on table public.psi_company_sites to service_role;
grant select, insert, update on table public.psi_company_experience to service_role;

insert into public.psi_company_sites (seed_key, department, city, address, is_main, source)
values ('rup_2026_06_17_sede_principal', 'Risaralda', 'Pereira', 'Calle 10 # 15-64', true, 'RUP 17-jun-2026 (informe)')
on conflict (seed_key) do nothing;

insert into public.psi_company_experience (seed_key, rup_number, contracting_party, contract_object, value_smmlv, value_cop, contract_year, source)
values
  ('rup_2026_06_17_c70', 70, 'Jerónimo Martins Colombia S.A.S. (Tiendas Ara)', null, 49113.99, null, null, 'RUP 17-jun-2026 (informe)'),
  ('rup_2026_06_17_c86', 86, 'Jerónimo Martins Colombia S.A.S. (Tiendas Ara)', null, 43454.45, null, null, 'RUP 17-jun-2026 (informe)'),
  ('rup_2026_06_17_c85', 85, 'Megabús S.A.', 'Servicios integrales de seguridad', 5658.95, null, null, 'RUP 17-jun-2026 (informe)'),
  ('rup_2026_06_17_c84', 84, 'Terminales de Transporte de Medellín S.A.', null, 4555.52, null, null, 'RUP 17-jun-2026 (informe)'),
  ('rup_2026_06_17_c50', 50, 'Aeropuerto Internacional Matecaña', 'Servicios de guardias y sistemas de seguridad', 2893.07, null, null, 'RUP 17-jun-2026 (informe)'),
  ('rup_2026_06_17_c1', 1, 'Universidad Tecnológica de Pereira', null, 1886.93, null, null, 'RUP 17-jun-2026 (informe)'),
  ('rup_2026_06_17_risaralda_2025', null, 'Departamento de Risaralda', 'Vigilancia fija armada y sin arma en entidades oficiales', null, 2245215803, 2025, 'RUP 17-jun-2026 (informe)'),
  ('rup_2026_06_17_carder', null, 'CARDER', 'Vigilancia y monitoreo de cámaras', null, 516228864, null, 'RUP 17-jun-2026 (informe)')
on conflict (seed_key) do nothing;

commit;
