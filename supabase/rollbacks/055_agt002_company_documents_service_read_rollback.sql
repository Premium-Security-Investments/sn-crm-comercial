begin;

-- Rollback operativo de 055: retira únicamente el SELECT de service_role
-- concedido por 055. public/anon/authenticated ya carecían de privilegios
-- desde 026 y no se tocan; la tabla y sus datos permanecen intactos.
do $$
begin
  if to_regclass('public.psi_company_procurement_documents') is null then
    raise exception 'Rollback 055 requiere que exista psi_company_procurement_documents.';
  end if;
end
$$;

revoke select on table public.psi_company_procurement_documents from service_role;

commit;
