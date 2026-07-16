-- Access-control foundation: organizational scope, additional permissions and immutable audit evidence.
-- Agencies and regions remain operational dimensions, not organizational subareas.

begin;

-- Abort before any DDL if historical role data cannot satisfy the approved catalog.
do $$
declare
  blocked_roles text;
begin
  select string_agg(
    case when role is null then 'NULL' else quote_literal(role) end,
    ', ' order by case when role is null then 0 else 1 end, role
  )
  into blocked_roles
  from (
    select distinct role
    from public.psi_sales_profiles
    where role is null
       or role not in ('admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta')
  ) invalid_roles;

  if blocked_roles is not null then
    raise exception 'No se puede aplicar 019: roles históricos no aprobados: %. Normalice estos valores a admin, gerencia, director, comercial, colaborador o junta antes de reintentar.', blocked_roles;
  end if;
end $$;

-- Replace only a CHECK whose constrained columns are exactly the role column.
-- Composite checks (for example role + active) are unrelated business rules and survive.
do $$
declare
  role_attnum smallint;
  role_check_count integer;
  role_check_name text;
begin
  select attnum
    into role_attnum
    from pg_attribute
   where attrelid = 'public.psi_sales_profiles'::regclass
     and attname = 'role'
     and not attisdropped;

  if role_attnum is null then
    raise exception 'No se puede aplicar 019: falta la columna public.psi_sales_profiles.role.';
  end if;

  select count(*), min(conname)
    into role_check_count, role_check_name
    from pg_constraint
   where conrelid = 'public.psi_sales_profiles'::regclass
     and contype = 'c'
     and conkey = array[role_attnum]::smallint[];

  if role_check_count > 1 then
    raise exception 'No se puede aplicar 019: hay % CHECKs exclusivos sobre psi_sales_profiles.role; resuelva la ambigüedad antes de reintentar.', role_check_count;
  end if;

  if role_check_count = 1 then
    execute format('alter table public.psi_sales_profiles drop constraint %I', role_check_name);
  end if;
end $$;

