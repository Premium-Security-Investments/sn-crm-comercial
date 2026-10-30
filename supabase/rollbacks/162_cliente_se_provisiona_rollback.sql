-- Revierte 162. Se pierde la lista declarada de clientes a provisionar; ningun cliente,
-- oportunidad ni dato de Avancys se toca.
begin;
drop table if exists public.psi_cliente_provision;
commit;
