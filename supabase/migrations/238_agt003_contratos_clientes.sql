-- AGT-003 — Contratos de los clientes: inicio, última renovación y fin (Juan, 2026-11-26).
--
-- Para qué: (1) comisiones — la regla base 2026 paga la vigilancia 12 meses desde que se firma el contrato o su
-- renovación; (2) alertas de vencimiento en Mi día y en el Dashboard; (3) ver qué clientes reciben servicio sin
-- contrato vigente.
--
-- Fuente por dato: el lugar de estas fechas es Avancys (los contratos existen allá, en project.project, con los campos
-- de inicio y fin vacíos al 2026-11-25). Mientras Avancys no las tenga, se cargan aquí desde el archivo que compartió
-- Juan; cuando Avancys las tenga, el CRM usa las de Avancys y estas quedan como respaldo. Cada fila dice su fuente.
--
-- Una fila por cliente (NIT). Sólo el servidor la lee (service_role); RLS encendido y revoke a anon/authenticated.
begin;

create table if not exists public.psi_client_contracts (
  id uuid primary key default gen_random_uuid(),
  nit text not null unique check (nit ~ '^[0-9]{5,12}$'),
  razon_social text,
  fecha_inicio date,
  fecha_ultima_renovacion date,
  fecha_fin date,
  duracion text,
  observacion text,
  fuente text not null,
  cargado_en timestamptz not null default now()
);

alter table public.psi_client_contracts enable row level security;
revoke all on table public.psi_client_contracts from public, anon, authenticated;
grant all on table public.psi_client_contracts to service_role;

commit;
