-- Rollback de 177: quita las funciones y la tabla de pedidos. Los archivos ya subidos a SharePoint se quedan allá: no
-- se borran desde aquí, porque pueden tener correcciones de una persona.
begin;
drop function if exists public.psi_finish_tender_draft_sharepoint_copy(uuid, boolean, text, text, text);
drop function if exists public.psi_claim_tender_draft_sharepoint_copies(integer);
drop function if exists public.psi_list_tender_draft_sharepoint_copies(uuid);
drop function if exists public.psi_request_tender_draft_sharepoint_copy(uuid, uuid, uuid);
drop table if exists public.psi_tender_dossier_sharepoint_copies;
commit;
