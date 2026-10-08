-- AGT-003 — Campos del perfil del cliente en la ficha comercial (decisión de Juan, 2026-10-08).
-- Aditiva: columnas opcionales en psi_sales_opportunities. No cambia vistas, RPC ni permisos; el servidor
-- (service_role) las escribe tras guardar la oportunidad y las lee aparte. Sede y Comisión % siguen en la tabla,
-- sólo se ocultan del formulario.
begin;

alter table public.psi_sales_opportunities
  add column if not exists company_website text,
  add column if not exists company_nit text,
  add column if not exists decision_maker_title text,
  add column if not exists decision_maker_linkedin text,
  add column if not exists current_security_provider text,
  add column if not exists current_security_provider_none boolean not null default false,
  add column if not exists current_contract_end_date date;

comment on column public.psi_sales_opportunities.company_website is 'AGT-003: página web pública de la empresa (la IA comercial puede leerla).';
comment on column public.psi_sales_opportunities.company_nit is 'AGT-003: NIT de la empresa (opcional; no cuenta para perfil completo).';
comment on column public.psi_sales_opportunities.decision_maker_title is 'AGT-003: cargo del decisor.';
comment on column public.psi_sales_opportunities.decision_maker_linkedin is 'AGT-003: perfil de LinkedIn del decisor (sólo referencia del comercial).';
comment on column public.psi_sales_opportunities.current_security_provider is 'AGT-003: proveedor actual de seguridad del cliente.';
comment on column public.psi_sales_opportunities.current_security_provider_none is 'AGT-003: el cliente no tiene proveedor (seguridad propia o ninguna); cuenta como respondido.';
comment on column public.psi_sales_opportunities.current_contract_end_date is 'AGT-003: vencimiento del contrato con el proveedor actual (opcional; no cuenta para perfil completo).';

commit;
