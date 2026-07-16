-- Access-control foundation: organizational scope, additional permissions and immutable audit evidence.
-- Agencies and regions remain operational dimensions, not organizational subareas.

begin;

-- Replace any legacy role check on the profile role with the approved, exact initial catalog.
-- Existing profile values are not updated by this migration.
do $$
declare
  role_check record;
begin
  for role_check in
    select conname
    from pg_constraint
    where conrelid = 'public.psi_sales_profiles'::regclass
      and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%role%'
  loop
    execute format('alter table public.psi_sales_profiles drop constraint if exists %I', role_check.conname);
  end loop;
end $$;

alter table public.psi_sales_profiles
  add constraint psi_sales_profiles_role_check
  check (role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta'));

create table if not exists public.psi_org_areas (
  code text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.psi_org_subareas (
  code text primary key,
  area_code text not null references public.psi_org_areas(code) on delete restrict,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint psi_org_subareas_area_code_code_key unique (area_code, code)
);

create table if not exists public.psi_access_permissions (
  code text primary key,
  name text not null,
  description text,
  active boolean not null default true
);

create table if not exists public.psi_profile_area_assignments (
  profile_id uuid not null references public.psi_sales_profiles(id) on delete cascade,
  area_code text not null references public.psi_org_areas(code) on delete restrict,
  subarea_code text,
  created_at timestamptz not null default now(),
  created_by uuid references public.psi_sales_profiles(id) on delete set null,
  constraint psi_profile_area_assignments_subarea_area_fkey
    foreign key (area_code, subarea_code)
    references public.psi_org_subareas(area_code, code)
    on delete restrict
);

-- NULL subarea_code means the whole area. COALESCE makes this unique too.
create unique index if not exists psi_profile_area_assignments_scope_unique
  on public.psi_profile_area_assignments (profile_id, area_code, coalesce(subarea_code, ''));

create table if not exists public.psi_profile_permissions (
  profile_id uuid not null references public.psi_sales_profiles(id) on delete cascade,
  permission_code text not null references public.psi_access_permissions(code) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references public.psi_sales_profiles(id) on delete set null,
  primary key (profile_id, permission_code)
);

create table if not exists public.psi_access_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.psi_sales_profiles(id) on delete set null,
  target_profile_id uuid references public.psi_sales_profiles(id) on delete set null,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_psi_access_audit_log_target_created
  on public.psi_access_audit_log(target_profile_id, created_at desc);

insert into public.psi_org_areas (code, name) values
  ('gerencia', 'Gerencia'),
  ('comercial', 'Comercial'),
  ('operaciones', 'Operaciones'),
  ('financiera', 'Financiera'),
  ('gestion_humana', 'Gestión Humana'),
  ('tecnologia_innovacion', 'Tecnología e Innovación')
on conflict (code) do nothing;

insert into public.psi_org_subareas (code, area_code, name) values
  ('seguridad_fisica', 'comercial', 'Seguridad Física'),
  ('tecnologia', 'comercial', 'Tecnología'),
  ('licitaciones', 'comercial', 'Licitaciones'),
  ('vigilancia_fisica', 'operaciones', 'Vigilancia Física'),
  ('seguridad_electronica', 'operaciones', 'Seguridad Electrónica'),
  ('sistemas_integrados', 'operaciones', 'Sistemas Integrados'),
  ('contabilidad', 'financiera', 'Contabilidad'),
  ('tesoreria', 'financiera', 'Tesorería'),
  ('cartera', 'financiera', 'Cartera'),
  ('planeacion_presupuesto', 'financiera', 'Planeación y Presupuesto'),
  ('seleccion_contratacion', 'gestion_humana', 'Selección y Contratación'),
  ('nomina', 'gestion_humana', 'Nómina'),
  ('relaciones_laborales', 'gestion_humana', 'Relaciones Laborales'),
  ('bienestar_desarrollo', 'gestion_humana', 'Bienestar y Desarrollo'),
  ('sst', 'gestion_humana', 'SST'),
  ('infraestructura_soporte', 'tecnologia_innovacion', 'Infraestructura y Soporte'),
  ('aplicaciones_datos_integraciones', 'tecnologia_innovacion', 'Aplicaciones, Datos e Integraciones'),
  ('ia_automatizacion', 'tecnologia_innovacion', 'IA y Automatización'),
  ('innovacion_productos', 'tecnologia_innovacion', 'Innovación y Productos'),
  ('seguridad_informacion', 'tecnologia_innovacion', 'Seguridad de la Información')
on conflict (code) do nothing;

insert into public.psi_access_permissions (code, name, description) values
  ('licitaciones', 'Licitaciones', 'Acceso transversal al módulo de Licitaciones.')
on conflict (code) do nothing;

-- Access writes stay backend/service-role mediated. No broad authenticated table access.
revoke all on table public.psi_org_areas, public.psi_org_subareas, public.psi_access_permissions,
  public.psi_profile_area_assignments, public.psi_profile_permissions, public.psi_access_audit_log from public;
revoke all on table public.psi_org_areas, public.psi_org_subareas, public.psi_access_permissions,
  public.psi_profile_area_assignments, public.psi_profile_permissions, public.psi_access_audit_log from authenticated;
grant all on table public.psi_org_areas, public.psi_org_subareas, public.psi_access_permissions,
  public.psi_profile_area_assignments, public.psi_profile_permissions, public.psi_access_audit_log to service_role;

alter table public.psi_org_areas enable row level security;
alter table public.psi_org_subareas enable row level security;
alter table public.psi_access_permissions enable row level security;
alter table public.psi_profile_area_assignments enable row level security;
alter table public.psi_profile_permissions enable row level security;
alter table public.psi_access_audit_log enable row level security;

commit;
