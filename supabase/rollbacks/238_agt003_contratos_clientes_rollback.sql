-- Rollback de la 238: borra la tabla de contratos de clientes (los datos vienen de un archivo y se pueden recargar).
begin;
drop table if exists public.psi_client_contracts;
commit;
