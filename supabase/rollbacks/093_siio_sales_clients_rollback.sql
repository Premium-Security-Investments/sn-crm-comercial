begin;

-- Operational rollback for migration 093 (SIIO sales client master).
-- Restores the pre-093 schema without deleting any opportunity row.
-- This intentionally removes only the client master and client_id links created by
-- this functionality; opportunity records and their original company_name remain.

lock table public.psi_sales_opportunities in access exclusive mode;
lock table public.psi_sales_clients in access exclusive mode;

drop function if exists public.psi_persist_sales_opportunity(text,uuid,uuid,uuid,jsonb,jsonb);

alter table public.psi_sales_opportunities
  drop constraint if exists psi_sales_opportunities_public_tender_client_check;

alter table public.psi_sales_opportunities
  drop column if exists client_id;

drop table if exists public.psi_sales_clients;

drop function if exists public.psi_sales_normalize_client_name(text);

commit;
