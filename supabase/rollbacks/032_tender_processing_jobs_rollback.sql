do $$
begin
  if exists (select 1 from public.psi_tender_processing_jobs where status not in ('cancelled','completed') limit 1) then
    raise exception 'Rollback 032 bloqueado: existen jobs activos.';
  end if;
end $$;
drop table if exists public.psi_tender_document_import_items;
drop table if exists public.psi_tender_processing_jobs;
