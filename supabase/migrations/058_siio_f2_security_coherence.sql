begin;

-- SIIO F2 Task 1: the 10 SIIO tables created by 014_siio_f2_foundation.sql
-- have RLS enabled but no policy was ever added, so their only protection is
-- Supabase's implicit default grant of ALL to anon/authenticated/service_role
-- on new public-schema tables. This migration replaces that implicit posture
-- with explicit, minimal privileges. No RLS policy is added here on purpose:
-- access is gated by role-level GRANTs alone, matching the service-only read
-- pattern already used for psi_company_procurement_documents (055).
do $$
begin
  if to_regclass('public.siio_fronts') is null
    or to_regclass('public.siio_sources') is null
    or to_regclass('public.siio_gerencial_records') is null
    or to_regclass('public.siio_decisions_commitments') is null
    or to_regclass('public.siio_monthly_board_reports') is null
    or to_regclass('public.siio_board_sections') is null
    or to_regclass('public.siio_financial_metrics') is null
    or to_regclass('public.siio_commercial_signals') is null
    or to_regclass('public.siio_payroll_aggregates') is null
    or to_regclass('public.siio_strategic_opportunities') is null
  then
    raise exception 'Migración 058 requiere las 10 tablas SIIO creadas por 014.';
  end if;
end
$$;

alter table public.siio_fronts enable row level security;
alter table public.siio_sources enable row level security;
alter table public.siio_gerencial_records enable row level security;
alter table public.siio_decisions_commitments enable row level security;
alter table public.siio_monthly_board_reports enable row level security;
alter table public.siio_board_sections enable row level security;
alter table public.siio_financial_metrics enable row level security;
alter table public.siio_commercial_signals enable row level security;
alter table public.siio_payroll_aggregates enable row level security;
alter table public.siio_strategic_opportunities enable row level security;

revoke all on table public.siio_fronts from public, anon, authenticated, service_role;
revoke all on table public.siio_sources from public, anon, authenticated, service_role;
revoke all on table public.siio_gerencial_records from public, anon, authenticated, service_role;
revoke all on table public.siio_decisions_commitments from public, anon, authenticated, service_role;
revoke all on table public.siio_monthly_board_reports from public, anon, authenticated, service_role;
revoke all on table public.siio_board_sections from public, anon, authenticated, service_role;
revoke all on table public.siio_financial_metrics from public, anon, authenticated, service_role;
revoke all on table public.siio_commercial_signals from public, anon, authenticated, service_role;
revoke all on table public.siio_payroll_aggregates from public, anon, authenticated, service_role;
revoke all on table public.siio_strategic_opportunities from public, anon, authenticated, service_role;

grant select on table public.siio_fronts to service_role;
grant select on table public.siio_sources to service_role;
grant select on table public.siio_gerencial_records to service_role;
grant select on table public.siio_decisions_commitments to service_role;
grant select on table public.siio_monthly_board_reports to service_role;
grant select on table public.siio_board_sections to service_role;
grant select on table public.siio_financial_metrics to service_role;
grant select on table public.siio_commercial_signals to service_role;
grant select on table public.siio_payroll_aggregates to service_role;
grant select on table public.siio_strategic_opportunities to service_role;

-- Only these 3 tables get write access, and only INSERT/UPDATE (no DELETE):
-- operational history stays append/amend-only, never erased.
grant insert, update on table public.siio_sources to service_role;
grant insert, update on table public.siio_gerencial_records to service_role;
grant insert, update on table public.siio_decisions_commitments to service_role;

commit;
