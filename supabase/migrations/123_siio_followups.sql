-- AGT-001 / Gerencia: Seguimiento gerencial (compromisos con responsable y fecha).
-- Decisión de Juan 2026-10-11: un solo tipo (compromiso); responsables escritos por nombre;
-- ven dueños, directivos de consulta y Junta; la Junta también crea; cierre automático
-- cuando el dato del CRM lo comprueba. Los registros de siio_gerencial_records no se tocan.
-- Source-only migration. Applying it to any remote environment requires a separate gate.

create table if not exists public.siio_followups (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 3 and 300),
  owner_label text not null check (length(btrim(owner_label)) between 2 and 120),
  due_date date not null,
  origin_type text not null check (origin_type in ('licitacion','oportunidad','finanzas','recomendacion_ia','junta','reunion','otro')),
  origin_ref text check (origin_ref is null or length(origin_ref) <= 120),
  origin_label text check (origin_label is null or length(origin_label) <= 300),
  auto_rule text check (auto_rule is null or auto_rule in ('tender_decision','tender_status','opportunity_activity')),
  status text not null default 'abierto' check (status in ('abierto','cumplido','cancelado')),
  notes jsonb not null default '[]'::jsonb check (jsonb_typeof(notes) = 'array'),
  created_by uuid references public.psi_sales_profiles(id) on delete set null,
  created_role text not null check (created_role in ('admin','gerencia','junta')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_by uuid references public.psi_sales_profiles(id) on delete set null,
  closed_at timestamptz,
  close_reason text check (close_reason is null or close_reason in ('manual','automatico','cancelado')),
  close_evidence text check (close_evidence is null or length(close_evidence) <= 500),
  constraint siio_followups_closed_consistency check (
    (status = 'abierto' and closed_at is null and close_reason is null)
    or (status <> 'abierto' and closed_at is not null and close_reason is not null)
  ),
  constraint siio_followups_auto_rule_needs_ref check (auto_rule is null or origin_ref is not null)
);

create index if not exists siio_followups_status_due_idx on public.siio_followups (status, due_date);
create index if not exists siio_followups_origin_idx on public.siio_followups (origin_type, origin_ref);

alter table public.siio_followups enable row level security;
revoke all on table public.siio_followups from public, anon, authenticated, service_role;
grant select, insert, update on table public.siio_followups to service_role;
