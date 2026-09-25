begin;

-- Rollback for migration 092 (SIIO sales client master).
--
-- Undoes only 092's additions: drops the client_id FK column from
-- public.psi_sales_opportunities and drops public.psi_sales_clients entirely, restoring the
-- database to its exact pre-092 shape. No row of psi_sales_opportunities is ever deleted here.
--
-- Fails closed: refuses to drop anything while any opportunity still carries a non-null
-- client_id, since dropping the column would silently discard that link.

lock table public.psi_sales_opportunities in access exclusive mode;
lock table public.psi_sales_clients in access exclusive mode;

do $$
begin
  if exists (select 1 from public.psi_sales_opportunities where client_id is not null) then
    raise exception 'bloqueado: no se puede revertir la migracion 092 mientras alguna oportunidad tenga client_id asignado';
  end if;
end
$$;

alter table public.psi_sales_opportunities
  drop column if exists client_id;

drop table if exists public.psi_sales_clients;

commit;
