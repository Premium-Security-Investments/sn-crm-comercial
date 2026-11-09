-- Reversa de la 195: vuelve vigente la versión anterior del bloque de licencia de comunicaciones. La versión con la
-- cobertura queda como historial (el registro no borra).
begin;
do $$
declare v_cur public.psi_agt002_company_evidence_registry%rowtype;
begin
  select * into v_cur from public.psi_agt002_company_evidence_registry where entry_id = 'communications_license' and current;
  if not found or v_cur.source_reference not like 'Resolución MinTIC 01535%' then return; end if;
  update public.psi_agt002_company_evidence_registry set current = false where id = v_cur.id;
  update public.psi_agt002_company_evidence_registry set current = true where entry_id = 'communications_license' and version = v_cur.version - 1;
end;
$$;
commit;
