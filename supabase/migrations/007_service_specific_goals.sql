-- Service/regional-specific commercial goals.
-- Existing 2026 goals came from Seguridad Física projections, so preserve them under that product.

alter table if exists public.psi_sales_goals
  add column if not exists service_type_code text not null default 'seguridad_fisica',
  add column if not exists regional_nombre text not null default 'todas',
  add column if not exists operational_unit_target numeric not null default 0;

update public.psi_sales_goals
set service_type_code = 'seguridad_fisica'
where service_type_code is null or service_type_code = '';

update public.psi_sales_goals
set regional_nombre = 'todas'
where regional_nombre is null or regional_nombre = '';

alter table if exists public.psi_sales_goals
  drop constraint if exists psi_sales_goals_user_id_period_month_key;

alter table if exists public.psi_sales_goals
  drop constraint if exists psi_sales_goals_user_period_service_regional_unique;

alter table if exists public.psi_sales_goals
  add constraint psi_sales_goals_user_period_service_regional_unique
  unique (user_id, period_month, service_type_code, regional_nombre);

alter table if exists public.psi_sales_goals
  drop constraint if exists psi_sales_goals_service_type_code_fkey;

alter table if exists public.psi_sales_goals
  add constraint psi_sales_goals_service_type_code_fkey
  foreign key (service_type_code) references public.psi_sales_service_types(code);

create index if not exists idx_psi_sales_goals_service_regional
  on public.psi_sales_goals(service_type_code, regional_nombre, period_month);
