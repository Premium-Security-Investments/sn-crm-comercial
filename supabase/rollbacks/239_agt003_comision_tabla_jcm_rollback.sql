-- Rollback de la 239: borra la lista de clientes de la tabla de Juan Carlos Martínez (se puede recargar).
begin;
drop table if exists public.psi_commission_half_table_clients;
commit;
