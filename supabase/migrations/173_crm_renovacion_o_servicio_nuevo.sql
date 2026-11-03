-- AGT-003 — Cliente actual: ¿renovación o servicio nuevo? (decisión de Juan, 2026-11-03).
--
-- Con un cliente que ya tenemos pasan dos cosas distintas: se renueva el contrato que ya existe, o se le vende un
-- servicio o solución nueva. El CRM sólo decía "Cliente Nuevo / Cliente Actual" y las dos quedaban revueltas.
--
-- Aditiva, como la 113: una columna opcional en psi_sales_opportunities. No cambia vistas, RPC ni permisos; el
-- servidor (service_role) la escribe junto con el perfil del cliente y la lee aparte. La regla de negocio —obligatoria
-- cuando el cliente es actual, y en una renovación también la fecha en que vence el contrato— la valida el servidor
-- (`src/vigia/client-profile.js`), no la base: así un cambio de tipo de cliente por otro camino no choca con un check.
begin;

alter table public.psi_sales_opportunities
  add column if not exists client_deal_type text;

alter table public.psi_sales_opportunities
  drop constraint if exists psi_sales_opportunities_client_deal_type_check;
alter table public.psi_sales_opportunities
  add constraint psi_sales_opportunities_client_deal_type_check
  check (client_deal_type is null or client_deal_type in ('renovacion', 'servicio_nuevo'));

comment on column public.psi_sales_opportunities.client_deal_type is
  'AGT-003: con Cliente Actual, si la oportunidad es renovación del contrato existente o un servicio nuevo.';

commit;