alter table public.psi_sales_profiles
  add constraint psi_sales_profiles_role_check
  check (role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta'));

create table if not exists public.psi_org_areas (
  code text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint psi_org_areas_code_not_blank check (btrim(code) <> '')
);

create table if not exists public.psi_org_subareas (
  code text primary key,
  area_code text not null references public.psi_org_areas(code) on delete restrict,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint psi_org_subareas_code_not_blank check (btrim(code) <> ''),
  constraint psi_org_subareas_area_code_not_blank check (btrim(area_code) <> ''),
  constraint psi_org_subareas_area_code_code_key unique (area_code, code)
);

create table if not exists public.psi_access_permissions (
  code text primary key,
  name text not null,
  description text,
  active boolean not null default true,
  constraint psi_access_permissions_code_not_blank check (btrim(code) <> '')
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
    on update cascade
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
  actor_profile_id uuid,
  target_profile_id uuid,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now(),
  constraint psi_access_audit_log_action_not_blank check (btrim(action) <> '')
);

-- Add validation constraints when rerunning against an earlier 019 schema.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.psi_org_areas'::regclass and conname = 'psi_org_areas_code_not_blank') then
    alter table public.psi_org_areas add constraint psi_org_areas_code_not_blank check (btrim(code) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.psi_org_subareas'::regclass and conname = 'psi_org_subareas_code_not_blank') then
    alter table public.psi_org_subareas add constraint psi_org_subareas_code_not_blank check (btrim(code) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.psi_org_subareas'::regclass and conname = 'psi_org_subareas_area_code_not_blank') then
    alter table public.psi_org_subareas add constraint psi_org_subareas_area_code_not_blank check (btrim(area_code) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.psi_access_permissions'::regclass and conname = 'psi_access_permissions_code_not_blank') then
    alter table public.psi_access_permissions add constraint psi_access_permissions_code_not_blank check (btrim(code) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.psi_access_audit_log'::regclass and conname = 'psi_access_audit_log_action_not_blank') then
    alter table public.psi_access_audit_log add constraint psi_access_audit_log_action_not_blank check (btrim(action) <> '');
  end if;
end $$;

-- Existing 019 deployments used ON DELETE SET NULL, which would mutate audit rows.
alter table public.psi_access_audit_log
  drop constraint if exists psi_access_audit_log_actor_profile_id_fkey;
alter table public.psi_access_audit_log
  drop constraint if exists psi_access_audit_log_target_profile_id_fkey;
alter table public.psi_access_audit_log
  drop constraint if exists psi_access_audit_log_actor_profile_fkey;
alter table public.psi_access_audit_log
  drop constraint if exists psi_access_audit_log_target_profile_fkey;
alter table public.psi_access_audit_log
  add constraint psi_access_audit_log_actor_profile_fkey
  foreign key (actor_profile_id) references public.psi_sales_profiles(id) on delete restrict;
alter table public.psi_access_audit_log
  add constraint psi_access_audit_log_target_profile_fkey
  foreign key (target_profile_id) references public.psi_sales_profiles(id) on delete restrict;

-- Rebuild this key explicitly so legacy 019 deployments gain ON UPDATE CASCADE.
alter table public.psi_profile_area_assignments
  drop constraint if exists psi_profile_area_assignments_subarea_area_fkey;
alter table public.psi_profile_area_assignments
  add constraint psi_profile_area_assignments_subarea_area_fkey
  foreign key (area_code, subarea_code)
  references public.psi_org_subareas(area_code, code)
  on delete restrict
  on update cascade;

create index if not exists idx_psi_access_audit_log_target_created
  on public.psi_access_audit_log(target_profile_id, created_at desc);

insert into public.psi_org_areas (code, name) values
  ('gerencia', 'Gerencia'),
  ('comercial', 'Comercial'),
  ('operaciones', 'Operaciones'),
  ('financiera', 'Financiera'),
  ('gestion_humana', 'Gestión Humana'),
  ('tecnologia_innovacion', 'Tecnología e Innovación')
on conflict (code) do update
  set name = excluded.name,
      active = true;

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
on conflict (code) do update
  set area_code = excluded.area_code,
      name = excluded.name,
      active = true;

insert into public.psi_access_permissions (code, name, description) values
  ('licitaciones', 'Licitaciones', 'Acceso transversal al módulo de Licitaciones.')
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      active = true;

-- Audit evidence is append-only, including for owners or BYPASSRLS roles.
create or replace function public.psi_access_audit_log_prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'psi_access_audit_log is immutable: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_access_audit_log_immutable on public.psi_access_audit_log;
create trigger psi_access_audit_log_immutable
  before update or delete on public.psi_access_audit_log
  for each row execute function public.psi_access_audit_log_prevent_mutation();

-- Access writes stay backend/service-role mediated. No broad authenticated table access.
revoke all on table public.psi_org_areas, public.psi_org_subareas, public.psi_access_permissions,
  public.psi_profile_area_assignments, public.psi_profile_permissions from public;
revoke all on table public.psi_org_areas, public.psi_org_subareas, public.psi_access_permissions,
  public.psi_profile_area_assignments, public.psi_profile_permissions from authenticated;
grant all on table public.psi_org_areas, public.psi_org_subareas, public.psi_access_permissions,
  public.psi_profile_area_assignments, public.psi_profile_permissions to service_role;

revoke all on table public.psi_access_audit_log from public;
revoke all on table public.psi_access_audit_log from authenticated;
revoke all on table public.psi_access_audit_log from service_role;
grant select, insert on table public.psi_access_audit_log to service_role;

alter table public.psi_org_areas enable row level security;
alter table public.psi_org_subareas enable row level security;
alter table public.psi_access_permissions enable row level security;
alter table public.psi_profile_area_assignments enable row level security;
alter table public.psi_profile_permissions enable row level security;
alter table public.psi_access_audit_log enable row level security;

commit;
