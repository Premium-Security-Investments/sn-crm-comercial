begin;

-- Normalizes access to the company procurement document register (026): the
-- AGT-002 workbench backend needs read access via the service role, but 026
-- revoked ALL privileges from every role, including service_role. Regardless
-- of the current grant state (untouched since 026, or drifted by a stray
-- manual grant), this fully re-normalizes to exactly service_role SELECT.
do $$
begin
  if to_regclass('public.psi_company_procurement_documents') is null then
    raise exception 'Migración 055 requiere que exista psi_company_procurement_documents (026).';
  end if;
end
$$;

alter table public.psi_company_procurement_documents enable row level security;

revoke all on table public.psi_company_procurement_documents from public;
revoke all on table public.psi_company_procurement_documents from anon;
revoke all on table public.psi_company_procurement_documents from authenticated;
revoke all on table public.psi_company_procurement_documents from service_role;

grant select on table public.psi_company_procurement_documents to service_role;

commit;
