-- Reversa de la 203: quita el registro de las carpetas de radicación. Las carpetas de SharePoint quedan como están.
begin;
drop table if exists public.psi_tender_filing_folders;
commit;
