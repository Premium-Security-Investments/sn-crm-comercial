-- Revierte 165. Deja de poderse crear procesos a mano.
--
-- No borra nada de lo ya creado: las parejas licitación + oportunidad registradas a mano quedan en pie y siguen
-- funcionando como cualquier otra (expediente, análisis, documentos, decisión y cierre), porque no dependen de la
-- función para existir. Lo único que se pierde es la marca de quién las registró a mano (`manual_entry_by` /
-- `manual_entry_at`), que es informativa, y el índice único que impedía registrar dos veces el mismo proceso.
begin;
drop function if exists public.psi_create_manual_tender_opportunity(uuid, uuid, text, text, text, text, text, text, text, text, text, text, numeric, timestamptz, date, text, text, jsonb);
drop index if exists public.psi_sales_opportunities_manual_tender_external_source_unique;
alter table public.psi_public_tenders
  drop column if exists manual_entry_by,
  drop column if exists manual_entry_at;
commit;
