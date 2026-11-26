-- AGT-003 — Clientes que se comisionan con la tabla «% comisión clientes Juan Carlos Martínez» (Juan, 2026-11-26).
--
-- La regla base 2026 (Excel «Comisiones Comerciales Condiciones 2026») tiene una tabla aparte, la mitad de la normal,
-- para los clientes de Juan Carlos Martínez; Jhon Bermúdez cobra sus clientes antiguos con ella. Ni Avancys ni el CRM
-- saben cuáles son: la lista la pide Juan y se carga aquí, un NIT por fila, con su fuente. Vacía, todos van con la tabla
-- normal. Sólo el servidor la lee; RLS encendido y revoke a anon/authenticated.
begin;
create table if not exists public.psi_commission_half_table_clients (
  nit text primary key check (nit ~ '^[0-9]{5,12}$'),
  razon_social text,
  fuente text not null,
  cargado_en timestamptz not null default now()
);
alter table public.psi_commission_half_table_clients enable row level security;
revoke all on table public.psi_commission_half_table_clients from public, anon, authenticated;
grant all on table public.psi_commission_half_table_clients to service_role;
commit;
