-- Reversión de la 225: vuelve a una sola etapa (la carpeta completa con el GO). Las filas creadas por ingreso se borran:
-- las carpetas en SharePoint quedan como estén (esto no toca SharePoint).
begin;
delete from public.psi_tender_filing_folders where origin = 'ingreso';
alter table public.psi_tender_filing_folders drop constraint if exists psi_tender_filing_folders_etapa_check;
alter table public.psi_tender_filing_folders drop column if exists etapa;
alter table public.psi_tender_filing_folders drop constraint if exists psi_tender_filing_folders_origin_check;
alter table public.psi_tender_filing_folders add constraint psi_tender_filing_folders_origin_check check (origin in ('go', 'boton'));
commit;
