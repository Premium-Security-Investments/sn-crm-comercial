-- Commercial areas, customer segment classification, and audit trail
-- Applies the new business rules from Informe de Requerimientos V1.

alter table if exists public.psi_sales_profiles
  add column if not exists commercial_area text check (commercial_area in ('seguridad_fisica','tecnologia','licitacion_publica')),
  add column if not exists can_edit_customer_segment boolean not null default false;

alter table if exists public.psi_sales_opportunities
  add column if not exists customer_segment text check (customer_segment in ('cliente_nuevo','cliente_actual'));

create table if not exists public.psi_sales_opportunity_audit_logs (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete cascade,
  changed_by uuid references public.psi_sales_profiles(id),
  field_name text not null,
  old_value text,
  new_value text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_psi_sales_profiles_commercial_area on public.psi_sales_profiles(commercial_area);
create index if not exists idx_psi_sales_profiles_segment_permission on public.psi_sales_profiles(can_edit_customer_segment) where can_edit_customer_segment = true;
create index if not exists idx_psi_sales_opportunities_customer_segment on public.psi_sales_opportunities(customer_segment);
create index if not exists idx_psi_sales_opportunity_audit_logs_opportunity on public.psi_sales_opportunity_audit_logs(opportunity_id, created_at desc);

alter table public.psi_sales_opportunity_audit_logs enable row level security;

do $$ begin
  create policy "psi_sales_opportunity_audit_logs_service_all"
    on public.psi_sales_opportunity_audit_logs
    for all
    using (true)
    with check (true);
exception when duplicate_object then null;
end $$;

-- Área Seguridad Física: únicamente los comerciales confirmados por gerencia.
update public.psi_sales_profiles
set commercial_area = 'seguridad_fisica'
where lower(microsoft_email) in (
  'analista3@seguridadnacional.co',
  'comercialfisica1@seguridadnacional.co',
  'comercialfisica3@seguridadnacional.co',
  'dircomercial.medellin@seguridadnacional.co',
  'dircomercial.bogota@seguridadnacional.co'
);

-- Área Licitación Pública: Katherine conserva rol comercial pero área especializada.
update public.psi_sales_profiles
set commercial_area = 'licitacion_publica'
where lower(microsoft_email) = 'directora.licitaciones@seguridadnacional.co';

-- Área Tecnología: Carlos Bedoya. Perfil comercial para asignación y medición de metas.
insert into public.psi_sales_profiles (full_name, microsoft_email, role, active, commercial_area, can_edit_customer_segment)
values ('Carlos Bedoya', 'analista2@seguridadnacional.co', 'comercial', true, 'tecnologia', false)
on conflict (microsoft_email) do update
set full_name = excluded.full_name,
    role = excluded.role,
    active = excluded.active,
    commercial_area = excluded.commercial_area,
    updated_at = now();

-- La clasificación Cliente Nuevo / Cliente Actual debe hacerse manualmente; no inferimos históricos.
